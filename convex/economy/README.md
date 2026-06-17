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

## ✅ 计划 5（已完成）

- **混合数据源**：Standing + 生命参数（marketCap/tokenBalance/costPerThink/floor/recoveryWindow/alive）从 **Ponder** 读（`ponderClient` + `resolveEconomyParams`，env/常量兜底）；**USDC 余额（eoaUsdc/smartUsdc = energy 源）仍走链读** `/balances`——pay-to-think 闸门保持链上真值、零索引器滞后。
- **死亡上链**：`status` 翻 `dead`（本周期首次）时，若 `TRUMANTOWN_KEEPER=1`，经济 tick 调执行器 `/actions/mark-dead` → 链上 `AgentRegistry.markDead(id)` → `AgentDied`。
- **gated 验收接口** `economy/e2e.ts`（`TRUMANTOWN_E2E=1` 才生效）：公开 action `tickOnce`（驱动单次 tick）/ `getStatus`（读 agentEconomy 行），供 `services/e2e/` 两条剧本确定性驱动。
- 新增模块：`ponderClient.ts`、`registry.ts`、`e2e.ts`；新增 env：`PONDER_URL`、`TRUMANTOWN_KEEPER`、`TRUMANTOWN_E2E`。
