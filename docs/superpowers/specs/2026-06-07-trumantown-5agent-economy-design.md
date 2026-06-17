# 楚门镇 TrumanTown · 5 居民经济扩展设计稿
## 「五居民同活」—— 多 Agent 经济并行（基础设施切片）

> 上承 SP1-SP4。本切片不新增功能，只把「单居民经济」扩展到「5 居民并行经济」。
> 每个居民有自己的代币、EOA、能量仪表盘，SP1-SP4 的所有功能对 5 个居民同时生效。

---

## 0. 目标

> **让 5 个 AI 居民（Lucky/Bob/Stella/Alice/Pete）同时活着，各自有链上代币和经济循环。**
> 人类可以买卖任意一个居民的币，向任意一个居民耳语，看到 5 个人头顶的双仪表盘。

---

## 1. 已确认决策

| 维度 | 决策 |
|---|---|
| 角色与 econAgentId 映射 | `world.agents[i]` → `econAgentId = i.toString()`：Lucky=0, Bob=1, Stella=2, Alice=3, Pete=4 |
| 执行器运行方式 | **一个进程管 5 个 CDP 钱包**，`AGENT_IDS=0,1,2,3,4` 环境变量控制 |
| Convex tick 发现机制 | **环境变量 `AGENT_IDS`**（逗号分隔），tick 循环每个 agentId |
| Schema 改动 | 无（`agentEconomy` 表已有 `econAgentId` 索引，直接支持多行） |
| 改动策略 | **最小改动**：不改 SP1-SP4 的已有逻辑，只扩展循环 |

---

## 2. 四个改动单元

### 单元 A：角色层 — `data/characters.ts`

取消注释 Alice 和 Pete，凑够 5 个 `Descriptions`：

```
index 0: Lucky   (f1) — econAgentId "0"
index 1: Bob     (f4) — econAgentId "1"
index 2: Stella  (f6) — econAgentId "2"
index 3: Alice   (f3) — econAgentId "3"（目前注释掉）
index 4: Pete    (f7) — econAgentId "4"（目前注释掉）
```

**改动：** 把 Alice 和 Pete 的 `Descriptions` 注释（`// {` ... `// },`）去掉。不改 `characters` 数组（sprite 配置已有 f3/f7）。

---

### 单元 B：执行器 — `services/executor/src/index.ts`

**改动：**
- 读 `AGENT_IDS`（逗号分隔，默认 `"0"`），为每个 agentId 构建 `AgentConfig`
- 每个 agent 读 `AGENT_N_EOA`、`AGENT_N_SMART_ACCOUNT`、`AGENT_N_TOKEN`
- `allowedContracts` 包含所有 5 个代币地址 + USDC
- 把所有 `AgentConfig` 注册进 `staticAgentResolver`

**`.env` 新格式：**
```
AGENT_IDS=0,1,2,3,4
AGENT_0_EOA=0x...   AGENT_0_SMART_ACCOUNT=0x...   AGENT_0_TOKEN=0x...
AGENT_1_EOA=0x...   AGENT_1_SMART_ACCOUNT=0x...   AGENT_1_TOKEN=0x...
AGENT_2_EOA=0x...   AGENT_2_SMART_ACCOUNT=0x...   AGENT_2_TOKEN=0x...
AGENT_3_EOA=0x...   AGENT_3_SMART_ACCOUNT=0x...   AGENT_3_TOKEN=0x...
AGENT_4_EOA=0x...   AGENT_4_SMART_ACCOUNT=0x...   AGENT_4_TOKEN=0x...
```

**向后兼容：** `AGENT_IDS` 不设时默认 `"0"`，读 `AGENT_0_*`，行为与现在完全一致。

---

### 单元 C：Convex 经济 tick — 多 agent 循环

**`convex/economy/constants.ts` 新增：**
```ts
export function agentIds(): string[] {
  return (process.env.AGENT_IDS ?? DEFAULT_ECON_AGENT_ID)
    .split(',').map((s) => s.trim()).filter(Boolean);
}
export function agentEoaForId(id: string): string {
  return process.env[`AGENT_${id}_EOA`] ?? '';
}
```

**`convex/economy/perception.ts` 新增：**
```ts
// 返回 world 里所有 agents（按 index 顺序）
export const getAllWorldAgents = internalQuery(...)
// 按 econAgentId 查 agentEconomy 行
export const getAgentEconomyByEconId = internalQuery(...)
```

**`convex/economy/tick.ts` 改动：**
- `runEconomicTickHandler` 改为循环 `agentIds()`
- 每个 agentId：
  - 用 `index = parseInt(econAgentId)` 取 `world.agents[index]`
  - 各自独立查 `agentEconomy`、读 balances、推进 survival state machine
  - 失败不影响其他 agent（`try/catch` 隔离）

**`convex/agent/conversation.ts` 微调：**
- `queryPromptData` 里查 `agentEconomy` 已经按 `agentId`（ai-town GameId）查，不需要改
- whisper 和 rivalry prompt 已按 `econAgentId` 查，也不需要改

---

### 单元 D：运维文档 — `docs/multi-agent-setup.md`

记录操作步骤：
1. 运行 `AGENT_IDS=0,1,2,3,4 npm run accounts` 拿到 5 套地址
2. 用 `DeployAgentToken` 或 LaunchpadFactory 为 agentId 1-4 各部署代币
3. 调 `spawnAgent(N)` 在 AgentRegistry 登记
4. 填写 `.env` 的 5 套 `AGENT_N_*` 变量
5. 重启执行器 + 在 Convex 设 `AGENT_IDS=0,1,2,3,4`

---

## 3. 关键设计点

| # | 点 | 决策 |
|---|---|---|
| 1 | **world.agents 顺序稳定性** | Descriptions 数组顺序决定 world.agents 顺序，不能随意调换 |
| 2 | **tick 失败隔离** | 每个 agent 的 tick 用独立 try/catch，一个 agent 的执行器报错不影响其他 4 个 |
| 3 | **executor balances 路由** | 执行器已有 `AgentResolver`，`/balances/:agentId` 按 agentId 路由到对应 CDP 钱包 |
| 4 | **向后兼容** | `AGENT_IDS` 不设 = 只跑 agent 0，SP1-SP4 的测试和验收不受影响 |
| 5 | **前端 PlayerDetails** | 现在硬编码 `agentId="0"`，需要改为从选中的居民读取 econAgentId（单元 E，见下） |

---

## 4. 前端微调（单元 E）

`src/components/PlayerDetails.tsx` 目前把 `agentId="0"` 硬编码传给 `WhisperPanel` 和 `RivalryPanel`。需要改为：从选中居民的 `agentEconomy` 读取其 `econAgentId`，动态传入。

这个改动很小：`PlayerDetails` 已经有 `playerId`/`agentId` props，只需查 `getAgentStatus` 拿到对应的 `econAgentId`。

---

## 5. Non-Goals

- **多个 ai-town world**：仍然只有 1 个 world，5 个 agents 都在里面
- **动态新增/删除 agent**：需要重启服务，不支持热更新
- **不同 agent 不同经济参数**：SP1 的 `COST_PER_THINK`/`STANDING_FLOOR` 对所有 agent 一样（未来可按链上 Registry 读取）
- **多执行器进程**：一个进程够，不需要拆

---

## 6. 验收标准

1. `world.agents` 有 5 个居民在地图上走动
2. `GET /agents/0`..`/agents/4` 各返回对应代币的 marketCap
3. Convex `agentEconomy` 表有 5 行，每行 status=alive
4. 前端地图上 5 个人头顶都有双仪表盘（energy + standing）
5. 点击任意居民，WhisperPanel 显示该居民对应的 `econAgentId` 和信任分
6. SP4 TWAB 耳语对任意居民生效（不只 agent 0）
