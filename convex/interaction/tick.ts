import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import * as embeddingsCache from '../agent/embeddingsCache';
import { interactionEnabled, ponderUrl } from './constants';
import { agentIds } from '../economy/constants';
import { mapImportance } from './whispers';

type PonderWhisper = { id: string; sender: string; amount: string; text: string; timestamp: string };

export const runWhisperTick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!interactionEnabled()) return; // gate: no-op when flag off
    const purl = ponderUrl();
    if (!purl) return;

    // Run whisper tick for all deployed agents (same list as economy tick)
    for (const onchainAgentId of agentIds()) {
      try {
        const resident = await ctx.runQuery(internal.interaction.whispers.getResidentByEconId, { onchainAgentId });
        if (!resident) continue;

        const sinceSec = await ctx.runQuery(internal.interaction.whispers.getCursor, { onchainAgentId });

        // Pull new whispers from the indexer (Ponder read API).
        let list: PonderWhisper[] = [];
        try {
          const r = await fetch(`${purl}/agents/${onchainAgentId}/whispers?since=${sinceSec}`);
          if (!r.ok) continue;
          list = (await r.json()) as PonderWhisper[];
        } catch (e) {
          console.error(`[interaction] whispers fetch failed for agent ${onchainAgentId}`, e);
          continue;
        }

        let maxTs = sinceSec;
        for (const w of list) {
          const tsSec = Number(w.timestamp);
          maxTs = Math.max(maxTs, tsSec);
          const whisperId = await ctx.runMutation(internal.interaction.whispers.insertWhisperIfNew, {
            onchainAgentId,
            whisperLogId: w.id,
            sender: w.sender,
            amount: w.amount,
            text: w.text,
            ts: tsSec * 1000,
          });
          if (!whisperId) continue; // dup
          const embedding = await embeddingsCache.fetch(ctx, w.text);
          const importance = mapImportance(Math.sqrt(Number(w.amount)));
          await ctx.runMutation(internal.interaction.whispers.writeWhisperMemory, {
            whisperId,
            playerId: resident.playerId as any,
            description: `A townsperson paid to tell you: "${w.text}"`,
            importance,
            embedding,
            sender: w.sender,
            amount: w.amount,
          });
        }
        if (maxTs > sinceSec) {
          await ctx.runMutation(internal.interaction.whispers.setCursor, { onchainAgentId, lastTsSec: maxTs });
        }
      } catch (e) {
        console.error(`[interaction] whisper tick failed for agent ${onchainAgentId}`, e);
      }
    }
  },
});
