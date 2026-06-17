export interface Balances {
  agentId: string;
  eoaUsdc: string;
  smartUsdc: string;
  tokenBalance: string;
  marketCap: string;
}

/** energy gate: can the EOA afford one think right now? */
export function canThink(b: Balances, costPerThink: bigint): boolean {
  return BigInt(b.eoaUsdc) >= costPerThink;
}

export function summarizeBalances(b: Balances): string {
  return `eoaUsdc=${b.eoaUsdc} smartUsdc=${b.smartUsdc} token=${b.tokenBalance} mcap=${b.marketCap}`;
}

// --- shared HTTP helpers (used by the live scripts) ---
export async function getBalances(executor: string, agentId: string): Promise<Balances> {
  const r = await fetch(`${executor}/balances/${agentId}`);
  if (!r.ok) throw new Error(`/balances/${agentId} -> ${r.status}`);
  return (await r.json()) as Balances;
}

export async function executorAction(
  executor: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const r = await fetch(`${executor}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}
