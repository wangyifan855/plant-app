// 满屏点赞/庆祝动效（微信式）：元素从屏幕顶部飘落到底部，悬浮在内容之上，约 6.5s 自动消失。
// 不重叠策略：屏幕横向切成 9 列，每个元素独占一列（列内 x 基本固定）；同列 4 个元素
// 错开出发时间（分成 4 排依次下落），保证同列不追尾、跨列不相撞。
import React, { useEffect, useState } from 'react';
import { View, Text, Animated, StyleSheet, Dimensions } from 'react-native';

const EMOJIS = ['👍', '❤️', '🌿', '🎉', '💚', '✨', '⭐'];
const COLS = 9;          // 横向列数
const LANES = 4;         // 每列 4 个波次 → 视觉上 4 排错落下落
const FALL = 3400;       // 单个元素从顶落到底的时长（放慢更有漂浮感）

export default function LikeBurst({ duration = 6600, onDone }) {
  const { height, width } = Dimensions.get('window');
  const [particles] = useState(() => {
    // 洗牌列顺序，让每次出发的列不一样
    const cols = Array.from({ length: COLS }, (_, i) => i);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const colW = width / COLS;
    return cols.flatMap((col, idx) =>
      Array.from({ length: LANES }).map((_, lane) => ({
        id: idx * LANES + lane,
        e: EMOJIS[(idx * 3 + lane) % EMOJIS.length],
        x: col * colW + colW / 2 - 17 + (Math.random() * 12 - 6), // 列内只留极小抖动
        scale: 0.85 + Math.random() * 0.5,
        rot: (Math.random() - 0.5) * 34,
        // 4 排依次出发：相邻排错开 FALL*0.26，让任意时刻屏幕都有 4 排错落分布
        delay: lane * FALL * 0.26 + Math.random() * 160,
        swayAmp: 10 + Math.random() * 10, // 左右摆动幅度
        y: new Animated.Value(-60),
        op: new Animated.Value(0),
        sway: new Animated.Value(0),
      }))
    );
  });

  useEffect(() => {
    const timers = [];
    particles.forEach((p) => {
      const t = setTimeout(() => {
        Animated.parallel([
          // 下落：顶部外 → 底部外
          Animated.timing(p.y, {
            toValue: height + 40,
            duration: FALL,
            useNativeDriver: false,
          }),
          // 淡入 200ms → 保持 → 最后 420ms 淡出（总时长正好 FALL）
          Animated.sequence([
            Animated.timing(p.op, { toValue: 1, duration: 200, useNativeDriver: false }),
            Animated.timing(p.op, { toValue: 0, duration: 420, delay: FALL - 620, useNativeDriver: false }),
          ]),
          // 轻微左右摇摆（漂浮感）
          Animated.loop(
            Animated.sequence([
              Animated.timing(p.sway, { toValue: 1, duration: 750, useNativeDriver: false }),
              Animated.timing(p.sway, { toValue: -1, duration: 750, useNativeDriver: false }),
              Animated.timing(p.sway, { toValue: 0, duration: 750, useNativeDriver: false }),
            ]),
            { iterations: 2 }
          ),
        ]).start();
      }, p.delay);
      timers.push(t);
    });
    const done = setTimeout(() => onDone && onDone(), duration + 500);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
      particles.forEach((p) => p.sway.stopAnimation());
    };
  }, [duration]);

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 999 }]} pointerEvents="none">
      {particles.map((p) => (
        <Animated.View
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: 0,
            transform: [
              { translateY: p.y },
              { translateX: p.sway.interpolate({ inputRange: [-1, 1], outputRange: [-p.swayAmp, p.swayAmp] }) },
              { rotate: `${p.rot}deg` },
              { scale: p.scale },
            ],
            opacity: p.op,
          }}
        >
          <Text style={{ fontSize: 26 }}>{p.e}</Text>
        </Animated.View>
      ))}
    </View>
  );
}
