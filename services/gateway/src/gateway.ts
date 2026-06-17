import express, { type Express } from 'express';
import { paymentMiddleware } from './paymentMiddleware.js';
import { makeProxy } from './proxy.js';
import type { PriceResolver } from './pricing.js';
import type { Facilitator } from './facilitatorClient.js';
import type { SettlementQueue } from './settlementQueue.js';

export interface GatewayDeps {
  resolve: PriceResolver;
  facilitator: Facilitator;
  queue: SettlementQueue;
  ollamaUpstream: string;
  upstreamApiKey?: string;
  defaultAgentId: string;
}

export function createGateway(deps: GatewayDeps): Express {
  const app = express();
  const proxy = makeProxy(deps.ollamaUpstream, deps.upstreamApiKey);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // PAID: the only metered endpoint = one "think".
  app.use(
    '/v1/chat/completions',
    paymentMiddleware({
      resolve: deps.resolve,
      facilitator: deps.facilitator,
      queue: deps.queue,
      defaultAgentId: deps.defaultAgentId,
    }),
    proxy,
  );

  // FREE passthrough: embeddings (OpenAI-compat + Ollama native), moderation, native /api/*.
  app.use('/v1/embeddings', proxy);
  app.use('/v1/moderations', proxy);
  app.use('/api', proxy);

  return app;
}
