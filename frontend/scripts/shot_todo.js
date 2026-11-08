// 通过 CDP 真实鼠标事件：打开首页 → 点开待办清单 → 勾选第一项 → 抓点赞特效
const fs = require('fs');
const http = require('http');
const WebSocket = global.WebSocket || require('ws');

const ORIGIN = 'http://localhost:3000';
const OUT = process.argv[2] || 'E:/preview_like.png';
const WAIT = parseInt(process.argv[3] || '1200', 10);

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get('http://127.0.0.1:9222/json' + path, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

async function main() {
  const targets = await getJSON('/list');
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalv = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: ORIGIN + '/?cb=' + Date.now() + '#home' });
  await new Promise((r) => setTimeout(r, 3200));

  // 1. 点「待办」卡片打开清单：找文本为「待办」的元素，取其外层卡片坐标，真实点击
  const cardInfo = await evalv(`(()=>{const els=Array.from(document.querySelectorAll('div,span'));const el=els.find(x=>x.textContent.trim()==='待办');if(!el)return null;let p=el;for(let i=0;i<6&&p;i++){p=p.parentElement;const r=p&&p.getBoundingClientRect&&p.getBoundingClientRect();if(r&&r.height>60&&r.height<140&&r.width>120)break;}if(!p)return null;const r=p.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()`);
  console.log('todo card:', JSON.stringify(cardInfo));
  if (!cardInfo) throw new Error('todo card not found');
  await clickAt(cardInfo.x, cardInfo.y);
  await new Promise((r) => setTimeout(r, 1300));

  // 2. 找第一个圆形勾选框（圆形 border-radius、20~40px 见方），真实点击其中心
  const boxInfo = await evalv(`(()=>{const panel=Array.from(document.querySelectorAll('div')).find(x=>x.textContent.includes('今日任务')&&x.textContent.length<300);if(!panel)return null;const els=Array.from(panel.querySelectorAll('div'));const b=els.find(x=>{const s=getComputedStyle(x);const w=x.offsetWidth,h=x.offsetHeight;return (s.borderRadius==='50%'||s.borderRadius==='9999px'||parseFloat(s.borderRadius)>=10)&&w>=18&&w<=44&&h>=18&&h<=44;});if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,br:getComputedStyle(b).borderRadius};})()`);
  console.log('checkbox:', JSON.stringify(boxInfo));
  if (!boxInfo) throw new Error('checkbox not found');
  await clickAt(boxInfo.x, boxInfo.y);
  await new Promise((r) => setTimeout(r, WAIT));

  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(s.data, 'base64'));
  console.log('saved', OUT);
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
