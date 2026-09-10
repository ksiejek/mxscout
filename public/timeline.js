/* MxScout — the performance Timeline: one time axis and everything drawn on it.
 *
 * Split out of public/perf.js, which had grown to 2,700 lines and become the
 * biggest file in the repo. The boundary follows the TOPIC, not where the code
 * happened to sit: perf.js keeps the recording — connecting to the admin port,
 * saving, importing, and every aggregation over the samples — and this file
 * keeps the view that puts those aggregations on a shared clock.
 *
 * What that view is, and why it is shaped this way (ROADMAP step 46, Phase 2f):
 * zoom is PIXELS PER SECOND, so the canvas is as wide as the recording is long
 * and the browser scrolls it. Fitting a whole recording into the panel's width
 * is what made a 150 ms action in a 57 s recording two pixels wide and
 * unclickable. Everything here hangs off that one decision — the ruler, the
 * pinned track gutter, the sticky labels, the clustering, and the runtime
 * tracks that share the ruler with the request bars so that "the heap stepped
 * under THIS microflow" is a thing you can see rather than infer.
 *
 * It computes nothing about a recording itself. Every number it draws arrives
 * through init() from perf.js, which is the only file that reads a sample.
 */
(function () {
  'use strict';

  // Bound once, in init(). The app's own three, then the recording functions
  // perf.js owns — this file never reaches into another module for them.
  var el, withMod, jumpToObject;
  var buildRequestRows, buildSpans, observedIntervalMs, totalDurationMs,
      concurrencySeries, poolSeries, gcMarks, connectionbusSeries, sparklineSvg,
      formatMs, formatBytes, typeClass, moduleOf, xpathEntityQualifiedName,
      resolveFrame, findingButton, CB_OPS;

  function init(deps) {
    el = deps.el;
    withMod = deps.withMod;
    jumpToObject = deps.jumpToObject;
    buildRequestRows = deps.buildRequestRows;
    buildSpans = deps.buildSpans;
    observedIntervalMs = deps.observedIntervalMs;
    totalDurationMs = deps.totalDurationMs;
    concurrencySeries = deps.concurrencySeries;
    poolSeries = deps.poolSeries;
    gcMarks = deps.gcMarks;
    connectionbusSeries = deps.connectionbusSeries;
    sparklineSvg = deps.sparklineSvg;
    formatMs = deps.formatMs;
    formatBytes = deps.formatBytes;
    typeClass = deps.typeClass;
    moduleOf = deps.moduleOf;
    xpathEntityQualifiedName = deps.xpathEntityQualifiedName;
    resolveFrame = deps.resolveFrame;
    findingButton = deps.findingButton;
    CB_OPS = deps.CB_OPS;
  }

  // Which request is open below the bars, and which span within its flame is
  // picked. Both belong to this view, so both live here with the zoom and the
  // scroll offset; perf.js keeps only the project id it scopes them against
  // and calls reset() when that changes.
  var selectedRequestId = null;
  var pickedSpanIndex = null;

  // How the five connectionbus counters are drawn: one hue, five strengths.
  // A breakdown of one quantity, not five identities, so it stays inside the
  // accent family instead of opening a sixth colour language on a screen that
  // already spends a hue per module. Karol's call, 2026-09-09. Delete is the
  // exception — it borrows the alarm hue, being the one that should catch the
  // eye. CB_OPS itself stays in perf.js, where the counters are read.
  var CB_FILL = {
    select: 'var(--accent)',
    insert: 'color-mix(in srgb, var(--accent) 66%, var(--panel-2))',
    update: 'color-mix(in srgb, var(--accent) 44%, var(--panel-2))',
    delete: 'color-mix(in srgb, var(--alarm) 55%, var(--panel-2))',
    transaction: 'color-mix(in srgb, var(--accent) 24%, var(--panel-2))'
  };


  // Greedy interval packing: place each request in the first lane whose last
  // bar already ends before this one starts, else open a new lane. Rows
  // arrive in the order buildRequestRows saw their ids, which is already
  // roughly chronological.
  function packLanes(rows) {
    var laneEnds = [];
    var placed = rows.map(function (row) {
      var lane = -1;
      for (var i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= row.firstT) { lane = i; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = row.lastT;
      return { row: row, lane: lane };
    });
    return { placed: placed, laneCount: laneEnds.length };
  }

  // ---------- the time axis (Phase 2f) ----------
  // The zoom control is PIXELS PER SECOND, and the tracks are exactly as wide
  // as that makes them \u2014 so stretching the timeline makes it LONGER than the
  // panel and a scrollbar appears, the way a track area works in a video
  // editor. Karol, 2026-09-09: "wa\u017cne aby jak masz timeline to mo\u017cna by\u0142o go
  // wyd\u0142u\u017ca\u0107 \u2014 czyli zwi\u0119kszy\u0107 step aby pojawi\u0142 si\u0119 scroll". Fitting the whole
  // recording into the panel's width is precisely what made a 150 ms action
  // two pixels wide and unclickable.
  //
  // These live at module scope, beside the selection they belong with, because
  // render() rebuilds the whole panel: a zoom level and a scroll offset held
  // in the DOM alone would snap back to the start every time a bar is clicked.
  var tlPps = null;          // pixels per second; null means "fit on first paint"
  var tlScrollLeft = 0;
  var tlCrumbs = [];         // zoom levels to come back to, newest last
  var tlSel = null;          // { a, b } in ms, while a range is being dragged
  var tlHover = null;        // ms under the pointer, for the crosshair
  var MIN_PPS = 1, MAX_PPS = 8000;
  var _tlModel = null, _tlRecording = null;

  function tlX(t) { return (t / 1000) * tlPps; }
  function tlT(x) { return (x / tlPps) * 1000; }
  function tlLength(recording) { return Math.max(1, totalDurationMs(recording) + observedIntervalMs(recording)); }

  // A tick every 78px or more, from a ladder of steps a person reads without
  // doing arithmetic. Exported so a test can pin the ladder rather than the
  // pixels it produces.
  function tickStep(pps) {
    var ladder = [10, 20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 60000];
    for (var i = 0; i < ladder.length; i++) if ((ladder[i] / 1000) * pps >= 78) return ladder[i];
    return ladder[ladder.length - 1];
  }

  // Absolute geometry on the canvas. A bar is never clamped to the viewport \u2014
  // that is the browser's job now \u2014 so this is just "where it is".
  function tlPlace(t0, t1) {
    var x0 = tlX(t0);
    return { x0: x0, w: Math.max(2, tlX(t1) - x0) };
  }

  // The bar says what it is. Colour comes from the MODULE (Karol's call,
  // 2026-09-09) rather than from the request type, so a bar means the same
  // thing here as everywhere else in MxScout and the eye can group by it;
  // the type is a chip inside the label, where it reads as a word instead of
  // as a colour nobody has a legend for.
  function renderBar(row) {
    var g = tlPlace(row.firstT, row.lastT + observedIntervalMs(_tlRecording));
    var name = row.entry || row.id;
    var bar = el('button', {
      class: 'perf-bar' + (selectedRequestId === row.id ? ' is-selected' : ''),
      'data-x0': g.x0.toFixed(1),
      style: 'left:' + g.x0.toFixed(1) + 'px;width:' + g.w.toFixed(1) + 'px',
      title: name + ' \u2014 ' + formatMs((row.lastT - row.firstT) + observedIntervalMs(_tlRecording)),
      onclick: function () { selectedRequestId = row.id; pickedSpanIndex = null; repaintTimeline(); },
      ondblclick: function () { tlZoomTo(row.firstT, row.lastT, true); }
    }, [
      el('span', { class: 'tl-lbl' }, [
        el('span', { class: 'tl-type', text: typeClass(row.type) }),
        el('span', { text: name })
      ])
    ]);
    return withMod(bar, moduleOf(name) || 'System');
  }

  // A label rides the VISIBLE edge of its bar, not the real one, so a call
  // that started before the viewport still says its own name \u2014 the same trick
  // Perfetto and the DevTools Performance panel use on long slices. Anything
  // too narrow to hold a name loses the label rather than showing a sliver of
  // one; on the flame, clusterSpans() below has already made sure that only
  // happens where a name would not have helped anyway.
  var TL_LABEL_PX = 34;
  function stickLabels(scroller, canvas) {
    var view0 = scroller.scrollLeft;
    var view1 = view0 + scroller.clientWidth;
    var bars = canvas.querySelectorAll('[data-x0]');
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      var lbl = bar.firstChild;
      if (!lbl || lbl.className !== 'tl-lbl') continue;
      var x0 = Number(bar.getAttribute('data-x0'));
      var w = bar.offsetWidth;
      var visible = Math.min(x0 + w, view1) - Math.max(x0, view0);
      if (visible < TL_LABEL_PX) { lbl.style.display = 'none'; continue; }
      lbl.style.display = '';
      lbl.style.left = Math.max(0, view0 - x0) + 'px';
    }
  }

  // The flame: one row per depth, depth 0 (the outermost, root call) at the
  // BOTTOM \u2014 the reading order every flame graph anyone has seen uses
  // (speedscope, DevTools Performance), and the one that matches "the thing
  // that triggered this" sitting still while what it called comes and goes
  // above it.
  function renderFlame(spans) {
    if (!spans.length) {
      return el('p', { class: 'muted', text: 'No activity recorded for this request.' });
    }
    var maxDepth = 0;
    spans.forEach(function (s) { if (s.depth > maxDepth) maxDepth = s.depth; });
    // Cluster from the root down, and do not draw what sits UNDER a clustered
    // block: a "×24" already says those calls are collapsed at this zoom, and
    // drawing their insides as fifty unreadable slivers underneath is the
    // same noise the block exists to replace. Stretching splits it and the
    // rows below come back.
    var hidden = [];
    var rows = [];
    for (var d = 0; d <= maxDepth; d++) {
      var atDepth = [];
      spans.forEach(function (s, i) {
        if (s.depth !== d) return;
        for (var h = 0; h < hidden.length; h++) if (s.t0 >= hidden[h].t0 && s.t1 <= hidden[h].t1) return;
        atDepth.push({ s: s, i: i });
      });
      var items = clusterSpans(atDepth);
      items.forEach(function (it) { if (it.items.length > 1) hidden.push({ t0: it.t0, t1: it.t1 }); });
      if (items.length) rows.push(items);
    }
    rows.reverse();
    return el('div', { class: 'flame-wrap' }, rows.map(function (rowItems) {
      return el('div', { class: 'flame-row' }, rowItems.map(renderFlameBar));
    }));
  }

  // Adjacent calls of the same thing, none of them wide enough to carry its
  // own name, become one block that is. The clustering threshold is
  // deliberately the SAME number as the label threshold: a block either has
  // room to say what it is, or it merges with its neighbours until it does —
  // there is no width band where a bar is drawn but unreadable, which is the
  // whole complaint this answers ("na samej kresce fajnie pokazać czym to
  // jest"). Reversible: clicking a cluster stretches to it and it comes apart.
  function clusterSpans(entries) {
    var sorted = entries.slice().sort(function (a, b) { return a.s.t0 - b.s.t0; });
    var out = [], cur = null;
    sorted.forEach(function (e) {
      var w = tlX(e.s.t1) - tlX(e.s.t0);
      if (cur && cur.items[0].s.name === e.s.name && w < TL_LABEL_PX &&
          (tlX(e.s.t0) - tlX(cur.t1)) < TL_LABEL_PX * 2) {
        cur.items.push(e);
        cur.t1 = e.s.t1;
        return;
      }
      cur = { t0: e.s.t0, t1: e.s.t1, items: [e] };
      out.push(cur);
      if (w >= TL_LABEL_PX) cur = null; // wide enough to stand alone; do not absorb the next
    });
    return out;
  }

  // On the RECORDING's axis, not on the request's own \u2014 that is what makes it
  // one timeline rather than two charts stacked. A call that ran at +7.4 s
  // sits under the +7.4 s tick, and under whatever else was running then.
  // The word for what a span IS, in the same chip the request bars already use
  // for their type. Karol, 2026-09-10: "fajnie jakby\u015bmy widzieli tam, gdzie
  // mamy napisany na przyk\u0142ad Client, \u017ce to jest Microflow" \u2014 a name
  // that reads like a microflow is a guess until the bar says so, and a
  // retrieve sits on the row above the flow that ran it looking much like it.
  function kindWord(kind) {
    return kind === 'flow' ? 'microflow' : kind === 'xpath' ? 'retrieve' : 'activity';
  }

  // The chip costs width the NAME needs more, so it rides only a bar with room
  // for both \u2014 the same rule as the label itself, one size up. Below that
  // the row, the colour and the tooltip still say what the bar is.
  var TL_CHIP_PX = 108;

  function renderFlameBar(item) {
    var s = item.items[0].s;
    var index = item.items[0].i;
    var count = item.items.length;
    var g = tlPlace(item.t0, item.t1);
    var word = kindWord(s.kind);
    var bar = el('button', {
      class: 'flame kind-' + s.kind + (count > 1 ? ' is-cluster' : '') +
             (count === 1 && pickedSpanIndex === index ? ' is-picked' : ''),
      'data-x0': g.x0.toFixed(1),
      style: 'left:' + g.x0.toFixed(1) + 'px;width:' + g.w.toFixed(1) + 'px',
      title: word.charAt(0).toUpperCase() + word.slice(1) + ' \u2014 ' + s.name +
             (count > 1 ? ' \u00d7' + count : '') + ' \u2014 ' + formatMs(item.t1 - item.t0),
      onclick: count > 1
        ? function () { tlZoomTo(item.t0, item.t1, true); }
        : function () { pickedSpanIndex = index; repaintTimeline(); },
      ondblclick: function () { tlZoomTo(item.t0, item.t1, true); }
    }, [
      el('span', { class: 'tl-lbl' }, [
        g.w >= TL_CHIP_PX ? el('span', { class: 'tl-type', text: word }) : null,
        el('span', { text: s.name }),
        count > 1 ? el('span', { class: 'tl-count', text: '\u00d7' + count }) : null
      ].filter(Boolean))
    ]);
    var modName = s.kind === 'flow' ? s.qualifiedName : (s.kind === 'xpath' ? xpathEntityQualifiedName(s.xpath) : null);
    return modName ? withMod(bar, moduleOf(modName) || modName) : bar;
  }

  function renderSpanDetail(model, spans) {
    var s = pickedSpanIndex != null ? spans[pickedSpanIndex] : null;
    if (!s) {
      return el('p', { class: 'muted perf-hint', text: 'Click a bar in the flame to see what it was doing.' });
    }
    var kindLabel = s.kind === 'xpath' ? 'Retrieve' : s.kind === 'flow' ? 'Microflow' : 'Activity';
    var wall = s.t1 - s.t0;
    var inCalls = Math.max(0, wall - s.self);
    var interval = observedIntervalMs(_tlRecording);
    var mod = s.qualifiedName ? moduleOf(s.qualifiedName)
      : (s.kind === 'xpath' ? moduleOf(xpathEntityQualifiedName(s.xpath) || '') : null);

    // The chips answer "what am I looking at" before any number is read. The
    // flat kv list this replaces made every fact the same size, so the module,
    // the loop position and the kind were all as loud as the finish time.
    var chips = [el('span', { class: 'perf-chip', text: kindLabel })];
    if (mod) chips.push(withMod(el('span', { class: 'perf-chip is-mod', text: mod }), mod));
    if (s.activity) chips.push(el('span', { class: 'perf-chip', text: s.activity }));
    if (s.iterations) chips.push(el('span', { class: 'perf-chip', text: 'iteration ' + (s.iteration != null ? s.iteration : '?') + ' of ' + s.iterations }));
    var sameName = spans.filter(function (o) { return o.name === s.name; }).length;
    if (sameName > 1) chips.push(el('span', { class: 'perf-chip', text: sameName + '\u00d7 in this request' }));

    var nums = [['Started', '+' + formatMs(s.t0)], ['Finished', '+' + formatMs(s.t1)],
                ['Wall', formatMs(wall)], ['Self', formatMs(s.self)],
                ['Samples', String(Math.max(1, Math.round(wall / interval)))]];
    if (s.amount != null) nums.push(['Amount asked', s.amount === -1 ? 'unlimited' : String(s.amount)]);
    if (s.returnsCount) nums.push(['Returns', 'a count']);

    var kids = [
      el('div', { class: 'perf-detail-head' }, [
        el('div', {}, [
          el('div', { class: 'perf-detail-title', text: s.name }),
          el('div', { class: 'perf-chips' }, chips)
        ]),
        el('div', { class: 'perf-detail-when' }, [
          el('b', { text: formatMs(wall) }),
          el('span', { class: 'muted', text: 'in this recording' })
        ])
      ]),
      // Self against what it called, as one bar. It is the single question a
      // caller actually has \u2014 is this slow, or is what it calls slow \u2014 and it
      // was a number in a list nobody compared against the one above it.
      el('div', { class: 'perf-split' }, [
        el('div', { class: 'perf-split-track' }, [
          el('div', { class: 'perf-split-self', style: 'width:' + (wall ? (s.self / wall) * 100 : 100).toFixed(1) + '%' })
        ]),
        el('div', { class: 'perf-split-legend' }, [
          el('span', { text: 'self ' + formatMs(s.self) }),
          el('span', { class: 'muted', text: 'in calls it made ' + formatMs(inCalls) })
        ])
      ]),
      el('div', { class: 'perf-nums' }, nums.map(function (n) {
        return el('div', { class: 'perf-num' }, [el('b', { text: n[1] }), el('span', { text: n[0] })]);
      }))
    ];
    if (s.kind === 'xpath' && s.xpath) kids.push(el('code', { class: 'rule-xpath-code', text: s.xpath }));

    var acts = [];
    var target = resolveFrame(model, s.frame);
    if (target) {
      acts.push(el('button', {
        class: 'btn btn-sm', text: 'Open ' + (s.qualifiedName || target.item.qualifiedName || target.item.name) + ' in the model',
        onclick: function () { jumpToObject(target.sectionKey, target.item); }
      }));
    }
    acts.push(el('button', { class: 'btn btn-sm', text: 'Stretch to this call', onclick: function () { tlZoomTo(s.t0, s.t1, true); } }));
    // The same comments.js editor every object popup uses, reached the same
    // way Hotspots reaches it \u2014 one finding system, not a second one.
    if (target) acts.push(findingButton(target));
    kids.push(el('div', { class: 'perf-detail-actions' }, acts));
    if (!target && s.kind === 'activity') {
      kids.push(el('p', { class: 'muted', style: 'margin:10px 0 0', text: 'A step the runtime reported \u2014 MxScout has no model object to open for it.' }));
    }
    return el('div', { class: 'perf-detail' }, kids);
  }

  // The timeline repaints itself rather than going through the app's render():
  // a zoom or a scroll must not rebuild the sidebar, the tabs and every other
  // card, and rebuilding them would throw away the scroll position this is
  // trying to keep. Same technique as updateStatusInPlace() above \u2014 one id,
  // one subtree.
  function repaintTimeline() {
    var host = document.getElementById('perf-timeline-area');
    if (!host || !_tlRecording) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    paintTimeline(host, _tlModel, _tlRecording);
  }

  function tlSetPps(next, anchorMs) {
    var scroller = document.querySelector('#perf-timeline-area .tl-scroll');
    var width = scroller ? scroller.clientWidth : 700;
    if (anchorMs == null) anchorMs = tlT(tlScrollLeft + width / 2);
    var offset = tlX(anchorMs) - tlScrollLeft;
    tlPps = Math.max(MIN_PPS, Math.min(MAX_PPS, next));
    tlScrollLeft = Math.max(0, tlX(anchorMs) - offset);
    tlSel = null;
    repaintTimeline();
  }

  function tlZoomTo(a, b, push) {
    var scroller = document.querySelector('#perf-timeline-area .tl-scroll');
    var width = scroller ? scroller.clientWidth : 700;
    var pad = observedIntervalMs(_tlRecording);
    a = Math.max(0, a - pad); b = b + pad;
    if (b - a < 20) { var c = (a + b) / 2; a = c - 10; b = c + 10; }
    if (push) tlCrumbs.push({ pps: tlPps, left: tlScrollLeft });
    tlPps = Math.max(MIN_PPS, Math.min(MAX_PPS, (width - 16) / ((b - a) / 1000)));
    tlScrollLeft = Math.max(0, tlX(a) - 8);
    tlSel = null;
    repaintTimeline();
  }

  function tlBack() {
    var c = tlCrumbs.pop();
    if (!c) return;
    tlPps = c.pps; tlScrollLeft = c.left; tlSel = null;
    repaintTimeline();
  }

  function renderTimeline(model, recording) {
    _tlModel = model;
    _tlRecording = recording;
    var host = el('div', { class: 'perf-tl', id: 'perf-timeline-area' });
    paintTimeline(host, model, recording);
    return host;
  }

  function paintTimeline(host, model, recording) {
    var rows = buildRequestRows(recording);
    if (!rows.length) {
      host.appendChild(el('p', { class: 'muted', text: 'This recording has no in-flight requests in it \u2014 the admin port answered, but nothing was running while it was polled.' }));
      return;
    }
    var lenMs = tlLength(recording);
    var interval = observedIntervalMs(recording);
    // Provisional until the scroller has been measured; the rAF at the bottom
    // fits it to the real width and repaints once.
    var needsFit = tlPps == null;
    if (needsFit) tlPps = 700 / (lenMs / 1000);

    host.appendChild(renderTlToolbar(recording, lenMs));
    host.appendChild(renderTlOverview(recording, lenMs));

    // --- the tracks: a pinned name gutter beside one scrolling canvas ---
    var gutter = el('div', { class: 'tl-gutter' });
    var canvas = el('div', { class: 'tl-canvas', tabindex: '0', style: 'width:' + tlX(lenMs).toFixed(1) + 'px' });

    var packed = packLanes(rows);
    var lanes = [];
    for (var i = 0; i < packed.laneCount; i++) lanes.push(el('div', { class: 'perf-lane' }));
    packed.placed.forEach(function (p) { lanes[p.lane].appendChild(renderBar(p.row)); });

    var selectedRow = rows.filter(function (r) { return r.id === selectedRequestId; })[0] || null;
    var spans = selectedRow ? buildSpans(recording, selectedRow.id) : [];

    var tracks = [
      { name: 'Time', read: formatMs(lenMs) + ' total', h: 22, body: renderTlRuler(lenMs) },
      { name: 'Requests', read: rows.length + ' request' + (rows.length === 1 ? '' : 's'),
        h: packed.laneCount * 28, body: el('div', {}, lanes) }
    ];

    var heap = renderHeapTrack(recording, lenMs, 46);
    if (heap) tracks.push({ name: 'Heap', read: heapReadout(recording), h: 46, body: heap });
    var db = renderDbTrack(recording, lenMs, 40);
    if (db) tracks.push({ name: 'Database', read: dbReadout(recording), h: 40, body: db });

    tracks.push({ name: 'Call stack',
      // The whole entry point, not its last dot-segment: the gutter wraps now,
      // so there is nothing to be gained by hiding which module it came from.
      read: selectedRow ? (selectedRow.entry || selectedRow.id) : 'pick a request',
      h: 0, body: selectedRow ? renderFlame(spans) : el('p', { class: 'muted perf-hint', text: 'Click a request bar above.' }) });
    tracks.forEach(function (tr) {
      gutter.appendChild(el('div', { class: 'tl-name' + (tr.h ? '' : ' is-auto'), style: tr.h ? 'height:' + tr.h + 'px' : null }, [
        el('b', { text: tr.name }), el('span', { class: 'tl-read', text: tr.read })
      ]));
      canvas.appendChild(el('div', { class: 'tl-row', style: tr.h ? 'height:' + tr.h + 'px' : null }, [tr.body]));
    });
    canvas.appendChild(renderTlOverlay(lenMs));

    var scroller = el('div', { class: 'tl-scroll' }, [canvas]);
    host.appendChild(el('div', { class: 'tl-grid' }, [
      el('div', { class: 'tl-gutter-wrap' }, [gutter]),
      scroller
    ]));

    if (selectedRow) {
      host.appendChild(el('div', { class: 'perf-detail-head' }, [
        el('span', { class: 'perf-detail-title', text: selectedRow.entry || selectedRow.id }),
        el('span', { class: 'muted', text: [selectedRow.type, selectedRow.user, formatMs((selectedRow.lastT - selectedRow.firstT) + interval)].filter(Boolean).join(' \u00b7 ') })
      ]));
      host.appendChild(renderSpanDetail(model, spans));
    }

    wireTimeline(scroller, canvas, lenMs);

    // Heights are only known once this is in the document, so the gutter's
    // auto-height row (the flame, which grows with call depth) is matched here
    // rather than guessed above.
    requestAnimationFrame(function () {
      if (!scroller.isConnected) return;
      // The fit pass: the provisional zoom above was a guess made before the
      // scroller existed, so now that it can be measured, set the real one and
      // paint once more. tlPps is a number by then, so this cannot recur.
      if (needsFit) {
        tlPps = Math.max(MIN_PPS, (scroller.clientWidth - 2) / (lenMs / 1000));
        tlScrollLeft = 0;
        repaintTimeline();
        return;
      }
      scroller.scrollLeft = tlScrollLeft;
      syncGutterHeights(gutter, canvas);
      stickLabels(scroller, canvas);
    });
  }

  // The gutter is a separate column, so the two have to agree on how tall each
  // row turned out. The TALLER of the pair wins, both ways: the flame grows
  // with call depth and the canvas is what knows that, while a track name that
  // wrapped onto a second line is what the gutter knows — and a gutter forced
  // down to the canvas's height is exactly how "808 select · 307 ot…" lost its
  // own ending (Karol, 2026-09-10).
  function syncGutterHeights(gutter, canvas) {
    var names = gutter.children, rowsEls = canvas.querySelectorAll('.tl-row');
    for (var i = 0; i < names.length && i < rowsEls.length; i++) {
      names[i].style.height = '';
      var h = Math.max(names[i].offsetHeight, rowsEls[i].offsetHeight);
      names[i].style.height = h + 'px';
      rowsEls[i].style.height = h + 'px';
    }
  }

  function renderTlToolbar(recording, lenMs) {
    var slider = el('input', {
      type: 'range', class: 'tl-slider', min: '0', max: '1000',
      value: String(Math.round(1000 * Math.log(tlPps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS))),
      title: 'Stretch the timeline'
    });
    slider.addEventListener('input', function () {
      tlSetPps(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Number(slider.value) / 1000));
    });
    return el('div', { class: 'tl-toolbar' }, [
      el('div', { class: 'tl-crumbs' }, [
        el('span', { class: 'tl-crumb', text: tlWindowLabel(lenMs) }),
        tlCrumbs.length ? el('button', { class: 'link-btn tl-back', text: '\u2190 back', title: 'Back to the previous zoom', onclick: tlBack }) : null
      ].filter(Boolean)),
      el('div', { class: 'tl-zoom' }, [
        el('button', { class: 'btn btn-sm tl-zoom-btn', text: '\u2212', title: 'Shorter', onclick: function () { tlSetPps(tlPps / 1.6); } }),
        slider,
        el('button', { class: 'btn btn-sm tl-zoom-btn', text: '+', title: 'Longer', onclick: function () { tlSetPps(tlPps * 1.6); } }),
        el('button', { class: 'btn btn-sm', text: 'Fit', title: 'Show the whole recording', onclick: function () { tlPps = null; tlScrollLeft = 0; tlCrumbs = []; repaintTimeline(); } }),
        el('span', { class: 'tl-scale', text: tlPps >= 1000 ? (tlPps / 1000).toFixed(1) + ' px/ms' : Math.round(tlPps) + ' px/s' })
      ])
    ]);
  }

  function tlWindowLabel(lenMs) {
    var scroller = document.querySelector('#perf-timeline-area .tl-scroll');
    var width = scroller ? scroller.clientWidth : 700;
    var a = tlT(tlScrollLeft), b = Math.min(lenMs, tlT(tlScrollLeft + width));
    return '+' + formatMs(a) + ' \u2013 +' + formatMs(b);
  }

  // Always the whole recording, however far the tracks below are stretched \u2014
  // the silhouette is how you find the busy stretch you are looking for, and
  // the window on it is how you get there. Drag it to move, drag an edge to
  // stretch, drag the empty part to pick a new stretch outright.
  function renderTlOverview(recording, lenMs) {
    var wrap = el('div', { class: 'tl-mini' });
    wrap.appendChild(el('div', { class: 'tl-mini-spark' }, [sparklineSvg(concurrencySeries(recording), 'var(--accent)')]));
    wrap.appendChild(el('div', { class: 'tl-mini-shade is-left' }));
    wrap.appendChild(el('div', { class: 'tl-mini-shade is-right' }));
    wrap.appendChild(el('div', { class: 'tl-mini-win' }, [
      el('span', { class: 'tl-mini-grip is-l', 'data-grip': 'l' }),
      el('span', { class: 'tl-mini-grip is-r', 'data-grip': 'r' })
    ]));
    wrap.addEventListener('mousedown', function (e) { onMiniDown(e, wrap, lenMs); });
    positionMiniWindow(wrap, lenMs);
    return wrap;
  }

  function positionMiniWindow(wrap, lenMs) {
    var scroller = document.querySelector('#perf-timeline-area .tl-scroll');
    var width = scroller ? scroller.clientWidth : 700;
    var l = Math.max(0, Math.min(100, (tlT(tlScrollLeft) / lenMs) * 100));
    var w = Math.max(1, Math.min(100 - l, (tlT(width) / lenMs) * 100));
    wrap.querySelector('.tl-mini-win').setAttribute('style', 'left:' + l + '%;width:' + w + '%');
    wrap.querySelector('.tl-mini-shade.is-left').setAttribute('style', 'left:0;width:' + l + '%');
    wrap.querySelector('.tl-mini-shade.is-right').setAttribute('style', 'left:' + (l + w) + '%;right:0');
  }

  // Dragging here used to fight back, and for three separate reasons (Karol,
  // 2026-09-10: "jak próbujesz to rozszerzać tam, gdzie masz ten sampling, to
  // zaczyna troszeczkę skakać"):
  //
  //   1. Grabbing the window CENTRED it under the cursor, so the first pixel
  //      of a drag teleported the view. You grab it where you grabbed it now —
  //      the offset into the window is kept for the whole drag.
  //   2. Every mousemove ran a full repaintTimeline(), which tears the whole
  //      panel down and builds it again — including the strip being dragged.
  //      Moves are coalesced to one per animation frame now, and a plain pan
  //      does not repaint at all: it sets scrollLeft and lets the scroll
  //      handler move the window, the same path the scrollbar takes.
  //   3. positionMiniWindow() was called on the element captured at mousedown,
  //      which a repaint had already replaced — so the window stopped tracking
  //      the pointer mid-drag. Everything below re-reads the live nodes.
  //
  // Zooming by dragging a range is still a zoom, so one crumb is pushed for
  // the whole gesture — "← back" undoes the drag, not the last frame of it.
  function liveScroller() { return document.querySelector('#perf-timeline-area .tl-scroll'); }
  function liveMini() { return document.querySelector('#perf-timeline-area .tl-mini'); }

  function onMiniDown(e, wrap, lenMs) {
    var box = wrap.getBoundingClientRect();
    var grip = e.target.getAttribute && e.target.getAttribute('data-grip');
    var atT = function (clientX) { return Math.max(0, Math.min(lenMs, ((clientX - box.left) / box.width) * lenMs)); };
    var startT = atT(e.clientX);
    var scroller = liveScroller();
    var shownMs = tlT(scroller ? scroller.clientWidth : 700);
    var a0 = tlT(tlScrollLeft), b0 = a0 + shownMs;
    var onWindow = e.target.classList && (e.target.classList.contains('tl-mini-win') || e.target.classList.contains('tl-mini-grip'));
    var mode = grip ? 'grip-' + grip : (onWindow ? 'move' : 'new');
    // How far into the window the grab landed, so the window keeps its
    // position under the pointer instead of jumping to be centred on it.
    var grabOffset = Math.max(0, Math.min(shownMs, startT - a0));
    if (mode !== 'move') tlCrumbs.push({ pps: tlPps, left: tlScrollLeft });

    var pending = null, frame = null;
    function apply() {
      frame = null;
      var t = pending;
      if (t == null) return;
      if (mode === 'move') {
        var sc = liveScroller();
        var maxLeft = Math.max(0, tlX(lenMs) - (sc ? sc.clientWidth : 700));
        tlScrollLeft = Math.max(0, Math.min(maxLeft, tlX(t - grabOffset)));
        if (sc) sc.scrollLeft = tlScrollLeft; // the scroll handler moves the window
        else { var m = liveMini(); if (m) positionMiniWindow(m, lenMs); }
      } else if (mode === 'new') tlZoomTo(Math.min(startT, t), Math.max(startT, t), false);
      else if (mode === 'grip-l') tlZoomTo(Math.min(t, b0 - 20), b0, false);
      else tlZoomTo(a0, Math.max(t, a0 + 20), false);
    }
    function move(ev) {
      pending = atT(ev.clientX);
      if (!frame) frame = requestAnimationFrame(apply);
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (frame) { cancelAnimationFrame(frame); apply(); }
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    if (mode !== 'move') { pending = startT; apply(); }
    e.preventDefault();
  }

  // ---------- the runtime tracks (Phase 2f) ----------
  // Heap and database sit UNDER the requests, on the same axis and the same
  // ruler, because that is the whole point: "the heap stepped 200 MB" is a
  // fact about the runtime, and "it stepped under IVK_SyncObjects" is a
  // finding. The two charts could not be compared at all while they lived in
  // their own card with their own unlabelled x-axis.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgNode(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    return n;
  }

  // What each runtime track says in the gutter beside it — the number in the
  // same place every time, rather than a tooltip you have to hunt for.
  function heapReadout(recording) {
    var pts = poolSeries(recording);
    if (!pts.length) return '—';
    var peak = pts.reduce(function (m, p) { return Math.max(m, p.used); }, 0);
    var committed = pts[pts.length - 1].committed;
    return formatBytes(peak) + (committed ? ' of ' + formatBytes(committed) : '');
  }

  function dbReadout(recording) {
    var pts = connectionbusSeries(recording);
    if (!pts.length) return '—';
    var sel = pts.reduce(function (s, p) { return s + p.select; }, 0);
    var rest = pts.reduce(function (s, p) { return s + p.total - p.select; }, 0);
    return sel + ' select · ' + rest + ' other';
  }

  function renderHeapTrack(recording, lenMs, height) {
    var pts = poolSeries(recording);
    if (pts.length < 2) return null;
    var width = Math.max(1, tlX(lenMs));
    var peak = pts.reduce(function (m, p) { return Math.max(m, p.used); }, 1);
    var ceiling = peak * 1.12;
    var svg = svgNode('svg', { width: width.toFixed(1), height: height, viewBox: '0 0 ' + width.toFixed(1) + ' ' + height, preserveAspectRatio: 'none', class: 'tl-svg' });
    function Y(v) { return height - 2 - (v / ceiling) * (height - 6); }
    var hasPools = pts.some(function (p) { return p.hasPools; });
    var dUsed = 'M' + tlX(pts[0].t).toFixed(1) + ' ' + height;
    var dOld = dUsed;
    pts.forEach(function (p) {
      dUsed += ' L' + tlX(p.t).toFixed(1) + ' ' + Y(p.used).toFixed(1);
      if (hasPools) dOld += ' L' + tlX(p.t).toFixed(1) + ' ' + Y(p.old + p.survivor).toFixed(1);
    });
    var lastX = tlX(pts[pts.length - 1].t).toFixed(1);
    svg.appendChild(svgNode('path', { d: dUsed + ' L' + lastX + ' ' + height + ' Z', fill: 'var(--muted)', 'fill-opacity': '.20' }));
    if (hasPools) svg.appendChild(svgNode('path', { d: dOld + ' L' + lastX + ' ' + height + ' Z', fill: 'var(--muted)', 'fill-opacity': '.36' }));
    // The committed ceiling, but only when it fits the scale this chart is
    // drawn to — a line off the top of the box is worse than no line.
    var committed = pts[pts.length - 1].committed;
    if (committed && committed <= ceiling) {
      svg.appendChild(svgNode('line', {
        x1: 0, x2: width.toFixed(1), y1: Y(committed).toFixed(1), y2: Y(committed).toFixed(1),
        stroke: 'var(--muted)', 'stroke-dasharray': '3 3', 'stroke-width': '1', 'vector-effect': 'non-scaling-stroke'
      }));
    }
    gcMarks(recording).forEach(function (t) {
      svg.appendChild(svgNode('line', {
        x1: tlX(t).toFixed(1), x2: tlX(t).toFixed(1), y1: 0, y2: height,
        stroke: 'var(--accent)', 'stroke-opacity': '.45', 'stroke-dasharray': '2 3',
        'stroke-width': '1', 'vector-effect': 'non-scaling-stroke'
      }));
    });
    return svg;
  }

  function renderDbTrack(recording, lenMs, height) {
    var pts = connectionbusSeries(recording);
    if (!pts.length) return null;
    var width = Math.max(1, tlX(lenMs));
    // One bar per bucket, and a bucket is never narrower than about six
    // pixels: at a wide zoom a bar per 62 ms sample would be sub-pixel noise.
    var bucketMs = Math.max(observedIntervalMs(recording), tlT(6));
    var buckets = {};
    var peak = 1;
    pts.forEach(function (p) {
      var key = Math.floor(p.t / bucketMs);
      var b = buckets[key];
      if (!b) { b = buckets[key] = { t0: key * bucketMs, total: 0 }; CB_OPS.forEach(function (op) { b[op] = 0; }); }
      CB_OPS.forEach(function (op) { b[op] += p[op] || 0; });
      b.total += p.total;
      if (b.total > peak) peak = b.total;
    });
    var svg = svgNode('svg', { width: width.toFixed(1), height: height, viewBox: '0 0 ' + width.toFixed(1) + ' ' + height, preserveAspectRatio: 'none', class: 'tl-svg' });
    Object.keys(buckets).forEach(function (key) {
      var b = buckets[key];
      var x = tlX(b.t0);
      var w = Math.max(1.5, tlX(b.t0 + bucketMs) - x - 1);
      var y = height - 1;
      CB_OPS.forEach(function (op) {
        if (!b[op]) return;
        var h = (b[op] / peak) * (height - 4);
        y -= h;
        svg.appendChild(svgNode('rect', { x: x.toFixed(1), y: y.toFixed(1), width: w.toFixed(1), height: Math.max(0.8, h).toFixed(1), fill: CB_FILL[op] }));
      });
    });
    return svg;
  }

  function renderTlRuler(lenMs) {
    var host = el('div', { class: 'tl-ruler' });
    var step = tickStep(tlPps);
    var end = tlX(lenMs);
    for (var t = 0; t <= lenMs; t += step) {
      var x = tlX(t);
      // The tick line always; its label only when the label fits before the
      // end of the canvas. A label hanging off the last tick makes the canvas
      // wider than the recording, which puts a scrollbar under a timeline
      // that is supposed to be showing everything.
      host.appendChild(el('div', { class: 'tl-tick', style: 'left:' + x.toFixed(1) + 'px' },
        x + TICK_LABEL_PX <= end ? [el('span', { text: '+' + formatMs(t) })] : []));
    }
    return host;
  }
  var TICK_LABEL_PX = 52;

  // Crosshair and drag-selection, inside the canvas so they share its
  // coordinate space and need no correction when it is scrolled.
  function renderTlOverlay(lenMs) {
    var ov = el('div', { class: 'tl-ov' });
    if (tlHover != null) {
      ov.appendChild(el('div', { class: 'tl-xhair', style: 'left:' + tlX(tlHover).toFixed(1) + 'px' }, [
        el('span', { class: 'tl-xhair-t', text: '+' + formatMs(tlHover) })
      ]));
    }
    if (tlSel) {
      var a = Math.min(tlSel.a, tlSel.b), b = Math.max(tlSel.a, tlSel.b);
      var xa = tlX(a), xb = tlX(b);
      ov.appendChild(el('div', { class: 'tl-selbox', style: 'left:' + xa.toFixed(1) + 'px;width:' + Math.max(1, xb - xa).toFixed(1) + 'px' }));
      if (xb - xa > 60) {
        ov.appendChild(el('button', {
          class: 'tl-selbtn', style: 'left:' + ((xa + xb) / 2).toFixed(1) + 'px',
          text: 'Stretch to ' + formatMs(b - a),
          onclick: function (e) { e.stopPropagation(); tlZoomTo(a, b, true); }
        }));
      }
    }
    return ov;
  }

  function wireTimeline(scroller, canvas, lenMs) {
    var mini = scroller.parentNode.parentNode.querySelector('.tl-mini');
    var ticking = false;
    scroller.addEventListener('scroll', function () {
      tlScrollLeft = scroller.scrollLeft;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if (mini) positionMiniWindow(mini, lenMs);
        var crumb = document.querySelector('#perf-timeline-area .tl-crumb');
        if (crumb) crumb.textContent = tlWindowLabel(lenMs);
        stickLabels(scroller, canvas);
      });
    });

    // Ctrl/\u2318 + wheel stretches around the pointer; a plain wheel is left alone
    // so the page still scrolls normally over the tracks.
    scroller.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      tlSetPps(tlPps * (e.deltaY > 0 ? 0.8 : 1.25), tlT(e.clientX - canvas.getBoundingClientRect().left));
    }, { passive: false });

    var drag = null;
    canvas.addEventListener('mousedown', function (e) {
      if (e.target.closest('.tl-selbtn')) return;
      canvas.focus();
      drag = { t0: tlT(e.clientX - canvas.getBoundingClientRect().left), x: e.clientX, moved: false };
    });
    canvas.addEventListener('mousemove', function (e) {
      var t = tlT(e.clientX - canvas.getBoundingClientRect().left);
      if (drag && Math.abs(e.clientX - drag.x) > 4) { drag.moved = true; tlSel = { a: drag.t0, b: t }; }
      tlHover = t;
      var ov = canvas.querySelector('.tl-ov');
      if (!ov) return;
      var fresh = renderTlOverlay(lenMs);
      canvas.replaceChild(fresh, ov);
    });
    canvas.addEventListener('mouseleave', function () {
      tlHover = null;
      var ov = canvas.querySelector('.tl-ov');
      if (ov) canvas.replaceChild(renderTlOverlay(lenMs), ov);
    });
    window.addEventListener('mouseup', function () {
      if (drag && !drag.moved) { tlSel = null; }
      drag = null;
    });

    canvas.addEventListener('keydown', function (e) {
      var k = (e.key || '').toLowerCase();
      var anchor = tlHover != null ? tlHover : null;
      if (k === 'w') { tlSetPps(tlPps * 1.4, anchor); e.preventDefault(); }
      else if (k === 's') { tlSetPps(tlPps / 1.4, anchor); e.preventDefault(); }
      else if (k === 'a') { scroller.scrollLeft -= scroller.clientWidth * 0.25; e.preventDefault(); }
      else if (k === 'd') { scroller.scrollLeft += scroller.clientWidth * 0.25; e.preventDefault(); }
      else if (e.key === 'Escape') { tlBack(); e.preventDefault(); }
      else if (e.key === 'Enter' && tlSel) { tlZoomTo(Math.min(tlSel.a, tlSel.b), Math.max(tlSel.a, tlSel.b), true); e.preventDefault(); }
    });
  }

  // Everything this view remembers, forgotten. Called when the project scope
  // changes and when a different recording is opened — a picked span index
  // from one recording names nothing in another, and a zoom fitted to a 57 s
  // recording is meaningless on a 7 s one.
  function reset() {
    selectedRequestId = null;
    pickedSpanIndex = null;
    tlPps = null;
    tlScrollLeft = 0;
    tlCrumbs = [];
    tlSel = null;
    tlHover = null;
  }

  window.MxTimeline = {
    init: init,
    render: renderTimeline,
    reset: reset,
    tickStep: tickStep
  };
})();
