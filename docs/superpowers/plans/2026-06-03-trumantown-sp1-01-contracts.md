# 楚门镇 SP1 · 计划 1/5：合约层（Contracts）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `contracts/`（Foundry）里实现 SP1 的最小链上集合：`MockUSDC`、`AgentToken`（USDC 储备的恒定乘积绑定曲线）、`AgentRegistry`（生命参数 + 生死登记）、`LaunchpadFactory`（发币+登记），并提供部署脚本（anvil + Base Sepolia）。

**Architecture:** 单一 Foundry 工程位于仓库根的 `contracts/` 子目录。绑定曲线采用**带虚拟储备的恒定乘积 AMM**（`k = effectiveReserve * tokensInCurve`），储备资产为 ERC-20 USDC（6 位小数），代币 18 位小数；公式按整数运算精确、十进制安全、天然含滑点。Standing（市值）由曲线即时价格 × 流通量推导。死亡由链下 keeper 调 `markDead` 落账并发事件，供索引器/运行时消费。

**Tech Stack:** Foundry（forge/anvil/cast）· Solidity ^0.8.20 · OpenZeppelin Contracts · forge-std 测试。

---

## 设计说明（对 brainstorming「fork+改造」决策的诚实细化）

`Web3_Agents.md` / SP1 设计稿选择「fork 开源 EVM pump.fun 曲线改 USDC 储备」。落到可 TDD 的计划时，
直接 fork 整个仓库（如 `jamesbachini/Pump.sol`）会带来三个不必要的负担：(1) 原版用 **ETH 储备**，其
`tokensPerETH = remainingTokens*1e18/reserve` 在 6 位小数 USDC 下十进制不干净、整数除法易出 0；
(2) 携带 SP1 用不到的费率/毕业注入 Uniswap 逻辑；(3) 其中点定价是近似式，测试需要循环对拍。

因此本计划**以开源 pump 克隆为数学参考，clean-room 实现一个最小恒定乘积 USDC 曲线**——这是上述决策更
YAGNI、更精确的实现。若后续确需完整 pump.fun 行为（毕业、费率），在 SP2/SP4 再叠加。此处主动标注。

**曲线公式（整数精确、十进制安全）：**
- 记 `R = effectiveReserve()`（USDC，6dec，含虚拟种子 `VIRTUAL_RESERVE`），`T = 曲线内剩余代币`（18dec）。
- 买入 `usdcIn = dx`：`tokensOut = T - (R*T)/(R+dx)`（`R*T` 为 6+18 dec，除以 6dec → 18dec，单位对）。
- 卖出 `tokensIn = dt`：`usdcOut = (R*dt)/(T+dt)`（6dec*18dec / 18dec → 6dec）。
- 即时价：`pricePerToken = R*1e18 / T`（每 1e18 代币的 USDC 6dec 计价）。
- 市值/Standing：`marketCap = pricePerToken * circulating / 1e18`，`circulating = maxSupply - T`。
- 虚拟储备只用于定价，**不可被卖出提走**：`usdcOut` 以**真实** `usdcReserve` 为上限。

---

## 文件结构（本计划创建/修改）

- 创建 `contracts/foundry.toml` — Foundry 配置
- 创建 `contracts/remappings.txt` — OZ 重映射
- 创建 `contracts/src/MockUSDC.sol` — 测试用 6 位小数 USDC（带 `mint`）
- 创建 `contracts/src/AgentToken.sol` — 绑定曲线 meme 币
- 创建 `contracts/src/AgentRegistry.sol` — 居民登记 + 生命参数 + 生死
- 创建 `contracts/src/LaunchpadFactory.sol` — 发币 + 登记入口
- 创建 `contracts/test/AgentToken.t.sol` — 曲线买卖/滑点/市值/守卫
- 创建 `contracts/test/AgentRegistry.t.sol` — 登记权限/生死
- 创建 `contracts/test/LaunchpadFactory.t.sol` — spawn 流程
- 创建 `contracts/script/Deploy.s.sol` — anvil/Base Sepolia 部署
- 创建 `contracts/.gitignore` — 忽略 `out/`、`cache/`、`broadcast/`
- 修改 仓库根 `.gitignore` — 忽略 `contracts/lib/`

---

## Task 0：Foundry 工程脚手架

**Files:**
- Create: `contracts/` (forge init)
- Create: `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/.gitignore`

- [ ] **Step 1: 安装 Foundry（WSL，一次性）**

Run:
```bash
curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup
```
Expected: 末尾打印 `forge`/`cast`/`anvil`/`chisel` 安装成功；`forge --version` 可用。

- [ ] **Step 2: 在仓库根初始化 contracts 子工程**

Run（项目根 `/mnt/d/AI Agent/ai-town-web3`）:
```bash
forge init --no-git contracts
```
Expected: 生成 `contracts/src/Counter.sol`、`contracts/test/Counter.t.sol`、`contracts/lib/forge-std`。

- [ ] **Step 3: 删除模板示例文件**

Run:
```bash
rm contracts/src/Counter.sol contracts/test/Counter.t.sol contracts/script/Counter.s.sol 2>/dev/null; true
```
Expected: 无输出即成功。

- [ ] **Step 4: 安装 OpenZeppelin**

Run:
```bash
cd contracts && forge install OpenZeppelin/openzeppelin-contracts --no-git && cd ..
```
Expected: `contracts/lib/openzeppelin-contracts` 出现。

- [ ] **Step 5: 写 remappings 与配置**

Create `contracts/remappings.txt`:
```
@openzeppelin/=lib/openzeppelin-contracts/
forge-std/=lib/forge-std/src/
```

Overwrite `contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.20"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC_URL}"
```

Create `contracts/.gitignore`:
```
out/
cache/
broadcast/
```

- [ ] **Step 6: 忽略 lib 提交（避免把 OZ 源码塞进仓库）**

Append to repo-root `.gitignore`:
```
contracts/lib/
```

- [ ] **Step 7: 验证空工程可编译**

Run:
```bash
cd contracts && forge build && cd ..
```
Expected: `Compiler run successful`（无合约也成功）。

- [ ] **Step 8: Commit**

```bash
git add contracts/foundry.toml contracts/remappings.txt contracts/.gitignore .gitignore
git commit -m "chore(contracts): scaffold Foundry project with OpenZeppelin"
```

---

## Task 1：MockUSDC（测试用 6 位小数 USDC）

**Files:**
- Create: `contracts/src/MockUSDC.sol`
- Test: `contracts/test/MockUSDC.t.sol`

- [ ] **Step 1: Write the failing test**

Create `contracts/test/MockUSDC.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_decimals_is_6() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_mint_credits_balance() public {
        usdc.mint(address(0xBEEF), 1_000_000); // 1 USDC
        assertEq(usdc.balanceOf(address(0xBEEF)), 1_000_000);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd contracts && forge test --match-contract MockUSDCTest -vv; cd ..
```
Expected: FAIL —— 编译错误 `Source "../src/MockUSDC.sol" not found`。

- [ ] **Step 3: Write minimal implementation**

Create `contracts/src/MockUSDC.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 仅用于本地 anvil 测试；Base Sepolia 上改用 Circle 测试网 USDC。
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd contracts && forge test --match-contract MockUSDCTest -vv; cd ..
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add contracts/src/MockUSDC.sol contracts/test/MockUSDC.t.sol
git commit -m "feat(contracts): add 6-decimal MockUSDC for testing"
```

---

## Task 2：AgentToken —— USDC 储备恒定乘积绑定曲线

**Files:**
- Create: `contracts/src/AgentToken.sol`
- Test: `contracts/test/AgentToken.t.sol`

- [ ] **Step 1: Write the failing tests（行为不变量）**

Create `contracts/test/AgentToken.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {AgentToken} from "../src/AgentToken.sol";

contract AgentTokenTest is Test {
    MockUSDC usdc;
    AgentToken token;
    address alice = address(0xA11CE);

    function setUp() public {
        usdc = new MockUSDC();
        token = new AgentToken("Alice Coin", "ALICE", address(usdc));
        usdc.mint(alice, 1_000_000_000); // 1000 USDC
        vm.prank(alice);
        usdc.approve(address(token), type(uint256).max);
    }

    function test_initial_supply_held_by_curve() public view {
        assertEq(token.balanceOf(address(token)), token.maxSupply());
        assertEq(token.totalSupply(), token.maxSupply());
    }

    function test_buy_credits_tokens_and_takes_usdc() public {
        uint256 usdcIn = 10_000_000; // 10 USDC
        vm.prank(alice);
        uint256 out = token.buy(usdcIn, 0);
        assertGt(out, 0, "got tokens");
        assertEq(token.balanceOf(alice), out);
        assertEq(token.usdcReserve(), usdcIn);
        assertEq(usdc.balanceOf(address(token)), usdcIn);
    }

    function test_price_increases_after_buy() public {
        uint256 p0 = token.pricePerToken();
        vm.prank(alice);
        token.buy(10_000_000, 0);
        uint256 p1 = token.pricePerToken();
        assertGt(p1, p0, "price rises after buy");
    }

    function test_roundtrip_never_profits() public {
        uint256 usdcIn = 50_000_000; // 50 USDC
        vm.startPrank(alice);
        uint256 out = token.buy(usdcIn, 0);
        uint256 back = token.sell(out, 0);
        vm.stopPrank();
        assertLe(back, usdcIn, "no free money on instant roundtrip");
    }

    function test_sell_never_drains_below_real_reserve() public {
        vm.startPrank(alice);
        uint256 out = token.buy(20_000_000, 0);
        token.sell(out, 0);
        vm.stopPrank();
        // 卖回后真实储备不应变负，余额一致
        assertEq(usdc.balanceOf(address(token)), token.usdcReserve());
    }

    function test_buy_respects_min_out() public {
        vm.prank(alice);
        vm.expectRevert(bytes("slippage"));
        token.buy(10_000_000, type(uint256).max);
    }

    function test_cannot_sell_more_than_held() public {
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient"));
        token.sell(1, 0);
    }

    function test_marketcap_positive_and_grows_with_buys() public {
        uint256 m0 = token.marketCap();
        vm.prank(alice);
        token.buy(30_000_000, 0);
        uint256 m1 = token.marketCap();
        assertGt(m1, m0, "standing grows");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd contracts && forge test --match-contract AgentTokenTest -vv; cd ..
```
Expected: FAIL —— `Source "../src/AgentToken.sol" not found`。

- [ ] **Step 3: Write minimal implementation**

Create `contracts/src/AgentToken.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice 居民的 meme 币：带虚拟储备的恒定乘积曲线，储备资产为 USDC(6dec)。
contract AgentToken is ERC20 {
    IERC20 public immutable usdc;
    uint256 public immutable maxSupply = 1_000_000e18;
    /// @notice 真实可提取储备（6dec）。虚拟种子只用于定价、不可提取。
    uint256 public usdcReserve;
    uint256 public constant VIRTUAL_RESERVE = 1_000_000; // 1 USDC 虚拟种子，避免除零并给初始定价

    event Bought(address indexed buyer, uint256 usdcIn, uint256 tokensOut);
    event Sold(address indexed seller, uint256 tokensIn, uint256 usdcOut);

    constructor(string memory name_, string memory symbol_, address usdc_) ERC20(name_, symbol_) {
        usdc = IERC20(usdc_);
        _mint(address(this), maxSupply);
    }

    /// @dev 定价用储备 = max(真实储备, 虚拟种子)
    function effectiveReserve() public view returns (uint256) {
        return usdcReserve < VIRTUAL_RESERVE ? VIRTUAL_RESERVE : usdcReserve;
    }

    /// @dev 每 1e18 代币的 USDC(6dec) 计价
    function pricePerToken() public view returns (uint256) {
        uint256 t = balanceOf(address(this));
        if (t == 0) return 0;
        return (effectiveReserve() * 1e18) / t;
    }

    /// @dev Standing = 即时价 × 流通量
    function marketCap() public view returns (uint256) {
        uint256 circulating = maxSupply - balanceOf(address(this));
        return (pricePerToken() * circulating) / 1e18;
    }

    function buy(uint256 usdcIn, uint256 minTokensOut) external returns (uint256 tokensOut) {
        require(usdcIn > 0, "zero in");
        uint256 R = effectiveReserve();
        uint256 T = balanceOf(address(this));
        require(T > 0, "sold out");
        uint256 newT = (R * T) / (R + usdcIn);
        tokensOut = T - newT;
        require(tokensOut >= minTokensOut, "slippage");
        require(usdc.transferFrom(msg.sender, address(this), usdcIn), "usdc in");
        usdcReserve += usdcIn;
        _transfer(address(this), msg.sender, tokensOut);
        emit Bought(msg.sender, usdcIn, tokensOut);
    }

    function sell(uint256 tokensIn, uint256 minUsdcOut) external returns (uint256 usdcOut) {
        require(tokensIn > 0, "zero in");
        require(balanceOf(msg.sender) >= tokensIn, "insufficient");
        uint256 R = effectiveReserve();
        uint256 T = balanceOf(address(this));
        usdcOut = (R * tokensIn) / (T + tokensIn);
        if (usdcOut > usdcReserve) usdcOut = usdcReserve; // 绝不动用虚拟储备
        require(usdcOut >= minUsdcOut, "slippage");
        _transfer(msg.sender, address(this), tokensIn);
        usdcReserve -= usdcOut;
        require(usdc.transfer(msg.sender, usdcOut), "usdc out");
        emit Sold(msg.sender, tokensIn, usdcOut);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd contracts && forge test --match-contract AgentTokenTest -vv; cd ..
```
Expected: PASS（8 passed）。

- [ ] **Step 5: Commit**

```bash
git add contracts/src/AgentToken.sol contracts/test/AgentToken.t.sol
git commit -m "feat(contracts): add AgentToken USDC-reserve bonding curve"
```

---

## Task 3：AgentRegistry —— 居民登记 + 生命参数 + 生死

**Files:**
- Create: `contracts/src/AgentRegistry.sol`
- Test: `contracts/test/AgentRegistry.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `contracts/test/AgentRegistry.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry reg;
    address factory = address(0xFAC);
    address keeper = address(0x4EE);
    address token = address(0x7011);
    address wallet = address(0x5A11E7); // CDP 钱包占位

    function setUp() public {
        reg = new AgentRegistry(factory, keeper);
    }

    function test_only_factory_can_register() public {
        vm.expectRevert(bytes("not factory"));
        reg.register(token, wallet, 10_000, 5_000_000, 10);
    }

    function test_register_stores_agent_and_increments_id() public {
        vm.prank(factory);
        uint256 id = reg.register(token, wallet, 10_000, 5_000_000, 10);
        assertEq(id, 0);
        (address t, address w, uint256 cost, uint256 floor_, uint256 win, bool alive) = reg.agents(id);
        assertEq(t, token);
        assertEq(w, wallet);
        assertEq(cost, 10_000);
        assertEq(floor_, 5_000_000);
        assertEq(win, 10);
        assertTrue(alive);
        assertEq(reg.nextAgentId(), 1);
    }

    function test_only_keeper_can_mark_dead() public {
        vm.prank(factory);
        uint256 id = reg.register(token, wallet, 10_000, 5_000_000, 10);
        vm.expectRevert(bytes("not keeper"));
        reg.markDead(id);
        vm.prank(keeper);
        reg.markDead(id);
        (, , , , , bool alive) = reg.agents(id);
        assertFalse(alive);
    }

    function test_marking_dead_twice_reverts() public {
        vm.prank(factory);
        uint256 id = reg.register(token, wallet, 10_000, 5_000_000, 10);
        vm.startPrank(keeper);
        reg.markDead(id);
        vm.expectRevert(bytes("already dead"));
        reg.markDead(id);
        vm.stopPrank();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd contracts && forge test --match-contract AgentRegistryTest -vv; cd ..
```
Expected: FAIL —— `Source "../src/AgentRegistry.sol" not found`。

- [ ] **Step 3: Write minimal implementation**

Create `contracts/src/AgentRegistry.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice 登记 居民 ↔ 代币 ↔ CDP 钱包 ↔ 生命参数；记录生死。
contract AgentRegistry {
    struct Agent {
        address token;          // AgentToken 地址
        address wallet;         // CDP 智能钱包地址
        uint256 costPerThink;   // 单次思考算力费（USDC 6dec）
        uint256 floor;          // 死亡地板（市值，USDC 6dec）
        uint256 recoveryWindow; // 抢救窗口 T（tick 数）
        bool alive;
    }

    address public immutable factory; // 仅 factory 可登记
    address public immutable keeper;  // 仅 keeper 可判死（链下守护进程）
    uint256 public nextAgentId;
    mapping(uint256 => Agent) public agents;

    event AgentRegistered(uint256 indexed agentId, address token, address wallet);
    event AgentDied(uint256 indexed agentId);

    constructor(address factory_, address keeper_) {
        factory = factory_;
        keeper = keeper_;
    }

    function register(
        address token,
        address wallet,
        uint256 costPerThink,
        uint256 floor,
        uint256 recoveryWindow
    ) external returns (uint256 agentId) {
        require(msg.sender == factory, "not factory");
        agentId = nextAgentId++;
        agents[agentId] = Agent(token, wallet, costPerThink, floor, recoveryWindow, true);
        emit AgentRegistered(agentId, token, wallet);
    }

    function markDead(uint256 agentId) external {
        require(msg.sender == keeper, "not keeper");
        require(agents[agentId].alive, "already dead");
        agents[agentId].alive = false;
        emit AgentDied(agentId);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd contracts && forge test --match-contract AgentRegistryTest -vv; cd ..
```
Expected: PASS（4 passed）。

- [ ] **Step 5: Commit**

```bash
git add contracts/src/AgentRegistry.sol contracts/test/AgentRegistry.t.sol
git commit -m "feat(contracts): add AgentRegistry with life params and death"
```

---

## Task 4：LaunchpadFactory —— 发币 + 登记入口

**Files:**
- Create: `contracts/src/LaunchpadFactory.sol`
- Test: `contracts/test/LaunchpadFactory.t.sol`

- [ ] **Step 1: Write the failing tests**

Create `contracts/test/LaunchpadFactory.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {AgentToken} from "../src/AgentToken.sol";

contract LaunchpadFactoryTest is Test {
    MockUSDC usdc;
    AgentRegistry reg;
    LaunchpadFactory factory;
    address keeper = address(0x4EE);
    address wallet = address(0x5A11E7);

    function setUp() public {
        usdc = new MockUSDC();
        // factory 地址需预先确定：先按 nonce 预测，或先部署 factory 再用其地址建 registry。
        // 这里用两步：registry 的 factory 设为「即将部署的 factory」——用 computeCreateAddress。
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        reg = new AgentRegistry(predicted, keeper);
        factory = new LaunchpadFactory(address(usdc), address(reg));
        assertEq(address(factory), predicted, "factory address prediction");
    }

    function test_spawn_deploys_token_and_registers() public {
        (uint256 id, address token) =
            factory.spawnAgent("Alice Coin", "ALICE", wallet, 10_000, 5_000_000, 10);
        assertEq(id, 0);
        assertTrue(token != address(0));
        // 代币储备资产指向 USDC
        assertEq(address(AgentToken(token).usdc()), address(usdc));
        // registry 已登记且 alive
        (address t, address w, uint256 cost, , , bool alive) = reg.agents(id);
        assertEq(t, token);
        assertEq(w, wallet);
        assertEq(cost, 10_000);
        assertTrue(alive);
    }

    function test_spawn_emits_event() public {
        vm.expectEmit(false, false, false, false);
        emit LaunchpadFactory.AgentSpawned(0, address(0), wallet);
        factory.spawnAgent("Bob Coin", "BOB", wallet, 10_000, 5_000_000, 10);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd contracts && forge test --match-contract LaunchpadFactoryTest -vv; cd ..
```
Expected: FAIL —— `Source "../src/LaunchpadFactory.sol" not found`。

- [ ] **Step 3: Write minimal implementation**

Create `contracts/src/LaunchpadFactory.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentToken} from "./AgentToken.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

/// @notice pump.fun 式发币入口：部署 AgentToken 并在 Registry 登记生命参数。
contract LaunchpadFactory {
    IERC20 public immutable usdc;
    AgentRegistry public immutable registry;

    event AgentSpawned(uint256 indexed agentId, address token, address wallet);

    constructor(address usdc_, address registry_) {
        usdc = IERC20(usdc_);
        registry = AgentRegistry(registry_);
    }

    function spawnAgent(
        string memory name,
        string memory symbol,
        address wallet,
        uint256 costPerThink,
        uint256 floor,
        uint256 recoveryWindow
    ) external returns (uint256 agentId, address token) {
        AgentToken t = new AgentToken(name, symbol, address(usdc));
        token = address(t);
        agentId = registry.register(token, wallet, costPerThink, floor, recoveryWindow);
        emit AgentSpawned(agentId, token, wallet);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd contracts && forge test --match-contract LaunchpadFactoryTest -vv; cd ..
```
Expected: PASS（2 passed）。

- [ ] **Step 5: Commit**

```bash
git add contracts/src/LaunchpadFactory.sol contracts/test/LaunchpadFactory.t.sol
git commit -m "feat(contracts): add LaunchpadFactory spawnAgent flow"
```

---

## Task 5：部署脚本（anvil + Base Sepolia）

**Files:**
- Create: `contracts/script/Deploy.s.sol`
- Create: `contracts/.env.example`

- [ ] **Step 1: 写部署脚本**

Create `contracts/script/Deploy.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";

/// @notice 部署顺序：USDC → 预测 factory 地址 → Registry(factory,keeper) → Factory。
/// 本地 anvil 部署 MockUSDC；Base Sepolia 用环境变量 USDC_ADDRESS 指向 Circle 测试网 USDC。
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        address usdc = vm.envOr("USDC_ADDRESS", address(0));

        vm.startBroadcast(pk);
        address deployer = vm.addr(pk);

        if (usdc == address(0)) {
            MockUSDC mock = new MockUSDC();
            usdc = address(mock);
            console2.log("MockUSDC:", usdc);
        }

        // Registry 的 factory 字段需为「下一笔部署的 Factory 地址」
        address predictedFactory = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        AgentRegistry registry = new AgentRegistry(predictedFactory, keeper);
        LaunchpadFactory factory = new LaunchpadFactory(usdc, address(registry));
        require(address(factory) == predictedFactory, "factory address mismatch");

        console2.log("USDC:", usdc);
        console2.log("AgentRegistry:", address(registry));
        console2.log("LaunchpadFactory:", address(factory));
        vm.stopBroadcast();
    }
}
```

Create `contracts/.env.example`:
```
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KEEPER_ADDRESS=0x0000000000000000000000000000000000000000
# 本地 anvil 留空 USDC_ADDRESS 会部署 MockUSDC；Base Sepolia 填 Circle 测试网 USDC：
# USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

- [ ] **Step 2: 本地 anvil 起链**

Run（另开一个终端，保持运行）:
```bash
anvil
```
Expected: 打印 10 个测试账户与私钥，监听 `127.0.0.1:8545`。第 0 个私钥即 `.env.example` 里的默认 `DEPLOYER_PRIVATE_KEY`。

- [ ] **Step 3: 对 anvil 跑部署脚本（dry-run + 广播）**

Run（项目根另一终端）:
```bash
cd contracts && \
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
KEEPER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast; cd ..
```
Expected: 日志打印 `MockUSDC:`、`AgentRegistry:`、`LaunchpadFactory:` 三个地址；`ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`。

- [ ] **Step 4: 用 cast 冒烟验证 spawnAgent**

Run（把 `<FACTORY>` 换成上一步打印的 LaunchpadFactory 地址）:
```bash
cast send <FACTORY> \
  "spawnAgent(string,string,address,uint256,uint256,uint256)" \
  "Alice Coin" "ALICE" 0x5A11E7000000000000000000000000000000a11e 10000 5000000 10 \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
Expected: 返回交易回执（status 1 success）。

- [ ] **Step 5: 运行整套合约测试**

Run:
```bash
cd contracts && forge test -vv; cd ..
```
Expected: 全部 PASS（MockUSDC 2 + AgentToken 8 + AgentRegistry 4 + LaunchpadFactory 2 = 16 passed）。

- [ ] **Step 6: Commit**

```bash
git add contracts/script/Deploy.s.sol contracts/.env.example
git commit -m "feat(contracts): add deploy script for anvil and Base Sepolia"
```

---

## 后续计划（SP1 的其余 4 个计划，本计划完成后各自再用 writing-plans 展开）

- **计划 2/5：x402 网关 + 自托管 facilitator**（Node/`x402-express`，按次定价 → Ollama 反向代理；本计划的合约提供 USDC 与收款地址）。
- **计划 3/5：执行器（AgentKit + CDP 智能钱包）**（钱包 = `AgentRegistry.wallet`；调用本计划的 `AgentToken.buy/sell`；作 x402 付款方）。
- **计划 4/5：Convex 经济模块**（感知 Ponder 数据、生存目标栈注入、`llm.ts` 接缝改指网关、调用执行器）。
- **计划 5/5：Ponder 索引器 + 集成**（索引 `Bought/Sold/AgentSpawned/AgentDied`；自托管 Convex；跑通「饥饿→卖币→复活」与「饥饿→死亡」两条脚本）。

每个后续计划依赖本计划产出的合约 ABI 与事件签名：`AgentToken.buy(uint256,uint256)`、`sell(uint256,uint256)`、
`pricePerToken()`、`marketCap()`、`usdcReserve()`；`LaunchpadFactory.spawnAgent(...)` 与 `AgentSpawned`；
`AgentRegistry.agents(uint256)`、`markDead(uint256)` 与 `AgentRegistered/AgentDied`。

---

_本计划为 SP1 计划 1/5（合约层）。完成后进入 subagent-driven-development 或 executing-plans 执行。_
