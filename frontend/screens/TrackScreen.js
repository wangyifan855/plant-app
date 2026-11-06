import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Modal, StyleSheet, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { compressImage, isLowQuality } from '../lib/compress';
import { identify, listTracks, getTrack, createTrack } from '../lib/api';
import { API_URL } from '../lib/config';
import { C } from '../lib/theme';

const CAM_ICON = require('../assets/fab_camera.png');
const ALBUM_ICON = require('../assets/icon_album.png');
const MASCOT_TRACK = require('../assets/mascot_track.png');

const WEEK = ['一', '二', '三', '四', '五', '六', '日']; // 周一开头

function pad(n) { return String(n).padStart(2, '0'); }
function dstr(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

// 追踪 tab：月历打卡 + 多株切换 + 拍照上传（task_type=recovery_track）
// focusTrackId：从「我的花园」点「查看追踪」跳过来时，自动选中对应追踪。
export default function TrackScreen({ focusTrackId } = {}) {
  const [tracks, setTracks] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [detail, setDetail] = useState(null);   // GET /tracks/{id}
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCrop, setNewCrop] = useState('');
  // 点开的历次记录（看照片 + 诊断详情）
  const [openRec, setOpenRec] = useState(null);
  // 日历视图年月
  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() + 1 });

  const load = useCallback(async (preferId) => {
    setLoading(true);
    setError('');
    try {
      const list = await listTracks();
      setTracks(list);
      const target = preferId
        || (list.find((t) => t.id === currentId)?.id)
        || list[0]?.id;
      setCurrentId(target || null);
      setDetail(target ? await getTrack(target) : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [currentId]);

  // 首次进入：有指定追踪就直接加载它，否则加载默认（避免先拉一次别的再切过来，白跑一趟）
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      load(focusTrackId || undefined);
    } else if (focusTrackId) {
      load(focusTrackId);
    }
    // eslint-disable-next-line
  }, [focusTrackId]);

  async function switchTrack(id) {
    setMenuOpen(false);
    setCurrentId(id);
    setLastResult(null);
    try { setDetail(await getTrack(id)); } catch (e) { setError(e.message); }
  }

  async function upload(source) {
    const opts = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, allowsEditing: true };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    if (isLowQuality(asset.width, asset.height)) {
      setError('图片分辨率过低，请靠近叶片重新拍摄');
      return;
    }
    const comp = await compressImage(asset.uri, asset.width, asset.height);
    setUploading(true);
    setError('');
    try {
      const data = await identify('recovery_track', { image: comp, trackId: currentId });
      setLastResult(data);
      setDetail(await getTrack(currentId));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function submitNewTrack() {
    if (!newName.trim()) { setError('请填写植物名称'); return; }
    try {
      const t = await createTrack(newName.trim(), newCrop.trim() || null);
      setCreating(false);
      setNewName('');
      setNewCrop('');
      await load(t.track_id);
    } catch (e) {
      setError(e.message);
    }
  }

  // 月历：records 按 date 建索引，相邻记录比较出趋势箭头
  const recByDate = useMemo(() => {
    const map = {};
    const recs = detail?.records || [];
    recs.forEach((r, i) => {
      const prev = recs[i - 1];
      let arrow = 'start';
      if (prev && r.disease_confidence != null && prev.disease_confidence != null) {
        arrow = r.disease_confidence < prev.disease_confidence ? 'up'
          : r.disease_confidence > prev.disease_confidence ? 'down' : 'flat';
      }
      map[r.date] = { ...r, arrow };
    });
    return map;
  }, [detail]);

  const grid = useMemo(() => {
    const { y, m } = view;
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7; // 周一=0
    const days = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    return cells;
  }, [view]);

  const currentTrack = tracks.find((t) => t.id === currentId);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* 顶部：株切换 */}
        <TouchableOpacity style={styles.picker} onPress={() => setMenuOpen(true)}>
          <Image source={MASCOT_TRACK} style={styles.pickerMascot} resizeMode="contain" />
          <Text style={styles.pickerText} numberOfLines={1}>
            {currentTrack ? currentTrack.name : loading ? '加载中…' : '还没有追踪，点右上角 + 新建'}
          </Text>
          <Text style={styles.pickerCaret}>▾</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!detail ? (
          <View style={styles.emptyBox}>
            <Image source={MASCOT_TRACK} style={styles.emptyMascot} resizeMode="contain" />
            <Text style={styles.emptyHint}>还没有追踪记录，点下方「＋ 新建追踪」开始记录你的植物吧</Text>
          </View>
        ) : null}

        {detail ? (
          <>
            {/* 状态卡 */}
            <View style={styles.statusCard}>
              <Text style={styles.verdict}>{detail.verdict}</Text>
              <Text style={styles.verdictExplain}>{detail.explanation}</Text>
            </View>

            {/* 月历 */}
            <View style={styles.calCard}>
              <View style={styles.calHead}>
                <TouchableOpacity onPress={() => stepMonth(-1)}><Text style={styles.calArrow}>‹</Text></TouchableOpacity>
                <Text style={styles.calTitle}>{view.y} 年 {view.m} 月</Text>
                <TouchableOpacity onPress={() => stepMonth(1)}><Text style={styles.calArrow}>›</Text></TouchableOpacity>
              </View>
              <View style={styles.weekRow}>
                {WEEK.map((w) => <Text key={w} style={styles.weekCell}>{w}</Text>)}
              </View>
              <View style={styles.grid}>
                {grid.map((d, i) => {
                  if (d == null) return <View key={`e${i}`} style={styles.day} />;
                  const iso = dstr(view.y, view.m, d);
                  const rec = recByDate[iso];
                  const isToday = iso === dstr(today.getFullYear(), today.getMonth() + 1, today.getDate());
                  return (
                    <View key={iso} style={[styles.day, isToday && styles.today]}>
                      <Text style={styles.dayNum}>{d}</Text>
                      {rec ? (
                        <Text style={[
                          styles.mark,
                          rec.arrow === 'up' && { color: C.greenDark },
                          rec.arrow === 'down' && { color: '#C2410C' },
                          rec.arrow === 'flat' && { color: '#5F5E5A' },
                        ]}>
                          {rec.arrow === 'up' ? '↑' : rec.arrow === 'down' ? '↓' : rec.arrow === 'flat' ? '—' : '·'}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              <View style={styles.legend}>
                <Text style={styles.legendItem}><Text style={{ color: C.greenDark }}>↑</Text> 好转</Text>
                <Text style={styles.legendItem}><Text style={{ color: '#C2410C' }}>↓</Text> 恶化</Text>
                <Text style={styles.legendItem}><Text style={{ color: '#5F5E5A' }}>—</Text> 持平</Text>
                <Text style={styles.legendItem}>◻ 今天</Text>
              </View>
            </View>

            {/* 历次记录：点开看照片和诊断详情 */}
            <Text style={styles.h2}>历次记录</Text>
            {(detail.records || []).slice().reverse().map((r) => {
              const rec = recByDate[r.date];
              return (
                <TouchableOpacity key={r.id} style={styles.recCard} onPress={() => setOpenRec(r)} activeOpacity={0.7}>
                  {r.image_url ? (
                    <Image
                      source={{ uri: r.image_url.startsWith('http') ? r.image_url : `${API_URL}${r.image_url}` }}
                      style={styles.recThumb}
                    />
                  ) : (
                    <View style={[styles.recThumb, styles.recThumbEmpty]}><Text style={styles.recThumbEmoji}>🌿</Text></View>
                  )}
                  <View style={styles.recMain}>
                    <Text style={styles.recDate}>{r.date}</Text>
                    <Text style={styles.recBody} numberOfLines={1}>
                      {r.disease_name || (r.disease_label === 'healthy' ? '健康' : r.disease_label === 'diseased' ? '病害' : '未知')} · 置信度 {r.disease_confidence != null ? `${(r.disease_confidence * 100).toFixed(0)}%` : '—'}
                    </Text>
                  </View>
                  <Text style={[
                    styles.recArrow,
                    rec?.arrow === 'up' && { color: C.greenDark },
                    rec?.arrow === 'down' && { color: '#C2410C' },
                  ]}>
                    {rec?.arrow === 'up' ? '↑' : rec?.arrow === 'down' ? '↓' : '·'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      {/* ＋ 上传悬浮按钮 */}
      {currentId ? (
        <View style={styles.fabCol}>
          <TouchableOpacity style={[styles.fab, uploading && styles.disabled]} onPress={() => upload('camera')} disabled={uploading}>
            {uploading
              ? <Text style={styles.fabText}>…</Text>
              : <Image source={CAM_ICON} style={styles.fabIcon} />}
          </TouchableOpacity>
          <TouchableOpacity style={styles.fabSmall} onPress={() => upload('library')}>
            <Image source={ALBUM_ICON} style={styles.fabSmallIcon} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 新建追踪入口：从植物档案/待办跳进来（focusTrackId）时不显示，
          避免用户再手填一遍名称/品种、造出重复追踪；想建独立追踪从底部 tab 进来 */}
      {!focusTrackId ? (
        <TouchableOpacity style={styles.addTrackBtn} onPress={() => setCreating(true)}>
          <Text style={styles.addTrackText}>＋ 新建追踪</Text>
        </TouchableOpacity>
      ) : null}

      {/* 株切换下拉 */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.mask} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            {tracks.map((t) => (
              <TouchableOpacity key={t.id} style={styles.menuItem} onPress={() => switchTrack(t.id)}>
                <Text style={[styles.menuText, t.id === currentId && styles.menuOn]} numberOfLines={1}>
                  {t.id === currentId ? '✓ ' : ''}{t.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 新建追踪弹层 */}
      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        <View style={styles.mask}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>新建追踪</Text>
            <TextInput style={styles.input} placeholder="植物名称（如 番茄 · 1号盆）" value={newName} onChangeText={setNewName} />
            <TextInput style={styles.input} placeholder="作物（可选，如 番茄）" value={newCrop} onChangeText={setNewCrop} />
            <View style={styles.dialogRow}>
              <TouchableOpacity style={styles.dialogCancel} onPress={() => setCreating(false)}>
                <Text style={styles.dialogCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogOk} onPress={submitNewTrack}>
                <Text style={styles.dialogOkText}>创建</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 历次记录详情：照片 + 诊断信息 */}
      <Modal visible={!!openRec} transparent animationType="fade" onRequestClose={() => setOpenRec(null)}>
        <View style={styles.mask}>
          {openRec ? (
            <View style={styles.dialog}>
              <Text style={styles.dialogTitle}>{openRec.date} 记录详情</Text>
              {openRec.image_url ? (
                <Image
                  source={{ uri: openRec.image_url.startsWith('http') ? openRec.image_url : `${API_URL}${openRec.image_url}` }}
                  style={styles.recPhoto}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.recPhoto, styles.recThumbEmpty]}>
                  <Text style={{ fontSize: 44 }}>🌿</Text>
                  <Text style={{ color: C.gray, fontSize: 12, marginTop: 6 }}>这条记录没有留档照片</Text>
                </View>
              )}
              <Text style={styles.recBody}>
                识别：{openRec.species_label || '—'}
              </Text>
              <Text style={styles.recBody}>
                诊断：{openRec.disease_name || (openRec.disease_label === 'healthy' ? '健康' : openRec.disease_label === 'diseased' ? '病害' : '未知')}
                {openRec.disease_confidence != null ? ` · 置信度 ${(openRec.disease_confidence * 100).toFixed(0)}%` : ''}
              </Text>
              {openRec.note ? <Text style={styles.recBody}>备注：{openRec.note}</Text> : null}
              <TouchableOpacity style={styles.dialogOk} onPress={() => setOpenRec(null)}>
                <Text style={styles.dialogOkText}>关闭</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* 本次上传结果 */}
      <Modal visible={!!lastResult} transparent animationType="slide" onRequestClose={() => setLastResult(null)}>
        <View style={styles.mask}>
          {lastResult ? (
            <View style={styles.dialog}>
              <Text style={styles.dialogTitle}>本次识别</Text>
              <Text style={styles.recBody}>
                {lastResult.current.species.label} ·{' '}
                {lastResult.current.disease.label === 'healthy' ? '健康'
                  : lastResult.current.disease.label === 'diseased'
                    ? `疑似 ${lastResult.current.disease.name || '病害'}`
                    : '不在识别范围'}
                {lastResult.current.disease.confidence != null
                  ? ` · ${(lastResult.current.disease.confidence * 100).toFixed(0)}%` : ''}
              </Text>
              <Text style={styles.verdictSmall}>{lastResult.verdict}</Text>
              <Text style={styles.explain}>{lastResult.explanation}</Text>
              <TouchableOpacity style={styles.dialogOk} onPress={() => setLastResult(null)}>
                <Text style={styles.dialogOkText}>好的</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );

  function stepMonth(delta) {
    setView((v) => {
      let m = v.m + delta, y = v.y;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { y, m };
    });
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  container: { padding: 16, paddingBottom: 120 },
  picker: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card,
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12,
  },
  pickerText: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text },
  pickerMascot: { width: 40, height: 40, marginRight: 8 },
  pickerCaret: { color: C.sub, fontSize: 14, marginLeft: 8 },
  statusCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 12 },
  verdict: { fontSize: 18, fontWeight: '800', color: C.greenDark },
  verdictSmall: { fontSize: 16, fontWeight: '800', color: C.greenDark, marginTop: 8 },
  verdictExplain: { marginTop: 6, fontSize: 13, lineHeight: 20, color: C.text },
  calCard: { backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 12 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  calTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  calArrow: { fontSize: 22, color: C.greenDark, paddingHorizontal: 14 },
  weekRow: { flexDirection: 'row' },
  weekCell: { flex: 1, textAlign: 'center', fontSize: 11, color: C.sub },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: C.green, borderRadius: 10 },
  dayNum: { fontSize: 12, color: C.text },
  mark: { fontSize: 12, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' },
  legendItem: { fontSize: 11, color: C.sub },
  h2: { fontSize: 16, fontWeight: '800', color: C.text, marginTop: 6, marginBottom: 8 },
  recCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card,
    borderRadius: 12, padding: 10, marginBottom: 8,
  },
  recThumb: { width: 46, height: 46, borderRadius: 10, marginRight: 10, backgroundColor: '#E9F1DC' },
  recThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  recThumbEmoji: { fontSize: 22 },
  recMain: { flex: 1 },
  recDate: { fontSize: 13, fontWeight: '700', color: C.text },
  recBody: { flex: 1, fontSize: 13, color: C.text, marginTop: 2, lineHeight: 19 },
  recPhoto: { width: '100%', aspectRatio: 1.25, borderRadius: 12, marginBottom: 12, backgroundColor: '#E9F1DC' },
  recArrow: { fontSize: 16, fontWeight: '800', color: C.gray, marginLeft: 6 },
  error: { color: '#C2410C', marginBottom: 8, fontSize: 13 },
  emptyBox: { alignItems: 'center', paddingTop: 24, paddingHorizontal: 24 },
  emptyMascot: { width: 96, height: 96, marginBottom: 10 },
  emptyHint: { textAlign: 'center', color: C.sub, fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.5 },
  fabCol: { position: 'absolute', right: 16, bottom: 84, alignItems: 'center', gap: 10 },
  fab: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  fabIcon: { width: 54, height: 54 },
  fabText: { fontSize: 20 },
  fabSmall: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#2F5413', alignItems: 'center', justifyContent: 'center' },
  fabSmallIcon: { width: 20, height: 17, tintColor: '#fff' },
  addTrackBtn: {
    position: 'absolute', left: 16, bottom: 92,
    backgroundColor: C.green, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
  },
  addTrackText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  menu: { backgroundColor: '#fff', borderRadius: 14, paddingVertical: 6, width: '80%', maxWidth: 420, maxHeight: 320 },
  menuItem: { paddingVertical: 12, paddingHorizontal: 16 },
  menuText: { fontSize: 15, color: C.text },
  menuOn: { fontWeight: '800', color: C.greenDark },
  dialog: { backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '100%' },
  dialogTitle: { fontSize: 17, fontWeight: '800', color: C.text, marginBottom: 12 },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 10,
  },
  dialogRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  dialogCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#EFEFEA', alignItems: 'center' },
  dialogCancelText: { color: C.sub, fontWeight: '700' },
  dialogOk: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: C.green, alignItems: 'center' },
  dialogOkText: { color: '#fff', fontWeight: '800' },
  explain: { fontSize: 13, lineHeight: 20, color: C.text, marginTop: 4 },
});
