/**
 * 网校自动确认 —— content script
 * 作用：检测播放页的「学习验证」弹窗，自动点击「确定」，并确保视频恢复播放。
 * 只在 usc.gzgs.edu.cn 生效（见 manifest.json 的 matches）。
 */
(function () {
  'use strict';

  // 避免同一页面重复注入（SPA 路由切换等情况）
  if (window.__GZGS_AUTO_CONFIRM_LOADED__) return;
  window.__GZGS_AUTO_CONFIRM_LOADED__ = true;

  // ---------------- 配置 ----------------
  // 弹窗正文里出现这些词，就认定是「防刷课验证」弹窗
  var VERIFY_WORDS = [
    '学习验证',
    '视频已暂停',
    '真人观看',
    '是否在观看',
    '请手动点击',
    '确认是真人'
  ];

  // 可以安全点击的按钮文本（先精确匹配，再做包含匹配兜底）
  var BTN_TEXT_EXACT = [
    '确定', '确认', '继续学习', '继续播放', '继续',
    '我知道了', '已知晓', '我还在看', '知道了', '好的', '是'
  ];

  var CLICK_COOLDOWN = 1200;   // 两次点击最小间隔（毫秒）
  var POLL_INTERVAL = 1200;    // 兜底轮询间隔（毫秒）

  var DELAY_MIN = 1200;        // 检测到弹窗后最短等待（毫秒）
  var DELAY_MAX = 3600;        // 最长等待——模拟真人反应，太快容易被判脚本

  var clickCount = 0;
  var enabled = true;
  var lastClickAt = 0;
  var badgeEl = null;
  var observerTimer = null;
  var pollTimer = null;
  var pendingBox = null;       // 已排队的弹窗，避免重复排
  var pendingTimer = null;

  // ---------------- 工具函数 ----------------

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    var st = window.getComputedStyle(el);
    if (!st) return false;
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    if (parseFloat(st.opacity) === 0) return false;
    return true;
  }

  function textOf(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || el.value || '').trim();
  }

  // 判断元素是否处在一个「浮层」里（弹窗 / 遮罩 / 蒙层）
  function insideFloatingLayer(el) {
    var node = el;
    var depth = 0;
    while (node && node !== document.documentElement && depth < 12) {
      var cls = (node.className && node.className.baseVal !== undefined)
        ? node.className.baseVal
        : (node.className || '');
      cls = String(cls);
      if (/dialog|modal|popup|mask|overlay|layer|confirm|message-box|alert|verify|popper/i.test(cls)) {
        return true;
      }
      var st = window.getComputedStyle(node);
      if (st && st.position === 'fixed') {
        var z = parseInt(st.zIndex, 10);
        if (!isNaN(z) && z >= 100) return true;
      }
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  // ---------------- 找弹窗 ----------------

  function findVerifyBox() {
    var i, box, txt;

    // 1) 优先：Element UI / 常见弹窗容器
    var primarySelectors = [
      '.el-message-box',
      '.el-message-box__wrapper',
      '.el-dialog',
      '[class*="message-box"]',
      '[class*="messageBox"]',
      '[class*="dialog"]',
      '[class*="modal"]'
    ];
    for (i = 0; i < primarySelectors.length; i++) {
      var list = document.querySelectorAll(primarySelectors[i]);
      for (var j = 0; j < list.length; j++) {
        box = list[j];
        if (!isVisible(box)) continue;
        txt = textOf(box);
        if (txt.length > 600) continue;
        for (var k = 0; k < VERIFY_WORDS.length; k++) {
          if (txt.indexOf(VERIFY_WORDS[k]) !== -1) return box;
        }
      }
    }

    // 2) 兜底：任何可见的小块元素，文本里带验证词，且处在浮层中
    var all = document.querySelectorAll('div, section, article, aside');
    for (i = 0; i < all.length; i++) {
      box = all[i];
      if (!isVisible(box)) continue;
      txt = textOf(box);
      if (txt.length === 0 || txt.length > 400) continue;
      var hit = false;
      for (var m = 0; m < VERIFY_WORDS.length; m++) {
        if (txt.indexOf(VERIFY_WORDS[m]) !== -1) { hit = true; break; }
      }
      if (!hit) continue;
      if (insideFloatingLayer(box)) return box;
    }

    return null;
  }

  // ---------------- 点按钮 ----------------

  function scoreButton(el) {
    var s = 0;
    var tag = el.tagName;
    var cls = String(el.className || '');
    if (tag === 'BUTTON') s += 20;
    if (cls.indexOf('el-button') !== -1) s += 15;
    if (/button|btn/i.test(cls)) s += 10;
    if (/primary|confirm|ok|success/i.test(cls)) s += 6;
    if (tag === 'INPUT') s += 8;
    if (tag === 'A' || tag === 'SPAN' || tag === 'DIV') s -= 5;
    return s;
  }

  function findClickTarget(box) {
    var candidates = box.querySelectorAll(
      'button, .el-button, input[type="button"], input[type="submit"], [role="button"], a, span, div'
    );
    var exact = [];
    var fuzzy = [];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var t = textOf(el);
      if (!t || t.length > 12) continue;

      if (BTN_TEXT_EXACT.indexOf(t) !== -1) {
        exact.push(el);
      } else {
        for (var j = 0; j < BTN_TEXT_EXACT.length; j++) {
          var w = BTN_TEXT_EXACT[j];
          if (w.length >= 2 && t.indexOf(w) !== -1) { fuzzy.push(el); break; }
        }
      }
    }

    function pick(arr) {
      if (!arr.length) return null;
      arr.sort(function (a, b) { return scoreButton(b) - scoreButton(a); });
      // 只点最"像按钮"的那个，且要求它真的是按钮形态
      return scoreButton(arr[0]) > 0 ? arr[0] : arr[0];
    }

    return pick(exact) || pick(fuzzy);
  }

  // ---------------- 恢复播放 ----------------

  function resumeVideo() {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      try {
        if (v.paused && !v.ended && v.readyState >= 2) {
          var p = v.play();
          if (p && typeof p.catch === 'function') p.catch(function () {});
        }
      } catch (e) { /* 忽略 */ }
    }
  }

  // ---------------- 主扫描 ----------------

  function doClick(reason) {
    var box = findVerifyBox();
    if (!box) return;

    var now = Date.now();
    if (now - lastClickAt < CLICK_COOLDOWN) return;

    var target = findClickTarget(box);
    if (!target) {
      log('找到验证弹窗，但没找到可点的按钮');
      return;
    }

    try {
      target.click();
    } catch (e) {
      // 有些框架需要派发真实事件
      try {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (e2) {
        log('点击失败: ' + e2.message);
        return;
      }
    }

    lastClickAt = Date.now();
    clickCount++;
    log('已自动确认第 ' + clickCount + ' 次（触发: ' + (reason || 'poll') + '）');
    updateBadge();

    // 弹窗关掉后确认视频有没有恢复，没有就补一刀
    setTimeout(resumeVideo, 800);
    setTimeout(resumeVideo, 2000);
  }

  function scan(reason) {
    if (!enabled) return;

    var box = findVerifyBox();
    if (!box) {
      pendingBox = null;   // 弹窗已消失，重置排队状态
      return;
    }

    // 已经排队等点击了，别重复排
    if (pendingBox === box) return;

    // 刚点过，冷却中
    if (Date.now() - lastClickAt < CLICK_COOLDOWN) return;

    pendingBox = box;
    var delay = DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN));
    log('检测到验证弹窗，' + (delay / 1000).toFixed(1) + ' 秒后自动确认');

    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      pendingBox = null;
      doClick(reason);
    }, delay);
  }

  // ---------------- 状态徽标 ----------------

  function ensureBadge() {
    if (badgeEl && document.documentElement.contains(badgeEl)) return badgeEl;

    badgeEl = document.createElement('div');
    badgeEl.id = '__gzgs_auto_confirm_badge';
    badgeEl.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'gap:5px',
      'padding:5px 11px',
      'border-radius:16px',
      'font:12px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
      'color:#fff',
      'box-shadow:0 2px 10px rgba(0,0,0,.22)',
      'cursor:pointer',
      'user-select:none',
      'opacity:.88',
      'transition:background .2s,opacity .2s'
    ].join(';');

    badgeEl.addEventListener('click', function () {
      enabled = !enabled;
      updateBadge();
      log(enabled ? '已启用自动确认' : '已暂停自动确认');
    });

    (document.body || document.documentElement).appendChild(badgeEl);
    updateBadge();
    return badgeEl;
  }

  function updateBadge() {
    var el = ensureBadge();
    if (!el) return;
    el.style.background = enabled ? 'rgba(7,193,96,.92)' : 'rgba(140,140,140,.92)';
    el.textContent = enabled ? ('✓ 自动确认 ' + clickCount) : '⏸ 已暂停';
    el.title = enabled
      ? '网校自动确认已启用｜已自动点击 ' + clickCount + ' 次｜点击可暂停'
      : '网校自动确认已暂停｜点击恢复';
  }

  function log(msg) {
    try { console.log('%c[网校助手] ' + msg, 'color:#07c160;font-weight:bold'); } catch (e) {}
  }

  // ---------------- 启动 ----------------

  function start() {
    // 注入 MAIN world 脚本，兜底拦截原生 confirm/alert
    try {
      var s = document.createElement('script');
      s.src = chrome.runtime.getURL('inject.js');
      s.onload = function () { this.remove(); };
      s.onerror = function () { this.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* 忽略 */ }

    // 接收注入脚本的回传
    window.addEventListener('message', function (e) {
      if (e.source !== window || !e.data || e.data.__gzgs !== 'native-dialog') return;
      if (!enabled) return;
      clickCount++;
      log('拦截到原生 ' + e.data.kind + '：「' + String(e.data.msg).slice(0, 60) + '」');
      updateBadge();
      setTimeout(resumeVideo, 600);
    });

    // MutationObserver：DOM 一变就扫
    try {
      var mo = new MutationObserver(function () {
        if (observerTimer) return;
        observerTimer = setTimeout(function () {
          observerTimer = null;
          scan('mutation');
        }, 220);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* 忽略 */ }

    // 兜底轮询（防止某些弹窗不走 DOM 变更）
    pollTimer = setInterval(function () { scan('poll'); }, POLL_INTERVAL);

    // 首次扫描
    setTimeout(function () { scan('init'); }, 800);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        ensureBadge();
        scan('dom-ready');
      });
    } else {
      ensureBadge();
    }
  }

  start();
})();
