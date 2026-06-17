// Pure mapping: economy snapshot -> gauge view (display fractions + state flags).
// Display normalizations only; not on-chain semantics.

export const ENERGY_FULL = 100; // remaining "thinks" that fills the energy bar
export const STANDING_FULL_USDC = 100_000_000n; // 100 USDC (6dec) fills the standing bar

export type GaugeState = 'healthy' | 'starving' | 'dead';

export interface GaugeView {
  energyFrac: number; // 0..1
  standingFrac: number; // 0..1
  countdownFrac: number; // 0..1 (1 = full rescue window, 0 = out of time)
  state: GaugeState;
  pulsing: boolean;
}

export interface GaugeInput {
  status: 'alive' | 'starving' | 'dead';
  energy: number;
  starvingPeriods: number;
  recoveryWindow: number;
  marketCap: bigint; // atomic USDC (6dec) — Standing
  alive: boolean; // on-chain alive (Ponder); authoritative for death
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function economyToGauge(input: GaugeInput): GaugeView {
  const state: GaugeState =
    !input.alive || input.status === 'dead'
      ? 'dead'
      : input.status === 'starving'
        ? 'starving'
        : 'healthy';

  const standingFrac =
    STANDING_FULL_USDC > 0n
      ? clamp01(Number((input.marketCap * 10000n) / STANDING_FULL_USDC) / 10000)
      : 0;

  const countdownFrac =
    input.recoveryWindow > 0
      ? clamp01((input.recoveryWindow - input.starvingPeriods) / input.recoveryWindow)
      : 0;

  return {
    energyFrac: clamp01(input.energy / ENERGY_FULL),
    standingFrac,
    countdownFrac: state === 'dead' ? 0 : countdownFrac,
    state,
    pulsing: state === 'starving',
  };
}
