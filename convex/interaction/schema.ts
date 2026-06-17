import { v } from 'convex/values';
import { defineTable } from 'convex/server';

export const interactionTables = {
  // One row per indexed on-chain whisper (deduped by whisperLogId).
  whispers: defineTable({
    onchainAgentId: v.string(), // matches agentEconomy.econAgentId / DEFAULT_AGENT_ID
    whisperLogId: v.string(), // Ponder id: `${txHash}-${logIndex}`
    sender: v.string(),
    amount: v.string(), // atomic USDC
    text: v.string(),
    ts: v.number(), // ms epoch (from on-chain block ts * 1000)
    memoryWritten: v.boolean(),
  })
    .index('logId', ['whisperLogId'])
    .index('agent_ts', ['onchainAgentId', 'ts']),
  // Single cursor row per onchainAgentId: last on-chain block ts (sec) consumed.
  whisperCursor: defineTable({
    onchainAgentId: v.string(),
    lastTsSec: v.number(),
  }).index('agent', ['onchainAgentId']),
};
