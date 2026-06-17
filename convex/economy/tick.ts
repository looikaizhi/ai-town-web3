import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { createExecutorClient } from './executorClient';
import { createPonderClient } from './ponderClient';
import { resolveEconomyParams } from './registry';
import { computeEnergy, isDying, advanceSurvival, SurvivalState } from './survival';
import {
  COST_PER_THINK,
  STANDING_FLOOR,
  RECOVERY_WINDOW,
  DEFAULT_ECON_AGENT_ID,
  economyEnabled,
  executorUrl,
  ponderUrl,
  keeperEnabled,
  agentIds,
  agentEoaForId,
} from './constants';

/**
 * The economic heartbeat (Plan 5 hybrid data source). Every ECONOMIC_TICK_SECONDS it:
 *  - reads Standing + life params from Ponder (marketCap, costPerThink, floor, T, alive),
 *    falling back to the env/constants mirror when Ponder is down/disabled;
 *  - reads USDC wallet balances LIVE from the executor (eoaUsdc = energy source);
 *  - advances the survival state machine and caches the snapshot;
 *  - on the first transition to `dead`, asks the executor keeper to markDead on-chain.
 * No-ops when the economy is disabled, no default world/agent exists, or the executor
 * is down. The reactive sell/sweep still lives in the payment seam (Plan 4).
 */
export const runEconomicTick = internalAction({
  args: {},
  handler: async (ctx) => {
    await runEconomicTickHandler(ctx);
  },
});

// Extracted so the gated e2e action (e2e.ts) can drive a single tick deterministically.
export async function runEconomicTickHandler(ctx: any): Promise<void> {
  if (!economyEnabled()) return;

  const worldData = await ctx.runQuery(internal.economy.perception.getAllWorldAgents, {});
  if (!worldData) return;

  const { worldId, agents } = worldData;
  const ids = agentIds(); // e.g. ["0","1","2","3","4"]
  const executor = createExecutorClient(executorUrl());
  const purl = ponderUrl();

  for (const econAgentId of ids) {
    const agentIndex = parseInt(econAgentId, 10);
    const agentEntry = agents[agentIndex];
    if (!agentEntry) {
      console.warn(`[economy] no ai-town agent at index ${agentIndex}, skipping`);
      continue;
    }

    const eoa = agentEoaForId(econAgentId);

    try {
      // USDC balances (energy) — LIVE chain truth
      const balances = await executor.balances(econAgentId);

      // Standing + life params
      const standing = purl ? await createPonderClient(purl).agentStanding(econAgentId) : null;
      const params = resolveEconomyParams(standing, {
        costPerThink: process.env.COST_PER_THINK ?? COST_PER_THINK,
        floor: process.env.STANDING_FLOOR ?? STANDING_FLOOR,
        recoveryWindow: Number(process.env.RECOVERY_WINDOW ?? RECOVERY_WINDOW),
      });

      const standingMarketCap = standing ? params.marketCap : BigInt(balances.marketCap);
      const energy = computeEnergy(BigInt(balances.eoaUsdc), params.costPerThink);
      const dying = isDying(energy, standingMarketCap, params.floor);

      const prevRow = await ctx.runQuery(internal.economy.perception.getAgentEconomyByEconId, {
        worldId,
        econAgentId,
      });
      const prevState: SurvivalState = prevRow
        ? {
            status: prevRow.status,
            starvingPeriods: prevRow.starvingPeriods,
            starvingSince: prevRow.starvingSince,
            diedAt: prevRow.diedAt,
          }
        : { status: 'alive', starvingPeriods: 0 };

      const now = Date.now();
      const next = advanceSurvival(prevState, dying, now, params.recoveryWindow);

      await ctx.runMutation(internal.economy.perception.upsertAgentEconomy, {
        worldId,
        agentId: agentEntry.agentId,
        econAgentId,
        eoa,
        eoaUsdc: balances.eoaUsdc,
        smartUsdc: balances.smartUsdc,
        tokenBalance: standing ? params.tokenBalance.toString() : balances.tokenBalance,
        marketCap: standingMarketCap.toString(),
        energy,
        lastPerceivedAt: now,
        status: next.status,
        starvingPeriods: next.starvingPeriods,
        starvingSince: next.starvingSince,
        diedAt: next.diedAt,
      });

      if (next.status === 'dead' && prevState.status !== 'dead') {
        console.log(`[economy] agent ${econAgentId} DIED`);
        if (keeperEnabled()) {
          try {
            const tx = await executor.markDead(econAgentId);
            console.log(`[economy] keeper markDead(${econAgentId}) -> ${tx}`);
          } catch (e) {
            console.error(`[economy] keeper markDead(${econAgentId}) failed`, e);
          }
        }
      }
    } catch (e) {
      // 单个 agent 失败不影响其他 agent
      console.error(`[economy] tick failed for agent ${econAgentId}`, e);
    }
  }
}
