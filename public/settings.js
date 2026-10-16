/* MxScout — Settings: one screen for what MxScout keeps for every project, and for the open one.
 *
 * Karol, 2026-10-16: the MxScout folder and the default language sat on the projects list as two loose
 * lines, the language of a project and its Claude skills on the Documentation page — "it should all be in
 * Settings". So: one screen, two sections, said to be what they are (Karol, later that day: "global
 * settings, project settings — the language is split over two places").
 *   Global settings (every project) — the MxScout folder (store.js home), the default language (docs.js),
 *     the theme (theme.js) and your name, stamped on comments. Reached from the sidebar's foot and the
 *     projects page with no project open (state.appSettings, in home.js's frame), and under a project's own.
 *   Project settings — where it is kept, first and in words (home.js keptLine), with the other places it
 *     can be kept; its name, the language its written content is in (the default named beside it),
 *     Developer tools (devtools.js), the Claude skills in its Mendix project (repoui.js), its package key
 *     (transfer.js) and its Marketplace modules.
 * Every row is one setting with its label on the left and what it does in a line under it. Nothing here
 * is written but through the module that owns it.
 */
(function () {
  'use strict';

  var el, state, store, render, setMessage, renameProject, setShowMarketplaceModules, reportWriteFailure, formatBytes, formatDate, focused;

  // api: { el, state, store, render, setMessage, renameProject, setShowMarketplaceModules, reportWriteFailure, formatBytes, formatDate } — app.js.
  function init(api) {
    el = api.el; state = api.state; store = api.store; render = api.render; setMessage = api.setMessage;
    renameProject = api.renameProject; setShowMarketplaceModules = api.setShowMarketplaceModules;
    reportWriteFailure = api.reportWriteFailure; formatBytes = api.formatBytes; formatDate = api.formatDate;
    focused = api.focused || function () { return document.activeElement; };
  }

  // One setting: its label, the control, and a line on what it does.
  function row(label, control, hint, cls) {
    return el('div', { class: 'set-row' + (cls ? ' ' + cls : '') }, [
      el('div', { class: 'set-label', text: label }),
      el('div', { class: 'set-value' }, [control, hint ? el('p', { class: 'hint set-hint', text: hint }) : null].filter(Boolean))
    ]);
  }
  function section(title, sub, rows) {
    return el('section', { class: 'card set-sec' }, [
      el('div', { class: 'set-sec-head' }, [el('h3', { class: 'live-h', text: title }), sub ? el('p', { class: 'muted set-sec-sub', text: sub }) : null].filter(Boolean))
    ].concat(rows.filter(Boolean)));
  }

  // ---------- MxScout: every project ----------
  function mxscoutSection() {
    var home = store.homeHandle(), canKeep = window.MxFolderUI.supported();
    var folder = canKeep ? el('div', { class: 'set-inline' }, [
      el('code', { class: 'set-folder-name' + (home ? '' : ' none'), text: home ? home.name : 'not set' }),
      el('button', { type: 'button', class: 'btn btn-sm home-pick', text: home ? 'Change…' : 'Choose…', onclick: function () { window.MxFolderUI.chooseHome(); } })
    ]) : el('p', { class: 'muted', text: 'This browser cannot keep projects in folders — that needs Chrome or Edge.' });
    var authorInput = el('input', { type: 'text', class: 'set-author', placeholder: 'e.g. Karol, QA', value: (state.settings.author && state.settings.author.name) || '' });
    authorInput.addEventListener('change', function () {
      var value = authorInput.value.trim();
      state.settings.author = { name: value };
      // Who wrote a comment is stamped on it when it is created, so this is set before a review starts.
      store.put('settings', { key: 'author', value: { name: value } }).then(function () {
        setMessage(value ? 'Your name is set to "' + value + '".' : 'Your name is cleared.', 'ok');
        render();
      }, reportWriteFailure);
    });
    return section('Global settings', 'MxScout — for every project.', [
      row('MxScout folder', folder, home
        ? 'Every project is kept here, a folder of its own each. For one kept in its Mendix project, what is yours — the model’s copy, Claude’s inbox, Assist — is here, and only what the team commits is in the Mendix project. Claude finds it with /mxscout-project.'
        : 'Choose one folder, once: every project is kept there, a folder of its own each, and nothing of yours goes into a Mendix project. Claude finds your projects there with /mxscout-project.', 'set-home'),
      row('Default language', el('span', { class: 'set-select' }, [window.MxDocs.defaultLanguageSelect()]), 'What Claude writes — descriptions, processes, risks, notes — for every new project, and every project that has not chosen its own. A project chooses its own in its Project settings.', 'set-lang-default'),
      row('Theme', window.MxTheme.switcher(), null, 'set-theme'),
      row('Your name', authorInput, 'Stamped on the comments you write (Developer tools). It stays in this browser.', 'set-name')
    ]);
  }

  // ---------- this project ----------
  // Where else it can be kept, as buttons beside where it is: a folder on disk, or the Mendix project (mxscout/).
  function keptActions(project, info) {
    if (!window.MxFolderUI.supported()) return null;
    var btns = [];
    if (!info) btns.push(el('button', { type: 'button', class: 'mf-btn set-kept-folder', text: store.homeHandle() ? 'Keep in my MxScout folder…' : 'Keep in a folder…', onclick: function () { window.MxFolderUI.keep(project); } }));
    if (!info || info.layout !== 2) btns.push(el('button', { type: 'button', class: 'mf-btn set-kept-repo', text: 'Keep in the Mendix project (mxscout/)…', title: 'The documentation goes into the Mendix project, for the team, through git', onclick: function () { window.MxRepoUI.startMove(project); } }));
    if (info) btns.push(el('button', { type: 'button', class: 'mf-btn set-kept-files', text: 'Its files…', title: 'What is written where, and when', onclick: function () { state.detail.view = 'docs'; state.detail.docsTab = 'folder'; render(); } }));
    var b = window.MxFolderUI.headerButton(project);
    if (b) btns.unshift(b);
    return el('div', { class: 'set-inline set-kept-a' }, btns);
  }
  function projectSection(project) {
    var nameInput = el('input', { type: 'text', class: 'set-project-name', value: project.name });
    nameInput.addEventListener('change', function () {
      var value = nameInput.value.trim();
      if (!value || value === project.name) { nameInput.value = project.name; return; }
      renameProject(project.id, value).then(render);
    });
    var info = store.folderInfo(project.id);
    // What the model was read from, in words — the stored kind is a key, not a label.
    function sourceLabel(src) {
      var kind = src && src.kind, file = src && src.fileName;
      var label = { 'mpr-folder': 'A Mendix project', 'legacy-json': 'An imported model JSON', 'package': 'A .mxscout package', 'documentation': 'Exported documentation' }[kind];
      if (!label) return kind || 'Unknown';
      return file ? label + ' (' + file + ')' : label;
    }
    var facts = [
      ['Model version', window.MxModelVersion.label(project.summary && project.summary.version)],
      ['Source', sourceLabel(project.source)],
      ['Model size', formatBytes(project.bytes)],
      ['Created', formatDate(project.createdAt)],
      ['Last updated', formatDate(project.updatedAt)],
      ['Eviction protection', state.settings.persisted === true ? 'Granted — this browser will not clear MxScout under disk pressure'
        : state.settings.persisted === false ? 'Not granted — this browser may clear MxScout under disk pressure, so keep the project in a folder, or export it' : 'Unknown']
    ];
    // Read from rawModel: what is hidden right now, which the filtered model cannot say.
    var market = (state.detail && state.detail.rawModel ? state.detail.rawModel.modules || [] : []).filter(function (m) { return m && m.fromAppStore; }).map(function (m) { return m.name; })
      .sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    var marketRow = null;
    if (market.length) {
      var box = el('input', { type: 'checkbox' });
      if (state.detail.showMarketplaceModules) box.setAttribute('checked', 'checked');
      box.addEventListener('change', function () { setShowMarketplaceModules(project, box.checked); });
      marketRow = row('Marketplace modules', el('label', { class: 'ack-row' }, [box, el('span', { text: ' Show them while browsing' })]),
        (state.detail.showMarketplaceModules ? 'Shown: ' : 'Hidden, as if they were not in the project: ') + market.join(', ') + '.', 'set-market');
    }
    var skills = window.MxRepoUI ? window.MxRepoUI.skillsCard(project) : null;
    var def = window.MxDocs.defaultLanguage();
    return section('Project settings', project.name + ' — this project only.', [
      el('div', { class: 'set-row set-kept' }, [el('div', { class: 'set-label', text: 'Kept in' }), el('div', { class: 'set-value' }, [window.MxHome.keptLine(project, true), keptActions(project, info)].filter(Boolean))]),
      row('Name', nameInput, null, 'set-name-project'),
      row('Language', el('span', { class: 'set-select' }, [window.MxDocs.languageSelect(project)]), 'What Claude writes for this project is in this language, every time — its own choice; the global default is ' + window.MxDescribe.languageName(def || 'en') + '. Headings and labels stay English.', 'set-lang'),
      el('div', { class: 'set-row set-devtools' }, [el('div', { class: 'set-label', text: 'Developer tools' }), el('div', { class: 'set-value' }, [window.MxDevTools.card(project)])]),
      skills ? el('div', { class: 'set-row set-skills' }, [el('div', { class: 'set-label', text: 'Claude skills' }), el('div', { class: 'set-value' }, [skills])]) : null,
      el('div', { class: 'set-row set-key' }, [el('div', { class: 'set-label', text: 'Packages' }), el('div', { class: 'set-value' }, [window.MxTransfer.keyCard(project)])]),
      marketRow,
      el('div', { class: 'set-row set-facts' }, [el('div', { class: 'set-label', text: 'About it' }), el('div', { class: 'set-value' }, [el('div', { class: 'kv' }, facts.map(function (f) {
        return el('div', { class: 'kv-row' }, [el('span', { class: 'kv-key', text: f[0] }), el('span', { class: 'kv-val', text: f[1] })]);
      }))])])
    ]);
  }

  // The screen: MxScout's settings, then — with a project open — the project's. While a list or a field on it
  // has the focus and no setting changed, the same screen is handed back: a folder's tick every two seconds,
  // or anything else that draws the app, does not take the list from under the person's hands (app.js puts
  // the focus back on it). A setting that changed draws it anew.
  var kept = null;
  function signature(project) {
    var info = project ? store.folderInfo(project.id) : null;
    return JSON.stringify([project ? [project.id, project.name, project.contentLanguage || null, !!project.devTools, !!project.showMarketplaceModules] : null,
      store.homeInfo(), window.MxDocs.defaultLanguage(), state.settings.theme, state.settings.author, state.settings.persisted,
      info ? [info.name, info.layout, info.repoName, info.localName, info.path, info.skills] : null]);
  }
  function renderPage(project) {
    var sig = signature(project), f = focused();
    if (kept && kept.sig === sig && f && kept.node.contains(f) && /^(SELECT|INPUT|TEXTAREA)$/.test(f.tagName)) return kept.node;
    var node = build(project);
    kept = { sig: sig, node: node };
    return node;
  }
  function build(project) {
    // With a project open, its own settings first; the global ones under them, said to be for every project.
    return el('div', { class: 'set-page' }, project ? [projectSection(project), mxscoutSection()]
      : [mxscoutSection(), el('p', { class: 'muted set-noproject', text: 'Open a project to see its own settings here.' })]);
  }

  window.MxSettings = { init: init, render: renderPage };
})();
