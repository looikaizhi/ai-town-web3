export const WHISPER_TICK_SECONDS = 20; // poll cadence for new on-chain whispers
export const WHISPER_PROMPT_K = 3; // top-K voices surfaced in the prompt
export const WHISPER_WINDOW_MS = 15 * 60 * 1000; // only whispers from the last 15 min feed the prompt

export function interactionEnabled(): boolean {
  return process.env.TRUMANTOWN_INTERACTION === '1';
}
export function ponderUrl(): string | undefined {
  return process.env.PONDER_URL; // e.g. http://host.docker.internal:42069
}
export function defaultOnchainAgentId(): string {
  return process.env.DEFAULT_AGENT_ID ?? '0';
}
