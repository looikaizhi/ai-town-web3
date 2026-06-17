export const AllianceRegistryAbi = [
  {
    type: 'event',
    name: 'AllianceProposed',
    inputs: [
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
      { name: 'message', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AllianceFormed',
    inputs: [
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AllianceDissolved',
    inputs: [
      { name: 'agentA', type: 'uint256', indexed: true },
      { name: 'agentB', type: 'uint256', indexed: true },
    ],
  },
] as const;
