import React, { useEffect, useState } from 'react';
import { PONDER_URL } from '../../web3/constants';

interface RivalInfo {
  agentId: string;
  marketCap: string;
  pricePerToken: string;
  alive: boolean;
  allied: boolean;
}

interface Props {
  agentId: string; // 当前居民的 onchain agentId（用于拉取对手数据）
}

export function RivalryPanel({ agentId }: Props) {
  const [rivals, setRivals] = useState<RivalInfo[]>([]);

  useEffect(() => {
    const fetchRivals = async () => {
      try {
        const r = await fetch(`${PONDER_URL}/agents/${agentId}/rivals`);
        if (r.ok) setRivals(await r.json());
      } catch {}
    };
    fetchRivals();
    const id = setInterval(fetchRivals, 10_000);
    return () => clearInterval(id);
  }, [agentId]);

  if (rivals.length === 0) return null;

  const sorted = [...rivals].sort(
    (a, b) => Number(BigInt(b.marketCap) - BigInt(a.marketCap)),
  );

  return (
    <div className="box">
      <h2 style={{ fontSize: 14, marginBottom: 6 }}>🏆 居民排行 / Rivals</h2>
      {sorted.map((r) => (
        <div
          key={r.agentId}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            padding: '2px 0',
            color: !r.alive ? '#888' : r.allied ? '#22C55E' : '#fff',
          }}
        >
          <span>
            居民 {r.agentId}
            {r.allied ? ' 🤝' : ''}
            {!r.alive ? ' 💀' : ''}
          </span>
          <span>{(Number(r.marketCap) / 1e6).toFixed(2)} USDC</span>
        </div>
      ))}
      <p style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
        绿=盟友 · 灰=已死 · 每 10s 更新
      </p>
    </div>
  );
}
