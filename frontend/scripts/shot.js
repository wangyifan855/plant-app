// 用 CDP 截图（支持登录态、点击等前置脚本），用于自检 PC 端页面
// 用法：node scripts/shot.js <url> <out.png> [等待毫秒] [前置JS...]
// 需要先启动 chrome --headless=new --remote-debugging-port=9222
const fs = require('fs');
const http = require('http');

const [url, out, waitMs = '2500', ...scripts] = process.argv.slice(2);

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const list = await getTargets();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有找到 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });

  await new Promise((r) => ws.addEventListener('open', r));

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }

  await send('Page.enable');
  // GEO=26.06,119.30 模拟浏览器定位（联调 navigator.geolocation 用）
  if (process.env.GEO) {
    const [la, lo] = process.env.GEO.split(',').map(Number);
    await send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['geolocation'] });
    await send('Emulation.setGeolocationOverride', { latitude: la, longitude: lo, accuracy: 30 });
  }
  // MOBILE=1 模拟手机视口；VIEW=1280x800 指定任意视口
  if (process.env.MOBILE === '1') {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
  } else if (process.env.VIEW) {
    const [w, h] = process.env.VIEW.split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: false,
    });
  }
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 2500));

  for (const expr of scripts) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true });
    if (r && r.exceptionDetails) console.log('JS 异常:', JSON.stringify(r.exceptionDetails.text || r.exceptionDetails));
  }

  await new Promise((r) => setTimeout(r, Number(waitMs)));

  // VIEW_AFTER=390x844：加载后再改视口，模拟用户拖动窗口，检查响应式是否跟着变
  if (process.env.VIEW_AFTER) {
    const [w, h] = process.env.VIEW_AFTER.split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 1, mobile: w < 720,
    });
    await new Promise((r) => setTimeout(r, 1500));
  }

  // REAL_CLICK='文本' 或 'x,y'：用真实鼠标事件点一下（走浏览器命中测试，能测出被遮挡/点不动的问题）
  // REAL_CLICK2='文本'：点第二下，用来测「先开弹层、再点弹层里某个按钮」这类两步交互
  async function realClick(target, label) {
    let pt = null;
    if (/^-?\d+,-?\d+$/.test(target)) {
      const [x, y] = target.split(',').map(Number);
      pt = { x, y };
    } else {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const el = [...document.querySelectorAll('div,span')].filter(e => e.textContent.trim() === ${JSON.stringify(target)}).pop();
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
        })()`,
        returnByValue: true,
      });
      pt = r && r.result && r.result.value;
    }
    if (!pt) {
      console.log(`${label}: 没找到元素`, target);
      return;
    }
    console.log(`${label} 目标框:`, JSON.stringify(pt));
    const base = { x: pt.x, y: pt.y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
    await new Promise((res) => setTimeout(res, 1200));
  }

  if (process.env.REAL_CLICK) {
    await realClick(process.env.REAL_CLICK, 'REAL_CLICK');
  }
  if (process.env.REAL_CLICK2) {
    await realClick(process.env.REAL_CLICK2, 'REAL_CLICK2');
  }

  // REAL_HOVER='x,y' 或 '文本'：把鼠标移到目标上但不点击，用来截 hover 态
  if (process.env.REAL_HOVER) {
    const spec = process.env.REAL_HOVER;
    let pt = null;
    if (/^-?\d+,-?\d+$/.test(spec)) {
      const [x, y] = spec.split(',').map(Number);
      pt = { x, y };
    } else {
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const el = [...document.querySelectorAll('div,span')].filter(e => e.textContent.trim() === ${JSON.stringify(spec)}).pop();
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        })()`,
        returnByValue: true,
      });
      pt = r && r.result && r.result.value;
    }
    if (!pt) {
      console.log('REAL_HOVER: 没找到目标', spec);
    } else {
      console.log('REAL_HOVER 位置:', JSON.stringify(pt));
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await new Promise((res) => setTimeout(res, 700));
    }
  }


  if (process.env.PROBE) {
    const r = await send('Runtime.evaluate', { expression: process.env.PROBE, returnByValue: true });
    console.log('PROBE =', JSON.stringify(r && r.result && r.result.value));
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('已保存 ' + out);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
