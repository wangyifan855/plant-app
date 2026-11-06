// 同步后端品种数据源 -> 前端打包副本
// 每次改动 config/varieties.json 后跑一次：node scripts/sync_varieties.js
// 前端 assets/varieties.json 是自动生成的快照，不要手改。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'config', 'varieties.json');
const dst = path.join(root, 'frontend', 'assets', 'varieties.json');

if (!fs.existsSync(src)) {
  console.error('[sync] 找不到源文件:', src);
  process.exit(1);
}

const raw = fs.readFileSync(src, 'utf8');
try {
  JSON.parse(raw); // 校验合法
} catch (e) {
  console.error('[sync] 源 JSON 非法:', e.message);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, raw);
console.log('[sync] 已同步 varieties.json ->', dst);
