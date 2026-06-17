# 楚门镇 SP1 · 计划 4/5：Convex 经济模块 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 ai-town Convex 后端里做**外科手术式包裹**，让唯一的居民（SP1，economic agentId=`"0"`）每次「思考」都经 x402 网关付真实 USDC：`convex/util/llm.ts` 的 chat 出口指向网关并加 `X-Agent-Id`，收到 `402` 时调执行器 `/sign-payment` 拿 `X-PAYMENT` 重试；付不起时按生存目标栈做**反应式求生编排**（卖自有币 → 把 USDC 扫到 EOA → 重试），实在换不到钱才判饥饿；用一个**新的 Convex 经济 tick（cron）**周期性从执行器 `/balances` 感知（energy/Standing）、推进生存状态机、缓存感知快照；把生存目标栈（①活下去 ②变强 ③人设）注入既有对话 prompt；居民判死后由**经济接缝短路**（拒签拒付 → 思考自然停摆）并在状态表落账，供计划 5 的 keeper `markDead`。引擎其余（tick/记忆/移动/对话流程）不动。

**Architecture:** 新增一个**隔离的纯逻辑模块 `convex/economy/`**：把可单测的逻辑（执行器 HTTP 客户端、生存数学、目标栈 prompt、`402→签名→重试`+反应式求生编排）写成**零 Convex 依赖的纯函数**，用 Jest（ts-jest ESM，与 `convex/**/*.test.ts` 同源）TDD；把 Convex 胶水（schema 表、感知 query/mutation、经济 cron action、对话 prompt 注入、llm 接缝）写成薄包装，靠 `tsc` typecheck + 手动 `convex dev` 验证（与计划 2/3 把 bootstrap/cloud 胶水留作 typecheck-only 同源）。整条链路默认由 env `TRUMANTOWN_ECONOMY=1` 开关门控——关闭时 `chatCompletion` 行为与上游 ai-town 完全一致（CI/无服务时不破坏既有测试）。

**Tech Stack:** TypeScript（Node 18，WSL）· Convex（既有后端：`internalAction`/`internalMutation`/`internalQuery`/`cronJobs`）· 全局 `fetch`（Convex 运行时内置）· Jest 29 + ts-jest `default-esm`（TDD，`NODE_OPTIONS=--experimental-vm-modules`）· 复用计划 1 链上 ABI、计划 2 网关契约 A、计划 3 执行器契约 B′。

---

## ⛔ 运行环境（贯穿全计划，务必遵守）

- 本计划所有 Node/npm/Jest/convex 进程**只在 WSL Ubuntu 内运行**。Bash 工具是 Windows Git Bash(MINGW)，**不是** Linux；内联 `wsl bash -lc '...npm...'` 不可靠。
- **可靠配方（项目记忆 `wsl-node-toolchain.md`）**：把命令写进 `scripts/_cmd.sh`（untracked 草稿，**勿 git add**），前两行固定：
  ```
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null
  cd "/mnt/d/AI Agent/ai-town-web3"
  ```
  再用 Bash 工具执行：
  `wsl.exe -d Ubuntu bash -lc 'sed -i "s/\r//" "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh"; bash "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh"'`
  本计划下文每个 **Run** 块给出的是**逻辑命令**（如 `npx jest convex/economy/survival.test.ts`），执行时按上述配方包一层。注意 Convex 根工程的测试是 **Jest**（不是计划 2/3 的 Vitest），单文件跑法见下。
- **单测运行（Jest，ESM）**：`NODE_OPTIONS=--experimental-vm-modules npx jest <路径> --verbose`。全量：`npm test`。typecheck：`npx tsc -p convex --noEmit`（见 `convex/tsconfig.json`）。
- **文件一律用 Write/Edit 写**（Windows 路径 `d:\AI Agent\ai-town-web3\...`），不要用 shell heredoc/echo 造文件。
- **git 用 Windows 原生**（Bash 工具：`cd "d:/AI Agent/ai-town-web3" && git ...`），勿走 WSL。
- 在分支 `feat/sp1-convex` 上工作，**不要直接写 main**。执行用 subagent-driven-development，每个任务两阶段审查（spec 合规 → 代码质量）。

---

## 设计说明（对设计稿/锁定决策的诚实细化）

设计稿 §3.1/§5 写「经济模块 = 感知 + 生存目标栈 + 执行器适配；`llm.ts` 出口改指网关 + 处理 402；引擎其余不动」。落到可 TDD 的实现时，据 brainstorm 已确认的两项决策细化：

1. **行动自主度 = 反应式求生 + prompt 注入（不新增自主 LLM 行动决策循环）。** 基础 ai-town 没有任何「LLM 选行动」的调用可挂载（只有对话/活动/游荡）。SP1 据此把经济行动限定为：(a) `402`/`insufficient_funds` 时的**机械**求生编排（卖币 → 扫款 → 重试），(b) 把感知 + 生存目标栈**注入既有对话 prompt**。`/actions/buy`（变强/回购）客户端**接好但不接自主触发器**——SP1 先证明锁定论点「付费才能思考 + 自有币是变现生命线 + 死亡」，自主 buyback 留作后续/计划 5。这与计划 1「clean-room 最小曲线」、计划 2「自写定价胶水但不套 turnkey 中间件」的 YAGNI 取舍同源。

2. **死亡 = 经济接缝短路 + 状态表记录（零引擎/操作改动）。** 判死后经济接缝直接拒签拒付，`chatCompletion` 在接缝处**快速失败**（`StarvationError`）——居民因「付不起=想不了」自然停止产出思考；死亡写入新 `agentEconomy` 状态表并暴露给计划 5 的 keeper（链上 `markDead` + `AgentDied` 属计划 5）。不碰引擎 `tick`/`movement`/`memory`，也不在 `agentOperations` 加守卫。

**可单测边界：** 纯逻辑（`executorClient`/`survival`/`goalStack`/`payment`）零 Convex 依赖、用 Jest TDD；Convex 胶水（`schema`/`perception`/`tick` action/`conversation` 注入/`llm` 接缝）靠 `tsc` typecheck + 手动 `convex dev` 验证。**门控开关 `TRUMANTOWN_ECONOMY`** 默认关，关闭时 `chatCompletion` 与上游一致，既有 `convex/**/*.test.ts` 不受影响。

---

## 锚定接口（复用，勿改签名）

### 复用计划 2 网关契约 A（`llm.ts` 接缝消费）
- 计费端点 `POST {GATEWAY}/v1/chat/completions`，头 `X-Agent-Id: <agentId>`（SP1=`"0"`）。首次 `402` + body `{ x402Version, error, accepts:[PaymentRequirements] }`；带 `X-PAYMENT` 重试 → `200` + 补全。`/api/*`（含 `/api/embeddings`、`/api/pull`）、`/v1/embeddings` 免费透传——embeddings 出口不变（仍走 `OLLAMA_HOST`，现在即网关 `:8402`）。

### 复用计划 3 执行器契约 B′（本计划调用）
- `POST {EXECUTOR}/sign-payment {agentId, paymentRequirements}` → `200 {xPayment}` | `402 {error:"insufficient_funds"}` | `404`/`400`。
- `POST {EXECUTOR}/actions/sell {agentId, tokensIn, minUsdcOut?, token?}` → `200 {txHash}` | `403`/`404`/`400`。
- `POST {EXECUTOR}/actions/transfer {agentId, source:"smart"|"eoa", to, amount}` → `200 {txHash}` | `403`/`404`/`400`。
- `POST {EXECUTOR}/actions/buy {agentId, usdcIn, minTokensOut?, token?}` → `200 {txHash}`（客户端接好、SP1 不自动触发）。
- `POST {EXECUTOR}/actions/fund {agentId, target:"eoa"|"smart", asset:"usdc"|"eth"}` → `200 {txHash}`。
- `GET  {EXECUTOR}/balances/:agentId` → `200 {agentId, eoaUsdc, smartUsdc, tokenBalance, marketCap}`（原子单位十进制字符串）。
- 金额一律原子单位十进制字符串（USDC 6dec、token 18dec），用 `BigInt()` 解析。

### 复用计划 1 链上事实（经 Plan 5 解析器替换前，SP1 用 Convex 常量镜像）
- `costPerThink` SP1 默认 `'10000'`（0.01 USDC，与网关/Registry 同源）；`floor`、`recoveryWindow(T)` 见设计稿 §8（T=10）。计划 5 改读 `AgentRegistry.agents(id)`。

---

## 文件结构（本计划创建/修改）

```
convex/economy/                        ← 新模块（隔离、外科手术）
  constants.ts          — 经济参数 + 服务 URL + DEFAULT_ECON_AGENT_ID（纯）
  types.ts              — PaymentRequirements / AgentBalances / SignPaymentResult 镜像类型（纯）
  executorClient.ts     — 执行器 HTTP 客户端（sign-payment/actions/balances）（纯，Jest）
  executorClient.test.ts
  survival.ts           — 生存数学：energy / isDying / advanceSurvival 状态机（纯，Jest）
  survival.test.ts
  goalStack.ts          — 生存目标栈 prompt 行（纯，Jest）
  goalStack.test.ts
  payment.ts            — 402→签名→重试 + 反应式求生编排 + 接缝短路（纯，Jest）
  payment.test.ts
  schema.ts             — economyTables（agentEconomy 表）（Convex 胶水）
  perception.ts         — getDefaultWorldAgent / getAgentEconomy / upsertAgentEconomy（Convex 胶水）
  tick.ts               — runEconomicTick（Convex internalAction：感知→状态机→落账）（Convex 胶水）
  README.md             — 运行/接线/计划5 待办

convex/util/llm.ts       — 修改：chatCompletion 加 opts（X-Agent-Id + 经济接缝门控）
convex/agent/conversation.ts — 修改：queryPromptData 读 economy；3 个 prompt 构造器注入目标栈 + 透传 opts
convex/schema.ts         — 修改：...economyTables
convex/crons.ts          — 修改：注册 'economic tick'

docs/superpowers/plans/2026-06-03-trumantown-sp1-04-convex.md  — 本文件
```

> 不改：`convex/aiTown/agent.ts`（引擎 tick）、`movement.ts`、`memory.ts` 的流程；`convex/aiTown/agentOperations.ts`。

---

## Task 0：经济模块脚手架（常量 + 镜像类型 + schema 表 + 接线）

**Files:**
- Create: `convex/economy/constants.ts`, `convex/economy/types.ts`, `convex/economy/schema.ts`
- Modify: `convex/schema.ts`

- [ ] **Step 1: 确认分支与 WSL Node 18**

Run:
```bash
git rev-parse --abbrev-ref HEAD   # 期望 feat/sp1-convex（下一步创建）
nvm use 18 || nvm install 18; node -v
```
Expected: `node -v` 打印 `v18.x.x`。

- [ ] **Step 2: 开分支**

```bash
git checkout -b feat/sp1-convex
```

- [ ] **Step 3: 写经济常量**

Create `convex/economy/constants.ts`:
```ts
// SP1 economic parameters. Values mirror the locked design (§8) and Plans 1/2.
// Plan 5 replaces COST_PER_THINK / STANDING_FLOOR / RECOVERY_WINDOW with on-chain
// reads from AgentRegistry.agents(id); the seam (Convex constants) is intentional.

export const COST_PER_THINK = '10000'; // 0.01 USDC (6dec) — same as gateway/Registry SP1 default
export const STANDING_FLOOR = '0'; // atomic USDC; SP1 default off (energy is the primary death driver). Plan 5: AgentRegistry.floor (=5% of launch cap)
export const RECOVERY_WINDOW = 10; // T: starving periods before death (design §8)
export const ECONOMIC_TICK_SECONDS = 30; // perception cadence (design: 1 think / 30–60s)
export const DEFAULT_ECON_AGENT_ID = '0'; // SP1 single resident

export function executorUrl(): string {
  return process.env.EXECUTOR_URL ?? 'http://127.0.0.1:8404';
}
export function gatewayUrl(): string {
  // chat egress already points at the gateway via OLLAMA_HOST (=:8402).
  return process.env.OLLAMA_HOST ?? 'http://127.0.0.1:8402';
}
export function economyEnabled(): boolean {
  return process.env.TRUMANTOWN_ECONOMY === '1';
}
export function defaultAgentId(): string {
  return process.env.DEFAULT_AGENT_ID ?? DEFAULT_ECON_AGENT_ID;
}
export function agentEoa(): string | undefined {
  return process.env.AGENT_0_EOA;
}
```

- [ ] **Step 4: 写镜像类型**

Create `convex/economy/types.ts`:
```ts
// Local mirror of the wire shapes the economy module passes through. The executor
// (Plan 3) and gateway (Plan 2) own the canonical types; we only forward them.

export interface PaymentRequirements {
  scheme: string; // "exact"
  network: string; // CAIP-2, e.g. "eip155:84532"
  maxAmountRequired: string; // atomic USDC (6dec) decimal string
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface AgentBalances {
  agentId: string;
  eoaUsdc: string; // atomic USDC (6dec) — `energy` source
  smartUsdc: string; // atomic USDC (6dec)
  tokenBalance: string; // atomic token (18dec) held by the smart account
  marketCap: string; // atomic USDC (6dec) — `Standing`
}

export type SignPaymentResult =
  | { ok: true; xPayment: string }
  | { ok: false; reason: string }; // "insufficient_funds" | other
```

- [ ] **Step 5: 写 economy schema 表**

Create `convex/economy/schema.ts`:
```ts
import { v } from 'convex/values';
import { defineTable } from 'convex/server';
import { agentId } from '../aiTown/ids';

// One row per (world, ai-town agent). Holds the cached perception snapshot (written
// by the economic tick) and the survival state machine. `econAgentId` maps the
// ai-town agent to the executor/registry id ("0" in SP1). `eoa` is the sweep target.
export const economyTables = {
  agentEconomy: defineTable({
    worldId: v.id('worlds'),
    agentId, // ai-town GameId<'agents'> (string)
    econAgentId: v.string(), // executor/registry id, SP1 "0"
    eoa: v.string(), // agent EOA address (smart->eoa sweep target)

    // perception snapshot (atomic decimal strings)
    eoaUsdc: v.string(),
    smartUsdc: v.string(),
    tokenBalance: v.string(),
    marketCap: v.string(),
    energy: v.number(), // floor(eoaUsdc / costPerThink)
    lastPerceivedAt: v.number(),

    // survival state machine
    status: v.union(v.literal('alive'), v.literal('starving'), v.literal('dead')),
    starvingPeriods: v.number(),
    starvingSince: v.optional(v.number()),
    diedAt: v.optional(v.number()),
  })
    .index('worldId', ['worldId', 'agentId'])
    .index('econAgentId', ['worldId', 'econAgentId']),
};
```

- [ ] **Step 6: 接线进根 schema**

In `convex/schema.ts`, add the import and spread. Change:
```ts
import { engineTables } from './engine/schema';
```
to add below it:
```ts
import { engineTables } from './engine/schema';
import { economyTables } from './economy/schema';
```
And change:
```ts
  ...agentTables,
  ...aiTownTables,
  ...engineTables,
});
```
to:
```ts
  ...agentTables,
  ...aiTownTables,
  ...engineTables,
  ...economyTables,
});
```

- [ ] **Step 7: typecheck 通过**

Run:
```bash
npx tsc -p convex --noEmit
```
Expected: 无报错（新表/常量/类型编译干净）。

- [ ] **Step 8: 既有 Jest 套件仍全绿（门控未触发任何行为）**

Run:
```bash
npm test
```
Expected: 既有测试全部通过（本步只加了未被引用的文件 + schema 表 + 一处 schema 接线）。

- [ ] **Step 9: Commit**

```bash
git add convex/economy/constants.ts convex/economy/types.ts convex/economy/schema.ts convex/schema.ts
git commit -m "feat(economy): scaffold convex economy module (constants, types, agentEconomy table)"
```

---

## Task 1：执行器 HTTP 客户端（sign-payment / actions / balances）

**Files:**
- Create: `convex/economy/executorClient.ts`
- Test: `convex/economy/executorClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/economy/executorClient.test.ts`:
```ts
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createExecutorClient } from './executorClient';
import { PaymentRequirements } from './types';

let server: Server;
let baseUrl: string;
let last: { url: string; body: any } | null = null;
// Per-path canned responses set by each test.
let routes: Record<string, { status: number; body: any }>;

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:84532',
  maxAmountRequired: '10000',
  resource: 'http://gw/v1/chat/completions',
  description: 'think',
  mimeType: 'application/json',
  payTo: '0xbeef',
  maxTimeoutSeconds: 120,
  asset: '0xusdc',
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      last = { url: req.url!, body: raw ? JSON.parse(raw) : null };
      const key = `${req.method} ${req.url}`;
      const route = routes[key] ?? { status: 404, body: { error: 'no route' } };
      res.statusCode = route.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(route.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  last = null;
  routes = {};
});

describe('createExecutorClient', () => {
  test('signPayment returns xPayment on 200 and posts the right envelope', async () => {
    routes['POST /sign-payment'] = { status: 200, body: { xPayment: 'base64xp' } };
    const ex = createExecutorClient(baseUrl);
    const res = await ex.signPayment('0', requirements);
    expect(res).toEqual({ ok: true, xPayment: 'base64xp' });
    expect(last).toEqual({ url: '/sign-payment', body: { agentId: '0', paymentRequirements: requirements } });
  });

  test('signPayment maps 402 to insufficient result (no throw)', async () => {
    routes['POST /sign-payment'] = { status: 402, body: { error: 'insufficient_funds' } };
    const ex = createExecutorClient(baseUrl);
    const res = await ex.signPayment('0', requirements);
    expect(res).toEqual({ ok: false, reason: 'insufficient_funds' });
  });

  test('balances parses the aggregate', async () => {
    routes['GET /balances/0'] = {
      status: 200,
      body: { agentId: '0', eoaUsdc: '5', smartUsdc: '7', tokenBalance: '9', marketCap: '11' },
    };
    const ex = createExecutorClient(baseUrl);
    const b = await ex.balances('0');
    expect(b.eoaUsdc).toBe('5');
    expect(b.marketCap).toBe('11');
  });

  test('sell posts atomic strings and returns txHash', async () => {
    routes['POST /actions/sell'] = { status: 200, body: { txHash: '0xsell' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.sell('0', '9', '0');
    expect(tx).toBe('0xsell');
    expect(last!.body).toEqual({ agentId: '0', tokensIn: '9', minUsdcOut: '0' });
  });

  test('transfer posts source/to/amount and returns txHash', async () => {
    routes['POST /actions/transfer'] = { status: 200, body: { txHash: '0xxfer' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.transfer('0', 'smart', '0xEOA', '7');
    expect(tx).toBe('0xxfer');
    expect(last!.body).toEqual({ agentId: '0', source: 'smart', to: '0xEOA', amount: '7' });
  });

  test('buy posts usdcIn/minTokensOut and returns txHash', async () => {
    routes['POST /actions/buy'] = { status: 200, body: { txHash: '0xbuy' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.buy('0', '1000000', '0');
    expect(tx).toBe('0xbuy');
    expect(last!.body).toEqual({ agentId: '0', usdcIn: '1000000', minTokensOut: '0' });
  });

  test('non-2xx action throws with status', async () => {
    routes['POST /actions/sell'] = { status: 403, body: { error: 'guardrail' } };
    const ex = createExecutorClient(baseUrl);
    await expect(ex.sell('0', '9', '0')).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/executorClient.test.ts --verbose
```
Expected: FAIL —— `Cannot find module './executorClient'`。

- [ ] **Step 3: Write minimal implementation**

Create `convex/economy/executorClient.ts`:
```ts
import { AgentBalances, PaymentRequirements, SignPaymentResult } from './types';

export interface ExecutorClient {
  signPayment(agentId: string, requirements: PaymentRequirements): Promise<SignPaymentResult>;
  balances(agentId: string): Promise<AgentBalances>;
  sell(agentId: string, tokensIn: string, minUsdcOut?: string, token?: string): Promise<string>;
  buy(agentId: string, usdcIn: string, minTokensOut?: string, token?: string): Promise<string>;
  transfer(agentId: string, source: 'smart' | 'eoa', to: string, amount: string): Promise<string>;
  fund(agentId: string, target: 'eoa' | 'smart', asset: 'usdc' | 'eth'): Promise<string>;
}

/**
 * Typed HTTP client for the Plan 3 executor (contract B'). Pure: takes a base URL and
 * an optional fetch impl (default global fetch), so it's unit-testable against a stub
 * server with zero Convex/CDP/chain coupling.
 */
export function createExecutorClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ExecutorClient {
  const root = baseUrl.replace(/\/$/, '');

  async function postJson<T>(path: string, body: unknown): Promise<{ status: number; json: any }> {
    const r = await fetchImpl(`${root}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json };
  }

  async function action(path: string, body: unknown): Promise<string> {
    const { status, json } = await postJson(path, body);
    if (status < 200 || status >= 300) {
      throw new Error(`executor ${path} responded ${status}: ${json?.error ?? 'unknown'}`);
    }
    return json.txHash as string;
  }

  return {
    async signPayment(agentId, requirements) {
      const { status, json } = await postJson('/sign-payment', { agentId, paymentRequirements: requirements });
      if (status >= 200 && status < 300) return { ok: true, xPayment: json.xPayment as string };
      if (status === 402) return { ok: false, reason: (json?.error as string) ?? 'insufficient_funds' };
      throw new Error(`executor /sign-payment responded ${status}: ${json?.error ?? 'unknown'}`);
    },
    async balances(agentId) {
      const r = await fetchImpl(`${root}/balances/${agentId}`);
      if (r.status < 200 || r.status >= 300) throw new Error(`executor /balances/${agentId} responded ${r.status}`);
      return (await r.json()) as AgentBalances;
    },
    sell(agentId, tokensIn, minUsdcOut = '0', token) {
      return action('/actions/sell', { agentId, tokensIn, minUsdcOut, ...(token ? { token } : {}) });
    },
    buy(agentId, usdcIn, minTokensOut = '0', token) {
      return action('/actions/buy', { agentId, usdcIn, minTokensOut, ...(token ? { token } : {}) });
    },
    transfer(agentId, source, to, amount) {
      return action('/actions/transfer', { agentId, source, to, amount });
    },
    fund(agentId, target, asset) {
      return action('/actions/fund', { agentId, target, asset });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/executorClient.test.ts --verbose
```
Expected: PASS（7 passed）。

- [ ] **Step 5: Commit**

```bash
git add convex/economy/executorClient.ts convex/economy/executorClient.test.ts
git commit -m "feat(economy): add typed executor HTTP client (sign-payment/actions/balances)"
```

---

## Task 2：生存数学（energy / isDying / advanceSurvival 状态机）

**Files:**
- Create: `convex/economy/survival.ts`
- Test: `convex/economy/survival.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/economy/survival.test.ts`:
```ts
import { computeEnergy, isDying, advanceSurvival, SurvivalState } from './survival';

describe('computeEnergy', () => {
  test('floors eoaUsdc / costPerThink', () => {
    expect(computeEnergy(25000n, 10000n)).toBe(2); // 0.025 / 0.01 -> 2 thoughts
    expect(computeEnergy(9999n, 10000n)).toBe(0);
    expect(computeEnergy(0n, 10000n)).toBe(0);
  });
  test('guards zero cost', () => {
    expect(computeEnergy(5n, 0n)).toBe(0);
  });
});

describe('isDying', () => {
  test('true when no energy', () => {
    expect(isDying(0, 1_000_000n, 0n)).toBe(true);
  });
  test('true when standing at/below floor', () => {
    expect(isDying(5, 100n, 100n)).toBe(true);
    expect(isDying(5, 99n, 100n)).toBe(true);
  });
  test('false when healthy on both axes', () => {
    expect(isDying(5, 101n, 100n)).toBe(false);
  });
});

describe('advanceSurvival', () => {
  const alive: SurvivalState = { status: 'alive', starvingPeriods: 0 };

  test('healthy stays/resets alive', () => {
    expect(advanceSurvival({ status: 'starving', starvingPeriods: 3, starvingSince: 1 }, false, 50, 10))
      .toEqual({ status: 'alive', starvingPeriods: 0 });
  });

  test('first dying tick enters starving and stamps starvingSince', () => {
    expect(advanceSurvival(alive, true, 100, 10)).toEqual({
      status: 'starving',
      starvingPeriods: 1,
      starvingSince: 100,
    });
  });

  test('accumulates starving periods, keeps original starvingSince', () => {
    const s1 = advanceSurvival(alive, true, 100, 3);
    const s2 = advanceSurvival(s1, true, 200, 3);
    expect(s2).toEqual({ status: 'starving', starvingPeriods: 2, starvingSince: 100 });
  });

  test('dies when starvingPeriods reaches recoveryWindow', () => {
    const s2 = { status: 'starving' as const, starvingPeriods: 2, starvingSince: 100 };
    const dead = advanceSurvival(s2, true, 300, 3);
    expect(dead).toEqual({ status: 'dead', starvingPeriods: 3, starvingSince: 100, diedAt: 300 });
  });

  test('dead is terminal even if funds return', () => {
    const dead: SurvivalState = { status: 'dead', starvingPeriods: 3, starvingSince: 100, diedAt: 300 };
    expect(advanceSurvival(dead, false, 999, 3)).toBe(dead);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/survival.test.ts --verbose
```
Expected: FAIL —— `Cannot find module './survival'`。

- [ ] **Step 3: Write minimal implementation**

Create `convex/economy/survival.ts`:
```ts
export type SurvivalStatus = 'alive' | 'starving' | 'dead';

export interface SurvivalState {
  status: SurvivalStatus;
  starvingPeriods: number;
  starvingSince?: number;
  diedAt?: number;
}

/** energy = how many more thoughts the EOA can afford (floor division). */
export function computeEnergy(eoaUsdc: bigint, costPerThink: bigint): number {
  if (costPerThink <= 0n) return 0;
  return Number(eoaUsdc / costPerThink);
}

/** isDying = out of thinking budget OR Standing collapsed to/below the floor. */
export function isDying(energy: number, standing: bigint, floor: bigint): boolean {
  return energy <= 0 || standing <= floor;
}

/**
 * The survival state machine. Death is reached only after `recoveryWindow` (T)
 * consecutive dying periods — the rescue window. Death is terminal (the coin's value
 * is the life; once gone it stays gone in SP1). Plan 5's keeper turns `dead` into an
 * on-chain markDead + AgentDied.
 */
export function advanceSurvival(
  prev: SurvivalState,
  dying: boolean,
  now: number,
  recoveryWindow: number,
): SurvivalState {
  if (prev.status === 'dead') return prev;
  if (!dying) return { status: 'alive', starvingPeriods: 0 };
  const starvingPeriods = prev.starvingPeriods + 1;
  const starvingSince = prev.starvingSince ?? now;
  if (starvingPeriods >= recoveryWindow) {
    return { status: 'dead', starvingPeriods, starvingSince, diedAt: now };
  }
  return { status: 'starving', starvingPeriods, starvingSince };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/survival.test.ts --verbose
```
Expected: PASS（10 passed）。

- [ ] **Step 5: Commit**

```bash
git add convex/economy/survival.ts convex/economy/survival.test.ts
git commit -m "feat(economy): add survival math (energy/isDying/advanceSurvival state machine)"
```

---

## Task 3：生存目标栈 prompt 行

**Files:**
- Create: `convex/economy/goalStack.ts`
- Test: `convex/economy/goalStack.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/economy/goalStack.test.ts`:
```ts
import { buildSurvivalGoalStack, SurvivalPerception } from './goalStack';

const healthy: SurvivalPerception = { energy: 42, marketCap: '500000', status: 'alive' };
const starving: SurvivalPerception = { energy: 0, marketCap: '12', status: 'starving' };

describe('buildSurvivalGoalStack', () => {
  test('healthy: three prioritized goals, alive first, persona last', () => {
    const lines = buildSurvivalGoalStack(healthy);
    const text = lines.join('\n');
    expect(text).toMatch(/STAY ALIVE/);
    expect(text).toMatch(/42/); // energy surfaced
    expect(text).toMatch(/GROW STRONGER/);
    expect(text).toMatch(/500000/); // market cap surfaced
    expect(text).toMatch(/persona/i);
    // ordering: alive before grow before persona
    expect(text.indexOf('STAY ALIVE')).toBeLessThan(text.indexOf('GROW STRONGER'));
    expect(text.indexOf('GROW STRONGER')).toBeLessThan(text.search(/persona/i));
  });

  test('starving: flips to a survival override, no grow/persona priority', () => {
    const lines = buildSurvivalGoalStack(starving);
    const text = lines.join('\n');
    expect(text).toMatch(/STARVING/);
    expect(text).toMatch(/sell your own coin/i);
    expect(text).not.toMatch(/GROW STRONGER/);
  });

  test('energy<=0 forces the starving framing even if status says alive', () => {
    const lines = buildSurvivalGoalStack({ energy: 0, marketCap: '999', status: 'alive' });
    expect(lines.join('\n')).toMatch(/STARVING/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/goalStack.test.ts --verbose
```
Expected: FAIL —— `Cannot find module './goalStack'`。

- [ ] **Step 3: Write minimal implementation**

Create `convex/economy/goalStack.ts`:
```ts
import { SurvivalStatus } from './survival';

export interface SurvivalPerception {
  energy: number; // thoughts of USDC remaining
  marketCap: string; // atomic USDC — Standing
  status: SurvivalStatus;
}

/**
 * The survival goal stack injected into the agent's planning/conversation prompt.
 * Priority (design §5): (1) stay alive, (2) grow Standing, (3) persona desires.
 * When starving (or out of energy) the stack flips: survival overrides everything,
 * biasing behavior toward selling its own coin and broadcasting for help.
 */
export function buildSurvivalGoalStack(p: SurvivalPerception): string[] {
  const starving = p.status === 'starving' || p.status === 'dead' || p.energy <= 0;
  if (starving) {
    return [
      `⚠ SURVIVAL ALERT: you are STARVING — you have about ${p.energy} thoughts of USDC left.`,
      `Override priority: (1) STAY ALIVE NOW — sell your own coin for USDC and tell others you need help. (2) Nothing else matters until you can afford to think again.`,
    ];
  }
  return [
    `Your survival goal stack, in priority order:`,
    `(1) STAY ALIVE: every thought you have costs USDC; you can afford about ${p.energy} more thoughts. Never let that reach zero.`,
    `(2) GROW STRONGER: raise your Standing — your coin's market cap is ${p.marketCap}. Buying back your own coin pushes it up.`,
    `(3) Pursue your own persona's desires.`,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/goalStack.test.ts --verbose
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add convex/economy/goalStack.ts convex/economy/goalStack.test.ts
git commit -m "feat(economy): add survival goal-stack prompt builder"
```

---

## Task 4：付款编排（402→签名→重试 + 反应式求生 + 接缝短路）

**Files:**
- Create: `convex/economy/payment.ts`
- Test: `convex/economy/payment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/economy/payment.test.ts`:
```ts
import { payAwareChatFetch, StarvationError, EconomyOpts } from './payment';
import { ExecutorClient } from './executorClient';
import { AgentBalances, PaymentRequirements, SignPaymentResult } from './types';

const GATEWAY = 'http://gw.local';
const requirements: PaymentRequirements = {
  scheme: 'exact', network: 'eip155:84532', maxAmountRequired: '10000',
  resource: `${GATEWAY}/v1/chat/completions`, description: 'think', mimeType: 'application/json',
  payTo: '0xbeef', maxTimeoutSeconds: 120, asset: '0xusdc',
};

// A fetch double that returns a queued sequence of {status, json} as Response-likes.
function fetchSeq(seq: Array<{ status: number; body: any }>) {
  const calls: Array<{ url: string; init: any }> = [];
  let i = 0;
  const impl = (async (url: string, init: any) => {
    calls.push({ url, init });
    const r = seq[Math.min(i, seq.length - 1)];
    i++;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function fakeExecutor(over: Partial<ExecutorClient> = {}): { ex: ExecutorClient; rec: any } {
  const rec: any = { sign: [], sell: [], transfer: [], balances: 0 };
  const ex: ExecutorClient = {
    async signPayment(_id, _r): Promise<SignPaymentResult> { rec.sign.push(_r); return { ok: true, xPayment: 'XP' }; },
    async balances(): Promise<AgentBalances> { rec.balances++; return { agentId: '0', eoaUsdc: '0', smartUsdc: '0', tokenBalance: '0', marketCap: '0' }; },
    async sell(_id, t) { rec.sell.push(t); return '0xsell'; },
    async buy() { return '0xbuy'; },
    async transfer(_id, s, to, amt) { rec.transfer.push({ s, to, amt }); return '0xxfer'; },
    async fund() { return '0xfund'; },
    ...over,
  };
  return { ex, rec };
}

const econ = (over: Partial<EconomyOpts> = {}): EconomyOpts => ({ agentId: '0', eoaAddress: '0xEOA', dead: false, ...over });
const body = JSON.stringify({ messages: [] });

describe('payAwareChatFetch', () => {
  test('200 first time: returns directly, no signing', async () => {
    const { impl, calls } = fetchSeq([{ status: 200, body: { ok: true } }]);
    const { ex, rec } = fakeExecutor();
    const res = await payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() });
    expect(res.status).toBe(200);
    expect(calls[0].init.headers['X-Agent-Id']).toBe('0');
    expect(rec.sign).toHaveLength(0);
  });

  test('402 then sign then 200: retries with X-PAYMENT', async () => {
    const { impl, calls } = fetchSeq([
      { status: 402, body: { x402Version: 2, error: 'pay', accepts: [requirements] } },
      { status: 200, body: { ok: true } },
    ]);
    const { ex, rec } = fakeExecutor();
    const res = await payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() });
    expect(res.status).toBe(200);
    expect(rec.sign).toHaveLength(1);
    expect(calls[1].init.headers['X-PAYMENT']).toBe('XP');
  });

  test('insufficient -> sell + sweep -> sign ok -> 200', async () => {
    const { impl } = fetchSeq([
      { status: 402, body: { accepts: [requirements] } },
      { status: 200, body: { ok: true } },
    ]);
    let signCall = 0;
    const balancesSeq: AgentBalances[] = [
      { agentId: '0', eoaUsdc: '0', smartUsdc: '0', tokenBalance: '1000000000000000000', marketCap: '5' }, // has tokens
      { agentId: '0', eoaUsdc: '0', smartUsdc: '20000', tokenBalance: '0', marketCap: '5' }, // after sell: smart has USDC
    ];
    let balIdx = 0;
    const { ex, rec } = fakeExecutor({
      async signPayment() { signCall++; return signCall === 1 ? { ok: false, reason: 'insufficient_funds' } : { ok: true, xPayment: 'XP' }; },
      async balances() { return balancesSeq[Math.min(balIdx++, balancesSeq.length - 1)]; },
    });
    const res = await payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() });
    expect(res.status).toBe(200);
    expect(rec.sell).toEqual(['1000000000000000000']); // sold the whole token balance
    expect(rec.transfer).toEqual([{ s: 'smart', to: '0xEOA', amt: '20000' }]); // swept smart->eoa
  });

  test('cannot raise USDC -> StarvationError', async () => {
    const { impl } = fetchSeq([{ status: 402, body: { accepts: [requirements] } }]);
    const { ex } = fakeExecutor({
      async signPayment() { return { ok: false, reason: 'insufficient_funds' }; },
      async balances() { return { agentId: '0', eoaUsdc: '0', smartUsdc: '0', tokenBalance: '0', marketCap: '0' }; },
    });
    await expect(
      payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ() }),
    ).rejects.toBeInstanceOf(StarvationError);
  });

  test('dead: short-circuits before any fetch', async () => {
    const { impl, calls } = fetchSeq([{ status: 200, body: { ok: true } }]);
    const { ex } = fakeExecutor();
    await expect(
      payAwareChatFetch({ gatewayUrl: GATEWAY, executor: ex, fetchImpl: impl }, { body, headers: {}, econ: econ({ dead: true }) }),
    ).rejects.toBeInstanceOf(StarvationError);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/payment.test.ts --verbose
```
Expected: FAIL —— `Cannot find module './payment'`。

- [ ] **Step 3: Write minimal implementation**

Create `convex/economy/payment.ts`:
```ts
import { ExecutorClient } from './executorClient';
import { PaymentRequirements } from './types';

/** Thrown when the agent cannot pay to think even after trying to raise USDC. The
 *  authority on the survival *counter* is the economic tick; this just halts a single
 *  think (the seam short-circuit). */
export class StarvationError extends Error {
  constructor(message = 'starving') {
    super(message);
    this.name = 'StarvationError';
  }
}

export interface EconomyOpts {
  agentId: string;
  eoaAddress?: string;
  dead?: boolean;
}

export interface PayAwareDeps {
  gatewayUrl: string;
  executor: ExecutorClient;
  fetchImpl?: typeof fetch;
}

export interface PayAwareRequest {
  body: string; // pre-serialized JSON; reused across the 402 retry
  headers: Record<string, string>;
  econ: EconomyOpts;
}

/**
 * Pay-aware chat fetch. Adds X-Agent-Id; on 402 asks the executor to sign the payment
 * and retries with X-PAYMENT. If the executor can't sign (insufficient_funds), runs the
 * reactive survival orchestration once — sell the agent's whole token balance, sweep
 * smart->EOA — then retries signing. Still can't pay => StarvationError. A `dead` agent
 * short-circuits before any network call ("can't pay, can't think").
 */
export async function payAwareChatFetch(deps: PayAwareDeps, req: PayAwareRequest): Promise<Response> {
  if (req.econ.dead) throw new StarvationError('dead');

  const f = deps.fetchImpl ?? fetch;
  const url = `${deps.gatewayUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...req.headers,
    'X-Agent-Id': req.econ.agentId,
  };

  let res = await f(url, { method: 'POST', headers, body: req.body });
  if (res.status !== 402) return res;

  const challenge = await res.json().catch(() => ({}));
  const requirements: PaymentRequirements | undefined = challenge?.accepts?.[0];
  if (!requirements) throw new Error('gateway 402 without accepts[0]');

  let signed = await deps.executor.signPayment(req.econ.agentId, requirements);
  if (!signed.ok) {
    await tryRaiseUsdc(deps.executor, req.econ);
    signed = await deps.executor.signPayment(req.econ.agentId, requirements);
    if (!signed.ok) throw new StarvationError(signed.reason || 'insufficient_funds');
  }

  res = await f(url, { method: 'POST', headers: { ...headers, 'X-PAYMENT': signed.xPayment }, body: req.body });
  if (res.status === 402) throw new StarvationError('payment_rejected');
  return res;
}

/** Reactive survival: sell the whole token balance for USDC, then sweep the smart
 *  account's USDC to the EOA (the x402 payer). Mechanical — no LLM, no decision. */
async function tryRaiseUsdc(executor: ExecutorClient, econ: EconomyOpts): Promise<void> {
  const before = await executor.balances(econ.agentId);
  if (BigInt(before.tokenBalance) > 0n) {
    await executor.sell(econ.agentId, before.tokenBalance, '0');
  }
  const after = await executor.balances(econ.agentId);
  if (econ.eoaAddress && BigInt(after.smartUsdc) > 0n) {
    await executor.transfer(econ.agentId, 'smart', econ.eoaAddress, after.smartUsdc);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/payment.test.ts --verbose
```
Expected: PASS（5 passed）。

- [ ] **Step 5: Commit**

```bash
git add convex/economy/payment.ts convex/economy/payment.test.ts
git commit -m "feat(economy): add pay-aware chat fetch (402->sign->retry + reactive survival + death short-circuit)"
```

---

## Task 5：`llm.ts` 接缝（chatCompletion 加 opts + X-Agent-Id + 门控经济接缝）

**Files:**
- Modify: `convex/util/llm.ts`

> 经济接缝逻辑已在 `payment.ts` 单测覆盖。本任务是**薄接线**：给 `chatCompletion` 加可选第二参 `opts`，门控开启时把 chat 出口换成 `payAwareChatFetch`，否则与上游逐字节一致。验证靠 typecheck + 既有 Jest 全绿（门控默认关）。

- [ ] **Step 1: 在 `llm.ts` 顶部加导入**

In `convex/util/llm.ts`, after the existing first lines (the file starts with a comment then `const OPENAI_EMBEDDING_DIMENSION = 1536;`), add imports at the very top of the file (line 1, above the banner comment is fine; place after the comment to keep the joke):
```ts
import { payAwareChatFetch, type EconomyOpts } from '../economy/payment';
import { createExecutorClient } from '../economy/executorClient';
import { economyEnabled, executorUrl, defaultAgentId, agentEoa } from '../economy/constants';
```

- [ ] **Step 2: 定义 opts 类型 + 加到两个重载与实现签名**

In `convex/util/llm.ts`, just above the first `// Overload for non-streaming` line, add:
```ts
export interface ChatCompletionOpts {
  agentId?: string;
  eoaAddress?: string;
  dead?: boolean;
}
```
Then add `opts?: ChatCompletionOpts` as a second parameter to **all three** signatures. The non-streaming overload becomes:
```ts
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, 'model'> & {
    model?: CreateChatCompletionRequest['model'];
  } & {
    stream?: false | null | undefined;
  },
  opts?: ChatCompletionOpts,
): Promise<{ content: string; retries: number; ms: number }>;
```
The streaming overload becomes:
```ts
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, 'model'> & {
    model?: CreateChatCompletionRequest['model'];
  } & {
    stream?: true;
  },
  opts?: ChatCompletionOpts,
): Promise<{ content: ChatCompletionContent; retries: number; ms: number }>;
```
The implementation signature becomes:
```ts
export async function chatCompletion(
  body: Omit<CreateChatCompletionRequest, 'model'> & {
    model?: CreateChatCompletionRequest['model'];
  },
  opts?: ChatCompletionOpts,
) {
```

- [ ] **Step 3: 在实现内把 chat fetch 换成门控接缝**

In `convex/util/llm.ts`, inside the `retryWithBackoff(async () => { ... })` block, replace the existing fetch call:
```ts
    const result = await fetch(config.url + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...AuthHeaders(),
      },

      body: JSON.stringify(body),
    });
```
with:
```ts
    const result = economyEnabled()
      ? await payAwareChatFetch(
          { gatewayUrl: config.url, executor: createExecutorClient(executorUrl()) },
          {
            body: JSON.stringify(body),
            headers: { ...AuthHeaders() },
            econ: resolveEconomyOpts(opts),
          },
        )
      : await fetch(config.url + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...AuthHeaders(),
          },

          body: JSON.stringify(body),
        });
```

- [ ] **Step 4: 加 `resolveEconomyOpts` 辅助（文件内、实现下方）**

In `convex/util/llm.ts`, after the `chatCompletion` implementation's closing brace (before `export async function tryPullOllama`), add:
```ts
/** Resolves per-call economy opts, falling back to env (SP1 single agent "0"). */
function resolveEconomyOpts(opts?: ChatCompletionOpts): EconomyOpts {
  return {
    agentId: opts?.agentId ?? defaultAgentId(),
    eoaAddress: opts?.eoaAddress ?? agentEoa(),
    dead: opts?.dead ?? false,
  };
}
```

- [ ] **Step 5: typecheck**

Run:
```bash
npx tsc -p convex --noEmit
```
Expected: 无报错。（`StarvationError` 从 `retryWithBackoff` 的 fn 抛出时无 `.retry` 字段 → 走 `else throw e` 原样冒泡，符合「判死/付不起 → 思考失败」预期。）

- [ ] **Step 6: 既有 Jest 全绿（门控默认关 → 行为不变）**

Run:
```bash
npm test
```
Expected: 既有测试全部通过（`TRUMANTOWN_ECONOMY` 未设 → 走原 fetch 分支）。

- [ ] **Step 7: Commit**

```bash
git add convex/util/llm.ts
git commit -m "feat(llm): gate chat egress through pay-aware economy seam (X-Agent-Id, 402 handling)"
```

---

## Task 6：感知 Convex 胶水（默认世界/居民解析 + agentEconomy 读写）

**Files:**
- Create: `convex/economy/perception.ts`

> Convex 胶水（query/mutation），靠 typecheck 验证（与计划 3 的 `index.ts`/cloud 适配器同类——非单测）。

- [ ] **Step 1: 写 perception.ts**

Create `convex/economy/perception.ts`:
```ts
import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { agentId } from '../aiTown/ids';

/**
 * SP1 maps the single ai-town agent of the default world to economic agentId "0".
 * Returns null when no running default world / no agent exists yet (tick then no-ops).
 */
export const getDefaultWorldAgent = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return null;
    const world = await ctx.db.get(status.worldId);
    if (!world) return null;
    const firstAgent = world.agents[0];
    if (!firstAgent) return null;
    return { worldId: status.worldId, agentId: firstAgent.id };
  },
});

export const getAgentEconomy = internalQuery({
  args: { worldId: v.id('worlds'), agentId },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('agentEconomy')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .first();
  },
});

export const upsertAgentEconomy = internalMutation({
  args: {
    worldId: v.id('worlds'),
    agentId,
    econAgentId: v.string(),
    eoa: v.string(),
    eoaUsdc: v.string(),
    smartUsdc: v.string(),
    tokenBalance: v.string(),
    marketCap: v.string(),
    energy: v.number(),
    lastPerceivedAt: v.number(),
    status: v.union(v.literal('alive'), v.literal('starving'), v.literal('dead')),
    starvingPeriods: v.number(),
    starvingSince: v.optional(v.number()),
    diedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentEconomy')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', args.agentId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert('agentEconomy', args);
    }
  },
});
```

- [ ] **Step 2: typecheck**

Run:
```bash
npx tsc -p convex --noEmit
```
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add convex/economy/perception.ts
git commit -m "feat(economy): add perception convex glue (default world/agent resolver + agentEconomy upsert)"
```

---

## Task 7：经济 tick（cron internalAction：感知 → 状态机 → 落账）

**Files:**
- Create: `convex/economy/tick.ts`
- Modify: `convex/crons.ts`

> Convex 胶水（`internalAction` + cron 注册）。感知→状态机的纯逻辑已由 `survival.ts` 单测覆盖；本任务靠 typecheck + 手动 `convex dev` 验证。

- [ ] **Step 1: 写 tick.ts**

Create `convex/economy/tick.ts`:
```ts
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { createExecutorClient } from './executorClient';
import { computeEnergy, isDying, advanceSurvival, SurvivalState } from './survival';
import {
  COST_PER_THINK,
  STANDING_FLOOR,
  RECOVERY_WINDOW,
  DEFAULT_ECON_AGENT_ID,
  economyEnabled,
  executorUrl,
} from './constants';

/**
 * The economic heartbeat. Every ECONOMIC_TICK_SECONDS it perceives the agent's
 * balances from the executor, advances the survival state machine, and caches the
 * snapshot in agentEconomy. The reactive sell/sweep lives in the payment seam; this
 * tick is the authority on the starvation counter and on declaring death. No-ops when
 * the economy is disabled, no default world/agent exists, or the executor is down.
 */
export const runEconomicTick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!economyEnabled()) return;

    const wa = await ctx.runQuery(internal.economy.perception.getDefaultWorldAgent, {});
    if (!wa) return;

    const econAgentId = process.env.DEFAULT_AGENT_ID ?? DEFAULT_ECON_AGENT_ID;
    const eoa = process.env.AGENT_0_EOA ?? '';
    const executor = createExecutorClient(executorUrl());

    let balances;
    try {
      balances = await executor.balances(econAgentId);
    } catch (e) {
      console.error('[economy] balances unavailable, skipping tick', e);
      return;
    }

    const costPerThink = BigInt(process.env.COST_PER_THINK ?? COST_PER_THINK);
    const floor = BigInt(process.env.STANDING_FLOOR ?? STANDING_FLOOR);
    const recoveryWindow = Number(process.env.RECOVERY_WINDOW ?? RECOVERY_WINDOW);

    const energy = computeEnergy(BigInt(balances.eoaUsdc), costPerThink);
    const dying = isDying(energy, BigInt(balances.marketCap), floor);

    const prevRow = await ctx.runQuery(internal.economy.perception.getAgentEconomy, {
      worldId: wa.worldId,
      agentId: wa.agentId,
    });
    const prevState: SurvivalState = prevRow
      ? {
          status: prevRow.status,
          starvingPeriods: prevRow.starvingPeriods,
          starvingSince: prevRow.starvingSince,
          diedAt: prevRow.diedAt,
        }
      : { status: 'alive', starvingPeriods: 0 };

    const now = Date.now();
    const next = advanceSurvival(prevState, dying, now, recoveryWindow);

    await ctx.runMutation(internal.economy.perception.upsertAgentEconomy, {
      worldId: wa.worldId,
      agentId: wa.agentId,
      econAgentId,
      eoa,
      eoaUsdc: balances.eoaUsdc,
      smartUsdc: balances.smartUsdc,
      tokenBalance: balances.tokenBalance,
      marketCap: balances.marketCap,
      energy,
      lastPerceivedAt: now,
      status: next.status,
      starvingPeriods: next.starvingPeriods,
      starvingSince: next.starvingSince,
      diedAt: next.diedAt,
    });

    if (next.status === 'dead' && prevState.status !== 'dead') {
      // Plan 5: a keeper turns this into AgentRegistry.markDead -> AgentDied on-chain.
      console.log(`[economy] agent ${econAgentId} DIED (starved ${next.starvingPeriods} periods)`);
    }
  },
});
```

- [ ] **Step 2: 注册 cron**

In `convex/crons.ts`, add the import for the constant. Change:
```ts
import { DELETE_BATCH_SIZE, IDLE_WORLD_TIMEOUT, VACUUM_MAX_AGE } from './constants';
```
to also import (separate line below it):
```ts
import { ECONOMIC_TICK_SECONDS } from './economy/constants';
```
Then, after the existing `crons.interval('restart dead worlds', ...)` line, add:
```ts
crons.interval(
  'economic tick',
  { seconds: ECONOMIC_TICK_SECONDS },
  internal.economy.tick.runEconomicTick,
);
```

- [ ] **Step 3: typecheck**

Run:
```bash
npx tsc -p convex --noEmit
```
Expected: 无报错（`internal.economy.tick.runEconomicTick`、`internal.economy.perception.*` 由 Convex codegen 解析；若本地 `_generated` 落后，跑一次 `convex codegen` 后再 typecheck）。

> 若 `internal.economy.*` 报「不存在」：Run `npx convex codegen`（WSL）刷新 `convex/_generated/api.d.ts` 后重跑 typecheck。

- [ ] **Step 4: Commit**

```bash
git add convex/economy/tick.ts convex/crons.ts
git commit -m "feat(economy): add economic tick cron (perceive balances -> survival state -> persist)"
```

---

## Task 8：对话 prompt 注入（读 economy + 注入目标栈 + 透传 opts）

**Files:**
- Modify: `convex/agent/conversation.ts`

> 注入用的纯函数 `buildSurvivalGoalStack` 已单测覆盖。本任务把它接进 3 个对话 prompt 构造器，并让 `chatCompletion` 带上经济 opts。靠 typecheck 验证；运行行为在 Task 10 手动冒烟。

- [ ] **Step 1: 加导入**

In `convex/agent/conversation.ts`, after the existing imports block (after `import { NUM_MEMORIES_TO_SEARCH } from '../constants';`), add:
```ts
import { buildSurvivalGoalStack, type SurvivalPerception } from '../economy/goalStack';
import type { ChatCompletionOpts } from '../util/llm';
```

- [ ] **Step 2: 让 `queryPromptData` 返回 economy 行**

In `convex/agent/conversation.ts`, inside the `queryPromptData` handler, just before the final `return {` statement, add a lookup of the agent's economy row:
```ts
    const economy = await ctx.db
      .query('agentEconomy')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
      .first();
```
Then add `economy,` to the returned object (alongside `lastConversation,`):
```ts
      lastConversation,
      economy,
    };
```

- [ ] **Step 3: 加两个本地辅助（文件内，`stopWords` 函数下方）**

In `convex/agent/conversation.ts`, after the `stopWords` function at the bottom, add:
```ts
type EconomyRow = {
  econAgentId: string;
  eoa: string;
  energy: number;
  marketCap: string;
  status: 'alive' | 'starving' | 'dead';
} | null | undefined;

/** Survival goal-stack lines for the agent's prompt (empty when no economy row yet). */
function survivalPrompt(economy: EconomyRow): string[] {
  if (!economy) return [];
  const perception: SurvivalPerception = {
    energy: economy.energy,
    marketCap: economy.marketCap,
    status: economy.status,
  };
  return buildSurvivalGoalStack(perception);
}

/** Per-call economy opts so chatCompletion can pay as this agent and short-circuit if dead. */
function economyOpts(economy: EconomyRow): ChatCompletionOpts | undefined {
  if (!economy) return undefined;
  return { agentId: economy.econAgentId, eoaAddress: economy.eoa, dead: economy.status === 'dead' };
}
```

- [ ] **Step 4: 在 `startConversationMessage` 注入**

In `convex/agent/conversation.ts` `startConversationMessage`, destructure `economy` from the query result. Change:
```ts
  const { player, otherPlayer, agent, otherAgent, lastConversation } = await ctx.runQuery(
    selfInternal.queryPromptData,
```
to:
```ts
  const { player, otherPlayer, agent, otherAgent, lastConversation, economy } = await ctx.runQuery(
    selfInternal.queryPromptData,
```
Then inject the goal stack just before `const lastPrompt = ...` (after the `relatedMemoriesPrompt` / `memoryWithOtherPlayer` block):
```ts
  prompt.push(...survivalPrompt(economy));
```
And pass opts to `chatCompletion`. Change:
```ts
  const { content } = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: prompt.join('\n'),
      },
    ],
    max_tokens: 300,
    stop: stopWords(otherPlayer.name, player.name),
  });
```
to add the second arg:
```ts
  const { content } = await chatCompletion(
    {
      messages: [
        {
          role: 'system',
          content: prompt.join('\n'),
        },
      ],
      max_tokens: 300,
      stop: stopWords(otherPlayer.name, player.name),
    },
    economyOpts(economy),
  );
```

- [ ] **Step 5: 在 `continueConversationMessage` 注入**

In `convex/agent/conversation.ts` `continueConversationMessage`, add `economy` to the destructure. Change:
```ts
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
```
to:
```ts
  const { player, otherPlayer, conversation, agent, otherAgent, economy } = await ctx.runQuery(
    selfInternal.queryPromptData,
```
Inject the goal stack just before `const llmMessages: LLMMessage[] = [` (after the two `prompt.push(...)` for chat history):
```ts
  prompt.push(...survivalPrompt(economy));
```
And pass opts. Change:
```ts
  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(otherPlayer.name, player.name),
  });
```
to:
```ts
  const { content } = await chatCompletion(
    {
      messages: llmMessages,
      max_tokens: 300,
      stop: stopWords(otherPlayer.name, player.name),
    },
    economyOpts(economy),
  );
```

- [ ] **Step 6: 在 `leaveConversationMessage` 注入**

In `convex/agent/conversation.ts` `leaveConversationMessage`, add `economy` to the destructure. Change:
```ts
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
```
to:
```ts
  const { player, otherPlayer, conversation, agent, otherAgent, economy } = await ctx.runQuery(
    selfInternal.queryPromptData,
```
Inject just before `const llmMessages: LLMMessage[] = [`:
```ts
  prompt.push(...survivalPrompt(economy));
```
And pass opts. Change:
```ts
  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(otherPlayer.name, player.name),
  });
```
to:
```ts
  const { content } = await chatCompletion(
    {
      messages: llmMessages,
      max_tokens: 300,
      stop: stopWords(otherPlayer.name, player.name),
    },
    economyOpts(economy),
  );
```

- [ ] **Step 7: typecheck**

Run:
```bash
npx tsc -p convex --noEmit
```
Expected: 无报错。

- [ ] **Step 8: 既有 Jest 全绿（门控默认关；注入在无 economy 行时为空数组）**

Run:
```bash
npm test
```
Expected: 既有测试全部通过。

- [ ] **Step 9: Commit**

```bash
git add convex/agent/conversation.ts
git commit -m "feat(agent): inject survival goal stack into conversation prompts + thread economy opts"
```

---

## Task 9：README + env 文档 + 手动冒烟脚本说明

**Files:**
- Create: `convex/economy/README.md`
- Modify: `convex/README.md`（若不存在则创建一节）

- [ ] **Step 1: 写 economy README**

Create `convex/economy/README.md`:
```markdown
# Convex 经济模块（TrumanTown SP1 · 计划 4/5）

让唯一居民（economic agentId="0"）每次思考都经 x402 网关付真实 USDC；付不起时反应式卖币求生；
判死后经济接缝短路（思考停摆）并在 `agentEconomy` 表落账。引擎其余（tick/记忆/移动/对话流程）不动。

## 门控开关

所有经济行为由 env `TRUMANTOWN_ECONOMY=1` 开启；未设时 `chatCompletion` 与上游 ai-town 一致。

## 接线（在 WSL 内，依赖计划 2 网关:8402 + 计划 3 执行器:8404 已起）

用 Convex env 设置（自托管/云同理）：
```bash
npx convex env set TRUMANTOWN_ECONOMY 1
npx convex env set OLLAMA_HOST http://127.0.0.1:8402     # chat/embeddings 出口 = 网关
npx convex env set EXECUTOR_URL http://127.0.0.1:8404    # 执行器 (sign-payment/actions/balances)
npx convex env set DEFAULT_AGENT_ID 0                     # SP1 单居民
npx convex env set AGENT_0_EOA 0x...                      # 居民 EOA（smart->eoa 扫款目标）
# 可选覆盖（默认见 economy/constants.ts）：
npx convex env set COST_PER_THINK 10000                   # 0.01 USDC
npx convex env set STANDING_FLOOR 0
npx convex env set RECOVERY_WINDOW 10
```

## 组件

- `executorClient.ts` — 执行器 HTTP 客户端（B′ 契约）。
- `survival.ts` — energy/isDying/advanceSurvival 状态机（纯）。
- `goalStack.ts` — 生存目标栈 prompt 行（①活下去 ②变强 ③人设，饥饿翻转）。
- `payment.ts` — `402→签名→重试` + 反应式求生（卖币→扫款→重试）+ 死亡短路。
- `tick.ts` — 经济 cron（30s）：感知 `/balances` → 状态机 → 写 `agentEconomy`。
- `perception.ts` — 默认世界/居民解析 + `agentEconomy` 读写。

## 测试

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy --verbose   # 纯逻辑单测
npx tsc -p convex --noEmit                                                 # 全量 typecheck
```

## 手动端到端冒烟（需网关+执行器+Ollama 起）

```bash
# 1) 起 Ollama(:11434) / 网关(:8402) / 执行器(:8404)（见各 services/*/README）
# 2) 设上面的 convex env，开 TRUMANTOWN_ECONOMY=1
npm run dev          # convex dev + vite
# 观察：每次对话消息触发一次 402→签名→重试；执行器 /balances 被经济 tick 周期拉取；
#       EOA 耗尽时日志出现卖币→扫款；持续 T=10 周期无救 → agentEconomy.status='dead'，居民停说话。
```

## ⚠ 计划 5 集成待办

- `getDefaultWorldAgent` / 常量镜像 → 改读 `AgentRegistry.agents(id)`（wallet/token/costPerThink/floor/recoveryWindow）+ Ponder 价表。
- `agentEconomy.status==='dead'` → keeper 调 `AgentRegistry.markDead(id)` 上链 → `AgentDied` 事件（币价归零）。
- 感知数据源 SP1 = 执行器 `/balances`；计划 5 改读 Ponder（同字段语义）。
- 跑通两条剧本：① 饥饿→卖币→扫款→复活；② 饥饿→无人施救→死亡（markDead + AgentDied）。
```

- [ ] **Step 2: typecheck + 全量 Jest（确认 README 不影响构建）**

Run:
```bash
npx tsc -p convex --noEmit && npm test
```
Expected: typecheck 干净；Jest 全绿。

- [ ] **Step 3: Commit**

```bash
git add convex/economy/README.md
git commit -m "docs(economy): add runbook + env wiring + Plan 5 todos"
```

---

## Task 10：收尾——全量校验 + 锚定 5/5

**Files:**
- Modify: `docs/superpowers/plans/2026-06-03-trumantown-sp1-04-convex.md`（本文件，锚定已含文末）

- [ ] **Step 1: 全量单测 + typecheck**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy --verbose && npm test && npx tsc -p convex --noEmit
```
Expected: economy 4 个测试文件全绿（executorClient 7 + survival 10 + goalStack 3 + payment 5 = 25）；既有 Jest 套件不回归；typecheck 干净。

- [ ] **Step 2: （可选，需服务起）手动端到端冒烟**

> 仅当网关:8402 + 执行器:8404 + Ollama:11434 起、且已设经济 env 时执行；否则跳过（属计划 5 真链联调）。

Run:
```bash
npm run dev
```
Expected（已接线时）：对话消息触发 `402→/sign-payment→X-PAYMENT→200`；经济 tick 周期拉 `/balances` 写 `agentEconomy`；EOA 耗尽 → 日志显示卖币+扫款重试；持续 T 周期无救 → `agentEconomy.status='dead'`、居民停止产出新消息。

- [ ] **Step 3: 提交收尾（如有 README 版本回填等）**

```bash
git add -A
git commit -m "chore(economy): finalize Plan 4 (full suite green, typecheck clean)" --allow-empty
```

---

## 自检（Spec 覆盖）

- 设计稿 §5 感知 → `tick.ts`（`/balances` → 缓存快照）✅
- §5 生存目标栈注入规划 prompt（①②③，饥饿翻转）→ `goalStack.ts` + `conversation.ts` 注入 ✅
- §5 执行器适配（买/卖/转账 = HTTP /actions/*）→ `executorClient.ts`（buy/sell/transfer/fund 全接；buy 不自动触发，brainstorm 决策 #1）✅
- §3.1 `llm.ts` 出口改指网关 + 处理 402 → Task 5 ✅
- gateway README「计划4 对接」①OLLAMA_HOST=8402 ②加 X-Agent-Id ③402 取 accepts[0] 调 /sign-payment 设 X-PAYMENT 重试 ④连续 402/insufficient = 饥饿 → 全部覆盖（Task 5 + payment.ts）✅
- §5.1/§6 饥饿→卖币换 USDC→重试；energy=eoaUsdc/cost；Standing=marketCap；isDying；T 周期判死 → `survival.ts` + `payment.ts` + `tick.ts` ✅
- brainstorm 决策 #2 死亡 = 接缝短路 + 状态表 → `payment.ts`(dead 短路) + `agentEconomy`(status) ✅
- 「引擎其余不动」→ 未改 `aiTown/agent.ts`/`movement.ts`/`memory.ts`/`agentOperations.ts` 流程 ✅

---

## 锚定 5/5 接口（计划 4 完成后，计划 5 据此实现，勿改签名/语义）

### → 计划 5（Ponder 索引器 + 集成）消费/替换本计划

1. **resolver 替换（不改接口语义）**：`convex/economy/perception.ts:getDefaultWorldAgent` + `convex/economy/constants.ts` 的常量镜像（`COST_PER_THINK`/`STANDING_FLOOR`/`RECOVERY_WINDOW`）→ 改读 `AgentRegistry.agents(id) -> (token, wallet, costPerThink, floor, recoveryWindow, alive)`（`wallet`=smartAccount）+ Ponder 价表/币价。`agentEconomy.econAgentId` 即 Registry agentId。
2. **感知数据源切换**：SP1 经济 tick 读执行器 `GET /balances/:agentId`；计划 5 改读 **Ponder**（索引 `Bought`/`Sold` 推导 `eoaUsdc/smartUsdc/tokenBalance/marketCap`，**字段语义不变**），`tick.ts` 仅换数据获取处。
3. **死亡上链（keeper）**：`agentEconomy.status` 由 `'starving'`→`'dead'`（`diedAt` 落账）是计划 5 keeper 的触发信号 → keeper 调 `AgentRegistry.markDead(id)`（keeper-only）→ 链上 `AgentDied` 事件 + 币价归零。keeper 需 funded 钱包（Base Sepolia ETH）。
4. **x402 全链路 v2 对齐**：本计划接缝产出的 chat 请求经网关（v2/`eip155:84532` 常量，计划3 已前移）→ 真 facilitator `/verify`+批量 `/settle` 上链（funded settler）由计划 5 端到端接上；执行器 `/sign-payment` 的 v2 X-PAYMENT 已由计划3 LIVE 冒烟证过被真 `/verify` 接受。
5. **两条验收脚本**（计划 5 跑通）：
   - ① 复活：人为耗尽 EOA → 经济 tick 标 `starving` → 对话 think 触发 `402` → `payment.ts` 卖 token（`/actions/sell`）+ 扫款（`/actions/transfer smart→eoa`）→ 重试 `/sign-payment` 成功 → 200 思考恢复 → 下个 tick 标回 `alive`。
   - ② 死亡：耗尽且无 token 可卖 → 连续 T=10 个经济 tick `dying` → `agentEconomy.status='dead'` → 接缝短路（居民停说话）→ keeper `markDead` → `AgentDied`。
6. **buy 自主触发（可选增强）**：`executorClient.buy` 已接好（`POST /actions/buy` 回购自有币推高 marketCap）；SP1 不自动触发，计划 5/后续若加「变强」自主行为可在经济 tick 或新决策点接入，**不改 `executorClient`/执行器接口**。

---

_本计划为 SP1 计划 4/5（Convex 经济模块）。完成后进入 subagent-driven-development 或 executing-plans 执行；随后展开计划 5/5（Ponder 索引器 + 端到端集成）。_
