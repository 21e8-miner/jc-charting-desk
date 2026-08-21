# SPEC — "Weight of the Evidence" Deck 10x Upgrade

Vanilla JS presentation deck. SAME 5-file structure: `index.html`, `styles.css`, `app.js`, `chart-engine.js`, `presentation-data.js`. No frameworks, no build step, no network dependencies beyond the existing Google Fonts links.

## User priorities
1. **Richer interactivity & features**
2. **Code quality & performance**
3. **Symbol data ALWAYS available** — deterministic, seeded, fully offline. Never a live feed, never a fetch.

## Interface contracts (sacred)
- `PRESENTATION_DATA` global stays; slides keep existing shape. New optional fields allowed.
- `TechnicalChartEngine` class stays, same constructor signature `(canvasId, options)` and existing public methods (`setData`, `toggleOption`, `setChartType`, `initCanvas`, `render`). New methods may be added.
- All new chart symbol data comes from a new `SYMBOL_LIBRARY` global in `presentation-data.js`: a map of ticker → lazily generated deterministic series (mulberry32-seeded, pinned closes) with attached SMA50/SMA200/RSI/RS-ratio indicators via existing helpers. Min 12 symbols: NVDA, TSLA, PLTR, AMD, SMH, SPY, QQQ, IWM, DIA, GLD, TLT, BTC-USD. Generation is lazy + cached so first paint stays fast. This guarantees "symbol data always available".

## Feature set to implement

### A. Symbol switcher (chart slides)
- A symbol strip on every chart-type slide (chips with ticker + mini sparkline + %chg, or compact dropdown) letting the user re-point the slide's chart at any symbol in `SYMBOL_LIBRARY`.
- When switching, risk/Fib levels are hidden unless the symbol == the slide's primary ticker (they don't apply to other symbols); RS vs SPY mode remains available for absolute-price symbols.
- State reflected in URL hash: `#5/NVDA`.

### B. Chart tools (chart-engine)
- **Drawing tools**: horizontal line + trendline, click-click placement (click to anchor, click to commit), with magnet snap to O/H/L/C within tolerance; drag to move; double-click a drawing to delete; "Clear" button. Per-slide, per-symbol persistence in memory.
- **Measure tool**: drag a range → overlay showing Δ$, Δ%, # bars.
- **Zoom to selection**: drag on time axis region or Shift+drag to zoom into range; existing wheel zoom / drag pan / dblclick reset stay.
- **Export PNG** button: renders canvas (with watermark title) to a downloadable PNG.
- Keep existing candle/line/RS toggle, SMA/Fib/Volume/RR toggles. RSI is not a desk indicator.

### C. Deck UX
- **Command palette (Ctrl/Cmd+K)**: fuzzy jump to slides, switch symbols, toggle indicators, autoplay on/off, help.
- **Autoplay** with per-slide dwell + countdown ring on the next button (A key).
- **Slide transitions**: subtle fade/slide-in on slide change; chart series animates draw-on (progressive reveal ~600ms, ease-out) when a chart slide becomes active. Respect `prefers-reduced-motion`.
- **Grid modal thumbnails**: each card shows a live mini canvas sparkline of the slide's chart data.
- Deep links `#<slide>/<symbol>` parsed on load and updated on change (history.replaceState, no scroll).
- Presenter timer stays; add total-deck estimated time.

### D. Performance & code quality
- Render loop strictly rAF-driven with dirty flags; no layout reads in hot path after layout cached; mousemove handlers only set state + scheduleRender.
- Precompute per-view min/max with a single pass; avoid `Array.slice` in `visible()` hot path (iterate by index).
- DPR-aware canvas sizing (already present — keep), re-render only when size actually changes.
- Event delegation for toolbar buttons (one listener per slide container instead of per-button).
- All slide rendering wrapped in try/catch so one bad slide cannot kill the deck; console.warn on failure.
- Zero console errors/warnings on load and during normal interaction.
- No memory leaks: ResizeObservers and window listeners cleaned up if instances are replaced.

## Definition of done
- `node --check` passes on all 3 JS files.
- Deck loads with zero console errors; all 7 slides render; every feature above works.
- Fully offline after fonts: no fetch/XHR/websocket anywhere in the code.
- Same file structure, committed to git with clear commit messages.
