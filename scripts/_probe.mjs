// Validate the death script's AgentDied getLogs query returns the event now (recent window,
// within the RPC's 2000-block getLogs limit) — proves the retry fix would catch it once indexed.
import { createPublicClient, http, getAddress, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';

const REG = '0xDc4d6521226F1F2ED5E3Ff8D5edF668F256162a6';
const client = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org') });
const head = await client.getBlockNumber();
const fromBlock = head - 1800n; // stay under the public RPC's 2000-block getLogs cap
const logs = await client.getLogs({
  address: getAddress(REG),
  event: parseAbiItem('event AgentDied(uint256 indexed agentId)'),
  args: { agentId: 0n },
  fromBlock,
  toBlock: 'latest',
});
console.log(`AgentDied(0) logs found in [${fromBlock}..${head}]:`, logs.length);
for (const l of logs) console.log('  block', l.blockNumber, 'tx', l.transactionHash);
