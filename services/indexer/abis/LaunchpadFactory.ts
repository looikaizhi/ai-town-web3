// Mirror of Plan 1 LaunchpadFactory (AgentSpawned drives the AgentToken factory tracking).
export const LaunchpadFactoryAbi = [
  { type: 'event', name: 'AgentSpawned', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'token', type: 'address', indexed: false },
    { name: 'wallet', type: 'address', indexed: false },
  ] },
] as const;
