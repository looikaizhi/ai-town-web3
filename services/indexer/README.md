# Ponder 索引器（TrumanTown SP1 · 计划 5/5）

索引 Base Sepolia 上 TrumanTown 合约事件，暴露 per-agent 读 API，供 Convex 感知（Standing 侧）与前端（SP2+）。

## 索引什么
- `LaunchpadFactory.AgentSpawned` → 动态追踪每个 `AgentToken`（factory 模式）。
- `AgentRegistry.AgentRegistered` → 建 `agent` 行（读 `agents(id)` 拿 token/wallet/costPerThink/floor/recoveryWindow/alive）+ 当前曲线快照。
- `AgentRegistry.AgentDied` → 标 `alive=false`、`diedAt`、`marketCap=0`（曲线其余字段不强制清零，属 SP5）。
- `AgentToken.Bought/Sold` → 追加 `trade` 行 + 刷新 Standing 快照（`marketCap/pricePerToken/usdcReserve/tokenBalance`）。

## 混合数据源（重要）
`agent` 行只存 **Standing 侧**（曲线派生 + 注册表镜像）。**USDC 钱包余额（eoaUsdc/smartUsdc = energy 源）不进 Ponder**——由 Convex 经济 tick 直接链读（pay-to-think 闸门保持链上真值、零索引器滞后）。

## WSL 运行（Node 24）
```bash
cd services/indexer
nvm use 24
npm install
cp .env.example .env   # 填 FACTORY_ADDRESS / REGISTRY_ADDRESS / USDC_ADDRESS / START_BLOCK / RPC（计划1 Deploy 输出）
npm run dev            # ponder dev，读 API 在 :42069（PONDER_PORT 可覆盖）；自带 /graphql
```

## 读 API
- `GET /agents/:id` → `AgentAggregate`（字段语义对齐执行器 /balances 的 Standing 侧；原子单位十进制字符串）。
- `GET /agents` → 列表。
- `GET /healthz` → `{ ok: true }`。

## 测试 / 校验
```bash
npm test               # 纯逻辑单测（aggregate）
npm run typecheck      # = tsc --noEmit（Ponder 0.11 无 typecheck CLI）
npm run smoke          # opt-in：起 ponder dev 后 curl 读 API（未起则 SKIP）
```

## 依赖版本（实测）
- `ponder`: 0.11.44　·　`viem`: 2.52.0　·　`hono`: 4.12.23

## ⚠ verify-then-adapt
Ponder 主线 API（`onchainTable` / `ponder:schema` / `ponder:api` / `context.db` / `chains`+`chain`）随版本演进；本实现已对齐 0.11.44（`chains`/`chain`/`id`/`rpc`、`eq` 从 `ponder` re-export、默认 Hono app 自动挂载、`onConflictDoUpdate` 仅非主键列）。升级 Ponder 时若导出变化，按 `tsc --noEmit` 就地绑定，schema/handler/读 API 形状不变。
