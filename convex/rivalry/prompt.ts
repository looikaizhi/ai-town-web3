import { RIVALRY_TOP_K } from './constants';

export interface RivalSnapshot {
  rivalAgentId: string;
  marketCap: string; // atomic USDC string
  alive: boolean;
  allied: boolean;
}

/**
 * 博弈感知 prompt 块：告诉居民其他居民的链上状态。
 * 按市值降序取 top-K，区分盟友/敌人/已死亡。
 * 返回 string[]，与 survivalPrompt/whispersPrompt 形状一致。
 */
export function rivalryPrompt(selfAgentId: string, snapshot: RivalSnapshot[]): string[] {
  if (snapshot.length === 0) return [];

  const sorted = [...snapshot]
    .sort((a, b) => Number(BigInt(b.marketCap) - BigInt(a.marketCap)))
    .slice(0, RIVALRY_TOP_K);

  const lines: string[] = [
    `Here is the current state of the other residents in town (ranked by their standing/market cap):`,
  ];

  for (const r of sorted) {
    const status = !r.alive
      ? 'DEAD'
      : r.allied
      ? 'your ALLY'
      : 'rival';
    const mc = (Number(r.marketCap) / 1e6).toFixed(2);
    lines.push(` - resident ${r.rivalAgentId}: standing=${mc} USDC, status=${status}`);
  }

  lines.push(
    `You may choose to buy a rival's token (to support an ally or signal dominance), ` +
    `whisper to them (to influence or propose alliance), or propose/accept/dissolve an alliance. ` +
    `These are your own decisions — act in your interest.`,
  );

  return lines;
}
