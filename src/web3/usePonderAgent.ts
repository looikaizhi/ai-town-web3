import { useCallback, useEffect, useRef, useState } from 'react';
import { PONDER_URL } from './constants';

// Mirrors services/indexer AgentAggregate (atomic decimal strings).
export interface AgentStanding {
  agentId: string;
  token: `0x${string}`;
  wallet: string;
  costPerThink: string;
  floor: string;
  recoveryWindow: number;
  alive: boolean;
  tokenBalance: string;
  marketCap: string;
  pricePerToken: string;
  usdcReserve: string;
  spawnedAt: number | null;
  diedAt: number | null;
  updatedAt: number;
}

/**
 * Polls Ponder /agents/:id every `pollMs`. Plain fetch + state (NO react-query / wagmi
 * provider), so it works both in the normal React tree AND inside the PixiJS Stage
 * sub-renderer (where outer context does not propagate). `refetch` forces an immediate
 * reload (call it after a trade confirms for instant Standing update).
 */
export function usePonderAgent(agentId: string, pollMs = 4000) {
  const [data, setData] = useState<AgentStanding | null>(null);
  const mounted = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch(`${PONDER_URL}/agents/${agentId}`);
      if (!r.ok) return;
      const json = (await r.json()) as AgentStanding;
      if (mounted.current) setData(json);
    } catch {
      /* fail-safe: keep last snapshot */
    }
  }, [agentId]);

  useEffect(() => {
    mounted.current = true;
    void refetch();
    const id = setInterval(() => void refetch(), pollMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refetch, pollMs]);

  return { data, refetch };
}
