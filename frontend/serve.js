// 本地预览用的静态服务（替代 python -m http.server，后者在浏览器并发请求下会假死）
// 启动：node serve.js  → http://127.0.0.1:3000/
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
};

http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);
  // 防目录穿越
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    const ext = path.extname(filePath || '').toLowerCase();
    // 入口页坚决不缓存（no-store）：expo export 的 JS 是内容哈希命名不会变，
    // 唯一会过期的就是 index.html——它一旦被缓存，浏览器就会一直加载旧 bundle。
    const cacheControl = (ext === '.html') ? 'no-store' : 'no-cache';
    if (err || !stat.isFile()) {
      // SPA fallback：未知路径回 index.html
      fs.readFile(path.join(ROOT, 'index.html'), (e2, buf) => {
        if (e2) { res.writeHead(404).end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(withNotranslate(buf));
      });
      return;
    }
    if (ext === '.html') {
      // HTML 不走流式：注入 notranslate，防止浏览器翻译插件改写 DOM
      // （翻译会绕过 React 直接替换文本节点，导致「N 株」这类计数卡在旧值不更新）
      fs.readFile(filePath, (e3, buf) => {
        if (e3) { res.writeHead(500).end('Read Error'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(withNotranslate(buf));
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`serving dist on http://127.0.0.1:${PORT}/`);
});

// 给 HTML 注入 notranslate meta（幂等）：本 App 全中文，禁掉浏览器自动翻译，
// 避免翻译插件改写文本节点后 React 认不出变化、计数/文案卡死在旧值。
function withNotranslate(buf) {
  let html = buf.toString('utf8');
  if (!html.includes('notranslate')) {
    html = html.replace('<head>', '<head><meta name="google" content="notranslate">');
  }
  return html;
}
