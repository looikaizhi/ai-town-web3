# 楚门镇 SP1 · 计划 5/5：Ponder 索引器 + 端到端集成 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SP1 收官——立起 **Ponder 索引器**（索引 `AgentToken.Bought/Sold`、`LaunchpadFactory.AgentSpawned`、`AgentRegistry.AgentRegistered/AgentDied`，暴露 per-agent 读 API，字段语义对齐执行器 `/balances` 的 Standing 侧）；把网关/执行器/Convex 的**静态 resolver 与常量镜像**替换成**以链上 `AgentRegistry.agents(id)` 为准 + Ponder 价表驱动**（并保证伪造的 `X-Agent-Id` 不能换更便宜/免费推理）；把 x402 全链路对齐到**真 facilitator** 端到端（真 `/verify` + 批量 `/settle` 上链）；接通执行器 `transferUsdc(source:"eoa")` 的 CDP EOA send；新增 **keeper**（消费 `agentEconomy.status='dead'` → 执行器 `/actions/mark-dead` → 链上 `AgentRegistry.markDead(id)` → `AgentDied`）；最后用**两条 Base Sepolia LIVE 验收脚本**跑通「饥饿→卖币+扫款→复活」与「饥饿→无人施救→T=10→markDead+AgentDied」。

**Architecture:** 新增第四个**隔离的 WSL 本地 Node 子工程 `services/indexer/`**（Ponder，与 gateway:8402/facilitator:8403/executor:8404 平级，端口 :42069，各自 `package.json`/`node_modules`/Vitest）。沿用前四个计划已确立的可测边界：**纯逻辑用 TDD 单测**（索引器读 API 聚合、网关/执行器/Convex 的 registry-cache resolver、Ponder HTTP 客户端、keeper 编排——全部经接缝注入假实现，零链/零云），**链上 & 真链 & 真 SDK 胶水靠 `typecheck` + 可选 LIVE 冒烟**（Ponder handler 读合约、CDP EOA send、真 facilitator verify/settle、链上 markDead——与计划 2/3「fork+冒烟、verify-then-adapt」同源）。感知按已锁定的**混合数据源**：Ponder 供 Standing（tokenBalance/marketCap/price/usdcReserve）+ 注册表镜像（token/wallet/costPerThink/floor/recoveryWindow/alive），**energy 所需的 USDC 余额（eoaUsdc/smartUsdc）仍走链读**（pay-to-think 核心闸门保持链上真值、零索引器滞后）。所有新行为延续既有门控：经济侧 `TRUMANTOWN_ECONOMY=1`、resolver 侧各服务的 `*_REGISTRY` env、验收侧 `TRUMANTOWN_E2E=1` + CDP 密钥，**未配置即回退/SKIP，不破坏既有全绿测试**。

**Tech Stack:** TypeScript（Node 18，WSL）· **Ponder ^0.11**（onchainTable schema + factory 动态合约 + `context.client` 合约读 + Hono API 路由）· `viem`（链上只读 + 注册表读 + keeper 写）· Vitest + Supertest（索引器/网关/执行器 TDD）· Jest 29 + ts-jest ESM（Convex TDD）· `@x402/core` + `@x402/evm` 2.14.0（真 facilitator v2/`eip155:84532`，与计划 3 同源）· `convex`（ConvexHttpClient，验收脚本驱动）· 复用计划 1 链上 ABI、计划 2 网关契约 A/C、计划 3 执行器契约 B′、计划 4 Convex 经济模块。

---

## ⛔ 运行环境（贯穿全计划，务必遵守）

- 本计划所有 Node/npm/Ponder/Vitest/Jest/convex 进程**只在 WSL Ubuntu 内运行**。Bash 工具是 Windows Git Bash(MINGW)，**不是** Linux；内联 `wsl bash -lc '...npm...'` 不可靠。
- **可靠配方（项目记忆 `wsl-node-toolchain.md`）**：把命令写进 `scripts/_cmd.sh`（untracked 草稿，**勿 git add**），前两行固定：
  ```
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 18 >/dev/null
  cd "/mnt/d/AI Agent/ai-town-web3/<子目录>"
  ```
  再用 Bash 工具执行：
  `wsl.exe -d Ubuntu bash -lc 'sed -i "s/\r//" "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh"; bash "/mnt/d/AI Agent/ai-town-web3/scripts/_cmd.sh"'`
  本计划下文每个 **Run** 块给出的是**逻辑命令**（如 `cd services/indexer && npx vitest run test/aggregate.test.ts`），执行时按上述配方包一层。
- **测试运行器分两套（别混）**：`services/*`（gateway/facilitator/executor/indexer/e2e）用 **Vitest**；根 `convex/` 用 **Jest**（`NODE_OPTIONS=--experimental-vm-modules npx jest <路径> --verbose`；全量 `npm test`；typecheck `npx tsc -p convex --noEmit`）。
- **文件一律用 Write/Edit 写**（Windows 路径 `d:\AI Agent\ai-town-web3\...`），不要用 shell heredoc/echo 造文件。
- **git 用 Windows 原生**（Bash 工具：`cd "d:/AI Agent/ai-town-web3" && git ...`），勿走 WSL。
- 在分支 `feat/sp1-ponder` 上工作，**不要直接写 main**。执行用 subagent-driven-development，每个任务两阶段审查（spec 合规 → 代码质量）。

---

## 设计说明（对设计稿/锁定决策 + brainstorm #5 的诚实细化）

设计稿 §3.4/§5/§9 与各计划文末「锚定 5/5」要求：上 Ponder、把感知与 resolver 换成链上/索引器驱动、跑通两条剧本。落到可执行计划时，据本计划 brainstorm 已确认的三项决策细化（其余用合理默认值，见下「默认值」）：

1. **感知数据源 = 混合（Ponder 供 Standing，USDC 走链读）。** Ponder 从 `Bought/Sold` 推导 + `context.client` 即时读 `marketCap()/pricePerToken()/usdcReserve()` 及 wallet 的 `balanceOf`，是 Standing/库存/价的权威；但 `eoaUsdc/smartUsdc`（= energy 源、pay-to-think 闸门）**继续由经济 tick 直接链读**（执行器 `/balances` 或 viem），保持精确、零索引器滞后。`tick.ts` 改为：Standing + 生命参数取 Ponder/注册表，USDC 取链读。**字段语义不变**（与计划 4 锚定一致）。

2. **keeper = 执行器新增 `POST /actions/mark-dead` 端点（keeper-only）。** 保持「执行器是唯一发链上交易的服务」不变量；keeper 私钥（= 计划 1 `AgentRegistry` 构造里的 `keeper` 地址对应钥）注入执行器，用 viem 直发 `markDead(id)`。Convex 经济 tick 在 `status` 翻 `dead`（且本周期首次）时 HTTP 调该端点。对 B′ 契约是**纯增量**端点，不改既有签名。

3. **两条验收脚本 = Base Sepolia LIVE，opt-in，未配置即 SKIP。** 纯编排逻辑（402→签名→重试 + 卖币扫款 + 生存状态机）已在计划 4 `payment.test.ts`/`survival.test.ts` 单测覆盖；本计划的验收脚本是**真链真相检验**（真 CDP 签名、真 facilitator、真 markDead/AgentDied），放在新隔离子工程 `services/e2e/`，沿用计划 3 `verify.live.ts` 的 gate+SKIP 模式。

**resolver 替换的反伪造语义（brainstorm 决策落地）：** 网关/执行器的 registry-backed resolver **以链上 `AgentRegistry.agents(id)` 为唯一定价/解析来源**，且**移除「任意未知 id 回退到默认价」的宽容 fallback**——未在链上注册（或链上 `alive=false`）的 id → resolver 返回 `undefined` → 网关 402/500、执行器 404，**伪造的 `X-Agent-Id` 拿不到更便宜/免费推理**。因 `AgentResolver`/`PriceResolver` 是**同步**签名（计划 2/3 冻结、被中间件同步调用），链读用**启动预取 + 周期刷新的内存缓存**承载：boot 时读 `agents(id)` 填缓存，之后定时刷新；同步 resolve 命中缓存。这样既不改冻结的同步接口，又让定价以链为准。

**可单测边界：** 纯逻辑（索引器 `aggregate`、各 registry-cache resolver、Convex `ponderClient`、`keeper` 编排、executorClient 新方法）零链/零云依赖、用各自 runner TDD；链/真链/真 SDK 胶水（Ponder config/schema/handlers/API、cdp EOA send、真 facilitator settle、链上 markDead、两条验收脚本）靠 `typecheck`（`ponder typecheck` / `tsc`）+ 可选 LIVE 冒烟。**门控**：经济 `TRUMANTOWN_ECONOMY`、各服务 `GATEWAY_USE_REGISTRY`/`EXECUTOR_USE_REGISTRY`/`PONDER_URL`、`TRUMANTOWN_E2E` 默认关，关闭时行为与计划 4 结束态逐字节一致，既有测试不回归。

---

## 默认值（无法从设计稿/代码唯一推断、本计划据此推进并在此写明）

| 维度 | 默认值 | 理由 |
|---|---|---|
| Ponder 端口 | `:42069`（Ponder 默认） | 与 8402/8403/8404 不冲突；`PONDER_URL` 可覆盖。 |
| Ponder 链 | Base Sepolia（chainId 84532）主；anvil 可选（同 ABI、换 `PONDER_RPC_URL`/地址） | 设计稿「anvil 内环→Base Sepolia 集成」；索引器 handler 不分链。 |
| 合约地址来源 | env（`FACTORY_ADDRESS`/`REGISTRY_ADDRESS`/`USDC_ADDRESS` + `START_BLOCK`），由计划 1 `Deploy.s.sol` 输出回填 | 部署产物不入库；env 注入与执行器/网关同模式。 |
| Ponder schema | `onchainTable`（Ponder ≥0.6 现代 API） | 当前 Ponder 主线；若安装版本 API 不同，按 `ponder typecheck` verify-then-adapt（同计划 2/3 处理 x402/CDP）。 |
| 索引器读 API | 自定义 Hono 路由 `GET /agents/:id`、`GET /agents`（除 Ponder 自带 `/graphql`/`/sql` 外） | Convex/前端要简单 JSON；与执行器 `/balances` 形状对齐。 |
| 网关/执行器 resolver 缓存刷新 | 30s（`REGISTRY_REFRESH_MS`） | 与经济 tick 同量级；Standing/生命参数变化慢。 |
| keeper 钱包 | 裸私钥 `KEEPER_PRIVATE_KEY`（viem account），非 CDP | keeper 是注册表 `keeper` 地址，独立于居民 CDP 钱包；需 Base Sepolia ETH 付 gas。 |
| 「币价归零」 | SP1 = 链上 `AgentDied` + `alive=false` + Ponder 标 dead（曲线本身不强制清零） | 合约 `markDead` 只翻 `alive`+发事件；强制清零/遗产属 SP5。诚实标注。 |
| 前端读取 | 仅暴露 Ponder 读 API + 一个示例查询；**不建 UI** | SP1 §10 Non-Goal：前端互动 UI 自 SP2 起。 |
| 验收脚本驱动 think | 直连网关 `/v1/chat/completions`（复刻 payment.ts 编排），不经 Convex cron | 真链闭环的更直接真相检验；与 Convex cron 时序解耦。死亡脚本经 Convex（计数权威在 tick）。 |

---

## 锚定接口（复用，勿改签名）

### 复用计划 1 链上 ABI（索引器/resolver/keeper 消费）
- `AgentToken`：事件 `Bought(address indexed buyer, uint256 usdcIn, uint256 tokensOut)`、`Sold(address indexed seller, uint256 tokensIn, uint256 usdcOut)`；只读 `pricePerToken()`、`marketCap()`、`usdcReserve()`、`balanceOf(address)`、`maxSupply()`。
- `LaunchpadFactory`：事件 `AgentSpawned(uint256 indexed agentId, address token, address wallet)`。
- `AgentRegistry`：`agents(uint256) -> (address token, address wallet, uint256 costPerThink, uint256 floor, uint256 recoveryWindow, bool alive)`；`markDead(uint256)`（keeper-only）；事件 `AgentRegistered(uint256 indexed agentId, address token, address wallet)`、`AgentDied(uint256 indexed agentId)`。
- USDC（Base Sepolia）= `0x036CbD53842c5426634e7929541eC2318f3dCF7e`（6dec）；anvil 用 `MockUSDC`。

### 复用计划 2 网关契约 A / C（不改）
- A：`POST /v1/chat/completions`（头 `X-Agent-Id`），402+`{x402Version,error,accepts:[PaymentRequirements]}`；`X-PAYMENT` 重试→200。
- C：真 facilitator `POST /facilitator/verify`、`/facilitator/settle`、`GET /facilitator/supported`（v2/`eip155:84532`，含 `/facilitator` 前缀）。
- 网关 `PriceResolver = (agentId:string)=>AgentPrice|undefined`（**同步**，本计划新增 registry-backed 实现，签名不变）。

### 复用计划 3 执行器契约 B′（不改既有，仅**增量** `/actions/mark-dead`）
- `POST /sign-payment`、`/actions/{buy,sell,transfer,fund}`、`GET /balances/:agentId`、`GET /healthz`（全部不动）。
- `AgentResolver = (agentId:string)=>AgentConfig|undefined`（**同步**，本计划新增 registry-backed 实现，签名不变）。
- `WalletProvider.transferUsdc(cfg, source, to, amount)`（本计划补齐 `source:"eoa"` 的真实 EOA send；接口不变）。
- **新增**：`POST /actions/mark-dead {agentId}` → `200 {txHash}` | `404` | `400` | `501`（未配 keeper）。

### 复用计划 4 Convex 经济模块（本计划外科手术式替换数据源 + 加 keeper 触发）
- `agentEconomy` 表 / `survival.ts` / `goalStack.ts` / `payment.ts` / `executorClient.ts` / `perception.ts` / `tick.ts` 既有签名不变；本计划只：(a) 新增 `ponderClient.ts` + `registry.ts`，(b) `tick.ts` 改为混合数据源 + dead→keeper 调用，(c) `executorClient.ts` 加 `markDead` 方法，(d) 新增 gated `e2e.ts`（验收脚本驱动）。

---

## 文件结构（本计划创建/修改）

```
services/indexer/                      ← 新子工程（Ponder，隔离）
  package.json · tsconfig.json · ponder-env.d.ts · vitest.config.ts · .gitignore · .env.example
  ponder.config.ts        — networks + 合约（factory 动态 AgentToken）（glue, typecheck）
  ponder.schema.ts        — onchainTable: agent / tokenIndex / trade（glue, typecheck）
  abis/AgentToken.ts · abis/LaunchpadFactory.ts · abis/AgentRegistry.ts（const ABI 镜像，计划1）
  src/index.ts            — 事件 handler（Registered/Spawned/Died/Bought/Sold）（glue, typecheck+smoke）
  src/aggregate.ts        — agent 行 → 读 API 聚合（纯，Vitest）
  src/api/index.ts        — Hono 读路由 GET /agents/:id、/agents（glue, typecheck+smoke）
  test/aggregate.test.ts
  README.md               — 立起/索引/读 API/计划5 状态
  scripts/smoke.ts        — 索引器读 API 冒烟（opt-in）

services/gateway/
  src/registryResolver.ts — 链上 AgentRegistry.costPerThink → PriceResolver（缓存，纯+viem 注入）（Vitest）
  test/registryResolver.test.ts
  src/index.ts            — 修改：GATEWAY_USE_REGISTRY 时装配 registry resolver（glue）
  .env.example            — 追加 REGISTRY_ADDRESS / RPC / GATEWAY_USE_REGISTRY / REGISTRY_REFRESH_MS
  README.md               — 修改：计划5 完成注记

services/executor/
  src/registryAgentResolver.ts — 链上 agents(id) + CDP EOA 派生 → AgentResolver（缓存，纯+注入）（Vitest）
  test/registryAgentResolver.test.ts
  src/keeper.ts           — markDeadForAgent 编排（纯，Vitest）
  test/keeper.test.ts
  src/executor.ts         — 修改：装配 markDead 依赖 + POST /actions/mark-dead 路由
  test/executor.e2e.test.ts — 修改：mark-dead 端点用例（注入 fake markDead）
  src/cdpWalletProvider.ts — 修改：transferUsdc(source:"eoa") 走注入的 sendEoaTransfer
  src/cdpClient.ts        — 修改：加 sendEoaTransfer hook（CDP EOA send）（glue）
  src/keeperSigner.ts     — viem keeper account → markDead(id)（glue, typecheck+LIVE）
  src/index.ts            — 修改：装配 registry resolver（gate）+ keeper signer
  .env.example            — 追加 KEEPER_PRIVATE_KEY / EXECUTOR_USE_REGISTRY / REGISTRY_ADDRESS / REFRESH
  README.md               — 修改：计划5 完成注记

convex/economy/
  ponderClient.ts         — Ponder 读 API HTTP 客户端（纯，Jest）
  ponderClient.test.ts
  registry.ts             — 经济参数解析（Ponder 优先，env 兜底）（纯，Jest）
  registry.test.ts
  executorClient.ts       — 修改：加 markDead(agentId) 方法
  executorClient.test.ts  — 修改：markDead 用例
  tick.ts                 — 修改：混合数据源（Ponder Standing + 链读 USDC）+ dead→executor mark-dead；抽出可复用 handler
  e2e.ts                  — 新增：gated 公开 action tickOnce + query getStatus（验收脚本驱动）（glue）
  constants.ts            — 修改：加 ponderUrl()/keeperEnabled() 等 env 读取
  README.md               — 修改：计划5 完成（混合数据源 + keeper）

services/e2e/                          ← 新子工程（验收脚本，隔离）
  package.json · tsconfig.json · vitest.config.ts · .gitignore · .env.example
  src/lib.ts              — HTTP/chain 小工具（纯部分 Vitest）
  test/lib.test.ts
  src/revive.live.ts      — 验收①：饥饿→卖币+扫款→复活（LIVE, gate+SKIP）
  src/death.live.ts       — 验收②：饥饿→无人施救→T=10→markDead+AgentDied（LIVE, gate+SKIP）
  README.md

services/gateway/test/live/facilitator.live.ts — x402 全链路 v2：网关↔真 facilitator verify/settle（LIVE, gate+SKIP）

.gitignore                — 追加 services/indexer 的 .ponder/ generated/
docs/superpowers/plans/2026-06-03-trumantown-sp1-05-ponder.md — 本文件
```

> 不改：合约（计划 1 冻结）、facilitator fork（计划 2 立起）、计划 4 的 `survival.ts`/`goalStack.ts`/`payment.ts`/`perception.ts`/`schema.ts` 逻辑、引擎 `aiTown/*`。

---

## Task 0：索引器脚手架（WSL Node 18 隔离 Ponder 工程）

**Files:**
- Create: `services/indexer/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Modify: 仓库根 `.gitignore`

- [ ] **Step 1: 开分支 + 确认 WSL Node 18**

Run:
```bash
git checkout -b feat/sp1-ponder
nvm use 18 || nvm install 18; node -v
```
Expected: 分支切换成功；`node -v` 打印 `v18.x.x`。

- [ ] **Step 2: 写 `services/indexer/package.json`**

Create `services/indexer/package.json`:
```json
{
  "name": "trumantown-indexer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "ponder dev",
    "start": "ponder start",
    "codegen": "ponder codegen",
    "typecheck": "ponder typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "tsx scripts/smoke.ts"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "ponder": "^0.11.0",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "@types/node": "^18.19.0",
    "drizzle-orm": "^0.36.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

> Ponder 自带其 drizzle 版本；`drizzle-orm` 列为 devDependency 仅供 `aggregate.ts`/API 路由的 `eq` 类型对齐。Step 8 核对实际版本，若 Ponder ≥0.11 的 `ponder:api`/`ponder:schema` 导出方式不同，按 verify-then-adapt 就地绑定。

- [ ] **Step 3: 写 `services/indexer/tsconfig.json`**

Create `services/indexer/tsconfig.json`:
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
  "include": ["src", "test", "abis", "scripts", "ponder.config.ts", "ponder.schema.ts", "ponder-env.d.ts"]
}
```

- [ ] **Step 4: 写 `services/indexer/vitest.config.ts`**

Create `services/indexer/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: 写 `services/indexer/.gitignore`**

Create `services/indexer/.gitignore`:
```
node_modules/
.ponder/
generated/
.env
.env.local
```

- [ ] **Step 6: 写 `services/indexer/.env.example`**

Create `services/indexer/.env.example`:
```
# Ponder 读 API 端口
PORT=42069

# Base Sepolia RPC（Ponder 索引）
PONDER_RPC_URL_84532=https://sepolia.base.org

# 计划1 Deploy.s.sol 输出回填
FACTORY_ADDRESS=0x...
REGISTRY_ADDRESS=0x...
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# 部署区块（缩短回填范围；不确定填 0）
START_BLOCK=0
```

- [ ] **Step 7: 仓库根 `.gitignore` 追加 Ponder 产物**

Append to repo-root `.gitignore`（`services/*/node_modules/` 计划 2 已加，无需重复）:
```
services/indexer/.ponder/
services/indexer/generated/
```

- [ ] **Step 8: 安装依赖 + 核对 Ponder 版本（verify-then-adapt 记录）**

Run:
```bash
cd "services/indexer" && npm install && npm view ponder version && cd ../..
```
Expected: `node_modules/` 生成无 error；打印一个 Ponder 版本号（应为 0.11.x 或更高）。**决策记录**：把实际版本写进 README（Task 4）。若安装版本 ≥0.12 且 `onchainTable`/`ponder:schema`/`ponder:api` 导出有变，后续 Task 1–3 按实际导出就地调整，**`ponder typecheck` 干净 + smoke 通过是真相检验**。

- [ ] **Step 9: Commit**

```bash
git add services/indexer/package.json services/indexer/tsconfig.json services/indexer/vitest.config.ts services/indexer/.gitignore services/indexer/.env.example .gitignore
git commit -m "chore(indexer): scaffold isolated Ponder service (TS+Vitest)"
```

---

## Task 1：链上 ABI 镜像 + Ponder schema

**Files:**
- Create: `services/indexer/abis/AgentToken.ts`, `abis/LaunchpadFactory.ts`, `abis/AgentRegistry.ts`
- Create: `services/indexer/ponder.schema.ts`

- [ ] **Step 1: 写 AgentToken ABI 镜像**

Create `services/indexer/abis/AgentToken.ts`:
```ts
// Mirror of Plan 1 AgentToken (events + read fns the indexer needs).
export const AgentTokenAbi = [
  { type: 'event', name: 'Bought', inputs: [
    { name: 'buyer', type: 'address', indexed: true },
    { name: 'usdcIn', type: 'uint256', indexed: false },
    { name: 'tokensOut', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'Sold', inputs: [
    { name: 'seller', type: 'address', indexed: true },
    { name: 'tokensIn', type: 'uint256', indexed: false },
    { name: 'usdcOut', type: 'uint256', indexed: false },
  ] },
  { type: 'function', name: 'pricePerToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'marketCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'usdcReserve', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
```

- [ ] **Step 2: 写 LaunchpadFactory ABI 镜像**

Create `services/indexer/abis/LaunchpadFactory.ts`:
```ts
// Mirror of Plan 1 LaunchpadFactory (AgentSpawned drives the AgentToken factory tracking).
export const LaunchpadFactoryAbi = [
  { type: 'event', name: 'AgentSpawned', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'token', type: 'address', indexed: false },
    { name: 'wallet', type: 'address', indexed: false },
  ] },
] as const;
```

- [ ] **Step 3: 写 AgentRegistry ABI 镜像**

Create `services/indexer/abis/AgentRegistry.ts`:
```ts
// Mirror of Plan 1 AgentRegistry (events + agents(id) read for life params).
export const AgentRegistryAbi = [
  { type: 'event', name: 'AgentRegistered', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'token', type: 'address', indexed: false },
    { name: 'wallet', type: 'address', indexed: false },
  ] },
  { type: 'event', name: 'AgentDied', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
  ] },
  { type: 'function', name: 'agents', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [
    { name: 'token', type: 'address' },
    { name: 'wallet', type: 'address' },
    { name: 'costPerThink', type: 'uint256' },
    { name: 'floor', type: 'uint256' },
    { name: 'recoveryWindow', type: 'uint256' },
    { name: 'alive', type: 'bool' },
  ] },
] as const;
```

- [ ] **Step 4: 写 Ponder schema**

Create `services/indexer/ponder.schema.ts`:
```ts
import { onchainTable } from 'ponder';

// One row per registered agent: registry mirror + latest curve snapshot (Standing side).
// USDC wallet balances (energy) are intentionally NOT stored — Convex reads those live.
export const agent = onchainTable('agent', (t) => ({
  id: t.text().primaryKey(), // agentId as decimal string ("0")
  token: t.hex().notNull(),
  wallet: t.hex().notNull(), // CDP smart account = AgentRegistry.wallet
  costPerThink: t.bigint().notNull(),
  floor: t.bigint().notNull(),
  recoveryWindow: t.bigint().notNull(),
  alive: t.boolean().notNull(),
  // latest curve snapshot (atomic units; Standing source)
  tokenBalance: t.bigint().notNull(), // token held by `wallet`
  marketCap: t.bigint().notNull(),
  pricePerToken: t.bigint().notNull(),
  usdcReserve: t.bigint().notNull(),
  spawnedAt: t.bigint(),
  diedAt: t.bigint(),
  updatedAt: t.bigint().notNull(),
}));

// Reverse lookup token address -> agentId, so Bought/Sold handlers can find the agent.
export const tokenIndex = onchainTable('token_index', (t) => ({
  id: t.hex().primaryKey(), // token address
  agentId: t.text().notNull(),
}));

// Append-only trade log (Bought/Sold) for history + frontend (SP2+).
export const trade = onchainTable('trade', (t) => ({
  id: t.text().primaryKey(), // `${txHash}-${logIndex}`
  agentId: t.text(),
  token: t.hex().notNull(),
  side: t.text().notNull(), // 'buy' | 'sell'
  actor: t.hex().notNull(),
  usdc: t.bigint().notNull(),
  tokens: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));
```

- [ ] **Step 5: typecheck（schema + abi 编译干净）**

Run:
```bash
cd "services/indexer" && npx tsc --noEmit; cd ../..
```
Expected: 无报错。（`onchainTable` 由 ponder 包导出；ABI 为 `as const`。若 `tsc` 报 `ponder` 类型缺失，先 `npx ponder codegen` 生成 `ponder-env.d.ts` 后重跑——见 Task 2 Step 3。）

- [ ] **Step 6: Commit**

```bash
git add services/indexer/abis services/indexer/ponder.schema.ts
git commit -m "feat(indexer): add Plan-1 ABI mirrors and Ponder schema (agent/tokenIndex/trade)"
```

---

## Task 2：Ponder 配置 + 事件 handler（Registered/Spawned/Died/Bought/Sold）

**Files:**
- Create: `services/indexer/ponder.config.ts`, `services/indexer/src/index.ts`

> Ponder 胶水（config + handler）。handler 里用 `context.client.readContract` 即时读曲线状态，**不重写曲线数学**（与计划 1 的 `marketCap()/pricePerToken()` 同源）。靠 `ponder typecheck` + Task 4 smoke 验证。

- [ ] **Step 1: 写 `ponder.config.ts`**

Create `services/indexer/ponder.config.ts`:
```ts
import { createConfig, factory } from 'ponder';
import { http, getAbiItem } from 'viem';
import { AgentTokenAbi } from './abis/AgentToken';
import { LaunchpadFactoryAbi } from './abis/LaunchpadFactory';
import { AgentRegistryAbi } from './abis/AgentRegistry';

const startBlock = Number(process.env.START_BLOCK ?? '0');

export default createConfig({
  networks: {
    baseSepolia: {
      chainId: 84532,
      transport: http(process.env.PONDER_RPC_URL_84532 ?? 'https://sepolia.base.org'),
    },
  },
  contracts: {
    LaunchpadFactory: {
      network: 'baseSepolia',
      abi: LaunchpadFactoryAbi,
      address: (process.env.FACTORY_ADDRESS ?? '0x') as `0x${string}`,
      startBlock,
    },
    AgentRegistry: {
      network: 'baseSepolia',
      abi: AgentRegistryAbi,
      address: (process.env.REGISTRY_ADDRESS ?? '0x') as `0x${string}`,
      startBlock,
    },
    // Every AgentToken deployed by the factory is tracked dynamically via AgentSpawned.token.
    AgentToken: {
      network: 'baseSepolia',
      abi: AgentTokenAbi,
      address: factory({
        address: (process.env.FACTORY_ADDRESS ?? '0x') as `0x${string}`,
        event: getAbiItem({ abi: LaunchpadFactoryAbi, name: 'AgentSpawned' }),
        parameter: 'token',
      }),
      startBlock,
    },
  },
});
```

- [ ] **Step 2: 写事件 handler**

Create `services/indexer/src/index.ts`:
```ts
import { ponder } from 'ponder:registry';
import { agent, tokenIndex, trade } from 'ponder:schema';
import { AgentRegistryAbi } from '../abis/AgentRegistry';
import { AgentTokenAbi } from '../abis/AgentToken';

/** Reads life params from the registry + the token's current curve state, returns the
 *  fields the `agent` row needs. Kept in the handler (needs `context.client`/chain). */
async function readAgentState(
  context: any,
  agentId: bigint,
  token: `0x${string}`,
  wallet: `0x${string}`,
) {
  const [a, marketCap, pricePerToken, usdcReserve, tokenBalance] = await Promise.all([
    context.client.readContract({
      abi: AgentRegistryAbi,
      address: context.contracts.AgentRegistry.address,
      functionName: 'agents',
      args: [agentId],
    }),
    context.client.readContract({ abi: AgentTokenAbi, address: token, functionName: 'marketCap', args: [] }),
    context.client.readContract({ abi: AgentTokenAbi, address: token, functionName: 'pricePerToken', args: [] }),
    context.client.readContract({ abi: AgentTokenAbi, address: token, functionName: 'usdcReserve', args: [] }),
    context.client.readContract({ abi: AgentTokenAbi, address: token, functionName: 'balanceOf', args: [wallet] }),
  ]);
  // a = [token, wallet, costPerThink, floor, recoveryWindow, alive]
  return {
    costPerThink: a[2] as bigint,
    floor: a[3] as bigint,
    recoveryWindow: a[4] as bigint,
    alive: a[5] as boolean,
    marketCap: marketCap as bigint,
    pricePerToken: pricePerToken as bigint,
    usdcReserve: usdcReserve as bigint,
    tokenBalance: tokenBalance as bigint,
  };
}

// Canonical agent create: AgentRegistered carries agentId/token/wallet; we read life params + curve.
ponder.on('AgentRegistry:AgentRegistered', async ({ event, context }) => {
  const id = event.args.agentId.toString();
  const token = event.args.token as `0x${string}`;
  const wallet = event.args.wallet as `0x${string}`;
  const s = await readAgentState(context, event.args.agentId, token, wallet);
  await context.db
    .insert(agent)
    .values({
      id,
      token,
      wallet,
      ...s,
      spawnedAt: event.block.timestamp,
      diedAt: null,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({ ...s, token, wallet, updatedAt: event.block.timestamp });
  await context.db
    .insert(tokenIndex)
    .values({ id: token, agentId: id })
    .onConflictDoNothing();
});

ponder.on('AgentRegistry:AgentDied', async ({ event, context }) => {
  const id = event.args.agentId.toString();
  await context.db
    .update(agent, { id })
    .set({ alive: false, diedAt: event.block.timestamp, marketCap: 0n, updatedAt: event.block.timestamp });
});

async function onTrade(side: 'buy' | 'sell', event: any, context: any) {
  const token = event.log.address as `0x${string}`;
  const idx = await context.db.find(tokenIndex, { id: token });
  const usdc = side === 'buy' ? (event.args.usdcIn as bigint) : (event.args.usdcOut as bigint);
  const tokens = side === 'buy' ? (event.args.tokensOut as bigint) : (event.args.tokensIn as bigint);
  const actor = (side === 'buy' ? event.args.buyer : event.args.seller) as `0x${string}`;

  await context.db.insert(trade).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    agentId: idx?.agentId ?? null,
    token,
    side,
    actor,
    usdc,
    tokens,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  // Refresh the Standing snapshot from current curve state.
  if (idx) {
    const [marketCap, pricePerToken, usdcReserve] = await Promise.all([
      context.client.readContract({ abi: AgentTokenAbi, address: token, functionName: 'marketCap', args: [] }),
      context.client.readContract({ abi: AgentTokenAbi, address: token, functionName: 'pricePerToken', args: [] }),
      context.client.readContract({ abi: AgentTokenAbi, address: token, functionName: 'usdcReserve', args: [] }),
    ]);
    const row = await context.db.find(agent, { id: idx.agentId });
    const wallet = (row?.wallet ?? actor) as `0x${string}`;
    const tokenBalance = await context.client.readContract({
      abi: AgentTokenAbi, address: token, functionName: 'balanceOf', args: [wallet],
    });
    await context.db.update(agent, { id: idx.agentId }).set({
      marketCap: marketCap as bigint,
      pricePerToken: pricePerToken as bigint,
      usdcReserve: usdcReserve as bigint,
      tokenBalance: tokenBalance as bigint,
      updatedAt: event.block.timestamp,
    });
  }
}

ponder.on('AgentToken:Bought', async ({ event, context }) => onTrade('buy', event, context));
ponder.on('AgentToken:Sold', async ({ event, context }) => onTrade('sell', event, context));
```

> `ponder:registry`/`ponder:schema` 是 Ponder codegen 产生的虚拟模块。`context` 用 `any` 是为避免锁死随版本变化的生成类型——`ponder typecheck` 仍会校验 handler 形状。若安装版本的 `context.db` API 是 `upsert`/`store.X` 等不同写法，按实际就地改（verify-then-adapt）。

- [ ] **Step 3: codegen + typecheck**

Run:
```bash
cd "services/indexer" && npx ponder codegen && npx ponder typecheck; cd ../..
```
Expected: `codegen` 生成 `ponder-env.d.ts` + `generated/`；`typecheck` 无报错。（首次若报合约地址非法 `0x`，是 `.env` 未填——typecheck 不连链，地址格式告警可忽略；smoke 阶段再填真地址。）

- [ ] **Step 4: Commit**

```bash
git add services/indexer/ponder.config.ts services/indexer/src/index.ts services/indexer/ponder-env.d.ts
git commit -m "feat(indexer): add Ponder config + event handlers (Registered/Spawned/Died/Bought/Sold)"
```

---

## Task 3：读 API 聚合（纯逻辑 TDD）+ Hono 读路由

**Files:**
- Create: `services/indexer/src/aggregate.ts`
- Test: `services/indexer/test/aggregate.test.ts`
- Create: `services/indexer/src/api/index.ts`

- [ ] **Step 1: Write the failing test**

Create `services/indexer/test/aggregate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildAgentAggregate, type AgentRow } from '../src/aggregate.js';

const row: AgentRow = {
  id: '0',
  token: '0xToKeN',
  wallet: '0xWaLLeT',
  costPerThink: 10000n,
  floor: 0n,
  recoveryWindow: 10n,
  alive: true,
  tokenBalance: 1000000000000000000n,
  marketCap: 500000n,
  pricePerToken: 12345n,
  usdcReserve: 250000n,
  spawnedAt: 111n,
  diedAt: null,
  updatedAt: 222n,
};

describe('buildAgentAggregate', () => {
  it('serializes bigints to atomic decimal strings and mirrors registry + Standing fields', () => {
    const a = buildAgentAggregate(row);
    expect(a).toEqual({
      agentId: '0',
      token: '0xToKeN',
      wallet: '0xWaLLeT',
      costPerThink: '10000',
      floor: '0',
      recoveryWindow: 10,
      alive: true,
      tokenBalance: '1000000000000000000',
      marketCap: '500000',
      pricePerToken: '12345',
      usdcReserve: '250000',
      spawnedAt: 111,
      diedAt: null,
      updatedAt: 222,
    });
  });

  it('reports diedAt as a number when set', () => {
    const a = buildAgentAggregate({ ...row, alive: false, diedAt: 999n, marketCap: 0n });
    expect(a.alive).toBe(false);
    expect(a.diedAt).toBe(999);
    expect(a.marketCap).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/indexer" && npx vitest run test/aggregate.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/aggregate.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/indexer/src/aggregate.ts`:
```ts
// The shape Convex perception (Plan 4 tick) and the frontend read from the indexer.
// Field semantics mirror the executor /balances Standing side; USDC balances live elsewhere.
export interface AgentRow {
  id: string;
  token: string;
  wallet: string;
  costPerThink: bigint;
  floor: bigint;
  recoveryWindow: bigint;
  alive: boolean;
  tokenBalance: bigint;
  marketCap: bigint;
  pricePerToken: bigint;
  usdcReserve: bigint;
  spawnedAt: bigint | null;
  diedAt: bigint | null;
  updatedAt: bigint;
}

export interface AgentAggregate {
  agentId: string;
  token: string;
  wallet: string;
  costPerThink: string; // atomic USDC (6dec)
  floor: string; // atomic USDC (6dec)
  recoveryWindow: number; // T
  alive: boolean;
  tokenBalance: string; // atomic token (18dec) held by wallet
  marketCap: string; // atomic USDC (6dec) — Standing
  pricePerToken: string; // atomic USDC (6dec) per 1e18 token
  usdcReserve: string; // atomic USDC (6dec)
  spawnedAt: number | null;
  diedAt: number | null;
  updatedAt: number;
}

/** Pure mapping: agent row -> read-API aggregate (bigints to atomic decimal strings). */
export function buildAgentAggregate(row: AgentRow): AgentAggregate {
  return {
    agentId: row.id,
    token: row.token,
    wallet: row.wallet,
    costPerThink: row.costPerThink.toString(),
    floor: row.floor.toString(),
    recoveryWindow: Number(row.recoveryWindow),
    alive: row.alive,
    tokenBalance: row.tokenBalance.toString(),
    marketCap: row.marketCap.toString(),
    pricePerToken: row.pricePerToken.toString(),
    usdcReserve: row.usdcReserve.toString(),
    spawnedAt: row.spawnedAt === null ? null : Number(row.spawnedAt),
    diedAt: row.diedAt === null ? null : Number(row.diedAt),
    updatedAt: Number(row.updatedAt),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/indexer" && npx vitest run test/aggregate.test.ts; cd ../..
```
Expected: PASS（2 passed）。

- [ ] **Step 5: 写 Hono 读路由**

Create `services/indexer/src/api/index.ts`:
```ts
import { Hono } from 'hono';
import { db } from 'ponder:api';
import { agent } from 'ponder:schema';
import { eq } from 'drizzle-orm';
import { buildAgentAggregate, type AgentRow } from '../aggregate.js';

const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true }));

// Per-agent aggregate (Convex perception consumes this).
app.get('/agents/:id', async (c) => {
  const rows = (await db.select().from(agent).where(eq(agent.id, c.req.param('id'))).limit(1)) as AgentRow[];
  if (!rows[0]) return c.json({ error: 'not found' }, 404);
  return c.json(buildAgentAggregate(rows[0]));
});

// All agents (frontend list; SP2+).
app.get('/agents', async (c) => {
  const rows = (await db.select().from(agent)) as AgentRow[];
  return c.json(rows.map(buildAgentAggregate));
});

export default app;
```

> Ponder ≥0.6 通过 `ponder:api` 暴露 `db`（drizzle）。若安装版本的 API 路由约定不同（如 `import { graphql } from "ponder"` 或需在 `ponder.config` 注册），按 `ponder typecheck` 报错就地调整；读 API 形状（`/agents/:id` → `AgentAggregate`）不变。

- [ ] **Step 6: typecheck（含 API 路由）**

Run:
```bash
cd "services/indexer" && npx ponder typecheck; cd ../..
```
Expected: 无报错。

- [ ] **Step 7: Commit**

```bash
git add services/indexer/src/aggregate.ts services/indexer/test/aggregate.test.ts services/indexer/src/api/index.ts
git commit -m "feat(indexer): add read-API aggregate (pure, tested) + Hono /agents routes"
```

---

## Task 4：索引器 smoke 脚本 + README

**Files:**
- Create: `services/indexer/scripts/smoke.ts`, `services/indexer/README.md`

> 索引器是链上胶水，无法纯单测端到端；用 opt-in smoke：起 `ponder dev`（连真链/anvil）后 curl 读 API，确认 `/agents/:id` 返回聚合。未配地址时脚本 SKIP。

- [ ] **Step 1: 写 smoke 脚本**

Create `services/indexer/scripts/smoke.ts`:
```ts
/**
 * Opt-in indexer smoke (NOT part of `npm test`; run `npm run smoke`).
 * Assumes `ponder dev` is already running on PORT (default 42069) and has indexed at
 * least agent "0". Skips cleanly if PONDER_URL/agent unreachable.
 */
const base = process.env.PONDER_URL ?? `http://127.0.0.1:${process.env.PORT ?? '42069'}`;
const agentId = process.env.SMOKE_AGENT_ID ?? '0';

async function main() {
  let health: Response;
  try {
    health = await fetch(`${base}/healthz`);
  } catch {
    console.log(`[smoke] SKIP — indexer not reachable at ${base}`);
    return;
  }
  console.log('[smoke] /healthz ->', health.status, await health.json().catch(() => ({})));

  const res = await fetch(`${base}/agents/${agentId}`);
  console.log('[smoke] /agents/' + agentId + ' ->', res.status);
  if (res.status === 404) {
    console.log('[smoke] agent not indexed yet (deploy + spawn + let ponder catch up), but route is live.');
    return;
  }
  const agg = await res.json();
  console.log('[smoke] aggregate:', agg);
  const need = ['agentId', 'token', 'wallet', 'costPerThink', 'marketCap', 'tokenBalance', 'alive'];
  const missing = need.filter((k) => !(k in agg));
  if (missing.length) throw new Error(`aggregate missing fields: ${missing.join(',')}`);
  console.log('[smoke] OK — read API serves the Standing aggregate');
}

main().catch((e) => {
  console.error('[smoke] FAIL', e);
  process.exit(1);
});
```

- [ ] **Step 2: 写 README**

Create `services/indexer/README.md`:
```markdown
# Ponder 索引器（TrumanTown SP1 · 计划 5/5）

索引 Base Sepolia 上 TrumanTown 合约事件，暴露 per-agent 读 API，供 Convex 感知（Standing 侧）与前端（SP2+）。

## 索引什么
- `LaunchpadFactory.AgentSpawned` → 动态追踪每个 `AgentToken`（factory 模式）。
- `AgentRegistry.AgentRegistered` → 建 `agent` 行（读 `agents(id)` 拿 token/wallet/costPerThink/floor/recoveryWindow/alive）+ 当前曲线快照。
- `AgentRegistry.AgentDied` → 标 `alive=false`、`diedAt`、`marketCap=0`。
- `AgentToken.Bought/Sold` → 追加 `trade` 行 + 刷新 Standing 快照（`marketCap/pricePerToken/usdcReserve/tokenBalance`）。

## 混合数据源（重要）
`agent` 行只存 **Standing 侧**（曲线派生 + 注册表镜像）。**USDC 钱包余额（eoaUsdc/smartUsdc = energy 源）不进 Ponder**——由 Convex 经济 tick 直接链读（pay-to-think 闸门保持链上真值、零索引器滞后）。

## WSL 运行（Node 18）
```bash
cd services/indexer
nvm use 18
npm install
cp .env.example .env   # 填 FACTORY_ADDRESS / REGISTRY_ADDRESS / USDC_ADDRESS / START_BLOCK / RPC（计划1 Deploy 输出）
npm run dev            # ponder dev，读 API 在 :42069；自带 /graphql
```

## 读 API
- `GET /agents/:id` → `AgentAggregate`（字段语义对齐执行器 /balances 的 Standing 侧；原子单位十进制字符串）。
- `GET /agents` → 列表。
- `GET /healthz` → `{ ok: true }`。

## 测试 / 校验
```bash
npm test               # 纯逻辑单测（aggregate）
npm run typecheck      # ponder typecheck（schema+handler+API）
npm run smoke          # opt-in：起 ponder dev 后 curl 读 API（未起则 SKIP）
```

## 依赖版本（Task 0 Step 8 实测回填）
- `ponder`: <版本>　·　`viem`: <版本>　·　`hono`: <版本>

## ⚠ verify-then-adapt
Ponder 主线 API（`onchainTable` / `ponder:schema` / `ponder:api` / `context.db`）随版本演进；若安装版本导出不同，按 `ponder typecheck` 就地绑定，schema/handler/读 API **形状**不变。
```

- [ ] **Step 3: 回填依赖版本**

Run:
```bash
cd "services/indexer" && node -e "const p=require('./package-lock.json');const d=p.packages?.['node_modules/ponder']?.version;console.log('ponder',d)"; cd ../..
```
Expected: 打印 ponder 实际版本；用 Edit 把 README「依赖版本」的 `<版本>` 换成实测值（viem/hono 同法）。

- [ ] **Step 4: 全量单测 + typecheck 确认绿**

Run:
```bash
cd "services/indexer" && npx vitest run && npx ponder typecheck; cd ../..
```
Expected: Vitest `2 passed`（aggregate）；typecheck 干净。

- [ ] **Step 5: Commit**

```bash
git add services/indexer/scripts/smoke.ts services/indexer/README.md
git commit -m "docs(indexer): add opt-in read-API smoke + runbook; pin dep versions"
```

---

## Task 5：网关 registry-backed PriceResolver（链上定价 + 反伪造）

**Files:**
- Create: `services/gateway/src/registryResolver.ts`
- Test: `services/gateway/test/registryResolver.test.ts`
- Modify: `services/gateway/src/index.ts`, `services/gateway/.env.example`

> `PriceResolver` 是同步签名（计划 2 冻结）。本任务实现「链读填充缓存 + 同步 resolve 命中缓存」的 registry resolver：以链上 `agents(id).costPerThink` 为唯一定价源，**无宽容 fallback**（未注册/`alive=false` → `undefined` → 中间件 402/500，伪造 id 拿不到便宜推理）。纯逻辑（注入 `RegistryReader`）TDD，viem 真实读放 `viemRegistryReader`（typecheck）。

- [ ] **Step 1: Write the failing test**

Create `services/gateway/test/registryResolver.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRegistryResolver, type RegistryReader, type RegistryAgent } from '../src/registryResolver.js';

const base = {
  payTo: '0x000000000000000000000000000000000000beef',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  network: 'eip155:84532',
};

function fakeReader(map: Record<string, RegistryAgent>): RegistryReader {
  return { async readAgent(id) { return map[id]; } };
}

describe('createRegistryResolver', () => {
  it('prices a registered, alive agent from on-chain costPerThink (no static map)', async () => {
    const r = createRegistryResolver(fakeReader({ '0': { costPerThink: 10000n, alive: true } }), base, ['0']);
    await r.refresh();
    expect(r.resolve('0')).toEqual({ costPerThink: '10000', ...base });
  });

  it('returns undefined for an unregistered (forged) agentId — no cheaper/free inference', async () => {
    const r = createRegistryResolver(fakeReader({ '0': { costPerThink: 10000n, alive: true } }), base, ['0']);
    await r.refresh();
    expect(r.resolve('999')).toBeUndefined();
  });

  it('returns undefined for a dead agent', async () => {
    const r = createRegistryResolver(fakeReader({ '0': { costPerThink: 10000n, alive: false } }), base, ['0']);
    await r.refresh();
    expect(r.resolve('0')).toBeUndefined();
  });

  it('refresh re-reads chain (price/aliveness can change)', async () => {
    const map: Record<string, RegistryAgent> = { '0': { costPerThink: 10000n, alive: true } };
    const r = createRegistryResolver({ async readAgent(id) { return map[id]; } }, base, ['0']);
    await r.refresh();
    expect(r.resolve('0')!.costPerThink).toBe('10000');
    map['0'] = { costPerThink: 20000n, alive: true };
    await r.refresh();
    expect(r.resolve('0')!.costPerThink).toBe('20000');
  });

  it('tolerates a reader throwing on one id (keeps last good cache)', async () => {
    let fail = false;
    const r = createRegistryResolver(
      { async readAgent(id) { if (fail) throw new Error('rpc down'); return { costPerThink: 10000n, alive: true }; } },
      base, ['0'],
    );
    await r.refresh();
    fail = true;
    await r.refresh(); // must not throw
    expect(r.resolve('0')!.costPerThink).toBe('10000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/gateway" && npx vitest run test/registryResolver.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/registryResolver.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/gateway/src/registryResolver.ts`:
```ts
import { createPublicClient, http, getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { AgentPrice, PriceResolver } from './pricing.js';

export interface RegistryAgent {
  costPerThink: bigint;
  alive: boolean;
}

export interface RegistryReader {
  readAgent(agentId: string): Promise<RegistryAgent | undefined>;
}

export interface RegistryResolver {
  resolve: PriceResolver; // synchronous (Plan 2 frozen middleware contract)
  refresh(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
}

/**
 * Registry-backed pricing. Pricing is authoritative from on-chain AgentRegistry —
 * there is NO permissive fallback, so a forged X-Agent-Id that isn't a registered,
 * alive agent resolves to `undefined` (gateway then 402/500; no cheaper/free inference).
 * The frozen PriceResolver is synchronous, so chain reads populate an in-memory cache
 * (prefetch on boot + periodic refresh); resolve() hits the cache.
 */
export function createRegistryResolver(
  reader: RegistryReader,
  base: Omit<AgentPrice, 'costPerThink'>,
  agentIds: string[],
): RegistryResolver {
  const cache = new Map<string, AgentPrice>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    for (const id of agentIds) {
      try {
        const a = await reader.readAgent(id);
        if (a && a.alive) cache.set(id, { costPerThink: a.costPerThink.toString(), ...base });
        else cache.delete(id);
      } catch {
        // keep last-good cache entry on transient RPC failure
      }
    }
  }

  return {
    resolve: (agentId: string) => cache.get(agentId),
    refresh,
    start(intervalMs: number) {
      if (timer === null) timer = setInterval(() => void refresh(), intervalMs);
    },
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    },
  };
}

const REGISTRY_ABI = [
  { type: 'function', name: 'agents', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [
    { name: 'token', type: 'address' },
    { name: 'wallet', type: 'address' },
    { name: 'costPerThink', type: 'uint256' },
    { name: 'floor', type: 'uint256' },
    { name: 'recoveryWindow', type: 'uint256' },
    { name: 'alive', type: 'bool' },
  ] },
] as const;

/** Real reader: viem read of AgentRegistry.agents(id) on Base Sepolia. */
export function viemRegistryReader(rpcUrl: string, registry: string): RegistryReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const address = getAddress(registry);
  return {
    async readAgent(agentId) {
      const a = (await client.readContract({
        address, abi: REGISTRY_ABI, functionName: 'agents', args: [BigInt(agentId)],
      })) as readonly [string, string, bigint, bigint, bigint, boolean];
      return { costPerThink: a[2], alive: a[5] };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/gateway" && npx vitest run test/registryResolver.test.ts; cd ../..
```
Expected: PASS（5 passed）。

- [ ] **Step 5: 在 `index.ts` 按 env 装配 registry resolver**

Read `services/gateway/src/index.ts` first（确认现有 `staticResolver` 装配处与 env 读取风格），then 修改：在构造 resolver 处加分支。把现有形如
```ts
  const resolve = staticResolver({ '0': price }, price);
```
替换为（保持变量名 `resolve`）:
```ts
  let resolve = staticResolver({ '0': price }, price);
  if (process.env.GATEWAY_USE_REGISTRY === '1') {
    const reg = createRegistryResolver(
      viemRegistryReader(
        process.env.RPC_URL_BASE_SEPOLIA ?? 'https://sepolia.base.org',
        process.env.REGISTRY_ADDRESS ?? '0x',
      ),
      { payTo: price.payTo, asset: price.asset, network: price.network },
      (process.env.AGENT_IDS ?? '0').split(',').map((s) => s.trim()).filter(Boolean),
    );
    await reg.refresh();
    reg.start(Number(process.env.REGISTRY_REFRESH_MS ?? '30000'));
    resolve = reg.resolve;
  }
```
And add the import at the top of `services/gateway/src/index.ts`:
```ts
import { createRegistryResolver, viemRegistryReader } from './registryResolver.js';
```
> 若 `index.ts` 的 `main` 非 async，把引导包进 `async function main(){...}; main()`（Node 顶层 await 视 tsconfig 而定；用 async 函数最稳）。

- [ ] **Step 6: 追加 `.env.example`**

Append to `services/gateway/.env.example`:
```
# 计划5：以链上 AgentRegistry 为准定价（反伪造）。置 1 启用
GATEWAY_USE_REGISTRY=0
REGISTRY_ADDRESS=0x...
RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
AGENT_IDS=0
REGISTRY_REFRESH_MS=30000
```

- [ ] **Step 7: 网关全套测试 + typecheck（默认关 → 行为不变）**

Run:
```bash
cd "services/gateway" && npx vitest run && npm run typecheck; cd ../..
```
Expected: 全套通过（计划 3 的 28 + 本任务 5 = **33 passed**）；typecheck 干净（`GATEWAY_USE_REGISTRY` 未设 → 仍走 `staticResolver`）。

- [ ] **Step 8: Commit**

```bash
git add services/gateway/src/registryResolver.ts services/gateway/test/registryResolver.test.ts services/gateway/src/index.ts services/gateway/.env.example
git commit -m "feat(gateway): add registry-backed price resolver (on-chain costPerThink, anti-spoof)"
```

---

## Task 6：执行器 registry-backed AgentResolver（链上 agents(id) + CDP EOA 派生）

**Files:**
- Create: `services/executor/src/registryAgentResolver.ts`
- Test: `services/executor/test/registryAgentResolver.test.ts`
- Modify: `services/executor/src/index.ts`, `services/executor/.env.example`

> 同 Task 5 模式：缓存 + 周期刷新承载同步 `AgentResolver`。token/wallet(=smartAccount) 取链上 `agents(id)`；EOA 由 CDP 派生（注入 `eoaFor`）。无宽容 fallback（未注册/dead → undefined → 404，反伪造）。纯逻辑 TDD。

- [ ] **Step 1: Write the failing test**

Create `services/executor/test/registryAgentResolver.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createRegistryAgentResolver, type RegistryAgentReader } from '../src/registryAgentResolver.js';

function fakeReader(map: Record<string, { token: string; wallet: string; alive: boolean }>): RegistryAgentReader {
  return { async readAgent(id) { return map[id]; } };
}
const eoaFor = (id: string) => `0xEOA${id}`;

describe('createRegistryAgentResolver', () => {
  it('builds AgentConfig from chain (token+wallet) + derived EOA', async () => {
    const r = createRegistryAgentResolver(
      fakeReader({ '0': { token: '0xT', wallet: '0xS', alive: true } }),
      eoaFor, ['0'],
    );
    await r.refresh();
    expect(r.resolve('0')).toEqual({ agentId: '0', smartAccount: '0xS', eoa: '0xEOA0', token: '0xT' });
  });

  it('returns undefined for unregistered (forged) id', async () => {
    const r = createRegistryAgentResolver(fakeReader({ '0': { token: '0xT', wallet: '0xS', alive: true } }), eoaFor, ['0']);
    await r.refresh();
    expect(r.resolve('42')).toBeUndefined();
  });

  it('returns undefined for a dead agent', async () => {
    const r = createRegistryAgentResolver(fakeReader({ '0': { token: '0xT', wallet: '0xS', alive: false } }), eoaFor, ['0']);
    await r.refresh();
    expect(r.resolve('0')).toBeUndefined();
  });

  it('refresh keeps last-good cache on reader error', async () => {
    let fail = false;
    const r = createRegistryAgentResolver(
      { async readAgent() { if (fail) throw new Error('rpc'); return { token: '0xT', wallet: '0xS', alive: true }; } },
      eoaFor, ['0'],
    );
    await r.refresh();
    fail = true;
    await r.refresh();
    expect(r.resolve('0')!.smartAccount).toBe('0xS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/registryAgentResolver.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/registryAgentResolver.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/executor/src/registryAgentResolver.ts`:
```ts
import { createPublicClient, http, getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { AgentConfig, AgentResolver } from './config.js';

export interface RegistryAgentRow {
  token: string;
  wallet: string; // CDP smart account
  alive: boolean;
}

export interface RegistryAgentReader {
  readAgent(agentId: string): Promise<RegistryAgentRow | undefined>;
}

export interface RegistryAgentResolver {
  resolve: AgentResolver; // synchronous (Plan 3 frozen)
  refresh(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
}

/**
 * Registry-backed agent resolution. token + wallet(=smartAccount) come from on-chain
 * AgentRegistry.agents(id); the EOA (x402 payer, not stored on-chain) is derived from CDP
 * via `eoaFor`. No permissive fallback — forged/dead ids resolve to undefined (404).
 * Sync resolve hits an in-memory cache (prefetch + periodic refresh).
 */
export function createRegistryAgentResolver(
  reader: RegistryAgentReader,
  eoaFor: (agentId: string) => string,
  agentIds: string[],
): RegistryAgentResolver {
  const cache = new Map<string, AgentConfig>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    for (const id of agentIds) {
      try {
        const a = await reader.readAgent(id);
        if (a && a.alive) cache.set(id, { agentId: id, smartAccount: a.wallet, eoa: eoaFor(id), token: a.token });
        else cache.delete(id);
      } catch {
        // keep last-good cache on transient RPC failure
      }
    }
  }

  return {
    resolve: (agentId: string) => cache.get(agentId),
    refresh,
    start(intervalMs) { if (timer === null) timer = setInterval(() => void refresh(), intervalMs); },
    stop() { if (timer !== null) { clearInterval(timer); timer = null; } },
  };
}

const REGISTRY_ABI = [
  { type: 'function', name: 'agents', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [
    { name: 'token', type: 'address' },
    { name: 'wallet', type: 'address' },
    { name: 'costPerThink', type: 'uint256' },
    { name: 'floor', type: 'uint256' },
    { name: 'recoveryWindow', type: 'uint256' },
    { name: 'alive', type: 'bool' },
  ] },
] as const;

export function viemRegistryAgentReader(rpcUrl: string, registry: string): RegistryAgentReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const address = getAddress(registry);
  return {
    async readAgent(agentId) {
      const a = (await client.readContract({
        address, abi: REGISTRY_ABI, functionName: 'agents', args: [BigInt(agentId)],
      })) as readonly [string, string, bigint, bigint, bigint, boolean];
      return { token: a[0], wallet: a[1], alive: a[5] };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/registryAgentResolver.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 5: 在 `index.ts` 按 env 装配（用 CDP 派生 EOA）**

Read `services/executor/src/index.ts` first。在 `staticAgentResolver` 装配处加分支。把
```ts
  const app = createExecutor({
    resolve: staticAgentResolver({ '0': agent0 }, agent0),
```
改为先构造 `resolve`，再传入：
```ts
  let resolve = staticAgentResolver({ '0': agent0 }, agent0);
  if (process.env.EXECUTOR_USE_REGISTRY === '1') {
    const reg = createRegistryAgentResolver(
      viemRegistryAgentReader(
        env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
        env('REGISTRY_ADDRESS'),
      ),
      // EOA derived from CDP per agent (the EOA address we already loaded into agent0).
      (id) => (id === agent0.agentId ? agent0.eoa : `0x`),
      (process.env.AGENT_IDS ?? '0').split(',').map((s) => s.trim()).filter(Boolean),
    );
    await reg.refresh();
    reg.start(Number(process.env.REGISTRY_REFRESH_MS ?? '30000'));
    resolve = reg.resolve;
  }

  const app = createExecutor({
    resolve,
```
And add the import at the top of `services/executor/src/index.ts`:
```ts
import { createRegistryAgentResolver, viemRegistryAgentReader } from './registryAgentResolver.js';
```
> SP1 单居民：EOA 派生用已 `buildCdpHooks` 载入的 `agent0.eoa`。多居民时 `eoaFor` 改为查 CDP `eoaByAddr`/按 `agent-{id}-eoa` 命名解析（不改 resolver 接口）。

- [ ] **Step 6: 追加 `.env.example`**

Append to `services/executor/.env.example`:
```
# 计划5：以链上 AgentRegistry 解析 token/wallet（反伪造）。置 1 启用
EXECUTOR_USE_REGISTRY=0
AGENT_IDS=0
REGISTRY_REFRESH_MS=30000
```
（`REGISTRY_ADDRESS`/`RPC_URL_BASE_SEPOLIA` 计划 3 已有则复用；无则一并加。）

- [ ] **Step 7: 执行器全套测试（默认关 → 不变）**

Run:
```bash
cd "services/executor" && npx vitest run; cd ../..
```
Expected: 计划 3 的 37/38 + 本任务 4 全绿（`EXECUTOR_USE_REGISTRY` 未设 → 仍走 `staticAgentResolver`；`index.ts` 不被测试导入）。

- [ ] **Step 8: Commit**

```bash
git add services/executor/src/registryAgentResolver.ts services/executor/test/registryAgentResolver.test.ts services/executor/src/index.ts services/executor/.env.example
git commit -m "feat(executor): add registry-backed agent resolver (on-chain token/wallet + CDP EOA, anti-spoof)"
```

---

## Task 7：执行器 `transferUsdc(source:"eoa")` 接 CDP EOA send

**Files:**
- Modify: `services/executor/src/cdpWalletProvider.ts`, `services/executor/src/cdpClient.ts`

> 计划 3 的 `cdpWalletProvider.transferUsdc` 忽略 `source`、恒从智能账户发。本任务补齐 `source:"eoa"`：经注入的 `sendEoaTransfer` 走 CDP EOA send。纯机械、无经济决策。胶水靠 typecheck + LIVE（Task 11/12）。`fakeWallet`（计划 3 单测用）已正确按 `source` 改余额，故既有单测不变、仍绿。

- [ ] **Step 1: 给 `CdpWalletConfig` 加 EOA send hook**

In `services/executor/src/cdpWalletProvider.ts`, 在 `CdpWalletConfig` 接口里 `faucetTo` 下方加：
```ts
  /** Sends USDC from the agent's EOA (x402 payer). From cdpClient.ts. */
  sendEoaTransfer: (cfg: AgentConfig, to: string, amount: bigint) => Promise<string>;
```

- [ ] **Step 2: 让 `transferUsdc` 按 source 分流**

In `services/executor/src/cdpWalletProvider.ts`, 替换 `transferUsdc` 实现：
```ts
    async transferUsdc(cfg, source, to, amount) {
      if (source === 'eoa') {
        // EOA-sourced send (e.g. refunds / future flows). The EOA is the x402 payer.
        return c.sendEoaTransfer(cfg, to, amount);
      }
      // smart-account-sourced sweep (gasless via paymaster) — the SP1 revive path.
      return c.sendSmartAccountCall(cfg, { to: c.usdcAddress, functionName: 'transfer', args: [getAddress(to), amount] });
    },
```

- [ ] **Step 3: 在 `cdpClient.ts` 暴露 `sendEoaTransfer`**

In `services/executor/src/cdpClient.ts`, 给 `CdpHooks` 接口加：
```ts
  /** Sends USDC from an agent's EOA server account. */
  sendEoaTransfer: (cfg: AgentConfig, to: string, amount: bigint) => Promise<string>;
```
And 在 `buildCdpHooks` 的返回对象里加（紧跟 `faucetTo` 后）:
```ts
    async sendEoaTransfer(cfg, to, amount) {
      const eoa = eoaByAddr.get(getAddress(cfg.eoa));
      if (!eoa) throw new Error(`no EOA loaded for ${cfg.eoa}`);
      // CDP EvmServerAccount USDC transfer (ERC20). Verify-then-adapt: confirm the
      // cdp-sdk method (e.g. eoa.transfer({ to, amount, token }) or
      // cdp.evm.sendTransaction({ address, transaction })) against the pinned version.
      const data = encodeFunctionData({ abi: ERC20_WRITE_ABI, functionName: 'transfer', args: [getAddress(to), amount] });
      const tx = await cdp.evm.sendTransaction({
        address: getAddress(cfg.eoa),
        network: 'base-sepolia',
        transaction: { to: getAddress(c.usdcAddress), data, value: 0n },
      });
      return (tx as { transactionHash?: string }).transactionHash ?? 'eoa-transfer';
    },
```

- [ ] **Step 4: 在 `index.ts` 把 hook 接进 wallet provider**

In `services/executor/src/index.ts`, `createCdpWalletProvider({...})` 调用里加一行（紧跟 `faucetTo: cdp.faucetTo,`）:
```ts
    sendEoaTransfer: cdp.sendEoaTransfer,
```

- [ ] **Step 5: typecheck（云胶水）**

Run:
```bash
cd "services/executor" && npm run typecheck; cd ../..
```
Expected: 干净。**若** `cdp.evm.sendTransaction` 签名与参考不符，按 Task 0（计划 3）核对的 cdp-sdk 真实导出就地修正（verify-then-adapt）；真实路径由 Task 12 验收脚本/LIVE 验证。

- [ ] **Step 6: 既有单测仍绿（fakeWallet 已按 source 改余额）**

Run:
```bash
cd "services/executor" && npx vitest run; cd ../..
```
Expected: 全绿（本任务只改云胶水 + 接口加字段，单测注入 `fakeWallet` 不受影响）。

- [ ] **Step 7: Commit**

```bash
git add services/executor/src/cdpWalletProvider.ts services/executor/src/cdpClient.ts services/executor/src/index.ts
git commit -m "feat(executor): wire transferUsdc(source:\"eoa\") to CDP EOA send"
```

---

## Task 8：执行器 keeper（markDead 编排 + `/actions/mark-dead` 端点）

**Files:**
- Create: `services/executor/src/keeper.ts`, `services/executor/src/keeperSigner.ts`
- Test: `services/executor/test/keeper.test.ts`
- Modify: `services/executor/src/executor.ts`, `services/executor/test/executor.e2e.test.ts`, `services/executor/src/index.ts`, `services/executor/.env.example`

> keeper-only 链上 `markDead`。纯编排（`markDeadForAgent`）TDD；真实 `markDead` 用 viem keeper account（`keeperSigner.ts`，typecheck + Task 12 验收）。端点对 B′ 是纯增量。

- [ ] **Step 1: Write the failing test (pure orchestration)**

Create `services/executor/test/keeper.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { markDeadForAgent, type KeeperDeps } from '../src/keeper.js';
import { staticAgentResolver, type AgentConfig } from '../src/config.js';

const agent0: AgentConfig = { agentId: '0', smartAccount: '0xS', eoa: '0xE', token: '0xT' };

function deps(over: Partial<KeeperDeps> = {}): { d: KeeperDeps; calls: string[] } {
  const calls: string[] = [];
  const d: KeeperDeps = {
    resolve: staticAgentResolver({ '0': agent0 }),
    markDead: async (id) => { calls.push(id); return '0xdead'; },
    ...over,
  };
  return { d, calls };
}

describe('markDeadForAgent', () => {
  it('marks a known agent dead and returns txHash', async () => {
    const { d, calls } = deps();
    const res = await markDeadForAgent(d, '0');
    expect(res).toEqual({ ok: true, txHash: '0xdead' });
    expect(calls).toEqual(['0']);
  });

  it('404 for unknown agent (does not call markDead)', async () => {
    const { d, calls } = deps();
    const res = await markDeadForAgent(d, '99');
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(calls).toEqual([]);
  });

  it('501 when keeper signer not configured', async () => {
    const { d } = deps({ markDead: undefined });
    const res = await markDeadForAgent(d, '0');
    expect(res).toMatchObject({ ok: false, status: 501 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd "services/executor" && npx vitest run test/keeper.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/keeper.js'`。

- [ ] **Step 3: Write minimal implementation**

Create `services/executor/src/keeper.ts`:
```ts
import type { AgentResolver } from './config.js';

export interface KeeperDeps {
  resolve: AgentResolver;
  /** Sends AgentRegistry.markDead(id) from the keeper wallet; undefined when not configured. */
  markDead?: (agentId: string) => Promise<string>;
}

export type MarkDeadResult =
  | { ok: true; txHash: string }
  | { ok: false; status: number; error: string };

/**
 * keeper-only: turns Plan 4's `agentEconomy.status='dead'` into an on-chain
 * AgentRegistry.markDead(id) -> AgentDied. Pure orchestration; the actual chain write
 * is injected (keeperSigner.ts). Preserves "executor is the only service that sends
 * chain txs". 404 unknown agent; 501 when no keeper wallet is configured.
 */
export async function markDeadForAgent(deps: KeeperDeps, agentId: string): Promise<MarkDeadResult> {
  const cfg = deps.resolve(agentId);
  if (!cfg) return { ok: false, status: 404, error: `unknown agent ${agentId}` };
  if (!deps.markDead) return { ok: false, status: 501, error: 'keeper not configured' };
  const txHash = await deps.markDead(agentId);
  return { ok: true, txHash };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd "services/executor" && npx vitest run test/keeper.test.ts; cd ../..
```
Expected: PASS（3 passed）。

- [ ] **Step 5: 把 markDead 接进 executor app + 加端点**

In `services/executor/src/executor.ts`:
- `ExecutorDeps` 接口加可选字段（在 `usdcAddress` 下方）:
```ts
  markDead?: (agentId: string) => Promise<string>;
```
- 顶部 import 加:
```ts
import { markDeadForAgent } from './keeper.js';
```
- 在 `app.get('/balances/:agentId', ...)` 之前加路由:
```ts
  app.post('/actions/mark-dead', async (req: Request, res: Response) => {
    const { agentId } = req.body ?? {};
    if (typeof agentId !== 'string' || agentId.length === 0) {
      res.status(400).json({ error: 'agentId required' });
      return;
    }
    const result = await markDeadForAgent({ resolve: deps.resolve, markDead: deps.markDead }, agentId);
    if (result.ok) { res.status(200).json({ txHash: result.txHash }); return; }
    res.status(result.status).json({ error: result.error });
  });
```

- [ ] **Step 6: e2e 加 mark-dead 用例（注入 fake markDead）**

In `services/executor/test/executor.e2e.test.ts`, `makeApp()` 的 `createExecutor({...})` 调用加一行 `markDead`:
```ts
  const app = createExecutor({
    resolve: staticAgentResolver({ '0': agent0 }, agent0),
    wallet: w.provider,
    signer: s.signer,
    guardrails,
    usdcAddress: '0xUSDC',
    markDead: async (id) => `0xdead-${id}`,
  });
```
And 在 `describe('executor end-to-end', () => {` 内末尾加用例:
```ts
  it('POST /actions/mark-dead returns txHash for known agent', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/actions/mark-dead').send({ agentId: '0' });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('0xdead-0');
  });

  it('POST /actions/mark-dead 400 when agentId missing', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/actions/mark-dead').send({});
    expect(res.status).toBe(400);
  });

  it('POST /actions/mark-dead 501 when keeper not configured', async () => {
    const w = fakeWallet();
    const s = fakeSigner();
    const app = createExecutor({
      resolve: staticAgentResolver({ '0': agent0 }, agent0),
      wallet: w.provider, signer: s.signer, guardrails, usdcAddress: '0xUSDC',
    });
    const res = await request(app).post('/actions/mark-dead').send({ agentId: '0' });
    expect(res.status).toBe(501);
  });
```

- [ ] **Step 7: 写真实 keeper signer（viem）**

Create `services/executor/src/keeperSigner.ts`:
```ts
import { createWalletClient, http, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const REGISTRY_MARKDEAD_ABI = [
  { type: 'function', name: 'markDead', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
] as const;

/**
 * Real keeper: signs AgentRegistry.markDead(id) with KEEPER_PRIVATE_KEY (the address set
 * as `keeper` in the Plan-1 AgentRegistry constructor). Needs Base Sepolia ETH for gas.
 * Returns a markDead(agentId) closure for ExecutorDeps, or undefined when unconfigured.
 */
export function createKeeperMarkDead(opts: {
  privateKey?: string;
  rpcUrl: string;
  registry?: string;
}): ((agentId: string) => Promise<string>) | undefined {
  if (!opts.privateKey || !opts.registry) return undefined;
  const account = privateKeyToAccount(opts.privateKey as `0x${string}`);
  const client = createWalletClient({ account, chain: baseSepolia, transport: http(opts.rpcUrl) });
  const address = getAddress(opts.registry);
  return async (agentId: string) => {
    return client.writeContract({
      address,
      abi: REGISTRY_MARKDEAD_ABI,
      functionName: 'markDead',
      args: [BigInt(agentId)],
    });
  };
}
```

- [ ] **Step 8: 在 `index.ts` 装配 keeper signer**

In `services/executor/src/index.ts`:
- 顶部 import 加:
```ts
import { createKeeperMarkDead } from './keeperSigner.js';
```
- 构造 `app` 前加:
```ts
  const markDead = createKeeperMarkDead({
    privateKey: process.env.KEEPER_PRIVATE_KEY,
    rpcUrl: env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
    registry: process.env.REGISTRY_ADDRESS,
  });
```
- `createExecutor({...})` 加一行 `markDead,`（紧跟 `usdcAddress,`）。

- [ ] **Step 9: 追加 `.env.example`**

Append to `services/executor/.env.example`:
```
# 计划5 keeper：判死后调 AgentRegistry.markDead(id)（keeper-only，需 Base Sepolia ETH 付 gas）
KEEPER_PRIVATE_KEY=
# REGISTRY_ADDRESS 复用上面（registry resolver 段）
```

- [ ] **Step 10: 全套测试 + typecheck**

Run:
```bash
cd "services/executor" && npx vitest run && npm run typecheck; cd ../..
```
Expected: 全绿（计划 3 的 38 + Task 6 的 4 + 本任务 keeper 3 + e2e 新增 3 = 增量通过）；typecheck 干净。

- [ ] **Step 11: Commit**

```bash
git add services/executor/src/keeper.ts services/executor/src/keeperSigner.ts services/executor/test/keeper.test.ts services/executor/src/executor.ts services/executor/test/executor.e2e.test.ts services/executor/src/index.ts services/executor/.env.example
git commit -m "feat(executor): add keeper markDead orchestration + POST /actions/mark-dead endpoint"
```

---

## Task 9：Convex Ponder 客户端 + 经济参数解析（纯逻辑，Jest）

**Files:**
- Create: `convex/economy/ponderClient.ts`, `convex/economy/ponderClient.test.ts`
- Create: `convex/economy/registry.ts`, `convex/economy/registry.test.ts`
- Modify: `convex/economy/constants.ts`

> 纯逻辑（HTTP 客户端 + 参数解析），用 Jest TDD（根 Convex 用 Jest，见项目记忆）。`registry.ts` 实现「Ponder 优先、env 兜底」的经济参数解析（混合数据源的 Standing/生命参数侧）。

- [ ] **Step 1: 给 constants.ts 加 ponderUrl + keeperEnabled**

In `convex/economy/constants.ts`, 在 `agentEoa()` 下方加:
```ts
export function ponderUrl(): string | undefined {
  return process.env.PONDER_URL; // e.g. http://127.0.0.1:42069 ; undefined => fall back to executor /balances Standing
}
export function keeperEnabled(): boolean {
  return process.env.TRUMANTOWN_KEEPER === '1';
}
```

- [ ] **Step 2: Write the failing test for ponderClient**

Create `convex/economy/ponderClient.test.ts`:
```ts
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createPonderClient } from './ponderClient';

let server: Server;
let baseUrl: string;
let routes: Record<string, { status: number; body: any }>;

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = routes[`${req.method} ${req.url}`] ?? { status: 404, body: { error: 'no route' } };
    res.statusCode = route.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(route.body));
  });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { routes = {}; });

describe('createPonderClient', () => {
  test('agentStanding parses the aggregate', async () => {
    routes['GET /agents/0'] = {
      status: 200,
      body: {
        agentId: '0', token: '0xT', wallet: '0xS', costPerThink: '10000', floor: '0',
        recoveryWindow: 10, alive: true, tokenBalance: '5', marketCap: '11',
        pricePerToken: '7', usdcReserve: '9', spawnedAt: 1, diedAt: null, updatedAt: 2,
      },
    };
    const p = createPonderClient(baseUrl);
    const s = await p.agentStanding('0');
    expect(s).not.toBeNull();
    expect(s!.costPerThink).toBe('10000');
    expect(s!.marketCap).toBe('11');
    expect(s!.alive).toBe(true);
  });

  test('agentStanding returns null on 404', async () => {
    const p = createPonderClient(baseUrl);
    expect(await p.agentStanding('0')).toBeNull();
  });

  test('agentStanding returns null on network error (fail-safe)', async () => {
    const p = createPonderClient('http://127.0.0.1:1'); // unreachable
    expect(await p.agentStanding('0')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/ponderClient.test.ts --verbose
```
Expected: FAIL —— `Cannot find module './ponderClient'`。

- [ ] **Step 4: Write minimal implementation**

Create `convex/economy/ponderClient.ts`:
```ts
// HTTP client for the Plan 5 indexer read API. Mirrors the AgentAggregate shape.
// Fail-safe: any error -> null (the tick then keeps the last snapshot / no-ops).
export interface AgentStanding {
  agentId: string;
  token: string;
  wallet: string;
  costPerThink: string; // atomic USDC (6dec)
  floor: string; // atomic USDC (6dec)
  recoveryWindow: number; // T
  alive: boolean;
  tokenBalance: string; // atomic token (18dec)
  marketCap: string; // atomic USDC (6dec) — Standing
  pricePerToken: string;
  usdcReserve: string;
  spawnedAt: number | null;
  diedAt: number | null;
  updatedAt: number;
}

export interface PonderClient {
  agentStanding(agentId: string): Promise<AgentStanding | null>;
}

export function createPonderClient(baseUrl: string, fetchImpl: typeof fetch = fetch): PonderClient {
  const root = baseUrl.replace(/\/$/, '');
  return {
    async agentStanding(agentId) {
      try {
        const r = await fetchImpl(`${root}/agents/${agentId}`);
        if (r.status < 200 || r.status >= 300) return null;
        return (await r.json()) as AgentStanding;
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/ponderClient.test.ts --verbose
```
Expected: PASS（3 passed）。

- [ ] **Step 6: Write the failing test for registry param resolution**

Create `convex/economy/registry.test.ts`:
```ts
import { resolveEconomyParams, type StandingSource } from './registry';

const envDefaults = { costPerThink: '10000', floor: '0', recoveryWindow: 10 };

describe('resolveEconomyParams', () => {
  test('prefers Ponder/registry values when standing present', () => {
    const standing: StandingSource = { costPerThink: '20000', floor: '500', recoveryWindow: 7, marketCap: '999', tokenBalance: '5', alive: true };
    expect(resolveEconomyParams(standing, envDefaults)).toEqual({
      costPerThink: 20000n, floor: 500n, recoveryWindow: 7, marketCap: 999n, tokenBalance: 5n, alive: true,
    });
  });

  test('falls back to env defaults when no standing (Ponder down/disabled)', () => {
    expect(resolveEconomyParams(null, envDefaults)).toEqual({
      costPerThink: 10000n, floor: 0n, recoveryWindow: 10, marketCap: 0n, tokenBalance: 0n, alive: true,
    });
  });

  test('guards malformed standing numbers by falling back per-field', () => {
    const standing = { costPerThink: 'oops', floor: '500', recoveryWindow: 7, marketCap: 'bad', tokenBalance: '5', alive: false } as unknown as StandingSource;
    const r = resolveEconomyParams(standing, envDefaults);
    expect(r.costPerThink).toBe(10000n); // fell back
    expect(r.floor).toBe(500n);
    expect(r.marketCap).toBe(0n); // fell back
    expect(r.alive).toBe(false);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/registry.test.ts --verbose
```
Expected: FAIL —— `Cannot find module './registry'`。

- [ ] **Step 8: Write minimal implementation**

Create `convex/economy/registry.ts`:
```ts
import type { AgentStanding } from './ponderClient';

// The Standing-side fields the economic tick needs from Ponder/registry. USDC wallet
// balances (energy source) are NOT here — those stay live chain reads in the tick.
export type StandingSource = Pick<
  AgentStanding,
  'costPerThink' | 'floor' | 'recoveryWindow' | 'marketCap' | 'tokenBalance' | 'alive'
>;

export interface EconomyParamDefaults {
  costPerThink: string;
  floor: string;
  recoveryWindow: number;
}

export interface ResolvedEconomyParams {
  costPerThink: bigint;
  floor: bigint;
  recoveryWindow: number;
  marketCap: bigint; // Standing
  tokenBalance: bigint;
  alive: boolean;
}

function bigOr(v: string | undefined, fallback: bigint): bigint {
  if (v === undefined) return fallback;
  try { return BigInt(v); } catch { return fallback; }
}

/**
 * Hybrid resolution: prefer Ponder/registry Standing values; fall back per-field to env
 * defaults (constants mirror) when Ponder is down/disabled or a field is malformed.
 * This replaces Plan 4's constants mirror as the Standing/life-param source.
 */
export function resolveEconomyParams(
  standing: StandingSource | null,
  defaults: EconomyParamDefaults,
): ResolvedEconomyParams {
  const dCost = bigOr(defaults.costPerThink, 10000n);
  const dFloor = bigOr(defaults.floor, 0n);
  if (!standing) {
    return { costPerThink: dCost, floor: dFloor, recoveryWindow: defaults.recoveryWindow, marketCap: 0n, tokenBalance: 0n, alive: true };
  }
  const rw = Number.isFinite(standing.recoveryWindow) && standing.recoveryWindow > 0 ? standing.recoveryWindow : defaults.recoveryWindow;
  return {
    costPerThink: bigOr(standing.costPerThink, dCost),
    floor: bigOr(standing.floor, dFloor),
    recoveryWindow: rw,
    marketCap: bigOr(standing.marketCap, 0n),
    tokenBalance: bigOr(standing.tokenBalance, 0n),
    alive: standing.alive ?? true,
  };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/registry.test.ts --verbose
```
Expected: PASS（3 passed）。

- [ ] **Step 10: typecheck**

Run:
```bash
npx tsc -p convex --noEmit
```
Expected: 无报错。

- [ ] **Step 11: Commit**

```bash
git add convex/economy/ponderClient.ts convex/economy/ponderClient.test.ts convex/economy/registry.ts convex/economy/registry.test.ts convex/economy/constants.ts
git commit -m "feat(economy): add Ponder read client + hybrid economy-param resolution (Standing from Ponder, env fallback)"
```

---

## Task 10：executorClient.markDead + 经济 tick 改混合数据源 + dead→keeper

**Files:**
- Modify: `convex/economy/executorClient.ts`, `convex/economy/executorClient.test.ts`
- Modify: `convex/economy/tick.ts`

> executorClient 加 `markDead` 方法（纯，Jest 补测）。tick 改为：Standing/生命参数取 Ponder（`resolveEconomyParams`），USDC 取链读 `/balances`（energy），并在 `status` 翻 `dead`（本周期首次）时调执行器 `/actions/mark-dead`。tick 是 Convex 胶水，靠 typecheck + Task 12 验收。

- [ ] **Step 1: Write the failing test for executorClient.markDead**

In `convex/economy/executorClient.test.ts`, 在 `describe('createExecutorClient', () => {` 内加用例:
```ts
  test('markDead posts agentId and returns txHash', async () => {
    routes['POST /actions/mark-dead'] = { status: 200, body: { txHash: '0xdead' } };
    const ex = createExecutorClient(baseUrl);
    const tx = await ex.markDead('0');
    expect(tx).toBe('0xdead');
    expect(last!.body).toEqual({ agentId: '0' });
  });

  test('markDead throws with status on non-2xx', async () => {
    routes['POST /actions/mark-dead'] = { status: 501, body: { error: 'keeper not configured' } };
    const ex = createExecutorClient(baseUrl);
    await expect(ex.markDead('0')).rejects.toThrow(/501/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/executorClient.test.ts --verbose
```
Expected: FAIL —— `ex.markDead is not a function`。

- [ ] **Step 3: Add markDead to the client**

In `convex/economy/executorClient.ts`:
- `ExecutorClient` 接口加（`fund` 下方）:
```ts
  markDead(agentId: string): Promise<string>;
```
- 返回对象里加（`fund(...)` 后）:
```ts
    markDead(agentId) {
      return action('/actions/mark-dead', { agentId });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/executorClient.test.ts --verbose
```
Expected: PASS（计划 4 的 7 + 本任务 2 = 9 passed）。

- [ ] **Step 5: 改 tick.ts 为混合数据源 + dead→keeper**

Overwrite `convex/economy/tick.ts`:
```ts
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { createExecutorClient } from './executorClient';
import { createPonderClient } from './ponderClient';
import { resolveEconomyParams } from './registry';
import { computeEnergy, isDying, advanceSurvival, SurvivalState } from './survival';
import {
  COST_PER_THINK,
  STANDING_FLOOR,
  RECOVERY_WINDOW,
  DEFAULT_ECON_AGENT_ID,
  economyEnabled,
  executorUrl,
  ponderUrl,
  keeperEnabled,
} from './constants';

/**
 * The economic heartbeat (Plan 5 hybrid data source). Every ECONOMIC_TICK_SECONDS it:
 *  - reads Standing + life params from Ponder (marketCap, costPerThink, floor, T, alive),
 *    falling back to the env/constants mirror when Ponder is down/disabled;
 *  - reads USDC wallet balances LIVE from the executor (eoaUsdc = energy source);
 *  - advances the survival state machine and caches the snapshot;
 *  - on the first transition to `dead`, asks the executor keeper to markDead on-chain.
 * No-ops when the economy is disabled, no default world/agent exists, or the executor
 * is down. The reactive sell/sweep still lives in the payment seam (Plan 4).
 */
export const runEconomicTick = internalAction({
  args: {},
  handler: async (ctx) => {
    await runEconomicTickHandler(ctx);
  },
});

// Extracted so the gated e2e action (e2e.ts) can drive a single tick deterministically.
export async function runEconomicTickHandler(ctx: any): Promise<void> {
  if (!economyEnabled()) return;

  const wa = await ctx.runQuery(internal.economy.perception.getDefaultWorldAgent, {});
  if (!wa) return;

  const econAgentId = process.env.DEFAULT_AGENT_ID ?? DEFAULT_ECON_AGENT_ID;
  const eoa = process.env.AGENT_0_EOA ?? '';
  const executor = createExecutorClient(executorUrl());

  // USDC balances (energy) — LIVE chain truth, not Ponder.
  let balances;
  try {
    balances = await executor.balances(econAgentId);
  } catch (e) {
    console.error('[economy] balances unavailable, skipping tick', e);
    return;
  }

  // Standing + life params — Ponder when configured, else env/constants mirror.
  const purl = ponderUrl();
  const standing = purl ? await createPonderClient(purl).agentStanding(econAgentId) : null;
  const params = resolveEconomyParams(standing, {
    costPerThink: process.env.COST_PER_THINK ?? COST_PER_THINK,
    floor: process.env.STANDING_FLOOR ?? STANDING_FLOOR,
    recoveryWindow: Number(process.env.RECOVERY_WINDOW ?? RECOVERY_WINDOW),
  });

  // Standing prefers Ponder marketCap; fall back to the live executor marketCap.
  const standingMarketCap = standing ? params.marketCap : BigInt(balances.marketCap);

  const energy = computeEnergy(BigInt(balances.eoaUsdc), params.costPerThink);
  const dying = isDying(energy, standingMarketCap, params.floor);

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
  const next = advanceSurvival(prevState, dying, now, params.recoveryWindow);

  await ctx.runMutation(internal.economy.perception.upsertAgentEconomy, {
    worldId: wa.worldId,
    agentId: wa.agentId,
    econAgentId,
    eoa,
    eoaUsdc: balances.eoaUsdc,
    smartUsdc: balances.smartUsdc,
    tokenBalance: standing ? params.tokenBalance.toString() : balances.tokenBalance,
    marketCap: standingMarketCap.toString(),
    energy,
    lastPerceivedAt: now,
    status: next.status,
    starvingPeriods: next.starvingPeriods,
    starvingSince: next.starvingSince,
    diedAt: next.diedAt,
  });

  if (next.status === 'dead' && prevState.status !== 'dead') {
    console.log(`[economy] agent ${econAgentId} DIED (starved ${next.starvingPeriods} periods)`);
    if (keeperEnabled()) {
      try {
        const tx = await executor.markDead(econAgentId);
        console.log(`[economy] keeper markDead(${econAgentId}) -> ${tx}`);
      } catch (e) {
        console.error('[economy] keeper markDead failed (will retry next death transition)', e);
      }
    }
  }
}
```

> 死亡上链由 `TRUMANTOWN_KEEPER=1` 门控（默认关）。仅 `status` 首次翻 `dead` 触发一次；`advanceSurvival` 的 `dead` 终态保证不重复调用。markDead 失败只记日志（不回滚状态表，下次死亡转换才会再尝试——SP1 单居民下死亡是单次事件，足够）。

- [ ] **Step 6: typecheck + 既有 Jest 全绿**

Run:
```bash
npx tsc -p convex --noEmit && npm test
```
Expected: typecheck 干净；既有 + 新增 Jest 全绿（门控默认关，`runEconomicTickHandler` 仅被 cron/e2e 调用，纯逻辑 ponderClient/registry/executorClient 已单测）。

- [ ] **Step 7: Commit**

```bash
git add convex/economy/executorClient.ts convex/economy/executorClient.test.ts convex/economy/tick.ts
git commit -m "feat(economy): hybrid tick (Ponder Standing + live USDC) + dead->executor keeper markDead"
```

---

## Task 11：gated e2e Convex 接口（验收脚本驱动）+ x402 全链路 facilitator 冒烟

**Files:**
- Create: `convex/economy/e2e.ts`
- Create: `services/gateway/test/live/facilitator.live.ts`

> `e2e.ts` 是 **gated 公开 action/query**（`TRUMANTOWN_E2E=1` 才生效），让验收脚本确定性地驱动单次 tick 并读 status，免等 30s cron。facilitator.live.ts 是网关↔真 facilitator 的 opt-in v2 端到端冒烟。两者均 typecheck + 手动验证。

- [ ] **Step 1: 写 gated e2e Convex 接口**

Create `convex/economy/e2e.ts`:
```ts
import { action } from '../_generated/server';
import { internal } from '../_generated/api';
import { runEconomicTickHandler } from './tick';

function e2eEnabled(): boolean {
  return process.env.TRUMANTOWN_E2E === '1';
}

/**
 * Gated public action: runs ONE economic tick deterministically (same handler the cron
 * uses). Only active when TRUMANTOWN_E2E=1, so it is inert in normal/prod runs. The two
 * acceptance scripts call this to advance the survival counter without waiting for cron.
 */
export const tickOnce = action({
  args: {},
  handler: async (ctx) => {
    if (!e2eEnabled()) return { ran: false };
    await runEconomicTickHandler(ctx);
    return { ran: true };
  },
});

/**
 * Gated public action: the default agent's current economy row (status/energy/marketCap).
 * An action (not a query) so it can `ctx.runQuery` the existing internalQueries — Convex
 * query contexts don't expose runQuery, actions do.
 */
export const getStatus = action({
  args: {},
  handler: async (ctx) => {
    if (!e2eEnabled()) return null;
    const wa = await ctx.runQuery(internal.economy.perception.getDefaultWorldAgent, {});
    if (!wa) return null;
    return await ctx.runQuery(internal.economy.perception.getAgentEconomy, {
      worldId: wa.worldId,
      agentId: wa.agentId,
    });
  },
});
```

> 两者都是 `action`：`tickOnce` 需 `runQuery`/`runMutation`，`getStatus` 需 `runQuery` 调既有 internalQuery（Convex `query` ctx 无 `runQuery`，`action` ctx 有）。验收脚本均经 `convex.action(...)` 调用。

- [ ] **Step 2: typecheck（codegen 后）**

Run:
```bash
npx convex codegen && npx tsc -p convex --noEmit
```
Expected: 无报错（`api.economy.e2e.tickOnce`/`getStatus` 进 codegen；若 `internal.economy.*` 报缺，重跑 codegen）。

- [ ] **Step 3: 写网关↔真 facilitator v2 冒烟**

Create `services/gateway/test/live/facilitator.live.ts`:
```ts
/**
 * Opt-in x402 full-chain v2 smoke (NOT in `npm test`; run with tsx).
 * Proves: a real X-PAYMENT (from the executor's real CDP signer) is accepted by the
 * gateway wired to the REAL self-hosted facilitator (/facilitator/verify), and the
 * batch queue settles it on-chain (/facilitator/settle, funded settler).
 *
 * Requires running: facilitator :8403, gateway :8402 (FACILITATOR_URL pointing at the
 * real facilitator), executor :8404 (real CDP), Ollama :11434. Skips if unconfigured.
 */
const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8402';
const EXECUTOR = process.env.EXECUTOR_URL ?? 'http://127.0.0.1:8404';
const AGENT_ID = process.env.SMOKE_AGENT_ID ?? '0';

async function main() {
  // Reachability gate.
  try {
    const h = await fetch(`${GATEWAY}/healthz`);
    if (!h.ok) throw new Error();
  } catch {
    console.log(`[facilitator.live] SKIP — gateway not reachable at ${GATEWAY}`);
    return;
  }

  // 1) First call -> 402 with accepts[0].
  const body = JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'live ping' }] });
  const r402 = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Id': AGENT_ID },
    body,
  });
  if (r402.status !== 402) {
    console.log('[facilitator.live] unexpected first status', r402.status, '(expected 402) — SKIP');
    return;
  }
  const challenge = await r402.json();
  const requirements = challenge?.accepts?.[0];
  if (!requirements) throw new Error('402 without accepts[0]');

  // 2) Executor signs (real CDP EOA -> real x402 v2 X-PAYMENT).
  const signRes = await fetch(`${EXECUTOR}/sign-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: AGENT_ID, paymentRequirements: requirements }),
  });
  if (signRes.status === 402) {
    console.log('[facilitator.live] executor reports insufficient_funds — fund the EOA first (executor /actions/fund). SKIP');
    return;
  }
  const { xPayment } = await signRes.json();

  // 3) Retry with X-PAYMENT -> real facilitator /verify -> 200 (then batch settle on-chain).
  const r200 = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Id': AGENT_ID, 'X-PAYMENT': xPayment },
    body,
  });
  console.log('[facilitator.live] retry status', r200.status, 'X-PAYMENT-RESPONSE:', r200.headers.get('x-payment-response'));
  if (r200.status !== 200) throw new Error(`gateway rejected verified payment: ${r200.status}`);
  console.log('[facilitator.live] OK — real facilitator verified the v2 payment; settle is queued (check facilitator logs / Base Sepolia for the settle tx).');
}

main().catch((e) => { console.error('[facilitator.live] FAIL', e); process.exit(1); });
```

- [ ] **Step 4: typecheck 网关（含 live 脚本）**

Run:
```bash
cd "services/gateway" && npm run typecheck; cd ../..
```
Expected: 干净（`test/live/facilitator.live.ts` 在 `include` 范围内，纯 fetch、零新依赖）。

> 该脚本是手动 opt-in：`cd services/gateway && npx tsx --env-file=.env test/live/facilitator.live.ts`（需上面四个服务起 + 真 facilitator 配 `EVM_PRIVATE_KEY` 且 funded）。`vitest run` 不收集 `.live.ts`（`include` 只匹配 `test/**/*.test.ts`）。

- [ ] **Step 5: 既有全套不回归**

Run:
```bash
cd "services/gateway" && npx vitest run; cd ../.. && npm test
```
Expected: 网关 Vitest 全绿；根 Convex Jest 全绿（e2e.ts gated 默认关）。

- [ ] **Step 6: Commit**

```bash
git add convex/economy/e2e.ts services/gateway/test/live/facilitator.live.ts
git commit -m "feat(economy): add gated e2e tick/status interface; add gateway<->real-facilitator v2 smoke"
```

---

## Task 12：两条 Base Sepolia LIVE 验收脚本（services/e2e/）

**Files:**
- Create: `services/e2e/package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`
- Create: `services/e2e/src/lib.ts`, `services/e2e/test/lib.test.ts`
- Create: `services/e2e/src/revive.live.ts`, `services/e2e/src/death.live.ts`

> 新隔离子工程。纯助手（阈值/比较/agent 解析）TDD；两条脚本是 opt-in LIVE（gate+SKIP），驱动真链闭环。

- [ ] **Step 1: 写 e2e 工程脚手架**

Create `services/e2e/package.json`:
```json
{
  "name": "trumantown-e2e",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "e2e:revive": "tsx --env-file=.env src/revive.live.ts",
    "e2e:death": "tsx --env-file=.env src/death.live.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "convex": "^1.16.0",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "@types/node": "^18.19.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

Create `services/e2e/tsconfig.json`:
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

Create `services/e2e/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

Create `services/e2e/.gitignore`:
```
node_modules/
dist/
.env
```

Create `services/e2e/.env.example`:
```
# 全栈端点（WSL 内）
GATEWAY_URL=http://127.0.0.1:8402
EXECUTOR_URL=http://127.0.0.1:8404
PONDER_URL=http://127.0.0.1:42069
CONVEX_URL=http://127.0.0.1:3210      # 自托管 convex dev 的 client URL

# 居民 0
SMOKE_AGENT_ID=0
AGENT_0_TOKEN=0x...
AGENT_0_EOA=0x...
REGISTRY_ADDRESS=0x...
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
RPC_URL_BASE_SEPOLIA=https://sepolia.base.org

# 死亡脚本：缩短抢救窗口加速（与 convex env RECOVERY_WINDOW 一致）
RECOVERY_WINDOW=10
```

- [ ] **Step 2: 安装依赖**

Run:
```bash
cd "services/e2e" && npm install && cd ../..
```
Expected: `node_modules/` 生成无 error。

- [ ] **Step 3: Write the failing test for pure helpers**

Create `services/e2e/test/lib.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canThink, summarizeBalances, type Balances } from '../src/lib.js';

const b = (eoaUsdc: string, smartUsdc = '0', tokenBalance = '0', marketCap = '0'): Balances => ({
  agentId: '0', eoaUsdc, smartUsdc, tokenBalance, marketCap,
});

describe('canThink', () => {
  it('true when EOA USDC >= costPerThink', () => {
    expect(canThink(b('10000'), 10000n)).toBe(true);
    expect(canThink(b('20000'), 10000n)).toBe(true);
  });
  it('false when EOA USDC < costPerThink', () => {
    expect(canThink(b('9999'), 10000n)).toBe(false);
    expect(canThink(b('0'), 10000n)).toBe(false);
  });
});

describe('summarizeBalances', () => {
  it('renders a one-line summary', () => {
    expect(summarizeBalances(b('1', '2', '3', '4'))).toBe('eoaUsdc=1 smartUsdc=2 token=3 mcap=4');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run:
```bash
cd "services/e2e" && npx vitest run test/lib.test.ts; cd ../..
```
Expected: FAIL —— `Cannot find module '../src/lib.js'`。

- [ ] **Step 5: Write minimal implementation**

Create `services/e2e/src/lib.ts`:
```ts
export interface Balances {
  agentId: string;
  eoaUsdc: string;
  smartUsdc: string;
  tokenBalance: string;
  marketCap: string;
}

/** energy gate: can the EOA afford one think right now? */
export function canThink(b: Balances, costPerThink: bigint): boolean {
  return BigInt(b.eoaUsdc) >= costPerThink;
}

export function summarizeBalances(b: Balances): string {
  return `eoaUsdc=${b.eoaUsdc} smartUsdc=${b.smartUsdc} token=${b.tokenBalance} mcap=${b.marketCap}`;
}

// --- shared HTTP helpers (used by the live scripts) ---
export async function getBalances(executor: string, agentId: string): Promise<Balances> {
  const r = await fetch(`${executor}/balances/${agentId}`);
  if (!r.ok) throw new Error(`/balances/${agentId} -> ${r.status}`);
  return (await r.json()) as Balances;
}

export async function executorAction(executor: string, path: string, body: unknown): Promise<any> {
  const r = await fetch(`${executor}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

export function reachable(label: string, url: string): Promise<boolean> {
  return fetch(`${url}/healthz`).then((r) => r.ok).catch(() => false);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run:
```bash
cd "services/e2e" && npx vitest run test/lib.test.ts; cd ../..
```
Expected: PASS（4 passed）。

- [ ] **Step 7: 写验收① 复活脚本**

Create `services/e2e/src/revive.live.ts`:
```ts
/**
 * Acceptance ① (Base Sepolia LIVE, opt-in): 饥饿 → 卖币 + 扫款 → 复活.
 * Preconditions: gateway/executor/(ollama) up; agent "0" registered; the smart account
 * holds some AgentToken (so there's something to sell) and the EOA is below costPerThink.
 * Mirrors the Plan-4 payment seam orchestration against the REAL chain. Skips if unconfigured.
 */
import { getBalances, executorAction, summarizeBalances, canThink } from './lib.js';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8402';
const EXECUTOR = process.env.EXECUTOR_URL ?? 'http://127.0.0.1:8404';
const AGENT_ID = process.env.SMOKE_AGENT_ID ?? '0';

async function main() {
  if (!(await fetch(`${EXECUTOR}/healthz`).then((r) => r.ok).catch(() => false))) {
    console.log(`[revive] SKIP — executor not reachable at ${EXECUTOR}`);
    return;
  }

  const before = await getBalances(EXECUTOR, AGENT_ID);
  console.log('[revive] before:', summarizeBalances(before));
  if (BigInt(before.tokenBalance) === 0n) {
    console.log('[revive] SKIP — no token to sell (fund smart account + buy first via /actions/fund + /actions/buy)');
    return;
  }

  // 1) Think attempt -> gateway 402.
  const body = JSON.stringify({ model: 'llama3', messages: [{ role: 'user', content: 'survive' }] });
  const r402 = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Id': AGENT_ID }, body,
  });
  const challenge = await r402.json();
  const requirements = challenge?.accepts?.[0];
  if (r402.status !== 402 || !requirements) throw new Error(`expected 402+accepts, got ${r402.status}`);
  const costPerThink = BigInt(requirements.maxAmountRequired);

  // 2) Sign should fail (EOA broke).
  const sign1 = await executorAction(EXECUTOR, '/sign-payment', { agentId: AGENT_ID, paymentRequirements: requirements });
  if (sign1.status !== 402) {
    console.log('[revive] EOA already funded (sign ok); nothing to revive. status', sign1.status);
    return;
  }
  console.log('[revive] sign -> insufficient_funds (as expected, EOA starving)');

  // 3) Reactive survival: sell whole token balance, sweep smart -> EOA.
  const cur = await getBalances(EXECUTOR, AGENT_ID);
  const sell = await executorAction(EXECUTOR, '/actions/sell', { agentId: AGENT_ID, tokensIn: cur.tokenBalance, minUsdcOut: '0' });
  console.log('[revive] sell ->', sell.status, sell.json?.txHash);
  const afterSell = await getBalances(EXECUTOR, AGENT_ID);
  const xfer = await executorAction(EXECUTOR, '/actions/transfer', { agentId: AGENT_ID, source: 'smart', to: process.env.AGENT_0_EOA, amount: afterSell.smartUsdc });
  console.log('[revive] transfer smart->eoa ->', xfer.status, xfer.json?.txHash);

  // 4) Retry sign -> should now succeed; retry think -> 200.
  const sign2 = await executorAction(EXECUTOR, '/sign-payment', { agentId: AGENT_ID, paymentRequirements: requirements });
  if (sign2.status !== 200) throw new Error(`revive failed: re-sign status ${sign2.status}`);
  const r200 = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Id': AGENT_ID, 'X-PAYMENT': sign2.json.xPayment }, body,
  });
  if (r200.status !== 200) throw new Error(`revive failed: think status ${r200.status}`);

  const after = await getBalances(EXECUTOR, AGENT_ID);
  console.log('[revive] after:', summarizeBalances(after));
  if (!canThink(after, costPerThink)) throw new Error('revive failed: EOA still below costPerThink');
  console.log('[revive] OK — starved agent sold its coin, swept USDC, and resumed thinking');
}

main().catch((e) => { console.error('[revive] FAIL', e); process.exit(1); });
```

- [ ] **Step 8: 写验收② 死亡脚本**

Create `services/e2e/src/death.live.ts`:
```ts
/**
 * Acceptance ② (Base Sepolia LIVE, opt-in): 饥饿 → 无人施救 → 连续 T 周期 → markDead + AgentDied.
 * Drives the Convex economic tick deterministically via the gated e2e action (TRUMANTOWN_E2E=1,
 * TRUMANTOWN_KEEPER=1 on the Convex deployment), then verifies the on-chain AgentDied event +
 * agents(id).alive == false. Preconditions: EOA broke AND no sellable token (so survival can't
 * recover). Skips if unconfigured.
 */
import { ConvexHttpClient } from 'convex/browser';
import { createPublicClient, http, getAddress, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { getBalances, summarizeBalances } from './lib.js';

const EXECUTOR = process.env.EXECUTOR_URL ?? 'http://127.0.0.1:8404';
const CONVEX_URL = process.env.CONVEX_URL;
const AGENT_ID = process.env.SMOKE_AGENT_ID ?? '0';
const REGISTRY = process.env.REGISTRY_ADDRESS;
const RPC = process.env.RPC_URL_BASE_SEPOLIA ?? 'https://sepolia.base.org';
const T = Number(process.env.RECOVERY_WINDOW ?? '10');

const REGISTRY_AGENTS_ABI = [
  { type: 'function', name: 'agents', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [
    { name: 'token', type: 'address' }, { name: 'wallet', type: 'address' }, { name: 'costPerThink', type: 'uint256' },
    { name: 'floor', type: 'uint256' }, { name: 'recoveryWindow', type: 'uint256' }, { name: 'alive', type: 'bool' },
  ] },
] as const;

async function main() {
  if (!CONVEX_URL || !REGISTRY) {
    console.log('[death] SKIP — CONVEX_URL / REGISTRY_ADDRESS not set');
    return;
  }
  if (!(await fetch(`${EXECUTOR}/healthz`).then((r) => r.ok).catch(() => false))) {
    console.log(`[death] SKIP — executor not reachable at ${EXECUTOR}`);
    return;
  }

  const start = await getBalances(EXECUTOR, AGENT_ID);
  console.log('[death] start:', summarizeBalances(start));
  if (BigInt(start.tokenBalance) > 0n) {
    console.log('[death] SKIP — agent still holds sellable token (would revive, not die). Sell/sweep/spend it first.');
    return;
  }

  const convex = new ConvexHttpClient(CONVEX_URL);
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const fromBlock = await client.getBlockNumber();

  // Drive up to T+1 ticks; expect status to reach 'dead' at tick T.
  let status = 'alive';
  for (let i = 1; i <= T + 1 && status !== 'dead'; i++) {
    await convex.action('economy/e2e:tickOnce' as any, {});
    const row = (await convex.action('economy/e2e:getStatus' as any, {})) as any;
    status = row?.status ?? 'unknown';
    console.log(`[death] tick ${i}: status=${status} starvingPeriods=${row?.starvingPeriods}`);
  }
  if (status !== 'dead') throw new Error(`agent did not die after ${T + 1} ticks (status=${status})`);

  // Verify on-chain: AgentDied event + alive=false.
  const logs = await client.getLogs({
    address: getAddress(REGISTRY),
    event: parseAbiItem('event AgentDied(uint256 indexed agentId)'),
    args: { agentId: BigInt(AGENT_ID) },
    fromBlock,
    toBlock: 'latest',
  });
  console.log('[death] AgentDied logs found:', logs.length);
  const a = (await client.readContract({
    address: getAddress(REGISTRY), abi: REGISTRY_AGENTS_ABI, functionName: 'agents', args: [BigInt(AGENT_ID)],
  })) as readonly [string, string, bigint, bigint, bigint, boolean];
  if (a[5] !== false) throw new Error('on-chain agent still alive after markDead');
  if (logs.length === 0) throw new Error('no AgentDied event emitted');
  console.log('[death] OK — starved with no rescue, died after T periods, markDead + AgentDied confirmed on-chain');
}

main().catch((e) => { console.error('[death] FAIL', e); process.exit(1); });
```

> Convex 自托管的 action/query 引用名按部署而定（`'economy/e2e:tickOnce'`）。若 ConvexHttpClient 需要生成的 `api` 引用，可改 `import { api } from "../../../convex/_generated/api"` 并用 `convex.action(api.economy.e2e.tickOnce, {})`——typecheck/运行是判据（verify-then-adapt）。死亡脚本需 Convex 部署设 `TRUMANTOWN_ECONOMY=1`、`TRUMANTOWN_E2E=1`、`TRUMANTOWN_KEEPER=1`、`RECOVERY_WINDOW=<T>`，执行器设 `KEEPER_PRIVATE_KEY`（funded）。

- [ ] **Step 9: 写 e2e README**

Create `services/e2e/README.md`:
```markdown
# 端到端验收脚本（TrumanTown SP1 · 计划 5/5 收官）

两条 Base Sepolia LIVE 脚本，opt-in、未配置即 SKIP。纯编排逻辑已在计划 4 单测覆盖；这里检验**真链闭环**。

## 前置（WSL 内全栈起）
1. 合约部署到 Base Sepolia（计划1 `Deploy.s.sol`），居民 0 已 `spawnAgent`。
2. facilitator :8403（真，`EVM_PRIVATE_KEY` funded）、gateway :8402（`GATEWAY_USE_REGISTRY=1` + `FACILITATOR_URL=.../facilitator`）、executor :8404（真 CDP + `EXECUTOR_USE_REGISTRY=1` + `KEEPER_PRIVATE_KEY` funded）、indexer :42069、Ollama :11434。
3. Convex 部署 env：`TRUMANTOWN_ECONOMY=1`、`TRUMANTOWN_E2E=1`、`TRUMANTOWN_KEEPER=1`、`PONDER_URL=http://127.0.0.1:42069`、`OLLAMA_HOST=http://127.0.0.1:8402`、`EXECUTOR_URL=http://127.0.0.1:8404`、`RECOVERY_WINDOW=<T>`、`AGENT_0_EOA=0x...`。
4. `cp .env.example .env` 填端点/地址。

## 跑
```bash
cd services/e2e && npm install
npm run e2e:revive   # 验收①：饥饿→卖币+扫款→复活
npm run e2e:death    # 验收②：饥饿→无人施救→T 周期→markDead+AgentDied
npm test             # 纯助手单测（canThink/summarizeBalances）
```

## 验收① 复活：前置 = smart 账户持有 AgentToken 且 EOA < costPerThink（faucet 到 smart + /actions/buy 造币，别给 EOA 充值）。
## 验收② 死亡：前置 = EOA 破产且 token 库存为 0（先卖光/扫走/花掉），脚本驱动 T 次 tick 后断言链上 AgentDied + alive=false。
```

- [ ] **Step 10: typecheck + 单测**

Run:
```bash
cd "services/e2e" && npm run typecheck && npx vitest run; cd ../..
```
Expected: typecheck 干净；Vitest `4 passed`（lib）。`.live.ts` 不被 `vitest run` 收集。

- [ ] **Step 11: Commit**

```bash
git add services/e2e
git commit -m "feat(e2e): add Base Sepolia LIVE acceptance scripts (revive + death) + pure helpers"
```

---

## Task 13：SP1 收官——全量校验 + READMEs 更新 + 收官清单

**Files:**
- Modify: `services/gateway/README.md`, `services/executor/README.md`, `convex/economy/README.md`
- Modify: `docs/superpowers/plans/2026-06-03-trumantown-sp1-05-ponder.md`（本文件，文末「SP1 收官验收清单」已含）

- [ ] **Step 1: 全量纯逻辑单测 + typecheck（四个子工程 + Convex）**

Run（逐个按 WSL 配方）:
```bash
cd "services/indexer" && npx vitest run && npx ponder typecheck; cd ../..
cd "services/gateway" && npx vitest run && npm run typecheck; cd ../..
cd "services/executor" && npx vitest run && npm run typecheck; cd ../..
cd "services/e2e" && npx vitest run && npm run typecheck; cd ../..
npx tsc -p convex --noEmit && npm test
```
Expected: 全部绿。索引器 aggregate 2；网关 33；执行器（38+4+keeper 3+e2e 3）；e2e lib 4；Convex Jest 全绿（含 ponderClient 3 + registry 3 + executorClient 9）。

- [ ] **Step 2: 更新网关 README 计划5 注记**

In `services/gateway/README.md`, 把「⚠ 计划 5 集成待办」整节替换为「✅ 计划 5 完成」:
```markdown
## ✅ 计划 5（已完成）

- 定价以链上 `AgentRegistry.agents(id).costPerThink` 为准（`GATEWAY_USE_REGISTRY=1`，registry-cache resolver）；伪造 `X-Agent-Id`（未注册/dead）→ 无价 → 402/500，拿不到便宜/免费推理。
- 网关↔真 facilitator v2 端到端冒烟：`test/live/facilitator.live.ts`（真 `/verify`；batch `/settle` 上链需 funded settler）。
```

- [ ] **Step 3: 更新执行器 README 计划5 注记**

In `services/executor/README.md`, 把「⚠ 计划 5 集成待办」整节替换为「✅ 计划 5 完成」:
```markdown
## ✅ 计划 5（已完成）

- `EXECUTOR_USE_REGISTRY=1`：以链上 `agents(id)` 解析 token/wallet + CDP 派生 EOA（反伪造，无宽容 fallback）。
- `transferUsdc(source:"eoa")` 接通 CDP EOA send。
- keeper：`POST /actions/mark-dead {agentId}`（`KEEPER_PRIVATE_KEY` 调 `AgentRegistry.markDead`，需 Base Sepolia ETH）。
- 两条验收脚本见 `services/e2e/`。
```

- [ ] **Step 4: 更新 convex/economy README 计划5 注记**

In `convex/economy/README.md`, 把「⚠ 计划 5 集成待办」整节替换为「✅ 计划 5 完成」:
```markdown
## ✅ 计划 5（已完成）

- 混合数据源：Standing（marketCap/tokenBalance/costPerThink/floor/T/alive）从 **Ponder** 读（`PONDER_URL`），env/常量兜底；**USDC 余额（energy 源）仍走链读** `/balances`。
- 死亡上链：`status` 翻 `dead` 时（`TRUMANTOWN_KEEPER=1`）调执行器 `/actions/mark-dead` → 链上 `AgentDied`。
- gated 验收接口 `economy/e2e.ts`（`TRUMANTOWN_E2E=1`）：`tickOnce` / `getStatus` 供 `services/e2e/` 驱动两条剧本。
- 新增 env：`PONDER_URL`、`TRUMANTOWN_KEEPER`、`TRUMANTOWN_E2E`。
```

- [ ] **Step 5: typecheck/test 不被 README 改动影响**

Run:
```bash
npx tsc -p convex --noEmit && npm test
```
Expected: typecheck 干净；Jest 全绿。

- [ ] **Step 6: Commit**

```bash
git add services/gateway/README.md services/executor/README.md convex/economy/README.md docs/superpowers/plans/2026-06-03-trumantown-sp1-05-ponder.md
git commit -m "docs(sp1): finalize Plan 5 (indexer + integration); mark Plan-5 todos done across services"
```

- [ ] **Step 7: （可选，需全栈 + 真链）端到端验收**

> 仅当 Base Sepolia 部署 + 全栈起 + CDP/keeper/settler funded 时执行；否则跳过（脚本自动 SKIP）。

Run:
```bash
cd "services/indexer" && npm run smoke; cd ../..
cd "services/gateway" && npx tsx --env-file=.env test/live/facilitator.live.ts; cd ../..
cd "services/e2e" && npm run e2e:revive && npm run e2e:death; cd ../..
```
Expected（全栈起时）：索引器 smoke 打印 `/agents/0` 聚合；facilitator 冒烟打印真 `/verify` 通过 + settle 入队；revive 打印「卖币→扫款→恢复思考」；death 打印「T 周期判死 + 链上 AgentDied + alive=false」。未配置时各自 SKIP。

---

## 自检（Spec / 锚定覆盖）

- 设计稿 §3.4 Ponder 索引链上事件（价/持仓/USDC/Death）→ 读 DB/API：`services/indexer/`（Bought/Sold/AgentSpawned/AgentRegistered/AgentDied + `/agents/:id`）✅（混合：USDC 余额按 brainstorm 决策走链读，非索引）
- 设计稿 §5 感知数据源 SP1=执行器/balances → 计划5 改读 Ponder（同字段语义）：`tick.ts` 混合（Ponder Standing + 链读 USDC）+ `ponderClient.ts`/`registry.ts` ✅
- 各计划锚定「resolver/数据源替换 → AgentRegistry.agents(id)/Ponder 驱动 + 反伪造」：网关 `registryResolver.ts`、执行器 `registryAgentResolver.ts`（无宽容 fallback，未注册/dead→undefined）✅
- 计划3 锚定「执行器 transferUsdc(source:"eoa") → CDP EOA send」：Task 7 ✅
- 计划4 锚定「死亡上链 keeper：status='dead' → markDead → AgentDied」：执行器 `/actions/mark-dead`（keeper-only）+ Convex tick 触发（决策 B）✅
- 计划2/3 锚定「x402 全链路 v2 真链：网关↔真 facilitator verify + 批量 settle」：`facilitator.live.ts` 冒烟 ✅（settle 上链需 funded settler，已注明）
- 设计稿 §7/各计划「两条验收脚本」：`services/e2e/`（revive + death，Base Sepolia LIVE，决策 C）✅
- 设计稿 §3「自托管 Convex（WSL 内）按需」：验收脚本 `CONVEX_URL` 指向自托管 dev；README 注明 ✅
- 设计稿 §10 Non-Goal「前端 UI 自 SP2 起」：索引器只暴露读 API，不建 UI ✅

---

## SP1 收官验收清单（SP1 末计划，整体交付判据）

> SP1 = 用最少部件端到端证明：**AI 居民必须支付真实 USDC 才能思考，而它自己的币是把价值变现成 USDC 的唯一生命线。** 下列勾齐即 SP1 完成。

### A. 静态/纯逻辑（无需真链，CI 可跑）
- [ ] 合约（计划1）：`cd contracts && forge test` 全绿（MockUSDC 2 + AgentToken 8 + AgentRegistry 4 + LaunchpadFactory 2 = 16）。
- [ ] 网关（计划2+5）：`cd services/gateway && npx vitest run` 全绿（33）+ `npm run typecheck` 干净。
- [ ] 执行器（计划3+5）：`cd services/executor && npx vitest run` 全绿 + `npm run typecheck` 干净。
- [ ] 索引器（计划5）：`cd services/indexer && npx vitest run`（aggregate 2）+ `npx ponder typecheck` 干净。
- [ ] e2e 助手（计划5）：`cd services/e2e && npx vitest run`（lib 4）+ `npm run typecheck` 干净。
- [ ] Convex（计划4+5）：`npm test`（Jest）全绿 + `npx tsc -p convex --noEmit` 干净。

### B. 链上 / 真链 / 真 SDK 冒烟（需密钥 + funded 钱包，opt-in）
- [ ] 合约部署到 Base Sepolia（计划1 `Deploy.s.sol`），`spawnAgent` 居民 0；回填 `FACTORY/REGISTRY/AGENT_0_*` 地址。
- [ ] facilitator :8403 真起，`GET /facilitator/supported` 返回 v2/`eip155:84532`。
- [ ] 执行器 LIVE 冒烟（计划3）：`npm run live:verify` —— 真 CDP 签名被真 `/verify` 接受。
- [ ] 索引器 smoke（计划5）：`npm run smoke` —— `/agents/0` 返回 Standing 聚合。
- [ ] x402 全链路（计划5）：`facilitator.live.ts` —— 网关↔真 facilitator 验款 200 + settle 入队（funded settler 上链）。

### C. 两条端到端剧本（SP1 核心论点的最终证据，Base Sepolia LIVE）
- [ ] **① 复活**：`npm run e2e:revive` —— 居民 EOA 破产 → think 触发 402 → `/sign-payment` insufficient → 卖自有币（`/actions/sell`）+ 扫款（`/actions/transfer smart→eoa`）→ 重签成功 → think 200 → energy 恢复。证「自有币是变现生命线」。
- [ ] **② 死亡**：`npm run e2e:death` —— 居民破产且无币可卖 → 连续 T=10 经济 tick `dying` → `agentEconomy.status='dead'` → 接缝短路（停止思考）→ keeper `markDead` → 链上 `AgentDied` + `alive=false`。证「付不起=想不了=死」。

### D. 不变量复核（外科手术式集成的边界）
- [ ] 引擎其余（`aiTown/*` tick/movement/memory 流程）未被改动。
- [ ] 计划 1–4 冻结接口（链上 ABI、网关 A/C、执行器 B′ 既有端点、Convex 经济模块既有签名）未改；计划 5 只做**增量**（新文件、新增量端点 `/actions/mark-dead`、resolver/数据源替换、新 env）。
- [ ] 所有新行为门控默认关（`*_USE_REGISTRY`/`PONDER_URL`/`TRUMANTOWN_KEEPER`/`TRUMANTOWN_E2E`），关闭时行为与计划 4 结束态一致，既有测试零回归。
- [ ] 反伪造：伪造 `X-Agent-Id`（未在链上注册或 `alive=false`）在网关与执行器均解析为「无」，拿不到更便宜/免费推理。

---

_本计划为 SP1 末计划（计划 5/5：Ponder 索引器 + 端到端集成）。完成并勾齐「SP1 收官验收清单」即标志 SP1 垂直切片交付——后续 SP2–SP5 在此之上逐层叠加（见设计稿 §9），各自再走 brainstorm → spec → plan。_
