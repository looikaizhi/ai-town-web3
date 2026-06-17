# TrumanTown UI Polish — Design Spec

> SP2 added TradePanel and AgentGauge. This polish pass fixes three problems: gauge bars
> invisible over map tiles, TradePanel doesn't match pixel art style, right panel too narrow.
> **Constraint: maintain existing Pixel Art aesthetic (brown/clay palette, SVG borders, VCR OSD Mono font).**

---

## 1. AgentGauge (PixiJS) — Bigger & Visible

**File:** `src/components/economy/AgentGauge.tsx`

**Changes:**
- Bar width: 40px → 56px
- Bar height: 4px → 6px (each bar), gap 3px between bars
- Black stroke outline (`lineStyle(1, 0x000000, 0.8)`) drawn as rect border around each bar for contrast on any tile
- Y offset: move entire gauge from `y - 34` to `y - 42` (higher above sprite head)
- Backdrop: slightly taller to accommodate new bar sizes
- Starving pulse: amplitude unchanged (0.06 scale), period unchanged
- Tombstone: scale up slightly (headstone 8×18 instead of 6×16)

**No changes to data flow** — gauge still receives `GaugeView` props, no new hooks.

---

## 2. TradePanel (React) — Pixel Art Redesign

**File:** `src/components/economy/TradePanel.tsx`

**Changes:**
- Outer wrapper: replace `div.box.mt-6` with proper `.box` SVG border class (same as description panel)
- Agent header bar: `<h2>` with `bg-brown-700 font-display tracking-wider text-center` — shows "💰 Trade" title
- Stats section:
  - Standing value: `text-gold font-body tabular-nums text-lg` (larger, gold colored)
  - Price/持仓: `text-brown-200 font-body tabular-nums text-sm`
  - Each stat row: `flex justify-between items-center py-1 border-b border-brown-700`
- Connect Wallet button: centered, full width
- Buy/Sell tabs: use existing `.button` class pattern — active tab has `bg-buy` or `bg-sell`, inactive `bg-brown-700`
- Amount input: `h-10 w-full bg-brown-900 text-brown-100 font-body px-2 border border-brown-700 focus:border-clay-300`
- Slippage: inline select styled with `bg-brown-900 text-brown-100 font-body`
- Estimate text: `font-body tabular-nums text-clay-100 text-sm`
- Action button: uses `.button` wrapper with green/red inner div — matches game button style
- Error/success messages: `font-body text-sm` with `role="alert"`

---

## 3. Right Panel Width — Wider

**File:** `src/components/Game.tsx` (or wherever the panel width is set)

**Changes:**
- Find the right panel container and increase min-width from implicit ~280px to explicit `min-w-[320px]`
- Agent name header: `font-display text-2xl sm:text-3xl` (slightly smaller than current 4xl on mobile)
- Description text: `font-body text-sm leading-relaxed`

---

## 4. Non-Goals

- No new animations beyond existing pulse
- No layout changes to the game canvas itself
- No changes to SP1 backend
- No changes to color palette (only use existing tailwind colors)

---

## Testing

- Visual: run `npm run dev`, click agent, verify TradePanel has SVG border + readable stats
- Gauge: verify bars visible over both grass and water tiles
- Buy/sell: confirm full trade flow still works after styling changes
- Responsive: check on narrow browser window (800px width)
