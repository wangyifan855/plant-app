// 植物健康状态 → 文案 + 配色。花园列表、草坪气泡、首页植物卡共用一套，别各写一份。
import { C } from './theme';

export function plantStatus(p) {
  const rec = p && p.last_record;
  if (!rec) return { text: '未记录', color: C.sub, bg: '#EFF2EC' };
  if (rec.disease_label === 'healthy') return { text: '健康', color: '#1E7B34', bg: '#E2F5E5' };
  if (rec.disease_label === 'diseased') {
    return { text: rec.low_confidence ? '需关注' : '异常', color: '#C2410C', bg: '#FDEBDD' };
  }
  return { text: '观察中', color: '#8A6D1A', bg: '#FBF3D9' };
}
