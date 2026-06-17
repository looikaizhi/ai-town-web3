import { ExecutorClient } from './executorClient';
import { PaymentRequirements } from './types';

/** Thrown when the agent cannot pay to think even after trying to raise USDC. The
 *  authority on the survival *counter* is the economic tick; this just halts a single
 *  think (the seam short-circuit). */
export class StarvationError extends Error {
  constructor(message = 'starving') {
    super(message);
    this.name = 'StarvationError';
  }
}

export interface EconomyOpts {
  agentId: string;
  eoaAddress?: string;
  dead?: boolean;
}

export interface PayAwareDeps {
  gatewayUrl: string;
  executor: ExecutorClient;
  fetchImpl?: typeof fetch;
}

export interface PayAwareRequest {
  body: string; // pre-serialized JSON; reused across the 402 retry
  headers: Record<string, string>;
  econ: EconomyOpts;
}

/**
 * Pay-aware chat fetch. Adds X-Agent-Id; on 402 asks the executor to sign the payment
 * and retries with X-PAYMENT. If the executor can't sign (insufficient_funds), runs the
 * reactive survival orchestration once — sell the agent's whole token balance, sweep
 * smart->EOA — then retries signing. Still can't pay => StarvationError. A `dead` agent
 * short-circuits before any network call ("can't pay, can't think").
 */
export async function payAwareChatFetch(deps: PayAwareDeps, req: PayAwareRequest): Promise<Response> {
  if (req.econ.dead) throw new StarvationError('dead');

  const f = deps.fetchImpl ?? fetch;
  const url = `${deps.gatewayUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...req.headers,
    'X-Agent-Id': req.econ.agentId,
  };

  let res = await f(url, { method: 'POST', headers, body: req.body });
  if (res.status !== 402) return res;

  const challenge = await res.json().catch(() => ({}));
  const requirements: PaymentRequirements | undefined = challenge?.accepts?.[0];
  if (!requirements) throw new Error('gateway 402 without accepts[0]');

  let signed = await deps.executor.signPayment(req.econ.agentId, requirements);
  if (!signed.ok) {
    await tryRaiseUsdc(deps.executor, req.econ);
    signed = await deps.executor.signPayment(req.econ.agentId, requirements);
    if (!signed.ok) throw new StarvationError(signed.reason || 'insufficient_funds');
  }

  res = await f(url, { method: 'POST', headers: { ...headers, 'X-PAYMENT': signed.xPayment }, body: req.body });
  if (res.status === 402) throw new StarvationError('payment_rejected');
  return res;
}

/** Reactive survival: sell the whole token balance for USDC, then sweep the smart
 *  account's USDC to the EOA (the x402 payer). Mechanical — no LLM, no decision. */
async function tryRaiseUsdc(executor: ExecutorClient, econ: EconomyOpts): Promise<void> {
  const before = await executor.balances(econ.agentId);
  if (BigInt(before.tokenBalance) > 0n) {
    await executor.sell(econ.agentId, before.tokenBalance, '0');
  }
  const after = await executor.balances(econ.agentId);
  if (econ.eoaAddress && BigInt(after.smartUsdc) > 0n) {
    await executor.transfer(econ.agentId, 'smart', econ.eoaAddress, after.smartUsdc);
  }
}
