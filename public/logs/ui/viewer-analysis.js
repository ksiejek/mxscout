/* MxScout — Log analysis, Log Viewer: the analysis tabs.
 *
 * Insights (one card per problem that actually occurs), Slow queries (the statements the runtime
 * reported as slow, grouped), In your model, and the Aggregate Errors dialog. The numbers behind them
 * come from MxDevSwissTool's engine (../engine/insights.js, decoder.js); everything here is the screens.
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
    filterInsight: null, filterByCorrId: null, jumpToEntry: null, showSlow: null,
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

  // Cross-links an Insights card can offer. A card names where it leads; the label, tooltip and action live
  // here so the pure extractor stays free of UI copy. The engine still names the original's Query Extractor
  // on the slow-query card; in MxScout that card leads to the Slow queries tab, which reads the same warnings.
  var INSIGHT_LINKS = {
    'log-query-extractor': {
      label: 'Open Slow queries',
      title: 'The same slow-query warnings, one row per statement with its full SQL, worst first',
      go: function () { S.showSlow(); }
    }
  };

  function emptyLog(text, extra) {
    return h('div', { class: 'lg-insights-empty' }, [h('p', { class: 'lg-empty-title', text: 'No log loaded yet' }), h('p', { class: 'muted', text: text }), extra]);
  }

  S.renderInsights = function (out) {
    L.clear(out);
    if (!S.all.length) {
      out.appendChild(emptyLog('Insights scans WARNING/ERROR patterns (permission violations, session-state bloat, TaskQueue failures, slow-query warnings, error mechanisms its rules recognize, per-node error hotspots) and shows a card for each problem that actually appears — nothing more. It also states one fact about the log itself: which log nodes are running at TRACE/DEBUG.'));
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
            ])
          ]);
          list.appendChild(row);
          var ml = W.modelLinks(it.label, function (o) {
            return { severity: sev === 'error' ? 'high' : 'medium', change: '',
              problem: 'Loaded log — ' + c.title + ' (' + c.subtitle + '):\n\n' + it.label + ' — ' + it.count + '× in the log, and it names this ' + o.kind + '.' };
          }, 3);
          if (ml) list.appendChild(ml);
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
      var link = c.crossLink && INSIGHT_LINKS[c.crossLink];
      if (link) {
        actions.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: link.label, title: link.title, onclick: link.go }));
      }

      grid.appendChild(h('div', { class: 'lg-insights-card lg-sev-' + sev }, [
        head, actions.length ? h('div', { class: 'lg-insights-actions' }, actions) : null, list
      ]));
    });
    out.appendChild(grid);
  };

  // ---------- Slow queries ----------
  // The one database signal a production log carries at default levels: the runtime writes a
  // ConnectionBus_Queries warning, with the full statement and how long it took, for every query past its
  // slow-query threshold. Read with the engine's own pattern and grouping (LOG_SLOW_QUERY, logSlowQuerySig —
  // the same the Insights card counts with), so the tab and the card can never disagree. One row per
  // statement, ordered by the time it cost in total: on a real log the expensive statement is usually the
  // ordinary one run a thousand times, not the single worst execution.
  var slowCache = null;
  function slowFor(entries) {
    if (slowCache && slowCache.entries === entries) return slowCache.result;
    var groups = new Map(), count = 0, worst = 0;
    entries.forEach(function (e) {
      if (e.node !== 'ConnectionBus_Queries' || e.level !== 'WARN') return;
      var m = String(e.msg).match(window.LOG_SLOW_QUERY);
      if (!m) return;
      var ms = (m[1] ? parseInt(m[1], 10) * 1000 : 0) + parseInt(m[2], 10);
      var sql = String(m[3]).trim();
      var key = window.logSlowQuerySig(sql);
      var g = groups.get(key);
      if (!g) { g = { key: key, sql: sql, runs: [], total: 0, worst: 0 }; groups.set(key, g); }
      g.runs.push({ e: e, ms: ms });
      g.total += ms;
      if (ms > g.worst) { g.worst = ms; g.sql = sql; }
      count++;
      if (ms > worst) worst = ms;
    });
    var list = Array.from(groups.values()).sort(function (a, b) { return (b.total - a.total) || (b.worst - a.worst); });
    slowCache = { entries: entries, result: { groups: list, count: count, worst: worst } };
    return slowCache.result;
  }
  S.slowCountLabel = function () {
    var n = S.all.length ? slowFor(S.all).count : 0;
    return n ? ' · ' + n : '';
  };

  // Rounded on the integer, not by toFixed: 2150 ms is 2.2 s, and toFixed's binary halves would say 2.1.
  function dur(ms) { return ms >= 10000 ? Math.round(ms / 1000) + ' s' : ms >= 1000 ? (Math.round(ms / 100) / 10).toFixed(1) + ' s' : ms + ' ms'; }

  S.renderSlow = function (out) {
    L.clear(out);
    if (!S.all.length) {
      out.appendChild(emptyLog('Slow queries lists the statements the runtime reported as slow. It needs no special log level: at default levels the runtime writes a ConnectionBus_Queries warning, with the full SQL and its duration, for every query past its slow-query threshold.'));
      return;
    }
    var res = slowFor(S.all);
    if (!res.count) {
      out.appendChild(h('div', { class: 'lg-insights-empty' }, [
        h('p', { class: 'lg-empty-title', text: 'No slow queries in this log' }),
        h('p', { class: 'muted', text: 'No ConnectionBus_Queries warning reports a query past the slow-query threshold. Either every query was fast, or the log does not include that node at WARNING level.' })
      ]));
      return;
    }
    out.appendChild(h('div', { class: 'lg-summary' }, [
      h('strong', { text: L.fmtInt(res.count) }), ' slow quer' + (res.count === 1 ? 'y' : 'ies') + ' · ',
      h('strong', { text: String(res.groups.length) }), ' distinct statement' + (res.groups.length === 1 ? '' : 's') + ' · worst ',
      h('strong', { text: dur(res.worst) }), ' · ', h('span', { class: 'muted', text: 'ordered by the time each statement cost in total' })
    ]));
    var list = h('div', { class: 'lg-slow-list' });
    res.groups.forEach(function (g) {
      var detail = h('div', { class: 'lg-slow-detail', hidden: true });
      function open() {
        if (!detail.hidden) { detail.hidden = true; return; }
        if (!detail.firstChild) {
          detail.appendChild(W.sqlBlock(g.sql));
          var ml = W.modelLinks(g.sql, function (o) {
            return { severity: 'medium', change: '',
              problem: 'Loaded log — a slow query, ' + g.runs.length + '× in the log, worst ' + dur(g.worst) + ', total ' + dur(g.total) + ', touches this ' + o.kind + ':\n\n' + g.sql.slice(0, 1200) };
          }, 4);
          if (ml) detail.appendChild(ml);
          var runs = g.runs.slice().sort(function (a, b) { return b.ms - a.ms; });
          detail.appendChild(h('div', { class: 'lg-label', text: runs.length === 1 ? 'The execution' : 'Executions, slowest first' }));
          var rl = h('div', { class: 'lg-slow-runs' });
          runs.slice(0, 50).forEach(function (r) {
            rl.appendChild(h('button', {
              class: 'lg-slow-run', type: 'button', title: 'Show this line in the stream',
              onclick: function () { S.jumpToEntry(r.e); }
            }, [h('span', { class: 'lg-slow-ms', text: dur(r.ms) }), h('span', { class: 'lg-slow-ts', text: r.e.ts }), h('span', { class: 'muted', text: 'line ' + r.e.line })]));
          });
          if (runs.length > 50) rl.appendChild(h('div', { class: 'lg-insights-more', text: '…and ' + (runs.length - 50) + ' more' }));
          detail.appendChild(rl);
        }
        detail.hidden = false;
      }
      list.appendChild(h('div', { class: 'lg-slow-card' }, [
        h('button', { class: 'lg-slow-head', type: 'button', 'aria-expanded': 'false', onclick: function (ev) { open(); ev.currentTarget.setAttribute('aria-expanded', String(!detail.hidden)); } }, [
          h('span', { class: 'lg-slow-num' }, [h('strong', { text: dur(g.total) }), h('span', { class: 'muted', text: 'total' })]),
          h('span', { class: 'lg-slow-num' }, [h('strong', { text: String(g.runs.length) + '×' }), h('span', { class: 'muted', text: 'runs' })]),
          h('span', { class: 'lg-slow-num' }, [h('strong', { text: dur(g.worst) }), h('span', { class: 'muted', text: 'worst' })]),
          h('span', { class: 'lg-slow-num' }, [h('strong', { text: dur(Math.round(g.total / g.runs.length)) }), h('span', { class: 'muted', text: 'average' })]),
          h('span', { class: 'lg-slow-sql', title: g.sql.slice(0, 600), text: g.sql.replace(/\s+/g, ' ') })
        ]),
        detail
      ]));
    });
    out.appendChild(list);
  };

  // ---------- In your model ----------
  // The warnings and errors, grouped by the microflow, page or entity of the open project they name — the
  // answer to "where in the model does this hurt". Cached per loaded entry array, like Insights.
  var modelCache = null;
  function modelHits(entries) {
    if (modelCache && modelCache.entries === entries && modelCache.model === L.model) return modelCache.hits;
    var map = {};
    entries.forEach(function (e) {
      if (e.level !== 'WARN' && e.level !== 'ERROR' && e.level !== 'CRITICAL') return;
      L.modelFind(e.msg, 6).forEach(function (o) {
        var g = map[o.qualifiedName] || (map[o.qualifiedName] = { obj: o, errors: 0, warnings: 0, first: null, firstError: null, last: null });
        if (e.level === 'WARN') g.warnings++; else g.errors++;
        if (!g.first) g.first = e;
        if (!g.firstError && e.level !== 'WARN') g.firstError = e;
        g.last = e;
      });
    });
    var hits = Object.keys(map).map(function (k) { return map[k]; });
    hits.sort(function (a, b) { return (b.errors - a.errors) || (b.warnings - a.warnings) || a.obj.qualifiedName.localeCompare(b.obj.qualifiedName); });
    modelCache = { entries: entries, model: L.model, hits: hits };
    return hits;
  }

  S.renderModel = function (out) {
    L.clear(out);
    if (!L.model) {
      out.appendChild(W.empty('No project is open', [
        h('p', { class: 'muted', text: 'Open Log analysis from inside a project (its Logs section) and this tab lists the microflows, pages and entities of that project that your warnings and errors name — each one opens in the model, and can be commented on straight from the log.' })
      ]));
      return;
    }
    if (!S.all.length) {
      out.appendChild(W.empty('Load a log to see where it points in ' + L.model.projectName, [
        h('p', { class: 'muted', text: 'Warnings and errors that name a microflow, nanoflow, page or entity of this project are grouped here.' })
      ]));
      return;
    }
    var hits = modelHits(S.all);
    if (!hits.length) {
      out.appendChild(W.empty('Nothing in this log names an object of ' + L.model.projectName, [
        h('p', { class: 'muted', text: 'Only WARNING, ERROR and CRITICAL lines are looked at. If the log is from a different application, or the model is an older version, the names will not match.' })
      ]));
      return;
    }
    var totalE = hits.reduce(function (n, g) { return n + g.errors; }, 0);
    out.appendChild(h('p', { class: 'lg-model-intro' }, [
      h('strong', { text: String(hits.length) }), ' object' + (hits.length === 1 ? '' : 's') + ' of ',
      h('strong', { text: L.model.projectName }), ' named in ', h('strong', { text: L.fmtInt(totalE) }), ' error' + (totalE === 1 ? '' : 's') + ' and warnings. ',
      h('span', { class: 'muted', text: 'Open one to see it in the model, or report it: the comment starts with the log lines already in it.' })
    ]));
    var list = h('div', { class: 'lg-model-list' });
    hits.forEach(function (g) {
      var o = g.obj;
      var sample = g.firstError || g.first;
      function draft() {
        var d = L.entryDraft(sample, o);
        var n = g.errors + g.warnings;
        d.problem = 'In the loaded log, this ' + o.kind + ' is named in ' + g.errors + ' error' + (g.errors === 1 ? '' : 's') + ' and ' + g.warnings +
          ' warning' + (g.warnings === 1 ? '' : 's') + ' (' + n + ' lines, ' + g.first.ts + ' → ' + g.last.ts + ').\n\nFirst ' +
          (g.firstError ? 'error' : 'warning') + ' (' + (sample.file || 'log') + ', line ' + sample.line + ', ' + sample.node + '):\n\n' + d.problem.split('\n\n').slice(1).join('\n\n');
        d.severity = g.errors ? 'high' : 'medium';
        return d;
      }
      list.appendChild(h('div', { class: 'lg-model-card' }, [
        h('div', { class: 'lg-model-head' }, [
          W.modelChip(o, draft),
          h('span', { class: 'lg-model-counts' }, [
            g.errors ? h('span', { class: 'lg-tone-error', text: g.errors + ' error' + (g.errors === 1 ? '' : 's') }) : null,
            g.errors && g.warnings ? ' · ' : null,
            g.warnings ? h('span', { class: 'lg-tone-warn', text: g.warnings + ' warning' + (g.warnings === 1 ? '' : 's') }) : null
          ]),
          h('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Show in stream', title: 'Narrow the Log Stream to the lines that name ' + o.qualifiedName,
            onclick: function () { S.filterInsight('', 'WARN,ERROR,CRITICAL', o.qualifiedName, ''); }
          })
        ]),
        h('div', { class: 'lg-model-sample', title: sample.msg.split('\n')[0], text: sample.ts + '  ' + sample.node + ': ' + sample.msg.split('\n')[0] })
      ]));
    });
    out.appendChild(list);
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
            W.modelLinks(s.header + '\n' + s.stack.join('\n'), function (o) {
              var d = L.entryDraft({ level: s.type === 'exception' ? 'ERROR' : 'WARN', file: '', line: s.samples[0] ? s.samples[0].line : '?', ts: s.samples[0] ? s.samples[0].ts : '', node: '', msg: s.header + '\n' + s.stack.join('\n') }, o);
              d.problem = 'This error occurs ' + s.count + '× in the loaded log and names this ' + o.kind + ':\n\n' + s.header + (s.stack.length ? '\n' + s.stack.slice(0, 10).join('\n') : '');
              return d;
            }),
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
