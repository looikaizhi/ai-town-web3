# 5 居民经济扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 5 个 AI 居民（Lucky/Bob/Stella/Alice/Pete）同时拥有各自的代币、EOA、经济仪表盘。

**Architecture:** 四个独立改动：(A) `data/characters.ts` 增加 Alice+Pete；(B) Convex `economy/constants.ts` + `perception.ts` + `tick.ts` 改为循环所有 agentIds；(C) `economy/public.ts` 改为支持任意 econAgentId 查询；(D) 前端 `PlayerDetails.tsx` + 各面板 props 改为从选中居民读取 econAgentId；(E) `executor/src/index.ts` 从 .env 读取全部 5 个 agent 配置。

**Tech Stack:** TypeScript · Convex · React/wagmi · Node 24 (WSL)

**Deployed addresses (already done):**
- Agent 0 (Lucky): token=`0x65ba9bb72cf4b30b5ed2c167dd437264c7455127`, EOA=`0x3b3Ba9Ce29302941516c638B364e86C018162740`, smart=`0x9Bc388e650d855120d7723dF0Ab1e6E1135b52c9`
- Agent 1 (Bob): token=`0x6aa938d87849195b12a104ef64d53be1236679cc`, EOA=`0xfc2D6b0b766822Fbe1d3De7280dc6Af8F1c1c114`, smart=`0x5a0bfCacb46388f370F04EBCcEcB4e9cA05b6DFe`
- Agent 2 (Stella): token=`0x53d6061d26039da3cd435f831e080696f546f689`, EOA=`0x0061891f2ce6F66f4912762b7838E16468d1feb7`, smart=`0xc1FF7E743F1cF4B88FBAa8709aB4819eAFF08Da1`
- Agent 3 (Alice): token=`0xe26bc373177779f78578e57903d5decf79c15028`, EOA=`0x9198007214E61C3EBA52293a1c7B0aC3F6A5F0bf`, smart=`0x226b6f1A42b435d19801132A4d1c08832fB15533`
- Agent 4 (Pete): token=`0x693328b35922896be6dbec4613b421f7451c1d33`, EOA=`0x9807fe349F131d85139CcC97f892fD98276c410F`, smart=`0x08d8BB8f0A7C7f400079B1b3b56A97952bdf8F4C`

**Conventions:**
- 所有 shell 命令用 `wsl.exe bash -lc '...'`（Windows 宿主机）
- WSL 路径：`/mnt/d/ETH beijing/ai-town-web3`
- Convex 测试：`NODE_OPTIONS=--experimental-vm-modules npx jest <path>`
- `world.agents[i]` 对应 `econAgentId = i.toString()`

---

## File Structure

**修改：**
- `data/characters.ts` — 取消注释 Alice + Pete（单元 A）
- `convex/economy/constants.ts` — 新增 `agentIds()` 和 `agentEoaForId()` 函数（单元 B）
- `convex/economy/perception.ts` — 新增 `getAllWorldAgents` + `getAgentEconomyByEconId`（单元 B）
- `convex/economy/tick.ts` — 改为循环所有 agentIds（单元 B）
- `convex/economy/public.ts` — `getAgentStatus` 改为接受 `econAgentId` 参数（单元 C）
- `src/components/PlayerDetails.tsx` — 从选中居民读取 econAgentId 并传给面板（单元 D）
- `src/components/economy/TradePanel.tsx` — 接受 `agentId` prop（单元 D）
- `src/components/economy/WhisperPanel.tsx` — 已有 `agentId` prop ✅，无需改
- `src/components/economy/RivalryPanel.tsx` — 已有 `agentId` prop ✅，无需改
- `services/executor/src/index.ts` — 读取全部 5 个 agent 配置（单元 E）

---

## Task 1：取消注释 Alice + Pete（单元 A）

**Files:**
- Modify: `data/characters.ts`

- [ ] **Step 1: 读文件确认注释位置**

读 `data/characters.ts`，找到 Alice（约第 44–51 行）和 Pete（约第 53–57 行）的注释块（`// {` ... `// },`）。

- [ ] **Step 2: 取消注释 Alice 和 Pete**

将 `data/characters.ts` 中以下注释取消（删除每行开头的 `// `）：

Alice 块（找到并取消注释）：
```ts
  {
    name: 'Alice',
    character: 'f3',
    identity: `Alice is a famous scientist. She is smarter than everyone else and has discovered mysteries of the universe no one else can understand. As a result she often speaks in oblique riddles. She comes across as confused and forgetful.`,
    plan: 'You want to figure out how the world works.',
  },
```

Pete 块（找到并取消注释）：
```ts
  {
    name: 'Pete',
    character: 'f7',
    identity: `Pete is deeply religious and sees the hand of god or of the work of the devil everywhere. He can't have a conversation without bringing up his deep faith. Or warning others about the perils of hell.`,
    plan: 'You want to convert everyone to your religion.',
  },
```

确认 `Descriptions` 数组现在有 5 个元素，顺序为：Lucky(0), Bob(1), Stella(2), Alice(3), Pete(4)。

- [ ] **Step 3: Typecheck**

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc --noEmit 2>&1 | grep -v node_modules | head -10'
```
期望：无新增错误。

- [ ] **Step 4: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add data/characters.ts && git commit -m "feat(5agent): uncomment Alice + Pete (5 residents)"'
```

---

## Task 2：Convex economy constants 新增多 agent 支持（单元 B）

**Files:**
- Modify: `convex/economy/constants.ts`

- [ ] **Step 1: 读现有文件**

读 `convex/economy/constants.ts`（已在上方 context，无需重读）。

- [ ] **Step 2: 新增两个函数**

在 `convex/economy/constants.ts` 末尾追加：

```ts
/** 所有经济活跃的 agent ID 列表（逗号分隔，默认只有 "0"）。 */
export function agentIds(): string[] {
  return (process.env.AGENT_IDS ?? DEFAULT_ECON_AGENT_ID)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 指定 agent 的 EOA 地址（从环境变量 AGENT_N_EOA 读取）。 */
export function agentEoaForId(id: string): string {
  return process.env[`AGENT_${id}_EOA`] ?? '';
}
```

- [ ] **Step 3: 写测试**

在 `convex/economy/` 目录找有没有现有测试文件（如 `public.test.ts`）。在根目录 Jest 配置下新建 `convex/economy/constants.test.ts`：

```ts
import { agentIds, agentEoaForId } from './constants';

describe('agentIds', () => {
  it('returns ["0"] by default when AGENT_IDS not set', () => {
    const prev = process.env.AGENT_IDS;
    delete process.env.AGENT_IDS;
    expect(agentIds()).toEqual(['0']);
    process.env.AGENT_IDS = prev;
  });

  it('parses comma-separated AGENT_IDS', () => {
    process.env.AGENT_IDS = '0,1,2,3,4';
    expect(agentIds()).toEqual(['0', '1', '2', '3', '4']);
    delete process.env.AGENT_IDS;
  });

  it('trims whitespace', () => {
    process.env.AGENT_IDS = '0, 1 , 2';
    expect(agentIds()).toEqual(['0', '1', '2']);
    delete process.env.AGENT_IDS;
  });
});

describe('agentEoaForId', () => {
  it('reads AGENT_N_EOA env var', () => {
    process.env.AGENT_3_EOA = '0xABC';
    expect(agentEoaForId('3')).toBe('0xABC');
    delete process.env.AGENT_3_EOA;
  });

  it('returns empty string when not set', () => {
    delete process.env.AGENT_99_EOA;
    expect(agentEoaForId('99')).toBe('');
  });
});
```

- [ ] **Step 4: 운행测试**

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/constants 2>&1 | tail -8'
```
期望：5 个测试全部 PASS。

- [ ] **Step 5: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/economy/constants.ts convex/economy/constants.test.ts && git commit -m "feat(5agent): agentIds() + agentEoaForId() multi-agent constants"'
```

---

## Task 3：Convex perception 新增多 agent 查询（单元 B）

**Files:**
- Modify: `convex/economy/perception.ts`

- [ ] **Step 1: 读现有文件**

读 `convex/economy/perception.ts`（已在 context 中）。

- [ ] **Step 2: 追加两个新查询**

在 `convex/economy/perception.ts` 末尾追加：

```ts
/**
 * 返回默认 world 里所有 agents（按 index 顺序）。
 * 每个 agent 的 index 对应其 econAgentId（agents[0] → "0"，agents[1] → "1"，...）。
 */
export const getAllWorldAgents = internalQuery({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) return null;
    const world = await ctx.db.get(status.worldId);
    if (!world) return null;
    return {
      worldId: status.worldId,
      agents: world.agents.map((a, i) => ({
        agentId: a.id,
        econAgentId: String(i),
      })),
    };
  },
});

/**
 * 按 econAgentId（如 "1"、"2"）查 agentEconomy 行。
 * 用于多 agent tick：每个 agent 独立查自己的经济状态。
 */
export const getAgentEconomyByEconId = internalQuery({
  args: { worldId: v.id('worlds'), econAgentId: v.string() },
  handler: async (ctx, { worldId, econAgentId }) => {
    return await ctx.db
      .query('agentEconomy')
      .withIndex('econAgentId', (q) => q.eq('worldId', worldId).eq('econAgentId', econAgentId))
      .first();
  },
});
```

- [ ] **Step 3: Typecheck**

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc -p convex --noEmit && echo "clean"'
```
期望：`clean`。

- [ ] **Step 4: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/economy/perception.ts && git commit -m "feat(5agent): getAllWorldAgents + getAgentEconomyByEconId queries"'
```

---

## Task 4：Convex economy tick 改为多 agent 循环（单元 B）

**Files:**
- Modify: `convex/economy/tick.ts`

- [ ] **Step 1: 读现有文件**

读 `convex/economy/tick.ts`（已在 context 中）。

- [ ] **Step 2: 替换 runEconomicTickHandler**

将 `convex/economy/tick.ts` 的 `runEconomicTickHandler` 函数完整替换为：

```ts
export async function runEconomicTickHandler(ctx: any): Promise<void> {
  if (!economyEnabled()) return;

  const worldData = await ctx.runQuery(internal.economy.perception.getAllWorldAgents, {});
  if (!worldData) return;

  const { worldId, agents } = worldData;
  const ids = agentIds(); // e.g. ["0","1","2","3","4"]
  const executor = createExecutorClient(executorUrl());
  const purl = ponderUrl();

  for (const econAgentId of ids) {
    const agentIndex = parseInt(econAgentId, 10);
    const agentEntry = agents[agentIndex];
    if (!agentEntry) {
      console.warn(`[economy] no ai-town agent at index ${agentIndex}, skipping`);
      continue;
    }

    const eoa = agentEoaForId(econAgentId);

    try {
      // USDC balances (energy) — LIVE chain truth
      const balances = await executor.balances(econAgentId);

      // Standing + life params
      const standing = purl ? await createPonderClient(purl).agentStanding(econAgentId) : null;
      const params = resolveEconomyParams(standing, {
        costPerThink: process.env.COST_PER_THINK ?? COST_PER_THINK,
        floor: process.env.STANDING_FLOOR ?? STANDING_FLOOR,
        recoveryWindow: Number(process.env.RECOVERY_WINDOW ?? RECOVERY_WINDOW),
      });

      const standingMarketCap = standing ? params.marketCap : BigInt(balances.marketCap);
      const energy = computeEnergy(BigInt(balances.eoaUsdc), params.costPerThink);
      const dying = isDying(energy, standingMarketCap, params.floor);

      const prevRow = await ctx.runQuery(internal.economy.perception.getAgentEconomyByEconId, {
        worldId,
        econAgentId,
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
        worldId,
        agentId: agentEntry.agentId,
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
        console.log(`[economy] agent ${econAgentId} DIED`);
        if (keeperEnabled()) {
          try {
            const tx = await executor.markDead(econAgentId);
            console.log(`[economy] keeper markDead(${econAgentId}) -> ${tx}`);
          } catch (e) {
            console.error(`[economy] keeper markDead(${econAgentId}) failed`, e);
          }
        }
      }
    } catch (e) {
      // 单个 agent 失败不影响其他 agent
      console.error(`[economy] tick failed for agent ${econAgentId}`, e);
    }
  }
}
```

- [ ] **Step 3: 更新 imports**

在 `convex/economy/tick.ts` 顶部，将 `agentEoa` import 改为 `agentIds, agentEoaForId`：

```ts
import {
  COST_PER_THINK,
  STANDING_FLOOR,
  RECOVERY_WINDOW,
  DEFAULT_ECON_AGENT_ID,
  economyEnabled,
  executorUrl,
  ponderUrl,
  keeperEnabled,
  agentIds,
  agentEoaForId,
} from './constants';
```

（删除旧的 `defaultAgentId` 和 `agentEoa` imports）

- [ ] **Step 4: Typecheck**

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc -p convex --noEmit && echo "clean"'
```
期望：`clean`。

- [ ] **Step 5: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/economy/tick.ts && git commit -m "feat(5agent): economy tick loops all agentIds (isolated per-agent try/catch)"'
```

---

## Task 5：`getAgentStatus` 支持多 agent 查询（单元 C）

**Files:**
- Modify: `convex/economy/public.ts`

- [ ] **Step 1: 读现有文件**

读 `convex/economy/public.ts`（已在 context 中）。

- [ ] **Step 2: 替换 getAgentStatus**

将 `convex/economy/public.ts` 中 `getAgentStatus` 完整替换为：

```ts
/**
 * SP2+ 前端只读查询：返回指定 econAgentId 的经济快照。
 * 默认查 "0"（向后兼容 SP1 单居民）。
 * 前端传 econAgentId 以支持多居民仪表盘。
 */
export const getAgentStatus = query({
  args: { econAgentId: v.optional(v.string()) },
  handler: async (ctx, { econAgentId = '0' }): Promise<AgentStatusView | null> => {
    const econ = await ctx.db
      .query('agentEconomy')
      .filter((q) => q.eq(q.field('econAgentId'), econAgentId))
      .first();
    if (!econ) return null;
    return selectAgentStatus(econ.agentId as string, econ, RECOVERY_WINDOW);
  },
});
```

注意：需要在文件顶部 import `v` from `'convex/values'`（如果还没有）。

- [ ] **Step 3: 查找所有调用 getAgentStatus 的地方并更新**

```bash
wsl.exe bash -lc 'grep -rn "getAgentStatus" "/mnt/d/ETH beijing/ai-town-web3/src/" 2>/dev/null'
```

对每个调用处，确认是否需要传 `econAgentId`（默认 `"0"` 向后兼容，无需改现有调用）。

- [ ] **Step 4: Typecheck + Jest**

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc -p convex --noEmit && echo "clean"'
```

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy 2>&1 | tail -8'
```
期望：所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/economy/public.ts && git commit -m "feat(5agent): getAgentStatus accepts econAgentId param (default 0)"'
```

---

## Task 6：前端 PlayerDetails 动态传 econAgentId（单元 D）

**Files:**
- Modify: `src/components/PlayerDetails.tsx`
- Modify: `src/components/economy/TradePanel.tsx`

- [ ] **Step 1: 读 TradePanel.tsx 了解现有 agentId 用法**

```bash
wsl.exe bash -lc 'grep -n "agentId\|DEFAULT_AGENT_ID\|econAgentId" "/mnt/d/ETH beijing/ai-town-web3/src/components/economy/TradePanel.tsx" | head -15'
```

- [ ] **Step 2: 读 PlayerDetails.tsx 末尾的渲染部分**

读 `src/components/PlayerDetails.tsx` 第 220-260 行（已在 context，包含 `<TradePanel />`, `<WhisperPanel />`, `<RivalryPanel agentId="0" />`）。

- [ ] **Step 3: 在 PlayerDetails.tsx 里查询选中居民的 econAgentId**

在 `src/components/PlayerDetails.tsx` 里，在 `const playerDescription = ...` 那行之后加：

```tsx
  // SP5: 获取选中居民的 econAgentId（ai-town world.agents 的 index 就是 econAgentId）
  const agents = [...game.world.agents.values()];
  const selectedAgent = player ? agents.find((a) => a.playerId === player.id) : undefined;
  // world.agents 的顺序即 econAgentId（0=Lucky, 1=Bob, ...）
  const selectedEconAgentId = selectedAgent
    ? String(agents.indexOf(selectedAgent))
    : '0';
```

- [ ] **Step 4: 把 econAgentId 传给三个面板**

找到：
```tsx
      {!isMe && <TradePanel />}
      {!isMe && <WhisperPanel />}
      {!isMe && <RivalryPanel agentId="0" />}
```

替换为：
```tsx
      {!isMe && <TradePanel agentId={selectedEconAgentId} />}
      {!isMe && <WhisperPanel agentId={selectedEconAgentId} />}
      {!isMe && <RivalryPanel agentId={selectedEconAgentId} />}
```

- [ ] **Step 5: 更新 TradePanel 接受 agentId prop**

读 `src/components/economy/TradePanel.tsx`，找到函数签名（类似 `export function TradePanel() {` 或 `export function TradePanel({ agentId = DEFAULT_AGENT_ID }: ...`），确保它接受并使用 `agentId` prop。

如果 TradePanel 目前没有 `agentId` prop，在函数参数里加：
```tsx
export function TradePanel({ agentId = DEFAULT_AGENT_ID }: { agentId?: string }) {
```
并在函数内所有使用 `DEFAULT_AGENT_ID` 的地方改为 `agentId`（买卖 token 地址、合约调用等）。

- [ ] **Step 6: Typecheck**

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc --noEmit 2>&1 | grep -v node_modules | head -20'
```
期望：新增代码无新增错误。

- [ ] **Step 7: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add src/components/PlayerDetails.tsx src/components/economy/TradePanel.tsx && git commit -m "feat(5agent): PlayerDetails passes dynamic econAgentId to panels"'
```

---

## Task 7：执行器支持 5 个 agent（单元 E）

**Files:**
- Modify: `services/executor/src/index.ts`

- [ ] **Step 1: 读现有文件**

读 `services/executor/src/index.ts`（已在 context 中）。

- [ ] **Step 2: 替换 main() 函数**

将 `services/executor/src/index.ts` 的 `main()` 函数完整替换为：

```ts
async function main() {
  const usdcAddress = env('USDC_ADDRESS', '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  const agentIdList = (process.env.AGENT_IDS ?? '0').split(',').map((s) => s.trim()).filter(Boolean);

  // 构建每个 agent 的配置
  const agentConfigs: AgentConfig[] = agentIdList.map((id) => ({
    agentId: id,
    smartAccount: env(`AGENT_${id}_SMART_ACCOUNT`),
    eoa: env(`AGENT_${id}_EOA`),
    token: env(`AGENT_${id}_TOKEN`),
  }));

  // 向后兼容：如果只有 agent 0，保留旧的 AGENT_0_* 变量名（已在 .env 里）
  const primaryAgent = agentConfigs[0];

  const cdp = await buildCdpHooks({
    apiKeyId: env('CDP_API_KEY_ID'),
    apiKeySecret: env('CDP_API_KEY_SECRET'),
    walletSecret: env('CDP_WALLET_SECRET'),
    rpcUrl: env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
    agents: agentConfigs,
    usdcAddress,
  });

  const wallet = createCdpWalletProvider({
    rpcUrl: env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
    usdcAddress,
    sendSmartAccountCall: cdp.sendSmartAccountCall,
    sendSmartAccountCalls: cdp.sendSmartAccountCalls,
    faucetTo: cdp.faucetTo,
    sendEoaTransfer: cdp.sendEoaTransfer,
  });

  const signer = createX402Signer({ accountFor: cdp.eoaAccountFor });

  // allowedContracts: 所有 agent 代币 + USDC
  const allTokens = agentConfigs.map((a) => a.token);
  const guardrails = {
    maxUsdcPerTx: BigInt(env('MAX_USDC_PER_TX', '5000000')),
    allowedContracts: [...allTokens, usdcAddress],
  };

  // AgentResolver：静态 map（所有 agent）
  const configMap: Record<string, AgentConfig> = {};
  for (const cfg of agentConfigs) configMap[cfg.agentId] = cfg;

  let resolve = staticAgentResolver(configMap, primaryAgent);
  if (process.env.EXECUTOR_USE_REGISTRY === '1') {
    const reg = createRegistryAgentResolver(
      viemRegistryAgentReader(
        env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
        env('REGISTRY_ADDRESS'),
      ),
      (id) => configMap[id]?.eoa ?? '0x',
      agentIdList,
    );
    await reg.refresh();
    reg.start(Number(process.env.REGISTRY_REFRESH_MS ?? '30000'));
    resolve = reg.resolve;
  }

  const markDead = createKeeperMarkDead({
    privateKey: process.env.KEEPER_PRIVATE_KEY,
    rpcUrl: env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
    registry: process.env.REGISTRY_ADDRESS,
  });

  const app = createExecutor({
    resolve,
    wallet,
    signer,
    guardrails,
    usdcAddress,
    markDead,
  });

  const port = Number(env('PORT', '8404'));
  console.log(`[executor] starting with agents: ${agentIdList.join(', ')}`);
  app.listen(port, () => console.log(`[executor] AgentKit/CDP on :${port}`));
}
```

- [ ] **Step 3: Typecheck**

```bash
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3/services/executor" && npx tsc --noEmit && echo "clean"'
```
期望：`clean`。

- [ ] **Step 4: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add services/executor/src/index.ts && git commit -m "feat(5agent): executor reads AGENT_IDS and builds multi-agent config"'
```

---

## Task 8：全套回归 + 验收

- [ ] **Step 1: 运行所有测试**

```bash
# Convex economy + interaction + rivalry
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy convex/interaction convex/rivalry 2>&1 | tail -8'
```
期望：全部 PASS。

```bash
# Convex typecheck
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc -p convex --noEmit && echo "convex: clean"'
```

```bash
# Executor typecheck
wsl.exe bash -lc 'source ~/.nvm/nvm.sh && nvm use 24 > /dev/null && cd "/mnt/d/ETH beijing/ai-town-web3/services/executor" && npx tsc --noEmit && echo "executor: clean"'
```

- [ ] **Step 2: 手动验收清单**

1. 重启 Convex（deploy）、执行器（`npm run dev`）
2. `GET http://localhost:8404/balances/1` → 返回 agent 1 (Bob) 的余额
3. `GET http://localhost:8404/balances/2` → 返回 agent 2 (Stella) 的余额
4. 等待 30s economic tick → Convex `agentEconomy` 表有 5 行（econAgentId: 0,1,2,3,4）
5. 前端地图：5 个居民在走动
6. 点击 Bob → `TradePanel` 显示 BOB 代币，`WhisperPanel` 显示 Bob 的信任分

- [ ] **Step 3: Commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add -A && git commit -m "docs(5agent): regression green"'
```

---

## Self-Review

**Spec coverage check：**

| 设计稿要求 | 对应 Task |
|---|---|
| characters.ts 加 Alice + Pete | Task 1 |
| `agentIds()` + `agentEoaForId()` | Task 2 |
| `getAllWorldAgents` + `getAgentEconomyByEconId` | Task 3 |
| economy tick 循环所有 agentIds | Task 4 |
| `getAgentStatus` 支持 econAgentId 参数 | Task 5 |
| PlayerDetails 动态传 econAgentId | Task 6 |
| 执行器多 agent 配置 | Task 7 |
| 回归测试 + 验收 | Task 8 |

**Placeholder 扫描：** 无 TBD/TODO，所有代码块完整。

**Type consistency check：**
- `agentIds()` 返回 `string[]`；Task 4 tick 里 `const ids = agentIds()` → `for (const econAgentId of ids)` — 一致。
- `getAllWorldAgents` 返回 `{ worldId, agents: { agentId, econAgentId }[] }`；Task 4 用 `worldData.agents[agentIndex]` — 一致。
- `getAgentEconomyByEconId` args: `{ worldId, econAgentId }`；Task 4 调用 — 一致。
- `getAgentStatus` args: `{ econAgentId?: string }`；Task 5 改后前端默认传 `"0"` — 向后兼容。
- `AgentConfig` 有 `agentId, smartAccount, eoa, token`；Task 7 用 `env(\`AGENT_${id}_*\`)` 构建 — 一致。
