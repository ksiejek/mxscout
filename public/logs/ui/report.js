/* MxScout — Log analysis: the Incident Report.
 *
 * Assembles ONE self-contained HTML file from whatever the log tools currently show, for a chosen time
 * window: each tool contributes exactly what its view holds right now (narrow a tool first and the report
 * follows). Because every section is cut to the same window, a spike lines up across the Log Viewer's
 * lines, the Nginx 5xx responses, the slow SQL, the failing microflow and the failed integration call in a
 * single file that is safe to attach to a ticket — nothing in it loads from outside.
 *
 * Data-driven: only the sources that hold data are offered, the row count beside each is the count FOR THE
 * SELECTED WINDOW (so the reader sees up front what the window trims away), and anything selected that
 * produced no rows is named as skipped in the summary.
 *
 * The report model and the summary line are MxDevSwissTool's (Mikołaj / RealMecowhy, MIT) —
 * ../engine/export.js. Its HAR and JVM-dump sources are not part of MxScout, so they are not offered.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;

  var SOURCES = [
    { id: 'log-viewer', label: 'Log Viewer — log entries' },
    { id: 'log-query-extractor', label: 'Log Query Extractor — SQL queries' },
    { id: 'microflow-tracer', label: 'Microflow Tracer — executions' },
    { id: 'ws-rest-extractor', label: 'REST & WS Extractor — calls' },
    { id: 'nginx-log', label: 'Nginx — HTTP requests' }
  ];
  var HUB_TOOLS = ['log-viewer', 'log-query-extractor', 'microflow-tracer', 'ws-rest-extractor'];

  var ui = {};
  var probed = [];         // [{ src, section|null }]
  var autoWindow = null;   // the window the report filled in by itself, so a new source can widen it

  function section(src, from, to) {
    var tool = L.tools[src.id];
    if (!tool || typeof tool.reportSection !== 'function') return null;
    try { return tool.reportSection(from, to); } catch (e) { return null; }
  }

  // "YYYY-MM-DD HH:MM:SS" (UTC) for the editable window inputs — no " UTC" suffix, so the value round-trips
  // through parseMs.
  function fmtInput(ms) {
    if (ms == null || isNaN(ms)) return '';
    return window.mtFmtTs(ms).replace(/ UTC$/, '');
  }

  // "YYYY-MM-DD HH:MM:SS" (UTC) → epoch ms; blank → null; unparseable → NaN. Anchored at both ends: a value
  // like "…10:00:002026-09-20 9:00" once parsed as its first 19 characters and silently set the window.
  function parseMs(str) {
    str = (str || '').trim();
    if (!str) return null;
    var m = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:\s*(?:UTC|Z))?$/);
    if (!m) return NaN;
    var base = Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + 'Z');
    return base + (m[5] ? parseFloat('0.' + m[5]) * 1000 : 0);
  }

  // A malformed bound or an end before the start used to surface only as a toast at Generate, or not at all — a
  // reversed window just produced an empty report. The mark appears when the reader leaves the field (not at
  // "2026-0", halfway through typing) and clears on the keystroke that makes it right: `clearOnly` is the
  // as-you-type call. Returns true when usable.
  function checkWindow(clearOnly) {
    var fromMs = parseMs(ui.from.value), toMs = parseMs(ui.to.value);
    var bad = null, msg = '';
    if (Number.isNaN(fromMs)) { bad = ui.from; msg = 'Start: use YYYY-MM-DD HH:MM:SS (UTC), e.g. 2026-09-20 09:00:00, or leave it blank.'; }
    else if (Number.isNaN(toMs)) { bad = ui.to; msg = 'End: use YYYY-MM-DD HH:MM:SS (UTC), e.g. 2026-09-20 10:00:00, or leave it blank.'; }
    else if (fromMs != null && toMs != null && fromMs > toMs) { bad = ui.to; msg = 'The end is before the start — the report would be empty.'; }
    if (clearOnly && bad) return false;
    [ui.from, ui.to].forEach(function (el) {
      el.classList.toggle('is-invalid', el === bad);
      if (el === bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    });
    ui.hint.hidden = !bad;
    ui.hint.textContent = msg;
    return !bad;
  }

  // A log tool with nothing loaded does not have to be skipped when the Data Hub holds a log it has not seen:
  // the Hub carries the parsed records, so filling that source is a click, without leaving the report.
  function hubOffer(id) {
    var src = L.hub.getSource();
    if (!src || HUB_TOOLS.indexOf(id) === -1 || src.loadedIn.indexOf(id) !== -1) return null;
    return src;
  }

  function loadFromHub(id, btn) {
    btn.disabled = true; btn.textContent = 'Loading…';
    L.hub.loadInto(id).then(function () {
      // A window the reader typed is theirs and stays; the pre-filled one would cut the new source down to the
      // span of whatever was loaded before it, so it is dropped to be read again.
      if (autoWindow && ui.from.value === autoWindow.from && ui.to.value === autoWindow.to) { ui.from.value = ''; ui.to.value = ''; }
      refresh();
    }, function (e) { L.toast('Could not load the Data Hub file: ' + e.message, 'error'); refresh(); });
  }

  // Probe every source, draw the checklist, and pre-fill the window from the combined data span (only when the
  // reader has not typed one).
  function refresh() {
    if (!ui.list) return;
    var kept = {};
    probed.forEach(function (p) { if (p.checkbox) kept[p.src.id] = p.checkbox.checked; });
    probed = SOURCES.map(function (src) { return { src: src, section: section(src, null, null) }; });
    var available = probed.filter(function (p) { return p.section; });
    var minMs = Infinity, maxMs = -Infinity;
    available.forEach(function (p) {
      if (p.section.firstMs != null && !isNaN(p.section.firstMs)) minMs = Math.min(minMs, p.section.firstMs);
      if (p.section.lastMs != null && !isNaN(p.section.lastMs)) maxMs = Math.max(maxMs, p.section.lastMs);
    });

    L.clear(ui.list);
    probed.forEach(function (p) {
      if (p.section) {
        p.checkbox = h('input', { type: 'checkbox', checked: kept[p.src.id] === undefined ? true : kept[p.src.id] });
        p.count = h('span', { class: 'lg-ir-count' });
        ui.list.appendChild(h('label', { class: 'lg-ir-source is-on' }, [p.checkbox, h('span', { class: 'lg-ir-label', text: p.src.label }), p.count]));
        return;
      }
      p.checkbox = null;
      var hub = hubOffer(p.src.id);
      var action = hub
        ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Load from Data Hub', title: 'Load ' + hub.name + ' — already parsed — without leaving the report', onclick: function (e) { loadFromHub(p.src.id, e.currentTarget); } })
        : h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Open & load data', onclick: function () { L.goto(p.src.id); } });
      ui.list.appendChild(h('div', { class: 'lg-ir-source is-off' }, [h('span', { class: 'lg-ir-dot' }), h('span', { class: 'lg-ir-label', text: p.src.label }), action]));
    });

    if (!ui.from.value && !ui.to.value && minMs !== Infinity) {
      ui.from.value = fmtInput(minMs);
      ui.to.value = fmtInput(maxMs);
      autoWindow = { from: ui.from.value, to: ui.to.value };
    }
    checkWindow();
    updateCounts();
    ui.status.textContent = available.length
      ? available.length + ' source' + (available.length === 1 ? '' : 's') + ' with data ready to include.'
      : 'No log tool has data loaded yet. Load a log in the Log Viewer, Query Extractor, Microflow Tracer, REST & WS Extractor or Nginx analyzer — then refresh.';
    ui.generate.disabled = available.length === 0;
  }

  // Row count each source contributes AT THE CURRENT WINDOW — the number that actually lands in the report.
  // Without this the checklist showed the unwindowed total, so a narrow window silently produced a much smaller
  // (or empty) report. Re-run whenever the window inputs change.
  function updateCounts() {
    var fromMs = parseMs(ui.from.value), toMs = parseMs(ui.to.value);
    var windowed = !isNaN(fromMs) && !isNaN(toMs) && (fromMs != null || toMs != null);
    probed.forEach(function (p) {
      if (!p.section || !p.count) return;
      var loaded = p.section.total != null ? p.section.total : (p.section.rows ? p.section.rows.length : 0);
      var inWin = loaded;
      if (windowed) {
        var sec = section(p.src, fromMs, toMs);
        inWin = sec ? (sec.total != null ? sec.total : (sec.rows ? sec.rows.length : 0)) : 0;
      }
      p.count.classList.toggle('is-zero', inWin === 0);
      if (inWin === 0) p.count.textContent = 'none in window — skipped';
      else if (inWin < loaded) p.count.textContent = inWin + ' of ' + loaded + ' in window';
      else p.count.textContent = loaded + ' row' + (loaded === 1 ? '' : 's');
    });
  }

  // Collect the selected sources at the chosen window, build the report and download it; also show a summary of
  // what went in.
  function generate() {
    var fromMs = parseMs(ui.from.value), toMs = parseMs(ui.to.value);
    if (!checkWindow()) {
      var bad = ui.from.classList.contains('is-invalid') ? ui.from : ui.to;
      bad.focus();
      L.toast('Fix the time window first — the problem is described under the field.', 'warn');
      return;
    }
    // Sources that were selected but contribute nothing at this window are named in the summary — dropping them
    // silently made the report look arbitrarily smaller than the checklist promised.
    var sections = [], skipped = [];
    probed.forEach(function (p) {
      if (!p.checkbox || !p.checkbox.checked) return;
      var sec = section(p.src, fromMs, toMs);
      if (sec && sec.rows && sec.rows.length) sections.push(sec); else skipped.push(p.src.label);
    });

    L.clear(ui.summary);
    ui.summary.hidden = false;
    if (!sections.length) {
      ui.summary.appendChild(h('div', { class: 'lg-edx-empty' }, [h('p', { class: 'lg-empty-title', text: 'Nothing to report for this selection' }),
        h('p', { text: 'No selected source has rows inside the chosen time window: ' + skipped.join(', ') + '. Widen the window or press Reset to re-read the full span of loaded data.' })]));
      return;
    }
    var title = (ui.title.value || '').trim() || 'Mendix Incident Report';
    var notes = (ui.notes.value || '').trim();
    var model = window.mtBuildIncidentReport(sections, { title: title, fromMs: fromMs, toMs: toMs, notes: notes });
    var filename = (title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'incident-report') + '.html';
    L.downloadHtml(filename, model);

    var win = (fromMs != null || toMs != null) ? (fromMs != null ? window.mtFmtTs(fromMs) : 'start') + ' → ' + (toMs != null ? window.mtFmtTs(toMs) : 'end') : 'all loaded data';
    ui.summary.appendChild(h('div', { class: 'lg-ir-done' }, [
      h('div', { class: 'lg-ir-done-title' }, ['✓ Report downloaded — ', h('strong', { text: filename })]),
      h('div', { class: 'muted', text: 'Window: ' + win }),
      h('ul', null, sections.map(function (s) { return h('li', null, [h('strong', { text: s.title }), ' — ' + (s.subtitle || (s.rows.length + ' rows'))]); })),
      skipped.length ? h('div', { class: 'muted', text: 'Skipped — no rows inside the window: ' + skipped.join(', ') }) : null,
      h('div', { class: 'muted', text: 'Open the file in any browser — it is fully self-contained. Review it for sensitive data before sharing; the Anonymizer can scrub a log first.' })
    ]));
  }

  function resetWindow() { ui.from.value = ''; ui.to.value = ''; refresh(); }

  function build() {
    ui.title = h('input', { type: 'text', class: 'lg-input lg-input-grow', value: 'Mendix Incident Report', spellcheck: 'false', 'aria-label': 'Report title' });
    ui.notes = h('textarea', { class: 'lg-textarea', rows: '3', placeholder: 'Optional context for the reader: what happened, what you saw, what you tried…', 'aria-label': 'Notes' });
    ui.from = h('input', { type: 'text', class: 'lg-input lg-input-datetime', placeholder: 'YYYY-MM-DD HH:MM:SS', 'aria-label': 'Window start (UTC)', spellcheck: 'false' });
    ui.to = h('input', { type: 'text', class: 'lg-input lg-input-datetime', placeholder: 'YYYY-MM-DD HH:MM:SS', 'aria-label': 'Window end (UTC)', spellcheck: 'false' });
    [ui.from, ui.to].forEach(function (el) {
      el.addEventListener('input', function () { checkWindow(true); updateCounts(); });
      el.addEventListener('blur', function () { checkWindow(); });
    });
    ui.hint = h('p', { class: 'lg-hint lg-tone-error', hidden: true });
    ui.list = h('div', { class: 'lg-ir-sources' });
    ui.status = h('p', { class: 'muted' });
    ui.summary = h('div', { class: 'lg-ir-summary', hidden: true });
    ui.generate = h('button', { class: 'btn btn-primary', type: 'button', text: 'Generate report', onclick: generate });

    L.hub.onChange(function () { if (ui.list && ui.list.isConnected) refresh(); });

    return h('div', { class: 'lg-tool lg-ir' }, [
      h('div', { class: 'lg-ir-body' }, [
        h('p', { class: 'muted' }, ['One self-contained HTML file from whatever the log tools currently show, cut to a time window. Narrow a tool first and the report follows.']),
        h('div', { class: 'lg-label', text: 'Title' }), ui.title,
        h('div', { class: 'lg-label', text: 'Time window (UTC)' }),
        h('div', { class: 'lg-ir-window' }, [ui.from, h('span', { class: 'muted', text: '→' }), ui.to, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Reset', title: 'Clear the window and re-read the full span of loaded data', onclick: resetWindow })]),
        ui.hint,
        h('div', { class: 'lg-label', text: 'Sources' }), ui.list, ui.status,
        h('div', { class: 'lg-label', text: 'Notes' }), ui.notes,
        h('div', { class: 'lg-ir-actions' }, [ui.generate, h('button', { class: 'btn btn-sm', type: 'button', text: 'Refresh sources', onclick: refresh })]),
        ui.summary
      ])
    ]);
  }

  L.register({
    id: 'incident-report', label: 'Incident Report',
    hint: 'One self-contained HTML report from what the tools show, cut to a time window.',
    build: build,
    onShow: refresh
  });
})();
