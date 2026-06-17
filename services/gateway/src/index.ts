import 'dotenv/config';
import { createGateway } from './gateway.js';
import { staticResolver, type AgentPrice } from './pricing.js';
import { createRegistryResolver, viemRegistryReader } from './registryResolver.js';
import { httpFacilitator } from './facilitatorClient.js';
import { SettlementQueue, type QueueItem } from './settlementQueue.js';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

async function main() {
  const price: AgentPrice = {
    costPerThink: env('DEFAULT_COST_PER_THINK', '10000'),
    payTo: env('GATEWAY_TREASURY_ADDRESS'),
    asset: env('USDC_ADDRESS', '0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    network: env('X402_NETWORK', 'eip155:84532'),
  };

  const facilitator = httpFacilitator(env('FACILITATOR_URL', 'http://127.0.0.1:8403'));

  const queue = new SettlementQueue(facilitator, {
    maxBatch: Number(env('SETTLE_MAX_BATCH', '10')),
    maxWaitMs: Number(env('SETTLE_MAX_WAIT_MS', '60000')),
    onError: (err: unknown, item: QueueItem) =>
      console.error('[settle] failed for', item.payload.payload.signature, err),
  });

  let resolve = staticResolver({ '0': price }, price);
  if (process.env.GATEWAY_USE_REGISTRY === '1') {
    const reg = createRegistryResolver(
      viemRegistryReader(
        env('RPC_URL_BASE_SEPOLIA', 'https://sepolia.base.org'),
        env('REGISTRY_ADDRESS'),
      ),
      { payTo: price.payTo, asset: price.asset, network: price.network },
      (process.env.AGENT_IDS ?? '0').split(',').map((s) => s.trim()).filter(Boolean),
    );
    await reg.refresh();
    reg.start(Number(process.env.REGISTRY_REFRESH_MS ?? '30000'));
    resolve = reg.resolve;
  }

  const app = createGateway({
    resolve,
    facilitator,
    queue,
    ollamaUpstream: env('OLLAMA_UPSTREAM', 'http://127.0.0.1:11434'),
    upstreamApiKey: process.env.UPSTREAM_API_KEY,
    defaultAgentId: env('DEFAULT_AGENT_ID', '0'),
  });

  const port = Number(env('PORT', '8402'));
  app.listen(port, () => console.log(`[gateway] x402 metered inference on :${port}`));
}

main().catch((err) => { console.error('[gateway] fatal:', err); process.exit(1); });
