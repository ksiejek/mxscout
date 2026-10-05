/* MxScout — Log analysis: the Nginx Log Analyzer.
 *
 * Mendix Cloud puts an nginx router (rtr) in front of every app, and its access log is where a public app's
 * traffic shows up: top clients, paths and status codes, response times with p95 / p99 per endpoint, and a
 * 404 table that answers WHOSE fault each 404 is — internet scanners probing for software you do not run,
 * requests every browser makes on its own, or your own broken references (the only fixable group, and on a
 * real app usually the smallest). The error log has its own analyzer, and a Timeline Correlator lines
 * requests up with runtime activity from the application log by time proximity — the rtr log carries no
 * correlation ID, so every match says "within ±N ms", never "this is the request that caused it".
 *
 * The reading, the 404 classifier and the correlation are MxDevSwissTool's (Mikołaj / RealMecowhy, MIT) —
 * ../engine/nginx.js — and so is the behaviour of this screen. One thing is not carried over: it looked up
 * the country of the top client IPs through an outside service (geojs.io). MxScout makes no request to
 * anywhere, so that column is gone rather than switched off.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  var CHUNK = 100;           // stream rows added per scroll step

  var access = { logs: [], filtered: [], visible: 0, name: null };
  var errors = { logs: [], filtered: [], visible: 0, scanned: 0, matched: 0, sample: '', name: null };
  var accessFilter = { search: '', statusClasses: [2, 3, 4, 5], date: '', timeFrom: '', timeTo: '' };
  var errorFilter = { search: '', levels: ['info', 'notice', 'warn', 'error', 'crit', 'alert', 'emerg'], date: '', timeFrom: '', timeTo: '' };
  var drill = { hour: null, ip: null, url: null };   // what the reader clicked in the analyzer to narrow further
  var corr = { text: null, name: null, records: [], result: null };
  var A = {}, E = {}, C = {};                         // the three tabs' elements
  var root, tabs, panes = {};
  var filterTimer = null;

  var STATUS_TONE = { 2: 'ok', 3: 'info', 4: 'warn', 5: 'error' };

  // ===================================================================================================
  // LOADING
  // ===================================================================================================
  // Streams the file (gunzipping a .gz) through the line parser. A big file runs in a Worker so a 100K+ line
  // log does not compete with the page for the whole read; a Worker that cannot start falls back to the main
  // thread, which is exactly what the original did.
  async function parseFile(file, type, onProgress) {
    var isGz = L.isGz(file);
    if (file.size >= window.NGINX_WORKER_THRESHOLD && typeof Worker !== 'undefined') {
      try {
        return await new Promise(function (resolve, reject) {
          var w;
          try { w = new Worker('/logs/nginx-worker.js'); } catch (e) { reject(e); return; }
          w.onmessage = function (m) {
            var d = m.data;
            if (d.type === 'progress') onProgress(d.totalBytes);
            else if (d.type === 'complete') { w.terminate(); resolve(d.result); }
            else if (d.type === 'error') { w.terminate(); reject(new Error(d.message)); }
          };
          w.onerror = function (err) { w.terminate(); reject(err); };
          w.postMessage({ file: file, isGz: isGz, type: type });
        });
      } catch (err) { console.warn('Nginx worker unavailable, parsing on the main thread:', err.message || err); }
    }
    return window.nginxStreamParseFile(file, isGz, type, type === 'access' ? window.nginxParseLine : window.nginxParseErrorLine, onProgress);
  }

  async function loadFile(files, type) {
    var file = files[0];
    if (!file) return;
    L.loader.show('Reading logs...');
    await new Promise(function (r) { setTimeout(r, 50); });   // let the veil paint
    try {
      var isGz = L.isGz(file);
      var result = await parseFile(file, type, function (totalBytes) {
        if (isGz) L.loader.show('Reading logs... (' + (totalBytes / 1024 / 1024).toFixed(1) + ' MB decompressed)');
        else { var pct = Math.min(100, Math.round((totalBytes / file.size) * 100)); L.loader.show('Reading logs... ' + pct + '%', pct); }
      });
      if (type === 'access') { access.logs = result.records; access.name = file.name; }
      else { errors.logs = result.records; errors.scanned = result.scanned; errors.matched = result.matched; errors.sample = result.sample; errors.name = file.name; }
      L.loader.show('Analyzing logs...');
      setTimeout(function () { if (type === 'access') showAccess(); else showErrors(); L.loader.hide(); }, 50);
    } catch (err) {
      console.error('Log file reading error:', err);
      L.loader.hide();
      L.toast('Failed to process the log file. Ensure it is a valid log file or gzip archive.', 'error');
    }
  }

  // Pasted text: parsed line by line on the main thread, as the original did.
  function parseAccessText(text) {
    var out = [];
    text.split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var parsed = window.nginxParseLine(line);
      if (parsed) { parsed.hourStr = window.nginxDeriveHourStr(parsed.date); out.push(parsed); }
    });
    return out;
  }
  function parseErrorText(text) {
    var recs = [], scanned = 0, sample = '';
    text.split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) return;
      scanned++;
      var parsed = window.nginxParseErrorLine(line);
      if (parsed) recs.push(parsed); else if (!sample) sample = line;
    });
    return { recs: recs, scanned: scanned, matched: recs.length, sample: sample };
  }

  // ===================================================================================================
  // THE ACCESS LOG
  // ===================================================================================================
  function accessTimeFilter() { return { search: accessFilter.search, statusClasses: accessFilter.statusClasses, date: accessFilter.date, timeFrom: accessFilter.timeFrom, timeTo: accessFilter.timeTo }; }

  function buildDates(select, logs) {
    var cur = select.value;
    var dates = Array.from(new Set(logs.map(function (l) { return l.dateOnly; }).filter(Boolean))).sort();
    L.clear(select);
    select.appendChild(h('option', { value: '', text: 'All dates' }));
    dates.forEach(function (d) { select.appendChild(h('option', { value: d, text: d, selected: d === cur })); });
  }

  function analyzeAccessText() {
    var text = A.input.value;
    if (!text.trim()) return;
    L.loader.show('Analyzing logs...');
    setTimeout(function () {
      access.logs = parseAccessText(text);
      access.name = 'pasted text';
      showAccess();
      L.loader.hide();
    }, 50);
  }

  function showAccess() {
    drill = { hour: null, ip: null, url: null };
    buildDates(A.date, access.logs);
    if (!access.logs.length) {
      L.toast('No nginx access-log lines were recognized. This tab reads the Mendix Cloud rtr format and the classic combined format.', 'warn');
      return;
    }
    A.input.hidden = true; A.inputCard.hidden = true;
    A.results.hidden = false;
    A.anonBtn.hidden = false;
    applyAccessFilters();
  }

  // The stream's own filters, then the analyzer over what is left (plus whatever the reader drilled into).
  function applyAccessFilters() {
    access.filtered = window.nginxFilterAccess(access.logs, accessTimeFilter());
    access.visible = Math.min(CHUNK, access.filtered.length);
    A.streamBox.scrollTop = 0;
    renderStream(A, access, 'access');
    renderAnalyzer();
  }

  function setDrill(key, value) { drill[key] = value; renderAnalyzer(); }

  function renderAnalyzer() {
    var a = window.nginxAggregate(access.filtered, drill, access.logs.length);

    // active drill-down filters
    L.clear(A.pills);
    var any = false;
    ['hour', 'ip', 'url'].forEach(function (k) {
      if (!drill[k]) return;
      any = true;
      A.pills.appendChild(h('span', { class: 'lg-pill' }, [h('strong', { text: k.toUpperCase() }), ': ' + drill[k] + ' ', h('button', { type: 'button', title: 'Remove filter', 'aria-label': 'Remove filter', text: '×', onclick: function () { setDrill(k, null); } })]));
    });
    if (any) A.pills.appendChild(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Clear filters', onclick: function () { drill = { hour: null, ip: null, url: null }; renderAnalyzer(); } }));
    A.pills.hidden = !any;

    A.stats.set('total', L.fmtInt(a.total));
    A.stats.set('ips', L.fmtInt(a.uniqueIps));
    A.stats.set('bandwidth', window.nginxFormatBytes(a.bytes));
    A.stats.set('errors', L.fmtInt(a.errors));
    A.stats.set('hour', a.activeHour);
    A.stats.set('parsed', a.shareOfParsed);

    // status codes
    L.clear(A.statusChart);
    if (!a.statuses.length) A.statusChart.appendChild(h('div', { class: 'muted', text: 'No data' }));
    a.statuses.forEach(function (s) {
      var code = s[0], count = s[1];
      var p = Math.round((count / (a.total || 1)) * 100);
      A.statusChart.appendChild(h('div', { class: 'lg-barrow' }, [
        h('div', { class: 'lg-bar-label lg-tone-' + (STATUS_TONE[code.charAt(0)] || 'muted'), text: code }),
        h('div', { class: 'lg-bar-track' }, [h('div', { class: 'lg-bar-fill lg-fill-' + (STATUS_TONE[code.charAt(0)] || 'muted'), style: 'width:' + Math.max(1, p) + '%' })]),
        h('div', { class: 'lg-bar-val', text: L.fmtInt(count) })
      ]));
    });

    renderHourChart(A.timeChart, a.hours, function (hour) { setDrill('hour', hour); }, 'requests', 'accent');

    var link = function (key, text) { return W.linkCell(text, function () { setDrill(key, text); }); };
    var num = function (n) { return L.fmtInt(n); };

    L.replace(A.ipCard, [W.table([{ label: 'IP address', cell: function (r) { return link('ip', r[0]); } }, { label: 'Hits', align: 'right', cell: function (r) { return num(r[1]); } },
      { label: '%', align: 'right', cell: function (r) { return ((r[1] / a.total) * 100).toFixed(1) + '%'; } }], a.topIps, { empty: 'No data' })]);

    L.replace(A.urlCard, [W.table([{ label: 'URL', cell: function (r) { return link('url', r[0]); } }, { label: 'Hits', align: 'right', cell: function (r) { return num(r[1]); } },
      { label: '%', align: 'right', cell: function (r) { return ((r[1] / a.total) * 100).toFixed(1) + '%'; } },
      { label: 'IPs', align: 'right', title: 'Distinct clients that requested this URL — one client hammering an endpoint reads very differently from many real users', cell: function (r) { return num(a.urlUniqueIps[r[0]] || 0); } }], a.topUrls, { empty: 'No data' })]);

    // 404s, split by whose fault they are. The app-owned ones come first: they are the only bucket the developer
    // can fix, and on a public app they are heavily outnumbered by scanner probes, which is exactly how they used
    // to get missed.
    var t = a.traffic;
    var rows404 = [];
    a.appPaths.forEach(function (p) { rows404.push({ p: p, tag: 'yours', tone: 'error' }); });
    a.fillPaths.forEach(function (p) { rows404.push({ p: p, tag: 'scanner', tone: 'muted' }); });
    L.clear(A.n404Card);
    if (t.total404 === 0) A.n404Card.appendChild(h('p', { class: 'lg-table-empty', text: 'No 404s in this selection.' }));
    else {
      A.n404Card.appendChild(h('div', { class: 'lg-404sum' }, [L.fmtInt(t.total404) + ' 404s: ', h('strong', { class: 'lg-tone-error', text: L.fmtInt(t.app.requests) + ' from your own app' }),
        ', ' + L.fmtInt(t.scanner.requests) + ' scanner probes, ' + L.fmtInt(t.convention.requests) + ' browser conventions']));
      if (!a.appPaths.length) A.n404Card.appendChild(h('p', { class: 'lg-table-empty', text: 'None of them point at your own app — nothing to fix here.' }));
      A.n404Card.appendChild(W.table([{ label: 'URL', cell: function (r) { return W.linkCell(r.p.path, function () { setDrill('url', r.p.path); }, r.p.path + ' — ' + r.p.reason); } },
        { label: 'Hits', align: 'right', cell: function (r) { return h('span', null, [h('span', { class: 'lg-tag lg-tone-' + r.tone, text: r.tag }), ' ' + num(r.p.hits)]); } }], rows404));
    }

    L.replace(A.osCard, [W.table([{ label: 'OS' }, { label: 'Hits', align: 'right', cell: function (r) { return num(r[1]); } }], a.topOs, { empty: 'No data' })]);

    L.replace(A.botsCard, [W.table([{ label: 'IP address', cell: function (b) { return link('ip', b.ip); } },
      { label: 'Reason', cell: function (b) { return h('span', null, [h('span', { class: 'lg-tone-error', text: b.reason }), h('span', { class: 'muted', text: ' · ' + num(b.distinctPaths) + ' distinct path' + (b.distinctPaths === 1 ? '' : 's') })]); } },
      { label: 'Hits', align: 'right', cell: function (b) { return num(b.hits); } }], a.topBots,
      { empty: 'No scanner traffic in this selection — every 404 here looks like a browser convention or a reference in your own app.' })]);

    L.replace(A.slowCard, [W.table([{ label: 'URL', cell: function (u) { return link('url', u[0]); } }, { label: 'Avg (s)', align: 'right', cell: function (u) { return u[1].toFixed(3); } },
      { label: 'p95 (s)', align: 'right', cell: function (u) { return u[2].toFixed(3); } }, { label: 'p99 (s)', align: 'right', cell: function (u) { return u[3].toFixed(3); } },
      { label: 'Hits', align: 'right', cell: function (u) { return num(u[4]); } }], a.slowestUrls, { empty: 'No data' })]);

    L.replace(A.bwCard, [W.table([{ label: 'URL', cell: function (u) { return link('url', u[0]); } }, { label: 'Total size', align: 'right', cell: function (u) { return window.nginxFormatBytes(u[1]); } },
      { label: 'Hits', align: 'right', cell: function (u) { return num(u[2]); } }], a.bwHogs, { empty: 'No data' })]);

    L.replace(A.refCard, [W.table([{ label: 'Referrer' }, { label: 'Hits', align: 'right', cell: function (r) { return num(r[1]); } }], a.topReferrers, { empty: 'No data' })]);
  }

  // Requests (or errors) per hour. A single bucket is drawn narrow and centred rather than as one wall of
  // colour; the x labels thin out to about six.
  function renderHourChart(box, hours, onPick, noun, tone) {
    L.clear(box);
    if (!hours.length) { box.appendChild(h('div', { class: 'muted lg-center', text: 'No data' })); return; }
    var maxVal = Math.max.apply(null, hours.map(function (x) { return x[1]; }));
    var single = hours.length === 1;
    var step = Math.max(1, Math.ceil(hours.length / 6));
    var fmt = function (n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); };
    var bars = h('div', { class: 'lg-hbars' + (single ? ' is-single' : '') });
    var axis = h('div', { class: 'lg-haxis' + (single ? ' is-single' : '') });
    hours.forEach(function (x, i) {
      var hour = x[0], count = x[1];
      bars.appendChild(h('button', {
        class: 'lg-hbar' + (onPick ? ' is-pick' : ''), type: 'button', title: hour + ' — ' + count + ' ' + noun + (onPick ? ' · click to filter by this hour' : ''),
        onclick: onPick ? function () { onPick(hour); } : null
      }, [h('span', { class: 'lg-fill-' + tone, style: 'height:' + Math.max(2, (count / maxVal) * 100) + '%' })]));
      var shortHour = hour.split(' ')[1] ? hour.split(' ')[1] + ':00' : hour;
      axis.appendChild(h('span', { text: (i % step === 0 || i === hours.length - 1) ? shortHour : '' }));
    });
    box.appendChild(h('div', { class: 'lg-hchart' }, [h('div', { class: 'lg-hy' }, [h('span', { text: fmt(maxVal) }), h('span', { text: fmt(Math.round(maxVal / 2)) }), h('span', { text: '0' })]),
      h('div', { class: 'lg-hplot' }, [bars, axis])]));
  }

  // ===================================================================================================
  // THE STREAM (access and error)
  // ===================================================================================================
  function renderStream(T, data, type) {
    L.clear(T.stream);
    T.streamCount.textContent = L.fmtInt(data.filtered.length);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < data.visible; i++) {
      var log = data.filtered[i];
      if (!log) continue;
      (function (log, idx) {
        var bad = type === 'access' ? log.status >= 400 : ['error', 'crit', 'alert', 'emerg'].indexOf(log.level) !== -1;
        var line = h('div', { class: 'lg-nxline' }, window.nginxColorizeTokens(type, log.rawLine).map(function (tk) { return tk.t === 'plain' ? tk.v : h('span', { class: 'lg-nx-' + tk.t, text: tk.v }); }));
        frag.appendChild(h('div', { class: 'lg-nxrow' + (bad ? ' is-bad' : '') }, [
          h('span', { class: 'lg-nxflag' }), line,
          type === 'access' ? h('button', { class: 'btn btn-sm lg-nxaction', type: 'button', text: 'SQL in window', title: 'Show the SQL that ran around this request in the Query Extractor', onclick: function () { showInQueries(idx); } }) : null
        ]));
      })(log, i);
    }
    T.stream.appendChild(frag);
    if (data.visible < data.filtered.length) T.stream.appendChild(h('div', { class: 'lg-sentinel', text: 'Showing ' + L.fmtInt(data.visible) + ' of ' + L.fmtInt(data.filtered.length) + ' — scroll to load more' }));
  }

  function loadMore(T, data, type) {
    if (data.visible >= data.filtered.length) return;
    data.visible = Math.min(data.filtered.length, data.visible + CHUNK);
    renderStream(T, data, type);
  }

  // The access-log request carries its own duration, so the window is [request − duration, request]; the
  // Query Extractor then shows only the SQL that ran inside it.
  function showInQueries(index) {
    var log = access.filtered[index];
    if (!log) return;
    var endTs = window.nginxDateToMs(log.date);
    if (isNaN(endTs)) { L.toast('Invalid date format in log entry.', 'error'); return; }
    var startTs = endTs - ((log.time || 0) * 1000);
    L.goto('log-query-extractor', { withReturn: true });
    L.tools['log-query-extractor'].setTimeWindow(startTs, endTs, log.method + ' ' + log.url);
  }

  // ===================================================================================================
  // THE ERROR LOG
  // ===================================================================================================
  function analyzeErrorText() {
    var text = E.input.value;
    if (!text.trim()) return;
    L.loader.show('Analyzing logs...');
    setTimeout(function () {
      var r = parseErrorText(text);
      errors.logs = r.recs; errors.scanned = r.scanned; errors.matched = r.matched; errors.sample = r.sample; errors.name = 'pasted text';
      showErrors();
      L.loader.hide();
    }, 50);
  }

  // Banner for text that does not look like an nginx error log — usually because an access log (Mendix Cloud
  // rtr) landed in the wrong tab. Stays quiet when the format matches or only a few odd lines slip by.
  function updateErrorHint() {
    var hint = window.nginxErrorHint(errors.matched, errors.scanned, errors.sample);
    if (!hint) { E.hint.hidden = true; return; }
    E.hint.hidden = false;
    if (hint.kind === 'none') {
      L.replace(E.hint, ['None of the ' + L.fmtInt(hint.scanned) + ' lines match the nginx ', h('strong', { text: 'error' }), '-log format (', h('code', { text: 'YYYY/MM/DD HH:MM:SS [level] …' }), '). ',
        hint.looksLikeAccess ? ['This looks like an ', h('strong', { text: 'access' }), ' log — switch to the ', h('em', { text: 'Access Log' }), ' tab instead.']
          : ['Make sure you pasted an nginx ', h('code', { text: 'error.log' }), ', not an application or access log.']]);
    } else {
      L.replace(E.hint, [L.fmtInt(hint.skipped) + ' of ' + L.fmtInt(hint.scanned) + ' lines were skipped — they don’t match the nginx error-log format and were ignored.']);
    }
  }

  function showErrors() {
    updateErrorHint();
    buildDates(E.date, errors.logs);
    if (!errors.logs.length) { L.toast('No nginx error-log lines were recognized.', 'warn'); return; }
    E.inputCard.hidden = true;
    E.results.hidden = false;
    applyErrorFilters();
  }

  function applyErrorFilters() {
    errors.filtered = window.nginxFilterErrors(errors.logs, errorFilter);
    errors.visible = Math.min(CHUNK, errors.filtered.length);
    E.streamBox.scrollTop = 0;
    renderStream(E, errors, 'error');
    renderErrorAnalyzer();
  }

  function renderErrorAnalyzer() {
    var a = window.nginxAggregateErrors(errors.filtered);
    E.stats.set('total', L.fmtInt(a.total));
    if (!a.total) {
      E.stats.set('levels', '0'); E.stats.set('clients', '0'); E.stats.set('hour', '-');
      L.clear(E.levelChart); L.clear(E.timeChart); L.clear(E.msgCard); L.clear(E.ipCard); L.clear(E.reqCard);
      E.levelChart.appendChild(h('div', { class: 'muted', text: 'No data' }));
      return;
    }
    E.stats.set('levels', L.fmtInt(a.levelCount));
    E.stats.set('clients', L.fmtInt(a.clientCount));
    E.stats.set('hour', a.activeHour);

    L.clear(E.levelChart);
    a.levels.forEach(function (l) {
      var tone = (l.level === 'error' || l.level === 'crit') ? 'error' : 'warn';
      E.levelChart.appendChild(h('div', { class: 'lg-barrow' }, [
        h('div', { class: 'lg-bar-label lg-tone-' + tone, text: l.level }),
        h('div', { class: 'lg-bar-track' }, [h('div', { class: 'lg-bar-fill lg-fill-' + tone, style: 'width:' + l.pct + '%' })]),
        h('div', { class: 'lg-bar-val', text: l.pct + '%' })
      ]));
    });

    L.clear(E.timeChart);
    var bars = h('div', { class: 'lg-hbars' });
    a.bars.forEach(function (b) {
      bars.appendChild(h('div', { class: 'lg-hbar', title: b.label + ': ' + b.sum + ' errors' }, [h('span', { class: 'lg-fill-error', style: 'height:' + Math.max(1, b.pct) + '%' })]));
    });
    E.timeChart.appendChild(h('div', { class: 'lg-hchart' }, [h('div', { class: 'lg-hplot' }, [bars])]));

    var cnt = function (r) { return L.fmtInt(r[1]); };
    L.replace(E.msgCard, [W.table([{ label: 'Error message', cell: function (r) { return h('span', { class: 'lg-breakall', text: r[0] }); } }, { label: 'Count', align: 'right', cell: cnt }], a.topMessages)]);
    L.replace(E.ipCard, [W.table([{ label: 'IP address' }, { label: 'Count', align: 'right', cell: cnt }], a.topIps, { empty: 'No client addresses in these lines.' })]);
    L.replace(E.reqCard, [W.table([{ label: 'Request', cell: function (r) { return h('span', { class: 'lg-breakall', text: r[0] }); } }, { label: 'Count', align: 'right', cell: cnt }], a.topRequests, { empty: 'No requests in these lines.' })]);
  }

  // ===================================================================================================
  // THE TIMELINE CORRELATOR
  // ===================================================================================================
  // The Mendix Cloud rtr log carries request/status/timing/UA fields and NOTHING that identifies a request
  // across logs, so a request can only be linked to runtime activity by TIME PROXIMITY. Every label here says
  // "matched within ±N ms", never "this is the request that triggered it".
  function eventLabel(e) {
    if (e.kind === 'flow') return e.id + (e.flow ? ' — ' + e.flow : '') + ' · ' + e.count + ' entries · ' + e.errors + ' errors, ' + e.warnings + ' warnings';
    return '[' + e.level + '] ' + (e.node ? e.node + ': ' : '') + e.message;
  }
  function dotClass(status) { return status >= 500 ? 'is-5xx' : (status >= 400 ? 'is-4xx' : (status >= 300 ? 'is-3xx' : 'is-2xx')); }

  async function loadCorrFile(files) {
    var f = files[0];
    if (!f) return;
    try {
      var text = await L.readFileText(f);
      corr.text = text; corr.name = f.name;
      C.input.value = '[File loaded: ' + f.name + ']\nSize: ' + (text.length / 1024 / 1024).toFixed(2) + ' MB\n\nClick Correlate to run.';
      L.toast('Application log loaded (' + f.name + ').', 'ok');
    } catch (e) { L.toast('Failed to read the file: ' + e.message, 'error'); }
  }

  function runCorrelation() {
    if (!access.logs.length) { L.toast('Load and analyze an rtr (access) log in the Access Log tab first.', 'warn'); return; }
    if (C.input.value && C.input.value.indexOf('[File loaded:') !== 0 && C.input.value.trim()) { corr.text = C.input.value; if (!corr.name) corr.name = 'pasted.log'; }
    if (!corr.text || !corr.text.trim()) { L.toast('Paste or load an application runtime log to correlate against.', 'warn'); return; }
    L.loader.show('Correlating...');
    setTimeout(function () {
      try {
        var parsed = window.createMendixLogParser().parse(corr.text);
        corr.records = parsed.records || [];
        var groups = window.logExtractCorrelations(corr.records);
        var events = window.nxCorrBuildRuntimeEvents(corr.records, groups.groups);
        var windowMs = parseInt(C.windowMs.value, 10) || 3000;
        corr.result = window.nxCorrelate(access.logs, events, windowMs);
        renderCorrelation(corr.result);
      } catch (e) {
        console.error('Correlation failed', e);
        L.toast('Correlation failed: ' + e.message, 'error');
      } finally { L.loader.hide(); }
    }, 50);
  }

  function clearCorrelation() {
    corr = { text: null, name: null, records: [], result: null };
    C.input.value = '';
    L.clear(C.out);
    C.summary.visible(false);
  }

  function renderCorrelation(result) {
    L.clear(C.out);
    if (!result.requests.length) {
      C.summary.visible(false);
      C.out.appendChild(W.note('No rtr requests had a parseable timestamp. This needs the Mendix Cloud rtr format loaded in the Access Log tab (the classic combined-log format has no sub-second timestamp to correlate with).', 'warn'));
      return;
    }
    if (!result.events.length) {
      C.summary.visible(false);
      C.out.appendChild(W.note('No ERROR/WARNING lines or correlation IDs found in the application log — nothing to place on the runtime lane. Check the log level and that this is a Cloud runtime log rather than an access log.', 'warn'));
      return;
    }
    var matchedReq = {}, matchedEvent = {};
    result.links.forEach(function (l) { matchedReq[l.reqIndex] = true; matchedEvent[l.eventIndex] = true; });
    C.summary.visible(true);
    C.summary.set('requests', String(result.requests.length));
    C.summary.set('events', String(result.events.length));
    C.summary.set('matched', String(result.links.length));
    C.summary.setLabel('matched', 'Matched within ±' + result.windowMs + 'ms:');

    if (!result.links.length) {
      C.out.appendChild(W.note('Found ' + result.requests.length + ' rtr requests and ' + result.events.length + ' runtime events, but none fell within ±' + result.windowMs + 'ms of each other. Widen the match window, or check that the two files actually cover overlapping time (same dates, same clock).', 'warn'));
      return;
    }

    var allMs = result.requests.map(function (r) { return r.ms; }).concat(result.events.map(function (e) { return e.ms; })).concat(result.events.map(function (e) { return e.msEnd; }));
    var t0 = Math.min.apply(null, allMs), t1 = Math.max.apply(null, allMs), span = Math.max(t1 - t0, 1);
    var pct = function (ms) { return ((ms - t0) / span) * 100; };

    var laneReq = h('div', { class: 'lg-lane' });
    result.requests.forEach(function (r) {
      var m = !!matchedReq[r.index];
      laneReq.appendChild(h('div', { class: 'lg-dot ' + dotClass(r.status) + (m ? ' is-matched' : ''), style: 'left:' + pct(r.ms).toFixed(3) + '%',
        title: new Date(r.ms).toISOString().slice(11, 23) + '  ' + r.method + ' ' + r.url + ' -> ' + r.status + (m ? ' (matched)' : ' (no match in window)') }));
    });
    var laneRun = h('div', { class: 'lg-lane' });
    result.events.forEach(function (e, i) {
      var m = !!matchedEvent[i];
      var left = pct(e.ms);
      var title = eventLabel(e) + (m ? ' (matched)' : ' (no rtr match in window)');
      if (e.kind === 'flow') {
        laneRun.appendChild(h('div', { class: 'lg-bar ' + (e.errors ? 'is-err' : (e.warnings ? 'is-warn' : 'is-ok')) + (m ? ' is-matched' : ''), style: 'left:' + left.toFixed(3) + '%;width:' + Math.max(pct(e.msEnd) - left, 0.3).toFixed(3) + '%', title: title }));
      } else {
        laneRun.appendChild(h('div', { class: 'lg-dot ' + (e.level === 'ERROR' || e.level === 'CRITICAL' ? 'is-5xx' : 'is-4xx') + (m ? ' is-matched' : ''), style: 'left:' + left.toFixed(3) + '%', title: title }));
      }
    });
    C.out.appendChild(h('div', { class: 'lg-swim' }, [h('div', { class: 'lg-lane-label', text: 'rtr requests' }), laneReq, h('div', { class: 'lg-lane-label', text: 'Runtime activity (flows + errors/warnings)' }), laneRun]));

    var rows = result.links.slice().sort(function (a, b) { return a.distMs - b.distMs; }).slice(0, 500).map(function (l) {
      var req = result.requests[l.reqIndex], e = result.events[l.eventIndex];
      return (req && e) ? { l: l, req: req, e: e } : null;
    }).filter(Boolean);
    C.out.appendChild(h('div', { class: 'lg-card' }, [h('div', { class: 'lg-card-head', text: 'Matches — closest in time first' }), h('div', { class: 'lg-card-body is-flush' }, [W.table([
      { label: 'rtr request', cell: function (r) { return h('span', { title: r.req.url, text: r.req.method + ' ' + (r.req.url.length > 48 ? r.req.url.slice(0, 48) + '…' : r.req.url) }); } },
      { label: 'Status', cell: function (r) { return h('span', null, [h('span', { class: 'lg-dotkey ' + dotClass(r.req.status) }), ' ' + r.req.status]); } },
      { label: 'Runtime event', cell: function (r) { var t = eventLabel(r.e); return h('span', { title: t, text: t.length > 60 ? t.slice(0, 60) + '…' : t }); } },
      { label: 'Δt', cell: function (r) { return r.l.distMs + 'ms'; } },
      { label: '', cell: function (r) { return h('button', { class: 'btn btn-sm', type: 'button', text: 'View in Log Viewer', onclick: function () { openInLogViewer(r.e.kind === 'flow' ? r.e.id : r.e.message); } }); } }
    ], rows)])]));
  }

  // Pushes the application log held in the correlator into the Log Viewer (it may not already have it) and
  // jumps there, filtered to a search term — a correlation ID for a flow event, or the line's own message for
  // a bare error/warning entry (there is no correlation ID to filter by).
  function openInLogViewer(term) {
    var lv = L.tools['log-viewer'];
    var ready = corr.text ? Promise.resolve(lv.loadText(corr.text, corr.name || 'app.log')) : Promise.resolve();
    L.goto('log-viewer', { withReturn: true });
    ready.then(function () { lv.filterInsight('', '', term); });
  }

  // ===================================================================================================
  // BUILD
  // ===================================================================================================
  function chipRow(items, active, onToggle) {
    var box = h('div', { class: 'lg-lvlchips' });
    items.forEach(function (it) {
      var on = active.indexOf(it.id) !== -1;
      var b = h('button', { class: 'lg-lvlchip lg-lvlchip-' + (it.tone || 'info') + (on ? ' is-on' : ''), type: 'button', text: it.label, 'aria-pressed': on ? 'true' : 'false',
        onclick: function () { b.classList.toggle('is-on'); b.setAttribute('aria-pressed', b.classList.contains('is-on') ? 'true' : 'false'); onToggle(it.id, b.classList.contains('is-on')); } });
      box.appendChild(b);
    });
    return box;
  }

  function later(fn) { clearTimeout(filterTimer); filterTimer = setTimeout(fn, 300); }

  function card(title, body, tone) {
    return h('div', { class: 'lg-card' }, [h('div', { class: 'lg-card-head' + (tone ? ' lg-tone-' + tone : ''), text: title }), h('div', { class: 'lg-card-body' }, [body])]);
  }

  // The input card each log tab starts with: paste, drop or browse.
  function inputCard(T, label, onFile, onAnalyze) {
    T.input = h('textarea', { class: 'lg-textarea lg-textarea-tall', placeholder: 'Paste ' + label + ' log content here…', spellcheck: 'false', 'aria-label': label + ' log' });
    var picker = W.filePicker('Browse files', { primary: true, accept: '.log,.txt,.gz' }, onFile);
    var card = h('div', { class: 'lg-inputcard' }, [
      h('p', { class: 'lg-empty-title', text: 'Drop a ' + label + ' log file here, or paste it below' }),
      h('p', { class: 'muted', text: '.log, .txt or .gz — large files are read in the background' }),
      h('div', { class: 'lg-empty-actions' }, [picker.button, picker.input, h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Analyze pasted text', onclick: onAnalyze })]),
      T.input
    ]);
    W.dropTarget(card, onFile);
    return card;
  }

  function buildAccess() {
    A.inputCard = inputCard(A, 'nginx access', function (f) { loadFile(f, 'access'); }, analyzeAccessText);

    A.search = h('input', { type: 'text', class: 'lg-input lg-input-grow', placeholder: 'Search IP, URL, method…', spellcheck: 'false', 'aria-label': 'Search' });
    A.search.addEventListener('input', function () { accessFilter.search = A.search.value; later(applyAccessFilters); });
    A.date = h('select', { class: 'lg-input', 'aria-label': 'Date', onchange: function () { accessFilter.date = A.date.value; applyAccessFilters(); } }, [h('option', { value: '', text: 'All dates' })]);
    A.from = h('input', { type: 'text', class: 'lg-input lg-input-time', placeholder: '09:00:00', 'aria-label': 'From time' });
    A.to = h('input', { type: 'text', class: 'lg-input lg-input-time', placeholder: '10:00:00', 'aria-label': 'To time' });
    A.from.addEventListener('input', function () { accessFilter.timeFrom = A.from.value.trim(); later(applyAccessFilters); });
    A.to.addEventListener('input', function () { accessFilter.timeTo = A.to.value.trim(); later(applyAccessFilters); });
    var chips = chipRow([{ id: 2, label: '2xx', tone: 'ok' }, { id: 3, label: '3xx', tone: 'info' }, { id: 4, label: '4xx', tone: 'warn' }, { id: 5, label: '5xx', tone: 'error' }], accessFilter.statusClasses, function (id, on) {
      var s = accessFilter.statusClasses;
      if (on && s.indexOf(id) === -1) s.push(id);
      if (!on) accessFilter.statusClasses = s.filter(function (c) { return c !== id; });
      applyAccessFilters();
    });

    A.pills = h('div', { class: 'lg-pills', hidden: true });
    A.stats = W.statBar([
      { id: 'total', label: 'Total requests:' }, { id: 'ips', label: 'Unique IPs:' }, { id: 'bandwidth', label: 'Total bandwidth:' }, { id: 'errors', label: 'Errors (4xx, 5xx):', tone: 'error' },
      { id: 'hour', label: 'Most active hour:', tone: 'warn' }, { id: 'parsed', label: 'Parsed successfully:', title: 'The share of the lines in the file that are shown after the filters above' }
    ]);
    A.stats.visible(true);

    A.statusChart = h('div', { class: 'lg-bars' });
    A.timeChart = h('div', { class: 'lg-hchart-wrap' });
    A.ipCard = h('div'); A.urlCard = h('div'); A.n404Card = h('div'); A.osCard = h('div'); A.botsCard = h('div'); A.slowCard = h('div'); A.bwCard = h('div'); A.refCard = h('div');
    var analyzer = h('div', { class: 'lg-nx-analyzer' }, [
      A.pills, A.stats.el,
      h('div', { class: 'lg-cards' }, [
        card('Status codes', A.statusChart), card('Requests over time (per hour)', A.timeChart), card('Top 10 client IPs', A.ipCard), card('Top 10 requested URLs', A.urlCard),
        card('404 Not Found — yours first', A.n404Card), card('Top operating systems', A.osCard), card('Scanner sources', A.botsCard, 'error'),
        card('Top 10 slowest endpoints', A.slowCard, 'warn'), card('Bandwidth hogs', A.bwCard), card('Top 10 referrers', A.refCard)
      ])
    ]);

    A.streamCount = h('strong', { text: '0' });
    A.stream = h('div', { class: 'lg-nxstream' });
    A.streamBox = L.keepScroll(h('div', { class: 'lg-nxbox' }, [A.stream]));
    A.streamBox.addEventListener('scroll', function () { if (A.streamBox.scrollTop + A.streamBox.clientHeight >= A.streamBox.scrollHeight - 200) loadMore(A, access, 'access'); });
    var stream = h('div', { class: 'lg-nx-streampane', hidden: true }, [h('div', { class: 'lg-nx-streamhead' }, [A.streamCount, ' requests match the filters above']), A.streamBox]);

    var views = W.tabs([{ id: 'analyzer', label: 'Analyzer' }, { id: 'stream', label: 'Log Stream' }], 'analyzer', function (id) { analyzer.hidden = id !== 'analyzer'; stream.hidden = id !== 'stream'; }, 'lg-tabs lg-tabs-sm');

    A.results = h('div', { class: 'lg-nx-results', hidden: true }, [
      h('div', { class: 'lg-fbar' }, [h('div', { class: 'lg-frow' }, [A.search, chips, A.date, h('span', { class: 'lg-flabel', text: 'Time' }), A.from, h('span', { class: 'muted', text: '→' }), A.to])]),
      views.el, analyzer, stream
    ]);
    return h('div', { class: 'lg-nx-pane' }, [A.inputCard, A.results]);
  }

  function buildErrors() {
    E.inputCard = inputCard(E, 'nginx error', function (f) { loadFile(f, 'error'); }, analyzeErrorText);
    E.hint = h('div', { class: 'lg-note lg-note-warn', hidden: true });

    E.search = h('input', { type: 'text', class: 'lg-input lg-input-grow', placeholder: 'Search message, IP…', spellcheck: 'false', 'aria-label': 'Search' });
    E.search.addEventListener('input', function () { errorFilter.search = E.search.value; later(applyErrorFilters); });
    E.date = h('select', { class: 'lg-input', 'aria-label': 'Date', onchange: function () { errorFilter.date = E.date.value; applyErrorFilters(); } }, [h('option', { value: '', text: 'All dates' })]);
    E.from = h('input', { type: 'text', class: 'lg-input lg-input-time', placeholder: '09:00:00', 'aria-label': 'From time' });
    E.to = h('input', { type: 'text', class: 'lg-input lg-input-time', placeholder: '10:00:00', 'aria-label': 'To time' });
    E.from.addEventListener('input', function () { errorFilter.timeFrom = E.from.value.trim(); later(applyErrorFilters); });
    E.to.addEventListener('input', function () { errorFilter.timeTo = E.to.value.trim(); later(applyErrorFilters); });
    var chips = chipRow(errorFilter.levels.map(function (l) { return { id: l, label: l, tone: (l === 'error' || l === 'crit' || l === 'alert' || l === 'emerg') ? 'error' : (l === 'warn' ? 'warn' : 'info') }; }), errorFilter.levels, function (id, on) {
      var s = errorFilter.levels;
      if (on && s.indexOf(id) === -1) s.push(id);
      if (!on) errorFilter.levels = s.filter(function (c) { return c !== id; });
      applyErrorFilters();
    });

    E.stats = W.statBar([{ id: 'total', label: 'Total errors:' }, { id: 'levels', label: 'Unique levels:' }, { id: 'clients', label: 'Unique clients:' }, { id: 'hour', label: 'Most active hour:', tone: 'warn' }]);
    E.stats.visible(true);
    E.levelChart = h('div', { class: 'lg-bars' }); E.timeChart = h('div', { class: 'lg-hchart-wrap' });
    E.msgCard = h('div'); E.ipCard = h('div'); E.reqCard = h('div');
    var analyzer = h('div', { class: 'lg-nx-analyzer' }, [E.stats.el, h('div', { class: 'lg-cards' }, [
      card('Error levels', E.levelChart), card('Errors over time (per hour)', E.timeChart), card('Top 10 error messages', E.msgCard), card('Top 10 client IPs', E.ipCard), card('Top 10 failing requests', E.reqCard)])]);

    E.streamCount = h('strong', { text: '0' });
    E.stream = h('div', { class: 'lg-nxstream' });
    E.streamBox = L.keepScroll(h('div', { class: 'lg-nxbox' }, [E.stream]));
    E.streamBox.addEventListener('scroll', function () { if (E.streamBox.scrollTop + E.streamBox.clientHeight >= E.streamBox.scrollHeight - 200) loadMore(E, errors, 'error'); });
    var stream = h('div', { class: 'lg-nx-streampane', hidden: true }, [h('div', { class: 'lg-nx-streamhead' }, [E.streamCount, ' entries match the filters above']), E.streamBox]);
    var views = W.tabs([{ id: 'analyzer', label: 'Analyzer' }, { id: 'stream', label: 'Log Stream' }], 'analyzer', function (id) { analyzer.hidden = id !== 'analyzer'; stream.hidden = id !== 'stream'; }, 'lg-tabs lg-tabs-sm');

    E.results = h('div', { class: 'lg-nx-results', hidden: true }, [
      h('div', { class: 'lg-fbar' }, [h('div', { class: 'lg-frow' }, [E.search, chips, E.date, h('span', { class: 'lg-flabel', text: 'Time' }), E.from, h('span', { class: 'muted', text: '→' }), E.to])]),
      views.el, analyzer, stream
    ]);
    return h('div', { class: 'lg-nx-pane' }, [E.inputCard, E.hint, E.results]);
  }

  function buildCorrelator() {
    C.input = h('textarea', { class: 'lg-textarea', rows: '6', placeholder: 'Paste the application runtime log here, or load a file…', spellcheck: 'false', 'aria-label': 'Application log' });
    var picker = W.filePicker('Browse files', { accept: '.log,.txt,.gz' }, loadCorrFile);
    C.windowMs = h('input', { type: 'number', class: 'lg-input lg-input-num', min: '100', step: '100', value: '3000', 'aria-label': 'Match window (ms)' });
    C.summary = W.statBar([{ id: 'requests', label: 'rtr requests (timed):' }, { id: 'events', label: 'Runtime events (flows + errors/warnings):' }, { id: 'matched', label: 'Matched:', tone: 'ok' }]);
    // The label of the last figure carries the window, so the stat bar needs to be able to change it.
    var matchedLabel = C.summary.el.children[2];
    C.summary.setLabel = function (id, text) { if (id === 'matched') matchedLabel.firstChild.nodeValue = text + ' '; };
    C.out = h('div', { class: 'lg-corr-result' });
    var panel = h('div', { class: 'lg-nx-pane' }, [
      h('p', { class: 'muted' }, ['Links rtr (nginx) requests from the ', h('strong', { text: 'Access Log' }), ' tab to application runtime activity by time proximity — the rtr log carries no correlation ID, so a match here means “within ±N ms”, never “this request caused that event”. Load the application runtime log below.']),
      h('div', { class: 'lg-inputcard lg-inputcard-sm' }, [C.input, h('div', { class: 'lg-empty-actions' }, [picker.button, picker.input,
        h('label', { class: 'lg-check' }, ['Match window: ', C.windowMs, ' ms']), h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Correlate', onclick: runCorrelation }),
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Clear', onclick: clearCorrelation })])]),
      C.summary.el, C.out
    ]);
    W.dropTarget(panel, loadCorrFile);
    return panel;
  }

  function resetAll() {
    access = { logs: [], filtered: [], visible: 0, name: null };
    errors = { logs: [], filtered: [], visible: 0, scanned: 0, matched: 0, sample: '', name: null };
    drill = { hour: null, ip: null, url: null };
    A.input.value = ''; E.input.value = '';
    A.inputCard.hidden = false; A.results.hidden = true; A.anonBtn.hidden = true;
    E.inputCard.hidden = false; E.results.hidden = true; E.hint.hidden = true;
    clearCorrelation();
  }

  function sendToAnonymizer() {
    var text = access.logs.map(function (l) { return l.rawLine; }).join('\n');
    if (!text) return;
    L.goto('log-anonymizer', { withReturn: true });
    L.tools['log-anonymizer'].setInput(text);
  }

  function build() {
    A.anonBtn = h('button', { class: 'btn btn-sm', type: 'button', text: 'Anonymize in tool', hidden: true, title: 'Send the access log to the Anonymizer', onclick: sendToAnonymizer });
    var actions = h('div', { class: 'lg-actions' }, [A.anonBtn, h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', text: 'Clear', title: 'Clear the logs and what was read from them', onclick: resetAll })]);
    panes.access = buildAccess();
    panes.error = buildErrors(); panes.error.hidden = true;
    panes.correlator = buildCorrelator(); panes.correlator.hidden = true;
    tabs = W.tabs([{ id: 'access', label: 'Access Log' }, { id: 'error', label: 'Error Log' }, { id: 'correlator', label: 'Timeline Correlator' }], 'access',
      function (id) { Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== id; }); });
    root = h('div', { class: 'lg-tool lg-nx' }, [actions, tabs.el, h('div', { class: 'lg-panes lg-scroll' }, [panes.access, panes.error, panes.correlator])]);
    return root;
  }

  L.register({
    id: 'nginx-log', label: 'Nginx',
    hint: 'Mendix Cloud router access / error logs: clients, paths, status codes, p95/p99 and whose fault each 404 is.',
    build: build,
    // The Incident Report source: the access stream's current filtered entries (falling back to everything
    // parsed before the stream has been filtered once).
    reportSection: function (fromMs, toMs) { return window.nginxBuildReportSection((access.filtered && access.filtered.length) ? access.filtered : access.logs, fromMs, toMs); }
  });
})();
