// 我的花园：把植物种在草坪上，而不是排成一列卡片。
//
// 位置由植物 id 决定（确定性伪随机），所以刷新、换设备回来都长在同一个地方，
// 不会每次进来重新洗牌 —— 花园要有「这是我的地」的稳定感。
// 桌面端悬停看信息、点击进档案；手机没有 hover，点一下先看信息，气泡里再进档案。
import React, { useMemo, useState } from 'react';
import {
  View, Text, Pressable, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { C } from '../lib/theme';
import { CROPS, cropEmoji } from '../lib/crops';
import { plantStatus } from '../lib/plantStatus';

const PW = 64;        // 单株占位宽
const PH = 76;        // 单株占位高
const ROW_H = 98;     // 行高
const PAD = 16;       // 草坪左右留白
const TIP_W = 200;    // 气泡宽

// 确定性伪随机：同一个 id 永远得到同一个值
function rand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function cropZh(en) {
  return CROPS.find((c) => c.en === en)?.zh || en || '未设品种';
}

export default function GardenLawn({ plants, isDesktop, onOpenPlant }) {
  const [w, setW] = useState(0);
  const [hoverId, setHoverId] = useState(null);   // 桌面端悬停
  const [activeId, setActiveId] = useState(null); // 手机端点选

  const isWeb = Platform.OS === 'web';
  // 按固定株距排，而不是把一行均分成 cols 份 —— 植物少的时候均分会散成一地芝麻。
  // 每行最多 perRow 株，整块地再居中；行内左对齐，看起来才像一畦菜。
  const spacing = isDesktop ? 112 : 86;
  const innerW = Math.max(0, w - PAD * 2);
  const perRow = Math.max(1, Math.floor(innerW / spacing) || 1);
  const rows = Math.max(1, Math.ceil(plants.length / perRow));
  const blockW = Math.min(plants.length || 1, perRow) * spacing;
  const originX = PAD + Math.max(0, (innerW - blockW) / 2);
  const lawnH = rows * ROW_H + PAD * 2;

  const laid = useMemo(() => plants.map((p, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const seed = (typeof p.id === 'number' ? p.id : i + 1) + 1;
    return {
      p,
      row,
      // 每株轻微错位，避免像仪表盘一样死板；幅度收在株距的四分之一内
      cx: originX + spacing * (col + 0.5) + (rand(seed) - 0.5) * (spacing * 0.18),
      cy: PAD + row * ROW_H + ROW_H * 0.52 + (rand(seed + 7) - 0.5) * 12,
    };
  }), [plants, perRow, originX, spacing]);

  const showId = activeId != null ? activeId : hoverId;
  const cur = laid.find((x) => x.p.id === showId) || null;
  const curStatus = cur ? plantStatus(cur.p) : null;

  // 草叶：确定性散布，两三根凑成一簇才像草（单根散着看就是划痕）。
  // 不用底图 —— 生成图的纹理缩小到这个尺寸只会糊成污渍。
  const blades = useMemo(() => {
    if (!w) return [];
    const clusters = Math.min(26, Math.max(8, Math.round((w * lawnH) / 5600)));
    const out = [];
    for (let c = 0; c < clusters; c += 1) {
      const bx = rand(c * 3.17 + 11) * w;
      const by = rand(c * 7.31 + 5) * lawnH;
      const n = 2 + Math.floor(rand(c * 4.71 + 1) * 2); // 每簇 2~3 根
      for (let k = 0; k < n; k += 1) {
        const s = c * 13.7 + k * 3.31;
        out.push({
          left: bx + (k - (n - 1) / 2) * 4.2 + (rand(s + 2) - 0.5) * 2.5,
          top: by - rand(s + 4) * 3.5,
          h: 7 + rand(s + 6) * 7,
          rot: (k - (n - 1) / 2) * 11 + (rand(s + 8) - 0.5) * 9,
          op: 0.1 + rand(s + 9) * 0.16,
        });
      }
    }
    return out;
  }, [w, lawnH]);

  let tipStyle = null;
  if (cur && innerW > 0) {
    const left = Math.max(6, Math.min(cur.cx - TIP_W / 2, w - TIP_W - 6));
    // 第一行的气泡朝下弹，否则会顶出草坪、压到标题上
    tipStyle = cur.row === 0
      ? { left, top: cur.cy + PH / 2 + 6 }
      : { left, bottom: lawnH - (cur.cy - PH / 2) + 6 };
  }

  return (
    <View
      style={[styles.lawn, { height: lawnH }]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {/* 草地：底色渐变 + 手绘草叶点缀，每行再铺一条浅色苗床做出「垄」 */}
      <View style={[StyleSheet.absoluteFill, styles.turf]} pointerEvents="none" />
      {blades.map((b, i) => (
        <View
          key={`blade-${i}`}
          pointerEvents="none"
          style={[styles.blade, {
            left: b.left,
            top: b.top,
            height: b.h,
            opacity: b.op,
            transform: [{ rotate: `${b.rot}deg` }],
          }]}
        />
      ))}
      {Array.from({ length: rows }).map((_, r) => (
        <View
          key={`bed-${r}`}
          pointerEvents="none"
          style={[styles.bed, { top: PAD + r * ROW_H + ROW_H * 0.3, height: ROW_H * 0.56 }]}
        />
      ))}

      {/* 点空白处收起气泡 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setActiveId(null)} />

      {innerW > 0 && laid.map(({ p, cx, cy }) => {
        // 草坪上按「品种」决定长相，别用随手给的 emoji —— 这样同种作物一眼能认出来
        const emoji = cropEmoji(p.crop) || p.photo_emoji || '🌱';
        const on = showId === p.id;
        return (
          <Pressable
            key={p.id}
            onHoverIn={isWeb ? () => setHoverId(p.id) : undefined}
            onHoverOut={isWeb ? () => setHoverId((h) => (h === p.id ? null : h)) : undefined}
            onPress={() => {
              if (isWeb) onOpenPlant(p.id);
              else setActiveId((a) => (a === p.id ? null : p.id));
            }}
            style={[
              styles.plant,
              { left: cx - PW / 2, top: cy - PH / 2 },
              on && styles.plantOn,
            ]}
          >
            {/* 土堆：植株看起来是从地里长出来的 */}
            <View style={[styles.soil, on && styles.soilOn]} />
            <Text style={styles.emoji}>{emoji}</Text>
            {p.last_record?.disease_label === 'diseased' ? (
              <View style={styles.warnDot} pointerEvents="none" />
            ) : null}
          </Pressable>
        );
      })}

      {/* 悬停 / 点选的信息气泡 */}
      {cur ? (
        <View style={[styles.tip, tipStyle]} pointerEvents="box-none">
          <Text style={styles.tipName} numberOfLines={1}>{cur.p.nickname}</Text>
          <View style={styles.tipRow}>
            <Text style={styles.tipCrop}>{cropZh(cur.p.crop)}</Text>
            <View style={[styles.tipBadge, { backgroundColor: curStatus.bg }]}>
              <Text style={[styles.tipBadgeText, { color: curStatus.color }]}>
                {curStatus.text}
              </Text>
            </View>
          </View>
          {cur.p.planted_date ? (
            <Text style={styles.tipLine}>种植于 {cur.p.planted_date}</Text>
          ) : null}
          {cur.p.last_record ? (
            <Text style={styles.tipLine} numberOfLines={2}>
              最近记录 {cur.p.last_record.date}
              {cur.p.last_record.disease_label === 'diseased'
                ? ` · ${cur.p.last_record.disease_name || '发现病害'}`
                : ''}
            </Text>
          ) : (
            <Text style={styles.tipLine}>还没有诊断记录</Text>
          )}
          {isWeb ? (
            <Text style={styles.tipHint}>点击可查看档案 ›</Text>
          ) : (
            <TouchableOpacity style={styles.tipBtn} onPress={() => onOpenPlant(cur.p.id)}>
              <Text style={styles.tipBtnText}>查看档案 ›</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lawn: {
    position: 'relative',
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    borderRadius: 22,
    overflow: 'visible',
    borderWidth: 1,
    borderColor: '#C2DFA4',
  },
  // 草地图自己裁圆角，lawn 不能设 overflow:hidden（会切掉气泡）
  turf: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#CFE7AF' },
  // 草叶是深绿细条 + 低透明度，在浅绿底上就是笔触，不会抢植物
  blade: {
    position: 'absolute', width: 2, borderRadius: 2,
    backgroundColor: '#4F8228',
  },
  // 每一行的浅色苗床（垄）
  bed: {
    position: 'absolute', left: 10, right: 10,
    borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.17)',
  },
  plant: {
    position: 'absolute',
    width: PW,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
  },
  plantOn: { transform: [{ scale: 1.1 }], zIndex: 5 },
  soil: {
    position: 'absolute', bottom: 2,
    width: 38, height: 12, borderRadius: 6,
    backgroundColor: '#B0895C', opacity: 0.8,
  },
  soilOn: { backgroundColor: '#9A7043', opacity: 1, width: 42 },
  emoji: { fontSize: 34, lineHeight: 42, marginBottom: 5 },
  warnDot: {
    position: 'absolute', top: 4, right: 6,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: '#EF7A6B', borderWidth: 1.5, borderColor: '#fff',
  },

  tip: {
    position: 'absolute',
    width: TIP_W,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    zIndex: 20,
    shadowColor: '#2F4A1D',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  tipName: { fontSize: 14, fontWeight: '800', color: C.text },
  tipRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 },
  tipCrop: { fontSize: 12, color: C.sub },
  tipBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1.5 },
  tipBadgeText: { fontSize: 10.5, fontWeight: '800' },
  tipLine: { fontSize: 11.5, color: C.sub, marginTop: 6, lineHeight: 16 },
  tipHint: { fontSize: 11, color: C.greenDark, marginTop: 8, fontWeight: '700' },
  tipBtn: {
    marginTop: 10, backgroundColor: C.greenTint, borderRadius: 9,
    paddingVertical: 7, alignItems: 'center',
  },
  tipBtnText: { fontSize: 12, color: C.greenDark, fontWeight: '800' },
});
