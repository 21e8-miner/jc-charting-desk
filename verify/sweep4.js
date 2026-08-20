const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const out = [];
  for (let n = 1; n <= 8; n++) {
    await page.keyboard.press(String(n));
    await page.waitForTimeout(1400);
    const m = await page.evaluate(() => {
      const slide = document.querySelector('.slide-card.active');
      const canvas = slide ? [...slide.querySelectorAll('canvas')].find(c => c.width > 300) : null;
      const footer = document.querySelector('.deck-footer, footer, .footer-bar, .deck-statusbar');
      const fTop = footer ? Math.round(footer.getBoundingClientRect().top) : null;
      const r = canvas ? canvas.getBoundingClientRect() : null;
      // find lowest visible content in slide
      let maxBottom = 0;
      if (slide) slide.querySelectorAll('*').forEach(el => { const b = el.getBoundingClientRect().bottom; if (b > maxBottom && b < 5000) maxBottom = b; });
      return {
        canvasBottom: r ? Math.round(r.bottom) : null,
        canvasH: r ? Math.round(r.height) : null,
        footerTop: fTop,
        slideScrollH: slide ? slide.scrollHeight : null,
        slideClientH: slide ? slide.clientHeight : null,
        maxContentBottom: Math.round(maxBottom),
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });
    out.push({ slide: n, ...m });
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
