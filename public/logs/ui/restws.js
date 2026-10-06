/* MxScout — Log analysis: the REST & WS Extractor.
 *
 * Rebuilds the integration calls a Mendix app makes and receives — REST Consume, REST Publish and web
 * services (SOAP) — from TRACE logs: each request paired with its response (first in, first out, per
 * endpoint, with an explicit "uncertain" flag when two calls to one endpoint overlap), method, URL, status,
 * headers, payloads and the wire-time duration from the timestamps. Requests that never got a response
 * are found, and so are client-timeout suspects. With MicroflowEngine TRACE the call is anchored to the
 * microflow that made it, which closes the chain microflow → REST → SQL across the tools.
 *
 * The reading is MxDevSwissTool's (Mikołaj / RealMecowhy, MIT) — ../engine/restws.js — and so is the
 * behaviour of this screen.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  var calls = [];
  var lastFiltered = [];
  var lastEndpoints = [];
  var view = 'calls';      // 'calls' = one row per call · 'endpoint' = one row per endpoint
  var sortKey = null, sortDir = -1;
  var activeId = null, slowestId = null, selectedCall = null;
  var vlist = null, vlistMode = null;
  var ui = {};

  var SORT = {
    time: function (c) { return c._recIdx; },
    duration: function (c) { return c.durationMs !== null && !isNaN(c.durationMs) ? c.durationMs : -1; },
    status: function (c) { return c.status !== null ? c.status : -1; }
  };
  var ENDPOINT_SORT = {
    count: function (g) { return g.count; },
    total: function (g) { return g.sumMs === null ? -1 : g.sumMs; },
    avg: function (g) { return g.avgMs === null ? -1 : g.avgMs; },
    max: function (g) { return g.maxMs === null ? -1 : g.maxMs; },
    errors: function (g) { return g.errors; }
  };

  var BADGES = {
    'rest|out': { label: 'REST →', cls: 'rest-out', title: 'REST Consume — this app calling an external REST API' },
    'rest|in': { label: 'REST ←', cls: 'rest-in', title: 'REST Publish — an external client calling this app' },
    'soap|out': { label: 'SOAP →', cls: 'soap-out', title: 'WebServices — this app calling an external SOAP service' },
    'soap|in': { label: 'SOAP ←', cls: 'soap-in', title: 'WebServices — an external client calling a published SOAP service' }
  };

  var loader = L.makeLoader('ws-rest-extractor', {
    parsing: 'Parsing REST/WS calls...', building: 'Pairing requests…',
    apply: function (res) {
      var out = window.wsreExtractCalls(res.records);
      calls = out.calls;
      if (calls.length === 0) {
        ui.note.hidden = false;
        ui.note.textContent = ' · no REST/WS records';
        ui.note.title = 'The log has no REST Consume / REST Publish / WebServices TRACE lines. Set those log nodes to TRACE and reproduce the scenario.';
      } else { ui.note.hidden = true; ui.note.textContent = ''; }
      filter();
    }
  });

  function clearAll() {
    calls = []; lastFiltered = []; lastEndpoints = [];
    selectedCall = null; activeId = null; slowestId = null;
    if (vlist) { vlist.destroy(); vlist = null; }
    vlistMode = null;
    ui.stats.visible(false);
    ui.note.hidden = true;
    ui.count.textContent = '0';
    ui.unit.textContent = 'calls';
    showEmptyList();
    clearDetail();
    loader.forget();
  }

  // ---------- filtering ----------
  function filter() {
    var search = ui.search.value.toLowerCase();
    var type = ui.type.value;
    var slowOnly = ui.slowOnly.input.checked;
    var slowMs = parseFloat(ui.slowMs.value) || 0;

    var out = calls.filter(function (c) {
      if (type === 'OUT' && c.direction !== 'out') return false;
      if (type === 'IN' && c.direction !== 'in') return false;
      if (type === 'REST' && c.kind !== 'rest') return false;
      if (type === 'SOAP' && c.kind !== 'soap') return false;
      if (type === 'ERR' && !window.wsreIsError(c) && c.endTs !== null) return false;
      if (type === 'UNC' && !c.uncertain) return false;
      if (slowOnly) { var d = c.durationMs !== null ? c.durationMs : NaN; if (isNaN(d) || d <= slowMs) return false; }
      if (search) {
        var hay = (window.wsreEndpoint(c) + ' ' + c.method + ' ' + (c.microflow || '') + ' ' + (c.corrId || '') + ' ' + (c.status || '')).toLowerCase();
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    });
    if (sortKey && SORT[sortKey]) { var acc = SORT[sortKey]; out.sort(function (a, b) { return (acc(a) - acc(b)) * sortDir; }); }

    lastFiltered = out;
    updateStats(out);

    if (view === 'endpoint') {
      var groups = window.wsreAggregateByEndpoint(out);
      if (sortKey && ENDPOINT_SORT[sortKey]) { var eacc = ENDPOINT_SORT[sortKey]; groups.sort(function (a, b) { return (eacc(a) - eacc(b)) * sortDir; }); }
      lastEndpoints = groups;
      ui.count.textContent = String(groups.length);
      ui.unit.textContent = groups.length === 1 ? 'endpoint' : 'endpoints';
      renderList(groups, renderEndpointRow, 'endpoint');
    } else {
      lastEndpoints = [];
      ui.count.textContent = String(out.length);
      ui.unit.textContent = out.length === 1 ? 'call' : 'calls';
      renderList(out, renderRow, 'calls');
    }
  }

  function setView(v) {
    view = v;
    ui.view.set(v);
    ui.headCalls.show(v !== 'endpoint');
    ui.headEndpoint.show(v === 'endpoint');
    sortKey = null; sortDir = -1;
    ui.headCalls.setSort(null); ui.headEndpoint.setSort(null);
    filter();
  }

  function sort(key) {
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = key === 'time' ? 1 : -1; }
    ui.headCalls.setSort(sortKey, sortDir);
    ui.headEndpoint.setSort(sortKey, sortDir);
    filter();
  }

  function updateStats(list) {
    if (!calls.length) { ui.stats.visible(false); slowestId = null; return; }
    ui.stats.visible(true);
    var sum = 0, timed = 0, slowest = null, slowestMs = -1, errors = 0, unanswered = 0, uncertain = 0;
    list.forEach(function (c) {
      if (c.durationMs !== null && !isNaN(c.durationMs)) { sum += c.durationMs; timed++; if (c.durationMs > slowestMs) { slowestMs = c.durationMs; slowest = c; } }
      if (window.wsreIsError(c)) errors++;
      if (c.endTs === null) unanswered++;
      if (c.uncertain) uncertain++;
    });
    ui.stats.set('total', String(list.length));
    ui.stats.set('avg', timed ? window.wsreFmtMs(sum / timed) : '–');
    ui.stats.set('slowest', slowest ? window.wsreFmtMs(slowestMs) : '–');
    ui.stats.set('errors', String(errors));
    ui.stats.set('unanswered', String(unanswered));
    ui.stats.set('uncertain', String(uncertain));
    slowestId = slowest ? slowest.id : null;
  }

  function selectSlowest() {
    if (slowestId === null) return;
    // The stat points at one call, which the endpoint view has no row for — switch back rather than doing
    // nothing on a click that looks actionable.
    if (view !== 'calls') setView('calls');
    if (!vlist) return;
    var idx = vlist.indexOf(function (c) { return c.id === slowestId; });
    if (idx < 0) return;
    activeId = slowestId;
    vlist.scrollToIndex(idx, 'center');
    vlist.refresh();
    selectCall(vlist.itemAt(idx));
  }

  // ---------- the list ----------
  function statusNode(c) {
    if (c.status !== null) {
      var cls = c.status >= 500 ? 'lg-tone-error' : (c.status >= 400 ? 'lg-tone-warn' : (c.status >= 300 ? 'lg-tone-info' : 'lg-tone-ok'));
      return h('span', { class: 'lg-bold ' + cls, text: String(c.status) });
    }
    if (c.statusText === 'SOAP Fault') return h('span', { class: 'lg-bold lg-tone-error', text: 'Fault' });
    if (c.statusText === 'OK') return h('span', { class: 'lg-bold lg-tone-ok', text: 'OK' });
    return h('span', { class: 'lg-muted', title: 'No response found in the log for this request', text: '…' });
  }

  function renderRow(c) {
    var badge = BADGES[c.kind + '|' + c.direction];
    var timeShort = (c.startTs || '').replace(/^[^T]*T/, '').substring(0, 12);
    var endpoint = window.wsreEndpoint(c);
    return h('div', {
      class: 'lg-lrow lg-wrow' + (activeId != null && c.id === activeId ? ' is-active' : ''),
      onclick: function () { activeId = c.id; if (vlist) vlist.refresh(); selectCall(c); }
    }, [
      h('div', { class: 'lg-mono lg-muted lg-small', title: c.startTs || '', text: timeShort }),
      h('div', { class: 'lg-bold lg-dir lg-dir-' + badge.cls, title: badge.title, text: badge.label }),
      h('div', { class: 'lg-bold' }, [
        c.method,
        c.uncertain ? h('span', { class: 'lg-slowmark', title: 'Another call to the same endpoint was in flight at the same time — request/response pairing is FIFO-based and may be uncertain', text: '⇅' }) : null,
        c.timeoutSuspect ? h('span', { class: 'lg-slowmark is-bad', title: 'No response logged and a client timeout of ' + c.timeoutSec + 's was configured — possible client timeout', text: '⏱' }) : null
      ]),
      h('div', null, [statusNode(c)]),
      h('div', { class: 'lg-bold lg-accent', text: c.durationMs !== null ? window.wsreFmtMs(c.durationMs) : '-' }),
      h('div', { class: 'lg-ellipsis', title: endpoint, text: endpoint })
    ]);
  }

  // One row per endpoint.
  function renderEndpointRow(g) {
    var isSel = activeId != null && g.worst && g.worst.id === activeId;
    var coverage = g.timedCount ? g.timedCount + ' of ' + g.count + ' call(s) have a paired response and therefore a duration'
      : 'No response was found in the log for any of these calls — the log carries no duration for this endpoint';
    var methods = Array.from(g.methods).join(', ');
    var ms = function (v) { return h('div', { class: v === null ? 'lg-muted' : '', text: v === null ? '–' : window.wsreFmtMs(v) }); };
    return h('div', {
      class: 'lg-lrow lg-erow' + (isSel ? ' is-active' : ''),
      onclick: function () { activeId = g.worst ? g.worst.id : null; if (vlist) vlist.refresh(); if (g.worst) selectCall(g.worst); }
    }, [
      h('div', { class: 'lg-bold ' + (g.count >= 10 ? 'lg-dur-bad' : (g.count > 1 ? 'lg-dur-warn' : '')) }, [
        '×' + g.count, g.unanswered ? h('span', { class: 'lg-muted', title: g.unanswered + ' of these calls have no response in the log', text: ' …' }) : null
      ]),
      h('div', { class: 'lg-bold ' + (g.sumMs === null ? 'lg-muted' : 'lg-accent'), title: coverage, text: g.sumMs === null ? '–' : window.wsreFmtMs(g.sumMs) }),
      ms(g.avgMs), ms(g.maxMs),
      h('div', { class: 'lg-bold ' + (g.errors ? 'lg-tone-error' : 'lg-muted'), text: g.errors ? String(g.errors) : '–' }),
      h('div', { class: 'lg-ellipsis', title: methods + ' ' + g.endpoint }, [h('span', { class: 'lg-muted', text: methods + ' ' }), g.endpoint])
    ]);
  }

  function showEmptyList() {
    if (vlist) { vlist.destroy(); vlist = null; }
    L.replace(ui.list, [W.empty('Drop a log file here or use “Load TRACE log”', [
      h('p', { class: 'muted', text: 'REST Consume, REST Publish and WebServices at TRACE — requests paired with their responses.' }),
      W.howTo('How to get this data', [h('p', null, ['Raise ', h('strong', { text: 'REST Consume' }), ', ', h('strong', { text: 'REST Publish' }), ' and ', h('strong', { text: 'WebServices' }), ' to ', h('strong', { text: 'TRACE' }),
        ' (and ', h('strong', { text: 'MicroflowEngine' }), ' to TRACE if you want each call tied to the microflow that made it) — Studio Pro: Console → Advanced → Set Log Levels; Mendix Cloud: Environment → Details → Log Levels. Reproduce the scenario, then export or download the log.'])])
    ])]);
  }

  function renderList(list, rowFn, mode) {
    if (vlist && vlistMode !== mode) { vlist.destroy(); vlist = null; }
    vlistMode = mode;
    if (list.length === 0) {
      if (vlist) { vlist.destroy(); vlist = null; }
      if (!calls.length) showEmptyList(); else L.replace(ui.list, [h('div', { class: 'lg-list-empty', text: 'No calls found matching criteria.' })]);
      return;
    }
    if (!vlist) vlist = window.createVirtualList({ container: ui.list, renderRow: rowFn });
    vlist.setItems(list);
  }

  // ---------- the detail pane ----------
  function clearDetail() {
    L.replace(ui.overview, [h('div', { class: 'lg-muted-block', text: 'Select a call to see its details.' })]);
    L.replace(ui.reqHeaders, [headerRows(null)]);
    L.replace(ui.respHeaders, [headerRows(null)]);
    L.replace(ui.reqBody, [h('div', { class: 'lg-muted-block', text: 'No request body logged.' })]);
    L.replace(ui.respBody, [h('div', { class: 'lg-muted-block', text: 'No response body logged.' })]);
    ui.hand.mft.disabled = true; ui.hand.sql.disabled = true; ui.hand.log.disabled = true;
  }

  function headerRows(headers) {
    if (!headers || headers.length === 0) return h('div', { class: 'lg-muted-block', text: 'No headers logged' });
    return h('table', { class: 'lg-table lg-table-kv' }, [h('tbody', null, headers.map(function (hd) {
      return h('tr', null, [h('td', { class: 'lg-mono lg-nowrap', text: hd.name }), h('td', { class: 'lg-mono lg-breakall', text: hd.value })]);
    }))]);
  }

  function selectCall(c) {
    selectedCall = c;
    var badge = BADGES[c.kind + '|' + c.direction];
    var rows = [];
    rows.push(['Call', [h('strong', { class: 'lg-dir lg-dir-' + badge.cls, text: badge.label }), ' ' + badge.title]]);
    rows.push(['Method', [h('strong', { text: c.method })]]);
    if (c.url) rows.push(['URL', [h('span', { class: 'lg-mono lg-breakall', text: c.url })]]);
    if (c.service) rows.push(['Service', [c.service]]);
    if (c.operation) rows.push(['Operation', [c.operation]]);
    rows.push(['Status', [statusNode(c), c.statusText && c.statusText !== 'OK' ? ' ' + c.statusText : '']]);
    rows.push(['Duration', c.durationMs !== null ? [h('strong', { text: window.wsreFmtMs(c.durationMs) }), ' (request → response timestamp delta)'] : [h('span', { class: 'lg-muted', text: 'no response found in the log' })]]);
    if (c.timeoutSec !== null) rows.push(['Client timeout', [c.timeoutSec + ' s', c.timeoutSuspect ? h('span', { class: 'lg-tone-error', text: ' — no response logged, possible client timeout' }) : '']]);
    if (c.clientIp) rows.push(['Client IP', [c.clientIp]]);
    rows.push(['Started', [h('span', { class: 'lg-mono', text: c.startTs || '' })]]);
    if (c.endTs) rows.push(['Responded', [h('span', { class: 'lg-mono', text: c.endTs })]]);
    if (c.uncertain) rows.push(['Pairing', [h('span', { class: 'lg-tone-warn', text: '⇅ uncertain' }), ' — another call to the same endpoint was in flight; FIFO pairing assumed']]);
    if (c.microflow) rows.push(['Microflow', [h('span', { class: 'lg-mono', text: c.microflow }), ' ', h('span', { class: 'lg-muted', text: '[' + (c.corrId || '') + ']' }), ' — from the CallRest/CallWebservice activity just before this call']]);

    var endpointKey = window.wsreEndpoint(c);
    var totals = endpointKey ? window.wsreEndpointTotals(calls).get(endpointKey) : null;
    if (totals) rows.push(['Total transferred', [h('strong', { text: window.wsreFmtBytes(totals.bytes) }), ' request+response across ' + totals.count + ' call' + (totals.count === 1 ? '' : 's') + ' to this endpoint (this session) — helps spot over-fetching']]);

    L.replace(ui.overview, [h('table', { class: 'lg-table lg-table-kv' }, [h('tbody', null, rows.map(function (r) {
      return h('tr', null, [h('td', { class: 'lg-muted lg-nowrap lg-keycell', text: r[0] }), h('td', null, r[1])]);
    }))])]);

    ui.hand.mft.disabled = !c.microflow;
    ui.hand.sql.disabled = !c.endTs;
    ui.hand.log.disabled = false;

    L.replace(ui.reqHeaders, [headerRows(c.requestHeaders)]);
    L.replace(ui.respHeaders, [headerRows(c.responseHeaders)]);
    L.replace(ui.reqBody, [W.payload(c.requestBody, 'No request body logged.')]);
    L.replace(ui.respBody, [W.payload(c.responseBody, c.endTs ? 'No response body logged.' : 'No response found in the log for this request.')]);
  }

  // ---------- hand-offs: the microflow → REST → SQL chain ----------
  // The CallRest/CallWebservice anchor gives the correlation ID and microflow name, so a call can jump to its
  // microflow in the Tracer; the [start, end] window jumps to the SQL that ran meanwhile in the Query
  // Extractor. If the target tool is empty, the log loaded here is handed over — one file, three tools.
  function showInTracer() {
    var c = selectedCall;
    if (!c) { L.toast('Select a call first.', 'warn'); return; }
    if (!c.microflow) { L.toast('This call has no CallRest/CallWebservice anchor — enable MicroflowEngine TRACE to link calls to microflows.', 'warn'); return; }
    var mft = L.tools['microflow-tracer'];
    L.goto('microflow-tracer', { withReturn: true });
    var raw = loader.rawText();
    var ready = (!mft.hasData() && raw) ? Promise.resolve(mft.loadText(raw)) : Promise.resolve();
    ready.then(function () { mft.search(c.microflow); });
  }

  function showInQueries() {
    var c = selectedCall;
    if (!c) { L.toast('Select a call first.', 'warn'); return; }
    if (!c.endTs) { L.toast('This call has no response record — no time window to correlate.', 'warn'); return; }
    var lqe = L.tools['log-query-extractor'];
    L.goto('log-query-extractor', { withReturn: true });
    lqe.setTimeWindow(c.startTs, c.endTs, c.method + ' ' + (c.operation || c.service || c.url || ''));
    var raw = loader.rawText();
    if (!lqe.hasData() && raw) lqe.loadText(raw);
  }

  // A failed or timed-out integration call is rarely explained by the call record itself — the reason
  // (connection refused, a stack trace, the retry that followed) is logged around it under the same
  // correlation ID.
  function showInLogViewer() {
    var c = selectedCall;
    if (!c) { L.toast('Select a call first.', 'warn'); return; }
    // corrId is only populated when a CallRest/CallWebservice anchor was matched — the REST/WebServices records
    // themselves carry no correlation ID, so without MicroflowEngine TRACE there is nothing to filter on.
    if (!c.corrId) { L.toast('This call has no correlation ID — enable MicroflowEngine TRACE so calls can be linked to the request that made them.', 'warn'); return; }
    var lv = L.tools['log-viewer'];
    L.goto('log-viewer', { withReturn: true });
    var raw = loader.rawText();
    var ready = (!lv.hasData() && raw) ? Promise.resolve(lv.loadText(raw, 'from REST & WS Extractor')) : Promise.resolve();
    ready.then(function () { lv.filterInsight('', '', c.corrId); });
  }

  // ---------- exports ----------
  function exportHeader() { return view === 'endpoint' ? window.WSRE_ENDPOINT_EXPORT_HEADER : window.WSRE_EXPORT_HEADER; }
  function callRow(c) {
    return [
      c.startTs, c.node, c.direction === 'out' ? 'outgoing' : 'incoming', c.method, c.status !== null ? c.status : c.statusText,
      (c.durationMs !== null && !isNaN(c.durationMs)) ? +c.durationMs.toFixed(3) : '', window.wsreEndpoint(c), c.microflow || '', c.corrId || '',
      [c.uncertain ? 'uncertain-pairing' : '', c.timeoutSuspect ? 'timeout-suspect' : ''].filter(Boolean).join(' ')
    ];
  }
  function exportRows() { return view === 'endpoint' ? window.wsreEndpointExportRows(lastEndpoints) : lastFiltered.map(callRow); }
  function needRows() {
    if (lastFiltered.length) return true;
    L.toast('Nothing to export — load a log first (and check the active filters).', 'warn');
    return false;
  }

  // Incident Report source: the current filtered call list, optionally narrowed to [fromMs, toMs] by request
  // time. The "N with error status" phrasing is kept in both shapes — the Incident Report's own summary line
  // parses that number out of this subtitle. null when empty.
  function reportSection(fromMs, toMs) {
    if (!calls.length) return null;
    var inWin = lastFiltered.filter(function (c) {
      if (fromMs != null && !isNaN(c.startMs) && c.startMs < fromMs) return false;
      if (toMs != null && !isNaN(c.startMs) && c.startMs > toMs) return false;
      return true;
    });
    if (!inWin.length) return null;
    var firstMs = Infinity, lastMs = -Infinity, errors = 0;
    var rows = inWin.map(function (c) {
      if (!isNaN(c.startMs)) { if (c.startMs < firstMs) firstMs = c.startMs; if (c.startMs > lastMs) lastMs = c.startMs; }
      if ((c.status !== null && c.status >= 400) || /fault/i.test(c.statusText || '')) errors++;
      return callRow(c);
    });
    var span = { firstMs: firstMs === Infinity ? null : firstMs, lastMs: lastMs === -Infinity ? null : lastMs };
    if (view === 'endpoint') {
      var groups = window.wsreAggregateByEndpoint(inWin);
      return Object.assign({
        id: 'ws-rest-extractor', title: 'REST & WS Extractor — integration calls (by endpoint)',
        subtitle: groups.length + ' endpoint' + (groups.length === 1 ? '' : 's') + ' from ' + inWin.length + ' call' + (inWin.length === 1 ? '' : 's') + (errors ? ' · ' + errors + ' with error status' : ''),
        columns: window.WSRE_ENDPOINT_EXPORT_HEADER, rows: window.wsreEndpointExportRows(groups), total: groups.length
      }, span);
    }
    return Object.assign({
      id: 'ws-rest-extractor', title: 'REST & WS Extractor — integration calls',
      subtitle: rows.length + ' call' + (rows.length === 1 ? '' : 's') + (errors ? ' · ' + errors + ' with error status' : ''),
      columns: window.WSRE_EXPORT_HEADER, rows: rows, total: rows.length
    }, span);
  }

  // ---------- build ----------
  function build() {
    var picker = W.filePicker('Load TRACE log', { primary: true, accept: '.log,.txt,.csv,.gz' }, loader.loadFiles);
    var actions = h('div', { class: 'lg-actions' }, [
      picker.button, picker.input,
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Export CSV', title: 'Download the currently filtered call list as a CSV file', onclick: function () { if (needRows()) L.downloadCsv('rest-ws-calls.csv', exportHeader(), exportRows()); } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy Markdown', title: 'Copy the currently filtered call list as a Markdown table', onclick: function (e) { if (needRows()) L.copyMarkdown(exportHeader(), exportRows(), e.currentTarget); } }),
      h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', text: 'Clear', onclick: clearAll })
    ]);

    ui.view = W.segmented([
      { id: 'calls', label: 'Calls' },
      { id: 'endpoint', label: 'By endpoint', title: 'One row per endpoint — calls, total and average duration, errors. An integration incident is “endpoint X fires 300× on page open”, not “call #4172 took 900 ms”.' }
    ], 'calls', setView);
    ui.search = W.searchBox('Search URL, service, microflow…', filter, 'lg-input-grow');
    ui.type = h('select', { class: 'lg-input', 'aria-label': 'Call type', onchange: filter }, [
      h('option', { value: 'ALL', text: 'All calls' }), h('option', { value: 'OUT', text: 'Outgoing (consume)' }), h('option', { value: 'IN', text: 'Incoming (publish)' }),
      h('option', { value: 'REST', text: 'REST only' }), h('option', { value: 'SOAP', text: 'SOAP only' }), h('option', { value: 'ERR', text: 'Errors / no response' }), h('option', { value: 'UNC', text: 'Uncertain pairing' })
    ]);
    ui.slowOnly = W.checkbox('Slow only >', false, filter, 'Show only calls with a duration above the threshold — calls without a paired response are hidden');
    ui.slowMs = W.numberInput(500, filter, { step: '100', title: 'Slow-call threshold in milliseconds' });
    ui.count = h('span', { text: '0' });
    ui.unit = h('span', { text: ' calls' });
    ui.note = h('span', { class: 'lg-tone-warn lg-help', hidden: true });

    ui.stats = W.statBar([
      { id: 'total', label: 'Calls:' }, { id: 'avg', label: 'Avg:', title: 'Average duration across visible calls with a paired response' },
      { id: 'slowest', label: 'Slowest:', tone: 'accent', onClick: selectSlowest, title: 'Slowest visible call — click to select it in the list' },
      { id: 'errors', label: 'Errors:', title: 'Calls with HTTP status ≥ 400 or a SOAP Fault' },
      { id: 'unanswered', label: 'No response:', title: 'Requests with no response found in the log — check the ⏱ badge for client-timeout suspects' },
      { id: 'uncertain', label: 'Uncertain:', title: 'Calls where another request to the same endpoint was in flight — FIFO pairing assumed' }
    ]);

    ui.headCalls = W.gridHead([
      { label: 'Time', key: 'time', title: 'Click to sort by log order' }, { label: 'Node', title: 'REST Consume / REST Publish / WebServices — the arrow shows the call direction' },
      { label: 'Method' }, { label: 'Status', key: 'status', title: 'Click to sort by status code' },
      { label: 'Duration', key: 'duration', title: 'Request → response timestamp delta — click to sort' }, { label: 'Endpoint' }
    ], '96px 76px 62px 56px 76px 1fr', sort);
    ui.headEndpoint = W.gridHead([
      { label: 'Calls', key: 'count', title: 'How many calls went to this endpoint — click to sort' },
      { label: 'Total', key: 'total', title: 'Sum of the measured durations of every call to this endpoint — click to sort' },
      { label: 'Avg', key: 'avg', title: 'Average measured duration per call — click to sort' },
      { label: 'Max', key: 'max', title: 'Slowest single call to this endpoint — click to sort' },
      { label: 'Err', key: 'errors', title: 'Calls with HTTP status ≥ 400 or a SOAP Fault — click to sort' }, { label: 'Endpoint' }
    ], '60px 84px 84px 84px 60px 1fr', sort);
    ui.headEndpoint.show(false);

    ui.list = L.keepScroll(h('div', { class: 'lg-list lg-vlist' }));
    W.dropTarget(ui.list, loader.loadFiles, L.looksLikeLog);
    showEmptyList();

    var left = h('div', { class: 'lg-left' }, [
      h('div', { class: 'lg-ltool' }, [ui.view.el, ui.search, ui.type, ui.slowOnly.el, ui.slowMs, h('span', { class: 'lg-dim', text: 'ms' }), h('span', { class: 'lg-count' }, [ui.count, ui.unit, ui.note])]),
      ui.stats.el, ui.headCalls.el, ui.headEndpoint.el, ui.list
    ]);

    // ---- right ----
    ui.overview = h('div');
    ui.reqHeaders = h('div'); ui.respHeaders = h('div'); ui.reqBody = h('div'); ui.respBody = h('div');
    ui.hand = {
      mft: h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Trace microflow', disabled: true, title: 'Open the microflow that made this call in the Microflow Tracer (needs the CallRest/CallWebservice anchor from MicroflowEngine TRACE)', onclick: showInTracer }),
      sql: h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'SQL in window', disabled: true, title: 'Show the SQL queries that executed during this call’s time window in the Log Query Extractor', onclick: showInQueries }),
      log: h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Show in Log Viewer', disabled: true, title: 'Show every log line recorded under this call’s correlation ID in the Log Viewer — the error, stack trace and surrounding context the call record itself does not hold', onclick: showInLogViewer })
    };
    var panes = {
      overview: h('div', { class: 'lg-dpane' }, [h('div', { class: 'lg-dbar' }, [ui.hand.mft, ui.hand.sql, ui.hand.log]), ui.overview]),
      headers: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-label', text: 'Request headers' }), ui.reqHeaders, h('div', { class: 'lg-label', text: 'Response headers' }), ui.respHeaders]),
      request: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-dbar' }, [W.copyButton(function () { return selectedCall ? W.payloadText(selectedCall.requestBody) : ''; })]), ui.reqBody]),
      response: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-dbar' }, [W.copyButton(function () { return selectedCall ? W.payloadText(selectedCall.responseBody) : ''; })]), ui.respBody])
    };
    var dtabs = W.tabs([{ id: 'overview', label: 'Overview' }, { id: 'headers', label: 'Headers' }, { id: 'request', label: 'Request' }, { id: 'response', label: 'Response' }], 'overview',
      function (id) { Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== id; }); }, 'lg-tabs lg-tabs-sm');
    var right = h('div', { class: 'lg-right' }, [dtabs.el, h('div', { class: 'lg-dbody' }, [panes.overview, panes.headers, panes.request, panes.response])]);
    clearDetail();

    return h('div', { class: 'lg-tool lg-split' }, [actions, h('div', { class: 'lg-splitbody' }, [left, right])]);
  }

  L.register({
    id: 'ws-rest-extractor', label: 'REST & WS',
    hint: 'REST and SOAP calls paired with their responses; by endpoint; microflow → REST → SQL.',
    build: build,
    hasData: function () { return calls.length > 0; },
    loadText: loader.loadText,
    loadFiles: loader.loadFiles,
    reportSection: reportSection
  });
})();
