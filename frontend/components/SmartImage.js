import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';

// 图片加载失败（或压根没有图）时回退到 fallback，
// 避免网页/真机上出现空白块或裂图。
export default function SmartImage({ uri, style, fallback = null, resizeMode = 'cover', ...rest }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [uri]);

  if (!uri || failed) return fallback;

  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}
