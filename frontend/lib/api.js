import { API_URL, REQUEST_TIMEOUT_MS } from './config';

// ── 登录态 token：web 用 localStorage 持久化，原生退化为内存 ──
const TOKEN_KEY = 'graftcheck_token';
function loadToken() {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null; }
  catch { return null; }
}
function saveToken(t) {
  try {
    if (typeof localStorage !== 'undefined') {
      t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
    }
  } catch { /* ignore */ }
}
let _token = loadToken();
export function getToken() { return _token; }
export function setToken(t) { _token = t; saveToken(t); }
export function clearToken() { _token = null; saveToken(null); }

// ── 通用请求：30 秒超时 + RN 网络错误转译 ──
// 注意：web 端不能手动设 multipart Content-Type（会丢 boundary 导致后端 400），
// 浏览器 fetch 遇 FormData 会自动补全；只有原生 RN 需要手动指定。
const IS_WEB = typeof document !== 'undefined';
async function request(path, { method = 'GET', form, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      body: form,
      headers: {
        ...(form && !IS_WEB ? { 'Content-Type': 'multipart/form-data' } : {}),
        ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 后端统一用 {"detail": "..."} 表达错误，直接把 detail 当提示文案，
      // 不要把状态码和原始 JSON 拼给用户看（"后端返回 401：{...}"）
      let detail = '';
      try {
        const j = JSON.parse(text);
        if (typeof j?.detail === 'string') detail = j.detail;
      } catch { /* 不是 JSON 就退到通用文案 */ }
      throw new Error(detail || `请求失败（${res.status}），请稍后重试`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('请求超时，请确认网络或后端已启动后重试');
    }
    // fetch 在 RN 上网络错误通常抛出 TypeError
    if (err instanceof TypeError) {
      throw new Error('无法连接服务器，请检查网络后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// RN 的 FormData 文件必须带 uri / name / type 三件套，漏了后端会拒收。
function filePart(image, name = 'photo.jpg') {
  return { uri: image.uri, name, type: 'image/jpeg' };
}

// web 端 uri 是 blob:/data: 地址，不能直接 append 对象（会被序列化成 "[object Object]"
// 变成普通文本字段，后端报 422 Expected UploadFile）。先 fetch 成 Blob 再 append。
// 原生 RN 走三件套对象。所有带文件的接口统一走这个函数。
async function appendFile(form, key, image, name = 'photo.jpg') {
  if (IS_WEB) {
    const blob = await (await fetch(image.uri)).blob();
    form.append(key, blob, name);
  } else {
    form.append(key, filePart(image, name));
  }
}

// ── 嫁接初筛（保持 v1 契约） ──
export async function analyze({ scionImage, rootstockImage, scionVariety, rootstockVariety, temperature, soilType }) {
  const form = new FormData();
  await appendFile(form, 'scion_image', scionImage, 'scion.jpg');
  await appendFile(form, 'rootstock_image', rootstockImage, 'rootstock.jpg');
  if (scionVariety) form.append('scion_variety', scionVariety);
  if (rootstockVariety) form.append('rootstock_variety', rootstockVariety);
  form.append('task_type', 'graft_screen');
  if (temperature) form.append('temperature', String(temperature));
  if (soilType) form.append('soil_type', String(soilType));
  return request('/analyze', { method: 'POST', form });
}

// ── 单图识别：task_type = plant_identify | graft_aftercare | recovery_track ──
export async function identify(taskType, { image, trackId, note, plantId } = {}) {
  const form = new FormData();
  form.append('task_type', taskType);
  await appendFile(form, 'image', image);
  if (trackId) form.append('track_id', trackId);
  if (note) form.append('note', String(note));
  if (plantId) form.append('plant_id', String(plantId)); // 关联花园植物 → 结果写进它的健康追踪
  return request('/analyze', { method: 'POST', form });
}

// ── 追踪 ──
export function createTrack(name, crop) {
  const form = new FormData();
  form.append('name', name);
  if (crop) form.append('crop', crop);
  return request('/tracks', { method: 'POST', form });
}

export function listTracks() {
  return request('/tracks');
}

export function getTrack(trackId) {
  return request(`/tracks/${trackId}`);
}

// ── 社区 ──
export function listPosts(limit = 20, offset = 0) {
  return request(`/posts?limit=${limit}&offset=${offset}`);
}

export async function createPost({ title, body, tags, isPublic = true, images }) {
  const form = new FormData();
  form.append('title', title);
  form.append('body', body);
  if (tags?.length) form.append('tags', tags.join(','));
  form.append('is_public', isPublic ? '1' : '0');
  let i = 0;
  for (const img of images || []) {
    await appendFile(form, 'images', img, `post_${i}.jpg`);
    i += 1;
  }
  return request('/posts', { method: 'POST', form });
}

export function getPost(postId) {
  return request(`/posts/${postId}`);
}

// 草稿箱：被下架、可以改完重新发的帖子
export function listDrafts() {
  return request('/drafts');
}

// 编辑自己的草稿帖并重新发布：keepImages 是保留的旧图相对路径，images 是新加的图
export async function updatePost(postId, { title, body, tags, isPublic = true, images, keepImages }) {
  const form = new FormData();
  form.append('title', title);
  form.append('body', body);
  if (tags?.length) form.append('tags', tags.join(','));
  form.append('is_public', isPublic ? '1' : '0');
  if (keepImages?.length) form.append('keep_images', keepImages.join(','));
  let i = 0;
  for (const img of images || []) {
    await appendFile(form, 'images', img, `post_${i}.jpg`);
    i += 1;
  }
  return request(`/posts/${postId}`, { method: 'PUT', form });
}

export function addComment(postId, body) {
  const form = new FormData();
  form.append('body', body);
  return request(`/posts/${postId}/comments`, { method: 'POST', form });
}

// 作者删自己的帖子
export function deletePost(postId) {
  return request(`/posts/${postId}`, { method: 'DELETE' });
}

// 作者切换可见范围（公开 / 仅自己可见）
export function setPostVisibility(postId, isPublic) {
  return request(`/posts/${postId}/visibility?is_public=${isPublic ? 1 : 0}`, { method: 'PATCH' });
}

export function likePost(postId) {
  return request(`/posts/${postId}/like`, { method: 'POST' });
}

export function favoritePost(postId) {
  return request(`/posts/${postId}/favorite`, { method: 'POST' });
}

export function toggleFollow(userId) {
  return request(`/users/${userId}/follow`, { method: 'POST' });
}

export function getProfile() {
  return request('/profile');
}

// 更新个人资料：昵称和/或头像（都可选）。
// 头像两种给法：image 是自己上传的照片，preset 是预置造型的 key（如 'graft'）。
// 同时给两个时以照片为准，避免后端存了个前后不一致的状态。
export async function updateProfile({ nickname, image, preset } = {}) {
  const form = new FormData();
  if (nickname != null) form.append('nickname', nickname);
  if (image) await appendFile(form, 'avatar', image);
  else if (preset) form.append('avatar_preset', preset);
  const r = await request('/profile/update', { method: 'POST', form });
  // 预置头像是 preset:xxx 标记，拼上 API_URL 会变成坏地址，这里直接给 null
  const isPreset = typeof r.avatar_url === 'string' && r.avatar_url.startsWith('preset:');
  return {
    ...r,
    absolute_avatar_url: r.avatar_url && !isPreset ? `${API_URL}${r.avatar_url}` : null,
  };
}

export async function healthCheck() {
  return request('/health');
}

// ── 用户认证 ──
export async function register(username, password) {
  const form = new FormData();
  form.append('username', username);
  form.append('password', password);
  const r = await request('/auth/register', { method: 'POST', form });
  setToken(r.token);
  return r;
}

export async function login(username, password) {
  const form = new FormData();
  form.append('username', username);
  form.append('password', password);
  const r = await request('/auth/login', { method: 'POST', form });
  setToken(r.token);
  return r;
}

export async function logout() {
  try { await request('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  clearToken();
}

// 演示账号一键进入（免注册，服务端自动种示例植物）
export async function demoLogin() {
  const r = await request('/auth/demo', { method: 'POST' });
  setToken(r.token);
  return r;
}

// 上传/更换花园植物的真实照片（服务端返回 /files/... 相对路径，这里拼成绝对地址）
export async function uploadPlantPhoto(plantId, image) {
  const form = new FormData();
  await appendFile(form, 'photo', image);
  const r = await request(`/garden/${plantId}/photo`, { method: 'POST', form });
  return { ...r, absolute_url: r.photo_url ? `${API_URL}${r.photo_url}` : null };
}

export function me() {
  return request('/auth/me');
}

// ── 我的花园 ──
export function listGarden() {
  return request('/garden');
}

export function addPlant({ nickname, crop, photoEmoji, plantedDate, notes }) {
  const form = new FormData();
  form.append('nickname', nickname);
  if (crop) form.append('crop', crop);
  if (photoEmoji) form.append('photo_emoji', photoEmoji);
  if (plantedDate) form.append('planted_date', plantedDate);
  if (notes) form.append('notes', notes);
  return request('/garden', { method: 'POST', form });
}

export function deletePlant(id) {
  return request(`/garden/${id}`, { method: 'DELETE' });
}

export function createPlantTrack(id) {
  return request(`/garden/${id}/track`, { method: 'POST' });
}

export function getGardenPlant(id) {
  return request(`/garden/${id}`);
}

// ── 首页聚合 / 天气 / 诊断历史 / 照养指南 ──
// coords: {lat, lon} 可选。传了就用真实定位查天气；没传后端按出口 IP 定位。
function withCoords(path, coords) {
  if (!coords || coords.lat == null || coords.lon == null) return path;
  return `${path}?lat=${coords.lat}&lon=${coords.lon}`;
}

export function getHome(coords) {
  return request(withCoords('/home', coords));
}

export function getTodos() {
  return request('/todos');
}

export function getWeather(coords) {
  return request(withCoords('/weather', coords));
}

export function recentDiagnoses(limit = 10) {
  return request(`/diagnoses/recent?limit=${limit}`);
}

export function getDiagnosis(id) {
  return request(`/diagnoses/${id}`);
}

export function getCare(crop) {
  return request(`/care/${encodeURIComponent(crop)}`);
}

// ── 消息通知 ──
export function getNotifications() {
  return request('/notifications');
}

export function getUnreadCount() {
  return request('/notifications/unread_count');
}

export function markNotificationsRead() {
  return request('/notifications/read', { method: 'POST' });
}
