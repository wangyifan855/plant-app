import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { C } from '../lib/theme';

// 每页淡装饰背景：浅绿底 + 四只吉祥物（小鳄鱼）均匀平铺、低透明度 + 几个柔和品牌色光斑。
// 放在各 tab 根 View 的最前面（absolute），并把该屏自己的纯色背景设为透明，
// 让图案透出来；不抢内容、不复杂。
const PATTERN = require('../assets/bg_pattern.png');

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
          backgroundColor: '#EEF7E4', // 浅绿底
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* 柔和光斑（垫在图案下面，给背景一点层次） */}
      <View style={{ position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: p[0], opacity: 0.22, top: -90, right: -70 }} />
      <View style={{ position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: p[1], opacity: 0.4, bottom: 70, left: -80 }} />
      <View style={{ position: 'absolute', width: 130, height: 130, borderRadius: 65, backgroundColor: p[2], opacity: 0.16, top: '44%', right: -34 }} />

      {/* 吉祥物背景图案：小鳄鱼四只一组平铺，透明度已在图里压到 15%~17% */}
      <Image source={PATTERN} style={StyleSheet.absoluteFill} resizeMode="repeat" />
    </View>
  );
}
