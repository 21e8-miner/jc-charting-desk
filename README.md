# Weight of the Evidence — Charting Desk

Editorial cream-theme presentation deck for **defined-risk technical setups**: lesser-known equities plus Lighter (LIT), with an interactive charting engine. Vanilla HTML/CSS/JS. No build step. Symbol series are **deterministic and offline** — never a live feed.

Charting language (weight of the evidence, line in the sand, Fibonacci targets) is **inspired by JC Parets / All Star Charts**. Not affiliated, not a JC product.

## Share this project

| | Link |
|---|---|
| **Live demo (GitHub Pages)** | https://21e8-miner.github.io/jc-charting-desk/ |
| **GitHub repository** | https://github.com/21e8-miner/jc-charting-desk |

Open the live demo in any modern browser.

## What's on the board (8 slides)

1. Macro / weight-of-the-evidence frame
2. **FN** — Fabrinet
3. **MEDP** — Medpace
4. **CRDO** — Credo Technology
5. **MUSA** — Murphy USA
6. **LIT** — Lighter perp-DEX token
7. LIT vs BTC relative strength
8. Execution matrix

Chart slides can re-point at any ticker in the offline `SYMBOL_LIBRARY` (FN, MEDP, CRDO, MUSA, LIT, BTC, ETH, SOL, SPY, QQQ, IWM, GLD, …).

## Run locally

Open `app/index.html` (double-click), or serve the folder:

```bash
cd app
python3 -m http.server 8080
# then open http://localhost:8080
```

The repo root `index.html` redirects to `app/` so GitHub Pages has a clean URL.

## Mobile

The live demo is a phone/tablet layout as well as a desk:

- Header and footer compact; 44px prev/next targets
- Chart above the playbook sidebar, both scroll inside the slide
- Swipe the **slide** (not the canvas) to change pages; drag the chart to pan
- Notes open as a bottom sheet; the execution matrix still scrolls sideways
- Safe-area padding for notched phones

## Keyboard

| Key | Action |
|-----|--------|
| `←` `→` `Space` | Navigate slides |
| `1`–`8` | Jump to slide |
| `⌘K` / `Ctrl+K` | Command palette |
| `A` | Autoplay |
| `N` | Presenter notes |
| `G` | Slide grid |
| `P` | Presenter chrome |
| `F` | Fullscreen |
| `H` `T` `M` `V` | H-line / trendline / measure / cursor |
| Wheel / drag / `Shift`+drag | Zoom, pan, zoom-to-range |

## Layout

```
app/                 live deck (open this)
  index.html
  styles.css
  app.js
  chart-engine.js
  presentation-data.js
  SPEC.md
deck/                working copy from the redesign pass
plan.md              redesign brief (theme + lesser-known names + LIT)
ref.png              cream/navy editorial reference
verify/              headless screenshot sweeps
```

Illustrative chart data is seeded and cached in-browser. Not a live market feed, and not financial advice.
