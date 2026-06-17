import { v } from 'convex/values';
import { defineTable } from 'convex/server';

export const rivalryTables = {
  // 每个 onchainAgentId 的最新感知快照（Ponder /agents/:id/rivals 的 Convex 镜像）
  rivalryState: defineTable({
    onchainAgentId: v.string(),    // 被感知的居民（当前居民视角）
    rivalAgentId: v.string(),
    marketCap: v.string(),          // atomic USDC string
    alive: v.boolean(),
    allied: v.boolean(),
    updatedAt: v.number(),          // ms epoch
  })
    .index('agent_rival', ['onchainAgentId', 'rivalAgentId']),

  // 每个 onchainAgentId 的感知轮次游标（上次成功拉取的 ms epoch）
  rivalryCursor: defineTable({
    onchainAgentId: v.string(),
    lastUpdatedAt: v.number(),
  }).index('agent', ['onchainAgentId']),
};
