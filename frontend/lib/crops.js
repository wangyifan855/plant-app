// 受支持的 14 种作物（与 backend/app/predict.py 的 _CROPS 单源一致）。
// 花园植物「品种」选择器与识别结果作物共用此列表。
export const CROPS = [
  { en: 'Tomato', zh: '番茄' },
  { en: 'Apple', zh: '苹果' },
  { en: 'Potato', zh: '马铃薯' },
  { en: 'Grape', zh: '葡萄' },
  { en: 'Corn', zh: '玉米' },
  { en: 'Pepper', zh: '辣椒' },
  { en: 'Strawberry', zh: '草莓' },
  { en: 'Blueberry', zh: '蓝莓' },
  { en: 'Cherry', zh: '樱桃' },
  { en: 'Peach', zh: '桃' },
  { en: 'Orange', zh: '橙子' },
  { en: 'Raspberry', zh: '树莓' },
  { en: 'Soybean', zh: '大豆' },
  { en: 'Squash', zh: '南瓜' },
];

// 植物的头像 emoji 候选（花园卡片用，轻量、跨端一致）
export const PLANT_EMOJIS = ['🌱', '🍅', '🍎', '🥔', '🍇', '🌽', '🌶️', '🍓', '🫐', '🍒', '🍑', '🍊', '🪴', '🌿'];

// 作物 → 默认头像（识别结果一键加入花园时自动配）
export const CROP_EMOJI = {
  Tomato: '🍅', Apple: '🍎', Potato: '🥔', Grape: '🍇', Corn: '🌽',
  Pepper: '🌶️', Strawberry: '🍓', Blueberry: '🫐', Cherry: '🍒',
  Peach: '🍑', Orange: '🍊', Raspberry: '🫐', Soybean: '🫘', Squash: '🎃',
};

export function cropEmoji(en) {
  return CROP_EMOJI[en] || '🌱';
}
