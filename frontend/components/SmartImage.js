import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';

// 图片加载失败（或压根没有图）时回退到 fallback，
// 避免网页/真机上出现空白块或裂图。
//
// 两种用法：传 uri（后端相对/绝对路径都行，调用方自己拼好），
// 或传 source（本地 require 的图，比如预置头像）。source 优先。
export default function SmartImage({
  uri, source, style, fallback = null, resizeMode = 'cover', ...rest
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [uri, source]);

  const src = source || (uri ? { uri } : null);
  if (!src || failed) return fallback;

  return (
    <Image
      source={src}
      style={style}
      resizeMode={resizeMode}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}
