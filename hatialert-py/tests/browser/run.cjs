// Runs the browser suites against fresh HatiAlert servers and exits non-zero on any failure.
//   cd hatialert-py && node tests/browser/run.cjs            (needs Python and Playwright's Chromium)
//   node tests/browser/run.cjs e2e layout                    (only some suites)
// Each suite gets its own server and empty database. Playwright is loaded from
// $PLAYWRIGHT if set, else from normal module resolution (web-ts/node_modules).
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');           // hatialert-py
if (!process.env.PLAYWRIGHT) {
  try { process.env.PLAYWRIGHT = require.resolve('playwright', { paths: [path.join(ROOT, 'web-ts')] }); } catch { /* fall back to global */ }
}
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'hatialert-browser-'));
fs.mkdirSync(path.join(WORK, 'shots'));

// Console errors a suite causes on purpose.
const EXPECTED = { e2e: [/status of 403 \(Forbidden\)/] };

const SUITES = {
  e2e: (base) => ['e2e.cjs', base, ''],
  fixes: (base, log) => ['fixes.cjs', base, log],
  'media-live': (base) => ['media.cjs', base, 'live', WORK],
  'media-picker': (base) => ['media.cjs', base, 'picker', WORK],
  layout: (base) => ['layout.cjs', base],
};
const SERVER_ARGS = { fixes: ['--backup-dir', path.join(WORK, 'backups')] };

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const waitFor = async (url, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  throw Error('server did not start: ' + url);
};

async function fixtures() {
  // A JPEG "photo" and a 2 s WAV "voice note" for the file-picker paths.
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 400, height: 300 } });
  await p.setContent('<body style="margin:0;background:linear-gradient(#5a8,#284)"><h1 style="font:40px sans-serif;color:#fff;padding:20px">Elephant</h1>');
  await p.screenshot({ path: path.join(WORK, 'shot.jpg'), type: 'jpeg', quality: 80 }); await b.close();
  const rate = 8000, n = rate * 2, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  fs.writeFileSync(path.join(WORK, 'tone.wav'), buf);
}

async function runSuite(name) {
  const port = await freePort();
  const log = path.join(WORK, name + '.log');
  const srv = spawn(PY, ['-m', 'hatialert', '--db', path.join(WORK, name + '.db'), '--port', String(port), ...(SERVER_ARGS[name] || [])],
    { cwd: ROOT, env: { ...process.env, HATIALERT_SMS_DEBUG: '1', PYTHONUNBUFFERED: '1' }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  try {
    const base = `http://127.0.0.1:${port}/`;
    await waitFor(base + 'api/meta');
    const [script, ...args] = SUITES[name](base, log);
    const out = await new Promise((res) => {
      const c = spawn(process.execPath, [path.join(HERE, script), ...args], { env: { ...process.env, SHOTS: path.join(WORK, 'shots'), FIXTURES: WORK } });
      let s = ''; c.stdout.on('data', (d) => (s += d)); c.stderr.on('data', (d) => (s += d)); c.on('close', (code) => res({ s, code }));
    });
    const lines = out.s.split('\n');
    const ok = lines.filter((l) => l.startsWith('ok ')).length;
    const fails = lines.filter((l) => l.startsWith('FAIL'));
    const m = out.s.match(/ERRORS:?\s*(\[[\s\S]*?\])/);
    const errors = m ? JSON.parse(m[1]).filter((e) => !(EXPECTED[name] || []).some((re) => re.test(e))) : ['suite did not finish'];
    const passed = out.code === 0 && fails.length === 0 && errors.length === 0 && ok > 0;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${ok} ok, ${fails.length} failed${errors.length ? `, page errors: ${JSON.stringify(errors)}` : ''}`);
    for (const f of fails) console.log('     ' + f);
    if (!passed && out.code !== 0 && !fails.length) console.log(out.s.split('\n').slice(-15).join('\n'));
    return passed;
  } finally { srv.kill(); }
}

(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SUITES);
  for (const n of names) if (!SUITES[n]) { console.error('unknown suite ' + n + '; have ' + Object.keys(SUITES).join(', ')); process.exit(2); }
  await fixtures();
  let all = true;
  for (const n of names) all = (await runSuite(n)) && all;
  console.log(all ? '\nAll browser suites passed.' : `\nSome suites failed. Logs and screenshots: ${WORK}`);
  process.exit(all ? 0 : 1);
})();
