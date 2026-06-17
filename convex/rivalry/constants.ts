export const RIVALRY_TICK_SECONDS = 30;
export const RIVALRY_TOP_K = 3; // rivalryPrompt 展示的最大对手数

export function rivalryEnabled(): boolean {
  return process.env.TRUMANTOWN_RIVALRY === '1';
}

export function ponderUrl(): string | undefined {
  return process.env.PONDER_URL;
}
