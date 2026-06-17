import { AgentBalances, PaymentRequirements, SignPaymentResult } from './types';

export interface ExecutorClient {
  signPayment(agentId: string, requirements: PaymentRequirements): Promise<SignPaymentResult>;
  balances(agentId: string): Promise<AgentBalances>;
  sell(agentId: string, tokensIn: string, minUsdcOut?: string, token?: string): Promise<string>;
  buy(agentId: string, usdcIn: string, minTokensOut?: string, token?: string): Promise<string>;
  transfer(agentId: string, source: 'smart' | 'eoa', to: string, amount: string): Promise<string>;
  fund(agentId: string, target: 'eoa' | 'smart', asset: 'usdc' | 'eth'): Promise<string>;
  markDead(agentId: string): Promise<string>;
}

/**
 * Typed HTTP client for the Plan 3 executor (contract B'). Pure: takes a base URL and
 * an optional fetch impl (default global fetch), so it's unit-testable against a stub
 * server with zero Convex/CDP/chain coupling.
 */
export function createExecutorClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ExecutorClient {
  const root = baseUrl.replace(/\/$/, '');

  async function postJson<T>(path: string, body: unknown): Promise<{ status: number; json: any }> {
    const r = await fetchImpl(`${root}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json };
  }

  async function action(path: string, body: unknown): Promise<string> {
    const { status, json } = await postJson(path, body);
    if (status < 200 || status >= 300) {
      throw new Error(`executor ${path} responded ${status}: ${json?.error ?? 'unknown'}`);
    }
    return json.txHash as string;
  }

  return {
    async signPayment(agentId, requirements) {
      const { status, json } = await postJson('/sign-payment', { agentId, paymentRequirements: requirements });
      if (status >= 200 && status < 300) return { ok: true, xPayment: json.xPayment as string };
      if (status === 402) return { ok: false, reason: (json?.error as string) ?? 'insufficient_funds' };
      throw new Error(`executor /sign-payment responded ${status}: ${json?.error ?? 'unknown'}`);
    },
    async balances(agentId) {
      const r = await fetchImpl(`${root}/balances/${agentId}`);
      if (r.status < 200 || r.status >= 300) throw new Error(`executor /balances/${agentId} responded ${r.status}`);
      return (await r.json()) as AgentBalances;
    },
    sell(agentId, tokensIn, minUsdcOut = '0', token) {
      return action('/actions/sell', { agentId, tokensIn, minUsdcOut, ...(token ? { token } : {}) });
    },
    buy(agentId, usdcIn, minTokensOut = '0', token) {
      return action('/actions/buy', { agentId, usdcIn, minTokensOut, ...(token ? { token } : {}) });
    },
    transfer(agentId, source, to, amount) {
      return action('/actions/transfer', { agentId, source, to, amount });
    },
    fund(agentId, target, asset) {
      return action('/actions/fund', { agentId, target, asset });
    },
    markDead(agentId) {
      return action('/actions/mark-dead', { agentId });
    },
  };
}
