/**
 * Interactive technical chart engine — JC / All Star Charts style.
 *
 * Features:
 *  - Candle / line / RS-ratio chart types, SMA 50/200, Fib levels, R/R zones,
 *    volume + RSI panes, last-price tag, crosshair tooltip.
 *  - Wheel zoom (anchored), drag pan, double-click reset.
 *  - Drawing tools: horizontal line + trendline (click-click placement with
 *    magnet snap to O/H/L/C), drag to move, double-click to delete, clear.
 *  - Measure tool: drag a range -> overlay with delta $, delta %, # bars.
 *  - Zoom-to-selection: Shift+drag (or drag on the time axis) to zoom a range.
 *  - Export PNG with watermark title (fully offline, no fetch/XHR).
 *  - Draw-on animation (~600ms ease-out) via animateIn(); honors
 *    prefers-reduced-motion.
 *
 * Performance contract (SPEC section D):
 *  - Render loop is rAF-driven through scheduleRender(); event handlers only
 *    mutate state and schedule a frame.
 *  - Visible-window min/max computed in a single index-based pass — no
 *    Array.slice in the hot path.
 *  - DPR-aware canvas sizing; backing store only resized when dimensions
 *    actually change.
 *  - Bounding rect is cached and refreshed on resize / gesture start — no
 *    layout reads on mousemove.
 *  - destroy() detaches the ResizeObserver and all window listeners.
 */
class TechnicalChartEngine {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.options = Object.assign({
      showSMA200: true,
      showSMA50: true,
      showFib: true,
      showRSI: true,
      showVolume: true,
      showRR: true,
      chartType: "candle",
      riskLevel: null,
      targetPrice: null,
      fibLevels: [],
      symbol: null,
      onDrawingsChange: null // optional callback(drawings[]) for persistence
    }, options);

    // --- core view state ---
    this.data = [];
    this.viewStart = 0;
    this.viewEnd = 0;
    this.mousePos = null;
    this.hoverIdx = null;
    this.tooltipEl = null;
    this._layout = null;
    this._raf = 0;
    this._dpr = 1;
    this._rect = null; // cached client rect {left, top}

    // --- interaction / tools state ---
    this.tool = "none";          // none | hline | trend | measure
    this.drawings = [];          // {type:'hline',price} | {type:'trend',i1,p1,i2,p2}
    this._anchor = null;         // pending click-click anchor {i, price}
    this._panDrag = null;        // active pan {x, lastShiftX}
    this._dragDrawing = null;    // {drawing, startI, startPrice}
    this._zoomSel = null;        // active zoom-to-selection {x1, x2}
    this._measuring = null;      // active measure drag {i1, i2}
    this._measure = null;        // committed measure {i1, i2}

    // --- animation state ---
    this._animRaf = 0;
    this._animProgress = null;   // 0..1 while draw-on animation runs
    this._reduceMotion = !!(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    this._bound = {}; // named handlers so destroy() can detach them
    this.initCanvas();
    this.bindEvents();
  }

  /* ========================================================================
     Canvas sizing / events
     ======================================================================== */

  initCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    this._rect = { left: rect.left, top: rect.top };
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    // Only touch the backing store when the size actually changed —
    // resizing clears the canvas and costs a full re-raster.
    if (this.width === w && this.height === h && this._dpr === dpr && this.canvas.width) {
      return true;
    }
    this._dpr = dpr;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  _refreshRect() {
    const rect = this.canvas.getBoundingClientRect();
    this._rect = { left: rect.left, top: rect.top };
  }

  bindEvents() {
    const B = this._bound;

    B.resize = () => {
      if (this.initCanvas()) this.scheduleRender();
    };
    this._ro = new ResizeObserver(B.resize);
    this._ro.observe(this.canvas);

    B.mousemove = (e) => {
      if (!this._rect) return;
      const x = e.clientX - this._rect.left;
      const y = e.clientY - this._rect.top;
      this.mousePos = { x, y };

      if (this._panDrag && this._layout) {
        // Pan by whole bars using the cached layout — no DOM reads here.
        const visN = this._layout.visN || 1;
        const dx = x - this._panDrag.x;
        const shift = Math.round((-dx / Math.max(this._layout.chartWidth, 1)) * visN);
        if (shift !== 0) {
          this._panBy(shift);
          this._panDrag.x = x;
        }
      } else if (this._zoomSel) {
        this._zoomSel.x2 = x;
      } else if (this._measuring && this._layout) {
        this._measuring.i2 = this._xToIdx(x);
      } else if (this._dragDrawing && this._layout) {
        this._moveDraggedDrawing(x, y);
      }
      this.scheduleRender();
    };
    this.canvas.addEventListener("mousemove", B.mousemove);

    B.mouseleave = () => {
      this.mousePos = null;
      this.hoverIdx = null;
      this._panDrag = null;
      this.scheduleRender();
      if (this.tooltipEl) this.tooltipEl.style.display = "none";
    };
    this.canvas.addEventListener("mouseleave", B.mouseleave);

    B.mousedown = (e) => {
      if (e.button !== 0 || !this._layout) return;
      this._refreshRect();
      const x = e.clientX - this._rect.left;
      const y = e.clientY - this._rect.top;

      // Measure tool: drag a bar range.
      if (this.tool === "measure") {
        const i = this._xToIdx(x);
        this._measuring = { i1: i, i2: i };
        this._measure = null;
        this.scheduleRender();
        return;
      }
      // Zoom-to-selection: Shift+drag anywhere, or a drag starting on the
      // time axis strip at the bottom of the chart.
      if (e.shiftKey || y > this.height - this._layout.axisH) {
        this._zoomSel = { x1: x, x2: x };
        this.scheduleRender();
        return;
      }
      // Drawing tools place via click-click (handled in the click handler).
      if (this.tool === "hline" || this.tool === "trend") return;

      // Grab an existing drawing to drag it, otherwise start a pan.
      const hit = this.options.chartType === "rs" ? null : this._hitDrawing(x, y);
      if (hit) {
        this._dragDrawing = {
          drawing: hit,
          startI: this._xToIdx(x),
          startPrice: this._yToPrice(y),
          orig: Object.assign({}, hit) // drift-free snapshot for the drag
        };
        this.canvas.style.cursor = "move";
      } else {
        this._panDrag = { x };
        this.canvas.style.cursor = "grabbing";
      }
    };
    this.canvas.addEventListener("mousedown", B.mousedown);

    B.click = (e) => {
      if (!this._layout) return;
      if (this.tool !== "hline" && this.tool !== "trend") return;
      this._refreshRect();
      const x = e.clientX - this._rect.left;
      const y = e.clientY - this._rect.top;
      if (x < this._layout.padL || x > this.width - this._layout.padR) return;
      if (y > this._layout.mainBottom) return;
      const i = this._xToIdx(x);
      const price = this._snapPrice(i, this._yToPrice(y));

      if (!this._anchor) {
        // First click anchors; preview follows the mouse until commit.
        this._anchor = { i, price };
      } else if (this.tool === "hline") {
        this.drawings.push({ type: "hline", price: this._anchor.price });
        this._anchor = null;
        this._emitDrawings();
      } else {
        // Trendline needs two distinct bar indices.
        if (i !== this._anchor.i) {
          const a = this._anchor;
          const [p1, p2] = a.i < i ? [a, { i, price }] : [{ i, price }, a];
          this.drawings.push({ type: "trend", i1: p1.i, p1: p1.price, i2: p2.i, p2: p2.price });
          this._emitDrawings();
        }
        this._anchor = null;
      }
      this.scheduleRender();
    };
    this.canvas.addEventListener("click", B.click);

    B.mouseup = () => {
      // Commit a zoom-to-selection gesture.
      if (this._zoomSel && this._layout) {
        const { x1, x2 } = this._zoomSel;
        if (Math.abs(x2 - x1) > 10) {
          const a = this._xToIdx(Math.min(x1, x2));
          const b = this._xToIdx(Math.max(x1, x2));
          if (b - a >= 8) {
            this.viewStart = a;
            this.viewEnd = b + 1;
          }
        }
        this._zoomSel = null;
      }
      if (this._measuring) {
        const { i1, i2 } = this._measuring;
        this._measure = i1 !== i2 ? { i1: Math.min(i1, i2), i2: Math.max(i1, i2) } : null;
        this._measuring = null;
      }
      if (this._dragDrawing) this._emitDrawings();
      this._panDrag = null;
      this._dragDrawing = null;
      this.canvas.style.cursor = "crosshair";
      this.scheduleRender();
    };
    window.addEventListener("mouseup", B.mouseup);

    B.wheel = (e) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      this.zoom(dir, this.mousePos ? this.mousePos.x : null);
    };
    this.canvas.addEventListener("wheel", B.wheel, { passive: false });

    B.dblclick = (e) => {
      if (!this._layout) { this.resetView(); return; }
      this._refreshRect();
      const x = e.clientX - this._rect.left;
      const y = e.clientY - this._rect.top;
      const hit = this.options.chartType === "rs" ? null : this._hitDrawing(x, y);
      if (hit) {
        // Double-click a drawing deletes it.
        this.drawings = this.drawings.filter((d) => d !== hit);
        this._emitDrawings();
        this.scheduleRender();
      } else {
        this.resetView();
      }
    };
    this.canvas.addEventListener("dblclick", B.dblclick);

    B.keydown = (e) => {
      if (e.key !== "Escape") return;
      // Cancel any in-flight tool gesture without disturbing the active tool.
      if (this._anchor || this._measuring || this._zoomSel || this._measure) {
        this._anchor = null;
        this._measuring = null;
        this._zoomSel = null;
        this._measure = null;
        this.scheduleRender();
      }
    };
    window.addEventListener("keydown", B.keydown);

    this.canvas.style.cursor = "crosshair";
  }

  /** Detach every listener / observer so replaced instances cannot leak. */
  destroy() {
    if (this._ro) this._ro.disconnect();
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._animRaf);
    if (this.canvas) {
      this.canvas.removeEventListener("mousemove", this._bound.mousemove);
      this.canvas.removeEventListener("mouseleave", this._bound.mouseleave);
      this.canvas.removeEventListener("mousedown", this._bound.mousedown);
      this.canvas.removeEventListener("click", this._bound.click);
      this.canvas.removeEventListener("wheel", this._bound.wheel);
      this.canvas.removeEventListener("dblclick", this._bound.dblclick);
    }
    window.removeEventListener("mouseup", this._bound.mouseup);
    window.removeEventListener("keydown", this._bound.keydown);
  }

  /* ========================================================================
     Coordinate helpers (all rely on the cached _layout, no DOM reads)
     ======================================================================== */

  _xToIdx(x) {
    const L = this._layout;
    if (!L) return 0;
    const rel = Math.round(((x - L.padL) / L.chartWidth) * (L.visN - 1));
    return Math.max(L.i0, Math.min(L.i1 - 1, L.i0 + rel));
  }

  _idxToX(i) {
    const L = this._layout;
    return L.padL + ((i - L.i0) / (L.visN - 1)) * L.chartWidth;
  }

  _yToPrice(y) {
    const L = this._layout;
    return L.minPrice + ((L.mainBottom - y) / L.innerH) * (L.maxPrice - L.minPrice);
  }

  _priceToY(p) {
    const L = this._layout;
    return L.mainBottom - ((p - L.minPrice) / (L.maxPrice - L.minPrice)) * L.innerH;
  }

  /** Magnet snap: snap a price to the nearest O/H/L/C of bar `idx` within
   *  an 8px tolerance (converted to price units via the cached layout). */
  _snapPrice(idx, price) {
    const L = this._layout;
    const d = this.data[idx];
    if (!L || !d) return price;
    const tol = (8 / L.innerH) * (L.maxPrice - L.minPrice);
    let best = price;
    let bestDist = tol;
    for (const v of [d.open, d.high, d.low, d.close]) {
      const dist = Math.abs(v - price);
      if (dist <= bestDist) { bestDist = dist; best = v; }
    }
    return best;
  }

  /** Hit-test drawings within 7px. Returns the drawing or null. */
  _hitDrawing(mx, my) {
    const L = this._layout;
    if (!L) return null;
    for (let k = this.drawings.length - 1; k >= 0; k--) {
      const d = this.drawings[k];
      if (d.type === "hline") {
        const y = this._priceToY(d.price);
        if (Math.abs(my - y) <= 7 && mx >= L.padL && mx <= this.width - L.padR) return d;
      } else if (d.type === "trend") {
        if (d.i2 < L.i0 || d.i1 > L.i1 - 1) continue;
        const x1 = this._idxToX(Math.max(d.i1, L.i0));
        const y1 = this._priceToY(this._trendPriceAt(d, Math.max(d.i1, L.i0)));
        const x2 = this._idxToX(Math.min(d.i2, L.i1 - 1));
        const y2 = this._priceToY(this._trendPriceAt(d, Math.min(d.i2, L.i1 - 1)));
        if (this._distToSegment(mx, my, x1, y1, x2, y2) <= 7) return d;
      }
    }
    return null;
  }

  _trendPriceAt(d, i) {
    if (d.i2 === d.i1) return d.p1;
    return d.p1 + ((d.p2 - d.p1) * (i - d.i1)) / (d.i2 - d.i1);
  }

  _distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  /** Drag-move the active drawing by the gesture delta from its snapshot
   *  (with magnet snap on price). Mutates the drawing in place. */
  _moveDraggedDrawing(x, y) {
    const g = this._dragDrawing;
    const d = g.drawing;
    const dp = this._yToPrice(y) - g.startPrice;
    if (d.type === "hline") {
      d.price = this._snapPrice(this._xToIdx(x), g.orig.price + dp);
    } else if (d.type === "trend") {
      const n = this.data.length;
      const span = g.orig.i2 - g.orig.i1;
      const di = this._xToIdx(x) - g.startI;
      const ni1 = Math.max(0, Math.min(n - 1 - span, g.orig.i1 + di));
      d.i1 = ni1;
      d.i2 = ni1 + span;
      d.p1 = this._snapPrice(d.i1, g.orig.p1 + dp);
      d.p2 = this._snapPrice(d.i2, g.orig.p2 + dp);
    }
  }

  _emitDrawings() {
    if (typeof this.options.onDrawingsChange === "function") {
      this.options.onDrawingsChange(this.drawings);
    }
  }

  /* ========================================================================
     Tool & drawing public API
     ======================================================================== */

  /** Activate a chart tool: "none" | "hline" | "trend" | "measure". */
  setTool(tool) {
    this.tool = tool || "none";
    this._anchor = null;
    this._measuring = null;
    if (this.tool !== "measure") this._measure = null;
    this.scheduleRender();
  }

  clearDrawings() {
    this.drawings = [];
    this._anchor = null;
    this._emitDrawings();
    this.scheduleRender();
  }

  getDrawings() {
    return this.drawings;
  }

  /** Restore drawings (per-slide, per-symbol persistence). */
  setDrawings(drawings) {
    this.drawings = Array.isArray(drawings) ? drawings : [];
    this._anchor = null;
    this.scheduleRender();
  }

  /* ========================================================================
     Data / view public API (signatures preserved from the original engine)
     ======================================================================== */

  visible() {
    return this.data.slice(this.viewStart, this.viewEnd);
  }

  resetView() {
    this.viewStart = 0;
    this.viewEnd = this.data.length;
    this.scheduleRender();
  }

  zoom(dir, anchorX) {
    const n = this.data.length;
    if (n < 20) return;
    const span = this.viewEnd - this.viewStart;
    const next = dir > 0 ? Math.round(span * 1.18) : Math.round(span * 0.82);
    const clamped = Math.max(40, Math.min(n, next));
    const layout = this._layout;
    const ratio = layout && anchorX != null
      ? Math.min(1, Math.max(0, (anchorX - layout.padL) / layout.chartWidth))
      : 0.7;
    const center = this.viewStart + span * ratio;
    let start = Math.round(center - clamped * ratio);
    let end = start + clamped;
    if (start < 0) { end -= start; start = 0; }
    if (end > n) { start -= end - n; end = n; }
    this.viewStart = Math.max(0, start);
    this.viewEnd = Math.min(n, end);
    this.scheduleRender();
  }

  pan(shift) {
    this._panBy(shift);
    this.scheduleRender();
  }

  _panBy(shift) {
    const n = this.data.length;
    const span = this.viewEnd - this.viewStart;
    let start = this.viewStart + shift;
    start = Math.max(0, Math.min(n - span, start));
    this.viewStart = start;
    this.viewEnd = start + span;
  }

  setData(data, options = {}) {
    this.data = data || [];
    this.options = Object.assign(this.options, options);
    if (!this.options.targetPrice && this.options.fibLevels && this.options.fibLevels.length) {
      const t1 = this.options.fibLevels.find((f) => /161/.test(f.label));
      if (t1) this.options.targetPrice = t1.price;
    }
    this.viewStart = 0;
    this.viewEnd = this.data.length;
    this._measure = null;
    this._measuring = null;
    this._anchor = null;
    this.initCanvas();
    this.render();
  }

  toggleOption(key) {
    if (key in this.options) {
      this.options[key] = !this.options[key];
      this.scheduleRender();
    }
  }

  setChartType(type) {
    this.options.chartType = type;
    this.scheduleRender();
  }

  /* ========================================================================
     Render scheduling — strictly rAF-driven with a dirty flag
     ======================================================================== */

  scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
      this.updateTooltip();
    });
  }

  fmt(p) {
    if (p == null || Number.isNaN(p)) return "—";
    if (Math.abs(p) < 2) return p.toFixed(3);
    return `$${p.toFixed(2)}`;
  }

  /* ========================================================================
     Main render — single-pass index-based min/max, no Array.slice.
     ======================================================================== */

  render() {
    if (!this.ctx || !this.data.length || !this.width) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);

    const n = this.data.length;
    const i0 = Math.max(0, Math.min(this.viewStart, n - 2));
    const i1 = Math.max(i0 + 2, Math.min(this.viewEnd, n));
    this.viewStart = i0;
    this.viewEnd = i1;
    const visN = i1 - i0;

    const opts = this.options;
    const isRS = opts.chartType === "rs";
    const showRSI = opts.showRSI;
    const showVol = opts.showVolume && !isRS;
    const rsiH = showRSI ? Math.max(56, h * 0.16) : 0;
    const volH = showVol ? Math.max(42, h * 0.12) : 0;
    const axisH = 22;
    const padL = 16;
    const padR = 78;
    const chartWidth = w - padR - padL;
    const mainTop = 10;
    const mainHeight = h - rsiH - volH - axisH - mainTop - (showRSI || showVol ? 10 : 0);
    const mainBottom = mainTop + mainHeight;
    const volTop = mainBottom + 6;
    const rsiTop = volTop + volH + (showVol ? 6 : 0);

    // Single pass over the visible window for min/max (+ max volume).
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;
    const wantSMA50 = !isRS && opts.showSMA50;
    const wantSMA200 = !isRS && opts.showSMA200;
    for (let i = i0; i < i1; i++) {
      const d = this.data[i];
      if (isRS) {
        if (d.rsRatio < minPrice) minPrice = d.rsRatio;
        if (d.rsRatio > maxPrice) maxPrice = d.rsRatio;
      } else if (opts.chartType === "candle") {
        if (d.low < minPrice) minPrice = d.low;
        if (d.high > maxPrice) maxPrice = d.high;
      } else {
        if (d.close < minPrice) minPrice = d.close;
        if (d.close > maxPrice) maxPrice = d.close;
      }
      if (wantSMA50 && d.sma50 != null) {
        if (d.sma50 < minPrice) minPrice = d.sma50;
        if (d.sma50 > maxPrice) maxPrice = d.sma50;
      }
      if (wantSMA200 && d.sma200 != null) {
        if (d.sma200 < minPrice) minPrice = d.sma200;
        if (d.sma200 > maxPrice) maxPrice = d.sma200;
      }
      if (showVol && d.volume > maxVol) maxVol = d.volume;
    }
    // Keep user drawings inside the visible price range.
    if (!isRS) {
      for (let k = 0; k < this.drawings.length; k++) {
        const d = this.drawings[k];
        if (d.type === "hline") {
          if (d.price < minPrice) minPrice = d.price;
          if (d.price > maxPrice) maxPrice = d.price;
        } else {
          if (Math.min(d.p1, d.p2) < minPrice) minPrice = Math.min(d.p1, d.p2);
          if (Math.max(d.p1, d.p2) > maxPrice) maxPrice = Math.max(d.p1, d.p2);
        }
      }
    }
    if (opts.showFib && opts.fibLevels && !isRS) {
      for (let k = 0; k < opts.fibLevels.length; k++) {
        const f = opts.fibLevels[k];
        if (f.price >= minPrice * 0.7 && f.price <= maxPrice * 1.45) {
          if (f.price < minPrice) minPrice = f.price;
          if (f.price > maxPrice) maxPrice = f.price;
        }
      }
    }
    const range = (maxPrice - minPrice) || 1;
    minPrice -= range * 0.06;
    maxPrice += range * 0.1;

    const spanY = maxPrice - minPrice;
    const innerH = mainHeight - 8;
    const getY = (p) => mainBottom - ((p - minPrice) / spanY) * innerH;
    const getX = (rel) => padL + (rel / (visN - 1)) * chartWidth;
    this._layout = {
      padL, padR, chartWidth, mainTop, mainBottom, mainHeight, innerH,
      minPrice, maxPrice, rsiTop, volTop, volH, rsiH, axisH, visN, i0, i1
    };

    // ---- background + horizontal grid ----
    ctx.fillStyle = "#fbf8ef";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#ddd5c0";
    ctx.lineWidth = 1;
    const gridSteps = 6;
    ctx.font = "10px \"IBM Plex Mono\", monospace";
    ctx.textAlign = "left";
    for (let i = 0; i <= gridSteps; i++) {
      const p = minPrice + (i / gridSteps) * spanY;
      const y = getY(p);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = "#5b6472";
      ctx.fillText(this.fmt(p).replace("$", ""), w - padR + 8, y + 3);
    }

    // ---- R/R zones ----
    if (opts.showRR && opts.riskLevel != null && opts.targetPrice != null && !isRS) {
      const lastD = this.data[i1 - 1];
      const lastY = getY(lastD.close);
      const riskY = getY(opts.riskLevel);
      const tgtY = getY(opts.targetPrice);
      const zoneX = padL + chartWidth * 0.72;
      const zoneW = chartWidth * 0.28;
      ctx.fillStyle = "rgba(168, 70, 47, 0.08)";
      ctx.fillRect(zoneX, lastY, zoneW, Math.max(2, riskY - lastY));
      ctx.fillStyle = "rgba(74, 124, 89, 0.09)";
      ctx.fillRect(zoneX, tgtY, zoneW, Math.max(2, lastY - tgtY));
    }

    // ---- risk level ----
    if (opts.riskLevel != null && !isRS) {
      const riskY = getY(opts.riskLevel);
      ctx.fillStyle = "rgba(168, 70, 47, 0.05)";
      ctx.fillRect(padL, riskY, chartWidth, Math.max(0, mainBottom - riskY));
      ctx.strokeStyle = "#a8462f";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, riskY);
      ctx.lineTo(w - padR, riskY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#a8462f";
      ctx.font = "bold 10px \"IBM Plex Mono\", monospace";
      ctx.fillText("RISK", w - padR + 8, riskY - 4);
    }

    // ---- Fibonacci levels ----
    if (opts.showFib && opts.fibLevels && !isRS) {
      for (let k = 0; k < opts.fibLevels.length; k++) {
        const fib = opts.fibLevels[k];
        if (fib.price === opts.riskLevel) continue;
        const fibY = getY(fib.price);
        if (fibY < mainTop || fibY > mainBottom) continue;
        ctx.strokeStyle = fib.color || "#4a7c59";
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, fibY);
        ctx.lineTo(w - padR, fibY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = fib.color || "#4a7c59";
        ctx.font = "600 10px \"IBM Plex Mono\", monospace";
        ctx.textAlign = "left";
        const short = (fib.label || "").split("(")[0].trim();
        ctx.fillText(short, padL + 6, fibY - 4);
      }
    }

    // ---- series + indicators (clipped during draw-on animation) ----
    ctx.save();
    if (this._animProgress != null) {
      ctx.beginPath();
      ctx.rect(padL, 0, chartWidth * this._animProgress + 2, h);
      ctx.clip();
    }

    const strokeMA = (key, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (let i = i0; i < i1; i++) {
        const v = this.data[i][key];
        if (v == null) continue;
        const x = getX(i - i0);
        const y = getY(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    if (!isRS) {
      if (opts.showSMA200) strokeMA("sma200", "#b08a3e", 2);
      if (opts.showSMA50) strokeMA("sma50", "#23405f", 1.7);
    }

    if (opts.chartType === "candle") {
      const candleW = Math.max(1.6, (chartWidth / visN) * 0.62);
      for (let i = i0; i < i1; i++) {
        const d = this.data[i];
        const x = getX(i - i0);
        const up = d.close >= d.open;
        const color = up ? "#4a7c59" : "#a8462f";
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, getY(d.high));
        ctx.lineTo(x, getY(d.low));
        ctx.stroke();
        const top = Math.min(getY(d.open), getY(d.close));
        const body = Math.max(1.2, Math.abs(getY(d.close) - getY(d.open)));
        ctx.fillStyle = color;
        ctx.fillRect(x - candleW / 2, top, candleW, body);
      }
    } else {
      const lineColor = isRS ? "#4a7c59" : "#23405f";
      const grad = ctx.createLinearGradient(0, mainTop, 0, mainBottom);
      grad.addColorStop(0, isRS ? "rgba(74, 124, 89, 0.16)" : "rgba(35, 64, 95, 0.14)");
      grad.addColorStop(1, "rgba(251, 248, 239, 0)");
      ctx.beginPath();
      for (let i = i0; i < i1; i++) {
        const y = getY(isRS ? this.data[i].rsRatio : this.data[i].close);
        if (i === i0) ctx.moveTo(getX(i - i0), y);
        else ctx.lineTo(getX(i - i0), y);
      }
      ctx.lineTo(getX(visN - 1), mainBottom);
      ctx.lineTo(getX(0), mainBottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      for (let i = i0; i < i1; i++) {
        const y = getY(isRS ? this.data[i].rsRatio : this.data[i].close);
        if (i === i0) ctx.moveTo(getX(i - i0), y);
        else ctx.lineTo(getX(i - i0), y);
      }
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ---- volume pane ----
    if (showVol) {
      const bw = Math.max(1.4, (chartWidth / visN) * 0.7);
      const vMax = maxVol || 1;
      for (let i = i0; i < i1; i++) {
        const d = this.data[i];
        const x = getX(i - i0);
        const bh = ((d.volume || 0) / vMax) * (volH - 4);
        const up = d.close >= d.open;
        ctx.fillStyle = up ? "rgba(74, 124, 89, 0.42)" : "rgba(168, 70, 47, 0.38)";
        ctx.fillRect(x - bw / 2, volTop + volH - bh, bw, bh);
      }
      ctx.fillStyle = "#5b6472";
      ctx.font = "bold 9px \"IBM Plex Mono\", monospace";
      ctx.textAlign = "left";
      ctx.fillText("VOL", padL + 4, volTop + 10);
    }

    // ---- RSI pane ----
    if (showRSI) {
      const rsiBottom = rsiTop + rsiH - 4;
      const rsiInner = rsiBottom - rsiTop - 8;
      ctx.strokeStyle = "#d9d2bd";
      ctx.beginPath();
      ctx.moveTo(padL, rsiTop);
      ctx.lineTo(w - padR, rsiTop);
      ctx.stroke();
      ctx.fillStyle = "#7d5a78";
      ctx.font = "bold 10px \"IBM Plex Mono\", monospace";
      ctx.textAlign = "left";
      ctx.fillText("RSI 14", padL + 4, rsiTop + 12);
      const yAt = (v) => rsiBottom - (v / 100) * rsiInner;
      ctx.fillStyle = "rgba(125, 90, 120, 0.08)";
      ctx.fillRect(padL, yAt(80), chartWidth, yAt(40) - yAt(80));
      ctx.strokeStyle = "#ddd5c0";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, yAt(70)); ctx.lineTo(w - padR, yAt(70));
      ctx.moveTo(padL, yAt(30)); ctx.lineTo(w - padR, yAt(30));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#5b6472";
      ctx.font = "9px \"IBM Plex Mono\", monospace";
      ctx.fillText("70", w - padR + 8, yAt(70) + 3);
      ctx.fillText("30", w - padR + 8, yAt(30) + 3);
      ctx.strokeStyle = "#7d5a78";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = i0; i < i1; i++) {
        const y = yAt(this.data[i].rsi != null ? this.data[i].rsi : 50);
        if (i === i0) ctx.moveTo(getX(i - i0), y);
        else ctx.lineTo(getX(i - i0), y);
      }
      ctx.stroke();
    }
    ctx.restore(); // end animation clip

    // ---- last price tag ----
    const lastD = this.data[i1 - 1];
    const lastVal = isRS ? lastD.rsRatio : lastD.close;
    const lastY = getY(lastVal);
    ctx.strokeStyle = "rgba(35, 64, 95, 0.35)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, lastY);
    ctx.lineTo(w - padR, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#23405f";
    ctx.fillRect(w - padR + 2, lastY - 8, 72, 16);
    ctx.fillStyle = "#fbf8ef";
    ctx.font = "bold 10px \"IBM Plex Mono\", monospace";
    ctx.textAlign = "left";
    ctx.fillText(this.fmt(lastVal).replace("$", ""), w - padR + 6, lastY + 3);

    // ---- date axis ----
    ctx.fillStyle = "#5b6472";
    ctx.font = "10px \"IBM Plex Mono\", monospace";
    ctx.textAlign = "center";
    const dateStep = Math.max(1, Math.ceil(visN / 6));
    for (let i = i0; i < i1; i += dateStep) {
      // Left-align the first tick so its label never clips off the plot edge.
      ctx.textAlign = i === i0 ? "left" : "center";
      ctx.fillText(this.data[i].date.replace(", ", " '"), getX(i - i0), h - 7);
    }

    // ---- overlays: drawings, pending anchor, measure, zoom selection ----
    if (!isRS) this._renderDrawings(ctx, w);
    this._renderMeasure(ctx, w);
    this._renderZoomSelection(ctx);

    // ---- crosshair ----
    if (this.mousePos && this.mousePos.x >= padL && this.mousePos.x <= w - padR) {
      const rel = Math.min(visN - 1, Math.max(0,
        Math.round(((this.mousePos.x - padL) / chartWidth) * (visN - 1))));
      this.hoverIdx = i0 + rel;
      const d = this.data[this.hoverIdx];
      const snapX = getX(rel);
      ctx.strokeStyle = "rgba(35, 64, 95, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(snapX, mainTop);
      ctx.lineTo(snapX, h - axisH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(padL, this.mousePos.y);
      ctx.lineTo(w - padR, this.mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const py = getY(isRS ? d.rsRatio : d.close);
      ctx.fillStyle = "#23405f";
      ctx.beginPath();
      ctx.arc(snapX, py, 3.4, 0, Math.PI * 2);
      ctx.fill();
      // Magnet preview dot while a drawing tool is armed.
      if ((this.tool === "hline" || this.tool === "trend") && this.mousePos.y <= mainBottom) {
        const snapped = this._snapPrice(this.hoverIdx, this._yToPrice(this.mousePos.y));
        ctx.strokeStyle = "rgba(176, 138, 62, 0.9)";
        ctx.beginPath();
        ctx.arc(snapX, getY(snapped), 4.4, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      this.hoverIdx = null;
    }
  }

  /* ========================================================================
     Overlay renderers: drawings, pending anchor, measure, zoom selection
     ======================================================================== */

  _renderDrawings(ctx, w) {
    const L = this._layout;
    const right = w - L.padR;
    ctx.font = "600 10px \"IBM Plex Mono\", monospace";

    for (let k = 0; k < this.drawings.length; k++) {
      const d = this.drawings[k];
      if (d.type === "hline") {
        const y = this._priceToY(d.price);
        if (y < L.mainTop || y > L.mainBottom) continue;
        ctx.strokeStyle = "#b08a3e";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([7, 4]);
        ctx.beginPath();
        ctx.moveTo(L.padL, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#b08a3e";
        ctx.textAlign = "right";
        ctx.fillText(this.fmt(d.price), right - 6, y - 5);
      } else if (d.type === "trend") {
        if (d.i2 < L.i0 || d.i1 > L.i1 - 1) continue;
        const ci1 = Math.max(d.i1, L.i0);
        const ci2 = Math.min(d.i2, L.i1 - 1);
        const x1 = this._idxToX(ci1);
        const y1 = this._priceToY(this._trendPriceAt(d, ci1));
        const x2 = this._idxToX(ci2);
        const y2 = this._priceToY(this._trendPriceAt(d, ci2));
        ctx.strokeStyle = "#b08a3e";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Anchor handles.
        ctx.fillStyle = "#23405f";
        for (const [ax, ay] of [[x1, y1], [x2, y2]]) {
          ctx.beginPath();
          ctx.arc(ax, ay, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Pending click-click anchor + live preview to the snapped mouse point.
    if (this._anchor && this.mousePos && (this.tool === "hline" || this.tool === "trend")) {
      const a = this._anchor;
      const ax = this._idxToX(Math.max(L.i0, Math.min(L.i1 - 1, a.i)));
      const ay = this._priceToY(a.price);
      ctx.fillStyle = "#23405f";
      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      ctx.fill();

      const mi = this._xToIdx(this.mousePos.x);
      const mp = this._snapPrice(mi, this._yToPrice(this.mousePos.y));
      const mx = this._idxToX(mi);
      const my = this._priceToY(mp);
      ctx.strokeStyle = "rgba(176, 138, 62, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      if (this.tool === "hline") {
        ctx.moveTo(L.padL, my);
        ctx.lineTo(right, my);
      } else {
        ctx.moveTo(ax, ay);
        ctx.lineTo(mx, my);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _renderMeasure(ctx, w) {
    const L = this._layout;
    const m = this._measuring || this._measure;
    if (!m || m.i1 == null || m.i2 == null || m.i1 === m.i2) return;
    const a = Math.max(L.i0, Math.min(m.i1, m.i2));
    const b = Math.min(L.i1 - 1, Math.max(m.i1, m.i2));
    if (b <= a) return;
    const dA = this.data[a];
    const dB = this.data[b];
    if (!dA || !dB) return;

    const x1 = this._idxToX(a);
    const x2 = this._idxToX(b);
    const isRS = this.options.chartType === "rs";
    const vA = isRS ? dA.rsRatio : dA.close;
    const vB = isRS ? dB.rsRatio : dB.close;
    const delta = vB - vA;
    const pct = (delta / vA) * 100;
    const bars = b - a;

    // Shaded measure region.
    ctx.fillStyle = "rgba(35, 64, 95, 0.06)";
    ctx.fillRect(x1, L.mainTop, x2 - x1, L.mainBottom - L.mainTop);
    ctx.strokeStyle = "rgba(35, 64, 95, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x1, L.mainTop); ctx.lineTo(x1, L.mainBottom);
    ctx.moveTo(x2, L.mainTop); ctx.lineTo(x2, L.mainBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Info box (drawn on canvas so it exports with the PNG).
    const up = delta >= 0;
    const accent = up ? "#4a7c59" : "#a8462f";
    const lines = [
      `${up ? "+" : ""}${isRS ? delta.toFixed(3) : "$" + delta.toFixed(2)}  (${up ? "+" : ""}${pct.toFixed(2)}%)`,
      `${bars} bars  ·  ${this.fmt(vA)} → ${this.fmt(vB)}`
    ];
    ctx.font = "bold 11px \"IBM Plex Mono\", monospace";
    const bw2 = Math.max(ctx.measureText(lines[0]).width, ctx.measureText(lines[1]).width) + 20;
    const bh2 = 44;
    const bx = Math.max(L.padL + 4, Math.min(w - L.padR - bw2 - 4, (x1 + x2) / 2 - bw2 / 2));
    const by = L.mainTop + 6;
    ctx.fillStyle = "rgba(251, 248, 239, 0.96)";
    ctx.strokeStyle = "#d9d2bd";
    ctx.beginPath();
    ctx.rect(bx, by, bw2, bh2);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = accent;
    ctx.fillText(lines[0], bx + 10, by + 17);
    ctx.fillStyle = "#5b6472";
    ctx.font = "10px \"IBM Plex Mono\", monospace";
    ctx.fillText(lines[1], bx + 10, by + 33);
  }

  _renderZoomSelection(ctx) {
    const L = this._layout;
    const z = this._zoomSel;
    if (!z) return;
    const x1 = Math.max(L.padL, Math.min(z.x1, z.x2));
    const x2 = Math.min(this.width - L.padR, Math.max(z.x1, z.x2));
    if (x2 - x1 < 2) return;
    ctx.fillStyle = "rgba(35, 64, 95, 0.07)";
    ctx.fillRect(x1, L.mainTop, x2 - x1, this.height - L.axisH - L.mainTop);
    ctx.strokeStyle = "rgba(35, 64, 95, 0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, L.mainTop, x2 - x1, this.height - L.axisH - L.mainTop);
  }

  /* ========================================================================
     Tooltip, animation, export
     ======================================================================== */

  updateTooltip() {
    const host = this.canvas.parentElement;
    if (!this.tooltipEl && host) this.tooltipEl = host.querySelector(".chart-crosshair-tooltip");
    if (!this.tooltipEl || !this.mousePos || this.hoverIdx == null) {
      if (this.tooltipEl) this.tooltipEl.style.display = "none";
      return;
    }
    const d = this.data[this.hoverIdx];
    if (!d) return;
    const above = this.options.riskLevel == null ? null : d.close >= this.options.riskLevel;
    const chg = this.hoverIdx > 0 ? d.close - this.data[this.hoverIdx - 1].close : 0;
    const chgPct = this.hoverIdx > 0 ? (chg / this.data[this.hoverIdx - 1].close) * 100 : 0;
    const vol = d.volume ? (d.volume / 1e6).toFixed(1) + "M" : "—";
    this.tooltipEl.innerHTML = `
      <div class="tt-date">${d.date}</div>
      <div class="tt-ohlc">
        <span>O ${this.fmt(d.open)}</span>
        <span>H ${this.fmt(d.high)}</span>
        <span>L ${this.fmt(d.low)}</span>
        <span>C <strong>${this.fmt(d.close)}</strong></span>
      </div>
      <div class="tt-row ${chg >= 0 ? "up" : "dn"}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}  ${chgPct.toFixed(2)}%</div>
      ${d.sma50 != null ? `<div class="tt-row sma50">50 SMA  ${this.fmt(d.sma50)}</div>` : ""}
      ${d.sma200 != null ? `<div class="tt-row sma200">200 SMA  ${this.fmt(d.sma200)}</div>` : ""}
      ${d.rsi != null ? `<div class="tt-row rsi">RSI  ${d.rsi.toFixed(1)}</div>` : ""}
      <div class="tt-row">Vol  ${vol}</div>
      ${above != null ? `<div class="tt-flag ${above ? "ok" : "bad"}">${above ? "ABOVE LINE IN THE SAND" : "BELOW RISK — NO TRADE"}</div>` : ""}
    `;
    this.tooltipEl.style.display = "block";
    const x = Math.min(this.width - 200, Math.max(12, this.mousePos.x + 16));
    const y = Math.min(this.height - 170, Math.max(10, this.mousePos.y - 20));
    this.tooltipEl.style.left = `${x}px`;
    this.tooltipEl.style.top = `${y}px`;
  }

  /** Progressive draw-on reveal (~600ms, ease-out cubic). Call when the
   *  slide becomes active. No-op under prefers-reduced-motion. */
  animateIn() {
    cancelAnimationFrame(this._animRaf);
    this._animRaf = 0;
    if (this._reduceMotion || !this.data.length) {
      this._animProgress = null;
      this.render();
      return;
    }
    const t0 = performance.now();
    const dur = 600;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      this._animProgress = 1 - Math.pow(1 - p, 3);
      this.render();
      if (p < 1) {
        this._animRaf = requestAnimationFrame(step);
      } else {
        this._animProgress = null;
        this._animRaf = 0;
      }
    };
    this._animRaf = requestAnimationFrame(step);
  }

  /** Render the current canvas to a downloadable PNG with a watermark
   *  title bar. Fully offline — uses canvas.toDataURL + an anchor click. */
  exportPNG(title, subtitle) {
    if (!this.ctx || !this.width || !this.data.length) return;
    // Re-render without the crosshair so the export is clean.
    const savedMouse = this.mousePos;
    this.mousePos = null;
    this.render();
    this.mousePos = savedMouse;

    const dpr = this._dpr || 1;
    const headerH = 36;
    const out = document.createElement("canvas");
    out.width = this.canvas.width;
    out.height = this.canvas.height + Math.round(headerH * dpr);
    const octx = out.getContext("2d");
    octx.fillStyle = "#f6f1e5";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(this.canvas, 0, Math.round(headerH * dpr));
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Watermark title bar.
    octx.strokeStyle = "#d9d2bd";
    octx.beginPath();
    octx.moveTo(0, headerH - 0.5);
    octx.lineTo(this.width, headerH - 0.5);
    octx.stroke();
    octx.fillStyle = "#1c2433";
    octx.font = "bold 15px \"EB Garamond\", serif";
    octx.textAlign = "left";
    octx.fillText(title || this.options.symbol || "WOE DESK CHART", 14, 23);
    octx.fillStyle = "#5b6472";
    octx.font = "10px \"IBM Plex Mono\", monospace";
    octx.textAlign = "right";
    octx.fillText(subtitle || "WEIGHT OF THE EVIDENCE DESK · deterministic offline data", this.width - 14, 22);

    const a = document.createElement("a");
    const base = (title || this.options.symbol || "chart")
      .replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "chart";
    a.download = `${base}-woe.png`;
    a.href = out.toDataURL("image/png");
    a.click();
  }
}
