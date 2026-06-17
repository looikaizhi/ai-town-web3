# 楚门镇 TrumanTown · 子项目 SP2 设计稿
## 「你的钱就是它的命」—— 人类买卖 + 生命仪表盘（第二个垂直切片）

> 本文是 brainstorming 阶段的**最终设计稿**，上承 SP1 设计稿
> [`2026-06-03-trumantown-sp1-design.md`](./2026-06-03-trumantown-sp1-design.md) §9 的路线。
> 它只覆盖 **SP2**，目标是直接转入「写计划（writing-plans）→ TDD 实现」流程。
> 范围、技术选型、UI 排版均已与用户逐段确认。

---

## 0. 背景与本切片要证明的论点

SP1 已端到端跑通核心代谢闭环：**AI 居民必须付真实 USDC 才能思考，它自己的币是把价值变现成
USDC 的唯一生命线，钱耗尽且无法变现 → 链上判死**。SP1 里买卖币的主体是 **AI 自己的 CDP 钱包**。

SP2 在 SP1 的链上事实 + 索引器读 API 之上，叠加 **人类这一侧的互动**，要证明的论点是：

> **你（人类）的钱，就是它的命。** 观众用自己的钱包在绑定曲线上买这个 AI 居民的币 →
> 它的 Standing（市值）上涨 → 它能变现更多 USDC 续命；反之无人接盘 → 它走向死亡。

人类的买卖、AI 的生死、链上的市值，第一次在同一块屏幕上被**肉眼**连起来。

---

## 1. 已确认决策（贯穿本切片）

| 维度 | 决策 | 含义 |
|---|---|---|
| 买卖主体 | **人类观众用自己的钱包** | 浏览器直接调绑定曲线合约 `buy/sell`，体现「人类的钱 → AI 的命」。AI 自买自卖是 SP1 既有执行器路径，SP2 不动。 |
| 钱包技术栈 | **wagmi + RainbowKit** | EVM 事实标准，现成连接弹窗 + `useReadContract/useWriteContract`，与 React 集成好。 |
| 动画野心 | **中等**：血条 + 变色 + 粒子 + 脉搏 + 死亡动画 | 头顶双仪表盘 + 抢救环形倒计时 + 付费粒子 + 饥饿脉搏 + 死亡墓碑。 |
| 数据源 | **混合**：Convex 反式 + Ponder 轮询 | 「命」线（status/energy/倒计时）走 Convex `useQuery`；「价」线（marketCap/price/reserve）轮询 Ponder，成交后立即重拉。 |
| 视觉风格 | **沿用现有 Pixel Art**（设计智能确认为 Web3/游戏经济推荐风格） | 不引入新风格；保留 `brown-700`/`clay-700`，叠加语义动作色。 |
| 后端契约 | **不改 SP1 任何后端契约** | 合约 ABI / 网关 / 执行器 / facilitator / Ponder schema 一律不动；唯一后端新增是一个**只读**的常开 Convex 查询。 |
| 居民数 | **1**（agentId 0），组件以 `agentId` 为参数 | 锁定单居民跑通，接口为多居民留好。 |

---

## 2. 架构与组件拆分

整体原则：**只加前端 + 一个只读 Convex 查询；SP1 的合约、网关、执行器、索引器一律不改。**
新增 5 个隔离单元，每个职责单一、接口清晰、可独立理解与测试：

| 单元 | 类型 | 职责 | 依赖 |
|---|---|---|---|
| **A. 钱包层** | 新增前端 | wagmi 配置 + RainbowKit Provider，定义 Base Sepolia 链、`ConnectButton`。包在 App 外层。 | wagmi / viem / RainbowKit |
| **B. 合约交互 hooks** | 新增前端 | `useAgentCoin(agentId)` 读 token 地址；`useBuy`（approve→buy）、`useSell`；滑点计算 + 交易状态。内含 USDC + AgentToken 两个 ABI 片段；小数转换集中在 `decimals.ts`。 | A、viem |
| **C. 经济读取层** | 新增前端 + **1 个 Convex 查询** | ① 新增常开 Convex query `economy/public.getAgentStatus` → `status/energy/starvingPeriods/recoveryWindow/diedAt`（反式订阅）；② `usePonderAgent(agentId)` 轮询 `/agents/0` 取 `marketCap/price/reserve/alive`，买卖成交后立即重拉。 | Convex、Ponder |
| **D. 买卖面板** | 新增 React | 选中居民时在右侧 `PlayerDetails` 内显示：连接钱包、当前价/Standing/持仓、金额+滑点输入、两步状态机按钮、Buy/Sell tab、交易 toast。复用现有 `box`/`button` 样式与 `toasts.ts`。 | A、B、C |
| **E. PixiJS 双仪表盘 + 倒计时 + 动画** | 新增 Pixi | 每个居民头顶：Energy 条、Standing 条、健康/饥饿配色、饥饿脉搏、付费 USDC 粒子、抢救环形倒计时、死亡变灰+墓碑。数据由 C 经 props 下传；视觉参数由纯函数 `economyToGauge()` 算出。 | C、现有 PixiGame/Character |

**关键边界**：
- 所有「币价/市值」走 Ponder（链上权威），所有「能量/饥饿/倒计时」走 Convex（引擎内部状态，不在链上）。
- 买卖只走人类自己的浏览器钱包，**不碰执行器**（执行器仍只管 AI 的 CDP 钱包，SP1 不变）。

---

## 3. 数据流

```
①「命」线（引擎内部，非链上）—— 反式实时
   Convex 经济 tick → agentEconomy 表(status/energy/starvingPeriods/diedAt)
        │  新增常开 query economy/public.getAgentStatus
        ▼
   useQuery(订阅，零轮询) ──► Energy 条 · 抢救倒计时 · 饥饿脉搏/死亡动画

②「价」线（链上权威）—— 轮询 + 成交后立即重拉
   人类钱包 buy/sell ─tx─► AgentToken 曲线 ─event─► Ponder 索引
        │  usePonderAgent 轮询 /agents/0 (默认 ~4s)
        ▼
   marketCap(Standing) · pricePerToken · usdcReserve · alive
        │  └─► 买卖面板的「当前价/Standing/预估」
        └─────► Standing 条（人类买完几秒内涨上去 = 主线论点的肉眼证据）

成交回调：buy/sell 交易 confirmed → 手动 invalidate ②的轮询 → 立刻重拉 → 体感「我一买它就涨」。
```

---

## 4. 关键技术点（前端/链上新手最易栽的地方，含对策）

合约事实（来自 SP1 已部署的 `AgentToken`）：
- `buy(usdcIn, minTokensOut)` / `sell(tokensIn, minUsdcOut)`；view：`pricePerToken()` / `marketCap()` / `usdcReserve`。
- USDC = 6 位小数，AgentToken = 18 位小数；Ponder 返回的是 atomic 字符串。

| # | 坑 | 对策 |
|---|---|---|
| 1 | **买币是两笔交易**：`buy` 内部 `transferFrom`，必须先 `USDC.approve(token, usdcIn)`。 | 面板做**两步状态机**（`需授权→授权中→可购买→购买中→完成`）；先查 `allowance`，够了跳过 approve。卖币只一笔。 |
| 2 | **滑点 minOut 必须前端算**，否则被前跑或交易卡死。 | 用 Ponder `pricePerToken` 估 `tokensOut`，乘 `(1 − 容忍%)` 得 `minTokensOut`；默认 1%，UI 给输入框。卖同理算 `minUsdcOut`。 |
| 3 | **小数位陷阱**（6dec vs 18dec）。 | 统一用 viem `parseUnits/formatUnits`，集中在 B 层 `decimals.ts`；UI 只碰人类可读数。 |
| 4 | **网络不对**（钱包在主网/别的链）。 | RainbowKit `chains=[baseSepolia]`，链不对自动弹「切换」；buy/sell 前 `assertChain` 兜底。 |
| 5 | **居民已死还能不能买**：`alive=false` 或 `marketCap=0`（售罄）时 `sell` 会 revert。 | 面板读 `alive`，死亡即禁用买卖、显示墓碑态；仪表盘 E 同步死亡动画。**这是 SP1 死亡论点在前端的收尾。** |

错误处理统一走现有 `toasts.ts`：approve 被拒 / USDC 不足 / 滑点 revert / 切链失败 / agent 已死 → `toastOnError`，文案明确且含恢复路径（如「滑点过大，调高容忍度或减小金额」）。

---

## 5. UI/UX 排版规范（落在现有 Pixel Art 上）

设计智能确认 Pixel Art 即 Web3/游戏经济推荐风格，故**不引入新风格**，仅补语义色与交互规范。

### 5.1 配色：保留现有底色，叠加语义动作色

`brown-700`/`clay-700` 继续作面板底与边框；新增三个语义色（Pixel Art 调色板）：

| 角色 | 色 | 用途 |
|---|---|---|
| 买/健康 | 绿 `#22C55E` | Buy 按钮、Energy/Standing 高位、健康态仪表盘 |
| 卖/危险 | 红 `#DC2626` | Sell 按钮、饥饿态、抢救倒计时、错误 toast |
| 次要/信息 | 蓝 `#2563EB` | 链接、价格变动提示、连接钱包按钮 |

**铁律**：颜色不单独承载语义（a11y `color-not-only`）——饥饿除变红还要脉搏 + 「STARVING」文字；死亡除变灰还要墓碑图标。

### 5.2 买卖面板布局（右侧 `PlayerDetails` 内，自上而下）

```
┌─ [居民名] ALICE ─────────────┐   ← 复用现有 .box 标题
│ ◆ Standing  12.34 USDC  ▲     │   ← 等宽数字(number-tabular)，Ponder 实时
│ ◆ Price     0.0012 USDC/ALICE │
│ ◆ 你的持仓   1,250 ALICE       │   ← 千分位
├───────────────────────────────┤
│ [ Connect Wallet ]            │   ← 未连时只显示这个(蓝)；连后变小地址条
│ ┌── Buy ──┬── Sell ──┐        │   ← Tab 切换，当前态高亮(nav-state-active)
│ 金额 [______] USDC  [Max]     │   ← input type=number
│ 滑点 [1%▾]  预估得 ≈ 1,041 ALICE│   ← 实时估算
│ [ ① 授权 USDC → ② 购买 ]       │   ← 两步状态机按钮
│ ⓘ 错误/状态行 (role=alert)     │   ← 近字段、可恢复
└───────────────────────────────┘
```

两步按钮状态：`需授权 →（点击）授权中 ⟳ → 可购买 →（点击）购买中 ⟳ → ✓ 完成`。异步 >300ms
一律转圈 + 禁用（`loading-buttons`）；allowance 够则直达「购买」。死亡时整块禁用 + 墓碑态。

### 5.3 头顶仪表盘 + 倒计时（PixiJS）

- **双横条**：Energy（上，绿→红随 energy 降）、Standing（下，金）；条宽 = 纯函数 `economyToGauge()` 算出，**只用 transform/缩放**，不改 width（`transform-performance`）。
- **饥饿脉搏**：`alive && starving` 时整组以 ~600ms 周期缩放脉动（红）；**必须读 `prefers-reduced-motion`，开了就只变色不脉动**。
- **抢救环形倒计时**：饥饿时精灵周围一圈，按 `(T − starvingPeriods)/T` 收缩；PixiJS Graphics 画弧。
- **付费粒子**：每次成功思考迸发几颗 USDC 粒子（≤2 个元素，符合 `excessive-motion`）。
- **死亡态**：变灰 + 墓碑精灵 + 仪表盘归零淡出；面板同步禁买。
- 动画时长统一 150–300ms、ease-out；全局尊重 reduced-motion。

### 5.4 可访问性底线（设计智能 §1 CRITICAL）

文本对比 ≥4.5:1；按钮/输入有可见 focus 环 + `cursor-pointer`；交易状态用 `role="alert"`/`aria-live`
播报；价格/倒计时用等宽数字防跳动。

---

## 6. 测试策略（TDD）

把「可测的纯函数」从「难测的渲染/钱包交互」里挤出来，纯函数严格 TDD，UI/链交互靠手动验收。

| 层 | 测什么 | 怎么测 |
|---|---|---|
| **B 滑点/小数（纯函数）** | `minTokensOut`/`minUsdcOut` 计算、`parseUnits/formatUnits` 6dec↔18dec 往返、滑点容忍 | **Vitest 单测，先写后实现**（金额算错会真亏钱，最该 TDD） |
| **C Convex 常开查询** | `getAgentStatus` 返回形状、未配置/无 agent 时降级 | 根目录 Jest（`convex/economy`），加一条 suite |
| **E 仪表盘映射（纯函数）** | `economyToGauge(data)` → 条宽/配色/倒计时格数/死亡态，边界值（energy≤0、starving=T、alive=false） | **Vitest 单测**；渲染只消费纯函数输出 |
| **D 买卖面板（组件）** | 两步状态机渲染、死亡禁用态 | 轻量组件测试或手动，不强求覆盖率 |
| **手动端到端（核心证据，仿 SP1 D 段）** | ①连 Base Sepolia 钱包→approve→buy→几秒内头顶 Standing 涨 ②让居民饿→看抢救环倒计时→死亡变灰+墓碑+面板禁买 | 手动剧本，写进 `SP2-acceptance-checklist.md` |

**判据**：B/E 纯函数单测全绿 + C 的 Jest suite 绿 + 两条手动剧本肉眼成立。

---

## 7. 明确的 Non-Goals（SP2 不做，留给后续）

- **喊话 / 求救 / 悬赏 / 二次方加权 / 用户输入回灌 AI 上下文** —— 全是 **SP3**（`InteractionHub`/`BountyEscrow`）。SP2 只做「买卖币 + 看仪表盘」，不让人类对 AI 喊话。
- **多居民规模化 UI / 跨币种 / 结盟攻击** —— SP4。SP2 锁定 1 居民，但组件以 `agentId` 为参数留好接口。
- **不改 SP1 任何后端契约**：合约 ABI、网关、执行器、facilitator、Ponder schema 一律不动；唯一后端新增是 C 的只读 Convex 查询。
- **不做账户抽象 / 法币入金 / 移动端适配**；钱包用 RainbowKit 默认那批（MetaMask 等）。
- **不替 AI 决定买卖**：AI 自买自卖是 SP1 既有路径，SP2 不动，只加人类侧。

---

## 8. 后续子项目（不变，见 SP1 设计稿 §9）

| 子项目 | 证明什么 |
|---|---|
| **SP3** | 用户输入真正回灌 AI 上下文（`InteractionHub`/`BountyEscrow`/二次方加权） |
| **SP4** | 居民读链上数据互相博弈（索引器驱动策略、跨币种、结盟/攻击） |
| **SP5** | permissionless 自生长 + 可验证死亡（L7 孵化、`LegacyNFT`、`StateCommitter`） |

---

_本设计稿为 SP2 的最终拍板版；下一步进入 writing-plans，产出带验收标准的实现计划。_
