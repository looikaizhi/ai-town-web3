import { useAccount, useReadContract } from 'wagmi';
import { usePonderAgent } from './usePonderAgent';
import { usdcAbi, agentTokenAbi } from './abis';
import { USDC_ADDRESS } from './constants';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`;

/** Aggregates the read-side: Ponder standing (token addr, price, reserve, alive) + the
 *  connected wallet's USDC balance / allowance(token) / token balance. */
export function useAgentCoin(agentId: string) {
  const { address } = useAccount();
  const { data: standing, refetch: refetchStanding } = usePonderAgent(agentId);
  const token = standing?.token ?? ZERO_ADDR;

  const usdcBalance = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: [address ?? ZERO_ADDR],
    query: { enabled: !!address },
  });

  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'allowance',
    args: [address ?? ZERO_ADDR, token],
    query: { enabled: !!address && !!standing?.token },
  });

  const tokenBalance = useReadContract({
    address: token,
    abi: agentTokenAbi,
    functionName: 'balanceOf',
    args: [address ?? ZERO_ADDR],
    query: { enabled: !!address && !!standing?.token },
  });

  // The contract's OWN unsold supply = the curve's T (AgentToken mints maxSupply to
  // itself; pricePerToken reads balanceOf(address(this))). Read it live for accurate
  // buy/sell estimates instead of reconstructing T from the floored pricePerToken.
  const curveSupply = useReadContract({
    address: token,
    abi: agentTokenAbi,
    functionName: 'balanceOf',
    args: [token],
    query: { enabled: !!standing?.token },
  });

  const refetchAll = async () => {
    await Promise.all([
      refetchStanding(),
      usdcBalance.refetch(),
      allowance.refetch(),
      tokenBalance.refetch(),
      curveSupply.refetch(),
    ]);
  };

  return {
    address,
    standing,
    token: standing?.token,
    usdcBalance: (usdcBalance.data as bigint | undefined) ?? 0n,
    allowance: (allowance.data as bigint | undefined) ?? 0n,
    tokenBalance: (tokenBalance.data as bigint | undefined) ?? 0n,
    curveSupply: (curveSupply.data as bigint | undefined) ?? 0n,
    refetchAll,
  };
}
