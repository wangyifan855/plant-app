// 一键检查并启动本地服务（前端 3000 / 后端 8010）
// 用法：node scripts/start_servers.js
// 已经在跑的服务会跳过；没跑的用 detached 方式拉起来（关掉终端也不会被带走）。
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const PYTHON = 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe';

function ping(url, timeout = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(timeout, () => { req.destroy(); resolve(0); });
  });
}

function launch(label, cmd, args, cwd, env) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  console.log(`  → ${label} 已启动 (pid ${child.pid})`);
}

async function main() {
  console.log('检查服务状态...');

  const fe = await ping('http://localhost:3000/');
  if (fe) {
    console.log(`  前端 3000 已在运行 (HTTP ${fe})`);
  } else {
    launch('前端 3000', NODE, ['serve.js'], path.join(ROOT, 'frontend'));
  }

  const be = await ping('http://localhost:8010/health');
  if (be) {
    console.log(`  后端 8010 已在运行 (HTTP ${be})`);
  } else {
    launch('后端 8010', PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8010'],
      path.join(ROOT, 'backend'),
      { PYTHONPATH: path.join(ROOT, 'backend'), IDENTIFIER: 'model', HF_HUB_OFFLINE: '1' });
  }

  // 等后端把模型加载完（真模型首次加载要十几秒）
  console.log('等待服务就绪...');
  let okFe = 0;
  let okBe = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    okFe = okFe || (await ping('http://localhost:3000/', 1200));
    okBe = okBe || (await ping('http://localhost:8010/health', 1200));
    if (okFe && okBe) break;
  }
  console.log('');
  console.log(`前端 3000 : ${okFe ? '正常' : '未就绪'}`);
  console.log(`后端 8010 : ${okBe ? '正常' : '未就绪（首次启动加载模型较慢，稍等再刷新）'}`);
  console.log('');
  console.log('打开 http://localhost:3000 即可使用。');
}

main();
