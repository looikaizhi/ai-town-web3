// Mirror of Plan 1 AgentRegistry (events + agents(id) read for life params).
export const AgentRegistryAbi = [
  { type: 'event', name: 'AgentRegistered', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'token', type: 'address', indexed: false },
    { name: 'wallet', type: 'address', indexed: false },
  ] },
  { type: 'event', name: 'AgentDied', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
  ] },
  { type: 'function', name: 'agents', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [
    { name: 'token', type: 'address' },
    { name: 'wallet', type: 'address' },
    { name: 'costPerThink', type: 'uint256' },
    { name: 'floor', type: 'uint256' },
    { name: 'recoveryWindow', type: 'uint256' },
    { name: 'alive', type: 'bool' },
  ] },
] as const;
