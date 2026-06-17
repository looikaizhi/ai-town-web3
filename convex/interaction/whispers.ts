import { v } from 'convex/values';
import { internalQuery, internalMutation, mutation, action } from '../_generated/server';
import { internal } from '../_generated/api';
import { verifyMessage } from 'viem';
import { interactionEnabled, ponderUrl } from './constants';

/** Quadratic weight (sqrt of atomic USDC) → existing 0..9 memory importance scale. */
export function mapImportance(weight: number): number {
  if (weight <= 0) return 0;
  // weight = sqrt(atomicUSDC); sqrt(1e6)=1000 for 1 USDC. log10 maps 1..1e6 -> ~0..6; scale to 0..9.
  const i = Math.round((Math.log10(weight) / Math.log10(1000)) * 9);
  return Math.max(0, Math.min(9, i));
}

/**
 * Resolve a specific resident by econAgentId (= world.agents array index).
 * econAgentId "0" → world.agents[0], "1" → world.agents[1], etc.
 */
export const getResidentByEconId = internalQuery({
  args: { onchainAgentId: v.string() },
  handler: async (ctx, { onchainAgentId }) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return null;
    const world = await ctx.db.get(status.worldId);
    if (!world) return null;
    const index = parseInt(onchainAgentId, 10);
    const agent = world.agents[index];
    if (!agent) return null;
    return { worldId: status.worldId, agentId: agent.id, playerId: agent.playerId };
  },
});

/** @deprecated Use getResidentByEconId. Kept for SP3 whisper tick backward compat. */
export const getDefaultResident = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return null;
    const world = await ctx.db.get(status.worldId);
    if (!world) return null;
    const agent = world.agents[0];
    if (!agent) return null;
    return { worldId: status.worldId, agentId: agent.id, playerId: agent.playerId };
  },
});

export const getCursor = internalQuery({
  args: { onchainAgentId: v.string() },
  handler: async (ctx, { onchainAgentId }) => {
    const row = await ctx.db
      .query('whisperCursor')
      .withIndex('agent', (q) => q.eq('onchainAgentId', onchainAgentId))
      .first();
    return row?.lastTsSec ?? 0;
  },
});

export const setCursor = internalMutation({
  args: { onchainAgentId: v.string(), lastTsSec: v.number() },
  handler: async (ctx, { onchainAgentId, lastTsSec }) => {
    const row = await ctx.db
      .query('whisperCursor')
      .withIndex('agent', (q) => q.eq('onchainAgentId', onchainAgentId))
      .first();
    if (row) await ctx.db.patch(row._id, { lastTsSec });
    else await ctx.db.insert('whisperCursor', { onchainAgentId, lastTsSec });
  },
});

/** Insert a whisper row if its logId is new. Returns the _id (or null if dup). */
export const insertWhisperIfNew = internalMutation({
  args: {
    onchainAgentId: v.string(),
    whisperLogId: v.string(),
    sender: v.string(),
    amount: v.string(),
    text: v.string(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('whispers')
      .withIndex('logId', (q) => q.eq('whisperLogId', args.whisperLogId))
      .first();
    if (existing) return null;
    return await ctx.db.insert('whispers', { ...args, memoryWritten: false });
  },
});

/** Read recent whispers (within window) for a given onchain agent (for the prompt block). */
export const recentWhispers = internalQuery({
  args: { onchainAgentId: v.string(), sinceTs: v.number() },
  handler: async (ctx, { onchainAgentId, sinceTs }) => {
    return await ctx.db
      .query('whispers')
      .withIndex('agent_ts', (q) => q.eq('onchainAgentId', onchainAgentId).gte('ts', sinceTs))
      .collect();
  },
});

/** Write a whisper as a retrievable memory under the resident's playerId (importance on 0..9). */
export const writeWhisperMemory = internalMutation({
  args: {
    whisperId: v.id('whispers'),
    playerId: v.string(),
    description: v.string(),
    importance: v.number(),
    embedding: v.array(v.float64()),
    sender: v.string(),
    amount: v.string(),
  },
  handler: async (ctx, args) => {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: args.playerId as any,
      embedding: args.embedding,
    });
    await ctx.db.insert('memories', {
      playerId: args.playerId as any,
      embeddingId,
      importance: args.importance,
      lastAccess: Date.now(),
      description: args.description,
      data: { type: 'whisper', sender: args.sender, amount: args.amount },
    });
    await ctx.db.patch(args.whisperId, { memoryWritten: true });
  },
});

/** Internal mutation: write the whisper row (no network I/O allowed in mutations). */
export const insertWhisperDirect = internalMutation({
  args: {
    onchainAgentId: v.string(),
    sender: v.string(),
    text: v.string(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    const logId = `direct-${args.sender}-${args.ts}`;
    // Check for duplicate (same sender + same second)
    const existing = await ctx.db
      .query('whispers')
      .withIndex('logId', (q) => q.eq('whisperLogId', logId))
      .first();
    if (existing) return;
    await ctx.db.insert('whispers', {
      onchainAgentId: args.onchainAgentId,
      whisperLogId: logId,
      sender: args.sender,
      amount: '0',
      text: args.text,
      ts: args.ts,
      memoryWritten: false,
    });
  },
});

/**
 * SP4 持币耳语：免费直写，身份由 Ethereum 签名验证。
 * Must be an action (not mutation) because it calls fetch() for TWAB check.
 */
export const submitWhisper = action({
  args: {
    onchainAgentId: v.string(),
    text: v.string(),
    sender: v.string(),    // 钱包地址（0x...）
    signature: v.string(), // signMessage(text) 的签名
  },
  handler: async (ctx, args) => {
    if (!interactionEnabled()) throw new Error('interaction not enabled');
    if (args.text.length === 0 || args.text.length > 512) {
      throw new Error('text must be 1-512 chars');
    }

    // 验证签名：确认 sender 确实签了 text
    const valid = await verifyMessage({
      address: args.sender as `0x${string}`,
      message: args.text,
      signature: args.signature as `0x${string}`,
    });
    if (!valid) throw new Error('invalid signature');

    // 检查 TWAB > 0（有持仓才能耳语）
    const purl = ponderUrl();
    if (purl) {
      try {
        const r = await fetch(`${purl}/agents/${args.onchainAgentId}/holders`);
        if (r.ok) {
          const holders = (await r.json()) as Array<{ address: string; twabScore: number }>;
          const entry = holders.find(
            (h) => h.address.toLowerCase() === args.sender.toLowerCase(),
          );
          if (!entry || entry.twabScore <= 0) {
            throw new Error('insufficient holding: must hold agent token to whisper');
          }
        }
      } catch (e: any) {
        if (e.message?.includes('insufficient holding')) throw e;
        // Ponder 不可达时放行（降级：允许耳语，权重为 0）
      }
    }

    await ctx.runMutation(internal.interaction.whispers.insertWhisperDirect, {
      onchainAgentId: args.onchainAgentId,
      sender: args.sender,
      text: args.text,
      ts: Date.now(),
    });
  },
});
