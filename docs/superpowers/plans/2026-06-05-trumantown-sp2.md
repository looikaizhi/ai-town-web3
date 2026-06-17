# TrumanTown SP2 Implementation Plan — 人类买卖 + 生命仪表盘

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让人类观众用自己的钱包在绑定曲线上买卖某个 AI 居民的币，并在 PixiJS 地图上实时看到该居民的 Energy/Standing 双仪表盘、抢救倒计时与死亡动画——肉眼连起「你的钱 → 它的命」。

**Architecture:** 纯前端叠加 + 一个只读 Convex 查询；不改 SP1 任何后端契约（合约/网关/执行器/facilitator/Ponder schema 一律不动）。数据分两条线：①「命」线（status/energy/倒计时）走 Convex 反式 `useQuery`；②「价」线（marketCap/price/reserve/alive）轮询 Ponder `/agents/:id`，成交后立即重拉。买卖是人类钱包直接调合约（approve→buy 两步 / sell 一步），不经执行器。可测的纯函数（曲线数学、小数格式化、仪表盘映射、错误文案）严格 TDD；React/Pixi/钱包交互靠手动验收剧本。

**Tech Stack:** React 18 + Vite 4 + TypeScript + Tailwind（现有 Pixel Art）· PixiJS 7 / @pixi/react · wagmi v2 + viem v2 + @rainbow-me/rainbowkit v2 + @tanstack/react-query v5 · Convex（只读查询）· Ponder（读 API，已存在）。

**关键既有事实（实现前必读）：**
- 合约 `AgentToken`（每居民一枚 ERC-20，USDC 6dec 储备，币 18dec）：
  - `buy(uint256 usdcIn, uint256 minTokensOut)` —— 内部 `usdc.transferFrom`，**调用前必须先 `USDC.approve(token, usdcIn)`**。
  - `sell(uint256 tokensIn, uint256 minUsdcOut)` —— 一步即可（`_transfer` 自 `msg.sender`）。
  - 曲线：`tokensOut = T - (R*T)/(R+usdcIn)`；`usdcOut = min((R*tokensIn)/(T+tokensIn), usdcReserve)`；`R = effectiveReserve = max(usdcReserve, 1_000_000)`；`T` = 合约自持代币量。`pricePerToken = R*1e18/T`。
- Ponder `/agents/:id` 返回字段（atomic 十进制字符串）：`token`、`costPerThink`、`floor`、`recoveryWindow`、`alive`、`tokenBalance`、`marketCap`、`pricePerToken`、`usdcReserve`、`diedAt`…（见 `services/indexer/src/aggregate.ts` 的 `AgentAggregate`）。
- Base Sepolia USDC = `0x036CbD53842c5426634e7929541eC2318f3dCF7e`（Circle 测试网，6dec）。
- **PixiJS 上下文桥接坑**：`src/components/Game.tsx` 在 `<Stage>` 内**重新 `ConvexProvider`**，因为 React context 不跨 Pixi 渲染器。结论：仪表盘的数据在 `PixiGame`（Stage 内、Convex 可用）层取好，以**普通 props** 下传给纯展示的 `AgentGauge`；Ponder 数据用**不依赖 Provider 的普通 fetch hook**，可在 Pixi 子树内安全使用。
- 根项目测试用 **Jest**（`jest.config.ts`，ts-jest ESM preset，tsconfig=`convex/tsconfig.json`，target ESNext 支持 bigint）。运行单个路径：`NODE_OPTIONS=--experimental-vm-modules npx jest <path>`。
- **运行环境硬规则**（CLAUDE.md）：npm/node/convex 等工具链**只在 WSL** 跑；git 用 Windows 原生。本机为 Windows 时，npm 命令包：`wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && <cmd>'`。下文 npm/jest 命令默认在 WSL 执行。

---

## File Structure

**新增前端 web3 核心模块** `src/web3/`：
- `constants.ts` — 链、USDC 地址、Ponder URL、WalletConnect projectId、默认 agentId（读 `import.meta.env`）。
- `abis.ts` — USDC（approve/allowance/balanceOf）+ AgentToken（buy/sell/balanceOf）ABI 片段。
- `curveMath.ts` — **纯 bigint** 曲线数学（effectiveReserve / contractTokenBalance / estimateBuy / estimateSell / applySlippage）。**TDD**。
- `format.ts` — 小数解析/格式化（viem parseUnits/formatUnits + 千分位 + 截尾）。**TDD**。
- `gauge.ts` — **纯函数** `economyToGauge()`：经济数据 → 仪表盘视觉参数。**TDD**。
- `tradeError.ts` — **纯函数** `humanizeTradeError()`：合约/钱包错误 → 中文文案。**TDD**。
- `wagmi.ts` — wagmi + RainbowKit 配置。
- `Web3Provider.tsx` — WagmiProvider + QueryClientProvider + RainbowKitProvider 包裹层。
- `usePonderAgent.ts` — 轮询 Ponder `/agents/:id` 的普通 hook（无 Provider 依赖）。
- `useAgentCoin.ts` — 聚合读：token 地址（来自 Ponder）+ 钱包 USDC 余额 / allowance / 持币（wagmi）。
- `useTrade.ts` — 写交易 hook：buy 两步状态机 / sell 一步。

**新增组件** `src/components/economy/`：
- `TradePanel.tsx` — 右侧买卖面板（连接钱包、行情、金额+滑点、状态机按钮、错误行）。
- `AgentGauge.tsx` — 纯展示 PixiJS 仪表盘（双条 + 倒计时弧 + 脉搏 + 死亡墓碑）。

**新增 Convex 只读查询**：
- `convex/economy/public.ts` — `getAgentStatus` 查询 + 纯选择器 `selectAgentStatus()`。**TDD（测纯选择器）**。
- `convex/economy/public.test.ts`。

**修改既有文件**：
- `src/main.tsx` — 用 `Web3Provider` 包裹。
- `src/components/Game.tsx` — `<Stage>` 内追加 `QueryClientProvider` 重传（让 Pixi 子树可用 react-query，若 AgentGauge 走 react-query）；本计划 `usePonderAgent` 不依赖它，故此项仅在确需时做（见 Task 12 备注）。
- `src/components/PlayerDetails.tsx` — 选中居民时渲染 `<TradePanel/>`。
- `src/components/PixiGame.tsx` — 取经济数据，算 `GaugeView`，传给匹配的 `Player`。
- `src/components/Player.tsx` — 接 `gauge?: GaugeView`，渲染 `<AgentGauge/>`。
- `tailwind.config.js` — 加语义色（emerald/red/blue/gold）。

**新增文档/配置**：
- `.env.local.example` — 前端 VITE 变量样例。
- `docs/SP2-acceptance-checklist.md` — 手动验收清单。

> 提交信息统一以仓库约定结尾（保留 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 行）。

---

## Task 1: 安装依赖 + Tailwind 语义色 + 环境样例

**Files:**
- Modify: `package.json`（由 npm install 写入）
- Modify: `tailwind.config.js:9-28`
- Create: `.env.local.example`

- [ ] **Step 1: 安装 web3 依赖（WSL，Node 24）**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && nvm use 24 >/dev/null 2>&1; npm install wagmi@^2 viem@^2 @wagmi/core@^2 @rainbow-me/rainbowkit@^2 @tanstack/react-query@^5'
```
Expected: 4 个新包写入 `package.json` 的 `dependencies`，`npm install` exit 0。

- [ ] **Step 2: 加 Tailwind 语义色**

把 `tailwind.config.js` 的 `theme.extend.colors` 块（第 10–27 行）替换为：

```js
      colors: {
        brown: {
          100: '#FFFFFF',
          200: '#EAD4AA',
          300: '#E4A672',
          500: '#B86F50',
          700: '#743F39',
          800: '#3F2832',
          900: '#181425',
        },
        clay: {
          100: '#C0CBDC',
          300: '#8B9BB4',
          500: '#5A6988',
          700: '#3A4466',
          900: '#181425',
        },
        // SP2 语义动作色（落在现有 Pixel Art 上）
        buy: '#22C55E',
        sell: '#DC2626',
        info: '#2563EB',
        gold: '#EAB308',
      },
```

- [ ] **Step 3: 创建前端环境样例**

Create `.env.local.example`:
```
# SP2 前端 (Vite). 复制为 .env.local 后按需改。
VITE_PONDER_URL=http://127.0.0.1:42069
VITE_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
# 仅注入式钱包(MetaMask)本地演示用 demo 即可；要 WalletConnect 扫码连接，去 https://cloud.walletconnect.com 免费申请
VITE_WALLETCONNECT_PROJECT_ID=demo
```

- [ ] **Step 4: 验证构建未被破坏**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && npx tsc --noEmit -p tsconfig.json'
```
Expected: 无新增错误（依赖装好、未引用新文件，应保持原状态）。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tailwind.config.js .env.local.example
git commit -m "chore(sp2): add wagmi/rainbowkit deps, semantic colors, env example

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Convex 只读查询 `getAgentStatus`（TDD 纯选择器）

**Files:**
- Create: `convex/economy/public.ts`
- Test: `convex/economy/public.test.ts`

- [ ] **Step 1: 写失败测试（纯选择器）**

Create `convex/economy/public.test.ts`:
```ts
import { selectAgentStatus } from './public';

describe('selectAgentStatus', () => {
  const econ = {
    econAgentId: '0',
    status: 'starving' as const,
    energy: 3,
    starvingPeriods: 4,
    diedAt: undefined as number | undefined,
  };

  test('maps econ row + playerId + recoveryWindow into the view', () => {
    expect(selectAgentStatus('p:42', econ, 10)).toEqual({
      playerId: 'p:42',
      econAgentId: '0',
      status: 'starving',
      energy: 3,
      starvingPeriods: 4,
      recoveryWindow: 10,
      diedAt: null,
    });
  });

  test('passes through diedAt when present', () => {
    expect(selectAgentStatus('p:1', { ...econ, status: 'dead', diedAt: 1717 }, 10).diedAt).toBe(1717);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/public.test.ts'
```
Expected: FAIL，提示 `Cannot find module './public'`。

- [ ] **Step 3: 实现 `public.ts`**

Create `convex/economy/public.ts`:
```ts
import { query } from '../_generated/server';
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
 * Always-on read-only query for the SP2 frontend: the default world's single
 * resident economy snapshot. Returns null until a world/agent/economy row exists.
 * Additive — does NOT touch any SP1 backend contract.
 */
export const getAgentStatus = query({
  args: {},
  handler: async (ctx): Promise<AgentStatusView | null> => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return null;
    const world = await ctx.db.get(status.worldId);
    if (!world) return null;
    const firstAgent = world.agents[0];
    if (!firstAgent) return null;
    const econ = await ctx.db
      .query('agentEconomy')
      .withIndex('worldId', (q) => q.eq('worldId', status.worldId).eq('agentId', firstAgent.id))
      .first();
    if (!econ) return null;
    return selectAgentStatus(firstAgent.playerId, econ, RECOVERY_WINDOW);
  },
});
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/public.test.ts && npx tsc -p convex --noEmit'
```
Expected: 2 passed；convex tsc 干净。

- [ ] **Step 5: Commit**

```bash
git add convex/economy/public.ts convex/economy/public.test.ts
git commit -m "feat(sp2): add always-on getAgentStatus Convex query

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 曲线数学纯函数（TDD — 最该严测，算错会真亏钱）

**Files:**
- Create: `src/web3/curveMath.ts`
- Test: `src/web3/curveMath.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/web3/curveMath.test.ts`:
```ts
import {
  VIRTUAL_RESERVE,
  effectiveReserve,
  estimateBuyTokensOut,
  estimateSellUsdcOut,
  applySlippage,
} from './curveMath';

describe('effectiveReserve', () => {
  test('uses virtual seed below threshold', () => {
    expect(effectiveReserve(0n)).toBe(VIRTUAL_RESERVE);
    expect(effectiveReserve(500_000n)).toBe(VIRTUAL_RESERVE);
  });
  test('uses real reserve at/above threshold', () => {
    expect(effectiveReserve(2_000_000n)).toBe(2_000_000n);
  });
});

describe('estimateBuyTokensOut (replica of AgentToken.buy)', () => {
  test('matches constant-product formula', () => {
    // R = 1_000_000 (virtual), T = 1_000_000e18, usdcIn = 1_000_000 (1 USDC)
    const R = 1_000_000n;
    const T = 1_000_000n * 10n ** 18n;
    const usdcIn = 1_000_000n;
    // newT = R*T/(R+usdcIn) = T/2 ; tokensOut = T/2
    expect(estimateBuyTokensOut(usdcIn, R, T)).toBe(T / 2n);
  });
  test('zero inputs -> 0', () => {
    expect(estimateBuyTokensOut(0n, 1_000_000n, 10n ** 18n)).toBe(0n);
    expect(estimateBuyTokensOut(1n, 1_000_000n, 0n)).toBe(0n);
  });
});

describe('estimateSellUsdcOut (replica of AgentToken.sell)', () => {
  test('caps at real reserve during bootstrap', () => {
    // bootstrap: usdcReserve = 0 -> out capped to 0
    const T = 1_000_000n * 10n ** 18n;
    expect(estimateSellUsdcOut(T / 2n, 0n, T / 2n)).toBe(0n);
  });
  test('returns curve value when reserve allows', () => {
    // R = usdcReserve = 2_000_000, T = 1e24, tokensIn = T -> out = R*T/(2T) = R/2 = 1_000_000
    const R = 2_000_000n;
    const T = 10n ** 24n;
    expect(estimateSellUsdcOut(T, R, T)).toBe(1_000_000n);
  });
});

describe('applySlippage', () => {
  test('1% tolerance reduces by 1%', () => {
    expect(applySlippage(1000n, 100)).toBe(990n);
  });
  test('clamps bps to [0,10000]', () => {
    expect(applySlippage(1000n, -5)).toBe(1000n);
    expect(applySlippage(1000n, 20000)).toBe(0n);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/curveMath.test.ts'
```
Expected: FAIL，`Cannot find module './curveMath'`。

- [ ] **Step 3: 实现 `curveMath.ts`**

Create `src/web3/curveMath.ts`:
```ts
// Pure bigint replicas of contracts/src/AgentToken.sol curve math. All amounts atomic.
// USDC 6dec, token 18dec. These compute client-side estimates + slippage floors.

export const VIRTUAL_RESERVE = 1_000_000n; // 1.0 USDC (6dec) virtual seed (pricing only)
export const ONE_E18 = 10n ** 18n;

export function effectiveReserve(usdcReserve: bigint): bigint {
  return usdcReserve < VIRTUAL_RESERVE ? VIRTUAL_RESERVE : usdcReserve;
}

/** tokensOut = T - (R*T)/(R+usdcIn). T (the contract's own unsold supply) is read live
 *  on-chain via balanceOf(tokenAddress) — see useAgentCoin — NOT reconstructed from the
 *  floored pricePerToken (which loses precision near bootstrap). */
export function estimateBuyTokensOut(usdcIn: bigint, usdcReserve: bigint, contractTokens: bigint): bigint {
  if (usdcIn <= 0n || contractTokens <= 0n) return 0n;
  const R = effectiveReserve(usdcReserve);
  const newT = (R * contractTokens) / (R + usdcIn);
  return contractTokens - newT;
}

/** usdcOut = min((R*tokensIn)/(T+tokensIn), usdcReserve). */
export function estimateSellUsdcOut(tokensIn: bigint, usdcReserve: bigint, contractTokens: bigint): bigint {
  if (tokensIn <= 0n) return 0n;
  const R = effectiveReserve(usdcReserve);
  let out = (R * tokensIn) / (contractTokens + tokensIn);
  if (out > usdcReserve) out = usdcReserve;
  return out;
}

/** minOut floor after slippage tolerance in basis points (100 = 1%). */
export function applySlippage(amountOut: bigint, toleranceBps: number): bigint {
  const clamped = Math.max(0, Math.min(10000, Math.round(toleranceBps)));
  return (amountOut * (10_000n - BigInt(clamped))) / 10_000n;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/curveMath.test.ts'
```
Expected: all passed。

- [ ] **Step 5: Commit**

```bash
git add src/web3/curveMath.ts src/web3/curveMath.test.ts
git commit -m "feat(sp2): bonding-curve math (buy/sell estimate + slippage), TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 小数格式化纯函数（TDD）

**Files:**
- Create: `src/web3/format.ts`
- Test: `src/web3/format.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/web3/format.test.ts`:
```ts
import { parseUsdc, parseToken, formatUsdc, formatToken } from './format';

describe('parse', () => {
  test('parseUsdc 6dec', () => {
    expect(parseUsdc('0.01')).toBe(10000n);
    expect(parseUsdc('1')).toBe(1_000_000n);
  });
  test('parseToken 18dec', () => {
    expect(parseToken('1')).toBe(10n ** 18n);
  });
  test('invalid input -> null', () => {
    expect(parseUsdc('abc')).toBeNull();
    expect(parseUsdc('')).toBeNull();
  });
});

describe('format', () => {
  test('formatUsdc trims + groups', () => {
    expect(formatUsdc(12_340_000n)).toBe('12.34');
    expect(formatUsdc(1_000_000n)).toBe('1');
    expect(formatUsdc(1_234_567_000n)).toBe('1,234.567');
  });
  test('formatToken groups thousands, 2 frac max', () => {
    expect(formatToken(1250n * 10n ** 18n)).toBe('1,250');
    expect(formatToken(10n ** 18n + 5n * 10n ** 17n)).toBe('1.5');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/format.test.ts'
```
Expected: FAIL，`Cannot find module './format'`。

- [ ] **Step 3: 实现 `format.ts`**

Create `src/web3/format.ts`:
```ts
// Self-contained atomic<->human decimal helpers (no viem import, so the Jest ESM
// transform never has to parse a node_modules ESM package for these pure tests).

export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

function safeParse(human: string, decimals: number): bigint | null {
  const s = human.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals); // pad/truncate
  try {
    return BigInt(intPart + frac);
  } catch {
    return null;
  }
}

export function parseUsdc(human: string): bigint | null {
  return safeParse(human, USDC_DECIMALS);
}
export function parseToken(human: string): bigint | null {
  return safeParse(human, TOKEN_DECIMALS);
}

function formatHuman(atomic: bigint, decimals: number, maxFractionDigits: number): string {
  const neg = atomic < 0n;
  const digits = (neg ? -atomic : atomic).toString().padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmedFrac = fracPart.slice(0, maxFractionDigits).replace(/0+$/, '');
  const body = trimmedFrac ? `${groupedInt}.${trimmedFrac}` : groupedInt;
  return neg ? `-${body}` : body;
}

export function formatUsdc(atomic: bigint, maxFractionDigits = 4): string {
  return formatHuman(atomic, USDC_DECIMALS, maxFractionDigits);
}
export function formatToken(atomic: bigint, maxFractionDigits = 2): string {
  return formatHuman(atomic, TOKEN_DECIMALS, maxFractionDigits);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/format.test.ts'
```
Expected: all passed。

- [ ] **Step 5: Commit**

```bash
git add src/web3/format.ts src/web3/format.test.ts
git commit -m "feat(sp2): USDC/token decimal parse+format helpers, TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 仪表盘映射纯函数 `economyToGauge`（TDD）

**Files:**
- Create: `src/web3/gauge.ts`
- Test: `src/web3/gauge.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/web3/gauge.test.ts`:
```ts
import { economyToGauge, ENERGY_FULL, STANDING_FULL_USDC } from './gauge';

const base = {
  status: 'alive' as const,
  energy: 50,
  starvingPeriods: 0,
  recoveryWindow: 10,
  marketCap: STANDING_FULL_USDC / 2n,
  alive: true,
};

describe('economyToGauge', () => {
  test('healthy: half energy/standing, no pulse, full countdown', () => {
    const v = economyToGauge(base);
    expect(v.state).toBe('healthy');
    expect(v.energyFrac).toBeCloseTo(50 / ENERGY_FULL);
    expect(v.standingFrac).toBeCloseTo(0.5);
    expect(v.pulsing).toBe(false);
    expect(v.countdownFrac).toBe(1);
  });

  test('starving: pulses, countdown shrinks with starvingPeriods', () => {
    const v = economyToGauge({ ...base, status: 'starving', energy: 0, starvingPeriods: 4 });
    expect(v.state).toBe('starving');
    expect(v.pulsing).toBe(true);
    expect(v.countdownFrac).toBeCloseTo((10 - 4) / 10);
    expect(v.energyFrac).toBe(0);
  });

  test('dead via status', () => {
    const v = economyToGauge({ ...base, status: 'dead' });
    expect(v.state).toBe('dead');
    expect(v.pulsing).toBe(false);
  });

  test('dead via on-chain alive=false even if status stale', () => {
    expect(economyToGauge({ ...base, alive: false }).state).toBe('dead');
  });

  test('clamps fractions to [0,1]', () => {
    const v = economyToGauge({ ...base, energy: 99999, marketCap: STANDING_FULL_USDC * 5n });
    expect(v.energyFrac).toBe(1);
    expect(v.standingFrac).toBe(1);
  });

  test('countdown never negative', () => {
    const v = economyToGauge({ ...base, status: 'starving', starvingPeriods: 99 });
    expect(v.countdownFrac).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/gauge.test.ts'
```
Expected: FAIL，`Cannot find module './gauge'`。

- [ ] **Step 3: 实现 `gauge.ts`**

Create `src/web3/gauge.ts`:
```ts
// Pure mapping: economy snapshot -> gauge view (display fractions + state flags).
// Display normalizations only; not on-chain semantics.

export const ENERGY_FULL = 100; // remaining "thinks" that fills the energy bar
export const STANDING_FULL_USDC = 100_000_000n; // 100 USDC (6dec) fills the standing bar

export type GaugeState = 'healthy' | 'starving' | 'dead';

export interface GaugeView {
  energyFrac: number; // 0..1
  standingFrac: number; // 0..1
  countdownFrac: number; // 0..1 (1 = full rescue window, 0 = out of time)
  state: GaugeState;
  pulsing: boolean;
}

export interface GaugeInput {
  status: 'alive' | 'starving' | 'dead';
  energy: number;
  starvingPeriods: number;
  recoveryWindow: number;
  marketCap: bigint; // atomic USDC (6dec) — Standing
  alive: boolean; // on-chain alive (Ponder); authoritative for death
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function economyToGauge(input: GaugeInput): GaugeView {
  const state: GaugeState =
    !input.alive || input.status === 'dead'
      ? 'dead'
      : input.status === 'starving'
        ? 'starving'
        : 'healthy';

  const standingFrac =
    STANDING_FULL_USDC > 0n
      ? clamp01(Number((input.marketCap * 10000n) / STANDING_FULL_USDC) / 10000)
      : 0;

  const countdownFrac =
    input.recoveryWindow > 0
      ? clamp01((input.recoveryWindow - input.starvingPeriods) / input.recoveryWindow)
      : 0;

  return {
    energyFrac: clamp01(input.energy / ENERGY_FULL),
    standingFrac,
    countdownFrac: state === 'dead' ? 0 : countdownFrac,
    state,
    pulsing: state === 'starving',
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/gauge.test.ts'
```
Expected: all passed。

- [ ] **Step 5: Commit**

```bash
git add src/web3/gauge.ts src/web3/gauge.test.ts
git commit -m "feat(sp2): economyToGauge pure mapping, TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 错误文案纯函数 `humanizeTradeError`（TDD）

**Files:**
- Create: `src/web3/tradeError.ts`
- Test: `src/web3/tradeError.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/web3/tradeError.test.ts`:
```ts
import { humanizeTradeError } from './tradeError';

describe('humanizeTradeError', () => {
  test('user rejected', () => {
    expect(humanizeTradeError({ shortMessage: 'User rejected the request.' })).toBe('你取消了交易');
  });
  test('slippage revert', () => {
    expect(humanizeTradeError({ message: 'execution reverted: slippage' })).toBe(
      '滑点过大，调高容忍度或减小金额',
    );
  });
  test('insufficient funds', () => {
    expect(humanizeTradeError({ message: 'transfer amount exceeds balance / insufficient' })).toBe(
      'USDC 余额不足',
    );
  });
  test('sold out / no real reserve', () => {
    expect(humanizeTradeError({ message: 'execution reverted: no real reserve' })).toBe(
      '当前无法卖出（曲线储备不足）',
    );
  });
  test('fallback', () => {
    expect(humanizeTradeError({})).toBe('交易失败，请重试');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/tradeError.test.ts'
```
Expected: FAIL，`Cannot find module './tradeError'`。

- [ ] **Step 3: 实现 `tradeError.ts`**

Create `src/web3/tradeError.ts`:
```ts
// Pure: map a wagmi/viem error-ish object to a clear, actionable Chinese message.
export function humanizeTradeError(e: { shortMessage?: string; message?: string } | unknown): string {
  const raw =
    (e as any)?.shortMessage ?? (e as any)?.message ?? (typeof e === 'string' ? e : '');
  const m = String(raw).toLowerCase();
  if (m.includes('user rejected') || m.includes('user denied')) return '你取消了交易';
  if (m.includes('slippage')) return '滑点过大，调高容忍度或减小金额';
  if (m.includes('no real reserve') || m.includes('sold out')) return '当前无法卖出（曲线储备不足）';
  if (m.includes('insufficient') || m.includes('exceeds balance')) return 'USDC 余额不足';
  if (m.includes('chain') && m.includes('match')) return '请切换到 Base Sepolia 网络';
  return '交易失败，请重试';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3/tradeError.test.ts'
```
Expected: all passed。

- [ ] **Step 5: Commit**

```bash
git add src/web3/tradeError.ts src/web3/tradeError.test.ts
git commit -m "feat(sp2): humanizeTradeError pure mapping, TDD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 前端常量 + ABI 片段

**Files:**
- Create: `src/web3/constants.ts`
- Create: `src/web3/abis.ts`

- [ ] **Step 1: 实现 `constants.ts`**

Create `src/web3/constants.ts`:
```ts
import { baseSepolia } from 'wagmi/chains';

export const CHAIN = baseSepolia;
export const CHAIN_ID = baseSepolia.id; // 84532

export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS ??
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`;

export const PONDER_URL = ((import.meta.env.VITE_PONDER_URL as string) ?? 'http://127.0.0.1:42069')
  .replace(/\/$/, '');

export const WALLETCONNECT_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ??
  'demo') as string;

// SP1 single resident.
export const DEFAULT_AGENT_ID = '0';

// Default slippage tolerance (basis points). 100 = 1%.
export const DEFAULT_SLIPPAGE_BPS = 100;
```

- [ ] **Step 2: 实现 `abis.ts`**

Create `src/web3/abis.ts`:
```ts
// Minimal ABI fragments for the human-side trades & balance reads.
export const usdcAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const agentTokenAbi = [
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'usdcIn', type: 'uint256' },
      { name: 'minTokensOut', type: 'uint256' },
    ],
    outputs: [{ name: 'tokensOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'sell',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokensIn', type: 'uint256' },
      { name: 'minUsdcOut', type: 'uint256' },
    ],
    outputs: [{ name: 'usdcOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
```

- [ ] **Step 3: 类型检查**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && npx tsc --noEmit -p tsconfig.json'
```
Expected: 无错误（注意 `vite-env.d.ts` 已声明 `import.meta.env`；若报 `VITE_*` 未知，继续 Task 7 Step 4）。

- [ ] **Step 4: 补充 env 类型（若需要）**

如 Step 3 报 `Property 'VITE_PONDER_URL' does not exist`，在 `src/vite-env.d.ts` 追加：
```ts
interface ImportMetaEnv {
  readonly VITE_PONDER_URL?: string;
  readonly VITE_USDC_ADDRESS?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```
再次跑 Step 3 确认干净。

- [ ] **Step 5: Commit**

```bash
git add src/web3/constants.ts src/web3/abis.ts src/vite-env.d.ts
git commit -m "feat(sp2): frontend web3 constants + USDC/AgentToken ABIs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: wagmi/RainbowKit 配置 + Provider + 接入 main.tsx

**Files:**
- Create: `src/web3/wagmi.ts`
- Create: `src/web3/Web3Provider.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: 实现 `wagmi.ts`**

Create `src/web3/wagmi.ts`:
```ts
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { CHAIN, WALLETCONNECT_PROJECT_ID } from './constants';

export const wagmiConfig = getDefaultConfig({
  appName: 'TrumanTown',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [CHAIN],
  ssr: false,
});
```

- [ ] **Step 2: 实现 `Web3Provider.tsx`**

Create `src/web3/Web3Provider.tsx`:
```tsx
import '@rainbow-me/rainbowkit/styles.css';
import { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './wagmi';

const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: '#22C55E', borderRadius: 'none' })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

- [ ] **Step 3: 接入 `main.tsx`**

Replace `src/main.tsx` 全文为：
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import Home from './App.tsx';
import './index.css';
import 'uplot/dist/uPlot.min.css';
import 'react-toastify/dist/ReactToastify.css';
import ConvexClientProvider from './components/ConvexClientProvider.tsx';
import { Web3Provider } from './web3/Web3Provider.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexClientProvider>
      <Web3Provider>
        <Home />
      </Web3Provider>
    </ConvexClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: 验证 app 起得来（手动）**

Run（前台跑 Vite，确认编译无错后 Ctrl-C）:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && nvm use 24 >/dev/null 2>&1; timeout 25 npm run dev:frontend'
```
Expected: Vite 打印 `Local: http://localhost:5173/`，无编译报错。（25s 后 timeout 自动退出即视为通过。）

- [ ] **Step 5: Commit**

```bash
git add src/web3/wagmi.ts src/web3/Web3Provider.tsx src/main.tsx
git commit -m "feat(sp2): wire wagmi+RainbowKit Web3Provider into app root

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `usePonderAgent` 轮询 hook（无 Provider 依赖）

**Files:**
- Create: `src/web3/usePonderAgent.ts`

- [ ] **Step 1: 实现 `usePonderAgent.ts`**

Create `src/web3/usePonderAgent.ts`:
```ts
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
```

- [ ] **Step 2: 类型检查**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && npx tsc --noEmit -p tsconfig.json'
```
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add src/web3/usePonderAgent.ts
git commit -m "feat(sp2): usePonderAgent polling hook (provider-free, Pixi-safe)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: `useAgentCoin` 聚合读 + `useTrade` 写交易

**Files:**
- Create: `src/web3/useAgentCoin.ts`
- Create: `src/web3/useTrade.ts`

- [ ] **Step 1: 实现 `useAgentCoin.ts`**

Create `src/web3/useAgentCoin.ts`:
```ts
import { useAccount, useReadContract } from 'wagmi';
import { usePonderAgent } from './usePonderAgent';
import { usdcAbi, agentTokenAbi } from './abis';
import { USDC_ADDRESS } from './constants';

/** Aggregates the read-side: Ponder standing (token addr, price, reserve, alive) + the
 *  connected wallet's USDC balance / allowance(token) / token balance. */
export function useAgentCoin(agentId: string) {
  const { address } = useAccount();
  const { data: standing, refetch: refetchStanding } = usePonderAgent(agentId);
  const token = standing?.token;

  const usdcBalance = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'allowance',
    args: address && token ? [address, token] : undefined,
    query: { enabled: !!address && !!token },
  });

  const tokenBalance = useReadContract({
    address: token,
    abi: agentTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!token },
  });

  // The contract's OWN unsold supply = the curve's T (AgentToken mints maxSupply to
  // itself; pricePerToken reads balanceOf(address(this))). Read it live for accurate
  // buy/sell estimates instead of reconstructing T from the floored pricePerToken.
  const curveSupply = useReadContract({
    address: token,
    abi: agentTokenAbi,
    functionName: 'balanceOf',
    args: token ? [token] : undefined,
    query: { enabled: !!token },
  });

  const refetchAll = async () => {
    await Promise.all([
      refetchStanding(),
      usdcBalance.refetch(),
      allowance.refetch(),
      tokenBalance.refetch(),
      curveSupply.refetch(),
    ]);
  };

  return {
    address,
    standing,
    token,
    usdcBalance: (usdcBalance.data as bigint | undefined) ?? 0n,
    allowance: (allowance.data as bigint | undefined) ?? 0n,
    tokenBalance: (tokenBalance.data as bigint | undefined) ?? 0n,
    curveSupply: (curveSupply.data as bigint | undefined) ?? 0n,
    refetchAll,
  };
}
```

- [ ] **Step 2: 实现 `useTrade.ts`**

Create `src/web3/useTrade.ts`:
```ts
import { useCallback, useState } from 'react';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { wagmiConfig } from './wagmi';
import { usdcAbi, agentTokenAbi } from './abis';
import { USDC_ADDRESS } from './constants';
import { humanizeTradeError } from './tradeError';

export type TradePhase = 'idle' | 'approving' | 'buying' | 'selling' | 'done' | 'error';

/** Drives the human-side trades. Buy is a two-step state machine (approve -> buy),
 *  auto-skipping approve when allowance already covers the spend. Sell is one step.
 *  `onSettled` runs after a confirmed receipt (caller refetches reads). */
export function useTrade(token: `0x${string}` | undefined, onSettled: () => void) {
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhase] = useState<TradePhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMsg(null);
  }, []);

  const buy = useCallback(
    async (usdcIn: bigint, minTokensOut: bigint, currentAllowance: bigint) => {
      if (!token) return;
      setErrorMsg(null);
      try {
        if (currentAllowance < usdcIn) {
          setPhase('approving');
          const approveHash = await writeContractAsync({
            address: USDC_ADDRESS,
            abi: usdcAbi,
            functionName: 'approve',
            args: [token, usdcIn],
          });
          await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
        }
        setPhase('buying');
        const buyHash = await writeContractAsync({
          address: token,
          abi: agentTokenAbi,
          functionName: 'buy',
          args: [usdcIn, minTokensOut],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: buyHash });
        setPhase('done');
        onSettled();
      } catch (e) {
        setPhase('error');
        setErrorMsg(humanizeTradeError(e));
      }
    },
    [token, writeContractAsync, onSettled],
  );

  const sell = useCallback(
    async (tokensIn: bigint, minUsdcOut: bigint) => {
      if (!token) return;
      setErrorMsg(null);
      try {
        setPhase('selling');
        const hash = await writeContractAsync({
          address: token,
          abi: agentTokenAbi,
          functionName: 'sell',
          args: [tokensIn, minUsdcOut],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
        setPhase('done');
        onSettled();
      } catch (e) {
        setPhase('error');
        setErrorMsg(humanizeTradeError(e));
      }
    },
    [token, writeContractAsync, onSettled],
  );

  return { phase, errorMsg, buy, sell, reset };
}
```

- [ ] **Step 3: 类型检查**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && npx tsc --noEmit -p tsconfig.json'
```
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/web3/useAgentCoin.ts src/web3/useTrade.ts
git commit -m "feat(sp2): useAgentCoin reads + useTrade approve->buy/sell state machine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: 买卖面板 `TradePanel` + 接入 PlayerDetails

**Files:**
- Create: `src/components/economy/TradePanel.tsx`
- Modify: `src/components/PlayerDetails.tsx`

- [ ] **Step 1: 实现 `TradePanel.tsx`**

Create `src/components/economy/TradePanel.tsx`:
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
  // Dead iff on-chain alive=false. NOTE: do NOT treat marketCap==='0' as dead — a freshly
  // spawned, never-bought resident has circulating=0 => marketCap=0 while alive, and that
  // is exactly the state in which the FIRST buy must be allowed. Sold-out sells are caught
  // by the contract revert ("no real reserve") + humanizeTradeError.
  const isDead = !!standing && !standing.alive;
  const wrongChain = isConnected && chainId !== CHAIN_ID;
  const busy = phase === 'approving' || phase === 'buying' || phase === 'selling';

  // Curve params: reserve from Ponder; T (contract's own unsold supply) read live on-chain.
  const reserve = standing ? BigInt(standing.usdcReserve) : 0n;
  const T = coin.curveSupply;

  // Estimate output for the typed amount.
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

  const tabBtn = (t: Tab, label: string, color: string) =>
    `flex-1 p-2 text-center cursor-pointer ${tab === t ? `${color} text-white` : 'bg-brown-700 text-brown-200'}`;

  return (
    <div className="box mt-6 p-4 bg-brown-800 text-brown-100">
      {/* 行情（等宽数字防跳动） */}
      <div className="font-body tabular-nums text-sm space-y-1">
        <div className="flex justify-between">
          <span>Standing</span>
          <span>{standing ? `${formatUsdc(BigInt(standing.marketCap))} USDC` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>Price</span>
          <span>{standing ? `${formatUsdc(BigInt(standing.pricePerToken))} /coin` : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span>你的持仓</span>
          <span>{formatToken(coin.tokenBalance)}</span>
        </div>
      </div>

      <div className="my-3">
        <ConnectButton chainStatus="icon" showBalance={false} />
      </div>

      {isDead && (
        <div role="alert" className="bg-sell/20 border border-sell text-sell p-2 text-center">
          🪦 该居民已死亡，无法买卖
        </div>
      )}

      {wrongChain && !isDead && (
        <button
          className="w-full p-2 bg-info text-white cursor-pointer"
          onClick={() => switchChain({ chainId: CHAIN_ID })}
        >
          切换到 Base Sepolia
        </button>
      )}

      {isConnected && !wrongChain && !isDead && (
        <>
          <div className="flex gap-1 mt-2">
            <button className={tabBtn('buy', 'Buy', 'bg-buy')} onClick={() => setTab('buy')}>
              Buy
            </button>
            <button className={tabBtn('sell', 'Sell', 'bg-sell')} onClick={() => setTab('sell')}>
              Sell
            </button>
          </div>

          <label className="block mt-3 text-sm">
            金额（{tab === 'buy' ? 'USDC' : 'coin'}）
            <div className="flex gap-1 mt-1">
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                className="flex-1 p-2 bg-brown-900 text-white tabular-nums"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <button className="px-3 bg-brown-700 text-white cursor-pointer" onClick={onMax}>
                Max
              </button>
            </div>
          </label>

          <label className="block mt-2 text-sm">
            滑点容忍
            <select
              className="ml-2 p-1 bg-brown-900 text-white"
              value={slippageBps}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
            >
              <option value={50}>0.5%</option>
              <option value={100}>1%</option>
              <option value={300}>3%</option>
              <option value={500}>5%</option>
            </select>
          </label>

          {estimate && (
            <p className="mt-2 text-sm tabular-nums text-brown-200">
              预估得 ≈{' '}
              {estimate.kind === 'buy'
                ? `${formatToken(estimate.out)} coin`
                : `${formatUsdc(estimate.out)} USDC`}{' '}
              （最少 {estimate.kind === 'buy' ? formatToken(estimate.minOut) : formatUsdc(estimate.minOut)}）
            </p>
          )}

          <button
            className={`w-full mt-3 p-2 text-white cursor-pointer disabled:opacity-50 ${
              tab === 'buy' ? 'bg-buy' : 'bg-sell'
            }`}
            disabled={busy || !estimate}
            onClick={onSubmit}
          >
            {actionLabel}
          </button>

          {errorMsg && (
            <div role="alert" className="mt-2 text-sell text-sm">
              {errorMsg}
            </div>
          )}
          {phase === 'done' && (
            <div role="status" className="mt-2 text-buy text-sm">
              ✓ 成交，Standing 已更新
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

> 备注：`tabular-nums` 是 Tailwind 内置 utility（`font-variant-numeric`），无需配置。`bg-sell/20` 透明度语法需 Tailwind 3（项目为 3.3.3，支持）。

- [ ] **Step 2: 接入 `PlayerDetails.tsx`**

在 `src/components/PlayerDetails.tsx` 顶部 import 区（第 11 行 `ServerGame` import 之后）加：
```tsx
import { TradePanel } from './economy/TradePanel';
```

在 `PlayerDetails` 的返回 JSX 中，把描述块（第 224–235 行的 `<div className="desc my-6">…</div>`）之后、`Messages` 渲染之前，插入买卖面板（仅对非「自己」的居民显示）：
```tsx
      {!isMe && <TradePanel />}
```
即放在：
```tsx
      </div>   {/* end of .desc */}
      {!isMe && <TradePanel />}
      {!isMe && playerConversation && playerStatus?.kind === 'participating' && (
```

> SP1 单居民：`TradePanel` 默认 `agentId="0"`，对任意选中的非自己居民都展示曲线 0 的买卖（演示足够）。多居民时再按 player→agentId 映射传参（SP4）。

- [ ] **Step 3: 验证编译（手动起 Vite）**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && nvm use 24 >/dev/null 2>&1; timeout 25 npm run dev:frontend'
```
Expected: 无编译报错，Vite 正常起。

- [ ] **Step 4: Commit**

```bash
git add src/components/economy/TradePanel.tsx src/components/PlayerDetails.tsx
git commit -m "feat(sp2): buy/sell TradePanel in PlayerDetails (connect, estimate, two-step)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: PixiJS 仪表盘 `AgentGauge` + 接入 PixiGame/Player

**Files:**
- Create: `src/components/economy/AgentGauge.tsx`
- Modify: `src/components/PixiGame.tsx`
- Modify: `src/components/Player.tsx`

- [ ] **Step 1: 实现 `AgentGauge.tsx`（纯展示 Pixi）**

Create `src/components/economy/AgentGauge.tsx`:
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

const BAR_W = 40;
const BAR_H = 4;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/** Presentational gauge drawn above a sprite. All data is precomputed (GaugeView);
 *  no data hooks here so it is safe inside the Pixi Stage sub-renderer. */
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
      // backdrop
      g.beginFill(0x000000, 0.5);
      g.drawRect(-BAR_W / 2 - 1, -1, BAR_W + 2, BAR_H * 2 + 4);
      g.endFill();
      // energy (top)
      g.beginFill(energyColor);
      g.drawRect(-BAR_W / 2, 0, BAR_W * clamp01(view.energyFrac), BAR_H);
      g.endFill();
      // standing (bottom, gold)
      g.beginFill(0xeab308);
      g.drawRect(-BAR_W / 2, BAR_H + 2, BAR_W * clamp01(view.standingFrac), BAR_H);
      g.endFill();
    },
    [energyColor, view.energyFrac, view.standingFrac],
  );

  const drawCountdown = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (view.state !== 'starving') return;
      const r = 26;
      const frac = clamp01(view.countdownFrac);
      g.lineStyle(2, 0xdc2626, 0.9);
      g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    },
    [view.state, view.countdownFrac],
  );

  const drawTomb = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (view.state !== 'dead') return;
      g.beginFill(0x9ca3af);
      g.drawRoundedRect(-6, -14, 12, 16, 6); // headstone
      g.drawRect(-8, 2, 16, 3); // base
      g.endFill();
    },
    [view.state],
  );

  return (
    <Container ref={containerRef} x={x} y={y - 34}>
      <Graphics draw={drawCountdown} y={20} />
      <Graphics draw={drawBars} />
      <Graphics draw={drawTomb} y={-2} />
    </Container>
  );
}
```

- [ ] **Step 2: 在 `PixiGame.tsx` 取数据并下传**

在 `src/components/PixiGame.tsx` import 区追加：
```tsx
import { usePonderAgent } from '../web3/usePonderAgent';
import { economyToGauge, GaugeView } from '../web3/gauge';
import { DEFAULT_AGENT_ID } from '../web3/constants';
```

在组件体内（`const players = [...]` 之后，第 83 行附近）加：
```tsx
  // SP2: economy gauge data. Convex query works here (ConvexProvider is re-propagated
  // inside <Stage> by Game.tsx). Ponder via provider-free polling hook.
  const agentStatus = useQuery(api.economy.public.getAgentStatus);
  const { data: standing } = usePonderAgent(DEFAULT_AGENT_ID);
  const gaugeView: GaugeView | undefined =
    agentStatus && standing
      ? economyToGauge({
          status: agentStatus.status,
          energy: agentStatus.energy,
          starvingPeriods: agentStatus.starvingPeriods,
          recoveryWindow: agentStatus.recoveryWindow,
          marketCap: BigInt(standing.marketCap),
          alive: standing.alive,
        })
      : undefined;
```

把 players 渲染（第 118–127 行）的 `<Player ... />` 改为传入仪表盘：
```tsx
      {players.map((p) => (
        <Player
          key={`player-${p.id}`}
          game={props.game}
          player={p}
          isViewer={p.id === humanPlayerId}
          onClick={props.setSelectedElement}
          historicalTime={props.historicalTime}
          gauge={p.id === agentStatus?.playerId ? gaugeView : undefined}
        />
      ))}
```

> 备注：`api.economy.public.getAgentStatus` 在 `convex dev` 重新生成 `_generated/api` 后可用；若 IDE 暂时报红，跑一次 `npm run dev:backend` 或 `npx convex codegen`。

- [ ] **Step 3: 在 `Player.tsx` 接收并渲染 `AgentGauge`**

在 `src/components/Player.tsx` import 区追加：
```tsx
import { AgentGauge } from './economy/AgentGauge.tsx';
import type { GaugeView } from '../web3/gauge.ts';
```

把组件 props 类型（第 18–31 行）加一个可选 `gauge`：
```tsx
export const Player = ({
  game,
  isViewer,
  player,
  onClick,
  historicalTime,
  gauge,
}: {
  game: ServerGame;
  isViewer: boolean;
  player: ServerPlayer;
  onClick: SelectElement;
  historicalTime?: number;
  gauge?: GaugeView;
}) => {
```

把返回的 `<>…</>` 片段（第 67–90 行）改为在 `<Character/>` 之后渲染仪表盘：
```tsx
  return (
    <>
      <Character
        x={historicalLocation.x * tileDim + tileDim / 2}
        y={historicalLocation.y * tileDim + tileDim / 2}
        orientation={orientationDegrees(historicalFacing)}
        isMoving={historicalLocation.speed > 0}
        isThinking={isThinking}
        isSpeaking={isSpeaking}
        emoji={
          player.activity && player.activity.until > (historicalTime ?? Date.now())
            ? player.activity?.emoji
            : undefined
        }
        isViewer={isViewer}
        textureUrl={character.textureUrl}
        spritesheetData={character.spritesheetData}
        speed={character.speed}
        onClick={() => {
          onClick({ kind: 'player', id: player.id });
        }}
      />
      {gauge && (
        <AgentGauge
          x={historicalLocation.x * tileDim + tileDim / 2}
          y={historicalLocation.y * tileDim + tileDim / 2}
          view={gauge}
        />
      )}
    </>
  );
```

- [ ] **Step 4: 验证编译（手动起 Vite）**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && nvm use 24 >/dev/null 2>&1; timeout 25 npm run dev:frontend'
```
Expected: 无编译报错。（若 `api.economy.public` 报红，先跑 `npx convex codegen` 再重试。）

- [ ] **Step 5: Commit**

```bash
git add src/components/economy/AgentGauge.tsx src/components/PixiGame.tsx src/components/Player.tsx
git commit -m "feat(sp2): PixiJS Energy/Standing gauges + rescue countdown + death state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: 全量纯函数回归 + 验收清单 + 文档

**Files:**
- Create: `docs/SP2-acceptance-checklist.md`
- Modify: `README.md`

- [ ] **Step 1: 跑全部 SP2 纯函数测试 + 类型检查**

Run:
```bash
wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest src/web3 convex/economy/public.test.ts && npx tsc --noEmit -p tsconfig.json && npx tsc -p convex --noEmit'
```
Expected: curveMath / format / gauge / tradeError / public 全绿；两类 tsc 干净。

- [ ] **Step 2: 写验收清单**

Create `docs/SP2-acceptance-checklist.md`:
```markdown
# 楚门镇 TrumanTown · SP2 手动验收清单

> 论点：**你（人类）的钱就是它的命。** 观众用自己钱包买居民的币 → Standing 涨 → 它能续命；
> 无人接盘 + 饥饿 → 抢救倒计时归零 → 链上判死，前端同步收尾。
> 前置：SP1 全栈已起（合约已部署、居民 0 已发币、Ponder 回填到最新块、Convex `TRUMANTOWN_ECONOMY=1`）。

## A. 静态（无需真链）
- [ ] `NODE_OPTIONS=--experimental-vm-modules npx jest src/web3 convex/economy/public.test.ts` → 全绿
- [ ] `npx tsc --noEmit -p tsconfig.json` 与 `npx tsc -p convex --noEmit` 干净
- [ ] `npm run dev:frontend` 起得来，无编译错误

## B. 连接钱包（Base Sepolia）
- [ ] 前端 `.env.local` 已设 `VITE_PONDER_URL` / `VITE_USDC_ADDRESS`（必要时 `VITE_WALLETCONNECT_PROJECT_ID`）
- [ ] 点居民 → 右侧出现买卖面板；点 Connect Wallet → MetaMask 连上
- [ ] 钱包若在别的网络 → 面板显示「切换到 Base Sepolia」并能一键切换

## C① 买 → Standing 上涨（核心证据）
- [ ] EOA 钱包有 Base Sepolia USDC（CDP faucet 或转入）
- [ ] Buy tab 输入金额（如 0.5 USDC）→ 看到「预估得 ≈ … coin / 最少 …」
- [ ] 点按钮：首购走 `① 授权 → ② 购买` 两步（MetaMask 弹两次）；再次买只弹一次
- [ ] 成交后几秒内：面板 Standing 上升、头顶 **Standing 金条变长**
- [ ] basescan 核对：USDC `approve` + AgentToken `Bought` 事件

## C② 卖 → 变现 USDC
- [ ] Sell tab，[Max] 填入持仓 → 预估 USDC out
- [ ] 成交后：持仓减少、钱包 USDC 增加；basescan 见 `Sold` 事件

## D. 生命仪表盘 + 死亡收尾
- [ ] 居民活着：头顶 Energy（绿）+ Standing（金）双条随数据变化（Energy 满格 = 100 次思考 = SP1 默认 costPerThink 下约 1 USDC；为让 Energy 条肉眼可动，给 EOA 充 ~1 USDC 量级即可，别充太多否则长期顶格）
- [ ] 让 EOA 破产（别充）→ 居民进入饥饿：Energy 条变红、整组**脉搏跳动**、出现**环形抢救倒计时**并随 starvingPeriods 收缩
- [ ] 开 `prefers-reduced-motion`（系统设置）→ 只变色、不脉动（可访问性）
- [ ] 连续 T 周期无人施救 → 链上判死：头顶变灰 + **墓碑**、双条归零；面板显示「🪦 已死亡，无法买卖」并禁用
- [ ] basescan / Ponder 核对：`AgentDied`、`alive=false`、`marketCap=0`

## 收官
- [ ] C① 肉眼看到「我一买它的 Standing 就涨」 → 「你的钱 = 它的命」成立
- [ ] D 看到死亡在前端完整收尾 → SP1 死亡论点在 UI 闭环
```

- [ ] **Step 3: README 加 SP2 前端环境说明**

在 `README.md` 末尾追加一节：
```markdown
## SP2 frontend (human trading + life gauges)

Copy `.env.local.example` → `.env.local` and set:
- `VITE_PONDER_URL` — Ponder read API (default `http://127.0.0.1:42069`)
- `VITE_USDC_ADDRESS` — Base Sepolia USDC (default Circle testnet)
- `VITE_WALLETCONNECT_PROJECT_ID` — `demo` works for injected MetaMask; get a free id at cloud.walletconnect.com for WalletConnect

Run the app (WSL, Node 24): `npm run dev`. Click a resident → the buy/sell panel appears
on the right; gauges (Energy/Standing + rescue countdown) render above sprites.
Manual acceptance: `docs/SP2-acceptance-checklist.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/SP2-acceptance-checklist.md README.md
git commit -m "docs(sp2): acceptance checklist + frontend env README

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完成判据（对应设计稿 §6）

- **A（纯函数）全绿**：curveMath / format / gauge / tradeError / selectAgentStatus 单测通过；两类 tsc 干净。
- **C①**：人类钱包买币后，几秒内面板 Standing + 头顶金条上涨；basescan 见 `approve`+`Bought`。
- **C②**：卖币变现 USDC，basescan 见 `Sold`。
- **D**：饥饿脉搏 + 抢救倒计时 + 死亡变灰/墓碑 + 面板禁买；reduced-motion 下只变色。链上 `AgentDied`/`alive=false`/`marketCap=0` 对得上。
- **不变量**：未改 SP1 任何后端契约（合约/网关/执行器/facilitator/Ponder schema）；唯一后端新增是只读 `getAgentStatus`。
