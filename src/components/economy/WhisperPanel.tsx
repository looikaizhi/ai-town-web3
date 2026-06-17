import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain, useSignMessage } from 'wagmi';
import { useAction } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { CHAIN_ID, DEFAULT_AGENT_ID, PONDER_URL } from '../../web3/constants';

interface WhisperRecord {
  id: string;
  sender: string;
  text: string;
  ts: number;
}

interface HolderRecord {
  address: string;
  twabScore: number;
}

type WhisperPhase = 'idle' | 'signing' | 'submitting' | 'done' | 'error';

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WhisperPanel({ agentId = DEFAULT_AGENT_ID }: { agentId?: string }) {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const submitWhisper = useAction(api.interaction.whispers.submitWhisper);

  const [text, setText] = useState('');
  const [phase, setPhase] = useState<WhisperPhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [recentWhispers, setRecentWhispers] = useState<WhisperRecord[]>([]);
  const [myScore, setMyScore] = useState<number | null>(null);

  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      // 拉最近耳语
      const r1 = await fetch(`${PONDER_URL}/agents/${agentId}/whispers`);
      if (r1.ok && mountedRef.current) {
        const data = await r1.json();
        setRecentWhispers(Array.isArray(data) ? data.slice(0, 5) : []);
      }
      // 拉自己的信任分
      if (address) {
        const r2 = await fetch(`${PONDER_URL}/agents/${agentId}/holders`);
        if (r2.ok && mountedRef.current) {
          const holders = (await r2.json()) as HolderRecord[];
          const mine = holders.find(
            (h) => h.address.toLowerCase() === address.toLowerCase(),
          );
          setMyScore(mine ? mine.twabScore : 0);
        }
      }
    } catch {
      /* fail-safe */
    }
  }, [agentId, address]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();
    const id = setInterval(() => void fetchData(), 10_000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchData]);

  const wrongChain = isConnected && chainId !== CHAIN_ID;
  const busy = phase === 'signing' || phase === 'submitting';
  const canSubmit = text.trim().length > 0 && isConnected && !wrongChain;

  const handleWhisper = async () => {
    if (!canSubmit || !address) return;
    setErrorMsg(null);
    try {
      setPhase('signing');
      const signature = await signMessageAsync({ message: text });
      setPhase('submitting');
      await submitWhisper({
        onchainAgentId: agentId,
        text,
        sender: address,
        signature,
      });
      setPhase('done');
      setText('');
      void fetchData();
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(e?.message ?? '发送失败，请重试');
    }
  };

  const actionLabel = (() => {
    if (phase === 'signing') return '签名中…';
    if (phase === 'submitting') return '发送中…';
    return '签名发送';
  })();

  return (
    <div className="box mt-4 bg-brown-800 text-brown-100">
      <div className="bg-brown-700 px-3 py-2 flex items-center justify-between">
        <h2 className="font-display text-lg tracking-wider shadow-solid">🤫 WHISPER</h2>
        <span className="font-body text-xs text-clay-300 uppercase tracking-widest">免费 · 持币加权</span>
      </div>

      <div className="p-3 flex flex-col gap-3">
        <div className="flex justify-center">
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>

        {wrongChain && (
          <button className="trade-chain-btn" onClick={() => switchChain({ chainId: CHAIN_ID })}>
            ⚠ 切换到 Base Sepolia
          </button>
        )}

        {isConnected && !wrongChain && (
          <>
            {/* 信任分显示 */}
            {myScore !== null && (
              <div className="text-xs text-clay-300 text-center">
                你的信任分：<span className="text-brown-100 font-bold">{myScore.toFixed(0)}</span>
                {myScore <= 0 && <span className="text-clay-500"> （需持有代币才能耳语）</span>}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <span className="trade-stat-label">消息（最多 512 字符）</span>
              <textarea
                className="trade-input resize-none"
                rows={3}
                maxLength={512}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="向居民低语…"
              />
              <span className="text-xs text-right text-clay-400">{text.length} / 512</span>
            </div>

            <button
              className="trade-action-btn buy-btn"
              disabled={busy || !canSubmit}
              onClick={handleWhisper}
            >
              {busy ? '⟳ ' : ''}{actionLabel}
            </button>

            {errorMsg && <p className="trade-status-err" role="alert">{errorMsg}</p>}
            {phase === 'done' && (
              <p className="trade-status-ok" role="status">✓ 耳语已发送</p>
            )}
          </>
        )}

        {recentWhispers.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <span className="trade-stat-label">最近低语</span>
            {recentWhispers.map((w) => (
              <div
                key={w.id}
                className="bg-brown-900 px-3 py-2 text-xs"
                style={{ border: '2px solid #B86F50' }}
              >
                <div className="flex justify-between mb-1">
                  <span className="text-clay-300">{truncateAddress(w.sender)}</span>
                </div>
                <p className="text-brown-100 break-words">{w.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
