// 受支持的 14 种作物（与 backend/app/predict.py 的 _CROPS 单源一致）。
// 花园植物「品种」选择器与识别结果作物共用此列表。
// look 是给花园悬停气泡用的一句「长什么样」，口语、只讲外观，别写成百科。
export const CROPS = [
  { en: 'Tomato', zh: '番茄', look: '藤蔓草本，带锯齿的深绿复叶，一串串圆果由青转红。' },
  { en: 'Apple', zh: '苹果', look: '落叶小乔木，卵形绿叶配白花，圆果把枝头压得往下垂。' },
  { en: 'Potato', zh: '马铃薯', look: '矮小的草本，羽状复叶贴着地铺开，能吃的那部分埋在土里。' },
  { en: 'Grape', zh: '葡萄', look: '攀在棚架上的藤本，巴掌大的掌状叶，一串串小圆果垂下来。' },
  { en: 'Corn', zh: '玉米', look: '高秆直立，长条叶片往外甩，顶上抽穗、腰间挂一根棒子。' },
  { en: 'Pepper', zh: '辣椒', look: '分枝小灌木，尖卵形的叶子，细长的果子朝下垂着。' },
  { en: 'Strawberry', zh: '草莓', look: '贴地匍匐，三出复叶低低铺开，红果子坠在叶下面。' },
  { en: 'Blueberry', zh: '蓝莓', look: '矮丛灌木，椭圆小叶，蓝紫色小果成簇挂在枝上。' },
  { en: 'Cherry', zh: '樱桃', look: '小乔木，细锯齿叶，红亮的小圆果两根长柄结一对。' },
  { en: 'Peach', zh: '桃', look: '小乔木，细长披针叶，圆果一侧带条沟、表面有层绒毛。' },
  { en: 'Orange', zh: '橙子', look: '常绿小乔木，厚实油亮的椭圆叶，橙黄的圆果压弯枝条。' },
  { en: 'Raspberry', zh: '树莓', look: '直立带刺的灌木，复叶，红果由许多小核果聚成一颗。' },
  { en: 'Soybean', zh: '大豆', look: '矮秆草本，三出复叶，毛豆荚一串串垂在叶腋里。' },
  { en: 'Squash', zh: '南瓜', look: '贴地爬的藤，大掌状叶铺满一片，橙黄大果躺在藤边上。' },
];

// 品种的外观描述；查不到返回空串，调用方自己兜底
export function cropLook(en) {
  return CROPS.find((c) => c.en === en)?.look || '';
}

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

// 通用幼苗：不在 14 种里、或者没选品种的植物用这张，
// 总比在花园里杵一个 emoji 强（emoji 和这批插画不是一个画风）。
export const UNKNOWN_PLANT = {
  img: require('../assets/plants/unknown.png'),
  ratio: 200 / 260,
};
