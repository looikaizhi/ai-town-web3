export const InteractionHubAbi = [
  {
    type: 'event',
    name: 'Whispered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'text', type: 'string', indexed: false },
    ],
  },
] as const;
