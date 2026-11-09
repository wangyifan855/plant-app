// 可按压卡片：按下缩到 0.965，松手 spring 回弹。
// 全站六十多个可点区域里原来只有十几处设了 activeOpacity，剩下按下去毫无反馈，
// 新写的地方统一套这个；老的 TouchableOpacity 逐个换，别一次全替换。
import React, { useRef } from 'react';
import { Animated, Pressable, Platform } from 'react-native';

const NATIVE = Platform.OS !== 'web';

export default function TapCard({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  containerStyle,
  scaleTo = 0.965,
  ...rest
}) {
  const s = useRef(new Animated.Value(1)).current;

  const to = (value) => {
    Animated.spring(s, {
      toValue: value,
      useNativeDriver: NATIVE,
      friction: 7,
      tension: 120,
    }).start();
  };

  return (
    <Pressable
      onPressIn={() => { if (!disabled) to(scaleTo); }}
      onPressOut={() => to(1)}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={containerStyle}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
