import { describe, it, expect } from 'vitest';
import { buildAgentAggregate, type AgentRow } from '../src/aggregate.js';

const row: AgentRow = {
  id: '0',
  token: '0xToKeN',
  wallet: '0xWaLLeT',
  costPerThink: 10000n,
  floor: 0n,
  recoveryWindow: 10n,
  alive: true,
  tokenBalance: 1000000000000000000n,
  marketCap: 500000n,
  pricePerToken: 12345n,
  usdcReserve: 250000n,
  spawnedAt: 111n,
  diedAt: null,
  updatedAt: 222n,
};

describe('buildAgentAggregate', () => {
  it('serializes bigints to atomic decimal strings and mirrors registry + Standing fields', () => {
    const a = buildAgentAggregate(row);
    expect(a).toEqual({
      agentId: '0',
      token: '0xToKeN',
      wallet: '0xWaLLeT',
      costPerThink: '10000',
      floor: '0',
      recoveryWindow: 10,
      alive: true,
      tokenBalance: '1000000000000000000',
      marketCap: '500000',
      pricePerToken: '12345',
      usdcReserve: '250000',
      spawnedAt: 111,
      diedAt: null,
      updatedAt: 222,
    });
  });

  it('reports diedAt as a number when set', () => {
    const a = buildAgentAggregate({ ...row, alive: false, diedAt: 999n, marketCap: 0n });
    expect(a.alive).toBe(false);
    expect(a.diedAt).toBe(999);
    expect(a.marketCap).toBe('0');
  });
});
