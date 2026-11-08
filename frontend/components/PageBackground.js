import React from 'react';
import { View } from 'react-native';
import { C } from '../lib/theme';

// 每页淡装饰背景：同色基底 + 几个柔和品牌色光斑。
// 放在各 tab 根 View 的最前面（absolute），并把该屏自己的纯色背景设为透明，
// 让光斑透出来；不抢内容、不复杂。
const PALETTES = {
  green: ['#CDE9B0', '#EAF6DF', '#F6CE3D'],
  leaf: ['#BFE3A0', '#EAF6DF', '#F6CE3D'],
  warm: ['#F6CE3D', '#FBE7B8', '#CDE9B0'],
  soft: ['#D8ECC6', '#F6CE3D', '#EAF6DF'],
};

export default function PageBackground({ variant = 'green', style }) {
  const p = PALETTES[variant] || PALETTES.green;
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 0,
          backgroundColor: C.bg,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: p[0], opacity: 0.32, top: -90, right: -70 }} />
      <View style={{ position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: p[1], opacity: 0.55, bottom: 70, left: -80 }} />
      <View style={{ position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: p[2], opacity: 0.22, top: '44%', right: -34 }} />
      <View style={{ position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: p[0], opacity: 0.18, top: 130, left: 46 }} />
    </View>
  );
}
