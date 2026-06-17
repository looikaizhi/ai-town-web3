import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createPonderClient } from './ponderClient';

let server: Server;
let baseUrl: string;
let routes: Record<string, { status: number; body: any }>;

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = routes[`${req.method} ${req.url}`] ?? { status: 404, body: { error: 'no route' } };
    res.statusCode = route.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(route.body));
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { routes = {}; });

describe('createPonderClient', () => {
  test('agentStanding parses the aggregate', async () => {
    routes['GET /agents/0'] = {
      status: 200,
      body: {
        agentId: '0', token: '0xT', wallet: '0xS', costPerThink: '10000', floor: '0',
        recoveryWindow: 10, alive: true, tokenBalance: '5', marketCap: '11',
        pricePerToken: '7', usdcReserve: '9', spawnedAt: 1, diedAt: null, updatedAt: 2,
      },
    };
    const p = createPonderClient(baseUrl);
    const s = await p.agentStanding('0');
    expect(s).not.toBeNull();
    expect(s!.costPerThink).toBe('10000');
    expect(s!.marketCap).toBe('11');
    expect(s!.alive).toBe(true);
  });

  test('agentStanding returns null on 404', async () => {
    const p = createPonderClient(baseUrl);
    expect(await p.agentStanding('0')).toBeNull();
  });

  test('agentStanding returns null on network error (fail-safe)', async () => {
    const p = createPonderClient('http://127.0.0.1:1'); // unreachable
    expect(await p.agentStanding('0')).toBeNull();
  });
});
