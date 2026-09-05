/* MxScout — the admin-port bridge: ONE small snippet pasted into a tab open
 * on the Mendix Runtime's admin port itself (http://host:8090/, a DIFFERENT
 * origin than the app being tested), so it can call that API same-origin —
 * no CORS, no server involved — and report what it reads back to MxScout.
 *
 * This is the same shape as public/bridge.js (paste a real script, generated
 * here and serialized with Function.prototype.toString(), into a tab on the
 * TARGET's own origin), applied to a different target. It is smaller because
 * the admin port has no UI to fall back into and nothing to pick: it only
 * ever does one thing, on or off, decided by MxScout.
 *
 * The admin password (CFG.password) is typed into MxScout once, by hand —
 * MxScout cannot read it itself, see public/perf.js's password-reveal
 * script — and travels no further than the config baked into THIS pasted
 * script. It is used only to build the auth header for requests this tab
 * makes to its OWN origin; it is never sent to MxScout, never logged, and
 * never written anywhere.
 *
 * CFG.palette (see live.js's currentPalette, passed through by perf.js) is
 * read live off MxScout's own stylesheet, so this tab's badge and bridge.js's
 * app-tab badge are the SAME component drawing in the SAME colours — one
 * bottom-right-corner popup design, not two that happen to look different.
 */
(function () {
  'use strict';

  // Everything below runs on the ADMIN PORT'S page, not on MxScout's. Like
  // bridge.js's bridgeBody, it may reference only its own argument and
  // browser globals — no closure over anything in this file.
  function adminBridgeBody(CFG) {
    // ---------- production guard ----------
    // The same whole-token, fail-closed check as bridge.js and live.js's
    // classifyAppUrl — a separate copy on purpose, because this is the copy
    // that actually runs, on the tab's own location.
    var NONPROD = {
      dev: 1, development: 1, test: 1, testing: 1, tst: 1,
      accept: 1, acceptance: 1, acc: 1, acp: 1, accp: 1,
      sandbox: 1, staging: 1, stage: 1, uat: 1, qa: 1, local: 1
    };
    function envAllowed(host) {
      host = (host || '').toLowerCase().replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
          host.slice(-6) === '.local' || host.slice(-10) === '.localhost') return true;
      var t = host.split(/[.\-]/);
      for (var i = 0; i < t.length; i++) { if (NONPROD[t[i]]) return true; }
      return false;
    }
    if (!envAllowed(location.hostname)) {
      console.error('MxScout: this environment is not supported. Nothing was read or sent.');
      return;
    }

    // ---------- tiny DOM kit ----------
    // Same palette-driven look as bridge.js's badge — see the file header:
    // CFG.palette makes this the SAME component, not a second hand-rolled one.
    var P = CFG.palette || {
      panel: '#1a1a1a', text: '#ededed', border: '#2e2e2e', accent: '#e8a33d', alarm: '#ff6b6b'
    };
    function mk(tag, css, text) {
      var n = document.createElement(tag);
      if (css) n.style.cssText = css;
      if (text != null) n.textContent = String(text);
      return n;
    }
    function add(parent, child) { parent.appendChild(child); return child; }
    var FONT = '13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

    // The same three-dot mark bridge.js's badge draws, so both popups read as
    // the same tool at a glance.
    function logoMark() {
      var wrap = mk('div', 'position:relative;width:18px;height:18px;flex:none;');
      [[0, 6], [12, 0], [12, 12]].forEach(function (pt) {
        add(wrap, mk('div', 'position:absolute;left:' + pt[0] + 'px;top:' + pt[1] + 'px;width:6px;height:6px;' +
          'border-radius:50%;background:' + P.accent + ';'));
      });
      return wrap;
    }

    function panel(border) {
      return mk('div', 'position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:300px;' +
        'display:flex;align-items:center;gap:8px;background:' + P.panel + ';color:' + P.text + ';font:' + FONT + ';' +
        'padding:8px 12px;border:1px solid ' + P.border + ';border-left:3px solid ' + border + ';border-radius:9px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.45);');
    }

    function showError(text) {
      var p = panel(P.alarm);
      add(p, logoMark());
      add(p, mk('span', '', text));
      document.body.appendChild(p);
    }

    var badge = null;
    function showBadge() {
      badge = panel(P.accent);
      add(badge, logoMark());
      var txt = add(badge, mk('span', '', 'Connected — idle'));
      var x = add(badge, mk('span', 'cursor:pointer;opacity:.6;padding-left:4px;', '✕'));
      x.addEventListener('click', function () { running = false; if (tickTimer) clearInterval(tickTimer); badge.parentNode.removeChild(badge); badge = null; });
      document.body.appendChild(badge);
      badge.__txt = txt;
      return badge;
    }
    function setBadgeText(text) { if (badge && badge.__txt) badge.__txt.textContent = text; }

    // ---------- talking to the admin API on OUR OWN origin ----------
    // base64(UTF-8 password) in X-M2EE-Authentication — the same protocol the
    // password-reveal PS1's comment documents, just built here in JS instead
    // of PowerShell's [Convert]::ToBase64String.
    function toBase64Utf8(str) {
      var bytes = new TextEncoder().encode(str);
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    var AUTH = toBase64Utf8(CFG.password);

    function invokeAdmin(action, done) {
      fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-M2EE-Authentication': AUTH },
        body: JSON.stringify({ action: action, params: {} })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(done)
        .catch(function () { done(null); });
    }

    // ---------- reporting to MxScout ----------
    function post(url, payload) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    var running = true;
    var recording = false;
    var tickTimer = null;
    var startedAt = 0;
    var sampleCount = 0;

    function nowMs() {
      return (window.performance && typeof performance.now === 'function') ? performance.now() : Date.now();
    }

    function tick() {
      if (!recording) return;
      var pending = 2, requests = null, stats = null;
      function settle() { if (--pending === 0) report(); }
      invokeAdmin('get_current_runtime_requests', function (r) { requests = r; settle(); });
      invokeAdmin('runtime_statistics', function (r) { stats = r; settle(); });
      function report() {
        var hasRequests = requests && typeof requests === 'object' && Object.keys(requests).length > 0;
        if (!hasRequests && !stats) return; // nothing worth a sample this tick
        post(CFG.origin + '/api/session/perf/sample', {
          token: CFG.token,
          t: Math.round(nowMs() - startedAt),
          requests: hasRequests ? requests : {},
          stats: stats || null
        }).catch(function () {});
        sampleCount++;
        setBadgeText('Recording… ' + sampleCount + ' sample' + (sampleCount === 1 ? '' : 's'));
      }
    }

    function startTicking() {
      if (tickTimer) return;
      startedAt = nowMs();
      sampleCount = 0;
      setBadgeText('Recording… 0 samples');
      tickTimer = setInterval(tick, CFG.intervalMs);
    }
    function stopTicking() {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      setBadgeText('Connected — idle');
    }

    // Long-poll for "should I be recording right now" — same idea as
    // bridge.js's command poll, but there is no one-shot command here, only a
    // desired on/off state. `known` tells the server what THIS tab currently
    // believes, so it can answer at once when that is already stale.
    var firstPoll = true;
    function pollLoop() {
      if (!running) return;
      var url = CFG.origin + '/api/session/perf/poll?wait=1&token=' + encodeURIComponent(CFG.token);
      if (!firstPoll) url += '&known=' + (recording ? '1' : '0');
      fetch(url)
        .then(function (r) {
          if (r.status === 403) {
            running = false;
            setBadgeText('This code is out of date — reconnect in MxScout.');
            return null;
          }
          return r.json();
        })
        .then(function (data) {
          firstPoll = false;
          if (!data) return;
          var wantsRecording = !!data.active;
          if (wantsRecording !== recording) { recording = wantsRecording; if (recording) startTicking(); else stopTicking(); }
        })
        .catch(function () {})
        .then(function () { if (running) setTimeout(pollLoop, 150); });
    }

    // ---------- boot ----------
    fetch(CFG.origin + '/api/session/ping?token=' + encodeURIComponent(CFG.token))
      .then(function (r) { if (!r.ok) throw new Error(); })
      .then(function () {
        showBadge();
        pollLoop();
      })
      .catch(function () {
        showError('Could not reach MxScout at ' + CFG.origin + '. Keep this tab open, and check that MxScout is running on this same machine.');
      });
  }

  function buildScript(cfg) {
    return '(' + adminBridgeBody.toString() + ')(' + JSON.stringify(cfg) + ');';
  }

  window.MxAdminBridge = { buildScript: buildScript, adminBridgeBody: adminBridgeBody };
})();
