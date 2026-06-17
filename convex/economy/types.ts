// Local mirror of the wire shapes the economy module passes through. The executor
// (Plan 3) and gateway (Plan 2) own the canonical types; we only forward them.

export interface PaymentRequirements {
  scheme: string; // "exact"
  network: string; // CAIP-2, e.g. "eip155:84532"
  maxAmountRequired: string; // atomic USDC (6dec) decimal string
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export interface AgentBalances {
  agentId: string;
  eoaUsdc: string; // atomic USDC (6dec) — `energy` source
  smartUsdc: string; // atomic USDC (6dec)
  tokenBalance: string; // atomic token (18dec) held by the smart account
  marketCap: string; // atomic USDC (6dec) — `Standing`
}

export type SignPaymentResult =
  | { ok: true; xPayment: string }
  | { ok: false; reason: string }; // "insufficient_funds" | other
