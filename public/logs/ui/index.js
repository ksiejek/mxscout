/* MxScout — Log analysis: the screen that holds the Log Viewer.
 *
 * One section of MxScout for reading a Mendix application's log: the stream with its filters, Insights
 * over it, the slow queries the runtime reported, and — inside a project — what in the model the log
 * names. All of it lives in the Log Viewer (viewer.js); this file is the frame around it.
 *
 * This is MxDevSwissTool's log analysis (Mikołaj / RealMecowhy, MIT), brought into MxScout as a module and
 * given MxScout's interface. The licence and what was changed are in THIRD-PARTY-NOTICES.md.
 *
 * It lives beside the projects rather than inside one: a log is not part of a model, and the screen has to
 * work with no project open. Like About and Getting started it is a top-level screen — app.js shows it
 * when asked and otherwise leaves it alone. The viewer builds itself the first time it is opened and then
 * keeps its state while you move around, and the whole screen keeps its state while the rest of the app
 * redraws.
 */
(function () {
  'use strict';

  var L = window.MxLogs;
  var h = L.h;

  var VIEWER = 'log-viewer';
  var root = null, ui = {};

  // Opened from inside a project, the screen knows its model: say so, because it changes what the viewer offers.
  function renderProject() {
    var m = L.model;
    ui.project.hidden = !m;
    if (!m) return;
    L.replace(ui.project, [h('strong', { text: m.projectName }), ' is open — warnings and errors that name its microflows, pages or entities link into the model, and can be commented on from here.']);
  }

  function build() {
    var viewer = L.tools[VIEWER];
    ui.project = h('p', { class: 'lg-head-project', hidden: true });
    root = h('div', { class: 'lg' }, [
      h('header', { class: 'lg-head' }, [
        h('div', { class: 'lg-head-row' }, [h('h2', { text: 'Log analysis' })]),
        h('p', { class: 'lg-head-hint', text: viewer.hint || '' }),
        ui.project,
        h('p', { class: 'lg-credit' }, ['Log analysis comes from ', h('strong', { text: 'MxDevSwissTool' }), ' by Mikołaj (RealMecowhy) — MIT licence — brought into MxScout as a module. Nothing you load leaves this tab.'])
      ]),
      h('div', { class: 'lg-panels' }, [viewer.build()]),
      L.overlayHost()
    ]);
    L.onModel(renderProject);
    renderProject();
    return root;
  }

  function onShow() { L.restoreScroll(); var t = L.tools[VIEWER]; if (t && t.onShow) t.onShow(); }

  // ---------- what app.js calls ----------
  L.render = function () { if (!root) build(); return root; };
  // After the screen was put back into the page: scroll positions are lost on detach, so they are restored.
  L.afterAttach = onShow;
  L.open = function () { if (root) onShow(); };

  // The table → entity names of the open project, so a PostgreSQL message that says `shop$order` can say
  // `Shop.Order`. app.js hands it over when a project opens and withdraws it when one closes.
  var tableMap = null;
  L.setTableMap = function (map) { tableMap = map || null; };
  L.tableMap = function () { return tableMap; };
})();
