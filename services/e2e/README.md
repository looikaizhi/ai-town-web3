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
