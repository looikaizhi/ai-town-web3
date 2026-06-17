/**
 * Opt-in indexer smoke (NOT part of `npm test`; run `npm run smoke`).
 * Assumes `ponder dev` is already running on PONDER_PORT (default 42069) and has indexed
 * at least agent "0". Skips cleanly if the read API is unreachable.
 */
const base = process.env.PONDER_URL ?? `http://127.0.0.1:${process.env.PONDER_PORT ?? '42069'}`;
const agentId = process.env.SMOKE_AGENT_ID ?? '0';

async function main() {
  let health: Response;
  try {
    health = await fetch(`${base}/healthz`);
  } catch {
    console.log(`[smoke] SKIP — indexer not reachable at ${base}`);
    return;
  }
  console.log('[smoke] /healthz ->', health.status, await health.json().catch(() => ({})));

  const res = await fetch(`${base}/agents/${agentId}`);
  console.log('[smoke] /agents/' + agentId + ' ->', res.status);
  if (res.status === 404) {
    console.log('[smoke] agent not indexed yet (deploy + spawn + let ponder catch up), but route is live.');
    return;
  }
  const agg = (await res.json()) as Record<string, unknown>;
  console.log('[smoke] aggregate:', agg);
  const need = ['agentId', 'token', 'wallet', 'costPerThink', 'marketCap', 'tokenBalance', 'alive'];
  const missing = need.filter((k) => !(k in agg));
  if (missing.length) throw new Error(`aggregate missing fields: ${missing.join(',')}`);
  console.log('[smoke] OK — read API serves the Standing aggregate');
}

main().catch((e) => {
  console.error('[smoke] FAIL', e);
  process.exit(1);
});
