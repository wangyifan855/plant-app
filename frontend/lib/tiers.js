// 五档建议的配色与图标映射，前端只根据 decision.code 取用，不含任何业务规则。
export const TIERS = {
  recommend: { color: '#2e7d32', bg: '#e8f5e9', label: '建议嫁接', emoji: '✅' },
  cautious: { color: '#f9a825', bg: '#fff8e1', label: '谨慎尝试', emoji: '⚠️' },
  defer: { color: '#ef6c00', bg: '#fff3e0', label: '暂缓嫁接', emoji: '⏸️' },
  not_recommend: { color: '#c62828', bg: '#ffebee', label: '不建议嫁接', emoji: '⛔' },
  retake: { color: '#616161', bg: '#eeeeee', label: '请重拍', emoji: '📷' },
};
