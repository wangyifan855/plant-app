import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView, Modal,
  ActivityIndicator, StyleSheet, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { compressImage, isLowQuality } from '../lib/compress';
import { identify, recentDiagnoses, getDiagnosis, addPlant } from '../lib/api';
import { CROPS, cropEmoji } from '../lib/crops';
import { FAQ, FAQ_MAIN } from '../lib/faq';
import { API_URL } from '../lib/config';
import { fmtDateTime, fmtMonthDay } from '../lib/time';
import { C } from '../lib/theme';

const MASCOT = require('../assets/mascot_identify.png');

function cropZh(en) {
  return CROPS.find((c) => c.en === en)?.zh || en || '';
}

// 最近诊断行的状态徽章（对齐参考图：需关注 / 异常 / 健康）
function diagBadge(d) {
  if (d.disease_label === 'healthy') return { text: '健康', color: '#1E7B34', bg: '#E2F5E5' };
  if (d.disease_label === 'diseased' && d.low_confidence) return { text: '需关注', color: '#B45309', bg: '#FBF3D9' };
  if (d.disease_label === 'diseased') return { text: '异常', color: '#C2410C', bg: '#FDEBDD' };
  return { text: '观察中', color: '#8A6D1A', bg: '#FBF3D9' };
}

// 打字机气泡：segments = [{ text, style }]，逐字输出，加粗/样式保留
function TypewriterBubble({ segments, style, speed = 55 }) {
  const total = segments.reduce((n, s) => n + s.text.length, 0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= total) return undefined;
    const t = setTimeout(() => setCount((c) => Math.min(c + 1, total)), speed);
    return () => clearTimeout(t);
  }, [count, total, speed]);
  let left = count;
  const parts = [];
  for (let i = 0; i < segments.length && left > 0; i++) {
    const take = Math.min(left, segments[i].text.length);
    parts.push(<Text key={i} style={segments[i].style}>{segments[i].text.slice(0, take)}</Text>);
    left -= take;
  }
  const done = count >= total;
  return (
    <Text style={style}>
      {parts}
      {!done && <Text style={{ color: C.green }}>▌</Text>}
    </Text>
  );
}

// 识别 tab：单图 → 物种 + 病害 + 建议文案（task_type=plant_identify）+ 最近诊断
export default function IdentifyScreen({ user, onGoProfile, linkedPlant, onOpenPlant }) {
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [recent, setRecent] = useState([]);
  const [addedIds, setAddedIds] = useState({}); // diagnosis_id → true（本会话已加入花园）
  const [faqView, setFaqView] = useState(null); // null | 'all' | FAQ 条目
  const [diagDetail, setDiagDetail] = useState(null); // 点最近诊断 → 回看完整结果
  const [diagLoading, setDiagLoading] = useState(false);

  const loadRecent = useCallback(async () => {
    try { setRecent(await recentDiagnoses(8)); } catch { /* 静默，最近诊断失败不影响主功能 */ }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent, user?.id]);

  async function openDiagDetail(id) {
    setDiagLoading(true);
    try { setDiagDetail(await getDiagnosis(id)); }
    catch (e) { setError(e.message); }
    finally { setDiagLoading(false); }
  }

  async function addToGarden(d) {
    if (!user) { onGoProfile && onGoProfile(); return; }
    try {
      const crop = d.crop || '';
      await addPlant({
        nickname: `${cropZh(crop) || '我的植物'} · ${fmtMonthDay(d.created_at) || '新记录'}`,
        crop: crop || null,
        photoEmoji: cropEmoji(crop),
        plantedDate: null,
        notes: `来自诊断：${d.disease_name || d.disease_label || ''}`,
      });
      setAddedIds((m) => ({ ...m, [d.id]: true }));
      loadRecent();
    } catch (e) {
      setError(e.message);
    }
  }

  async function pick(source) {
    const opts = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    };
    // 浏览器里没有原生相机接口，统一走文件选择器（手机上仍走相机）
    const useCamera = source === 'camera' && Platform.OS !== 'web';
    let res;
    try {
      res = useCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    } catch (e) {
      setError('打不开相机，改用相册选一张试试');
      return;
    }
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    const comp = await compressImage(asset.uri, asset.width, asset.height);
    setImage(comp);
    setError('');
    setResult(null);
  }

  async function submit() {
    if (!image) { setError('请先拍一张或选一张图片'); return; }
    if (isLowQuality(image.width, image.height)) {
      setError('图片分辨率过低，请靠近叶片重新拍摄');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await identify('plant_identify', { image, plantId: linkedPlant?.id });
      setResult(data);
      loadRecent();
    } catch (e) {
      setError(e.message || '识别失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <ResultView
        result={result}
        image={image}
        user={user}
        linkedPlant={linkedPlant}
        onOpenPlant={onOpenPlant}
        onReset={() => { setResult(null); setImage(null); loadRecent(); }}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.mascotRow}>
        <Image source={MASCOT} style={styles.mascot} />
        <View style={styles.bubble}>
          <TypewriterBubble
            style={styles.bubbleText}
            segments={[
              { text: '我是 ' },
              { text: 'Avo', style: styles.bubbleBold },
              { text: ' 🐊，拍张叶子 snap 给我，我来认它是什么、有没有病～' },
            ]}
          />
        </View>
      </View>

      {linkedPlant ? (
        <View style={styles.linkBar}>
          <Text style={styles.linkBarText}>
            🌿 正在为「{linkedPlant.nickname}」拍照记录，结果会存进它的健康追踪
          </Text>
        </View>
      ) : null}

      <View style={styles.shotCard}>
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.preview} />
        ) : (
          <View style={styles.emptyShot}>
            <Text style={styles.emptyEmoji}>🌿</Text>
            <Text style={styles.emptyText}>拍一张正常植株或病叶</Text>
          </View>
        )}
        <View style={styles.pickRow}>
          <TouchableOpacity style={[styles.pickBtn, { backgroundColor: C.green }]} onPress={() => pick('camera')}>
            <Text style={styles.pickText}>拍照</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.pickBtn, { backgroundColor: C.yellow }]} onPress={() => pick('library')}>
            <Text style={[styles.pickText, { color: '#6B5A0E' }]}>相册</Text>
          </TouchableOpacity>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={[styles.goBtn, loading && styles.disabled]} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.goText}>开始识别</Text>}
      </TouchableOpacity>
      <Text style={styles.note}>课程原型，非生产级诊断工具，结果不构成农业建议</Text>

      {/* 最近诊断：点击可加入我的花园 */}
      <View style={styles.recentHead}>
        <Text style={styles.recentTitle}>最近诊断</Text>
        {user ? null : <Text style={styles.recentTip}>登录后可加入花园</Text>}
      </View>
      {recent.length === 0 ? (
        <Text style={styles.recentEmpty}>还没有诊断记录，识别一次就会出现这里</Text>
      ) : (
        recent.map((d) => {
          const badge = diagBadge(d);
          const added = addedIds[d.id];
          return (
            <TouchableOpacity
              key={d.id}
              style={styles.recentRow}
              onPress={() => openDiagDetail(d.id)}
              activeOpacity={0.7}
            >
              <View style={styles.recentThumb}>
                {d.image_url
                  ? <Image source={{ uri: API_URL + d.image_url }} style={styles.recentPhoto} />
                  : <Text style={{ fontSize: 22 }}>{cropEmoji(d.crop)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentName} numberOfLines={1}>
                  {d.disease_label === 'healthy' ? '植株健康' : (d.disease_name || '发现病害')}
                  {d.crop ? ` · ${cropZh(d.crop)}` : ''}
                </Text>
                <Text style={styles.recentTime}>{fmtDateTime(d.created_at)} · 点开回看 ›</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.badgeText, { color: badge.color }]}>{badge.text}</Text>
              </View>
              {added ? (
                <Text style={styles.addedText}>已加入</Text>
              ) : (
                <TouchableOpacity style={styles.addBtn} onPress={() => addToGarden(d)}>
                  <Text style={styles.addBtnText}>＋花园</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })
      )}

      {/* 常见问题快捷入口 */}
      <View style={styles.recentHead}>
        <Text style={styles.recentTitle}>常见问题快捷入口</Text>
        <TouchableOpacity onPress={() => setFaqView('all')}>
          <Text style={styles.faqAll}>全部 ›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.faqGrid}>
        {FAQ_MAIN.map((f) => (
          <TouchableOpacity key={f.key} style={styles.faqCard} activeOpacity={0.7} onPress={() => setFaqView(f)}>
            <Text style={styles.faqEmoji}>{f.emoji}</Text>
            <Text style={styles.faqTitle}>{f.title}</Text>
            <Text style={styles.faqSub}>{f.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 最近诊断回看：照片 + 完整结果（与识别结果页同款布局） */}
      <Modal visible={diagDetail != null} animationType="slide" onRequestClose={() => setDiagDetail(null)}>
        <View style={styles.faqModalRoot}>
          <View style={styles.faqModalHead}>
            <TouchableOpacity style={styles.faqBackBtn} onPress={() => setDiagDetail(null)}>
              <Text style={styles.faqBack}>‹ 返回</Text>
            </TouchableOpacity>
            <Text style={styles.faqModalTitle}>诊断详情</Text>
            <TouchableOpacity style={styles.faqCloseBtn} onPress={() => setDiagDetail(null)}>
              <Text style={styles.faqClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {diagLoading || !diagDetail ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={C.green} />
            </View>
          ) : (
            <DiagDetailBody d={diagDetail} />
          )}
        </View>
      </Modal>

      {/* 常见问题弹层：全部列表 / 单条详情 */}
      <Modal visible={faqView != null} animationType="slide" onRequestClose={() => setFaqView(null)}>
        <View style={styles.faqModalRoot}>
          <View style={styles.faqModalHead}>
            {faqView !== 'all' ? (
              <TouchableOpacity style={styles.faqBackBtn} onPress={() => setFaqView('all')}>
                <Text style={styles.faqBack}>‹ 返回</Text>
              </TouchableOpacity>
            ) : <View style={{ width: 40 }} />}
            <Text style={styles.faqModalTitle}>{faqView === 'all' ? '常见问题' : faqView?.title}</Text>
            <TouchableOpacity style={styles.faqCloseBtn} onPress={() => setFaqView(null)}>
              <Text style={styles.faqClose}>✕</Text>
            </TouchableOpacity>
          </View>

          {faqView === 'all' ? (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {FAQ.map((f) => (
                <TouchableOpacity key={f.key} style={styles.faqRow} onPress={() => setFaqView(f)}>
                  <Text style={{ fontSize: 26 }}>{f.emoji}</Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.faqRowTitle}>{f.title}</Text>
                    <Text style={styles.faqRowSub}>{f.sub}</Text>
                  </View>
                  <Text style={styles.faqChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : faqView ? (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              <View style={styles.faqHero}>
                <Text style={{ fontSize: 46 }}>{faqView.emoji}</Text>
                <Text style={styles.faqHeroTitle}>{faqView.title} · {faqView.sub}</Text>
              </View>
              <Text style={styles.faqSec}>典型症状</Text>
              <Text style={styles.faqBody}>{faqView.symptom}</Text>
              <Text style={styles.faqSec}>常见原因</Text>
              {faqView.causes.map((c, i) => <Text key={i} style={styles.faqLi}>• {c}</Text>)}
              <Text style={styles.faqSec}>处理建议</Text>
              {faqView.tips.map((t, i) => <Text key={i} style={styles.faqLi}>• {t}</Text>)}
              <TouchableOpacity
                style={styles.faqGo}
                onPress={() => { setFaqView(null); pick('camera'); }}
              >
                <Text style={styles.faqGoText}>📷 拍照让 Avo 看看</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </ScrollView>
  );
}

// 诊断详情正文：照片 + 物种/病害 + 相似疑似 + 处理建议
function DiagDetailBody({ d }) {
  const stateText = d.disease_label === 'healthy' ? '健康' : d.disease_label === 'diseased' ? '疑似病害' : '不在识别范围';
  const stateColor = d.disease_label === 'healthy' ? C.greenDark : d.disease_label === 'diseased' ? '#C2410C' : '#5F5E5A';
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {d.image_url ? (
        <Image source={{ uri: API_URL + d.image_url }} style={styles.fullPreview} />
      ) : (
        <View style={[styles.emptyShot, { height: 160 }]}>
          <Text style={{ fontSize: 40 }}>{cropEmoji(d.crop) || '🌿'}</Text>
          <Text style={styles.emptyText}>该记录没有留存照片</Text>
        </View>
      )}
      <View style={styles.resultCard}>
        <View style={styles.line}>
          <Text style={styles.k}>物种</Text>
          <Text style={styles.v}>
            {d.species_label || '未知'}
            {d.species_confidence != null ? ` · ${(d.species_confidence * 100).toFixed(0)}%` : ''}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.k}>病害</Text>
          <Text style={[styles.v, { color: stateColor }]}>
            {stateText}
            {d.disease_name ? ` · ${d.disease_name}` : ''}
            {d.disease_confidence != null ? ` · ${(d.disease_confidence * 100).toFixed(0)}%` : ''}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.k}>时间</Text>
          <Text style={styles.v}>{fmtDateTime(d.created_at)}</Text>
        </View>
        {Array.isArray(d.candidates) && d.candidates.length ? (
          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#EEE' }}>
            <Text style={styles.candTitle}>其他相似疑似</Text>
            {d.candidates.map((c, i) => (
              <Text key={i} style={styles.candLine}>
                {c.label} · {(c.confidence * 100).toFixed(0)}%
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.suggestionCard}>
        <Text style={styles.suggestTitle}>处理建议</Text>
        <Text style={styles.suggestBody}>{d.suggestion || '暂无建议文案'}</Text>
      </View>
      <Text style={styles.note}>课程原型，非生产级诊断工具，结果不构成农业建议</Text>
    </ScrollView>
  );
}

function ResultView({ result, image, user, onReset, linkedPlant, onOpenPlant }) {
  const d = result.disease;
  const stateText = d.label === 'healthy' ? '健康' : d.label === 'diseased' ? '疑似病害' : '不在识别范围';
  const stateColor = d.label === 'healthy' ? C.greenDark : d.label === 'diseased' ? '#C2410C' : '#5F5E5A';
  const [saved, setSaved] = useState(false);
  const [saveTip, setSaveTip] = useState('');
  const linked = result.linked_plant; // 后端回传：这次结果已写进哪株植物的追踪

  async function saveToGarden() {
    if (!user) { setSaveTip('请先在「个人资料」页登录'); return; }
    try {
      const crop = CROPS.find((c) => result.species.label.includes(c.zh))?.en || null;
      await addPlant({
        nickname: `${cropZh(crop) || result.species.label} · ${fmtMonthDay(new Date().toISOString())}`,
        crop,
        photoEmoji: cropEmoji(crop),
        notes: `来自诊断：${d.name || stateText}（${(d.confidence * 100).toFixed(0)}%）`,
      });
      setSaved(true);
    } catch (e) {
      setSaveTip(e.message);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {image ? <Image source={{ uri: image.uri }} style={styles.fullPreview} /> : null}

      <View style={styles.resultCard}>
        <View style={styles.line}>
          <Text style={styles.k}>物种</Text>
          <Text style={styles.v}>{result.species.label} · {(result.species.confidence * 100).toFixed(0)}%</Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.k}>病害</Text>
          <Text style={[styles.v, { color: stateColor }]}>
            {stateText}{d.name ? ` · ${d.name}` : ''}{d.confidence != null ? ` · ${(d.confidence * 100).toFixed(0)}%` : ''}
          </Text>
        </View>
        {result.candidates?.length ? (
          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#EEE' }}>
            <Text style={styles.candTitle}>其他相似疑似</Text>
            {result.candidates.map((c, i) => (
              <Text key={i} style={styles.candLine}>
                {c.label} · {(c.confidence * 100).toFixed(0)}%
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.suggestionCard}>
        <Text style={styles.suggestTitle}>处理建议</Text>
        <Text style={styles.suggestBody}>{result.suggestion}</Text>
      </View>

      {/* 关联了植物：说明已经写进它的追踪，不用再手动加花园 */}
      {linked ? (
        <View style={styles.linkedCard}>
          <Text style={styles.linkedText}>
            ✅ 已记录到「{linked.plant_name}」的健康追踪
          </Text>
          <Text style={styles.linkedSub}>回植物档案看曲线，或直接再拍一张继续记录</Text>
          {onOpenPlant ? (
            <TouchableOpacity
              style={styles.linkedBtn}
              onPress={() => onOpenPlant(linked.plant_id)}
            >
              <Text style={styles.linkedBtnText}>查看「{linked.plant_name}」的档案 ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {linked ? null : saved ? (
        <View style={styles.savedCard}>
          <Text style={styles.savedText}>🌿 已加入我的花园，去花园页查看并建立追踪</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.saveBtn} onPress={saveToGarden}>
          <Text style={styles.saveBtnText}>🪴 加入我的花园</Text>
        </TouchableOpacity>
      )}
      {saveTip ? <Text style={styles.saveTip}>{saveTip}</Text> : null}

      <TouchableOpacity style={styles.goBtn} onPress={onReset}>
        <Text style={styles.goText}>{linked ? `再给「${linked.plant_name}」拍一张` : '再拍一张'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, backgroundColor: C.bg, flexGrow: 1 },
  mascotRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 },
  mascot: { width: 76, height: 76 },
  bubble: {
    flex: 1, backgroundColor: C.greenTint, borderRadius: 14, padding: 10, paddingHorizontal: 13,
  },
  bubbleText: { color: '#44652A', fontSize: 15, lineHeight: 22 },
  bubbleBold: { fontWeight: '800', color: '#2F5413' },
  shotCard: { backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 12 },
  preview: { width: '100%', height: 220, borderRadius: 12, backgroundColor: '#eee' },
  emptyShot: { height: 220, borderRadius: 12, backgroundColor: C.greenTint, alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 44 },
  emptyText: { marginTop: 8, color: C.sub, fontSize: 14 },
  pickRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pickBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  pickText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  error: { color: '#C2410C', marginTop: 8, fontSize: 14 },
  goBtn: {
    backgroundColor: C.green, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', marginTop: 14,
  },
  disabled: { opacity: 0.6 },
  goText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  note: { color: C.sub, fontSize: 12, marginTop: 12, textAlign: 'center' },
  fullPreview: { width: '100%', height: 240, borderRadius: 16, marginBottom: 12, backgroundColor: '#eee' },
  resultCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 12 },
  line: { flexDirection: 'row', paddingVertical: 6, alignItems: 'center' },
  k: { width: 52, fontSize: 14, fontWeight: '700', color: C.sub },
  v: { flex: 1, fontSize: 15, color: C.text, fontWeight: '600' },
  suggestionCard: { backgroundColor: C.card, borderRadius: 16, padding: 14 },
  suggestTitle: { fontSize: 15, fontWeight: '800', color: C.greenDark, marginBottom: 6 },
  suggestBody: { fontSize: 14, lineHeight: 22, color: C.text },
  candTitle: { fontSize: 13, fontWeight: '800', color: '#ef6c00', marginBottom: 4 },
  candLine: { fontSize: 13, lineHeight: 20, color: C.text },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 24, marginBottom: 10 },
  recentTitle: { fontSize: 17, fontWeight: '800', color: '#1F3D10' },
  recentTip: { fontSize: 11, color: C.sub },
  recentEmpty: { color: C.sub, fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 10, marginBottom: 8,
  },
  recentThumb: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: C.greenTint,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
    overflow: 'hidden',
  },
  recentPhoto: { width: 44, height: 44 },
  recentName: { fontSize: 14, fontWeight: '600', color: C.text },
  recentTime: { fontSize: 11, color: C.sub, marginTop: 2 },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  addBtn: {
    backgroundColor: C.greenDark, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginLeft: 8,
  },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  addedText: { color: C.sub, fontSize: 12, marginLeft: 8 },
  faqAll: { fontSize: 13, color: C.sub },
  faqGrid: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  faqCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  faqEmoji: { fontSize: 30 },
  faqTitle: { fontSize: 14, fontWeight: '700', color: C.text, marginTop: 8 },
  faqSub: { fontSize: 11, color: C.sub, marginTop: 3 },
  faqModalRoot: { flex: 1, backgroundColor: C.bg, paddingTop: 52 },
  faqModalHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E7ECE2',
  },
  faqBackBtn: { width: 40, alignItems: 'flex-start' },
  faqBack: { fontSize: 15, color: C.greenDark, fontWeight: '700' },
  faqModalTitle: { fontSize: 17, fontWeight: '800', color: '#1F3D10' },
  faqCloseBtn: { width: 40, alignItems: 'flex-end' },
  faqClose: { fontSize: 16, color: C.sub },
  faqRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  faqRowTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  faqRowSub: { fontSize: 12, color: C.sub, marginTop: 2 },
  faqChevron: { fontSize: 18, color: C.sub },
  faqHero: {
    backgroundColor: '#fff', borderRadius: 16, paddingVertical: 22,
    alignItems: 'center', marginBottom: 14,
  },
  faqHeroTitle: { fontSize: 16, fontWeight: '800', color: '#1F3D10', marginTop: 8 },
  faqSec: { fontSize: 14, fontWeight: '800', color: C.greenDark, marginTop: 14, marginBottom: 6 },
  faqBody: { fontSize: 14, lineHeight: 22, color: C.text },
  faqLi: { fontSize: 14, lineHeight: 23, color: C.text },
  faqGo: {
    backgroundColor: '#2F5413', borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginTop: 20,
  },
  faqGoText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  saveBtn: {
    backgroundColor: '#2F5413', borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginTop: 12,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  savedCard: {
    backgroundColor: '#E2F5E5', borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', marginTop: 12,
  },
  savedText: { color: '#1E7B34', fontSize: 14, fontWeight: '700' },
  saveTip: { color: '#C2410C', fontSize: 12, marginTop: 6, textAlign: 'center' },
  linkBar: {
    backgroundColor: '#E2F5E5', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 12,
  },
  linkBarText: { color: '#1E7B34', fontSize: 13, fontWeight: '600' },
  linkedCard: {
    backgroundColor: '#E2F5E5', borderRadius: 14, padding: 14, marginTop: 12,
  },
  linkedText: { color: '#1E7B34', fontSize: 14, fontWeight: '800' },
  linkedSub: { color: '#3F6B45', fontSize: 12, marginTop: 4 },
  linkedBtn: {
    backgroundColor: '#1E7B34', borderRadius: 12, paddingVertical: 11,
    alignItems: 'center', marginTop: 12,
  },
  linkedBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
