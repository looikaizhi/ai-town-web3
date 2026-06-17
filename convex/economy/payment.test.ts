import { payAwareChatFetch, StarvationError, EconomyOpts } from './payment';
import { ExecutorClient } from './executorClient';
import { AgentBalances, PaymentRequirements, SignPaymentResult } from './types';

const GATEWAY = 'http://gw.local';
const requirements: PaymentRequirements = {
  scheme: 'exact', network: 'eip155:84532', maxAmountRequired: '10000',
  resource: `${GATEWAY}/v1/chat/completions`, description: 'think', mimeType: 'application/json',
  payTo: '0xbeef', maxTimeoutSeconds: 120, asset: '0xusdc',
};

// A fetch double that returns a queued sequence of {status, json} as Response-likes.
function fetchSeq(seq: Array<{ status: number; body: any }>) {
  const calls: Array<{ url: string; init: any }> = [];
  let i = 0;
  const impl = (async (url: string, init: any) => {
    calls.push({ url, init });
    const r = seq[Math.min(i, seq.length - 1)];
    i++;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function fakeExecutor(over: Partial<ExecutorClient> = {}): { ex: ExecutorClient; rec: any } {
  const rec: any = { sign: [], sell: [], transfer: [], balances: 0 };
  const ex: ExecutorClient = {
    async signPayment(_id, _r): Promise<SignPaymentResult> { rec.sign.push(_r); return { ok: true, xPayment: 'XP' }; },
    async balances(): Promise<AgentBalances> { rec.balances++; return { agentId: '0', eoaUsdc: '0', smartUsdc: '0', tokenBalance: '0', marketCap: '0' }; },
    async sell(_id, t) { rec.sell.push(t); return '0xsell'; },
    async buy() { return '0xbuy'; },
    async transfer(_id, s, to, amt) { rec.transfer.push({ s, to, amt }); return '0xxfer'; },
    async fund() { return '0xfund'; },
    async markDead() { return '0xdead'; },
    ...over,
  };
  return { ex, rec };
}

const econ = (over: Partial<EconomyOpts> = {}): EconomyOpts => ({ agentId: '0', eoaAddress: '0xEOA', dead: false, ...over });
const body = JSON.stringify({ messages: [] });

describe('payAwareChatFetch', () => {
  test('200 first time: returns directly, no signing', async () => {
    const { impl, calls } = fetchSeq([{ status: 200, body: { ok: true } }]);
    const { ex, rec } = fakeExecutor();
    const res = await payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() });
    expect(res.status).toBe(200);
    expect(calls[0].init.headers['X-Agent-Id']).toBe('0');
    expect(rec.sign).toHaveLength(0);
  });

  test('402 then sign then 200: retries with X-PAYMENT', async () => {
    const { impl, calls } = fetchSeq([
      { status: 402, body: { x402Version: 2, error: 'pay', accepts: [requirements] } },
      { status: 200, body: { ok: true } },
    ]);
    const { ex, rec } = fakeExecutor();
    const res = await payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() });
    expect(res.status).toBe(200);
    expect(rec.sign).toHaveLength(1);
    expect(calls[1].init.headers['X-PAYMENT']).toBe('XP');
  });

  test('insufficient -> sell + sweep -> sign ok -> 200', async () => {
    const { impl } = fetchSeq([
      { status: 402, body: { accepts: [requirements] } },
      { status: 200, body: { ok: true } },
    ]);
    let signCall = 0;
    const balancesSeq: AgentBalances[] = [
      { agentId: '0', eoaUsdc: '0', smartUsdc: '0', tokenBalance: '1000000000000000000', marketCap: '5' }, // has tokens
      { agentId: '0', eoaUsdc: '0', smartUsdc: '20000', tokenBalance: '0', marketCap: '5' }, // after sell: smart has USDC
    ];
    let balIdx = 0;
    const { ex, rec } = fakeExecutor({
      async signPayment() { signCall++; return signCall === 1 ? { ok: false, reason: 'insufficient_funds' } : { ok: true, xPayment: 'XP' }; },
      async balances() { return balancesSeq[Math.min(balIdx++, balancesSeq.length - 1)]; },
    });
    const res = await payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() });
    expect(res.status).toBe(200);
    expect(rec.sell).toEqual(['1000000000000000000']); // sold the whole token balance
    expect(rec.transfer).toEqual([{ s: 'smart', to: '0xEOA', amt: '20000' }]); // swept smart->eoa
  });

  test('cannot raise USDC -> StarvationError', async () => {
    const { impl } = fetchSeq([{ status: 402, body: { accepts: [requirements] } }]);
    const { ex } = fakeExecutor({
      async signPayment() { return { ok: false, reason: 'insufficient_funds' }; },
      async balances() { return { agentId: '0', eoaUsdc: '0', smartUsdc: '0', tokenBalance: '0', marketCap: '0' }; },
    });
    await expect(
      payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() }),
    ).rejects.toBeInstanceOf(StarvationError);
  });

  test('dead: short-circuits before any fetch', async () => {
    const { impl, calls } = fetchSeq([{ status: 200, body: { ok: true } }]);
    const { ex } = fakeExecutor();
    await expect(
      payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ({ dead: true }) }),
    ).rejects.toBeInstanceOf(StarvationError);
    expect(calls).toHaveLength(0);
  });
});
