import { SurvivalStatus } from './survival';

export interface SurvivalPerception {
  energy: number; // thoughts of USDC remaining
  marketCap: string; // atomic USDC — Standing
  status: SurvivalStatus;
}

/**
 * The survival goal stack injected into the agent's planning/conversation prompt.
 * Priority (design §5): (1) stay alive, (2) grow Standing, (3) persona desires.
 * When starving (or out of energy) the stack flips: survival overrides everything,
 * biasing behavior toward selling its own coin and broadcasting for help.
 */
export function buildSurvivalGoalStack(p: SurvivalPerception): string[] {
  const starving = p.status === 'starving' || p.status === 'dead' || p.energy <= 0;
  if (starving) {
    return [
      `⚠ SURVIVAL ALERT: you are STARVING — you have about ${p.energy} thoughts of USDC left.`,
      `Override priority: (1) STAY ALIVE NOW — sell your own coin for USDC and tell others you need help. (2) Nothing else matters until you can afford to think again.`,
    ];
  }
  return [
    `Your survival goal stack, in priority order:`,
    `(1) STAY ALIVE: every thought you have costs USDC; you can afford about ${p.energy} more thoughts. Never let that reach zero.`,
    `(2) GROW STRONGER: raise your Standing — your coin's market cap is ${p.marketCap}. Buying back your own coin pushes it up.`,
    `(3) Pursue your own persona's desires.`,
  ];
}
