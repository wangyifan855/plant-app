// 管理后台接口自检。管理接口需要 admin 角色，但提拔管理员本身也要 admin 权限，
// 所以这里直接用 sqlite 把测试账号提权（跑完改回去），再去打接口。
//
// 用法：node scripts/test_admin.js
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.env.API || 'http://127.0.0.1:8010';
const DB = path.join(__dirname, '..', 'backend', 'data', 'app.db');
const PY = process.env.PY || 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe';

let pass = 0;
let fail = 0;
const failures = [];

function chk(name, cond, detail) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    let d = '';
    if (detail !== undefined) {
      d = typeof detail === 'string' ? detail : JSON.stringify(detail);
      if (d && d.length > 160) d = d.slice(0, 160) + '…';
    }
    failures.push(d ? `${name}  →  ${d}` : name);
  }
}

async function call(url, { method = 'GET', token, form } = {}) {
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, { method, headers: h, body: form });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

function form(fields) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) f.append(k, String(v));
  }
  return f;
}

// 直接改库里的 role（后端每次请求都查，改完立即生效，不用重启）
function setRole(username, role) {
  execFileSync(PY, ['-c', `
import sqlite3
c = sqlite3.connect(${JSON.stringify(DB)})
c.execute("UPDATE users SET role = ? WHERE username = ?", (${JSON.stringify(role)}, ${JSON.stringify(username)}))
c.commit()
print("ok")
`], { stdio: 'pipe' });
}

(async () => {
  const tag = `adm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const adminName = `${tag}_admin`;
  const userName = `${tag}_user`;
  const pwd = 'pw1234';

  // 准备账号
  const a = await call('/auth/register', { method: 'POST', form: form({ username: adminName, password: pwd }) });
  const b = await call('/auth/register', { method: 'POST', form: form({ username: userName, password: pwd }) });
  const adminTok = a.data && a.data.token;
  const userTok = b.data && b.data.token;
  const userUid = b.data && b.data.user_id;
  chk('[准备] 两个账号注册成功', !!adminTok && !!userTok, { a: a.status, b: b.status });

  setRole(adminName, 'admin');
  console.log(`已把 ${adminName} 提成 admin\n`);

  try {
    // ── 统计 / 列表 ──
    {
      const r = await call('/api/admin/stats', { token: adminTok });
      chk('[统计] 200 且有内容', r.status === 200 && r.data && Object.keys(r.data).length > 0, r);
    }
    {
      const r = await call('/api/admin/users', { token: adminTok });
      const list = Array.isArray(r.data) ? r.data : (r.data && r.data.items);
      chk('[用户列表] 含刚建的两个账号',
        r.status === 200 && Array.isArray(list)
        && list.some((u) => u.username === adminName) && list.some((u) => u.username === userName), r);
    }
    {
      const r = await call('/api/admin/posts', { token: adminTok });
      const list = Array.isArray(r.data) ? r.data : (r.data && r.data.items);
      chk('[帖子列表] 200 且是数组', r.status === 200 && Array.isArray(list), r.status);
    }

    // ── 下架 → 草稿箱 → 恢复 ──
    let postId = null;
    {
      const r = await call('/posts', { method: 'POST', token: userTok, form: form({ title: '管理测试帖', body: '会被下架再恢复', is_public: '1' }) });
      postId = r.data && r.data.post_id;
      chk('[准备] 普通用户发帖', r.status === 200 && !!postId, r);
    }
    {
      const r = await call(`/api/admin/posts/${postId}/takedown`, { method: 'POST', token: adminTok, form: form({ reason: '   ' }) });
      chk('[下架] 空原因被拒 400', r.status === 400, r);
    }
    {
      const r = await call('/api/admin/posts/99999999/takedown', { method: 'POST', token: adminTok, form: form({ reason: '测试' }) });
      chk('[下架] 不存在的帖子 404', r.status === 404, r);
    }
    {
      const r = await call(`/api/admin/posts/${postId}/takedown`, { method: 'POST', token: adminTok, form: form({ reason: '内容与主题不符' }) });
      chk('[下架] 成功 200', r.status === 200, r);
    }
    {
      const r = await call('/drafts', { token: userTok });
      const items = r.data && r.data.items;
      chk('[草稿箱] 作者能看到被下架的帖子', r.status === 200 && Array.isArray(items) && items.some((p) => p.id === postId), r);
    }
    {
      const r = await call('/posts?limit=50');
      chk('[下架] 发现页不再出现', !(Array.isArray(r.data) && r.data.some((p) => p.id === postId)), 'listed');
    }
    {
      const r = await call('/notifications', { token: userTok });
      const items = r.data && r.data.items;
      chk('[下架] 作者收到系统通知',
        r.status === 200 && Array.isArray(items) && items.some((n) => n.type === 'system' && n.post_id === postId), r);
    }
    {
      const r = await call(`/api/admin/posts/${postId}/restore`, { method: 'POST', token: adminTok });
      chk('[恢复] 成功 200', r.status === 200, r);
    }
    {
      const r = await call('/posts?limit=50');
      chk('[恢复] 重新出现在发现页', Array.isArray(r.data) && r.data.some((p) => p.id === postId), 'not listed');
    }

    // ── 评论删除 ──
    let commentId = null;
    {
      const r = await call(`/posts/${postId}/comments`, { method: 'POST', token: userTok, form: form({ body: '待删评论' }) });
      commentId = r.data && r.data.comment_id;
      chk('[准备] 发一条评论', r.status === 200 && !!commentId, r);
    }
    {
      const r = await call(`/api/admin/comments/${commentId}`, { method: 'DELETE', token: adminTok });
      chk('[评论] 管理员删除 200', r.status === 200, r);
    }
    {
      const r = await call(`/api/admin/comments/${commentId}`, { method: 'DELETE', token: adminTok });
      chk('[评论] 重复删除 404', r.status === 404, r);
    }

    // ── 角色 / 删账号的保护 ──
    {
      const me = a.data.user_id;
      const r = await call(`/api/admin/users/${me}/role`, { method: 'POST', token: adminTok, form: form({ role: 'user' }) });
      chk('[角色] 不能改自己 400', r.status === 400, r);
    }
    {
      const r = await call(`/api/admin/users/${userUid}/role`, { method: 'POST', token: adminTok, form: form({ role: '乱写' }) });
      chk('[角色] 非法角色 400', r.status === 400, r);
    }
    {
      const r = await call(`/api/admin/users/${userUid}/role`, { method: 'POST', token: adminTok, form: form({ role: 'admin' }) });
      const check = await call('/api/admin/stats', { token: userTok });
      chk('[角色] 提成 admin 后能访问管理接口', r.status === 200 && check.status === 200, { set: r.status, stats: check.status });
      await call(`/api/admin/users/${userUid}/role`, { method: 'POST', token: adminTok, form: form({ role: 'user' }) });
      const after = await call('/api/admin/stats', { token: userTok });
      chk('[角色] 收回后立刻变 403', after.status === 403, after.status);
    }
    {
      const me = a.data.user_id;
      const r = await call(`/api/admin/users/${me}`, { method: 'DELETE', token: adminTok });
      chk('[删号] 不能删自己 400', r.status === 400, r);
    }
    {
      const r = await call('/api/admin/users/99999999', { method: 'DELETE', token: adminTok });
      chk('[删号] 不存在的用户 404', r.status === 404, r);
    }

    // ── 收尾：删测试帖和测试用户 ──
    {
      const r = await call(`/api/admin/posts/${postId}`, { method: 'DELETE', token: adminTok });
      chk('[清理] 管理员删帖 200', r.status === 200, r);
    }
    {
      const r = await call(`/api/admin/users/${userUid}`, { method: 'DELETE', token: adminTok });
      chk('[清理] 管理员删用户 200', r.status === 200, r);
    }
    {
      const r = await call('/auth/me', { token: userTok });
      chk('[清理] 被删用户的 token 失效', r.status === 401 || r.status === 404, r.status);
    }
  } finally {
    // 无论成败都把测试账号降回普通用户（避免仓库里出现没人管的 admin）
    try {
      setRole(adminName, 'user');
      console.log(`\n已把 ${adminName} 降回 user`);
    } catch (e) {
      console.log(`\n⚠ 降级失败，请手动处理 ${adminName}：${e.message}`);
    }
    // 顺便删掉这个测试管理员账号
    try {
      execFileSync(PY, ['-c', `
import sqlite3
c = sqlite3.connect(${JSON.stringify(DB)})
c.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)", (${JSON.stringify(adminName)},))
c.execute("DELETE FROM users WHERE username = ?", (${JSON.stringify(adminName)},))
c.commit()
`], { stdio: 'pipe' });
      console.log(`已删除测试账号 ${adminName}`);
    } catch (e) {
      console.log(`⚠ 删除测试账号失败：${e.message}`);
    }
  }

  console.log(`\n合计 ${pass + fail} 项检查，通过 ${pass}，失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  process.exit(fail ? 1 : 0);
})();
