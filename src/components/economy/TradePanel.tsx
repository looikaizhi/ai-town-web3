import { useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useAgentCoin } from '../../web3/useAgentCoin';
import { useTrade } from '../../web3/useTrade';
import { CHAIN_ID, DEFAULT_AGENT_ID, DEFAULT_SLIPPAGE_BPS } from '../../web3/constants';
import { formatUsdc, formatToken, parseUsdc, parseToken } from '../../web3/format';
import { estimateBuyTokensOut, estimateSellUsdcOut, applySlippage } from '../../web3/curveMath';

type Tab = 'buy' | 'sell';

export function TradePanel({ agentId = DEFAULT_AGENT_ID }: { agentId?: string }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const coin = useAgentCoin(agentId);
  const { phase, errorMsg, buy, sell, reset } = useTrade(coin.token, () => void coin.refetchAll());

  const [tab, setTab] = useState<Tab>('buy');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  const standing = coin.standing;
  const isDead = !!standing && !standing.alive;
  const wrongChain = isConnected && chainId !== CHAIN_ID;
  const busy = phase === 'approving' || phase === 'buying' || phase === 'selling';

  const reserve = standing ? BigInt(standing.usdcReserve) : 0n;
  const T = coin.curveSupply;

  const estimate = useMemo(() => {
    if (tab === 'buy') {
      const usdcIn = parseUsdc(amount);
      if (usdcIn === null || usdcIn <= 0n) return null;
      const out = estimateBuyTokensOut(usdcIn, reserve, T);
      return { kind: 'buy' as const, in: usdcIn, out, minOut: applySlippage(out, slippageBps) };
    }
    const tokensIn = parseToken(amount);
    if (tokensIn === null || tokensIn <= 0n) return null;
    const out = estimateSellUsdcOut(tokensIn, reserve, T);
    return { kind: 'sell' as const, in: tokensIn, out, minOut: applySlippage(out, slippageBps) };
  }, [tab, amount, reserve, T, slippageBps]);

  const onMax = () => {
    if (tab === 'buy') setAmount(formatUsdc(coin.usdcBalance).replace(/,/g, ''));
    else setAmount(formatToken(coin.tokenBalance).replace(/,/g, ''));
  };

  const onSubmit = async () => {
    if (!estimate) return;
    reset();
    if (estimate.kind === 'buy') await buy(estimate.in, estimate.minOut, coin.allowance);
    else await sell(estimate.in, estimate.minOut);
  };

  const actionLabel = (() => {
    if (phase === 'approving') return '授权中…';
    if (phase === 'buying') return '购买中…';
    if (phase === 'selling') return '卖出中…';
    if (tab === 'buy') return coin.allowance >= (estimate?.in ?? 0n) ? '购买 ▶' : '授权 → 购买';
    return '卖出 ▶';
  })();

  return (
    <div className="box mt-4 bg-brown-800 text-brown-100">
      {/* ── Header ── */}
      <div className="bg-brown-700 px-3 py-2 flex items-center justify-between">
        <h2 className="font-display text-lg tracking-wider shadow-solid">💰 TRADE</h2>
        <span className="font-body text-xs text-clay-300 uppercase tracking-widest">Base Sepolia</span>
      </div>

      <div className="p-3 flex flex-col gap-3">

        {/* ── Market Stats ── */}
        <div className="bg-brown-900 px-3 py-2" style={{ border: '2px solid #B86F50', boxShadow: 'inset 0 1px 0 rgba(234,179,8,0.08)' }}>
          <div className="trade-stat-row">
            <span className="trade-stat-label">Standing</span>
            <span className="trade-stat-value gold">
              {standing ? `${formatUsdc(BigInt(standing.marketCap || '0'))} USDC` : '—'}
            </span>
          </div>
          <div className="trade-stat-row">
            <span className="trade-stat-label">Price</span>
            <span className="trade-stat-value">
              {standing ? `${formatUsdc(BigInt(standing.pricePerToken || '0'), 6)} /coin` : '—'}
            </span>
          </div>
          <div className="trade-stat-row">
            <span className="trade-stat-label">你的持仓</span>
            <span className="trade-stat-value">{formatToken(coin.tokenBalance)}</span>
          </div>
        </div>

        {/* ── Wallet ── */}
        <div className="flex justify-center">
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>

        {/* ── Dead ── */}
        {isDead && (
          <div role="alert" className="trade-dead-banner">
            🪦 &nbsp;该居民已死亡，无法买卖
          </div>
        )}

        {/* ── Wrong Chain ── */}
        {wrongChain && !isDead && (
          <button className="trade-chain-btn" onClick={() => switchChain({ chainId: CHAIN_ID })}>
            ⚠ 切换到 Base Sepolia
          </button>
        )}

        {/* ── Trade UI ── */}
        {isConnected && !wrongChain && !isDead && (
          <>
            {/* Tabs */}
            <div className="flex gap-1">
              <button
                className={`trade-tab ${tab === 'buy' ? 'active-buy' : 'inactive'}`}
                onClick={() => setTab('buy')}
              >
                Buy
              </button>
              <button
                className={`trade-tab ${tab === 'sell' ? 'active-sell' : 'inactive'}`}
                onClick={() => setTab('sell')}
              >
                Sell
              </button>
            </div>

            {/* Amount */}
            <div className="flex flex-col gap-1">
              <span className="trade-stat-label">
                金额（{tab === 'buy' ? 'USDC' : 'coin'}）
              </span>
              <div className="flex gap-1">
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  className="trade-input flex-1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
                <button className="trade-max-btn" onClick={onMax}>MAX</button>
              </div>
            </div>

            {/* Slippage */}
            <div className="trade-slippage-row">
              <span>滑点容忍</span>
              <select
                className="trade-slippage-select"
                value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
              >
                <option value={50}>0.5%</option>
                <option value={100}>1%</option>
                <option value={300}>3%</option>
                <option value={500}>5%</option>
              </select>
            </div>

            {/* Estimate */}
            {estimate && (
              <p className="trade-estimate">
                预估得 ≈ <span>
                  {estimate.kind === 'buy'
                    ? `${formatToken(estimate.out)} coin`
                    : `${formatUsdc(estimate.out)} USDC`}
                </span>
                &nbsp;（最少&nbsp;
                {estimate.kind === 'buy' ? formatToken(estimate.minOut) : formatUsdc(estimate.minOut)}
                ）
              </p>
            )}

            {/* Action */}
            <button
              className={`trade-action-btn ${tab === 'buy' ? 'buy-btn' : 'sell-btn'}`}
              disabled={busy || !estimate}
              onClick={onSubmit}
            >
              {busy ? '⟳ ' : ''}{actionLabel}
            </button>

            {/* Feedback */}
            {errorMsg && <p className="trade-status-err" role="alert">{errorMsg}</p>}
            {phase === 'done' && (
              <p className="trade-status-ok" role="status">✓ 成交，Standing 已更新</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
