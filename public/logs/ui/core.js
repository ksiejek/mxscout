/* MxScout — Log analysis: shared plumbing for the screens in this folder.
 *
 * What lives here is everything more than one tool needs and none of them owns: building elements,
 * reading a file (including the .gz a Mendix Cloud download arrives as), parsing it off the main
 * thread, the one-file-shared-by-every-tool bar (the Data Hub), moving between tools, and the three
 * little overlays — a progress veil, a toast with Undo, and a dialog.
 *
 * Log analysis comes from MxDevSwissTool by Mikołaj (RealMecowhy), MIT — see THIRD-PARTY-NOTICES.md.
 * The analysis engines are in ../engine/ and are that project's code, carried over unchanged; the
 * screens in this folder are MxScout's own, built on its conventions:
 *
 *   - No markup is ever assigned. Everything on screen is built from elements, and text only ever
 *     goes in as text — a log is somebody else's data, and a log line is the most natural place there
 *     is to hide a <script>. (MxScout's About page says exactly one place assigns markup; this is not
 *     a second one.)
 *   - Nothing leaves this tab and nothing is written anywhere. A loaded log lives in memory until the
 *     page is closed; no storage, no request, no CDN.
 *   - Workers are files on this origin (the Content-Security-Policy allows no blob: scripts).
 */
(function () {
  'use strict';

  var L = window.MxLogs = { tools: {}, w: {} };

  // ---------- elements ----------
  // `text` is textContent, `class` is className, `on…` attaches a listener, the form-state names are
  // properties rather than attributes (an attribute only sets the DEFAULT of an input), and there is
  // deliberately no `html`.
  var PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, hidden: 1, indeterminate: 1, scrollTop: 1 };

  function add(node, children) {
    if (children == null || children === false) return;
    if (Array.isArray(children)) { children.forEach(function (c) { add(node, c); }); return; }
    if (typeof children === 'string' || typeof children === 'number') { node.appendChild(document.createTextNode(String(children))); return; }
    node.appendChild(children);
  }

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.className = v;
        else if (k === 'style') node.style.cssText = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (PROPS[k]) node[k] = v;
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    add(node, children);
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'class') node.setAttribute('class', v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    add(node, children);
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function replace(node, children) { clear(node); add(node, children); return node; }

  L.h = h; L.svg = svg; L.add = add; L.clear = clear; L.replace = replace;

  // ---------- formatting ----------
  L.fmtInt = function (n) { return (Number(n) || 0).toLocaleString('en-US'); };
  L.fmtBytes = function (n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  };
  L.plural = function (n, one, many) { return n === 1 ? one : (many || one + 's'); };

  // ---------- the overlay layer: progress veil, toasts, dialogs ----------
  var host = null, veil = null, veilText = null, veilTrack = null, veilBar = null, toasts = null;

  // Created once and mounted by the shell, so it survives the page redrawing around it.
  L.overlayHost = function () {
    if (host) return host;
    veilText = h('div', { class: 'lg-veil-text', text: 'Working…' });
    veilBar = h('div', { class: 'lg-veil-bar' });
    veilTrack = h('div', { class: 'lg-veil-track', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [veilBar]);
    veil = h('div', { class: 'lg-veil', hidden: true, role: 'status', 'aria-live': 'polite' }, [
      h('div', { class: 'lg-veil-card' }, [h('div', { class: 'lg-spinner' }), veilText, veilTrack])
    ]);
    toasts = h('div', { class: 'lg-toasts', 'aria-live': 'polite' });
    host = h('div', { class: 'lg-overlays' }, [veil, toasts]);
    return host;
  };

  L.loader = {
    // `pct` is optional: given, the veil draws a bar; left out, it only says what it is doing.
    show: function (text, pct) {
      L.overlayHost();
      veil.hidden = false;
      veilText.textContent = text || 'Working…';
      if (pct === undefined || pct === null) { veilTrack.hidden = true; veilBar.style.width = '0%'; }
      else { veilTrack.hidden = false; veilBar.style.width = Math.max(0, Math.min(100, pct)) + '%'; veilTrack.setAttribute('aria-valuenow', String(Math.round(pct))); }
    },
    hide: function () { if (veil) veil.hidden = true; }
  };

  // kind: 'info' | 'ok' | 'warn' | 'error'. `opts.actions` are the Undo-shaped buttons: a confirmation
  // asks before the fact and gets dismissed by habit, an Undo catches the slip after it.
  L.toast = function (text, kind, opts) {
    opts = opts || {};
    L.overlayHost();
    var timer = null;
    var node = h('div', { class: 'lg-toast lg-toast-' + (kind || 'info'), role: kind === 'error' ? 'alert' : null }, [
      h('span', { class: 'lg-toast-text', text: text })
    ]);
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    (opts.actions || []).forEach(function (a) {
      node.appendChild(h('button', { class: 'lg-toast-btn', type: 'button', text: a.label, onclick: function () { dismiss(); a.onClick(); } }));
    });
    node.appendChild(h('button', { class: 'lg-toast-x', type: 'button', 'aria-label': 'Dismiss', text: '×', onclick: dismiss }));
    toasts.appendChild(node);
    timer = setTimeout(dismiss, opts.duration || (kind === 'error' || kind === 'warn' ? 8000 : 4500));
    return { dismiss: dismiss };
  };

  // A dialog over the Log analysis screen. { title, body, actions:[{label, primary, danger, onClick}], wide }.
  // Esc and a click on the backdrop close it; so does an action unless its handler returns false.
  L.modal = function (opts) {
    L.overlayHost();
    var onKey = null, closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (onKey) document.removeEventListener('keydown', onKey, true);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (opts.onClose) opts.onClose();
    }
    var actions = (opts.actions || []).map(function (a) {
      return h('button', {
        class: 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger-outline' : ''), type: 'button', text: a.label,
        onclick: function () { var keep = a.onClick ? a.onClick(close) : undefined; if (keep !== false) close(); }
      });
    });
    var box = h('div', { class: 'modal lg-modal' + (opts.wide ? ' lg-modal-wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog' }, [
      opts.title ? h('h3', { text: opts.title }) : null,
      h('div', { class: 'lg-modal-body' }, [opts.body]),
      actions.length ? h('div', { class: 'modal-actions' }, actions) : null
    ]);
    var backdrop = h('div', { class: 'modal-backdrop lg-modal-backdrop', onmousedown: function (e) { if (e.target === backdrop) close(); } }, [box]);
    onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    host.appendChild(backdrop);
    var first = box.querySelector('textarea, input, select, button.btn-primary, button');
    if (first) first.focus();
    return { close: close, el: backdrop, box: box };
  };

  L.confirm = function (message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var answered = false;
      function answer(v) { answered = true; resolve(v); }
      L.modal({
        title: opts.title || 'Are you sure?',
        body: h('p', { class: 'muted', text: message }),
        actions: [
          { label: 'Cancel', onClick: function () { answer(false); } },
          { label: opts.confirmLabel || 'OK', primary: true, onClick: function () { answer(true); } }
        ],
        onClose: function () { if (!answered) resolve(false); }
      });
    });
  };

  // ---------- clipboard and downloads ----------
  function flash(btn, label) {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = label || 'Copied!';
    setTimeout(function () { btn.textContent = old; }, 1600);
  }

  // Copies text; falls back to a throw-away textarea where the Clipboard API is not offered.
  L.copy = function (text, btn, label) {
    var done = function () { flash(btn, label); };
    var fallback = function () {
      var ta = h('textarea', { value: text, style: 'position:fixed;left:-9999px;top:0' });
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { L.toast('Could not copy to the clipboard.', 'error'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };

  L.download = function (text, fileName, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: fileName, rel: 'noopener', style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  L.downloadCsv = function (fileName, header, rows) {
    L.download(window.mtExportToCsv(header, rows), fileName, 'text/csv;charset=utf-8');
  };
  L.copyMarkdown = function (header, rows, btn) { L.copy(window.mtExportToMarkdown(header, rows), btn); };
  L.downloadHtml = function (fileName, model) { L.download(window.mtExportToHtml(model), fileName, 'text/html;charset=utf-8'); };

  // ---------- reading a file ----------
  // A .gz carries no trustworthy size, and text compresses ~20:1, so a 30 MB download can be 600 MB of
  // log — past what one tab can hold as a string. The bytes are counted as they are inflated and the
  // read stops at the cap with advice, instead of the tab dying silently.
  L.MAX_TEXT_BYTES = 512 * 1024 * 1024;

  L.isGz = function (f) { return /\.gz$/i.test(f.name); };

  L.readFileText = async function (f, maxBytes) {
    if (L.isGz(f)) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser does not support gzip decompression (DecompressionStream)');
      }
      var cap = maxBytes || L.MAX_TEXT_BYTES;
      // Read by hand rather than through Response.text(): an error raised inside the pipe comes out of
      // Response as a bare "Failed to fetch", losing the advice.
      var reader = f.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      var decoder = new TextDecoder('utf-8');
      var parts = [];
      var seen = 0;
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        seen += r.value.length;
        if (seen > cap) {
          reader.cancel().catch(function () {});
          throw new Error(f.name + ' expands to more than ' + Math.round(cap / 1048576) + ' MB of text — too large for one browser tab. ' +
            'Split the file, or download a narrower time range (in Grafana or the Mendix Portal) and open that.');
        }
        parts.push(decoder.decode(r.value, { stream: true }));
      }
      parts.push(decoder.decode());
      return parts.join('');
    }
    return await f.text();
  };

  // Line endings as the shared parser counts them — its record offsets point into this text.
  L.lf = function (text) { return text.indexOf('\r') === -1 ? text : text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); };

  // The files a drop or a picker may bring in. A browser reports no type for .log, so the name counts too.
  L.looksLikeLog = function (f) {
    var fn = f.name.toLowerCase();
    return /\.(log|txt|csv|gz)$/.test(fn) || f.type === 'text/plain' || f.type === 'text/csv' || f.type === '';
  };

  // ---------- parsing ----------
  // Above 2 MB the parse runs in a Worker so the page keeps answering; below it, a worker would be pure
  // overhead. A worker that cannot start, or dies, falls back to the main thread rather than failing.
  var WORKER_THRESHOLD = 2 * 1024 * 1024;
  var parseWorkers = {};

  L.parseText = function (text, key) {
    key = key || 'parse';
    return new Promise(function (resolve, reject) {
      if (parseWorkers[key]) { parseWorkers[key].terminate(); parseWorkers[key] = null; }
      function onMainThread() {
        setTimeout(function () {
          try { resolve(window.createMendixLogParser().parse(text)); } catch (e) { reject(e); }
        }, 20);
      }
      if (text.length < WORKER_THRESHOLD || typeof Worker === 'undefined') { onMainThread(); return; }
      var w;
      try { w = new Worker('/logs/parse-worker.js'); } catch (e) { onMainThread(); return; }
      parseWorkers[key] = w;
      w.onmessage = function (msg) {
        var d = msg.data;
        if (d.type === 'progress') L.loader.show(d.phase || ('Parsing… ' + d.progress + '%'), d.progress);
        else if (d.type === 'complete') {
          w.terminate();
          if (parseWorkers[key] === w) parseWorkers[key] = null;
          resolve({ format: d.format, records: d.records, skipped: d.skipped });
        }
      };
      w.onerror = function () {
        w.terminate();
        if (parseWorkers[key] === w) parseWorkers[key] = null;
        onMainThread();
      };
      w.postMessage({ text: text });
    });
  };

  // The Studio Pro CSV export and a live log are told apart by extension; a Grafana export only by
  // content, so the parser is asked first.
  L.detectSourceFormat = function (name, text) {
    var fmt = window.createMendixLogParser().detectFormat(text);
    if (fmt.indexOf('grafana-') === 0) return fmt;
    return /\.csv$/i.test(name) ? 'csv' : 'live';
  };

  // The load path three tools share (Query Extractor, Microflow Tracer, REST & WS): read the file, parse it
  // (off the main thread when it is big), hand the records to the tool, and offer the file to the Data Hub so
  // the others do not need it dropped again. `apply(res, text)` is the tool's own view of the parse result.
  // text that arrives from another tool or the Hub already has an owner, so it is never re-published.
  L.makeLoader = function (toolId, opts) {
    var raw = null;
    function tick() { return new Promise(function (r) { setTimeout(r, 20); }); }
    async function run(text, name, parsed, pending) {
      raw = text;
      L.loader.show(opts.parsing, 5);
      var res = parsed || await L.parseText(text, toolId);
      L.loader.show(opts.building, 99);
      await tick();
      opts.apply(res, text, name);
      L.loader.hide();
      L.hub.publishFromParse(pending, text, res, toolId);
      return true;
    }
    return {
      loadFiles: async function (files) {
        var f = files[0];
        if (!f) return;
        try {
          L.loader.show('Reading log file...');
          var text = await L.readFileText(f);
          await run(text, f.name, null, { name: f.name, size: L.isGz(f) ? text.length : f.size });
        } catch (err) {
          L.loader.hide();
          console.error(toolId + ' load failed', err);
          L.toast('Could not read "' + f.name + '": ' + err.message, 'error');
        }
      },
      loadText: function (text, name, parsed) {
        return run(text, name, parsed, null).catch(function (err) { L.loader.hide(); L.toast('Could not parse this log: ' + err.message, 'error'); return false; });
      },
      rawText: function () { return raw; },
      forget: function () { raw = null; }
    };
  };

  // ---------- the Data Hub: one loaded file, shared across the log tools ----------
  // Every log tool used to be an island: the same 60 MB log had to be dropped into one tool and then
  // again into the next. The Hub holds ONE active source — the file most recently parsed by any tool —
  // and the bar above the tools offers it to the others. The raw text is already in memory, and so are
  // the records the shared parser produced; handing both over costs a function call, not a re-read.
  // (The pure summary/target builders are MxDevSwissTool's: ../engine/hub.js.)
  var hubSource = null;
  var hubListeners = [];
  var HUB_TARGET_IDS = ['log-viewer', 'log-query-extractor', 'microflow-tracer', 'ws-rest-extractor'];

  function hubNotify() { hubListeners.forEach(function (cb) { try { cb(hubSource); } catch (e) { /* a listener must not break the others */ } }); }

  L.hub = {
    onChange: function (cb) { hubListeners.push(cb); },
    getSource: function () { return hubSource; },
    summary: function () { return window.mtHubSummary(hubSource); },
    targets: function (currentToolId) { return window.mtHubTargets(hubSource, currentToolId); },
    // Called by every log tool right after it parses a file. `text` is kept by reference.
    setSource: function (info) {
      if (!info || !info.text) return;
      hubSource = {
        name: info.name || 'log',
        size: typeof info.size === 'number' ? info.size : info.text.length,
        format: info.format || null,
        records: typeof info.records === 'number' ? info.records : null,
        siblings: info.siblings || 0,
        text: info.text,
        // { format, records, skipped } from the shared parser, for exactly this text.
        parsed: info.parsed && info.parsed.records ? info.parsed : null,
        origin: info.origin || null,
        loadedIn: info.origin ? [info.origin] : [],
        loadedAt: Date.now()
      };
      hubNotify();
    },
    clear: function () { hubSource = null; hubNotify(); },
    // `pending` is the {name,size} a tool recorded when a user dropped or picked a file; it is null when
    // the text instead arrived from another tool or from the Hub itself, so a hand-off never re-publishes.
    publishFromParse: function (pending, text, res, origin) {
      if (!pending || !text) return;
      L.hub.setSource({
        name: pending.name, size: pending.size, text: text,
        format: res && res.format, records: res && res.records ? res.records.length : null,
        parsed: res, origin: origin
      });
    },
    // Pushes the active source into another tool and goes there; the target parses it as if the reader
    // had dropped the file in. When that tool already shows unrelated data of its own and has no Undo,
    // a silent one-click replace is exactly the kind of thing that should be confirmed first.
    openIn: function (toolId, stay) {
      var target = L.tools[toolId];
      if (!hubSource || !target || HUB_TARGET_IDS.indexOf(toolId) === -1) return Promise.resolve(false);
      var needsAsk = hubSource.loadedIn.indexOf(toolId) === -1 && target.hasData && target.hasData() && !target.hasUndo;
      var go = function () {
        if (hubSource.loadedIn.indexOf(toolId) === -1) hubSource.loadedIn.push(toolId);
        if (!stay) L.goto(toolId, { withReturn: true });
        var out;
        try { out = target.loadText(hubSource.text, hubSource.name, hubSource.parsed); }
        catch (e) { console.error('Data Hub: ' + toolId + ' failed', e); return false; }
        hubNotify();
        return out === undefined ? true : out;
      };
      if (needsAsk) {
        return L.confirm('This replaces what is currently loaded in ' + target.label + ' with ' + hubSource.name + '. ' + target.label + ' has no Undo.',
          { title: 'Replace the data in ' + target.label + '?', confirmLabel: 'Replace' }).then(function (ok) { return ok ? go() : false; });
      }
      return Promise.resolve(go());
    },
    // Fills a tool that holds nothing yet without leaving the current one (the Incident Report).
    loadInto: function (toolId) { return L.hub.openIn(toolId, true); }
  };

  // ---------- moving between tools ----------
  // A tab click is plain navigation. A hand-off from one tool to another (a "Show in Log Viewer" button,
  // a decoder check that points at another tool) is navigation WITH a way back: a pill that returns to
  // where the reader was.
  var navListeners = [];
  L.nav = { current: 'log-viewer', back: null };

  L.onNav = function (cb) { navListeners.push(cb); };
  L.goto = function (id, opts) {
    opts = opts || {};
    if (!L.tools[id]) return;
    var from = L.nav.current;
    L.nav.back = (opts.withReturn && from !== id) ? from : null;
    L.nav.current = id;
    navListeners.forEach(function (cb) { cb(id, from); });
  };
  L.goBack = function () { if (L.nav.back) L.goto(L.nav.back); };

  // ---------- registering a tool ----------
  // A tool is { id, label, build() → element (once), onShow?(), hasData?(), hasUndo?, loadText?(text, name, parsed),
  // reportSection?(fromMs, toMs) }. They register themselves; the shell decides the order.
  L.register = function (tool) { L.tools[tool.id] = tool; };

  // ---------- optional: resolving a table name to an entity of the open project ----------
  // The original resolved `eshop$order` to `eShop.Order` when a domain model had been loaded from a live
  // database. MxScout has the model of the project that is open, so app.js hands over a resolver.
  // The engine reads `window.mxEntityForTable`; this just keeps the names in one place.
  L.setEntityResolver = function (fn) { window.mxEntityForTable = fn || null; };

  // A scroll position is lost when an element leaves the document, and app.js redraws the page (and so
  // detaches this whole screen) for reasons of its own — a toast timing out, say. Every scroller that
  // asks is remembered here and put back after the screen is attached again.
  var scrollers = [];
  L.keepScroll = function (node) {
    var rec = { node: node, top: 0, left: 0 };
    node.addEventListener('scroll', function () { rec.top = node.scrollTop; rec.left = node.scrollLeft; }, { passive: true });
    scrollers.push(rec);
    return node;
  };
  L.restoreScroll = function () {
    scrollers.forEach(function (r) { if (r.node.isConnected) { r.node.scrollTop = r.top; r.node.scrollLeft = r.left; } });
  };
})();
