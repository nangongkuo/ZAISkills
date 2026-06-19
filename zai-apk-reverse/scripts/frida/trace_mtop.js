// trace_mtop_v2.js - 阿里系 mtop 通用追踪（淘宝/支付宝/天猫/闲鱼）
// 用法: frida -U -f <pkg> -l lib/_common.js -l trace_mtop_v2.js
// 或（合并版）: cat lib/_common.js trace_mtop_v2.js | frida -U -f <pkg> -

Java.perform(function () {
  var H = createHelper('mtop');
  H.log('=== trace_mtop_v2 ready (after Agree / 进首页) ===');

  // --- 1. MtopBuilder.asyncRequest / syncRequest（主入口）---
  H.waitForClass('mtopsdk.mtop.intf.MtopBuilder', function (MB) {
    H.hookOverloads(MB, 'asyncRequest', function (args, sig) {
      try {
        var req = this.request.value;
        var api = req.getApiName(), v = req.getVersion();
        var seq = H.bump('req');
        H.log('REQ #' + seq + ' [async/' + sig.length + 'p] api=' + api + ' v=' + v);
        H.dumpString('REQ#' + seq + '.data', req.getData() || '');
        try { H.dumpString('REQ#' + seq + '.headers', H.safeJson(this.headers.value)); } catch (e) {}
      } catch (e) { H.warn('REQ parse: ' + e); }
    });

    try {
      MB.syncRequest.implementation = function () {
        try {
          var req = this.request.value;
          var seq = H.bump('req');
          H.log('REQ #' + seq + ' [sync] api=' + req.getApiName() + ' v=' + req.getVersion());
          H.dumpString('REQ#' + seq + '.data', req.getData() || '');
        } catch (e) {}
        return this.syncRequest();
      };
    } catch (e) {}
  });

  // --- 2. MtopResponse.setBytedata（响应字节，每条都拿）---
  H.waitForClass('mtopsdk.mtop.domain.MtopResponse', function (MR) {
    MR.setBytedata.implementation = function (bytes) {
      try {
        var api = this.api.value || '';
        var v = this.v.value || '';
        var size = bytes ? bytes.length : 0;
        var seq = H.bump('resp');
        H.log('RESP #' + seq + ' api=' + api + ' v=' + v + ' size=' + size);
        if (bytes) H.dumpBytes('RESP#' + seq + '.body', bytes);
      } catch (e) { H.warn('RESP: ' + e); }
      return this.setBytedata(bytes);
    };
    H.log('[OK] MtopResponse.setBytedata hooked');
  });

  // --- 3. anet 网络层 URL（兜底，看到真实 HTTPS URL）---
  H.waitForClass('anet.channel.request.Request', function (ARQ) {
    ARQ.getBodyBytes.implementation = function () {
      var r = this.getBodyBytes();
      try {
        var url = this.getUrlString();
        if (url && url.indexOf('mtop') >= 0) {
          H.log('[anet] ' + H.trunc(url, 300));
        }
      } catch (e) {}
      return r;
    };
  });

  // --- 4. Nav 跳转（首页 icon 点击触发的 Activity / H5 跳转）---
  H.waitForClass('com.taobao.android.nav.Nav', function (Nav) {
    H.hookOverloads(Nav, 'toUri', function (args, sig) {
      try { H.log('[Nav.toUri] ' + (args[0] ? args[0].toString() : 'null')); } catch (e) {}
    });
  });

  // --- 5. WebView（含 UC 内核） URL ---
  H.waitForClass('android.webkit.WebView', function (WV) {
    try {
      WV.loadUrl.overload('java.lang.String').implementation = function (u) {
        H.log('[WV.loadUrl] ' + H.trunc(u, 500));
        return this.loadUrl(u);
      };
    } catch (e) {}
  });

  H.waitForClass('com.uc.webview.export.WebView', function (UCW) {
    try {
      UCW.loadUrl.overload('java.lang.String').implementation = function (u) {
        H.log('[UC.loadUrl] ' + H.trunc(u, 500));
        return this.loadUrl(u);
      };
    } catch (e) {}
  }, 30);

  H.heartbeat(5);
  H.log('=== mtop hooks staged, waiting class loads ===');
});
