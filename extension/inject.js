/**
 * 网校自动确认 —— 注入到页面主环境（MAIN world）的兜底脚本
 * 作用：如果平台用原生 confirm()/alert() 弹验证，直接放行，不让它卡住播放。
 * 只对 confirm 返回 true；alert 不阻塞但把内容回传给 content.js 记录下来。
 */
(function () {
  'use strict';

  if (window.__GZGS_INJECT_LOADED__) return;
  window.__GZGS_INJECT_LOADED__ = true;

  function report(kind, msg) {
    try {
      window.postMessage({
        __gzgs: 'native-dialog',
        kind: kind,
        msg: String(msg == null ? '' : msg).slice(0, 300)
      }, '*');
    } catch (e) { /* 忽略 */ }
  }

  // ---- confirm：一律当作「确定」 ----
  var nativeConfirm = window.confirm;
  window.confirm = function (msg) {
    report('confirm', msg);
    return true;
  };
  window.confirm.__gzgs_wrapped = true;
  window.confirm.toString = function () { return 'function confirm() { [native code] }'; };

  // ---- alert：不阻塞，内容回传 ----
  var nativeAlert = window.alert;
  window.alert = function (msg) {
    report('alert', msg);
    // 保留可读性：不弹原生框，但保留原生调用能力（注释掉即为完全静默）
    return undefined;
  };
  window.alert.__gzgs_wrapped = true;
  window.alert.toString = function () { return 'function alert() { [native code] }'; };

  // ---- 顺带记录一下（方便排查） ----
  try {
    console.log('%c[网校助手] 注入脚本已就绪，原生 confirm/alert 已接管', 'color:#07c160;font-weight:bold');
  } catch (e) { /* 忽略 */ }
})();
