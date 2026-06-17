import { Container, Graphics } from '@pixi/react';
import { useTick } from '@pixi/react';
import { useCallback, useRef } from 'react';
import * as PIXI from 'pixi.js';
import type { GaugeView } from '../../web3/gauge';

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const BAR_W = 56;
const BAR_H = 6;
const GAP = 3;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function AgentGauge({ x, y, view }: { x: number; y: number; view: GaugeView }) {
  const containerRef = useRef<PIXI.Container | null>(null);
  const t = useRef(0);

  useTick((delta) => {
    const c = containerRef.current;
    if (!c) return;
    if (view.pulsing && !REDUCED_MOTION) {
      t.current += delta * 0.12;
      c.scale.set(1 + Math.sin(t.current) * 0.06);
    } else {
      c.scale.set(1);
    }
  });

  const energyColor =
    view.state === 'dead' ? 0x666666 : view.state === 'starving' ? 0xdc2626 : 0x22c55e;

  const drawBars = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      const totalH = BAR_H * 2 + GAP;

      // Dark backdrop
      g.beginFill(0x000000, 0.65);
      g.drawRect(-BAR_W / 2 - 2, -2, BAR_W + 4, totalH + 4);
      g.endFill();

      // Energy bar fill
      g.beginFill(energyColor);
      g.drawRect(-BAR_W / 2, 0, BAR_W * clamp01(view.energyFrac), BAR_H);
      g.endFill();
      // Energy bar outline
      g.lineStyle(1, 0x000000, 0.9);
      g.drawRect(-BAR_W / 2, 0, BAR_W, BAR_H);
      g.lineStyle(0);

      // Standing bar fill (gold)
      g.beginFill(0xeab308);
      g.drawRect(-BAR_W / 2, BAR_H + GAP, BAR_W * clamp01(view.standingFrac), BAR_H);
      g.endFill();
      // Standing bar outline
      g.lineStyle(1, 0x000000, 0.9);
      g.drawRect(-BAR_W / 2, BAR_H + GAP, BAR_W, BAR_H);
      g.lineStyle(0);
    },
    [energyColor, view.energyFrac, view.standingFrac],
  );

  const drawCountdown = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (view.state !== 'starving') return;
      const r = 28;
      const frac = clamp01(view.countdownFrac);
      // Background full circle (dark)
      g.lineStyle(5, 0x330000, 0.6);
      g.drawCircle(0, 0, r);
      // Countdown arc (bright red)
      g.lineStyle(5, 0xff2222, 1);
      g.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    },
    [view.state, view.countdownFrac],
  );

  const drawTomb = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (view.state !== 'dead') return;
      g.beginFill(0x9ca3af);
      g.drawRoundedRect(-8, -18, 16, 20, 7); // headstone
      g.drawRect(-10, 2, 20, 4); // base
      g.endFill();
      // dark outline
      g.lineStyle(1, 0x000000, 0.6);
      g.drawRoundedRect(-8, -18, 16, 20, 7);
      g.drawRect(-10, 2, 20, 4);
      g.lineStyle(0);
    },
    [view.state],
  );

  return (
    <Container ref={containerRef} x={x} y={y}>
      {/* Countdown arc — centered on sprite body, rendered on top */}
      <Graphics draw={drawCountdown} y={0} />
      {/* Bars — above sprite head */}
      <Graphics draw={drawBars} y={-46} />
      {/* Tombstone — above head */}
      <Graphics draw={drawTomb} y={-50} />
    </Container>
  );
}
