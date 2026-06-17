/**
 * Side-effect import that prepares the runtime environment for every executor entrypoint.
 * Import this FIRST (before any module that reads process.env or makes network calls):
 *
 *   import './loadEnv.js';
 *
 * 1. Loads `services/executor/.env` (Node 18 has no `--env-file`, and this tsx forwards that
 *    flag to node which rejects it — so we load via dotenv instead).
 * 2. If an HTTP(S) proxy is configured, routes Node's http/https through it via global-agent.
 *    Why: @coinbase/cdp-sdk talks to api.cdp.coinbase.com over axios; axios reads HTTP(S)_PROXY
 *    itself but fails to CONNECT-tunnel to HTTPS targets through the proxy ("plain HTTP request
 *    was sent to HTTPS port"). We move the proxy to GLOBAL_AGENT_HTTP_PROXY and remove the
 *    standard vars so axios falls back to Node's global agent, which global-agent patches to
 *    tunnel correctly. GLOBAL_AGENT_NO_PROXY keeps loopback calls (facilitator on 127.0.0.1)
 *    direct, while remote calls (CDP, Base Sepolia RPC) go through the proxy.
 *
 * NOTE: @coinbase/cdp-sdk requires Node >= 19 (it throws on Node 18 at CdpClient construction).
 * The whole repo runs on Node 24 (see CLAUDE.md), which satisfies this.
 */
import 'dotenv/config';
import { bootstrap } from 'global-agent';

const proxy =
  process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
if (proxy) {
  process.env.GLOBAL_AGENT_HTTP_PROXY = proxy;
  process.env.GLOBAL_AGENT_NO_PROXY = process.env.GLOBAL_AGENT_NO_PROXY ?? '127.0.0.1,localhost';
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  bootstrap();
  console.log(`[env] routing http(s) through proxy ${proxy} via global-agent (loopback stays direct)`);
}
