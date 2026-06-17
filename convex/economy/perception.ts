import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { agentId } from '../aiTown/ids';

/**
 * SP1 maps the single ai-town agent of the default world to economic agentId "0".
 * Returns null when no running default world / no agent exists yet (tick then no-ops).
 */
export const getDefaultWorldAgent = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return null;
    const world = await ctx.db.get(status.worldId);
    if (!world) return null;
    const firstAgent = world.agents[0];
    if (!firstAgent) return null;
    return { worldId: status.worldId, agentId: firstAgent.id };
  },
});

export const getAgentEconomy = internalQuery({
  args: { worldId: v.id('worlds'), agentId },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentEconomy')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .first();
  },
});

/** E2E/demo helper: drop the agent's economy row so the next tick rebuilds it from
 *  scratch as `alive` (death is terminal in the state machine — this is the only reset). */
export const deleteAgentEconomy = internalMutation({
  args: { worldId: v.id('worlds'), agentId },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentEconomy')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return existing ? 1 : 0;
  },
});

export const upsertAgentEconomy = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agentId,
    econAgentId: v.string(),
    eoa: v.string(),
    eoaUsdc: v.string(),
    smartUsdc: v.string(),
    tokenBalance: v.string(),
    marketCap: v.string(),
    energy: v.number(),
    lastPerceivedAt: v.number(),
    status: v.union(v.literal('alive'), v.literal('starving'), v.literal('dead')),
    starvingPeriods: v.number(),
    starvingSince: v.optional(v.number()),
    diedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentEconomy')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert('agentEconomy', args);
    }
  },
});

/**
 * 返回默认 world 里所有 agents（按 index 顺序）。
 * 每个 agent 的 index 对应其 econAgentId（agents[0] → "0"，agents[1] → "1"，...）。
 */
export const getAllWorldAgents = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return null;
    const world = await ctx.db.get(status.worldId);
    if (!world) return null;
    return {
      worldId: status.worldId,
      agents: world.agents.map((a, i) => ({
        agentId: a.id,
        econAgentId: String(i),
      })),
    };
  },
});

/**
 * 按 econAgentId（如 "1"、"2"）查 agentEconomy 行。
 * 用于多 agent tick：每个 agent 独立查自己的经济状态。
 */
export const getAgentEconomyByEconId = internalQuery({
  args: { worldId: v.id('worlds'), econAgentId: v.string() },
  handler: async (ctx, { worldId, econAgentId }) => {
    return await ctx.db
      .query('agentEconomy')
      .withIndex('econAgentId', (q) => q.eq('worldId', worldId).eq('econAgentId', econAgentId))
      .first();
  },
});
