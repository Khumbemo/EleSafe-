const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const [,, BASE, LOG] = process.argv;
const codeFor = (phone) => { const m = [...fs.readFileSync(LOG, 'utf8').matchAll(new RegExp(`\\[SMS to \\+91${phone}\\] HatiAlert code: (\\d{6})`, 'g'))]; return m.length ? m[m.length - 1][1] : null; };
(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const step = async (n, fn) => { try { await fn(); console.log('ok  ', n); } catch (e) { console.log('FAIL', n, e.message.split('\n')[0]); } };
  const signIn = async (phone, pin) => { await p.goto(BASE + '#/login'); await p.waitForSelector('#login'); await p.fill('#login-phone', phone); await p.fill('#login-pin', pin); await p.click('#login button[type=submit]'); };
  const signOut = async () => { await p.evaluate(() => localStorage.removeItem('hatialert.token')); await p.goto(BASE + '#/login'); await p.reload(); await p.waitForSelector('#login'); };
  let temp;
  await p.goto(BASE); await p.waitForSelector('#login');

  await step('officer resets a villager PIN', async () => {
    await signIn('9000000003', '3333'); await p.waitForSelector('.tabs');
    await p.goto(BASE + '#/admin/people'); await p.waitForSelector('#pp-list .item');
    await p.fill('#pp-q', 'Yanbeni'); await p.waitForFunction(() => document.querySelectorAll('#pp-list .item').length === 1);
    await p.click('#pp-list [data-act=reset]'); await p.click('#pp-list [data-act=reset]');
    await p.waitForSelector('.bigpin'); temp = (await p.innerText('.bigpin')).trim();
    if (!/^\d{6}$/.test(temp)) throw Error('temp ' + temp);
  });
  await step('officer edits, adds and imports villages', async () => {
    await p.goto(BASE + '#/admin/villages'); await p.waitForSelector('.vform', { state: 'attached' });
    const row = p.locator('[data-vid="2"]'); await row.locator('summary').click();
    await row.locator('input[name=lat]').fill('26.0905'); await row.locator('input[name=source]').fill('GPS by forest guard, Oct 2026');
    await row.locator('input[name=verified]').check(); await row.locator('button[type=submit]').click(); await p.waitForSelector('text=Village saved');
    await p.fill('#v-add input[name=name]', 'Merapani'); await p.fill('#v-add input[name=lat]', '26.36'); await p.fill('#v-add input[name=lng]', '94.07');
    await p.click('#v-add button[type=submit]'); await p.waitForSelector('text=Village added');
    await p.fill('#v-csv', 'name,lat,lng,source\nLotsu,26.25,94.10,Census 2011\nBad,x,1,\n'); await p.click('#v-import button[type=submit]');
    await p.waitForSelector('text=Skipped 1 line'); const t = await p.innerText('#admin-body'); if (!/Lotsu/.test(t) || !/Merapani/.test(t)) throw Error('missing villages');
  });
  await step('alert queues texts; messages tab lists them', async () => {
    await p.goto(BASE + '#/alerts'); await p.click('#compose-wrap summary');
    await p.click('[data-v="Wozhuro"]'); await p.fill('#compose-msg', 'Herd near the school, stay inside.'); await p.click('#compose button[type=submit]');
    await p.waitForSelector('text=/Alert sent\\. Texting/');
    await p.goto(BASE + '#/admin/messages'); await p.waitForSelector('[data-batch]');
    await p.waitForTimeout(6500); await p.goto(BASE + '#/admin/system'); await p.goto(BASE + '#/admin/messages'); await p.waitForSelector('[data-batch]');
    const t = await p.innerText('[data-batch] >> nth=0'); if (!/Sent: 1/.test(t)) throw Error(t.slice(0, 200));
  });
  await step('system tab shows backups and audit log', async () => {
    await p.goto(BASE + '#/admin/system'); await p.waitForSelector('text=Recent admin actions');
    const t = await p.innerText('#admin-body'); if (!/Every 24 h/.test(t) || !/pin reset/.test(t) || !/village import/.test(t)) throw Error(t.slice(0, 300));
  });
  await signOut();
  await step('temporary PIN forces a new PIN', async () => {
    await signIn('9000000001', temp); await p.waitForSelector('#np');
    await p.fill('#np-old', temp); await p.fill('#np-new', '1234'); await p.fill('#np-new2', '1234'); await p.click('#np button[type=submit]');
    await p.waitForSelector('text=too easy to guess');
    await p.fill('#np-new', '582047'); await p.fill('#np-new2', '582047'); await p.click('#np button[type=submit]'); await p.waitForSelector('.tabs');
  });
  await step('villager settings: text alerts, change PIN, sign out others', async () => {
    await p.goto(BASE + '#/more'); await p.waitForSelector('#sms-on');
    await p.uncheck('#sms-on'); await p.waitForSelector('text=Text alerts off'); await p.check('#sms-on'); await p.waitForSelector('text=Text alerts on');
    await p.fill('#cp-old', '582047'); await p.fill('#cp-new', '602915'); await p.fill('#cp-new2', '602915'); await p.click('#cp button[type=submit]'); await p.waitForSelector('text=New PIN saved');
    await p.click('#logout-all [data-ask]'); await p.click('#logout-all [data-yes]'); await p.waitForSelector('text=Other devices signed out');
  });
  await step('offline: report saved, then sent when back online', async () => {
    await p.goto(BASE + '#/home'); await p.waitForSelector('.map .pins'); await p.waitForTimeout(1500); // service worker caches the app
    await ctx.setOffline(true);
    await p.goto(BASE + '#/report'); await p.waitForSelector('#rep'); await p.click('[data-type=crop_raid]'); await p.click('#rep-send');
    await p.waitForSelector('text=Your report is saved');
    await p.goto(BASE + '#/home'); await p.waitForSelector('#offline-bar:not([hidden])'); await p.waitForSelector('#queue-note:not([hidden])');
    await p.screenshot({ path: process.env.SHOTS + '/fx-offline.png', fullPage: true });
    await p.reload(); await p.waitForSelector('.tabs', { timeout: 15000 }); // app opens from the phone with no network
    await ctx.setOffline(false); // the app sends the saved report by itself
    await p.waitForSelector('text=/Saved report sent: HA-/'); await p.waitForSelector('#queue-note', { state: 'hidden' });
    await p.evaluate(() => window.dispatchEvent(new Event('online'))); await p.waitForTimeout(1200); // a second try must not duplicate
    const n = await p.evaluate(async () => (await fetch('/api/incidents?mine=1&status=all', { headers: { Authorization: 'Bearer ' + localStorage.getItem('hatialert.token') } }).then(r => r.json())).filter(i => i.type === 'crop_raid' && i.village === 'Wozhuro' && Date.now() - i.created_at < 600000).length);
    if (n !== 1) throw Error('expected exactly one new report, got ' + n);
  });
  await signOut();
  await step('sign up with a texted code', async () => {
    await p.goto(BASE + '#/register'); await p.waitForSelector('#reg-send');
    await p.fill('#reg-name', 'Akum Jamir'); await p.fill('#reg-phone', '9876543210'); await p.click('#reg-send'); await p.waitForSelector('text=6-digit code');
    await p.waitForTimeout(1000); const code = codeFor('9876543210'); if (!code) throw Error('no code in log');
    await p.fill('#reg-code', code); await p.fill('#reg-pin', '408215'); await p.fill('#reg-pin2', '408215'); await p.click('#reg button[type=submit]'); await p.waitForSelector('.tabs');
    await p.goto(BASE + '#/more'); const t = await p.innerText('.pagehead'); if (/not verified/.test(t)) throw Error('should be verified');
  });
  await signOut();
  await step('forgot PIN with a texted code', async () => {
    await p.goto(BASE + '#/forgot'); await p.waitForSelector('#fg');
    await p.fill('#fg-phone', '9876543210'); await p.click('#fg-send'); await p.waitForSelector('#fg-note:has-text("code")');
    await p.waitForTimeout(1000); const code = codeFor('9876543210');
    await p.fill('#fg-code', code); await p.fill('#fg-pin', '719356'); await p.fill('#fg-pin2', '719356'); await p.click('#fg button[type=submit]'); await p.waitForSelector('.tabs');
  });
  console.log('ERRORS', JSON.stringify(errs));
  await b.close();
})();
