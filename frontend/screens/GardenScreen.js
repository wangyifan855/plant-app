import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView, Modal, StyleSheet, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { compressImage } from '../lib/compress';
import { listGarden, addPlant, createPlantTrack, uploadPlantPhoto } from '../lib/api';
import PageBackground from '../components/PageBackground';
import PlantDetailScreen from './PlantDetailScreen';
import FadeUp from '../components/FadeUp';
import GardenLawn from '../components/GardenLawn';
import { SkeletonRows } from '../components/Skeleton';
import { CROPS } from '../lib/crops';
import { C } from '../lib/theme';
import { useLayout } from '../lib/responsive';

const MASCOT_TRACK = require('../assets/mascot_track.png');
const ICON_CAM = require('../assets/icon_camera.png');
const ICON_ALB = require('../assets/icon_album.png');

// 我的花园 tab：把植物种在一片草坪上，点开看档案 / 诊断历史 / 照养指南
export default function GardenScreen({ user, onOpenTrack, onGoIdentify, openPlantId, onPlantOpened, onGoHome }) {
  const { isDesktop } = useLayout();
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState(null);

  // 从追踪页返回时，重新打开刚才那株植物的档案
  useEffect(() => {
    if (openPlantId) {
      setDetailId(openPlantId);
      onPlantOpened && onPlantOpened();
    }
    /* eslint-disable-next-line */
  }, [openPlantId]);

  // 新增表单状态
  const [nickname, setNickname] = useState('');
  const [crop, setCrop] = useState('');
  const [photo, setPhoto] = useState(null); // { uri, width, height }
  const [planted, setPlanted] = useState('');
  const [notes, setNotes] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setPlants(await listGarden()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function openAdd() {
    setNickname(''); setCrop(''); setPhoto(null); setPlanted(''); setNotes('');
    setAdding(true);
  }

  async function pickPhoto(source) {
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
    const a = res.assets[0];
    try {
      const comp = await compressImage(a.uri, a.width, a.height);
      setPhoto(comp);
    } catch { setPhoto({ uri: a.uri, width: a.width, height: a.height }); }
  }

  async function submitAdd() {
    if (!nickname.trim()) { setError('请填写植物昵称'); return; }
    setBusy(true); setError('');
    try {
      const r = await addPlant({
        nickname: nickname.trim(),
        crop: crop || null,
        plantedDate: planted.trim() || null,
        notes: notes.trim() || null,
      });
      let photoWarn = '';
      if (photo && r?.plant_id) {
        // 建档成功但照片没传上去时给出提示，别静默吞掉（否则用户会以为上传成功了）
        try { await uploadPlantPhoto(r.plant_id, photo); }
        catch { photoWarn = '植物已建好，但照片没传上去，进档案点头像可以重试'; }
      }
      setAdding(false);
      await refresh();
      if (photoWarn) setError(photoWarn);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function makeTrack(plant) {
    if (!plant?.id) return;
    setBusy(true); setError('');
    try {
      // 后端会自动复用已有追踪 / 用植物昵称和品种新建，无需手填
      const r = await createPlantTrack(plant.id);
      await refresh();
      setDetailId(null);
      onOpenTrack && onOpenTrack(r.track_id, plant.id);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.root}>
      <PageBackground variant="green" />
      <View style={styles.header}>
        <View>
          {/* PC 上底部 tab 栏没了，给一条明确的回首页入口 */}
          {isDesktop && onGoHome ? (
            <TouchableOpacity onPress={onGoHome} style={styles.backHome}>
              <Text style={styles.backHomeText}>‹ 返回首页</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.hi}>我的花园</Text>
          <Text style={styles.user}>{user?.username} · {plants.length} 株</Text>
        </View>
        <Image source={MASCOT_TRACK} style={styles.headerMascot} resizeMode="contain" />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? <SkeletonRows rows={4} /> : null}
        {!loading && plants.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🪴</Text>
            <Text style={styles.emptyText}>这块地还空着，点右下角「+」种下第一株吧</Text>
          </View>
        ) : null}

        {!loading && plants.length > 0 ? (
          <FadeUp>
            <GardenLawn
              plants={plants}
              isDesktop={isDesktop}
              onOpenPlant={(id) => setDetailId(id)}
            />
          </FadeUp>
        ) : null}

        {!loading && plants.length > 0 ? (
          <Text style={styles.lawnTip}>
            {isDesktop
              ? '把鼠标移到植株上看它的状态，点一下进档案'
              : '点一下植株看它的状态'}
          </Text>
        ) : null}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openAdd}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <PlantDetailScreen
        plantId={detailId}
        onClose={() => { setDetailId(null); refresh(); }}
        onOpenTrack={onOpenTrack}
        onGoIdentify={(plant) => { setDetailId(null); onGoIdentify && onGoIdentify(plant); }}
        onChanged={refresh}
        onStartTrack={makeTrack}
      />

      <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>添加植物</Text>
          <Text style={styles.modalHint}>先起个名字就行，头像和昵称以后在植物档案里随时都能改 📷</Text>

          <Text style={styles.label}>昵称</Text>
          <TextInput style={styles.input} placeholder="如：阳台番茄1号" value={nickname} onChangeText={setNickname} />

          <Text style={styles.label}>品种</Text>
          <View style={styles.chipWrap}>
            {CROPS.map((c) => (
              <TouchableOpacity
                key={c.en}
                style={[styles.chip, crop === c.en && styles.chipOn]}
                onPress={() => setCrop(c.en)}
              >
                <Text style={[styles.chipText, crop === c.en && styles.chipTextOn]}>{c.zh}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>头像（拍一张 or 从相册选）</Text>
          <View style={styles.avatarRow}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.avatarPreview} />
            ) : (
              <View style={[styles.avatarPreview, styles.avatarEmpty]}>
                <Text style={styles.avatarEmptyText}>尚未设置</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={styles.avatarBtnRow}>
                <TouchableOpacity style={styles.avatarBtn} onPress={() => pickPhoto('camera')}>
                  <Image source={ICON_CAM} style={styles.btnIcon} />
                  <Text style={styles.avatarBtnText}>拍照</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.avatarBtn, styles.avatarBtnAlt]} onPress={() => pickPhoto('library')}>
                  <Image source={ICON_ALB} style={styles.btnIcon} />
                  <Text style={styles.avatarBtnText}>相册</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.avatarTip}>不选也行，以后在植物档案里随时能换</Text>
            </View>
          </View>

          <Text style={styles.label}>种植日期（可选）</Text>
          <TextInput style={styles.input} placeholder="2026-10-01" value={planted} onChangeText={setPlanted} />

          <Text style={styles.label}>备注（可选）</Text>
          <TextInput style={[styles.input, styles.notes]} placeholder="位置、品种来源…" value={notes} onChangeText={setNotes} multiline />

          <View style={styles.modalBtns}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setAdding(false)}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.okBtn} onPress={submitAdd} disabled={busy}>
              <Text style={styles.okText}>{busy ? '保存中…' : '保存'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 8 },
  backHome: { marginBottom: 6 },
  backHomeText: { fontSize: 13, color: C.sub, fontWeight: '600' },
  hi: { fontSize: 28, fontWeight: '800', color: '#1F3D10' },
  user: { fontSize: 13, color: C.sub, marginTop: 2 },
  headerMascot: { width: 68, height: 68, marginLeft: 8 },
  list: { padding: 16, paddingBottom: 90 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyEmoji: { fontSize: 56 },
  emptyText: { color: C.sub, marginTop: 12, textAlign: 'center', paddingHorizontal: 30 },
  lawnTip: { fontSize: 11.5, color: C.sub, textAlign: 'center', marginTop: 14 },
  modalHint: { fontSize: 12, color: C.sub, marginBottom: 6 },
  error: { color: C.red, fontSize: 13, paddingHorizontal: 16 },
  fab: {
    position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#2F5413', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  fabText: { color: '#fff', fontSize: 30, lineHeight: 34 },
  modal: { flex: 1, backgroundColor: C.bg, padding: 20, paddingTop: 50 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 14 },
  label: { fontSize: 13, color: C.sub, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  notes: { height: 60, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 14, color: C.text },
  chipTextOn: { color: '#fff' },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatarPreview: { width: 72, height: 72, borderRadius: 36, marginRight: 14 },
  avatarEmpty: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  avatarEmptyText: { fontSize: 11, color: C.gray },
  avatarBtnRow: { flexDirection: 'row' },
  avatarBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: '#2F5413', marginRight: 8,
  },
  btnIcon: { width: 17, height: 13, marginRight: 6 },
  avatarBtnAlt: { backgroundColor: '#5B7A3A' },
  avatarBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  avatarTip: { fontSize: 11, color: C.sub, marginTop: 6 },
  modalBtns: { flexDirection: 'row', marginTop: 24 },
  cancelBtn: { flex: 1, paddingVertical: 13, marginRight: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  cancelText: { color: C.text, fontSize: 15 },
  okBtn: { flex: 1, backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  okText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
