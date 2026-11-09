// 骨架占位：呼吸式明暗循环，替代「空白 + 转圈」。
// 转圈的问题不是丑，是内容回来时整页要往下跳一次；骨架按真实尺寸占好位就不会跳。
//
// 同一屏里的一组骨架必须同步呼吸，所以用 usePulse() 造一个共享值往下传，
// 各自独立跑动画会明灭不同步，看起来像在抽搐。
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, View } from 'react-native';
import { C, R } from '../lib/theme';

const NATIVE = Platform.OS !== 'web';

// 共享呼吸值：一个屏幕调一次，传给屏内所有 Skeleton / SkeletonRows
export function usePulse(enabled = true) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 0, duration: 800, useNativeDriver: NATIVE }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, enabled]);
  return v;
}

export default function Skeleton({ width = '100%', height = 12, radius = 5, style, pulse }) {
  // 外面传了共享值就不要再自己跑一条 loop，否则一屏几十块各转各的
  const own = usePulse(!pulse);
  const v = pulse || own;

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: '#DCE4D6',
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        },
        style,
      ]}
    />
  );
}

// 列表骨架：形状对齐「头像 + 标题 + 副标题」这一类卡片，高度和真实卡片一致。
export function SkeletonRows({ rows = 3, avatar = 52, style }) {
  const pulse = usePulse();
  return (
    <View style={style}>
      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: C.card,
            borderRadius: R.md,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Skeleton width={avatar} height={avatar} radius={14} pulse={pulse} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Skeleton width="58%" height={13} pulse={pulse} />
            <Skeleton width="36%" height={11} pulse={pulse} style={{ marginTop: 9 }} />
          </View>
        </View>
      ))}
    </View>
  );
}
