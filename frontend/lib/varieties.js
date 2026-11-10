import data from '../assets/varieties.json';

// 品种数据与后端 config/varieties.json 同源（打包时内置快照，后端更新需同步此文件）。
// role=rootstock 的条目是嫁接专用砧木（不参与病害识别），其余是 14 种可识别作物。
export const VARIETY_ENTRIES = data.varieties;

export const VARIETIES = VARIETY_ENTRIES.map((v) => v.name);

export function getVarietyNames() {
  return VARIETIES;
}

// 栽培品种（可当接穗、可被识别）：不含砧木
export function getCropVarietyNames() {
  return VARIETY_ENTRIES.filter((v) => v.role !== 'rootstock').map((v) => v.name);
}

// 按名字取品种条目（含 rootstocks 推荐砧木、note 等）
export function getVarietyMeta(name) {
  return VARIETY_ENTRIES.find((v) => v.name === name) || null;
}

// 砧木在界面上的显示后缀，避免和食用品种混淆
export function rootstockLabel(name) {
  const meta = getVarietyMeta(name);
  return meta && meta.role === 'rootstock' ? `${name}·砧` : name;
}

// 同科跨属组合的趣味知识卡：这些组合兼容性中等，但生产上真能接，有记忆点
export const COMBO_NOTES = {
  '番茄×马铃薯': '同科异属经典组合：接穗结番茄，地下块茎照常长土豆，一株两收。嫁接位要高过土面，防止接穗生根绕过砧木。',
  '番茄×托鲁巴姆': '抗病换根的标准组合：托鲁巴姆根系抗青枯病、线虫，接穗产量与品质不受影响，重茬地的首选方案。',
};
