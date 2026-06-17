import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createExecutorClient } from './executorClient';
import { PaymentRequirements } from './types';

let server: Server;
let baseUrl: string;
let last: { url: string; body: any } | null = null;
// Per-path canned responses set by each test.
let routes: Record<string, { status: number; body: any }>;

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:84532',
  maxAmountRequired: '10000',
  resource: 'http://gw/v1/chat/completions',
  description: 'think',
  mimeType: 'application/json',
  payTo: '0xbeef',
  maxTimeoutSeconds: 120,
  asset: '0xusdc',
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      last = { url: req.url!, body: raw ? JSON.parse(raw) : null };
      const key = `${req.method} ${req.url}`;
      const route = routes[key] ?? { status: 404, body: { error: 'no route' } };
      res.statusCode = route.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(route.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  last = null;
  routes = {};
});

describe('createExecutorClient', () => {
  test('signPayment returns xPayment on 200 and posts the right envelope', async () => {
    routes['POST /sign-payment'] = { status: 200, body: { xPayment: 'base64xp' } };
    const ex = createExecutorClient(baseUrl);
    const res = await ex.signPayment('0', requirements);
    expect(res).toEqual({ ok: true, xPayment: 'base64xp' });
    expect(last).toEqual({ url: '/sign-payment', body: { agentId: '0', paymentRequirements: requirements } });
  });

  test('signPayment maps 402 to insufficient result (no throw)', async () => {
    routes['POST /sign-payment'] = { status: 402, body: { error: 'insufficient_funds' } };
    const ex = createExecutorClient(baseUrl);
    const res = await ex.signPayment('0', requirements);
    expect(res).toEqual({ ok: false, reason: 'insufficient_funds' });
  });

  test('balances parses the aggregate', async () => {
    routes['GET /balances/0'] = {
      status: 200,
      body: { agentId: '0', eoaUsdc: '5', smartUsdc: '7', tokenBalance: '9', marketCap: '11' },
    };
    const ex = createExecutorClient(baseUrl);
    const b = await ex.balances('0');
    expect(b.eoaUsdc).toBe('5');
    expect(b.marketCap).toBe('11');
  });

  test('sell posts atomic strings and returns txHash', async () => {
    routes['POST /actions/sell'] = { status: 200, body: { txHash: '0xsell' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.sell('0', '9', '0');
    expect(tx).toBe('0xsell');
    expect(last!.body).toEqual({ agentId: '0', tokensIn: '9', minUsdcOut: '0' });
  });

  test('transfer posts source/to/amount and returns txHash', async () => {
    routes['POST /actions/transfer'] = { status: 200, body: { txHash: '0xxfer' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.transfer('0', 'smart', '0xEOA', '7');
    expect(tx).toBe('0xxfer');
    expect(last!.body).toEqual({ agentId: '0', source: 'smart', to: '0xEOA', amount: '7' });
  });

  test('buy posts usdcIn/minTokensOut and returns txHash', async () => {
    routes['POST /actions/buy'] = { status: 200, body: { txHash: '0xbuy' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.buy('0', '1000000', '0');
    expect(tx).toBe('0xbuy');
    expect(last!.body).toEqual({ agentId: '0', usdcIn: '1000000', minTokensOut: '0' });
  });

  test('non-2xx action throws with status', async () => {
    routes['POST /actions/sell'] = { status: 403, body: { error: 'guardrail' } };
    const ex = createExecutorClient(baseUrl);
    await expect(ex.sell('0', '9', '0')).rejects.toThrow(/403/);
  });

  test('markDead posts agentId and returns txHash', async () => {
    routes['POST /actions/mark-dead'] = { status: 200, body: { txHash: '0xdead' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.markDead('0');
    expect(tx).toBe('0xdead');
    expect(last!.body).toEqual({ agentId: '0' });
  });

  test('markDead throws with status on non-2xx', async () => {
    routes['POST /actions/mark-dead'] = { status: 501, body: { error: 'keeper not configured' } };
    const ex = createExecutorClient(baseUrl);
    await expect(ex.markDead('0')).rejects.toThrow(/501/);
  });
});
