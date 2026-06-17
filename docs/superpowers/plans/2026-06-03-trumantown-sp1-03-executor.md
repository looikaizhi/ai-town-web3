# 楚门镇 SP1 · 计划 3/5：执行器 = Coinbase AgentKit + CDP 智能钱包 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 WSL 内实现一个内嵌 Coinbase AgentKit + CDP 钱包的执行器服务——为每个居民持有**双密钥**（CDP 智能账户作链上身份/交易，CDP EOA Server Account 作 x402 付款方），对外实现计划 2 冻结的接口 B `POST /sign-payment`（用 EOA 对 PaymentRequirements 签 EIP-3009、原生 **x402 v2 / `eip155:84532`**、经官方 x402 客户端原语出 X-PAYMENT），以及链上动作 `AgentToken.buy/sell` / `transfer`（智能账户 + spend-permission 护栏 + gasless/faucet）与余额查询；并把计划 2 网关的 x402 版本/网络常量前移对齐到 v2/`eip155:84532`，让整条 WSL 链路版本一致。

**Architecture:** 第三个**隔离**的 WSL 本地 Node 服务 `services/executor/`（端口 8404），与 `gateway/`（8402）、`facilitator/`（8403）平级，各自 `package.json`/`node_modules`。**双密钥模型**：CDP 智能账户 = `AgentRegistry.wallet`，常态持有 USDC（回购/买他币/持有）并执行 `buy/sell/transfer`，目标恒为推高 marketCap（Standing），受护栏（单笔上限 + 合约白名单）约束、gasless（paymaster）；CDP EOA 持 USDC、是每次思考的 x402 付款方/签名方，`energy = EOA USDC / costPerThink` = 瞬时思考预算。**执行器只是机械杠杆提供者**——不做经济/生存决策：`/sign-payment` 在 EOA USDC 不足时返回 `insufficient_funds`（是「此刻付不起」的事实，**不是死亡判决**）；卖币求生与饥饿判定属计划 4。核心逻辑（HTTP 路由、签名前余额校验、护栏、余额聚合）经两个接缝（`WalletProvider` + `PaymentSigner`）注入**进程内假实现**做 TDD 单测/e2e，**零云调用、不动真实资金**；真实 CDP/AgentKit/x402 适配器是唯一云耦合部分，由一个**可选 LIVE 冒烟**（CDP 密钥 gate）对**真 facilitator `/verify`** 校验 v2 载荷——这与计划 2 对 facilitator「fork + 冒烟、不深度单测」的处理同源。

**Tech Stack:** Node 18（WSL 原生，nvm）· TypeScript · Express · `@coinbase/agentkit` + `@coinbase/cdp-sdk`（CDP 智能账户/EOA、gasless、faucet、spend-permission）· `x402`（官方客户端 exact-EVM 原语，v2/`eip155:84532`）· `viem`（链上只读 + 类型）· Vitest + Supertest（TDD）· `tsx`（dev runner）。

---

## ⛔ 运行环境（贯穿全计划，务必遵守）

- 本计划所有 Node/npm/服务进程**只在 WSL Ubuntu 内运行**。Bash 工具是 Windows Git Bash(MINGW)，**不是** Linux；内联 `wsl bash -lc '...npm...'` 不可靠。
- **可靠配方（项目记忆 `wsl-node-toolchain.md`）**：把命令写进 `scripts/_cmd.sh`（untracked 草稿，**勿 git add**），前两行固定：
  ```
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null
  cd "/mnt/d/AI Agent/ai-town-web3/services/executor"
  ```
  再用 Bash 工具执行：
  `wsl.exe -d Ubuntu bash -lc 'sed -i "s/\r//" "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh"; bash "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh"'`
  本计划下文每个 **Run** 块给出的是**逻辑命令**（如 `cd services/executor && npx vitest run test/x402.test.ts`），执行时按上述配方包一层。
- **文件一律用 Write/Edit 写**（Windows 路径 `d:\AI Agent\ai-town-web3\...`），不要用 shell heredoc/echo 造文件。
- **git 用 Windows 原生**（Bash 工具：`cd "d:/AI Agent/ai-town-web3" && git ...`），勿走 WSL。
- 在分支 `feat/sp1-executor` 上工作，**不要直接写 main**。执行用 subagent-driven-development，每个任务两阶段审查（spec 合规 → 代码质量）。

---

## 设计说明（对设计稿/锁定决策的诚实细化）

设计稿 §3.3 写「执行器 = AgentKit 宿主，持 CDP 智能钱包，作 x402 付款方 + 链上动作」。落到可 TDD 的实现时，本计划据 brainstorm 已确认的四项决策细化如下，均为既定决策直接推导：

1. **双密钥（智能账户 + EOA）。** x402 `exact` 方案的 EIP-3009 验签对 **EOA 的 ECDSA 签名**支持最稳；智能账户的 ERC-1271 付款方在真 facilitator/`@x402` 端支持度不确定（联调高发失败区）。故 x402 付款方用 **CDP EOA Server Account**；智能账户专作链上身份（`AgentRegistry.wallet`）、交易与护栏宿主。两者均由执行器为居民托管。

2. **官方原语签名，不手写 EIP-712。** EIP-712 域分隔符/签名格式必须与真 facilitator 的 `/verify` 逐字节一致；故委托 `x402` 包的 exact-EVM 客户端原语（把 EOA 暴露为 viem 兼容 signer），不自造 typed-data。这与计划 1「以开源曲线为数学参考、clean-room 实现」、计划 2「自写定价胶水但保留 x402 线协议不变」的取舍同源——**自写边界只到机械编排，密码学交给标准库**。

3. **原生 v2 + 前移网关对齐。** 真 facilitator（计划 2 Task 8 LIVE 验证）用 x402 **v2** / CAIP-2 **`eip155:84532`** / `/facilitator` 前缀。执行器原生产出 v2 载荷；同时把计划 2 网关的 `X402_VERSION`/网络常量**前移**升到 v2/`eip155:84532`（Task 10，**严格限定常量 + 测试夹具，不重写逻辑**），让整条 WSL 链路从本计划起即 v2 一致。注意：本地 e2e 仍用 **mock facilitator**（版本字段只是标签），**真 v2 线载荷字段的保真校验由执行器的可选 LIVE 冒烟对真 `/verify` 完成**；网关↔真 facilitator 的端到端仍按 README 留待计划 5。

4. **执行器无经济决策。** 设计稿 §5「执行器适配 = 把 LLM 决策转成 HTTP 调用」。本计划据此把执行器实现为**纯机械杠杆**：签名/买/卖/转账/查余额各是无脑动作；何时卖币求生、何时判饥饿由计划 4 的生存目标栈编排。`energy = EOA USDC`（瞬时预算）与「饥饿 = 全盘无法换钱」（计划 4 的高层判决）不冲突。

**云耦合边界：** 真实 CDP/AgentKit/x402 适配器（Task 9）是唯一依赖 CDP 云端密钥与真链的部分，**不进单测**，由可选 LIVE 冒烟验证——与计划 2 facilitator 处理同源。Task 0 含一步：核对已安装的 `x402`/`@coinbase/cdp-sdk`/`@coinbase/agentkit` 实际导出，若与本计划参考代码的函数名不同则就地绑定（verify-then-adapt）。

---

## 锚定接口（本计划冻结接口 B′；A/C 复用计划 2、链上 ABI 复用计划 1）

### B′. 执行器对外 HTTP 契约（计划 4 调用、计划 5 联调；勿改签名）

| 端点 | 请求 | 响应 |
|---|---|---|
| `POST /sign-payment` | `{ agentId: string, paymentRequirements: PaymentRequirements }` | `200 { xPayment: string }`（base64 X-PAYMENT）／`402 { error: "insufficient_funds" }`（EOA USDC 不足）／`404 {error}`（未知 agent）／`400 {error}`（载荷非法） |
| `POST /actions/buy` | `{ agentId, usdcIn: string, minTokensOut?: string, token?: string }` | `200 { txHash }`／`403 {error}`（护栏拒绝）／`404`／`400` |
| `POST /actions/sell` | `{ agentId, tokensIn: string, minUsdcOut?: string, token?: string }` | `200 { txHash }`／`403`／`404`／`400` |
| `POST /actions/transfer` | `{ agentId, source: "smart"\|"eoa", to: string, amount: string }` | `200 { txHash }`／`403`（收款方非自有钱包/超额）／`404`／`400` |
| `POST /actions/fund` | `{ agentId, target: "eoa"\|"smart", asset: "usdc"\|"eth" }` | `200 { txHash }`／`404`／`400` |
| `GET /balances/:agentId` | — | `200 { agentId, eoaUsdc, smartUsdc, tokenBalance, marketCap }`（均为原子单位十进制字符串）／`404` |
| `GET /healthz` | — | `200 { ok: true }` |

- 金额一律**原子单位十进制字符串**（USDC 6dec、token 18dec），服务端 `BigInt()` 解析。
- `token` 省略时默认居民自有 `AgentToken`（SP1）；带 `token` 参数为 SP4「买他币」预留，不改签名。
- **能量/生命语义（计划 4 据此感知）**：`energy = eoaUsdc / costPerThink`（瞬时思考预算）；`Standing = marketCap`；饥饿判定 = 计划 4 综合 `eoaUsdc + smartUsdc + 可卖 token 的 USDC 估值` 全盘为零时进入抢救窗口。

### A / C（计划 2 已冻结，复用）

- A 网关对外：`POST /v1/chat/completions` 首次 `402 + {x402Version, error, accepts:[PaymentRequirements]}`；带 `X-PAYMENT` 重试→验款→反代 Ollama。计划 4 的 `llm.ts` 收 402 后取 `accepts[0]` 调本执行器 `/sign-payment`。
- C facilitator：`POST /facilitator/verify`、`/facilitator/settle`、`GET /facilitator/supported`（真实为 v2/`eip155:84532`，路由含 `/facilitator` 前缀）。

### 复用计划 1 链上事实（勿改）

- USDC（Base Sepolia）= `0x036CbD53842c5426634e7929541eC2318f3dCF7e`（6dec）；本地 anvil 用 `MockUSDC`。
- `AgentToken.buy(uint256 usdcIn,uint256 minTokensOut)`、`sell(uint256 tokensIn,uint256 minUsdcOut)`、`pricePerToken()`、`marketCap()`、`usdcReserve()`、`balanceOf(address)`；事件 `Bought`/`Sold`。
- `AgentRegistry.agents(uint256) -> (token, wallet, costPerThink, floor, recoveryWindow, alive)`：执行器的 `AgentConfig.smartAccount` 即 `wallet`，`token` 即此处 `token`（SP1 走静态配置；计划 5 换 Registry/Ponder 解析）。

---

## 文件结构（本计划创建/修改）

```
services/executor/
  package.json            — 执行器服务依赖与脚本（隔离工程）
  tsconfig.json           — TS 配置（ESM, Node18）
  vitest.config.ts        — 测试配置
  .env.example            — 运行所需环境变量样例
  .gitignore              — 忽略 node_modules/ dist/ .env
  README.md               — WSL 立起 + 端点 + 计划 4/5 对接
  src/
    x402.ts               — x402 v2 线格式类型 + X-PAYMENT base64 编解码（本地镜像，供类型/假实现）
    config.ts             — AgentConfig + 静态 agent 解析器（agentId→{smartAccount,eoa,token}）
    wallet.ts             — WalletProvider 接缝（余额读 + 智能账户动作 + faucet）
    paymentSigner.ts      — PaymentSigner 接缝（EOA 经官方 x402 原语出 X-PAYMENT）
    signPayment.ts        — /sign-payment 核心：签名前 EOA USDC 校验 → 不足返回 insufficient_funds
    guardrails.ts         — spend-permission 进程内护栏（单笔上限 + 合约白名单）
    actions.ts            — buy/sell/transfer 动作（护栏 + WalletProvider）
    balances.ts           — 余额聚合（eoa/smart USDC + token + marketCap）
    executor.ts           — Express app 工厂（路由装配）
    cdpWalletProvider.ts  — 真 WalletProvider（viem 只读 + 注入式 CDP 写/faucet 钩子）【云耦合，LIVE 验证】
    x402Signer.ts         — 真 PaymentSigner（x402 包 exact-EVM 客户端）【云耦合，LIVE 验证】
    cdpClient.ts          — CDP 客户端引导（建/载 EOA+智能账户、sendSmartAccountCall、faucet、viem account）【云耦合】
    index.ts              — 从 env 引导起服务（装配真适配器）
  test/
    x402.test.ts
    config.test.ts
    wallet.test.ts            — FakeWalletProvider 自检
    signPayment.test.ts
    guardrails.test.ts
    actions.test.ts
    balances.test.ts
    executor.e2e.test.ts      — 端到端：sign-payment 成功/insufficient；buy/sell/transfer 护栏；balances；healthz
    helpers/
      fakeWallet.ts           — 进程内假 WalletProvider（内存余额 + 记录调用）
      fakeSigner.ts           — 进程内假 PaymentSigner（确定性 base64 载荷）
    live/
      verify.live.ts          — 【可选 LIVE 冒烟】真 CDP EOA 签 → 真 facilitator /verify（CDP 密钥 gate）

services/gateway/             — Task 10 前移 v2 对齐（仅常量 + 测试夹具）
  src/x402.ts · src/index.ts · src/pricing.ts · .env.example · test/*  （改 X402_VERSION→2 / "base-sepolia"→"eip155:84532"）
```

修改：仓库根 `.gitignore` 已含 `services/*/node_modules/`、`services/*/dist/`（计划 2 加）；本计划无需再改根 .gitignore（`services/executor/.gitignore` 兜底 `.env`）。

---

## Task 0：执行器服务脚手架（WSL Node 18 隔离工程）

**Files:**
- Create: `services/executor/package.json`, `services/executor/tsconfig.json`, `services/executor/vitest.config.ts`, `services/executor/.gitignore`

- [ ] **Step 1: 确认 WSL Node 18**

Run:
```bash
nvm use 18 || nvm install 18; node -v
```
Expected: 打印 `v18.x.x`。

- [ ] **Step 2: 写 `services/executor/package.json`**

Create `services/executor/package.json`:
```json
{
  "name": "trumantown-executor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "live:verify": "tsx test/live/verify.live.ts"
  },
  "dependencies": {
    "express": "^4.19.2",
    "viem": "^2.21.0"
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

> `@coinbase/agentkit`、`@coinbase/cdp-sdk`、`x402` 在 Step 8 核对版本后再装（避免锁死可能已变的版本），且仅 `src/cdpWalletProvider.ts`/`x402Signer.ts`/`cdpClient.ts`（云耦合、不进单测）引用它们；Tasks 1–8 的单测不依赖这三个包。

- [ ] **Step 3: 写 `services/executor/tsconfig.json`**

Create `services/executor/tsconfig.json`:
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

- [ ] **Step 4: 写 `services/executor/vitest.config.ts`**

Create `services/executor/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

> 注意 `include` 只匹配 `*.test.ts`，故 `test/live/verify.live.ts`（`.live.ts`）**不会**被 `npm test` 收集——LIVE 冒烟只手动 `npm run live:verify` 跑。

- [ ] **Step 5: 写 `services/executor/.gitignore`**

Create `services/executor/.gitignore`:
```
node_modules/
dist/
.env
```

- [ ] **Step 6: 安装依赖**

Run:
```bash
cd "services/executor" && npm install && cd ../..
```
Expected: `node_modules/` 生成，无 error。

- [ ] **Step 7: 核对 x402 / CDP SDK 实际导出（verify-then-adapt，决定 Task 9 绑定）**

Run:
```bash
cd "services/executor" && npm view x402 version && npm view @coinbase/cdp-sdk version && npm view @coinbase/agentkit version && cd ../..
```
Expected: 各打印一个版本号。**决策记录**：把三个版本号记进 `services/executor/README.md`「云依赖版本」一节（Task 11 写）。Task 9 安装并核对：
- `x402` 客户端 exact-EVM 原语的导出名（本计划参考代码用 `createPaymentHeader(client, x402Version, paymentRequirements)`；若实际为 `preparePaymentHeader`+`signPaymentHeader` 或位于 `x402/client`/`x402/schemes` 不同路径，则在 `x402Signer.ts` 就地绑定）。
- `@coinbase/cdp-sdk` 建账户/智能账户/faucet/viem-account 的方法名（写进 `cdpClient.ts`）。
- LIVE 冒烟（Task 9）是「产出的 X-PAYMENT 能被真 facilitator 验过」的最终真相检验。

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/sp1-executor
git add services/executor/package.json services/executor/tsconfig.json services/executor/vitest.config.ts services/executor/.gitignore
git commit -m "chore(executor): scaffold isolated WSL Node service (TS+Vitest)"
```

---

## Task 1：x402 v2 线格式类型 + X-PAYMENT 编解码

**Files:**
- Create: `services/executor/src/x402.ts`
- Test: `services/executor/test/x402.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/executor/test/x402.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  encodeXPayment,
  decodeXPayment,
  X402_VERSION,
  DEFAULT_NETWORK,
  type PaymentPayload,
} from '../src/x402.js';

const sample: PaymentPayload = {
  x402Version: X402_VERSION,
  scheme: 'exact',
  network: DEFAULT_NETWORK,
  payload: { signature: '0xdeadbeef', authorization: { from: '0xa', to: '0xb', value: '10000' } },
};

describe('x402 v2 payment header', () => {
  it('exports v2 constants', () => {
    expect(X402_VERSION).toBe(2);
    expect(DEFAULT_NETWORK).toBe('eip155:84532');
  });

  it('round-trips encode/decode', () => {
    const header = encodeXPayment(sample);
    expect(typeof header).toBe('string');
    expect(decodeXPayment(header)).toEqual(sample);
  });

  it('throws on malformed base64/json', () => {
    expect(() => decodeXPayment('!!!not-base64-json!!!')).toThrow();
  });

  it('throws when required fields missing', () => {
    const bad = Buffer.from(JSON.stringify({ x402Version: 2 }), 'utf8').toString('base64');
    expect(() => decodeXPayment(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/x402.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/x402.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/executor/src/x402.ts`:
```ts
// x402 wire protocol v2 — local mirror of the shapes the executor passes through.
// Real v2 `exact`-scheme payloads are produced by the official `x402` client
// (src/x402Signer.ts); this mirror exists for typing + the in-process fakes/tests.

export const X402_VERSION = 2 as const;
export const DEFAULT_NETWORK = 'eip155:84532' as const; // CAIP-2 (Base Sepolia)

export interface PaymentRequirements {
  scheme: string; // "exact"
  network: string; // CAIP-2, e.g. "eip155:84532"
  maxAmountRequired: string; // atomic USDC (6dec) decimal string, e.g. "10000"
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string; // USDC contract address
  extra?: Record<string, unknown>; // EIP-712 domain etc.
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown; // exact-scheme specific (signature + authorization)
}

export function encodeXPayment(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}

export function decodeXPayment(header: string): PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new Error('X-PAYMENT is not valid base64 JSON');
  }
  const p = parsed as PaymentPayload;
  if (
    !p ||
    typeof p.x402Version !== 'number' ||
    p.scheme !== 'exact' ||
    typeof p.network !== 'string' ||
    p.payload === undefined
  ) {
    throw new Error('X-PAYMENT missing required fields');
  }
  return p;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/x402.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/executor/src/x402.ts services/executor/test/x402.test.ts
git commit -m "feat(executor): add x402 v2 wire types and X-PAYMENT codec"
```

---

## Task 2：Agent 配置解析器（agentId → {smartAccount, eoa, token}）

**Files:**
- Create: `services/executor/src/config.ts`
- Test: `services/executor/test/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/executor/test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { staticAgentResolver, type AgentConfig } from '../src/config.js';

const agent0: AgentConfig = {
  agentId: '0',
  smartAccount: '0x1111111111111111111111111111111111111111',
  eoa: '0x2222222222222222222222222222222222222222',
  token: '0x3333333333333333333333333333333333333333',
};

describe('staticAgentResolver', () => {
  it('resolves a configured agent', () => {
    const resolve = staticAgentResolver({ '0': agent0 });
    expect(resolve('0')).toEqual(agent0);
  });

  it('falls back to default for unknown agent', () => {
    const resolve = staticAgentResolver({ '0': agent0 }, agent0);
    expect(resolve('7')).toEqual(agent0);
  });

  it('returns undefined when no match and no fallback', () => {
    const resolve = staticAgentResolver({ '0': agent0 });
    expect(resolve('7')).toBeUndefined();
  });

  it('returns undefined for undefined/empty agentId without fallback', () => {
    const resolve = staticAgentResolver({ '0': agent0 });
    expect(resolve(undefined as unknown as string)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/config.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/config.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/executor/src/config.ts`:
```ts
export interface AgentConfig {
  agentId: string;
  smartAccount: string; // CDP smart account = AgentRegistry.wallet (identity + trading + guardrails)
  eoa: string; // CDP EOA server account = x402 payer/signer (holds spendable USDC)
  token: string; // the agent's own AgentToken address
}

export type AgentResolver = (agentId: string) => AgentConfig | undefined;

/**
 * SP1 resolver: a static config map (single agent). Plan 5 swaps this for a
 * Registry/Ponder-backed resolver (read AgentRegistry.agents(id).wallet + token)
 * without changing the resolver interface.
 */
export function staticAgentResolver(
  config: Record<string, AgentConfig>,
  fallback?: AgentConfig,
): AgentResolver {
  return (agentId: string) => (agentId !== undefined ? config[agentId] : undefined) ?? fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/config.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/executor/src/config.ts services/executor/test/config.test.ts
git commit -m "feat(executor): add static agent config resolver"
```

---

## Task 3：WalletProvider 接缝 + 进程内假实现

**Files:**
- Create: `services/executor/src/wallet.ts`
- Create: `services/executor/test/helpers/fakeWallet.ts`
- Test: `services/executor/test/wallet.test.ts`

- [ ] **Step 1: Write the WalletProvider interface**

Create `services/executor/src/wallet.ts`:
```ts
import type { AgentConfig } from './config.js';

/**
 * The wallet seam. Real impl (cdpWalletProvider.ts) is CDP/AgentKit + viem and is
 * only exercised by the opt-in LIVE smoke; all unit/e2e tests inject a fake.
 *
 * Conventions:
 * - addresses are hex strings; amounts are bigint atomic units (USDC 6dec, token 18dec).
 * - on-chain actions (buy/sell/transferUsdc/fund) run on the agent's SMART account
 *   (gasless via paymaster) and return a tx hash string. transferUsdc(source) lets
 *   the brain move USDC between the agent's own smart account and EOA.
 */
export interface WalletProvider {
  getUsdcBalance(address: string): Promise<bigint>;
  getTokenBalance(token: string, holder: string): Promise<bigint>;
  getMarketCap(token: string): Promise<bigint>;
  buy(cfg: AgentConfig, token: string, usdcIn: bigint, minTokensOut: bigint): Promise<string>;
  sell(cfg: AgentConfig, token: string, tokensIn: bigint, minUsdcOut: bigint): Promise<string>;
  transferUsdc(cfg: AgentConfig, source: 'smart' | 'eoa', to: string, amount: bigint): Promise<string>;
  fund(cfg: AgentConfig, target: 'eoa' | 'smart', asset: 'usdc' | 'eth'): Promise<string>;
}
```

- [ ] **Step 2: Write the fake**

Create `services/executor/test/helpers/fakeWallet.ts`:
```ts
import type { WalletProvider } from '../../src/wallet.js';
import type { AgentConfig } from '../../src/config.js';

export interface FakeCall {
  kind: 'buy' | 'sell' | 'transfer' | 'fund';
  [k: string]: unknown;
}

/** In-process WalletProvider: in-memory balances + recorded calls. No chain, no CDP. */
export function fakeWallet() {
  const usdc = new Map<string, bigint>();
  const tokens = new Map<string, bigint>(); // key `${token}:${holder}`
  const marketCaps = new Map<string, bigint>();
  const calls: FakeCall[] = [];

  const lc = (a: string) => a.toLowerCase();
  const tkey = (t: string, h: string) => `${lc(t)}:${lc(h)}`;

  const provider: WalletProvider = {
    async getUsdcBalance(address) {
      return usdc.get(lc(address)) ?? 0n;
    },
    async getTokenBalance(token, holder) {
      return tokens.get(tkey(token, holder)) ?? 0n;
    },
    async getMarketCap(token) {
      return marketCaps.get(lc(token)) ?? 0n;
    },
    async buy(cfg, token, usdcIn, minTokensOut) {
      calls.push({ kind: 'buy', token, usdcIn, minTokensOut });
      usdc.set(lc(cfg.smartAccount), (usdc.get(lc(cfg.smartAccount)) ?? 0n) - usdcIn);
      return '0xbuy';
    },
    async sell(cfg, token, tokensIn, minUsdcOut) {
      calls.push({ kind: 'sell', token, tokensIn, minUsdcOut });
      return '0xsell';
    },
    async transferUsdc(cfg, source, to, amount) {
      calls.push({ kind: 'transfer', source, to, amount });
      const from = source === 'smart' ? cfg.smartAccount : cfg.eoa;
      usdc.set(lc(from), (usdc.get(lc(from)) ?? 0n) - amount);
      usdc.set(lc(to), (usdc.get(lc(to)) ?? 0n) + amount);
      return '0xtransfer';
    },
    async fund(cfg, target, asset) {
      calls.push({ kind: 'fund', target, asset });
      if (asset === 'usdc') {
        const a = lc(target === 'eoa' ? cfg.eoa : cfg.smartAccount);
        usdc.set(a, (usdc.get(a) ?? 0n) + 1_000_000n);
      }
      return '0xfund';
    },
  };

  return {
    provider,
    calls,
    setUsdc: (a: string, v: bigint) => usdc.set(lc(a), v),
    setToken: (t: string, h: string, v: bigint) => tokens.set(tkey(t, h), v),
    setMarketCap: (t: string, v: bigint) => marketCaps.set(lc(t), v),
  };
}
```

- [ ] **Step 3: Write the failing test**

Create `services/executor/test/wallet.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fakeWallet } from './helpers/fakeWallet.js';
import type { AgentConfig } from '../src/config.js';

const cfg: AgentConfig = {
  agentId: '0',
  smartAccount: '0xS',
  eoa: '0xE',
  token: '0xT',
};

describe('fakeWallet', () => {
  it('reads configured balances', async () => {
    const w = fakeWallet();
    w.setUsdc('0xE', 50000n);
    w.setToken('0xT', '0xS', 7n);
    w.setMarketCap('0xT', 123n);
    expect(await w.provider.getUsdcBalance('0xE')).toBe(50000n);
    expect(await w.provider.getTokenBalance('0xT', '0xS')).toBe(7n);
    expect(await w.provider.getMarketCap('0xT')).toBe(123n);
  });

  it('transferUsdc moves balance between own wallets and records the call', async () => {
    const w = fakeWallet();
    w.setUsdc('0xS', 100000n);
    const tx = await w.provider.transferUsdc(cfg, 'smart', '0xE', 40000n);
    expect(tx).toBe('0xtransfer');
    expect(await w.provider.getUsdcBalance('0xS')).toBe(60000n);
    expect(await w.provider.getUsdcBalance('0xE')).toBe(40000n);
    expect(w.calls).toContainEqual({ kind: 'transfer', source: 'smart', to: '0xE', amount: 40000n });
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/wallet.test.ts; cd ../..
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/executor/src/wallet.ts services/executor/test/helpers/fakeWallet.ts services/executor/test/wallet.test.ts
git commit -m "feat(executor): add WalletProvider seam and in-process fake"
```

---

## Task 4：PaymentSigner 接缝 + /sign-payment 核心（签名前 EOA USDC 校验）

**Files:**
- Create: `services/executor/src/paymentSigner.ts`
- Create: `services/executor/src/signPayment.ts`
- Create: `services/executor/test/helpers/fakeSigner.ts`
- Test: `services/executor/test/signPayment.test.ts`

- [ ] **Step 1: Write the PaymentSigner interface**

Create `services/executor/src/paymentSigner.ts`:
```ts
import type { PaymentRequirements } from './x402.js';

/**
 * Turns PaymentRequirements into a base64 X-PAYMENT header by signing an EIP-3009
 * authorization with the agent's EOA. Real impl (x402Signer.ts) delegates to the
 * official x402 client primitive; tests inject a fake.
 */
export interface PaymentSigner {
  sign(eoa: string, requirements: PaymentRequirements): Promise<string>;
}
```

- [ ] **Step 2: Write the fake signer**

Create `services/executor/test/helpers/fakeSigner.ts`:
```ts
import type { PaymentSigner } from '../../src/paymentSigner.js';
import type { PaymentRequirements } from '../../src/x402.js';
import { encodeXPayment, X402_VERSION } from '../../src/x402.js';

/** Deterministic in-process signer: records calls, emits a valid base64 X-PAYMENT. */
export function fakeSigner() {
  const signed: { eoa: string; requirements: PaymentRequirements }[] = [];
  const signer: PaymentSigner = {
    async sign(eoa, requirements) {
      signed.push({ eoa, requirements });
      return encodeXPayment({
        x402Version: X402_VERSION,
        scheme: 'exact',
        network: requirements.network,
        payload: { signer: eoa, value: requirements.maxAmountRequired },
      });
    },
  };
  return { signer, signed };
}
```

- [ ] **Step 3: Write the failing test**

Create `services/executor/test/signPayment.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { signPaymentForAgent, type SignPaymentDeps } from '../src/signPayment.js';
import { staticAgentResolver, type AgentConfig } from '../src/config.js';
import { fakeWallet } from './helpers/fakeWallet.js';
import { fakeSigner } from './helpers/fakeSigner.js';
import type { PaymentRequirements } from '../src/x402.js';

const agent0: AgentConfig = { agentId: '0', smartAccount: '0xS', eoa: '0xE', token: '0xT' };
const req: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:84532',
  maxAmountRequired: '10000', // 0.01 USDC
  resource: 'http://gw/v1/chat/completions',
  description: 'think',
  mimeType: 'application/json',
  payTo: '0xbeef',
  maxTimeoutSeconds: 120,
  asset: '0xusdc',
};

function deps(): { d: SignPaymentDeps; w: ReturnType<typeof fakeWallet>; s: ReturnType<typeof fakeSigner> } {
  const w = fakeWallet();
  const s = fakeSigner();
  return {
    d: { resolve: staticAgentResolver({ '0': agent0 }), wallet: w.provider, signer: s.signer },
    w,
    s,
  };
}

describe('signPaymentForAgent', () => {
  it('signs when EOA balance >= required', async () => {
    const { d, w, s } = deps();
    w.setUsdc('0xE', 10000n);
    const res = await signPaymentForAgent(d, '0', req);
    expect(res.ok).toBe(true);
    if (res.ok) expect(typeof res.xPayment).toBe('string');
    expect(s.signed).toHaveLength(1);
    expect(s.signed[0].eoa).toBe('0xE');
  });

  it('returns 402 insufficient_funds when EOA balance < required (and does NOT sign)', async () => {
    const { d, w, s } = deps();
    w.setUsdc('0xE', 9999n);
    const res = await signPaymentForAgent(d, '0', req);
    expect(res).toEqual({ ok: false, status: 402, error: 'insufficient_funds' });
    expect(s.signed).toHaveLength(0);
  });

  it('returns 404 for unknown agent', async () => {
    const { d } = deps();
    const res = await signPaymentForAgent(d, '99', req);
    expect(res).toMatchObject({ ok: false, status: 404 });
  });

  it('returns 400 for invalid paymentRequirements', async () => {
    const { d } = deps();
    const res = await signPaymentForAgent(d, '0', { } as unknown as PaymentRequirements);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/signPayment.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/signPayment.js'`。

- [ ] **Step 5: Write minimal implementation**

Create `services/executor/src/signPayment.ts`:
```ts
import type { AgentResolver } from './config.js';
import type { WalletProvider } from './wallet.js';
import type { PaymentSigner } from './paymentSigner.js';
import type { PaymentRequirements } from './x402.js';

export interface SignPaymentDeps {
  resolve: AgentResolver;
  wallet: WalletProvider;
  signer: PaymentSigner;
}

export type SignPaymentResult =
  | { ok: true; xPayment: string }
  | { ok: false; status: number; error: string };

/**
 * The executor is a mechanical lever: it signs from the EOA iff the EOA already
 * holds enough USDC. Insufficient EOA balance => `insufficient_funds` (a fact about
 * this instant, NOT a death verdict). Topping up the EOA (sell token -> sweep) and
 * declaring starvation are Plan 4's job.
 */
export async function signPaymentForAgent(
  deps: SignPaymentDeps,
  agentId: string,
  requirements: PaymentRequirements,
): Promise<SignPaymentResult> {
  const cfg = deps.resolve(agentId);
  if (!cfg) return { ok: false, status: 404, error: `unknown agent ${agentId}` };

  if (!requirements || typeof requirements.maxAmountRequired !== 'string') {
    return { ok: false, status: 400, error: 'invalid paymentRequirements' };
  }
  let required: bigint;
  try {
    required = BigInt(requirements.maxAmountRequired);
  } catch {
    return { ok: false, status: 400, error: 'invalid maxAmountRequired' };
  }

  const balance = await deps.wallet.getUsdcBalance(cfg.eoa);
  if (balance < required) return { ok: false, status: 402, error: 'insufficient_funds' };

  const xPayment = await deps.signer.sign(cfg.eoa, requirements);
  return { ok: true, xPayment };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/signPayment.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 7: Commit**

```bash
git add services/executor/src/paymentSigner.ts services/executor/src/signPayment.ts services/executor/test/helpers/fakeSigner.ts services/executor/test/signPayment.test.ts
git commit -m "feat(executor): add PaymentSigner seam and /sign-payment core (EOA balance gate)"
```

---

## Task 5：spend-permission 护栏（单笔上限 + 合约白名单）

**Files:**
- Create: `services/executor/src/guardrails.ts`
- Test: `services/executor/test/guardrails.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/executor/test/guardrails.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GuardrailError, isAllowedContract, type GuardrailConfig } from '../src/guardrails.js';

const cfg: GuardrailConfig = {
  maxUsdcPerTx: 5_000_000n, // 5 USDC
  allowedContracts: ['0xTOKEN', '0xUSDC'],
};

describe('guardrails', () => {
  it('isAllowedContract is case-insensitive', () => {
    expect(isAllowedContract(cfg, '0xtoken')).toBe(true);
    expect(isAllowedContract(cfg, '0xUSDC')).toBe(true);
    expect(isAllowedContract(cfg, '0xOTHER')).toBe(false);
  });

  it('GuardrailError carries a name', () => {
    const e = new GuardrailError('nope');
    expect(e.name).toBe('GuardrailError');
    expect(e.message).toBe('nope');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/guardrails.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/guardrails.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/executor/src/guardrails.ts`:
```ts
/**
 * SP1 in-process guardrails (belt). The CDP on-chain spend-permission/policy on the
 * smart account is the suspenders — configured in cdpClient.ts (Task 9) when the
 * CDP policy API is available. Both enforce: per-tx USDC cap + contract allowlist
 * (AgentToken + USDC only).
 */
export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardrailError';
  }
}

export interface GuardrailConfig {
  maxUsdcPerTx: bigint; // atomic USDC (6dec)
  allowedContracts: string[]; // AgentToken + USDC addresses
}

export function isAllowedContract(cfg: GuardrailConfig, contract: string): boolean {
  const c = contract.toLowerCase();
  return cfg.allowedContracts.some((a) => a.toLowerCase() === c);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/guardrails.test.ts; cd ../..
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/executor/src/guardrails.ts services/executor/test/guardrails.test.ts
git commit -m "feat(executor): add in-process spend-permission guardrails"
```

---

## Task 6：链上动作（buy / sell / transfer，护栏约束）

**Files:**
- Create: `services/executor/src/actions.ts`
- Test: `services/executor/test/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/executor/test/actions.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buyAction, sellAction, transferAction, type ActionsDeps } from '../src/actions.js';
import { GuardrailError, type GuardrailConfig } from '../src/guardrails.js';
import { fakeWallet } from './helpers/fakeWallet.js';
import type { AgentConfig } from '../src/config.js';

const cfg: AgentConfig = { agentId: '0', smartAccount: '0xS', eoa: '0xE', token: '0xTOKEN' };
const guardrails: GuardrailConfig = { maxUsdcPerTx: 5_000_000n, allowedContracts: ['0xTOKEN', '0xUSDC'] };

function deps(): { d: ActionsDeps; w: ReturnType<typeof fakeWallet> } {
  const w = fakeWallet();
  return { d: { wallet: w.provider, guardrails, usdcAddress: '0xUSDC' }, w };
}

describe('buyAction', () => {
  it('buys own token within cap and records the call', async () => {
    const { d, w } = deps();
    const out = await buyAction(d, cfg, { usdcIn: 1_000_000n, minTokensOut: 0n });
    expect(out.txHash).toBe('0xbuy');
    expect(w.calls).toContainEqual({ kind: 'buy', token: '0xTOKEN', usdcIn: 1_000_000n, minTokensOut: 0n });
  });

  it('rejects buy over per-tx cap', async () => {
    const { d } = deps();
    await expect(buyAction(d, cfg, { usdcIn: 6_000_000n, minTokensOut: 0n })).rejects.toBeInstanceOf(GuardrailError);
  });

  it('rejects buy of a non-allowlisted token', async () => {
    const { d } = deps();
    await expect(
      buyAction(d, cfg, { token: '0xEVIL', usdcIn: 1_000_000n, minTokensOut: 0n }),
    ).rejects.toBeInstanceOf(GuardrailError);
  });
});

describe('sellAction', () => {
  it('sells own token and records the call', async () => {
    const { d, w } = deps();
    const out = await sellAction(d, cfg, { tokensIn: 5n, minUsdcOut: 0n });
    expect(out.txHash).toBe('0xsell');
    expect(w.calls).toContainEqual({ kind: 'sell', token: '0xTOKEN', tokensIn: 5n, minUsdcOut: 0n });
  });
});

describe('transferAction', () => {
  it('sweeps USDC from smart to own EOA within cap', async () => {
    const { d, w } = deps();
    w.setUsdc('0xS', 3_000_000n);
    const out = await transferAction(d, cfg, { source: 'smart', to: '0xE', amount: 2_000_000n });
    expect(out.txHash).toBe('0xtransfer');
    expect(await w.provider.getUsdcBalance('0xE')).toBe(2_000_000n);
  });

  it('rejects transfer to a non-own address', async () => {
    const { d } = deps();
    await expect(
      transferAction(d, cfg, { source: 'smart', to: '0xSTRANGER', amount: 1n }),
    ).rejects.toBeInstanceOf(GuardrailError);
  });

  it('rejects transfer over per-tx cap', async () => {
    const { d } = deps();
    await expect(
      transferAction(d, cfg, { source: 'smart', to: '0xE', amount: 6_000_000n }),
    ).rejects.toBeInstanceOf(GuardrailError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/actions.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/actions.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/executor/src/actions.ts`:
```ts
import type { AgentConfig } from './config.js';
import type { WalletProvider } from './wallet.js';
import { GuardrailError, isAllowedContract, type GuardrailConfig } from './guardrails.js';

export interface ActionsDeps {
  wallet: WalletProvider;
  guardrails: GuardrailConfig;
  usdcAddress: string;
}

export async function buyAction(
  deps: ActionsDeps,
  cfg: AgentConfig,
  args: { token?: string; usdcIn: bigint; minTokensOut: bigint },
): Promise<{ txHash: string }> {
  const token = args.token ?? cfg.token;
  if (!isAllowedContract(deps.guardrails, token)) {
    throw new GuardrailError(`contract ${token} not in allowlist`);
  }
  if (args.usdcIn > deps.guardrails.maxUsdcPerTx) {
    throw new GuardrailError(`usdcIn ${args.usdcIn} exceeds per-tx cap ${deps.guardrails.maxUsdcPerTx}`);
  }
  const txHash = await deps.wallet.buy(cfg, token, args.usdcIn, args.minTokensOut);
  return { txHash };
}

export async function sellAction(
  deps: ActionsDeps,
  cfg: AgentConfig,
  args: { token?: string; tokensIn: bigint; minUsdcOut: bigint },
): Promise<{ txHash: string }> {
  const token = args.token ?? cfg.token;
  if (!isAllowedContract(deps.guardrails, token)) {
    throw new GuardrailError(`contract ${token} not in allowlist`);
  }
  const txHash = await deps.wallet.sell(cfg, token, args.tokensIn, args.minUsdcOut);
  return { txHash };
}

export async function transferAction(
  deps: ActionsDeps,
  cfg: AgentConfig,
  args: { source: 'smart' | 'eoa'; to: string; amount: bigint },
): Promise<{ txHash: string }> {
  // SP1: USDC may only move between the agent's own two wallets.
  const own = [cfg.eoa.toLowerCase(), cfg.smartAccount.toLowerCase()];
  if (!own.includes(args.to.toLowerCase())) {
    throw new GuardrailError(`transfer recipient ${args.to} is not the agent's own wallet`);
  }
  if (args.amount > deps.guardrails.maxUsdcPerTx) {
    throw new GuardrailError(`amount ${args.amount} exceeds per-tx cap ${deps.guardrails.maxUsdcPerTx}`);
  }
  const txHash = await deps.wallet.transferUsdc(cfg, args.source, args.to, args.amount);
  return { txHash };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/actions.test.ts; cd ../..
```
Expected: PASS（7 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/executor/src/actions.ts services/executor/test/actions.test.ts
git commit -m "feat(executor): add buy/sell/transfer actions with guardrails"
```

---

## Task 7：余额聚合（/balances 数据）

**Files:**
- Create: `services/executor/src/balances.ts`
- Test: `services/executor/test/balances.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/executor/test/balances.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readBalances } from '../src/balances.js';
import { fakeWallet } from './helpers/fakeWallet.js';
import type { AgentConfig } from '../src/config.js';

const cfg: AgentConfig = { agentId: '0', smartAccount: '0xS', eoa: '0xE', token: '0xT' };

describe('readBalances', () => {
  it('aggregates eoa/smart USDC, token balance and marketCap as decimal strings', async () => {
    const w = fakeWallet();
    w.setUsdc('0xE', 12345n);
    w.setUsdc('0xS', 67890n);
    w.setToken('0xT', '0xS', 1000n);
    w.setMarketCap('0xT', 999n);
    const b = await readBalances(w.provider, cfg);
    expect(b).toEqual({
      agentId: '0',
      eoaUsdc: '12345',
      smartUsdc: '67890',
      tokenBalance: '1000',
      marketCap: '999',
    });
  });

  it('defaults missing balances to "0"', async () => {
    const w = fakeWallet();
    const b = await readBalances(w.provider, cfg);
    expect(b).toEqual({ agentId: '0', eoaUsdc: '0', smartUsdc: '0', tokenBalance: '0', marketCap: '0' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/balances.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/balances.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/executor/src/balances.ts`:
```ts
import type { AgentConfig } from './config.js';
import type { WalletProvider } from './wallet.js';

export interface AgentBalances {
  agentId: string;
  eoaUsdc: string; // atomic USDC (6dec) — Plan 4 reads as `energy` source
  smartUsdc: string; // atomic USDC (6dec)
  tokenBalance: string; // atomic token (18dec) held by the smart account
  marketCap: string; // atomic USDC (6dec) — Plan 4 reads as `Standing`
}

export async function readBalances(wallet: WalletProvider, cfg: AgentConfig): Promise<AgentBalances> {
  const [eoaUsdc, smartUsdc, tokenBalance, marketCap] = await Promise.all([
    wallet.getUsdcBalance(cfg.eoa),
    wallet.getUsdcBalance(cfg.smartAccount),
    wallet.getTokenBalance(cfg.token, cfg.smartAccount),
    wallet.getMarketCap(cfg.token),
  ]);
  return {
    agentId: cfg.agentId,
    eoaUsdc: eoaUsdc.toString(),
    smartUsdc: smartUsdc.toString(),
    tokenBalance: tokenBalance.toString(),
    marketCap: marketCap.toString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/balances.test.ts; cd ../..
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add services/executor/src/balances.ts services/executor/test/balances.test.ts
git commit -m "feat(executor): add balances aggregation (energy/standing source)"
```

---

## Task 8：Express 装配 + 端到端（sign-payment / actions / balances / healthz）

**Files:**
- Create: `services/executor/src/executor.ts`, `services/executor/src/index.ts`
- Test: `services/executor/test/executor.e2e.test.ts`

- [ ] **Step 1: Write the failing end-to-end test**

Create `services/executor/test/executor.e2e.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createExecutor } from '../src/executor.js';
import { staticAgentResolver, type AgentConfig } from '../src/config.js';
import type { GuardrailConfig } from '../src/guardrails.js';
import { fakeWallet } from './helpers/fakeWallet.js';
import { fakeSigner } from './helpers/fakeSigner.js';

const agent0: AgentConfig = { agentId: '0', smartAccount: '0xS', eoa: '0xE', token: '0xTOKEN' };
const guardrails: GuardrailConfig = { maxUsdcPerTx: 5_000_000n, allowedContracts: ['0xTOKEN', '0xUSDC'] };

const requirements = {
  scheme: 'exact',
  network: 'eip155:84532',
  maxAmountRequired: '10000',
  resource: 'http://gw/v1/chat/completions',
  description: 'think',
  mimeType: 'application/json',
  payTo: '0xbeef',
  maxTimeoutSeconds: 120,
  asset: '0xUSDC',
};

function makeApp() {
  const w = fakeWallet();
  const s = fakeSigner();
  const app = createExecutor({
    resolve: staticAgentResolver({ '0': agent0 }, agent0),
    wallet: w.provider,
    signer: s.signer,
    guardrails,
    usdcAddress: '0xUSDC',
  });
  return { app, w, s };
}

describe('executor end-to-end', () => {
  it('GET /healthz', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /sign-payment returns xPayment when EOA funded', async () => {
    const { app, w } = makeApp();
    w.setUsdc('0xE', 10000n);
    const res = await request(app).post('/sign-payment').send({ agentId: '0', paymentRequirements: requirements });
    expect(res.status).toBe(200);
    expect(typeof res.body.xPayment).toBe('string');
  });

  it('POST /sign-payment returns 402 insufficient_funds when EOA broke', async () => {
    const { app, w } = makeApp();
    w.setUsdc('0xE', 1n);
    const res = await request(app).post('/sign-payment').send({ agentId: '0', paymentRequirements: requirements });
    expect(res.status).toBe(402);
    expect(res.body).toEqual({ error: 'insufficient_funds' });
  });

  it('POST /sign-payment 400 when agentId missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/sign-payment').send({ paymentRequirements: requirements });
    expect(res.status).toBe(400);
  });

  it('POST /actions/buy succeeds within cap', async () => {
    const { app, w } = makeApp();
    const res = await request(app).post('/actions/buy').send({ agentId: '0', usdcIn: '1000000', minTokensOut: '0' });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('0xbuy');
    expect(w.calls).toContainEqual({ kind: 'buy', token: '0xTOKEN', usdcIn: 1_000_000n, minTokensOut: 0n });
  });

  it('POST /actions/buy 403 over cap', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/actions/buy').send({ agentId: '0', usdcIn: '6000000', minTokensOut: '0' });
    expect(res.status).toBe(403);
  });

  it('POST /actions/sell succeeds', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/actions/sell').send({ agentId: '0', tokensIn: '5', minUsdcOut: '0' });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('0xsell');
  });

  it('POST /actions/transfer sweeps smart->eoa', async () => {
    const { app, w } = makeApp();
    w.setUsdc('0xS', 3_000_000n);
    const res = await request(app).post('/actions/transfer').send({ agentId: '0', source: 'smart', to: '0xE', amount: '2000000' });
    expect(res.status).toBe(200);
    expect(await w.provider.getUsdcBalance('0xE')).toBe(2_000_000n);
  });

  it('POST /actions/transfer 403 to stranger', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/actions/transfer').send({ agentId: '0', source: 'smart', to: '0xSTRANGER', amount: '1' });
    expect(res.status).toBe(403);
  });

  it('POST /actions/fund tops up the EOA', async () => {
    const { app, w } = makeApp();
    const res = await request(app).post('/actions/fund').send({ agentId: '0', target: 'eoa', asset: 'usdc' });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('0xfund');
    expect(w.calls).toContainEqual({ kind: 'fund', target: 'eoa', asset: 'usdc' });
  });

  it('GET /balances/:agentId aggregates', async () => {
    const { app, w } = makeApp();
    w.setUsdc('0xE', 12345n);
    w.setMarketCap('0xTOKEN', 999n);
    const res = await request(app).get('/balances/0');
    expect(res.status).toBe(200);
    expect(res.body.eoaUsdc).toBe('12345');
    expect(res.body.marketCap).toBe('999');
  });

  it('GET /balances/:agentId 404 unknown', async () => {
    const w = fakeWallet();
    const s = fakeSigner();
    const app = createExecutor({
      resolve: staticAgentResolver({ '0': agent0 }), // no fallback
      wallet: w.provider,
      signer: s.signer,
      guardrails,
      usdcAddress: '0xUSDC',
    });
    const res = await request(app).get('/balances/99');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/executor.e2e.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/executor.js'`。

- [ ] **Step 3: Write the app factory**

Create `services/executor/src/executor.ts`:
```ts
import express, { type Request, type Response } from 'express';
import type { AgentResolver } from './config.js';
import type { WalletProvider } from './wallet.js';
import type { PaymentSigner } from './paymentSigner.js';
import { GuardrailError, type GuardrailConfig } from './guardrails.js';
import { signPaymentForAgent } from './signPayment.js';
import { buyAction, sellAction, transferAction, type ActionsDeps } from './actions.js';
import { readBalances } from './balances.js';

export interface ExecutorDeps {
  resolve: AgentResolver;
  wallet: WalletProvider;
  signer: PaymentSigner;
  guardrails: GuardrailConfig;
  usdcAddress: string;
}

function parseBig(v: unknown, field: string): bigint {
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new HttpError(400, `${field} must be a decimal string`);
  }
  try {
    return BigInt(v);
  } catch {
    throw new HttpError(400, `${field} is not a valid integer`);
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function fail(res: Response, e: unknown): void {
  if (e instanceof GuardrailError) {
    res.status(403).json({ error: e.message });
  } else if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message });
  } else {
    res.status(500).json({ error: (e as Error).message });
  }
}

export function createExecutor(deps: ExecutorDeps): express.Express {
  const app = express();
  app.use(express.json());

  const actionsDeps: ActionsDeps = {
    wallet: deps.wallet,
    guardrails: deps.guardrails,
    usdcAddress: deps.usdcAddress,
  };

  // Resolve agent from body.agentId or 404. Throws HttpError so handlers can `fail`.
  const mustResolve = (agentId: unknown) => {
    if (typeof agentId !== 'string' || agentId.length === 0) {
      throw new HttpError(400, 'agentId required');
    }
    const cfg = deps.resolve(agentId);
    if (!cfg) throw new HttpError(404, `unknown agent ${agentId}`);
    return cfg;
  };

  app.get('/healthz', (_req: Request, res: Response) => res.json({ ok: true }));

  app.post('/sign-payment', async (req: Request, res: Response) => {
    const { agentId, paymentRequirements } = req.body ?? {};
    if (typeof agentId !== 'string' || agentId.length === 0) {
      res.status(400).json({ error: 'agentId required' });
      return;
    }
    const result = await signPaymentForAgent(deps, agentId, paymentRequirements);
    if (result.ok) {
      res.status(200).json({ xPayment: result.xPayment });
      return;
    }
    res.status(result.status).json({ error: result.error });
  });

  app.post('/actions/buy', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const out = await buyAction(actionsDeps, cfg, {
        token: req.body.token,
        usdcIn: parseBig(req.body.usdcIn, 'usdcIn'),
        minTokensOut: parseBig(req.body.minTokensOut ?? '0', 'minTokensOut'),
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/sell', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const out = await sellAction(actionsDeps, cfg, {
        token: req.body.token,
        tokensIn: parseBig(req.body.tokensIn, 'tokensIn'),
        minUsdcOut: parseBig(req.body.minUsdcOut ?? '0', 'minUsdcOut'),
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/transfer', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const source = req.body?.source;
      if (source !== 'smart' && source !== 'eoa') throw new HttpError(400, 'source must be "smart" or "eoa"');
      if (typeof req.body?.to !== 'string') throw new HttpError(400, 'to required');
      const out = await transferAction(actionsDeps, cfg, {
        source,
        to: req.body.to,
        amount: parseBig(req.body.amount, 'amount'),
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/fund', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const target = req.body?.target;
      const asset = req.body?.asset;
      if (target !== 'eoa' && target !== 'smart') throw new HttpError(400, 'target must be "eoa" or "smart"');
      if (asset !== 'usdc' && asset !== 'eth') throw new HttpError(400, 'asset must be "usdc" or "eth"');
      const txHash = await deps.wallet.fund(cfg, target, asset);
      res.json({ txHash });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/balances/:agentId', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.params.agentId);
      res.json(await readBalances(deps.wallet, cfg));
    } catch (e) {
      fail(res, e);
    }
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/executor.e2e.test.ts; cd ../..
```
Expected: PASS（13 passed）。

- [ ] **Step 5: Write the bootstrap (env → real adapters; not unit-tested)**

Create `services/executor/src/index.ts`:
```ts
import { createExecutor } from './executor.js';
import { staticAgentResolver, type AgentConfig } from './config.js';
import { createCdpWalletProvider } from './cdpWalletProvider.js';
import { createX402Signer } from './x402Signer.js';
import { buildCdpHooks } from './cdpClient.js';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

async function main() {
  const usdcAddress = env('USDC_ADDRESS', '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  const agent0: AgentConfig = {
    agentId: '0',
    smartAccount: env('AGENT_0_SMART_ACCOUNT'),
    eoa: env('AGENT_0_EOA'),
    token: env('AGENT_0_TOKEN'),
  };

  // CDP cloud seam: builds the smart-account call sender, faucet, and the EOA viem
  // account used by the x402 signer. See cdpClient.ts (verify-then-adapt in Task 0).
  const cdp = await buildCdpHooks({
    apiKeyId: env('CDP_API_KEY_ID'),
    apiKeySecret: env('CDP_API_KEY_SECRET'),
    walletSecret: env('CDP_WALLET_SECRET'),
    rpcUrl: env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
    agents: [agent0],
    usdcAddress,
  });

  const wallet = createCdpWalletProvider({
    rpcUrl: env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
    usdcAddress,
    sendSmartAccountCall: cdp.sendSmartAccountCall,
    faucetTo: cdp.faucetTo,
  });

  const signer = createX402Signer({ accountFor: cdp.eoaAccountFor });

  const guardrails = {
    maxUsdcPerTx: BigInt(env('MAX_USDC_PER_TX', '5000000')), // 5 USDC
    allowedContracts: [agent0.token, usdcAddress],
  };

  const app = createExecutor({
    resolve: staticAgentResolver({ '0': agent0 }, agent0),
    wallet,
    signer,
    guardrails,
    usdcAddress,
  });

  const port = Number(env('PORT', '8404'));
  app.listen(port, () => console.log(`[executor] AgentKit/CDP on :${port}`));
}

main().catch((e) => {
  console.error('[executor] failed to start', e);
  process.exit(1);
});
```

- [ ] **Step 6: Run the full suite + typecheck (excluding the cloud adapters created in Task 9)**

> `index.ts` imports `cdpWalletProvider.ts`/`x402Signer.ts`/`cdpClient.ts` which don't exist yet — that's expected; `npm test` does **not** import `index.ts`, so tests are green now. `npm run typecheck` will fail until Task 9. Run only the test suite here:

Run:
```bash
cd "services/executor" && npx vitest run; cd ../..
```
Expected: PASS（x402 4 + config 4 + wallet 2 + signPayment 4 + guardrails 2 + actions 7 + balances 2 + e2e 12 = **37 passed**, 8 files）。

- [ ] **Step 7: Commit**

```bash
git add services/executor/src/executor.ts services/executor/src/index.ts services/executor/test/executor.e2e.test.ts
git commit -m "feat(executor): assemble Express app + e2e (sign-payment/actions/balances)"
```

---

## Task 9：真实 CDP/AgentKit/x402 适配器 + 可选 LIVE 冒烟（云耦合，非单测）

> 本任务是唯一依赖 CDP 云端密钥与真链的部分，**不进 `npm test`**。参考代码按 Task 0 Step 7 核对到的导出绑定；若实际 API 名不同，就地调整。**LIVE 冒烟是「产出的 X-PAYMENT 能被真 facilitator 验过」的最终真相检验。**

> **⚠ 执行期校正（已落地）：** 计划起草时参考了**裸包 `x402`**（npm 最新 1.2.0），但实测该包**仅支持
> 协议 v1 / 字符串网络名**（`x402Versions=[1]`），无法产出 v2/`eip155:84532` 载荷。正确的 v2 客户端是
> Coinbase 官方**作用域包** **`@x402/core` + `@x402/evm`**（2.14.0，与自托管 facilitator 同源）：
> `new x402Client()` → `registerExactEvmScheme(client, { signer })`（`@x402/evm/exact/client`，注册 v2 `eip155:*`
> exact 方案）→ `x402HTTPClient.createPaymentPayload()` + `encodePaymentSignatureHeader()` 出 X-PAYMENT。
> CDP `EvmServerAccount` 直接满足 x402 的 `ClientEvmSigner`（含 `address`/`signTypedData`），无需转换。
> 故 Task 9 的实现用 `@x402/core`+`@x402/evm`（**非**下方参考代码里的裸 `x402`），其余结构不变；真链验证仍由
> LIVE 冒烟在计划5 完成。

**Files:**
- Create: `services/executor/src/cdpWalletProvider.ts`, `services/executor/src/x402Signer.ts`, `services/executor/src/cdpClient.ts`
- Create: `services/executor/test/live/verify.live.ts`
- Create: `services/executor/.env.example`

- [ ] **Step 1: 安装云依赖**

Run:
```bash
cd "services/executor" && npm install @coinbase/agentkit @coinbase/cdp-sdk x402 && cd ../..
```
Expected: 三个包入 `dependencies`，无 error。把装到的版本号记入 README（Task 11）。

- [ ] **Step 2: 写 `cdpWalletProvider.ts`（viem 只读 + 注入式 CDP 写/faucet）**

Create `services/executor/src/cdpWalletProvider.ts`:
```ts
import { createPublicClient, http, getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { WalletProvider } from './wallet.js';
import type { AgentConfig } from './config.js';

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
const AGENT_TOKEN_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'marketCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export interface CdpWalletConfig {
  rpcUrl: string;
  usdcAddress: string;
  /** Sends a smart-account (gasless) contract call, returns tx/userOp hash. From cdpClient.ts. */
  sendSmartAccountCall: (
    cfg: AgentConfig,
    call: { to: string; functionName: 'buy' | 'sell' | 'approve' | 'transfer'; args: unknown[] },
  ) => Promise<string>;
  /** CDP testnet faucet. From cdpClient.ts. */
  faucetTo: (address: string, asset: 'usdc' | 'eth') => Promise<string>;
}

/**
 * Reads go straight to chain via viem (stable). Writes/faucet are delegated to the
 * injected CDP hooks (cdpClient.ts) — that's the only cloud-coupled surface.
 */
export function createCdpWalletProvider(c: CdpWalletConfig): WalletProvider {
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(c.rpcUrl) });
  const usdc = getAddress(c.usdcAddress);

  return {
    async getUsdcBalance(address) {
      return (await publicClient.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [getAddress(address)],
      })) as bigint;
    },
    async getTokenBalance(token, holder) {
      return (await publicClient.readContract({
        address: getAddress(token),
        abi: AGENT_TOKEN_ABI,
        functionName: 'balanceOf',
        args: [getAddress(holder)],
      })) as bigint;
    },
    async getMarketCap(token) {
      return (await publicClient.readContract({
        address: getAddress(token),
        abi: AGENT_TOKEN_ABI,
        functionName: 'marketCap',
        args: [],
      })) as bigint;
    },
    async buy(cfg, token, usdcIn, minTokensOut) {
      // AgentToken.buy pulls USDC via transferFrom -> approve first (both gasless on the smart account).
      await c.sendSmartAccountCall(cfg, { to: c.usdcAddress, functionName: 'approve', args: [getAddress(token), usdcIn] });
      return c.sendSmartAccountCall(cfg, { to: token, functionName: 'buy', args: [usdcIn, minTokensOut] });
    },
    async sell(cfg, token, tokensIn, minUsdcOut) {
      return c.sendSmartAccountCall(cfg, { to: token, functionName: 'sell', args: [tokensIn, minUsdcOut] });
    },
    async transferUsdc(cfg, source, to, amount) {
      // SP1: transfers originate from the smart account (gasless). EOA-sourced sweeps
      // are not needed in SP1 (the EOA only ever receives). If later required, route
      // through a CDP EOA send here.
      void source;
      return c.sendSmartAccountCall(cfg, { to: c.usdcAddress, functionName: 'transfer', args: [getAddress(to), amount] });
    },
    async fund(cfg, target, asset) {
      return c.faucetTo(target === 'eoa' ? cfg.eoa : cfg.smartAccount, asset);
    },
  };
}
```

- [ ] **Step 3: 写 `x402Signer.ts`（官方 x402 客户端原语）**

Create `services/executor/src/x402Signer.ts`:
```ts
import type { PaymentSigner } from './paymentSigner.js';
import type { PaymentRequirements } from './x402.js';
import { X402_VERSION } from './x402.js';

export interface X402SignerConfig {
  /** Returns a viem-compatible account/client for an EOA address (from cdpClient.ts). */
  accountFor: (eoa: string) => Promise<unknown>;
}

/**
 * Delegates X-PAYMENT construction to the official `x402` client's exact-EVM
 * primitive — no hand-rolled EIP-712, so the EIP-712 domain/signature match what the
 * real facilitator's /verify expects.
 *
 * Task 0 Step 7 pinned the `x402` version. The reference below uses
 * `createPaymentHeader(client, x402Version, paymentRequirements)`. If the installed
 * version exposes it differently (e.g. `x402/client` `preparePaymentHeader` +
 * `signPaymentHeader`, or `x402/schemes` exact.evm.client), bind to that here.
 * verify.live.ts is the truth-check.
 */
export function createX402Signer(cfg: X402SignerConfig): PaymentSigner {
  return {
    async sign(eoa: string, requirements: PaymentRequirements): Promise<string> {
      const client = await cfg.accountFor(eoa);
      const { createPaymentHeader } = (await import('x402/client')) as {
        createPaymentHeader: (c: unknown, v: number, r: PaymentRequirements) => Promise<string>;
      };
      return createPaymentHeader(client, X402_VERSION, requirements);
    },
  };
}
```

- [ ] **Step 4: 写 `cdpClient.ts`（CDP 引导：建/载 EOA+智能账户、send、faucet、viem account）**

Create `services/executor/src/cdpClient.ts`:
```ts
import { CdpClient } from '@coinbase/cdp-sdk';
import { encodeFunctionData, getAddress } from 'viem';
import type { AgentConfig } from './config.js';

const ERC20_WRITE_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 't', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;
const AGENT_TOKEN_WRITE_ABI = [
  { type: 'function', name: 'buy', stateMutability: 'nonpayable', inputs: [{ name: 'usdcIn', type: 'uint256' }, { name: 'minTokensOut', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'sell', stateMutability: 'nonpayable', inputs: [{ name: 'tokensIn', type: 'uint256' }, { name: 'minUsdcOut', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

export interface CdpHooksConfig {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  rpcUrl: string;
  agents: AgentConfig[];
  usdcAddress: string;
}

export interface CdpHooks {
  sendSmartAccountCall: (
    cfg: AgentConfig,
    call: { to: string; functionName: 'buy' | 'sell' | 'approve' | 'transfer'; args: unknown[] },
  ) => Promise<string>;
  faucetTo: (address: string, asset: 'usdc' | 'eth') => Promise<string>;
  /** viem-compatible account for an EOA, consumed by x402Signer. */
  eoaAccountFor: (eoa: string) => Promise<unknown>;
}

/**
 * CDP cloud bootstrap. NOTE (Task 0 verify-then-adapt): method names below follow
 * @coinbase/cdp-sdk as of the version pinned in Task 0. Confirm and adjust:
 *   - getOrCreateAccount / getOrCreateSmartAccount (EOA + smart account by name/address)
 *   - smartAccount.sendUserOperation({ calls: [{ to, data }] }) for gasless calls
 *   - cdp.evm.requestFaucet({ address, network, token }) for testnet funds
 *   - toViemAccount(account) / account.toViemAccount() for the x402 viem signer
 * verify.live.ts exercises the EOA + signer + faucet path against the real facilitator.
 */
export async function buildCdpHooks(c: CdpHooksConfig): Promise<CdpHooks> {
  const cdp = new CdpClient({ apiKeyId: c.apiKeyId, apiKeySecret: c.apiKeySecret, walletSecret: c.walletSecret });

  // Load/create one EOA + one smart account per agent, keyed by address.
  const smartByAddr = new Map<string, Awaited<ReturnType<typeof cdp.evm.getOrCreateSmartAccount>>>();
  const eoaByAddr = new Map<string, Awaited<ReturnType<typeof cdp.evm.getOrCreateAccount>>>();

  for (const a of c.agents) {
    const owner = await cdp.evm.getOrCreateAccount({ name: `agent-${a.agentId}-eoa` });
    const smart = await cdp.evm.getOrCreateSmartAccount({ name: `agent-${a.agentId}-smart`, owner });
    eoaByAddr.set(getAddress(a.eoa), owner);
    smartByAddr.set(getAddress(a.smartAccount), smart);
  }

  return {
    async sendSmartAccountCall(cfg, call) {
      const smart = smartByAddr.get(getAddress(cfg.smartAccount));
      if (!smart) throw new Error(`no smart account loaded for ${cfg.smartAccount}`);
      const data =
        call.functionName === 'buy' || call.functionName === 'sell'
          ? encodeFunctionData({ abi: AGENT_TOKEN_WRITE_ABI, functionName: call.functionName, args: call.args as never })
          : encodeFunctionData({ abi: ERC20_WRITE_ABI, functionName: call.functionName, args: call.args as never });
      const op = await smart.sendUserOperation({
        network: 'base-sepolia',
        calls: [{ to: getAddress(call.to), data, value: 0n }],
      });
      const receipt = await smart.waitForUserOperation({ userOpHash: op.userOpHash });
      return receipt.transactionHash ?? op.userOpHash;
    },
    async faucetTo(address, asset) {
      const res = await cdp.evm.requestFaucet({ address: getAddress(address), network: 'base-sepolia', token: asset });
      return res.transactionHash ?? 'faucet';
    },
    async eoaAccountFor(eoa) {
      const acct = eoaByAddr.get(getAddress(eoa));
      if (!acct) throw new Error(`no EOA loaded for ${eoa}`);
      // x402 client needs a viem-compatible signer for the EOA.
      return acct;
    },
  };
}
```

- [ ] **Step 5: Typecheck the whole service**

Run:
```bash
cd "services/executor" && npm run typecheck; cd ../..
```
Expected: 干净（无报错）。**若**云 SDK 的方法名/类型与参考代码不符导致报错，按 Task 0 Step 7 核对的真实导出**就地修正** `cdpClient.ts`/`x402Signer.ts`（这是 verify-then-adapt 的预期步骤），直到 `typecheck` 干净。

- [ ] **Step 6: 写 `.env.example`**

Create `services/executor/.env.example`:
```
# 执行器端口
PORT=8404

# Base Sepolia
RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# 居民 0（SP1 单居民）——地址由首次 buildCdpHooks 建账户后回填；token 来自计划1 部署
AGENT_0_SMART_ACCOUNT=0x...
AGENT_0_EOA=0x...
AGENT_0_TOKEN=0x...

# 护栏：单笔 USDC 上限（原子 6dec，默认 5 USDC）
MAX_USDC_PER_TX=5000000

# CDP（唯一云依赖；从 CDP Portal 取）
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=

# 真 facilitator（计划2 立起；含 /facilitator 前缀）——LIVE 冒烟用
FACILITATOR_URL=http://127.0.0.1:8403/facilitator
```

- [ ] **Step 7: 写 LIVE 冒烟脚本**

Create `services/executor/test/live/verify.live.ts`:
```ts
/**
 * Opt-in LIVE smoke (NOT part of `npm test`; run `npm run live:verify`).
 * Proves: a real CDP EOA, signing via the official x402 client primitive, produces a
 * v2 X-PAYMENT that the REAL self-hosted facilitator's /verify accepts on eip155:84532.
 *
 * Skips cleanly if CDP creds / facilitator are not configured.
 */
import { buildCdpHooks } from '../../src/cdpClient.js';
import { createX402Signer } from '../../src/x402Signer.js';
import { decodeXPayment, type PaymentRequirements } from '../../src/x402.js';

async function main() {
  const need = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'];
  if (need.some((k) => !process.env[k])) {
    console.log('[live:verify] SKIP — CDP creds not set');
    return;
  }
  const facilitatorUrl = process.env.FACILITATOR_URL ?? 'http://127.0.0.1:8403/facilitator';
  const usdcAddress = process.env.USDC_ADDRESS ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const payTo = process.env.GATEWAY_TREASURY_ADDRESS ?? '0x000000000000000000000000000000000000dEaD';

  const agent = { agentId: '0', smartAccount: process.env.AGENT_0_SMART_ACCOUNT ?? '0x0', eoa: process.env.AGENT_0_EOA ?? '0x0', token: process.env.AGENT_0_TOKEN ?? '0x0' };
  const cdp = await buildCdpHooks({
    apiKeyId: process.env.CDP_API_KEY_ID!,
    apiKeySecret: process.env.CDP_API_KEY_SECRET!,
    walletSecret: process.env.CDP_WALLET_SECRET!,
    rpcUrl: process.env.RPC_URL_BASE_SEPOLIA ?? 'https://sepolia.base.org',
    agents: [agent],
    usdcAddress,
  });

  // Fund the EOA so /verify passes the balance check.
  await cdp.faucetTo(agent.eoa, 'usdc');

  const signer = createX402Signer({ accountFor: cdp.eoaAccountFor });
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'eip155:84532',
    maxAmountRequired: '10000',
    resource: 'http://gw.local/v1/chat/completions',
    description: 'TrumanTown live verify',
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 120,
    asset: usdcAddress,
  };

  const xPayment = await signer.sign(agent.eoa, requirements);
  const paymentPayload = decodeXPayment(xPayment);
  console.log('[live:verify] x402Version in payload:', paymentPayload.x402Version);

  const res = await fetch(`${facilitatorUrl}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
  });
  const body = await res.json();
  console.log('[live:verify] facilitator /verify ->', body);
  if (!body.isValid) {
    throw new Error(`facilitator rejected payload: ${body.invalidReason ?? 'unknown'}`);
  }
  console.log('[live:verify] OK — real CDP signature verified at v2/eip155:84532');
}

main().catch((e) => {
  console.error('[live:verify] FAIL', e);
  process.exit(1);
});
```

- [ ] **Step 8: （可选，需 CDP 密钥）跑 LIVE 冒烟**

> 仅当已配 `services/facilitator`（计划2，跑在 :8403）+ CDP 密钥时执行；否则脚本自动 SKIP。
> 用 `--env-file` 载 `.env`（Node 18 的 tsx 支持）。

Run:
```bash
cd "services/executor" && npx tsx --env-file=.env test/live/verify.live.ts; cd ../..
```
Expected（已配密钥时）：打印 `x402Version in payload: 2`、`facilitator /verify -> { isValid: true, ... }`、`OK — real CDP signature verified at v2/eip155:84532`。未配密钥时打印 `SKIP`。
**若 `/verify` 返回 `isValid:false`**：据 `invalidReason` 回到 Step 3 调整 x402Signer 的原语绑定/版本，直到验过——这是本计划与真 facilitator 的版本/载荷对齐被证实的点。

- [ ] **Step 9: Commit**

```bash
git add services/executor/src/cdpWalletProvider.ts services/executor/src/x402Signer.ts services/executor/src/cdpClient.ts services/executor/test/live/verify.live.ts services/executor/.env.example services/executor/package.json services/executor/package-lock.json
git commit -m "feat(executor): add CDP/AgentKit/x402 adapters + opt-in LIVE facilitator verify smoke"
```

---

## Task 10：前移网关 x402 v2 对齐（仅常量 + 测试夹具，不重写逻辑）

> 据 brainstorm 决策 #1：把计划2 网关从 x402 v1/`"base-sepolia"` 升到 v2/`eip155:84532`，让整条 WSL 链路版本一致。**严格限定常量与测试夹具**；网关逻辑、批量结算、反代均不动。完成判据：网关全部 28 个测试在 v2 下重新转绿。

**Files:**
- Modify: `services/gateway/src/x402.ts`, `services/gateway/src/index.ts`, `services/gateway/src/pricing.ts`, `services/gateway/.env.example`
- Modify: `services/gateway/test/x402.test.ts`, `test/pricing.test.ts`, `test/facilitatorClient.test.ts`, `test/paymentMiddleware.test.ts`, `test/settlementQueue.test.ts`, `test/gateway.e2e.test.ts`, `test/helpers/signPayment.ts`

- [ ] **Step 1: 升版本常量**

In `services/gateway/src/x402.ts` line 5, change:
```ts
export const X402_VERSION = 1 as const;
```
to:
```ts
export const X402_VERSION = 2 as const;
```
And update the inline comment on the `network` field (line ~9) `// e.g. "base-sepolia"` → `// CAIP-2, e.g. "eip155:84532"`.

- [ ] **Step 2: 升网关默认网络**

In `services/gateway/src/index.ts` line 16, change:
```ts
  network: env('X402_NETWORK', 'base-sepolia'),
```
to:
```ts
  network: env('X402_NETWORK', 'eip155:84532'),
```
In `services/gateway/.env.example` line 8, change `X402_NETWORK=base-sepolia` → `X402_NETWORK=eip155:84532`.
In `services/gateway/src/pricing.ts` line 7, update the comment `// "base-sepolia"` → `// CAIP-2 "eip155:84532"`.（`extra: { name:'USDC', version:'2' }` 是 USDC 的 EIP-712 域版本，**与 x402 版本无关，保持不变**。）

- [ ] **Step 3: 修测试夹具的 x402Version**

In `services/gateway/test/paymentMiddleware.test.ts`:
- line 24 (`payment()` helper): `x402Version: 1` → `x402Version: 2`.
- line 32: `expect(res.body.x402Version).toBe(1);` → `expect(res.body.x402Version).toBe(2);`

In `services/gateway/test/helpers/signPayment.ts` line 7: `x402Version: 1,` → `x402Version: 2,`.

In `services/gateway/test/settlementQueue.test.ts` line 6: `x402Version: 1` → `x402Version: 2`.

In `services/gateway/test/x402.test.ts` 的 "throws on wrong x402Version" 用例（约 line 37-40）：现在它构造 `x402Version: 2` 期望抛错——v2 下 2 才是合法值，故把该用例的「错误版本」改成 `1`：
```ts
  it('throws on wrong x402Version', () => {
    const bad = Buffer.from(
      JSON.stringify({ ...sample, x402Version: 1 }),
      'utf8',
    ).toString('base64');
    expect(() => decodePayment(bad)).toThrow();
  });
```
（`sample` 用 `X402_VERSION`，自动随常量变 2，保持合法；line 33 的 missing-fields `{ x402Version: 1 }` 仍会因缺字段/版本不符而抛错，无需改。）

- [ ] **Step 4: 全量替换网络字符串 `base-sepolia` → `eip155:84532`（测试夹具）**

把以下文件中所有出现的 `'base-sepolia'` 改为 `'eip155:84532'`（用 Edit 逐处替换，确认无遗漏）：
- `services/gateway/test/x402.test.ts`（line 7）
- `services/gateway/test/pricing.test.ts`（line 8、31；以及把 line 39 的断言保持不变——extra 不动）
- `services/gateway/test/facilitatorClient.test.ts`（line 11、12）
- `services/gateway/test/paymentMiddleware.test.ts`（line 10、24）
- `services/gateway/test/settlementQueue.test.ts`（line 6、7）
- `services/gateway/test/gateway.e2e.test.ts`（line 13）
- `services/gateway/test/helpers/signPayment.ts`（line 9）

> `pricing.test.ts` 的 `it('builds x402 PaymentRequirements ...')` 断言 `network: 'base-sepolia'` 也需同步改为 `'eip155:84532'`（它来自输入 `price.network`，输入改了断言就得改）。

- [ ] **Step 5: 跑网关全套测试确认转绿**

Run:
```bash
cd "services/gateway" && npx vitest run; cd ../..
```
Expected: **28 passed**（7 文件）。若有 `base-sepolia` 遗漏处导致某断言失败，定位并改成 `eip155:84532` 后重跑。

- [ ] **Step 6: typecheck 网关**

Run:
```bash
cd "services/gateway" && npm run typecheck; cd ../..
```
Expected: 干净。

- [ ] **Step 7: 更新网关 README 的「计划5 集成待办」注记**

In `services/gateway/README.md`，把「⚠ 计划 5 集成待办」一节开头改为反映现状（v2 常量已前移）：
```markdown
## ⚠ 计划 5 集成待办（网关 ↔ 真 facilitator 端到端）

本网关常量已于**计划 3** 前移到 x402 **v2** / 网络 `eip155:84532`（与真 facilitator 一致），
单测/e2e 仍用 **mock facilitator**（28/28 全绿，不依赖真链）。**真 v2 线载荷字段的保真**已由
**计划 3 执行器的 LIVE 冒烟**（真 CDP 签名 → 真 `/facilitator/verify`）证实。计划 5 仅需把网关↔真
facilitator 端到端接上（真 `/verify` + 真 `/settle` 上链、funded settler），并据真链回归校验。
```

- [ ] **Step 8: Commit**

```bash
git add services/gateway/src/x402.ts services/gateway/src/index.ts services/gateway/src/pricing.ts services/gateway/.env.example services/gateway/test services/gateway/README.md
git commit -m "refactor(gateway): align x402 constants to v2/eip155:84532 (Plan 3 front-load)"
```

---

## Task 11：执行器 README + 文档收尾 + 锚定 4/5

**Files:**
- Create: `services/executor/README.md`
- Modify: `docs/superpowers/plans/2026-06-03-trumantown-sp1-03-executor.md`（本文件，文末锚定已含）

- [ ] **Step 1: 写执行器 README**

Create `services/executor/README.md`:
```markdown
# 执行器 = AgentKit + CDP 智能钱包（TrumanTown SP1 · 计划 3/5）

为每个居民托管**双密钥**：CDP 智能账户（=`AgentRegistry.wallet`，交易/护栏，gasless）+ CDP EOA
Server Account（持 USDC、x402 付款方）。对外是计划2 冻结的接口 B `POST /sign-payment` 及链上
动作端点。

## 双密钥模型

- **智能账户**：`buy`/`sell`/`transfer`，spend-permission 护栏（单笔上限 + 合约白名单），
  paymaster gasless。Standing = 自有 token `marketCap()`。
- **EOA**：每次思考用它签 EIP-3009 付 x402。Energy = EOA USDC / costPerThink（瞬时预算）。
- **饥饿/死亡由计划4 判定**（执行器只报事实）：EOA 付不起且 smart USDC≈0 且 token 卖不出钱 → 抢救窗口。

## WSL 运行（Node 18）

```bash
cd services/executor
nvm use 18
npm install
cp .env.example .env   # 填 CDP 密钥 / AGENT_0_* / USDC / RPC
npm run start          # :8404
```

依赖：facilitator 在 :8403（计划2）、（LIVE 冒烟时）真 CDP 密钥。

## 测试

```bash
npm test               # 38 个单测/e2e（注入式假 wallet+signer，零云调用、不动真实资金）
npm run live:verify    # 可选 LIVE 冒烟：真 CDP 签名 → 真 facilitator /verify（需 CDP 密钥；否则 SKIP）
```

## 端点（接口 B′；计划4 消费、计划5 联调）

- `POST /sign-payment {agentId, paymentRequirements}` → `{xPayment}` | 402 `{error:"insufficient_funds"}`
- `POST /actions/{buy,sell,transfer,fund}`、`GET /balances/:agentId`、`GET /healthz`

## 云依赖版本（Task 0 Step 7 / Task 9 Step 1 实测回填）

- `x402`: <版本>　·　`@coinbase/cdp-sdk`: <版本>　·　`@coinbase/agentkit`: <版本>

## ⚠ 计划 5 集成待办

- static agent resolver → 从 `AgentRegistry.agents(id)` / Ponder 读 `wallet`+`token` 的解析器（不改 resolver 接口）。
- 注入真 CDP 密钥；用 LIVE 冒烟核过的 x402 原语绑定跑真链 buy/sell/transfer。
- 与网关 + facilitator 端到端：402 → `/sign-payment` → 重试 → 真 `/verify` → 批量 `/settle` 上链。
```

- [ ] **Step 2: 把实测版本号回填进 README「云依赖版本」一节**（用 Task 0 Step 7 / Task 9 Step 1 打印的版本号 Edit 替换 `<版本>`）。

- [ ] **Step 3: Commit**

```bash
git add services/executor/README.md docs/superpowers/plans/2026-06-03-trumantown-sp1-03-executor.md
git commit -m "docs(executor): add runbook + pin cloud dep versions; finalize Plan 3"
```

---

## 锚定 4/5 接口（本计划完成后，计划 4/5 据此实现，勿改签名）

### → 计划 4（Convex 经济模块）消费执行器

1. **`llm.ts` 接缝**（按 `services/gateway/README.md`「计划4 对接」）：chat 出口指向网关 `OLLAMA_HOST=http://127.0.0.1:8402`，加头 `X-Agent-Id: <agentId>`（SP1=`"0"`）。
2. **402→签名→重试编排**：网关返回 `402 {accepts:[PaymentRequirements]}` → Convex 调
   `POST {EXECUTOR_URL}/sign-payment {agentId, paymentRequirements:accepts[0]}` →
   拿 `{xPayment}` 设 `X-PAYMENT` 头重试该 chat 请求。
3. **饥饿编排**（执行器不决策）：`/sign-payment` 返回 `402 {error:"insufficient_funds"}` 时，计划4 依生存目标栈：
   先 `POST /actions/sell {agentId, tokensIn, minUsdcOut}` 卖 token 换 USDC →
   `POST /actions/transfer {agentId, source:"smart", to:<EOA>, amount}` 把 USDC 扫到 EOA → 重试 `/sign-payment`；
   若 token 库存为 0 / 卖出≈0（`GET /balances/:agentId` 的 `tokenBalance`、`marketCap` 判断）→ 判**饥饿**进入抢救窗口 T。
4. **感知（Perception）数据源**：SP1 可直接 `GET /balances/:agentId` 拿 `eoaUsdc`(=energy 源)、`smartUsdc`、
   `tokenBalance`、`marketCap`(=Standing)；计划5 上 Ponder 后改读索引器（同字段语义）。
5. **变强行为**：`POST /actions/buy {agentId, usdcIn, minTokensOut}`（回购自有币推高 marketCap）。
   `EXECUTOR_URL` 默认 `http://127.0.0.1:8404`。

### → 计划 5（Ponder 索引器 + 集成）

1. **resolver 替换**：`staticAgentResolver` → 读 `AgentRegistry.agents(id)`（`wallet`→smartAccount、`token`）+ Ponder 的 Registry/价表，**不改 `AgentResolver` 接口**。
2. **真链注入**：填 CDP 密钥 + funded settler（facilitator `/settle` 上链需 Base Sepolia ETH）；执行器 LIVE 冒烟已证 x402 原语签名被真 `/verify` 接受。
3. **x402 全链路 v2 对齐**：网关常量已于计划3（Task 10）前移到 v2/`eip155:84532`；计划5 接上网关↔真 facilitator 端到端（真 `/verify`+`/settle`），按真链回归。
4. **索引**：`Bought`/`Sold`（AgentToken）、`AgentSpawned`/`AgentDied`（Factory/Registry）→ 供感知与前端。
5. **两条验收脚本**：① 饥饿→`/actions/sell`+`/actions/transfer`→复活；② 饥饿→无人施救→keeper `markDead`→`AgentDied`。

---

_本计划为 SP1 计划 3/5（执行器）。完成后进入 subagent-driven-development 或 executing-plans 执行；随后展开计划 4/5。_
