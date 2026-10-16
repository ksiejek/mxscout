/* MxScout — the Microflows screen (and the Nanoflows one, the same screen).
 *
 * The redesign's way of reading one flow the way a developer does (private
 * redesign spec 02). The list, the drawn flow, tracing a variable, the step
 * inspector, the flow as a whole and the Studio Pro view are one component,
 * flowview.js, which the exported documentation runs too (spec 14). This file
 * is MxScout's shell around it: the header with the search, "View as" and the
 * project's menu; the flows the chosen role may run; and the actions that
 * only the app has — Run… (the window that runs it
 * against a connected app), Add comment.
 *
 * Read from the model, except a description of the flow and the risks, which
 * an agent wrote and the person imported; both are marked as the agent's. It
 * changes nothing in the project. One object on window, one init().
 */
(function () {
  'use strict';

  var el = null, state = null, render = null, deps = null;

  function init(d) {
    deps = d;
    el = function (tag, attrs, children) {
      return d.el(tag, attrs, (children || []).map(function (c) { return typeof c === 'string' ? document.createTextNode(c) : c; }));
    };
    state = d.state;
    render = d.render;
    document.addEventListener('keydown', function (e) {
      // Pressed where something else took it — a window's own Escape (dialog.js), a search box — it is not ours.
      if (e.key !== 'Escape' || e.defaultPrevented || !state.detail || !state.detail.mfui) return;
      var u = state.detail.mfui[state.detail.view === 'nanoflows' ? 'nanoflow' : 'microflow'];
      // Esc closes the step's window, or else the About panel.
      if (u && u.mode === 'modeler' && u.studio) { e.preventDefault(); u.studio = false; u.step = null; render(); }
      else if (u && u.about) { e.preventDefault(); u.about = false; render(); }
    });
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    search: [['circle', { cx: 7, cy: 7, r: 4.5 }], ['path', { d: 'M10.5 10.5L14 14' }]],
    dots: [['circle', { cx: 3.5, cy: 8, r: 1.2 }], ['circle', { cx: 8, cy: 8, r: 1.2 }], ['circle', { cx: 12.5, cy: 8, r: 1.2 }]]
  };
  function icon(name, size, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'xe-i ic-' + name + (name === 'dots' ? ' filled' : '') + (cls ? ' ' + cls : ''));
    (ICONS[name] || []).forEach(function (s) {
      var node = document.createElementNS(SVG_NS, s[0]);
      Object.keys(s[1]).forEach(function (k) { node.setAttribute(k, String(s[1][k])); });
      svg.appendChild(node);
    });
    return svg;
  }
  function moduleOf(qn) { var i = String(qn || '').indexOf('.'); return i > 0 ? qn.slice(0, i) : ''; }

  // ---------- state, per kind ----------
  // Pages too (Karol, 2026-10-13: the Pages screen "must be like the rest" —
  // the list on the left, what the page is on the right, as its window said).
  function kindOf() { return state.detail.view === 'nanoflows' ? 'nanoflow' : state.detail.view === 'pages' ? 'page' : 'microflow'; }
  var PLURAL = { microflow: 'microflows', nanoflow: 'nanoflows', page: 'pages' };
  var TITLE = { microflow: 'Microflows', nanoflow: 'Nanoflows', page: 'Pages' };
  function ui() {
    state.detail.mfui = state.detail.mfui || {};
    var k = kindOf();
    if (!state.detail.mfui[k]) state.detail.mfui[k] = { module: null, key: null, sort: 'az', show: 'all', filter: '', step: null, trace: null, tab: 'step', mview: 'source', studio: false, menu: false };
    return state.detail.mfui[k];
  }
  // Moves the screen to one flow, from anywhere (a call, the palette).
  function select(qn, step) {
    var u = ui();
    // A link names this flow; if the role in View as hides it, show everyone's
    // (the selector says so), rather than land on a list without it.
    var model = state.detail.model;
    var f = named(model, kindOf(), qn);
    var set = f && deps.roleSet(model);
    if (set && !deps.listHitsSet(f.allowedModuleRoles, set)) state.detail.role = 'all';
    u.key = kindOf() + ':' + qn; u.module = moduleOf(qn); u.step = step || null; u.trace = null; u.tab = 'step'; u.studio = !!step;
    render();
  }

  // ---------- the data ----------
  // Every click draws the screen again, so what it is drawn from is kept for
  // as long as the model is the same one: each flow's entry, each kind's
  // flows by name, and the list the role in View as may run.
  var cache = { model: null, entries: {}, byName: {}, lists: {} };
  function fresh(model) { if (cache.model !== model) cache = { model: model, entries: {}, byName: {}, lists: {} }; }
  function entryOf(model, kind, f) {
    fresh(model);
    var key = kind + ':' + f.qualifiedName;
    if (!cache.entries[key]) cache.entries[key] = kind === 'page' ? window.MxDocsData.pageEntry(f, model) : window.MxDocsData.flowEntry(f, kind);
    return cache.entries[key];
  }
  function flowsOf(model, kind) { return model[PLURAL[kind]] || []; }
  // One of a kind by its qualified name, the first the model lists.
  function named(model, kind, qn) {
    fresh(model);
    var ix = cache.byName[kind];
    if (!ix) {
      ix = cache.byName[kind] = Object.create(null);
      flowsOf(model, kind).forEach(function (f) { if (!(f.qualifiedName in ix)) ix[f.qualifiedName] = f; });
    }
    return ix[qn] || null;
  }
  // The entries the screen lists: the kind's flows the role may run, or all of them.
  function listed(model, kind, set) {
    fresh(model);
    var key = kind + '|' + (set ? Object.keys(set).sort().join(',') : '*');
    if (!cache.lists[key]) {
      cache.lists[key] = flowsOf(model, kind).filter(function (f) { return deps.listHitsSet(f.allowedModuleRoles, set) || !set; })
        .map(function (f) { return entryOf(model, kind, f); });
    }
    return cache.lists[key];
  }
  function anyFlow(model, qn) {
    return named(model, 'microflow', qn) || named(model, 'nanoflow', qn);
  }
  function described() {
    var rec = deps.descriptions(state.activeId);
    return rec && rec.value ? rec.value : null;
  }
  function kindKey(kind) { return kind === 'nanoflow' ? 'nf' : kind === 'page' ? 'pg' : 'mf'; }

  // ---------- the header ----------
  // With a role in View as, the line under the title says the list is narrowed and to what, as the
  // Entities screen's does: "3 of 7 microflows that Clerk may run, in 2 modules".
  function header(model, kind, project, count, modules, total) {
    var u = ui();
    var search = el('input', { type: 'text', class: 'xe-search-input', placeholder: 'Search modules, flows, pages, entities…', 'aria-label': 'Search the model' });
    function toPalette() { var v = search.value; search.value = ''; search.blur(); window.MxPalette.open(v); }
    search.addEventListener('focus', toPalette);
    search.addEventListener('input', toPalette);
    var menu = u.menu ? el('div', { class: 'xe-menu', role: 'menu' }, [
      el('button', { type: 'button', role: 'menuitem', text: 'Rename…', onclick: function () { u.menu = false; deps.renameProject(project.id); } }),
      el('button', { type: 'button', role: 'menuitem', text: 'Replace model…', onclick: function () { u.menu = false; deps.replaceModel(project.id); } }),
      el('button', { type: 'button', role: 'menuitem', text: 'Package…', onclick: function () { u.menu = false; deps.packageProject(project.id); } }),
      deps.folderMenuItem(project, function () { u.menu = false; }),
      el('button', { type: 'button', role: 'menuitem', class: 'danger', text: 'Delete project', onclick: function () { u.menu = false; deps.deleteProject(project.id); } })
    ]) : null;
    return el('header', { class: 'xe-head' }, [
      el('div', { class: 'xe-title' }, [
        el('h1', { text: TITLE[kind] }),
        el('p', { class: 'xe-sub' }, deps.roleSet(model)
          ? [el('span', { class: 'mono', text: String(count) }), ' of ', el('span', { class: 'mono', text: String(total) }), ' ' + PLURAL[kind] + ' that ' + state.detail.role +
            (kind === 'page' ? ' may open' : ' may run') + ', in ', el('span', { class: 'mono', text: String(modules) }), modules === 1 ? ' module' : ' modules']
          : [el('span', { class: 'mono', text: String(count) }), ' ' + PLURAL[kind] + ' in ',
            el('span', { class: 'mono', text: String(modules) }), kind === 'page' ? ' modules, with who may open each and from where' : ' modules, each drawn from the model'])
      ]),
      el('label', { class: 'xe-search' }, [icon('search', 15), search, el('kbd', { text: 'Ctrl K' })]),
      el('div', { class: 'xe-head-right' }, [
        deps.folderButton(project),
        deps.roleSelector(model),
        kind === 'page' ? null : deps.exportButton(model, PLURAL[kind]),
        el('div', { class: 'xe-more' }, [el('button', {
          type: 'button', class: 'xe-icon-btn', 'aria-label': 'Project actions — replace model, package, delete',
          title: 'Rename · Replace model · Package · Delete project', 'aria-expanded': u.menu ? 'true' : 'false',
          onclick: function () { u.menu = !u.menu; render(); }
        }, [icon('dots', 16)]), menu])
      ].filter(Boolean))
    ]);
  }

  // ---------- the screen ----------
  function renderScreen(project) {
    var model = state.detail.model;
    var kind = kindOf();
    var u = ui();
    var set = deps.roleSet(model);
    var items = listed(model, kind, set);
    var d = described();
    // Only the risks that count (open or reopened, triage.js), the agent's and the ones people raised.
    var ix = window.MxTriage.riskIndex(state.activeId, d);
    var mods = {};
    items.forEach(function (f) { mods[f.module] = true; });
    var table = d && d[kind === 'nanoflow' ? 'nanoflows' : 'microflows'];
    var src = {
      items: items,
      entry: function (k, qn) {
        var ks = k ? [k] : ['microflow', 'nanoflow', 'page'];
        for (var i = 0; i < ks.length; i++) {
          var f = named(model, ks[i], qn);
          if (f) return entryOf(model, ks[i], f);
        }
        return null;
      },
      model: model,
      risks: function (e) { return ix.of(kindKey(e.kind), e.qn); },
      desc: function (e) { var x = table && table[e.qn]; return x && x.text ? { text: x.text } : null; }
    };
    return el('div', { class: 'xe mf' }, [
      header(model, kind, project, items.length, Object.keys(mods).length, flowsOf(model, kind).length),
      deps.levelWarning(model),
      window.MxFlowView.screen(src, u, {
        rerender: render, noun: PLURAL[kind],
        empty: 'No ' + kind + ' to show for this role.',
        openFlow: deps.openFlow, openRef: deps.openRef,
        // Developer tools off (app.js): no comment counts and no Run… or Add comment — what the model says, and
        // + Context (basket.js), which is not a Developer tool: what to talk over with a chat assistant.
        commentCount: function (e) { return deps.devTools() ? window.MxComments.countOn(e.qn) : 0; },
        copied: function (qn) { deps.setMessage('Copied ' + qn + '.', 'ok'); render(); },
        rowMenu: function (e, ev) { deps.contextMenu(ev, e.kind, e.qn); },
        actions: function (e) {
          var ctx = deps.contextButton(e.kind, e.qn);
          if (!deps.devTools()) return [ctx];
          var f = anyFlow(model, e.qn) || named(model, 'page', e.qn);
          if (kind === 'page') {
            return [
              ctx,
              window.MxComments.linkFor(e.qn),
              el('button', { type: 'button', class: 'mf-btn primary', text: 'Add comment', onclick: function () { deps.addComment('pages', f); } })
            ].filter(Boolean);
          }
          return [
            ctx,
            // Not in the design: running a flow against a connected app lives in
            // the flow's own window, and testers need it (Karol, 2026-10-13).
            el('button', { type: 'button', class: 'mf-btn', text: 'Run…', title: 'Run it against the connected app, in its own window', onclick: function () { deps.openWindow(kind, e.qn); } }),
            // Its comments, when it has any: the Comments section, narrowed to it.
            window.MxComments.linkFor(e.qn),
            el('button', { type: 'button', class: 'mf-btn primary', text: 'Add comment', onclick: function () { deps.addComment(kind === 'nanoflow' ? 'nanoflows' : 'microflows', f); } })
          ].filter(Boolean);
        }
      })
    ].filter(Boolean));
  }

  window.MxMicroflows = { init: init, renderScreen: renderScreen, select: select };
})();
