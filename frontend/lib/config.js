import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ── 改这里就行（开发调试用）────────────────────
// 网页测试 / 本机模拟器：'http://localhost:8010'
// （本机 8000 回环被 WorkBuddy 桌面端内部服务常驻占用，后端本地演示改用 8010）
// Expo Go 真机调试：填你电脑的局域网 IP（终端跑 `ipconfig` 看 IPv4 地址）
//   例：'http://192.168.1.100:8010'
// 打 APK / release 包时，由 app.json 里的 extra.apiUrl 自动覆盖（见 §5），
//   填后端 HTTPS 地址，例：'https://graftcheck.onrender.com'
// 网页版自动用 localhost（跟随浏览器地址，不受换网/IP 变化影响）；
// 真机调试才需要填局域网 IP（换网络后 ipconfig 重新看一眼）。
const LAN_API_URL = 'http://10.133.5.44:8010';
const DEV_API_URL = Platform.OS === 'web' ? 'http://localhost:8010' : LAN_API_URL;
// ────────────────────────────────────────────

// 网页版永远用 localhost，且无视 extra.apiUrl（那是给 APK/release 包用的，
// 曾因烤进旧局域网 IP 导致网页全页「无法连接服务器」，别再让它进网页包）。
export const API_URL = Platform.OS === 'web'
  ? DEV_API_URL.replace(/\/$/, '')
  : (Constants.expoConfig?.extra?.apiUrl || DEV_API_URL).replace(/\/$/, '');

// 客户端请求超时：30 秒（覆盖冷启动偶发慢响应，详见需求文档 §4）。
export const REQUEST_TIMEOUT_MS = 30000;
