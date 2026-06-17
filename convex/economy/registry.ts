import type { AgentStanding } from './ponderClient';

// The Standing-side fields the economic tick needs from Ponder/registry. USDC wallet
// balances (energy source) are NOT here — those stay live chain reads in the tick.
export type StandingSource = Pick<
  AgentStanding,
  'costPerThink' | 'floor' | 'recoveryWindow' | 'marketCap' | 'tokenBalance' | 'alive'
>;

export interface EconomyParamDefaults {
  costPerThink: string;
  floor: string;
  recoveryWindow: number;
}

export interface ResolvedEconomyParams {
  costPerThink: bigint;
  floor: bigint;
  recoveryWindow: number;
  marketCap: bigint; // Standing
  tokenBalance: bigint;
  alive: boolean;
}

function bigOr(v: string | undefined, fallback: bigint): bigint {
  if (v === undefined) return fallback;
  try { return BigInt(v); } catch { return fallback; }
}

/**
 * Hybrid resolution: prefer Ponder/registry Standing values; fall back per-field to env
 * defaults (constants mirror) when Ponder is down/disabled or a field is malformed.
 * This replaces Plan 4's constants mirror as the Standing/life-param source.
 */
export function resolveEconomyParams(
  standing: StandingSource | null,
  defaults: EconomyParamDefaults,
): ResolvedEconomyParams {
  const dCost = bigOr(defaults.costPerThink, 10000n);
  const dFloor = bigOr(defaults.floor, 0n);
  if (!standing) {
    return { costPerThink: dCost, floor: dFloor, recoveryWindow: defaults.recoveryWindow, marketCap: 0n, tokenBalance: 0n, alive: true };
  }
  const rw = Number.isFinite(standing.recoveryWindow) && standing.recoveryWindow > 0 ? standing.recoveryWindow : defaults.recoveryWindow;
  return {
    costPerThink: bigOr(standing.costPerThink, dCost),
    floor: bigOr(standing.floor, dFloor),
    recoveryWindow: rw,
    marketCap: bigOr(standing.marketCap, 0n),
    tokenBalance: bigOr(standing.tokenBalance, 0n),
    alive: standing.alive ?? true,
  };
}
