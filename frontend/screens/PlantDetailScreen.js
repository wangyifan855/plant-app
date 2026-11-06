import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet, ActivityIndicator, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getGardenPlant, deletePlant, uploadPlantPhoto } from '../lib/api';
import { compressImage } from '../lib/compress';
import { API_URL } from '../lib/config';
import { CROPS } from '../lib/crops';
import { C } from '../lib/theme';
import { useLayout } from '../lib/responsive';

const CAM_ICON = require('../assets/fab_camera.png');

function cropZh(en) {
  return CROPS.find((c) => c.en === en)?.zh || en || '未设品种';
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  try {
    return Math.floor((Date.now() - new Date(dateStr + 'T00:00:00')) / 86400000);
  } catch { return null; }
}

// 花园植物详情：照片 + 健康趋势 + 历史诊断 + 拍照提醒 + 照养指南
export default function PlantDetailScreen({ plantId, onClose, onOpenTrack, onGoIdentify, onChanged, onStartTrack }) {
  const { isDesktop } = useLayout();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [startingTrack, setStartingTrack] = useState(false);
  const [openRec, setOpenRec] = useState(null); // 点开的历史诊断记录（看照片+详情）
  const [uploading, setUploading] = useState(false);
  // 确认弹层：'delete' 删除植物 / 'avatar' 换头像来源。
  // 不用 Alert.alert —— 网页端 RN 的 Alert 不认多按钮，点了没反应。
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setData(await getGardenPlant(plantId)); }
    catch (e) { setError(e.message); }
  }, [plantId]);

  useEffect(() => { if (plantId) load(); /* eslint-disable-next-line */ }, [plantId]);

  async function doRemove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deletePlant(plantId);
      setConfirm(null);
      onChanged && onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  }

  function changeAvatar() {
    setConfirm('avatar');
  }

  async function pickAndUpload(source) {
    if (uploading) return;
    const opts = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    setUploading(true);
    setError('');
    try {
      const comp = await compressImage(asset.uri, asset.width, asset.height);
      await uploadPlantPhoto(plantId, comp);
      await load();
      onChanged && onChanged();
    } catch (e) { setError(e.message || '上传失败，请重试'); }
    finally { setUploading(false); }
  }

  const plant = data?.plant;
  const records = data?.records || [];
  const last = records[0]; // 倒序，最新在前
  const gap = last ? daysSince(last.date) : null;
  const needPhoto = gap == null || gap >= 7;
  // photo_url 是后端相对路径（/files/uploads/...），拼成绝对地址给 Image 用
  const photoUri = plant?.photo_url
    ? (plant.photo_url.startsWith('http') ? plant.photo_url : `${API_URL}${plant.photo_url}`)
    : null;

  return (
    <Modal visible={!!plantId} animationType="slide" onRequestClose={onClose}>
      {/* 外层铺页面底色：PC 上限宽后两侧的留白才不会露出 Modal 的白底 */}
      <View style={styles.pageBg}>
      <View style={[styles.root, isDesktop && styles.rootPc]}>
        <View style={styles.head}>
          <TouchableOpacity onPress={onClose}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
          <Text style={styles.headTitle}>植物档案</Text>
          <TouchableOpacity onPress={() => setConfirm('delete')}><Text style={styles.delText}>删除</Text></TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!data && !error ? <ActivityIndicator style={{ marginTop: 60 }} color={C.green} /> : null}

        {data && plant ? (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* 头像 + 基本信息（点头像可换真实照片） */}
            <View style={styles.hero}>
              <TouchableOpacity style={styles.avatarWrap} onPress={changeAvatar} activeOpacity={0.8}>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatar}><Text style={{ fontSize: 52 }}>{plant.photo_emoji || '🌱'}</Text></View>
                )}
                <Image source={CAM_ICON} style={styles.camBadge} />
              </TouchableOpacity>
              <Text style={styles.name}>{plant.nickname}</Text>
              <Text style={styles.avatarHint}>{uploading ? '正在上传头像…' : '点头像可以换成真实照片'}</Text>
              <Text style={styles.meta}>
                {cropZh(plant.crop)}
                {plant.planted_date ? ` · 种植于 ${plant.planted_date}` : ''}
                {plant.notes ? `\n${plant.notes}` : ''}
              </Text>
              {plant.track_id ? (
                <TouchableOpacity
                  style={styles.trackBtn}
                  onPress={() => {
                    // 先关掉自身弹层再开追踪：网页端两个 Modal 同时开时后挂载的会盖住先挂载的，追踪层会被压在下面
                    onClose && onClose();
                    onOpenTrack && onOpenTrack(plant.track_id, plant.id); // 带上 plant.id，追踪关掉好回到档案
                  }}
                >
                  <Text style={styles.trackBtnText}>📈 查看健康曲线（追踪）</Text>
                </TouchableOpacity>
              ) : (
                // 还没建档追踪：一键创建（后端自动用植物的昵称和品种，不用手填）
                <TouchableOpacity
                  style={styles.trackBtn}
                  disabled={startingTrack}
                  onPress={async () => {
                    setStartingTrack(true);
                    try {
                      await (onStartTrack && onStartTrack(plant));
                    } finally {
                      setStartingTrack(false);
                    }
                  }}
                >
                  <Text style={styles.trackBtnText}>{startingTrack ? '正在创建追踪…' : '📈 开始健康追踪'}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* 健康状态 + 拍照提醒 */}
            <View style={[styles.statusCard, last?.disease_label === 'diseased' && styles.statusWarn]}>
              <Text style={styles.statusTitle}>
                {last
                  ? (last.disease_label === 'diseased'
                    ? `当前状态：需关注 · ${last.disease_name || '发现病害'}`
                    : last.disease_label === 'healthy' ? '当前状态：健康' : `当前状态：${last.disease_label}`)
                  : '还没有诊断记录'}
              </Text>
              <Text style={styles.statusText}>{data.verdict_explanation}</Text>
              {needPhoto ? (
                <Text style={styles.remind}>
                  {gap == null ? '建议现在拍一张，建立第一份记录 📷' : `距上次拍照已 ${gap} 天，建议再次拍照记录`}
                </Text>
              ) : (
                <Text style={styles.remindOk}>上次记录 {last.date}（{gap} 天前），状态良好</Text>
              )}
              <TouchableOpacity style={styles.photoBtn} onPress={() => onGoIdentify && onGoIdentify(plant)}>
                <Text style={styles.photoBtnText}>📷 现在去拍照记录</Text>
              </TouchableOpacity>
            </View>

            {/* 历史诊断记录（结合追踪日期） */}
            <Text style={styles.sectionTitle}>历史诊断记录（{records.length}）</Text>
            {records.length === 0 ? (
              <Text style={styles.emptyLine}>还没有记录，拍第一张吧</Text>
            ) : (
              records.map((r) => {
                const bad = r.disease_label === 'diseased';
                return (
                  <TouchableOpacity key={r.id} style={styles.recRow} onPress={() => setOpenRec(r)} activeOpacity={0.7}>
                    <View style={[styles.recDot, { backgroundColor: bad ? '#F59331' : r.disease_label === 'healthy' ? '#6FB83F' : C.gray }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recName}>
                        {r.disease_label === 'healthy' ? '植株健康' : (r.disease_name || r.disease_label)}
                        {r.disease_confidence != null ? ` · ${(r.disease_confidence * 100).toFixed(0)}%` : ''}
                      </Text>
                      {r.note ? <Text style={styles.recNote}>{r.note}</Text> : null}
                    </View>
                    <Text style={styles.recDate}>{r.date}</Text>
                  </TouchableOpacity>
                );
              })
            )}

            {/* 照养指南 */}
            <Text style={styles.sectionTitle}>照养指南 · {cropZh(plant.crop)}</Text>
            <View style={styles.careCard}>
              <Text style={styles.careHead}>生活习性</Text>
              <Text style={styles.careBody}>{data.care?.habit}</Text>
              <Text style={[styles.careHead, { marginTop: 12 }]}>照养技巧</Text>
              {(data.care?.tips || []).map((t, i) => (
                <Text key={i} style={styles.tipLine}>· {t}</Text>
              ))}
            </View>
          </ScrollView>
        ) : null}

        {/* 确认弹层：删除植物 / 换头像来源 */}
        {confirm ? (
          <View style={styles.confirmMask}>
            <View style={styles.confirmCard}>
              {confirm === 'delete' ? (
                <>
                  <Text style={styles.confirmTitle}>删除「{plant?.nickname || '这株植物'}」？</Text>
                  <Text style={styles.confirmBody}>
                    档案、健康追踪和历次记录都会一起删掉，删了没法恢复。
                  </Text>
                  <View style={styles.confirmRow}>
                    <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirm(null)}>
                      <Text style={styles.confirmCancelText}>取消</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.confirmDanger, deleting && { opacity: 0.6 }]}
                      onPress={doRemove}
                      disabled={deleting}
                    >
                      {deleting
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={styles.confirmDangerText}>确认删除</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.confirmTitle}>更换照片</Text>
                  <Text style={styles.confirmBody}>给植物拍一张，或从相册里选一张</Text>
                  <TouchableOpacity
                    style={styles.sheetBtn}
                    onPress={() => { setConfirm(null); pickAndUpload('camera'); }}
                  >
                    <Text style={styles.sheetBtnText}>📷 拍照</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.sheetBtn}
                    onPress={() => { setConfirm(null); pickAndUpload('library'); }}
                  >
                    <Text style={styles.sheetBtnText}>🖼 从相册选</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sheetCancel} onPress={() => setConfirm(null)}>
                    <Text style={styles.confirmCancelText}>取消</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ) : null}

        {/* 历史诊断记录详情：照片 + 诊断信息 */}
        {openRec ? (
          <View style={styles.confirmMask}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{openRec.date} 诊断详情</Text>
              {openRec.image_url ? (
                <Image
                  source={{ uri: openRec.image_url.startsWith('http') ? openRec.image_url : `${API_URL}${openRec.image_url}` }}
                  style={styles.recPhoto}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.recPhoto, styles.recPhotoEmpty]}>
                  <Text style={{ fontSize: 40 }}>🌿</Text>
                  <Text style={{ color: C.gray, fontSize: 12, marginTop: 6 }}>这条记录没有留档照片</Text>
                </View>
              )}
              <Text style={styles.confirmBody}>
                诊断：{openRec.disease_label === 'healthy' ? '植株健康' : (openRec.disease_name || openRec.disease_label)}
                {openRec.disease_confidence != null ? ` · 置信度 ${(openRec.disease_confidence * 100).toFixed(0)}%` : ''}
              </Text>
              {openRec.note ? <Text style={styles.confirmBody}>备注：{openRec.note}</Text> : null}
              <TouchableOpacity style={styles.trackBtn} onPress={() => setOpenRec(null)}>
                <Text style={styles.trackBtnText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pageBg: { flex: 1, backgroundColor: C.bg },
  root: { flex: 1, backgroundColor: C.bg },
  // PC 上限宽居中，植物档案不铺满整个屏幕
  rootPc: {
    width: '100%', maxWidth: 820, alignSelf: 'center',
    borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#E8F0DF',
  },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#E4EDDA',
  },
  back: { color: C.sub, fontSize: 15, width: 70 },
  headTitle: { fontSize: 16, fontWeight: '800', color: C.text },
  delText: { color: C.red, fontSize: 13, width: 70, textAlign: 'right' },
  // 确认弹层（覆盖在档案之上，不用嵌套 Modal，避开网页端叠层问题）
  confirmMask: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28,
  },
  confirmCard: {
    width: '100%', backgroundColor: '#fff', borderRadius: 18, padding: 20,
  },
  confirmTitle: { fontSize: 16, fontWeight: '800', color: C.text, textAlign: 'center' },
  confirmBody: { fontSize: 13, color: C.sub, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  confirmRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  confirmCancel: {
    flex: 1, backgroundColor: '#F1F3EE', borderRadius: 12,
    paddingVertical: 12, alignItems: 'center',
  },
  confirmCancelText: { color: C.text, fontSize: 14, fontWeight: '700' },
  confirmDanger: {
    flex: 1, backgroundColor: '#C2410C', borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  confirmDangerText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  sheetBtn: {
    backgroundColor: '#F1F3EE', borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', marginTop: 10,
  },
  sheetBtnText: { color: C.text, fontSize: 14, fontWeight: '700' },
  sheetCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  error: { color: C.red, fontSize: 13, padding: 16 },
  body: { padding: 16, paddingBottom: 50 },
  hero: { alignItems: 'center', marginBottom: 16 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 108, height: 108, borderRadius: 24, backgroundColor: '#E3EDD8',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 108, height: 108, borderRadius: 24 },
  camBadge: {
    position: 'absolute', right: -6, bottom: -6, width: 34, height: 34,
  },
  avatarHint: { fontSize: 11, color: C.sub, marginTop: 4 },
  name: { fontSize: 20, fontWeight: '900', color: '#1F3D10', marginTop: 10 },
  meta: { fontSize: 12, color: C.sub, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  trackBtn: {
    marginTop: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
  },
  trackBtnText: { color: C.greenDark, fontSize: 13, fontWeight: '700' },
  statusCard: { backgroundColor: '#E9F1DC', borderRadius: 16, padding: 14, marginBottom: 16 },
  statusWarn: { backgroundColor: '#FDEBDD' },
  statusTitle: { fontSize: 15, fontWeight: '800', color: '#1F3D10' },
  statusText: { fontSize: 12, color: '#5A6B4E', marginTop: 6, lineHeight: 18 },
  remind: { fontSize: 13, color: '#C2410C', marginTop: 8, fontWeight: '600' },
  remindOk: { fontSize: 13, color: '#1E7B34', marginTop: 8, fontWeight: '600' },
  photoBtn: {
    marginTop: 10, backgroundColor: '#2F5413', borderRadius: 12,
    paddingVertical: 10, alignItems: 'center',
  },
  photoBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1F3D10', marginBottom: 8 },
  emptyLine: { color: C.sub, fontSize: 13, marginBottom: 14 },
  recRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 11, marginBottom: 8,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  recPhoto: { width: '100%', aspectRatio: 1.25, borderRadius: 12, marginBottom: 12, backgroundColor: '#E9F1DC' },
  recPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  recName: { fontSize: 13, fontWeight: '600', color: C.text },
  recNote: { fontSize: 11, color: C.sub, marginTop: 2 },
  recDate: { fontSize: 11, color: C.sub, marginLeft: 8 },
  careCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 30 },
  careHead: { fontSize: 14, fontWeight: '800', color: C.greenDark },
  careBody: { fontSize: 13, lineHeight: 20, color: C.text, marginTop: 4 },
  tipLine: { fontSize: 13, lineHeight: 20, color: C.text, marginTop: 4 },
});
