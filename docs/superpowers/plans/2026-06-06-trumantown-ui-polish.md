# TrumanTown UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the SP2 UI — make AgentGauge bars bigger and visible, redesign TradePanel to match pixel art style, and widen the right panel.

**Architecture:** Pure CSS/Tailwind + PixiJS Graphics changes. No new dependencies, no backend changes, no new files. Three isolated tasks, each touching one file.

**Tech Stack:** React 18, Tailwind CSS 3, PixiJS 7 (@pixi/react), existing brown/clay palette + SVG border classes.

---

## File Structure

- Modify: `src/components/economy/AgentGauge.tsx` — bigger bars, black outline stroke, higher Y position
- Modify: `src/components/economy/TradePanel.tsx` — pixel art header, styled stats, game-style buttons/inputs
- Modify: `src/components/Game.tsx:70` — widen right panel from `lg:w-96` to `lg:w-[420px]`

---

## Task 1: AgentGauge — Bigger Bars + Black Outline

**Files:**
- Modify: `src/components/economy/AgentGauge.tsx`

**Context:** Current bars are 40×4px and blend into map tiles. Need 56×6px with a 1px black outline rect drawn around each bar. Move container 8px higher (from `y - 34` to `y - 42`). Tombstone headstone slightly larger.

- [ ] **Step 1: Replace AgentGauge.tsx with the improved version**

Replace the full content of `src/components/economy/AgentGauge.tsx` with:

```tsx
import { Container, Graphics } from '@pixi/react';
import { useTick } from '@pixi/react';
import { useCallback, useRef } from 'react';
import * as PIXI from 'pixi.js';
import type { GaugeView } from '../../web3/gauge';

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const BAR_W = 56;
const BAR_H = 6;
const GAP = 3;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function AgentGauge({ x, y, view }: { x: number; y: number; view: GaugeView }) {
  const containerRef = useRef<PIXI.Container | null>(null);
  const t = useRef(0);

  useTick((delta) => {
    const c = containerRef.current;
    if (!c) return;
    if (view.pulsing && !REDUCED_MOTION) {
      t.current += delta * 0.12;
      c.scale.set(1 + Math.sin(t.current) * 0.06);
    } else {
      c.scale.set(1);
    }
  });

  const energyColor =
    view.state === 'dead' ? 0x666666 : view.state === 'starving' ? 0xdc2626 : 0x22c55e;

  const drawBars = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      const totalH = BAR_H * 2 + GAP;

      // Dark backdrop
      g.beginFill(0x000000, 0.65);
      g.drawRect(-BAR_W / 2 - 2, -2, BAR_W + 4, totalH + 4);
      g.endFill();

      // Energy bar fill
      g.beginFill(energyColor);
      g.drawRect(-BAR_W / 2, 0, BAR_W * clamp01(view.energyFrac), BAR_H);
      g.endFill();
      // Energy bar outline
      g.lineStyle(1, 0x000000, 0.9);
      g.drawRect(-BAR_W / 2, 0, BAR_W, BAR_H);
      g.lineStyle(0);

      // Standing bar fill (gold)
      g.beginFill(0xeab308);
      g.drawRect(-BAR_W / 2, BAR_H + GAP, BAR_W * clamp01(view.standingFrac), BAR_H);
      g.endFill();
      // Standing bar outline
      g.lineStyle(1, 0x000000, 0.9);
      g.drawRect(-BAR_W / 2, BAR_H + GAP, BAR_W, BAR_H);
      g.lineStyle(0);
    },
    [energyColor, view.energyFrac, view.standingFrac],
  );

  const drawCountdown = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (view.state !== 'starving') return;
      const r = 30;
      const frac = clamp01(view.countdownFrac);
      g.lineStyle(2.5, 0xdc2626, 0.9);
      g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    },
    [view.state, view.countdownFrac],
  );

  const drawTomb = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (view.state !== 'dead') return;
      g.beginFill(0x9ca3af);
      g.drawRoundedRect(-8, -18, 16, 20, 7); // headstone
      g.drawRect(-10, 2, 20, 4); // base
      g.endFill();
      // dark outline
      g.lineStyle(1, 0x000000, 0.6);
      g.drawRoundedRect(-8, -18, 16, 20, 7);
      g.drawRect(-10, 2, 20, 4);
      g.lineStyle(0);
    },
    [view.state],
  );

  return (
    <Container ref={containerRef} x={x} y={y - 42}>
      <Graphics draw={drawCountdown} y={22} />
      <Graphics draw={drawBars} />
      <Graphics draw={drawTomb} y={-2} />
    </Container>
  );
}
```

- [ ] **Step 2: Verify visually in browser**

Open `http://localhost:5174/ai-town` — you should see wider bars (56px) with black outlines above the agent sprite. Bars should be visible over both grass and water tiles.

- [ ] **Step 3: Commit**

```bash
git add src/components/economy/AgentGauge.tsx
git commit -m "feat(ui): bigger AgentGauge bars (56px) with black outline, higher position

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: TradePanel — Pixel Art Redesign

**Files:**
- Modify: `src/components/economy/TradePanel.tsx`

**Context:** Current panel has a `.box` wrapper but plain inputs/buttons that don't match the game's pixel art style. Need: `font-display` header, gold-colored Standing value, larger inputs (h-10), game-style Buy/Sell tabs with proper active states, `.button`-style action button using inner div pattern, `font-body` throughout.

- [ ] **Step 1: Replace TradePanel.tsx with the pixel-art styled version**

Replace the full content of `src/components/economy/TradePanel.tsx` with:

```tsx
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
    if (tab === 'buy') return coin.allowance >= (estimate?.in ?? 0n) ? '购买' : '① 授权 → ② 购买';
    return '卖出';
  })();

  return (
    <div className="box mt-4 bg-brown-800 text-brown-100">
      {/* Header */}
      <h2 className="bg-brown-700 p-2 font-display text-xl tracking-wider shadow-solid text-center">
        💰 Trade
      </h2>

      <div className="p-3 space-y-3">
        {/* Market stats */}
        <div className="font-body tabular-nums text-sm space-y-1 border border-brown-700 rounded p-2 bg-brown-900">
          <div className="flex justify-between items-center">
            <span className="text-clay-300">Standing</span>
            <span className="text-gold font-body text-base">
              {standing ? `${formatUsdc(BigInt(standing.marketCap || '0'))} USDC` : '—'}
            </span>
          </div>
          <div className="flex justify-between items-center border-t border-brown-700 pt-1">
            <span className="text-clay-300">Price</span>
            <span className="text-brown-100">
              {standing ? `${formatUsdc(BigInt(standing.pricePerToken || '0'), 6)} /coin` : '—'}
            </span>
          </div>
          <div className="flex justify-between items-center border-t border-brown-700 pt-1">
            <span className="text-clay-300">你的持仓</span>
            <span className="text-brown-100">{formatToken(coin.tokenBalance)}</span>
          </div>
        </div>

        {/* Wallet connect */}
        <div className="flex justify-center">
          <ConnectButton chainStatus="icon" showBalance={false} />
        </div>

        {/* Dead state */}
        {isDead && (
          <div role="alert" className="font-body text-center text-sell border border-sell bg-sell/10 p-2 rounded text-sm">
            🪦 该居民已死亡，无法买卖
          </div>
        )}

        {/* Wrong chain */}
        {wrongChain && !isDead && (
          <button
            className="button w-full text-white shadow-solid cursor-pointer pointer-events-auto"
            onClick={() => switchChain({ chainId: CHAIN_ID })}
          >
            <div className="h-full bg-info text-center font-body py-1 text-sm">
              切换到 Base Sepolia
            </div>
          </button>
        )}

        {/* Trade UI */}
        {isConnected && !wrongChain && !isDead && (
          <>
            {/* Buy / Sell tabs */}
            <div className="flex gap-1">
              <button
                className={`button flex-1 shadow-solid cursor-pointer pointer-events-auto text-white`}
                onClick={() => setTab('buy')}
              >
                <div className={`h-full text-center font-display tracking-wider py-1 ${tab === 'buy' ? 'bg-buy' : 'bg-brown-700 text-brown-300'}`}>
                  Buy
                </div>
              </button>
              <button
                className={`button flex-1 shadow-solid cursor-pointer pointer-events-auto text-white`}
                onClick={() => setTab('sell')}
              >
                <div className={`h-full text-center font-display tracking-wider py-1 ${tab === 'sell' ? 'bg-sell' : 'bg-brown-700 text-brown-300'}`}>
                  Sell
                </div>
              </button>
            </div>

            {/* Amount input */}
            <div className="space-y-1">
              <label className="font-body text-clay-300 text-xs uppercase tracking-wider">
                金额（{tab === 'buy' ? 'USDC' : 'coin'}）
              </label>
              <div className="flex gap-1">
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  className="flex-1 h-10 px-2 bg-brown-900 text-brown-100 font-body tabular-nums border border-brown-700 focus:border-clay-300 outline-none"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
                <button
                  className="button shadow-solid cursor-pointer pointer-events-auto text-white px-1"
                  onClick={onMax}
                >
                  <div className="h-full bg-clay-700 font-body text-xs px-2 flex items-center">Max</div>
                </button>
              </div>
            </div>

            {/* Slippage */}
            <div className="flex items-center gap-2 font-body text-sm">
              <span className="text-clay-300 text-xs uppercase tracking-wider">滑点容忍</span>
              <select
                className="bg-brown-900 text-brown-100 border border-brown-700 px-1 py-0.5 font-body text-sm"
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
              <p className="font-body tabular-nums text-clay-300 text-xs">
                预估得 ≈{' '}
                <span className="text-brown-100">
                  {estimate.kind === 'buy'
                    ? `${formatToken(estimate.out)} coin`
                    : `${formatUsdc(estimate.out)} USDC`}
                </span>
                {' '}（最少{' '}
                {estimate.kind === 'buy' ? formatToken(estimate.minOut) : formatUsdc(estimate.minOut)}
                ）
              </p>
            )}

            {/* Action button */}
            <button
              className="button w-full shadow-solid cursor-pointer pointer-events-auto text-white disabled:opacity-40"
              disabled={busy || !estimate}
              onClick={onSubmit}
            >
              <div className={`h-full text-center font-display tracking-wider py-2 ${tab === 'buy' ? 'bg-buy' : 'bg-sell'}`}>
                {busy && <span className="inline-block animate-spin mr-1">⟳</span>}
                {actionLabel}
              </div>
            </button>

            {/* Status messages */}
            {errorMsg && (
              <div role="alert" className="font-body text-sell text-xs">
                {errorMsg}
              </div>
            )}
            {phase === 'done' && (
              <div role="status" className="font-body text-buy text-xs">
                ✓ 成交，Standing 已更新
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5174/ai-town`, click an agent. The TradePanel should now show:
- "💰 Trade" header in pixel font with brown-700 background
- Gold-colored Standing value
- Buy/Sell as pixel-art `.button` style tabs
- Taller input (h-10), monospace font
- Green/red action button using `.button` class with `font-display` label

- [ ] **Step 3: Verify buy/sell still works**

Connect MetaMask, try a buy — MetaMask should still pop up and transaction should complete.

- [ ] **Step 4: Commit**

```bash
git add src/components/economy/TradePanel.tsx
git commit -m "feat(ui): redesign TradePanel with pixel art style — font-display header, gold stats, game-style buttons

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Right Panel Width — Wider

**Files:**
- Modify: `src/components/Game.tsx:70`

**Context:** Line 70 has `lg:w-96` (384px). Increase to `lg:w-[420px]` so the TradePanel and PlayerDetails have more breathing room.

- [ ] **Step 1: Widen the right panel**

In `src/components/Game.tsx`, find line 70:
```
className="flex flex-col overflow-y-auto shrink-0 px-4 py-6 sm:px-6 lg:w-96 xl:pr-6 border-t-8 sm:border-t-0 sm:border-l-8 border-brown-900  bg-brown-800 text-brown-100"
```

Change `lg:w-96` to `lg:w-[420px]`:
```
className="flex flex-col overflow-y-auto shrink-0 px-4 py-6 sm:px-6 lg:w-[420px] xl:pr-6 border-t-8 sm:border-t-0 sm:border-l-8 border-brown-900  bg-brown-800 text-brown-100"
```

- [ ] **Step 2: Verify in browser**

Right panel should be visibly wider. Description text and TradePanel should have more space, less awkward wrapping.

- [ ] **Step 3: Commit**

```bash
git add src/components/Game.tsx
git commit -m "feat(ui): widen right panel from 384px to 420px for better readability

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Completion Check

After all 3 tasks:
1. AgentGauge: 56px wide bars with black outlines visible over any map tile
2. TradePanel: pixel art styled with `font-display` header, gold Standing, game-style buttons
3. Right panel: 420px wide, less text wrapping
4. Buy/sell transactions: still functional end-to-end
