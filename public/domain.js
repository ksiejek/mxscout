/* MxScout — the Domain model screen (the Entities section).
 *
 * Karol, 2026-10-13: the documentation's Domain model reads much better than
 * the old list and map, so this screen IS that page — the same reader
 * (docs-view.js, mounted with only: 'domain'), on the same data the
 * Documentation section builds (docs.js domainScreen) — with three
 * differences that belong to the app:
 *   - nothing is picked on arrival, so every entity is drawn in full; a click
 *     picks one and greys the rest, a click beside the boxes lets go;
 *   - only the diagram, no List view;
 *   - the entity on the right has two actions of the app's own: Browse data
 *     (only its rows in the connected app, searchable, in a dialog of this
 *     screen's style — objects.js renderEntityData) and Add comment.
 * It reads the model and writes nothing; the search box in the header is
 * the app's search (palette.js), not the reader's.
 *
 * View as in its header narrows the diagram to the entities the chosen role
 * reaches: an entity is shown when one of its access rules belongs to a
 * module role of that user role, as Mendix grants read by the mere
 * existence of a matching rule (Karol, 2026-10-14: picking a role made the
 * others disappear before the Domain model replaced the list, and must
 * again). Associations to an entity the role does not reach go with it.
 */
(function () {
  'use strict';

  var deps, el, state;

  function init(d) {
    deps = d;
    el = d.el;
    state = d.state;
  }

  function header(model, project, all) {
    var open = !!state.detail.domainMenu;
    var menu = open ? el('div', { class: 'xe-menu', role: 'menu' }, [
      el('button', { type: 'button', role: 'menuitem', text: 'Rename…', onclick: function () { state.detail.domainMenu = false; deps.renameProject(project.id); } }),
      el('button', { type: 'button', role: 'menuitem', text: 'Replace model…', onclick: function () { state.detail.domainMenu = false; deps.replaceModel(project.id); } }),
      el('button', { type: 'button', role: 'menuitem', text: 'Package…', onclick: function () { state.detail.domainMenu = false; deps.packageProject(project.id); } }),
      deps.folderMenuItem(project, function () { state.detail.domainMenu = false; }),
      el('button', { type: 'button', role: 'menuitem', class: 'danger', text: 'Delete project', onclick: function () { state.detail.domainMenu = false; deps.deleteProject(project.id); } })
    ]) : null;
    var more = el('div', { class: 'xe-more' }, [el('button', {
      type: 'button', class: 'xe-icon-btn', 'aria-label': 'Project actions — replace model, package, delete',
      title: 'Rename · Replace model · Package · Delete project', 'aria-expanded': open ? 'true' : 'false', text: '⋯',
      onclick: function () { state.detail.domainMenu = !open; deps.render(); }
    }), menu].filter(Boolean));
    var n = (model.entities || []).length, total = (all.entities || []).length;
    var mods = {};
    (model.entities || []).forEach(function (e) { mods[e.module] = true; });
    var narrowed = model !== all;
    var search = el('input', { type: 'text', class: 'xe-search-input', placeholder: 'Search modules, flows, pages, entities…', 'aria-label': 'Search' });
    function toPalette() { var v = search.value; search.value = ''; search.blur(); window.MxPalette.open(v); }
    search.addEventListener('focus', toPalette);
    search.addEventListener('input', toPalette);
    return el('header', { class: 'xe-head' }, [
      el('div', { class: 'xe-title' }, [
        el('h1', { text: 'Domain model' }),
        el('p', { class: 'xe-sub' }, narrowed
          ? [el('span', { class: 'mono', text: String(n) }), el('span', { text: ' of ' }), el('span', { class: 'mono', text: String(total) }), el('span', { text: ' entities that ' + state.detail.role + ' reaches, in ' }), el('span', { class: 'mono', text: String(Object.keys(mods).length) }), el('span', { text: Object.keys(mods).length === 1 ? ' module' : ' modules' })]
          : [el('span', { class: 'mono', text: String(n) }), el('span', { text: ' entities in ' }), el('span', { class: 'mono', text: String(Object.keys(mods).length) }), el('span', { text: ' modules, one module at a time' })])
      ]),
      el('label', { class: 'xe-search' }, [search, el('kbd', { text: 'Ctrl K' })]),
      el('div', { class: 'xe-head-right' }, [deps.folderButton(project), deps.roleSelector(all), more].filter(Boolean))
    ]);
  }

  // The whole model, Marketplace modules included, whatever the project's
  // setting hides elsewhere: the page has its own Own / Marketplace switch,
  // as App Explorer does. Read once per model.
  var full = { raw: null, model: null };
  function fullModel() {
    var raw = state.detail.rawModel || state.detail.model;
    if (full.raw !== raw) { full.raw = raw; full.model = deps.fullModel(raw); }
    return full.model;
  }

  // The model as the role chosen in View as sees it, kept per model and role.
  var asRole = { model: null, key: null, out: null };
  function roleModel(model) {
    var set = deps.roleSet ? deps.roleSet(model) : null;
    if (!set) return model;
    var key = state.detail.role + '|' + Object.keys(set).sort().join(',');
    if (asRole.model === model && asRole.key === key) return asRole.out;
    var keep = {};
    var entities = (model.entities || []).filter(function (en) {
      var hit = (en.accessRules || []).some(function (r) { return set[r.moduleRole]; });
      if (hit) keep[en.qualifiedName] = true;
      return hit;
    });
    var out = Object.assign({}, model, {
      entities: entities,
      associations: (model.associations || []).filter(function (a) { return keep[a.owner] && keep[a.other]; })
    });
    asRole = { model: model, key: key, out: out };
    return out;
  }

  function renderScreen(project) {
    var all = fullModel();
    var model = roleModel(all);
    var host = window.MxDocs.domainScreen(model, project, {
      // What the panel's actions show: the comments, and what is in the context (+ Context's own state).
      stamp: function () { return String(window.MxComments.countFor(project.id)) + '|' + window.MxBasket.version(project.id); },
      route: deps.docRoute, patch: deps.docPatch ? deps.docPatch() : null,
      // What the Security analysis found about one rule, shown in its Access window. Asked of the
      // whole model, not the one View as narrowed: the analysis reads the whole model either way and
      // only leaves out what the view does not show, and a drawn entity is always shown — so the
      // notes are the same, and the analysis is made once, not again for every role picked.
      accessNotes: function (qn, moduleRole) { return window.MxSecurity.accessNotes(all, qn, moduleRole); },
      // A right-click on an entity's box: the context's menu (basket.js).
      entityMenu: function (qn, ev) { deps.contextMenu(ev, qn); },
      entityActions: function (qn) {
        // + Context is not a Developer tool (basket.js). Browse data and comments are (app.js): off, the
        // panel holds what the model says, and that.
        var ctx = deps.contextButton(qn);
        if (!deps.devTools()) return [ctx];
        var item = (model.entities || []).filter(function (e) { return e.qualifiedName === qn; })[0];
        if (!item) return [ctx];
        return [
          ctx,
          el('button', { type: 'button', class: 'mf-btn', text: 'Browse data', title: 'Its rows in the connected app — search and page through them', onclick: function () { deps.browseData(item); } }),
          deps.commentButton('entities', item),
          window.MxComments.linkFor(item.qualifiedName)
        ].filter(Boolean);
      }
    });
    // A role that reaches no entity at all: say so, rather than an empty canvas.
    var none = model !== all && !(model.entities || []).length
      ? el('div', { class: 'xe-page' }, [el('div', { class: 'card doc-empty' }, [el('h3', { text: state.detail.role + ' reaches no entity' }), el('p', { class: 'muted', text: 'No access rule in the model belongs to a module role of ' + state.detail.role + '. Choose Everything in View as to see the whole domain model.' })])])
      : null;
    return el('div', { class: 'xe dm-screen' }, [header(model, project, all), deps.levelWarning(all), none || el('div', { class: 'dm-host' }, [host])].filter(Boolean));
  }

  window.MxDomain = { init: init, renderScreen: renderScreen };
})();
