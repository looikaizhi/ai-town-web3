import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { rivalryEnabled, ponderUrl } from './constants';

type PonderRival = {
  agentId: string;
  marketCap: string;
  pricePerToken: string;
  alive: boolean;
  allied: boolean;
};

export const runRivalryTick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!rivalryEnabled()) return;
    const purl = ponderUrl();
    if (!purl) return;

    // 遍历 5 个居民
    const allAgentIds: string[] = [];
    for (let i = 0; i < 5; i++) allAgentIds.push(String(i));

    for (const agentId of allAgentIds) {
      let rivals: PonderRival[] = [];
      try {
        const r = await fetch(`${purl}/agents/${agentId}/rivals`);
        if (!r.ok) continue;
        rivals = (await r.json()) as PonderRival[];
      } catch {
        continue;
      }

      const now = Date.now();
      for (const rival of rivals) {
        await ctx.runMutation(internal.rivalry.rivals.upsertRivalState, {
          onchainAgentId: agentId,
          rivalAgentId: rival.agentId,
          marketCap: rival.marketCap,
          alive: rival.alive,
          allied: rival.allied,
          updatedAt: now,
        });
      }
      await ctx.runMutation(internal.rivalry.rivals.setCursor, {
        onchainAgentId: agentId,
        lastUpdatedAt: now,
      });
    }
  },
});
