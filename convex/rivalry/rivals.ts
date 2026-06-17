import { v } from 'convex/values';
import { internalQuery, internalMutation } from '../_generated/server';

export const upsertRivalState = internalMutation({
  args: {
    onchainAgentId: v.string(),
    rivalAgentId: v.string(),
    marketCap: v.string(),
    alive: v.boolean(),
    allied: v.boolean(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('rivalryState')
      .withIndex('agent_rival', (q) =>
        q.eq('onchainAgentId', args.onchainAgentId).eq('rivalAgentId', args.rivalAgentId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        marketCap: args.marketCap,
        alive: args.alive,
        allied: args.allied,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert('rivalryState', args);
    }
  },
});

export const getRivalSnapshot = internalQuery({
  args: { onchainAgentId: v.string() },
  handler: async (ctx, { onchainAgentId }) => {
    return await ctx.db
      .query('rivalryState')
      .withIndex('agent_rival', (q) => q.eq('onchainAgentId', onchainAgentId))
      .collect();
  },
});

export const getCursor = internalQuery({
  args: { onchainAgentId: v.string() },
  handler: async (ctx, { onchainAgentId }) => {
    const row = await ctx.db
      .query('rivalryCursor')
      .withIndex('agent', (q) => q.eq('onchainAgentId', onchainAgentId))
      .first();
    return row?.lastUpdatedAt ?? 0;
  },
});

export const setCursor = internalMutation({
  args: { onchainAgentId: v.string(), lastUpdatedAt: v.number() },
  handler: async (ctx, { onchainAgentId, lastUpdatedAt }) => {
    const row = await ctx.db
      .query('rivalryCursor')
      .withIndex('agent', (q) => q.eq('onchainAgentId', onchainAgentId))
      .first();
    if (row) await ctx.db.patch(row._id, { lastUpdatedAt });
    else await ctx.db.insert('rivalryCursor', { onchainAgentId, lastUpdatedAt });
  },
});
