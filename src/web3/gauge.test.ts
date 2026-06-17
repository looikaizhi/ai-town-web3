import { describe, test, expect } from 'vitest';
import { economyToGauge, ENERGY_FULL, STANDING_FULL_USDC } from './gauge';

const base = {
  status: 'alive' as const,
  energy: 50,
  starvingPeriods: 0,
  recoveryWindow: 10,
  marketCap: STANDING_FULL_USDC / 2n,
  alive: true,
};

describe('economyToGauge', () => {
  test('healthy: half energy/standing, no pulse, full countdown', () => {
    const v = economyToGauge(base);
    expect(v.state).toBe('healthy');
    expect(v.energyFrac).toBeCloseTo(50 / ENERGY_FULL);
    expect(v.standingFrac).toBeCloseTo(0.5);
    expect(v.pulsing).toBe(false);
    expect(v.countdownFrac).toBe(1);
  });

  test('starving: pulses, countdown shrinks with starvingPeriods', () => {
    const v = economyToGauge({ ...base, status: 'starving', energy: 0, starvingPeriods: 4 });
    expect(v.state).toBe('starving');
    expect(v.pulsing).toBe(true);
    expect(v.countdownFrac).toBeCloseTo((10 - 4) / 10);
    expect(v.energyFrac).toBe(0);
  });

  test('dead via status', () => {
    const v = economyToGauge({ ...base, status: 'dead' });
    expect(v.state).toBe('dead');
    expect(v.pulsing).toBe(false);
  });

  test('dead via on-chain alive=false even if status stale', () => {
    expect(economyToGauge({ ...base, alive: false }).state).toBe('dead');
  });

  test('clamps fractions to [0,1]', () => {
    const v = economyToGauge({ ...base, energy: 99999, marketCap: STANDING_FULL_USDC * 5n });
    expect(v.energyFrac).toBe(1);
    expect(v.standingFrac).toBe(1);
  });

  test('countdown never negative', () => {
    const v = economyToGauge({ ...base, status: 'starving', starvingPeriods: 99 });
    expect(v.countdownFrac).toBe(0);
  });
});
