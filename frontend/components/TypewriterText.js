// 打字机文字：segments = [{ text, style }]，逐字输出，样式保留，打完前显示光标
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { C } from '../lib/theme';

export default function TypewriterText({ segments, style, speed = 55, delay = 0, cursor = true }) {
  const total = segments.reduce((n, s) => n + s.text.length, 0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= total) return undefined;
    let t;
    if (count === 0 && delay > 0) {
      t = setTimeout(() => setCount(1), delay);
    } else {
      t = setTimeout(() => setCount((c) => Math.min(c + 1, total)), speed);
    }
    return () => clearTimeout(t);
  }, [count, total, speed, delay]);
  let left = count;
  const parts = [];
  for (let i = 0; i < segments.length && left > 0; i++) {
    const take = Math.min(left, segments[i].text.length);
    parts.push(<Text key={i} style={segments[i].style}>{segments[i].text.slice(0, take)}</Text>);
    left -= take;
  }
  const done = count >= total;
  return (
    <Text style={style}>
      {parts}
      {cursor && !done && <Text style={{ color: C.green }}>▌</Text>}
    </Text>
  );
}
