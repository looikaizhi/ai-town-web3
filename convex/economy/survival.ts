export type SurvivalStatus = 'alive' | 'starving' | 'dead';

export interface SurvivalState {
  status: SurvivalStatus;
  starvingPeriods: number;
  starvingSince?: number;
  diedAt?: number;
}

/** energy = how many more thoughts the EOA can afford (floor division). */
export function computeEnergy(eoaUsdc: bigint, costPerThink: bigint): number {
  if (costPerThink <= 0n) return 0;
  return Number(eoaUsdc / costPerThink);
}

/** isDying = out of thinking budget OR Standing collapsed to/below the floor. */
export function isDying(energy: number, standing: bigint, floor: bigint): boolean {
  return energy <= 0 || standing <= floor;
}

/**
 * The survival state machine. Death is reached only after `recoveryWindow` (T)
 * consecutive dying periods — the rescue window. Death is terminal (the coin's value
 * is the life; once gone it stays gone in SP1). Plan 5's keeper turns `dead` into an
 * on-chain markDead + AgentDied.
 */
export function advanceSurvival(
  prev: SurvivalState,
  dying: boolean,
  now: number,
  recoveryWindow: number,
): SurvivalState {
  if (prev.status === 'dead') return prev;
  if (!dying) return { status: 'alive', starvingPeriods: 0 };
  const starvingPeriods = prev.starvingPeriods + 1;
  const starvingSince = prev.starvingSince ?? now;
  if (starvingPeriods >= recoveryWindow) {
    return { status: 'dead', starvingPeriods, starvingSince, diedAt: now };
  }
  return { status: 'starving', starvingPeriods, starvingSince };
}
