import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Image,
  Modal, FlatList,
} from 'react-native';
import { getHome, getTodos, getNotifications, getUnreadCount, markNotificationsRead, createPlantTrack } from '../lib/api';
import PageBackground from '../components/PageBackground';
import LikeBurst from '../components/LikeBurst';
import PlantDetailScreen from './PlantDetailScreen';
import { API_URL } from '../lib/config';
import SmartImage from '../components/SmartImage';
import { CROPS } from '../lib/crops';
import { C } from '../lib/theme';
import { useLayout } from '../lib/responsive';
import { getCoords, getCachedCoords } from '../lib/location';

const MASCOT = require('../assets/mascot_identify.png');
const MASCOT_GRAFT = require('../assets/mascot_graft.png');
const FAB_ICON = require('../assets/fab_camera.png');

function cropZh(en) {
  return CROPS.find((c) => c.en === en)?.zh || en || '未设品种';
}

// 植物头像底色（跟参考图一样的柔和色块）
const AVATAR_BG = ['#E4F0FA', '#EAF6DF', '#FFF3D6', '#FDE8E0', '#E8F5E9'];

function avatarBg(seed) {
  return AVATAR_BG[Math.abs(seed) % AVATAR_BG.length];
}

// 植物照片：后端存的是 /files/... 相对路径，拼成绝对地址
function plantPhotoUri(p) {
  if (!p?.photo_url) return null;
  return p.photo_url.startsWith('http') ? p.photo_url : `${API_URL}${p.photo_url}`;
}

function statusOf(plant) {
  const rec = plant.last_record;
  if (!rec) return { text: '未记录', color: C.sub, bg: '#EFF2EC' };
  if (rec.disease_label === 'healthy') return { text: '健康', color: '#1E7B34', bg: '#E2F5E5' };
  if (rec.disease_label === 'diseased') return { text: '需关注', color: '#C2410C', bg: '#FDEBDD' };
  return { text: '观察中', color: '#8A6D1A', bg: '#FBF3D9' };
}

// 消息类型的展示样式
const NOTIF_STYLE = {
  comment:  { icon: '💬', color: '#4A9FE8', label: '评论' },
  like:     { icon: '❤️', color: '#E5484D', label: '点赞' },
  favorite: { icon: '⭐', color: '#E8A33D', label: '收藏' },
  follow:   { icon: '👤', color: '#2E7D32', label: '关注' },
  system:   { icon: '📣', color: '#8A6D1A', label: '系统' },
};

// 待办类型样式 + 去处理跳哪个 tab
const TODO_STYLE = {
  review: { icon: '🩺', label: '复查', tab: 'identify' },
  photo:  { icon: '📷', label: '拍照记录', tab: 'garden' },
  track:  { icon: '📈', label: '建立追踪', tab: 'garden' },
};

// 当天已完成的任务 key（存 localStorage，原生端退化为内存）
let _doneCache = null;
let _doneCacheDay = null;
function doneKeyOf(item) { return `${item.type}|${item.text}`; }
// 本地日期（不能用 toISOString，那是 UTC，早上 8 点前会算成昨天）
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 清掉昨天以前的完成记录，别让 localStorage 一直堆积
function pruneDoneKeys(today) {
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('todo_done_') && k !== `todo_done_${today}`) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch { /* 原生端没有 localStorage */ }
}
function loadDone() {
  const today = localToday();
  if (_doneCache && _doneCacheDay === today) return _doneCache;
  try {
    pruneDoneKeys(today);
    _doneCache = JSON.parse(localStorage.getItem(`todo_done_${today}`) || '[]');
  } catch { _doneCache = []; }
  _doneCacheDay = today;
  return _doneCache;
}
function saveDone(list) {
  _doneCache = list;
  const today = localToday();
  _doneCacheDay = today;
  try {
    localStorage.setItem(`todo_done_${today}`, JSON.stringify(list));
  } catch { /* 原生端只存内存 */ }
}

// 任务清单弹窗：今日全部待办，可勾选完成、可跳去处理
function TodosModal({ visible, onClose, user, onGoTab, onHandle }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState([]);
  const [burst, setBurst] = useState(false); // 完成待办触发满屏下落点赞（渲染在本 Modal 内，盖住弹窗）

  useEffect(() => {
    if (!visible || !user) return;
    setItems(null);
    setError('');
    setDone(loadDone());
    let alive = true;
    (async () => {
      try {
        const r = await getTodos();
        if (alive) setItems(r.todos || []);
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => { alive = false; };
  }, [visible, user]);

  const toggle = (item) => {
    const k = doneKeyOf(item);
    const wasDone = done.includes(k);
    const next = wasDone ? done.filter((x) => x !== k) : [...done, k];
    setDone(next);
    saveDone(next);
    if (!wasDone) setBurst(true); // 勾选完成才放满屏点赞
  };

  const total = items?.length ?? 0;
  const doneCount = items ? items.filter((it) => done.includes(doneKeyOf(it))).length : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={nstyles.mask}>
        <View style={nstyles.panel}>
          <View style={nstyles.head}>
            <View>
              <Text style={nstyles.headTitle}>今日任务</Text>
              {user && items ? (
                <Text style={nstyles.headSub}>{total ? `${doneCount}/${total} 已完成` : '暂无任务'}</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose}><Text style={nstyles.close}>完成</Text></TouchableOpacity>
          </View>
          {!user ? (
            <View style={nstyles.empty}>
              <Text style={nstyles.emptyText}>登录后才能查看任务</Text>
              <TouchableOpacity style={nstyles.loginBtn} onPress={() => { onClose(); onGoTab('profile'); }}>
                <Text style={nstyles.loginBtnText}>去登录</Text>
              </TouchableOpacity>
            </View>
          ) : error ? (
            <Text style={nstyles.error}>{error}</Text>
          ) : items == null ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
          ) : items.length === 0 ? (
            <View style={nstyles.empty}>
              <Text style={{ fontSize: 44 }}>🦎</Text>
              <Text style={nstyles.emptyText}>今天的任务都完成啦</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(it, i) => `${i}-${it.type}-${it.plant_id}`}
              renderItem={({ item }) => {
                const st = TODO_STYLE[item.type] || TODO_STYLE.photo;
                const isDone = done.includes(doneKeyOf(item));
                return (
                  <View style={nstyles.row}>
                    <TouchableOpacity
                      style={[tstyles.check, isDone && { backgroundColor: C.green, borderColor: C.green }]}
                      onPress={() => toggle(item)}
                    >
                      {isDone ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <Text style={[tstyles.rowText, isDone && tstyles.rowDone]} numberOfLines={2}>
                        {item.text}
                      </Text>
                      <Text style={nstyles.rowTime}>{st.icon} {st.label}</Text>
                    </View>
                    <TouchableOpacity
                      style={tstyles.goBtn}
                      onPress={() => { onClose(); onHandle(item); }}
                    >
                      <Text style={tstyles.goText}>去处理 ›</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
      {/* 满屏下落点赞：渲染在 Modal 内部（Modal 传送门在 root 之上，必须在里面才能盖住弹窗） */}
      {burst && <LikeBurst onDone={() => setBurst(false)} />}
    </Modal>
  );
}

// 任务清单弹窗样式
const tstyles = StyleSheet.create({
  check: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#C9D6BD',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  rowText: { fontSize: 14, color: C.text, lineHeight: 19, fontWeight: '600' },
  rowDone: { color: C.sub, textDecorationLine: 'line-through', fontWeight: '400' },
  goBtn: {
    backgroundColor: '#EFF5E8', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6,
    marginLeft: 8,
  },
  goText: { color: C.greenDark, fontSize: 12, fontWeight: '700' },
});

function timeZh(s) {
  if (!s) return '';
  // 后端存的是不带时区的 UTC 时间（YYYY-MM-DDTHH:MM:SS），补 Z 按 UTC 解析
  const d = new Date(/Z$|[+-]\d\d:?$/.test(s) ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) return s.slice(5, 16);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return s.slice(0, 10);
}

// 消息中心弹窗：别人评论/点赞/收藏你的帖子、关注你
function NotificationsModal({ visible, onClose, user, onGoTab, onOpenPost, onOpenDraft }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible || !user) return;
    setItems(null);
    setError('');
    let alive = true;
    (async () => {
      try {
        const r = await getNotifications();
        if (alive) setItems(r.items || []);
        markNotificationsRead().catch(() => {});
      } catch (e) {
        if (alive) setError(e.message);
      }
    })();
    return () => { alive = false; };
  }, [visible, user]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={nstyles.mask}>
        <View style={nstyles.panel}>
          <View style={nstyles.head}>
            <Text style={nstyles.headTitle}>消息</Text>
            <TouchableOpacity onPress={onClose}><Text style={nstyles.close}>完成</Text></TouchableOpacity>
          </View>
          {!user ? (
            <View style={nstyles.empty}>
              <Text style={nstyles.emptyText}>登录后才能查看消息</Text>
              <TouchableOpacity style={nstyles.loginBtn} onPress={() => { onClose(); onGoTab('profile'); }}>
                <Text style={nstyles.loginBtnText}>去登录</Text>
              </TouchableOpacity>
            </View>
          ) : error ? (
            <Text style={nstyles.error}>{error}</Text>
          ) : items == null ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={C.green} />
          ) : items.length === 0 ? (
            <View style={nstyles.empty}>
              <Text style={{ fontSize: 44 }}>🦎</Text>
              <Text style={nstyles.emptyText}>还没有消息，发帖互动一下试试</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(it) => String(it.id)}
              renderItem={({ item }) => {
                const st = NOTIF_STYLE[item.type] || NOTIF_STYLE.system;
                const isTakedown = item.post_status === 'takedown';
                const body = (
                  <>
                    <SmartImage
                      uri={item.actor_avatar ? `${API_URL}${item.actor_avatar}` : null}
                      style={nstyles.avatar}
                      fallback={(
                        <View style={nstyles.avatarFallback}>
                          <Text style={{ fontSize: 20 }}>{st.icon}</Text>
                        </View>
                      )}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={nstyles.rowText} numberOfLines={2}>
                        {/* 系统通知（下架/审核）没有具体操作人，署名统一显示「系统管理员」 */}
                        <Text style={nstyles.rowActor}>
                          {item.type === 'system' ? '系统管理员' : (item.actor_nickname || '有人')}{' '}
                        </Text>
                        {item.content || st.label}
                      </Text>
                      <Text style={nstyles.rowTime}>
                        {timeZh(item.created_at)}
                        {item.post_id ? (isTakedown ? ' · 去草稿箱修改 ›' : ' · 查看帖子 ›') : ''}
                      </Text>
                    </View>
                    {!item.is_read ? <View style={nstyles.unreadDot} /> : null}
                  </>
                );
                // 有对应帖子的通知可以直接点进去看（关注类没有帖子，保持静态）
                if (!item.post_id) {
                  return <View style={[nstyles.row, !item.is_read && nstyles.rowUnread]}>{body}</View>;
                }
                return (
                  <TouchableOpacity
                    style={[nstyles.row, !item.is_read && nstyles.rowUnread]}
                    activeOpacity={0.7}
                    onPress={() => {
                      onClose();
                      // 被下架的帖子已经不在发现页了，直接带去个人资料的草稿箱
                      if (isTakedown) { onOpenDraft && onOpenDraft(item.post_id); }
                      else { onOpenPost && onOpenPost(item.post_id); }
                    }}
                  >
                    {body}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// 首页：当天天气 + 花园健康度 + 待办 + 我的植物 + 今日任务（参考 PlantCare 布局）
export default function HomeScreen({ user, onGoTab, onOpenAnalyze, onOpenTrack, onGoIdentifyPlant, openPlantId, onPlantOpened, onOpenPost, onOpenDraft }) {
  const { isDesktop } = useLayout();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [todoOpen, setTodoOpen] = useState(false);
  const [detailId, setDetailId] = useState(null); // 首页植物卡 → 植物档案

  // 从追踪页返回时，重新打开刚才那株植物的档案
  useEffect(() => {
    if (openPlantId) {
      setDetailId(openPlantId);
      onPlantOpened && onPlantOpened();
    }
    /* eslint-disable-next-line */
  }, [openPlantId]);

  const load = useCallback(async () => {
    setError('');
    try {
      // 先用已有坐标（或后端的 IP 定位）把首页秒开，别卡在授权弹窗上
      const cached = getCachedCoords();
      setData(await getHome(cached));

      // 没有坐标才去要真实定位，拿到后静默刷新一次
      if (!cached) {
        const coords = await getCoords();
        if (coords) setData(await getHome(coords));
      }
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  // 未读消息数：登录后拉一次，弹窗看过之后清零
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    let alive = true;
    getUnreadCount()
      .then((r) => { if (alive) setUnread(r.unread || 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user, notifOpen]);

  const weather = data?.weather;
  const garden = data?.garden;
  const plants = data?.plants || [];
  const todos = garden?.todos || [];

  // 任务「去处理」：按类型直达真正的操作位置
  //   track        → 直接给这株植物建追踪并打开追踪页
  //   review/photo → 打开这株植物的档案（能看历史诊断、直接拍新照片）
  const [todoTip, setTodoTip] = useState('');
  async function handleTodo(item) {
    setTodoTip('');
    if (item.type === 'track') {
      try {
        const r = await createPlantTrack(item.plant_id);
        load(); // 待办会随之减少
        if (r?.track_id && onOpenTrack) onOpenTrack(r.track_id);
        else setDetailId(item.plant_id);
      } catch (e) {
        // 建追踪失败（比如已经建过）就退到植物档案，至少能继续操作
        setTodoTip(e.message || '建立追踪失败');
        setDetailId(item.plant_id);
      }
      return;
    }
    // 复查 / 拍照记录：都进这株植物的植物档案
    setDetailId(item.plant_id);
  }

  // 植物卡：手机上横向滑动，PC 上换成换行网格（横向滚动在 PC 上不好用）
  function renderPlantCard(p) {
    const st = statusOf(p);
    return (
      <TouchableOpacity key={p.id} style={styles.plantCard} onPress={() => setDetailId(p.id)}>
        <View style={[styles.plantAvatar, { backgroundColor: avatarBg(p.id) }]}>
          <SmartImage
            uri={plantPhotoUri(p)}
            style={styles.plantAvatarImg}
            fallback={<Text style={{ fontSize: 40 }}>{p.photo_emoji || '🌱'}</Text>}
          />
        </View>
        <Text style={styles.plantName} numberOfLines={1}>{p.nickname}</Text>
        <Text style={styles.plantCrop} numberOfLines={1}>{cropZh(p.crop)}</Text>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Text style={[styles.badgeText, { color: st.color }]}>{st.text}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // 快捷功能区块（嫁接初筛入口）：PC 放左栏，手机放植物列表后面
  function renderQuickSection() {
    return (
      <View>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>快捷功能</Text>
        </View>
        <TouchableOpacity style={styles.graftCard} onPress={onOpenAnalyze}>
          <Image source={MASCOT_GRAFT} style={styles.graftMascot} resizeMode="contain" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.graftTitle}>嫁接初筛</Text>
            <Text style={styles.graftSub}>接穗 + 砧木双图，评估亲和性与成活决策</Text>
          </View>
          <Text style={{ color: C.sub }}>›</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 陪伴卡：Avo 站在植物卡旁边，把「我的植物」面板右侧的空位填上（仅 PC）
  function renderMascotAside() {
    return (
      <View style={styles.mascotAside}>
        <Image source={MASCOT} style={styles.mascotAsideImg} resizeMode="contain" />
        <Text style={styles.mascotAsideTitle}>我是 Avo 🌱</Text>
        <Text style={styles.mascotAsideText}>常来给植物拍张照，{'\n'}我帮你看看它们今天状态怎么样～</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <PageBackground variant="green" />
      <ScrollView contentContainerStyle={[styles.scroll, isDesktop && styles.scrollPc]} showsVerticalScrollIndicator={false}>
        {/* 头部 */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>
              {isDesktop
                ? (user ? `你好，${user.nickname || user.username}` : '欢迎回到 Avo')
                : 'Avo 植物管家'}
            </Text>
            <Text style={styles.slogan}>打造你的花园</Text>
          </View>
          {!isDesktop && <Image source={MASCOT} style={styles.mascot} resizeMode="contain" />}
          <TouchableOpacity style={styles.bell} onPress={() => setNotifOpen(true)}>
            <Text style={{ fontSize: 20 }}>🔔</Text>
            {unread > 0 ? (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {todoTip ? <Text style={styles.todoTip}>{todoTip}</Text> : null}
        {!data && !error ? <ActivityIndicator style={{ marginTop: 40 }} color={C.green} /> : null}

        {data ? (
          // PC 上分两栏（左：天气 + 健康度/待办；右：我的植物 + 快捷功能），手机上仍是单列
          <View style={isDesktop ? styles.colsPc : undefined}>
            <View style={isDesktop ? styles.colPc : undefined}>
            {/* PC 上左栏也带分区标题，才能和右栏「我的植物」顶部对齐 */}
            {isDesktop ? (
              <View style={styles.overviewHead}>
                <Text style={styles.sectionTitle}>今日概览</Text>
              </View>
            ) : null}
            {/* 天气卡 */}
            <View style={styles.weatherCard}>
              <Text style={styles.weatherEmoji}>{weather?.emoji || '⛅'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.weatherMain}>
                  {weather?.condition} {weather?.temperature}°C
                  {weather?.demo ? (
                    <Text style={styles.demoTag}> · 示例</Text>
                  ) : weather?.city ? (
                    <Text style={styles.demoTag}> · {weather.city}</Text>
                  ) : null}
                </Text>
                <Text style={styles.weatherHint}>{weather?.hint}</Text>
              </View>
            </View>

            {/* 健康度 + 待办 */}
            <View style={styles.statRow}>
              <TouchableOpacity style={styles.statCard} onPress={() => onGoTab('garden')}>
                <Text style={styles.statLabel}>花园健康度 ›</Text>
                <Text style={styles.statValue}>
                  {garden?.health_score != null ? garden.health_score : '—'}
                </Text>
                <Text style={styles.statSub}>
                  {user ? `${garden?.plant_count ?? 0} 株植物` : '登录后开通'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.statCard} onPress={() => setTodoOpen(true)}>
                <View style={styles.statHead}>
                  <Text style={styles.statLabel}>待办</Text>
                  <View style={styles.checkDot}>
                    <Text style={{ fontSize: 11, color: '#fff' }}>{todos.length ? todos.length : '✓'}</Text>
                  </View>
                </View>
                <Text style={styles.statValueSmall} numberOfLines={1}>
                  {todos.length ? todos[0].text : '已完成'}
                </Text>
                <Text style={styles.statSub}>{todos.length ? `还有 ${todos.length} 项，点开任务清单 ›` : '今天见 🌞'}</Text>
              </TouchableOpacity>
            </View>
            {/* 快捷功能：嫁接初筛入口（原「嫁接」tab）。PC 上放在左栏，免得两栏高低差太多 */}
            {isDesktop ? renderQuickSection() : null}
            </View>

            <View style={isDesktop ? styles.colPc : undefined}>
            {/* 我的植物：PC 上包一层比页面背景略深的浅色面板，和背景区分开（手机不变） */}
            <View style={isDesktop ? styles.plantsPanel : undefined}>
            <View style={isDesktop ? styles.sectionHeadPanel : styles.sectionHead}>
              <Text style={styles.sectionTitle}>我的植物</Text>
              <TouchableOpacity onPress={() => onGoTab('garden')}>
                <Text style={styles.sectionMore}>查看全部</Text>
              </TouchableOpacity>
            </View>
            {plants.length === 0 ? (
              <TouchableOpacity style={styles.emptyPlants} onPress={() => onGoTab('garden')}>
                <Image source={MASCOT} style={styles.mascotSmall} resizeMode="contain" />
                <Text style={styles.emptyPlantsText}>
                  {user ? '还没有添加植物，去花园添加 →' : '登录后添加你的植物 →'}
                </Text>
              </TouchableOpacity>
            ) : isDesktop ? (
              <View style={styles.plantPanelRow}>
                <View style={styles.plantGrid}>{plants.map(renderPlantCard)}</View>
                {renderMascotAside()}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {plants.map(renderPlantCard)}
              </ScrollView>
            )}
            </View>

            {/* 手机上快捷功能跟在植物后面（PC 上在上面左栏） */}
            {isDesktop ? null : renderQuickSection()}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* 相机悬浮按钮 → 诊断（图标抠自参考图） */}
      <TouchableOpacity style={styles.fab} onPress={() => onGoTab('identify')} activeOpacity={0.85}>
        <Image source={FAB_ICON} style={styles.fabIcon} resizeMode="contain" />
      </TouchableOpacity>

      {/* 消息中心 */}
      <NotificationsModal
        visible={notifOpen}
        onClose={() => { setNotifOpen(false); setUnread(0); }}
        user={user}
        onGoTab={onGoTab}
        onOpenPost={onOpenPost}
        onOpenDraft={onOpenDraft}
      />

      {/* 今日任务清单 */}
      <TodosModal
        visible={todoOpen}
        onClose={() => setTodoOpen(false)}
        user={user}
        onGoTab={onGoTab}
        onHandle={handleTodo}
      />

      {/* 植物档案（点首页植物卡直达，与花园页同一组件） */}
      <PlantDetailScreen
        plantId={detailId}
        onClose={() => { setDetailId(null); load(); }}
        onOpenTrack={onOpenTrack}
        onGoIdentify={(plant) => { setDetailId(null); onGoIdentifyPlant && onGoIdentifyPlant(plant); }}
        onChanged={load}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 90 },
  scrollPc: { padding: 26, paddingBottom: 40 },
  colsPc: { flexDirection: 'row', gap: 22, alignItems: 'flex-start' },
  colPc: { flex: 1, minWidth: 0 },
  plantGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  // PC：「我的植物」面板里 植物卡 + Avo 陪伴卡 并排，撑满面板宽度
  plantPanelRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  mascotAside: {
    flex: 1, minWidth: 150, backgroundColor: '#EAF6DF', borderRadius: 14,
    padding: 14, alignItems: 'center', justifyContent: 'center',
  },
  mascotAsideImg: { width: 110, height: 110, marginBottom: 8 },
  mascotAsideTitle: { fontSize: 15, fontWeight: '800', color: '#1F3D10', textAlign: 'center' },
  mascotAsideText: { fontSize: 12, color: '#5A6B4E', marginTop: 3, textAlign: 'center', lineHeight: 18 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, marginTop: 8 },
  h1: { fontSize: 30, fontWeight: '900', color: '#1F3D10' },
  slogan: { fontSize: 13, color: C.sub, marginTop: 2 },
  bell: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -4,
    minWidth: 17, height: 17, borderRadius: 9,
    backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 2, borderColor: C.bg,
  },
  bellBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  mascot: { width: 72, height: 72, marginRight: 10 },
  mascotSmall: { width: 80, height: 80, marginBottom: 6 },
  error: { color: '#C2410C', fontSize: 13, marginBottom: 8 },
  todoTip: { color: '#B45309', fontSize: 12, marginBottom: 8 },
  weatherCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#E3EDD8',
    borderRadius: 18, padding: 16, marginBottom: 12,
  },
  weatherEmoji: { fontSize: 30, marginRight: 14 },
  weatherMain: { fontSize: 17, fontWeight: '800', color: '#24421B' },
  demoTag: { fontSize: 11, color: C.sub, fontWeight: '400' },
  weatherHint: { fontSize: 12, color: '#5A6B4E', marginTop: 3 },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  statCard: {
    flex: 1, backgroundColor: '#E9F1DC', borderRadius: 18, padding: 14,
  },
  statHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { fontSize: 13, color: '#5A6B4E', fontWeight: '600' },
  statValue: { fontSize: 34, fontWeight: '900', color: '#1F3D10', marginTop: 4 },
  statValueSmall: { fontSize: 14, fontWeight: '700', color: '#1F3D10', marginTop: 6 },
  statSub: { fontSize: 11, color: C.sub, marginTop: 2 },
  checkDot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, marginBottom: 10,
  },
  // PC 左栏「今日概览」标题：和右栏面板里的标题顶对齐（面板 paddingTop 12 + 标题 marginTop 0）
  overviewHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, marginBottom: 10,
  },
  // PC 右栏「我的植物」面板：比页面背景(#F4FAEE)略深一档，别太深
  plantsPanel: {
    backgroundColor: '#EBF4DF', borderRadius: 18, borderWidth: 1, borderColor: '#DFEDD0',
    padding: 14, paddingTop: 12,
  },
  sectionHeadPanel: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#1F3D10' },
  sectionMore: { fontSize: 13, color: C.sub },
  emptyPlants: {
    backgroundColor: '#fff', borderRadius: 14, padding: 18, alignItems: 'center',
  },
  emptyPlantsText: { color: C.sub, fontSize: 14, marginTop: 2 },
  plantCard: {
    width: 130, backgroundColor: '#fff', borderRadius: 16, padding: 10,
    marginRight: 12, alignItems: 'center',
  },
  plantAvatar: {
    width: 110, height: 96, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  plantAvatarImg: { width: 110, height: 96, borderRadius: 12 },
  plantName: { fontSize: 13, fontWeight: '700', color: C.text, marginTop: 8 },
  plantCrop: { fontSize: 11, color: C.sub, marginTop: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  graftCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 14,
  },
  graftMascot: { width: 46, height: 46 },
  graftTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  graftSub: { fontSize: 12, color: C.sub, marginTop: 2 },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 54, height: 54,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
  },
  fabIcon: { width: 54, height: 54 },
});

// 消息中心弹窗样式
const nstyles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  panel: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    height: '72%', paddingBottom: 20,
    // PC 上是居中的抽屉，不要横跨整个屏幕
    width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: 780,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#F0F0EA',
  },
  headTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  headSub: { fontSize: 12, color: C.sub, marginTop: 2 },
  close: { color: C.greenDark, fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F5F5F0',
  },
  rowUnread: { backgroundColor: '#F4FAF0' },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  avatarFallback: {
    width: 40, height: 40, borderRadius: 20, marginRight: 12,
    backgroundColor: '#EFF5E8', alignItems: 'center', justifyContent: 'center',
  },
  rowText: { fontSize: 13, color: C.text, lineHeight: 18 },
  rowActor: { fontWeight: '800' },
  rowTime: { fontSize: 11, color: C.sub, marginTop: 3 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5484D', marginLeft: 8 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: C.sub, fontSize: 14, marginTop: 10 },
  loginBtn: {
    marginTop: 16, backgroundColor: C.green, borderRadius: 20,
    paddingHorizontal: 26, paddingVertical: 9,
  },
  loginBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  error: { color: '#C2410C', fontSize: 13, padding: 20 },
});
