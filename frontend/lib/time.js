// 后端时间统一存 UTC（形如 "2026-11-03T16:14:51"，不带时区后缀），
// 直接截字符串会差 8 小时，这里统一按 UTC 解析再转本地展示。

function parseUtc(s) {
  if (!s) return null;
  // 已经是 ISO 带时区（含 Z 或 +08:00）就直接解析
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

// 2026-11-04 00:14
export function fmtDateTime(s) {
  const d = parseUtc(s);
  if (!d) return s ? String(s).slice(0, 16).replace('T', ' ') : '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 2026-11-04
export function fmtDate(s) {
  const d = parseUtc(s);
  if (!d) return s ? String(s).slice(0, 10) : '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 11-04（用于拼标题之类）
export function fmtMonthDay(s) {
  const d = parseUtc(s);
  if (!d) return s ? String(s).slice(5, 10) : '';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
