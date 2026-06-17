# 自托管 x402 facilitator（TrumanTown SP1）

基底：fork 自 `OviatoHQ/x402-facilitator-hono`（不入库）。这是一个可挂载的 Hono 子应用库，
提供网关依赖的 `/verify`、`/settle`、`/supported`，指向 Base Sepolia（CAIP-2: `eip155:84532`）。

端点已通过 **LIVE smoke test** 验证（本地 anvil key + `https://sepolia.base.org` RPC）：
- `GET /facilitator/supported` → `{"kinds":[{"x402Version":2,"scheme":"exact","network":"eip155:84532"}],...}`
- `POST /facilitator/verify` (空 body) → `{"error":"Missing paymentPayload or paymentRequirements"}` (预期 400)

## WSL 复现（Node 18）

```bash
cd services
git clone --depth 1 https://github.com/OviatoHQ/x402-facilitator-hono.git facilitator
cd facilitator && rm -rf .git

# 安装依赖（npm；库本身 pnpm lockfile 在 Windows NTFS 上有 rename 权限问题）
npm install hono @hono/node-server @x402/core @x402/evm viem tsx

cp .env.example .env   # 按 .env.example 填 RPC_URL_BASE_SEPOLIA / EVM_PRIVATE_KEY

# 启动（tsx 开发模式，监听 :8403）
./node_modules/.bin/tsx examples/node/src/index.ts
```

> **备注：** `examples/node` 的 `package.json` 使用 `"@oviato/x402-facilitator-hono": "workspace:*"`，
> 在独立克隆时需要先构建库（`pnpm install && pnpm build` 在根目录），或直接从 npm 注册表安装：
> `npm install @oviato/x402-facilitator-hono`。最简单的方式是从根目录的 `node_modules` 里让
> tsx 直接引用 `./src/index.js`（已在 smoke test server-smoke.ts 中验证可行）。

**正式 dev 启动命令（upstream examples/node 的 `package.json` 定义）：**
```
npx tsx --env-file=.env src/index.ts
```
（等同于 `pnpm dev`；默认端口 4020，用 `PORT=8403` 覆盖）

## 网关对接

网关设置 `FACILITATOR_URL=http://127.0.0.1:8403/facilitator`。
- `/facilitator/verify` 即时（无需 gas，只做签名验证 + nonce 重放检查）
- `/facilitator/settle` 需要 `EVM_PRIVATE_KEY` 对应钱包有 Base Sepolia ETH（支付 gas）

批量由网关侧 SettlementQueue 驱动（每 N=10 笔或 60s 触发）。

## 端点（网关消费的契约）

路由注册位于 `src/index.ts` 第 70-72 行，通过 `app.route("/facilitator", ...)` 挂载：

- `GET  /facilitator/supported`
  -> `{ "kinds": [{ "x402Version": 2, "scheme": "exact", "network": "eip155:84532" }], "extensions": [], "signers": { "eip155:*": ["<settler_address>"] } }`

- `POST /facilitator/verify`
  body: `{ "paymentPayload": {...}, "paymentRequirements": {...} }`
  -> `{ "isValid": bool, "invalidReason"?: string, "payer"?: string }`

- `POST /facilitator/settle`
  body: `{ "paymentPayload": {...}, "paymentRequirements": {...} }`
  -> `{ "success": bool, "transaction"?: string, "network": string, "payer"?: string }`

**与草案的实际差异（SOURCE + LIVE 双重确认）：**
- 草案 `SETTLER_PRIVATE_KEY` → 实际为 `EVM_PRIVATE_KEY`
- 草案 `SUPPORTED_NETWORK=base-sepolia` → 实际无此变量；网络在代码中为 CAIP-2 格式 `"eip155:84532"`
- 草案 `x402Version: 1` → 实际响应为 `x402Version: 2`（live 确认）
- 草案默认端口 `8403` → upstream 默认 `4020`；TrumanTown 用 `PORT=8403` 覆盖
- 路由前缀为 `/facilitator/`（非裸 `/`）

## 边界

- `/settle` 上链端到端集成 = 计划 5（需 funded settler + Base Sepolia ETH）
- 本服务不定价；定价在网关（按 costPerThink）
- nonce 防重放：`/verify` 检查 nonce 是否已用；`/settle` 成功后写入 nonce store
- 默认使用内存 nonce store（单实例）；分布式部署可换 Cloudflare KV store
