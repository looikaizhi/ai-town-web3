export interface WhisperRow {
  sender: string;
  amount: string; // atomic USDC decimal string
  text: string;
  ts: number; // ordering: newest wins for a sender's displayed text
}

export interface WeightedVoice {
  sender: string;
  text: string; // the sender's most recent whisper text
  weight: number; // sqrt(total atomic amount by this sender)
}

/**
 * Aggregate whispers per sender (sum amounts) → weight = sqrt(total) (quadratic: damps whales,
 * and aggregation closes the "split into many" sybil hole). Return the top-K senders by weight,
 * each represented by their most recent whisper text. Deterministic: sort by weight desc, then ts asc (oldest sender wins ties).
 */
export function quadraticTopK(rows: WhisperRow[], k: number): WeightedVoice[] {
  const bySender = new Map<string, { total: bigint; text: string; ts: number }>();
  for (const r of rows) {
    const cur = bySender.get(r.sender);
    const amt = BigInt(r.amount);
    if (!cur) {
      bySender.set(r.sender, { total: amt, text: r.text, ts: r.ts });
    } else {
      cur.total += amt;
      if (r.ts >= cur.ts) {
        cur.text = r.text;
        cur.ts = r.ts;
      }
    }
  }
  const voices: (WeightedVoice & { ts: number })[] = [];
  for (const [sender, v] of bySender) {
    voices.push({ sender, text: v.text, weight: Math.sqrt(Number(v.total)), ts: v.ts });
  }
  voices.sort((a, b) => (b.weight - a.weight) || (a.ts - b.ts));
  return voices.slice(0, k).map(({ sender, text, weight }) => ({ sender, text, weight }));
}
