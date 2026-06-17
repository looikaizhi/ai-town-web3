import { resolveEconomyParams, type StandingSource } from './registry';

const envDefaults = { costPerThink: '10000', floor: '0', recoveryWindow: 10 };

describe('resolveEconomyParams', () => {
  test('prefers Ponder/registry values when standing present', () => {
    const standing: StandingSource = { costPerThink: '20000', floor: '500', recoveryWindow: 7, marketCap: '999', tokenBalance: '5', alive: true };
    expect(resolveEconomyParams(standing, envDefaults)).toEqual({
      costPerThink: 20000n, floor: 500n, recoveryWindow: 7, marketCap: 999n, tokenBalance: 5n, alive: true,
    });
  });

  test('falls back to env defaults when no standing (Ponder down/disabled)', () => {
    expect(resolveEconomyParams(null, envDefaults)).toEqual({
      costPerThink: 10000n, floor: 0n, recoveryWindow: 10, marketCap: 0n, tokenBalance: 0n, alive: true,
    });
  });

  test('guards malformed standing numbers by falling back per-field', () => {
    const standing = { costPerThink: 'oops', floor: '500', recoveryWindow: 7, marketCap: 'bad', tokenBalance: '5', alive: false } as unknown as StandingSource;
    const r = resolveEconomyParams(standing, envDefaults);
    expect(r.costPerThink).toBe(10000n); // fell back
    expect(r.floor).toBe(500n);
    expect(r.marketCap).toBe(0n); // fell back
    expect(r.alive).toBe(false);
  });
});
