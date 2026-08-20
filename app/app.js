/**
 * Main Presentation Deck Application Controller
 *
 * Handles slide navigation, chart lifecycle, symbol switching, drawing tools,
 * command palette, autoplay, deep links, grid overview & speaker notes.
 *
 * Contracts honored (SPEC):
 *  - PRESENTATION_DATA global shape unchanged (new optional fields: dwell).
 *  - TechnicalChartEngine(canvasId, options) with setData / toggleOption /
 *    setChartType / initCanvas / render preserved; new engine APIs used:
 *    setTool, clearDrawings, getDrawings, setDrawings, animateIn, exportPNG,
 *    destroy, scheduleRender.
 *  - SYMBOL_LIBRARY provides all symbol data — deterministic, offline,
 *    lazily generated and cached. No fetch/XHR anywhere.
 *
 * Robustness: every slide render and chart init is wrapped in try/catch so
 * one broken slide can never kill the deck (console.warn on failure).
 */

document.addEventListener('DOMContentLoaded', () => {
  let currentSlideIndex = 0;
  const chartInstances = {};                 // slideIdx -> TechnicalChartEngine
  const symbolBySlide = {};                  // slideIdx -> active symbol
  const drawingsStore = {};                  // "slideIdx|symbol" -> drawings[]
  const slidesData = PRESENTATION_DATA.slides;
  const totalSlides = slidesData.length;

  // DOM Elements
  const viewportEl = document.getElementById('slides-viewport');
  const currentNumEl = document.getElementById('current-slide-num');
  const totalNumEl = document.getElementById('total-slides-num');
  const headerTitleEl = document.getElementById('header-slide-title');
  const dotsContainerEl = document.getElementById('slide-dots-container');
  const btnPrev = document.getElementById('btn-prev-slide');
  const btnNext = document.getElementById('btn-next-slide');
  const btnNotes = document.getElementById('btn-toggle-notes');
  const btnGrid = document.getElementById('btn-toggle-grid');
  const btnFullscreen = document.getElementById('btn-fullscreen');
  const btnPresenter = document.getElementById('btn-presenter');
  const btnHelp = document.getElementById('btn-help');
  const helpModal = document.getElementById('help-modal');
  const helpBackdrop = document.getElementById('help-backdrop');
  const progressEl = document.getElementById('deck-progress');
  const sessionClockEl = document.getElementById('session-clock');
  const deckEtaEl = document.getElementById('deck-eta');
  const quoteEl = document.getElementById('jc-quote-ticker');
  const notesPanel = document.getElementById('presenter-notes-panel');
  const notesCloseBtn = document.getElementById('notes-close-btn');
  const notesContent = document.getElementById('notes-content');
  const gridModal = document.getElementById('grid-modal');
  const gridModalBackdrop = document.getElementById('grid-modal-backdrop');
  const gridCloseBtn = document.getElementById('grid-close-btn');
  const gridCardsContainer = document.getElementById('grid-cards-container');
  const cmdPalette = document.getElementById('cmd-palette');
  const cmdBackdrop = document.getElementById('cmd-backdrop');
  const cmdInput = document.getElementById('cmd-input');
  const cmdResults = document.getElementById('cmd-results');
  const autoplayRingFg = document.getElementById('autoplay-ring-fg');

  const JC_QUOTES = [
    "Risk management is #1. If we're above our risk level, we're buyers. Below it, there's no reason to be involved.",
    "Price is the only thing that pays. The weight of the evidence is all that matters.",
    "All-time highs are a bullish characteristic. Leaders make higher highs.",
    "From false moves come fast moves in the opposite direction.",
    "The bigger the base, the higher in space.",
    "Crypto gets wider lines in the sand and smaller size. The discipline stays exactly the same.",
    "If you don't know where you're getting out, you're not trading — you're gambling."
  ];
  let quoteIdx = 0;
  const sessionStart = Date.now();

  totalNumEl.textContent = String(totalSlides).padStart(2, '0');

  /* ========================================================================
     Symbol helpers
     ======================================================================== */

  /** The slide's own ticker (its primary subject). Risk/Fib levels only
   *  apply to this symbol. */
  const primarySymbolOf = (slide) => slide.ticker || null;

  /** URL-safe key: "SMH / SPY" -> "SMH-SPY", "BTC-USD" stays "BTC-USD". */
  const hashKeyFor = (symbol) => String(symbol).replace(/\s*\/\s*/g, '-');

  /** Resolve a hash key back to a symbol valid for the given slide. */
  function resolveSymbol(slide, key) {
    if (!key || slide.type !== 'chart') return null;
    const primary = primarySymbolOf(slide);
    if (primary && hashKeyFor(primary) === key) return primary;
    const hit = SYMBOL_LIBRARY.tickers.find((t) => t === key || hashKeyFor(t) === key);
    return hit || null;
  }

  /** Series for a symbol on a slide — primary uses the slide's own pinned
   *  chartData, everything else comes from SYMBOL_LIBRARY (offline). */
  function seriesFor(slide, symbol) {
    if (symbol === primarySymbolOf(slide)) return slide.chartData;
    return SYMBOL_LIBRARY.has(symbol) ? SYMBOL_LIBRARY[symbol].data : null;
  }

  const activeSymbolOf = (idx) => symbolBySlide[idx] || primarySymbolOf(slidesData[idx]);
  const cloneDrawings = (arr) => (Array.isArray(arr) ? arr.map((d) => Object.assign({}, d)) : []);

  /* ========================================================================
     Sparkline renderer (symbol chips + grid thumbnails)
     ======================================================================== */

  function drawSparkline(canvas, data, cssW, cssH) {
    if (!canvas || !data || data.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(cssW * dpr));
    const ph = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const c = data[i].close;
      if (c < min) min = c;
      if (c > max) max = c;
    }
    const span = (max - min) || 1;
    const up = data[data.length - 1].close >= data[0].close;
    ctx.strokeStyle = up ? '#4a7c59' : '#a8462f';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * cssW;
      const y = cssH - 1.5 - ((data[i].close - min) / span) * (cssH - 3);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* ========================================================================
     Slide renderers (each wrapped in try/catch by renderAllSlides)
     ======================================================================== */

  function renderMacroSlide(slide, idx) {
    return `
      <div class="slide-top-bar">
        <div class="slide-headline-group">
          <div class="slide-badge-row">
            <span class="setup-type-pill ${slide.pillClass}">${slide.setupPill}</span>
          </div>
          <h1 class="slide-main-title">${slide.title}</h1>
          <p class="slide-subtitle-text">${slide.subtitle}</p>
        </div>
        <div class="slide-quick-metrics">
          ${slide.metrics.map(m => `
            <div class="quick-metric-item">
              <span class="quick-metric-label">${m.label}</span>
              <span class="quick-metric-val ${m.class}">${m.value}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="confluence-strip">
        <div class="confluence-label">WEIGHT OF THE EVIDENCE</div>
        <div class="confluence-track"><div class="confluence-fill" style="width:86%"></div></div>
        <div class="confluence-score">86 · OFFENSE</div>
      </div>
      <div class="macro-dashboard-grid">
        ${slide.pillars.map(p => `
          <div class="macro-pillar-card">
            <div class="pillar-header">
              <span class="pillar-icon">${p.icon}</span>
              <div>
                <h3 class="pillar-title">${p.title}</h3>
                <span class="pillar-status ${p.statusClass}">${p.status}</span>
              </div>
            </div>
            <p class="pillar-desc">${p.desc}</p>
            <div class="pillar-metrics-mini">
              <span>${p.miniMetrics[0]}</span>
              <span>${p.miniMetrics[1]}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="jc-rule-box" style="margin-top: 20px;">
        <div class="jc-rule-badge">JC'S PRIMARY MARKET TENET</div>
        <div class="jc-rule-quote">"If you're trying to figure out what the Fed will do next, you've already lost. Focus on price, trend, and relative strength. The weight of the evidence is overwhelmingly bullish."</div>
      </div>
    `;
  }

  function symbolChipHTML(idx, symbol, label) {
    return `
      <button class="symbol-chip" data-slide="${idx}" data-symbol="${symbol}" title="Point this chart at ${label}">
        <span class="chip-ticker">${label}</span>
        <canvas class="chip-spark" width="64" height="18"></canvas>
        <span class="chip-chg" data-chg>—</span>
      </button>`;
  }

  function symbolStripHTML(slide, idx) {
    const primary = primarySymbolOf(slide);
    const chips = [symbolChipHTML(idx, primary, primary.replace(/\s+/g, ''))];
    SYMBOL_LIBRARY.tickers.forEach((t) => {
      if (t === primary) return; // primary already pinned first
      chips.push(symbolChipHTML(idx, t, t));
    });
    return `<div class="symbol-strip" data-slide="${idx}" role="tablist" aria-label="Symbol switcher">${chips.join('')}</div>`;
  }

  function renderChartSlide(slide, idx) {
    return `
      <div class="slide-top-bar">
        <div class="slide-headline-group">
          <div class="slide-badge-row">
            <span class="ticker-badge">${slide.ticker}</span>
            <span class="setup-type-pill ${slide.pillClass}">${slide.setupPill}</span>
          </div>
          <h1 class="slide-main-title">${slide.title}</h1>
          <p class="slide-subtitle-text">${slide.subtitle}</p>
        </div>
        <div class="slide-quick-metrics">
          ${slide.metrics.map(m => `
            <div class="quick-metric-item">
              <span class="quick-metric-label">${m.label}</span>
              <span class="quick-metric-val ${m.class}">${m.value}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="slide-content-grid">
        <!-- Interactive Canvas Chart -->
        <div class="chart-container-card">
          ${symbolStripHTML(slide, idx)}

          <div class="chart-toolbar">
            <div class="chart-left-controls">
              <div class="timeframe-group">
                <button class="chart-pill-btn active" data-type="candle" data-slide="${idx}">Candles</button>
                <button class="chart-pill-btn" data-type="line" data-slide="${idx}">Line</button>
                <button class="chart-pill-btn${String(slide.ticker || '').includes('/') ? ' hidden' : ''}" data-type="rs" data-slide="${idx}">RS vs SPY</button>
              </div>

              <div class="draw-tools-group">
                <button class="tool-btn" data-tool="hline" data-slide="${idx}" title="Horizontal line — click, click (H)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="4 3"/></svg>
                  <span>H-Line</span>
                </button>
                <button class="tool-btn" data-tool="trend" data-slide="${idx}" title="Trendline — click, click (T)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"/></svg>
                  <span>Trend</span>
                </button>
                <button class="tool-btn" data-tool="measure" data-slide="${idx}" title="Measure tool — drag a range (M)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>
                  <span>Measure</span>
                </button>
                <button class="tool-btn" data-action="clear-drawings" data-slide="${idx}" title="Clear all drawings on this symbol">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>
                  <span>Clear</span>
                </button>
                <button class="tool-btn" data-action="export-png" data-slide="${idx}" title="Export chart as PNG (offline)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
                  <span>PNG</span>
                </button>
              </div>
            </div>

            <div class="chart-indicators-bar">
              <button class="indicator-toggle sma-200 active" data-toggle="showSMA200" data-slide="${idx}">
                <span class="indicator-dot"></span> 200 SMA
              </button>
              <button class="indicator-toggle sma-50 active" data-toggle="showSMA50" data-slide="${idx}">
                <span class="indicator-dot"></span> 50 SMA
              </button>
              <button class="indicator-toggle fib active" data-toggle="showFib" data-slide="${idx}">
                <span class="indicator-dot"></span> Fib Targets
              </button>
              <button class="indicator-toggle rsi active" data-toggle="showRSI" data-slide="${idx}">
                <span class="indicator-dot"></span> RSI (14)
              </button>
              <button class="indicator-toggle vol active" data-toggle="showVolume" data-slide="${idx}">
                <span class="indicator-dot"></span> Volume
              </button>
              <button class="indicator-toggle rr active" data-toggle="showRR" data-slide="${idx}">
                <span class="indicator-dot"></span> R/R
              </button>
            </div>
          </div>

          <div class="chart-viewport-box">
            <canvas id="chart-canvas-${idx}" class="chart-canvas"></canvas>
            <div class="chart-crosshair-tooltip"></div>
          </div>
        </div>

        <!-- Strategy Sidebar -->
        <div class="strategy-sidebar-card">
          <div class="jc-rule-box">
            <div class="jc-rule-badge">${slide.ruleTitle}</div>
            <div class="jc-rule-quote">"${slide.ruleQuote}"</div>
          </div>

          <div class="trade-levels-card">
            <div class="trade-levels-title">
              <span>JC's Trade Playbook</span>
              <span>RISK / REWARD</span>
            </div>
            ${slide.tradeLevels.map(lvl => `
              <div class="level-row ${lvl.type}${lvl.customClass ? ' ' + lvl.customClass : ''}">
                <span class="level-label">${lvl.label}</span>
                <span class="level-val">${lvl.val}</span>
              </div>
            `).join('')}
          </div>

          <div class="evidence-bullet-points">
            <div class="evidence-title">Weight of the Evidence</div>
            <ul class="evidence-list">
              ${slide.evidence.map(e => `<li>${e}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  function renderTableSlide(slide, idx) {
    return `
      <div class="slide-top-bar">
        <div class="slide-headline-group">
          <div class="slide-badge-row">
            <span class="setup-type-pill ${slide.pillClass}">${slide.setupPill}</span>
          </div>
          <h1 class="slide-main-title">${slide.title}</h1>
          <p class="slide-subtitle-text">${slide.subtitle}</p>
        </div>
        <div class="slide-quick-metrics">
          ${slide.metrics.map(m => `
            <div class="quick-metric-item">
              <span class="quick-metric-label">${m.label}</span>
              <span class="quick-metric-val ${m.class}">${m.value}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="table-slide-wrapper">
        <table class="jc-strategy-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Company / Asset</th>
              <th>Technical Setup</th>
              <th>Bias</th>
              <th>Line in the Sand (Risk)</th>
              <th>Pivot</th>
              <th>Fib Target 1 (161.8%)</th>
              <th>Fib Target 2 (261.8%)</th>
              <th>R / R</th>
              <th>JC's Actionable Verdict</th>
            </tr>
          </thead>
          <tbody>
            ${slide.matrixRows.map(r => `
              <tr class="matrix-jump" data-ticker="${r.ticker}">
                <td class="table-ticker-cell">${r.ticker}</td>
                <td><strong>${r.name}</strong></td>
                <td>${r.setup}</td>
                <td><span class="verdict-chip ${r.biasClass || 'core'}">${r.bias}</span></td>
                <td class="table-risk-cell">${r.riskLevel}</td>
                <td>${r.pivot}</td>
                <td class="table-target-cell">${r.target1}</td>
                <td class="table-target-cell">${r.target2}</td>
                <td class="table-rr-cell">${r.rr}</td>
                <td>${r.verdict}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="jc-rule-box" style="margin-top: 20px;">
        <div class="jc-rule-badge">EXECUTION DISCIPLINE</div>
        <div class="jc-rule-quote">"If you enter a trade without knowing exactly where you are getting out if you're wrong, you are not trading—you're gambling. Define your risk, size accordingly, and let the mathematics do the work."</div>
      </div>
    `;
  }

  /* ========================================================================
     Deck assembly — per-slide try/catch so one bad slide cannot kill the deck
     ======================================================================== */

  // Build Dots Navigation
  slidesData.forEach((_, idx) => {
    const dot = document.createElement('button');
    dot.className = `dot-btn ${idx === 0 ? 'active' : ''}`;
    dot.title = `Jump to Slide ${idx + 1}`;
    dot.addEventListener('click', () => goToSlide(idx));
    dotsContainerEl.appendChild(dot);
  });

  // Build Grid Cards (chart slides get a live mini sparkline thumbnail)
  slidesData.forEach((slide, idx) => {
    const card = document.createElement('div');
    card.className = `grid-slide-card ${idx === 0 ? 'active' : ''}`;
    card.innerHTML = `
      <span class="grid-slide-num">SLIDE ${String(idx + 1).padStart(2, '0')}</span>
      <div class="grid-slide-title">${slide.ticker ? `[${slide.ticker}] ` : ''}${slide.title}</div>
      <div class="grid-slide-subtitle">${slide.subtitle}</div>
      ${slide.type === 'chart' ? '<canvas class="grid-thumb" height="52"></canvas>' : ''}
    `;
    card.addEventListener('click', () => {
      goToSlide(idx);
      closeGridModal();
    });
    gridCardsContainer.appendChild(card);
  });

  let gridThumbsDrawn = false;
  function drawGridThumbs() {
    if (gridThumbsDrawn) return;
    gridThumbsDrawn = true;
    gridCardsContainer.querySelectorAll('.grid-slide-card').forEach((card, i) => {
      const slide = slidesData[i];
      const canvas = card.querySelector('.grid-thumb');
      if (!canvas || !slide || slide.type !== 'chart') return;
      try {
        drawSparkline(canvas, slide.chartData, Math.max(180, card.clientWidth - 32), 52);
      } catch (err) {
        console.warn(`[deck] grid thumbnail failed for slide ${i + 1}:`, err);
      }
    });
  }

  /** One delegated click listener per slide container (SPEC D) — handles
   *  symbol chips, chart-type pills, indicator toggles, tool buttons and
   *  matrix jump rows without per-button listeners. */
  function handleSlideClick(e, idx) {
    const chip = e.target.closest('.symbol-chip');
    if (chip) {
      switchSymbol(parseInt(chip.dataset.slide, 10), chip.dataset.symbol);
      return;
    }

    const pill = e.target.closest('.chart-pill-btn');
    if (pill) {
      const slideIdx = pill.dataset.slide;
      pill.closest('.timeframe-group')
        .querySelectorAll('.chart-pill-btn')
        .forEach((b) => b.classList.remove('active'));
      pill.classList.add('active');
      if (chartInstances[slideIdx]) chartInstances[slideIdx].setChartType(pill.dataset.type);
      return;
    }

    const toggle = e.target.closest('.indicator-toggle');
    if (toggle) {
      if (toggle.disabled) return;
      const slideIdx = toggle.dataset.slide;
      toggle.classList.toggle('active');
      if (chartInstances[slideIdx]) chartInstances[slideIdx].toggleOption(toggle.dataset.toggle);
      return;
    }

    const toolBtn = e.target.closest('.tool-btn');
    if (toolBtn) {
      const slideIdx = parseInt(toolBtn.dataset.slide, 10);
      const engine = chartInstances[slideIdx];
      if (!engine) return;
      if (toolBtn.dataset.tool) {
        const tool = toolBtn.dataset.tool;
        const alreadyActive = toolBtn.classList.contains('active');
        const card = document.getElementById(`slide-${slideIdx}`);
        card.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        if (alreadyActive) {
          engine.setTool('none');
        } else {
          toolBtn.classList.add('active');
          engine.setTool(tool);
        }
      } else if (toolBtn.dataset.action === 'clear-drawings') {
        engine.clearDrawings();
      } else if (toolBtn.dataset.action === 'export-png') {
        const slide = slidesData[slideIdx];
        engine.exportPNG(`${activeSymbolOf(slideIdx)} — ${slide.title}`, slide.subtitle);
      }
      return;
    }

    const jump = e.target.closest('.matrix-jump');
    if (jump) {
      const ticker = jump.dataset.ticker;
      const dest = slidesData.findIndex(s => s.ticker &&
        (s.ticker === ticker || hashKeyFor(s.ticker) === hashKeyFor(ticker)));
      if (dest >= 0) goToSlide(dest);
    }
  }

  function renderAllSlides() {
    viewportEl.innerHTML = '';

    slidesData.forEach((slide, idx) => {
      const slideCard = document.createElement('div');
      slideCard.className = `slide-card ${idx === 0 ? 'active' : ''}`;
      slideCard.id = `slide-${idx}`;

      try {
        if (slide.type === 'macro') {
          slideCard.innerHTML = renderMacroSlide(slide, idx);
        } else if (slide.type === 'chart') {
          slideCard.innerHTML = renderChartSlide(slide, idx);
        } else if (slide.type === 'table') {
          slideCard.innerHTML = renderTableSlide(slide, idx);
        } else {
          throw new Error(`unknown slide type "${slide.type}"`);
        }
      } catch (err) {
        console.warn(`[deck] slide ${idx + 1} failed to render:`, err);
        slideCard.innerHTML = `
          <div class="slide-error-card">
            <h1 class="slide-main-title">${slide.title || 'Slide'} — unavailable</h1>
            <p class="slide-subtitle-text">This slide failed to render. The rest of the deck is unaffected.</p>
          </div>`;
      }

      slideCard.addEventListener('click', (e) => handleSlideClick(e, idx));
      viewportEl.appendChild(slideCard);
    });

    // Draw chip sparklines once the DOM is in place (rAF keeps first paint fast).
    requestAnimationFrame(drawChipSparklines);
  }

  function drawChipSparklines() {
    document.querySelectorAll('.symbol-chip').forEach((chip) => {
      try {
        const idx = parseInt(chip.dataset.slide, 10);
        const slide = slidesData[idx];
        const data = seriesFor(slide, chip.dataset.symbol);
        if (!data || data.length < 2) return;
        drawSparkline(chip.querySelector('.chip-spark'), data, 64, 18);
        const last = data[data.length - 1].close;
        const prev = data[data.length - 2].close;
        const pct = ((last - prev) / prev) * 100;
        const chgEl = chip.querySelector('[data-chg]');
        chgEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
        chgEl.classList.add(pct >= 0 ? 'up' : 'dn');
      } catch (err) {
        console.warn('[deck] symbol chip sparkline failed:', err);
      }
    });
  }

  /* ========================================================================
     Symbol switching (SPEC A)
     ======================================================================== */

  /** Re-point a chart slide at any symbol. Risk/Fib levels only apply to the
   *  slide's primary ticker; drawings persist per slide + symbol in memory. */
  function switchSymbol(idx, symbol, opts = {}) {
    const slide = slidesData[idx];
    if (!slide || slide.type !== 'chart') return;
    if (!seriesFor(slide, symbol)) return;

    const prev = activeSymbolOf(idx);
    const engine = chartInstances[idx];
    if (engine && prev !== symbol) {
      drawingsStore[`${idx}|${prev}`] = cloneDrawings(engine.getDrawings());
    }
    symbolBySlide[idx] = symbol;

    if (engine) {
      applySymbolToEngine(idx, engine);
      engine.animateIn();
    }
    syncSymbolUI(idx);
    if (opts.updateHash !== false && idx === currentSlideIndex) updateHash();
  }

  function levelOptionsFor(slide, symbol) {
    const isPrimary = symbol === primarySymbolOf(slide);
    if (!isPrimary) {
      return { riskLevel: null, fibLevels: [], targetPrice: null, symbol };
    }
    const t1 = (slide.fibLevels || []).find((f) => /161/.test(f.label));
    return {
      riskLevel: slide.riskLevel,
      fibLevels: slide.fibLevels,
      targetPrice: t1 ? t1.price : null,
      symbol
    };
  }

  function applySymbolToEngine(idx, engine) {
    const slide = slidesData[idx];
    const symbol = activeSymbolOf(idx);
    const data = seriesFor(slide, symbol);
    const levelOpts = levelOptionsFor(slide, symbol);
    if (engine.data !== data) {
      engine.setData(data, levelOpts);
    } else {
      Object.assign(engine.options, levelOpts);
    }
    engine.setDrawings(cloneDrawings(drawingsStore[`${idx}|${symbol}`]));
    // Fib / R-R levels are meaningless for non-primary symbols — force off.
    const isPrimary = symbol === primarySymbolOf(slide);
    const card = document.getElementById(`slide-${idx}`);
    const fibBtn = card && card.querySelector('[data-toggle="showFib"]');
    const rrBtn = card && card.querySelector('[data-toggle="showRR"]');
    engine.options.showFib = isPrimary && !!fibBtn && fibBtn.classList.contains('active');
    engine.options.showRR = isPrimary && !!rrBtn && rrBtn.classList.contains('active');
    engine.scheduleRender();
  }

  /** Sync chip active states + disable Fib/R-R toggles off-primary. */
  function syncSymbolUI(idx) {
    const card = document.getElementById(`slide-${idx}`);
    if (!card) return;
    const slide = slidesData[idx];
    const symbol = activeSymbolOf(idx);
    const isPrimary = symbol === primarySymbolOf(slide);
    card.querySelectorAll('.symbol-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.symbol === symbol);
    });
    card.querySelectorAll('[data-toggle="showFib"], [data-toggle="showRR"]').forEach((b) => {
      b.disabled = !isPrimary;
      b.classList.toggle('force-off', !isPrimary);
      b.title = isPrimary
        ? ''
        : 'Levels only apply to ' + primarySymbolOf(slide);
    });

    // RS-vs-SPY mode is available for absolute-price symbols only — hide the
    // pill while the ratio slide shows its own primary ratio series.
    const rsBtn = card.querySelector('.chart-pill-btn[data-type="rs"]');
    if (rsBtn) {
      const hideRS = isPrimary && String(primarySymbolOf(slide)).includes('/');
      rsBtn.classList.toggle('hidden', hideRS);
      if (hideRS && rsBtn.classList.contains('active')) {
        rsBtn.classList.remove('active');
        const candleBtn = card.querySelector('.chart-pill-btn[data-type="candle"]');
        if (candleBtn) candleBtn.classList.add('active');
        if (chartInstances[idx]) chartInstances[idx].setChartType('candle');
      }
    }
  }

  function initializeChartForSlide(idx) {
    const slide = slidesData[idx];
    if (!slide || slide.type !== 'chart') return;
    try {
      if (!chartInstances[idx]) {
        const symbol = activeSymbolOf(idx);
        const t1 = (slide.fibLevels || []).find((f) => /161/.test(f.label));
        const engine = new TechnicalChartEngine(`chart-canvas-${idx}`, {
          riskLevel: slide.riskLevel,
          targetPrice: t1 ? t1.price : null,
          fibLevels: slide.fibLevels,
          showSMA200: true,
          showSMA50: true,
          showFib: true,
          showRSI: true,
          showVolume: true,
          showRR: true,
          symbol
        });
        // Persist drawings per slide + symbol whenever they change.
        engine.options.onDrawingsChange = (drawings) => {
          drawingsStore[`${idx}|${activeSymbolOf(idx)}`] = cloneDrawings(drawings);
        };
        chartInstances[idx] = engine;
      }
      const engine = chartInstances[idx];
      applySymbolToEngine(idx, engine);
      syncSymbolUI(idx);
    } catch (err) {
      console.warn(`[deck] chart init failed on slide ${idx + 1}:`, err);
    }
  }

  /* ========================================================================
     Navigation, deep links, transitions
     ======================================================================== */

  function updateHash() {
    const slide = slidesData[currentSlideIndex];
    let hash = `#${currentSlideIndex + 1}`;
    if (slide.type === 'chart') {
      const sym = activeSymbolOf(currentSlideIndex);
      if (sym) hash += `/${hashKeyFor(sym)}`;
    }
    if (location.hash !== hash) {
      history.replaceState(null, '', hash); // no scroll, no history spam
    }
  }

  function parseHash() {
    const m = /^#(\d+)(?:\/([^/]+))?$/.exec(location.hash || '');
    if (!m) return { slide: 0, symbol: null };
    const s = parseInt(m[1], 10);
    return {
      slide: Number.isFinite(s) && s >= 1 && s <= totalSlides ? s - 1 : 0,
      symbol: m[2] ? decodeURIComponent(m[2]) : null
    };
  }

  function goToSlide(newIndex) {
    if (newIndex < 0 || newIndex >= totalSlides) return;

    const oldSlide = document.getElementById(`slide-${currentSlideIndex}`);
    const newSlide = document.getElementById(`slide-${newIndex}`);

    if (oldSlide) {
      oldSlide.classList.remove('active');
      if (newIndex > currentSlideIndex) {
        oldSlide.classList.add('prev-slide');
      } else {
        oldSlide.classList.remove('prev-slide');
      }
    }

    if (newSlide) {
      newSlide.classList.add('active');
      newSlide.classList.remove('prev-slide');
    }

    currentSlideIndex = newIndex;
    autoplay.elapsed = 0; // reset per-slide dwell on any navigation

    // Update Header and Counter
    currentNumEl.textContent = String(currentSlideIndex + 1).padStart(2, '0');
    const currentData = slidesData[currentSlideIndex];
    headerTitleEl.textContent = currentData.title;

    // Update Dots
    document.querySelectorAll('.dot-btn').forEach((dot, i) => {
      dot.classList.toggle('active', i === currentSlideIndex);
    });

    // Update Grid Modal selection
    document.querySelectorAll('.grid-slide-card').forEach((card, i) => {
      card.classList.toggle('active', i === currentSlideIndex);
    });

    // Update Prev / Next Buttons
    btnPrev.disabled = currentSlideIndex === 0;
    btnNext.disabled = currentSlideIndex === totalSlides - 1;

    // Update Presenter Notes
    updatePresenterNotes();

    if (progressEl) {
      progressEl.style.width = `${((currentSlideIndex + 1) / totalSlides) * 100}%`;
    }
    updateHash();

    // Chart slide became active: init + draw-on animation.
    initializeChartForSlide(currentSlideIndex);
    requestAnimationFrame(() => {
      const engine = chartInstances[currentSlideIndex];
      if (!engine) return;
      try {
        engine.initCanvas();
        engine.animateIn();
      } catch (err) {
        console.warn(`[deck] chart render failed on slide ${currentSlideIndex + 1}:`, err);
      }
    });
  }

  function updatePresenterNotes() {
    const currentData = slidesData[currentSlideIndex];
    notesContent.innerHTML = currentData.jcNotes || '<p>No specific speaker notes for this slide.</p>';
  }

  /* ========================================================================
     Autoplay (A key) — per-slide dwell + countdown ring on the next button
     ======================================================================== */

  const RING_R = 16.5;
  const RING_C = 2 * Math.PI * RING_R;
  const autoplay = { on: false, elapsed: 0, last: 0, raf: 0 };

  if (autoplayRingFg) {
    autoplayRingFg.style.strokeDasharray = RING_C;
    autoplayRingFg.style.strokeDashoffset = RING_C;
  }

  function setAutoplay(on) {
    autoplay.on = !!on;
    autoplay.elapsed = 0;
    autoplay.last = 0;
    btnNext.classList.toggle('autoplaying', autoplay.on);
    cancelAnimationFrame(autoplay.raf);
    autoplay.raf = 0;
    if (autoplayRingFg && !autoplay.on) autoplayRingFg.style.strokeDashoffset = RING_C;
    if (autoplay.on) autoplay.raf = requestAnimationFrame(autoplayTick);
  }

  function autoplayTick(t) {
    if (!autoplay.on) return;
    if (autoplay.last) autoplay.elapsed += t - autoplay.last;
    autoplay.last = t;
    const dwell = (slidesData[currentSlideIndex].dwell || 20) * 1000;
    const p = Math.min(1, autoplay.elapsed / dwell);
    if (autoplayRingFg) autoplayRingFg.style.strokeDashoffset = RING_C * (1 - p);
    if (p >= 1) {
      if (currentSlideIndex < totalSlides - 1) {
        goToSlide(currentSlideIndex + 1);
        autoplay.elapsed = 0;
      } else {
        setAutoplay(false); // stop at the end of the deck
        return;
      }
    }
    autoplay.raf = requestAnimationFrame(autoplayTick);
  }

  // Total-deck estimated time next to the session clock.
  if (deckEtaEl) {
    const totalSec = slidesData.reduce((acc, s) => acc + (s.dwell || 20), 0);
    const mm = Math.floor(totalSec / 60);
    const ss = String(totalSec % 60).padStart(2, '0');
    deckEtaEl.textContent = `EST ${mm}:${ss}`;
    deckEtaEl.title = 'Estimated full-deck runtime (sum of per-slide dwell)';
  }

  /* ========================================================================
     Command palette (Ctrl/Cmd+K) — fuzzy jump / symbol / indicator / deck
     ======================================================================== */

  let cmdCommands = null;   // built lazily on first open
  let cmdFiltered = [];
  let cmdActiveIdx = 0;

  function buildCommands() {
    const cmds = [];
    slidesData.forEach((s, i) => {
      cmds.push({
        label: `Slide ${i + 1} — ${s.title}`,
        hint: s.ticker ? `[${s.ticker}]` : s.type,
        keywords: `${i + 1} ${s.title} ${s.subtitle} ${s.ticker || ''}`,
        run: () => goToSlide(i)
      });
    });
    SYMBOL_LIBRARY.tickers.forEach((t) => {
      const meta = SYMBOL_LIBRARY[t]; // lazily generated + cached
      cmds.push({
        label: `Chart symbol → ${t}`,
        hint: meta.name,
        keywords: `symbol chart ${t} ${meta.name}`,
        run: () => applySymbolFromPalette(t)
      });
    });
    [
      ['showSMA50', 'Toggle 50 SMA'],
      ['showSMA200', 'Toggle 200 SMA'],
      ['showFib', 'Toggle Fib targets'],
      ['showRSI', 'Toggle RSI pane'],
      ['showVolume', 'Toggle volume pane'],
      ['showRR', 'Toggle risk/reward zones']
    ].forEach(([key, label]) => {
      cmds.push({
        label,
        hint: 'indicator',
        keywords: `${label} indicator overlay`,
        run: () => toggleIndicatorFromPalette(key)
      });
    });
    cmds.push(
      { label: 'Autoplay: on / off', hint: 'deck', keywords: 'autoplay auto advance play timer', run: () => setAutoplay(!autoplay.on) },
      { label: 'Export current chart as PNG', hint: 'chart', keywords: 'export png image download screenshot', run: exportCurrentChart },
      { label: 'Clear drawings on current chart', hint: 'chart', keywords: 'clear delete drawings lines annotations', run: clearCurrentDrawings },
      { label: 'Open slide grid overview', hint: 'deck', keywords: 'grid overview thumbnails', run: () => openGridModal() },
      { label: 'Toggle presenter notes', hint: 'deck', keywords: 'notes jc commentary speaker', run: () => btnNotes.click() },
      { label: 'Open help / keyboard map', hint: 'deck', keywords: 'help keys shortcuts keyboard', run: () => helpModal.classList.add('open') }
    );
    return cmds;
  }

  function applySymbolFromPalette(ticker) {
    let idx = currentSlideIndex;
    if (slidesData[idx].type !== 'chart') {
      idx = slidesData.findIndex((s) => s.type === 'chart');
      goToSlide(idx);
    }
    switchSymbol(idx, ticker);
  }

  function toggleIndicatorFromPalette(key) {
    const engine = chartInstances[currentSlideIndex];
    if (!engine || slidesData[currentSlideIndex].type !== 'chart') return;
    const card = document.getElementById(`slide-${currentSlideIndex}`);
    const btn = card && card.querySelector(`.indicator-toggle[data-toggle="${key}"]`);
    if (btn && btn.disabled) return; // Fib/R-R off for non-primary symbols
    if (btn) btn.classList.toggle('active');
    engine.toggleOption(key);
  }

  function exportCurrentChart() {
    const engine = chartInstances[currentSlideIndex];
    const slide = slidesData[currentSlideIndex];
    if (!engine || slide.type !== 'chart') return;
    engine.exportPNG(`${activeSymbolOf(currentSlideIndex)} — ${slide.title}`, slide.subtitle);
  }

  function clearCurrentDrawings() {
    const engine = chartInstances[currentSlideIndex];
    if (engine) engine.clearDrawings();
  }

  /** Subsequence fuzzy match with consecutive-match bonus. -1 = no match. */
  function fuzzyScore(query, text) {
    query = query.toLowerCase();
    text = text.toLowerCase();
    if (!query) return 0;
    // Contiguous substring matches outrank any scattered subsequence match;
    // shorter strings win ties so exact tickers (e.g. "amd") rank first.
    const idx = text.indexOf(query);
    if (idx !== -1) return 1000 - text.length - idx;
    let qi = 0;
    let score = 0;
    let lastMatch = -2;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) {
        score += (lastMatch === ti - 1) ? 3 : 1;
        if (ti === 0 || text[ti - 1] === ' ') score += 1; // word-start bonus
        lastMatch = ti;
        qi++;
      }
    }
    return qi === query.length ? score : -1;
  }

  function renderCmdResults() {
    const q = cmdInput.value.trim();
    cmdFiltered = cmdCommands
      .map((c) => ({ c, score: fuzzyScore(q, `${c.label} ${c.keywords}`) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 9)
      .map((r) => r.c);
    cmdActiveIdx = Math.min(cmdActiveIdx, Math.max(0, cmdFiltered.length - 1));
    cmdResults.innerHTML = cmdFiltered.length
      ? cmdFiltered.map((c, i) => `
        <button class="cmd-item ${i === cmdActiveIdx ? 'active' : ''}" data-cmd-idx="${i}">
          <span class="cmd-item-label">${c.label}</span>
          <span class="cmd-item-hint">${c.hint}</span>
        </button>`).join('')
      : '<div class="cmd-empty">No matching command</div>';
  }

  function openPalette() {
    if (!cmdCommands) cmdCommands = buildCommands();
    cmdPalette.classList.add('open');
    cmdInput.value = '';
    cmdActiveIdx = 0;
    renderCmdResults();
    requestAnimationFrame(() => cmdInput.focus());
  }

  function closePalette() {
    cmdPalette.classList.remove('open');
    cmdInput.blur();
  }

  function runActiveCommand() {
    const cmd = cmdFiltered[cmdActiveIdx];
    closePalette();
    if (cmd) {
      try { cmd.run(); } catch (err) { console.warn('[deck] command failed:', err); }
    }
  }

  cmdInput.addEventListener('input', () => { cmdActiveIdx = 0; renderCmdResults(); });
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdActiveIdx = Math.min(cmdFiltered.length - 1, cmdActiveIdx + 1);
      renderCmdResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdActiveIdx = Math.max(0, cmdActiveIdx - 1);
      renderCmdResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActiveCommand();
    }
  });
  cmdResults.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-item');
    if (!item) return;
    cmdActiveIdx = parseInt(item.dataset.cmdIdx, 10);
    runActiveCommand();
  });
  cmdBackdrop.addEventListener('click', closePalette);

  /* ========================================================================
     Global UI wiring
     ======================================================================== */

  btnPrev.addEventListener('click', () => goToSlide(currentSlideIndex - 1));
  btnNext.addEventListener('click', () => goToSlide(currentSlideIndex + 1));

  btnNotes.addEventListener('click', () => {
    notesPanel.classList.toggle('open');
    btnNotes.classList.toggle('active');
  });

  notesCloseBtn.addEventListener('click', () => {
    notesPanel.classList.remove('open');
    btnNotes.classList.remove('active');
  });

  function openGridModal() {
    gridModal.classList.add('open');
    requestAnimationFrame(drawGridThumbs);
  }
  function closeGridModal() {
    gridModal.classList.remove('open');
  }
  btnGrid.addEventListener('click', () => {
    if (gridModal.classList.contains('open')) closeGridModal();
    else openGridModal();
  });
  gridCloseBtn.addEventListener('click', closeGridModal);
  gridModalBackdrop.addEventListener('click', closeGridModal);

  function toggleHelp() {
    helpModal.classList.toggle('open');
  }
  btnHelp.addEventListener('click', toggleHelp);
  helpBackdrop.addEventListener('click', () => helpModal.classList.remove('open'));

  btnPresenter.addEventListener('click', () => {
    document.body.classList.toggle('presenter-mode');
    btnPresenter.classList.toggle('active');
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Command palette (Ctrl/Cmd+K) works everywhere.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (cmdPalette.classList.contains('open')) closePalette();
      else openPalette();
      return;
    }

    // While the palette is open, it owns the keyboard.
    if (cmdPalette.classList.contains('open')) {
      if (e.key === 'Escape') closePalette();
      return;
    }

    if (e.key === 'Escape') {
      if (helpModal.classList.contains('open')) helpModal.classList.remove('open');
      if (gridModal.classList.contains('open')) closeGridModal();
      if (notesPanel.classList.contains('open')) {
        notesPanel.classList.remove('open');
        btnNotes.classList.remove('active');
      }
      return;
    }

    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      goToSlide(currentSlideIndex + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      goToSlide(currentSlideIndex - 1);
    } else if (e.key.toLowerCase() === 'n') {
      notesPanel.classList.toggle('open');
      btnNotes.classList.toggle('active');
    } else if (e.key.toLowerCase() === 'g') {
      if (gridModal.classList.contains('open')) closeGridModal();
      else openGridModal();
    } else if (e.key.toLowerCase() === 'p') {
      btnPresenter.click();
    } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      toggleHelp();
    } else if (e.key.toLowerCase() === 'f') {
      btnFullscreen.click();
    } else if (e.key.toLowerCase() === 'a') {
      setAutoplay(!autoplay.on);
    } else if (['h', 't', 'm', 'v'].includes(e.key.toLowerCase())) {
      // Chart tool hotkeys on chart slides: H-line / Trend / Measure / cursor.
      const engine = chartInstances[currentSlideIndex];
      if (engine && slidesData[currentSlideIndex].type === 'chart') {
        const toolMap = { h: 'hline', t: 'trend', m: 'measure', v: 'none' };
        const tool = toolMap[e.key.toLowerCase()];
        engine.setTool(tool);
        const card = document.getElementById(`slide-${currentSlideIndex}`);
        if (card) {
          card.querySelectorAll('.tool-btn[data-tool]').forEach((b) => {
            b.classList.toggle('active', b.dataset.tool === tool);
          });
        }
      }
    } else if (!isNaN(parseInt(e.key)) && parseInt(e.key) >= 1 && parseInt(e.key) <= totalSlides) {
      goToSlide(parseInt(e.key) - 1);
    }
  });

  let touchX = null;
  viewportEl.addEventListener('touchstart', (e) => {
    touchX = e.changedTouches[0].clientX;
  }, { passive: true });
  viewportEl.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (dx < -60) goToSlide(currentSlideIndex + 1);
    if (dx > 60) goToSlide(currentSlideIndex - 1);
    touchX = null;
  });

  setInterval(() => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    if (sessionClockEl) sessionClockEl.textContent = `${mm}:${ss}`;
  }, 1000);

  setInterval(() => {
    quoteIdx = (quoteIdx + 1) % JC_QUOTES.length;
    if (quoteEl) quoteEl.textContent = `"${JC_QUOTES[quoteIdx]}"`;
  }, 9000);

  /* ========================================================================
     Boot — parse deep link (#<slide>/<symbol>) and go
     ======================================================================== */

  renderAllSlides();
  const boot = parseHash();
  if (boot.symbol && slidesData[boot.slide].type === 'chart') {
    const sym = resolveSymbol(slidesData[boot.slide], boot.symbol);
    if (sym) symbolBySlide[boot.slide] = sym;
  }
  goToSlide(boot.slide);
});
