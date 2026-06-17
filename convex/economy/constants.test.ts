import { agentIds, agentEoaForId } from './constants';

describe('agentIds', () => {
  it('returns ["0"] by default when AGENT_IDS not set', () => {
    const prev = process.env.AGENT_IDS;
    delete process.env.AGENT_IDS;
    expect(agentIds()).toEqual(['0']);
    if (prev !== undefined) process.env.AGENT_IDS = prev;
  });

  it('parses comma-separated AGENT_IDS', () => {
    process.env.AGENT_IDS = '0,1,2,3,4';
    expect(agentIds()).toEqual(['0', '1', '2', '3', '4']);
    delete process.env.AGENT_IDS;
  });

  it('trims whitespace', () => {
    process.env.AGENT_IDS = '0, 1 , 2';
    expect(agentIds()).toEqual(['0', '1', '2']);
    delete process.env.AGENT_IDS;
  });
});

describe('agentEoaForId', () => {
  it('reads AGENT_N_EOA env var', () => {
    process.env.AGENT_3_EOA = '0xABC';
    expect(agentEoaForId('3')).toBe('0xABC');
    delete process.env.AGENT_3_EOA;
  });

  it('returns empty string when not set', () => {
    delete process.env.AGENT_99_EOA;
    expect(agentEoaForId('99')).toBe('');
  });
});
