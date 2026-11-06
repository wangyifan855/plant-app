// 语法自检：用 @babel/parser 解析所有 JSX 文件，报出第一个出错的文件
const parser = require('@babel/parser');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = [
  path.join(ROOT, 'App.js'),
  ...fs.readdirSync(path.join(ROOT, 'screens')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'screens', f)),
  ...fs.readdirSync(path.join(ROOT, 'components')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'components', f)),
  ...fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'lib', f)),
];

let bad = 0;
for (const f of files) {
  try {
    parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    bad += 1;
    console.log(`FAIL ${path.relative(ROOT, f)}\n     ${e.message}`);
  }
}
console.log(bad === 0 ? `全部通过（${files.length} 个文件）` : `${bad} 个文件有语法错误`);
