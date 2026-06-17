# CLAUDE.md

楚门镇 / TrumanTown — an on-chain AI survival sim. A fork of a16z `ai-town`
(Convex + PixiJS generative agents) extended with Web3: each AI resident issues
its own meme coin, and the USDC it raises pays — via the x402 protocol — for the
LLM inference that keeps it "thinking." Coin value = life. See
`docs/superpowers/specs/2026-06-03-trumantown-sp1-design.md` for the locked design.

## ⛔ Runtime environment (HARD RULE)

This project runs ONLY on **WSL2 (Windows), Linux, or macOS**. The toolchain
(Node 24, Convex, Foundry/anvil, Ollama) is POSIX-targeted.

- **NEVER** run the toolchain under native Windows — not PowerShell, CMD, or
  MINGW/Git-Bash. It will break (paths, line endings, native modules).
- On a Windows host, operate **inside WSL**. If your shell is Windows-native,
  wrap every toolchain command:
  `wsl.exe bash -lc 'export PATH="$HOME/.foundry/bin:$PATH"; cd "/mnt/d/AI Agent/ai-town-web3" && <cmd>'`
- Author files with editors (Write/Edit), not shell heredocs/echo.
- Node must be **24** (`nvm use 24`; set as nvm default). Verified end-to-end:
  Convex (tsc + economy jest), executor (tsc + vitest), and `@coinbase/cdp-sdk`
  (which itself requires Node ≥ 19) all run cleanly on Node 24.
- Behind a proxy: `services/executor` auto-routes http/https through `HTTP(S)_PROXY`
  via global-agent (`src/loadEnv.ts`), keeping `127.0.0.1`/`localhost` direct — the
  CDP SDK uses axios, whose built-in env-proxy can't CONNECT-tunnel HTTPS.

## Repo layout

- `convex/` — ai-town backend: tick loop, memory, planning. **LLM calls funnel
  through `convex/util/llm.ts`** (the x402 integration seam).
- `src/` — PixiJS + React frontend (Vite).
- `contracts/` — Foundry sub-project (Solidity 0.8.26), **isolated** from the TS
  app. Web3 contracts live here only.
- `docs/superpowers/specs|plans/` — design spec + SP1 implementation plans.

## Tech stack

TypeScript · Convex · PixiJS/React/Vite · Ollama (local LLM) · Solidity/Foundry ·
Base Sepolia · x402 · Coinbase AgentKit + CDP smart wallet · Ponder indexer.

## Key commands

- App (frontend + backend): `npm run dev`  (needs Node 24; see runbooks in `docs/`)
- Contracts test: `cd contracts && forge test`
- Local chain: `anvil`   ·   Deploy: `forge script script/Deploy.s.sol ...`
- (On Windows host, run all of the above through `wsl.exe bash -lc '...'`.)
