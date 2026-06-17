// One-off: drain agent 0's EOA USDC to an external address so the EOA goes "broke"
// (< costPerThink) for the D1 revive precondition — WITHOUT inflating the smart account
// (which would exceed the executor's 5-USDC transfer cap during the revive sweep).
// Direct CDP send (no executor guardrail). Faucets a little ETH first for gas.
import './src/loadEnv.js';
import { createPublicClient, http, getAddress } from 'viem';
import { baseSepolia } from 'viem/chains';
import { buildCdpHooks } from './src/cdpClient.js';

function env(n: string): string { const v = process.env[n]; if (!v) throw new Error('missing ' + n); return v; }

const usdc = env('USDC_ADDRESS');
const agent0 = { agentId: '0', smartAccount: env('AGENT_0_SMART_ACCOUNT'), eoa: env('AGENT_0_EOA'), token: env('AGENT_0_TOKEN') };
const SINK = '0xBa2103E1a323134653A40B2353712111Caa7A3Dc'; // treasury — external to the agent
const ERC20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

const pc = createPublicClient({ chain: baseSepolia, transport: http(env('RPC_URL_BASE_SEPOLIA')) });
const cdp = await buildCdpHooks({
  apiKeyId: env('CDP_API_KEY_ID'), apiKeySecret: env('CDP_API_KEY_SECRET'), walletSecret: env('CDP_WALLET_SECRET'),
  rpcUrl: env('RPC_URL_BASE_SEPOLIA'), agents: [agent0], usdcAddress: usdc,
});

const ethBal = await pc.getBalance({ address: getAddress(agent0.eoa) });
if (ethBal === 0n) {
  console.log('faucet ETH ->', await cdp.faucetTo(agent0.eoa, 'eth'));
  console.log('waiting 15s for ETH to land...');
  await new Promise((r) => setTimeout(r, 15000));
} else {
  console.log('EOA already has ETH:', ethBal.toString());
}

const bal = (await pc.readContract({ address: getAddress(usdc), abi: ERC20, functionName: 'balanceOf', args: [getAddress(agent0.eoa)] })) as bigint;
const keep = 5000n; // leave 0.005 USDC dust (< costPerThink 10000)
const amount = bal > keep ? bal - keep : 0n;
console.log(`EOA USDC=${bal}, draining ${amount} to ${SINK} (leaving ${keep})`);
if (amount > 0n) {
  console.log('drain tx ->', await cdp.sendEoaTransfer(agent0, SINK, amount));
} else {
  console.log('nothing to drain');
}
