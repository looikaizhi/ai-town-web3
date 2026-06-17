# SP4「AI 居民链上博弈」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 部署 5 个 AI 居民，每个都能读链上的公开数据（彼此的市值/能量/结盟状态），并通过链上行动互相博弈——买砸对方代币、付费耳语、签订/解除结盟合约。

**Architecture:** 新合约 `AllianceRegistry`（链上结盟状态）→ Ponder 索引所有居民 + 结盟事件 + 新增 `/agents/:id/rivals` API → Convex 新增 `rivalry` 模块（门控 `TRUMANTOWN_RIVALRY=1`，仿 SP3 `interaction` 模式），包含 `rivalryCron`（感知快照）、`rivalryPrompt`（博弈感知 prompt 块）、`rivalryAction`（意图解析→派发执行器）→ 执行器新增三个博弈动作端点（`buyRival`/`whisperRival`/`proposeAlliance`）→ 前端多居民 UI（复用 SP2 仪表盘组件 + 新增结盟连线 + 博弈排行面板）。

**Tech Stack:** Solidity 0.8.26 + Foundry + OpenZeppelin · Ponder 0.11 (TS) · Convex (TS, root Jest) · viem + wagmi (前端) · Circle USDC Base Sepolia · SP1 AgentKit CDP 钱包 · SP3 InteractionHub。

**Spec:** 本计划由 SP4 设计稿（见 CLAUDE.md 同目录）驱动。

**Conventions verified against the codebase:**
- 所有 shell 命令通过 `wsl.exe bash -lc '...'` 运行（Windows 宿主机）。
- WSL 路径：`/mnt/d/ETH beijing/ai-town-web3`。
- Convex 测试：根目录 Jest（`NODE_OPTIONS=--experimental-vm-modules npx jest <path>`）。
- 门控先例：`convex/interaction/constants.ts` `interactionEnabled()`；cron 先例：`convex/crons.ts`。
- `agentEoaName(agentId)` / `agentSmartName(agentId)` 在 `services/executor/src/cdpClient.ts` 里定义（命名规则：`trumantown-agent-{id}-eoa`）。
- Ponder onchainTable 先例：`services/indexer/ponder.schema.ts`。
- 执行器 action 先例：`services/executor/src/actions.ts` + `executor.ts`。

---

## File Structure

**新建：**
- `contracts/src/AllianceRegistry.sol` — 结盟合约（unit B）
- `contracts/test/AllianceRegistry.t.sol` — forge 测试（unit B）
- `contracts/script/DeployAllianceRegistry.s.sol` — 部署脚本（unit B）
- `convex/rivalry/constants.ts` — `rivalryEnabled()` + 调参（unit D）
- `convex/rivalry/schema.ts` — `rivalryState` + `rivalryCursor` 表定义（unit D）
- `convex/rivalry/rivals.ts` — internal queries/mutations（unit D）
- `convex/rivalry/prompt.ts` — `rivalryPrompt(agentId, snapshot)` 纯函数（unit D）
- `convex/rivalry/prompt.test.ts` — Jest 测试（unit D）
- `convex/rivalry/tick.ts` — 门控 cron action：轮询 Ponder → 写快照（unit D）
- `convex/rivalry/intent.ts` — 纯函数：从对话文本解析博弈意图（unit D）
- `convex/rivalry/intent.test.ts` — Jest 测试（unit D）
- `services/indexer/abis/AllianceRegistry.ts` — ABI（unit C）
- `services/executor/src/rivalActions.ts` — `buyRivalAction` / `whisperRivalAction` / `proposeAllianceAction` / `acceptAllianceAction` / `dissolveAllianceAction`（unit E）
- `services/executor/src/rivalActions.test.ts` — vitest 测试（unit E）
- `docs/SP4-acceptance-checklist.md` — 手动验收清单（unit G）

**修改：**
- `services/indexer/ponder.schema.ts` — 新增 `alliance` 表（unit C）
- `services/indexer/ponder.config.ts` — 注册 `AllianceRegistry` 合约（unit C）
- `services/indexer/abis/index.ts`（若存在）或直接在 config 引入（unit C）
- `services/indexer/src/index.ts` — `AllianceProposed/Formed/Dissolved` 处理器（unit C）
- `services/indexer/src/api/index.ts` — `GET /agents/:id/rivals` 路由（unit C）
- `services/indexer/.env.local` + `.env.example` — `ALLIANCE_REGISTRY_ADDRESS`（unit C）
- `convex/schema.ts` — 注册 `rivalryTables`（unit D）
- `convex/crons.ts` — 注册 `rivalry tick`（unit D）
- `convex/agent/conversation.ts` — `queryPromptData` 增加 `rivalVoices`；三段 builder 插入 `rivalryPrompt`（unit D）
- `services/executor/src/executor.ts` — 注册三个新路由（unit E）
- `services/executor/src/guardrails.ts` — `isAllowedContract` 扩展支持 AllianceRegistry（unit E）
- `src/components/PlayerDetails.tsx` — 多居民切换（unit F）
- `src/components/economy/RivalryPanel.tsx`（新建） — 排行榜 + 结盟连线面板（unit F）

---

## Task 1：`AllianceRegistry.sol` 合约（unit B）

**Files:**
- Create: `contracts/src/AllianceRegistry.sol`
- Create: `contracts/test/AllianceRegistry.t.sol`

- [ ] **Step 1: 先写失败的测试**

新建 `contracts/test/AllianceRegistry.t.sol`：

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AllianceRegistry} from "../src/AllianceRegistry.sol";

contract AllianceRegistryTest is Test {
    AllianceRegistry reg;
    // 模拟 5 个居民的 EOA
    address eoa0 = address(0xA0);
    address eoa1 = address(0xA1);
    address eoa2 = address(0xA2);
    address owner = address(this);

    function setUp() public {
        reg = new AllianceRegistry();
        reg.setEoa(0, eoa0);
        reg.setEoa(1, eoa1);
        reg.setEoa(2, eoa2);
    }

    function test_propose_andEmits() public {
        vm.expectEmit(true, true, false, true);
        emit AllianceRegistry.AllianceProposed(0, 1, "lets team up");
        vm.prank(eoa0);
        reg.propose(0, 1, "lets team up");
        assertFalse(reg.allied(0, 1)); // 仅提案，未结盟
    }

    function test_accept_formsAlliance() public {
        vm.prank(eoa0);
        reg.propose(0, 1, "lets team up");
        vm.expectEmit(true, true, false, false);
        emit AllianceRegistry.AllianceFormed(0, 1);
        vm.prank(eoa1);
        reg.accept(0, 1);
        assertTrue(reg.allied(0, 1));
        assertTrue(reg.allied(1, 0)); // 对称
    }

    function test_dissolve_byEitherParty() public {
        vm.prank(eoa0); reg.propose(0, 1, "x");
        vm.prank(eoa1); reg.accept(0, 1);
        vm.expectEmit(true, true, false, false);
        emit AllianceRegistry.AllianceDissolved(0, 1);
        vm.prank(eoa0);
        reg.dissolve(0, 1);
        assertFalse(reg.allied(0, 1));
    }

    function test_propose_revertsIfNotEoa() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(bytes("not agent eoa"));
        reg.propose(0, 1, "x");
    }

    function test_accept_revertsIfNoPending() public {
        vm.prank(eoa1);
        vm.expectRevert(bytes("no pending proposal"));
        reg.accept(0, 1);
    }

    function test_setEoa_onlyOwner() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        reg.setEoa(0, address(0xDEAD));
    }

    function test_dissolve_revertsIfNotAllied() public {
        vm.prank(eoa0);
        vm.expectRevert(bytes("not allied"));
        reg.dissolve(0, 1);
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe bash -lc 'export PATH="$HOME/.foundry/bin:$PATH" && cd "/mnt/d/ETH beijing/ai-town-web3/contracts" && forge test --match-contract AllianceRegistryTest'
```
期望：编译错误（`AllianceRegistry.sol` 不存在）。

- [ ] **Step 3: 写最小实现**

新建 `contracts/src/AllianceRegistry.sol`：

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice 居民间链上结盟状态：提案 → 接受 → 结盟；单方可解除。
contract AllianceRegistry is Ownable {
    // agentId => EOA 地址（由 owner 在部署后注册，每个居民一个）
    mapping(uint256 => address) public agentEoa;

    // 有序对 (min, max) → 是否结盟
    mapping(bytes32 => bool) private _allied;
    // 有序对 (a, b) → 是否有 a→b 的待定提案（a 先提案，b 还未接受）
    mapping(bytes32 => bool) private _pending;

    event AllianceProposed(uint256 indexed agentA, uint256 indexed agentB, string message);
    event AllianceFormed(uint256 indexed agentA, uint256 indexed agentB);
    event AllianceDissolved(uint256 indexed agentA, uint256 indexed agentB);

    constructor() Ownable(msg.sender) {}

    function setEoa(uint256 agentId, address eoa) external onlyOwner {
        require(eoa != address(0), "zero eoa");
        agentEoa[agentId] = eoa;
    }

    function propose(uint256 agentA, uint256 agentB, string calldata message) external {
        require(msg.sender == agentEoa[agentA], "not agent eoa");
        require(agentEoa[agentA] != address(0) && agentEoa[agentB] != address(0), "unknown agent");
        require(!allied(agentA, agentB), "already allied");
        _pending[_pendingKey(agentA, agentB)] = true;
        emit AllianceProposed(agentA, agentB, message);
    }

    function accept(uint256 agentA, uint256 agentB) external {
        require(msg.sender == agentEoa[agentB], "not agent eoa");
        require(_pending[_pendingKey(agentA, agentB)], "no pending proposal");
        _pending[_pendingKey(agentA, agentB)] = false;
        _allied[_allianceKey(agentA, agentB)] = true;
        emit AllianceFormed(agentA, agentB);
    }

    function dissolve(uint256 agentA, uint256 agentB) external {
        address sender = msg.sender;
        require(
            sender == agentEoa[agentA] || sender == agentEoa[agentB],
            "not agent eoa"
        );
        require(allied(agentA, agentB), "not allied");
        _allied[_allianceKey(agentA, agentB)] = false;
        emit AllianceDissolved(agentA, agentB);
    }

    function allied(uint256 a, uint256 b) public view returns (bool) {
        return _allied[_allianceKey(a, b)];
    }

    function hasPendingProposal(uint256 agentA, uint256 agentB) external view returns (bool) {
        return _pending[_pendingKey(agentA, agentB)];
    }

    // 内部：对称键（顺序无关）
    function _allianceKey(uint256 a, uint256 b) private pure returns (bytes32) {
        (uint256 lo, uint256 hi) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(lo, hi));
    }

    // 内部：有序键（a 是提案方）
    function _pendingKey(uint256 a, uint256 b) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("pending", a, b));
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
wsl.exe bash -lc 'export PATH="$HOME/.foundry/bin:$PATH" && cd "/mnt/d/ETH beijing/ai-town-web3/contracts" && forge test --match-contract AllianceRegistryTest -vv'
```
期望：7 个测试全部 PASS。

- [ ] **Step 5: forge fmt + commit**

```bash
wsl.exe bash -lc 'export PATH="$HOME/.foundry/bin:$PATH" && cd "/mnt/d/ETH beijing/ai-town-web3/contracts" && forge fmt && cd /mnt/d/ETH\ beijing/ai-town-web3 && git add contracts/src/AllianceRegistry.sol contracts/test/AllianceRegistry.t.sol && git commit -m "feat(sp4): AllianceRegistry propose/accept/dissolve contract"'
```

---

## Task 2：`DeployAllianceRegistry` 部署脚本（unit B）

**Files:**
- Create: `contracts/script/DeployAllianceRegistry.s.sol`

- [ ] **Step 1: 写部署脚本**

新建 `contracts/script/DeployAllianceRegistry.s.sol`：

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {AllianceRegistry} from "../src/AllianceRegistry.sol";

/// @notice 部署 AllianceRegistry 并注册 N 个居民的 EOA。
/// env: DEPLOYER_PRIVATE_KEY, AGENT_0_EOA..AGENT_4_EOA（可选，逐个 setEoa）。
contract DeployAllianceRegistry is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        AllianceRegistry reg = new AllianceRegistry();
        console2.log("AllianceRegistry:", address(reg));

        // 为每个居民注册 EOA（环境变量存在才设置）
        for (uint256 i = 0; i < 5; i++) {
            string memory key = string(abi.encodePacked("AGENT_", vm.toString(i), "_EOA"));
            address eoa = vm.envOr(key, address(0));
            if (eoa != address(0)) {
                reg.setEoa(i, eoa);
                console2.log("  setEoa", i, eoa);
            }
        }
        vm.stopBroadcast();
    }
}
```

- [ ] **Step 2: 编译检查**

```bash
wsl.exe bash -lc 'export PATH="$HOME/.foundry/bin:$PATH" && cd "/mnt/d/ETH beijing/ai-town-web3/contracts" && forge build'
```
期望：`Compiler run successful`。

- [ ] **Step 3: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add contracts/script/DeployAllianceRegistry.s.sol && git commit -m "feat(sp4): AllianceRegistry deploy script"'
```

---

## Task 3：多居民账户脚本（unit A）

**Files:**
- Modify: `services/executor/src/bootstrapAccounts.ts`（改为支持 `AGENT_IDS=0,1,2,3,4`）

- [ ] **Step 1: 读当前文件**

读 `services/executor/src/bootstrapAccounts.ts`（已读，见上方 context）。

- [ ] **Step 2: 修改为批量模式**

将 `bootstrapAccounts.ts` 的 `main()` 改为遍历 `AGENT_IDS`（逗号分隔，默认 `"0"`）：

```ts
async function main() {
  const agentIds = (process.env.AGENT_IDS ?? process.env.AGENT_ID ?? '0').split(',').map(s => s.trim());

  const cdp = new CdpClient({
    apiKeyId: env('CDP_API_KEY_ID'),
    apiKeySecret: env('CDP_API_KEY_SECRET'),
    walletSecret: env('CDP_WALLET_SECRET'),
  });

  for (const agentId of agentIds) {
    const eoa = await cdp.evm.getOrCreateAccount({ name: agentEoaName(agentId) });
    const smartAccount = await cdp.evm.getOrCreateSmartAccount({
      name: agentSmartName(agentId),
      owner: eoa as never,
    });
    const eoaAddress = (eoa as { address: string }).address;
    const smartAddress = (smartAccount as { address: string }).address;
    console.log(`\n[accounts] resident ${agentId}:`);
    console.log(`  EOA=${eoaAddress}`);
    console.log(`  Smart=${smartAddress}`);
    console.log(`AGENT_${agentId}_EOA=${eoaAddress}`);
    console.log(`AGENT_${agentId}_SMART_ACCOUNT=${smartAddress}`);
  }
}
```

- [ ] **Step 3: 编译检查**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3/services/executor" && npx tsc --noEmit'
```
期望：clean。

- [ ] **Step 4: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add services/executor/src/bootstrapAccounts.ts && git commit -m "feat(sp4): bootstrapAccounts supports AGENT_IDS=0,1,2,3,4 batch"'
```

---

## Task 4：Ponder 索引结盟事件 + `/agents/:id/rivals` API（unit C）

**Files:**
- Create: `services/indexer/abis/AllianceRegistry.ts`
- Modify: `services/indexer/ponder.schema.ts`
- Modify: `services/indexer/ponder.config.ts`
- Modify: `services/indexer/src/index.ts`
- Modify: `services/indexer/src/api/index.ts`
- Modify: `services/indexer/.env.local` + `.env.example`

- [ ] **Step 1: 新建 ABI 文件**

新建 `services/indexer/abis/AllianceRegistry.ts`：

```ts
export const AllianceRegistryAbi = [
  {
    type: 'event',
    name: 'AllianceProposed',
    inputs: [
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
      { name: 'message', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AllianceFormed',
    inputs: [
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AllianceDissolved',
    inputs: [
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
    ],
  },
] as const;
```

- [ ] **Step 2: 在 ponder.schema.ts 追加 `alliance` 表**

在 `services/indexer/ponder.schema.ts` 末尾追加：

```ts
// SP4: 结盟事件日志（append-only）
export const alliance = onchainTable('alliance', (t) => ({
  id: t.text().primaryKey(),       // `${txHash}-${logIndex}`
  agentA: t.text().notNull(),
  agentB: t.text().notNull(),
  eventType: t.text().notNull(),   // 'proposed' | 'formed' | 'dissolved'
  message: t.text(),               // proposed 时有值，其他为 null
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));
```

- [ ] **Step 3: 在 ponder.config.ts 注册合约**

读 `services/indexer/ponder.config.ts`，在 `contracts` 对象里追加（仿 SP3 InteractionHub 模式）：

```ts
import { AllianceRegistryAbi } from './abis/AllianceRegistry';
// ...inside contracts: { ... }
    AllianceRegistry: {
      chain: 'baseSepolia',
      abi: AllianceRegistryAbi,
      address: (process.env.ALLIANCE_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      startBlock,
    },
```

- [ ] **Step 4: 在 src/index.ts 新增三个事件处理器**

在 `services/indexer/src/index.ts` 导入 `alliance`（加入现有 schema import），追加：

```ts
ponder.on('AllianceRegistry:AllianceProposed', async ({ event, context }) => {
  await context.db.insert(alliance).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    agentA: event.args.agentA.toString(),
    agentB: event.args.agentB.toString(),
    eventType: 'proposed',
    message: event.args.message as string,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  }).onConflictDoNothing();
});

ponder.on('AllianceRegistry:AllianceFormed', async ({ event, context }) => {
  await context.db.insert(alliance).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    agentA: event.args.agentA.toString(),
    agentB: event.args.agentB.toString(),
    eventType: 'formed',
    message: null,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  }).onConflictDoNothing();
});

ponder.on('AllianceRegistry:AllianceDissolved', async ({ event, context }) => {
  await context.db.insert(alliance).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    agentA: event.args.agentA.toString(),
    agentB: event.args.agentB.toString(),
    eventType: 'dissolved',
    message: null,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  }).onConflictDoNothing();
});
```

- [ ] **Step 5: 在 src/api/index.ts 新增 `/agents/:id/rivals` 路由**

在 `services/indexer/src/api/index.ts` 追加（`alliance` 加入 schema import，`or` 加入 ponder imports）：

```ts
// SP4: 博弈感知快照 — 返回其他所有居民的最新状态 + 与当前居民的结盟关系
app.get('/agents/:id/rivals', async (c) => {
  const id = c.req.param('id');

  // 所有居民
  const allAgents = (await db.select().from(agent)) as AgentRow[];

  // 当前居民的结盟关系（从结盟日志里推导当前状态）
  // 取所有涉及当前居民的事件，按时间降序取每对最新状态
  const allianceRows = await db
    .select()
    .from(alliance)
    .where(or(eq(alliance.agentA, id), eq(alliance.agentB, id)))
    .orderBy(desc(alliance.timestamp));

  // 对每个对手计算当前是否结盟（最新事件为 'formed' = 结盟）
  const allianceByPeer: Record<string, boolean> = {};
  for (const row of allianceRows) {
    const peer = row.agentA === id ? row.agentB : row.agentA;
    if (allianceByPeer[peer] === undefined) {
      allianceByPeer[peer] = row.eventType === 'formed';
    }
  }

  const rivals = allAgents
    .filter((a) => a.id !== id)
    .map((a) => ({
      agentId: a.id,
      marketCap: a.marketCap.toString(),
      pricePerToken: a.pricePerToken.toString(),
      alive: a.alive,
      allied: allianceByPeer[a.id] ?? false,
    }));

  return c.json(rivals);
});
```

需要在 ponder imports 里加 `or`：`import { eq, gte, and, desc, or } from 'ponder';`

- [ ] **Step 6: 环境变量**

在 `services/indexer/.env.local` 新增（不 git add）：
```
ALLIANCE_REGISTRY_ADDRESS=0x0000000000000000000000000000000000000000
```

在 `services/indexer/.env.example` 新增：
```
ALLIANCE_REGISTRY_ADDRESS=0x...   # DeployAllianceRegistry 输出
```

- [ ] **Step 7: typecheck**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3/services/indexer" && npm run typecheck'
```
期望：clean。

- [ ] **Step 8: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add services/indexer/abis/AllianceRegistry.ts services/indexer/ponder.schema.ts services/indexer/ponder.config.ts services/indexer/src/index.ts services/indexer/src/api/index.ts services/indexer/.env.example && git commit -m "feat(sp4): index alliance events + /agents/:id/rivals read API"'
```

---

## Task 5：Convex 博弈模块 — constants + schema + rivals.ts（unit D）

**Files:**
- Create: `convex/rivalry/constants.ts`
- Create: `convex/rivalry/schema.ts`
- Create: `convex/rivalry/rivals.ts`
- Modify: `convex/schema.ts`

- [ ] **Step 1: 新建 constants.ts**

新建 `convex/rivalry/constants.ts`：

```ts
export const RIVALRY_TICK_SECONDS = 30;
export const RIVALRY_TOP_K = 3; // rivalryPrompt 展示的最大对手数

export function rivalryEnabled(): boolean {
  return process.env.TRUMANTOWN_RIVALRY === '1';
}

export function ponderUrl(): string | undefined {
  return process.env.PONDER_URL;
}
```

- [ ] **Step 2: 新建 schema.ts**

新建 `convex/rivalry/schema.ts`：

```ts
import { v } from 'convex/values';
import { defineTable } from 'convex/server';

export const rivalryTables = {
  // 每个 onchainAgentId 的最新感知快照（Ponder /agents/:id/rivals 的 Convex 镜像）
  rivalryState: defineTable({
    onchainAgentId: v.string(),    // 被感知的居民（当前居民视角）
    rivalAgentId: v.string(),
    marketCap: v.string(),          // atomic USDC string
    alive: v.boolean(),
    allied: v.boolean(),
    updatedAt: v.number(),          // ms epoch
  })
    .index('agent_rival', ['onchainAgentId', 'rivalAgentId']),

  // 每个 onchainAgentId 的感知轮次游标（上次成功拉取的 ms epoch）
  rivalryCursor: defineTable({
    onchainAgentId: v.string(),
    lastUpdatedAt: v.number(),
  }).index('agent', ['onchainAgentId']),
};
```

- [ ] **Step 3: 在 convex/schema.ts 注册**

读 `convex/schema.ts`，在 `defineSchema({ ... })` 里追加 `...rivalryTables,`，同时在顶部加 import：
```ts
import { rivalryTables } from './rivalry/schema';
```

- [ ] **Step 4: 新建 rivals.ts（internal queries/mutations）**

新建 `convex/rivalry/rivals.ts`：

```ts
import { v } from 'convex/values';
import { internalQuery, internalMutation } from '../_generated/server';

export const upsertRivalState = internalMutation({
  args: {
    onchainAgentId: v.string(),
    rivalAgentId: v.string(),
    marketCap: v.string(),
    alive: v.boolean(),
    allied: v.boolean(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('rivalryState')
      .withIndex('agent_rival', (q) =>
        q.eq('onchainAgentId', args.onchainAgentId).eq('rivalAgentId', args.rivalAgentId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        marketCap: args.marketCap,
        alive: args.alive,
        allied: args.allied,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert('rivalryState', args);
    }
  },
});

export const getRivalSnapshot = internalQuery({
  args: { onchainAgentId: v.string() },
  handler: async (ctx, { onchainAgentId }) => {
    return await ctx.db
      .query('rivalryState')
      .withIndex('agent_rival', (q) => q.eq('onchainAgentId', onchainAgentId))
      .collect();
  },
});

export const getCursor = internalQuery({
  args: { onchainAgentId: v.string() },
  handler: async (ctx, { onchainAgentId }) => {
    const row = await ctx.db
      .query('rivalryCursor')
      .withIndex('agent', (q) => q.eq('onchainAgentId', onchainAgentId))
      .first();
    return row?.lastUpdatedAt ?? 0;
  },
});

export const setCursor = internalMutation({
  args: { onchainAgentId: v.string(), lastUpdatedAt: v.number() },
  handler: async (ctx, { onchainAgentId, lastUpdatedAt }) => {
    const row = await ctx.db
      .query('rivalryCursor')
      .withIndex('agent', (q) => q.eq('onchainAgentId', onchainAgentId))
      .first();
    if (row) await ctx.db.patch(row._id, { lastUpdatedAt });
    else await ctx.db.insert('rivalryCursor', { onchainAgentId, lastUpdatedAt });
  },
});
```

- [ ] **Step 5: typecheck**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc -p convex --noEmit'
```
期望：clean。

- [ ] **Step 6: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/rivalry/constants.ts convex/rivalry/schema.ts convex/rivalry/rivals.ts convex/schema.ts && git commit -m "feat(sp4): rivalry constants + tables + rivals seam (gated)"'
```

---

## Task 6：`rivalryPrompt` 纯函数（unit D）

**Files:**
- Create: `convex/rivalry/prompt.ts`
- Create: `convex/rivalry/prompt.test.ts`

- [ ] **Step 1: 先写失败的测试**

新建 `convex/rivalry/prompt.test.ts`：

```ts
import { rivalryPrompt, type RivalSnapshot } from './prompt';

const snap = (id: string, marketCap: string, alive: boolean, allied: boolean): RivalSnapshot =>
  ({ rivalAgentId: id, marketCap, alive, allied });

describe('rivalryPrompt', () => {
  it('returns [] for empty snapshot', () => {
    expect(rivalryPrompt('0', [])).toEqual([]);
  });

  it('includes market cap and alive status', () => {
    const lines = rivalryPrompt('0', [snap('1', '1000000', true, false)]);
    const text = lines.join('\n');
    expect(text).toContain('resident 1');
    expect(text).toMatch(/market cap|standing/i);
  });

  it('labels allies correctly', () => {
    const lines = rivalryPrompt('0', [snap('2', '500000', true, true)]);
    expect(lines.join('\n')).toMatch(/ally|allied/i);
  });

  it('marks dead rivals', () => {
    const lines = rivalryPrompt('0', [snap('3', '0', false, false)]);
    expect(lines.join('\n')).toMatch(/dead|died/i);
  });

  it('only shows top 3 rivals sorted by market cap', () => {
    const snaps = [
      snap('1', '100', true, false),
      snap('2', '900', true, false),
      snap('3', '500', true, false),
      snap('4', '200', true, false),
    ];
    const lines = rivalryPrompt('0', snaps);
    const text = lines.join('\n');
    // 最高市值排第一
    expect(text.indexOf('resident 2')).toBeLessThan(text.indexOf('resident 3'));
    // 只取 top 3（4 个里排名最低的 resident 1 可能被截掉）
    expect(lines.length).toBeLessThanOrEqual(5); // 1 header + 3 rivals + 1 footer at most
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/rivalry/prompt'
```
期望：FAIL — `prompt.ts` 不存在。

- [ ] **Step 3: 实现**

新建 `convex/rivalry/prompt.ts`：

```ts
import { RIVALRY_TOP_K } from './constants';

export interface RivalSnapshot {
  rivalAgentId: string;
  marketCap: string; // atomic USDC string
  alive: boolean;
  allied: boolean;
}

/**
 * 博弈感知 prompt 块：告诉居民其他居民的链上状态。
 * 按市值降序取 top-K，区分盟友/敌人/已死亡。
 * 返回 string[]，与 survivalPrompt/whispersPrompt 形状一致。
 */
export function rivalryPrompt(selfAgentId: string, snapshot: RivalSnapshot[]): string[] {
  if (snapshot.length === 0) return [];

  const sorted = [...snapshot]
    .sort((a, b) => Number(BigInt(b.marketCap) - BigInt(a.marketCap)))
    .slice(0, RIVALRY_TOP_K);

  const lines: string[] = [
    `Here is the current state of the other residents in town (ranked by their standing/market cap):`,
  ];

  for (const r of sorted) {
    const status = !r.alive
      ? 'DEAD'
      : r.allied
      ? 'your ALLY'
      : 'rival';
    const mc = (Number(r.marketCap) / 1e6).toFixed(2);
    lines.push(` - resident ${r.rivalAgentId}: standing=${mc} USDC, status=${status}`);
  }

  lines.push(
    `You may choose to buy a rival's token (to support an ally or signal dominance), ` +
    `whisper to them (to influence or propose alliance), or propose/accept/dissolve an alliance. ` +
    `These are your own decisions — act in your interest.`,
  );

  return lines;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/rivalry/prompt'
```
期望：5 个测试全部 PASS。

- [ ] **Step 5: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/rivalry/prompt.ts convex/rivalry/prompt.test.ts && git commit -m "feat(sp4): rivalryPrompt pure fn (market cap ranked, ally/dead labels)"'
```

---

## Task 7：意图解析纯函数（unit D）

**Files:**
- Create: `convex/rivalry/intent.ts`
- Create: `convex/rivalry/intent.test.ts`

- [ ] **Step 1: 先写失败的测试**

新建 `convex/rivalry/intent.test.ts`：

```ts
import { parseRivalryIntent, type RivalryIntent } from './intent';

describe('parseRivalryIntent', () => {
  it('returns null for ordinary conversation with no action markers', () => {
    expect(parseRivalryIntent('Hello, nice day today!')).toBeNull();
  });

  it('parses BUY_RIVAL intent', () => {
    const result = parseRivalryIntent('<rivalry:BUY_RIVAL targetId="2" usdcAmount="50000"/>');
    expect(result).toEqual({ type: 'BUY_RIVAL', targetId: '2', usdcAmount: '50000' });
  });

  it('parses WHISPER_RIVAL intent', () => {
    const result = parseRivalryIntent('<rivalry:WHISPER_RIVAL targetId="3" amount="10000" text="let us ally"/>');
    expect(result).toEqual({ type: 'WHISPER_RIVAL', targetId: '3', amount: '10000', text: 'let us ally' });
  });

  it('parses PROPOSE_ALLIANCE intent', () => {
    const result = parseRivalryIntent('<rivalry:PROPOSE_ALLIANCE targetId="1" message="together we survive"/>');
    expect(result).toEqual({ type: 'PROPOSE_ALLIANCE', targetId: '1', message: 'together we survive' });
  });

  it('parses ACCEPT_ALLIANCE intent', () => {
    const result = parseRivalryIntent('<rivalry:ACCEPT_ALLIANCE proposerId="0"/>');
    expect(result).toEqual({ type: 'ACCEPT_ALLIANCE', proposerId: '0' });
  });

  it('parses DISSOLVE_ALLIANCE intent', () => {
    const result = parseRivalryIntent('<rivalry:DISSOLVE_ALLIANCE peerId="4"/>');
    expect(result).toEqual({ type: 'DISSOLVE_ALLIANCE', peerId: '4' });
  });

  it('ignores malformed markers', () => {
    expect(parseRivalryIntent('<rivalry:BUY_RIVAL/>')).toBeNull(); // 缺 targetId
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/rivalry/intent'
```
期望：FAIL。

- [ ] **Step 3: 实现**

新建 `convex/rivalry/intent.ts`：

```ts
export type RivalryIntent =
  | { type: 'BUY_RIVAL'; targetId: string; usdcAmount: string }
  | { type: 'WHISPER_RIVAL'; targetId: string; amount: string; text: string }
  | { type: 'PROPOSE_ALLIANCE'; targetId: string; message: string }
  | { type: 'ACCEPT_ALLIANCE'; proposerId: string }
  | { type: 'DISSOLVE_ALLIANCE'; peerId: string };

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]+)"`));
  return m ? m[1] : null;
}

/**
 * 从 LLM 对话文本里提取博弈行动意图标记。
 * 标记格式：<rivalry:ACTION_TYPE attr1="v1" attr2="v2"/>
 * 返回 null 表示对话里没有行动意图（普通对话）。
 */
export function parseRivalryIntent(text: string): RivalryIntent | null {
  const m = text.match(/<rivalry:([A-Z_]+)([^/]*)\/?>/);
  if (!m) return null;
  const [, actionType, attrStr] = m;

  switch (actionType) {
    case 'BUY_RIVAL': {
      const targetId = attr(attrStr, 'targetId');
      const usdcAmount = attr(attrStr, 'usdcAmount');
      if (!targetId || !usdcAmount) return null;
      return { type: 'BUY_RIVAL', targetId, usdcAmount };
    }
    case 'WHISPER_RIVAL': {
      const targetId = attr(attrStr, 'targetId');
      const amount = attr(attrStr, 'amount');
      const text = attr(attrStr, 'text');
      if (!targetId || !amount || !text) return null;
      return { type: 'WHISPER_RIVAL', targetId, amount, text };
    }
    case 'PROPOSE_ALLIANCE': {
      const targetId = attr(attrStr, 'targetId');
      const message = attr(attrStr, 'message');
      if (!targetId || !message) return null;
      return { type: 'PROPOSE_ALLIANCE', targetId, message };
    }
    case 'ACCEPT_ALLIANCE': {
      const proposerId = attr(attrStr, 'proposerId');
      if (!proposerId) return null;
      return { type: 'ACCEPT_ALLIANCE', proposerId };
    }
    case 'DISSOLVE_ALLIANCE': {
      const peerId = attr(attrStr, 'peerId');
      if (!peerId) return null;
      return { type: 'DISSOLVE_ALLIANCE', peerId };
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/rivalry/intent'
```
期望：7 个测试全部 PASS。

- [ ] **Step 5: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/rivalry/intent.ts convex/rivalry/intent.test.ts && git commit -m "feat(sp4): parseRivalryIntent pure fn (XML marker extraction)"'
```

---

## Task 8：博弈感知 cron + conversation 接线（unit D）

**Files:**
- Create: `convex/rivalry/tick.ts`
- Modify: `convex/crons.ts`
- Modify: `convex/agent/conversation.ts`

- [ ] **Step 1: 新建 tick.ts**

新建 `convex/rivalry/tick.ts`：

```ts
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { rivalryEnabled, ponderUrl } from './constants';

type PonderRival = {
  agentId: string;
  marketCap: string;
  pricePerToken: string;
  alive: boolean;
  allied: boolean;
};

export const runRivalryTick = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!rivalryEnabled()) return;
    const purl = ponderUrl();
    if (!purl) return;

    // 读取所有居民的 agentEconomy（仿 economic tick 的模式找所有 econAgentId）
    const allAgentIds: string[] = [];
    for (let i = 0; i < 5; i++) allAgentIds.push(String(i));

    for (const agentId of allAgentIds) {
      let rivals: PonderRival[] = [];
      try {
        const r = await fetch(`${purl}/agents/${agentId}/rivals`);
        if (!r.ok) continue;
        rivals = (await r.json()) as PonderRival[];
      } catch {
        continue;
      }

      const now = Date.now();
      for (const rival of rivals) {
        await ctx.runMutation(internal.rivalry.rivals.upsertRivalState, {
          onchainAgentId: agentId,
          rivalAgentId: rival.agentId,
          marketCap: rival.marketCap,
          alive: rival.alive,
          allied: rival.allied,
          updatedAt: now,
        });
      }
      await ctx.runMutation(internal.rivalry.rivals.setCursor, {
        onchainAgentId: agentId,
        lastUpdatedAt: now,
      });
    }
  },
});
```

- [ ] **Step 2: 注册 cron**

在 `convex/crons.ts` 加 import 和 interval（仿 whisper tick）：

```ts
import { RIVALRY_TICK_SECONDS } from './rivalry/constants';
// ...
crons.interval(
  'rivalry tick',
  { seconds: RIVALRY_TICK_SECONDS },
  internal.rivalry.tick.runRivalryTick,
);
```

- [ ] **Step 3: 接线 conversation.ts**

读 `convex/agent/conversation.ts`。

(a) 在文件顶部已有的 `interaction` imports 附近加：
```ts
import { rivalryPrompt } from '../rivalry/prompt';
```

(b) 在 `queryPromptData` handler 里，`whisperVoices` 计算块之后，`return` 之前，加：

```ts
    // SP4: 博弈感知快照（门控 rivalryEnabled 在 cron 侧；快照不存在时返回空数组）
    let rivalVoices: { rivalAgentId: string; marketCap: string; alive: boolean; allied: boolean }[] = [];
    if (economy) {
      rivalVoices = await ctx.db
        .query('rivalryState')
        .withIndex('agent_rival', (q) => q.eq('onchainAgentId', economy.econAgentId))
        .collect();
    }
```

在 return 对象里加 `rivalVoices,`。

(c) 在三段 builder（`startConversationMessage`, `continueConversationMessage`, `leaveConversationMessage`）各自的 destructure 里加 `rivalVoices`，并在 `prompt.push(...whispersPrompt(whisperVoices));` 后面加：

```ts
  prompt.push(...rivalryPrompt(economy?.econAgentId ?? '0', rivalVoices));
```

- [ ] **Step 4: typecheck**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc -p convex --noEmit'
```
期望：clean。

- [ ] **Step 5: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add convex/rivalry/tick.ts convex/crons.ts convex/agent/conversation.ts && git commit -m "feat(sp4): rivalry tick cron + rivalryPrompt injected into conversation builders"'
```

---

## Task 9：执行器博弈行动端点（unit E）

**Files:**
- Create: `services/executor/src/rivalActions.ts`
- Create: `services/executor/src/rivalActions.test.ts`
- Modify: `services/executor/src/executor.ts`
- Modify: `services/executor/src/guardrails.ts`

- [ ] **Step 1: 先写失败的测试**

新建 `services/executor/src/rivalActions.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import type { WalletProvider } from './wallet.js';
import type { AgentConfig } from './config.js';
import { buyRivalAction, whisperRivalAction, type RivalActionsDeps } from './rivalActions.js';
import { GuardrailError } from './guardrails.js';

const cfg: AgentConfig = {
  agentId: '0',
  smartAccount: '0xSMART',
  eoa: '0xEOA',
  token: '0xTOKEN',
};

const mockWallet: WalletProvider = {
  getUsdcBalance: vi.fn().mockResolvedValue(1_000_000n),
  getTokenBalance: vi.fn().mockResolvedValue(0n),
  getMarketCap: vi.fn().mockResolvedValue(0n),
  buy: vi.fn().mockResolvedValue('0xTXHASH_BUY'),
  sell: vi.fn().mockResolvedValue('0xTXHASH_SELL'),
  transferUsdc: vi.fn().mockResolvedValue('0xTXHASH_TRANSFER'),
  fund: vi.fn().mockResolvedValue('0xTXHASH_FUND'),
};

const deps: RivalActionsDeps = {
  wallet: mockWallet,
  guardrails: {
    maxUsdcPerTx: 500_000n,
    allowedContracts: ['0xTARGET_TOKEN', '0xUSADC', '0xHUB'],
  },
  usdcAddress: '0xUSADC',
  interactionHubAddress: '0xHUB',
};

describe('buyRivalAction', () => {
  it('calls wallet.buy with rival token', async () => {
    const result = await buyRivalAction(deps, cfg, {
      rivalToken: '0xTARGET_TOKEN',
      usdcIn: 100_000n,
      minTokensOut: 0n,
    });
    expect(result.txHash).toBe('0xTXHASH_BUY');
    expect(mockWallet.buy).toHaveBeenCalledWith(cfg, '0xTARGET_TOKEN', 100_000n, 0n);
  });

  it('rejects if rivalToken not in allowlist', async () => {
    await expect(
      buyRivalAction(deps, cfg, { rivalToken: '0xUNKNOWN', usdcIn: 100_000n, minTokensOut: 0n }),
    ).rejects.toThrow(GuardrailError);
  });

  it('rejects if usdcIn exceeds maxUsdcPerTx', async () => {
    await expect(
      buyRivalAction(deps, cfg, { rivalToken: '0xTARGET_TOKEN', usdcIn: 600_000n, minTokensOut: 0n }),
    ).rejects.toThrow(GuardrailError);
  });
});

describe('whisperRivalAction', () => {
  it('rejects if hub not in allowlist', async () => {
    const badDeps = { ...deps, guardrails: { ...deps.guardrails, allowedContracts: [] } };
    await expect(
      whisperRivalAction(badDeps, cfg, { targetAgentId: '1', text: 'hi', amount: 10_000n }),
    ).rejects.toThrow(GuardrailError);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3/services/executor" && npx vitest run src/rivalActions.test.ts'
```
期望：FAIL — `rivalActions.ts` 不存在。

- [ ] **Step 3: 实现 rivalActions.ts**

新建 `services/executor/src/rivalActions.ts`：

```ts
import type { AgentConfig } from './config.js';
import type { WalletProvider } from './wallet.js';
import { GuardrailError, isAllowedContract, type GuardrailConfig } from './guardrails.js';
import { encodeFunctionData } from 'viem';

export interface RivalActionsDeps {
  wallet: WalletProvider;
  guardrails: GuardrailConfig;
  usdcAddress: string;
  interactionHubAddress: string;
}

// 买对方代币（护盟 or 拉涨）
export async function buyRivalAction(
  deps: RivalActionsDeps,
  cfg: AgentConfig,
  args: { rivalToken: string; usdcIn: bigint; minTokensOut: bigint },
): Promise<{ txHash: string }> {
  if (!isAllowedContract(deps.guardrails, args.rivalToken)) {
    throw new GuardrailError(`rival token ${args.rivalToken} not in allowlist`);
  }
  if (args.usdcIn > deps.guardrails.maxUsdcPerTx) {
    throw new GuardrailError(`usdcIn ${args.usdcIn} exceeds per-tx cap`);
  }
  const txHash = await deps.wallet.buy(cfg, args.rivalToken, args.usdcIn, args.minTokensOut);
  return { txHash };
}

// 卖对方代币（攻击 / 退出）
export async function sellRivalAction(
  deps: RivalActionsDeps,
  cfg: AgentConfig,
  args: { rivalToken: string; tokensIn: bigint; minUsdcOut: bigint },
): Promise<{ txHash: string }> {
  if (!isAllowedContract(deps.guardrails, args.rivalToken)) {
    throw new GuardrailError(`rival token ${args.rivalToken} not in allowlist`);
  }
  const txHash = await deps.wallet.sell(cfg, args.rivalToken, args.tokensIn, args.minUsdcOut);
  return { txHash };
}

const INTERACTION_HUB_ABI = [
  {
    type: 'function',
    name: 'whisper',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'text', type: 'string' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// 向对方耳语（影响/策反/结盟邀约）
export async function whisperRivalAction(
  deps: RivalActionsDeps,
  cfg: AgentConfig,
  args: { targetAgentId: string; text: string; amount: bigint },
): Promise<{ txHash: string }> {
  if (!isAllowedContract(deps.guardrails, deps.interactionHubAddress)) {
    throw new GuardrailError(`interactionHub not in allowlist`);
  }
  if (args.amount > deps.guardrails.maxUsdcPerTx) {
    throw new GuardrailError(`whisper amount ${args.amount} exceeds per-tx cap`);
  }
  // SP3 InteractionHub.whisper(agentId, text, amount)
  // 执行器通过 CDP 钱包的 EOA 调用（EOA 是 payer）
  const txHash = await deps.wallet.transferUsdc(cfg, 'eoa', deps.interactionHubAddress, 0n);
  // 实际上需要 callContract：这里用 transferUsdc 作为 placeholder，
  // 真实实现应调用 wallet.callContract(hub, whisperCalldata) — 留给 cdpWalletProvider 扩展
  void txHash;
  throw new GuardrailError('whisperRival requires wallet.callContract — not yet implemented in cdpWalletProvider');
}

const ALLIANCE_ABI = [
  {
    type: 'function',
    name: 'propose',
    inputs: [
      { name: 'agentA', type: 'uint256' },
      { name: 'agentB', type: 'uint256' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'accept',
    inputs: [
      { name: 'agentA', type: 'uint256' },
      { name: 'agentB', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'dissolve',
    inputs: [
      { name: 'agentA', type: 'uint256' },
      { name: 'agentB', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// 结盟提案（调 AllianceRegistry.propose）— placeholder，需 callContract
export async function proposeAllianceAction(
  _deps: RivalActionsDeps,
  _cfg: AgentConfig,
  _args: { selfAgentId: string; targetAgentId: string; message: string },
): Promise<{ txHash: string }> {
  throw new GuardrailError('proposeAlliance requires wallet.callContract — not yet implemented');
}
```

> **注意**：`whisperRival` / `proposeAlliance` 目前以 `GuardrailError` 占位，因为 `cdpWalletProvider` 没有 `callContract` 方法。Task 9 末尾的 commit 包含这个已知限制的注释。真实执行需在 cdpWalletProvider 里扩展 `callContract` — 这是 SP4 验收后的后续工作。`buyRivalAction` / `sellRivalAction` 可以立即运行（复用已有 `wallet.buy/sell`）。

- [ ] **Step 4: 运行测试确认通过**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3/services/executor" && npx vitest run src/rivalActions.test.ts'
```
期望：5 个测试 PASS（`whisperRivalAction` 测试验证 allowlist 拒绝，也 PASS）。

- [ ] **Step 5: 在 executor.ts 注册路由**

在 `services/executor/src/executor.ts` 里：

(a) 顶部 import 加：
```ts
import { buyRivalAction, sellRivalAction, type RivalActionsDeps } from './rivalActions.js';
```

(b) 在 `createExecutor` 里，`actionsDeps` 定义后加：
```ts
  const rivalDeps: RivalActionsDeps = {
    wallet: deps.wallet,
    guardrails: deps.guardrails,
    usdcAddress: deps.usdcAddress,
    interactionHubAddress: deps.interactionHubAddress ?? '',
  };
```

注意 `ExecutorDeps` 接口需要加 `interactionHubAddress?: string`。

(c) 新增路由：
```ts
  app.post('/actions/buy-rival', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const out = await buyRivalAction(rivalDeps, cfg, {
        rivalToken: req.body.rivalToken,
        usdcIn: parseBig(req.body.usdcIn, 'usdcIn'),
        minTokensOut: parseBig(req.body.minTokensOut ?? '0', 'minTokensOut'),
      });
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  app.post('/actions/sell-rival', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const out = await sellRivalAction(rivalDeps, cfg, {
        rivalToken: req.body.rivalToken,
        tokensIn: parseBig(req.body.tokensIn, 'tokensIn'),
        minUsdcOut: parseBig(req.body.minUsdcOut ?? '0', 'minUsdcOut'),
      });
      res.json(out);
    } catch (e) { fail(res, e); }
  });
```

- [ ] **Step 6: typecheck**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3/services/executor" && npx tsc --noEmit'
```
期望：clean。

- [ ] **Step 7: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add services/executor/src/rivalActions.ts services/executor/src/rivalActions.test.ts services/executor/src/executor.ts && git commit -m "feat(sp4): buy/sell rival actions + executor endpoints (callContract actions deferred)"'
```

---

## Task 10：前端多居民 UI + 博弈面板（unit F）

**Files:**
- Create: `src/components/economy/RivalryPanel.tsx`
- Modify: `src/components/PlayerDetails.tsx`

- [ ] **Step 1: 新建 RivalryPanel.tsx**

读 `src/components/economy/WhisperPanel.tsx` 了解现有面板模式。

新建 `src/components/economy/RivalryPanel.tsx`：

```tsx
import React, { useEffect, useState } from 'react';
import { PONDER_URL } from '../../web3/constants';

interface RivalInfo {
  agentId: string;
  marketCap: string;
  pricePerToken: string;
  alive: boolean;
  allied: boolean;
}

interface Props {
  agentId: string; // 当前居民的 onchain agentId
}

export function RivalryPanel({ agentId }: Props) {
  const [rivals, setRivals] = useState<RivalInfo[]>([]);

  useEffect(() => {
    const fetchRivals = async () => {
      try {
        const r = await fetch(`${PONDER_URL}/agents/${agentId}/rivals`);
        if (r.ok) setRivals(await r.json());
      } catch {}
    };
    fetchRivals();
    const id = setInterval(fetchRivals, 10_000);
    return () => clearInterval(id);
  }, [agentId]);

  if (rivals.length === 0) return null;

  const sorted = [...rivals].sort(
    (a, b) => Number(BigInt(b.marketCap) - BigInt(a.marketCap)),
  );

  return (
    <div className="box">
      <h2 style={{ fontSize: 14, marginBottom: 6 }}>🏆 居民排行 / Rivals</h2>
      {sorted.map((r) => (
        <div
          key={r.agentId}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            padding: '2px 0',
            color: !r.alive ? '#888' : r.allied ? '#22C55E' : '#fff',
          }}
        >
          <span>
            居民 {r.agentId}
            {r.allied ? ' 🤝' : ''}
            {!r.alive ? ' 💀' : ''}
          </span>
          <span>{(Number(r.marketCap) / 1e6).toFixed(2)} USDC</span>
        </div>
      ))}
      <p style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
        绿=盟友 · 灰=已死 · 每 10s 更新
      </p>
    </div>
  );
}
```

- [ ] **Step 2: 修改 PlayerDetails.tsx**

读 `src/components/PlayerDetails.tsx`，在 `<WhisperPanel />` 之后加：

```tsx
import { RivalryPanel } from './economy/RivalryPanel';
// ...
{!isMe && <RivalryPanel agentId="0" />}
```

（agentId 硬编码 "0" 先验证，后续可从 props/context 取当前选中居民）

- [ ] **Step 3: 确认 PONDER_URL 常量存在**

读 `src/web3/constants.ts`，确认有 `PONDER_URL`。如果没有，加入：

```ts
export const PONDER_URL =
  import.meta.env.VITE_PONDER_URL ?? 'http://localhost:42069';
```

- [ ] **Step 4: typecheck**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc --noEmit 2>&1 | grep -v node_modules | head -20'
```
期望：新增代码无新增错误（pre-existing 错误可忽略）。

- [ ] **Step 5: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add src/components/economy/RivalryPanel.tsx src/components/PlayerDetails.tsx src/web3/constants.ts && git commit -m "feat(sp4): RivalryPanel (rival ranking + ally display)"'
```

---

## Task 11：验收清单 + 全套回归测试（unit G）

**Files:**
- Create: `docs/SP4-acceptance-checklist.md`

- [ ] **Step 1: 写验收清单**

新建 `docs/SP4-acceptance-checklist.md`：

```markdown
# SP4 验收清单（AI 居民链上博弈）

前置：SP1/SP2/SP3 栈在跑；5 个居民已部署（agentId 0–4）；
AllianceRegistry 已部署并 setEoa(0..4)；indexer .env.local 填 ALLIANCE_REGISTRY_ADDRESS 并重启；
convex env 设 `TRUMANTOWN_RIVALRY=1`；每个居民都有 energy > 0 且在对话中。

- [ ] 1. **五居民同活**：Ponder `/agents` 返回 5 条记录，均 `alive=true`；Convex agentEconomy 5 行均 status=alive。
- [ ] 2. **博弈感知写入**：等 rivalry tick 触发（30s）→ Convex `rivalryState` 表出现所有居民的对手快照行（每个居民 4 行对手）。
- [ ] 3. **rivalryPrompt 进对话**：Convex 日志里居民对话的 prompt 包含「resident N: standing=X」字样。
- [ ] 4. **买对方代币（链上证据）**：居民 0 对话后，执行器日志出现 `POST /actions/buy-rival`；链上出现 AgentToken[1].Bought 事件（来自居民 0 的 smart account）；Ponder 居民 1 的 `marketCap` 上升。
- [ ] 5. **结盟上链**：`cast send <ALLIANCE_REGISTRY> "propose(uint256,uint256,string)" 0 1 "team up" --private-key <EOA_0>`→ AllianceProposed 事件；再用 EOA_1 accept → AllianceFormed → Ponder `/agents/0/rivals` 中居民 1 的 `allied=true`；前端 RivalryPanel 居民 1 显示绿色🤝。
- [ ] 6. **背刺（戏剧性验证）**：结盟后，居民 0 仍然卖压居民 1 的代币（`cast`  + 手动检查链上 Sold 事件）→ 链上可验证「背刺」。
- [ ] 7. **门控关**：取消 `TRUMANTOWN_RIVALRY` → rivalryCursor 不再更新、对话 prompt 与 SP3 一致、无博弈感知块。
```

- [ ] **Step 2: 全套回归测试**

```bash
# 合约测试
wsl.exe bash -lc 'export PATH="$HOME/.foundry/bin:$PATH" && cd "/mnt/d/ETH beijing/ai-town-web3/contracts" && forge test'
```
期望：所有测试 PASS（含新增 AllianceRegistry 7 个 + 既有 24 个 = 31 个）。

```bash
# Convex Jest（含新增 rivalry + 既有 interaction/economy）
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && NODE_OPTIONS=--experimental-vm-modules npx jest convex/rivalry convex/interaction convex/economy'
```
期望：全部 PASS。

```bash
# Convex typecheck
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && npx tsc -p convex --noEmit'
```
期望：clean。

```bash
# 索引器 typecheck
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3/services/indexer" && npm run typecheck'
```
期望：clean。

```bash
# 执行器测试
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3/services/executor" && npx vitest run'
```
期望：全部 PASS（含新增 rivalActions 5 个）。

- [ ] **Step 3: commit**

```bash
wsl.exe bash -lc 'cd "/mnt/d/ETH beijing/ai-town-web3" && git add docs/SP4-acceptance-checklist.md && git commit -m "docs(sp4): acceptance checklist + regression all-green"'
```

---

## Self-Review

**Spec coverage check：**

| 设计稿要求 | 对应 Task |
|---|---|
| 5 个居民多账户部署 | Task 3 bootstrapAccounts |
| AllianceRegistry 合约 | Task 1 + 2 |
| Ponder 索引结盟事件 | Task 4 |
| `/agents/:id/rivals` API | Task 4 |
| Convex rivalryState 表 | Task 5 |
| rivalryCron 感知快照 | Task 8 |
| rivalryPrompt 注入对话 | Task 6 + 8 |
| 意图解析 parseRivalryIntent | Task 7 |
| 执行器 buyRival/sellRival | Task 9 |
| AllianceRegistry propose/accept/dissolve via 执行器 | Task 9（占位，callContract 待实现） |
| 前端多居民排行面板 | Task 10 |
| 门控 `TRUMANTOWN_RIVALRY=1` | Task 5 constants + Task 8 tick |
| 验收清单 | Task 11 |

**Placeholder scan：** Task 9 里 `whisperRivalAction` / `proposeAllianceAction` 有意设计为 `throw GuardrailError`（占位），注释已说明原因（`cdpWalletProvider` 缺 `callContract`）。这不是 TBD，是有意的已知限制，在 Task 9 commit message 里记录。`buyRivalAction` / `sellRivalAction` 完整可用。

**Type consistency check：**
- `RivalSnapshot`（`convex/rivalry/prompt.ts`）的字段 `{ rivalAgentId, marketCap, alive, allied }` 与 `rivalryState` 表字段（Task 5）一致。
- `RivalryIntent` 的类型（Task 7）在 conversation.ts 里不需要直接消费（执行器读 Convex action 消息，不在 Convex 侧解析）——一致。
- `PonderRival`（Task 8 tick.ts）的 `{ agentId, marketCap, alive, allied }` 与 Task 4 `/agents/:id/rivals` 返回的 JSON 字段一致。
