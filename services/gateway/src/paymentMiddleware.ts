import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { X402_VERSION, decodePayment } from './x402.js';
import { buildPaymentRequirements, type PriceResolver } from './pricing.js';
import type { Facilitator } from './facilitatorClient.js';
import type { SettlementQueue } from './settlementQueue.js';

export interface PaymentMiddlewareDeps {
  resolve: PriceResolver;
  facilitator: Facilitator;
  queue: SettlementQueue;
  defaultAgentId: string;
}

export function paymentMiddleware(deps: PaymentMiddlewareDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const agentId = (req.header('x-agent-id') ?? deps.defaultAgentId).trim();
    const price = deps.resolve(agentId);
    if (!price) {
      res.status(500).json({ error: `no pricing configured for agent ${agentId}` });
      return;
    }

    // Use GATEWAY_EXTERNAL_URL if set — ensures the resource URL in the 402 challenge
    // is stable regardless of which hostname the caller used (host.docker.internal vs
    // 127.0.0.1 vs WSL IP). Facilitator verifies the signed resource matches exactly.
    const externalBase = process.env.GATEWAY_EXTERNAL_URL?.replace(/\/$/, '');
    const resource = externalBase
      ? `${externalBase}${req.originalUrl}`
      : `${req.protocol}://${req.get('host') ?? 'gateway'}${req.originalUrl}`;
    const requirements = buildPaymentRequirements(price, resource);

    const header = req.header('x-payment');
    if (!header) {
      res
        .status(402)
        .json({ x402Version: X402_VERSION, error: 'X-PAYMENT header is required', accepts: [requirements] });
      return;
    }

    let payload;
    try {
      payload = decodePayment(header);
    } catch {
      res
        .status(402)
        .json({ x402Version: X402_VERSION, error: 'malformed X-PAYMENT', accepts: [requirements] });
      return;
    }

    let verifyRes;
    try {
      verifyRes = await deps.facilitator.verify(payload, requirements);
    } catch {
      res.status(502).json({ error: 'facilitator verify failed' });
      return;
    }

    if (!verifyRes.isValid) {
      res.status(402).json({
        x402Version: X402_VERSION,
        error: verifyRes.invalidReason ?? 'payment invalid',
        accepts: [requirements],
      });
      return;
    }

    // Verified instantly; defer on-chain settlement to the batch queue.
    deps.queue.enqueue({ payload, requirements });
    res.setHeader(
      'x-payment-response',
      Buffer.from(JSON.stringify({ settlement: 'queued', payer: verifyRes.payer }), 'utf8').toString('base64'),
    );
    next();
  };
}
