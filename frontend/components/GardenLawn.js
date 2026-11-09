// 我的花园：一片草坡，植物按品种种在上面。
//
// 位置由植物 id 决定（确定性伪随机），所以刷新、换设备回来都长在同一个地方，
// 不会每次进来重新洗牌 —— 花园要有「这是我的地」的稳定感。
// 桌面端悬停看信息、点击进档案；手机没有 hover，点一下先看信息，气泡里再进档案。
import React, { useMemo, useState } from 'react';
import {
  View, Text, Image, Pressable, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { C } from '../lib/theme';
import { CROPS, cropPlant, UNKNOWN_PLANT } from '../lib/crops';
import { plantStatus } from '../lib/plantStatus';

const GARDEN_BG = require('../assets/garden_bg.jpg');
const BG_AR = 1399 / 800;   // 背景图 高/宽
const SKY_RATIO = 0.285;    // 草坡从图高的这个位置开始，植物只种在它下面
const GRASS = '#BFD264';    // 图底部的草色，植物多了往下接色

const PAD = 14;             // 左右留白
const TIP_W = 200;          // 气泡宽

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

  // 背景图按容器宽度等比显示；株距按固定值排，一行能放几株算几株，
  // 整块地居中、行内左对齐，看起来才像一畦菜而不是仪表盘。
  const imgH = w * BG_AR;
  const sky = imgH * SKY_RATIO;
  const spacing = isDesktop ? 140 : 100;
  const plantH = isDesktop ? 120 : 96;
  const rowH = plantH + 26;

  const innerW = Math.max(0, w - PAD * 2);
  const perRow = Math.max(1, Math.floor(innerW / spacing) || 1);
  const rows = Math.max(1, Math.ceil(plants.length / perRow));
  const blockW = Math.min(plants.length || 1, perRow) * spacing;
  const originX = PAD + Math.max(0, (innerW - blockW) / 2);

  // 舞台至少一屏草坡那么高；植物多了往下长，底部用草色接上
  const lawnH = Math.max(imgH, sky + rows * rowH + PAD * 2);

  const laid = useMemo(() => plants.map((p, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const seed = (typeof p.id === 'number' ? p.id : i + 1) + 1;
    // 不在 14 种里的（比如 demo 的「窗台薄荷」）用通用幼苗顶上，别让花园里冒出个 emoji
    const plant = cropPlant(p.crop) || UNKNOWN_PLANT;
    const ratio = plant.ratio;

    // 先按统一高度算宽，太宽的（草莓那种趴地植物）改用宽度约束、自然变矮
    let ph = plantH;
    let pw = ph * ratio;
    const maxW = spacing * 0.94;
    if (pw > maxW) { pw = maxW; ph = pw / ratio; }

    return {
      p,
      plant,
      row,
      w: pw,
      h: ph,
      cx: originX + spacing * (col + 0.5) + (rand(seed) - 0.5) * (spacing * 0.16),
      // 底部基线对齐：不同高度的植物扎根在同一条线上
      baseY: sky + row * rowH + rowH * 0.92,
    };
  }), [plants, perRow, originX, spacing, sky, plantH, rowH]);

  const showId = activeId != null ? activeId : hoverId;
  const cur = laid.find((x) => x.p.id === showId) || null;
  const curStatus = cur ? plantStatus(cur.p) : null;

  let tipStyle = null;
  if (cur && w > 0) {
    const left = Math.max(6, Math.min(cur.cx - TIP_W / 2, w - TIP_W - 6));
    // 第一行的气泡朝下弹，否则会顶到天空外面
    tipStyle = cur.row === 0
      ? { left, top: cur.baseY + 6 }
      : { left, bottom: lawnH - (cur.baseY - cur.h) + 6 };
  }

  return (
    <View
      style={[styles.stage, { height: lawnH, maxWidth: isDesktop ? 620 : 900 }]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {/* 草坡背景：天空 + 草地，植物只种在草坡那一段 */}
      <Image source={GARDEN_BG} style={[styles.bg, { height: imgH }]} resizeMode="cover" />
      {lawnH > imgH ? <View style={[styles.grassMore, { top: imgH - 2 }]} /> : null}

      {/* 点空白处收起气泡 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setActiveId(null)} />

      {w > 0 && laid.map(({ p, plant, cx, baseY, w: pw, h: ph }) => {
        const st = plantStatus(p);
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
              { left: cx - pw / 2, top: baseY - ph, width: pw, height: ph },
              on && styles.plantOn,
            ]}
          >
            <Image source={plant.img} style={{ width: pw, height: ph }} resizeMode="contain" />
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
  stage: {
    position: 'relative',
    width: '100%',
    alignSelf: 'center',
    overflow: 'visible',
  },
  bg: {
    position: 'absolute', top: 0, left: 0, right: 0,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
  },
  // 植物比一屏草坡还多时，底部用图里的草色接上去
  grassMore: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: GRASS,
    borderBottomLeftRadius: 22, borderBottomRightRadius: 22,
  },
  plant: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  plantOn: { transform: [{ scale: 1.06 }], zIndex: 5 },
  warnDot: {
    position: 'absolute', top: 2, right: 2,
    width: 10, height: 10, borderRadius: 5,
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
    shadowOpacity: 0.18,
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
