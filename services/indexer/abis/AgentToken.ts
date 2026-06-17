// Mirror of Plan 1 AgentToken (events + read fns the indexer needs).
export const AgentTokenAbi = [
  { type: 'event', name: 'Bought', inputs: [
    { name: 'buyer', type: 'address', indexed: true },
    { name: 'usdcIn', type: 'uint256', indexed: false },
    { name: 'tokensOut', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'Sold', inputs: [
    { name: 'seller', type: 'address', indexed: true },
    { name: 'tokensIn', type: 'uint256', indexed: false },
    { name: 'usdcOut', type: 'uint256', indexed: false },
  ] },
  { type: 'function', name: 'pricePerToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'marketCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'usdcReserve', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
