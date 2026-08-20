const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const msgs = [];
  page.on('console', m => msgs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => msgs.push('pageerror: ' + e));
  await page.goto('http://127.0.0.1:8123/#2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.evaluate(() => document.querySelector('.slide-card.active .tool-btn[data-action="export-png"]').click());
  const d = await dl;
  await page.waitForTimeout(500);
  console.log(JSON.stringify({ download: d ? d.suggestedFilename() : null, msgs }, null, 1));
  await browser.close();
})();
