/**
 * One-shot CDP account address discovery (TrumanTown SP1 · checklist B1).
 *
 * Gets-or-creates resident 0's CDP EOA + smart account *by deterministic name* and prints
 * the two addresses ready to paste into `services/executor/.env`. Idempotent and safe to
 * re-run — `getOrCreate*` returns the existing accounts on subsequent calls.
 *
 * Why a standalone script (not `npm run start`): the executor reads AGENT_0_SMART_ACCOUNT /
 * AGENT_0_EOA at boot (before any CDP call), so it can't be the thing that discovers them —
 * chicken-and-egg. This script needs only the CDP creds, not the agent addresses.
 *
 *   cd services/executor && npm run accounts   # uses --env-file=.env
 *
 * Cloud-coupled, NOT unit-tested (same stance as cdpClient.ts) — proven by running it.
 */
import './loadEnv.js'; // load .env + route fetch through proxy (must be first)
import { CdpClient } from '@coinbase/cdp-sdk';
import { agentEoaName, agentSmartName } from './cdpClient.js';

function env(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`missing env ${name}`);
  return v;
}

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

main().catch((e) => {
  console.error('[accounts] failed', e);
  process.exit(1);
});
