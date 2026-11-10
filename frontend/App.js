import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, Image, Animated, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './screens/HomeScreen';
import IdentifyScreen from './screens/IdentifyScreen';
import AnalyzeScreen from './screens/AnalyzeScreen';
import TrackScreen from './screens/TrackScreen';
import CommunityScreen from './screens/CommunityScreen';
import ProfileScreen from './screens/ProfileScreen';
import GardenScreen from './screens/GardenScreen';
import { getToken, me, logout } from './lib/api';
import { C } from './lib/theme';
import { useLayout, CONTENT_MAX } from './lib/responsive';
import { installWebScale, SIDENAV_W } from './lib/webScale';

// 网页端整体等比缩放（原生端是空操作）
installWebScale();

const MASCOT = require('./assets/mascot_identify.png');

// 底部 tab（对齐参考设计）：首页 / 诊断 / 发现 / 我的花园 / 个人资料。
// 嫁接初筛与追踪以弹层保留入口：首页快捷功能 & 花园植物详情。
const TABS = [
  { key: 'home', title: '首页', icon: '🏠' },
  { key: 'identify', title: '诊断', icon: '🩺' },
  { key: 'discover', title: '发现', icon: '🔍' },
  { key: 'garden', title: '我的花园', icon: '🌿' },
  { key: 'profile', title: '个人资料', icon: '👤' },
];

// RN-web 不支持 native driver，web 上必须走 JS 驱动，否则控制台一片告警
const NATIVE = Platform.OS !== 'web';

// 选中态弹一下：active 由 false 变 true 的那一刻从 0.86 弹回 1。
// 只在"切过去"时弹，重渲染或本来就选中的不会反复抖。
function useBounce(active) {
  const s = useRef(new Animated.Value(1)).current;
  const prev = useRef(active);
  useEffect(() => {
    if (active && !prev.current) {
      s.setValue(0.86);
      Animated.spring(s, {
        toValue: 1, friction: 4.5, tension: 150, useNativeDriver: NATIVE,
      }).start();
    }
    prev.current = active;
  }, [active, s]);
  return s;
}

// 底部 tab 单项（图标选中时弹一下）
function TabItem({ t, on, onPress }) {
  const s = useBounce(on);
  return (
    <TouchableOpacity style={styles.tabItem} onPress={onPress} activeOpacity={0.7}>
      <Animated.Text
        style={[styles.tabIcon, on && styles.tabIconOn, { transform: [{ scale: s }] }]}
      >
        {t.icon}
      </Animated.Text>
      <Text style={[styles.tabText, on && styles.tabActive]}>{t.title}</Text>
    </TouchableOpacity>
  );
}

// 底部 tab bar + 滑动指示条。
// 指示条宽度靠 onLayout 量出来（横向等分），没量到之前不渲染，避免先闪一下再跳位。
function TabBar({ tab, onSelect }) {
  const idx = Math.max(0, TABS.findIndex((t) => t.key === tab));
  const pos = useRef(new Animated.Value(idx)).current;
  const [w, setW] = useState(0);
  const itemW = w / TABS.length;

  useEffect(() => {
    Animated.spring(pos, {
      toValue: idx, friction: 9, tension: 90, useNativeDriver: NATIVE,
    }).start();
  }, [idx, pos]);

  const left = useMemo(
    () => (itemW
      ? pos.interpolate({
        inputRange: [0, TABS.length - 1],
        outputRange: [0, itemW * (TABS.length - 1)],
      })
      : 0),
    [pos, itemW]
  );

  return (
    <View style={styles.tabBar} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {itemW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.tabIndWrap, { width: itemW, transform: [{ translateX: left }] }]}
        >
          <View style={styles.tabInd} />
        </Animated.View>
      ) : null}
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TabItem key={t.key} t={t} on={tab === t.key} onPress={() => onSelect(t.key)} />
        ))}
      </View>
    </View>
  );
}

// PC 侧边栏单项：选中时左侧长出一条竖条，图标同样弹一下
function SideItem({ t, on, onPress }) {
  const s = useBounce(on);
  return (
    <TouchableOpacity
      style={[styles.navItem, on && styles.navItemOn]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {on ? <View style={styles.navMark} /> : null}
      <Animated.Text
        style={[styles.navIcon, on && styles.navIconOn, { transform: [{ scale: s }] }]}
      >
        {t.icon}
      </Animated.Text>
      <Text style={[styles.navText, on && styles.navTextOn]}>{t.title}</Text>
    </TouchableOpacity>
  );
}

// PC 端左侧导航（替代底部 tab bar）
function SideNav({ tab, onSelect, user }) {
  return (
    <View style={styles.side}>
      <View style={styles.brand}>
        <Image source={MASCOT} style={styles.brandLogo} />
        <View>
          <Text style={styles.brandName}>Avo 植物管家</Text>
          <Text style={styles.brandSlogan}>AI 植物健康助手</Text>
        </View>
      </View>

      <View style={styles.navList}>
        {TABS.map((t) => (
          <SideItem key={t.key} t={t} on={tab === t.key} onPress={() => onSelect(t.key)} />
        ))}
      </View>

      <View style={styles.sideFoot}>
        <Text style={styles.sideFootText}>
          {user ? `已登录 · ${user.nickname || user.username}` : '未登录 · 部分功能需要账号'}
        </Text>
      </View>
    </View>
  );
}

// 网页端支持用 hash 直接定位 tab（便于分享/演示/截图：#identify、#discover…）
function initialTab() {
  try {
    if (typeof window !== 'undefined' && window.location.hash) {
      const k = window.location.hash.replace('#', '');
      if (TABS.some((t) => t.key === k)) return k;
    }
  } catch { /* 原生端没有 window */ }
  return 'home';
}

export default function App() {
  const { isDesktop } = useLayout();
  const [tab, setTab] = useState(initialTab);
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  // 诊断页砧木方案卡片带参进入嫁接初筛：{scion, rootstock}，关闭弹层时清掉
  const [analyzePrefill, setAnalyzePrefill] = useState(null);
  const [trackId, setTrackId] = useState(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackReturnPlant, setTrackReturnPlant] = useState(null); // 追踪是从哪株植物的档案进来的
  const [openPlantId, setOpenPlantId] = useState(null);           // 追踪关掉后要回开的植物档案
  const [focusPost, setFocusPost] = useState(null); // 资料页点帖子 → 发现页直接开详情
  const [openDraftId, setOpenDraftId] = useState(null); // 通知里点「去草稿箱修改」→ 个人资料草稿箱
  const [linkedPlant, setLinkedPlant] = useState(null); // 识别页当前关联的植物（拍照记录）

  // 启动时若本地有 token，尝试恢复会话
  useEffect(() => {
    if (!getToken()) { setRestoring(false); return; }
    me().then((u) => setUser(u)).catch(() => setUser(null)).finally(() => setRestoring(false));
  }, []);

  // 网页端手动改地址栏 #xxx 也能切 tab（分享链接/刷新后仍停在原页）
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return undefined;
    const onHash = () => {
      const k = window.location.hash.replace('#', '');
      if (TABS.some((t) => t.key === k)) {
        if (k === 'identify') setLinkedPlant(null);
        setTab(k);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function handleLogout() {
    logout().catch(() => {});
    setUser(null);
  }

  function openTrack(id, plantId) {
    setTrackId(id);
    setTrackOpen(true);
    setTrackReturnPlant(plantId || null);
  }

  function closeTrack() {
    setTrackOpen(false);
    setTrackId(null); // 置空，下次再打开同一株才会重新拉数据
    // 从植物档案点进来的，关掉追踪后回那株植物的档案
    if (trackReturnPlant) {
      setOpenPlantId(trackReturnPlant);
      setTrackReturnPlant(null);
    }
  }

  // 普通识别：不从植物档案进的，一律解除植物关联，
  // 否则首页相机按钮会把结果误记到上次那株植物身上
  function switchTab(key) {
    if (key === 'identify') setLinkedPlant(null);
    // PC 上侧边栏在弹层打开时仍然可点，切 tab 得把 App 级弹层收掉，
    // 否则会看到「换了页但嫁接初筛还盖在上面」
    setAnalyzeOpen(false);
    setTrackOpen(false);
    setTrackId(null);
    setTab(key);
    try {
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState(null, '', `#${key}`);
      }
    } catch { /* 原生端忽略 */ }
  }

  // 从植物档案点「拍照记录」：切到诊断页，并告诉它这次是为哪株植物记录
  function goIdentifyForPlant(plant) {
    if (!plant) { setTab('identify'); return; }
    setLinkedPlant({ id: plant.id, nickname: plant.nickname });
    setTab('identify');
  }

  // 识别结果页点「查看档案」：切到我的花园并打开该植物档案
  function openPlant(id) {
    setOpenPlantId(id);
    setTab('garden');
  }

  // 跳到发现页并直接打开某帖（个人资料页的收藏/点赞/评论用）
  function openPost(id) {
    setFocusPost(id);
    setTab('discover');
  }

  // 通知里点被下架的帖子：切到个人资料 → 草稿箱，并直接打开这条草稿的编辑页
  function openDraft(id) {
    setOpenDraftId(id);
    setTab('profile');
  }

  if (restoring) {
    return (
      <View style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.greenDark} />
      </View>
    );
  }

  return (
    <View style={[styles.root, isDesktop && styles.rootRow]}>
      <StatusBar style="dark" />
      {isDesktop && <SideNav tab={tab} onSelect={switchTab} user={user} />}

      <View style={styles.main}>
        <View style={styles.content}>
          {tab === 'home' && (
            <HomeScreen
              user={user}
              onGoTab={switchTab}
              onOpenAnalyze={() => setAnalyzeOpen(true)}
              onOpenTrack={openTrack}
              onGoIdentifyPlant={goIdentifyForPlant}
              openPlantId={openPlantId}
              onPlantOpened={() => setOpenPlantId(null)}
              onOpenPost={openPost}
              onOpenDraft={openDraft}
            />
          )}
          {tab === 'identify' && (
            <IdentifyScreen
              user={user}
              onGoProfile={() => setTab('profile')}
              linkedPlant={linkedPlant}
              onOpenPlant={openPlant}
              onGotoGraft={(p) => { setAnalyzePrefill(p); setAnalyzeOpen(true); }}
            />
          )}
          {tab === 'discover' && (
            <CommunityScreen
              focusPostId={focusPost}
              onFocusConsumed={() => setFocusPost(null)}
              onGoProfile={() => setTab('profile')}
            />
          )}
          {tab === 'garden' && (
            user
              ? <GardenScreen
                  user={user}
                  onOpenTrack={openTrack}
                  onGoIdentify={goIdentifyForPlant}
                  onGoHome={() => switchTab('home')}
                  openPlantId={openPlantId}
                  onPlantOpened={() => setOpenPlantId(null)}
                />
              : <ProfileScreen user={null} onLogin={setUser} onLogout={handleLogout} />
          )}
          {tab === 'profile' && (
            <ProfileScreen
              user={user}
              onLogin={setUser}
              onLogout={handleLogout}
              onOpenPost={openPost}
              openDraftId={openDraftId}
              onDraftOpened={() => setOpenDraftId(null)}
            />
          )}
        </View>

        {!isDesktop && <TabBar tab={tab} onSelect={switchTab} />}
      </View>

      {/* 嫁接初筛（原「嫁接」tab，弹层保留）；诊断页砧木方案可带参预填进来 */}
      <Modal
        visible={analyzeOpen}
        animationType="slide"
        onRequestClose={() => { setAnalyzeOpen(false); setAnalyzePrefill(null); }}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalInner}>
            <View style={[styles.modalHead, isDesktop && styles.modalHeadPc]}>
              <TouchableOpacity
                onPress={() => { setAnalyzeOpen(false); setAnalyzePrefill(null); }}
              >
                <Text style={styles.modalBack}>‹ 关闭</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>嫁接初筛</Text>
              <View style={{ width: 70 }} />
            </View>
            <AnalyzeScreen prefill={analyzePrefill} user={user} />
          </View>
        </View>
      </Modal>

      {/* 健康追踪（植物档案 → 查看曲线，弹层保留） */}
      <Modal visible={trackOpen} animationType="slide" onRequestClose={closeTrack}>
        <View style={styles.modalWrap}>
          <View style={styles.modalInner}>
            <View style={[styles.modalHead, isDesktop && styles.modalHeadPc]}>
              <TouchableOpacity onPress={closeTrack}>
                <Text style={styles.modalBack}>‹ 返回</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>健康追踪</Text>
              <View style={{ width: 70 }} />
            </View>
            <TrackScreen focusTrackId={trackId} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  rootRow: { flexDirection: 'row' },
  // minWidth:0 + overflow:hidden：内容再宽也只能撑自己，挤不动侧边栏
  main: { flex: 1, minWidth: 0, overflow: 'hidden' },
  // PC 上内容区居中限宽，别让卡片拉成一整行
  content: { flex: 1, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },

  // 左侧导航（仅 PC）
  side: {
    width: SIDENAV_W, flexShrink: 0, flexGrow: 0, backgroundColor: '#fff',
    borderRightWidth: 1, borderRightColor: C.border,
    paddingTop: 26, paddingHorizontal: 14,
  },
  brand: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, marginBottom: 26 },
  brandLogo: { width: 42, height: 42, marginRight: 10 },
  brandName: { fontSize: 17, fontWeight: '900', color: '#1F3D10' },
  brandSlogan: { fontSize: 11, color: C.sub, marginTop: 3 },
  navList: { flex: 1 },
  navItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: 12, marginBottom: 4,
  },
  navItemOn: { backgroundColor: C.greenTint },
  navIcon: { fontSize: 18, marginRight: 10, opacity: 0.5 },
  navIconOn: { opacity: 1 },
  navText: { fontSize: 14, color: C.sub, fontWeight: '600' },
  navTextOn: { color: C.greenDark, fontWeight: '800' },
  // PC 导航选中项左侧那条竖线
  navMark: {
    position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
    borderRadius: 2, backgroundColor: C.green,
  },
  sideFoot: { paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#F0F0EA' },
  sideFootText: { fontSize: 11, color: C.sub, lineHeight: 16 },

  // 底部 tab（自带一条会滑的指示条）
  tabBar: {
    position: 'relative', backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: C.border, paddingBottom: 6,
  },
  tabRow: { flexDirection: 'row' },
  tabIndWrap: {
    position: 'absolute', top: -1, left: 0, height: 3,
    alignItems: 'center', zIndex: 2,
  },
  tabInd: { width: '34%', height: 3, borderRadius: 2, backgroundColor: C.green },
  tabItem: { flex: 1, paddingTop: 10, paddingBottom: 8, alignItems: 'center' },
  tabIcon: { fontSize: 20, opacity: 0.45 },
  tabIconOn: { opacity: 1 },
  tabText: { fontSize: 12, color: C.sub, marginTop: 3 },
  tabActive: { color: C.greenDark, fontWeight: '800' },

  modalWrap: { flex: 1, backgroundColor: C.bg },
  modalInner: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center', backgroundColor: C.bg },
  modalHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 50, paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#E4EDDA', backgroundColor: C.bg,
  },
  modalHeadPc: { paddingTop: 18, paddingHorizontal: 24 },
  modalBack: { color: C.sub, fontSize: 15, width: 70 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: C.text },
});
