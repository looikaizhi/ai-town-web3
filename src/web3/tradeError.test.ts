import { describe, test, expect } from 'vitest';
import { humanizeTradeError } from './tradeError';

describe('humanizeTradeError', () => {
  test('user rejected', () => {
    expect(humanizeTradeError({ shortMessage: 'User rejected the request.' })).toBe('你取消了交易');
  });
  test('slippage revert', () => {
    expect(humanizeTradeError({ message: 'execution reverted: slippage' })).toBe(
      '滑点过大，调高容忍度或减小金额',
    );
  });
  test('insufficient funds', () => {
    expect(humanizeTradeError({ message: 'transfer amount exceeds balance / insufficient' })).toBe(
      'USDC 余额不足',
    );
  });
  test('sold out / no real reserve', () => {
    expect(humanizeTradeError({ message: 'execution reverted: no real reserve' })).toBe(
      '当前无法卖出（曲线储备不足）',
    );
  });
  test('fallback', () => {
    expect(humanizeTradeError({})).toBe('交易失败，请重试');
  });
});
