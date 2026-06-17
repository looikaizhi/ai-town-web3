import { parseRivalryIntent, type RivalryIntent } from './intent';

describe('parseRivalryIntent', () => {
  it('returns null for ordinary conversation with no action markers', () => {
    expect(parseRivalryIntent('Hello, nice day today!')).toBeNull();
  });

  it('parses BUY_RIVAL intent', () => {
    const result = parseRivalryIntent('<rivalry:BUY_RIVAL targetId="2" usdcAmount="50000"/>');
    expect(result).toEqual({ type: 'BUY_RIVAL', targetId: '2', usdcAmount: '50000' });
  });

  it('parses WHISPER_RIVAL intent', () => {
    const result = parseRivalryIntent('<rivalry:WHISPER_RIVAL targetId="3" amount="10000" text="let us ally"/>');
    expect(result).toEqual({ type: 'WHISPER_RIVAL', targetId: '3', amount: '10000', text: 'let us ally' });
  });

  it('parses PROPOSE_ALLIANCE intent', () => {
    const result = parseRivalryIntent('<rivalry:PROPOSE_ALLIANCE targetId="1" message="together we survive"/>');
    expect(result).toEqual({ type: 'PROPOSE_ALLIANCE', targetId: '1', message: 'together we survive' });
  });

  it('parses ACCEPT_ALLIANCE intent', () => {
    const result = parseRivalryIntent('<rivalry:ACCEPT_ALLIANCE proposerId="0"/>');
    expect(result).toEqual({ type: 'ACCEPT_ALLIANCE', proposerId: '0' });
  });

  it('parses DISSOLVE_ALLIANCE intent', () => {
    const result = parseRivalryIntent('<rivalry:DISSOLVE_ALLIANCE peerId="4"/>');
    expect(result).toEqual({ type: 'DISSOLVE_ALLIANCE', peerId: '4' });
  });

  it('ignores malformed markers', () => {
    expect(parseRivalryIntent('<rivalry:BUY_RIVAL/>')).toBeNull(); // 缺 targetId
  });
});
