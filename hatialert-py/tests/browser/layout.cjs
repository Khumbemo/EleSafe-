// Layout check at phone, tablet and laptop sizes: no screen scrolls sideways, and on
// touch screens every control is at least 44 x 44 CSS px (text links and checkboxes
// may be smaller to look at, as long as their touch area is that big).
// Usage: node layout.cjs BASE   -> prints "ok"/"FAIL" lines and "ERRORS [...]"
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.argv[2];
const DEVICES = [
  { name: 'phone 320x640', w: 320, h: 640, touch: true },
  { name: 'phone 390x844', w: 390, h: 844, touch: true },
  { name: 'phone sideways 780x360', w: 780, h: 360, touch: true },
  { name: 'tablet 768x1024', w: 768, h: 1024, touch: true },
  { name: 'tablet 1024x768', w: 1024, h: 768, touch: true },
  { name: 'laptop 1366x768', w: 1366, h: 768, touch: false },
  { name: 'desktop 1920x1080', w: 1920, h: 1080, touch: false },
];
const SCREENS = ['#/home', '#/report', '#/cases', '#/case/2', '#/alerts', '#/dashboard', '#/guide', '#/more', '#/admin/people', '#/admin/villages'];
const MIN = 44;

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); } };
  for (const d of DEVICES) {
    const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, hasTouch: d.touch, isMobile: d.touch });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '#/login'); await p.waitForSelector('#login');
    await p.fill('#login-phone', '9000000003'); await p.fill('#login-pin', '3333'); await p.click('#login button[type=submit]'); await p.waitForSelector('.tabs');
    for (const s of SCREENS) {
      await step(`${d.name} ${s}`, async () => {
        await p.goto(BASE + s); await p.waitForTimeout(400);
        const r = await p.evaluate(({ touch, MIN }) => {
          const vw = document.documentElement.clientWidth;
          const out = { scrollW: document.documentElement.scrollWidth, vw, small: [] };
          if (!touch) return out;
          const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary';
          for (const el of document.querySelectorAll(sel)) {
            const rc = el.getBoundingClientRect(); if (!rc.width || !rc.height) continue;
            if (getComputedStyle(el).visibility === 'hidden' || el.closest('.mapframe svg')) continue;
            if (rc.width >= MIN && rc.height >= MIN) continue;
            // A checkbox inside a tall label is tapped through the label.
            const label = el.closest('label');
            if (label && el.matches('input[type=checkbox],input[type=radio]')) { const lr = label.getBoundingClientRect(); if (lr.height >= MIN) continue; }
            // A text link with an enlarged invisible touch area (::after).
            const after = getComputedStyle(el, '::after');
            if (after.content !== 'none' && parseFloat(after.height) >= MIN) continue;
            out.small.push(`${el.tagName.toLowerCase()}[${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}] ${Math.round(rc.width)}x${Math.round(rc.height)}`);
          }
          return out;
        }, { touch: d.touch, MIN });
        if (r.scrollW > r.vw) throw Error(`scrolls sideways: ${r.scrollW}px content in ${r.vw}px`);
        if (r.small.length) throw Error(`touch targets under ${MIN}px: ${r.small.slice(0, 6).join(', ')}`);
      });
    }
    await ctx.close();
  }
  console.log('ERRORS', JSON.stringify([...new Set(errs)]));
  await b.close();
})();
