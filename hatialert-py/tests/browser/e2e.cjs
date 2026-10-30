const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.argv[2]; const SHOTS = process.argv[3];
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 220)); });
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); } };
  const text = async () => (await p.innerText('main')).replace(/\s+/g, ' ');
  await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : ''));
  await p.waitForSelector('#login', { timeout: 60000 });
  if (SHOTS) await p.screenshot({ path: SHOTS + '/1-login.png', fullPage: true });

  // villager
  await step('villager sign-in', async () => { await p.click('.demo button >> nth=0'); await p.waitForSelector('.tabs'); });
  await step('home shows nearby + warning', async () => { await p.waitForSelector('.map'); const t = await text(); if (!/near you/.test(t) || !/elephant warning/i.test(t)) throw Error(t.slice(0, 200)); });
  if (SHOTS) await p.screenshot({ path: SHOTS + '/2-home.png', fullPage: true });
  await step('report crop raid', async () => {
    await p.click('a[href="#/report"]'); await p.click('[data-type=crop_raid]');
    await p.click('[data-herd="5"]'); await p.selectOption('#rep-km', '1'); await p.click('[data-odir=NE]'); await p.click('[data-heading=S]');
    await p.fill('#rep-acres', '0.7'); await p.fill('#rep-place', 'Paddy by the church');
    await p.waitForFunction(() => /High/.test(document.querySelector('#rep-sev').textContent));
    if (SHOTS) await p.screenshot({ path: SHOTS + '/3-report.png', fullPage: true });
    await p.click('#rep-send'); await p.waitForSelector('text=Your report number is');
  });
  await step('my reports lists it', async () => { await p.click('a[href="#/cases"]'); await p.waitForSelector('.item'); const t = await text(); if (!/Paddy|Crop raid/.test(t)) throw Error(t); });
  if (!process.env.PREVIEW) await step('villager blocked from staff status', async () => { const r = await p.evaluate(async () => { const t = localStorage.getItem('hatialert.token'); const res = await fetch('/api/incidents?status=closed', { headers: { Authorization: 'Bearer ' + t } }); return res.status; }); if (r !== 403) throw Error('got ' + r); });
  await step('validation: no type', async () => { await p.click('a[href="#/report"]'); await p.click('#rep-send'); await p.waitForSelector('.err'); });
  await step('sign out', async () => { await p.click('a[href="#/more"]'); await p.click('#out'); await p.waitForSelector('#login'); });

  // guard
  await step('guard verifies newest case', async () => {
    await p.click('.demo button >> nth=1'); await p.waitForSelector('.tabs');
    await p.click('a[href="#/cases"]'); await p.waitForSelector('.item'); await p.click('.item >> nth=0');
    await p.waitForSelector('#act'); await p.fill('#act-note', 'Checked, fresh tracks.'); await p.click('[data-status=verified]');
    await p.waitForSelector('text=Checked, fresh tracks.');
    if (SHOTS) await p.screenshot({ path: SHOTS + '/4-case.png', fullPage: true });
  });
  await step('guard cannot resolve (no button)', async () => { if (await p.$('[data-status=resolved]')) throw Error('resolve shown'); });
  await step('warn nearby villages', async () => {
    await p.click('#warn'); await p.waitForSelector('#compose'); const pressed = await p.$$eval('[data-v][aria-pressed=true]', e => e.map(x => x.dataset.v));
    if (!pressed.length) throw Error('no villages'); await p.click('#compose button[type=submit]'); await p.waitForSelector('text=Alert sent');
  });
  await step('sign out guard', async () => { await p.click('a[href="#/more"]'); await p.click('#out'); await p.waitForSelector('#login'); });

  // officer
  await step('officer dashboard', async () => {
    await p.click('.demo button >> nth=2'); await p.waitForSelector('.tabs');
    await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + '#/dashboard'); await p.waitForSelector('.chart');
    await p.click('[data-days="90"]'); await p.waitForSelector('[data-days="90"][aria-pressed=true]');
    await p.click('#csv'); await p.waitForSelector('#csv-text'); const v = await p.inputValue('#csv-text'); if (!v.startsWith('report_no')) throw Error(v.slice(0, 50));
    if (SHOTS) await p.screenshot({ path: SHOTS + '/5-dash.png', fullPage: true });
  });
  await step('officer resolves path', async () => {
    await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + '#/cases'); await p.waitForSelector('.item'); await p.click('.item >> nth=0'); await p.waitForSelector('#act');
    for (const s of ['responded', 'resolved']) { await p.click(`[data-status=${s}]`); await p.waitForSelector('text=Status updated'); await p.waitForTimeout(300); }
    const t = await text(); if (!/Resolved/.test(t)) throw Error(t.slice(0, 120));
  });
  await step('alerts page', async () => { await p.click('a[href="#/alerts"]'); await p.waitForSelector('article'); });
  await step('guide page', async () => { await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + '#/guide'); await p.waitForSelector('text=Emergency numbers'); });
  if (SHOTS) await p.screenshot({ path: SHOTS + '/6-guide.png', fullPage: true });
  await step('profile radius', async () => { await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + '#/more'); await p.selectOption('#prof-radius', '10'); await p.click('#prof button[type=submit]'); await p.waitForSelector('text=Saved'); });
  await step('remove sample data', async () => { await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + '#/home'); await p.click('[data-ask]'); await p.click('[data-yes]'); await p.waitForSelector('text=Sample data removed'); });
  await step('desktop layout', async () => { await p.setViewportSize({ width: 1280, height: 860 }); await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + '#/home'); await p.waitForSelector('.map'); const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 1280) throw Error('overflow ' + w); });
  if (SHOTS) await p.screenshot({ path: SHOTS + '/7-desktop.png' });
  await step('no horizontal overflow at 400px', async () => { await p.setViewportSize({ width: 400, height: 860 }); for (const r of ['#/home', '#/report', '#/cases', '#/alerts', '#/more', '#/guide']) { await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + r); await p.waitForTimeout(400); const w = await p.evaluate(() => document.documentElement.scrollWidth); if (w > 400) throw Error(r + ' ' + w); } });
  await p.goto(BASE + (process.env.PREVIEW ? 'test.html' : '') + '#/more'); await p.waitForSelector('#out'); console.log('ENGINE:', (await p.innerText('main')).match(/Engine: .*/)?.[0]);
  console.log('ERRORS:', JSON.stringify([...new Set(errs)], null, 1));
  await b.close();
})();
