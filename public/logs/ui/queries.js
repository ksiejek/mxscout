/* MxScout — Log analysis: the Log Query Extractor.
 *
 * Executed SQL, OQL and XPath out of a Mendix TRACE log, with the bound parameters put back, the query
 * plan and the duration the log carries, and — at default log levels, no TRACE needed — the slow-query
 * warnings the runtime writes with the full statement. Two views of the same list: one row per execution,
 * and one row per distinct statement (total time, average, count), because on a real log the expensive
 * statement is usually the cheap one run thousands of times.
 *
 * The extraction is MxDevSwissTool's (Mikołaj / RealMecowhy, MIT) — ../engine/queries.js — and so is the
 * behaviour of this screen. Two things in the original are not here, and that is deliberate: it could run
 * EXPLAIN against a live database, and it handed a plan to a separate visualiser. MxScout never connects to
 * a database, so the plan is shown as a tree instead and "Copy for EXPLAIN" puts the statement on the
 * clipboard for you to run yourself.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  var queries = [];
  var lastFiltered = [];
  var lastStatements = [];
  var skipped = 0;
  var sourceFormat = null;
  var view = 'exec';
  var sortKey = null, sortDir = -1;      // -1 = descending: slowest / most expensive first
  var timeWindow = null;                 // { from, to, label } — set by a hand-off from the Tracer, REST & WS or Nginx
  var activeId = null;
  var slowestId = null;
  var compare = [];                      // up to two sqlIds
  var selected = null;
  var vlist = null, vlistMode = null;
  var ui = {};

  var SORT = {
    time: function (q) { return q._idx; },
    duration: function (q) { return q.duration ? parseFloat(q.duration) : -1; },
    cost: function (q) { return q.cost !== null && q.cost !== undefined ? parseFloat(q.cost) : -1; },
    rows: function (q) { return q.rows !== '-' ? parseInt(q.rows, 10) : -1; }
  };
  // Statement-view keys are disjoint from the execution ones, so one sortKey serves both views without either
  // reading the other's accessor. Un-timed groups sort to the bottom (-1) instead of pretending to be 0 ms.
  var STMT_SORT = {
    count: function (g) { return g.count; },
    total: function (g) { return g.sumMs === null ? -1 : g.sumMs; },
    avg: function (g) { return g.avgMs === null ? -1 : g.avgMs; },
    max: function (g) { return g.maxMs === null ? -1 : g.maxMs; }
  };

  // A window bound arrives either as a log timestamp (the Tracer and REST & WS pass the record's own string) or
  // as an epoch (the Nginx analyzer resolves its access-log date itself). Render both readably.
  function boundLabel(v) {
    if (typeof v !== 'number') return String(v);
    return isFinite(v) ? new Date(v).toISOString().replace('T', ' ').replace('Z', '') : '?';
  }

  // ---------- applying a parse ----------
  var loader = L.makeLoader('log-query-extractor', {
    parsing: 'Parsing queries...', building: 'Extracting queries…',
    apply: function (res) {
      sourceFormat = res.format;
      skipped = res.skipped || 0;
      queries = window.lqeExtractQueries(res.records);
      updateNote();
      filter();
    }
  });

  function clearAll() {
    queries = []; lastFiltered = []; lastStatements = []; skipped = 0; sourceFormat = null;
    activeId = null; slowestId = null; compare = []; selected = null;
    if (vlist) { vlist.destroy(); vlist = null; }
    vlistMode = null;
    if (timeWindow) setTimeWindow(null, null);
    ui.stats.visible(false);
    ui.note.hidden = true;
    ui.compareBtn.disabled = true;
    ui.compareCount.textContent = '(0/2)';
    ui.count.textContent = '0';
    ui.unit.textContent = 'queries';
    showEmptyList();
    clearDetail();
    loader.forget();
  }

  // Non-invasive note next to the query counter: malformed CSV rows lost during parsing, or a hint that a live
  // log only yields slow-query warnings for now.
  function updateNote() {
    var parts = [];
    if (sourceFormat === 'live') parts.push('live log');
    if (skipped > 0) parts.push(skipped + ' line' + (skipped === 1 ? '' : 's') + ' skipped');
    if (!parts.length) { ui.note.hidden = true; ui.note.textContent = ''; return; }
    ui.note.hidden = false;
    ui.note.textContent = ' · ' + parts.join(' · ');
    ui.note.title = (sourceFormat === 'live'
      ? 'Mendix Cloud live-log format detected — SQL is extracted where the log has it (ConnectionBus_Retrieve) along with slow-query warnings (ConnectionBus_Queries). A Studio Pro CSV export with TRACE levels gives the fullest detail. '
      : '') + (skipped > 0 ? skipped + ' malformed row(s) with fewer than 4 fields were ignored — usually a truncated or hand-edited export.' : '');
  }

  // A time window from a hand-off: only the queries between two instants are shown, as a dismissible chip.
  function setTimeWindow(from, to, label) {
    timeWindow = from && to ? { from: from, to: to, label: label || '' } : null;
    if (timeWindow) {
      ui.windowChip.hidden = false;
      ui.windowChip.textContent = '⧉ ' + (label ? label + ' ' : '') + '×';
      ui.windowChip.title = 'Showing only queries between ' + boundLabel(from) + ' and ' + boundLabel(to) + '. Click × to remove.';
    } else {
      ui.windowChip.hidden = true;
      ui.windowChip.textContent = '';
    }
    filter();
  }

  // ---------- filtering, sorting, stats ----------
  function filter() {
    var search = ui.search.value.toLowerCase();
    var typeFilter = ui.type.value;
    var slowOnly = ui.slowOnly.input.checked;
    var slowMs = parseFloat(ui.slowMs.value) || 0;

    // Numeric comparison through the shared timestamp reader, so live (ISO) and CSV (day/month/year) formats
    // both work.
    var twFrom = timeWindow ? window.mtTsToMs(timeWindow.from) : NaN;
    var twTo = timeWindow ? window.mtTsToMs(timeWindow.to) : NaN;

    var out = queries.filter(function (q) {
      if (!isNaN(twFrom) && !isNaN(twTo)) {
        var t = window.mtTsToMs(q.timestamp);
        if (isNaN(t) || t < twFrom || t > twTo) return false;
      }
      if (typeFilter === 'DUP') { if (q.dupCount < 2) return false; }
      else if (typeFilter !== 'ALL' && q.type !== typeFilter) return false;
      if (slowOnly) {
        // Queries without a measured duration cannot pass a duration threshold.
        var d = q.duration ? parseFloat(q.duration) : NaN;
        if (isNaN(d) || d <= slowMs) return false;
      }
      if (search) {
        if (!q.sql.toLowerCase().includes(search) && !q.txConn.toLowerCase().includes(search) && !q.type.toLowerCase().includes(search) &&
            !(q.xpathContent && q.xpathContent.toLowerCase().includes(search))) return false;
      }
      return true;
    });
    if (sortKey && SORT[sortKey]) { var acc = SORT[sortKey]; out.sort(function (a, b) { return (acc(a) - acc(b)) * sortDir; }); }

    lastFiltered = out;
    updateStats(out);

    // The stats bar keeps describing executions in both views — it answers "how much SQL is in this window",
    // which the aggregate does not change.
    if (view === 'stmt') {
      var groups = window.lqeAggregateByStatement(out);
      if (sortKey && STMT_SORT[sortKey]) { var sacc = STMT_SORT[sortKey]; groups.sort(function (a, b) { return (sacc(a) - sacc(b)) * sortDir; }); }
      lastStatements = groups;
      ui.count.textContent = String(groups.length);
      ui.unit.textContent = groups.length === 1 ? 'statement' : 'statements';
      renderList(groups, renderStmtRow, 'stmt');
    } else {
      lastStatements = [];
      ui.count.textContent = String(out.length);
      ui.unit.textContent = out.length === 1 ? 'query' : 'queries';
      renderList(out, renderRow, 'exec');
    }
  }

  function setView(v) {
    view = v;
    ui.view.set(v);
    ui.headExec.show(v !== 'stmt');
    ui.headStmt.show(v === 'stmt');
    sortKey = null; sortDir = -1;
    ui.headExec.setSort(null); ui.headStmt.setSort(null);
    filter();
  }

  function sort(key) {
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = key === 'time' ? 1 : -1; }
    ui.headExec.setSort(sortKey, sortDir);
    ui.headStmt.setSort(sortKey, sortDir);
    filter();
  }

  // Stats above the list — always computed on the currently visible (filtered) set.
  function updateStats(list) {
    if (!queries.length) { ui.stats.visible(false); slowestId = null; return; }
    ui.stats.visible(true);
    var sum = 0, timed = 0, slowest = null, slowestMs = -1;
    list.forEach(function (q) {
      var d = q.duration ? parseFloat(q.duration) : NaN;
      if (!isNaN(d)) { sum += d; timed++; if (d > slowestMs) { slowestMs = d; slowest = q; } }
    });
    var dups = new Set(list.filter(function (q) { return q.dupCount > 1; }).map(function (q) { return q.signature; })).size;
    ui.stats.set('total', String(list.length));
    ui.stats.set('sum', timed ? window.lqeFmtMs(sum) : '–');
    ui.stats.set('avg', timed ? window.lqeFmtMs(sum / timed) : '–');
    ui.stats.set('slowest', slowest ? window.lqeFmtMs(slowestMs) : '–');
    ui.stats.set('dups', String(dups));
    ui.statSum.title = 'Sum of measured durations across visible queries (' + timed + ' of ' + list.length + ' have a duration)';
    slowestId = slowest ? slowest.sqlId : null;
  }

  // Click on the "Slowest" stat selects that query. The target row may be virtualised out of the DOM, so it is
  // driven through the list by index.
  function selectSlowest() {
    if (!slowestId) return;
    // The stat points at one execution, which the statement view has no row for — switch back rather than
    // doing nothing on a click that looks actionable.
    if (view !== 'exec') setView('exec');
    if (!vlist) return;
    var idx = vlist.indexOf(function (q) { return q.sqlId === slowestId; });
    if (idx < 0) return;
    activeId = slowestId;
    vlist.scrollToIndex(idx, 'center');
    vlist.refresh();
    selectQuery(vlist.itemAt(idx));
  }

  // ---------- the list ----------
  function typeClass(t) { return 'lg-sqltype lg-sqltype-' + (t || 'other').toLowerCase(); }

  // Duration heat-map: fixed bands (not relative to the visible set, so the same number always means the same
  // colour as filters change) — <100 ms fine, <1 s worth a look, otherwise slow.
  function durClass(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return '';
    if (ms < 100) return 'lg-dur-ok';
    if (ms < 1000) return 'lg-dur-warn';
    return 'lg-dur-bad';
  }

  function summaryOf(sql) { return sql.length > 100 ? sql.substring(0, 100) + '...' : sql; }

  function renderRow(q) {
    var d = q.duration ? parseFloat(q.duration) : NaN;
    var check = h('input', { type: 'checkbox', title: 'Select for Compare (max 2)', checked: compare.indexOf(q.sqlId) !== -1 });
    check.addEventListener('change', function () { toggleCompare(q.sqlId, check); });
    check.addEventListener('click', function (e) { e.stopPropagation(); });

    var row = h('div', {
      class: 'lg-lrow lg-qrow' + (activeId != null && q.sqlId === activeId ? ' is-active' : ''),
      onclick: function () { activeId = q.sqlId; if (vlist) vlist.refresh(); selectQuery(q); }
    }, [
      h('div', { class: 'lg-lcell' }, [check]),
      h('div', { class: typeClass(q.type) }, [
        q.type,
        q.dupCount > 1 ? h('span', { class: 'lg-badge ' + (q.dupCount >= 10 ? 'is-bad' : 'is-warn'), title: 'This statement was executed ' + q.dupCount + '× with different parameters — possible N+1 pattern', text: '×' + q.dupCount }) : null,
        q.slowWarning ? h('span', { class: 'lg-slowmark', title: 'Slow-query warning logged by ConnectionBus_Queries — the runtime flagged this query as slow (available at default log levels, no TRACE needed)', text: '⚠' }) : null
      ]),
      h('div', { class: 'lg-mono lg-muted', text: q.txConn }),
      h('div', { class: 'lg-muted', text: q.timestamp }),
      h('div', { class: 'lg-bold ' + (durClass(d) || 'lg-dur-none'), text: q.duration || '-' }),
      h('div', { class: 'lg-muted', text: q.cost != null ? String(q.cost) : '-' }),
      h('div', { class: 'lg-ellipsis', title: q.sql }, [h('strong', { text: window.lqeSmartLabel(q) }), h('span', { class: 'lg-muted', text: ' — ' + summaryOf(q.sql) })]),
      h('div', { class: 'is-right', text: q.rows })
    ]);
    return row;
  }

  // One row per distinct statement. A group is "timed" only if the log measured at least one of its
  // executions; where it didn't, the cells read "–" rather than 0 ms, and the tooltip says how many of the
  // executions the totals actually cover.
  function renderStmtRow(g) {
    var isSel = activeId != null && g.worst && g.worst.sqlId === activeId;
    var coverage = g.timedCount ? g.timedCount + ' of ' + g.count + ' execution(s) have a measured duration'
      : 'None of these executions has a measured duration — the log carries no query plan or slow-query warning for them';
    var dash = function (v, cls, tip) { return h('div', { class: v === null ? 'lg-muted' : (cls || ''), title: tip || null, text: v === null ? '–' : window.lqeFmtMs(v) }); };
    return h('div', {
      class: 'lg-lrow lg-srow' + (isSel ? ' is-active' : ''),
      onclick: function () { activeId = g.worst ? g.worst.sqlId : null; if (vlist) vlist.refresh(); if (g.worst) selectQuery(g.worst); }
    }, [
      h('div', { class: 'lg-bold ' + (g.count >= 10 ? 'lg-dur-bad' : (g.count > 1 ? 'lg-dur-warn' : '')) }, [
        '×' + g.count,
        g.slowCount ? h('span', { class: 'lg-slowmark', title: g.slowCount + ' of these executions were logged as slow-query warnings by ConnectionBus_Queries', text: '⚠' }) : null
      ]),
      h('div', { class: 'lg-bold ' + (g.sumMs === null ? 'lg-muted' : 'lg-accent'), title: coverage, text: g.sumMs === null ? '–' : window.lqeFmtMs(g.sumMs) }),
      dash(g.avgMs, durClass(g.avgMs)),
      dash(g.maxMs, durClass(g.maxMs)),
      h('div', { class: 'lg-ellipsis', title: g.sample.sql }, [h('strong', { text: window.lqeSmartLabel(g.sample) }), h('span', { class: 'lg-muted', text: ' — ' + summaryOf(g.sample.sql) })])
    ]);
  }

  function showEmptyList() {
    if (vlist) { vlist.destroy(); vlist = null; }
    L.replace(ui.list, [W.empty('Drop a log file here or use “Load TRACE log”', [
      h('p', { class: 'muted', text: 'Studio Pro CSV export (TRACE) — full SQL, params and plans · Mendix Cloud live log (.txt/.log) — slow-query warnings.' }),
      W.howTo('How to get this data', [h('p', null, ['Raise ', h('strong', { text: 'ConnectionBus_Retrieve' }), ' (and ', h('strong', { text: 'DataStorage_QueryPlan' }), ' for query plans) to ', h('strong', { text: 'TRACE' }),
        ' — Studio Pro: Console → Advanced → Set Log Levels; Mendix Cloud: Environment → Details → Log Levels. Reproduce the scenario, then export the console log (CSV) or download the live log (.txt/.log/.gz). At default levels the runtime still writes a ConnectionBus_Queries warning for every slow query, with the full SQL.'])])
    ])]);
  }

  // Both views share the virtual list. The row renderer is fixed at creation, so switching views rebuilds it
  // rather than repainting rows of the wrong shape.
  function renderList(list, renderRowFn, mode) {
    if (vlist && vlistMode !== mode) { vlist.destroy(); vlist = null; }
    vlistMode = mode;
    if (list.length === 0) {
      if (vlist) { vlist.destroy(); vlist = null; }
      L.replace(ui.list, [h('div', { class: 'lg-list-empty', text: queries.length ? 'No queries found matching criteria.' : '' })]);
      if (!queries.length) showEmptyList();
      return;
    }
    if (!vlist) vlist = window.createVirtualList({ container: ui.list, renderRow: renderRowFn });
    vlist.setItems(list);
  }

  // ---------- compare ----------
  function toggleCompare(sqlId, box) {
    if (box.checked) {
      if (compare.length >= 2) { box.checked = false; return; }
      compare.push(sqlId);
    } else compare = compare.filter(function (id) { return id !== sqlId; });
    ui.compareBtn.disabled = compare.length !== 2;
    ui.compareCount.textContent = '(' + compare.length + '/2)';
  }

  // A line diff (longest common subsequence) — small statements, so the plain table is fine.
  function lineDiff(a, b) {
    var n = a.length, m = b.length, i, j;
    var t = [];
    for (i = 0; i <= n; i++) { t.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    var out = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ a: a[i], b: b[j], same: true }); i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) { out.push({ a: a[i], b: null }); i++; }
      else { out.push({ a: null, b: b[j] }); j++; }
    }
    while (i < n) { out.push({ a: a[i++], b: null }); }
    while (j < m) { out.push({ a: null, b: b[j++] }); }
    return out;
  }

  function compareSelected() {
    if (compare.length !== 2) return;
    var qa = queries.find(function (q) { return q.sqlId === compare[0]; });
    var qb = queries.find(function (q) { return q.sqlId === compare[1]; });
    if (!qa || !qb) return;
    var rows = lineDiff(window.lqeBuildRunnableSql(qa).split('\n'), window.lqeBuildRunnableSql(qb).split('\n'));
    var left = h('div', { class: 'lg-diff-col' }), right = h('div', { class: 'lg-diff-col' });
    rows.forEach(function (r) {
      left.appendChild(h('div', { class: 'lg-diff-line' + (r.a !== null && !r.same ? ' is-del' : '') + (r.a === null ? ' is-gap' : ''), text: r.a === null ? ' ' : r.a }));
      right.appendChild(h('div', { class: 'lg-diff-line' + (r.b !== null && !r.same ? ' is-add' : '') + (r.b === null ? ' is-gap' : ''), text: r.b === null ? ' ' : r.b }));
    });
    L.modal({
      title: 'Compare two queries', wide: true,
      body: h('div', null, [
        h('div', { class: 'lg-diff-head' }, [h('span', { text: qa.txConn + ' · ' + qa.timestamp }), h('span', { text: qb.txConn + ' · ' + qb.timestamp })]),
        h('div', { class: 'lg-diff' }, [left, right])
      ]),
      actions: [{ label: 'Close', primary: true }]
    });
  }

  // ---------- the detail pane ----------
  var DETAIL_TABS = [
    { id: 'sql', label: 'Runnable SQL' }, { id: 'source', label: 'Source XPath/OQL' }, { id: 'params', label: 'Parameters' },
    { id: 'result', label: 'Result Data' }, { id: 'plan', label: 'Query Plan' }
  ];

  function clearDetail() {
    L.replace(ui.sqlOut, [h('div', { class: 'lg-muted-block', text: 'Select a query to view its runnable SQL...' })]);
    L.replace(ui.sourceOut, [h('div', { class: 'lg-muted-block', text: 'No source available (XPath/OQL) for this query.' })]);
    L.replace(ui.paramsOut, [h('div', { class: 'lg-muted-block', text: 'No parameters' })]);
    L.replace(ui.resultOut, [h('div', { class: 'lg-muted-block', text: 'No result output logged.' })]);
    L.replace(ui.planOut, [h('div', { class: 'lg-muted-block', text: 'No execution plan found for this query.' })]);
    ui.runnable = '';
    ui.planBtn.disabled = true;
  }

  function selectQuery(q) {
    selected = q;
    var runnable = window.lqeBuildRunnableSql(q);
    ui.runnable = runnable;
    L.replace(ui.sqlOut, [W.sqlBlock(runnable)]);

    L.replace(ui.sourceOut, [q.xpathContent ? W.sqlBlock(q.xpathContent, { class: 'lg-code lg-code-sql lg-code-plain' }) : h('div', { class: 'lg-muted-block', text: 'No source available (XPath/OQL) for this query.' })]);

    if (q.params && q.params.length) {
      L.replace(ui.paramsOut, [W.table([{ label: 'Index' }, { label: 'Value', cell: function (r) { return h('span', { class: 'lg-mono lg-accent', text: r[1] }); } }],
        q.params.map(function (p, i) { return [i + 1, p]; }))]);
    } else L.replace(ui.paramsOut, [h('div', { class: 'lg-muted-block', text: 'No parameters' })]);

    L.replace(ui.resultOut, [q.resultData ? h('pre', { class: 'lg-code lg-code-plain', text: q.resultData.trim() }) : h('div', { class: 'lg-muted-block', text: 'No result output logged. (Might be a DML query or trace level too low)' })]);

    if (q.queryPlan) {
      ui.planBtn.disabled = false;
      try {
        var planObj = JSON.parse(q.queryPlan);
        var prefix = '';
        if (q.duration) prefix += 'Execution Time: ' + q.duration + '\n';
        if (q.planningTime) prefix += 'Planning Time: ' + q.planningTime + '\n';
        if (q.duration || q.planningTime) prefix += '\n';
        L.replace(ui.planOut, [h('pre', { class: 'lg-code lg-code-payload' }, [prefix, W.jsonNodes(planObj)])]);
      } catch (e) { L.replace(ui.planOut, [h('pre', { class: 'lg-code lg-code-plain', text: q.queryPlan.trim() })]); }
    } else {
      ui.planBtn.disabled = true;
      L.replace(ui.planOut, [h('div', { class: 'lg-muted-block', text: 'No execution plan found for this query.' })]);
    }
  }

  function planText() {
    if (!selected || !selected.queryPlan) return '';
    var text = selected.queryPlan;
    try {
      var arr = JSON.parse(selected.queryPlan);
      if (arr && arr[0] && arr[0].Plan) {
        text = window.lqePlanNodeToText(arr[0].Plan, 0);
        if (arr[0]['Planning Time'] !== undefined) text += 'Planning Time: ' + arr[0]['Planning Time'] + ' ms\n';
        if (arr[0]['Execution Time'] !== undefined) text += 'Execution Time: ' + arr[0]['Execution Time'] + ' ms\n';
      }
    } catch (e) { /* the plan was already plain text — pass it through unchanged */ }
    return text;
  }

  // The plan as EXPLAIN prints it — an indented tree — in a dialog. The original handed this text to a
  // separate plan visualiser; MxScout has none, and the tree is what that tool parsed anyway.
  function showPlanTree() {
    var text = planText();
    if (!text) { L.toast('Select a query that has a logged Query Plan first.', 'warn'); return; }
    L.modal({ title: 'Query plan', wide: true, body: h('pre', { class: 'lg-code lg-code-plain', text: text }),
      actions: [{ label: 'Copy', onClick: function () { L.copy(text); return false; } }, { label: 'Close', primary: true }] });
  }

  // ---------- exports ----------
  function exportHeader() { return view === 'stmt' ? window.LQE_STMT_EXPORT_HEADER : window.LQE_EXPORT_HEADER; }
  function queryRow(q, maxLen) {
    var sql = q.sql.replace(/\s+/g, ' ').trim();
    if (sql.length > maxLen) sql = sql.substring(0, maxLen) + '…';
    return [
      q.type + (q.slowWarning ? ' (SLOW warning)' : ''), q.txConn, q.timestamp,
      q.duration ? parseFloat(q.duration) : '',
      (q.cost !== null && q.cost !== undefined) ? q.cost : '',
      q.rows !== '-' ? q.rows : '', q.dupCount > 1 ? '×' + q.dupCount : '', sql
    ];
  }
  function exportRows(maxLen) {
    if (view === 'stmt') return window.lqeStmtExportRows(lastStatements, maxLen);
    return lastFiltered.map(function (q) { return queryRow(q, maxLen); });
  }
  function needRows() {
    if (lastFiltered.length) return true;
    L.toast('Nothing to export — load a log first (and check the active filters).', 'warn');
    return false;
  }

  function exportHtml() {
    if (!needRows()) return;
    var rows = exportRows(2000);
    L.downloadHtml('extracted-queries.html', {
      title: view === 'stmt' ? 'Extracted SQL Queries — by statement' : 'Extracted SQL Queries',
      subtitle: 'MxScout — Log Query Extractor',
      meta: [
        { label: 'Source', value: sourceFormat === 'live' ? 'Mendix Cloud live log' : (sourceFormat === 'csv' ? 'Studio Pro CSV export' : 'log') },
        { label: view === 'stmt' ? 'Statements' : 'Queries', value: rows.length }
      ].concat(view === 'stmt' ? [{ label: 'Executions', value: lastFiltered.length }] : []),
      columns: exportHeader(), rows: rows
    });
  }

  // Incident Report source: the currently filtered queries, optionally narrowed to [fromMs, toMs]. Reuses the
  // tool's own filter state, so the report reflects what the reader is looking at. null when empty.
  function reportSection(fromMs, toMs) {
    if (!lastFiltered.length) return null;
    var inWin = lastFiltered.filter(function (q) {
      var ms = window.mtTsToMs(q.timestamp);
      if (fromMs != null && !isNaN(ms) && ms < fromMs) return false;
      if (toMs != null && !isNaN(ms) && ms > toMs) return false;
      return true;
    });
    if (!inWin.length) return null;
    var firstMs = Infinity, lastMs = -Infinity;
    inWin.forEach(function (q) {
      var ms = window.mtTsToMs(q.timestamp);
      if (!isNaN(ms)) { if (ms < firstMs) firstMs = ms; if (ms > lastMs) lastMs = ms; }
    });
    var src = sourceFormat === 'live' ? ' (Mendix Cloud live log)' : (sourceFormat === 'csv' ? ' (Studio Pro CSV)' : '');
    // The report follows the active view, like the exports do: a reader looking at total cost per statement
    // needs that table in the report, not several thousand individual executions to add up by hand.
    var rows = view === 'stmt'
      ? window.lqeStmtExportRows(window.lqeAggregateByStatement(inWin), 2000)
      : inWin.map(function (q) { return queryRow(q, 2000); });
    var subtitle = view === 'stmt'
      ? rows.length + ' distinct statement' + (rows.length === 1 ? '' : 's') + ' from ' + inWin.length + ' execution' + (inWin.length === 1 ? '' : 's') + src
      : rows.length + ' quer' + (rows.length === 1 ? 'y' : 'ies') + src;
    return {
      id: 'log-query-extractor',
      title: 'Log Query Extractor — SQL queries' + (view === 'stmt' ? ' (by statement)' : ''),
      subtitle: subtitle,
      columns: view === 'stmt' ? window.LQE_STMT_EXPORT_HEADER : window.LQE_EXPORT_HEADER,
      rows: rows, total: rows.length,
      firstMs: firstMs === Infinity ? null : firstMs, lastMs: lastMs === -Infinity ? null : lastMs
    };
  }

  // ---------- build ----------
  function build() {
    var picker = W.filePicker('Load TRACE log', { primary: true, accept: '.log,.txt,.csv,.gz' }, loader.loadFiles);
    var actions = h('div', { class: 'lg-actions' }, [
      picker.button, picker.input,
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Export CSV', title: 'Download the currently filtered query list as a CSV file', onclick: function () { if (needRows()) L.downloadCsv('extracted-queries.csv', exportHeader(), exportRows(300)); } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy Markdown', title: 'Copy the currently filtered query list as a Markdown table', onclick: function (e) { if (needRows()) L.copyMarkdown(exportHeader(), exportRows(120), e.currentTarget); } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Export HTML', title: 'Download the currently filtered query list as a self-contained HTML report', onclick: exportHtml }),
      h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', text: 'Clear', onclick: clearAll })
    ]);

    ui.view = W.segmented([
      { id: 'exec', label: 'Executions', title: 'One row per logged execution' },
      { id: 'stmt', label: 'By statement', title: 'One row per distinct statement — total time, average and execution count, so a cheap query run thousands of times stops hiding behind a single slow one' }
    ], 'exec', setView);
    ui.search = W.searchBox('Search queries…', filter, 'lg-input-grow');
    ui.type = h('select', { class: 'lg-input', 'aria-label': 'Query type', onchange: filter }, [
      h('option', { value: 'ALL', text: 'All types' }), h('option', { value: 'SELECT', text: 'SELECT' }), h('option', { value: 'UPDATE', text: 'UPDATE' }),
      h('option', { value: 'INSERT', text: 'INSERT' }), h('option', { value: 'DELETE', text: 'DELETE' }), h('option', { value: 'DUP', text: 'Duplicates only (N+1)' })
    ]);
    ui.slowOnly = W.checkbox('Slow only >', false, filter, 'Show only queries with a measured duration above the threshold — queries without a duration are hidden');
    ui.slowMs = W.numberInput(100, filter, { step: '50', title: 'Slow-query threshold in milliseconds' });
    ui.compareCount = h('span', { class: 'lg-dim', text: '(0/2)' });
    ui.compareBtn = h('button', { class: 'btn btn-sm', type: 'button', disabled: true, title: 'Tick the checkbox on two rows, then compare their SQL side by side', onclick: compareSelected }, ['Compare ', ui.compareCount]);
    ui.count = h('span', { text: '0' });
    ui.unit = h('span', { text: ' queries' });
    ui.note = h('span', { class: 'lg-tone-warn lg-help', hidden: true });
    ui.windowChip = h('button', { class: 'lg-chip-window', type: 'button', hidden: true, onclick: function () { setTimeWindow(null, null); } });

    ui.stats = W.statBar([
      { id: 'total', label: 'Queries:' },
      { id: 'sum', label: 'Total time:' },
      { id: 'avg', label: 'Avg:', title: 'Average of measured durations across visible queries' },
      { id: 'slowest', label: 'Slowest:', tone: 'accent', onClick: selectSlowest, title: 'Slowest visible query — click to select it in the list' },
      { id: 'dups', label: 'Duplicated:', title: 'Number of distinct statements executed more than once (possible N+1)' }
    ]);
    ui.statSum = ui.stats.el.children[1];

    ui.headExec = W.gridHead([
      { label: '', title: 'Select two rows to compare' }, { label: 'Type' }, { label: 'Tx-Conn' },
      { label: 'Time', key: 'time', title: 'Click to sort by log order' },
      { label: 'Duration', key: 'duration', title: 'Execution Time (when the plan was logged) — click to sort' },
      { label: 'Cost', key: 'cost', title: 'Total Cost (from the query plan) — click to sort' },
      { label: 'Table · SQL' }, { label: 'Rows', key: 'rows', align: 'right', title: 'Click to sort by returned rows' }
    ], '22px 96px 92px 112px 78px 60px 1fr 60px', sort);
    ui.headStmt = W.gridHead([
      { label: 'Count', key: 'count', title: 'How many times this statement was executed — click to sort' },
      { label: 'Total', key: 'total', title: 'Sum of the measured durations of every execution of this statement — click to sort' },
      { label: 'Avg', key: 'avg', title: 'Average measured duration per execution — click to sort' },
      { label: 'Max', key: 'max', title: 'Slowest single execution of this statement — click to sort' },
      { label: 'Table · SQL' }
    ], '74px 92px 92px 92px 1fr', sort);
    ui.headStmt.show(false);

    ui.list = L.keepScroll(h('div', { class: 'lg-list lg-vlist' }));
    W.dropTarget(ui.list, loader.loadFiles, L.looksLikeLog);
    showEmptyList();

    var left = h('div', { class: 'lg-left' }, [
      h('div', { class: 'lg-ltool' }, [ui.view.el, ui.search, ui.type, ui.slowOnly.el, ui.slowMs, h('span', { class: 'lg-dim', text: 'ms' }), ui.compareBtn,
        h('span', { class: 'lg-count' }, [ui.count, ui.unit, ui.note, ui.windowChip])]),
      ui.stats.el, ui.headExec.el, ui.headStmt.el, ui.list
    ]);

    // ---- right: the selected query ----
    ui.sqlOut = h('div'); ui.sourceOut = h('div'); ui.paramsOut = h('div'); ui.resultOut = h('div'); ui.planOut = h('div');
    ui.planBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Show plan tree', disabled: true, title: 'Show the plan as the indented tree EXPLAIN prints', onclick: showPlanTree });
    var panes = {
      sql: h('div', { class: 'lg-dpane' }, [h('div', { class: 'lg-dbar' }, [
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Copy SQL', onclick: function (e) { if (ui.runnable) L.copy(ui.runnable, e.currentTarget); } }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Copy for EXPLAIN', title: 'Copy the statement behind an EXPLAIN (ANALYZE …) — MxScout never connects to a database, so you run it yourself', onclick: function (e) { if (ui.runnable) L.copy('EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT TEXT)\n' + ui.runnable, e.currentTarget); } })]), ui.sqlOut]),
      source: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-dbar' }, [W.copyButton(function () { return selected ? selected.xpathContent : ''; })]), ui.sourceOut,
        h('p', { class: 'lg-hint', text: 'The XPath behind a query is logged at TRACE only. On an ordinary production log this pane is usually empty.' })]),
      params: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-dbar' }, [W.copyButton(function () { return selected && selected.params ? JSON.stringify(selected.params, null, 2) : '[]'; }, 'Copy JSON')]), ui.paramsOut]),
      result: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-dbar' }, [W.copyButton(function () { return selected ? selected.resultData.trim() : ''; })]), ui.resultOut]),
      plan: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-dbar' }, [ui.planBtn, W.copyButton(function () { return selected ? selected.queryPlan : ''; })]), ui.planOut,
        h('p', { class: 'lg-hint', text: 'Plans are shown as logged. To plan a statement against your own database, use “Copy for EXPLAIN” on the Runnable SQL tab — MxScout never connects to a database itself.' })])
    };
    var dtabs = W.tabs(DETAIL_TABS, 'sql', function (id) { Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== id; }); }, 'lg-tabs lg-tabs-sm');
    var right = h('div', { class: 'lg-right' }, [dtabs.el, h('div', { class: 'lg-dbody' }, [panes.sql, panes.source, panes.params, panes.result, panes.plan])]);
    clearDetail();

    return h('div', { class: 'lg-tool lg-split' }, [actions, h('div', { class: 'lg-splitbody' }, [left, right])]);
  }

  L.register({
    id: 'log-query-extractor', label: 'Query Extractor',
    hint: 'SQL, OQL, XPath and plans out of a TRACE log; slow-query warnings at any level.',
    build: build,
    hasData: function () { return queries.length > 0; },
    loadText: loader.loadText,
    loadFiles: loader.loadFiles,
    setTimeWindow: setTimeWindow,
    reportSection: reportSection
  });
})();
