import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

// 客户端压缩：最长边缩放到 1024px 以内，JPEG 质量 0.7~0.8。
// 注意：这是软目标，实际大小可能 200KB~1MB 不等，后端 10MB 才是硬上限。
// 同时返回压缩后尺寸，供质量门判断（最短边 < 300px 视为低质量）。
export async function compressImage(uri, width, height) {
  const MAX_SIDE = 1024;
  let resize = undefined;
  if (width && height) {
    if (width >= height && width > MAX_SIDE) {
      resize = { width: MAX_SIDE };
    } else if (height > MAX_SIDE) {
      resize = { height: MAX_SIDE };
    }
  }

  const actions = resize ? [{ resize }] : [];
  const result = await manipulateAsync(uri, actions, {
    compress: 0.75,
    format: SaveFormat.JPEG,
  });
  return { uri: result.uri, width: result.width, height: result.height };
}

// 客户端质量门（重拍的另一触发）：最短边 < 300px 直接判定低质量，不发起请求。
// 模糊度（拉普拉斯方差）在 RN 端需逐像素分析，原型阶段省略，交由后端 0.60 阈值兜底。
export function isLowQuality(width, height) {
  if (!width || !height) return false;
  return Math.min(width, height) < 300;
}
