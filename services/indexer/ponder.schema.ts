import { onchainTable } from 'ponder';

// One row per registered agent: registry mirror + latest curve snapshot (Standing side).
// USDC wallet balances (energy) are intentionally NOT stored — Convex reads those live.
export const agent = onchainTable('agent', (t) => ({
  id: t.text().primaryKey(), // agentId as decimal string ("0")
  token: t.hex().notNull(),
  wallet: t.hex().notNull(), // CDP smart account = AgentRegistry.wallet
  costPerThink: t.bigint().notNull(),
  floor: t.bigint().notNull(),
  recoveryWindow: t.bigint().notNull(),
  alive: t.boolean().notNull(),
  // latest curve snapshot (atomic units; Standing source)
  tokenBalance: t.bigint().notNull(), // token held by `wallet`
  marketCap: t.bigint().notNull(),
  pricePerToken: t.bigint().notNull(),
  usdcReserve: t.bigint().notNull(),
  spawnedAt: t.bigint(),
  diedAt: t.bigint(),
  updatedAt: t.bigint().notNull(),
}));

// Reverse lookup token address -> agentId, so Bought/Sold handlers can find the agent.
export const tokenIndex = onchainTable('token_index', (t) => ({
  id: t.hex().primaryKey(), // token address
  agentId: t.text().notNull(),
}));

// Append-only trade log (Bought/Sold) for history + frontend (SP2+).
export const trade = onchainTable('trade', (t) => ({
  id: t.text().primaryKey(), // `${txHash}-${logIndex}`
  agentId: t.text(),
  token: t.hex().notNull(),
  side: t.text().notNull(), // 'buy' | 'sell'
  actor: t.hex().notNull(),
  usdc: t.bigint().notNull(),
  tokens: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

// Append-only whisper log (SP3): humans paying to inject context into a resident.
export const whisper = onchainTable('whisper', (t) => ({
  id: t.text().primaryKey(), // `${txHash}-${logIndex}`
  agentId: t.text().notNull(),
  sender: t.hex().notNull(),
  amount: t.bigint().notNull(),
  text: t.text().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

// SP4: 结盟事件日志（append-only）
export const alliance = onchainTable('alliance', (t) => ({
  id: t.text().primaryKey(),       // `${txHash}-${logIndex}`
  agentA: t.text().notNull(),
  agentB: t.text().notNull(),
  eventType: t.text().notNull(),   // 'proposed' | 'formed' | 'dissolved'
  message: t.text(),               // proposed 时有值，其他为 null
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));
