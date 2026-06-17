import { describe, it, expect } from 'vitest';
import { canThink, summarizeBalances, type Balances } from '../src/lib.js';

const b = (eoaUsdc: string, smartUsdc = '0', tokenBalance = '0', marketCap = '0'): Balances => ({
  agentId: '0', eoaUsdc, smartUsdc, tokenBalance, marketCap,
});

describe('canThink', () => {
  it('true when EOA USDC >= costPerThink', () => {
    expect(canThink(b('10000'), 10000n)).toBe(true);
    expect(canThink(b('20000'), 10000n)).toBe(true);
  });
  it('false when EOA USDC < costPerThink', () => {
    expect(canThink(b('9999'), 10000n)).toBe(false);
    expect(canThink(b('0'), 10000n)).toBe(false);
  });
});

describe('summarizeBalances', () => {
  it('renders a one-line summary', () => {
    expect(summarizeBalances(b('1', '2', '3', '4'))).toBe('eoaUsdc=1 smartUsdc=2 token=3 mcap=4');
  });
});
