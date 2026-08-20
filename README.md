# Weight of the Evidence — JC Charting Desk

Editorial cream-theme presentation deck for **defined-risk technical setups**: lesser-known equities plus Lighter (LIT), with an interactive charting engine. Vanilla HTML/CSS/JS. No build step. Symbol series are **deterministic and offline** — never a live feed.

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

## Keyboard

| Key | Action |
|-----|--------|
| `←` `→` `Space` | Navigate slides |
| `1`–`8` | Jump to slide |
| `⌘K` / `Ctrl+K` | Command palette |
| `A` | Autoplay |
| `N` | JC presenter notes |
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
