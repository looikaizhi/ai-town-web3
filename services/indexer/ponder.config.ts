import { createConfig, factory } from 'ponder';
import { http, getAbiItem } from 'viem';
import { AgentTokenAbi } from './abis/AgentToken';
import { LaunchpadFactoryAbi } from './abis/LaunchpadFactory';
import { AgentRegistryAbi } from './abis/AgentRegistry';
import { InteractionHubAbi } from './abis/InteractionHub';
import { AllianceRegistryAbi } from './abis/AllianceRegistry';

const startBlock = Number(process.env.START_BLOCK ?? '0');

// NOTE: Ponder 0.11 uses `chains` (not `networks`) and ChainConfig takes `id` + `rpc` (not `chainId` + `transport`).
// Contract config uses `chain` (not `network`).
export default createConfig({
  chains: {
    baseSepolia: {
      id: 84532,
      rpc: process.env.PONDER_RPC_URL_84532 ?? 'https://sepolia.base.org',
    },
  },
  contracts: {
    LaunchpadFactory: {
      chain: 'baseSepolia',
      abi: LaunchpadFactoryAbi,
      address: (process.env.FACTORY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      startBlock,
    },
    AgentRegistry: {
      chain: 'baseSepolia',
      abi: AgentRegistryAbi,
      address: (process.env.REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      startBlock,
    },
    AgentToken: {
      chain: 'baseSepolia',
      abi: AgentTokenAbi,
      // factory() tracks every token address emitted by the LaunchpadFactory's AgentSpawned.token parameter.
      address: factory({
        address: (process.env.FACTORY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
        event: getAbiItem({ abi: LaunchpadFactoryAbi, name: 'AgentSpawned' }),
        parameter: 'token',
      }),
      startBlock,
    },
    InteractionHub: {
      chain: 'baseSepolia',
      abi: InteractionHubAbi,
      address: (process.env.INTERACTION_HUB_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      startBlock,
    },
    AllianceRegistry: {
      chain: 'baseSepolia',
      abi: AllianceRegistryAbi,
      address: (process.env.ALLIANCE_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      startBlock,
    },
  },
});
