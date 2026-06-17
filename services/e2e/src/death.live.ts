/**
 * Acceptance ② (Base Sepolia LIVE, opt-in): 饥饿 → 无人施救 → 连续 T 周期 → markDead + AgentDied.
 * Drives the Convex economic tick deterministically via the gated e2e action (TRUMANTOWN_E2E=1,
 * TRUMANTOWN_KEEPER=1 on the Convex deployment), then verifies the on-chain AgentDied event +
 * agents(id).alive == false. Preconditions: EOA broke AND no sellable token. Skips if unconfigured.
 */
import { ConvexHttpClient } from 'convex/browser';
import { createPublicClient, http, getAddress, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import { getBalances, summarizeBalances } from './lib.js';

const EXECUTOR = process.env.EXECUTOR_URL ?? 'http://127.0.0.1:8404';
const CONVEX_URL = process.env.CONVEX_URL;
const AGENT_ID = process.env.SMOKE_AGENT_ID ?? '0';
const REGISTRY = process.env.REGISTRY_ADDRESS;
const RPC = process.env.RPC_URL_BASE_SEPOLIA ?? 'https://sepolia.base.org';
const T = Number(process.env.RECOVERY_WINDOW ?? '10');

const REGISTRY_AGENTS_ABI = [
  {
    type: 'function',
    name: 'agents',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'wallet', type: 'address' },
      { name: 'costPerThink', type: 'uint256' },
      { name: 'floor', type: 'uint256' },
      { name: 'recoveryWindow', type: 'uint256' },
      { name: 'alive', type: 'bool' },
    ],
  },
] as const;

async function main() {
  if (!CONVEX_URL || !REGISTRY) {
    console.log('[death] SKIP — CONVEX_URL / REGISTRY_ADDRESS not set');
    return;
  }
  if (!(await fetch(`${EXECUTOR}/healthz`).then((r) => r.ok).catch(() => false))) {
    console.log(`[death] SKIP — executor not reachable at ${EXECUTOR}`);
    return;
  }

  const start = await getBalances(EXECUTOR, AGENT_ID);
  console.log('[death] start:', summarizeBalances(start));
  if (BigInt(start.tokenBalance) > 0n) {
    console.log(
      '[death] SKIP — agent still holds sellable token (would revive, not die). Sell/sweep/spend it first.',
    );
    return;
  }

  const convex = new ConvexHttpClient(CONVEX_URL, { skipConvexDeploymentUrlCheck: true });
  const client = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
  const fromBlock = await client.getBlockNumber();

  let status = 'alive';
  for (let i = 1; i <= T + 1 && status !== 'dead'; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await convex.action('economy/e2e:tickOnce' as any, {} as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (await convex.action('economy/e2e:getStatus' as any, {} as any)) as {
      status?: string;
      starvingPeriods?: number;
    } | null;
    status = row?.status ?? 'unknown';
    console.log(`[death] tick ${i}: status=${status} starvingPeriods=${row?.starvingPeriods}`);
  }
  if (status !== 'dead') throw new Error(`agent did not die after ${T + 1} ticks (status=${status})`);

  const agentDiedEvent = parseAbiItem('event AgentDied(uint256 indexed agentId)');
  // Public RPCs index tx receipts BEFORE log filters, so a getLogs issued the instant markDead
  // mines can return []. Poll a few times to ride out that eventual-consistency lag.
  let logs: Awaited<ReturnType<typeof client.getLogs>> = [];
  for (let attempt = 1; attempt <= 15; attempt++) {
    logs = await client.getLogs({
      address: getAddress(REGISTRY),
      event: agentDiedEvent,
      args: { agentId: BigInt(AGENT_ID) },
      fromBlock,
      toBlock: 'latest',
    });
    if (logs.length > 0) break;
    if (attempt < 15) {
      console.log(`[death] AgentDied not indexed yet (attempt ${attempt}); retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log('[death] AgentDied logs found:', logs.length);

  const a = (await client.readContract({
    address: getAddress(REGISTRY),
    abi: REGISTRY_AGENTS_ABI,
    functionName: 'agents',
    args: [BigInt(AGENT_ID)],
  })) as readonly [string, string, bigint, bigint, bigint, boolean];

  if (a[5] !== false) throw new Error('on-chain agent still alive after markDead');
  if (logs.length === 0) throw new Error('no AgentDied event emitted');
  console.log('[death] OK — starved with no rescue, died after T periods, markDead + AgentDied confirmed on-chain');
}

main().catch((e) => {
  console.error('[death] FAIL', e);
  process.exit(1);
});
