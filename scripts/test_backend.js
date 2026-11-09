// 后端接口回归自检：把主要接口按业务线跑一遍，默认连跑三轮确认稳定
// （没有随机失败、没有上一轮残留状态影响下一轮）。
//
// 用法：node scripts/test_backend.js [轮数]
// 环境变量：API 默认 http://127.0.0.1:8010
//
// 会真的建账号、发帖、上传图片、调识别模型，跑完把自己造的数据删掉。
const fs = require('fs');
const path = require('path');

const BASE = process.env.API || 'http://127.0.0.1:8010';
const ROUNDS = Number(process.argv[2] || 3);
const SAMPLES = path.join(__dirname, '..', 'test_samples');
const TOMATO = path.join(SAMPLES, 'A_healthy_tomato_plant__Solanu_2026-11-05T04-39-06.png');
const APPLE = path.join(SAMPLES, 'A_branch_of_an_apple_tree__Mal_2026-11-05T04-39-06.png');

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

async function call(url, { method = 'GET', token, form, headers = {} } = {}) {
  const h = { ...headers };
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

function formWithFile(fields, field, filePath) {
  const f = form(fields);
  const buf = fs.readFileSync(filePath);
  f.append(field, new Blob([new Uint8Array(buf)], { type: 'image/png' }), path.basename(filePath));
  return f;
}

function formWithFiles(fields, pairs) {
  const f = form(fields);
  for (const [field, filePath] of pairs) {
    const buf = fs.readFileSync(filePath);
    f.append(field, new Blob([new Uint8Array(buf)], { type: 'image/png' }), path.basename(filePath));
  }
  return f;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runRound(round) {
  const tag = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const userA = `qa_${tag}_a`;
  const userB = `qa_${tag}_b`;
  const pwd = 'pw1234';
  const pwd2 = 'pw5678';
  const log = [];

  // ── 1. 基础与静态数据 ──
  {
    const h = await call('/health');
    chk('[健康检查] 200', h.status === 200, h);
  }
  {
    const v = await call('/varieties');
    chk('[品种库] 非空', v.status === 200 && (Array.isArray(v.data) ? v.data.length > 0 : Object.keys(v.data).length > 0), v);
  }
  {
    const c = await call('/care/tomato');
    chk('[养护知识] tomato 有返回', c.status === 200 && c.data, c);
  }
  {
    const w = await call('/weather');
    chk('[天气] 有 condition', w.status === 200 && !!w.data.condition, w);
  }
  {
    const t = await call('/tracks');
    chk('[追踪列表] 200 且是数组', t.status === 200 && Array.isArray(t.data), t);
  }

  // ── 2. 注册 / 登录 / 会话 ──
  let tokA = null;
  let idA = null;
  {
    const r = await call('/auth/register', { method: 'POST', form: form({ username: userA, password: pwd }) });
    tokA = r.data && r.data.token;
    idA = r.data && r.data.user_id;
    chk('[注册] 拿到 token', r.status === 200 && !!tokA, r);
  }
  {
    const r = await call('/auth/register', { method: 'POST', form: form({ username: `${userA}_x`, password: '123' }) });
    chk('[注册] 密码太短被拒 400', r.status === 400, r);
  }
  {
    const r = await call('/auth/register', { method: 'POST', form: form({ username: '   ', password: pwd }) });
    chk('[注册] 空用户名被拒 400', r.status === 400, r);
  }
  {
    const r = await call('/auth/me', { token: tokA });
    chk('[会话] /auth/me 用户名一致', r.status === 200 && r.data.username === userA, r);
  }
  {
    const r = await call('/auth/me');
    chk('[会话] 无 token 时 401', r.status === 401, r);
  }
  {
    const r = await call('/auth/login', { method: 'POST', form: form({ username: userA, password: 'wrongpw' }) });
    chk('[登录] 密码错 401', r.status === 401, r);
  }
  {
    const r = await call('/auth/login', { method: 'POST', form: form({ username: `${userA}_nobody`, password: pwd }) });
    chk('[登录] 用户不存在 401', r.status === 401, r);
  }
  {
    const r = await call('/auth/login', { method: 'POST', form: form({ username: userA, password: pwd }) });
    chk('[登录] 正常 200', r.status === 200 && !!r.data.token, r);
    if (r.data && r.data.token) tokA = r.data.token;
  }

  // ── 3. 改密码 ──
  {
    const r = await call('/auth/change-password', { method: 'POST', token: tokA, form: form({ old_password: 'wrong', new_password: pwd2 }) });
    chk('[改密码] 旧密码错 400', r.status === 400, r);
  }
  {
    const r = await call('/auth/change-password', { method: 'POST', token: tokA, form: form({ old_password: pwd, new_password: '1' }) });
    chk('[改密码] 新密码太短 400', r.status === 400, r);
  }
  {
    const r = await call('/auth/change-password', { method: 'POST', token: tokA, form: form({ old_password: pwd, new_password: pwd2 }) });
    chk('[改密码] 成功 200', r.status === 200, r);
  }
  {
    const r = await call('/auth/login', { method: 'POST', form: form({ username: userA, password: pwd }) });
    chk('[改密码] 旧密码已失效 401', r.status === 401, r);
  }
  {
    const r = await call('/auth/login', { method: 'POST', form: form({ username: userA, password: pwd2 }) });
    chk('[改密码] 新密码可登录 200', r.status === 200, r);
    if (r.data && r.data.token) tokA = r.data.token;
  }

  // ── 4. 权限隔离 ──
  {
    const r = await call('/garden');
    chk('[权限] 未登录 /garden 401', r.status === 401, r);
  }
  {
    const r = await call('/api/admin/stats');
    chk('[权限] 未登录 /api/admin/stats 401', r.status === 401, r);
  }
  {
    const r = await call('/api/admin/stats', { token: tokA });
    chk('[权限] 普通用户访问管理接口 403', r.status === 403, r);
  }
  {
    const f = form({ title: 'x', body: 'y' });
    const r = await call('/posts', { method: 'POST', form: f });
    chk('[权限] 未登录发帖 401', r.status === 401, r);
  }

  // ── 5. 花园 ──
  let plantId = null;
  let trackId = null;
  {
    const r = await call('/garden', { token: tokA });
    chk('[花园] 新账号为空', r.status === 200 && Array.isArray(r.data) && r.data.length === 0, r);
  }
  {
    const r = await call('/garden', { method: 'POST', token: tokA, form: form({ nickname: 'QA 番茄', crop: 'tomato', photo_emoji: '🍅', planted_date: '2026-10-01' }) });
    plantId = r.data && r.data.plant_id;
    chk('[花园] 添加植物', r.status === 200 && !!plantId, r);
  }
  {
    const r = await call('/garden', { method: 'POST', token: tokA, form: form({ nickname: '   ', crop: 'tomato' }) });
    chk('[花园] 空昵称被拒 400', r.status === 400, r);
  }
  {
    const r = await call('/garden', { token: tokA });
    chk('[花园] 列表含刚加的植物', r.status === 200 && r.data.length === 1 && r.data[0].nickname === 'QA 番茄', r);
  }
  {
    const r = await call(`/garden/${plantId}`, { token: tokA });
    chk('[花园] 单株详情 200', r.status === 200 && r.data.plant && r.data.plant.id === plantId, r);
  }
  {
    const r = await call('/garden/99999999', { token: tokA });
    chk('[花园] 不存在的植物 404', r.status === 404, r);
  }
  {
    const r = await call(`/garden/${plantId}/photo`, { method: 'POST', token: tokA, form: formWithFile({}, 'photo', TOMATO) });
    chk('[花园] 上传植物照片', r.status === 200 && !!r.data.photo_url, r);
  }
  {
    const r = await call(`/garden/${plantId}/track`, { method: 'POST', token: tokA });
    trackId = r.data && r.data.track_id;
    chk('[花园] 建立健康追踪', r.status === 200 && !!trackId, r);
  }
  {
    const f = form({});
    f.append('photo', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'a.txt');
    const r = await call(`/garden/${plantId}/photo`, { method: 'POST', token: tokA, form: f });
    chk('[花园] 非图片文件被拒 400', r.status === 400, r.status);
  }
  {
    const r = await call('/home', { token: tokA });
    chk('[首页] 有天气与花园数据', r.status === 200 && !!r.data.weather && !!r.data.garden, r);
  }
  {
    const r = await call('/home?lat=26.06&lon=119.30', { token: tokA });
    chk('[首页] 带坐标也能返回', r.status === 200 && !!r.data.weather, r);
  }
  {
    const r = await call('/todos', { token: tokA });
    chk('[待办] 200', r.status === 200, r);
  }
  {
    const r = await call('/diagnoses/recent', { token: tokA });
    chk('[最近诊断] 200', r.status === 200, r);
  }

  // ── 6. 资料 ──
  {
    const r = await call('/profile', { token: tokA });
    chk('[资料] 200 且含 user', r.status === 200 && !!r.data.user, r);
  }
  {
    const r = await call('/profile/update', { method: 'POST', token: tokA, form: form({ nickname: 'QA 园丁' }) });
    chk('[资料] 改昵称 200', r.status === 200 && r.data.nickname === 'QA 园丁', r);
  }
  {
    const r = await call('/profile/update', { method: 'POST', token: tokA, form: form({ nickname: '一二三四五六七八九十一二三四五六七八九十一' }) });
    chk('[资料] 昵称超 20 字被拒 400', r.status === 400, r);
  }
  {
    const r = await call('/profile/update', { method: 'POST', token: tokA, form: form({ avatar_preset: 'graft' }) });
    chk('[资料] 预置头像 200', r.status === 200 && r.data.avatar_url === 'preset:graft', r);
  }
  {
    const r = await call('/profile/update', { method: 'POST', token: tokA, form: form({ avatar_preset: 'not-a-preset' }) });
    chk('[资料] 非法预置头像 400', r.status === 400, r);
  }
  {
    const r = await call('/profile/update', { method: 'POST', token: tokA, form: form({}) });
    chk('[资料] 空请求 400', r.status === 400, r);
  }
  {
    const r = await call('/profile/update', { method: 'POST', token: tokA, form: formWithFile({ nickname: 'QA 园丁' }, 'avatar', TOMATO) });
    chk('[资料] 上传头像 200 且非 preset', r.status === 200 && typeof r.data.avatar_url === 'string' && !r.data.avatar_url.startsWith('preset:'), r);
  }

  // ── 7. 社区 ──
  let postId = null;
  {
    const r = await call('/posts', { method: 'POST', token: tokA, form: form({ title: 'QA 帖', body: '自动化测试发的', tags: '测试,自检', is_public: '1' }) });
    postId = r.data && r.data.post_id;
    chk('[帖子] 发帖成功', r.status === 200 && !!postId, r);
  }
  {
    const r = await call('/posts', { method: 'POST', token: tokA, form: form({ title: '   ', body: 'x' }) });
    chk('[帖子] 空标题被拒 400', r.status === 400, r);
  }
  {
    const r = await call('/posts?limit=50');
    const found = Array.isArray(r.data) && r.data.some((p) => p.id === postId);
    chk('[帖子] 列表里能看到', r.status === 200 && found, r);
  }
  {
    const r = await call(`/posts/${postId}`);
    chk('[帖子] 详情 200', r.status === 200 && r.data.id === postId, r);
  }
  {
    const r = await call(`/posts/${postId}/like`, { method: 'POST', token: tokA });
    chk('[帖子] 点赞', r.status === 200, r);
  }
  {
    const d = await call(`/posts/${postId}`);
    chk('[帖子] 点赞数已 +1', d.data.likes === 1, d.data && d.data.likes);
  }
  {
    const r = await call(`/posts/${postId}/like`, { method: 'POST', token: tokA });
    const d = await call(`/posts/${postId}`);
    chk('[帖子] 再点一次取消赞', r.status === 200 && d.data.likes === 0, d.data && d.data.likes);
  }
  {
    const r = await call(`/posts/${postId}/favorite`, { method: 'POST', token: tokA });
    chk('[帖子] 收藏', r.status === 200, r);
  }
  {
    const r = await call(`/posts/${postId}/comments`, { method: 'POST', token: tokA, form: form({ body: 'QA 评论' }) });
    chk('[帖子] 评论', r.status === 200, r);
  }
  {
    const r = await call(`/posts/${postId}/comments`, { method: 'POST', token: tokA, form: form({ body: '   ' }) });
    chk('[帖子] 空评论被拒 400', r.status === 400, r);
  }
  {
    const d = await call(`/posts/${postId}`);
    chk('[帖子] 详情含评论', d.status === 200 && Array.isArray(d.data.comments) && d.data.comments.length === 1, d.data && d.data.comments);
  }
  {
    const r = await call(`/posts/${postId}/visibility?is_public=0`, { method: 'PATCH', token: tokA });
    chk('[帖子] 改成私密 200', r.status === 200 && r.data.is_public === false, r);
  }
  {
    const r = await call(`/posts/${postId}`, { method: 'PUT', token: tokA, form: form({ title: 'QA 帖（改）', body: '改过的正文' }) });
    chk('[帖子] 作者编辑 200', r.status === 200, r);
  }
  {
    const r = await call(`/posts/${postId}`, { method: 'DELETE', token: tokA });
    chk('[帖子] 作者删除 200', r.status === 200 || r.status === 204, r);
  }
  {
    const r = await call(`/posts/${postId}`);
    chk('[帖子] 删掉后详情 404', r.status === 404, r);
  }

  // ── 8. 第二个用户：关注 / 越权 ──
  let tokB = null;
  let idB = null;
  {
    const r = await call('/auth/register', { method: 'POST', form: form({ username: userB, password: pwd }) });
    tokB = r.data && r.data.token;
    idB = r.data && r.data.user_id;
    chk('[用户B] 注册成功', r.status === 200 && !!tokB, r);
  }

  // 私密帖可见性：这是最容易漏的安全点，别人的「仅自己可见」不能被看到
  {
    const r = await call('/posts', { method: 'POST', token: tokA, form: form({ title: 'QA 私密帖', body: '只给自己看', is_public: '0' }) });
    const privId = r.data && r.data.post_id;
    chk('[私密] 发私密帖成功', r.status === 200 && !!privId, r);

    const mine = await call(`/posts/${privId}`, { token: tokA });
    chk('[私密] 作者自己能看详情', mine.status === 200, mine.status);

    const other = await call(`/posts/${privId}`, { token: tokB });
    chk('[私密] 别人看详情 404', other.status === 404, other.status);

    const guest = await call(`/posts/${privId}`);
    chk('[私密] 游客看详情 404', guest.status === 404, guest.status);

    const list = await call('/posts?limit=50', { token: tokB });
    chk('[私密] 别人列表里不出现', !(Array.isArray(list.data) && list.data.some((p) => p.id === privId)), 'listed');

    const patch = await call(`/posts/${privId}/visibility?is_public=1`, { method: 'PATCH', token: tokB });
    chk('[私密] 别人不能改可见性', patch.status === 404 || patch.status === 403, patch.status);

    const del = await call(`/posts/${privId}`, { method: 'DELETE', token: tokB });
    chk('[私密] 别人不能删', del.status === 403 || del.status === 404, del.status);

    await call(`/posts/${privId}`, { method: 'DELETE', token: tokA });
  }
  {
    const r = await call('/posts', { method: 'POST', token: tokA, form: form({ title: 'A 的帖子', body: '给越权测试用', is_public: '1' }) });
    const newPost = r.data && r.data.post_id;
    const del = await call(`/posts/${newPost}`, { method: 'DELETE', token: tokB });
    chk('[越权] B 删 A 的帖子被拒', del.status === 403 || del.status === 404, del);
    if (newPost) await call(`/posts/${newPost}`, { method: 'DELETE', token: tokA });
  }
  {
    const r = await call(`/users/${idA}/follow`, { method: 'POST', token: tokB });
    chk('[关注] B 关注 A', r.status === 200, r);
  }
  {
    const r = await call(`/users/${idA}/follow`, { method: 'POST', token: tokB });
    chk('[关注] 重复关注不报错', r.status === 200 || r.status === 400, r);
  }
  {
    const r = await call(`/users/${idB}/follow`, { method: 'POST', token: tokB });
    chk('[关注] 自己关注自己被拒', r.status === 400, r);
  }
  {
    const r = await call('/notifications', { token: tokA });
    chk('[通知] A 收到关注通知', r.status === 200 && Array.isArray(r.data.items) && r.data.items.length > 0, r);
  }
  {
    const r = await call('/notifications/unread_count', { token: tokA });
    chk('[通知] 未读数 ≥1', r.status === 200 && r.data.unread >= 1, r);
  }
  {
    const r = await call('/notifications/read', { method: 'POST', token: tokA });
    const c = await call('/notifications/unread_count', { token: tokA });
    chk('[通知] 标记已读后归零', r.status === 200 && c.data.unread === 0, c.data);
  }

  // ── 9. 识别（走真模型，比较慢） ──
  {
    const t0 = Date.now();
    const r = await call('/analyze', { method: 'POST', token: tokA, form: formWithFile({ task_type: 'plant_identify' }, 'image', TOMATO) });
    const ok = r.status === 200 && r.data && !!r.data.species && !!r.data.disease;
    chk(`[识别] 单图诊断（${Date.now() - t0}ms）`, ok, r.status !== 200 ? r : (r.data && r.data.species && r.data.species.label));
    log.push(`识别耗时 ${Date.now() - t0}ms`);
  }
  {
    const r = await call('/analyze', { method: 'POST', token: tokA, form: form({ task_type: 'plant_identify' }) });
    chk('[识别] 不给图时 400', r.status === 400, r);
  }
  {
    const r = await call('/analyze', { method: 'POST', token: tokA, form: form({ task_type: '乱写的类型' }) });
    chk('[识别] 非法 task_type 400', r.status === 400, r);
  }
  {
    const t0 = Date.now();
    const r = await call('/analyze', {
      method: 'POST',
      token: tokA,
      form: formWithFiles({ task_type: 'graft_screen', scion_variety: '', rootstock_variety: '' }, [['scion_image', TOMATO], ['rootstock_image', APPLE]]),
    });
    chk(`[识别] 嫁接初筛双图（${Date.now() - t0}ms）`, r.status === 200 && !!r.data, r.status !== 200 ? r : 'ok');
    log.push(`嫁接耗时 ${Date.now() - t0}ms`);
  }
  {
    const r = await call('/analyze', { method: 'POST', token: tokA, form: formWithFile({ task_type: 'graft_aftercare' }, 'image', TOMATO) });
    chk('[识别] 嫁接后管护（单图）', r.status === 200 && !!r.data.disease, r.status !== 200 ? r : 'ok');
  }
  {
    const r = await call('/analyze', {
      method: 'POST',
      token: tokA,
      form: formWithFile({ task_type: 'recovery_track', track_id: trackId }, 'image', TOMATO),
    });
    chk('[识别] 康复追踪（带 track_id）', r.status === 200 && !!r.data, r.status !== 200 ? r : 'ok');
  }
  {
    const r = await call('/analyze', { method: 'POST', token: tokA, form: formWithFile({ task_type: 'recovery_track' }, 'image', TOMATO) });
    chk('[识别] 康复追踪缺 track_id 被拒 400', r.status === 400, r.status);
  }
  {
    const f = form({ task_type: 'plant_identify' });
    f.append('image', new Blob([Buffer.from('not an image at all')], { type: 'text/plain' }), 'a.txt');
    const r = await call('/analyze', { method: 'POST', token: tokA, form: f });
    chk('[识别] 非图片文件被拒 400', r.status === 400, r.status);
  }

  // 同名注册：db 层设计上允许重名（verify_user 逐个试密码），这里把实际行为记下来
  {
    const r = await call('/auth/register', { method: 'POST', form: form({ username: userA, password: 'other124' }) });
    log.push(`同名注册→${r.status}`);
    if (r.status === 200) {
      const l1 = await call('/auth/login', { method: 'POST', form: form({ username: userA, password: pwd2 }) });
      const l2 = await call('/auth/login', { method: 'POST', form: form({ username: userA, password: 'other124' }) });
      chk(
        '[重名] 各自密码登进各自账号',
        l1.status === 200 && l2.status === 200 && l1.data.user_id !== l2.data.user_id,
        { a: l1.data && l1.data.user_id, b: l2.data && l2.data.user_id }
      );
    }
  }

  // ── 10. 收尾：删掉本轮造的植物（必须赶在 logout 之前，否则 token 已失效） ──
  if (plantId) {
    const r = await call(`/garden/${plantId}`, { method: 'DELETE', token: tokA });
    chk('[清理] 删除植物 200', r.status === 200 || r.status === 204, r);
  }
  {
    const r = await call('/garden', { token: tokA });
    chk('[清理] 花园已清空', r.status === 200 && r.data.length === 0, r.data && r.data.length);
  }

  // ── 11. 退出 ──
  {
    const r = await call('/auth/logout', { method: 'POST', token: tokA });
    const me = await call('/auth/me', { token: tokA });
    chk('[退出] 退出后 401', (r.status === 200 || r.status === 204) && me.status === 401, { logout: r.status, me: me.status });
  }

  return log;
}

(async () => {
  console.log(`目标：${BASE}`);
  console.log(`轮数：${ROUNDS}\n`);
  const t0 = Date.now();
  let crashed = null;
  for (let i = 1; i <= ROUNDS; i += 1) {
    const before = { pass, fail };
    const rt = Date.now();
    try {
      // eslint-disable-next-line no-await-in-loop
      const log = await runRound(i);
      console.log(`第 ${i} 轮：${pass - before.pass} 通过 / ${fail - before.fail} 失败，${Date.now() - rt}ms${log.length ? '  ' + log.join('，') : ''}`);
    } catch (e) {
      crashed = e;
      console.log(`第 ${i} 轮：脚本异常中断 —— ${e.message}`);
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    if (i < ROUNDS) await sleep(300);
  }
  const total = Date.now() - t0;
  console.log(`\n合计 ${pass + fail} 项检查，通过 ${pass}，失败 ${fail}，总耗时 ${(total / 1000).toFixed(1)}s`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  if (crashed) {
    console.log('\n异常堆栈：');
    console.log(crashed.stack);
  }
  process.exit(fail || crashed ? 1 : 0);
})();
