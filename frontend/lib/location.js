// 真实定位：给首页天气用。
//
// web：浏览器 navigator.geolocation（需要用户授权，且只在 https / localhost 这类
//      安全上下文里才给权限；用 http://192.168.x.x 打开时浏览器会直接拒绝，
//      这里返回 null，后端会自动退回按出口 IP 定位）。
// 原生：暂未接入 expo-location（项目没装这个依赖），同样返回 null。
//
// 拿到坐标后缓存 30 分钟，避免每次回首页都问一遍。

import { Platform } from 'react-native';

const CACHE_KEY = 'geo_coords_v1';
const TTL = 30 * 60 * 1000; // 30 分钟

let _memo = null;

function readCache() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || Date.now() - (c.ts || 0) > TTL) return null;
    return { lat: c.lat, lon: c.lon };
  } catch {
    return null;
  }
}

function writeCache(c) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...c, ts: Date.now() }));
  } catch { /* 无痕模式等，忽略 */ }
}

function locate() {
  return new Promise((resolve) => {
    // 浏览器迟迟不弹窗/用户不点，最多等 6 秒就放弃，别拖住首页
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), 6500);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        const c = {
          lat: +pos.coords.latitude.toFixed(4),
          lon: +pos.coords.longitude.toFixed(4),
        };
        _memo = c;
        writeCache(c);
        finish(c);
      },
      () => { clearTimeout(timer); finish(null); },
      { timeout: 6000, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false },
    );
  });
}

export async function getCoords() {
  if (_memo) return _memo;

  const cached = readCache();
  if (cached) { _memo = cached; return cached; }

  if (Platform.OS !== 'web') return null;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;

  return locate();
}

// 同步取缓存：有就直接用，没有返回 null（首页可以先用 IP 定位秒开，别等授权弹窗）
export function getCachedCoords() {
  if (_memo) return _memo;
  const cached = readCache();
  if (cached) { _memo = cached; return cached; }
  return null;
}

// 用户手动拒绝过就不再多问（本次会话内）
export function clearCoordsCache() {
  _memo = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}
