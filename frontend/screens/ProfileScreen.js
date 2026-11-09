import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Image, Modal, TextInput, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getProfile, updateProfile, listDrafts } from '../lib/api';
import { compressImage } from '../lib/compress';
import { API_URL } from '../lib/config';
import { fmtDateTime } from '../lib/time';
import SmartImage from '../components/SmartImage';
import FadeUp from '../components/FadeUp';
import TapCard from '../components/TapCard';
import { SkeletonRows } from '../components/Skeleton';
import { AVATAR_PRESETS, avatarSource, presetKey, presetSource } from '../lib/avatar';
import LoginScreen from './LoginScreen';
import PageBackground from '../components/PageBackground';
import { ComposeModal } from './CommunityScreen';
import { C } from '../lib/theme';
import { useLayout } from '../lib/responsive';
import { BUILD_STAMP } from '../lib/version';

const MASCOT = require('../assets/mascot_identify.png');
const ICON_CAM = require('../assets/icon_camera.png');
const ICON_ALB = require('../assets/icon_album.png');

// 个人资料 tab：昵称 + 关注/粉丝/获赞 + 点赞/收藏过的帖子和我的评论
// 头像旁的铅笔可编辑昵称和头像；未设置头像时默认用小鳄鱼吉祥物
export default function ProfileScreen({ user, onLogin, onLogout, onOpenPost, openDraftId, onDraftOpened }) {
  const { isDesktop } = useLayout();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [seg, setSeg] = useState('posts'); // posts | favorites | liked | comments
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState('');
  const [pickedImage, setPickedImage] = useState(null); // 本地预览 {uri}
  const [pickedPreset, setPickedPreset] = useState(null); // 选中的预置造型 key
  const [saving, setSaving] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false); // 退出登录二次确认
  const [drafts, setDrafts] = useState([]);        // 草稿箱：被下架、待重发的帖子
  const [draftEditing, setDraftEditing] = useState(null); // 正在编辑的草稿

  const load = useCallback(async () => {
    if (!user) return;
    setError('');
    try {
      // 草稿箱拉失败不影响资料本身，单独兜住
      const [prof, dr] = await Promise.all([
        getProfile(),
        listDrafts().catch(() => ({ items: [] })),
      ]);
      setData(prof);
      setDrafts(dr?.items || []);
    } catch (e) { setError(e.message); }
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  // 从消息通知点「去草稿箱修改」进来：切到草稿分段，并直接打开这条草稿的编辑页
  useEffect(() => {
    if (!openDraftId) return;
    setSeg('drafts');
    const d = drafts.find((x) => x.id === openDraftId);
    if (d) {
      setDraftEditing(d);
      onDraftOpened && onDraftOpened();
    }
    /* eslint-disable-next-line */
  }, [openDraftId, drafts]);

  if (!user) {
    return <LoginScreen onLogin={onLogin} />;
  }

  const u = data?.user;
  const displayName = u?.nickname || u?.username || user.username;
  // 头像是上传的照片就拼完整地址，是预置造型就返回打包好的本地图（见 lib/avatar.js）
  const avatarSrc = avatarSource(u?.avatar_url);

  // 弹层里的预览：刚上传的照片 > 刚选的造型 > 现有的头像 > 默认吉祥物
  const previewSrc = pickedImage
    ? { uri: pickedImage.uri }
    : pickedPreset
      ? presetSource(pickedPreset)
      : (avatarSrc || MASCOT);

  function openEdit() {
    setNick(u?.nickname || '');
    setPickedImage(null);
    // 当前头像本来就是某个预置造型的话，打开弹层时它就显示成选中态
    setPickedPreset(presetKey(u?.avatar_url));
    setEditing(true);
  }

  // 点同一个造型再点一次就取消选中，方便已经选过的人反悔
  function togglePreset(key) {
    setPickedImage(null);
    setPickedPreset((cur) => (cur === key ? null : key));
  }

  async function pickAvatar(source) {
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
    setPickedPreset(null); // 换成自己的照片，造型的选中态就撤掉
    try {
      const comp = await compressImage(asset.uri, asset.width, asset.height);
      setPickedImage(comp);
    } catch { /* 压缩失败就用原图 */ setPickedImage({ uri: asset.uri }); }
  }

  async function save() {
    if (saving) return;
    const name = nick.trim();
    // 昵称没填、也没挑新头像 —— 那就是什么都没改，直接关掉，
    // 别让后端返回「没有要更新的内容」把人吓一跳
    if (!name && !pickedImage && !pickedPreset) { setEditing(false); return; }
    setSaving(true);
    setError('');
    try {
      await updateProfile({
        nickname: name || undefined,
        image: pickedImage || undefined,
        preset: pickedPreset || undefined,
      });
      setEditing(false);
      await load();
    } catch (e) { setError(e.message || '保存失败，请重试'); }
    finally { setSaving(false); }
  }

  const lists = {
    posts: { label: '帖子', empty: '还没有发过帖子，去发现页发第一帖吧', items: data?.posts || [] },
    drafts: { label: '草稿', empty: '草稿箱是空的。帖子被管理员下架后会放到这里，改好就能重新发布', items: drafts },
    favorites: { label: '收藏', empty: '还没有收藏过帖子', items: data?.favorited_posts || [] },
    liked: { label: '点赞', empty: '还没有点赞过帖子', items: data?.liked_posts || [] },
    comments: { label: '评论', empty: '还没有发过评论', items: data?.comments || [] },
  };

  return (
    <View style={styles.root}>
      <PageBackground variant="soft" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 头像 + 昵称（铅笔进入编辑） */}
        <View style={styles.profileHead}>
          <TouchableOpacity style={styles.avatarWrap} onPress={openEdit}>
            <SmartImage
              source={avatarSrc}
              style={styles.avatarImg}
              fallback={<View style={styles.avatar}><Image source={MASCOT} style={styles.avatarMascot} /></View>}
            />
            <View style={styles.pencilBadge}><Text style={styles.pencilText}>✏️</Text></View>
          </TouchableOpacity>
          <Text style={styles.username}>{displayName}</Text>
          <Text style={styles.sub}>好好照顾每一株植物 🌱</Text>
        </View>

        {/* 统计：关注 / 粉丝 / 获赞 */}
        <View style={statsStyles.row}>
          <Stat label="关注" value={u?.following} />
          <Stat label="粉丝" value={u?.followers} />
          <Stat label="获赞" value={u?.likes_received} />
          <Stat label="帖子" value={u?.post_count} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* 编辑资料弹窗 */}
        <Modal visible={editing} animationType="slide" onRequestClose={() => setEditing(false)}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>编辑资料</Text>
            <Text style={styles.modalHint}>头像和昵称以后随时都能改</Text>

            <View style={styles.avatarBlock}>
              <Image source={previewSrc} style={styles.modalAvatar} />

              <Text style={styles.presetTitle}>挑一个 Avo 形象</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.presetRow}
              >
                {AVATAR_PRESETS.map((p) => {
                  const on = !pickedImage && pickedPreset === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.presetCell, on && styles.presetCellOn]}
                      onPress={() => togglePreset(p.key)}
                      activeOpacity={0.75}
                    >
                      <Image source={p.source} style={styles.presetImg} resizeMode="contain" />
                      {on ? (
                        <View style={styles.presetCheck}>
                          <Text style={styles.presetCheckText}>✓</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.pickRow}>
                <TouchableOpacity style={styles.pickBtn} onPress={() => pickAvatar('camera')}>
                  <Image source={ICON_CAM} style={styles.btnIcon} />
                  <Text style={styles.pickBtnText}>拍照</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickBtn, styles.pickBtnAlt]} onPress={() => pickAvatar('library')}>
                  <Image source={ICON_ALB} style={[styles.btnIcon, { tintColor: C.greenDark }]} />
                  <Text style={styles.pickBtnAltText}>相册</Text>
                </TouchableOpacity>
              </View>
              {pickedImage ? (
                <Text style={styles.pickedTip}>已用自己的照片，保存后生效</Text>
              ) : pickedPreset ? (
                <Text style={styles.pickedTip}>
                  已换成「{AVATAR_PRESETS.find((x) => x.key === pickedPreset)?.label}」造型，保存后生效
                </Text>
              ) : null}
            </View>

            <Text style={styles.label}>昵称</Text>
            <TextInput
              style={styles.input}
              placeholder={displayName}
              placeholderTextColor={C.gray}
              value={nick}
              onChangeText={setNick}
              maxLength={20}
            />

            {error ? <Text style={styles.modalError}>{error}</Text> : null}
            <TouchableOpacity style={[styles.saveBtn, saving && styles.disabled]} onPress={save} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.saveText}>保存</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </Modal>

        {/* 分段：收藏 / 点赞 / 评论 */}
        <View style={styles.segRow}>
          {Object.entries(lists).map(([key, v]) => (
            <TouchableOpacity
              key={key}
              style={[styles.seg, seg === key && styles.segOn]}
              onPress={() => setSeg(key)}
            >
              <Text style={[styles.segText, seg === key && styles.segTextOn]}>
                {v.label}{key === 'drafts' && drafts.length ? ` ${drafts.length}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {!data ? (
          // 加载中：不要先闪一句"还没有发过帖子"；加载失败时也别一直转圈
          error
            ? <Text style={styles.empty}>加载失败，切换一下标签页再回来重试</Text>
            : <SkeletonRows rows={3} />
        ) : lists[seg].items.length === 0 ? (
          <Text style={styles.empty}>{lists[seg].empty}</Text>
        ) : seg === 'drafts' ? (
          // 草稿箱：被管理员下架的帖子，改好重新发布会回到发现页
          lists[seg].items.map((item, i) => {
            const cover = item.images?.[0]
              ? (item.images[0].startsWith('http') ? item.images[0] : `${API_URL}${item.images[0]}`)
              : null;
            return (
              <FadeUp key={item.id} index={i}>
              <View style={styles.draftCard}>
                <View style={{ flexDirection: 'row' }}>
                  <SmartImage
                    uri={cover}
                    style={styles.draftCover}
                    fallback={(
                      <View style={[styles.draftCover, styles.draftCoverEmpty]}>
                        <Text style={{ fontSize: 22 }}>{item.image_emoji || '🌿'}</Text>
                      </View>
                    )}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.draftTitle} numberOfLines={2}>
                      {item.title || item.body || '无标题'}
                    </Text>
                    <Text style={styles.draftReason} numberOfLines={2}>
                      下架原因：{item.takedown_reason || '管理员未填写'}
                    </Text>
                    <Text style={styles.itemTime}>{fmtDateTime(item.created_at)}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.draftEditBtn}
                  activeOpacity={0.85}
                  onPress={() => setDraftEditing(item)}
                >
                  <Text style={styles.draftEditText}>重新编辑并发布</Text>
                </TouchableOpacity>
              </View>
              </FadeUp>
            );
          })
        ) : seg === 'comments' ? (
          // 评论：保持列表样式，点整行跳到原帖
          lists[seg].items.map((item, i) => (
            <FadeUp key={item.id} index={i}>
              <TouchableOpacity
                style={styles.itemCard}
                activeOpacity={0.8}
                onPress={() => onOpenPost && onOpenPost(item.post_id)}
              >
                <Text style={styles.itemTitle}>{item.post_title}</Text>
                <Text style={styles.itemBody}>{item.body}</Text>
                <Text style={styles.itemTime}>
                  {fmtDateTime(item.created_at)} · 查看原帖 ›
                </Text>
              </TouchableOpacity>
            </FadeUp>
          ))
        ) : (
          // 收藏 / 点赞：瀑布流，手机上双列、PC 上三列；点封面或标题都进原帖
          <View style={styles.waterfall}>
            {(() => {
              const n = isDesktop ? 3 : 2;
              const cols = Array.from({ length: n }, () => []);
              lists[seg].items.forEach((it, i) => cols[i % n].push(it));
              return cols.map((col, ci) => (
                <View key={ci} style={styles.waterCol}>
                  {col.map((item, i) => (
                    <PostTile key={item.id} post={item} index={i} onPress={() => onOpenPost && onOpenPost(item.id)} />
                  ))}
                </View>
              ));
            })()}
          </View>
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={() => setConfirmLogout(true)}>
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>

        {/* 版本号：用来判断当前页是不是最新构建 */}
        <Text style={styles.version}>版本 {BUILD_STAMP}</Text>
      </ScrollView>

      {/* 编辑被下架的草稿：改完点「重新发布」就回到发现页 */}
      <ComposeModal
        visible={!!draftEditing}
        initial={draftEditing}
        nickname={displayName}
        onClose={() => setDraftEditing(null)}
        onDone={async () => { setDraftEditing(null); setSeg('posts'); await load(); }}
      />

      {/* 退出登录二次确认（网页端 Alert 多按钮不可用，用自定义弹层） */}
      {confirmLogout ? (
        <View style={styles.confirmMask}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>退出登录？</Text>
            <Text style={styles.confirmBody}>
              退出后需要重新输入账号和密码，才能查看花园和帖子。
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmLogout(false)}>
                <Text style={styles.confirmCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmDanger}
                onPress={() => { setConfirmLogout(false); onLogout && onLogout(); }}
              >
                <Text style={styles.confirmDangerText}>退出登录</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// 瀑布流卡片：有图显示封面（按原图比例限幅），无图用 emoji 底色块
function PostTile({ post, onPress, index = 0 }) {
  const [aspect, setAspect] = useState(0);
  const coverUri = post.images?.[0] ? `${API_URL}${post.images[0]}` : null;
  const ratio = aspect ? Math.min(Math.max(aspect, 0.65), 1.5) : 1.2;
  return (
    <FadeUp index={index}>
    <TapCard style={styles.tile} onPress={onPress}>
      <SmartImage
        uri={coverUri}
        style={[styles.tileCover, { aspectRatio: ratio }]}
        onLoad={(e) => {
          const s = e?.nativeEvent?.source;
          if (s?.width && s?.height) setAspect(s.width / s.height);
        }}
        fallback={(
          <View style={[styles.tileCover, styles.tileCoverEmpty]}>
            <Text style={styles.tileEmoji}>{post.image_emoji || '🌿'}</Text>
          </View>
        )}
      />
      {!!post.images?.length && post.images.length > 1 ? (
        <View style={styles.tileCount}><Text style={styles.tileCountText}>🖼 {post.images.length}</Text></View>
      ) : null}
      {!post.is_public ? <View style={[styles.tileCount, { left: 8, right: 'auto' }]}><Text style={styles.tileCountText}>🔒 仅自己</Text></View> : null}
      <View style={styles.tileBody}>
        <Text style={styles.tileTitle} numberOfLines={2}>{post.title || post.body || '无标题'}</Text>
        <View style={styles.tileFoot}>
          <Text style={styles.tileAuthor} numberOfLines={1}>{post.nickname || '园友'}</Text>
          <Text style={styles.tileLike}>♡ {post.likes ?? 0}</Text>
        </View>
      </View>
    </TapCard>
    </FadeUp>
  );
}

function Stat({ label, value }) {
  return (
    <View style={statsStyles.cell}>
      <Text style={statsStyles.value}>{value ?? '—'}</Text>
      <Text style={statsStyles.label}>{label}</Text>
    </View>
  );
}

const statsStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16,
    marginHorizontal: 16, paddingVertical: 14, marginBottom: 14,
  },
  cell: { flex: 1, alignItems: 'center' },
  value: { fontSize: 19, fontWeight: '900', color: '#1F3D10' },
  label: { fontSize: 12, color: C.sub, marginTop: 2 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 90 },
  profileHead: { alignItems: 'center', marginVertical: 18 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#E3EDD8',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarMascot: { width: 84, height: 84 },
  avatarImg: { width: 84, height: 84, borderRadius: 42 },
  pencilBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pencilText: { fontSize: 13 },
  username: { fontSize: 24, fontWeight: '900', color: '#1F3D10', marginTop: 10 },
  sub: { fontSize: 12, color: C.sub, marginTop: 3 },
  error: { color: C.red, fontSize: 13, marginBottom: 8, textAlign: 'center' },
  modal: { flex: 1, backgroundColor: C.bg, padding: 20, paddingTop: 60 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 6 },
  modalHint: { fontSize: 12, color: C.sub },
  modalAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#E3EDD8' },
  // 预置形象：六款吉祥物圆缩略图，选中的换成绿描边 + 右下角小勾
  avatarBlock: { alignItems: 'center', marginVertical: 14 },
  presetTitle: { fontSize: 12, color: C.sub, marginTop: 14, marginBottom: 9 },
  presetRow: { gap: 10, paddingVertical: 2, flexGrow: 1, justifyContent: 'center' },
  presetCell: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#F1F6EA',
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  presetCellOn: { borderWidth: 2.5, borderColor: C.green, backgroundColor: '#fff' },
  presetImg: { width: 40, height: 40 },
  presetCheck: {
    position: 'absolute', right: -3, bottom: -3,
    width: 16, height: 16, borderRadius: 8, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#fff',
  },
  presetCheckText: { color: '#fff', fontSize: 9, fontWeight: '900', lineHeight: 12 },
  pickRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.green, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 18,
  },
  btnIcon: { width: 17, height: 13, marginRight: 6 },
  pickBtnAlt: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  pickBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pickBtnAltText: { color: C.text },
  pickedTip: { fontSize: 12, color: C.greenDark, marginTop: 10 },
  label: { fontSize: 13, fontWeight: '700', color: C.text, marginTop: 8, marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.text,
  },
  saveBtn: {
    marginTop: 22, backgroundColor: '#2F5413', borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  modalError: { color: C.red, fontSize: 13, marginTop: 16, textAlign: 'center' },
  disabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  cancelBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  cancelText: { color: C.sub, fontSize: 14 },
  segRow: {
    flexDirection: 'row', backgroundColor: '#E9F1DC', borderRadius: 14,
    padding: 4, marginBottom: 12,
  },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center' },
  segOn: { backgroundColor: '#fff' },
  segText: { fontSize: 13, color: C.sub, fontWeight: '600' },
  segTextOn: { color: '#1F3D10', fontWeight: '800' },
  empty: { color: C.sub, textAlign: 'center', marginTop: 26, fontSize: 14 },
  itemCard: { backgroundColor: '#fff', borderRadius: 14, padding: 13, marginBottom: 10 },
  itemEmoji: { fontSize: 22, marginRight: 10 },
  itemTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  itemBody: { fontSize: 13, color: '#4B5B41', marginTop: 5, lineHeight: 19 },
  itemTime: { fontSize: 11, color: C.sub, marginTop: 6 },
  // 草稿箱卡片
  draftCard: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 10 },
  draftCover: { width: 64, height: 64, borderRadius: 10 },
  draftCoverEmpty: { backgroundColor: '#E9F1DC', alignItems: 'center', justifyContent: 'center' },
  draftTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  draftReason: { fontSize: 12, color: '#C2410C', marginTop: 4, lineHeight: 17 },
  draftEditBtn: {
    marginTop: 10, backgroundColor: '#EAF3DF', borderRadius: 10,
    paddingVertical: 9, alignItems: 'center',
  },
  draftEditText: { color: '#2F5413', fontSize: 13, fontWeight: '800' },
  itemLike: { fontSize: 12, color: C.sub },

  // 双列瀑布流（收藏 / 点赞）
  waterfall: { flexDirection: 'row', gap: 10 },
  waterCol: { flex: 1, gap: 10 },
  tile: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  tileCover: { width: '100%', backgroundColor: '#E9F0E1' },
  tileCoverEmpty: { height: 118, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 44 },
  tileCount: {
    position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
  },
  tileCountText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  tileBody: { padding: 9, paddingTop: 7 },
  tileTitle: { fontSize: 13, fontWeight: '700', color: C.text, lineHeight: 18 },
  tileFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  tileAuthor: { flex: 1, fontSize: 11, color: C.sub },
  tileLike: { fontSize: 11, color: C.sub },
  logoutBtn: {
    marginTop: 18, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff',
  },
  logoutText: { color: C.sub, fontSize: 14 },
  version: { textAlign: 'center', color: C.gray, fontSize: 11, marginTop: 18, marginBottom: 8 },
  // 退出登录二次确认（absolute 覆盖整页，避开网页端 Modal 叠层问题）
  confirmMask: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28,
  },
  confirmCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 18, padding: 20 },
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
});
