import { describe, test, expect } from 'vitest';
import {
  VIRTUAL_RESERVE,
  effectiveReserve,
  estimateBuyTokensOut,
  estimateSellUsdcOut,
  applySlippage,
} from './curveMath';

describe('effectiveReserve', () => {
  test('uses virtual seed below threshold', () => {
    expect(effectiveReserve(0n)).toBe(VIRTUAL_RESERVE);
    expect(effectiveReserve(500_000n)).toBe(VIRTUAL_RESERVE);
  });
  test('uses real reserve at/above threshold', () => {
    expect(effectiveReserve(2_000_000n)).toBe(2_000_000n);
  });
});

describe('estimateBuyTokensOut (replica of AgentToken.buy)', () => {
  test('matches constant-product formula', () => {
    // R = 1_000_000 (virtual), T = 1_000_000e18, usdcIn = 1_000_000 (1 USDC)
    const R = 1_000_000n;
    const T = 1_000_000n * 10n ** 18n;
    const usdcIn = 1_000_000n;
    // newT = R*T/(R+usdcIn) = T/2 ; tokensOut = T/2
    expect(estimateBuyTokensOut(usdcIn, R, T)).toBe(T / 2n);
  });
  test('zero inputs -> 0', () => {
    expect(estimateBuyTokensOut(0n, 1_000_000n, 10n ** 18n)).toBe(0n);
    expect(estimateBuyTokensOut(1n, 1_000_000n, 0n)).toBe(0n);
  });
});

describe('estimateSellUsdcOut (replica of AgentToken.sell)', () => {
  test('caps at real reserve during bootstrap', () => {
    // bootstrap: usdcReserve = 0 -> out capped to 0
    const T = 1_000_000n * 10n ** 18n;
    expect(estimateSellUsdcOut(T / 2n, 0n, T / 2n)).toBe(0n);
  });
  test('returns curve value when reserve allows', () => {
    // R = usdcReserve = 2_000_000, T = 1e24, tokensIn = T -> out = R*T/(2T) = R/2 = 1_000_000
    const R = 2_000_000n;
    const T = 10n ** 24n;
    expect(estimateSellUsdcOut(T, R, T)).toBe(1_000_000n);
  });
});

describe('applySlippage', () => {
  test('1% tolerance reduces by 1%', () => {
    expect(applySlippage(1000n, 100)).toBe(990n);
  });
  test('clamps bps to [0,10000]', () => {
    expect(applySlippage(1000n, -5)).toBe(1000n);
    expect(applySlippage(1000n, 20000)).toBe(0n);
  });
});
