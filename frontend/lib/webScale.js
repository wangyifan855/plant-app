// 桌面浏览器整体等比缩放。
//
// 移动优先写出来的 UI，字号/间距/图标都是按手机尺寸定的；直接铺到 2K/4K 屏上就会
// 变成「一小撮内容飘在大白板中间」。这里不逐处改字号（那样字变大了间距还是小的，
// 反而更挤），而是把整个应用当成设计稿整体放大：布局宽度固定按 DESIGN_WIDTH 算，
// 再按窗口宽度等比 scale，等价于浏览器缩放。
//
// 只在 web 生效，原生 App 完全不受影响。

export const DESIGN_WIDTH = 1080; // 小于等于这个宽度按 1 倍显示；调小=整屏放大（字更大）
const MAX_SCALE = 2;              // 超宽屏封顶，避免字大得离谱
export const SIDENAV_W = 232;     // PC 左侧导航宽度（App 的 styles.side 用同一个值）
const DESKTOP_MIN = 1024;         // 与 lib/responsive 的断点保持一致

export function uiScale(width) {
  const w = width || (typeof window !== 'undefined' ? window.innerWidth : 0) || DESIGN_WIDTH;
  return Math.min(MAX_SCALE, Math.max(1, w / DESIGN_WIDTH));
}

function apply() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const w = window.innerWidth;
  document.documentElement.style.setProperty('--ui-scale', String(uiScale(w)));
  // 弹层让出侧边栏的位置：PC 上导航要一直挂着
  document.documentElement.style.setProperty('--side-w', w >= DESKTOP_MIN ? `${SIDENAV_W}px` : '0px');
}

// RN-web 的每个 <Modal> 都会往 body 挂一个空的传送门 div（没打开时里面是空的）。
// 给这些 div 设全屏定位会把整页点击吃掉，所以只给「真的有内容」的传送门打标记，
// 用 JS 维护 class 而不是依赖 CSS :has()（老内核不支持）。
const PORTAL_CLASS = 'ui-modal-portal';

function markPortal(el) {
  const hasContent = el.childElementCount > 0;
  if (hasContent && !el.classList.contains(PORTAL_CLASS)) el.classList.add(PORTAL_CLASS);
  if (!hasContent && el.classList.contains(PORTAL_CLASS)) el.classList.remove(PORTAL_CLASS);
}

function isPortal(el) {
  return el && el.tagName === 'DIV' && el.id !== 'root';
}

let observer = null;

function watchPortals() {
  if (!observer || !document.body) return;
  [...document.body.children].filter(isPortal).forEach((el) => {
    if (el.__uiPortalWatched) return;
    el.__uiPortalWatched = true;
    markPortal(el);
    // 弹层打开/关闭时，变的是这个传送门自己的子节点
    observer.observe(el, { childList: true });
  });
}

function syncAll() {
  [...document.body.children].filter(isPortal).forEach(markPortal);
}

function startPortalWatch() {
  if (observer || typeof MutationObserver === 'undefined' || !document.body) return;
  observer = new MutationObserver(() => {
    watchPortals();  // 新出现的传送门
    syncAll();       // 已有传送门的内容变化
  });
  observer.observe(document.body, { childList: true });
  watchPortals();
}

let installed = false;

export function installWebScale() {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') return;
  installed = true;

  const style = document.createElement('style');
  style.id = 'ui-scale-reset';
  style.textContent = `
    /* #root 是 App 挂载点 */
    #root {
      width: calc(100% / var(--ui-scale, 1)) !important;
      height: calc(100% / var(--ui-scale, 1)) !important;
      transform: scale(var(--ui-scale, 1));
      transform-origin: 0 0;
    }
    /* 打开中的弹层传送门（有内容），要跟着一起缩放。
       PC 上让出左侧导航的宽度，这样打开植物档案/发帖这类整页弹层时，
       侧边栏仍然留在原地，返回键正好在导航右边。
       注意 left 必须乘上缩放倍数：--side-w 是设计像素（232），而导航在 #root
       里被放大过，实际屏幕宽度是 232*scale；不乘的话弹层会左移压住侧边栏、
       右边漏出一条底色（宽屏下越明显）。 */
    body > div.${PORTAL_CLASS} {
      position: fixed !important;
      top: 0 !important;
      left: calc(var(--side-w, 0px) * var(--ui-scale, 1)) !important;
      width: calc(100% / var(--ui-scale, 1) - var(--side-w, 0px)) !important;
      height: calc(100% / var(--ui-scale, 1)) !important;
      transform: scale(var(--ui-scale, 1));
      transform-origin: 0 0;
    }
    /* 万一标记了但其实是空的，别让它挡住点击 */
    body > div.${PORTAL_CLASS}:empty {
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);

  apply();
  startPortalWatch();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
}
