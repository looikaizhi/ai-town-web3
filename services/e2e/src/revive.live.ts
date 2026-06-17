/**
 * Acceptance ① (Base Sepolia LIVE, opt-in): 饥饿 → 卖币 + 扫款 → 复活.
 * Preconditions: gateway/executor/(ollama) up; agent "0" registered; the smart account
 * holds some AgentToken (so there's something to sell) and the EOA is below costPerThink.
 * Mirrors the Plan-4 payment seam orchestration against the REAL chain. Skips if unconfigured.
 */
import { getBalances, executorAction, summarizeBalances, canThink } from './lib.js';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8402';
const EXECUTOR = process.env.EXECUTOR_URL ?? 'http://127.0.0.1:8404';
const AGENT_ID = process.env.SMOKE_AGENT_ID ?? '0';

async function main() {
  if (!(await fetch(`${EXECUTOR}/healthz`).then((r) => r.ok).catch(() => false))) {
    console.log(`[revive] SKIP — executor not reachable at ${EXECUTOR}`);
    return;
  }

  const before = await getBalances(EXECUTOR, AGENT_ID);
  console.log('[revive] before:', summarizeBalances(before));
  if (BigInt(before.tokenBalance) === 0n) {
    console.log('[revive] SKIP — no token to sell (fund smart account + buy first via /actions/fund + /actions/buy)');
    return;
  }

  const body = JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'survive' }] });
  const r402 = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Id': AGENT_ID },
    body,
  });
  const challenge = (await r402.json()) as { accepts?: Array<{ maxAmountRequired: string }> };
  const requirements = challenge?.accepts?.[0];
  if (r402.status !== 402 || !requirements) throw new Error(`expected 402+accepts, got ${r402.status}`);
  const costPerThink = BigInt(requirements.maxAmountRequired);

  const sign1 = await executorAction(EXECUTOR, '/sign-payment', {
    agentId: AGENT_ID,
    paymentRequirements: requirements,
  });
  if (sign1.status !== 402) {
    console.log('[revive] EOA already funded (sign ok); nothing to revive. status', sign1.status);
    return;
  }
  console.log('[revive] sign -> insufficient_funds (as expected, EOA starving)');

  const cur = await getBalances(EXECUTOR, AGENT_ID);
  const sell = await executorAction(EXECUTOR, '/actions/sell', {
    agentId: AGENT_ID,
    tokensIn: cur.tokenBalance,
    minUsdcOut: '0',
  });
  console.log('[revive] sell ->', sell.status, (sell.json as { txHash?: string })?.txHash);
  if (sell.status < 200 || sell.status >= 300) {
    throw new Error(`[revive] sell failed: status ${sell.status} — ${JSON.stringify(sell.json)}`);
  }
  const afterSell = await getBalances(EXECUTOR, AGENT_ID);
  const xfer = await executorAction(EXECUTOR, '/actions/transfer', {
    agentId: AGENT_ID,
    source: 'smart',
    to: process.env.AGENT_0_EOA,
    amount: afterSell.smartUsdc,
  });
  console.log('[revive] transfer smart->eoa ->', xfer.status, (xfer.json as { txHash?: string })?.txHash);
  if (xfer.status < 200 || xfer.status >= 300) {
    throw new Error(`[revive] transfer smart->eoa failed: status ${xfer.status} — ${JSON.stringify(xfer.json)}`);
  }

  const sign2 = await executorAction(EXECUTOR, '/sign-payment', {
    agentId: AGENT_ID,
    paymentRequirements: requirements,
  });
  if (sign2.status !== 200) throw new Error(`revive failed: re-sign status ${sign2.status}`);
  const r200 = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': AGENT_ID,
      'X-PAYMENT': (sign2.json as { xPayment: string }).xPayment,
    },
    body,
  });
  if (r200.status !== 200) throw new Error(`revive failed: think status ${r200.status}`);

  const after = await getBalances(EXECUTOR, AGENT_ID);
  console.log('[revive] after:', summarizeBalances(after));
  if (!canThink(after, costPerThink)) throw new Error('revive failed: EOA still below costPerThink');
  console.log('[revive] OK — starved agent sold its coin, swept USDC, and resumed thinking');
}

main().catch((e) => {
  console.error('[revive] FAIL', e);
  process.exit(1);
});
