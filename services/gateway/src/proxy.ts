import type { Request, Response, RequestHandler } from 'express';
import { Readable } from 'node:stream';

const HOP_BY_HOP = new Set([
  'host',
  'content-length',
  'connection',
  'x-payment',
  'x-agent-id',
]);

/**
 * Minimal streaming reverse proxy. Forwards to `target`, optionally injecting
 * an upstream API key (for non-Ollama providers like OpenAI-compatible APIs).
 * Strips hop-by-hop and TrumanTown-internal headers before forwarding.
 */
export function makeProxy(target: string, upstreamApiKey?: string): RequestHandler {
  const root = target.replace(/\/$/, '');
  return async (req: Request, res: Response) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k) && typeof v === 'string') headers[k] = v;
    }

    // Inject upstream API key if configured — replaces any Authorization from client
    if (upstreamApiKey) {
      headers['authorization'] = `Bearer ${upstreamApiKey}`;
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${root}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
        duplex: 'half',
      });
    } catch {
      res.status(502).json({ error: 'upstream unreachable' });
      return;
    }

    res.status(upstream.status);
    upstream.headers.forEach((val, key) => {
      if (key !== 'content-encoding' && key !== 'transfer-encoding') res.setHeader(key, val);
    });
    if (upstream.body) {
      const upstreamStream = Readable.fromWeb(
        upstream.body as Parameters<typeof Readable.fromWeb>[0],
      );
      upstreamStream.on('error', () => res.destroy());
      res.on('close', () => upstreamStream.destroy());
      upstreamStream.pipe(res);
    } else {
      res.end();
    }
  };
}
