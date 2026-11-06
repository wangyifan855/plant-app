// 响应式断点：同一个 App 既跑手机也跑 PC 浏览器。
//
// 注意：断点必须是「响应窗口变化」的，不能用模块加载时算一次就定死，
// 否则用户把窗口从宽屏拖窄，侧边栏不会消失，内容会被压成一条竖条。
// 所以统一用 useWindowDimensions()，改窗口会跟着重渲染。

import { Platform, useWindowDimensions } from 'react-native';

export const isWeb = Platform.OS === 'web';

// >=1024 视为 PC：左侧导航 + 多栏布局；以下走手机布局
export const DESKTOP_MIN = 1024;

// 内容区最大宽度（PC 上居中，手机上没有影响）
export const CONTENT_MAX = 1040;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isDesktop = isWeb && width >= DESKTOP_MIN;
  return { width, height, isDesktop };
}
