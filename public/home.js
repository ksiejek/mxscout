/* MxScout — the projects page: where MxScout opens, and where the MxScout logo leads.
 *
 * Karol, 2026-10-16: the list of projects was the one screen left in the old look — a row of buttons over
 * a list with seven buttons on every project — and it did not say where a project is kept, which is what a
 * person needs to know before they tell Claude where to look ("it says there is no mxscout/ in the
 * project — there isn't, I don't want it there"). So, in the redesigned screens' frame:
 *   - a header: the projects, a search over them, + New project, and the rest behind ⋯;
 *   - setting MxScout up once, while it is not: the MxScout folder and the language Claude writes in;
 *   - a card per project: its name and Mendix version, WHERE IT IS KEPT — your MxScout folder, a folder
 *     of its own, its Mendix project (mxscout/), or this browser only — said in words, with what that means
 *     for Claude, its numbers, and its actions behind ⋯;
 *   - the global settings in one line at the foot, and the way to them.
 * Where a project is kept is said by keptIn(), which Settings (settings.js) shows too.
 */
(function () {
  'use strict';

  var deps = null; // { el, state, store, render, setMessage, navIcon, openProject, openGuide, openAbout, openAppSettings, openReplaceModel, newProjectCard, formatDate, formatBytes }
  var SETUP_KEY = 'homeSetupHidden';

  function init(d) {
    deps = d;
    deps.store.get('settings', SETUP_KEY).then(function (r) { hidden = !!(r && r.value); deps.render(); }, function () {});
  }
  var hidden = false;
  function el(t, a, c) { return deps.el(t, a, c); }
  function txt(s) { return document.createTextNode(s); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------- where a project is kept ----------
  // inHome answers asynchronously; the answer is kept here and the page drawn again once it is in.
  var homeOf = {};
  function askInHome(id) {
    var key = id + '|' + ((deps.store.homeInfo() || {}).name || '');
    if (homeOf[key] !== undefined) return homeOf[key];
    homeOf[key] = null;
    deps.store.inHome(id).then(function (v) { if (homeOf[key] !== v) { homeOf[key] = v; deps.render(); } }, function () {});
    return null;
  }
  // → { kind: 'home' | 'folder' | 'repo' | 'browser', title, place, detail, claude }
  function keptIn(project) {
    var store = deps.store, info = store.folderInfo(project.id), home = store.homeInfo();
    if (!info) {
      return { kind: 'browser', title: 'This browser only', place: null,
        detail: 'In no folder on disk — nothing in the Mendix project.',
        claude: 'Claude reaches it only while you share it (Documentation → Other ways → Share with an agent). Keep it in a folder to let Claude read it by itself.' };
    }
    if (info.layout === 2) {
      var local = info.localName && home ? 'your MxScout folder (' + home.name + ')' : 'mxscout/.local/ (not committed)';
      return { kind: 'repo', title: 'In its Mendix project', place: (info.repoName || info.name) + '/mxscout',
        detail: 'The documentation is in the Mendix project and goes to git with the app; what is yours stays in ' + local + '.',
        claude: 'Start Claude in the Mendix project folder — it finds mxscout/ by itself.' };
    }
    var inside = home ? askInHome(project.id) : false;
    if (inside) {
      return { kind: 'home', title: 'In your MxScout folder', place: home.name + '/' + info.name,
        detail: 'Everything is there — nothing of it is in the Mendix project.',
        claude: 'Ask Claude: /mxscout-project ' + project.name + ' — from any folder.' };
    }
    return { kind: 'folder', title: 'In a folder of its own', place: info.path || info.name,
      detail: 'Everything is in that folder — nothing of it is in the Mendix project.',
      claude: 'Start Claude in that folder, or give it the folder’s path.' };
  }
  var KEPT_ICON = { browser: 'monitor', home: 'folder', folder: 'folder', repo: 'modules' };
  // The where-kept block: on a card (what it means for Claude), and on top of a project's Settings (full: and what is where).
  function keptLine(project, full) {
    var k = keptIn(project), info = deps.store.folderInfo(project.id);
    var warn = info && { 'needs-permission': 'The browser needs your permission to write it again.', missing: 'The folder is not where it was.', error: 'Writing it failed.' }[info.status];
    return el('div', { class: 'home-kept', 'data-kind': k.kind }, [
      el('span', { class: 'home-kept-i', 'aria-hidden': 'true' }, [deps.navIcon(KEPT_ICON[k.kind], 15)]),
      el('div', { class: 'home-kept-t' }, [
        el('div', { class: 'home-kept-h' }, [el('strong', { text: k.title }), k.place ? el('code', { class: 'home-kept-place', text: k.place }) : null].filter(Boolean)),
        full ? el('p', { class: 'home-kept-d', text: k.detail }) : null,
        el('p', { class: 'home-kept-c' }, [el('b', { text: 'Claude: ' }), txt(k.claude)]),
        warn ? el('p', { class: 'warn-text home-kept-w', text: warn }) : null
      ].filter(Boolean))
    ]);
  }

  // ---------- the header ----------
  function menu(open, items, label, onToggle) {
    return el('div', { class: 'xe-more' }, [
      el('button', { type: 'button', class: 'xe-icon-btn', 'aria-label': label, title: label, 'aria-expanded': open ? 'true' : 'false', text: '⋯', onclick: function (e) { e.stopPropagation(); onToggle(); } }),
      open ? el('div', { class: 'xe-menu', role: 'menu' }, items.filter(Boolean)) : null
    ].filter(Boolean));
  }
  function item(text, fn, cls) {
    return el('button', { type: 'button', role: 'menuitem', class: cls || null, text: text, onclick: function () { deps.state.homeMenu = null; fn(); } });
  }
  function header(count) {
    var state = deps.state, store = deps.store;
    var canKeep = window.MxFolderUI.supported();
    var browserOnly = state.projects.filter(function (p) { return !store.hasFolder(p.id); }).length;
    var search = el('input', { type: 'search', class: 'xe-search-input home-search', placeholder: 'Find a project…', 'aria-label': 'Find a project' });
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('.home-grid .project-card'), function (c) { c.hidden = !!q && (c.getAttribute('data-name') || '').indexOf(q) === -1; });
    });
    var open = state.homeMenu === 'page';
    return el('header', { class: 'xe-head home-head' }, [
      el('div', { class: 'xe-title' }, [
        el('h1', { text: 'Projects' }),
        el('p', { class: 'xe-sub', text: count ? plural(count, 'Mendix application', 'Mendix applications') + ', each read from its model' : 'Mendix applications, read from their model' })
      ]),
      count > 3 ? el('label', { class: 'xe-search' }, [deps.navIcon('search', 15), search]) : el('span', { class: 'home-head-gap' }),
      el('div', { class: 'xe-head-right' }, [
        el('button', { type: 'button', class: 'mf-btn primary home-new', text: '+ New project', onclick: function () { state.newProject.open = true; deps.setMessage(null); deps.render(); } }),
        menu(open, [
          canKeep ? item('Open a project folder…', function () { window.MxFolderUI.openFolder(); }) : null,
          count ? item('Export documentation…', function () { window.MxBundle.startExport(); }) : null,
          canKeep && browserOnly ? item('Move all projects to folders…', function () { window.MxFolderUI.startMoveAll(); }) : null,
          item('Settings', function () { deps.openAppSettings(); }),
          item('Getting started', function () { deps.openGuide(); deps.render(); }),
          item('About & security', function () { deps.openAbout(); })
        ], 'More — open a folder, export, move to folders, settings', function () { state.homeMenu = open ? null : 'page'; deps.render(); })
      ])
    ]);
  }

  // ---------- setting MxScout up, once ----------
  function setup() {
    var store = deps.store, canKeep = window.MxFolderUI.supported(), home = store.homeHandle(), lang = window.MxDocs.defaultLanguage();
    if (hidden || ((!canKeep || home) && lang)) return null;
    var steps = [];
    if (canKeep) {
      steps.push(el('li', { class: 'home-step' + (home ? ' done' : '') }, [
        el('span', { class: 'home-step-n', text: home ? '✓' : '1' }),
        el('div', { class: 'home-step-t' }, [
          el('strong', { text: 'Your MxScout folder' }),
          el('p', { class: 'muted', text: home ? 'Every new project gets a folder of its own in ' + home.name + '.' : 'Set your MxScout folder: every project gets a folder of its own there — the model, what Claude wrote, your notes — and nothing of yours goes into a Mendix project.' })
        ]),
        home ? el('code', { class: 'home-step-v', text: home.name }) : el('button', { type: 'button', class: 'mf-btn setup-pick home-step-v', text: 'Choose…', onclick: function () { window.MxFolderUI.chooseHome(function () { deps.render(); }); } })
      ]));
    }
    steps.push(el('li', { class: 'home-step' + (lang ? ' done' : '') }, [
      el('span', { class: 'home-step-n', text: lang ? '✓' : String(steps.length + 1) }),
      el('div', { class: 'home-step-t' }, [
        el('strong', { text: 'The language Claude writes in' }),
        el('p', { class: 'muted', text: 'Descriptions, processes, risks and notes, for every project — English until you choose. A project can still choose its own.' })
      ]),
      el('span', { class: 'set-select home-step-v' }, [window.MxDocs.defaultLanguageSelect()])
    ]));
    return el('section', { class: 'home-setup home-line', 'data-home': home ? 'set' : 'none' }, [
      el('div', { class: 'home-setup-h' }, [
        el('div', {}, [el('h2', { text: 'Set up MxScout once' }), el('p', { class: 'muted', text: 'Two choices every project follows. Both can be changed later in Settings.' })]),
        el('div', { class: 'home-setup-a' }, [
          el('button', { type: 'button', class: 'mf-btn home-settings', text: 'Open Settings', onclick: function () { deps.openAppSettings(); } }),
          el('button', { type: 'button', class: 'mf-btn home-setup-hide', text: 'Not now', title: 'Hide this; Settings has both', onclick: function () { hidden = true; store.put('settings', { key: SETUP_KEY, value: true }).catch(function () {}); deps.render(); } })
        ])
      ]),
      el('ol', { class: 'home-steps' }, steps)
    ]);
  }

  // ---------- a project ----------
  function initial(name) { var m = String(name || '?').trim().match(/[A-Za-z0-9]/); return (m ? m[0] : '?').toUpperCase(); }
  function stat(n, label) { return el('div', { class: 'home-stat' }, [el('b', { text: String(n || 0) }), el('span', { text: label })]); }
  function card(project) {
    var state = deps.state, store = deps.store, s = project.summary || {};
    var open = state.homeMenu === project.id;
    var sub = [s.mendixVersion ? 'Mendix ' + s.mendixVersion : null, s.version && window.MxModelVersion.known(s.version) ? window.MxModelVersion.short(s.version) : null].filter(Boolean).join(' · ');
    var go = function () { deps.openProject(project.id).then(deps.render); };
    var folderItems = window.MxFolderUI.supported() ? window.MxFolderUI.menuItem(project, function () { state.homeMenu = null; }) : null;
    var acts = [
      item('Open', go),
      item('Rename…', function () { state.renameProject = project.id; deps.render(); }),
      item('Replace model…', function () { deps.openReplaceModel(project.id); }),
      item('Package…', function () { window.MxTransfer.startPackaging(project.id); }),
      folderItems,
      item('Delete project', function () { state.confirmDelete = project.id; deps.render(); }, 'danger')
    ];
    var c = el('article', { class: 'project-card home-card' + (project.id === state.activeId ? ' active' : ''), 'data-id': project.id, 'data-name': String(project.name || '').toLowerCase() }, [
      el('div', { class: 'home-card-top' }, [
        el('button', { type: 'button', class: 'home-card-open', title: 'Open ' + project.name, onclick: go }, [
          el('span', { class: 'home-avatar', 'aria-hidden': 'true', text: initial(project.name) }),
          el('span', { class: 'home-card-name' }, [el('span', { class: 'project-name', text: project.name }), el('span', { class: 'home-card-sub', text: sub || 'Read from its model' })])
        ]),
        menu(open, acts, 'Actions for ' + project.name + ' — rename, replace the model, package, folder, delete', function () { state.homeMenu = open ? null : project.id; deps.render(); })
      ]),
      keptLine(project, false),
      el('div', { class: 'home-stats' }, [stat(s.modules, 'modules'), stat((s.microflows || 0) + (s.nanoflows || 0), 'flows'), stat(s.pages, 'pages'), stat(s.entities, 'entities')]),
      el('div', { class: 'home-card-foot' }, [
        el('span', { class: 'muted', text: 'Updated ' + deps.formatDate(project.updatedAt) }),
        window.MxFolderUI.headerButton(project),
        el('button', { type: 'button', class: 'mf-btn home-card-go', text: 'Open →', onclick: go })
      ].filter(Boolean))
    ]);
    return c;
  }
  function newTile() {
    return el('button', { type: 'button', class: 'home-tile-new', onclick: function () { deps.state.newProject.open = true; deps.setMessage(null); deps.render(); } }, [
      el('span', { class: 'home-tile-plus', 'aria-hidden': 'true', text: '+' }),
      el('strong', { text: 'New project' }),
      el('span', { class: 'muted', text: 'From a Mendix project folder, or a .mxscout package' })
    ]);
  }

  // ---------- the global settings, in a line ----------
  function globalLine() {
    var home = deps.store.homeInfo(), lang = window.MxDocs.defaultLanguage(), canKeep = window.MxFolderUI.supported();
    return el('div', { class: 'home-global' }, [
      el('span', { class: 'home-global-h', text: 'Global settings' }),
      canKeep ? el('span', {}, [txt('MxScout folder '), el('code', { text: home ? home.name : 'not set' })]) : null,
      el('span', {}, [txt('Language '), el('b', { text: lang ? window.MxDescribe.languageName(lang) : 'English (not chosen)' })]),
      el('button', { type: 'button', class: 'mf-btn home-global-go', text: 'Settings', onclick: function () { deps.openAppSettings(); } })
    ].filter(Boolean));
  }

  // ---------- the page ----------
  function render() {
    var state = deps.state;
    var list = state.projects || [];
    var body;
    if (state.newProject.open) {
      body = [deps.newProjectCard()];
    } else if (!list.length) {
      body = [setup(), el('section', { class: 'home-empty' }, [
        el('h2', { text: 'Read your first Mendix app' }),
        el('p', { class: 'muted', text: 'A project is a Mendix app’s model, read straight from its project folder — nothing is installed in the app, nothing is sent anywhere. MxScout lays it out as documentation: its processes, the domain model, every microflow drawn as Studio Pro draws it, and what could go wrong.' }),
        el('div', { class: 'home-empty-a' }, [
          el('button', { type: 'button', class: 'mf-btn primary', text: '+ New project', onclick: function () { state.newProject.open = true; deps.setMessage(null); deps.render(); } }),
          el('button', { type: 'button', class: 'mf-btn', text: 'Getting started', onclick: function () { deps.openGuide(); deps.render(); } })
        ])
      ])];
    } else {
      body = [setup(), el('div', { class: 'project-list home-grid' }, list.map(card).concat([newTile()])), globalLine()];
    }
    var page = el('div', { class: 'xe xe-pagescreen home' }, [
      header(list.length),
      el('div', { class: 'xe-page view-body home-body', 'data-keep-scroll': 'page|home' }, body.filter(Boolean))
    ]);
    // A click beside an open menu closes it.
    if (state.homeMenu) page.addEventListener('click', function (e) { if (!(e.target.closest && e.target.closest('.xe-more'))) { state.homeMenu = null; deps.render(); } });
    return page;
  }

  // A screen with no project open (Settings) in the same frame: its title, a line under it, and the body.
  function shell(title, sub, body) {
    return el('div', { class: 'xe xe-pagescreen' }, [
      el('header', { class: 'xe-head' }, [el('div', { class: 'xe-title' }, [el('h1', { text: title }), el('p', { class: 'xe-sub', text: sub })])]),
      el('div', { class: 'xe-page view-body', 'data-keep-scroll': 'page|' + title }, [body])
    ]);
  }

  window.MxHome = { init: init, render: render, keptIn: keptIn, keptLine: keptLine, shell: shell };
})();
