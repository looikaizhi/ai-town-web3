import { useCallback, useState } from 'react';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { wagmiConfig } from './wagmi';
import { usdcAbi, agentTokenAbi } from './abis';
import { USDC_ADDRESS } from './constants';
import { humanizeTradeError } from './tradeError';

export type TradePhase = 'idle' | 'approving' | 'buying' | 'selling' | 'done' | 'error';

/** Drives the human-side trades. Buy is a two-step state machine (approve -> buy),
 *  auto-skipping approve when allowance already covers the spend. Sell is one step.
 *  `onSettled` runs after a confirmed receipt (caller refetches reads). */
export function useTrade(token: `0x${string}` | undefined, onSettled: () => void) {
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhase] = useState<TradePhase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setErrorMsg(null);
  }, []);

  const buy = useCallback(
    async (usdcIn: bigint, minTokensOut: bigint, currentAllowance: bigint) => {
      if (!token) return;
      setErrorMsg(null);
      try {
        if (currentAllowance < usdcIn) {
          setPhase('approving');
          const approveHash = await writeContractAsync({
            address: USDC_ADDRESS,
            abi: usdcAbi,
            functionName: 'approve',
            args: [token, usdcIn],
          });
          await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
        }
        setPhase('buying');
        const buyHash = await writeContractAsync({
          address: token,
          abi: agentTokenAbi,
          functionName: 'buy',
          args: [usdcIn, minTokensOut],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: buyHash });
        setPhase('done');
        onSettled();
      } catch (e) {
        setPhase('error');
        setErrorMsg(humanizeTradeError(e));
      }
    },
    [token, writeContractAsync, onSettled],
  );

  const sell = useCallback(
    async (tokensIn: bigint, minUsdcOut: bigint) => {
      if (!token) return;
      setErrorMsg(null);
      try {
        setPhase('selling');
        const hash = await writeContractAsync({
          address: token,
          abi: agentTokenAbi,
          functionName: 'sell',
          args: [tokensIn, minUsdcOut],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
        setPhase('done');
        onSettled();
      } catch (e) {
        setPhase('error');
        setErrorMsg(humanizeTradeError(e));
      }
    },
    [token, writeContractAsync, onSettled],
  );

  return { phase, errorMsg, buy, sell, reset };
}
