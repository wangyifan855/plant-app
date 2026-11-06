import data from '../assets/varieties.json';

// 前端下拉的品种列表，来自与后端共用的同一份数据源（config/varieties.json 的副本）。
// 注意：这是打包时内置的快照，若后端 config 更新需同步此文件。
export const VARIETIES = data.varieties.map((v) => v.name);

export function getVarietyNames() {
  return VARIETIES;
}
