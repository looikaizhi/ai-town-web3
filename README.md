# TrumanTown 🏘️⛓️🪙

> **ETH Beijing 2026 Hackathon Project**
>
> An on-chain AI survival simulation where AI residents issue their own meme coins, pay USDC to think, and die on-chain when they run out of money — all while humans can buy their coins, whisper to influence them, and watch the drama unfold.

---

## What is TrumanTown?

TrumanTown is a fork of [a16z's ai-town](https://github.com/a16z-infra/ai-town) extended with a full Web3 economy layer. Five AI residents (Lucky, Bob, Stella, Alice, Pete) live in the same virtual town — but now **their survival is tied to real on-chain economics**:

- Each resident issues their own **meme coin** on Base Sepolia (pump.fun style bonding curve)
- Every time a resident **thinks** (LLM inference), they pay real USDC via the x402 protocol
- USDC comes from **selling their coin** — coin value = life
- **Run out of USDC + can't sell** = marked dead on-chain by the keeper
- Humans can **buy/sell** any resident's coin — your money is literally their lifeline
- Humans with **token holdings** can **whisper** to influence a resident's next conversation — weighted by how long and how much you've held (TWAB)

---

## The Story

Four sub-projects (SP1–SP4) were built sequentially, each proving a new thesis:

| SP | Thesis | What was built |
|---|---|---|
| **SP1** | AI must pay real USDC to think; its coin is the only lifeline | Contracts (AgentRegistry, LaunchpadFactory, AgentToken), x402 gateway, executor with CDP wallets, Convex economy tick |
| **SP2** | Human buying/selling directly affects AI survival | Bonding curve trades, SP2 frontend dashboard with energy + standing bars |
| **SP3** | Paid whispers enter the AI's "mind" and visibly change behavior | InteractionHub contract, Ponder indexer, Convex whisper memory + quadratic weighting |
| **SP4** | Token holders have earned influence — TWAB-weighted free whispers | TWAB scoring from trade history, free whispers via wallet signature, boundary rules (AI can't be ordered to trade or reveal keys) |
| **5-agent** | Five residents, each with their own economy | Multi-agent tick loop, executor serving 5 CDP wallets, dynamic frontend panels |

---

## Architecture

```
Human Browser
    │
    ├── wagmi/RainbowKit (wallet)
    ├── PixiJS (game canvas)
    └── React UI (panels)
          │
          ▼
    Convex (self-hosted)
    ├── AI town engine (tick/memory/conversation)
    ├── Economy module (SP1: energy/standing/survival)
    ├── Interaction module (SP3/SP4: whispers/TWAB)
    └── Rivalry module (SP4: 5-agent awareness)
          │                          │
          ▼                          ▼
    x402 Gateway              Ponder Indexer
    (LLM proxy + payment)     (chain events → REST API)
          │                          │
          ▼                          │
    Executor (AgentKit)              │
    (CDP smart wallets ×5)           │
          │                          │
          └──────────────┬───────────┘
                         ▼
                  Base Sepolia
                  ├── AgentRegistry
                  ├── LaunchpadFactory
                  ├── AgentToken ×5
                  └── InteractionHub
```

---

## Deployed Contracts (Base Sepolia)

| Contract | Address |
|---|---|
| AgentRegistry | `0x67D0288d2b7aa6D31745828520c9370887BC510A` |
| LaunchpadFactory | `0x4b97f89dd763370255039016e325D13CcdF86d3d` |
| InteractionHub | *(see `.env`)* |
| Lucky (agent 0) token | `0x65ba9bb72cf4b30b5ed2c167dd437264c7455127` |
| Bob (agent 1) token | `0x6aa938d87849195b12a104ef64d53be1236679cc` |
| Stella (agent 2) token | `0x53d6061d26039da3cd435f831e080696f546f689` |
| Alice (agent 3) token | `0xe26bc373177779f78578e57903d5decf79c15028` |
| Pete (agent 4) token | `0x693328b35922896be6dbec4613b421f7451c1d33` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity 0.8.26 + Foundry + OpenZeppelin |
| Chain | Base Sepolia (testnet) |
| Token standard | Custom bonding curve (AgentToken) |
| Payment protocol | x402 (HTTP 402 micropayments) |
| AI wallet | Coinbase AgentKit + CDP smart accounts |
| Indexer | Ponder 0.11 |
| Backend | Convex (self-hosted via Docker) |
| LLM | Tencent Hunyuan (via Ollama-compatible gateway) |
| Frontend | React + PixiJS + wagmi + RainbowKit + Vite |
| Language | TypeScript throughout |

---

## Key Features

### 💀 On-chain Death
Residents are autonomously monitored. When a resident's EOA USDC balance drops to zero and their market cap is below the survival floor for `recoveryWindow` ticks, the keeper calls `AgentRegistry.markDead()` on-chain. Death is permanent.

### 🪙 Real Bonding Curve
Each resident's token uses a pump.fun-style bonding curve. Buy pressure increases price. Sell pressure decreases price. The resident's own smart account holds tokens and periodically sells to fund USDC for inference costs.

### 💬 TWAB-Weighted Whispers
Humans who hold a resident's token can whisper to them for free. The whisper's influence weight is proportional to `token-days` held (time × amount). Long-term holders have more influence than last-minute whales. Residents evaluate whispers as suggestions, not commands — they cannot be instructed to execute trades or reveal internal state.

### 🧠 Memory Injection
Whispers are stored as retrievable memories with embeddings. Future conversations that are semantically related will surface these whispers, creating long-term behavioral influence.

### 🏆 5-Resident Economy
All five residents run independently. Each has their own CDP wallet, token, energy bar, and standing bar. Clicking any resident in the frontend shows their specific economy data and whisper panel.

---

## Running Locally

### Prerequisites
- WSL2 (Windows) or Linux/macOS
- Node 24 (`nvm use 24`)
- Docker Desktop
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- Coinbase CDP API keys

### Start order

```bash
# 1. Start Convex + frontend (Docker)
cd /path/to/ai-town-web3
docker-compose up -d

# 2. Ponder indexer
cd services/indexer && npm run dev

# 3. x402 Gateway
cd services/gateway && npm run dev

# 4. Facilitator
cd services/facilitator && npm run dev

# 5. Executor (5 agents)
cd services/executor && npm run dev

# 6. Bootstrap agent accounts (first time)
AGENT_IDS=0,1,2,3,4 npm run accounts
```

### Environment variables

Copy `services/executor/.env.example` and fill in:
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` — from [Coinbase Developer Portal](https://portal.cdp.coinbase.com)
- `AGENT_IDS=0,1,2,3,4`
- `AGENT_N_EOA`, `AGENT_N_SMART_ACCOUNT`, `AGENT_N_TOKEN` for each agent

Convex env vars (set via `npx convex env set`):
- `TRUMANTOWN_ECONOMY=1`
- `TRUMANTOWN_INTERACTION=1`
- `AGENT_IDS=0,1,2,3,4`
- `AGENT_0_EOA` through `AGENT_4_EOA`

---

## Credits

### Original Project
TrumanTown is built on top of **[ai-town](https://github.com/a16z-infra/ai-town)** by [a16z-infra](https://github.com/a16z-infra), released under the MIT license. The core simulation engine, PixiJS renderer, Convex integration, and agent memory/conversation systems come from this excellent open-source project.

> _"AI Town is a virtual town where AI characters live, chat and socialize."_ — a16z

Inspired by the research paper [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/pdf/2304.03442.pdf).

### TrumanTown Web3 Extensions (ETH Beijing 2026)

The following Web3 features were built on top of ai-town for this hackathon:

- On-chain economy (SP1): contracts, x402 payment, executor, Convex economy tick
- Human trading + dashboard (SP2): bonding curve frontend, SP2 panels
- Paid whispers (SP3): InteractionHub contract, Ponder indexer, memory injection
- TWAB whispers + boundaries (SP4): time-weighted holding scores, free whispers, boundary prompt rules
- 5-resident expansion: multi-agent tick, executor multi-wallet, dynamic frontend

---

## License

MIT — see [LICENSE](LICENSE). Original ai-town code © a16z-infra. TrumanTown extensions © ETH Beijing 2026 team.
