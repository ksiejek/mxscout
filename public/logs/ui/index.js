/* MxScout — Log analysis: the screen that holds the tools.
 *
 * One section of MxScout for reading a Mendix application's logs — the Log Viewer, the Query Extractor,
 * the Microflow Tracer, the REST & WS Extractor, the Error Decoder, the Nginx analyzer, the Anonymizer and
 * the Incident Report — over one loaded file: the bar under the tabs says what is loaded and hands it to
 * the next tool, so a 60 MB log is read once.
 *
 * This is MxDevSwissTool's log analysis (Mikołaj / RealMecowhy, MIT), brought into MxScout as a module and
 * given MxScout's interface. The licence and what was changed are in THIRD-PARTY-NOTICES.md.
 *
 * It lives beside the projects rather than inside one: a log is not part of a model, and the screen has to
 * work with no project open. Like About and Getting started it is a top-level screen — app.js shows it
 * when asked and otherwise leaves it alone. The tools build themselves the first time they are opened and
 * then keep their state while you move around, and the whole screen keeps its state while the rest of the
 * app redraws.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;
  var W = L.w;

  var ORDER = ['log-viewer', 'log-query-extractor', 'microflow-tracer', 'ws-rest-extractor', 'error-decoder', 'nginx-log', 'log-anonymizer', 'incident-report'];
  var root = null, tabs = null, ui = {};
  var built = {};

  function show(id, from) {
    var tool = L.tools[id];
    if (!tool) return;
    if (!built[id]) {
      built[id] = h('div', { class: 'lg-toolhost', 'data-tool': id }, [tool.build()]);
      ui.panels.appendChild(built[id]);
    }
    ORDER.forEach(function (k) { if (built[k]) built[k].hidden = k !== id; });
    tabs.set(id);
    ui.hint.textContent = tool.hint || '';
    renderBack();
    renderHub();
    if (tool.onShow) tool.onShow();
    L.restoreScroll();
  }

  function renderBack() {
    var back = L.nav.back && L.tools[L.nav.back];
    ui.back.hidden = !back;
    if (back) ui.back.textContent = '← Back to ' + back.label;
  }

  // ---------- the Data Hub bar ----------
  // Nothing loaded → nothing drawn (no empty shell, no placeholder counts).
  function renderHub() {
    var summary = L.hub.summary();
    L.clear(ui.hub);
    if (!summary) { ui.hub.hidden = true; return; }
    ui.hub.hidden = false;
    var targets = L.hub.targets(L.nav.current);
    ui.hub.appendChild(h('span', { class: 'lg-hub-line' }, [h('strong', { text: summary.line }),
      summary.siblings ? h('span', { class: 'muted', text: ' (+' + summary.siblings + ' more file' + (summary.siblings === 1 ? '' : 's') + ' in the Log Viewer — only this one is shared)' }) : null]));
    var right = h('span', { class: 'lg-hub-actions' }, [h('span', { class: 'muted', text: 'Open in…' })]);
    targets.forEach(function (t) {
      if (t.current) { right.appendChild(h('span', { class: 'lg-hub-here', text: '✓ here' })); return; }
      right.appendChild(h('button', {
        class: 'btn btn-sm', type: 'button', text: (t.loaded ? '✓ ' : '') + t.label, title: t.loaded ? 'Already loaded there — click to re-parse the same file' : null,
        onclick: function () { L.hub.openIn(t.id); }
      }));
    });
    right.appendChild(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '×', title: 'Forget this file (does not clear the tools)', 'aria-label': 'Forget this file', onclick: function () { L.hub.clear(); } }));
    ui.hub.appendChild(right);
  }

  function build() {
    L.overlayHost();
    ui.hint = h('p', { class: 'lg-head-hint' });
    ui.back = h('button', { class: 'lg-back', type: 'button', hidden: true, onclick: function () { L.goBack(); } });
    ui.hub = h('div', { class: 'lg-hub', hidden: true });
    ui.panels = h('div', { class: 'lg-panels' });
    tabs = W.tabs(ORDER.filter(function (id) { return L.tools[id]; }).map(function (id) { return { id: id, label: L.tools[id].label }; }), L.nav.current,
      function (id) { L.goto(id); }, 'lg-tabs lg-tabs-main');

    root = h('div', { class: 'lg' }, [
      h('header', { class: 'lg-head' }, [
        h('div', { class: 'lg-head-row' }, [h('h2', { text: 'Log analysis' }), ui.back]),
        ui.hint,
        h('p', { class: 'lg-credit' }, ['Log analysis comes from ', h('strong', { text: 'MxDevSwissTool' }), ' by Mikołaj (RealMecowhy) — MIT licence — brought into MxScout as a module. Nothing you load leaves this tab.'])
      ]),
      tabs.el, ui.hub, ui.panels, L.overlayHost()
    ]);

    L.onNav(function (id, from) { show(id, from); });
    L.hub.onChange(renderHub);
    show(L.nav.current);
    return root;
  }

  // ---------- what app.js calls ----------
  L.render = function () { if (!root) build(); return root; };
  // After the screen was put back into the page: scroll positions are lost on detach, so they are restored.
  L.afterAttach = function () { L.restoreScroll(); var t = L.tools[L.nav.current]; if (t && t.onShow) t.onShow(); };
  L.open = function (id) { if (id && L.tools[id]) L.nav.current = id; if (root) show(L.nav.current); };

  // The table → entity names of the open project, so a PostgreSQL message that says `shop$order` can say
  // `Shop.Order`. app.js hands it over when a project opens and withdraws it when one closes.
  var tableMap = null;
  L.setTableMap = function (map) { tableMap = map || null; };
  L.tableMap = function () { return tableMap; };
})();
