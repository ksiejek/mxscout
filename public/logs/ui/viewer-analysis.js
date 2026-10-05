/* MxScout — Log analysis, Log Viewer: the analysis tabs.
 *
 * Insights (one card per problem that actually occurs), the Levels Matrix, Correlation Flow, the
 * Sequence Diagram, the Gantt chart, and the Aggregate Errors dialog. The numbers behind them come
 * from MxDevSwissTool's engine (../engine/insights.js, decoder.js); everything here is the screens.
 *
 * The state a tab reads — the loaded entries, the filtered stream — is shared with viewer.js through
 * MxLogs.lv, and a tab acts on the stream (filter it, jump to a line) through the callbacks viewer.js
 * puts on the same object. Nothing here calls the other file at load time.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  var S = L.lv = {
    all: [],               // every entry of the loaded log(s), in display order
    filtered: [],          // what the stream currently shows
    levels: new Set(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL']),
    sigKey: null,          // Aggregate Errors: the signature the stream is narrowed to
    mechanisms: null,      // Insights: a Set of decoder rule ids the stream is narrowed to
    // — set by viewer.js:
    filterInsight: null, openTool: null, explainEntry: null, filterByCorrId: null,
    applyFilters: null, showFilterBanner: null, clearSignatureFilter: null, showStream: null
  };

  var LEVEL_ORDER = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];
  S.LEVEL_ORDER = LEVEL_ORDER;

  function badge(level) {
    var cls = { TRACE: 'trace', DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error', CRITICAL: 'critical' }[level] || 'neutral';
    return h('span', { class: 'lg-lvl lg-lvl-' + cls, text: level });
  }
  S.badge = badge;

  // ---------- Insights ----------
  // Computed when the tab opens, but the tab has to say how many problems there are before anyone opens it.
  // The result is cached per loaded entry array (the array is replaced on every load) and counted while the
  // browser is idle — 571 ms on a 55,248-record log, so never on the path that renders the stream.
  var insightsCache = null;
  function insightsFor(entries) {
    if (!insightsCache || insightsCache.entries !== entries) {
      insightsCache = { entries: entries, result: window.logExtractInsights(entries) };
    }
    return insightsCache.result;
  }
  S.dropInsightsCache = function () { insightsCache = null; };

  S.insightsFor = insightsFor;

  S.updateInsightsCount = function (setBadge) {
    setBadge('');
    var entries = S.all;
    if (!entries.length) return;
    var run = function () {
      if (entries !== S.all) return;
      var n = insightsFor(entries).categories.filter(function (c) { return c.severity !== 'info'; }).length;
      setBadge(n ? ' · ' + n : '');
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 0);
  };

  // Cross-links an Insights card can offer. A card names the tool; the label and tooltip live here so the
  // pure extractor stays free of UI copy.
  var INSIGHT_TOOLS = {
    'log-query-extractor': {
      label: 'Open in Query Extractor',
      title: 'Open the Log Query Extractor on this log — it reads the same slow-query warnings and shows the full SQL, with a By-statement view for total cost'
    }
  };

  function emptyLog(text, extra) {
    return h('div', { class: 'lg-insights-empty' }, [h('p', { class: 'lg-empty-title', text: 'No log loaded yet' }), h('p', { class: 'muted', text: text }), extra]);
  }

  S.renderInsights = function (out) {
    L.clear(out);
    if (!S.all.length) {
      out.appendChild(emptyLog('Insights scans WARNING/ERROR patterns (permission violations, session-state bloat, TaskQueue failures, slow-query warnings, error mechanisms the Error Decoder recognizes, per-node error hotspots) and shows a card for each problem that actually appears — nothing more. It also states one fact about the log itself: which log nodes are running at TRACE/DEBUG.'));
      return;
    }
    var result = insightsFor(S.all);
    var cats = result.categories;

    // Observations ('info') are not problems, so they are counted separately — a log whose only card says
    // "these nodes log at TRACE" is still a clean log.
    var problems = cats.filter(function (c) { return c.severity !== 'info'; }).length;
    var notes = cats.length - problems;

    out.appendChild(h('div', { class: 'lg-summary' }, [
      'Scanned ', h('strong', { text: L.fmtInt(result.stats.records) }), ' entries · ',
      h('span', { class: 'lg-tone-error', text: L.fmtInt(result.stats.errors) + ' errors' }), ' · ',
      h('span', { class: 'lg-tone-warn', text: L.fmtInt(result.stats.warnings) + ' warnings' }), ' · ',
      h('strong', { text: String(problems) }), ' problem categor' + (problems === 1 ? 'y' : 'ies'),
      notes ? [' · ', h('strong', { text: String(notes) }), ' observation' + (notes === 1 ? '' : 's')] : null
    ]));

    var clean = h('div', { class: 'lg-insights-empty' }, [
      h('p', { class: 'lg-empty-title', text: 'No WARNING/ERROR patterns found' }),
      h('p', { class: 'muted', text: 'This log is clean at WARNING level and above. If you expected background-job or microflow detail, raise the relevant log nodes to DEBUG/TRACE and reproduce the scenario.' })
    ]);
    if (!cats.length) { out.appendChild(clean); return; }
    if (problems === 0) out.appendChild(clean);

    var grid = h('div', { class: 'lg-insights-grid' });
    cats.forEach(function (c) {
      var sev = c.severity === 'error' ? 'error' : (c.severity === 'info' ? 'info' : 'warn');
      var span = (c.firstTs && c.lastTs && c.firstTs !== c.lastTs)
        ? h('span', { class: 'lg-insights-span', title: 'First → last occurrence', text: window.logInsightsShortTs(c.firstTs) + ' → ' + window.logInsightsShortTs(c.lastTs) })
        : null;

      var head = h('button', {
        class: 'lg-insights-head', type: 'button', title: 'Filter the stream to these entries',
        onclick: function () { S.filterInsight(c.filter.node, c.filter.levels, c.filter.search, c.filter.mech); }
      }, [
        h('span', { class: 'lg-count lg-count-' + sev, title: c.count + ' entries', text: window.logInsightsCount(c.count) + '×' }),
        h('div', { class: 'lg-insights-main' }, [
          h('div', { class: 'lg-insights-title', text: c.title }),
          h('div', { class: 'lg-insights-sub', text: c.subtitle }),
          c.sample ? h('div', { class: 'lg-insights-sample', title: c.sample, text: c.sample }) : null
        ]),
        span
      ]);

      // A pinned item (the mechanism card's "unrecognized" row) is always listed, however far down the count
      // order puts it — hiding it would overstate how much of the log the rules explain.
      var items = c.items || [];
      var shown = items.slice(0, 12);
      items.slice(12).forEach(function (it) { if (it.pinned) shown.push(it); });
      var list = null;
      if (items.length) {
        list = h('div', { class: 'lg-insights-items', hidden: true });
        shown.forEach(function (it) {
          var row = h('div', { class: 'lg-insights-item' }, [
            h('button', {
              class: 'lg-insights-item-main', type: 'button', title: 'Filter the stream to these entries',
              onclick: function () { S.filterInsight(it.filter.node, it.filter.levels, it.filter.search, it.filter.mech); }
            }, [
              h('span', { class: 'lg-insights-item-count', title: it.count + ' entries', text: window.logInsightsCount(it.count) + '×' }),
              h('span', { class: 'lg-insights-item-label', text: it.label })
            ]),
            it.mechanism ? h('button', {
              class: 'btn btn-ghost btn-sm', type: 'button', text: 'Decode', title: 'Open the first of these entries in the Mendix Error Decoder',
              onclick: function () { S.decodeMechanism(it.mechanism); }
            }) : null
          ]);
          list.appendChild(row);
        });
        if (items.length > shown.length) list.appendChild(h('div', { class: 'lg-insights-more', text: '…and ' + (items.length - shown.length) + ' more' }));
      }

      var actions = [];
      if (items.length) {
        actions.push(h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', text: 'Breakdown (' + items.length + ')',
          onclick: function () { list.hidden = !list.hidden; }
        }));
      }
      if (c.crossLink && INSIGHT_TOOLS[c.crossLink]) {
        actions.push(h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', text: INSIGHT_TOOLS[c.crossLink].label, title: INSIGHT_TOOLS[c.crossLink].title,
          onclick: function () { S.openTool(c.crossLink); }
        }));
      }

      grid.appendChild(h('div', { class: 'lg-insights-card lg-sev-' + sev }, [
        head, actions.length ? h('div', { class: 'lg-insights-actions' }, actions) : null, list
      ]));
    });
    out.appendChild(grid);
  };

  // "Decode" on a mechanism row: the first entry of that mechanism goes to the Error Decoder exactly as the
  // stream's Explain chip would send it.
  S.decodeMechanism = function (id) {
    var e = S.all.find(function (x) { return x._edxMech === id; });
    if (e) S.explainEntry(e);
  };

  // ---------- Levels Matrix ----------
  // Every level × log node, ranked by error volume. Heat is per COLUMN, not per row or globally: the question
  // is "for this severity, which node is responsible?", and only column scaling answers it — globally,
  // MicroflowEngine's 76 204 TRACE entries would flatten every other cell to invisible, and per row every row
  // would get one full-heat cell, which says nothing. Log scale, because the counts span 2 … 98 482.
  S.renderMatrix = function (out) {
    L.clear(out);
    if (!S.all.length) {
      out.appendChild(emptyLog('The Levels matrix pivots the loaded log by log node × severity so you can see, at a glance, which logger is producing the errors and which nodes are running at DEBUG/TRACE. Load a log in the Log Stream tab; then click any cell to filter the stream to exactly those entries.'));
      return;
    }
    var m = window.logBuildLevelMatrix(S.all);
    if (m.grandTotal === 0) { out.appendChild(h('div', { class: 'lg-insights-empty' }, [h('p', { class: 'lg-empty-title', text: 'No leveled entries to pivot' })])); return; }

    out.appendChild(h('div', { class: 'lg-summary' }, [
      'Pivot of ', h('strong', { text: L.fmtInt(m.grandTotal) }), ' entr' + (m.grandTotal === 1 ? 'y' : 'ies') + ' · ',
      h('strong', { text: String(m.nodeCount) }), ' log node' + (m.nodeCount === 1 ? '' : 's') + ' × ', h('strong', { text: String(m.levels.length) }),
      ' level' + (m.levels.length === 1 ? '' : 's') + ' · ', h('span', { class: 'muted', text: 'click a cell to filter the stream' })
    ]));

    var cls = { TRACE: 'trace', DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error', CRITICAL: 'critical' };
    var colMax = {};
    m.levels.forEach(function (l) { colMax[l] = m.nodes.reduce(function (mx, row) { return Math.max(mx, row.counts[l] || 0); }, 0); });
    function heat(level, c) {
      var mx = colMax[level] || 0;
      if (c <= 0 || mx <= 0) return null;
      var t = Math.log(c + 1) / Math.log(mx + 1);
      // The token is named for the class, never built from the level: WARN's class is "warn" in every scale.
      return 'background:color-mix(in srgb, var(--lg-' + cls[level] + ') ' + Math.round(8 + 42 * t) + '%, transparent)';
    }

    var headRow = h('tr', null, [h('th', { class: 'lm-node-th', text: 'Log node' })]);
    m.levels.forEach(function (l) {
      headRow.appendChild(h('th', {
        class: 'lm-lvl-th lm-' + cls[l], title: 'Filter the stream to all ' + l + ' entries',
        onclick: function () { S.filterInsight('', l, ''); }, text: l
      }));
    });
    headRow.appendChild(h('th', { class: 'lm-total-th', text: 'Total' }));

    var tbody = h('tbody');
    m.nodes.forEach(function (row) {
      var tr = h('tr', null, [h('td', {
        class: 'lm-node', title: 'Filter the stream to node ' + row.node, text: row.node, onclick: function () { S.filterInsight(row.node, '', ''); }
      })]);
      m.levels.forEach(function (l) {
        var c = row.counts[l] || 0;
        if (c === 0) { tr.appendChild(h('td', { class: 'lm-cell lm-zero', text: '·' })); return; }
        tr.appendChild(h('td', {
          class: 'lm-cell lm-' + cls[l], style: heat(l, c), text: String(c),
          title: 'Filter to ' + row.node + ' · ' + l + ' (' + c + ')', onclick: function () { S.filterInsight(row.node, l, ''); }
        }));
      });
      tr.appendChild(h('td', { class: 'lm-cell lm-total', text: String(row.total), onclick: function () { S.filterInsight(row.node, '', ''); } }));
      tbody.appendChild(tr);
    });

    var foot = h('tr', { class: 'lm-foot' }, [h('td', { class: 'lm-node', text: 'All nodes' })]);
    m.levels.forEach(function (l) {
      foot.appendChild(h('td', { class: 'lm-cell lm-' + cls[l], text: String(m.levelTotals[l] || 0), onclick: function () { S.filterInsight('', l, ''); } }));
    });
    foot.appendChild(h('td', { class: 'lm-cell lm-total', text: String(m.grandTotal) }));

    out.appendChild(h('div', { class: 'lg-matrix-wrap' }, [h('table', { class: 'lg-matrix' }, [h('thead', null, [headRow]), tbody, h('tfoot', null, [foot])])]));
  };

  // ---------- Correlation Flow ----------
  // Correlation IDs you can discover, not ones you must already know. The runtime writes the ID as a
  // bracketed token at the START of the message and repeats it on the Plan/OQL/XPath records emitted while
  // that execution runs, so one ID stitches a microflow to the queries it triggered. Anchoring on that
  // bracket rather than on a bare UUID is what keeps the list honest: an application log that carries SAML
  // assertions is full of UUIDs which are not correlation IDs at all.
  var LIST_CAP = 200;   // rows before the list asks to be narrowed — a 69 MB TRACE log holds tens of thousands
  var FLOW_CAP = 500;   // entries rendered for one flow; the stream (virtualised) is one click away
  var corrCache = null;
  S.corrSelected = null;

  S.correlations = function () {
    if (!corrCache || corrCache.scanned !== S.all.length) corrCache = window.logExtractCorrelations(S.all);
    return corrCache;
  };
  S.dropCorrelations = function () { corrCache = null; S.corrSelected = null; };

  S.renderCorrelationList = function (listEl, inputEl, onSelect) {
    L.clear(listEl);
    if (!S.all.length) {
      listEl.appendChild(emptyLog('This tab lists the correlation IDs the runtime recorded, ranked by errors and volume, so you can find the request that failed instead of having to know its ID first. Load a log in the Log Stream tab.'));
      return;
    }
    var res = S.correlations();
    if (!res.groups.length) {
      listEl.appendChild(h('div', { class: 'lg-insights-empty' }, [
        h('p', { class: 'lg-empty-title', text: 'No correlation IDs in this log' }),
        h('p', { class: 'muted' }, ['The runtime stamps a correlation ID on ', h('strong', { text: 'MicroflowEngine' }), ' records at DEBUG level, and on the Plan/OQL/XPath records at TRACE. A log running at INFO carries none — raise MicroflowEngine to DEBUG and reproduce the scenario. The box above still works for any other token you have: paste a session ID, request ID or user name to see every line that mentions it.'])
      ]));
      return;
    }
    // The box doubles as the filter, but picking a row writes that ID into it — which would then narrow the
    // list to the one row just clicked and strand the user there. A value that IS the current selection
    // filters nothing.
    var raw = (inputEl.value || '').trim();
    var q = raw === S.corrSelected ? '' : raw.toLowerCase();
    var matching = q ? res.groups.filter(function (g) { return g.id.toLowerCase().indexOf(q) !== -1 || (g.flow || '').toLowerCase().indexOf(q) !== -1; }) : res.groups;

    listEl.appendChild(h('div', { class: 'lg-corr-head' }, [
      res.groups.length + ' correlation ID' + (res.groups.length === 1 ? '' : 's') + ' · ' + res.withId + ' of ' + res.scanned + ' records carry one',
      q ? [' · ', h('strong', { text: String(matching.length) }), ' match the filter'] : null
    ]));
    if (!matching.length) {
      listEl.appendChild(h('div', { class: 'lg-corr-note' }, ['No correlation ID matches that text. Clear the filter to see all of them, or press ', h('strong', { text: 'Track' }), ' to scan every line for it as free text.']));
      return;
    }
    var shown = matching.slice(0, LIST_CAP);
    shown.forEach(function (g) {
      var bdg = g.errors ? h('span', { class: 'lg-lvl lg-lvl-error', text: g.errors + ' ERR' })
        : (g.warnings ? h('span', { class: 'lg-lvl lg-lvl-warn', text: g.warnings + ' WARN' }) : null);
      var span = window.logCorrSpanLabel(g);
      var meta = [g.count + ' record' + (g.count === 1 ? '' : 's')].concat(span ? [span] : [])
        .concat([g.nodes.slice(0, 3).join(', ') + (g.nodes.length > 3 ? ' +' + (g.nodes.length - 3) : '')]);
      listEl.appendChild(h('button', {
        class: 'lg-corr-row' + (g.id === S.corrSelected ? ' is-selected' : ''), type: 'button', title: g.id, onclick: function () { onSelect(g.id); }
      }, [
        h('div', { class: 'lg-corr-row-head' }, [h('span', { class: 'lg-corr-row-title', text: g.flow || 'Correlation ID' }), bdg]),
        h('div', { class: 'lg-corr-row-id', text: g.id }),
        h('div', { class: 'lg-corr-row-meta', text: meta.join(' · ') })
      ]));
    });
    if (matching.length > shown.length) listEl.appendChild(h('div', { class: 'lg-corr-note', text: (matching.length - shown.length) + ' more not shown — narrow the list with the filter above.' }));
  };

  // Every loaded line that mentions `cid`, in order, with the facts the ranking knows about it.
  S.renderCorrelationFlow = function (outEl, streamBtn, cid) {
    L.clear(outEl);
    if (!cid) {
      outEl.appendChild(h('span', { class: 'lg-tone-warn', text: 'Enter a correlation ID, or pick one from the list.' }));
      S.corrSelected = null;
      streamBtn.hidden = true;
      return;
    }
    var matched = S.all.filter(function (e) { return e.raw.indexOf(cid) !== -1; });
    S.corrSelected = cid;
    if (!matched.length) {
      outEl.appendChild(h('span', { class: 'muted', text: 'No logs found for this Correlation ID.' }));
      streamBtn.hidden = true;
      return;
    }
    streamBtn.hidden = false;

    var g = S.all.length ? S.correlations().groups.find(function (x) { return x.id === cid; }) : null;
    var facts = [[h('strong', { text: String(matched.length) }), ' log entries']];
    if (g) {
      var span = window.logCorrSpanLabel(g);
      if (span) facts.push(['span ' + span]);
      if (g.errors) facts.push([h('span', { class: 'lg-tone-error', text: g.errors + ' error' + (g.errors === 1 ? '' : 's') })]);
      if (g.flow) facts.push(['microflow ', h('strong', { text: g.flow })]);
    }
    outEl.appendChild(h('div', { class: 'lg-flow-id' }, ['ID ', h('code', { text: cid })]));
    var f = h('div', { class: 'lg-flow-facts' });
    facts.forEach(function (x, i) { if (i) L.add(f, ' · '); L.add(f, x); });
    outEl.appendChild(f);

    var list = h('div', { class: 'lg-flow-list' });
    matched.slice(0, FLOW_CAP).forEach(function (e) {
      list.appendChild(h('div', { class: 'lg-flow-item' }, [
        h('div', { class: 'lg-flow-meta' }, [e.ts + ' — Node: ', h('strong', { text: e.node }), ' — Level: ', badge(e.level)]),
        h('div', { class: 'lg-flow-msg', text: e.msg })
      ]));
    });
    outEl.appendChild(list);
    if (matched.length > FLOW_CAP) {
      outEl.appendChild(h('div', { class: 'lg-corr-note' }, ['Showing the first ' + FLOW_CAP + ' of ' + matched.length + ' entries. ', h('strong', { text: 'Show in Log Stream' }), ' opens the full, scrollable list.']));
    }
  };

  // ---------- Sequence diagram ----------
  S.renderSequence = function (out) {
    L.clear(out);
    if (!S.filtered.length) { out.appendChild(h('span', { class: 'lg-tone-warn', text: 'No logs in current filter.' })); return; }
    var entries = S.filtered.slice(0, 100);
    var nodes = [];
    entries.forEach(function (e) { if (nodes.indexOf(e.node) === -1) nodes.push(e.node); });

    var wrap = h('div', { class: 'lg-seq' });
    wrap.appendChild(h('div', { class: 'lg-seq-note', text: 'Showing sequence flow for first ' + entries.length + ' visible logs' }));
    var lanes = h('div', { class: 'lg-seq-lanes' });
    nodes.forEach(function (n) { lanes.appendChild(h('div', { class: 'lg-seq-lane' }, [n, h('div', { class: 'lg-seq-line' })])); });
    wrap.appendChild(lanes);
    entries.forEach(function (e) {
      var left = (nodes.indexOf(e.node) / nodes.length) * 100 + (100 / nodes.length / 2);
      var first = e.msg.split('\n')[0];
      wrap.appendChild(h('div', { class: 'lg-seq-row' }, [
        h('div', { class: 'lg-seq-ts', text: e.ts.split(' ')[1] || e.ts }),
        h('div', { class: 'lg-seq-track' }, [
          h('div', { class: 'lg-seq-dot', style: 'left:' + left + '%' }),
          h('div', { class: 'lg-seq-label', style: 'left:calc(' + left + '% + 15px)', title: first, text: first })
        ])
      ]));
    });
    out.appendChild(wrap);
  };

  // ---------- Gantt ----------
  // The bar measures the gap to the NEXT log line, which is all a generic log can support — an arbitrary
  // entry carries no duration of its own. Saying "gap" is the honest label: a wide bar means nothing was
  // logged for that long, which is either a quiet period or one un-instrumented operation running. For real
  // per-activity durations the log needs MicroflowEngine DEBUG/TRACE records — that is the Microflow Tracer's
  // job, and the note points there.
  S.renderGantt = function (out) {
    L.clear(out);
    if (S.filtered.length < 2) { out.appendChild(h('span', { class: 'lg-tone-warn', text: 'Not enough logs to generate timeline (need at least 2).' })); return; }
    var entries = S.filtered.slice(0, 500);
    var parsed = window.logGanttAxis(entries);
    if (parsed.length < 2) { out.appendChild(h('span', { class: 'lg-tone-warn', text: 'Could not parse time from logs.' })); return; }
    var t0 = parsed[0].ms, tEnd = parsed[parsed.length - 1].ms, total = tEnd - t0;
    if (total <= 0) { out.appendChild(h('span', { class: 'lg-tone-warn', text: 'Total duration is zero (logs have same timestamp).' })); return; }

    out.appendChild(h('div', { class: 'lg-seq-note' }, ['Timeline for ' + parsed.length + ' entries. Total span: ' + total + 'ms. Each bar is the gap until the next log line — a wide bar means the log went quiet, not that one operation took that long. For per-activity durations use the ', h('strong', { text: 'Microflow Tracer' }), '.']));
    var rows = h('div', { class: 'lg-gantt' });
    parsed.forEach(function (e, i) {
      var perc = ((e.ms - t0) / total) * 100;
      var gap = i < parsed.length - 1 ? parsed[i + 1].ms - e.ms : 0;
      var width = Math.max((gap / total) * 100, 0.5);
      var first = e.msg.split('\n')[0];
      rows.appendChild(h('div', { class: 'lg-gantt-row' }, [
        h('div', { class: 'lg-gantt-node', title: e.node + ': ' + first, text: e.node }),
        h('div', { class: 'lg-gantt-track' }, [h('div', {
          class: 'lg-gantt-bar', style: 'left:' + perc + '%;width:' + width + '%',
          title: 'Time: ' + e.ts + '\nGap to next line: ' + gap + 'ms\nMsg: ' + first
        })]),
        h('div', { class: 'lg-gantt-gap', title: 'Gap to the next log line', text: gap + 'ms' })
      ]));
    });
    out.appendChild(rows);
  };

  // ---------- Aggregate Errors ----------
  // The same error shown four hundred times with a different id in it is one problem. A signature is the
  // headline plus the top four stack frames, with ids, numbers, line numbers and timestamps replaced — so
  // identical failures land in one group however often, and with whatever values, they happened.
  S.openSignatures = function () {
    L.loader.show('Analyzing error signatures...');
    setTimeout(function () {
      var signatures = [];
      var exceptionCount = 0, plainCount = 0;
      try {
        var sigMap = new Map();
        for (var i = 0; i < S.all.length; i++) {
          var entry = S.all[i];
          var isErrorOrWarn = ['ERROR', 'CRITICAL', 'WARN', 'WARNING'].indexOf(entry.level) !== -1;
          if (!isErrorOrWarn && !(entry.stackLines > 0)) continue;
          var sig = window.logGetSignature(entry);
          if (sig.type === 'exception') exceptionCount++; else plainCount++;
          if (!sigMap.has(sig.key)) {
            sigMap.set(sig.key, { key: sig.key, type: sig.type, header: sig.header, stack: sig.stack, count: 0, level: entry.level, samples: [], entries: [] });
          }
          var group = sigMap.get(sig.key);
          group.count++;
          group.entries.push(entry);
          if (group.samples.length < 5) group.samples.push({ ts: entry.ts, line: entry.line, raw: entry.raw.split('\n')[0] });
        }
        signatures = Array.from(sigMap.values());
      } catch (e) {
        console.error(e);
        L.toast('Error during log signature analysis: ' + e.message, 'error');
      }
      L.loader.hide();

      var search = W.searchBox('Search signatures or stack frames…', render, 'lg-input-grow');
      var sort = h('select', { class: 'lg-input', 'aria-label': 'Sort signatures', onchange: render }, [
        h('option', { value: 'count-desc', text: 'Most frequent' }), h('option', { value: 'count-asc', text: 'Least frequent' }), h('option', { value: 'name-asc', text: 'Name (A–Z)' })
      ]);
      var type = h('select', { class: 'lg-input', 'aria-label': 'Signature type', onchange: render }, [
        h('option', { value: 'all', text: 'All types' }), h('option', { value: 'exceptions', text: 'Exceptions' }), h('option', { value: 'messages', text: 'Messages' })
      ]);
      var list = h('div', { class: 'lg-sig-list' });
      var details = [];
      var modal;

      function render() {
        L.clear(list);
        details = [];
        var q = search.value.toLowerCase().trim();
        var rows = signatures.filter(function (s) {
          if (type.value === 'exceptions' && s.type !== 'exception') return false;
          if (type.value === 'messages' && s.type !== 'message') return false;
          if (q) return s.header.toLowerCase().indexOf(q) !== -1 || s.stack.some(function (f) { return f.toLowerCase().indexOf(q) !== -1; });
          return true;
        });
        rows.sort(function (a, b) {
          if (sort.value === 'count-desc') return b.count - a.count;
          if (sort.value === 'count-asc') return a.count - b.count;
          if (sort.value === 'name-asc') return a.header.localeCompare(b.header);
          return 0;
        });
        if (!rows.length) { list.appendChild(h('div', { class: 'lg-corr-note', text: 'No signatures found matching the criteria.' })); return; }
        rows.forEach(function (s) {
          var detail = h('div', { class: 'lg-sig-detail', hidden: true }, [
            h('div', { class: 'lg-label', text: 'Exception/Message Signature Pattern:' }),
            h('pre', { class: 'lg-code lg-code-plain', text: s.stack.length ? s.header + '\n' + s.stack.map(function (f) { return '    ' + f; }).join('\n') : s.header }),
            h('div', { class: 'lg-label', text: 'Sample Occurrences (Top 5):' }),
            h('ul', { class: 'lg-sig-samples' }, s.samples.map(function (smp) {
              return h('li', null, [h('span', { class: 'lg-sig-where', text: 'Line ' + smp.line + ' [' + smp.ts + ']' }), ': ', h('code', { text: smp.raw })]);
            }))
          ]);
          details.push(detail);
          list.appendChild(h('div', { class: 'lg-sig-card' }, [
            h('div', { class: 'lg-sig-head', onclick: function () { detail.hidden = !detail.hidden; } }, [
              h('span', { class: 'lg-count lg-count-' + (s.type === 'exception' ? 'error' : 'warn'), text: s.count + '×' }),
              h('div', { class: 'lg-sig-main' }, [
                h('div', { class: 'lg-sig-header', title: s.header, text: s.header }),
                h('div', { class: 'lg-sig-frame', text: s.stack.length ? s.stack[0] : 'No stack trace' })
              ]),
              h('button', {
                class: 'btn btn-sm', type: 'button', text: 'Filter Logs',
                onclick: function (ev) { ev.stopPropagation(); S.sigKey = s.key; S.mechanisms = null; S.showFilterBanner('Filtering by Signature:', s.header); modal.close(); S.applyFilters(); S.showStream(); }
              })
            ]),
            detail
          ]));
        });
      }

      var body = h('div', { class: 'lg-sig' }, [
        h('p', { class: 'muted' }, ['Analyzed ', h('strong', { text: L.fmtInt(S.all.length) }), ' log entries. Found ', h('strong', { text: String(signatures.length) }),
          ' unique error signatures (Exceptions: ' + exceptionCount + ', Warnings/Messages: ' + plainCount + ').']),
        h('div', { class: 'lg-sig-bar' }, [search, type, sort,
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Expand all', onclick: function () { details.forEach(function (d) { d.hidden = false; }); } }),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Collapse all', onclick: function () { details.forEach(function (d) { d.hidden = true; }); } })]),
        list
      ]);
      modal = L.modal({ title: 'Aggregate Errors', body: body, wide: true, actions: [{ label: 'Close' }] });
      render();
    }, 50);
  };
})();
