# 楚门镇 SP1 · 计划 2/5：x402 计量推理网关 + 自托管 facilitator 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WSL 内实现一个挡在 Ollama 前面的 x402 计量推理网关——每次 `chat completion` 按居民的 `costPerThink` 定价为真实 USDC，首次返回 `402 + 付款要求`，带 `X-PAYMENT` 重试则即时验款 → 反向代理转发 Ollama → 返回，并把已验款项放入内存队列批量结算上链；同时立起自托管 facilitator（fork `OviatoHQ/x402-facilitator-hono`，指向 Base Sepolia）。

**Architecture:** 两个独立的 WSL 本地 Node 服务（`services/gateway/`、`services/facilitator/`），与根目录的 Convex/Vite 工程**隔离**（各自 `package.json` / `node_modules`）。网关是一个**纯 x402 资源服务器**（语义上「只 402 + 验款」），自写部分严格限定为**Ollama 反向代理 + 按 `costPerThink` 的定价胶水 + 批量结算队列**；`/verify`、`/settle` 全部委托 facilitator。验款即时（链下签名+余额校验），结算异步批量（每 N=10 笔或 60s 先到先触发），以兼顾 Base Sepolia ~2s 出块。`402→签名付款→重试`的编排由 Convex 接缝（计划 4）驱动，付款签名方是居民的 CDP 钱包（计划 3）——网关对此无状态、不持钱包。

**Tech Stack:** Node 18（WSL 原生，nvm）· TypeScript · Express · x402 wire protocol v1（`exact` 方案 / EIP-3009，USDC 6dec on Base Sepolia）· Vitest + Supertest（TDD）· `tsx`（dev runner）· 自托管 facilitator = Hono/TypeScript fork。

---

## ⛔ 运行环境（贯穿全计划，务必遵守）

- 本计划所有 Node/npm/服务进程**只在 WSL 内运行**。Windows 主机上的每条命令包一层：
  `wsl.exe bash -lc 'cd "/mnt/d/AI Agent/ai-town-web3" && <cmd>'`
- WSL 默认 `node` 可能指向 Windows 版；先 `nvm use 18`（无则 `nvm install 18`）确认 `node -v` 为 v18.x。
- **文件一律用 Write/Edit 写**（Windows 路径 `d:\AI Agent\ai-town-web3\...`），不要用 shell heredoc/echo 造文件。
- 在分支 `feat/sp1-gateway` 上工作，**不要直接写 main**。执行用 subagent-driven-development，每个任务两阶段审查（spec 合规 → 代码质量）。

---

## 设计说明（对设计稿措辞的诚实细化）

设计稿 §3.2 写「用 `x402-express` 中间件」。落到可 TDD 的实现时，本计划**保留 x402 的线协议（wire protocol v1）与 `exact`/EIP-3009 方案不变**，但**自写一个极薄的 402/验款中间件（即设计稿点名要自写的「定价胶水」）**，而非套用 `x402-express` 的 turnkey `paymentMiddleware`。原因有二，均为既定决策直接推导：

1. **按 `costPerThink` 的逐居民动态定价**（经 `X-Agent-Id` 路由）——turnkey 中间件以静态路由价为模型，不支持按请求头动态定价。
2. **延迟批量结算**（已锁定 Q4：内存队列、N 笔或 T 秒触发）——turnkey 中间件在响应后**内联 settle**，与「验款即时、结算批量」相冲突。

因此自写中间件只做 `402 挑战 + 解析 X-PAYMENT + 调 facilitator 验款 + 入队`，**不在请求路径上 settle**。这与设计稿「自写的只有 Ollama 反向代理 + 定价胶水」完全一致，且语义上仍是一个纯 x402 资源服务器。若后续要简化为「定价固定 + 内联结算」，可平滑换回 `x402-express`（接口契约不变）。此处主动标注，与计划 1「以开源曲线为数学参考、clean-room 实现」的做法同源。

**facilitator 的边界：** 自托管 facilitator 以 `OviatoHQ/x402-facilitator-hono` 为基底 fork，只**配置 + 立起 + 冒烟**其 `/verify`、`/settle`、`/supported`，不做深度改写。`/settle` 真正上链需要一个有 gas 的 settler 钱包与 Base Sepolia 连接，其**端到端链上集成放到计划 5**。本计划网关的全部单测用**进程内 mock facilitator**（设计稿 §7 允许「本地 facilitator 或 mock」），不依赖真链或测试网资金。

**类型来源：** 代码用本地接口镜像 x402 v1 线格式（零 SDK API 风险）。Task 0 含一步：若安装的 `x402` 包导出等价 `PaymentRequirements`/`PaymentPayload`/`exact` 解码，则改用其规范类型；否则保留本地镜像类型。

---

## 锚定接口（供计划 3/4/5 直接对齐，勿改签名）

本计划冻结以下三个 HTTP 契约。计划 3（执行器）、4（Convex 经济模块）、5（索引器+集成）按此实现，不另行发明。

### A. 网关对外（计划 4 的 `llm.ts` 接缝消费）

| 项 | 约定 |
|---|---|
| 计费端点 | `POST /v1/chat/completions`（**唯一收费**；= 一次「思考」） |
| 免费透传 | `POST /v1/embeddings`、`POST /api/embeddings`（Ollama 原生）、`POST /v1/moderations`、`/api/*`（含 `/api/pull`）、`GET /healthz` |
| 计费路由头 | 请求带 `X-Agent-Id: <agentId>`（缺省回退 `DEFAULT_AGENT_ID`，SP1=`"0"`）→ 网关据此查 `costPerThink` 定价 |
| 首次无付款 | `402` + body `{ x402Version:1, error, accepts:[PaymentRequirements] }`（标准 x402 402） |
| 重试 | 带 `X-PAYMENT: <base64(PaymentPayload)>` 头 → 验款通过则 `200` + Ollama 补全；并设响应头 `X-PAYMENT-RESPONSE: <base64>` |
| 余额不足/验款失败 | 持续 `402`（同上 body）→ 计划 4 据「连续 402」判定**饥饿** |

### B. 执行器签名（计划 3 实现、计划 4 调用）—— 本计划**不实现**，仅冻结形状

`402→签名→重试`由 Convex 接缝编排：`llm.ts` 收到 402 后，把 `accepts[0]`（PaymentRequirements）交给执行器签名，拿回 `X-PAYMENT` 再重试。

```
POST {EXECUTOR_URL}/sign-payment
req : { agentId: string, paymentRequirements: PaymentRequirements }
resp: { xPayment: string }                       // base64(PaymentPayload)，直接当 X-PAYMENT 头
错误: 402/200 + { error: "insufficient_funds" }  // 余额不够无法签 → 计划 4 据此进入饥饿
```

### C. facilitator（本计划立起、网关调用）

x402 标准线格式：

```
POST {FACILITATOR_URL}/verify
req : { x402Version:1, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements }
resp: { isValid: boolean, invalidReason?: string, payer?: string }

POST {FACILITATOR_URL}/settle
req : { x402Version:1, paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements }
resp: { success: boolean, transaction?: string, network?: string, payer?: string, errorReason?: string }

GET  {FACILITATOR_URL}/supported   → { kinds: [{ x402Version:1, scheme:"exact", network:"base-sepolia" }] }
```

> **执行期校正（Task 8 立起真 facilitator 后 LIVE 验证 —— 计划 5 据此对齐）：**
> 实际 `OviatoHQ/x402-facilitator-hono` 是一个**可挂载 Hono 子应用库**（独立 server 在其
> `examples/node`），路由挂在 **`/facilitator` 前缀**下（`/facilitator/verify|settle|supported`），
> env 为 `EVM_PRIVATE_KEY` + `RPC_URL_BASE_SEPOLIA`（无 `SUPPORTED_NETWORK`）。其 `/supported`
> live 返回 **`x402Version: 2`**、网络 **CAIP-2 `eip155:84532`**（非本计划假定的 v1 / `"base-sepolia"`）。
> 因此：(1) `FACILITATOR_URL` 须含 `/facilitator` 前缀；(2) 本计划网关按 x402 **v1**/`"base-sepolia"`
> 实现并以 **mock facilitator** 完成单测/e2e（28/28 全绿、不依赖真链），**网关↔真 facilitator 的
> 版本/网络对齐留到计划 5**（届时用真 `/verify` 跑通来校验 v2 载荷字段后再改网关常量）。详见
> `services/facilitator/README.md` 与 `services/gateway/README.md` 的「计划 5 集成待办」。

### 复用计划 1 的链上事实（勿改）

- USDC（Base Sepolia）= `0x036CbD53842c5426634e7929541eC2318f3dCF7e`（6dec）；本地 anvil 用 `MockUSDC`。
- `AgentRegistry.agents(uint256) -> (token, wallet, costPerThink, floor, recoveryWindow, alive)`：网关的 `costPerThink` 与此同源（SP1 默认 `10000` = 0.01 USDC）。
- 收款金库 `payTo` = 网关金库地址（env `GATEWAY_TREASURY_ADDRESS`），计划 3/5 据此对账。

---

## 文件结构（本计划创建/修改）

```
services/gateway/
  package.json            — 网关服务依赖与脚本（隔离工程）
  tsconfig.json           — TS 配置（ESM, Node18）
  vitest.config.ts        — 测试配置
  .env.example            — 网关运行所需环境变量样例
  .gitignore              — 忽略 node_modules/ dist/
  src/
    x402.ts               — x402 v1 线格式类型 + X-PAYMENT base64 编解码
    pricing.ts            — PriceResolver + PaymentRequirements 构造（定价胶水）
    facilitatorClient.ts  — /verify /settle HTTP 客户端（Facilitator 接口，可 mock）
    settlementQueue.ts    — 内存批量结算队列（N 笔 / T 秒触发）
    paymentMiddleware.ts  — 402 挑战 + 验款 + 入队（自写中间件）
    proxy.ts              — 自写 Ollama 反向代理（流式：请求/响应双向 pipe）
    gateway.ts            — Express app 工厂（路由装配）
    index.ts              — 从 env 引导起服务
  test/
    x402.test.ts
    pricing.test.ts
    facilitatorClient.test.ts
    settlementQueue.test.ts
    paymentMiddleware.test.ts
    proxy.test.ts
    gateway.e2e.test.ts   — 端到端：402→付款→200；连续 402（饥饿）；免费透传
    helpers/
      stubUpstream.ts     — 进程内假 Ollama
      mockFacilitator.ts  — 进程内 Facilitator（verify/settle 可编排）
      signPayment.ts      — 构造测试用 PaymentPayload（无需真链）

services/facilitator/      — fork OviatoHQ/x402-facilitator-hono（Task 8 落地）
  .env.example            — RPC / settler key / 网络配置样例
  README.md               — WSL 立起 + 冒烟步骤

docs/superpowers/plans/2026-06-03-trumantown-sp1-02-gateway.md  — 本文件
```

修改：仓库根 `.gitignore` 追加 `services/*/node_modules/`、`services/*/dist/`、`services/facilitator/`（fork 不入库，用 README 复现）。

---

## Task 0：网关服务脚手架（WSL Node 18 隔离工程）

**Files:**
- Create: `services/gateway/package.json`, `services/gateway/tsconfig.json`, `services/gateway/vitest.config.ts`, `services/gateway/.gitignore`
- Modify: 仓库根 `.gitignore`

- [ ] **Step 1: 确认 WSL Node 18**

Run:
```bash
nvm use 18 || nvm install 18; node -v
```
Expected: 打印 `v18.x.x`。

- [ ] **Step 2: 写 `services/gateway/package.json`**

Create `services/gateway/package.json`:
```json
{
  "name": "trumantown-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^18.19.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: 写 `services/gateway/tsconfig.json`**

Create `services/gateway/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: 写 `services/gateway/vitest.config.ts`**

Create `services/gateway/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: 写 `services/gateway/.gitignore`**

Create `services/gateway/.gitignore`:
```
node_modules/
dist/
.env
```

- [ ] **Step 6: 仓库根 `.gitignore` 追加**

Append to repo-root `.gitignore`:
```
services/*/node_modules/
services/*/dist/
services/facilitator/
```

- [ ] **Step 7: 安装依赖**

Run:
```bash
cd "services/gateway" && npm install && cd ../..
```
Expected: `node_modules/` 生成，无 error。

- [ ] **Step 8: 核对 x402 类型来源（决定用本地镜像类型还是 SDK 规范类型）**

Run:
```bash
cd "services/gateway" && npm view x402 version && cd ../..
```
Expected: 打印一个版本号。**决策**：若团队希望与官方类型强绑定，可 `npm i x402` 并在 `src/x402.ts` 顶部改 `export type { PaymentRequirements, PaymentPayload } from 'x402/types'`；否则保留本计划的本地镜像类型（默认路径，零 API 风险）。本计划后续代码按**本地镜像类型**书写。

- [ ] **Step 9: Commit**

```bash
git add services/gateway/package.json services/gateway/tsconfig.json services/gateway/vitest.config.ts services/gateway/.gitignore .gitignore
git commit -m "chore(gateway): scaffold isolated WSL Node service (TS+Vitest)"
```

---

## Task 1：x402 线格式类型 + X-PAYMENT 编解码

**Files:**
- Create: `services/gateway/src/x402.ts`
- Test: `services/gateway/test/x402.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/gateway/test/x402.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encodePayment, decodePayment, X402_VERSION, type PaymentPayload } from '../src/x402.js';

const sample: PaymentPayload = {
  x402Version: X402_VERSION,
  scheme: 'exact',
  network: 'base-sepolia',
  payload: {
    signature: '0xdeadbeef',
    authorization: {
      from: '0x1111111111111111111111111111111111111111',
      to: '0x2222222222222222222222222222222222222222',
      value: '10000',
      validAfter: '0',
      validBefore: '99999999999',
      nonce: '0xabc',
    },
  },
};

describe('x402 payment header', () => {
  it('round-trips encode/decode', () => {
    const header = encodePayment(sample);
    expect(typeof header).toBe('string');
    expect(decodePayment(header)).toEqual(sample);
  });

  it('throws on malformed base64/json', () => {
    expect(() => decodePayment('!!!not-base64-json!!!')).toThrow();
  });

  it('throws when required fields missing', () => {
    const bad = Buffer.from(JSON.stringify({ x402Version: 1 }), 'utf8').toString('base64');
    expect(() => decodePayment(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/x402.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/x402.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/gateway/src/x402.ts`:
```ts
// x402 wire protocol v1 — local mirror of the `exact` (EIP-3009) scheme shapes.
// If the installed `x402` package exports equivalents, these may be replaced by
// `export type { PaymentRequirements, PaymentPayload } from 'x402/types'`.

export const X402_VERSION = 1 as const;

export interface PaymentRequirements {
  scheme: 'exact';
  network: string; // e.g. "base-sepolia"
  maxAmountRequired: string; // atomic USDC (6dec) as decimal string, e.g. "10000"
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string; // USDC contract address
  extra?: { name: string; version: string }; // EIP-712 domain for EIP-3009
}

export interface ExactEvmAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: 'exact';
  network: string;
  payload: { signature: string; authorization: ExactEvmAuthorization };
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
}

export function encodePayment(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}

export function decodePayment(header: string): PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new Error('X-PAYMENT is not valid base64 JSON');
  }
  const p = parsed as PaymentPayload;
  if (
    !p ||
    p.scheme !== 'exact' ||
    typeof p.network !== 'string' ||
    !p.payload ||
    typeof p.payload.signature !== 'string' ||
    !p.payload.authorization ||
    typeof p.payload.authorization.from !== 'string'
  ) {
    throw new Error('X-PAYMENT missing required exact-scheme fields');
  }
  return p;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/x402.test.ts; cd ../..
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/x402.ts services/gateway/test/x402.test.ts
git commit -m "feat(gateway): add x402 v1 wire types and X-PAYMENT codec"
```

---

## Task 2：定价胶水（PriceResolver + PaymentRequirements 构造）

**Files:**
- Create: `services/gateway/src/pricing.ts`
- Test: `services/gateway/test/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/gateway/test/pricing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { staticResolver, buildPaymentRequirements, type AgentPrice } from '../src/pricing.js';

const price: AgentPrice = {
  costPerThink: '10000', // 0.01 USDC (6dec)
  payTo: '0x000000000000000000000000000000000000dEaD',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  network: 'base-sepolia',
};

describe('pricing', () => {
  it('resolves a configured agent', () => {
    const resolve = staticResolver({ '0': price });
    expect(resolve('0')).toEqual(price);
  });

  it('falls back to default for unknown agent', () => {
    const resolve = staticResolver({ '0': price }, price);
    expect(resolve('7')).toEqual(price);
  });

  it('returns undefined when no match and no fallback', () => {
    const resolve = staticResolver({ '0': price });
    expect(resolve('7')).toBeUndefined();
  });

  it('builds x402 PaymentRequirements from a price + resource', () => {
    const req = buildPaymentRequirements(price, 'http://gw.local/v1/chat/completions');
    expect(req).toMatchObject({
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: '10000',
      payTo: price.payTo,
      asset: price.asset,
      resource: 'http://gw.local/v1/chat/completions',
      mimeType: 'application/json',
    });
    expect(req.maxTimeoutSeconds).toBeGreaterThan(0);
    expect(req.extra).toEqual({ name: 'USDC', version: '2' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/pricing.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/pricing.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/gateway/src/pricing.ts`:
```ts
import type { PaymentRequirements } from './x402.js';

export interface AgentPrice {
  costPerThink: string; // atomic USDC (6dec) decimal string
  payTo: string; // gateway treasury
  asset: string; // USDC address
  network: string; // "base-sepolia"
}

export type PriceResolver = (agentId: string) => AgentPrice | undefined;

/**
 * SP1 resolver: a static config map (single agent). Plan 5 may swap this for a
 * Ponder/registry-backed resolver without changing the middleware interface.
 */
export function staticResolver(
  config: Record<string, AgentPrice>,
  fallback?: AgentPrice,
): PriceResolver {
  return (agentId: string) => config[agentId] ?? fallback;
}

export function buildPaymentRequirements(
  price: AgentPrice,
  resource: string,
): PaymentRequirements {
  return {
    scheme: 'exact',
    network: price.network,
    maxAmountRequired: price.costPerThink,
    resource,
    description: 'TrumanTown metered inference: 1 think',
    mimeType: 'application/json',
    payTo: price.payTo,
    maxTimeoutSeconds: 120,
    asset: price.asset,
    extra: { name: 'USDC', version: '2' },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/pricing.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/pricing.ts services/gateway/test/pricing.test.ts
git commit -m "feat(gateway): add per-agent pricing glue and x402 requirements builder"
```

---

## Task 3：facilitator 客户端（/verify /settle）

**Files:**
- Create: `services/gateway/src/facilitatorClient.ts`
- Test: `services/gateway/test/facilitatorClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/gateway/test/facilitatorClient.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { httpFacilitator } from '../src/facilitatorClient.js';
import { X402_VERSION, type PaymentPayload, type PaymentRequirements } from '../src/x402.js';

let server: Server;
let baseUrl: string;
let lastBody: any;

const payload = { x402Version: X402_VERSION, scheme: 'exact', network: 'base-sepolia', payload: { signature: '0x', authorization: { from: '0xa', to: '0xb', value: '1', validAfter: '0', validBefore: '9', nonce: '0x1' } } } as PaymentPayload;
const requirements = { scheme: 'exact', network: 'base-sepolia', maxAmountRequired: '10000', resource: 'r', description: 'd', mimeType: 'application/json', payTo: '0xb', maxTimeoutSeconds: 120, asset: '0xusdc' } as PaymentRequirements;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastBody = JSON.parse(raw || '{}');
      res.setHeader('content-type', 'application/json');
      if (req.url === '/verify') res.end(JSON.stringify({ isValid: true, payer: '0xa' }));
      else if (req.url === '/settle') res.end(JSON.stringify({ success: true, transaction: '0xtx', payer: '0xa' }));
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('httpFacilitator', () => {
  it('verify posts x402 envelope and parses response', async () => {
    const f = httpFacilitator(baseUrl);
    const res = await f.verify(payload, requirements);
    expect(res).toEqual({ isValid: true, payer: '0xa' });
    expect(lastBody).toEqual({ x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements });
  });

  it('settle posts x402 envelope and parses response', async () => {
    const f = httpFacilitator(baseUrl);
    const res = await f.settle(payload, requirements);
    expect(res).toEqual({ success: true, transaction: '0xtx', payer: '0xa' });
  });

  it('throws on non-2xx', async () => {
    const f = httpFacilitator(`${baseUrl}/nope`);
    await expect(f.verify(payload, requirements)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/facilitatorClient.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/facilitatorClient.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/gateway/src/facilitatorClient.ts`:
```ts
import {
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
  type VerifyResponse,
  type SettleResponse,
} from './x402.js';

export interface Facilitator {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`facilitator ${url} responded ${r.status}`);
  return (await r.json()) as T;
}

export function httpFacilitator(baseUrl: string): Facilitator {
  const root = baseUrl.replace(/\/$/, '');
  return {
    verify: (paymentPayload, paymentRequirements) =>
      post<VerifyResponse>(`${root}/verify`, {
        x402Version: X402_VERSION,
        paymentPayload,
        paymentRequirements,
      }),
    settle: (paymentPayload, paymentRequirements) =>
      post<SettleResponse>(`${root}/settle`, {
        x402Version: X402_VERSION,
        paymentPayload,
        paymentRequirements,
      }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/facilitatorClient.test.ts; cd ../..
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/facilitatorClient.ts services/gateway/test/facilitatorClient.test.ts
git commit -m "feat(gateway): add facilitator HTTP client (verify/settle)"
```

---

## Task 4：内存批量结算队列（N 笔 / T 秒触发）

**Files:**
- Create: `services/gateway/src/settlementQueue.ts`
- Test: `services/gateway/test/settlementQueue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/gateway/test/settlementQueue.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettlementQueue, type QueueItem } from '../src/settlementQueue.js';
import type { Facilitator } from '../src/facilitatorClient.js';

const item = (n: number): QueueItem => ({
  payload: { x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: '0x' + n, authorization: { from: '0xa', to: '0xb', value: '1', validAfter: '0', validBefore: '9', nonce: '0x' + n } } },
  requirements: { scheme: 'exact', network: 'base-sepolia', maxAmountRequired: '10000', resource: 'r', description: 'd', mimeType: 'application/json', payTo: '0xb', maxTimeoutSeconds: 120, asset: '0xusdc' },
});

function fakeFacilitator() {
  const settle = vi.fn().mockResolvedValue({ success: true, transaction: '0xtx' });
  const verify = vi.fn().mockResolvedValue({ isValid: true });
  return { facilitator: { settle, verify } as unknown as Facilitator, settle };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SettlementQueue', () => {
  it('flushes immediately when batch size reached', async () => {
    const { facilitator, settle } = fakeFacilitator();
    const q = new SettlementQueue(facilitator, { maxBatch: 3, maxWaitMs: 60000 });
    q.enqueue(item(1));
    q.enqueue(item(2));
    expect(settle).not.toHaveBeenCalled();
    q.enqueue(item(3));
    await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(3));
    expect(q.size).toBe(0);
  });

  it('flushes on timer when batch not full', async () => {
    const { facilitator, settle } = fakeFacilitator();
    const q = new SettlementQueue(facilitator, { maxBatch: 10, maxWaitMs: 60000 });
    q.enqueue(item(1));
    expect(settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(0);
  });

  it('settle errors invoke onError and do not throw', async () => {
    const onError = vi.fn();
    const settle = vi.fn().mockRejectedValue(new Error('chain down'));
    const facilitator = { settle, verify: vi.fn() } as unknown as Facilitator;
    const q = new SettlementQueue(facilitator, { maxBatch: 1, maxWaitMs: 60000, onError });
    q.enqueue(item(1));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(q.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/settlementQueue.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/settlementQueue.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/gateway/src/settlementQueue.ts`:
```ts
import type { Facilitator } from './facilitatorClient.js';
import type { PaymentPayload, PaymentRequirements } from './x402.js';

export interface QueueItem {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
}

export interface SettlementQueueOptions {
  maxBatch: number;
  maxWaitMs: number;
  onError?: (err: unknown, item: QueueItem) => void;
}

/**
 * Defers on-chain settlement off the request path. Verify happens inline (instant);
 * settle is batched here — flushed when `maxBatch` accrues or `maxWaitMs` elapses,
 * whichever comes first. In-memory: a restart drops the un-settled queue, which is
 * acceptable for SP1 (the payment was already verified/"booked"; settle is the
 * on-chain catch-up). Plan 5 may persist this if needed.
 */
export class SettlementQueue {
  private items: QueueItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly facilitator: Facilitator,
    private readonly opts: SettlementQueueOptions,
  ) {}

  get size(): number {
    return this.items.length;
  }

  enqueue(item: QueueItem): void {
    this.items.push(item);
    if (this.items.length >= this.opts.maxBatch) {
      void this.flush();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => void this.flush(), this.opts.maxWaitMs);
    }
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.items.splice(0, this.items.length);
    await Promise.all(
      batch.map(async (it) => {
        try {
          await this.facilitator.settle(it.payload, it.requirements);
        } catch (err) {
          this.opts.onError?.(err, it);
        }
      }),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/settlementQueue.test.ts; cd ../..
```
Expected: PASS（3 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/settlementQueue.ts services/gateway/test/settlementQueue.test.ts
git commit -m "feat(gateway): add in-memory batch settlement queue (N/T trigger)"
```

---

## Task 5：自写付款中间件（402 挑战 + 验款 + 入队）

**Files:**
- Create: `services/gateway/src/paymentMiddleware.ts`
- Test: `services/gateway/test/paymentMiddleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/gateway/test/paymentMiddleware.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { paymentMiddleware } from '../src/paymentMiddleware.js';
import { SettlementQueue } from '../src/settlementQueue.js';
import { staticResolver, type AgentPrice } from '../src/pricing.js';
import { encodePayment, type PaymentPayload } from '../src/x402.js';
import type { Facilitator } from '../src/facilitatorClient.js';

const price: AgentPrice = { costPerThink: '10000', payTo: '0xbeef', asset: '0xusdc', network: 'base-sepolia' };

function buildApp(facilitator: Facilitator) {
  const queue = new SettlementQueue(facilitator, { maxBatch: 100, maxWaitMs: 60000 });
  const app = express();
  app.use(
    '/v1/chat/completions',
    paymentMiddleware({ resolve: staticResolver({ '0': price }, price), facilitator, queue, defaultAgentId: '0' }),
    (_req, res) => res.status(200).json({ ok: true }),
  );
  return { app, queue };
}

const payment = (): string =>
  encodePayment({ x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: '0xsig', authorization: { from: '0xa', to: '0xbeef', value: '10000', validAfter: '0', validBefore: '9999999999', nonce: '0x1' } } } as PaymentPayload);

describe('paymentMiddleware', () => {
  it('returns 402 with accepts when no X-PAYMENT', async () => {
    const facilitator = { verify: vi.fn(), settle: vi.fn() } as unknown as Facilitator;
    const { app } = buildApp(facilitator);
    const res = await request(app).post('/v1/chat/completions').send({ messages: [] });
    expect(res.status).toBe(402);
    expect(res.body.x402Version).toBe(1);
    expect(res.body.accepts[0].maxAmountRequired).toBe('10000');
    expect(res.body.accepts[0].payTo).toBe('0xbeef');
  });

  it('returns 402 again when facilitator says invalid (insufficient funds)', async () => {
    const facilitator = { verify: vi.fn().mockResolvedValue({ isValid: false, invalidReason: 'insufficient_funds' }), settle: vi.fn() } as unknown as Facilitator;
    const { app, queue } = buildApp(facilitator);
    const res = await request(app).post('/v1/chat/completions').set('X-PAYMENT', payment()).send({ messages: [] });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('insufficient_funds');
    expect(queue.size).toBe(0);
  });

  it('passes to next() and enqueues settlement when valid', async () => {
    const facilitator = { verify: vi.fn().mockResolvedValue({ isValid: true, payer: '0xa' }), settle: vi.fn() } as unknown as Facilitator;
    const { app, queue } = buildApp(facilitator);
    const res = await request(app).post('/v1/chat/completions').set('X-PAYMENT', payment()).send({ messages: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['x-payment-response']).toBeTruthy();
    expect(queue.size).toBe(1);
  });

  it('returns 402 on malformed X-PAYMENT', async () => {
    const facilitator = { verify: vi.fn(), settle: vi.fn() } as unknown as Facilitator;
    const { app } = buildApp(facilitator);
    const res = await request(app).post('/v1/chat/completions').set('X-PAYMENT', 'garbage').send({});
    expect(res.status).toBe(402);
    expect(facilitator.verify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/paymentMiddleware.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/paymentMiddleware.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/gateway/src/paymentMiddleware.ts`:
```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { X402_VERSION, decodePayment } from './x402.js';
import { buildPaymentRequirements, type PriceResolver } from './pricing.js';
import type { Facilitator } from './facilitatorClient.js';
import type { SettlementQueue } from './settlementQueue.js';

export interface PaymentMiddlewareDeps {
  resolve: PriceResolver;
  facilitator: Facilitator;
  queue: SettlementQueue;
  defaultAgentId: string;
}

export function paymentMiddleware(deps: PaymentMiddlewareDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const agentId = (req.header('x-agent-id') ?? deps.defaultAgentId).trim();
    const price = deps.resolve(agentId);
    if (!price) {
      res.status(500).json({ error: `no pricing configured for agent ${agentId}` });
      return;
    }

    const resource = `${req.protocol}://${req.get('host') ?? 'gateway'}${req.originalUrl}`;
    const requirements = buildPaymentRequirements(price, resource);

    const header = req.header('x-payment');
    if (!header) {
      res
        .status(402)
        .json({ x402Version: X402_VERSION, error: 'X-PAYMENT header is required', accepts: [requirements] });
      return;
    }

    let payload;
    try {
      payload = decodePayment(header);
    } catch {
      res
        .status(402)
        .json({ x402Version: X402_VERSION, error: 'malformed X-PAYMENT', accepts: [requirements] });
      return;
    }

    let verifyRes;
    try {
      verifyRes = await deps.facilitator.verify(payload, requirements);
    } catch {
      res.status(502).json({ error: 'facilitator verify failed' });
      return;
    }

    if (!verifyRes.isValid) {
      res.status(402).json({
        x402Version: X402_VERSION,
        error: verifyRes.invalidReason ?? 'payment invalid',
        accepts: [requirements],
      });
      return;
    }

    // Verified instantly; defer on-chain settlement to the batch queue.
    deps.queue.enqueue({ payload, requirements });
    res.setHeader(
      'x-payment-response',
      Buffer.from(JSON.stringify({ settlement: 'queued', payer: verifyRes.payer }), 'utf8').toString('base64'),
    );
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/paymentMiddleware.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/paymentMiddleware.ts services/gateway/test/paymentMiddleware.test.ts
git commit -m "feat(gateway): add self-written x402 payment middleware (402/verify/enqueue)"
```

---

## Task 6：自写 Ollama 反向代理（流式双向 pipe）

**Files:**
- Create: `services/gateway/src/proxy.ts`
- Test: `services/gateway/test/proxy.test.ts`, `services/gateway/test/helpers/stubUpstream.ts`

- [ ] **Step 1: Write the stub upstream helper**

Create `services/gateway/test/helpers/stubUpstream.ts`:
```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubUpstream {
  url: string;
  requests: { method: string; url: string; body: string; headers: Record<string, string | string[] | undefined> }[];
  close: () => Promise<void>;
}

/** A tiny fake Ollama that echoes the request path/body so the proxy can be asserted. */
export async function startStubUpstream(): Promise<StubUpstream> {
  const requests: StubUpstream['requests'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method!, url: req.url!, body, headers: req.headers });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ echoUrl: req.url, echoBody: body }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `services/gateway/test/proxy.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeProxy } from '../src/proxy.js';
import { startStubUpstream, type StubUpstream } from './helpers/stubUpstream.js';

let upstream: StubUpstream;
let app: express.Express;

beforeAll(async () => {
  upstream = await startStubUpstream();
  app = express();
  const proxy = makeProxy(upstream.url);
  app.use('/api', proxy);
  app.use('/v1/chat/completions', proxy);
});

afterAll(() => upstream.close());

describe('makeProxy', () => {
  it('forwards path and body to upstream and returns its response', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('content-type', 'application/json')
      .send({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(200);
    expect(res.body.echoUrl).toBe('/v1/chat/completions');
    expect(JSON.parse(res.body.echoBody).model).toBe('llama3');
  });

  it('forwards free native ollama path (/api/embeddings)', async () => {
    const res = await request(app).post('/api/embeddings').set('content-type', 'application/json').send({ model: 'mxbai', prompt: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.echoUrl).toBe('/api/embeddings');
  });

  it('does not forward gateway-internal headers', async () => {
    await request(app).post('/api/embeddings').set('X-PAYMENT', 'secret').set('X-Agent-Id', '0').send({});
    const last = upstream.requests.at(-1)!;
    expect(last.headers['x-payment']).toBeUndefined();
    expect(last.headers['x-agent-id']).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/proxy.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/proxy.js'`。

- [ ] **Step 4: Write minimal implementation**

Create `services/gateway/src/proxy.ts`:
```ts
import type { Request, Response, RequestHandler } from 'express';
import { Readable } from 'node:stream';

const HOP_BY_HOP = new Set([
  'host',
  'content-length',
  'connection',
  'x-payment',
  'x-agent-id',
]);

/**
 * Minimal streaming reverse proxy to Ollama. Forwards the original URL, streams
 * the request body (so chat prompts aren't buffered) and pipes the upstream
 * response back (so SSE streaming works). The gateway never JSON-parses bodies,
 * which keeps `req` a readable stream.
 */
export function makeProxy(target: string): RequestHandler {
  const root = target.replace(/\/$/, '');
  return async (req: Request, res: Response) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k) && typeof v === 'string') headers[k] = v;
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${root}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        // @ts-expect-error duplex is required by Node fetch for a streaming body
        duplex: 'half',
      });
    } catch {
      res.status(502).json({ error: 'upstream (ollama) unreachable' });
      return;
    }

    res.status(upstream.status);
    upstream.headers.forEach((val, key) => {
      if (key !== 'content-encoding' && key !== 'transfer-encoding') res.setHeader(key, val);
    });
    if (upstream.body) {
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } else {
      res.end();
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/proxy.test.ts; cd ../..
```
Expected: PASS（3 passed）。

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/proxy.ts services/gateway/test/proxy.test.ts services/gateway/test/helpers/stubUpstream.ts
git commit -m "feat(gateway): add streaming Ollama reverse proxy"
```

---

## Task 7：网关装配 + 端到端（402→付款→200；连续 402 饥饿；免费透传）

**Files:**
- Create: `services/gateway/src/gateway.ts`, `services/gateway/src/index.ts`
- Test: `services/gateway/test/gateway.e2e.test.ts`, `services/gateway/test/helpers/mockFacilitator.ts`, `services/gateway/test/helpers/signPayment.ts`

- [ ] **Step 1: Write the test helpers**

Create `services/gateway/test/helpers/mockFacilitator.ts`:
```ts
import type { Facilitator } from '../../src/facilitatorClient.js';

/**
 * In-process facilitator. `richPayers` are addresses whose verify() returns valid;
 * everyone else is treated as insufficient funds. settle() records calls.
 */
export function mockFacilitator(richPayers: string[]) {
  const settled: string[] = [];
  const rich = new Set(richPayers.map((a) => a.toLowerCase()));
  const facilitator: Facilitator = {
    async verify(payload) {
      const from = payload.payload.authorization.from.toLowerCase();
      return rich.has(from) ? { isValid: true, payer: from } : { isValid: false, invalidReason: 'insufficient_funds', payer: from };
    },
    async settle(payload) {
      settled.push(payload.payload.signature);
      return { success: true, transaction: '0xtx', payer: payload.payload.authorization.from };
    },
  };
  return { facilitator, settled };
}
```

Create `services/gateway/test/helpers/signPayment.ts`:
```ts
import { encodePayment, type PaymentPayload } from '../../src/x402.js';

/** Builds an X-PAYMENT header value for a given payer (no real chain needed; the
 *  mock facilitator decides validity by `from`). */
export function fakeXPayment(from: string, payTo: string, value = '10000'): string {
  const payload: PaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: 'base-sepolia',
    payload: {
      signature: '0x' + Math.random().toString(16).slice(2),
      authorization: { from, to: payTo, value, validAfter: '0', validBefore: '9999999999', nonce: '0x' + Math.random().toString(16).slice(2) },
    },
  };
  return encodePayment(payload);
}
```

- [ ] **Step 2: Write the failing end-to-end test**

Create `services/gateway/test/gateway.e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createGateway } from '../src/gateway.js';
import { staticResolver, type AgentPrice } from '../src/pricing.js';
import { SettlementQueue } from '../src/settlementQueue.js';
import { startStubUpstream, type StubUpstream } from './helpers/stubUpstream.js';
import { mockFacilitator } from './helpers/mockFacilitator.js';
import { fakeXPayment } from './helpers/signPayment.js';

const PAY_TO = '0x000000000000000000000000000000000000beef';
const RICH = '0x000000000000000000000000000000000000a11ce';
const POOR = '0x0000000000000000000000000000000000000dead';
const price: AgentPrice = { costPerThink: '10000', payTo: PAY_TO, asset: '0xusdc', network: 'base-sepolia' };

let upstream: StubUpstream;

beforeAll(async () => {
  upstream = await startStubUpstream();
});
afterAll(() => upstream.close());

function makeApp(richPayers: string[]) {
  const { facilitator, settled } = mockFacilitator(richPayers);
  const queue = new SettlementQueue(facilitator, { maxBatch: 1, maxWaitMs: 60000 });
  const app = createGateway({
    resolve: staticResolver({ '0': price }, price),
    facilitator,
    queue,
    ollamaUpstream: upstream.url,
    defaultAgentId: '0',
  });
  return { app, settled, queue };
}

describe('gateway end-to-end', () => {
  it('402 first, then 200 after a valid payment, and settles', async () => {
    const { app, settled } = makeApp([RICH]);

    const first = await request(app).post('/v1/chat/completions').send({ messages: [] });
    expect(first.status).toBe(402);
    expect(first.body.accepts[0].maxAmountRequired).toBe('10000');

    const paid = await request(app)
      .post('/v1/chat/completions')
      .set('X-PAYMENT', fakeXPayment(RICH, PAY_TO))
      .send({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] });
    expect(paid.status).toBe(200);
    expect(paid.body.echoUrl).toBe('/v1/chat/completions');
    await new Promise((r) => setTimeout(r, 10)); // let the size-1 queue flush
    expect(settled.length).toBe(1);
  });

  it('persistent 402 when payer is starving (insufficient funds)', async () => {
    const { app, settled } = makeApp([RICH]); // POOR not rich
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/v1/chat/completions')
        .set('X-PAYMENT', fakeXPayment(POOR, PAY_TO))
        .send({ messages: [] });
      expect(res.status).toBe(402);
      expect(res.body.error).toBe('insufficient_funds');
    }
    expect(settled.length).toBe(0);
  });

  it('free passthrough: embeddings need no payment', async () => {
    const { app } = makeApp([]);
    const res = await request(app).post('/api/embeddings').send({ model: 'mxbai', prompt: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.echoUrl).toBe('/api/embeddings');
  });

  it('healthz is open', async () => {
    const { app } = makeApp([]);
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/gateway.e2e.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/gateway.js'`。

- [ ] **Step 4: Write `gateway.ts` (app factory)**

Create `services/gateway/src/gateway.ts`:
```ts
import express, { type Express } from 'express';
import { paymentMiddleware } from './paymentMiddleware.js';
import { makeProxy } from './proxy.js';
import type { PriceResolver } from './pricing.js';
import type { Facilitator } from './facilitatorClient.js';
import type { SettlementQueue } from './settlementQueue.js';

export interface GatewayDeps {
  resolve: PriceResolver;
  facilitator: Facilitator;
  queue: SettlementQueue;
  ollamaUpstream: string;
  defaultAgentId: string;
}

export function createGateway(deps: GatewayDeps): Express {
  const app = express();
  const proxy = makeProxy(deps.ollamaUpstream);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // PAID: the only metered endpoint = one "think".
  app.use(
    '/v1/chat/completions',
    paymentMiddleware({
      resolve: deps.resolve,
      facilitator: deps.facilitator,
      queue: deps.queue,
      defaultAgentId: deps.defaultAgentId,
    }),
    proxy,
  );

  // FREE passthrough: embeddings (OpenAI-compat + Ollama native), moderation, native /api/*.
  app.use('/v1/embeddings', proxy);
  app.use('/v1/moderations', proxy);
  app.use('/api', proxy);

  return app;
}
```

- [ ] **Step 5: Write `index.ts` (bootstrap from env)**

Create `services/gateway/src/index.ts`:
```ts
import { createGateway } from './gateway.js';
import { staticResolver, type AgentPrice } from './pricing.js';
import { httpFacilitator } from './facilitatorClient.js';
import { SettlementQueue, type QueueItem } from './settlementQueue.js';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

const price: AgentPrice = {
  costPerThink: env('DEFAULT_COST_PER_THINK', '10000'),
  payTo: env('GATEWAY_TREASURY_ADDRESS'),
  asset: env('USDC_ADDRESS', '0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
  network: env('X402_NETWORK', 'base-sepolia'),
};

const facilitator = httpFacilitator(env('FACILITATOR_URL', 'http://127.0.0.1:8403'));

const queue = new SettlementQueue(facilitator, {
  maxBatch: Number(env('SETTLE_MAX_BATCH', '10')),
  maxWaitMs: Number(env('SETTLE_MAX_WAIT_MS', '60000')),
  onError: (err: unknown, item: QueueItem) =>
    console.error('[settle] failed for', item.payload.payload.signature, err),
});

const app = createGateway({
  resolve: staticResolver({ '0': price }, price),
  facilitator,
  queue,
  ollamaUpstream: env('OLLAMA_UPSTREAM', 'http://127.0.0.1:11434'),
  defaultAgentId: env('DEFAULT_AGENT_ID', '0'),
});

const port = Number(env('PORT', '8402'));
app.listen(port, () => console.log(`[gateway] x402 metered inference on :${port}`));
```

- [ ] **Step 6: Run the e2e test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/gateway.e2e.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 7: Run the full gateway suite + typecheck**

Run:
```bash
cd "services/gateway" && npx vitest run && npm run typecheck; cd ../..
```
Expected: 全部 PASS（x402 3 + pricing 4 + facilitatorClient 3 + settlementQueue 3 + paymentMiddleware 4 + proxy 3 + e2e 4 = 24 passed）；`tsc --noEmit` 无错误。

- [ ] **Step 8: Commit**

```bash
git add services/gateway/src/gateway.ts services/gateway/src/index.ts services/gateway/test/gateway.e2e.test.ts services/gateway/test/helpers/mockFacilitator.ts services/gateway/test/helpers/signPayment.ts
git commit -m "feat(gateway): wire app + e2e (402->pay->200, starvation, free passthrough)"
```

---

## Task 8：自托管 facilitator 立起（fork OviatoHQ/x402-facilitator-hono）

> facilitator 不入库（根 `.gitignore` 已忽略 `services/facilitator/`）；用 `.env.example` + `README.md` 复现。其 `/settle` 真正上链的端到端集成放到计划 5（需有 gas 的 settler 钱包 + Base Sepolia）。本任务只确保**网关依赖的 `/verify`、`/settle`、`/supported` 端点存在且能应答**。

**Files:**
- Create: `services/facilitator/.env.example`, `services/facilitator/README.md`

- [ ] **Step 1: clone fork 基底**

Run:
```bash
cd services && git clone https://github.com/OviatoHQ/x402-facilitator-hono.git facilitator && cd facilitator && rm -rf .git && cd ../..
```
Expected: `services/facilitator/` 出现源码（含 `package.json`）。若该仓库结构/端点名与下文不符，**以其 README 为准**调整 `.env` 键名与启动命令（见 Step 3 备注）。

- [ ] **Step 2: 安装依赖**

Run:
```bash
cd "services/facilitator" && npm install && cd ../..
```
Expected: 安装成功。

- [ ] **Step 3: 写 `.env.example`（按 fork README 校正键名）**

Create `services/facilitator/.env.example`:
```
# Base Sepolia RPC（自托管时可用公共端点；高频建议自有节点）
RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
# settle 上链用的 settler 私钥（需有少量 Base Sepolia ETH 付 gas）。
# 仅 /settle 需要；/verify 不需要。计划 5 集成时填真值，本任务可用 anvil 私钥占位。
SETTLER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# 支持的网络与方案
SUPPORTED_NETWORK=base-sepolia
PORT=8403
```
> 备注：`OviatoHQ/x402-facilitator-hono` 的实际环境变量名以其 README 为准（常见为 `PRIVATE_KEY` / `EVM_PRIVATE_KEY` / `RPC_URL`）。clone 后先读其 README，把上面键名一一对应改正，再继续。

- [ ] **Step 4: 启动 facilitator（后台保持运行）**

Run（另开一个 WSL 终端，或后台）:
```bash
cd "services/facilitator" && cp .env.example .env && PORT=8403 npm run start
```
Expected: 打印监听 `:8403`（具体脚本名以 fork 的 `package.json` 为准，可能是 `dev`/`start`）。

- [ ] **Step 5: 冒烟验证网关依赖的端点存在**

Run（再开一个终端）:
```bash
curl -s http://127.0.0.1:8403/supported
curl -s -X POST http://127.0.0.1:8403/verify -H 'content-type: application/json' -d '{"x402Version":1,"paymentPayload":{},"paymentRequirements":{}}'
```
Expected:
- `/supported` 返回包含 `base-sepolia` + `exact` 的 `kinds` 列表。
- `/verify` 对空载荷返回**结构化**响应（`{ isValid:false, invalidReason:... }` 或 4xx + JSON），证明端点在线并解析输入。
> 若端点路径不同（如 `/v1/verify`），记录实际路径并在网关 `FACILITATOR_URL` 或 `facilitatorClient` 的拼接处对齐——但**优先**让 fork 暴露标准 `/verify` `/settle` 以符合本计划「锚定接口 C」。

- [ ] **Step 6: 写 facilitator README（WSL 复现步骤）**

Create `services/facilitator/README.md`:
```markdown
# 自托管 x402 facilitator（TrumanTown SP1）

基底：fork 自 `OviatoHQ/x402-facilitator-hono`（不入库）。提供网关依赖的
`/verify`、`/settle`、`/supported`，指向 Base Sepolia。

## WSL 复现

    cd services
    git clone https://github.com/OviatoHQ/x402-facilitator-hono.git facilitator
    cd facilitator && rm -rf .git && npm install
    cp .env.example .env   # 按本仓 .env.example 填 RPC / settler key（键名以本 fork README 为准）
    PORT=8403 npm run start

## 网关对接

网关 `FACILITATOR_URL=http://127.0.0.1:8403`。`/verify` 即时（无需 gas）；
`/settle` 需 settler 钱包有 Base Sepolia ETH。批量由网关侧 SettlementQueue 驱动
（每 N=10 笔或 60s 触发）。

## 边界

- `/settle` 上链端到端集成 = 计划 5（需 funded settler + Base Sepolia）。
- 本服务不定价；定价在网关（按 costPerThink）。
```

- [ ] **Step 7: Commit**

```bash
git add services/facilitator/.env.example services/facilitator/README.md
git commit -m "feat(facilitator): stand up self-hosted x402 facilitator (Base Sepolia)"
```

---

## Task 9：网关运行手册 + .env.example + README

**Files:**
- Create: `services/gateway/.env.example`, `services/gateway/README.md`

- [ ] **Step 1: 写网关 `.env.example`**

Create `services/gateway/.env.example`:
```
# 网关监听端口
PORT=8402
# Ollama 上游（反向代理目标）
OLLAMA_UPSTREAM=http://127.0.0.1:11434
# 自托管 facilitator
FACILITATOR_URL=http://127.0.0.1:8403
# x402 定价（SP1 单居民）
X402_NETWORK=base-sepolia
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
GATEWAY_TREASURY_ADDRESS=0x0000000000000000000000000000000000000000
DEFAULT_AGENT_ID=0
DEFAULT_COST_PER_THINK=10000
# 批量结算触发（先到先发）
SETTLE_MAX_BATCH=10
SETTLE_MAX_WAIT_MS=60000
```

- [ ] **Step 2: 写网关 README（含计划 4 接缝指引）**

Create `services/gateway/README.md`:
```markdown
# x402 计量推理网关（TrumanTown SP1 · 计划 2/5）

挡在 Ollama 前面：每次 `chat completion` 按居民 `costPerThink` 定价为真实 USDC。
首次 `402 + 付款要求`；带 `X-PAYMENT` 重试 → facilitator 即时验款 → 反向代理转发
Ollama → 返回；已验款项入内存队列，每 N=10 笔或 60s 批量 settle 上链。

## WSL 运行（Node 18）

    cd services/gateway
    nvm use 18
    npm install
    cp .env.example .env   # 填 GATEWAY_TREASURY_ADDRESS 等
    npm run start          # :8402

依赖：facilitator 在 :8403（见 ../facilitator/README.md）、Ollama 在 :11434。

## 测试

    npm test          # 全部单测 + e2e（用 mock facilitator + stub Ollama，无需真链）

## 计费 / 免费

- 计费：`POST /v1/chat/completions`（= 一次思考）。
- 免费透传：`/v1/embeddings`、`/api/*`（含 `/api/embeddings`、`/api/pull`）、`/v1/moderations`、`GET /healthz`。

## 计划 4（Convex 接缝）对接

在 `convex/util/llm.ts`：
1. 让 chat 出口指向本网关：`OLLAMA_HOST=http://127.0.0.1:8402`（embeddings 走同一 host 的免费 `/api/embeddings`）。
2. chat 请求加头 `X-Agent-Id: <agentId>`（SP1 用 "0"）。
3. 收到 `402` 时，取 body `accepts[0]`（PaymentRequirements），调执行器
   `POST {EXECUTOR_URL}/sign-payment {agentId, paymentRequirements}` 拿 `xPayment`，
   设 `X-PAYMENT: <xPayment>` 头重试该请求。
4. 执行器返回 `insufficient_funds` 或重试仍持续 `402` → 判定**饥饿**（进入抢救窗口）。

> 网关不持钱包、不签名；签名方永远是居民的 CDP 钱包（执行器，计划 3）。
```

- [ ] **Step 3: Commit**

```bash
git add services/gateway/.env.example services/gateway/README.md
git commit -m "docs(gateway): add .env.example and runbook with llm.ts seam guide"
```

---

## 后续计划（SP1 其余 3 个计划，本计划完成后各自再用 writing-plans 展开）

- **计划 3/5：执行器（AgentKit + CDP 智能钱包）**——实现「锚定接口 B」`POST /sign-payment`：用居民 CDP 钱包对 `PaymentRequirements` 签 EIP-3009 授权 → 返回 `X-PAYMENT`；并作链上动作（`AgentToken.buy/sell`）。钱包 = `AgentRegistry.wallet`。
- **计划 4/5：Convex 经济模块**——按本计划 README「计划 4 对接」改 `llm.ts` 接缝（指向网关、加 `X-Agent-Id`、402→执行器签名→重试、连续 402=饥饿）；感知 Ponder 数据 + 生存目标栈。
- **计划 5/5：Ponder 索引器 + 集成**——索引 `Bought/Sold/AgentSpawned/AgentDied`；facilitator `/settle` 端到端上链集成（funded settler + Base Sepolia）；跑通「饥饿→卖币→复活」与「饥饿→死亡」两条脚本。

本计划冻结的三个 HTTP 契约（网关对外 A / 执行器签名 B / facilitator C）为上述计划的对齐基准，勿改签名。

---

## 自检（writing-plans Self-Review）

- **Spec 覆盖（设计稿 §3.2/§3.6/§4/§7）：**
  - §3.2「OLLAMA_HOST→网关、x402 计量、402→X-PAYMENT 重试→验款→反向代理→返回、余额不足持续 402、自写=反向代理+定价胶水」→ Task 2/5/6/7 + README 接缝指引 ✅
  - §3.2/§3.6「自托管 facilitator（OviatoHQ fork）、verify/settle、Base Sepolia」→ Task 3（客户端）+ Task 8（立起）✅
  - §4「验款即时、结算批量（每 N 次上链）」→ Task 4 + Task 5（验款入队、settle 不在请求路径）✅
  - §7「网关单元 402/验款/结算路径用 mock facilitator；余额不足拒绝服务」→ Task 5 + Task 7 e2e（持续 402 饥饿）✅
  - §3.6「仅 chat 收费；embeddings 免费」（已锁定 Q2）→ Task 7 路由装配（`/api/*`、`/v1/embeddings` 免费）✅
- **Placeholder 扫描：** 无 TBD/TODO；每个代码步骤含完整可运行代码。Task 8 对外部 fork 的依赖以「按 README 校正键名」标注 + 冒烟验证步骤兜底（非占位，而是真实外部依赖的对齐动作）。
- **类型一致性：** `PaymentRequirements`/`PaymentPayload`/`VerifyResponse`/`SettleResponse`（x402.ts）、`AgentPrice`/`PriceResolver`（pricing.ts）、`Facilitator`（facilitatorClient.ts）、`QueueItem`/`SettlementQueue`（settlementQueue.ts）、`PaymentMiddlewareDeps`、`GatewayDeps` 全计划一致引用；测试 helper 与 src 类型同名同形。
- **决策一致性：** 四项锁定决策（Convex 接缝编排 / 仅 chat 收费 / OviatoHQ fork / 内存队列 N=10·60s）逐一落到 README 接缝指引、Task 7 路由、Task 8、Task 4。

---

_本计划为 SP1 计划 2/5（x402 计量推理网关 + 自托管 facilitator）。完成后进入 subagent-driven-development 或 executing-plans 执行。_
