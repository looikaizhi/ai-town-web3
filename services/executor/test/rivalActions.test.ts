import { describe, it, expect, vi } from 'vitest';
import type { WalletProvider } from '../src/wallet.js';
import type { AgentConfig } from '../src/config.js';
import { buyRivalAction, sellRivalAction, type RivalActionsDeps } from '../src/rivalActions.js';
import { GuardrailError } from '../src/guardrails.js';

const cfg: AgentConfig = {
  agentId: '0',
  smartAccount: '0xSMART',
  eoa: '0xEOA',
  token: '0xTOKEN',
};

const mockWallet: WalletProvider = {
  getUsdcBalance: vi.fn().mockResolvedValue(1_000_000n),
  getTokenBalance: vi.fn().mockResolvedValue(0n),
  getMarketCap: vi.fn().mockResolvedValue(0n),
  buy: vi.fn().mockResolvedValue('0xTXHASH_BUY'),
  sell: vi.fn().mockResolvedValue('0xTXHASH_SELL'),
  transferUsdc: vi.fn().mockResolvedValue('0xTXHASH_TRANSFER'),
  fund: vi.fn().mockResolvedValue('0xTXHASH_FUND'),
};

const deps: RivalActionsDeps = {
  wallet: mockWallet,
  guardrails: {
    maxUsdcPerTx: 500_000n,
    allowedContracts: ['0xTARGET_TOKEN', '0xUSADC', '0xHUB'],
  },
  usdcAddress: '0xUSADC',
  interactionHubAddress: '0xHUB',
};

describe('buyRivalAction', () => {
  it('calls wallet.buy with rival token', async () => {
    const result = await buyRivalAction(deps, cfg, {
      rivalToken: '0xTARGET_TOKEN',
      usdcIn: 100_000n,
      minTokensOut: 0n,
    });
    expect(result.txHash).toBe('0xTXHASH_BUY');
    expect(mockWallet.buy).toHaveBeenCalledWith(cfg, '0xTARGET_TOKEN', 100_000n, 0n);
  });

  it('rejects if rivalToken not in allowlist', async () => {
    await expect(
      buyRivalAction(deps, cfg, { rivalToken: '0xUNKNOWN', usdcIn: 100_000n, minTokensOut: 0n }),
    ).rejects.toThrow(GuardrailError);
  });

  it('rejects if usdcIn exceeds maxUsdcPerTx', async () => {
    await expect(
      buyRivalAction(deps, cfg, { rivalToken: '0xTARGET_TOKEN', usdcIn: 600_000n, minTokensOut: 0n }),
    ).rejects.toThrow(GuardrailError);
  });
});

describe('sellRivalAction', () => {
  it('calls wallet.sell with rival token', async () => {
    const result = await sellRivalAction(deps, cfg, {
      rivalToken: '0xTARGET_TOKEN',
      tokensIn: 1_000n,
      minUsdcOut: 0n,
    });
    expect(result.txHash).toBe('0xTXHASH_SELL');
    expect(mockWallet.sell).toHaveBeenCalledWith(cfg, '0xTARGET_TOKEN', 1_000n, 0n);
  });

  it('rejects if rivalToken not in allowlist', async () => {
    await expect(
      sellRivalAction(deps, cfg, { rivalToken: '0xUNKNOWN', tokensIn: 1_000n, minUsdcOut: 0n }),
    ).rejects.toThrow(GuardrailError);
  });
});
