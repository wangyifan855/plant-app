// 重抓 README 展示用的手机端截图（5 个 tab，390x844@2x，带 demo 登录态）
const fs = require('fs');
const http = require('http');

const TOKENS = JSON.parse(fs.readFileSync(__dirname + '/.tokens.json', 'utf8'));
const DEMO = TOKENS.demo;
const ORIGIN = 'http://localhost:3000';
const OUT = 'E:\\大三上\\医学人工智能导论\\docs\\screenshots\\';

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function shot(page, out, url, waitMs = 3200) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: ORIGIN });
  await new Promise((r) => setTimeout(r, 1500));
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('graftcheck_token', ${JSON.stringify(DEMO)});`,
  });
  await send('Page.navigate', { url: 'about:blank' });
  await new Promise((r) => setTimeout(r, 500));
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, waitMs));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
  console.log('saved ' + out);
  ws.close();
}

(async () => {
  const list = await getTargets();
  const page = list.find((t) => t.type === 'page');
  const tabs = ['home', 'identify', 'discover', 'garden', 'profile'];
  for (const t of tabs) {
    await shot(page, OUT + t + '.png', `${ORIGIN}/?cb=${Date.now()}#${t}`, t === 'home' ? 3800 : 3200);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
