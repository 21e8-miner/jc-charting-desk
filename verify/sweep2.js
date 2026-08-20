const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const warnings = [], errors = [];
  page.on('console', m => { if (m.type()==='warning') warnings.push(m.text()); if (m.type()==='error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // navigate all slides without any canvas readback
  for (let n = 1; n <= 8; n++) { await page.keyboard.press(String(n)); await page.waitForTimeout(1200); }
  const monoCheck = await page.evaluate(() => {
    const sels = ['.kpi-value', '.eyebrow', '.slide-eyebrow', '.matrix-table td', '.stat-value', '.session-clock', '.nav-slide-counter', '.indicator-toggle', '.tool-btn'];
    return sels.map(s => {
      const el = document.querySelector('.slide.active ' + s) || document.querySelector(s);
      return el ? { sel: s, font: getComputedStyle(el).fontFamily.slice(0, 40) } : { sel: s, font: null };
    });
  });
  const notes = await page.evaluate(() => {
    const p = document.getElementById('presenter-notes-panel');
    return { exists: !!p };
  });
  await page.keyboard.press('n'); await page.waitForTimeout(400);
  notes.openAfterN = await page.evaluate(() => document.getElementById('presenter-notes-panel').classList.contains('open'));
  notes.text = await page.evaluate(() => document.getElementById('presenter-notes-panel').textContent.trim().slice(0, 120));
  await page.screenshot({ path: '/mnt/agents/output/verify/notes-open.png' });
  await page.keyboard.press('n'); await page.waitForTimeout(300);
  notes.closedAfterN = await page.evaluate(() => !document.getElementById('presenter-notes-panel').classList.contains('open'));
  console.log(JSON.stringify({ monoCheck, notes, warnings, errors }, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
