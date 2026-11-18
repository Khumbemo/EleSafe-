const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const [,, BASE, MODE, SP] = process.argv; // MODE: live | picker
(async () => {
  const args = ['--no-proxy-server'];
  if (MODE === 'live') args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');
  const b = await chromium.launch({ args });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, permissions: MODE === 'live' ? ['camera', 'microphone'] : [] });
  const p = await ctx.newPage(); const errs = [];
  if (MODE === 'picker') await p.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
  const step = async (n, fn) => { try { await fn(); console.log('ok  ', n); } catch (e) { console.log('FAIL', n, e.message.split('\n')[0]); } };
  const jpg = SP + '/shot.jpg';
  const chooser = async (file, action) => { const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), action()]); await fc.setFiles(file); };
  const shootLive = async () => { await p.waitForSelector('.cam video'); await p.waitForFunction(() => document.querySelector('.cam video').videoWidth > 0); await p.click('[data-shoot]'); await p.waitForSelector('[data-use]:visible'); await p.click('[data-use]'); };
  await p.goto(BASE); await p.waitForSelector('#login', { timeout: 90000 });
  await p.screenshot({ path: jpg, type: 'jpeg' });
  await p.click('.demo button >> nth=0'); await p.waitForSelector('.tabs');
  await step('snap & report opens camera', async () => {
    if (MODE === 'live') {
      await p.click('a[href="#/report/camera"]'); await p.waitForSelector('.cam video');
      await p.waitForFunction(() => document.querySelector('.cam video').videoWidth > 0);
      await p.screenshot({ path: SP + '/shots/m1-camera.png' });
      await p.click('[data-shoot]'); await p.waitForSelector('[data-use]:visible');
      await p.screenshot({ path: SP + '/shots/m1b-review.png' });
      await p.click('[data-use]');
    } else await chooser(jpg, () => p.click('a[href="#/report/camera"]'));
    await p.waitForSelector('#rep-media .thumb img');
  });
  await step('type preselected for quick send', async () => { if (!(await p.$('[data-type=sighting][aria-pressed=true]'))) throw Error('no type'); });
  await step('second photo from gallery', async () => { await chooser(jpg, () => p.click('#rep-gallery')); await p.waitForFunction(() => document.querySelectorAll('#rep-media .thumb').length === 2); });
  await step('remove a photo', async () => { await p.click('#rep-media [data-remove="1"]'); await p.waitForFunction(() => document.querySelectorAll('#rep-media .thumb').length === 1); });
  await step('voice note', async () => {
    if (MODE === 'live') { await p.click('[data-rec]'); await p.waitForSelector('[data-stop]'); await p.waitForTimeout(2200); await p.screenshot({ path: SP + '/shots/m2-recording.png' }); await p.click('[data-stop]'); }
    else await chooser(SP + '/tone.wav', () => p.click('[data-rec]'));
    await p.waitForSelector('#rep-media .voice audio');
  });
  await p.screenshot({ path: SP + '/shots/m3-form-' + MODE + '.png', fullPage: true });
  await step('send report with media', async () => { await p.click('#rep-send'); await p.waitForSelector('text=Your report number is', { timeout: 30000 }); const t = await p.innerText('main'); if (!/1 photo, 1 voice note/.test(t)) throw Error(t.slice(0, 200)); });
  await step('case shows photo + playable voice', async () => {
    await p.click('text=View report'); await p.waitForSelector('#case-media');
    await p.waitForFunction(() => { const i = document.querySelector('#case-media img'); return i && i.complete && i.naturalWidth > 0; });
    const ok = await p.evaluate(() => new Promise(res => {
      const a = document.querySelector('#case-media audio');
      const check = () => { if (a.readyState >= 1) res(true); };
      a.addEventListener('loadedmetadata', () => res(true)); a.addEventListener('error', () => res('error ' + (a.error && a.error.code)));
      const t = setInterval(check, 200); setTimeout(() => { clearInterval(t); res('timeout ' + a.readyState + ' ' + (a.src || '').slice(0, 30)); }, 6000);
    }));
    if (ok !== true) throw Error('audio ' + ok);
  });
  await step('lightbox opens/closes', async () => { await p.click('#case-media [data-view]'); await p.waitForSelector('.lightbox img'); await p.keyboard.press('Escape'); await p.waitForSelector('.lightbox', { state: 'detached' }); });
  await step('add photo later on case', async () => {
    if (MODE === 'live') { await p.click('#case-cam'); await shootLive(); }
    else await chooser(jpg, () => p.click('#case-cam'));
    await p.waitForSelector('text=Added a photo');
  });
  await p.screenshot({ path: SP + '/shots/m4-case-' + MODE + '.png', fullPage: true });
  await step('reload keeps media', async () => { await p.reload(); await p.waitForSelector('#case-media img', { timeout: 90000 }); const n = await p.$$eval('#case-media .thumb', e => e.length); if (n !== 2) throw Error('thumbs ' + n); });
  if (process.env.EXPECT_ENGINE) await step('engine is ' + process.env.EXPECT_ENGINE, async () => { await p.goto(BASE + '#/more'); await p.waitForSelector('#out'); const t = await p.innerText('main'); if (!t.includes(process.env.EXPECT_ENGINE)) throw Error(t.match(/Engine: .*/)?.[0]); });
  console.log('ERRORS', JSON.stringify([...new Set(errs)]));
  await b.close();
})();
