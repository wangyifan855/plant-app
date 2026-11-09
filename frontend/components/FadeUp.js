// 入场包装：挂载时淡入 + 从下方 12px 浮上来。
// index 用来做交错：列表里传 index={i}，就会依次入场，不会整屏「啪」一下全出现。
// 只动 opacity 和 transform，不给子内容设任何布局尺寸，套在什么上面都不会改原有排版。
import React, { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { T, EASE, STAGGER } from '../lib/theme';

const NATIVE = Platform.OS !== 'web';

export default function FadeUp({ children, index = 0, delay, distance = 12, style }) {
  const v = useRef(new Animated.Value(0)).current;
  const wait = delay != null ? delay : index * STAGGER;

  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: T.enter,
      delay: wait,
      easing: EASE.out,
      useNativeDriver: NATIVE,
    });
    anim.start();
    return () => anim.stop();
  }, [v, wait]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
