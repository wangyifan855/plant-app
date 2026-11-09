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

// 草坪上「种下去」用的植物插画（scripts/cut_plants.py 抠好的透明图）。
// ratio = 宽/高，渲染时按高度算宽度，省得每张图都去量。
export const CROP_PLANT = {
  Tomato: { img: require('../assets/plants/tomato.png'), ratio: 0.847 },
  Apple: { img: require('../assets/plants/apple.png'), ratio: 0.956 },
  Potato: { img: require('../assets/plants/potato.png'), ratio: 1.028 },
  Grape: { img: require('../assets/plants/grape.png'), ratio: 0.55 },
  Corn: { img: require('../assets/plants/corn.png'), ratio: 0.497 },
  Pepper: { img: require('../assets/plants/pepper.png'), ratio: 0.872 },
  Strawberry: { img: require('../assets/plants/strawberry.png'), ratio: 1.423 },
  Blueberry: { img: require('../assets/plants/blueberry.png'), ratio: 0.938 },
  Cherry: { img: require('../assets/plants/cherry.png'), ratio: 0.959 },
  Peach: { img: require('../assets/plants/peach.png'), ratio: 0.956 },
  Orange: { img: require('../assets/plants/orange.png'), ratio: 0.956 },
  Raspberry: { img: require('../assets/plants/raspberry.png'), ratio: 0.894 },
  Soybean: { img: require('../assets/plants/soybean.png'), ratio: 0.8 },
  Squash: { img: require('../assets/plants/squash.png'), ratio: 0.766 },
};

// 拿不到插画（比如用户填了不在 14 种里的作物）时返回 null，调用方回退到 emoji
export function cropPlant(en) {
  return CROP_PLANT[en] || null;
}
