import { baseSepolia } from 'wagmi/chains';

export const CHAIN = baseSepolia;
export const CHAIN_ID = baseSepolia.id; // 84532

export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS ??
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e') as `0x${string}`;

export const PONDER_URL = ((import.meta.env.VITE_PONDER_URL as string) ?? 'http://127.0.0.1:42069')
  .replace(/\/$/, '');

export const WALLETCONNECT_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ??
  'demo') as string;

// SP1 single resident.
export const DEFAULT_AGENT_ID = '0';

export const INTERACTION_HUB_ADDRESS = (import.meta.env.VITE_INTERACTION_HUB_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;

// Default slippage tolerance (basis points). 100 = 1%.
export const DEFAULT_SLIPPAGE_BPS = 100;
