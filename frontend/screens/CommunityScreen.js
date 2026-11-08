import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal,
  ActivityIndicator, StyleSheet, ScrollView, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { listPosts, getPost, createPost, updatePost, deletePost, setPostVisibility, addComment, likePost, favoritePost, toggleFollow, me } from '../lib/api';
import { compressImage } from '../lib/compress';
import { API_URL } from '../lib/config';
import { fmtDateTime } from '../lib/time';
import SmartImage from '../components/SmartImage';
import PageBackground from '../components/PageBackground';
import { C } from '../lib/theme';
import { useLayout } from '../lib/responsive';

const MASCOT_COMMUNITY = require('../assets/mascot_community.png');
const ICON_CAM = require('../assets/icon_camera.png');
const ICON_ALB = require('../assets/icon_album.png');
const TAG_PRESETS = ['晒图', '求助', '病虫害', '嫁接', '浇水', '施肥', '新手', '心得'];
const MAX_POST_IMAGES = 9;

// 社区 tab：登录后发帖 + 双列瀑布流 + 详情（点赞/评论），后端端点见文档 §12
// focusPostId：从别处（个人资料页的收藏/点赞/评论）点进来时，直接打开该帖详情
export default function CommunityScreen({ focusPostId, onFocusConsumed, onGoProfile }) {
  const { isDesktop } = useLayout();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openPost, setOpenPost] = useState(null);   // 详情
  const [composing, setComposing] = useState(false); // 发帖表单
  const [editingPost, setEditingPost] = useState(null); // 编辑自己的帖子（详情页「⋯」→ 编辑内容）
  const [detailTick, setDetailTick] = useState(0);      // 编辑保存后让详情页重新拉一次
  const [meInfo, setMeInfo] = useState(null);        // 当前登录用户（未登录 null）

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPosts(await listPosts());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { me().then(setMeInfo).catch(() => setMeInfo(null)); }, []);

  // 从个人资料页点某条帖子进来：拉详情并直接打开
  useEffect(() => {
    if (!focusPostId) return;
    let alive = true;
    getPost(focusPostId)
      .then((p) => {
        if (alive && p) {
          setOpenPost(p);
          onFocusConsumed && onFocusConsumed(); // 清掉，再次点同一帖也能触发
        }
      })
      .catch(() => {});
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, [focusPostId]);

  function tryCompose() {
    if (!meInfo) { setError('发帖需要先登录'); return; }
    setError('');
    setComposing(true);
  }

  // 瀑布流：手机上双列，PC 上三列（轮流塞列，卡片高度随封面图比例自适应）
  const colCount = isDesktop ? 4 : 2;
  const cols = Array.from({ length: colCount }, () => []);
  posts.forEach((p, i) => cols[i % colCount].push(p));

  return (
    <View style={styles.root}>
      <PageBackground variant="warm" />
      <View style={styles.header}>
        <Text style={styles.h1}>发现</Text>
        <TouchableOpacity style={styles.newBtn} onPress={tryCompose}>
          <Text style={styles.newBtnText}>＋ 发帖</Text>
        </TouchableOpacity>
      </View>

      {/* 常驻吉祥物欢迎条：community 小鳄鱼 */}
      <View style={styles.welcome}>
        <Image source={MASCOT_COMMUNITY} style={styles.welcomeMascot} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.welcomeTitle}>和大家聊聊种植日常</Text>
          <Text style={styles.welcomeSub}>看看别人的月季、番茄怎么养，也发发你的心得</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <Text style={styles.error}>{error}</Text>
          {!meInfo ? (
            <TouchableOpacity onPress={() => onGoProfile && onGoProfile()}>
              <Text style={styles.errorLink}>去登录 ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
          {posts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Image source={MASCOT_COMMUNITY} style={styles.emptyMascot} resizeMode="contain" />
              <Text style={styles.empty}>还没有帖子，点右上角发第一帖吧 🌱</Text>
            </View>
          ) : (
            <View style={[styles.waterfall, isDesktop && styles.waterfallPc]}>
              {cols.map((col, ci) => (
                <View key={ci} style={styles.waterCol}>
                  {col.map((p) => <PostCard key={p.id} post={p} onPress={() => setOpenPost(p)} />)}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <PostDetail
        postId={openPost?.id}
        onClose={() => setOpenPost(null)}
        onChanged={load}
        onEdit={(p) => setEditingPost(p)}
        refreshKey={detailTick}
      />
      <ComposeModal
        visible={composing}
        onClose={() => setComposing(false)}
        onDone={() => { setComposing(false); load(); }}
        nickname={meInfo?.nickname || meInfo?.username || ''}
      />
      {/* 编辑自己的帖子（和编辑草稿共用同一个表单） */}
      <ComposeModal
        visible={!!editingPost}
        initial={editingPost}
        nickname={meInfo?.nickname || meInfo?.username || ''}
        onClose={() => setEditingPost(null)}
        onDone={() => { setEditingPost(null); setDetailTick((t) => t + 1); load(); }}
      />
    </View>
  );
}

function PostCard({ post, onPress }) {
  // 统一卡片尺寸：封面固定比例、标题固定两行高、标签行占位——每张卡一样大
  const coverUri = post.images?.[0] ? `${API_URL}${post.images[0]}` : null;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <SmartImage
        uri={coverUri}
        style={styles.coverImg}
        fallback={(
          <View style={[styles.coverImg, styles.cover, { backgroundColor: tint(post.image_emoji) }]}>
            <Text style={styles.coverEmoji}>{post.image_emoji || '🌿'}</Text>
          </View>
        )}
      />
      {!!post.images?.length && post.images.length > 1 ? (
        <View style={styles.imgCount}><Text style={styles.imgCountText}>🖼 {post.images.length}</Text></View>
      ) : null}
      {!post.is_public ? <View style={[styles.imgCount, { left: 8, right: 'auto' }]}><Text style={styles.imgCountText}>🔒 仅自己</Text></View> : null}
      <Text style={styles.cardTitle} numberOfLines={2}>{post.title}</Text>
      <View style={styles.cardTags}>
        {(post.tags || []).slice(0, 2).map((t) => (
          <Text key={t} style={styles.cardTag} numberOfLines={1}># {t}</Text>
        ))}
      </View>
      <View style={styles.cardMeta}>
        <Text style={styles.author} numberOfLines={1}>{post.nickname}</Text>
        <Text style={styles.stats}>♡ {post.likes} · 💬 {post.comment_count}</Text>
      </View>
    </TouchableOpacity>
  );
}

function tint(emoji) {
  const map = ['EAF6DF', 'FFF6D6', 'FFEAD1', 'E4F0FA'];
  const i = (emoji || '🌿').codePointAt(0) % map.length;
  return `#${map[i]}`;
}

function PostDetail({ postId, onClose, onChanged, onEdit, refreshKey = 0 }) {
  const { isDesktop } = useLayout();
  const [post, setPost] = useState(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [meId, setMeId] = useState(null);          // 当前登录用户 id（未登录为 null）
  const [following, setFollowing] = useState(false); // 是否已关注本帖作者
  const [bodyW, setBodyW] = useState(0);           // 详情正文宽度（横向图片按它定宽）
  const [menuOpen, setMenuOpen] = useState(false);  // 自己的帖子：右上角「⋯」侧边菜单
  const [confirmDel, setConfirmDel] = useState(false); // 菜单里的删除二次确认
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef(null);                  // 点评论图标滚到评论区

  const load = useCallback(async () => {
    if (!postId) return;
    setError('');
    try {
      const p = await getPost(postId);
      setPost(p);
      setFollowing(!!p.following_author);
    } catch (e) { setError(e.message); }
  }, [postId]);

  // 进入详情时取一次当前登录用户（用于决定是否显示关注按钮）
  useEffect(() => {
    if (!postId) return;
    me().then((u) => setMeId(u.id)).catch(() => setMeId(null));
  }, [postId]);

  useEffect(() => { if (postId) load(); }, [postId, load, refreshKey]);

  async function like() {
    if (meId == null) { setError('登录后才能点赞'); return; }
    try {
      await likePost(postId);
      await load();
      onChanged();
    } catch (e) { setError(e.message); }
  }

  async function fav() {
    if (meId == null) { setError('登录后才能收藏'); return; }
    try {
      await favoritePost(postId);
      await load();
      onChanged();
    } catch (e) { setError(e.message); }
  }

  async function follow() {
    if (meId == null) { setError('登录后才能关注'); return; }
    if (!post?.user_id) return;
    try {
      const r = await toggleFollow(post.user_id);
      setFollowing(!!r.following);
    } catch (e) { setError(e.message); }
  }

  async function send() {
    if (!comment.trim()) return;
    if (meId == null) { setError('登录后才能评论'); return; }
    setSending(true);
    setError('');
    try {
      await addComment(postId, comment.trim());
      setComment('');
      await load();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  // 只有作者本人能看到右上角的「⋯」
  const isMine = !!(post && meId != null && post.user_id === meId);

  async function removePost() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deletePost(postId);
      setMenuOpen(false);
      setConfirmDel(false);
      onChanged && onChanged();
      onClose();           // 删完直接退回列表
    } catch (e) { setError(e.message); }
    finally { setDeleting(false); }
  }

  async function toggleVisibility() {
    try {
      await setPostVisibility(postId, !post.is_public);
      setMenuOpen(false);
      await load();
      onChanged && onChanged();
    } catch (e) { setError(e.message); }
  }

  return (
    <Modal visible={!!postId} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.detailRoot, isDesktop && styles.detailRootPc]}>
        <View style={styles.detailHead}>
          <TouchableOpacity onPress={onClose}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
          {post ? <Text style={styles.detailAuthor} numberOfLines={1}>{post.nickname}</Text> : null}
          {isMine ? (
            <TouchableOpacity style={styles.moreBtn} onPress={() => { setConfirmDel(false); setMenuOpen(true); }}>
              <Text style={styles.moreDots}>⋯</Text>
            </TouchableOpacity>
          ) : <View style={{ width: 70 }} />}
        </View>

        {/* 错误提示固定在头部下方：点赞收藏按钮在底部，滚下去就看不到滚动区顶部的提示了 */}
        {error ? <Text style={styles.errorFixed}>{error}</Text> : null}

        <ScrollView ref={scrollRef} contentContainerStyle={styles.detailBody}>
          {post ? (
            <>
              {post.images?.length ? (
                // 横向滑动图：宽度必须显式给（横向 ScrollView 里 width:'100%' 解析不出宽度，
                // 网页端会渲染成一片空白），所以先量出正文宽度再按它定宽
                <View onLayout={(e) => setBodyW(e.nativeEvent.layout.width)}>
                  {bodyW > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} pagingEnabled>
                      {post.images.map((img, i) => (
                        <SmartImage
                          key={i}
                          uri={img.startsWith('http') ? img : `${API_URL}${img}`}
                          style={[styles.detailImg, { width: bodyW }]}
                          fallback={(
                            <View style={[styles.cover, { backgroundColor: tint(post.image_emoji), width: bodyW, height: 280 }]}>
                              <Text style={styles.coverEmoji}>{post.image_emoji || '🌿'}</Text>
                            </View>
                          )}
                        />
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              ) : (
                <View style={[styles.cover, styles.coverBig, { backgroundColor: tint(post.image_emoji) }]}>
                  <Text style={styles.coverEmoji}>{post.image_emoji || '🌿'}</Text>
                </View>
              )}
              <Text style={styles.detailTitle}>{post.title}</Text>
              {!!post.tags?.length ? (
                <View style={styles.tagWrap}>
                  {post.tags.map((t) => (
                    <View key={t} style={styles.tagChip}><Text style={styles.tagChipText}># {t}</Text></View>
                  ))}
                </View>
              ) : null}
              <Text style={styles.detailBodyText}>{post.body}</Text>
              <Text style={styles.detailTime}>
                {fmtDateTime(post.created_at)}{!post.is_public ? ' · 🔒 仅自己可见' : ''}
              </Text>

              {meId != null && post.user_id != null && post.user_id !== meId ? (
                <View style={styles.authorRow}>
                  <View style={[styles.authorAvatar, { backgroundColor: tint(post.image_emoji) }]}>
                    <Text style={styles.authorAvatarText}>{post.image_emoji || '🌿'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.authorName}>{post.nickname}</Text>
                    <Text style={styles.authorTag}>帖子作者</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.followBtn, following && styles.followBtnOn]}
                    onPress={follow}
                  >
                    <Text style={[styles.followBtnText, following && styles.followBtnTextOn]}>
                      {following ? '已关注' : '＋ 关注'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={styles.cmtHead}>评论 {post.comments.length}</Text>
              {post.comments.map((c) => (
                <View key={c.id} style={styles.cmtRow}>
                  <Text style={styles.cmtNick}>{c.nickname}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cmtBody}>{c.body}</Text>
                    <Text style={styles.cmtTime}>{fmtDateTime(c.created_at)}</Text>
                  </View>
                </View>
              ))}
              {post.comments.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Image source={MASCOT_COMMUNITY} style={styles.emptyMascotSm} resizeMode="contain" />
                  <Text style={styles.empty}>还没有评论，来坐沙发</Text>
                </View>
              ) : null}
            </>
          ) : <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />}
        </ScrollView>

        {/* 小红书式底部栏：输入框 + 点赞 / 收藏 / 评论；输入时右侧变「发送」 */}
        <View style={styles.commentBar}>
          <TextInput
            style={styles.cmtInput}
            placeholder={meId == null ? '登录后才能评论…' : '说点什么…'}
            value={comment}
            onChangeText={setComment}
            onSubmitEditing={send}
          />
          {comment.trim() || sending ? (
            <TouchableOpacity onPress={send} disabled={sending}>
              {sending ? <ActivityIndicator color={C.green} /> : <Text style={styles.sendBtn}>发送</Text>}
            </TouchableOpacity>
          ) : post ? (
            <>
              <TouchableOpacity style={styles.barAction} onPress={like}>
                <Text style={[styles.barIcon, { color: post.liked ? '#E5484D' : '#404040' }]}>
                  {post.liked ? '♥' : '♡'}
                </Text>
                <Text style={styles.barCount}>{post.likes ?? 0}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.barAction} onPress={fav}>
                <Text style={[styles.barIcon, { color: post.favorited ? '#E8A33D' : '#404040' }]}>
                  {post.favorited ? '★' : '☆'}
                </Text>
                <Text style={styles.barCount}>{post.favorite_count ?? 0}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.barAction}
                onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
              >
                <Text style={styles.barIcon}>💬</Text>
                <Text style={styles.barCount}>{post.comments?.length ?? 0}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {/* 自己的帖子：右上角「⋯」→ 右侧抽屉（编辑内容 / 改可见范围 / 删除） */}
        {menuOpen ? (
          <View style={styles.menuMask}>
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={1}
              onPress={() => { setMenuOpen(false); setConfirmDel(false); }}
            />
            <View style={styles.menuPanel}>
              {confirmDel ? (
                <>
                  <Text style={styles.menuTitle}>删除这条帖子？</Text>
                  <Text style={styles.menuDesc}>
                    删除后帖子连同它的评论、点赞、收藏会一起消失，没法恢复。
                  </Text>
                  <View style={styles.menuRow}>
                    <TouchableOpacity style={styles.menuCancelBtn} onPress={() => setConfirmDel(false)}>
                      <Text style={styles.menuCancelText}>再想想</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.menuDangerBtn, deleting && { opacity: 0.6 }]}
                      onPress={removePost}
                      disabled={deleting}
                    >
                      {deleting
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={styles.menuDangerText}>确认删除</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.menuTitle}>帖子操作</Text>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => { setMenuOpen(false); onEdit && onEdit(post); }}
                  >
                    <Text style={styles.menuItemText}>✏️ 编辑内容</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={toggleVisibility}>
                    <Text style={styles.menuItemText}>
                      {post.is_public ? '🔒 改为仅自己可见' : '🌍 改为公开可见'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuItem} onPress={() => setConfirmDel(true)}>
                    <Text style={[styles.menuItemText, styles.menuItemDanger]}>🗑 删除帖子</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.menuBottom} onPress={() => setMenuOpen(false)}>
                    <Text style={styles.menuBottomText}>取消</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

export function ComposeModal({ visible, onClose, onDone, initial, nickname }) {
  const { isDesktop } = useLayout();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState([]);          // 已选标签（预设 + 自定义）
  const [customTags, setCustomTags] = useState([]); // 自己添加过的标签
  const [customInput, setCustomInput] = useState(''); // 自定义标签输入框
  const [isPublic, setIsPublic] = useState(true); // 公开可见 / 仅自己可见
  const [images, setImages] = useState([]);       // [{uri}] 最多 9 张
  const [choosing, setChoosing] = useState(false); // "＋"展开的拍照/相册选择条
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const allTags = [...TAG_PRESETS, ...customTags];
  const MAX_TAGS = 6; // 与后端上限一致
  const editingDraft = !!initial?.id; // 传了 initial 就是「编辑」
  // 有下架原因才是草稿箱里的那条；普通帖子进来是「编辑帖子」
  const isDraft = !!initial?.takedown_reason;

  // 打开时回填：编辑草稿用草稿内容，正常发帖则清空
  useEffect(() => {
    if (!visible) return;
    setError('');
    setChoosing(false);
    setCustomInput('');
    if (initial) {
      const t = initial.tags || [];
      setTitle(initial.title || '');
      setBody(initial.body || '');
      setTags(t);
      setCustomTags(t.filter((x) => !TAG_PRESETS.includes(x)));
      setIsPublic(!(initial.is_public === 0 || initial.is_public === false));
      // 旧图存的是相对路径，转成可预览的绝对地址，提交时按 existing 标记回传
      setImages((initial.images || []).map((p) => ({
        uri: p.startsWith('http') ? p : `${API_URL}${p}`,
        existing: p,
      })));
    } else {
      setTitle(''); setBody(''); setTags([]); setCustomTags([]); setIsPublic(true); setImages([]);
    }
    /* eslint-disable-next-line */
  }, [visible, initial?.id]);

  async function addImages(source) {
    setChoosing(false);
    const room = MAX_POST_IMAGES - images.length;
    if (room <= 0) return;
    const opts = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: source === 'library' && room > 1,
      selectionLimit: room,
    };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;
    const picked = [];
    for (const a of res.assets.slice(0, room)) {
      try {
        picked.push(await compressImage(a.uri, a.width, a.height));
      } catch { picked.push({ uri: a.uri, width: a.width, height: a.height }); }
    }
    setImages((prev) => [...prev, ...picked].slice(0, MAX_POST_IMAGES));
  }

  function toggleTag(t) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function addCustomTag() {
    const t = customInput.trim().replace(/^#/, '').slice(0, 10);
    if (!t) return;
    setCustomInput('');
    if (allTags.includes(t)) {
      // 已存在：直接选中它
      if (!tags.includes(t) && tags.length < MAX_TAGS) toggleTag(t);
      return;
    }
    if (tags.length >= MAX_TAGS) { setError(`最多选 ${MAX_TAGS} 个标签`); return; }
    setCustomTags((prev) => [...prev, t]);
    setTags((prev) => [...prev, t]);
    setError('');
  }

  async function submit() {
    if (!title.trim() || !body.trim()) { setError('标题和正文都要填'); return; }
    setSending(true);
    setError('');
    try {
      if (editingDraft) {
        // 编辑草稿：旧图（未删除的）按路径保留，新选的图走上传
        const keepImages = images.filter((im) => im.existing).map((im) => im.existing);
        const fresh = images.filter((im) => !im.existing);
        await updatePost(initial.id, {
          title: title.trim(), body: body.trim(),
          tags, isPublic, images: fresh, keepImages,
        });
      } else {
        await createPost({
          title: title.trim(), body: body.trim(),
          tags, isPublic, images,
        });
      }
      setTitle(''); setBody(''); setTags([]); setImages([]); setIsPublic(true);
      setCustomTags([]); setCustomInput('');
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.detailRoot, isDesktop && styles.detailRootPc]}>
        <View style={styles.detailHead}>
          <TouchableOpacity onPress={onClose}><Text style={styles.back}>‹ 取消</Text></TouchableOpacity>
          <Text style={styles.detailTitle}>
            {isDraft ? '编辑草稿' : editingDraft ? '编辑帖子' : '发笔记'}
          </Text>
          <TouchableOpacity onPress={submit} disabled={sending}>
            {sending
              ? <ActivityIndicator color={C.green} />
              : <Text style={styles.sendBtn}>{isDraft ? '重新发布' : editingDraft ? '保存' : '发布'}</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {editingDraft && initial?.takedown_reason ? (
            <View style={styles.draftNotice}>
              <Text style={styles.draftNoticeText}>
                下架原因：{initial.takedown_reason}{'\n'}
                改完点右上角「重新发布」，帖子和图片会重新公开。
              </Text>
            </View>
          ) : null}

          {/* 图片九宫格 */}
          <View style={styles.imgGrid}>
            {images.map((img, i) => (
              <View key={i} style={styles.imgCell}>
                <Image source={{ uri: img.uri }} style={styles.imgThumb} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.imgRemove}
                  onPress={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Text style={styles.imgRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {images.length < MAX_POST_IMAGES ? (
              <TouchableOpacity style={styles.imgAdd} onPress={() => setChoosing((v) => !v)}>
                <Text style={styles.imgAddPlus}>＋</Text>
                <Text style={styles.imgAddText}>{images.length}/{MAX_POST_IMAGES}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {choosing ? (
            <View style={styles.pickRow}>
              <TouchableOpacity style={styles.pickBtn} onPress={() => addImages('camera')}>
                <Image source={ICON_CAM} style={[styles.btnIcon, { tintColor: C.greenDark }]} />
                <Text style={styles.pickBtnText}>拍照</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickBtn} onPress={() => addImages('library')}>
                <Image source={ICON_ALB} style={[styles.btnIcon, { tintColor: C.greenDark }]} />
                <Text style={styles.pickBtnText}>从相册选</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 标题 + 正文（无边框，XHS 风） */}
          <TextInput
            style={styles.xhsTitle}
            placeholder="添加标题"
            placeholderTextColor={C.gray}
            value={title}
            onChangeText={setTitle}
            maxLength={40}
          />
          <TextInput
            style={styles.xhsBody}
            placeholder="添加正文：晒图、提问、分享经验都行"
            placeholderTextColor={C.gray}
            value={body}
            onChangeText={setBody}
            multiline
          />

          {/* 标签：预设 + 自定义 */}
          <Text style={styles.secLabel}>选择标签（可自己添加，最多 6 个）</Text>
          <View style={styles.tagWrap}>
            {allTags.map((t) => {
              const on = tags.includes(t);
              return (
                <TouchableOpacity key={t} style={[styles.tagChip, on && styles.tagChipOn]} onPress={() => toggleTag(t)}>
                  <Text style={[styles.tagChipText, on && styles.tagChipTextOn]}># {t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.customTagRow}>
            <TextInput
              style={styles.customTagInput}
              placeholder="自定义标签，如：多肉"
              placeholderTextColor={C.gray}
              value={customInput}
              onChangeText={setCustomInput}
              maxLength={10}
              onSubmitEditing={addCustomTag}
            />
            <TouchableOpacity style={styles.customTagBtn} onPress={addCustomTag}>
              <Text style={styles.customTagBtnText}>＋ 添加</Text>
            </TouchableOpacity>
          </View>

          {/* 可见性 */}
          <View style={styles.visRow}>
            <Text style={styles.secLabel}>谁可以看</Text>
            <View style={styles.visOpts}>
              <TouchableOpacity
                style={[styles.visPill, isPublic && styles.visPillOn]}
                onPress={() => setIsPublic(true)}
              >
                <Text style={[styles.visPillText, isPublic && styles.visPillTextOn]}>🌍 公开可见</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.visPill, !isPublic && styles.visPillOn]}
                onPress={() => setIsPublic(false)}
              >
                <Text style={[styles.visPillText, !isPublic && styles.visPillTextOn]}>🔒 仅自己可见</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 发布身份：直接用登录账号昵称，不再手填 */}
          <Text style={styles.publishAs}>发布身份：{nickname || '…'}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, paddingBottom: 8,
  },
  h1: { fontSize: 28, fontWeight: '800', color: C.text },
  newBtn: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 14 },
  newBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  welcome: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginHorizontal: 12, marginTop: 6, marginBottom: 4 },
  welcomeMascot: { width: 62, height: 62, marginRight: 12 },
  welcomeTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  welcomeSub: { fontSize: 12, color: C.sub, marginTop: 2 },
  error: { color: '#C2410C', fontSize: 13, paddingHorizontal: 16, marginBottom: 6 },
  draftNotice: {
    backgroundColor: '#FDF3E3', borderRadius: 12, padding: 12,
    marginHorizontal: 16, marginBottom: 10,
  },
  draftNoticeText: { color: '#8A5A18', fontSize: 12.5, lineHeight: 19 },
  errorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
  errorFixed: {
    color: '#C2410C', fontSize: 13, paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#FDEBDD',
  },
  errorLink: { color: C.greenDark, fontSize: 13, fontWeight: '800' },
  // ── 双列瀑布流 ──
  waterfall: { flexDirection: 'row', gap: 10 },
  // PC 上不限宽，四列铺满内容区（此前限 760 会让卡片缩水、右侧留白）
  waterfallPc: { width: '100%' },
  waterCol: { flex: 1 },
  card: { backgroundColor: C.card, borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  cover: { alignItems: 'center', justifyContent: 'center' },
  coverBig: { height: 200, borderRadius: 14, marginBottom: 12 },
  coverEmoji: { fontSize: 46 },
  cardTitle: { fontSize: 13, fontWeight: '600', color: C.text, padding: 10, paddingBottom: 4, lineHeight: 18, height: 50 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingBottom: 10 },
  author: { fontSize: 11, color: C.sub, flex: 1 },
  stats: { fontSize: 11, color: C.sub },
  empty: { textAlign: 'center', color: C.sub, marginTop: 12, fontSize: 14 },
  emptyBox: { alignItems: 'center', paddingTop: 40 },
  emptyMascot: { width: 90, height: 90, marginBottom: 8 },
  emptyMascotSm: { width: 64, height: 64, marginBottom: 4 },
  detailRoot: { flex: 1, backgroundColor: '#fff' },
  // PC 上帖子详情/发帖页限宽居中，别拉满整个屏幕
  detailRootPc: {
    width: '100%', maxWidth: 760, alignSelf: 'center',
    borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#EEF2E6',
  },
  detailHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  back: { color: C.sub, fontSize: 15, width: 70 },
  detailAuthor: { flex: 1, textAlign: 'center', fontWeight: '700', color: C.text },
  moreBtn: { width: 70, alignItems: 'flex-end', paddingVertical: 4 },
  moreDots: { fontSize: 22, lineHeight: 24, color: C.text, fontWeight: '800' },
  // 自己的帖子：右侧抽屉菜单
  menuMask: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)', flexDirection: 'row', justifyContent: 'flex-end',
  },
  menuPanel: { width: 268, backgroundColor: '#fff', paddingTop: 70, paddingHorizontal: 16 },
  menuTitle: { fontSize: 15, fontWeight: '800', color: C.text, marginBottom: 6 },
  menuDesc: { fontSize: 12.5, color: C.sub, lineHeight: 19, marginBottom: 14 },
  menuItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F2EC' },
  menuItemText: { fontSize: 14.5, color: C.text },
  menuItemDanger: { color: '#C2410C', fontWeight: '700' },
  menuBottom: {
    marginTop: 14, paddingVertical: 12, alignItems: 'center',
    backgroundColor: '#F1F3EE', borderRadius: 10,
  },
  menuBottomText: { fontSize: 14, color: C.text, fontWeight: '700' },
  menuRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  menuCancelBtn: {
    flex: 1, backgroundColor: '#F1F3EE', borderRadius: 10,
    paddingVertical: 11, alignItems: 'center',
  },
  menuCancelText: { fontSize: 14, color: C.text, fontWeight: '700' },
  menuDangerBtn: {
    flex: 1, backgroundColor: '#C2410C', borderRadius: 10,
    paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
  },
  menuDangerText: { fontSize: 14, color: '#fff', fontWeight: '800' },
  detailBody: { padding: 16, paddingBottom: 100 },
  detailTitle: { fontSize: 19, fontWeight: '800', color: C.text, marginBottom: 8 },
  detailBodyText: { fontSize: 15, lineHeight: 24, color: C.text },
  detailTime: { fontSize: 12, color: C.sub, marginTop: 10 },
  authorRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 16 },
  authorAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  authorAvatarText: { fontSize: 22 },
  authorName: { fontSize: 15, fontWeight: '700', color: C.text },
  authorTag: { fontSize: 12, color: C.sub, marginTop: 2 },
  followBtn: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 7, paddingHorizontal: 16 },
  followBtnOn: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  followBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  followBtnTextOn: { color: C.sub },
  cmtHead: { fontSize: 15, fontWeight: '800', color: C.text, marginTop: 20, marginBottom: 8 },
  cmtRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F2F2EC' },
  cmtNick: { width: 70, fontSize: 13, fontWeight: '700', color: C.sub },
  cmtBody: { fontSize: 14, color: C.text, lineHeight: 20 },
  cmtTime: { fontSize: 11, color: C.sub, marginTop: 2 },
  commentBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 14, paddingVertical: 10, paddingBottom: 28,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee',
  },
  cmtInput: {
    flex: 1, borderWidth: 1, borderColor: '#E2E2DA', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, fontSize: 13,
  },
  sendBtn: { color: C.greenDark, fontWeight: '800', fontSize: 14, paddingHorizontal: 6 },
  barAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  barIcon: { fontSize: 21, lineHeight: 24 },
  barCount: { fontSize: 13, color: '#404040', fontWeight: '600' },
  // ── 小红书式发帖 ──
  imgGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  imgCell: { width: 96, height: 96, borderRadius: 10, overflow: 'hidden' },
  imgThumb: { width: '100%', height: '100%' },
  imgRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  imgRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  imgAdd: {
    width: 96, height: 96, borderRadius: 10, backgroundColor: '#F2F5EE',
    alignItems: 'center', justifyContent: 'center',
  },
  imgAddPlus: { fontSize: 30, color: C.gray, lineHeight: 34 },
  imgAddText: { fontSize: 11, color: C.gray, marginTop: 2 },
  pickRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  pickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.greenTint, borderRadius: 12, paddingVertical: 10,
  },
  btnIcon: { width: 17, height: 13, marginRight: 6 },
  pickBtnText: { color: C.greenDark, fontWeight: '700', fontSize: 14 },
  xhsTitle: { fontSize: 19, fontWeight: '800', color: C.text, paddingVertical: 12 },
  xhsBody: {
    fontSize: 15, lineHeight: 22, color: C.text, minHeight: 110,
    textAlignVertical: 'top', paddingBottom: 12,
  },
  secLabel: { fontSize: 13, color: C.sub, marginBottom: 8, marginTop: 4 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tagChip: {
    backgroundColor: '#F2F5EE', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  tagChipOn: { backgroundColor: C.greenTint, borderWidth: 1, borderColor: C.green },
  tagChipText: { fontSize: 12, color: C.sub },
  tagChipTextOn: { color: C.greenDark, fontWeight: '700' },
  visRow: { marginBottom: 16 },
  visOpts: { flexDirection: 'row', gap: 8 },
  visPill: {
    borderWidth: 1, borderColor: C.border, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff',
  },
  visPillOn: { borderColor: C.green, backgroundColor: C.greenTint },
  visPillText: { fontSize: 13, color: C.sub },
  visPillTextOn: { color: C.greenDark, fontWeight: '700' },
  customTagRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 },
  customTagInput: {
    flex: 1, borderWidth: 1, borderColor: '#E2E2DA', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7, fontSize: 13,
  },
  customTagBtn: {
    backgroundColor: C.green, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14,
  },
  customTagBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  publishAs: { fontSize: 12, color: C.sub, borderTopWidth: 1, borderTopColor: '#F0F2EC', paddingTop: 12 },
  // ── 卡片图 / 详情图 ──
  coverImg: { width: '100%', aspectRatio: 0.75 },
  imgCount: {
    position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
  },
  imgCountText: { color: '#fff', fontSize: 11 },
  cardTags: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 4, height: 20 },
  cardTag: { fontSize: 11, color: C.greenDark },
  detailImg: { width: '100%', height: 280 },
});
