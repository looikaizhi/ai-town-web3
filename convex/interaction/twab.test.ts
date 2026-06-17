import { twabScore, twabTopK, type TradeRow, type WhisperRow } from './twab';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000 * DAY; // 固定"现在"便于测试

const buy = (tokens: string, ts: number): TradeRow => ({ side: 'buy', tokens, ts });
const sell = (tokens: string, ts: number): TradeRow => ({ side: 'sell', tokens, ts });

describe('twabScore', () => {
  it('returns 0 for no trades', () => {
    expect(twabScore([], NOW, 30 * DAY)).toBe(0);
  });

  it('returns 0 for trade exactly at now (zero hold time)', () => {
    expect(twabScore([buy('1000', NOW)], NOW, 30 * DAY)).toBe(0);
  });

  it('calculates token-days for a simple buy and hold', () => {
    // 1000 tokens held for 10 days
    const score = twabScore([buy('1000', NOW - 10 * DAY)], NOW, 30 * DAY);
    expect(score).toBeCloseTo(1000 * 10);
  });

  it('deducts sold tokens from accumulation', () => {
    const trades = [
      buy('1000', NOW - 20 * DAY),
      sell('500', NOW - 10 * DAY),
    ];
    // 1000 * 10 days + 500 * 10 days = 15000
    expect(twabScore(trades, NOW, 30 * DAY)).toBeCloseTo(15000);
  });

  it('pre-window buy seeds balance: holder who bought before window and held through gets credit', () => {
    const oldBuy = buy('9999', NOW - 40 * DAY); // bought before window, still holding
    const recentBuy = buy('100', NOW - 5 * DAY); // also bought within window
    const score = twabScore([oldBuy, recentBuy], NOW, 30 * DAY);
    // oldBuy seeds balance=9999 at windowStart; held 25 days then recentBuy adds 100
    // 9999*25 + 10099*5 = 249975 + 50495 = 300470
    expect(score).toBeCloseTo(300470);
  });

  it('returns 0 if all tokens sold before now', () => {
    const trades = [
      buy('1000', NOW - 20 * DAY),
      sell('1000', NOW - 10 * DAY),
    ];
    // 1000*10 + 0*10 = 10000 (still counts the period when held)
    expect(twabScore(trades, NOW, 30 * DAY)).toBeCloseTo(10000);
  });
});

describe('twabTopK', () => {
  it('returns [] for empty inputs', () => {
    expect(twabTopK([], {}, 3)).toEqual([]);
  });

  it('orders by TWAB score descending', () => {
    const whispers: WhisperRow[] = [
      { sender: '0xA', text: 'low', ts: 1 },
      { sender: '0xB', text: 'high', ts: 2 },
    ];
    // holderScores keys must be lowercase (as returned by Ponder)
    const scores: Record<string, number> = { '0xa': 100, '0xb': 999 };
    const result = twabTopK(whispers, scores, 3);
    expect(result[0].sender).toBe('0xB');
    expect(result[1].sender).toBe('0xA');
  });

  it('uses most recent text per sender', () => {
    const whispers: WhisperRow[] = [
      { sender: '0xA', text: 'old', ts: 1 },
      { sender: '0xA', text: 'new', ts: 10 },
    ];
    const scores: Record<string, number> = { '0xa': 500 };
    const result = twabTopK(whispers, scores, 3);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('new');
  });

  it('excludes senders with score 0 (no holding)', () => {
    const whispers: WhisperRow[] = [{ sender: '0xZ', text: 'hi', ts: 1 }];
    const scores: Record<string, number> = { '0xz': 0 };
    expect(twabTopK(whispers, scores, 3)).toEqual([]);
  });

  it('respects K limit', () => {
    const whispers: WhisperRow[] = ['0xA','0xB','0xC','0xD'].map(s => ({ sender: s, text: s, ts: 1 }));
    const scores: Record<string, number> = { '0xa': 1, '0xb': 2, '0xc': 3, '0xd': 4 };
    expect(twabTopK(whispers, scores, 2)).toHaveLength(2);
  });
});
