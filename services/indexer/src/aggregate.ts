// The shape Convex perception (Plan 4 tick) and the frontend read from the indexer.
// Field semantics mirror the executor /balances Standing side; USDC balances live elsewhere.
export interface AgentRow {
  id: string;
  token: string;
  wallet: string;
  costPerThink: bigint;
  floor: bigint;
  recoveryWindow: bigint;
  alive: boolean;
  tokenBalance: bigint;
  marketCap: bigint;
  pricePerToken: bigint;
  usdcReserve: bigint;
  spawnedAt: bigint | null;
  diedAt: bigint | null;
  updatedAt: bigint;
}

export interface AgentAggregate {
  agentId: string;
  token: string;
  wallet: string;
  costPerThink: string; // atomic USDC (6dec)
  floor: string; // atomic USDC (6dec)
  recoveryWindow: number; // T
  alive: boolean;
  tokenBalance: string; // atomic token (18dec) held by wallet
  marketCap: string; // atomic USDC (6dec) — Standing
  pricePerToken: string; // atomic USDC (6dec) per 1e18 token
  usdcReserve: string; // atomic USDC (6dec)
  spawnedAt: number | null;
  diedAt: number | null;
  updatedAt: number;
}

/** Pure mapping: agent row -> read-API aggregate (bigints to atomic decimal strings). */
export function buildAgentAggregate(row: AgentRow): AgentAggregate {
  return {
    agentId: row.id,
    token: row.token,
    wallet: row.wallet,
    costPerThink: row.costPerThink.toString(),
    floor: row.floor.toString(),
    recoveryWindow: Number(row.recoveryWindow),
    alive: row.alive,
    tokenBalance: row.tokenBalance.toString(),
    marketCap: row.marketCap.toString(),
    pricePerToken: row.pricePerToken.toString(),
    usdcReserve: row.usdcReserve.toString(),
    spawnedAt: row.spawnedAt === null ? null : Number(row.spawnedAt),
    diedAt: row.diedAt === null ? null : Number(row.diedAt),
    updatedAt: Number(row.updatedAt),
  };
}
