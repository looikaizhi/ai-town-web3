import { quadraticTopK, type WhisperRow } from './quadratic';

const row = (sender: string, amount: string, text: string, ts: number): WhisperRow =>
  ({ sender, amount, text, ts });

describe('quadraticTopK', () => {
  it('aggregates per sender then sqrt-weights, returns top-K senders w/ latest text', () => {
    const rows = [
      row('0xA', '1000000', 'be a poet', 1), // whale: 1.0 USDC -> weight 1000
      row('0xB', '250000', 'go to the well', 2), // 0.25 -> 500
      row('0xC', '250000', 'help the baker', 3), // 0.25 -> 500
    ];
    const top = quadraticTopK(rows, 2);
    expect(top.map((t) => t.sender)).toEqual(['0xA', '0xB']); // A then B (B,C tie 500, B older index but desc by weight then ts)
    expect(top[0].weight).toBeCloseTo(1000);
  });

  it('splitting does NOT help a whale (aggregate per sender)', () => {
    const whole = quadraticTopK([row('0xW', '1000000', 'x', 1)], 1)[0].weight;
    const split = quadraticTopK(
      [row('0xW', '250000', 'x', 1), row('0xW', '250000', 'x', 2),
       row('0xW', '250000', 'x', 3), row('0xW', '250000', 'x', 4)],
      1,
    )[0].weight;
    expect(split).toBeCloseTo(whole); // sqrt(sum) == sqrt(1_000_000) either way
  });

  it('two small distinct senders out-rank one whale of equal-ish total in top-K', () => {
    const rows = [
      row('0xWhale', '900000', 'whale says', 1),
      row('0xS1', '500000', 's1 says', 2),
      row('0xS2', '500000', 's2 says', 3),
    ];
    const top = quadraticTopK(rows, 3);
    // sqrt: whale=948.7, s1=707.1, s2=707.1; combined small voices (1414) > whale (948)
    const small = top.filter((t) => t.sender !== '0xWhale').reduce((a, t) => a + t.weight, 0);
    expect(small).toBeGreaterThan(top.find((t) => t.sender === '0xWhale')!.weight);
  });

  it('handles empty + respects K', () => {
    expect(quadraticTopK([], 3)).toEqual([]);
    expect(quadraticTopK([row('0xA', '1', 'a', 1), row('0xB', '1', 'b', 2)], 1)).toHaveLength(1);
  });
});
