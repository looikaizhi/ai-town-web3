# 楚门镇 TrumanTown · SP2 手动验收清单

> 论点：**你（人类）的钱就是它的命。** 观众用自己钱包买居民的币 → Standing 涨 → 它能续命；
> 无人接盘 + 饥饿 → 抢救倒计时归零 → 链上判死，前端同步收尾。
> 前置：SP1 全栈已起（合约已部署、居民 0 已发币、Ponder 回填到最新块、Convex `TRUMANTOWN_ECONOMY=1`）。

---

## A. 静态（无需真链）

- [ ] `npx vitest run src/web3/` → **24 passed**（curveMath / format / gauge / tradeError）
- [ ] `NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy/public.test.ts` → **2 passed**
- [ ] `npx tsc --noEmit -p tsconfig.json` 与 `npx tsc -p convex --noEmit` 干净
- [ ] `npm run dev:frontend` 起得来，无编译错误

**A 段通过判据**：所有测试绿，tsc 干净，Vite 起得来。

---

## B. 连接钱包（Base Sepolia）

- [ ] 前端 `.env.local` 已设 `VITE_PONDER_URL` / `VITE_USDC_ADDRESS`（复制 `.env.local.example`）
- [ ] `npm run dev` 全栈起来，浏览器打开 `http://localhost:5174/ai-town`
- [ ] 点击任意非自己的居民 → 右侧出现买卖面板（Standing / Price / 你的持仓 / Connect Wallet）
- [ ] 点 Connect Wallet → MetaMask 弹出，选账户连上
- [ ] 若钱包在别的网络 → 面板显示「切换到 Base Sepolia」，点击后一键切换

---

## C①. 买入 → Standing 上涨（核心证据）

- [ ] EOA 钱包有 Base Sepolia USDC（从 `https://faucet.circle.com` 领或转入）
- [ ] Buy tab，输入金额（如 `0.5`）→ 面板显示「预估得 ≈ … coin / 最少 …」实时更新
- [ ] 点「① 授权 → ② 购买」：
  - 首购：MetaMask 弹**两次**（approve + buy）；再次购买只弹一次（allowance 够了）
  - 成交后面板显示「✓ 成交，Standing 已更新」
- [ ] 几秒内：面板 **Standing** 数值上升，头顶**金色 Standing 条变长**
- [ ] basescan 核对 `https://sepolia.basescan.org`：USDC `approve` + AgentToken `Bought` 事件可见

**C① 通过判据**：肉眼看到「我一买 Standing 就涨」——这就是「你的钱 = 它的命」的硬证据。

---

## C②. 卖出 → 变现 USDC

- [ ] Sell tab，点 [Max] 自动填入持仓
- [ ] 预估 USDC out 合理（有储备时 > 0）
- [ ] 成交后：持仓减少，钱包 USDC 余额增加
- [ ] basescan 见 AgentToken `Sold` 事件

---

## D. 生命仪表盘 + 死亡收尾

- [ ] **Energy 条（绿）**：居民活着且 EOA 有 USDC 时显示绿色，充约 1 USDC 让 Energy ≈ 100 格
- [ ] **Standing 条（金）**：买入后随 marketCap 上升而变长
- [ ] **饥饿态**：让 EOA 破产（不充 USDC）→ 居民进入 starving：
  - Energy 条变**红**
  - 整组出现**脉搏跳动**动画
  - 精灵周围出现**红色环形抢救倒计时**，随 starvingPeriods 逐渐收缩
- [ ] **reduced-motion**：系统开启 `prefers-reduced-motion` → 只变红色，不脉动（开无障碍设置验证）
- [ ] **死亡**：连续 T（=100）周期无人施救：
  - 头顶变**灰**
  - 出现**墓碑**图标
  - 双条归零淡出
  - 右侧面板显示「🪦 该居民已死亡，无法买卖」，买卖按钮禁用
- [ ] basescan 核对：`AgentRegistry` 的 `AgentDied(0)` 事件
- [ ] Ponder 核对：`curl http://127.0.0.1:42069/agents/0` → `alive: false`, `marketCap: "0"`

---

## 收官判定

- [ ] **A 段全绿** → 纯函数逻辑与曲线数学正确（算错会真亏钱）
- [ ] **C① 肉眼看到「买 → Standing 涨」** → 「你的钱 = 它的命」论点在 UI 成立
- [ ] **D 死亡完整收尾** → SP1 死亡论点在前端闭环
- [ ] **不变量**：未改 SP1 任何后端契约（合约/网关/执行器/facilitator/Ponder schema）；唯一后端新增是只读 `getAgentStatus` Convex 查询

> 以上全部勾齐且主观满意整体效果后，即可进入 **SP3**（用户输入回灌 AI 上下文 / InteractionHub / BountyEscrow）。
