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
import { CROPS, cropPlant, cropLook, UNKNOWN_PLANT } from '../lib/crops';
import { plantStatus } from '../lib/plantStatus';

const GARDEN_BG = require('../assets/garden_bg.jpg');
const BG_AR = 1399 / 800;   // 背景图 高/宽
const SKY_RATIO = 0.285;    // 草坡从图高的这个位置开始，植物只种在它下面
const GRASS = '#BFD264';    // 图底部的草色，植物多了往下接色

const PAD = 14;             // 左右留白
const TIP_W = 236;          // 气泡宽：要塞下缩略图 + 一段外观描述
const TIP_EST_H = 200;      // 气泡大致高度（缩略图 + 两行描述 + 两行档案），用于判方向
const CHUNK = 7;            // 一块地最多 7 株
const GROUP_GAP = 26;       // 两块地之间留的空
const FAB_SPACE = 90;       // 右下角悬浮「+」占的高度，植物别种到那儿去
const MAX_PER_ROW = 2;      // 一行最多几株 —— 植物要够大，一行放 3 个就只能各占 120px

// 每行几个：金字塔式堆叠，上窄下宽
const LAYOUTS = {
  1: [1],
  2: [1, 1],      // 这两株会错开成「一左上、一右下」
  3: [1, 2],
  4: [2, 2],
  5: [1, 2, 2],
  6: [2, 2, 2],
  7: [1, 2, 2, 2],
};

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

  // 背景图按容器宽度等比显示
  const imgH = w * BG_AR;
  const skyH = imgH * SKY_RATIO;
  // 宽屏上按比例算出来的图很高（520 宽 → 900 多高），一屏只看得到天空。
  // 所以桌面端把图片往上顶，只留一小条天空，让草地尽快进画面。
  const skyTop = isDesktop ? Math.min(skyH, 130) : skyH;
  const bgOffset = skyH - skyTop;
  // 株距按「一行最多 2 株」来分：每格 = 可用宽度 / 2，植物占格子的八成，
  // 剩下两成当间隙。之前一行放 3 个，每株只能 120px 宽，怎么调都显小。
  const slotW = Math.max(1, (w - PAD * 2) / MAX_PER_ROW);
  const spacing = slotW;
  // 桌面端要额外限高：网页缩放到 1.33 倍后一屏的 CSS 高度只有 677，
  // 按比例算出来的 207 会把第二排顶出视口。手机上没这个问题。
  const plantH = isDesktop ? Math.min(slotW * 0.84, 130) : slotW * 0.84;
  const rowH = plantH * 1.24;

  // 植物按「金字塔」摆：行数由上到下逐行加宽，每行水平居中。
  // 1 居中 / 2 错开 / 3 = 1+2 / 4 = 1+2+1 / 5 = 2+3 / 6 = 1+2+3 / 7 = 2+3+2。
  // 超过 7 株就再起一块地，用同一套规则，不破坏节奏。
  const { laid, lawnH } = useMemo(() => {
    if (!w) return { laid: [], lawnH: imgH || 1 };

    const chunks = [];
    for (let i = 0; i < plants.length; i += CHUNK) chunks.push(plants.slice(i, i + CHUNK));
    const rowCounts = chunks.map((c) => LAYOUTS[c.length] || [3, 3, 1]);

    // 先算总高，好在草地里垂直居中（只放得下一行时别贴着草坡边缘）
    const blockH = rowCounts.reduce((s, r) => s + r.length * rowH, 0)
      + Math.max(0, chunks.length - 1) * GROUP_GAP;
    // 底部要给悬浮「+」按钮让地方，不然最下面一排会被它压住
    const usableH = imgH - bgOffset - skyTop - FAB_SPACE;
    // 桌面端贴顶往下排（天空已经只剩一条，再居中会把下面顶出去）；手机端在草地里居中
    const startY = isDesktop
      ? skyTop + 10
      : (blockH <= usableH - PAD * 2 ? skyTop + (usableH - blockH) / 2 : skyTop);

    const centerX = w / 2;
    const out = [];
    let baseTop = startY;

    chunks.forEach((chunk, gi) => {
      const counts = rowCounts[gi];
      let k = 0;
      counts.forEach((count, row) => {
        const rowSpan = (count - 1) * spacing;
        for (let c = 0; c < count; c += 1) {
          const p = chunk[k];
          const seed = (typeof p.id === 'number' ? p.id : gi * CHUNK + k + 1) + 1;
          // 不在 14 种里的用通用幼苗顶上，别让花园里冒出个 emoji
          const plant = cropPlant(p.crop) || UNKNOWN_PLANT;
          const ratio = plant.ratio;

          // 先按统一高度算宽，太宽的（草莓那种趴地植物）改用宽度约束、自然变矮。
          // 上限收在株距的 0.84，保证左右还留着空隙
          let ph = plantH;
          let pw = ph * ratio;
          const maxW = spacing * 0.92;
          if (pw > maxW) { pw = maxW; ph = pw / ratio; }

          // 只有两株时上下错开，做成「一左上、一右下」，不然会竖着叠成一条线
          const x = chunk.length === 2
            ? centerX + (row === 0 ? -0.45 : 0.45) * spacing
            : centerX - rowSpan / 2 + c * spacing;

          out.push({
            p,
            plant,
            row,
            w: pw,
            h: ph,
            cx: x + (rand(seed) - 0.5) * (spacing * 0.12),
            // 底部基线对齐：不同高度的植物扎根在同一条线上
            baseY: baseTop + row * rowH + rowH * 0.92,
          });
          k += 1;
        }
      });
      baseTop += counts.length * rowH + GROUP_GAP;
    });

    // 手机端至少一整屏草坡；桌面端图片被上顶过，按植物实际需要的高度来
    const floor = isDesktop ? 560 : imgH;
    return { laid: out, lawnH: Math.max(floor, startY + blockH + PAD * 2) };
  }, [plants, w, imgH, bgOffset, skyTop, isDesktop, spacing, plantH, rowH]);

  const showId = activeId != null ? activeId : hoverId;
  const cur = laid.find((x) => x.p.id === showId) || null;
  const curStatus = cur ? plantStatus(cur.p) : null;

  let tipStyle = null;
  if (cur && w > 0) {
    // 靠边时别贴着草坪边缘，留一圈呼吸；草坪太窄时按可用空间退让
    const edge = Math.max(6, Math.min(14, (w - TIP_W) / 2));
    const left = Math.max(edge, Math.min(cur.cx - TIP_W / 2, w - TIP_W - edge));
    const downTop = cur.baseY + 6;
    const upTop = cur.baseY - cur.h - 6 - TIP_EST_H;
    // 第一行的气泡朝下弹（上面是天空，弹上去会顶出画面），其余朝上；
    // 无论朝哪边，最后都夹回草坪范围内，别让卡片露到外面去。
    const fitsDown = downTop + TIP_EST_H <= lawnH - 4;
    const fitsUp = upTop >= 4;
    const useDown = cur.row === 0 ? fitsDown : !fitsUp;
    tipStyle = {
      left,
      top: useDown
        ? Math.min(downTop, Math.max(4, lawnH - TIP_EST_H - 4))
        : Math.max(4, upTop),
    };
  }

  return (
    <View
      style={[styles.stage, { height: lawnH, maxWidth: isDesktop ? 520 : 900 }]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {/* 草坡背景：天空 + 草地，植物只种在草坡那一段 */}
      {/* 草坡背景：天空 + 草地，植物只种在草坡那一段。
          桌面端图片会被往上顶一截（bgOffset），所以外面套一层裁剪容器。 */}
      <View style={[styles.bgWrap, { height: lawnH }]}>
        <Image
          source={GARDEN_BG}
          style={{ width: '100%', height: imgH, marginTop: -bgOffset }}
          resizeMode="cover"
        />
      </View>

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
              // 桌面端点植物直接进档案（说明已在 hover 里看过）；
              // 手机 / 平板没有 hover，先弹气泡看说明，气泡里再进档案。
              if (isDesktop) onOpenPlant(p.id);
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

      {/* 悬停 / 点选的信息气泡：缩略图 + 昵称 + 品种 + 一句外观说明 + 档案信息 */}
      {cur ? (
        <View style={[styles.tip, tipStyle]} pointerEvents="box-none">
          <View style={styles.tipHead}>
            <View style={styles.tipThumb}>
              <Image source={cur.plant.img} style={styles.tipThumbImg} resizeMode="contain" />
            </View>
            <View style={styles.tipHeadText}>
              <Text style={styles.tipName} numberOfLines={1}>{cur.p.nickname}</Text>
              <View style={styles.tipRow}>
                <Text style={styles.tipCrop}>{cropZh(cur.p.crop)}</Text>
                <View style={[styles.tipBadge, { backgroundColor: curStatus.bg }]}>
                  <Text style={[styles.tipBadgeText, { color: curStatus.color }]}>
                    {curStatus.text}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <Text style={styles.tipLook} numberOfLines={3}>
            {cropLook(cur.p.crop) || '还没选定品种的小苗，先在这片地里长着。'}
          </Text>

          <View style={styles.tipDivider} />

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
          {isDesktop ? (
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
  // 背景裁剪层：圆角 + overflow:hidden，桌面端靠它把图片上方裁掉一截
  bgWrap: {
    position: 'absolute', top: 0, left: 0, right: 0,
    borderRadius: 22, overflow: 'hidden',
    // 植物多到超出图片高度时，底部露出的就是这层草色
    backgroundColor: GRASS,
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
  tipHead: { flexDirection: 'row', alignItems: 'center' },
  // 缩略图垫一层浅绿，插图本身是透明底的，没底会飘
  tipThumb: {
    width: 44, height: 44, borderRadius: 11,
    backgroundColor: '#EAF3DC', alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  tipThumbImg: { width: 34, height: 34 },
  tipHeadText: { flex: 1, minWidth: 0 },
  tipName: { fontSize: 14, fontWeight: '800', color: C.text },
  tipRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  tipCrop: { fontSize: 12, color: C.sub },
  tipBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1.5 },
  tipBadgeText: { fontSize: 10.5, fontWeight: '800' },
  // 外观描述：比档案信息稍深一点，读起来像「介绍」而不是「备注」
  tipLook: { fontSize: 12, color: '#5B6B4C', marginTop: 9, lineHeight: 18 },
  tipDivider: { height: 1, backgroundColor: '#EFF3E8', marginTop: 9, marginBottom: 2 },
  tipLine: { fontSize: 11.5, color: C.sub, marginTop: 5, lineHeight: 16 },
  tipHint: { fontSize: 11, color: C.greenDark, marginTop: 8, fontWeight: '700' },
  tipBtn: {
    marginTop: 10, backgroundColor: C.greenTint, borderRadius: 9,
    paddingVertical: 7, alignItems: 'center',
  },
  tipBtnText: { fontSize: 12, color: C.greenDark, fontWeight: '800' },
});
