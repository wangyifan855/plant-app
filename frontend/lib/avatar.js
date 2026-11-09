// 头像有两种来源：
//   1. 用户自己上传的照片 —— 后端存 /files/uploads/xxx.jpg 相对路径
//   2. 从吉祥物造型里挑一个 —— 存 `preset:<key>` 标记
// 预置形象直接用打包进 App 的那几张图，服务器不用存副本；以后换画风，
// 老用户的头像也跟着一起变，不用挨个迁移文件。
import { API_URL } from './config';

const PRESET_IMG = {
  identify: require('../assets/mascot_identify.png'),
  graft: require('../assets/mascot_graft.png'),
  community: require('../assets/mascot_community.png'),
  track: require('../assets/mascot_track.png'),
  carrot: require('../assets/mascot_carrot.png'),
  cucumber: require('../assets/mascot_cucumber.png'),
};

// 编辑资料里给用户挑的六款。前三款是 App 里最常露脸的，放前面。
export const AVATAR_PRESETS = [
  { key: 'identify', label: '举番茄', source: PRESET_IMG.identify },
  { key: 'graft', label: '挖土', source: PRESET_IMG.graft },
  { key: 'community', label: '抱黄瓜', source: PRESET_IMG.community },
  { key: 'track', label: '浇水', source: PRESET_IMG.track },
  { key: 'carrot', label: '胡萝卜', source: PRESET_IMG.carrot },
  { key: 'cucumber', label: '小黄瓜', source: PRESET_IMG.cucumber },
];

export const PRESET_KEYS = AVATAR_PRESETS.map((p) => p.key);

const PREFIX = 'preset:';

// avatar_url 是预置形象就返回它的 key，否则 null
export function presetKey(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(PREFIX)) return null;
  const k = raw.slice(PREFIX.length);
  return PRESET_IMG[k] ? k : null;
}

// 直接拿到 require 出来的本地图（给 <Image source> 用）
export function presetSource(key) {
  return PRESET_IMG[key] || null;
}

// 统一出口：喂给 <SmartImage source> 或 <Image source>。
// 预置形象返回本地 require 的结果，上传照片返回 { uri }，都没有返回 null（交给 fallback）。
export function avatarSource(raw) {
  const k = presetKey(raw);
  if (k) return PRESET_IMG[k];
  if (!raw) return null;
  return { uri: raw.startsWith('http') ? raw : `${API_URL}${raw}` };
}
