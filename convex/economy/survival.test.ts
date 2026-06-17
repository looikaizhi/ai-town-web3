import { computeEnergy, isDying, advanceSurvival, SurvivalState } from './survival';

describe('computeEnergy', () => {
  test('floors eoaUsdc / costPerThink', () => {
    expect(computeEnergy(25000n, 10000n)).toBe(2); // 0.025 / 0.01 -> 2 thoughts
    expect(computeEnergy(9999n, 10000n)).toBe(0);
    expect(computeEnergy(0n, 10000n)).toBe(0);
  });
  test('guards zero cost', () => {
    expect(computeEnergy(5n, 0n)).toBe(0);
  });
});

describe('isDying', () => {
  test('true when no energy', () => {
    expect(isDying(0, 1_000_000n, 0n)).toBe(true);
  });
  test('true when standing at/below floor', () => {
    expect(isDying(5, 100n, 100n)).toBe(true);
    expect(isDying(5, 99n, 100n)).toBe(true);
  });
  test('false when healthy on both axes', () => {
    expect(isDying(5, 101n, 100n)).toBe(false);
  });
});

describe('advanceSurvival', () => {
  const alive: SurvivalState = { status: 'alive', starvingPeriods: 0 };

  test('healthy stays/resets alive', () => {
    expect(advanceSurvival({ status: 'starving', starvingPeriods: 3, starvingSince: 1 }, false, 50, 10))
      .toEqual({ status: 'alive', starvingPeriods: 0 });
  });

  test('first dying tick enters starving and stamps starvingSince', () => {
    expect(advanceSurvival(alive, true, 100, 10)).toEqual({
      status: 'starving',
      starvingPeriods: 1,
      starvingSince: 100,
    });
  });

  test('accumulates starving periods, keeps original starvingSince', () => {
    const s1 = advanceSurvival(alive, true, 100, 3);
    const s2 = advanceSurvival(s1, true, 200, 3);
    expect(s2).toEqual({ status: 'starving', starvingPeriods: 2, starvingSince: 100 });
  });

  test('dies when starvingPeriods reaches recoveryWindow', () => {
    const s2 = { status: 'starving' as const, starvingPeriods: 2, starvingSince: 100 };
    const dead = advanceSurvival(s2, true, 300, 3);
    expect(dead).toEqual({ status: 'dead', starvingPeriods: 3, starvingSince: 100, diedAt: 300 });
  });

  test('dead is terminal even if funds return', () => {
    const dead: SurvivalState = { status: 'dead', starvingPeriods: 3, starvingSince: 100, diedAt: 300 };
    expect(advanceSurvival(dead, false, 999, 3)).toBe(dead);
  });
});
