const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto('http://127.0.0.1:8123/#6', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/mnt/agents/output/verify/slide6-lit-rm.png' });
  // clip analysis: is chart canvas bottom cut off by footer?
  const clip = await page.evaluate(() => {
    const slide = document.querySelector('.slide-card.active');
    const canvas = [...slide.querySelectorAll('canvas')].find(c => c.width > 300);
    const r = canvas.getBoundingClientRect();
    const footer = document.querySelector('footer, .deck-footer, .deck-statusbar, .footer-bar');
    const fr = footer ? footer.getBoundingClientRect() : null;
    // sample bottom rows of canvas for axis text presence
    const cx = canvas.getContext('2d');
    const rowHasInk = (y) => {
      const d = cx.getImageData(0, y, canvas.width, 1).data;
      for (let i = 0; i < d.length; i += 4) { if (d[i] < 200 && d[i+1] < 200 && d[i+2] < 200) return true; }
      return false;
    };
    return {
      canvasRect: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
      footerTop: fr ? Math.round(fr.top) : null,
      viewportH: window.innerHeight,
      inkInBottom10: rowHasInk(canvas.height - 5),
      inkRows: [canvas.height-40, canvas.height-25, canvas.height-12].map(y => ({ y, ink: rowHasInk(y) })),
    };
  });
  // chip strip overflow
  const strip = await page.evaluate(() => {
    const s = document.querySelector('.slide-card.active .symbol-strip');
    if (!s) return null;
    const r = { scrollW: s.scrollWidth, clientW: s.clientWidth, overflowX: getComputedStyle(s).overflowX };
    const chips = [...s.querySelectorAll('.symbol-chip')];
    const last = chips[chips.length - 1].getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    r.lastChipRight = Math.round(last.right); r.stripRight = Math.round(sr.right);
    r.lastChipClipped = last.right > sr.right + 1;
    return r;
  });
  console.log(JSON.stringify({ clip, strip, errors }, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
