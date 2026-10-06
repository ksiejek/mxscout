/* MxScout — Log analysis: the Microflow Tracer.
 *
 * Rebuilds microflow executions from MicroflowEngine records: exact durations from DEBUG
 * (Starting/Finished), activity-by-activity timelines and sub-microflow call trees from TRACE. Three
 * views of one log — each execution, each microflow aggregated, and the background work the runtime
 * starts on its own (scheduled events, task-queue workers) — plus an N+1 detector that flags a database
 * retrieve firing once per row inside a loop.
 *
 * The reading is MxDevSwissTool's (Mikołaj / RealMecowhy, MIT) — ../engine/tracer.js — and so is the
 * behaviour of this screen.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  var RENDER_CAP = 2000;   // rows in the DOM; a 69 MB log produces more than 11k executions

  var executions = [];
  var flows = [];
  var background = null;
  var lastFiltered = [];
  var view = 'exec';       // 'exec' | 'flows' | 'background'
  var sortKey = null, sortDir = -1;
  var selectedExec = null;
  var slowestId = null;
  var activeEl = null;
  var ui = {};

  var SORT = {
    time: function (e) { return e._idx; },
    duration: function (e) { return e.durationMs !== null && !isNaN(e.durationMs) ? e.durationMs : -1; },
    steps: function (e) { return e.steps.length; },
    sub: function (e) { return e.children.length; }
  };
  var FLOW_SORT = {
    calls: function (f) { return f.count; },
    total: function (f) { return f.totalMs; },
    avg: function (f) { return f.finishedCount ? f.totalMs / f.finishedCount : -1; },
    max: function (f) { return f.maxMs; }
  };
  var BG_SORT = {
    runs: function (e) { return e.runs; },
    median: function (e) { return e.medianMs === null ? -1 : e.medianMs; },
    max: function (e) { return e.maxMs === null ? -1 : e.maxMs; },
    every: function (e) { return e.medianIntervalMs === null ? -1 : e.medianIntervalMs; }
  };

  var loader = L.makeLoader('microflow-tracer', {
    parsing: 'Parsing microflow events...', building: 'Rebuilding executions…',
    apply: function (res) {
      var out = window.mftExtractExecutions(res.records);
      executions = out.executions;
      flows = out.flows;
      // N+1 detection pass (needs TRACE-level activity steps).
      window.mftDetectNPlusOne(executions);
      // The Background view needs the raw records too — its fallback reads failures from log nodes the
      // engine never touches (TaskQueue & co).
      background = window.mftBuildBackgroundView(executions, res.records);

      if (executions.length === 0) {
        ui.note.hidden = false;
        ui.note.textContent = ' · no MicroflowEngine records';
        ui.note.title = 'The log has no MicroflowEngine DEBUG/TRACE lines. Set the MicroflowEngine log node to DEBUG (execution times) or TRACE (activity steps + call tree) and reproduce the scenario.';
      } else if (out.stats.activityRecords === 0) {
        ui.note.hidden = false;
        ui.note.textContent = ' · DEBUG only';
        ui.note.title = 'Executions and durations were found, but no "Executing activity" TRACE records — set MicroflowEngine to TRACE to get activity steps and step timings.';
      } else { ui.note.hidden = true; ui.note.textContent = ''; }
      filter();
    }
  });

  function clearAll() {
    executions = []; flows = []; lastFiltered = []; background = null;
    selectedExec = null; slowestId = null; activeEl = null;
    ui.stats.visible(false);
    ui.note.hidden = true;
    ui.count.textContent = '0 executions';
    showEmpty();
    showDetailEmpty();
    loader.forget();
  }

  // The Executions-tab filter (search / slow-only / top-level), factored out so the Incident Report can
  // reproduce exactly what that tab shows — independently of which tab happens to be active.
  function filteredExecutions() {
    var search = ui.search.value.toLowerCase();
    var slowOnly = ui.slowOnly.input.checked;
    var slowMs = parseFloat(ui.slowMs.value) || 0;
    var topOnly = ui.topOnly.input.checked;
    return executions.filter(function (e) {
      if (topOnly && e.depth !== 0) return false;
      if (slowOnly && (e.durationMs === null || isNaN(e.durationMs) || e.durationMs <= slowMs)) return false;
      if (search && !e.name.toLowerCase().includes(search) && !e.corrId.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function filter() {
    var search = ui.search.value.toLowerCase();
    var slowOnly = ui.slowOnly.input.checked;
    var slowMs = parseFloat(ui.slowMs.value) || 0;

    if (view === 'background') {
      var bg = background || { events: [], errors: [], hasEngineData: false, runs: 0, requestRuns: 0, overlapCount: 0, unfinished: 0 };
      var events = bg.events.filter(function (e) { return !search || e.name.toLowerCase().includes(search); });
      if (slowOnly) events = events.filter(function (e) { return e.maxMs !== null && e.maxMs > slowMs; });
      if (sortKey && BG_SORT[sortKey]) { var a1 = BG_SORT[sortKey]; events = events.slice().sort(function (x, y) { return (a1(x) - a1(y)) * sortDir; }); }
      ui.count.textContent = events.length + (events.length === 1 ? ' event' : ' events');
      lastFiltered = events;
      updateStats(null);
      renderBackground(bg, events);
      return;
    }
    if (view === 'flows') {
      var fl = flows.filter(function (f) { return !search || f.name.toLowerCase().includes(search); });
      if (slowOnly) fl = fl.filter(function (f) { return f.maxMs > slowMs; });
      if (sortKey && FLOW_SORT[sortKey]) { var a2 = FLOW_SORT[sortKey]; fl = fl.slice().sort(function (x, y) { return (a2(x) - a2(y)) * sortDir; }); }
      ui.count.textContent = fl.length + ' flows';
      lastFiltered = fl;
      updateStats(null);
      renderFlows(fl);
      return;
    }
    var out = filteredExecutions();
    if (sortKey && SORT[sortKey]) { var a3 = SORT[sortKey]; out.sort(function (x, y) { return (a3(x) - a3(y)) * sortDir; }); }
    ui.count.textContent = out.length + ' executions';
    lastFiltered = out;
    updateStats(out);
    renderExecs(out);
  }

  function setView(v) {
    view = v;
    ui.view.set(v);
    ui.headExec.show(v === 'exec');
    ui.headFlow.show(v === 'flows');
    ui.headBg.show(v === 'background');
    sortKey = null; sortDir = -1;
    [ui.headExec, ui.headFlow, ui.headBg].forEach(function (x) { x.setSort(null); });
    filter();
  }

  function sort(key) {
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = key === 'time' ? 1 : -1; }
    [ui.headExec, ui.headFlow, ui.headBg].forEach(function (x) { x.setSort(sortKey, sortDir); });
    filter();
  }

  function updateStats(list) {
    // The background view counts runs, not executions, and carries its own summary strip — showing both side
    // by side would read as two contradicting totals.
    if (view === 'background' || executions.length === 0) { ui.stats.visible(false); slowestId = null; return; }
    ui.stats.visible(true);
    var l = list || executions;
    var sum = 0, timed = 0, slowest = null, slowestMs = -1, unfinished = 0, n1 = 0;
    var names = new Set();
    l.forEach(function (e) {
      names.add(e.displayName);
      if (!e.finished) unfinished++;
      if (e.nPlusOne && e.nPlusOne.length) n1++;
      if (e.durationMs !== null && !isNaN(e.durationMs)) { sum += e.durationMs; timed++; if (e.durationMs > slowestMs) { slowestMs = e.durationMs; slowest = e; } }
    });
    ui.stats.set('total', String(l.length));
    ui.stats.set('flows', String(names.size));
    ui.stats.set('sum', timed ? window.mftFmtMs(sum) : '–');
    ui.stats.set('avg', timed ? window.mftFmtMs(sum / timed) : '–');
    ui.stats.set('slowest', slowest ? window.mftFmtMs(slowestMs) : '–');
    ui.stats.set('unfinished', String(unfinished));
    ui.stats.set('n1', String(n1));
    ui.stats.show('n1', n1 > 0);
    slowestId = slowest ? slowest.id : null;
  }

  function selectSlowest() {
    if (slowestId === null || slowestId === undefined) return;
    var node = ui.list.querySelector('[data-execid="' + slowestId + '"]');
    if (node) { node.scrollIntoView({ block: 'center' }); node.click(); return; }
    // The row may be outside the render cap — select directly.
    var exec = executions[slowestId];
    if (exec) selectExecution(exec);
  }

  // ---------- the lists ----------
  function showEmpty() {
    L.replace(ui.list, [W.empty('Drop a log file here or use “Load log”', [
      h('p', { class: 'muted', text: 'MicroflowEngine at DEBUG — execution times · at TRACE — activity steps and the call tree.' }),
      howTo()
    ])]);
  }
  function howTo() {
    return W.howTo('How to get this data', [h('p', null, ['Raise ', h('strong', { text: 'MicroflowEngine' }), ' to ', h('strong', { text: 'DEBUG' }), ' (execution times) or ', h('strong', { text: 'TRACE' }),
      ' (activity steps and call tree) — Studio Pro: Console → Advanced → Set Log Levels; Mendix Cloud: Environment → Details → Log Levels. Reproduce the scenario, then export or download the log.'])]);
  }

  function badge(text, title, tone) { return h('span', { class: 'lg-badge is-' + (tone || 'warn'), title: title || null, text: text }); }

  function renderExecs(list) {
    L.clear(ui.list);
    if (list.length === 0) {
      if (!executions.length) showEmpty();
      else ui.list.appendChild(h('div', { class: 'lg-list-empty', text: 'No microflow executions match the criteria.' }));
      return;
    }
    var visible = list.length > RENDER_CAP ? list.slice(0, RENDER_CAP) : list;
    var frag = document.createDocumentFragment();
    visible.forEach(function (e) {
      var timeShort = e.startTs.length > 11 ? e.startTs.substring(11, 23) : e.startTs;
      var row = h('div', { class: 'lg-lrow lg-trow-exec', 'data-execid': String(e.id), onclick: function () { activate(row); selectExecution(e); } }, [
        h('div', { class: 'lg-mono lg-muted', text: timeShort }),
        h('div', { class: 'lg-ellipsis', title: e.name + ' [' + e.corrId + ']' }, [
          e.depth ? h('span', { class: 'lg-muted', text: '  '.repeat(Math.min(e.depth, 6)) + '└ ' }) : null,
          e.displayName,
          e.recursive ? badge('REC', 'This microflow was already on the call stack when this execution started (recursion)') : null,
          !e.finished ? badge('…', 'No Finished record — the log window probably ends mid-execution', 'bad') : null,
          (e.nPlusOne && e.nPlusOne.length) ? badge('N+1', 'N+1 detected: ' + e.nPlusOne.map(function (d) { return d.type + ' ×' + d.count; }).join(', ')) : null
        ]),
        h('div', { class: 'lg-bold lg-accent', text: window.mftFmtMs(e.durationMs) }),
        h('div', { class: 'is-right lg-muted', text: String(e.steps.length) }),
        h('div', { class: 'is-right lg-muted', text: e.children.length ? String(e.children.length) : '' })
      ]);
      if (selectedExec && selectedExec.id === e.id) { row.classList.add('is-active'); activeEl = row; }
      frag.appendChild(row);
    });
    ui.list.appendChild(frag);
    if (list.length > RENDER_CAP) {
      ui.list.appendChild(h('div', { class: 'lg-list-empty', text: 'Showing first ' + L.fmtInt(RENDER_CAP) + ' of ' + L.fmtInt(list.length) + ' executions — narrow down with the filters above.' }));
    }
  }

  function activate(row) {
    if (activeEl) activeEl.classList.remove('is-active');
    row.classList.add('is-active');
    activeEl = row;
  }

  // Drilling into a row switches to the executions view filtered to that flow.
  function drill(name) {
    ui.search.value = name.replace(' (nested)', '');
    setView('exec');
  }

  function renderFlows(list) {
    L.clear(ui.list);
    if (list.length === 0) {
      if (!executions.length) showEmpty(); else ui.list.appendChild(h('div', { class: 'lg-list-empty', text: 'No microflows match the criteria.' }));
      return;
    }
    list.forEach(function (f) {
      ui.list.appendChild(h('div', { class: 'lg-lrow lg-trow-flow', onclick: function () { drill(f.name); } }, [
        h('div', { class: 'lg-ellipsis', title: f.name }, [f.name, f.recursions ? badge('REC', f.recursions + ' recursive execution(s)') : null]),
        h('div', { class: 'is-right lg-muted', text: String(f.count) }),
        h('div', { class: 'is-right lg-bold lg-accent', text: f.finishedCount ? window.mftFmtMs(f.totalMs) : '–' }),
        h('div', { class: 'is-right', text: f.finishedCount ? window.mftFmtMs(f.totalMs / f.finishedCount) : '–' }),
        h('div', { class: 'is-right', text: f.maxMs >= 0 ? window.mftFmtMs(f.maxMs) : '–' })
      ]));
    });
  }

  // Compact per-node failure strip. The full task × queue breakdown lives in Log Viewer → Insights; this only
  // tells the reader that background work is failing.
  function failuresBox(errors) {
    return h('div', { class: 'lg-bgerrors' }, [
      h('div', { class: 'lg-bgerrors-title', text: 'Background failures in this log' }),
      errors.map(function (e) {
        return h('div', { class: 'lg-bgerrors-row' }, [h('strong', { text: e.node }), h('span', { class: 'lg-tone-error lg-bold', text: String(e.count) }), h('span', { class: 'lg-muted lg-ellipsis', title: e.sample, text: e.sample })]);
      }),
      h('div', { class: 'lg-muted', text: 'Full task × queue breakdown: Log Viewer → Insights.' })
    ]);
  }

  function renderBackground(bg, events) {
    L.clear(ui.list);
    // Nothing loaded yet is not the same as "no background work in this log".
    if (!background) {
      ui.list.appendChild(h('div', { class: 'lg-list-empty', text: 'Drop a log file here or use “Load log” to see scheduled events and other background work.' }));
      return;
    }
    // No MicroflowEngine records at all: say what is missing and how to get it, but still show whatever
    // background failures the log does carry.
    if (!bg.hasEngineData) {
      ui.list.appendChild(W.empty(bg.errors.length ? 'No MicroflowEngine records — run statistics are unavailable, but this log does contain background failures.' : 'No MicroflowEngine records in this log.', [
        W.howTo('How to get run statistics', [h('p', null, ['Scheduled events and queue workers are ordinary microflows — raise ', h('strong', { text: 'MicroflowEngine' }), ' to ', h('strong', { text: 'DEBUG' }),
          ' (run times) or ', h('strong', { text: 'TRACE' }), ' (activity steps) and let the schedule fire at least once. Studio Pro: Console → Advanced → Set Log Levels; Mendix Cloud: Environment → Details → Log Levels.'])])
      ]));
      if (bg.errors.length) ui.list.appendChild(failuresBox(bg.errors));
      return;
    }
    if (events.length === 0) {
      ui.list.appendChild(h('div', { class: 'lg-list-empty', text: bg.runs === 0
        ? 'No background work in this log — all ' + L.fmtInt(bg.requestRuns) + ' execution(s) ran on request correlation IDs. Scheduled events and queue workers use a UUID correlation ID; none appear here.'
        : 'No background events match the criteria.' }));
      if (bg.errors.length) ui.list.appendChild(failuresBox(bg.errors));
      return;
    }
    // Summary strip — only the facts that exist in this log.
    var bits = [[h('strong', { text: L.fmtInt(bg.runs) }), ' background run' + (bg.runs === 1 ? '' : 's')], [h('strong', { text: String(bg.events.length) }), ' event' + (bg.events.length === 1 ? '' : 's')]];
    if (bg.requestRuns) bits.push([L.fmtInt(bg.requestRuns) + ' request-driven (not shown)']);
    if (bg.overlapCount) bits.push([h('strong', { class: 'lg-tone-warn', text: String(bg.overlapCount) }), ' overlapping']);
    if (bg.unfinished) bits.push([h('strong', { class: 'lg-tone-error', text: String(bg.unfinished) }), ' unfinished']);
    var strip = h('div', { class: 'lg-bgsummary' });
    bits.forEach(function (b, i) { if (i) L.add(strip, ' · '); L.add(strip, b); });
    ui.list.appendChild(strip);

    events.forEach(function (ev) {
      // The generic explanation stays first; up to 5 concrete instances are appended so the tooltip alone
      // answers "which runs, exactly" without a trip to Executions.
      var ovl = (ev.overlaps || []).slice(0, 5).map(function (o) { return o.startTs + ' overlapped a run still open from ' + o.withStartTs + ' (by ' + window.mftFmtMs(o.overlapMs) + ')'; }).join('\n');
      var ovlMore = (ev.overlaps || []).length > 5 ? '\n… and ' + (ev.overlaps.length - 5) + ' more' : '';
      var trend = h('span', { class: 'lg-muted', title: 'Needs at least 4 timed runs', text: '–' });
      if (ev.trend) {
        var pct = Math.round(Math.abs(ev.trend.pct));
        var tip = 'First half median ' + window.mftFmtMs(ev.trend.firstHalfMs) + ' → second half ' + window.mftFmtMs(ev.trend.secondHalfMs);
        if (ev.trend.dir === 'up') trend = h('span', { class: 'lg-tone-warn lg-bold', title: tip, text: '↑ ' + pct + '%' });
        else if (ev.trend.dir === 'down') trend = h('span', { class: 'lg-tone-ok lg-bold', title: tip, text: '↓ ' + pct + '%' });
        else trend = h('span', { class: 'lg-muted', title: tip, text: '≈' });
      }
      ui.list.appendChild(h('div', { class: 'lg-lrow lg-trow-bg', onclick: function () { drill(ev.name); } }, [
        h('div', { class: 'lg-ellipsis', title: ev.name + ' — first run ' + (ev.firstTs || '?') + ', last run ' + (ev.lastTs || '?') }, [
          ev.name,
          ev.overlapCount ? badge('⇉ ' + ev.overlapCount, ev.overlapCount + ' run(s) started while a previous run was still open. For a scheduled event that means the run overran its interval; for a queue worker it is ordinary parallelism.' + (ovl ? '\n\n' + ovl + ovlMore : '')) : null,
          ev.unfinished ? badge('…' + ev.unfinished, ev.unfinished + ' run(s) without a Finished record — the log window ends mid-run, or the run failed', 'bad') : null
        ]),
        h('div', { class: 'is-right lg-muted', text: String(ev.runs) }),
        h('div', { class: 'is-right lg-bold lg-accent', text: window.mftFmtMs(ev.medianMs) }),
        h('div', { class: 'is-right', text: window.mftFmtMs(ev.maxMs) }),
        h('div', { class: 'is-right lg-muted', text: window.mftFmtInterval(ev.medianIntervalMs) }),
        h('div', { class: 'is-right' }, [trend])
      ]));
    });
    if (bg.errors.length) ui.list.appendChild(failuresBox(bg.errors));
  }

  // ---------- the detail pane ----------
  function showDetailEmpty() {
    L.replace(ui.dHead, [h('div', { class: 'lg-muted', text: 'Select an execution to see its activity timeline and call tree.' })]);
    L.clear(ui.n1); ui.n1.hidden = true;
    L.clear(ui.stepsBody);
    L.clear(ui.tree);
    ui.raw.textContent = '';
    ui.hand.sql.disabled = true; ui.hand.log.disabled = true;
  }

  function selectExecution(e) {
    selectedExec = e;
    ui.hand.sql.disabled = false; ui.hand.log.disabled = false;
    L.replace(ui.dHead, [
      h('div', { class: 'lg-dtitle', title: e.name, text: e.displayName }),
      h('div', { class: 'lg-dsub lg-mono' }, [
        e.startTs + (e.endTs ? ' → ' + (e.endTs.length > 11 ? e.endTs.substring(11) : e.endTs) : ' → (unfinished)') + ' · corr ' + e.corrId + ' · ',
        h('strong', { class: 'lg-accent', text: window.mftFmtMs(e.durationMs) })
      ]),
      // The flow this execution is of, if the open project has it — to open it, or to report it.
      W.modelLinks(e.name, function (o) {
        var n1 = e.nPlusOne && e.nPlusOne.length ? ' N+1: ' + e.nPlusOne.map(function (d) { return (d.caption || d.type) + ' ×' + d.count; }).join(', ') + '.' : '';
        return { severity: 'medium', change: '',
          problem: 'Loaded log — execution of ' + e.name + ' at ' + e.startTs + ' (corr ' + e.corrId + ') took ' + window.mftFmtMs(e.durationMs) +
            ' over ' + e.steps.length + ' step' + (e.steps.length === 1 ? '' : 's') + '.' + n1 };
      }, 1)
    ]);

    // Timeline: this execution's own steps (sub-flow steps live in their own executions).
    L.clear(ui.n1);
    if (e.nPlusOne && e.nPlusOne.length) {
      ui.n1.hidden = false;
      L.add(ui.n1, [h('div', { class: 'lg-n1-title', text: '⚠ N+1 anti-pattern detected' }),
        h('div', { text: 'A database retrieve inside a loop is executing N times. This usually degrades performance severely. Consider pulling the data outside the loop with a single batch retrieve.' }),
        h('ul', null, e.nPlusOne.map(function (d) { return h('li', null, [h('strong', { text: d.caption || d.type }), ' (' + d.type + ') executed ', h('strong', { text: d.count + ' times' }), ' taking ' + window.mftFmtMs(d.totalMs) + ' in total.']); }))]);
    } else ui.n1.hidden = true;

    L.clear(ui.stepsBody);
    if (e.steps.length === 0) {
      ui.stepsBody.appendChild(h('tr', null, [h('td', { colspan: '5', class: 'lg-table-empty', text: 'No activity steps (TRACE level required for MicroflowEngine).' })]));
    } else {
      var maxStep = Math.max.apply(null, e.steps.map(function (s) { return s.durationMs || 0; }));
      e.steps.forEach(function (s, i) {
        var off = (!isNaN(s.ms) && !isNaN(e.startMs)) ? s.ms - e.startMs : NaN;
        var pct = maxStep > 0 && s.durationMs ? Math.max(2, (s.durationMs / maxStep) * 100) : 0;
        ui.stepsBody.appendChild(h('tr', null, [
          h('td', { class: 'lg-muted', text: String(i + 1) }),
          h('td', { class: 'lg-mono lg-muted', text: '+' + (isNaN(off) ? '?' : window.mftFmtMs(off)) }),
          h('td', { class: 'lg-bold', text: s.type }),
          h('td', { class: 'lg-ellipsis', title: s.caption, text: s.caption }),
          h('td', null, [h('span', { class: 'lg-stepdur', text: window.mftFmtMs(s.durationMs) }), h('span', { class: 'lg-stepbar', style: 'width:' + Math.min(100, pct) + 'px' })])
        ]));
      });
    }

    // Call tree, from the root of this execution's tree.
    L.clear(ui.tree);
    var root = e;
    while (root.parentId !== null && executions[root.parentId]) root = executions[root.parentId];
    treeNode(root, 0, e.id);

    // Raw engine events reconstructed for copy/inspection.
    var lines = [e.startTs + "  Starting execution of microflow '" + e.name + "'  [" + e.corrId + ']'];
    e.steps.forEach(function (s) { lines.push(s.ts + '  Executing activity: ' + s.type + (s.caption ? ' — ' + s.caption : '')); });
    if (e.endTs) lines.push(e.endTs + "  Finished execution of microflow '" + e.name + "'");
    ui.raw.textContent = lines.join('\n');
  }

  function treeNode(exec, depth, selectedId) {
    var isSel = exec.id === selectedId;
    ui.tree.appendChild(h('div', {
      class: 'lg-treerow' + (isSel ? ' is-active' : ''), style: 'padding-left:' + (8 + depth * 18) + 'px', title: exec.name, onclick: function () { selectExecution(exec); }
    }, [
      (depth ? '└ ' : '') + exec.displayName + ' ',
      h('span', { class: 'lg-accent', text: window.mftFmtMs(exec.durationMs) }), ' ',
      h('span', { class: 'lg-muted lg-small', text: '(' + exec.steps.length + ' steps)' }),
      exec.recursive ? h('span', { class: 'lg-tone-warn lg-small lg-bold', text: ' REC' }) : null
    ]));
    exec.children.forEach(function (c) { treeNode(c, depth + 1, selectedId); });
  }

  // ---------- hand-offs ----------
  // MicroflowEngine lines carry no Tx-Conn, so the correlation with SQL is purely temporal: the Query
  // Extractor gets a [start, end] window. If it has nothing yet, the log loaded here goes with it, so one file
  // load powers both tools.
  function showInQueries() {
    var e = selectedExec;
    if (!e) { L.toast('Select a microflow execution first.', 'warn'); return; }
    if (!e.endTs) { L.toast('This execution has no Finished record — no time window to correlate.', 'warn'); return; }
    var lqe = L.tools['log-query-extractor'];
    L.goto('log-query-extractor', { withReturn: true });
    lqe.setTimeWindow(e.startTs, e.endTs, e.displayName);
    var raw = loader.rawText();
    if (!lqe.hasData() && raw) lqe.loadText(raw);
  }

  // The reverse of every other cross-link, which all lead away from the Log Viewer: once the Tracer says "this
  // execution was slow / unfinished", the next question is what else got logged under the same request — the
  // ERROR, the stack trace, the surrounding INFO chatter. The correlation ID is exact here (no time window).
  function showInLogViewer() {
    var e = selectedExec;
    if (!e) { L.toast('Select a microflow execution first.', 'warn'); return; }
    if (!e.corrId) { L.toast('This execution has no correlation ID to filter on.', 'warn'); return; }
    var lv = L.tools['log-viewer'];
    L.goto('log-viewer', { withReturn: true });
    var raw = loader.rawText();
    var ready = (!lv.hasData() && raw) ? Promise.resolve(lv.loadText(raw, 'from Microflow Tracer')) : Promise.resolve();
    ready.then(function () { lv.filterInsight('', '', e.corrId); });
  }

  // ---------- exports ----------
  var EXPORT_HEADER = ['Microflow', 'Start', 'Duration (ms)', 'Steps', 'Sub-flows', 'Depth', 'Corr ID', 'Status', 'N+1 Issues'];
  // Background runs are a different shape from executions, so the export follows the active view.
  var BG_EXPORT_HEADER = ['Event', 'Runs', 'Median (ms)', 'Min (ms)', 'Max (ms)', 'Every (ms)', 'Trend', 'Overlapping', 'Unfinished', 'First run', 'Last run'];
  function exportHeader() { return view === 'background' ? BG_EXPORT_HEADER : EXPORT_HEADER; }
  function n1Text(e) { return (e.nPlusOne && e.nPlusOne.length) ? e.nPlusOne.map(function (d) { return d.type + ' ×' + d.count; }).join(', ') : ''; }
  function execRow(e) {
    return [e.displayName, e.startTs, (e.durationMs !== null && !isNaN(e.durationMs)) ? +e.durationMs.toFixed(3) : '', e.steps.length, e.children.length, e.depth, e.corrId, e.finished ? 'finished' : 'unfinished', n1Text(e)];
  }
  function exportRows() {
    if (view === 'background') {
      return lastFiltered.map(function (ev) {
        return [ev.name, ev.runs, ev.medianMs === null ? '' : +ev.medianMs.toFixed(3), ev.minMs === null ? '' : +ev.minMs.toFixed(3), ev.maxMs === null ? '' : +ev.maxMs.toFixed(3),
          ev.medianIntervalMs === null ? '' : Math.round(ev.medianIntervalMs), ev.trend ? ev.trend.dir + ' ' + Math.round(ev.trend.pct) + '%' : '',
          ev.overlapCount || '', ev.unfinished || '', ev.firstTs || '', ev.lastTs || ''];
      });
    }
    if (view === 'flows') {
      return lastFiltered.map(function (f) { return [f.name, '', f.finishedCount ? Math.round(f.totalMs) : '', f.steps, '', '', '', f.count + ' calls' + (f.unfinished ? ', ' + f.unfinished + ' unfinished' : '')]; });
    }
    return lastFiltered.map(execRow);
  }
  function needRows() {
    if (lastFiltered.length) return true;
    L.toast('Nothing to export — load a log first (and check the active filters).', 'warn');
    return false;
  }

  // Incident Report source: the Executions tab's current filtered list, optionally narrowed to [fromMs, toMs]
  // by start time. null when empty.
  function reportSection(fromMs, toMs) {
    if (!executions.length) return null;
    var inWin = filteredExecutions().filter(function (e) {
      if (fromMs != null && !isNaN(e.startMs) && e.startMs < fromMs) return false;
      if (toMs != null && !isNaN(e.startMs) && e.startMs > toMs) return false;
      return true;
    });
    if (!inWin.length) return null;
    var firstMs = Infinity, lastMs = -Infinity, unfinished = 0;
    var rows = inWin.map(function (e) {
      if (!isNaN(e.startMs)) { if (e.startMs < firstMs) firstMs = e.startMs; if (e.startMs > lastMs) lastMs = e.startMs; }
      if (!e.finished) unfinished++;
      return execRow(e);
    });
    return {
      id: 'microflow-tracer', title: 'Microflow Tracer — executions',
      subtitle: rows.length + ' execution' + (rows.length === 1 ? '' : 's') + (unfinished ? ' · ' + unfinished + ' unfinished' : ''),
      columns: EXPORT_HEADER, rows: rows, total: rows.length,
      firstMs: firstMs === Infinity ? null : firstMs, lastMs: lastMs === -Infinity ? null : lastMs
    };
  }

  // ---------- build ----------
  function build() {
    var picker = W.filePicker('Load log', { primary: true, accept: '.log,.txt,.csv,.gz' }, loader.loadFiles);
    var actions = h('div', { class: 'lg-actions' }, [
      picker.button, picker.input,
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Export CSV', title: 'Download the currently filtered list as a CSV file', onclick: function () { if (needRows()) L.downloadCsv(view === 'background' ? 'microflow-background-events.csv' : 'microflow-executions.csv', exportHeader(), exportRows()); } }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy Markdown', title: 'Copy the currently filtered list as a Markdown table', onclick: function (e) { if (needRows()) L.copyMarkdown(exportHeader(), exportRows(), e.currentTarget); } }),
      h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', text: 'Clear', onclick: clearAll })
    ]);

    ui.view = W.segmented([
      { id: 'exec', label: 'Executions' }, { id: 'flows', label: 'By microflow' },
      { id: 'background', label: 'Background', title: 'Scheduled events and other work the runtime starts itself (UUID correlation IDs), aggregated per event' }
    ], 'exec', setView);
    ui.search = W.searchBox('Search microflow, corr ID…', filter, 'lg-input-grow');
    ui.slowOnly = W.checkbox('Slow only >', false, filter, 'Show only executions with a measured duration above the threshold');
    ui.slowMs = W.numberInput(100, filter, { step: '50', title: 'Slow-execution threshold in milliseconds' });
    ui.topOnly = W.checkbox('Top-level', false, filter, 'Hide sub-microflow executions — show only the entry points of each call tree');
    ui.count = h('span', { text: '0 executions' });
    ui.note = h('span', { class: 'lg-tone-warn lg-help', hidden: true });

    ui.stats = W.statBar([
      { id: 'total', label: 'Executions:' }, { id: 'flows', label: 'Flows:', title: 'Distinct microflows across visible executions' },
      { id: 'sum', label: 'Total time:', title: 'Sum of measured durations across visible executions' }, { id: 'avg', label: 'Avg:', title: 'Average of measured durations across visible executions' },
      { id: 'slowest', label: 'Slowest:', tone: 'accent', onClick: selectSlowest, title: 'Slowest visible execution — click to select it' },
      { id: 'unfinished', label: 'Unfinished:', title: 'Executions without a Finished record — the log window likely ends mid-execution' },
      { id: 'n1', label: 'N+1 issues:', tone: 'warn', hidden: true, title: 'Executions with detected N+1 patterns (DB retrieve inside a loop)' }
    ]);

    ui.headExec = W.gridHead([
      { label: 'Time', key: 'time', title: 'Click to sort by log order' }, { label: 'Microflow' },
      { label: 'Duration', key: 'duration', title: 'Execution time (Starting → Finished, needs DEBUG) — click to sort' },
      { label: 'Steps', key: 'steps', align: 'right', title: 'Activity steps logged for this execution (needs TRACE) — click to sort' },
      { label: 'Sub', key: 'sub', align: 'right', title: 'Direct sub-microflow calls — click to sort' }
    ], '118px 1fr 84px 56px 48px', sort);
    ui.headFlow = W.gridHead([
      { label: 'Microflow' }, { label: 'Calls', key: 'calls', align: 'right', title: 'Number of executions — click to sort' },
      { label: 'Total', key: 'total', align: 'right', title: 'Summed duration of finished executions — click to sort' },
      { label: 'Avg', key: 'avg', align: 'right', title: 'Average duration — click to sort' }, { label: 'Max', key: 'max', align: 'right', title: 'Slowest single execution — click to sort' }
    ], '1fr 62px 84px 84px 84px', sort);
    ui.headBg = W.gridHead([
      { label: 'Event' }, { label: 'Runs', key: 'runs', align: 'right', title: 'Number of runs on a background correlation ID — click to sort' },
      { label: 'Median', key: 'median', align: 'right', title: 'Median run duration — click to sort' }, { label: 'Max', key: 'max', align: 'right', title: 'Slowest run — click to sort' },
      { label: 'Every', key: 'every', align: 'right', title: 'Median time between run starts — for a scheduled event this is its schedule; click to sort' },
      { label: 'Trend', align: 'right', title: 'Median duration of the first half of the runs vs the second half — needs at least 4 timed runs' }
    ], '1fr 52px 78px 78px 74px 62px', sort);
    ui.headFlow.show(false); ui.headBg.show(false);

    ui.list = L.keepScroll(h('div', { class: 'lg-list' }));
    W.dropTarget(ui.list, loader.loadFiles, L.looksLikeLog);
    showEmpty();

    var left = h('div', { class: 'lg-left' }, [
      h('div', { class: 'lg-ltool' }, [ui.view.el, ui.search, ui.slowOnly.el, ui.slowMs, h('span', { class: 'lg-dim', text: 'ms' }), ui.topOnly.el, h('span', { class: 'lg-count' }, [ui.count, ui.note])]),
      ui.stats.el, ui.headExec.el, ui.headFlow.el, ui.headBg.el, ui.list
    ]);

    // ---- right ----
    ui.dHead = h('div', { class: 'lg-dhead' });
    ui.hand = {
      sql: h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'SQL in window', disabled: true, title: 'Open the Log Query Extractor filtered to the SQL queries that ran inside this execution’s time window (temporal correlation — engine lines carry no connection id)', onclick: showInQueries }),
      log: h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Show in Log Viewer', disabled: true, title: 'Show every log line recorded under this execution’s correlation ID in the Log Viewer — exact match, no time window needed', onclick: showInLogViewer })
    };
    ui.n1 = h('div', { class: 'lg-n1', hidden: true });
    ui.stepsBody = h('tbody');
    ui.tree = h('div', { class: 'lg-tree' });
    ui.raw = h('pre', { class: 'lg-code lg-code-plain' });
    var panes = {
      timeline: h('div', { class: 'lg-dpane' }, [ui.n1, h('div', { class: 'lg-tablewrap' }, [h('table', { class: 'lg-table' }, [
        h('thead', null, [h('tr', null, [h('th', { text: '#' }), h('th', { text: 'Offset', title: 'Offset from execution start' }), h('th', { text: 'Activity' }), h('th', { text: 'Caption' }), h('th', { text: 'Duration', title: 'Time until the engine logged the next event on this correlation ID' })])]), ui.stepsBody])])]),
      tree: h('div', { class: 'lg-dpane', hidden: true }, [ui.tree]),
      raw: h('div', { class: 'lg-dpane', hidden: true }, [h('div', { class: 'lg-dbar' }, [W.copyButton(function () { return ui.raw.textContent; })]), ui.raw])
    };
    var dtabs = W.tabs([{ id: 'timeline', label: 'Activity Timeline' }, { id: 'tree', label: 'Call Tree' }, { id: 'raw', label: 'Raw' }], 'timeline',
      function (id) { Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== id; }); }, 'lg-tabs lg-tabs-sm');
    var right = h('div', { class: 'lg-right' }, [ui.dHead, h('div', { class: 'lg-dtabrow' }, [dtabs.el, h('span', { class: 'lg-grow' }), ui.hand.sql, ui.hand.log]),
      h('div', { class: 'lg-dbody' }, [panes.timeline, panes.tree, panes.raw])]);
    showDetailEmpty();

    return h('div', { class: 'lg-tool lg-split' }, [actions, h('div', { class: 'lg-splitbody' }, [left, right])]);
  }

  // The REST & WS Extractor and the Error Decoder narrow this tool to one microflow or correlation ID by
  // putting it in the search box.
  function search(text) { ui.search.value = text; if (view !== 'exec') setView('exec'); else filter(); }

  L.register({
    id: 'microflow-tracer', label: 'Microflow Tracer',
    hint: 'Executions, call trees, N+1 loops and background-run statistics from MicroflowEngine records.',
    build: build,
    hasData: function () { return executions.length > 0; },
    loadText: loader.loadText,
    loadFiles: loader.loadFiles,
    search: search,
    reportSection: reportSection
  });
})();
