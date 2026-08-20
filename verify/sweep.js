const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/mnt/agents/output/verify';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();

  const consoleErrors = [], consoleWarnings = [], pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) => consoleErrors.push('REQUEST FAILED: ' + req.url() + ' ' + req.failure().errorText));

  const results = {};
  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ---- Theme checks ----
  results.theme = await page.evaluate(() => {
    const bodyCS = getComputedStyle(document.body);
    const title = document.querySelector('.slide-title, h1, h2, .slide-headline');
    const mono = document.querySelector('.mono, .chip-ticker, .kpi-value, code, .stat-value, [class*="mono"]');
    const header = document.querySelector('header, .deck-header, .top-bar, .deck-topbar');
    const footer = document.querySelector('footer, .deck-footer, .bottom-bar, .deck-statusbar');
    const card = document.querySelector('.slide-card, .slide, .card');
    return {
      bodyBg: bodyCS.backgroundColor,
      bodyFont: bodyCS.fontFamily,
      titleSel: title ? title.className || title.tagName : null,
      titleFont: title ? getComputedStyle(title).fontFamily : null,
      monoSel: mono ? mono.className || mono.tagName : null,
      monoFont: mono ? getComputedStyle(mono).fontFamily : null,
      headerBg: header ? getComputedStyle(header).backgroundColor : null,
      footerBg: footer ? getComputedStyle(footer).backgroundColor : null,
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
    };
  });

  // ---- Canvas pixel sampling (slide 2 = FN chart) ----
  await page.keyboard.press('2');
  await page.waitForTimeout(1300);
  results.canvasPixels = await page.evaluate(() => {
    const slide = document.querySelector('.slide.active, .slide-card.active') || document;
    const canvases = [...document.querySelectorAll('.slide.active canvas, .slide-card.active canvas')];
    const out = [];
    for (const c of canvases) {
      if (c.width < 200) continue; // skip sparklines
      const ctx = c.getContext('2d');
      const pts = [[5,5],[c.width>>1, 8],[8, c.height>>1],[c.width-8, c.height-8],[c.width>>1, c.height-8]];
      out.push({ w: c.width, h: c.height, px: pts.map(([x,y]) => [...ctx.getImageData(x,y,1,1).data]) });
    }
    return out;
  });

  // Screenshot slide 2 (FN)
  await page.screenshot({ path: OUT + '/slide2-fn.png' });

  // ---- Number-key navigation across all 8 slides ----
  results.navNumbers = [];
  for (let n = 1; n <= 8; n++) {
    await page.keyboard.press(String(n));
    await page.waitForTimeout(350);
    const idx = await page.evaluate(() => document.getElementById('current-slide-num')?.textContent || document.querySelector('.slide.active')?.id);
    results.navNumbers.push({ pressed: n, shows: idx });
  }
  // arrow navigation forward/back
  await page.keyboard.press('1'); await page.waitForTimeout(300);
  for (let i = 0; i < 7; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250); }
  results.afterArrowsFwd = await page.evaluate(() => document.getElementById('current-slide-num')?.textContent);
  for (let i = 0; i < 7; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(250); }
  results.afterArrowsBack = await page.evaluate(() => document.getElementById('current-slide-num')?.textContent);

  // ---- Screenshot slide 1 ----
  await page.keyboard.press('1'); await page.waitForTimeout(1300);
  await page.screenshot({ path: OUT + '/slide1-macro.png' });

  // ---- Grid modal ----
  await page.keyboard.press('g'); await page.waitForTimeout(500);
  results.gridOpen = await page.evaluate(() => !!document.querySelector('.grid-modal.open, #grid-modal.open'));
  await page.screenshot({ path: OUT + '/grid-modal.png' });
  await page.keyboard.press('g'); await page.waitForTimeout(300);
  results.gridClosed = await page.evaluate(() => !document.querySelector('.grid-modal.open, #grid-modal.open'));

  // ---- Notes panel ----
  await page.keyboard.press('n'); await page.waitForTimeout(400);
  results.notesOpen = await page.evaluate(() => !!document.querySelector('.notes-panel.open, #notes-panel.open'));
  await page.keyboard.press('n'); await page.waitForTimeout(300);

  // ---- Command palette: Ctrl+K, type 'lit', Enter ----
  await page.keyboard.press('Control+k'); await page.waitForTimeout(400);
  results.paletteOpen = await page.evaluate(() => !!document.querySelector('.cmd-palette.open, #cmd-palette.open'));
  await page.screenshot({ path: OUT + '/palette.png' });
  await page.keyboard.type('lit', { delay: 40 }); await page.waitForTimeout(300);
  results.paletteResults = await page.evaluate(() => [...document.querySelectorAll('.cmd-result, .cmd-item, [class*="cmd"] li')].map(e => e.textContent.trim()).slice(0,5));
  await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  results.afterPaletteSlide = await page.evaluate(() => ({
    num: document.getElementById('current-slide-num')?.textContent,
    hash: location.hash,
  }));

  // ---- Symbol chip switch (on a chart slide) ----
  await page.keyboard.press('2'); await page.waitForTimeout(1200);
  const chipClicked = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.slide.active .symbol-chip, .slide-card.active .symbol-chip')];
    if (chips.length < 2) return null;
    chips[1].click();
    return chips[1].dataset.symbol;
  });
  await page.waitForTimeout(1000);
  results.chipSwitch = chipClicked ? { clicked: chipClicked, hash: await page.evaluate(() => location.hash) } : 'NO CHIPS FOUND';
  // switch back
  await page.evaluate(() => { const c = document.querySelector('.slide.active .symbol-chip, .slide-card.active .symbol-chip'); c && c.click(); });
  await page.waitForTimeout(600);

  // ---- Drawing tool keys H/T/M ----
  results.tools = [];
  for (const k of ['h','t','m']) {
    await page.keyboard.press(k); await page.waitForTimeout(250);
    results.tools.push(await page.evaluate(() => document.querySelector('.slide.active .tool-btn.active, .slide-card.active .tool-btn.active')?.dataset.tool || null));
  }
  await page.keyboard.press('v'); await page.waitForTimeout(200);

  // ---- Indicator toggles ----
  results.indicatorToggles = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.slide.active .indicator-toggle, .slide-card.active .indicator-toggle')];
    const before = t.map(x => x.classList.contains('active'));
    t.forEach(x => x.click());
    const mid = t.map(x => x.classList.contains('active'));
    t.forEach(x => x.click());
    const after = t.map(x => x.classList.contains('active'));
    return { count: t.length, before, mid, after };
  });
  await page.waitForTimeout(600);

  // ---- Autoplay ring ----
  await page.keyboard.press('a'); await page.waitForTimeout(600);
  results.autoplay = await page.evaluate(() => {
    const fg = document.getElementById('autoplay-ring-fg');
    const btn = document.querySelector('#btn-next-slide');
    return {
      ringExists: !!fg,
      ringVisible: fg ? getComputedStyle(fg).opacity !== '0' && getComputedStyle(fg).visibility !== 'hidden' : false,
      dasharray: fg ? fg.style.strokeDasharray : null,
      btnClass: btn ? btn.className : null,
    };
  });
  await page.screenshot({ path: OUT + '/autoplay-ring.png' });
  await page.keyboard.press('a'); await page.waitForTimeout(300);

  // ---- PNG export ----
  const dlPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.evaluate(() => {
    const b = document.querySelector('.slide.active .tool-btn[data-action="export-png"], .slide-card.active .tool-btn[data-action="export-png"]');
    b && b.click();
  });
  const dl = await dlPromise;
  results.exportDownload = dl ? { suggested: dl.suggestedFilename() } : 'NO DOWNLOAD';
  if (dl) await dl.saveAs(OUT + '/' + dl.suggestedFilename()).catch(e => results.exportSaveError = String(e));

  // ---- Screenshots slide 6 (LIT) and 8 (matrix) ----
  await page.keyboard.press('6'); await page.waitForTimeout(1400);
  await page.screenshot({ path: OUT + '/slide6-lit.png' });
  await page.keyboard.press('8'); await page.waitForTimeout(1400);
  await page.screenshot({ path: OUT + '/slide8-matrix.png' });

  results.consoleErrors = consoleErrors;
  results.consoleWarnings = consoleWarnings;
  results.pageErrors = pageErrors;

  fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch(e => { console.error('SWEEP FAILED', e); process.exit(1); });
