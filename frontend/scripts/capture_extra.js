// 批量抓取 README 补充截图：登录页 / PC 首页 / PC 发现 / 管理员后台
const fs = require('fs');
const http = require('http');

const DEMO = JSON.parse(fs.readFileSync(__dirname + '/.tokens.json', 'utf8')).demo;
const ADMIN = JSON.parse(fs.readFileSync(__dirname + '/.tokens.json', 'utf8')).admin;
const ORIGIN = 'http://localhost:3000';

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function shot(page, out, { view, token, tokenKey, url, waitMs = 3000 }) {
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
  if (view) await send('Emulation.setDeviceMetricsOverride', { width: view.w, height: view.h, deviceScaleFactor: view.d || 1, mobile: view.mobile || false });
  // 先开目标域（让 localStorage 归属正确域），注入 token，再经 about:blank 触发整页重载
  const origin = new URL(url).origin;
  await send('Page.navigate', { url: origin });
  await new Promise((r) => setTimeout(r, 1500));
  const inj = token
    ? `localStorage.setItem(${JSON.stringify(tokenKey)}, ${JSON.stringify(token)});`
    : `localStorage.removeItem(${JSON.stringify(tokenKey)});`;
  await send('Runtime.evaluate', { expression: inj });
  await send('Page.navigate', { url: 'about:blank' });
  await new Promise((r) => setTimeout(r, 600));
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
  const out = 'E:\\大三上\\医学人工智能导论\\docs\\screenshots\\';
  // 1. 登录页（无 token，移动端）
  await shot(page, out + 'login.png', {
    view: { w: 390, h: 844, d: 2, mobile: true },
    token: null, tokenKey: 'graftcheck_token', url: ORIGIN + '/#profile',
  });
  // 2. PC 首页（带 SideNav）
  await shot(page, out + 'pc_home.png', {
    view: { w: 1440, h: 900, d: 1, mobile: false },
    token: DEMO, tokenKey: 'graftcheck_token', url: ORIGIN + '/#home', waitMs: 3500,
  });
  // 3. PC 发现（4 列瀑布流）
  await shot(page, out + 'pc_discover.png', {
    view: { w: 1440, h: 900, d: 1, mobile: false },
    token: DEMO, tokenKey: 'graftcheck_token', url: ORIGIN + '/#discover', waitMs: 3500,
  });
  // 4. 管理员后台（独立页，admin token）
  await shot(page, out + 'admin.png', {
    view: { w: 1440, h: 900, d: 1, mobile: false },
    token: ADMIN, tokenKey: 'gc_admin_token', url: 'http://localhost:8010/admin/', waitMs: 4000,
  });
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
