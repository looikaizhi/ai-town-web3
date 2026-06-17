import { ponder } from 'ponder:registry';
import { agent, tokenIndex, trade, whisper, alliance } from 'ponder:schema';
import { AgentRegistryAbi } from '../abis/AgentRegistry';
import { AgentTokenAbi } from '../abis/AgentToken';

/**
 * Reads on-chain life params + latest curve snapshot for an agent.
 * Uses context.client.readContract (Ponder 0.11 ReadonlyClient viem action).
 */
async function readAgentState(
  context: { client: { readContract: Function }; contracts: { AgentRegistry: { address: `0x${string}` } } },
  agentId: bigint,
  token: `0x${string}`,
  wallet: `0x${string}`,
) {
  const [a, marketCap, pricePerToken, usdcReserve, tokenBalance] = await Promise.all([
    context.client.readContract({
      abi: AgentRegistryAbi,
      address: context.contracts.AgentRegistry.address,
      functionName: 'agents',
      args: [agentId],
    }),
    context.client.readContract({
      abi: AgentTokenAbi,
      address: token,
      functionName: 'marketCap',
      args: [],
    }),
    context.client.readContract({
      abi: AgentTokenAbi,
      address: token,
      functionName: 'pricePerToken',
      args: [],
    }),
    context.client.readContract({
      abi: AgentTokenAbi,
      address: token,
      functionName: 'usdcReserve',
      args: [],
    }),
    context.client.readContract({
      abi: AgentTokenAbi,
      address: token,
      functionName: 'balanceOf',
      args: [wallet],
    }),
  ]);

  // agents() returns a tuple: (token, wallet, costPerThink, floor, recoveryWindow, alive)
  const row = a as readonly [
    `0x${string}`,
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    boolean,
  ];

  return {
    costPerThink: row[2],
    floor: row[3],
    recoveryWindow: row[4],
    alive: row[5],
    marketCap: marketCap as bigint,
    pricePerToken: pricePerToken as bigint,
    usdcReserve: usdcReserve as bigint,
    tokenBalance: tokenBalance as bigint,
  };
}

// ---------------------------------------------------------------------------
// AgentRegistry:AgentRegistered
// Creates (or upserts) the agent row + populates the reverse-lookup tokenIndex.
// ---------------------------------------------------------------------------
ponder.on('AgentRegistry:AgentRegistered', async ({ event, context }) => {
  const id = event.args.agentId.toString();
  const token = event.args.token as `0x${string}`;
  const wallet = event.args.wallet as `0x${string}`;
  const s = await readAgentState(context, event.args.agentId, token, wallet);

  // Ponder 0.11: onConflictDoUpdate receives Partial<updateModel> (no PK) or a fn.
  await context.db
    .insert(agent)
    .values({
      id,
      token,
      wallet,
      costPerThink: s.costPerThink,
      floor: s.floor,
      recoveryWindow: s.recoveryWindow,
      alive: s.alive,
      marketCap: s.marketCap,
      pricePerToken: s.pricePerToken,
      usdcReserve: s.usdcReserve,
      tokenBalance: s.tokenBalance,
      spawnedAt: event.block.timestamp,
      diedAt: null,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      token,
      wallet,
      costPerThink: s.costPerThink,
      floor: s.floor,
      recoveryWindow: s.recoveryWindow,
      alive: s.alive,
      marketCap: s.marketCap,
      pricePerToken: s.pricePerToken,
      usdcReserve: s.usdcReserve,
      tokenBalance: s.tokenBalance,
      updatedAt: event.block.timestamp,
    });

  await context.db
    .insert(tokenIndex)
    .values({ id: token, agentId: id })
    .onConflictDoNothing();
});

// ---------------------------------------------------------------------------
// AgentRegistry:AgentDied
// Marks the agent dead and zeroes the market cap.
// ---------------------------------------------------------------------------
ponder.on('AgentRegistry:AgentDied', async ({ event, context }) => {
  const id = event.args.agentId.toString();
  // Intentional partial zero: marketCap collapses to 0 as the economic death
  // signal (standing = 0 means the agent can no longer pay for inference).
  // The on-chain curve fields (pricePerToken, usdcReserve, tokenBalance) are
  // NOT force-zeroed here — AgentRegistry.markDead only flips alive + emits
  // AgentDied; forced curve-zeroing is deferred to SP5.
  await context.db
    .update(agent, { id })
    .set({
      alive: false,
      diedAt: event.block.timestamp,
      marketCap: 0n,
      updatedAt: event.block.timestamp,
    });
});

// ---------------------------------------------------------------------------
// Trade helpers (Bought / Sold on every AgentToken instance)
// ---------------------------------------------------------------------------
async function onTrade(
  side: 'buy' | 'sell',
  event: {
    args: Record<string, unknown>;
    log: { address: string; logIndex: number };
    transaction: { hash: string };
    block: { number: bigint; timestamp: bigint };
  },
  context: any,
) {
  const token = event.log.address as `0x${string}`;
  const idx = await context.db.find(tokenIndex, { id: token });

  const usdc =
    side === 'buy'
      ? (event.args.usdcIn as bigint)
      : (event.args.usdcOut as bigint);
  const tokens =
    side === 'buy'
      ? (event.args.tokensOut as bigint)
      : (event.args.tokensIn as bigint);
  const actor = (
    side === 'buy' ? event.args.buyer : event.args.seller
  ) as `0x${string}`;

  // Append trade record.
  await context.db.insert(trade).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    agentId: idx?.agentId ?? null,
    token,
    side,
    actor,
    usdc,
    tokens,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  // Update agent curve snapshot.
  if (idx) {
    const [marketCap, pricePerToken, usdcReserve] = await Promise.all([
      context.client.readContract({
        abi: AgentTokenAbi,
        address: token,
        functionName: 'marketCap',
        args: [],
      }),
      context.client.readContract({
        abi: AgentTokenAbi,
        address: token,
        functionName: 'pricePerToken',
        args: [],
      }),
      context.client.readContract({
        abi: AgentTokenAbi,
        address: token,
        functionName: 'usdcReserve',
        args: [],
      }),
    ]);

    const row = await context.db.find(agent, { id: idx.agentId });
    const wallet = (row?.wallet ?? actor) as `0x${string}`;

    const tokenBalance = await context.client.readContract({
      abi: AgentTokenAbi,
      address: token,
      functionName: 'balanceOf',
      args: [wallet],
    });

    await context.db.update(agent, { id: idx.agentId }).set({
      marketCap: marketCap as bigint,
      pricePerToken: pricePerToken as bigint,
      usdcReserve: usdcReserve as bigint,
      tokenBalance: tokenBalance as bigint,
      updatedAt: event.block.timestamp,
    });
  }
}

ponder.on('AgentToken:Bought', async ({ event, context }) => {
  await onTrade('buy', event as any, context as any);
});

ponder.on('AgentToken:Sold', async ({ event, context }) => {
  await onTrade('sell', event as any, context as any);
});

// ---------------------------------------------------------------------------
// InteractionHub:Whispered (SP3)
// Append-only log of humans paying to inject context into a resident agent.
// ---------------------------------------------------------------------------
ponder.on('InteractionHub:Whispered', async ({ event, context }) => {
  await context.db.insert(whisper).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    agentId: event.args.agentId.toString(),
    sender: event.args.sender as `0x${string}`,
    amount: event.args.amount as bigint,
    text: event.args.text as string,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  }).onConflictDoNothing();
});

// ---------------------------------------------------------------------------
// AllianceRegistry events (SP4)
// ---------------------------------------------------------------------------
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
