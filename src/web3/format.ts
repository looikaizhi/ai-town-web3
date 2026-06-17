// Self-contained atomic<->human decimal helpers (no viem import, so the Jest ESM
// transform never has to parse a node_modules ESM package for these pure tests).

export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

function safeParse(human: string, decimals: number): bigint | null {
  const s = human.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals); // pad/truncate
  try {
    return BigInt(intPart + frac);
  } catch {
    return null;
  }
}

export function parseUsdc(human: string): bigint | null {
  return safeParse(human, USDC_DECIMALS);
}
export function parseToken(human: string): bigint | null {
  return safeParse(human, TOKEN_DECIMALS);
}

function formatHuman(atomic: bigint, decimals: number, maxFractionDigits: number): string {
  const neg = atomic < 0n;
  const digits = (neg ? -atomic : atomic).toString().padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = decimals > 0 ? digits.slice(digits.length - decimals) : '';
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmedFrac = fracPart.slice(0, maxFractionDigits).replace(/0+$/, '');
  const body = trimmedFrac ? `${groupedInt}.${trimmedFrac}` : groupedInt;
  return neg ? `-${body}` : body;
}

export function formatUsdc(atomic: bigint, maxFractionDigits = 4): string {
  return formatHuman(atomic, USDC_DECIMALS, maxFractionDigits);
}
export function formatToken(atomic: bigint, maxFractionDigits = 2): string {
  return formatHuman(atomic, TOKEN_DECIMALS, maxFractionDigits);
}
