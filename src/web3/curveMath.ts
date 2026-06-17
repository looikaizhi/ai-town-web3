// Pure bigint replicas of contracts/src/AgentToken.sol curve math. All amounts atomic.
// USDC 6dec, token 18dec. These compute client-side estimates + slippage floors.

export const VIRTUAL_RESERVE = 1_000_000n; // 1.0 USDC (6dec) virtual seed (pricing only)
export const ONE_E18 = 10n ** 18n;

export function effectiveReserve(usdcReserve: bigint): bigint {
  return usdcReserve < VIRTUAL_RESERVE ? VIRTUAL_RESERVE : usdcReserve;
}

/** tokensOut = T - (R*T)/(R+usdcIn). T (the contract's own unsold supply) is read live
 *  on-chain via balanceOf(tokenAddress) — see useAgentCoin — NOT reconstructed from the
 *  floored pricePerToken (which loses precision near bootstrap). */
export function estimateBuyTokensOut(usdcIn: bigint, usdcReserve: bigint, contractTokens: bigint): bigint {
  if (usdcIn <= 0n || contractTokens <= 0n) return 0n;
  const R = effectiveReserve(usdcReserve);
  const newT = (R * contractTokens) / (R + usdcIn);
  return contractTokens - newT;
}

/** usdcOut = min((R*tokensIn)/(T+tokensIn), usdcReserve). */
export function estimateSellUsdcOut(tokensIn: bigint, usdcReserve: bigint, contractTokens: bigint): bigint {
  if (tokensIn <= 0n) return 0n;
  const R = effectiveReserve(usdcReserve);
  let out = (R * tokensIn) / (contractTokens + tokensIn);
  if (out > usdcReserve) out = usdcReserve;
  return out;
}

/** minOut floor after slippage tolerance in basis points (100 = 1%). */
export function applySlippage(amountOut: bigint, toleranceBps: number): bigint {
  const clamped = Math.max(0, Math.min(10000, Math.round(toleranceBps)));
  return (amountOut * (10_000n - BigInt(clamped))) / 10_000n;
}
