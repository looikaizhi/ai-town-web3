// HTTP client for the Plan 5 indexer read API. Mirrors the AgentAggregate shape.
// Fail-safe: any error -> null (the tick then keeps the last snapshot / no-ops).
export interface AgentStanding {
  agentId: string;
  token: string;
  wallet: string;
  costPerThink: string; // atomic USDC (6dec)
  floor: string; // atomic USDC (6dec)
  recoveryWindow: number; // T
  alive: boolean;
  tokenBalance: string; // atomic token (18dec)
  marketCap: string; // atomic USDC (6dec) — Standing
  pricePerToken: string;
  usdcReserve: string;
  spawnedAt: number | null;
  diedAt: number | null;
  updatedAt: number;
}

export interface PonderClient {
  agentStanding(agentId: string): Promise<AgentStanding | null>;
}

export function createPonderClient(baseUrl: string, fetchImpl: typeof fetch = fetch): PonderClient {
  const root = baseUrl.replace(/\/$/, '');
  return {
    async agentStanding(agentId) {
      try {
        const r = await fetchImpl(`${root}/agents/${agentId}`);
        if (r.status < 200 || r.status >= 300) return null;
        return (await r.json()) as AgentStanding;
      } catch {
        return null;
      }
    },
  };
}
