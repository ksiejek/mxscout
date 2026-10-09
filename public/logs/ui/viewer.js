/* MxScout — Log analysis: the Log Viewer.
 *
 * Tail, search and filter a Mendix log: levels that behave like a Grafana legend, search that either
 * filters or highlights, a time range, a "records over time" strip you can drag a window off, line
 * bookmarks that survive every filter, and four tabs over the same log (stream, Insights, Slow queries,
 * and — inside a project — what in the model it names).
 *
 * The behaviour is MxDevSwissTool's Log Viewer (Mikołaj / RealMecowhy, MIT) and the numbers come from its
 * engine (../engine/insights.js); this file is the screen, built the MxScout way. The analysis tabs are in
 * viewer-analysis.js, which also holds the state this file and those tabs share (MxLogs.lv).
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;
  var S = L.lv;

  var LEVELS = S.LEVEL_ORDER;
  var LEVEL_CLS = { TRACE: 'trace', DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error', CRITICAL: 'critical' };

  // ---------- state that only the viewer touches ----------
  var multiFile = false;                 // more than one distinct file loaded — gates the per-row file badge
  var fileBadgeCache = new Map();
  var bookmarks = new Map();             // file#line → a snapshot the bookmark list shows, so it survives re-renders
  var searchMode = 'filter';             // 'filter' hides non-matches; 'highlight' keeps every line and marks them
  var hitIndices = [];
  var hitCursor = 0;
  var undoGen = 0;

  // ---------- the pieces of the screen the code below reaches back to ----------
  var ui = {};

  function fileBadgeLabel(file) {
    var key = file || '';
    if (fileBadgeCache.has(key)) return fileBadgeCache.get(key);
    var base = key.replace(/\.[^./\\]+$/, '').split(/[\\/]/).pop() || key;
    var label = base.length > 14 ? base.slice(0, 13) + '…' : base;
    fileBadgeCache.set(key, label);
    return label;
  }
  function bookmarkKey(e) { return (e.file || '') + '#' + e.line; }

  // A time field reports "HH:MM" when the seconds are zero, and the bounds are compared as text against the
  // line's HH:MM:SS — where "10:00:00" > "10:00" would drop the first second of an upper bound. Padded here
  // so both sides agree.
  function timeBound(v) {
    v = (v || '').trim();
    return /^\d{2}:\d{2}$/.test(v) ? v + ':00' : v;
  }

  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Text with every hit on `search` wrapped in a <mark>. The search filter matches e.raw — the whole line:
  // timestamp, level, node and every stack frame — so the highlighter has to cover the same ground; marking
  // only the message made a search for a node name or a stack frame look like "search doesn't highlight"
  // when the row was a genuine hit. Returns nodes: no markup is built from the text.
  function highlight(text, search) {
    if (!search) return [text];
    var re = new RegExp(escRegex(search), 'gi');
    var out = [], pos = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (m.index > pos) out.push(text.slice(pos, m.index));
      out.push(h('mark', { class: 'lg-hl', text: m[0] }));
      pos = m.index + m[0].length;
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  }
  function hasHit(text, search) { return !!search && text.toLowerCase().indexOf(search.toLowerCase()) !== -1; }

  // ===================================================================================================
  // FILTERS
  // ===================================================================================================

  function anyFilterActive() {
    if (S.sigKey || S.mechanisms) return true;
    if (chart.range) return true;
    if (S.levels.size !== LEVELS.length) return true;
    return [ui.search, ui.from, ui.to, ui.node, ui.date].some(function (el) { return el && el.value.trim() !== ''; });
  }

  function applyFilters() {
    var search = ui.search.value.toLowerCase();
    var from = timeBound(ui.from.value);
    var to = timeBound(ui.to.value);
    var node = ui.node.value.toLowerCase();
    var date = ui.date.value;
    var narrowBySearch = search && searchMode === 'filter';
    S.filtered = S.all.filter(function (e) {
      if (S.sigKey) { if (window.logGetSignature(e).key !== S.sigKey) return false; }
      if (S.mechanisms && !S.mechanisms.has(window.logMechanismOf(e))) return false;
      if (!S.levels.has(e.level)) return false;
      if (chart.range) {
        if (typeof e.ms !== 'number' || isNaN(e.ms)) return false;
        if (e.ms < chart.range.from || e.ms > chart.range.to) return false;
      }
      if (narrowBySearch && !e.raw.toLowerCase().includes(search)) return false;
      if (node && !e.node.toLowerCase().includes(node)) return false;
      if (date && !e.ts.includes(date)) return false;
      if (from || to) {
        var m = e.ts.match(/(\d{2}:\d{2}:\d{2})/);
        if (m) { var t = m[1]; if (from && t < from) return false; if (to && t > to) return false; }
      }
      return true;
    });
    collectHits(search);
    renderStream();
    updateStats();
    renderChart();
    ui.clearFilters.hidden = !anyFilterActive();
  }
  S.applyFilters = applyFilters;

  // Grafana's legend convention, which Mendix developers already know: a click shows only that level,
  // Shift/Ctrl/Cmd+click adds or removes it, and clicking the only active level brings every level back.
  // A plain toggle made the first instinct — "show me the errors" — hide them instead, with the stream
  // looking unchanged.
  function toggleLevel(level, ev) {
    var additive = !!(ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey));
    if (additive) {
      if (S.levels.has(level)) S.levels.delete(level); else S.levels.add(level);
    } else if (S.levels.size === 1 && S.levels.has(level)) {
      S.levels = new Set(LEVELS);
    } else {
      S.levels = new Set([level]);
    }
    syncLevelChips();
    applyFilters();
  }
  function syncLevelChips() {
    LEVELS.forEach(function (l) {
      var on = S.levels.has(l);
      ui.levelBtns[l].classList.toggle('is-on', on);
      ui.levelBtns[l].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function toggleAllLevels(val) {
    LEVELS.forEach(function (l) { if (val) S.levels.add(l); else S.levels.delete(l); });
    syncLevelChips();
    applyFilters();
  }

  // 'filter' (the default) drops the lines that do not match, so everything on screen is a hit. 'highlight'
  // keeps every line, marks the hits and steps between them — which is what you want when the question is
  // "what happened around this error", not "show me only this error".
  function setSearchMode(mode) {
    if (mode !== 'filter' && mode !== 'highlight') return;
    searchMode = mode;
    ui.mode.set(mode);
    hitCursor = 0;
    applyFilters();
  }

  // The Insights cards and the row context menu both mean "narrow the stream to this". They drive the same
  // search box, so under highlight mode they would set the term and narrow nothing — the action would look
  // broken. Carrying a term forces filter mode; without one the reader's chosen mode is left alone.
  function applyProgrammaticSearch() {
    if (ui.search.value.trim() && searchMode !== 'filter') setSearchMode('filter');
    else applyFilters();
  }

  function resetStreamFilters() {
    S.sigKey = null; S.mechanisms = null; showWindow(null);
    ui.banner.hidden = true;
    [ui.search, ui.from, ui.to, ui.node, ui.date].forEach(function (el) { el.value = ''; });
    toggleAllLevels(true);
  }

  function showFilterBanner(label, name) {
    ui.bannerLabel.textContent = label;
    ui.bannerName.textContent = name;
    ui.banner.hidden = false;
  }
  S.showFilterBanner = showFilterBanner;

  function clearSignatureFilter() {
    S.sigKey = null; S.mechanisms = null;
    ui.banner.hidden = true;
    applyFilters();
  }
  S.clearSignatureFilter = clearSignatureFilter;

  // Card/item click → the Log Stream with matching filters applied. `mech` (comma-separated decoder rule ids)
  // comes only from the mechanism card; every other card clears a mechanism filter left over from an
  // earlier click.
  function filterInsight(node, levels, search, mech) {
    if (mech) {
      var ids = mech.split(',');
      S.sigKey = null;
      S.mechanisms = new Set(ids);
      showFilterBanner('Filtering by mechanism:', ids.length === 1
        ? (ids[0] === window.LOG_MECH_UNRECOGNIZED ? 'not recognised by any error rule' : (window.logMechTitles.get(ids[0]) || ids[0]))
        : 'all ' + ids.length + ' on the Error mechanisms card');
    } else if (S.mechanisms) {
      S.mechanisms = null;
      if (!S.sigKey) ui.banner.hidden = true;
    }
    var set = (levels || '').split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean)
      .map(function (l) { return l === 'WARNING' ? 'WARN' : l; });
    LEVELS.forEach(function (l) {
      if (set.length === 0 || set.indexOf(l) !== -1) S.levels.add(l); else S.levels.delete(l);
    });
    syncLevelChips();
    ui.node.value = node || '';
    ui.search.value = search || '';
    showTab('stream');
    applyProgrammaticSearch();
  }
  S.filterInsight = filterInsight;
  S.filterByCorrId = function (id) { closeContextMenu(); ui.search.value = id; applyProgrammaticSearch(); };
  S.showStream = function () { showTab('stream'); };

  // ===================================================================================================
  // THE STREAM
  // ===================================================================================================
  var BATCH = 1000;
  var scrolled = { loaded: 0, observer: null };

  function updateStats() {
    var e = 0, w = 0, i = 0;
    for (var k = 0; k < S.filtered.length; k++) {
      var lvl = S.filtered[k].level;
      if (lvl === 'ERROR' || lvl === 'CRITICAL') e++;
      else if (lvl === 'WARN') w++;
      else if (lvl === 'INFO') i++;
    }
    ui.stats.set('total', L.fmtInt(S.all.length));
    ui.stats.set('shown', L.fmtInt(S.filtered.length));
    ui.stats.set('errors', L.fmtInt(e));
    ui.stats.set('warnings', L.fmtInt(w));
    ui.stats.set('info', L.fmtInt(i));
  }

  // Highlight mode takes the search out of the filtered set, which is also what Export Filtered and the
  // counts in the stats bar read. That is a real change of meaning, so it is stated on screen rather than
  // left for the reader to discover from an export that is larger than expected.
  function updateScopeNote() {
    var searching = ui.search.value.trim() !== '';
    if (searchMode !== 'highlight' || !searching || !S.all.length) { ui.scopeNote.hidden = true; return; }
    ui.scopeNote.hidden = false;
    L.replace(ui.scopeNote, ['Highlight mode keeps every line, so ', h('strong', { text: 'Export filtered' }),
      ' and the counts above cover all ' + L.fmtInt(S.filtered.length) + ' line' + (S.filtered.length === 1 ? '' : 's') + ' — not just the ' +
      L.fmtInt(hitIndices.length) + ' match' + (hitIndices.length === 1 ? '' : 'es') + '. Switch to ', h('strong', { text: 'Filter' }), ' to narrow them.']);
  }

  // Indices into the filtered set of the lines that match the search. Only populated in highlight mode —
  // under 'filter' every entry in the list is a hit and a "1 / all" counter would say nothing.
  function collectHits(search) {
    hitIndices = [];
    if (search && searchMode === 'highlight') {
      for (var i = 0; i < S.filtered.length; i++) if (S.filtered[i].raw.toLowerCase().includes(search)) hitIndices.push(i);
    }
    if (hitCursor >= hitIndices.length) hitCursor = 0;
    updateHitNav();
    updateScopeNote();
  }
  function updateHitNav() {
    var searching = ui.search.value.trim() !== '';
    // Shown with a zero count too: in highlight mode nothing is removed from the stream, so a search that
    // matches nothing looks exactly like no search at all unless the counter says "0 / 0".
    ui.hitNav.hidden = !(searchMode === 'highlight' && searching);
    ui.hitNav.classList.toggle('is-empty', hitIndices.length === 0);
    ui.hitCount.textContent = hitIndices.length ? (hitCursor + 1) + ' / ' + hitIndices.length : '0 / 0';
  }

  // Pages the list far enough to put entry `idx` in the DOM and returns its row.
  function revealRow(idx) {
    var guard = 0;
    while (scrolled.loaded <= idx && scrolled.loaded < S.filtered.length && guard++ < 100000) loadMore();
    return ui.list.children[idx];
  }

  // Steps to the next/previous match and centres it. Instant rather than smooth: holding the arrow walks
  // through hits, and queued smooth scrolls interrupt one another so you lose track of where you landed.
  function gotoHit(delta) {
    if (!hitIndices.length) return;
    hitCursor = (hitCursor + delta + hitIndices.length) % hitIndices.length;
    var row = revealRow(hitIndices[hitCursor]);
    if (row) {
      var prev = ui.list.querySelector('.is-hit-current');
      if (prev) prev.classList.remove('is-hit-current');
      row.classList.add('is-hit-current');
      row.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
    updateHitNav();
  }

  function buildRow(e, idx, search, needle, curHit) {
    var parts = e.msg.split('\n');
    var mainLine = parts[0];
    var stackLines = parts.slice(1);
    var key = bookmarkKey(e);
    var isBm = bookmarks.has(key);

    var star = h('button', {
      class: 'lg-bm' + (isBm ? ' is-on' : ''), type: 'button', 'data-bmkey': key, text: isBm ? '★' : '☆',
      title: isBm ? 'Remove bookmark' : 'Bookmark this line', 'aria-label': 'Bookmark this line',
      onclick: function (ev) { ev.stopPropagation(); toggleBookmark(star, e); }
    });

    var row = h('div', {
      class: 'lg-row lg-row-' + LEVEL_CLS[e.level] + (isBm ? ' is-bookmarked' : '') +
        (needle && !hasHit(e.raw, needle) ? ' is-dimmed' : '') + (idx === curHit ? ' is-hit-current' : ''),
      oncontextmenu: function (ev) { showContextMenu(ev, e); }
    }, [
      star,
      h('span', { class: 'lg-row-num', text: String(e.line) }),
      multiFile ? h('span', { class: 'lg-row-file', title: e.file || '', text: fileBadgeLabel(e.file) }) : null,
      h('span', { class: 'lg-row-ts' }, highlight(e.ts, search)),
      S.badge(e.level),
      h('span', { class: 'lg-row-node', title: e.node }, highlight(e.node, search)),
      h('span', { class: 'lg-row-msg' }, highlight(mainLine, search))
    ]);

    if (stackLines.length) {
      // A hit inside a stack frame is a hit the filter already honoured, but the stack is collapsed by
      // default — so the toggle says how many frames matched. Auto-expanding instead would unfold hundreds of
      // stacks on a common search term.
      var hits = search ? stackLines.filter(function (l) { return hasHit(l, search); }).length : 0;
      var label = stackLines.length + ' frame' + (stackLines.length > 1 ? 's' : '') + (hits ? ' · ' + hits + ' matching' : '');
      var body = h('pre', { class: 'lg-stack-body', hidden: true });
      stackLines.forEach(function (l, i) { if (i) L.add(body, '\n'); L.add(body, highlight(l, search)); });
      var toggle = h('button', { class: 'lg-stack-toggle', type: 'button', text: '▶ Show ' + label });
      toggle.addEventListener('click', function () {
        body.hidden = !body.hidden;
        toggle.textContent = (body.hidden ? '▶' : '▼') + ' Show ' + label;
      });
      row.appendChild(h('div', { class: 'lg-stack' }, [toggle, body]));
    }
    // A warning or an error that names something in the open project's model says so under the line — the
    // quiet levels do not, or a TRACE log would be one long strip of chips.
    if (L.model && (e.level === 'WARN' || e.level === 'ERROR' || e.level === 'CRITICAL')) {
      var links = W.modelLinks(e.msg, function (o) { return L.entryDraft(e, o); });
      if (links) row.appendChild(links);
    }
    return row;
  }

  function loadMore() {
    if (scrolled.loaded >= S.filtered.length) { updateSentinel(); return; }
    var search = ui.search.value;
    var needle = searchMode === 'highlight' && search ? search.toLowerCase() : '';
    var curHit = hitIndices.length ? hitIndices[hitCursor] : -1;
    var start = scrolled.loaded;
    var end = Math.min(S.filtered.length, start + BATCH);
    var frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) frag.appendChild(buildRow(S.filtered[i], i, search, needle, curHit));
    ui.list.appendChild(frag);
    scrolled.loaded = end;
    updateSentinel();
  }
  function updateSentinel() {
    ui.sentinel.textContent = scrolled.loaded >= S.filtered.length
      ? 'Showing all ' + L.fmtInt(S.filtered.length) + ' results'
      : 'Showing ' + L.fmtInt(scrolled.loaded) + ' of ' + L.fmtInt(S.filtered.length) + ' results. Scroll down to load more.';
  }

  function renderStream() {
    L.clear(ui.list);
    scrolled.loaded = 0;
    ui.stream.scrollTop = 0;
    loadMore();
  }

  function scrollStream(pos) { ui.stream.scrollTop = pos === 'top' ? 0 : ui.stream.scrollHeight; }

  // ===================================================================================================
  // THE TIMELINE — records over time, above the stream
  // ===================================================================================================
  // Answers "when did this log get loud", which nothing else here does. Two lanes, not one stack: INFO
  // outnumbers ERROR by two or three orders of magnitude in a healthy runtime, so stacking them hides exactly
  // the bars worth seeing. Background is the whole log, foreground the current filter — drawing only the
  // filtered set would throw away the context the chart exists for.
  //
  // A window dragged off the chart is also where the chart goes: the axis becomes that window, so the hour
  // you picked fills the strip instead of sitting in a sliver of it, and a second drag narrows it further.
  // It used to filter the stream and keep the whole log on the axis — the chosen window shrank to a few bars
  // in an empty strip, and the next drag, measured against the whole log again, widened it instead.
  var TL = { H_VOL: 42, H_SEV: 15, Y_SEV: 47, W: 1000, SEV_MIN: 3 };
  var chart = { full: null, axis: null, bg: null, fg: null, buckets: 120, range: null, wired: false, bandRaf: 0 };

  // The axis the chart is drawn on: the whole log, or the window dragged off it.
  function showWindow(range) {
    chart.range = range;
    var f = chart.full;
    chart.axis = !f || !range ? f
      : { t0: range.from, t1: range.to, span: Math.max(1, range.to - range.from), epoch: f.epoch, timed: f.timed, skipped: f.skipped };
    chart.bg = chart.axis ? bucketize(S.all) : null;
  }

  function buildChart() {
    chart.full = null;
    chart.axis = null;
    chart.bg = null;
    var t0 = Infinity, t1 = -Infinity, timed = 0;
    for (var i = 0; i < S.all.length; i++) {
      var ms = S.all[i].ms;
      if (typeof ms !== 'number' || isNaN(ms)) continue;
      timed++;
      if (ms < t0) t0 = ms;
      if (ms > t1) t1 = ms;
    }
    // Under two timestamped lines, or a log that all happened in the same millisecond, there is no axis to
    // draw — the chart hides rather than render a single meaningless bar.
    if (timed < 2 || t1 <= t0) return;
    chart.full = {
      t0: t0, t1: t1, span: t1 - t0,
      // Time-only logs carry ms since midnight plus a day carry, so they stay far below any real epoch
      // value. Anything larger came from a date.
      epoch: t0 > 86400000 * 400, timed: timed, skipped: S.all.length - timed
    };
    showWindow(null);
  }

  // Lines outside the axis are left out, not piled into the first or last bar: zoomed to a window, the
  // rest of the log is not in view, and counting it at the edges would draw two walls that are not there.
  function bucketize(entries) {
    var n = chart.buckets, a = chart.axis;
    var vol = new Array(n).fill(0), warn = new Array(n).fill(0), err = new Array(n).fill(0);
    if (!a) return { vol: vol, warn: warn, err: err, max: 0, sevMax: 0 };
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (typeof e.ms !== 'number' || isNaN(e.ms) || e.ms < a.t0 || e.ms > a.t1) continue;
      var b = Math.floor(((e.ms - a.t0) / a.span) * n);
      if (b >= n) b = n - 1;
      vol[b]++;
      if (e.level === 'ERROR' || e.level === 'CRITICAL') err[b]++;
      else if (e.level === 'WARN') warn[b]++;
    }
    var max = 0, sevMax = 0;
    for (var k = 0; k < n; k++) {
      if (vol[k] > max) max = vol[k];
      var s = warn[k] + err[k];
      if (s > sevMax) sevMax = s;
    }
    return { vol: vol, warn: warn, err: err, max: max, sevMax: sevMax };
  }

  // Bar heights for one bucket of the severity lane, as [warn, error]. Proportional to the busiest bucket,
  // then lifted to SEV_MIN as a pair when the two together would otherwise round away to nothing — scaling
  // WARN/ERROR strictly to the busiest bucket reproduces, inside the lane, the very problem the lane exists
  // to avoid: against a burst holding 120 of them, a bucket holding one renders 0.12 of 15 units and
  // disappears. Lifting the pair rather than each bar keeps the warn-to-error split inside the bucket intact.
  function sevHeights(warn, err, sevMax) {
    if (warn + err === 0) return [0, 0];
    var hW = (warn / sevMax) * TL.H_SEV;
    var hE = (err / sevMax) * TL.H_SEV;
    var total = hW + hE;
    if (total < TL.SEV_MIN) { var k = TL.SEV_MIN / total; hW *= k; hE *= k; }
    return [hW, hE];
  }

  function timeLabel(ms, withDate) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    if (chart.axis && chart.axis.epoch) {
      // mtTsToMs pins the log's wall clock to UTC so the number does not move with the viewer's timezone.
      // Reading it back with local getters would print an axis offset from the timestamps in the rows right
      // below it, so read UTC.
      var d = new Date(ms);
      var t = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
      return withDate ? p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + t : t;
    }
    var tt = ((ms % 86400000) + 86400000) % 86400000, s = Math.floor(tt / 1000);
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60);
  }

  // The time range typed into the From/To fields compares HH:MM:SS as text, which is date-blind on purpose —
  // it answers "every day between 09:00 and 10:00". A range dragged off the chart means one specific window,
  // so it filters on e.ms instead of borrowing those fields, which on a multi-day log would silently select
  // that clock hour on every day in it.
  function setChartRange(from, to) {
    showWindow({ from: Math.min(from, to), to: Math.max(from, to) });
    applyFilters();
  }
  function clearChartRange() { showWindow(null); applyFilters(); }

  function rect(x, y, w, hgt, cls) {
    return L.svg('rect', { x: x, y: y.toFixed(2), width: w, height: hgt.toFixed(2), class: cls });
  }

  function renderChart() {
    var tl = ui.tl;
    if (!chart.axis || !S.all.length) { tl.wrap.hidden = true; return; }
    tl.wrap.hidden = false;

    // Kept so the hover tooltip can read it: bucketizing per pointermove would walk the whole filtered log
    // on every pixel of mouse travel.
    var fg = bucketize(S.filtered);
    chart.fg = fg;
    // Both lanes scale to the whole log, never to the filtered subset, so filtering visibly shrinks the bars
    // instead of silently rescaling the axis under them.
    var volMax = Math.max(1, chart.bg.max);
    var sevMax = Math.max(1, chart.bg.sevMax);
    var n = chart.buckets, w = TL.W / n, gap = w > 3 ? 0.9 : 0.25, bw = (w - gap).toFixed(2);

    L.clear(tl.gVol); L.clear(tl.gSev);
    for (var i = 0; i < n; i++) {
      var x = (i * w).toFixed(2);
      var hAll = (chart.bg.vol[i] / volMax) * TL.H_VOL;
      var hFil = (fg.vol[i] / volMax) * TL.H_VOL;
      if (hAll > 0) tl.gVol.appendChild(rect(x, TL.H_VOL - hAll, bw, hAll, 'lg-tl-all'));
      if (hFil > 0) tl.gVol.appendChild(rect(x, TL.H_VOL - hFil, bw, hFil, 'lg-tl-cur'));
      // The severity lane gets the same background-and-foreground treatment as the volume lane. Without the
      // background silhouette, narrowing the view made every warning and error outside it vanish from the
      // chart while the volume bars stayed — so the chart implied the rest of the run was clean. The
      // silhouette is one neutral bar for warnings and errors together; the coloured foreground gives the
      // breakdown for what is actually in view.
      var base = TL.Y_SEV + TL.H_SEV;
      var allSev = sevHeights(chart.bg.warn[i], chart.bg.err[i], sevMax);
      var hAllSev = allSev[0] + allSev[1];
      if (hAllSev > 0) tl.gSev.appendChild(rect(x, base - hAllSev, bw, hAllSev, 'lg-tl-sev-all'));
      var cur = sevHeights(fg.warn[i], fg.err[i], sevMax);
      if (cur[0] > 0) tl.gSev.appendChild(rect(x, base - cur[0], bw, cur[0], 'lg-tl-warn'));
      if (cur[1] > 0) tl.gSev.appendChild(rect(x, base - cur[0] - cur[1], bw, cur[1], 'lg-tl-err'));
    }

    var multiDay = chart.axis.span > 86400000;
    tl.a0.textContent = timeLabel(chart.axis.t0, multiDay);
    tl.a1.textContent = timeLabel(chart.axis.t0 + chart.axis.span / 2, multiDay);
    tl.a2.textContent = timeLabel(chart.axis.t1, multiDay);

    if (chart.range) {
      tl.range.textContent = timeLabel(chart.range.from, multiDay) + ' → ' + timeLabel(chart.range.to, multiDay);
      tl.clear.hidden = false;
    } else { tl.range.textContent = ''; tl.clear.hidden = true; }

    // Lines the chart cannot place are disclosed rather than dropped in silence — a chart that quietly
    // under-reports is worse than no chart.
    if (chart.axis.skipped > 0) {
      tl.note.hidden = false;
      tl.note.textContent = L.fmtInt(chart.axis.skipped) + ' line' + (chart.axis.skipped === 1 ? ' has' : 's have') + ' no readable timestamp and ' + (chart.axis.skipped === 1 ? 'is' : 'are') + ' not on this chart.';
    } else tl.note.hidden = true;

    renderChartBookmarks();
    wireChart();
    // Deferred a frame on purpose: on the first load the stream is unhidden only AFTER filters have run, so
    // measuring here would measure rows that are still hidden and put the band nowhere.
    scheduleBand();
  }

  // Pinned lines as ticks along the top of the timeline, so the moments you marked during an incident show
  // their spacing at a glance — two bookmarks four seconds apart read very differently from two an hour apart.
  function renderChartBookmarks() {
    var g = ui.tl.gBm;
    L.clear(g);
    if (!chart.axis || bookmarks.size === 0) return;
    var a = chart.axis;
    bookmarks.forEach(function (b) {
      if (typeof b.ms !== 'number' || isNaN(b.ms)) return;
      var x = ((b.ms - a.t0) / a.span) * TL.W;
      if (x < 0 || x > TL.W) return;
      g.appendChild(L.svg('rect', { x: Math.max(0, x - 1).toFixed(2), y: 0, width: 2.5, height: 5, class: 'lg-tl-bm' }));
    });
  }

  // The scroll position is read off the first and last row actually on screen, not from a scrollTop
  // percentage: rows vary in height (stack traces, wrapping) and the list pages in a batch at a time, so a
  // proportional playhead would drift and then lie outright. Binary search finds the first visible row
  // without measuring every loaded one.
  function updateBand() {
    var band = ui.tl.band;
    var kids = ui.list.children;
    if (!chart.axis || !kids.length || ui.stream.offsetParent === null) { band.hidden = true; return; }
    var cRect = ui.stream.getBoundingClientRect();
    var lo = 0, hi = kids.length - 1, first = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (kids[mid].getBoundingClientRect().bottom >= cRect.top) { first = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (first < 0) { band.hidden = true; return; }
    var msFrom = null, msTo = null;
    for (var i = first; i < kids.length; i++) {
      if (kids[i].getBoundingClientRect().top > cRect.bottom) break;
      var e = S.filtered[i];
      if (!e || typeof e.ms !== 'number' || isNaN(e.ms)) continue;
      if (msFrom === null) msFrom = e.ms;
      msTo = e.ms;
    }
    if (msFrom === null) { band.hidden = true; return; }
    var a = chart.axis;
    var l = ((msFrom - a.t0) / a.span) * 100;
    var r = ((msTo - a.t0) / a.span) * 100;
    band.hidden = false;
    band.style.left = Math.max(0, Math.min(100, l)) + '%';
    band.style.width = Math.max(0.4, Math.min(100 - l, r - l)) + '%';
  }
  function scheduleBand() {
    if (chart.bandRaf) return;
    chart.bandRaf = requestAnimationFrame(function () { chart.bandRaf = 0; updateBand(); });
  }

  function msAt(clientX, box) {
    var r = box.getBoundingClientRect();
    var f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return chart.axis.t0 + f * chart.axis.span;
  }

  function flashRow(row) {
    row.scrollIntoView({ block: 'center', behavior: 'auto' });
    row.classList.add('is-flash');
    setTimeout(function () { row.classList.remove('is-flash'); }, 1500);
  }

  // Drag across the strip to filter to that window; click to jump the stream to that moment; hover for the
  // counts in a slice.
  function wireChart() {
    if (chart.wired) return;
    chart.wired = true;
    var box = ui.tl.box, dragEl = ui.tl.drag, tip = ui.tl.tip;
    var dragging = false, x0 = 0;

    box.addEventListener('pointerdown', function (ev) {
      if (!chart.axis) return;
      dragging = true;
      x0 = ev.clientX;
      // Keeps the drag when the pointer leaves the strip; a pointer the browser does not track (one made
      // up by a script) cannot be captured, and the drag works without it.
      try { box.setPointerCapture(ev.pointerId); } catch (e) { /* not a tracked pointer */ }
      var r = box.getBoundingClientRect();
      dragEl.hidden = false;
      dragEl.style.left = (x0 - r.left) + 'px';
      dragEl.style.width = '0px';
      tip.hidden = true;
    });

    box.addEventListener('pointermove', function (ev) {
      if (!chart.axis) return;
      var r = box.getBoundingClientRect();
      if (dragging) {
        var a = Math.min(x0, ev.clientX) - r.left, b = Math.max(x0, ev.clientX) - r.left;
        dragEl.style.left = a + 'px';
        dragEl.style.width = (b - a) + 'px';
        return;
      }
      var n = chart.buckets;
      var bIdx = Math.floor(((msAt(ev.clientX, box) - chart.axis.t0) / chart.axis.span) * n);
      if (bIdx < 0) bIdx = 0; else if (bIdx >= n) bIdx = n - 1;
      var fg = chart.fg;
      if (!fg || !chart.bg) return;
      var bucketMs = chart.axis.span / n;
      L.clear(tip);
      tip.appendChild(h('strong', { text: timeLabel(chart.axis.t0 + bIdx * bucketMs, chart.axis.span > 86400000) }));
      tip.appendChild(h('div', { text: L.fmtInt(fg.vol[bIdx]) + ' shown · ' + L.fmtInt(chart.bg.vol[bIdx]) + ' total' }));
      if (fg.warn[bIdx]) tip.appendChild(h('div', { class: 'lg-tone-warn', text: fg.warn[bIdx] + ' WARN' }));
      if (fg.err[bIdx]) tip.appendChild(h('div', { class: 'lg-tone-error', text: fg.err[bIdx] + ' ERROR' }));
      tip.hidden = false;
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(0, ev.clientX - r.left + 14)) + 'px';
    });

    box.addEventListener('pointerleave', function () { tip.hidden = true; });

    box.addEventListener('pointerup', function (ev) {
      if (!dragging || !chart.axis) return;
      dragging = false;
      dragEl.hidden = true;
      // A drag narrower than a few pixels is a click, not a selection — jump to that moment in the stream
      // instead of filtering the log down to nothing.
      if (Math.abs(ev.clientX - x0) < 5) {
        var t = msAt(ev.clientX, box);
        var idx = -1;
        for (var i = 0; i < S.filtered.length; i++) {
          var e = S.filtered[i];
          if (typeof e.ms === 'number' && !isNaN(e.ms) && e.ms >= t) { idx = i; break; }
        }
        if (idx < 0) idx = S.filtered.length - 1;
        var row = revealRow(idx);
        if (row) flashRow(row);
        return;
      }
      setChartRange(msAt(x0, box), msAt(ev.clientX, box));
    });

    ui.stream.addEventListener('scroll', scheduleBand, { passive: true });
    window.addEventListener('resize', scheduleBand);
  }

  // ===================================================================================================
  // BOOKMARKS — pin lines and jump between them across filters
  // ===================================================================================================
  // Bookmarks live in a map (file#line → snapshot) so they persist through every filter and level change.
  // The star on each row toggles membership; the bar lists them chronologically and jumps back to the stream
  // — clearing filters first if the target line is currently filtered out.
  function toggleBookmark(star, e) {
    var key = bookmarkKey(e);
    if (bookmarks.has(key)) {
      bookmarks.delete(key);
      setStar(star, false);
    } else {
      // ms rides along so the timeline can tick the bookmark without re-scanning the log on every redraw.
      bookmarks.set(key, { line: e.line, file: e.file, ts: e.ts, ms: e.ms, level: e.level, node: e.node, msg: e.msg.split('\n')[0] });
      setStar(star, true);
    }
    updateBookmarkBar();
  }
  function setStar(star, on) {
    if (!star) return;
    star.classList.toggle('is-on', on);
    star.textContent = on ? '★' : '☆';
    star.title = on ? 'Remove bookmark' : 'Bookmark this line';
    var row = star.closest('.lg-row');
    if (row) row.classList.toggle('is-bookmarked', on);
  }
  function removeBookmark(key) {
    bookmarks.delete(key);
    ui.list.querySelectorAll('.lg-bm').forEach(function (el) { if (el.getAttribute('data-bmkey') === key) setStar(el, false); });
    updateBookmarkBar();
  }
  function clearBookmarks() {
    bookmarks.clear();
    ui.list.querySelectorAll('.lg-bm.is-on').forEach(function (el) { setStar(el, false); });
    updateBookmarkBar();
  }
  function updateBookmarkBar() {
    var n = bookmarks.size;
    if (n === 0) { ui.bmBar.hidden = true; ui.bmList.hidden = true; renderChartBookmarks(); return; }
    ui.bmBar.hidden = false;
    ui.bmCount.textContent = String(n);
    if (!ui.bmList.hidden) renderBookmarkList();
    renderChartBookmarks();
  }
  function renderBookmarkList() {
    L.clear(ui.bmList);
    if (bookmarks.size === 0) { ui.bmList.appendChild(h('div', { class: 'muted', text: 'No bookmarks yet. Click the ☆ at the start of a log line to pin it.' })); return; }
    var items = Array.from(bookmarks.entries()).map(function (e) { return { key: e[0], b: e[1] }; });
    items.sort(function (x, y) {
      var mx = window.mtTsToMs(x.b.ts), my = window.mtTsToMs(y.b.ts);
      if (!isNaN(mx) && !isNaN(my) && mx !== my) return mx - my;
      return x.b.line - y.b.line;
    });
    items.forEach(function (it) {
      var b = it.b;
      ui.bmList.appendChild(h('div', { class: 'lg-bm-item', title: 'Jump to this line in the stream', onclick: function () { jumpToBookmark(it.key); } }, [
        h('span', { class: 'lg-bm-line', text: 'L' + b.line }),
        h('span', { class: 'lg-bm-ts', text: window.logInsightsShortTs(b.ts) }),
        S.badge(b.level),
        h('span', { class: 'lg-bm-node', title: b.node, text: b.node }),
        h('span', { class: 'lg-bm-msg', text: b.msg }),
        h('button', { class: 'lg-bm-x', type: 'button', title: 'Remove bookmark', text: '×', onclick: function (ev) { ev.stopPropagation(); removeBookmark(it.key); renderBookmarkList(); } })
      ]));
    });
  }
  function toggleBookmarkList() {
    ui.bmList.hidden = !ui.bmList.hidden;
    if (!ui.bmList.hidden) renderBookmarkList();
  }
  // Jumps to one line of the log: switch to the stream tab, reveal the row (clearing filters if the line is
  // filtered out), page the list up to it, then centre and flash it. Bookmarks and the Slow queries tab
  // both land here.
  function jumpToLine(key) {
    var idx = S.filtered.findIndex(function (e) { return bookmarkKey(e) === key; });
    if (idx < 0) {
      resetStreamFilters();
      idx = S.filtered.findIndex(function (e) { return bookmarkKey(e) === key; });
      if (idx < 0) return;
    }
    showTab('stream');
    var row = revealRow(idx);
    if (row) flashRow(row);
  }
  function jumpToBookmark(key) { jumpToLine(key); }
  S.jumpToEntry = function (e) { jumpToLine(bookmarkKey(e)); };

  // ===================================================================================================
  // ROW CONTEXT MENU — right-click a line → "Filter by this Correlation ID"
  // ===================================================================================================
  var menu = null;
  function closeContextMenu() { if (menu && menu.parentNode) menu.parentNode.removeChild(menu); menu = null; }
  function showContextMenu(ev, e) {
    ev.preventDefault();
    closeContextMenu();
    // The runtime's own marker first (the bracketed token at the start of the message), falling back to the
    // first UUID on the line. Order matters: a record carrying a SAML assertion holds several UUIDs that are
    // claim values, not correlation IDs.
    var bracketed = String(e.msg || '').match(window.LOG_CORRID_MSG);
    var bare = e.raw.match(window.LOG_CORRID_PAT);
    var cid = bracketed ? bracketed[1] : (bare ? bare[0] : null);
    menu = h('div', { class: 'lg-ctx', style: 'left:' + ev.clientX + 'px;top:' + ev.clientY + 'px', onclick: function (e2) { e2.stopPropagation(); } },
      cid ? [h('button', { class: 'lg-ctx-item', type: 'button', onclick: function () { S.filterByCorrId(cid); } }, ['Filter by this Correlation ID', h('br'), h('span', { class: 'lg-ctx-id', text: cid })])]
        : [h('div', { class: 'lg-ctx-item is-disabled', text: 'No correlation/request ID-like token found on this line' })]);
    L.overlayHost().appendChild(menu);
    setTimeout(function () { document.addEventListener('click', closeContextMenu, { once: true }); }, 0);
  }

  // ===================================================================================================
  // TAKING LINES OUT
  // ===================================================================================================
  function exportFiltered() {
    if (!S.filtered.length) return;
    L.download(S.filtered.map(function (e) { return e.raw; }).join('\n'), 'filtered-logs.txt');
  }

  // A quick scrub for the clipboard: the same four replacements the original's Log Viewer ran — UUIDs,
  // IP addresses, e-mail addresses and Mendix object ids. It is a convenience, not a guarantee: names,
  // tokens and anything else in a message stay as they are.
  function anonymizeAndCopy(btn) {
    if (!S.filtered.length) { L.toast('No logs to anonymize.', 'warn'); return; }
    var text = S.filtered.map(function (e) { return e.raw; }).join('\n');
    text = text.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '[UUID]');
    text = text.replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, '[IP]');
    text = text.replace(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, '[IP]');
    text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]');
    text = text.replace(/\b\d{15,19}\b/g, '[MENDIX_ID]');
    L.copy(text, btn);
    L.toast('Anonymized and copied ' + S.filtered.length + ' filtered log entries to the clipboard.', 'ok');
  }

  // ===================================================================================================
  // LOADING A LOG — and taking it back
  // ===================================================================================================
  // Loading over a log that is on screen REPLACES it: a second file used to join the first without saying
  // so. The previous state is kept for Undo / Merge instead. Clear and replace are forgiven (Undo, 10 s)
  // rather than questioned with a dialog on every deliberate use.
  function snapshot() {
    return {
      entries: S.all, multi: multiFile, bookmarks: new Map(bookmarks), levels: new Set(S.levels),
      search: ui.search.value, from: ui.from.value, to: ui.to.value, node: ui.node.value, date: ui.date.value, mode: searchMode
    };
  }

  function restore(s) {
    clearState();
    undoGen++;
    S.all = s.entries;
    multiFile = s.multi;
    bookmarks = s.bookmarks;
    S.levels = new Set(s.levels);
    syncLevelChips();
    ui.mode.set(s.mode || 'filter');
    searchMode = s.mode || 'filter';
    ui.search.value = s.search; ui.from.value = s.from; ui.to.value = s.to; ui.node.value = s.node;
    buildDateFilter();
    ui.date.value = s.date;
    showLoaded();
  }

  function filesLabel(entries) {
    var files = new Set();
    entries.forEach(function (e) { files.add(e.file || 'log'); });
    var first = files.values().next().value || 'log';
    return files.size > 1 ? first + ' (+' + (files.size - 1) + ' more)' : first;
  }

  function offerUndo(snap, message, loaded) {
    var gen = ++undoGen;
    var stale = function () { return gen !== undoGen; };
    var expired = function () { L.toast('Nothing to undo — the log has changed since.', 'warn'); };
    var actions = [{ label: 'Undo', onClick: function () { if (stale()) expired(); else restore(snap); } }];
    if (loaded && loaded.length) {
      actions.push({ label: 'Merge instead', onClick: function () {
        if (stale()) { expired(); return; }
        restore(snap);
        loaded.reduce(function (p, l) { return p.then(function () { return parseContent(l.text, l.name, l.parsed); }); }, Promise.resolve());
      } });
    }
    L.toast(message, 'info', { actions: actions, duration: 10000 });
  }

  function replacedMessage(prevEntries, newLabel) {
    var oldLabel = filesLabel(prevEntries);
    // Re-opening the file already on screen loses none of the log, only its filters and bookmarks — say
    // that, not "replaced X with X".
    return oldLabel === newLabel ? 'Reloaded ' + newLabel + ' — filters and bookmarks were reset.' : 'Replaced ' + oldLabel + ' with ' + newLabel + '.';
  }

  // text → entries, appended to what is loaded. `parsed` — records the Hub already holds for this very text —
  // skips the parse; their offsets still fit, because the parser normalises line endings exactly as L.lf does.
  async function parseContent(text, filename, parsed) {
    text = L.lf(text);
    var res = parsed || await L.parseText(text, 'log-viewer');
    var entries = window.logRecordsToEntries(res.records, text, filename);

    // An unrecognised format used to land as ONE entry with every other line folded into it as a stack frame —
    // a 1581-line Grafana export shown as a single INFO row, reported as a clean parse. The silence was the
    // real bug: a format we cannot read has to say so.
    if (entries.length === 1) {
      var folded = (entries[0].msg.match(/\n/g) || []).length;
      if (folded >= 20) {
        L.toast('Only 1 entry was recognized in "' + filename + '", with ' + folded + ' lines folded into it. This usually means the file is an export from another tool (Grafana, Kibana, a spreadsheet) rather than a raw Mendix log.', 'warn');
      }
    }
    if (entries.length === 0) {
      showUnparsable();
      return res;
    }

    S.all = S.all.concat(entries);

    // When logs come from multiple files, merge them chronologically so an incident spanning several files
    // reads as one timeline. Entries without a parseable full timestamp keep their relative order (stable sort).
    var distinct = new Set(S.all.map(function (e) { return e.file; }));
    multiFile = distinct.size > 1;
    if (multiFile) {
      S.all.forEach(function (e) {
        if (e._t === undefined) { var t = Date.parse(e.ts); e._t = isNaN(t) ? null : t; }
      });
      S.all.sort(function (a, b) { return (a._t !== null && b._t !== null) ? a._t - b._t : 0; });
    }
    buildDateFilter();
    showLoaded();
    return res;
  }

  function showUnparsable() {
    ui.empty.hidden = true;
    L.clear(ui.list);
    ui.list.appendChild(W.note('Could not parse any log entries from this file. Make sure it is a plain-text Mendix log.', 'error'));
    ui.list.hidden = false;
  }

  // ISO from live logs, day/month/year from a Studio Pro CSV export.
  function buildDateFilter() {
    var dates = Array.from(new Set(S.all.map(function (e) { var m = e.ts.match(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/); return m ? m[1] : null; }).filter(Boolean)));
    var cur = ui.date.value;
    L.clear(ui.date);
    ui.date.appendChild(h('option', { value: '', text: 'All dates' }));
    dates.forEach(function (d) { ui.date.appendChild(h('option', { value: d, text: d, selected: d === cur })); });
  }

  // Everything the view needs once S.all holds a log — after a parse, and after an Undo puts a previous log
  // back. A newer log also makes any pending Undo stale.
  function showLoaded() {
    undoGen++;
    window.logAssignMs(S.all);
    S.dropInsightsCache();
    buildChart();
    ui.empty.hidden = true;
    ui.list.hidden = false;
    setDataDependentUI(true);
    applyFilters();
    refreshActiveTab();
    updateBookmarkBar();
    S.updateInsightsCount(function (t) { ui.tabs.setCount('insights', t); });
    ui.tabs.setCount('slow', S.slowCountLabel());
  }

  // Search, level chips, the time range, the node filter and the date select are all no-ops with nothing
  // loaded — the empty viewer used to present the full filter bar plus an enabled Export and Clear over zero
  // rows. Same rule the app already applies everywhere else: nothing to act on, nothing offered.
  function setDataDependentUI(hasData) {
    ui.fbar.hidden = !hasData;
    ui.stats.visible(hasData);
    ui.btn.analyze.hidden = !hasData;
    ui.btn.anonCopy.hidden = !hasData;
    ui.btn.export.disabled = !hasData;
    ui.btn.clear.disabled = !hasData;
    // With a log on screen another file replaces this one (with Undo), so the button says so. It is never the
    // primary action: the empty state's Browse is, and once a log is loaded the next step is analysis.
    ui.loadBtn.textContent = hasData ? 'Replace log…' : 'Load log file';
    ui.loadBtn.title = hasData ? 'Load another log in place of this one — Undo and Merge instead are offered afterwards' : '';
  }

  // Back to the empty viewer: no log, no filters, no bookmarks.
  function clearState() {
    S.all = []; S.filtered = [];
    S.dropInsightsCache();
    ui.tabs.setCount('insights', '');
    ui.tabs.setCount('slow', '');
    multiFile = false; fileBadgeCache.clear();
    chart.range = null; chart.full = null; chart.axis = null; chart.bg = null; chart.fg = null;
    ui.tl.wrap.hidden = true;
    closeContextMenu();
    L.clear(ui.list);
    ui.list.hidden = true;
    ui.sentinel.textContent = '';
    ui.empty.hidden = false;
    ui.stats.visible(false);
    L.clear(ui.date);
    ui.date.appendChild(h('option', { value: '', text: 'All dates' }));
    setDataDependentUI(false);
    S.sigKey = null; S.mechanisms = null; ui.banner.hidden = true;
    [ui.search, ui.from, ui.to, ui.node].forEach(function (el) { el.value = ''; });
    S.levels = new Set(LEVELS);
    syncLevelChips();
    S.renderInsights(ui.insightsOut);
    S.renderSlow(ui.slowOut);
    bookmarks.clear();
    updateBookmarkBar();
    S.renderModel(ui.modelOut);
    ui.scopeNote.hidden = true;
    ui.hitNav.hidden = true;
  }

  function clearLog() {
    var snap = S.all.length ? snapshot() : null;
    clearState();
    if (snap) offerUndo(snap, 'Log cleared.', null);
  }

  async function loadFiles(files) {
    L.loader.show('Reading files...');
    var prev = S.all.length ? snapshot() : null;
    if (prev) clearState();
    var loaded = [];
    // Sequential to keep file order deterministic before the timestamp merge-sort.
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        L.loader.show('Parsing ' + f.name + '...');
        var text = L.lf(await L.readFileText(f));
        var before = S.all.length;
        var parsed = await parseContent(text, f.name);
        if (S.all.length > before) loaded.push({ text: text, name: f.name, parsed: parsed });
      } catch (err) {
        console.error('Failed to load ' + f.name, err);
        L.toast('Could not read "' + f.name + '": ' + err.message, 'error');
      }
    }
    // A file that failed to parse must not cost the log that was on screen.
    if (prev && !loaded.length) { restore(prev); L.loader.hide(); return; }
    L.loader.hide();
    if (prev) offerUndo(prev, replacedMessage(prev.entries, filesLabel(S.all)), loaded);
  }

  // Parse raw log text as if it were a dropped file (Paste log uses it). It replaces what is on screen, the
  // same way a dropped file does.
  async function loadText(text, filename, parsed) {
    var prev = S.all.length ? snapshot() : null;
    if (prev) clearState();
    L.loader.show('Reading the log…');
    await parseContent(text, filename || 'shared.log', parsed);
    L.loader.hide();
    if (prev) offerUndo(prev, replacedMessage(prev.entries, filename || 'shared.log'), null);
    return true;
  }

  function openPasteModal() {
    var ta = h('textarea', { class: 'lg-textarea', rows: '12', placeholder: 'Paste log content here…', spellcheck: 'false' });
    L.modal({
      title: 'Paste log content', wide: true,
      body: h('div', null, [h('p', { class: 'muted', text: 'Paste raw Mendix log text — a live log, a Studio Pro console export or a Grafana export. It is read in this tab and goes nowhere else.' }), ta]),
      actions: [
        { label: 'Cancel' },
        { label: 'Parse', primary: true, onClick: function () {
          if (!ta.value.trim()) { L.toast('Please paste some logs first.', 'warn'); return false; }
          var text = ta.value;
          setTimeout(function () { loadText(text, 'clipboard-paste.txt'); }, 0);
        } }
      ]
    });
  }

  // ===================================================================================================
  // TABS
  // ===================================================================================================
  var currentTab = 'stream';
  function showTab(id) {
    currentTab = id;
    ui.tabs.set(id);
    Object.keys(ui.panes).forEach(function (k) { ui.panes[k].hidden = k !== id; });
    refreshActiveTab();
    if (id === 'stream') scheduleBand();
  }
  function refreshActiveTab() {
    if (currentTab === 'insights') S.renderInsights(ui.insightsOut);
    if (currentTab === 'slow') S.renderSlow(ui.slowOut);
    if (currentTab === 'model') S.renderModel(ui.modelOut);
  }
  S.showSlow = function () { showTab('slow'); };

  // ===================================================================================================
  // BUILD
  // ===================================================================================================
  function chip(level) {
    var b = h('button', {
      class: 'lg-lvlchip lg-lvlchip-' + LEVEL_CLS[level] + ' is-on', type: 'button', text: level, 'aria-pressed': 'true',
      title: 'Show only ' + level + ' · Shift/Ctrl+click adds or removes it',
      onclick: function (ev) { toggleLevel(level, ev); }
    });
    ui.levelBtns[level] = b;
    return b;
  }

  function build() {
    ui.levelBtns = {};

    // ---- the module's own buttons ----
    var picker = W.filePicker('Load log file', { primary: true, multiple: true, accept: '.log,.txt,.csv,.gz' }, loadFiles);
    ui.loadBtn = picker.button;
    ui.btn = {
      analyze: h('button', { class: 'btn btn-sm', type: 'button', text: 'Aggregate errors', hidden: true, title: 'Group identical errors and exceptions — useful for finding error loops', onclick: S.openSignatures }),
      anonCopy: h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy anonymized', hidden: true, title: 'Copy the filtered lines with UUIDs, IPs, e-mail addresses and Mendix ids replaced', onclick: function () { anonymizeAndCopy(ui.btn.anonCopy); } }),
      export: h('button', { class: 'btn btn-sm', type: 'button', text: 'Export filtered', disabled: true, onclick: exportFiltered }),
      clear: h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', text: 'Clear', disabled: true, title: 'Unload the log — Undo is offered for 10 seconds', onclick: clearLog })
    };
    var actions = h('div', { class: 'lg-actions' }, [
      ui.btn.analyze, ui.btn.anonCopy, ui.btn.export, h('span', { class: 'lg-sep' }), ui.btn.clear, h('span', { class: 'lg-sep' }),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Paste log', onclick: openPasteModal }), picker.button, picker.input
    ]);

    // ---- filter bar ----
    ui.search = h('input', { type: 'text', class: 'lg-input lg-input-grow', placeholder: 'Search messages, nodes, text…', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search' });
    ui.search.addEventListener('input', applyFilters);
    ui.search.addEventListener('keydown', function (ev) {
      // Enter steps to the next hit, Shift+Enter to the previous one — the find-bar reflex. Only bound in
      // highlight mode; under 'filter' there is nothing to step through, so Enter is left alone.
      if (ev.key !== 'Enter' || searchMode !== 'highlight') return;
      ev.preventDefault();
      gotoHit(ev.shiftKey ? -1 : 1);
    });
    ui.mode = W.segmented([
      { id: 'filter', label: 'Filter', title: 'Hide the lines that do not match. Export filtered and the counts narrow to the matches.' },
      { id: 'highlight', label: 'Highlight', title: 'Keep every line and mark the matches, so you can read what happened around them. Step between matches with the arrows or Enter / Shift+Enter.' }
    ], 'filter', setSearchMode);
    ui.hitCount = h('span', { text: '0 / 0' });
    ui.hitNav = h('span', { class: 'lg-hitnav', hidden: true }, [
      ui.hitCount,
      h('button', { type: 'button', title: 'Previous match (Shift+Enter)', 'aria-label': 'Previous match', text: '▲', onclick: function () { gotoHit(-1); } }),
      h('button', { type: 'button', title: 'Next match (Enter)', 'aria-label': 'Next match', text: '▼', onclick: function () { gotoHit(1); } })
    ]);
    ui.from = h('input', { type: 'time', step: '1', class: 'lg-input lg-input-time', 'aria-label': 'From time' });
    ui.to = h('input', { type: 'time', step: '1', class: 'lg-input lg-input-time', 'aria-label': 'To time' });
    ui.node = h('input', { type: 'text', class: 'lg-input', placeholder: 'Node filter (e.g. Core, MyModule)', spellcheck: 'false', 'aria-label': 'Log node' });
    ui.date = h('select', { class: 'lg-input', 'aria-label': 'Date' }, [h('option', { value: '', text: 'All dates' })]);
    [ui.from, ui.to, ui.node].forEach(function (el) { el.addEventListener('input', applyFilters); });
    ui.date.addEventListener('change', applyFilters);
    ui.clearFilters = h('button', { class: 'btn btn-ghost btn-sm lg-push', type: 'button', text: 'Clear all filters', hidden: true, title: 'Reset search, levels, time range, node, date and the signature filter', onclick: resetStreamFilters });

    ui.fbar = h('div', { class: 'lg-fbar', hidden: true }, [
      h('div', { class: 'lg-frow' }, [
        ui.search, ui.mode.el, ui.hitNav,
        h('div', { class: 'lg-lvlchips', role: 'group', 'aria-label': 'Levels' }, LEVELS.map(chip)),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'All', onclick: function () { toggleAllLevels(true); } }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'None', onclick: function () { toggleAllLevels(false); } })
      ]),
      h('div', { class: 'lg-frow' }, [h('span', { class: 'lg-flabel', text: 'Time' }), ui.from, h('span', { class: 'muted', text: '→' }), ui.to, ui.node, ui.date, ui.clearFilters])
    ]);

    // ---- banners ----
    ui.bannerLabel = h('span', { class: 'lg-banner-label', text: 'Filtering by Signature:' });
    ui.bannerName = h('span', { class: 'lg-banner-name' });
    ui.banner = h('div', { class: 'lg-banner', hidden: true }, [ui.bannerLabel, ui.bannerName, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Clear filter', onclick: clearSignatureFilter })]);

    ui.bmCount = h('span', { text: '0' });
    ui.bmList = h('div', { class: 'lg-bm-list', hidden: true });
    ui.bmBar = h('div', { class: 'lg-bmbar', hidden: true }, [
      h('div', { class: 'lg-bmbar-row' }, [
        h('button', { class: 'lg-bmbar-title', type: 'button', onclick: toggleBookmarkList }, ['★ Bookmarks: ', ui.bmCount]),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Show / hide list', onclick: toggleBookmarkList }),
        h('span', { class: 'lg-grow' }),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Clear all', onclick: clearBookmarks })
      ]),
      ui.bmList
    ]);

    // ---- timeline ----
    var tl = ui.tl = {};
    tl.gVol = L.svg('g'); tl.gSev = L.svg('g'); tl.gBm = L.svg('g');
    tl.svg = L.svg('svg', { viewBox: '0 0 ' + TL.W + ' 66', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Log records over time: an upper lane for total volume and a lower lane for warnings and errors', class: 'lg-tl-svg' }, [tl.gVol, tl.gSev, tl.gBm]);
    tl.band = h('div', { class: 'lg-tl-band', hidden: true });
    tl.drag = h('div', { class: 'lg-tl-drag', hidden: true });
    tl.tip = h('div', { class: 'lg-tl-tip', hidden: true });
    tl.box = h('div', { class: 'lg-tl-box' }, [tl.svg, tl.band, tl.drag, tl.tip]);
    tl.range = h('span', { class: 'lg-tl-range' });
    tl.clear = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Clear range', hidden: true, onclick: clearChartRange });
    tl.a0 = h('span'); tl.a1 = h('span'); tl.a2 = h('span');
    tl.note = h('div', { class: 'lg-tl-note', hidden: true });
    tl.wrap = h('div', { class: 'lg-tl', hidden: true }, [
      h('div', { class: 'lg-tl-head' }, [h('span', { class: 'lg-tl-title', text: 'Records over time' }), h('span', { class: 'lg-tl-hint', text: 'drag to zoom into a time range · click to jump there' }), tl.range, tl.clear]),
      tl.box, h('div', { class: 'lg-tl-axis' }, [tl.a0, tl.a1, tl.a2]), tl.note
    ]);

    // ---- stats, scope note, the stream itself ----
    ui.stats = W.statBar([
      { id: 'total', label: 'Total:' }, { id: 'shown', label: 'Shown:' },
      { id: 'errors', label: 'Errors:', tone: 'error' }, { id: 'warnings', label: 'Warnings:', tone: 'warn' }, { id: 'info', label: 'Info:', tone: 'info' }
    ]);
    ui.stats.el.appendChild(h('span', { class: 'lg-grow' }));
    ui.stats.el.appendChild(h('button', { class: 'lg-stat is-link', type: 'button', text: '↑ Top', onclick: function () { scrollStream('top'); } }));
    ui.stats.el.appendChild(h('button', { class: 'lg-stat is-link', type: 'button', text: '↓ Bottom', onclick: function () { scrollStream('bottom'); } }));
    ui.scopeNote = h('div', { class: 'lg-note lg-note-info', hidden: true });

    var empty = W.empty('Drop a log file here', [
      h('p', { class: 'muted', text: 'Mendix Cloud live logs (.txt/.log), Studio Pro CSV exports and Grafana exports · several files are merged into one timeline · .gz archives · large files are fine' }),
      W.howTo('How to get this data', [h('p', null, ['Any Mendix log works — no special level is needed for INFO/WARN/ERROR. ', h('strong', { text: 'Mendix Cloud:' }), ' Environment → Details → Logs (download the file or a .gz archive). ',
        h('strong', { text: 'Studio Pro:' }), ' the Console, or deployment/log/log.txt inside the project folder. ', h('strong', { text: 'Grafana:' }), ' any of the three download buttons (TXT, JSON, CSV).'])])
    ], [
      (function () { var p2 = W.filePicker('Browse files', { primary: true, multiple: true }, loadFiles); return [p2.button, p2.input]; })(),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Paste log content', onclick: openPasteModal })
    ]);
    ui.empty = empty;
    ui.list = h('div', { class: 'lg-list', hidden: true });
    ui.sentinel = h('div', { class: 'lg-sentinel' });
    ui.stream = L.keepScroll(h('div', { class: 'lg-stream' }, [empty, ui.list, ui.sentinel]));
    W.dropTarget(ui.stream, loadFiles, L.looksLikeLog);
    // Pages the next batch in as the sentinel comes near.
    if (typeof IntersectionObserver !== 'undefined') {
      scrolled.observer = new IntersectionObserver(function (entries) { if (entries[0].isIntersecting) loadMore(); }, { root: ui.stream, rootMargin: '200px' });
      scrolled.observer.observe(ui.sentinel);
    }

    var streamPane = h('div', { class: 'lg-pane lg-pane-stream' }, [ui.fbar, ui.banner, ui.bmBar, tl.wrap, ui.stats.el, ui.scopeNote, ui.stream]);

    // ---- the other tabs ----
    ui.insightsOut = L.keepScroll(h('div', { class: 'lg-scroll' }));
    ui.slowOut = L.keepScroll(h('div', { class: 'lg-scroll' }));
    ui.modelOut = L.keepScroll(h('div', { class: 'lg-scroll' }));

    ui.panes = {
      stream: streamPane,
      insights: h('div', { class: 'lg-pane', hidden: true }, [ui.insightsOut]),
      slow: h('div', { class: 'lg-pane', hidden: true }, [ui.slowOut]),
      model: h('div', { class: 'lg-pane', hidden: true }, [ui.modelOut])
    };

    ui.tabs = W.tabs([
      { id: 'stream', label: 'Log Stream' }, { id: 'insights', label: 'Insights' },
      { id: 'slow', label: 'Slow queries', title: 'The statements the runtime reported as slow, worst first — from the warnings it writes at default log levels' },
      { id: 'model', label: 'In your model', title: 'Which microflows, pages and entities of the open project the warnings and errors name' }
    ], 'stream', showTab);

    var root = h('div', { class: 'lg-tool lg-viewer' }, [actions, ui.tabs.el, h('div', { class: 'lg-panes' }, [ui.panes.stream, ui.panes.insights, ui.panes.slow, ui.panes.model])]);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeContextMenu(); });

    S.renderInsights(ui.insightsOut);
    S.renderSlow(ui.slowOut);
    S.renderModel(ui.modelOut);
    L.onModel(function () { S.renderModel(ui.modelOut); });
    return root;
  }

  L.register({
    id: 'log-viewer', label: 'Log Viewer',
    hint: 'Search, filter and chart a log; Insights and the slow queries over it.',
    build: build,
    hasData: function () { return S.all.length > 0; },
    loadText: loadText,
    loadFiles: loadFiles,
    filterInsight: filterInsight,
    onShow: function () { scheduleBand(); }
  });
})();
