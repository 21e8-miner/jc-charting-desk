# Plan v2 — Deck Redesign: Editorial Cream Theme + New Content

## Request (user)
1. Replace well-known equities (NVDA/TSLA/PLTR/AMD) with LESSER-KNOWN equities
2. Include Lighter crypto (LIT — perp-DEX token)
3. Recolor + refont to match attached screenshot: cream/ivory background, dark navy text,
   serif display type, letterspaced small-caps labels, tabular numerals, muted navy/green accents
4. Cleaner, less busy layout

## Stage 1 — Implementation (skill: vibecoding-general-swarm, Mode B, single coder)
Work in /mnt/agents/output/deck (git repo with prior work). Then copy 5 files to /mnt/agents/output/app.

### Content (presentation-data.js + app.js strings)
- Slide 1 macro: keep structure, restyle; soften copy.
- Slides 2–5, lesser-known real tickers w/ illustrative deterministic data:
  FN (Fabrinet), MEDP (Medpace), CRDO (Credo Technology), MUSA (Murphy USA)
- Slide 6: Lighter crypto — LIT/USD chart slide (perp DEX momentum setup)
- Slide 7: RS ratio → LIT vs BTC (crypto relative strength leadership)
- Slide 8: execution matrix table (now 8 slides; fix number-key nav + header total)
- SYMBOL_LIBRARY: replace/add tickers {FN, MEDP, CRDO, MUSA, LIT, BTC, ETH, SOL, SPY, QQQ, IWM, GLD} — same lazy deterministic offline generation contract.

### Theme (styles.css + chart-engine.js colors + index.html fonts)
Palette (from screenshot):
- bg cream #f6f1e5 / panel #fbf8ef; ink #1c2433; hairline #d9d2bd
- navy accent #23405f (chips, verdicts); muted green #4a7c59; muted brick red #a8462f
- soft cell tints: blue #dfe7f0, green #e3ecdf
Fonts (Google Fonts): "EB Garamond" (display serif, titles, fund names) +
"IBM Plex Mono" (numerals/labels) + small-caps letterspaced labels via font-variant/tracking.
Remove Outfit/Plus Jakarta/JetBrains Mono imports.
Canvas chart restyle: cream plot bg, hairline grids, navy/green/brick series colors, serif-free mono labels.

### Layout (cleaner, less busy)
- More whitespace, fewer competing pills; hairline dividers instead of heavy card borders/shadows
- Consolidate chart toolbar into one quiet row; smaller, quieter indicator toggles
- Slimmer header/footer; keep all features (palette, autoplay, drawings, symbol switcher, grid, notes, PNG export)

## Stage 2 — Verification (verifier subagent)
Headless browser sweep: 8 slides render, theme applied (cream bg computed style), fonts loaded,
all interactions still work, zero console errors, offline guarantee intact. Screenshot review for
cleanliness vs. the reference image.

## Stage 3 — Delivery
Copy to /mnt/agents/output/app, website_version_manager build_version (type html).
