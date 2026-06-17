import { v } from 'convex/values';
import { defineTable } from 'convex/server';
import { agentId } from '../aiTown/ids';

// One row per (world, ai-town agent). Holds the cached perception snapshot (written
// by the economic tick) and the survival state machine. `econAgentId` maps the
// ai-town agent to the executor/registry id ("0" in SP1). `eoa` is the sweep target.
export const economyTables = {
  agentEconomy: defineTable({
    worldId: v.id('worlds'),
    agentId, // ai-town GameId<'agents'> (string)
    econAgentId: v.string(), // executor/registry id, SP1 "0"
    eoa: v.string(), // agent EOA address (smart->eoa sweep target)

    // perception snapshot (atomic decimal strings)
    eoaUsdc: v.string(),
    smartUsdc: v.string(),
    tokenBalance: v.string(),
    marketCap: v.string(),
    energy: v.number(), // floor(eoaUsdc / costPerThink)
    lastPerceivedAt: v.number(),

    // survival state machine
    status: v.union(v.literal('alive'), v.literal('starving'), v.literal('dead')),
    starvingPeriods: v.number(),
    starvingSince: v.optional(v.number()),
    diedAt: v.optional(v.number()),
  })
    .index('worldId', ['worldId', 'agentId'])
    .index('econAgentId', ['worldId', 'econAgentId']),
};
