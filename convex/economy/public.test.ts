import { selectAgentStatus } from './public';

describe('selectAgentStatus', () => {
  const econ = {
    econAgentId: '0',
    status: 'starving' as const,
    energy: 3,
    starvingPeriods: 4,
    diedAt: undefined as number | undefined,
  };

  test('maps econ row + playerId + recoveryWindow into the view', () => {
    expect(selectAgentStatus('p:42', econ, 10)).toEqual({
      playerId: 'p:42',
      econAgentId: '0',
      status: 'starving',
      energy: 3,
      starvingPeriods: 4,
      recoveryWindow: 10,
      diedAt: null,
    });
  });

  test('passes through diedAt when present', () => {
    expect(selectAgentStatus('p:1', { ...econ, status: 'dead', diedAt: 1717 }, 10).diedAt).toBe(1717);
  });
});
