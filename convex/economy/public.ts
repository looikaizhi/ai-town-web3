import { query } from '../_generated/server';
import { v } from 'convex/values';
import { RECOVERY_WINDOW } from './constants';

export interface AgentStatusView {
  playerId: string;
  econAgentId: string;
  status: 'alive' | 'starving' | 'dead';
  energy: number;
  starvingPeriods: number;
  recoveryWindow: number;
  diedAt: number | null;
}

/**
 * Pure selector: economy row + ai-town playerId + T -> the frontend view.
 * Kept pure (no ctx) so it is unit-testable without a Convex harness.
 */
export function selectAgentStatus(
  playerId: string,
  econ: {
    econAgentId: string;
    status: 'alive' | 'starving' | 'dead';
    energy: number;
    starvingPeriods: number;
    diedAt?: number;
  },
  recoveryWindow: number,
): AgentStatusView {
  return {
    playerId,
    econAgentId: econ.econAgentId,
    status: econ.status,
    energy: econ.energy,
    starvingPeriods: econ.starvingPeriods,
    recoveryWindow,
    diedAt: econ.diedAt ?? null,
  };
}

/**
 * SP2+ 前端只读查询：返回指定 econAgentId 的经济快照。
 * 默认查 "0"（向后兼容 SP1 单居民）。
 */
export const getAgentStatus = query({
  args: { econAgentId: v.optional(v.string()) },
  handler: async (ctx, { econAgentId = '0' }): Promise<AgentStatusView | null> => {
    const econ = await ctx.db
      .query('agentEconomy')
      .filter((q) => q.eq(q.field('econAgentId'), econAgentId))
      .first();
    if (!econ) return null;
    return selectAgentStatus(econ.agentId as string, econ, RECOVERY_WINDOW);
  },
});

/**
 * SP3+ 全部居民经济快照 — PixiJS 地图仪表盘用。
 * 返回当前世界所有 agentEconomy 行，前端按 playerId 匹配精灵。
 */
export const getAllAgentStatuses = query({
  args: {},
  handler: async (ctx): Promise<AgentStatusView[]> => {
    const rows = await ctx.db.query('agentEconomy').collect();
    return rows.map((r) => selectAgentStatus(r.agentId as string, r, RECOVERY_WINDOW));
  },
});
