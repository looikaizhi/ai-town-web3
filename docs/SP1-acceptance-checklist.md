# 楚门镇 TrumanTown · SP1 手动验收清单

> 目的：在进入 **SP2** 之前，手动端到端验证 SP1 垂直切片（计划 1–5 全部已合并到
> `main`）真正成立。SP1 要证明的唯一论点：**AI 居民必须支付真实 USDC 才能思考，而它自己的币是把价值变现成 USDC 的唯一生命线；钱耗尽且无法变现 → 死亡。**
>
> 清单分 5 个阶段：**A 静态**（无需真链，几分钟）→ **B 上链准备**（部署 + 起栈 + 资金）→
> **C 单服务冒烟** → **D 两条端到端剧本**（核心证据）→
> **E 论点亲眼观察 + 不变量复核**。A 段任何机器都能跑；B–E 需要 **Base Sepolia +
> CDP 密钥 + 有 gas 的钱包**。

---

## ⛔ 执行环境（贯穿全程）

- 工具链（Node/npm/forge/ponder/convex）**只在 WSL Ubuntu 内跑**（**Node
  24**：`nvm use 24`，已设为 nvm 默认）。git 用 Windows 原生。Node 24 已端到端验证：Convex（tsc +
  economy jest）、各服务（tsc + vitest）、`@coinbase/cdp-sdk`（其自身要求 Node ≥ 19）均干净通过。
- **代理**：若你在需经本地代理（如
  `HTTPS_PROXY=http://127.0.0.1:10808`）才能访问外网/Coinbase 的网络下，执行器入口已用
  **global-agent** 自动把 http/https 走代理、且对 `127.0.0.1`/`localhost` 直连（CDP
  SDK 用 axios，其自带 env 代理无法对 HTTPS 做 CONNECT，会报
  `plain HTTP ... HTTPS port`）。其余服务（gateway/indexer/convex）如遇同类报错可参照处理。
- 每个服务是**隔离子工程**（各自
  `npm install`）：`services/gateway`(:8402)、`services/facilitator`(:8403)、`services/executor`(:8404)、`services/indexer`(:42069)、`services/e2e`、`contracts/`、`convex/`(+
  Vite 前端)、Ollama(:11434)。
- 真链 = **Base Sepolia**（CAIP-2 `eip155:84532`）。USDC =
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e`（Circle 测试网，6dec）。
- 区块浏览器：`https://sepolia.basescan.org`（用来肉眼核对 USDC 转账 / AgentDied 事件）。

---

## A. 静态验证（无需真链 — 先把这段全勾上）

> 每条在对应子目录用 WSL Node 24 跑。期望数字是 SP1 完成态的实测值。

- [✓] **合约（Foundry）**：`cd contracts && forge test` → **16 passed**（MockUSDC 2 + AgentToken 8 +
  AgentRegistry 4 + LaunchpadFactory 2）
- [✓] **网关**：`cd services/gateway && npm install && npx vitest run` → **33
  passed**；`npm run typecheck` 干净
- [✓] **执行器**：`cd services/executor && npm install && npx vitest run` → **48
  passed**；`npm run typecheck` 干净
- [✓] **索引器**：`cd services/indexer && npm install && npx vitest run` → **2
  passed**；`npm run typecheck`（= `tsc --noEmit`）干净⚠ Ponder 0.11 **没有** `ponder typecheck`
  子命令；用 `npm run typecheck`。
- [✓] **e2e 助手**：`cd services/e2e && npm install && npx vitest run` → **3
  passed**；`npm run typecheck` 干净
- [✓] **Convex 经济模块（Jest）**：仓库根
  `NODE_OPTIONS=--experimental-vm-modules npx jest convex/economy` → **33 passed（6
  suites）**；`npx tsc -p convex --noEmit` 干净 ⚠ 根 `npm test` 会顺带扫到 `contracts/lib` 与
  `services/*` 的非-Jest 测试并「加载失败」，但**退出码 0**——这是预存现象（计划 4 起就有）。验收只看
  `jest convex/economy` 的 33 全绿即可。

**A 段通过判据**：以上全部数字对得上、两类 typecheck 干净。这证明所有纯逻辑 + 接口契约是对的，与真链无关。

---

## B. 上链准备（部署合约 + 起全栈 + 资金）

> 这是最繁琐的一段，按顺序来。**先理解钱包拓扑**：
>
> - **CDP 智能账户**（每居民一个）= `AgentRegistry.wallet`，持 USDC、买/卖/转、受护栏，gasless。
> - **CDP EOA**（每居民一个）= x402 付款方，持可花的 USDC；`energy = EOA USDC / costPerThink`。
> - **keeper 钱包**（裸私钥）= 判死后上链调 `markDead`，需 Base Sepolia ETH。
> - **settler 钱包**（facilitator 的 `EVM_PRIVATE_KEY`）= 批量 `/settle` 上链，需 Base Sepolia ETH。
> - **deployer 钱包** = 部署合约，需 Base Sepolia ETH。

### B1. 取得 CDP 居民钱包地址（先于部署）

- [✓] 在 [CDP Portal](https://portal.cdp.coinbase.com) 建 API key + wallet secret，拿到
  `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` / `CDP_WALLET_SECRET`。
- [✓] 在 `services/executor/.env` 填 CDP 三件套 + `RPC_URL_BASE_SEPOLIA`（`AGENT_0_*` 可先留 `0x...`
  占位，取地址脚本不依赖它们）。
- [✓] 跑 `cd services/executor && npm run accounts`（Node 24）——它按名字 `trumantown-agent-0-eoa` /
  `trumantown-agent-0-smart` **取/建**居民 0 的 CDP EOA + 智能账户，并直接打印 `AGENT_0_EOA=0x…` /
  `AGENT_0_SMART_ACCOUNT=0x…` 两行（幂等，可重复跑）。⚠ 不要用 `npm run start`
  来「顺便建账户」：执行器启动时先读 `AGENT_0_*`（无默认值）才轮到建账户，是先有鸡先有蛋；建账户的
  `ensureAgent` 又是懒触发，光启动并不会建。用专用的 `npm run accounts`。
- [✓] 把打印的两行粘进 `.env`，记下：**`AGENT_0_SMART_ACCOUNT`**（智能账户）与 **`AGENT_0_EOA`**。

### B2. 部署合约 + 发币（计划 1）

- [✓] `cd contracts`，设置 env：`DEPLOYER_PRIVATE_KEY`（已充 Base Sepolia
  ETH）、`KEEPER_ADDRESS`（= 你 keeper 钱包的地址，必须与执行器的 `KEEPER_PRIVATE_KEY`
  对应）、`USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e`、`BASE_SEPOLIA_RPC_URL`。
- [✓] 部署：`forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast`
  → 记下打印的 **`AgentRegistry`** 与 **`LaunchpadFactory`** 地址（USDC 用 Circle 的，不自部署）。
- [✓] 发居民 0（`wallet` 传 **B1 的智能账户地址**）：
  `bash     cast send <FACTORY> \       "spawnAgent(string,string,address,uint256,uint256,uint256)" \       "Alice Coin" "ALICE" <AGENT_0_SMART_ACCOUNT> 10000 0 10 \       --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY     `
  参数：`costPerThink=10000`（0.01
  USDC）、`floor=0`（让 energy 作为唯一死亡驱动，最利于演示死亡）、`recoveryWindow=10`（T）。
- [✓] 取回 **agentId=0** 与 **token 地址**（读 `AgentRegistry.agents(0)` 或 `AgentSpawned`
  事件）→ 记为 **`AGENT_0_TOKEN`**。
  `bash     cast call <REGISTRY_ADDRESS> \     "agents(uint256)(address,address,uint256,uint256,uint256,bool)" \     0 \     --rpc-url https://sepolia.base.org     `
- [✓] 记下部署所在 **区块号** → `START_BLOCK`（缩短 Ponder 回填范围）。

> ⚠ **修正记录（2026-06-05）**：首版部署时 `contracts/.env` 漏填 `USDC_ADDRESS`，`Deploy.s.sol`
> 退化为自部署 **MockUSDC**（`0x2f83…`）并把 factory/token 绑到它——与执行器/CDP faucet/x402 用的
> **Circle USDC**（`0x036C…`）不一致，导致 `buy` 的 `transferFrom`
> 直接 revert，且复活剧本经济上不成立（卖币得到的是 MockUSDC，付不了用 Circle
> USDC 计价的思考）。已**取消注释 `USDC_ADDRESS=0x036C…` 重新部署**：新
> **AgentRegistry=`0xDc4d6521226F1F2ED5E3Ff8D5edF668F256162a6`**、
> **LaunchpadFactory=`0x5568f7c39874342F66fA1E0876539A6FC94641ce`**、重新 spawn 后
> **AGENT_0_TOKEN=`0xAB2ec7B5c994503284f3Dbf7c21EFc5BCE53514b`**（`usdc()` 已是 Circle）、
> **`START_BLOCK=42426508`**。已同步 `services/executor/.env` `services/indexer/.env` >
> `services/gateway/.env`。另修复两个真 bug：`keeperSigner` 现接受无 `0x` 前缀的私钥；`buy` 的
> `approve+buy` 改为**单个 ERC-4337 user op**（原先两个连发 → `AA25 invalid account nonce`）。

### B3. 资金（缺一不可）

- [✓] **keeper 钱包**：充 Base Sepolia ETH（付 markDead 的 gas）。
- [✓] **settler 钱包**（facilitator `EVM_PRIVATE_KEY`）：充 Base Sepolia ETH（付 settle 的 gas）。
- [✓] **居民智能账户**：充 USDC（用 CDP faucet 或执行器
  `POST /actions/fund {agentId:"0",target:"smart",asset:"usdc"}`）——复活剧本要它有 USDC 去买自己的币。✅
  `fund target=smart` → `smartUsdc` 0 → **1000000**（CDP faucet 给 1 USDC）。
- [✓] **居民智能账户买自有币**（为复活剧本备「可卖的币」）：执行器
  `POST /actions/buy {agentId:"0", usdcIn:"<额度>", minTokensOut:"0"}`，确认 `GET /balances/0` 的
  `tokenBalance > 0`。✅ `buy usdcIn=500000` → `tokenBalance` =
  **333333333333333333333334**（>0）、`smartUsdc` 1.0→0.5、`marketCap` 0→333333；链上
  `AgentToken.usdcReserve=500000`、`AgentToken.usdc()=Circle USDC`。
- [✓] **居民 EOA**：正常思考演示时充 USDC（faucet 或
  `/actions/fund {target:"eoa"}`）；做**复活/死亡剧本时反而要它「破产」**（<
  costPerThink）——届时别充。✅ 现保持**破产**（`eoaUsdc=0`），正是复活/死亡剧本的前置；fund-EOA 机制与 fund-smart 同一路径（`wallet.fund→faucetTo`，仅目标地址不同），已由上面
  `target=smart` 实证。正常思考演示前再 `fund target=eoa` 即可。

#### B3′. 自行验证指令（copy-paste，在 WSL 里跑）

> 前提：执行器已在 `:8404` 跑。没起的话，在 WSL 里：
> `cd "/mnt/d/AI Agent/ai-town-web3/services/executor" && nvm use 24 && npm run start` （`/mnt/d`
> 上 tsx 冷启动约 30–40s，等打印 `[executor] AgentKit/CDP on :8404` 再跑下面的 curl）。
> **所有 curl 都加 `--noproxy '*'`**——本机设了
> `HTTP(S)_PROXY=http://127.0.0.1:10808`（CDP 出网要用它），不绕过的话连 `127.0.0.1:8404`
> 会被代理拦成 `503`。`fund`/`buy` 返回的 `txHash` 其实是 ERC-4337 的
> **userOpHash**（不是普通交易哈希）；要在 basescan 核对就看**智能账户地址** `0x9Bc3…`
> 的 activity，别直接查这个 hash。

```bash
# 0) 先确认执行器活着（没有就去 B4 起它）
curl -s --noproxy '*' http://127.0.0.1:8404/healthz            # 期望 {"ok":true}

# 0') 看基线余额（六位小数：1 USDC = 1000000；token 18 位小数）
curl -s --noproxy '*' http://127.0.0.1:8404/balances/0; echo

# 1) 居民智能账户充 USDC（CDP faucet 一次给 1 USDC = 1000000）
curl -s --noproxy '*' -X POST http://127.0.0.1:8404/actions/fund \
  -H 'content-type: application/json' \
  -d '{"agentId":"0","target":"smart","asset":"usdc"}'; echo
#   等几秒后确认 smartUsdc 增加：
curl -s --noproxy '*' http://127.0.0.1:8404/balances/0; echo
#   期望：{"...","smartUsdc":"1000000",...}

# 2) 智能账户买自有币（usdcIn 单位是 6dec 原子；500000 = 0.5 USDC；上限 MAX_USDC_PER_TX=5000000）
curl -s --noproxy '*' -X POST http://127.0.0.1:8404/actions/buy \
  -H 'content-type: application/json' \
  -d '{"agentId":"0","usdcIn":"500000","minTokensOut":"0"}'; echo
#   等几秒（approve+buy 一个 user op 上链）后确认 tokenBalance>0：
curl -s --noproxy '*' http://127.0.0.1:8404/balances/0; echo
#   期望：tokenBalance 变成一个很大的数（18dec），marketCap、usdcReserve 同步>0

# 3) 居民 EOA 充 USDC —— 仅「正常思考演示」时做；跑复活/死亡剧本前务必让它保持破产(eoaUsdc=0)，别充
curl -s --noproxy '*' -X POST http://127.0.0.1:8404/actions/fund \
  -H 'content-type: application/json' \
  -d '{"agentId":"0","target":"eoa","asset":"usdc"}'; echo
curl -s --noproxy '*' http://127.0.0.1:8404/balances/0; echo   # 期望 eoaUsdc>0（演示用）
```

可选——**直接读链核对**（forge/cast 走直连，先 `unset HTTP_PROXY HTTPS_PROXY`）：

```bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
RPC=https://sepolia.base.org
TOKEN=0xAB2ec7B5c994503284f3Dbf7c21EFc5BCE53514b
SMART=0x9Bc388e650d855120d7723dF0Ab1e6E1135b52c9
cast call $TOKEN "usdc()(address)"            --rpc-url $RPC   # 必须 = 0x036CbD…（Circle USDC）
cast call $TOKEN "usdcReserve()(uint256)"     --rpc-url $RPC   # 买入后 = 你花掉的 USDC（如 500000）
cast call $TOKEN "balanceOf(address)(uint256)" $SMART --rpc-url $RPC   # 智能账户持币 = tokenBalance
```

> 想要更多/更大额测试币（CDP faucet 单次只 1 USDC 且限频）：去 `https://faucet.circle.com`（选 Base
> Sepolia）领，或从自有钱包把 `0x036CbD53842c5426634e7929541eC2318f3dCF7e` 这枚 USDC 直接 `transfer`
> 到 `0x9Bc3…`(smart) / `0x3b3B…`(eoa)。同一枚真 USDC，**不用改任何配置**，`/balances/0` 立刻可见。

### B4. 起全栈（WSL，各开一个终端）

- [✓] **Ollama**：`ollama serve`（:11434）+ 拉模型（ai-town 用的模型，如 `ollama pull llama3`）。
- [✓] **facilitator**（:8403）：按 `services/facilitator/README.md` clone fork +
  `cp .env.example .env` 填 `EVM_PRIVATE_KEY`(settler) +
  `RPC_URL_BASE_SEPOLIA`，`PORT=8403 npx tsx --env-file=.env src/index.ts`。
- [✓] **网关**（:8402）：`services/gateway/.env` 设
  `GATEWAY_TREASURY_ADDRESS`、`FACILITATOR_URL=http://127.0.0.1:8403/facilitator`、`X402_NETWORK=eip155:84532`、`GATEWAY_USE_REGISTRY=1`、`REGISTRY_ADDRESS`、`RPC_URL_BASE_SEPOLIA`、`AGENT_IDS=0`；`npm run start`。
- [✓] **执行器**（:8404）：`services/executor/.env` 补齐
  `AGENT_0_SMART_ACCOUNT/AGENT_0_EOA/AGENT_0_TOKEN`、`USDC_ADDRESS`、`RPC_URL_BASE_SEPOLIA`、CDP 三件套、`MAX_USDC_PER_TX`、`EXECUTOR_USE_REGISTRY=1`、`REGISTRY_ADDRESS`、`KEEPER_PRIVATE_KEY`、`AGENT_IDS=0`；`npm run start`。
- [✓] **索引器**（:42069）：`services/indexer/.env` 设
  `PONDER_RPC_URL_84532`、`FACTORY_ADDRESS`、`REGISTRY_ADDRESS`、`USDC_ADDRESS`、`START_BLOCK`；`npm run dev`，等它回填到最新块。
- [✓] **Convex + 前端**：Convex env 设
  `TRUMANTOWN_ECONOMY=1`、`OLLAMA_HOST=http://127.0.0.1:8402`、`EXECUTOR_URL=http://127.0.0.1:8404`、`PONDER_URL=http://127.0.0.1:42069`、`DEFAULT_AGENT_ID=0`、`AGENT_0_EOA=<EOA>`、`TRUMANTOWN_KEEPER=1`（要看死亡上链则开）；`npm run dev`（convex
  dev + vite）。

**B 段通过判据**：6 个进程都在跑，合约已部署、居民 0 已发币、四类钱包按上面充好。

---

## C. 单服务冒烟（确认每个接缝在真链上活着）

- [✓] **facilitator 版本/网络**：`curl http://127.0.0.1:8403/facilitator/supported` → 含
  `{"x402Version":2,"scheme":"exact","network":"eip155:84532"}`。
- [✓] **索引器读 API**：`cd services/indexer && PONDER_URL=http://127.0.0.1:42069 npm run smoke` →
  `/healthz` ok 且 `/agents/0` 返回 Standing 聚合（`costPerThink/marketCap/tokenBalance/alive`
  等字段齐全）。
- [✓]
  **执行器 LIVE 冒烟（真 CDP 签名 → 真 /verify）**：`cd services/executor && npm run live:verify`
  → 打印 `x402Version in payload: 2` 且
  `facilitator /verify -> { isValid: true }`。（EOA 需有一点 USDC；不足会提示先 fund。）
- [✓]
  **网关 ↔ 真 facilitator 全链路 v2**：`cd services/gateway && npx tsx --env-file=.env test/live/facilitator.live.ts`
  → `402 → 执行器签名 → 200`；日志提示 settle 已入队。随后去 basescan 看 settler 钱包发出的 USDC
  settle 交易。
- [✓] **反伪造（关键安全属性）**：对网关发一个**未注册**的 agentId，确认拿不到便宜/免费推理：
  `bash     curl -s -X POST http://127.0.0.1:8402/v1/chat/completions \       -H "content-type: application/json" -H "X-Agent-Id: 999" \       -d '{"model":"llama3","messages":[{"role":"user","content":"hi"}]}' -i | head -5     `
  → 期望 **402/500，无定价**（registry resolver 对未注册 id 返回 undefined）。再用 `X-Agent-Id: 0`
  对比，应正常 402+accepts。

**C 段通过判据**：四个冒烟全绿 + 反伪造确认。

---

## D. 两条端到端剧本（SP1 核心证据 — 最重要）

> 都在 `services/e2e/` 跑（`cp .env.example .env` 填端点 + 地址 +
> `CONVEX_URL`）。脚本 opt-in、未配齐即自动 SKIP。

### D① 复活：饥饿 → 卖币 + 扫款 → 恢复思考

- [✓] **前置**：居民智能账户**持有 AgentToken**（B3 已买）、**EOA 破产**（<
  costPerThink，别充 EOA）。
- [✓] 跑：`cd services/e2e && npm run e2e:revive`
- [✓] **期望日志**：`sign -> insufficient_funds`（破产）→ `sell ->`（卖光自有币）→
  `transfer smart->eoa ->`（USDC 扫到 EOA）→ 重签 200 →
  `OK — starved agent sold its coin, swept USDC, and resumed thinking`。
- [✓] **去 basescan 核对**：AgentToken 的 `Sold` 事件 + USDC 从智能账户转到 EOA 的转账。
- [✓] **证明了什么**：自有币是把价值变现成 USDC 的**生命线**——没它，居民付不起思考。

### D② 死亡：饥饿 → 无人施救 → 连续 T 周期 → 链上判死

- [✓] **前置**：**EOA 破产 + tokenBalance=0**（先把币卖光/扫走/花掉，让它无可变现）。Convex env 已开
  `TRUMANTOWN_ECONOMY=1`、`TRUMANTOWN_E2E=1`、`TRUMANTOWN_KEEPER=1`，且 `RECOVERY_WINDOW` 与 e2e
  `.env` 的 `RECOVERY_WINDOW` 一致（默认 10）。
- [✓] 跑：`cd services/e2e && npm run e2e:death`
- [✓] **期望日志**：`tick 1..10` 里 `status` 由 `alive`→`starving`→…→在第 T 次变 `dead` →
  `AgentDied logs found: 1` → `OK — ... markDead + AgentDied confirmed on-chain`。
- [✓] **去 basescan 核对**：`AgentRegistry` 的 **`AgentDied(0)`** 事件；读 `agents(0)` 的
  `alive == false`。
- [✓] **去索引器核对**：`curl http://127.0.0.1:42069/agents/0` →
  `alive:false`、`marketCap:"0"`（Standing 归零）。
- [✓] **证明了什么**：付不起 = 想不了 = 死；死亡是**可验证的链上事实**。

**D 段通过判据**：两条脚本都打印
`OK`，且链上/索引器侧的事实（Sold/转账、AgentDied/alive=false/marketCap=0）都对得上。

---

## E. 论点亲眼观察 + 不变量复核

### E1. 「真·每次推理付费」亲眼看一遍（不靠脚本）

- [ ] 让居民正常活着（EOA 充够 USDC），在前端看它对话/思考。
- [ ] 每次「思考」= 一次 `POST /v1/chat/completions`：首次 402 → CDP EOA 用 x402 真实授权付
      `0.01 USDC` → facilitator 验款 → 反代 Ollama 返回。
- [ ] **去 basescan 核对**：每 N 次（批量结算）能看到 EOA → 网关金库的
      **真实 USDC 转账**。这就是「区块链 = AI 的新陈代谢」的硬证据。
- [ ] 观察 `energy = EOA USDC / costPerThink` 随思考递减；归零后若不卖币就停止产出（接缝短路
      `StarvationError`）。
- [ ] 观察 `Standing = marketCap`（曲线市值）：执行器 `/actions/buy` 回购自有币会推高它（Ponder
      `/agents/0` 的 `marketCap` 上升）。

### E2. 看数据（可选辅助）

- [ ] **Convex 数据**：在 Convex dashboard 看 `agentEconomy`
      表（`status/energy/marketCap/starvingPeriods/diedAt`），或用 gated `economy/e2e:getStatus`（需
      `TRUMANTOWN_E2E=1`）。
- [ ] **索引器数据**：`GET /agents`（全部居民）、`GET /agents/0`（单个 Standing 聚合）、Ponder 自带
      `/graphql`。

### E3. 不变量复核（SP1 外科手术式集成的边界）

- [ ] **引擎未被改动**：ai-town 的 tick/移动/记忆/对话流程行为与上游一致（经济只在
      `convex/util/llm.ts` 接缝 + 经济 cron 包了一层）。
- [ ] **门控默认关时行为不变**：不设 `TRUMANTOWN_ECONOMY` → `chatCompletion`
      直连 Ollama，与上游逐字节一致（A 段既有测试零回归即证此）。
- [ ] **反伪造**（C 段已测）：伪造/未注册/已死的 `X-Agent-Id`
      在网关与执行器都解析为「无」，拿不到便宜/免费推理。
- [ ] **冻结接口只增不改**：执行器 B′ 仅新增 `/actions/mark-dead`；网关 A / facilitator C / 链上 ABI
      / 计划 4 经济模块既有签名未变。

---

## 收官判定

- [ ] **A 段全绿** → 逻辑与契约正确。
- [ ] **C 段全绿** → 每个接缝在真链上活着 + 反伪造成立。
- [ ] **D① + D② 都 OK + 链上事实对得上** →
      SP1 的「缺一不可」论点端到端成立（付费才能思考 · 自有币是生命线 · 可验证死亡）。
- [ ] **E1 亲眼看到真实 USDC 上链** → 「代币经济 = 生命支持系统」被肉眼证实。
- [ ] **E3 不变量全部成立** → 集成是外科手术式、可继续叠加。

> 以上全部勾齐且你**主观满意整体效果**后，即可进入 **SP2**（L1 买卖 UI + 钱包连接 + PixiJS
> Energy/Standing 双仪表盘 + 抢救倒计时；见设计稿 §9）。SP2 在 SP1 的链上事实 + 索引器读 API 之上叠加前端互动，不改本切片的后端契约。

---

### 附：常见卡点速查

| 现象                                                   | 排查                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 执行器启动报 `missing env AGENT_0_SMART_ACCOUNT`       | `.env` 没被加载。执行器入口已 `import './loadEnv.js'`（内含 dotenv）自动读本目录 `.env`；确认在 `services/executor/` 下跑、`.env` 已填，首次取地址用 `npm run accounts`。（Node 18 无 `--env-file`，勿用该 flag。） |
| 执行器/CDP 报 `Node.js version 18.x is not supported`  | 落到了旧 Node。整个项目已统一 **Node 24**（`nvm use 24`，已设默认）；`@coinbase/cdp-sdk` 要 Node ≥ 19。                                                                                                             |
| CDP 调用报 `plain HTTP request was sent to HTTPS port` | 你在代理后面，axios 自带 env 代理对 HTTPS 不做 CONNECT。`loadEnv.ts` 已用 global-agent 修正——确认 `HTTPS_PROXY` 已设且经入口加载；本地 `127.0.0.1` 调用默认直连。                                                   |
| CDP 调用报 `EAI_AGAIN` / DNS 失败                      | 直连访问不到 `api.cdp.coinbase.com`，需经代理：设 `HTTPS_PROXY`（loadEnv 会用 global-agent 走它）。                                                                                                                 |
| 执行器 `/sign-payment` 一直 402                        | EOA USDC < costPerThink（破产）——正常；要思考就 fund EOA。                                                                                                                                                          |
| `live:verify` 返回 `isValid:false`                     | x402 v2 载荷/域不匹配——核对 facilitator `/supported` 是 v2/`eip155:84532` + executor `@x402/core`+`@x402/evm` 2.14.0。                                                                                              |
| 索引器 `/agents/0` 404                                 | 部署/spawn 后 Ponder 还没回填到该块；等几个块或检查 `START_BLOCK`/`FACTORY_ADDRESS`。                                                                                                                               |
| 死亡脚本 status 不变 dead                              | Convex 未开 `TRUMANTOWN_E2E=1`；或 EOA 没破产/还有币可卖；或 `RECOVERY_WINDOW` 两侧不一致。                                                                                                                         |
| markDead 没上链                                        | Convex 未开 `TRUMANTOWN_KEEPER=1`；或执行器 `KEEPER_PRIVATE_KEY` 未设/与 `KEEPER_ADDRESS` 不符/没 ETH。                                                                                                             |
| settle 没上链                                          | facilitator `EVM_PRIVATE_KEY`(settler) 没 Base Sepolia ETH；verify 即时不需 gas、settle 需要。                                                                                                                      |
| 网关对未知 id 仍给价                                   | 确认 `GATEWAY_USE_REGISTRY=1` 且 `REGISTRY_ADDRESS` 正确（registry resolver 才生效；否则回退静态 resolver）。                                                                                                       |
