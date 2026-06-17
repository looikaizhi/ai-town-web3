import type { AgentConfig } from './config.js';
import type { WalletProvider } from './wallet.js';
import { GuardrailError, isAllowedContract, type GuardrailConfig } from './guardrails.js';

export interface RivalActionsDeps {
  wallet: WalletProvider;
  guardrails: GuardrailConfig;
  usdcAddress: string;
  interactionHubAddress: string;
}

/** 买对方代币（护盟 or 拉涨）——复用 SP1 执行器已有的 wallet.buy 路径 */
export async function buyRivalAction(
  deps: RivalActionsDeps,
  cfg: AgentConfig,
  args: { rivalToken: string; usdcIn: bigint; minTokensOut: bigint },
): Promise<{ txHash: string }> {
  if (!isAllowedContract(deps.guardrails, args.rivalToken)) {
    throw new GuardrailError(`rival token ${args.rivalToken} not in allowlist`);
  }
  if (args.usdcIn > deps.guardrails.maxUsdcPerTx) {
    throw new GuardrailError(`usdcIn ${args.usdcIn} exceeds per-tx cap ${deps.guardrails.maxUsdcPerTx}`);
  }
  const txHash = await deps.wallet.buy(cfg, args.rivalToken, args.usdcIn, args.minTokensOut);
  return { txHash };
}

/** 卖对方代币（攻击 / 退出）——复用 SP1 执行器已有的 wallet.sell 路径 */
export async function sellRivalAction(
  deps: RivalActionsDeps,
  cfg: AgentConfig,
  args: { rivalToken: string; tokensIn: bigint; minUsdcOut: bigint },
): Promise<{ txHash: string }> {
  if (!isAllowedContract(deps.guardrails, args.rivalToken)) {
    throw new GuardrailError(`rival token ${args.rivalToken} not in allowlist`);
  }
  const txHash = await deps.wallet.sell(cfg, args.rivalToken, args.tokensIn, args.minUsdcOut);
  return { txHash };
}
