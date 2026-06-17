import { buildSurvivalGoalStack, SurvivalPerception } from './goalStack';

const healthy: SurvivalPerception = { energy: 42, marketCap: '500000', status: 'alive' };
const starving: SurvivalPerception = { energy: 0, marketCap: '12', status: 'starving' };

describe('buildSurvivalGoalStack', () => {
  test('healthy: three prioritized goals, alive first, persona last', () => {
    const lines = buildSurvivalGoalStack(healthy);
    const text = lines.join('\n');
    expect(text).toMatch(/STAY ALIVE/);
    expect(text).toMatch(/42/); // energy surfaced
    expect(text).toMatch(/GROW STRONGER/);
    expect(text).toMatch(/500000/); // market cap surfaced
    expect(text).toMatch(/persona/i);
    // ordering: alive before grow before persona
    expect(text.indexOf('STAY ALIVE')).toBeLessThan(text.indexOf('GROW STRONGER'));
    expect(text.indexOf('GROW STRONGER')).toBeLessThan(text.search(/persona/i));
  });

  test('starving: flips to a survival override, no grow/persona priority', () => {
    const lines = buildSurvivalGoalStack(starving);
    const text = lines.join('\n');
    expect(text).toMatch(/STARVING/);
    expect(text).toMatch(/sell your own coin/i);
    expect(text).not.toMatch(/GROW STRONGER/);
  });

  test('energy<=0 forces the starving framing even if status says alive', () => {
    const lines = buildSurvivalGoalStack({ energy: 0, marketCap: '999', status: 'alive' });
    expect(lines.join('\n')).toMatch(/STARVING/);
  });
});
