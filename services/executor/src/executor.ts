import express, { type Request, type Response } from 'express';
import type { AgentResolver } from './config.js';
import type { WalletProvider } from './wallet.js';
import type { PaymentSigner } from './paymentSigner.js';
import { GuardrailError, type GuardrailConfig } from './guardrails.js';
import { signPaymentForAgent } from './signPayment.js';
import { buyAction, sellAction, transferAction, type ActionsDeps } from './actions.js';
import { buyRivalAction, sellRivalAction, type RivalActionsDeps } from './rivalActions.js';
import { readBalances } from './balances.js';
import { markDeadForAgent } from './keeper.js';

export interface ExecutorDeps {
  resolve: AgentResolver;
  wallet: WalletProvider;
  signer: PaymentSigner;
  guardrails: GuardrailConfig;
  usdcAddress: string;
  interactionHubAddress?: string;
  markDead?: (agentId: string) => Promise<string>;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function parseBig(v: unknown, field: string): bigint {
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new HttpError(400, `${field} must be a decimal string`);
  }
  try {
    return BigInt(v);
  } catch {
    throw new HttpError(400, `${field} is not a valid integer`);
  }
}

function fail(res: Response, e: unknown): void {
  if (e instanceof GuardrailError) {
    res.status(403).json({ error: e.message });
  } else if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message });
  } else {
    res.status(500).json({ error: (e as Error).message });
  }
}

export function createExecutor(deps: ExecutorDeps): express.Express {
  const app = express();
  app.use(express.json());

  const actionsDeps: ActionsDeps = {
    wallet: deps.wallet,
    guardrails: deps.guardrails,
    usdcAddress: deps.usdcAddress,
  };

  const rivalDeps: RivalActionsDeps = {
    wallet: deps.wallet,
    guardrails: deps.guardrails,
    usdcAddress: deps.usdcAddress,
    interactionHubAddress: deps.interactionHubAddress ?? '',
  };

  const mustResolve = (agentId: unknown) => {
    if (typeof agentId !== 'string' || agentId.length === 0) {
      throw new HttpError(400, 'agentId required');
    }
    const cfg = deps.resolve(agentId);
    if (!cfg) throw new HttpError(404, `unknown agent ${agentId}`);
    return cfg;
  };

  app.get('/healthz', (_req: Request, res: Response) => res.json({ ok: true }));

  app.post('/sign-payment', async (req: Request, res: Response) => {
    try {
      const { agentId, paymentRequirements } = req.body ?? {};
      if (typeof agentId !== 'string' || agentId.length === 0) {
        res.status(400).json({ error: 'agentId required' });
        return;
      }
      const result = await signPaymentForAgent(deps, agentId, paymentRequirements);
      if (result.ok) {
        res.status(200).json({ xPayment: result.xPayment });
        return;
      }
      res.status(result.status).json({ error: result.error });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/buy', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const out = await buyAction(actionsDeps, cfg, {
        token: req.body.token,
        usdcIn: parseBig(req.body.usdcIn, 'usdcIn'),
        minTokensOut: parseBig(req.body.minTokensOut ?? '0', 'minTokensOut'),
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/sell', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const out = await sellAction(actionsDeps, cfg, {
        token: req.body.token,
        tokensIn: parseBig(req.body.tokensIn, 'tokensIn'),
        minUsdcOut: parseBig(req.body.minUsdcOut ?? '0', 'minUsdcOut'),
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/transfer', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const source = req.body?.source;
      if (source !== 'smart' && source !== 'eoa') throw new HttpError(400, 'source must be "smart" or "eoa"');
      if (typeof req.body?.to !== 'string') throw new HttpError(400, 'to required');
      const out = await transferAction(actionsDeps, cfg, {
        source,
        to: req.body.to,
        amount: parseBig(req.body.amount, 'amount'),
      });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/fund', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      const target = req.body?.target;
      const asset = req.body?.asset;
      if (target !== 'eoa' && target !== 'smart') throw new HttpError(400, 'target must be "eoa" or "smart"');
      if (asset !== 'usdc' && asset !== 'eth') throw new HttpError(400, 'asset must be "usdc" or "eth"');
      const txHash = await deps.wallet.fund(cfg, target, asset);
      res.json({ txHash });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/mark-dead', async (req: Request, res: Response) => {
    try {
      const { agentId } = req.body ?? {};
      if (typeof agentId !== 'string' || agentId.length === 0) {
        res.status(400).json({ error: 'agentId required' });
        return;
      }
      const result = await markDeadForAgent({ resolve: deps.resolve, markDead: deps.markDead }, agentId);
      if (result.ok) { res.status(200).json({ txHash: result.txHash }); return; }
      res.status(result.status).json({ error: result.error });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/actions/buy-rival', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      if (typeof req.body?.rivalToken !== 'string') throw new HttpError(400, 'rivalToken required');
      const out = await buyRivalAction(rivalDeps, cfg, {
        rivalToken: req.body.rivalToken,
        usdcIn: parseBig(req.body.usdcIn, 'usdcIn'),
        minTokensOut: parseBig(req.body.minTokensOut ?? '0', 'minTokensOut'),
      });
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  app.post('/actions/sell-rival', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.body?.agentId);
      if (typeof req.body?.rivalToken !== 'string') throw new HttpError(400, 'rivalToken required');
      const out = await sellRivalAction(rivalDeps, cfg, {
        rivalToken: req.body.rivalToken,
        tokensIn: parseBig(req.body.tokensIn, 'tokensIn'),
        minUsdcOut: parseBig(req.body.minUsdcOut ?? '0', 'minUsdcOut'),
      });
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  app.get('/balances/:agentId', async (req: Request, res: Response) => {
    try {
      const cfg = mustResolve(req.params.agentId);
      res.json(await readBalances(deps.wallet, cfg));
    } catch (e) {
      fail(res, e);
    }
  });

  return app;
}
