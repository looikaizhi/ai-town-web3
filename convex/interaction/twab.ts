/** 单笔交易记录（从 Ponder trade 表简化） */
export interface TradeRow {
  side: 'buy' | 'sell';
  tokens: string; // atomic token amount (18dec decimal string)
  ts: number;     // ms epoch
}

/** 来自 whispers 表的耳语行 */
export interface WhisperRow {
  sender: string;
  text: string;
  ts: number; // ms epoch
}

/** 加权耳语结果（与 WeightedVoice 兼容） */
export interface WeightedVoice {
  sender: string;
  text: string;
  weight: number; // TWAB token-days
}

/**
 * 计算某地址的时间加权平均持仓分数（token-days）。
 * 只计算 windowMs 内的交易，防止早期大户永远占主导。
 */
export function twabScore(trades: TradeRow[], nowMs: number, windowMs: number): number {
  const windowStart = nowMs - windowMs;

  // Sort all trades by time ascending
  const sorted = [...trades].filter((t) => t.ts <= nowMs).sort((a, b) => a.ts - b.ts);

  // Seed balance from trades BEFORE the window (so long-term holders get credit)
  let balance = BigInt(0);
  for (const t of sorted) {
    if (t.ts >= windowStart) break;
    if (t.side === 'buy') balance += BigInt(t.tokens);
    else { balance -= BigInt(t.tokens); if (balance < 0n) balance = 0n; }
  }

  // Only accumulate token-days for trades within the window
  const recent = sorted.filter((t) => t.ts >= windowStart);
  let prevTs = windowStart;
  let tokenDays = 0;

  for (const t of recent) {
    const dtDays = (t.ts - prevTs) / (24 * 60 * 60 * 1000);
    if (dtDays > 0) tokenDays += Number(balance) * dtDays;
    prevTs = t.ts;
    if (t.side === 'buy') {
      balance += BigInt(t.tokens);
    } else {
      balance -= BigInt(t.tokens);
      if (balance < 0n) balance = 0n;
    }
  }

  // 加上最后一笔到 now 的持仓期
  const finalDt = (nowMs - prevTs) / (24 * 60 * 60 * 1000);
  if (finalDt > 0) tokenDays += Number(balance) * finalDt;

  return tokenDays;
}

/**
 * 按 TWAB 信任分对耳语排序，取 top-K。
 * 零分（无持仓）的发送者被排除。
 * 每个 sender 只取最近一条耳语（最高 ts）。
 */
export function twabTopK(
  whispers: WhisperRow[],
  holderScores: Record<string, number>, // address -> twabScore
  k: number,
): WeightedVoice[] {
  // 每个 sender 取最新耳语
  const bySender = new Map<string, { text: string; ts: number }>();
  for (const w of whispers) {
    const cur = bySender.get(w.sender);
    if (!cur || w.ts > cur.ts) bySender.set(w.sender, { text: w.text, ts: w.ts });
  }

  const voices: WeightedVoice[] = [];
  for (const [sender, { text }] of bySender) {
    // Normalize to lowercase to match holderScores keys (which are lowercased from Ponder)
    const score = holderScores[sender.toLowerCase()] ?? 0;
    if (score <= 0) continue; // 无持仓不进 prompt
    voices.push({ sender, text, weight: score });
  }

  voices.sort((a, b) => b.weight - a.weight);
  return voices.slice(0, k);
}
