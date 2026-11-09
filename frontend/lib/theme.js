// 全局配色（对齐 prototype.html 浅色方案：主绿/暖黄/橙/米绿背景）
import { Easing } from 'react-native';

export const C = {
  green: '#6FB83F',
  greenDark: '#4A8A22',
  greenTint: '#EAF6DF',
  yellow: '#F6CE3D',
  orange: '#F59331',
  bg: '#F4FAEE',
  card: '#FFFFFF',
  text: '#2F4A1D',
  sub: '#7A8B6F',
  red: '#EF7A6B',
  gray: '#C2CBC0',
  border: '#DCEBD0',
};

// ---- 设计 token ----
// 新写的组件从这里取值。老的 Screen 里还是硬编码数字，改动量太大会把现有视觉
// 打散，所以不做全量替换，只在新增/重写的地方用。

// 间距：4 的倍数
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

// 圆角：原来 10/12/14/16 混着用，收敛成四档
export const R = { sm: 10, md: 14, lg: 18, pill: 999 };

// 字号：12/13/14 挤在一起看不出层级，新代码按这七档取
export const FS = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, hero: 30, num: 34 };

// 阴影：阴影色用深绿而不是纯黑，压在米绿背景上不会发灰
export const SH = {
  none: {},
  sm: { shadowColor: '#2F4A1D', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  md: { shadowColor: '#2F4A1D', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  lg: { shadowColor: '#2F4A1D', shadowOpacity: 0.1, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
};

// 时长（ms）：全站统一用这四档，别在组件里随手写数字
export const T = { fast: 120, base: 220, slow: 320, enter: 420 };

// 缓动：入场统一用一条「快出、缓停」的曲线，才有一致的呼吸感
export const EASE = {
  out: Easing.bezier(0.22, 1, 0.36, 1),
  inOut: Easing.inOut(Easing.ease),
  back: Easing.bezier(0.34, 1.4, 0.64, 1),
};

// 交错入场的步长：列表里第 n 个元素延迟 n * STAGGER 才入场
export const STAGGER = 70;
