import { rivalryPrompt, type RivalSnapshot } from './prompt';

const snap = (id: string, marketCap: string, alive: boolean, allied: boolean): RivalSnapshot =>
  ({ rivalAgentId: id, marketCap, alive, allied });

describe('rivalryPrompt', () => {
  it('returns [] for empty snapshot', () => {
    expect(rivalryPrompt('0', [])).toEqual([]);
  });

  it('includes market cap and alive status', () => {
    const lines = rivalryPrompt('0', [snap('1', '1000000', true, false)]);
    const text = lines.join('\n');
    expect(text).toContain('resident 1');
    expect(text).toMatch(/market cap|standing/i);
  });

  it('labels allies correctly', () => {
    const lines = rivalryPrompt('0', [snap('2', '500000', true, true)]);
    expect(lines.join('\n')).toMatch(/ally|allied/i);
  });

  it('marks dead rivals', () => {
    const lines = rivalryPrompt('0', [snap('3', '0', false, false)]);
    expect(lines.join('\n')).toMatch(/dead|died/i);
  });

  it('only shows top 3 rivals sorted by market cap', () => {
    const snaps = [
      snap('1', '100', true, false),
      snap('2', '900', true, false),
      snap('3', '500', true, false),
      snap('4', '200', true, false),
    ];
    const lines = rivalryPrompt('0', snaps);
    const text = lines.join('\n');
    expect(text.indexOf('resident 2')).toBeLessThan(text.indexOf('resident 3'));
    expect(lines.length).toBeLessThanOrEqual(5);
  });
});
