/* MxScout — a simple, local Mendix model explorer for developers and testers.
 * Single vanilla-JS IIFE, no framework, no bundler (same shape as MxSonar's
 * public/app.js, deliberately much smaller).
 *
 * Regions below are marked with ---------- name ---------- banners; grep for
 * those to jump around.
 *
 * Everything on this screen is client-side: the server serves these static
 * files and nothing else. Projects (a name + one model) live in the browser's own database — see
 * store.js — and, when the person chose one, in a folder on disk that this
 * tab writes (folder.js, folderui.js). Never on a server.
 */
(function () {
  'use strict';

  // ---------- DOM helper ----------
  // The one DOM-construction helper used everywhere. `text:` maps to
  // textContent, and there is deliberately NO `html:` escape hatch: every
  // string this app renders ultimately came out of a JSON file someone was
  // handed, so an innerHTML sink would be an XSS hole with a very plausible
  // delivery route. If something ever genuinely needs markup, build it from
  // elements — don't add `html:` back.
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // ---------- state ----------
  var state = {
    projects: [],        // project metadata, newest first (see storage region)
    activeId: null,      // project currently opened, or null on the list screen
    message: null,       // { text, kind: 'error'|'ok' } shown under the current screen
    newProject: {        // the "new project" form's own transient state
      open: false,
      name: '',
      file: null,        // { fileName, text } — read but not yet committed
      busy: false,
      store: null        // where it is kept: a folder (first) or this browser (folderui.js choice)
    },
    replaceModel: null,  // { id } — the "Replace model" modal, offering folder or file just like New project
    moveAll: null,       // "Move all projects to folders" (folderui.js): { step, parent, rows }
    folderClash: null,   // a folder opened that holds a project this browser already has (folderui.js)
    folderNotice: null,  // a project created but its folder could not be written: said until dismissed
    confirmDelete: null, // project id awaiting delete confirmation
    findings: [],        // comments for the open project (see comments.js)
    exports: [],         // what has been sent from this project, and when
    renameProject: null, // project id whose Rename window is open
    packaging: null,     // the encrypted-package flow: { projectId, step, code, … }
    unlock: null,        // a package waiting for its access code
    mprImport: null,     // importing a Mendix project folder: { step, name, grouped, phase, done, total, error, worker }
    // Small per-install preferences, loaded once at boot: who you are (stamped
    // on comments), and whether the browser granted eviction protection.
    settings: { author: null, persisted: null },
    storageError: null,  // browser storage unavailable at all (private mode, disabled)
    storageErrorDetail: null, // what the browser said, shown under that message
    // The About screen (see its region below) — { health } while open, null
    // otherwise. It is a top-level screen rather than a project tab: a
    // security reviewer must be able to reach it before any project exists,
    // and opening it must not disturb the project a tester has open.
    about: null,
    // The Getting started guide — a static walkthrough, no project needed.
    // Same top-level-screen treatment as About: null when closed, truthy
    // while open, and mutually exclusive with it (see openGuide/openAbout).
    guide: null,
    switcher: false,     // the project switcher's menu is open (sidebar)
    // Log analysis — the Log Viewer: the stream, Insights and slow queries
    // (see public/logs/). A top-level screen like About and Getting
    // started: it needs no project, so opening it leaves the open project
    // alone, and it is mutually exclusive with those two. The module keeps
    // its own state (a loaded log is large and lives in memory only), so
    // this is only the flag that says whether it is on screen.
    logs: null,
    // Set by openProject() while a project is open, cleared by closeProject().
    // Holds the PARSED model (kept out of the project index so the list stays
    // cheap) plus everything the browsing views need — which view is active,
    // the text/module filters, the entity popup, and the chosen role.
    detail: null         // { model, view, filter, hiddenModules, selectedEntity, role }
  };

  var _messageTimer = null;
  // `action` is optional: { label, onclick }. It is how a destructive action
  // offers to be taken back — a confirmation asks before the fact and gets
  // dismissed by habit, an undo catches the slip after it. Phase 3 audit.
  function setMessage(text, kind, action) {
    if (_messageTimer) { clearTimeout(_messageTimer); _messageTimer = null; }
    state.message = text ? { text: text, kind: kind || 'error', action: action || null } : null;
    // A success toast is about what just happened, not a standing fact about
    // the screen — unlike an error, which stays until the thing it complains
    // about is fixed, it should get out of the way on its own instead of
    // following the user to every page they visit next.
    if (state.message && state.message.kind === 'ok') {
      var mine = state.message;
      // A message carrying an undo has to be read, decided on and clicked, so
      // it gets longer than one that only reports. Still short enough that it
      // does not follow the user to the next screen.
      _messageTimer = setTimeout(function () {
        _messageTimer = null;
        if (state.message === mine) { state.message = null; render(); }
      }, action ? 9000 : 4000);
    }
  }

  // ---------- storage ----------
  // Every persistent read and write in this app goes through public/store.js
  // (IndexedDB) — see that file for why localStorage was not enough once
  // comments entered the picture. What lives HERE is the in-memory picture of
  // that data plus the rules for keeping the two in step.
  //
  // The shape of the deal: reads are synchronous because everything the UI
  // needs is already in memory (the project list at boot, one model when a
  // project opens), and writes are asynchronous and optimistic — state changes
  // first, the record follows, and a failed write surfaces as a message rather
  // than a silently lost edit. render() stays synchronous, which is the only
  // reason the whole view layer did not have to change with the storage layer.
  var store = window.MxStore;
  var ACTIVE_SETTING = 'activeProject';

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Newest first, matching the order the list screen has always shown.
  function sortProjects() {
    state.projects.sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  // A write that fails must never pass silently: the user believes their edit
  // is saved, and the next thing they do is close the tab.
  function reportWriteFailure(err) {
    setMessage(
      'Could not save to this browser’s storage: ' + ((err && err.message) || 'unknown error') +
      '. Your last change may not survive a reload.',
      'error'
    );
    render();
  }

  function saveProjectMeta(project) {
    return store.put('projects', project).catch(reportWriteFailure);
  }

  var DEV_SECTIONS = window.MxDevTools.SECTIONS; // Developer tools (devtools.js): shown only in a project that has them on
  function devTools(project) { return window.MxDevTools.on(project || findProject(state.activeId)); }
  function loadProjects() {
    return store.getAll('projects').then(function (rows) {
      state.projects = rows;
      sortProjects();
      return store.get('settings', ACTIVE_SETTING);
    }).then(function (row) {
      var active = row ? row.value : null;
      state.activeId = state.projects.some(function (p) { return p.id === active; }) ? active : null;
    });
  }

  function setActive(id) {
    state.activeId = id;
    var write = id
      ? store.put('settings', { key: ACTIVE_SETTING, value: id })
      : store.delete('settings', ACTIVE_SETTING);
    // Losing only which project was last open is a cosmetic failure, so it
    // deliberately does not raise the banner that a lost edit would.
    return write.catch(function () { return null; });
  }

  // ---------- the built-in System module ----------
  // Mendix's own System module (User, Session, FileDocument, ...) ships with
  // the Runtime, not with a project: an .mpr file never contains a "System"
  // Unit at all (checked against two real projects — neither has one), which
  // is also why a flow parameter typed System.User only ever appears as a
  // bare qualified-name string, never as a parsed Entity, anywhere in this
  // codebase's model. But the module itself is the same in every Mendix app
  // and it never changes shape between projects, so unlike everything else
  // MxScout shows, it is safe to hard-code rather than parse — this list
  // adds it back as a fixed, always-present module rather than pretending
  // MxScout could read it out of any particular .mpr.
  // Attributes are deliberately left empty rather than guessed: they are not
  // stored in the project file either, and a wrong guess here would be wrong
  // data shown as fact, or a live query sent for a column that does not
  // exist in this project's actual Mendix version. Browsing still works (see
  // renderEntityDataTab) — a Data-tab query with no known columns still asks
  // the running app for real rows, and picking one for a flow parameter (the
  // gap this closes: "expects a System.User, which is not in this model")
  // works the same way any other entity's rows do.
  var BUILTIN_SYSTEM_ENTITIES = [
    { name: 'User', description: 'The account behind every session — the entity almost every project generalizes its own "Account" or "Employee" entity from.' },
    { name: 'UserRole', description: 'One project user role, when the project uses database (dynamic) user roles rather than only the static ones defined in Studio Pro.' },
    { name: 'Session', description: 'One active login session for a User.' },
    { name: 'FileDocument', description: 'A stored file — the generalization root for any entity that holds an uploaded document.' },
    { name: 'Image', description: 'A stored image; extends FileDocument.' },
    { name: 'Owned', description: 'Generalization mixin that adds an Owner (a User) to whatever extends it.' }
  ];

  function withBuiltinSystemModule(model) {
    var entities = model.entities.concat(BUILTIN_SYSTEM_ENTITIES.map(function (e) {
      return {
        module: 'System',
        name: e.name,
        qualifiedName: 'System.' + e.name,
        description: e.description,
        builtin: true,
        persistable: true,
        attributes: [],
        accessRules: []
      };
    }));
    var modules = model.modules.some(function (m) { return m.name === 'System'; })
      ? model.modules
      : model.modules.concat([{ name: 'System' }]);
    return Object.assign({}, model, { entities: entities, modules: modules });
  }

  // ---------- hiding Marketplace modules ----------
  // A real app's model is dominated by modules nobody browsing it actually
  // came to look at — CommunityCommons, Encryption, Atlas_Core and the rest
  // of what Studio Pro's own App Explorer buckets under "Marketplace
  // modules". Off by default (project.showMarketplaceModules, persisted);
  // when off, a marketplace module and everything in it is removed from the
  // model entirely — not dimmed, not a chip toggled off, gone — so the chip
  // row, the lists, the map and the sidebar counts all agree on what this
  // project actually looks like to browse. The flag brings it all back.
  //
  // A cross-module reference INTO a hidden module (an association whose
  // other end is hidden, a flow parameter typed to a hidden entity) is left
  // to point at something no longer in the model — findEntity/lookups
  // already return null for an unknown qualifiedName rather than throwing,
  // so this degrades to "that reference shows as unresolved", not a crash.
  // If that unresolved reference is confusing, the flag is the fix: turn
  // Marketplace modules back on for this project.
  function stripMarketplaceModules(model, show) {
    if (show) return model;
    var hiddenNames = {};
    (model.modules || []).forEach(function (m) { if (m && m.fromAppStore) hiddenNames[m.name] = true; });
    if (!Object.keys(hiddenNames).length) return model;
    var entities = (model.entities || []).filter(function (e) { return !e || !hiddenNames[e.module]; });
    var keptQNs = {};
    entities.forEach(function (e) { keptQNs[e.qualifiedName] = true; });
    function ownModuleKept(x) { return !x || !hiddenNames[x.module]; }
    return Object.assign({}, model, {
      modules: (model.modules || []).filter(function (m) { return !hiddenNames[m.name]; }),
      entities: entities,
      associations: (model.associations || []).filter(function (a) { return keptQNs[a.owner] && keptQNs[a.other]; }),
      microflows: (model.microflows || []).filter(ownModuleKept),
      nanoflows: (model.nanoflows || []).filter(ownModuleKept),
      pages: (model.pages || []).filter(ownModuleKept),
      // The tree renders from `modules`, so a hidden module's documents never
      // got drawn — but they were still counted, and the line above the tree
      // read "3,377 documents in 29 modules" while 23 modules' worth of them
      // were not there to find.
      documents: (model.documents || []).filter(ownModuleKept),
      folders: (model.folders || []).filter(ownModuleKept),
      userRoles: (model.userRoles || []).map(function (r) {
        return Object.assign({}, r, {
          moduleRoles: (r.moduleRoles || []).filter(function (mr) { return !hiddenNames[String(mr).split('.')[0]]; })
        });
      }),
      moduleRoles: (model.moduleRoles || []).filter(function (r) { return !r || !hiddenNames[r.module]; })
    });
  }

  // The one place a stored model becomes the model browsing views render:
  // the built-in System module folded in, then Marketplace modules stripped
  // per this project's own setting. System is added by MxScout itself and
  // never carries fromAppStore, so it is untouched by the strip regardless
  // of order — this order just means "add it, then decide what else shows".
  function deriveModel(rawModel, showMarketplaceModules) {
    return stripMarketplaceModules(withBuiltinSystemModule(rawModel), showMarketplaceModules);
  }

  // Shared by the Settings checkbox and the quick "N from Marketplace" chip
  // in the module row (renderModuleChips) — one flip of the same persisted
  // per-project flag, reachable from wherever you actually notice it is
  // hidden instead of only from a separate settings screen.
  function setShowMarketplaceModules(project, show) {
    project.showMarketplaceModules = show;
    return saveProjectMeta(project).then(function () {
      state.detail.showMarketplaceModules = show;
      state.detail.model = deriveModel(state.detail.rawModel, show);
      state.detail.selectedEntity = null;
      state.detail.selectedFlow = null;
      render();
    }, reportWriteFailure);
  }

  // Opening a project loads its stored model into state.detail. The model is
  // read once here (not on every render) and never kept in the project list,
  // so the list screen never pays for it. A missing or unreadable body is
  // surfaced as a message rather than throwing the whole screen away.
  // Resolves true when the project is open, false when it could not be.
  function openProject(id) {
    state.appSettings = null;
    // Its descriptions are read beside the model, not after it (docs.js readAhead), and so are what
    // was decided about its risks and its comments, which can carry risks: the documentation's data
    // is built with all three, so each one arriving late would build it again.
    if (window.MxDocs) window.MxDocs.readAhead(id);
    if (window.MxTriage) window.MxTriage.recordFor(id);
    var findingsRead = window.MxComments.loadFindings(id);
    return store.getModel(id).then(function (model) {
      if (!model) {
        setMessage('That project’s model is missing from this browser’s storage.', 'error');
        return false;
      }
      if (!Array.isArray(model.modules) || !Array.isArray(model.entities)) {
        setMessage('That project’s stored model could not be read.', 'error');
        return false;
      }
      setActive(id);
      var rawModel = model;
      var project = findProject(id);
      var showMarketplaceModules = !!(project && project.showMarketplaceModules);
      model = deriveModel(rawModel, showMarketplaceModules);
      var roles = Array.isArray(model.userRoles) ? model.userRoles : [];
      state.detail = {
        model: model,
        // The stored model, exactly as parsed — never the one above with the
        // built-in System module folded in, nor with Marketplace modules
        // stripped. Exporting/packaging a project (public/transfer.js) must
        // hand out only what is really in the project, not a browsing-time
        // addition or subtraction that would come back wrong on the next
        // import (System entities added twice, a copy of MxScout's own
        // fixed list baked into someone else's package, or a Marketplace
        // module silently missing from a package just because it happened
        // to be hidden when someone clicked Package).
        rawModel: rawModel,
        // Persisted on the project (see renderProjectSettings); kept here too
        // so the Settings toggle can recompute state.detail.model without
        // re-reading the project record on every click.
        showMarketplaceModules: showMarketplaceModules,
        // A project opens on its Overview (App Explorer is gone, Karol 2026-10-14:
        // nothing on it the other screens did not show).
        view: 'overview',
        mapZoom: 1,              // map view: scroll-to-zoom factor, kept across re-renders
        filter: '',              // free-text filter shared across views
        hiddenModules: {},       // moduleName -> true when its chip is toggled off
        moduleScope: null,       // set from the palette path: show ONLY this module
        selectedEntity: null,    // qualifiedName of the entity whose popup is open
        entityTab: 'attributes', // which tab that popup is showing
        selectedFlow: null,      // { kind, qualifiedName } of the flow whose popup is open
        flowTab: 'inputs',       // which tab THAT popup is showing
        flowPick: {},            // paramName -> { guids: [...] } — one entry per object input
        flowScalars: {},         // paramName -> the raw value typed for a plain-value input
        flowOverrides: {},       // paramName -> { attrName: rawValue } — attribute values to set on the chosen object before the run
        objectPicker: null,      // { paramName, entityQualifiedName, isList } while its picker is open
        createObject: null,      // qualifiedName of a non-persistable entity whose "create" popup is open
        // "entityQn#ruleIndex" -> { busy } | { total, matched } | { error }
        // What the running app answered when somebody asked how many rows a
        // row-level rule's constraint really matches. Keyed by entity so an
        // answer can never be shown against a different entity's rule.
        constraintCounts: {},
        data: null,              // the page of live rows a Data tab is showing
        transient: null,         // non-persistable entity: looked-up/created objects this session
        // Performance tab (see perf.js): what THIS PAGE knows about the
        // admin-port connection, which the server actually owns — `status`
        // and `statusKnown` are answers from /api/session/perf/status, and
        // `port`/`password` are only what is being typed on the way there.
        // The password is never persisted and is dropped from here the
        // moment the server accepts it. Deliberately separate from `live`
        // below: the admin port and the app are different connections and
        // either can be up without the other. `recordings` is null until the
        // Performance tab is first opened (lazy, like the Data pane).
        perf: {
          adminUrl: '', urlOk: false, password: '', status: {}, statusKnown: false,
          recordings: null, recordingsLoading: false, selectedId: null,
          tab: 'overview', _finishing: false
        },
        // 'all' shows everything regardless of role; otherwise a user-role name.
        // Everything by default (Karol, 2026-10-15): View as narrows it when asked.
        role: 'all',
        // Live-app connection: the URL the user last entered plus its
        // classification. A previously-approved URL is remembered on the project
        // and re-classified here (never trusted as still-allowed just because it
        // was stored) so the guard runs every time, not once.
        // token is the session token for the ONE bridge in the app tab (one
        // session per project view); script/scriptKey cache the snippet
        // currently on offer; exec is the run-a-flow side — its `acknowledged`
        // deliberately lives here so it resets every time a project is opened
        // (and on reload), never persisted.
        live: {
          url: '', result: null, token: null, script: null, scriptKey: null,
          exec: {
            acknowledged: false, ackOpen: false,
            status: {},
            confirm: null, armedCommandId: null, armedFlow: null, armedAt: null, armError: null
          }
        }
      };
      var storedUrl = (findProject(id) || {}).appUrl;
      if (storedUrl) {
        var cls = window.MxLive.classifyAppUrl(storedUrl);
        if (cls.verdict === 'allow') { state.detail.live.url = storedUrl; state.detail.live.result = cls; }
      }
      setMessage(null);
      // Comments belong to the project, so they arrive with it — along with
      // the record of what has already been sent, which is what makes "the
      // ones I have not sent yet" answerable. The view does not wait on
      // either: the model renders now and the lists fill in.
      findingsRead.then(render);
      store.byIndex('exports', 'byProject', id).then(function (rows) {
        state.exports = rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        render();
      });
      // A project kept in a folder: what changed there is taken in, then the folder is written —
      // in the background, after the screen is drawn from this browser's copy.
      if (store.hasFolder(id)) store.syncFolder(id, false).then(function () { render(); });
      return true;
    }, function (err) {
      setMessage('Could not read that project: ' + ((err && err.message) || 'storage error'), 'error');
      return false;
    });
  }

  function closeProject() {
    window.MxLive.stopPolling();
    setActive(null);
    state.detail = null;
    state.findings = [];
    state.exports = [];
    setMessage(null);
  }

  function findProject(id) {
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === id) return state.projects[i];
    }
    return null;
  }

  // ---------- model parsing ----------
  // Accepts either an MxSonar export envelope or a bare canonical model, so a
  // JSON someone saved straight out of /api/model still works.
  function parseModelText(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error('That file is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('That file is not a Mendix model export.');

    var model = (parsed.model && typeof parsed.model === 'object') ? parsed.model : parsed;

    if (!Array.isArray(model.modules) || !Array.isArray(model.entities)) {
      throw new Error(
        'That JSON does not look like a Mendix model export — expected "modules" and "entities" lists. ' +
        'Export the file from MxSonar (Export JSON in the top bar) and try again.'
      );
    }
    return model;
  }

  function countOf(model, key) {
    return Array.isArray(model[key]) ? model[key].length : 0;
  }

  // Only primitive, display-safe fields are lifted out of the model here —
  // the index is rendered on every screen, so it stays small and boring.
  function summarize(model) {
    var meta = (model.meta && typeof model.meta === 'object') ? model.meta : {};
    return {
      appName: typeof meta.appName === 'string' ? meta.appName : null,
      mendixVersion: typeof meta.mendixVersion === 'string' ? meta.mendixVersion : null,
      source: typeof meta.source === 'string' ? meta.source : null,
      generatedAt: typeof meta.generatedAt === 'string' ? meta.generatedAt : null,
      modules: countOf(model, 'modules'),
      entities: countOf(model, 'entities'),
      associations: countOf(model, 'associations'),
      microflows: countOf(model, 'microflows'),
      nanoflows: countOf(model, 'nanoflows'),
      pages: countOf(model, 'pages'),
      userRoles: countOf(model, 'userRoles'),
      // Absent on a project stored before the tree was read, which is why the
      // sidebar's count is allowed to be missing rather than shown as 0.
      documents: countOf(model, 'documents'),
      // Which version of the app it is (modelversion.js), without its reflog; null: not recorded.
      version: window.MxModelVersion.brief(window.MxModelVersion.clean(model.version)) || (model.version && model.version.why ? { commit: null, why: String(model.version.why).slice(0, 40) } : null)
    };
  }

  // ---------- formatting ----------
  function formatBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  function safeFileName(name) {
    return String(name || 'project').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  }

  // ---------- project operations ----------
  // All four mutate state.projects first and persist after: the list is the
  // truth the user is looking at, and a storage failure is reported rather
  // than rolled back — silently reverting a row the user just saw appear is
  // more confusing than saying the save did not stick.
  // Shared tail for every way a project gets created — from a JSON file
  // below, and from a Mendix project folder (public/mprImport.js). One
  // transaction for the row and its model — a project listed with no model
  // behind it is the inconsistency this storage layer exists to rule out, so
  // nothing enters state.projects until both have landed.
  // Where the project being created is kept: the New project card's choice, taken when the
  // person goes on to pick the model (the card itself closes then).
  var creatingIn = null;
  function finishCreatingProject(name, source, model) {
    var box = creatingIn;
    creatingIn = null;
    var now = new Date().toISOString();
    var record = {
      id: newId(),
      name: name,
      createdAt: now,
      updatedAt: now,
      source: source,
      fileName: (source && source.fileName) || null,
      bytes: JSON.stringify(model).length,
      summary: summarize(model),
      contentLanguage: window.MxDocs.defaultLanguage() // the default language (docs.js), when one is set
    };
    return store.saveProjectWithModel(record, model).then(function () {
      state.projects.push(record);
      sortProjects();
      // Into the folder chosen for it (folderui.js), never failing the creation.
      return window.MxFolderUI.linkNew(record, box);
    }).then(function () { return record; });
  }

  function createProject(name, fileName, text) {
    var model = parseModelText(text); // throws with a readable message
    // Store the unwrapped model, never the raw file text: the file may or may
    // not carry an export envelope around it, and re-saving that verbatim
    // would make exportProject() wrap an envelope inside another envelope —
    // a file this app would then refuse to import back.
    return finishCreatingProject(name, { kind: 'legacy-json', fileName: fileName || null }, model);
  }

  // Shared tail for every way an EXISTING project's model gets replaced —
  // from a JSON/.mxscout file below, and from a Mendix project folder
  // (public/mprImport.js, which shows a diff summary first).
  // opts.mirror === false: the model came from the project's folder and is not written back there.
  function finishReplacingProject(id, source, model, opts) {
    var project = findProject(id);
    if (!project) return Promise.reject(new Error('That project no longer exists.'));
    var updated = {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
      source: source,
      fileName: (source && source.fileName) || project.fileName,
      bytes: JSON.stringify(model).length,
      summary: summarize(model),
      appUrl: project.appUrl || null,
      showMarketplaceModules: project.showMarketplaceModules || false,
      agentAutoSave: project.agentAutoSave,
      contentLanguage: project.contentLanguage || null
    };
    return store.saveProjectWithModel(updated, model, opts).then(function () {
      var i = state.projects.indexOf(project);
      if (i !== -1) state.projects[i] = updated;
      // The open project is holding the OLD model in memory; swap it or the
      // views keep rendering a model that is no longer stored.
      if (state.activeId === id && state.detail) {
        state.detail.rawModel = model;
        state.detail.model = deriveModel(model, state.detail.showMarketplaceModules);
      }
      return updated;
    });
  }

  function replaceProjectModel(id, fileName, text) {
    var project = findProject(id);
    if (!project) return Promise.reject(new Error('That project no longer exists.'));
    var model = parseModelText(text);
    return finishReplacingProject(id, { kind: 'legacy-json', fileName: fileName || (project.source && project.source.fileName) || null }, model);
  }

  function renameProject(id, name) {
    var project = findProject(id);
    if (!project) return Promise.resolve(null);
    project.name = name;
    project.updatedAt = new Date().toISOString();
    return saveProjectMeta(project).then(function () { return project; });
  }

  function deleteProject(id) {
    // Deep: the model, every finding and the export history go with it, in
    // one transaction (see store.js). A folder it was kept in is forgotten,
    // and its files stay on disk.
    return store.deleteProjectDeep(id).then(function () {
      window.MxAssist.forget(id); window.MxKnowledge.forget(id); window.MxBasket.forget(id);
      state.projects = state.projects.filter(function (p) { return p.id !== id; });
      if (state.activeId === id) closeProject();
    });
  }

  // Handing the user a file. Generic enough that comments, reports and the
  // package all use it, so it lives here rather than with any one of them.
  function downloadText(text, fileName, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- file picking ----------
  // Shared by the "new project" and "replace model" file drops, both of which
  // accept a .mpr too — hands back the raw File, unread, so the caller can
  // tell a binary .mpr apart from a JSON/.mxscout BEFORE anything tries to
  // read it as text. Only the file's TEXT is read once that check is done —
  // the browser never exposes its real path, and this app never needs one.
  function pickModelFile(onFile, accept) {
    // No filter outside Chromium: Safari greys out a .mpr or .mxscout it cannot
    // type (see acceptFilter in mprImport.js).
    var input = el('input', { type: 'file', accept: window.MxMprImport.acceptFilter(accept || '.mxscout,.json,application/json,.mpr') });
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (file) onFile(file);
    });
    document.body.appendChild(input);
    input.click();
  }

  function readFileText(file, onRead) {
    var reader = new FileReader();
    reader.onload = function () { onRead(file.name, String(reader.result)); };
    reader.onerror = function () { setMessage('Could not read that file.', 'error'); render(); };
    reader.readAsText(file);
  }

  // ---------- brand ----------
  // A model is a graph, so the mark is one: three nodes and the two edges
  // between them, drawn IN the brand colour rather than knocked out of a
  // coloured tile. It has to survive being 16px in a browser tab, which is
  // why the strokes are heavy and there are only five shapes — anything
  // finer stops reading at that size. The redesign's version (spec 01
  // §3.1.1): the edges and two nodes in the secondary ink, the node they
  // start from in the accent. Colours through the style property, because an
  // SVG attribute cannot read var().
  function renderLogo(size) {
    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 34 34');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    // Edges first, so the nodes sit on top of them.
    [['9', '12', '24', '9'], ['9', '12', '17', '25']].forEach(function (e) {
      var line = document.createElementNS(svgNs, 'line');
      line.setAttribute('x1', e[0]); line.setAttribute('y1', e[1]);
      line.setAttribute('x2', e[2]); line.setAttribute('y2', e[3]);
      line.style.stroke = 'var(--ink2)'; line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    });
    [['9', '12', '4.6', 'var(--acc)'], ['24', '9', '4', 'var(--ink2)'], ['17', '25', '4', 'var(--ink2)']].forEach(function (c) {
      var circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', c[0]); circle.setAttribute('cy', c[1]); circle.setAttribute('r', c[2]);
      circle.style.fill = c[3];
      svg.appendChild(circle);
    });
    return svg;
  }

  // The sidebar's icons (spec 01 §3.8): 16-unit viewBox, stroked in the
  // colour of whatever holds them, decorative.
  var NAV_ICONS = {
    // The documentation's pages carry the documentation's own icons (docs-view.js navIcon).
    overview: [['path', 'M2.5 7.5L8 3l5.5 4.5V13H2.5z'], ['path', 'M6.5 13V9.5h3V13']],
    processes: [['path', 'M3 4h.01M3 8h.01M3 12h.01'], ['path', 'M6 4h7M6 8h7M6 12h7']],
    assist: [['path', 'M2 4.5h12v2.2a1.4 1.4 0 0 0 0 2.6v2.2H2V9.3a1.4 1.4 0 0 0 0-2.6z'], ['path', 'M10 5v1M10 7.5v1M10 10v1']],
    cases: [['path', 'M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z'], ['path', 'M6 7.5l1.5 1.5 3-3']],
    modules: [['path', 'M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z'], ['path', 'M2.5 4.8L8 7.8l5.5-3M8 7.8v6.4']],
    arch: [['path', 'M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM6 9.5h4v4H6z'], ['path', 'M4.5 6.5v1.5h7V6.5M8 8v1.5']],
    risks: [['path', 'M8 2l6 11H2z'], ['path', 'M8 6.5v3M8 11.5h.01']],
    quality: [['path', 'M3 8.5l3 3 7-7']],
    dev: [['path', 'M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5']],
    entities: [['rect', '2.5 3 11 10 1.5'], ['path', 'M2.5 6.5h11M6.5 6.5V13']],
    microflows: [['circle', '3 8 1.6'], ['rect', '6 5.5 4.5 5 1'], ['circle', '13.4 8 1.6'], ['path', 'M4.6 8H6M10.5 8h1.3']],
    nanoflows: [['rect', '1.8 4.5 12.4 7 3.5'], ['path', 'M5.5 8h4.5M8.5 6.3L10.2 8l-1.7 1.7']],
    pages: [['rect', '3 2 10 12 1.5'], ['path', 'M5.5 5.5h5M5.5 8h5M5.5 10.5h3']],
    security: [['path', 'M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z']],
    performance: [['path', 'M1.5 9h3l2-5 3 9 2-4h3']],
    logs: [['path', 'M3 4h10M3 8h10M3 12h6']],
    live: [['circle', '8 8 6'], ['path', 'M6.7 5.6l3.6 2.4-3.6 2.4z']],
    comments: [['path', 'M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z']],
    docs: [['path', 'M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z'], ['path', 'M3 11.5a2 2 0 0 1 2-2h7.5']],
    context: [['path', 'M2.5 3h11v7.5h-6l-3 2.5v-2.5h-2z'], ['path', 'M5 5.8h6M5 7.8h4']], // a conversation: what is put aside to talk over
    settings: [['path', 'M2.5 4.5h6M12 4.5h1.5M2.5 11.5h1.5M7.5 11.5h6'], ['circle', '10.3 4.5 1.7'], ['circle', '5.7 11.5 1.7']],
    plus: [['path', 'M8 3v10M3 8h10']],
    switch: [['path', 'M5 6l3-3 3 3M5 10l3 3 3-3']],
    sun: [['circle', '8 8 2.8'], ['path', 'M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1']],
    moon: [['path', 'M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z']],
    monitor: [['rect', '2 3 12 8.5 1.5'], ['path', 'M6 14h4M8 11.5V14']],
    search: [['circle', '7 7 4.5'], ['path', 'M10.5 10.5L14 14']],
    folder: [['path', 'M2 4.5V12.5h12V6H7.5L6 4.5z']]
  };
  function navIcon(name, size) {
    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', String(size || 16));
    svg.setAttribute('height', String(size || 16));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'nav-icon');
    (NAV_ICONS[name] || []).forEach(function (sh) {
      var n = document.createElementNS(svgNs, sh[0]);
      var v = sh[1].split(' ');
      if (sh[0] === 'path') n.setAttribute('d', sh[1]);
      else if (sh[0] === 'circle') { n.setAttribute('cx', v[0]); n.setAttribute('cy', v[1]); n.setAttribute('r', v[2]); }
      else { n.setAttribute('x', v[0]); n.setAttribute('y', v[1]); n.setAttribute('width', v[2]); n.setAttribute('height', v[3]); n.setAttribute('rx', v[4]); }
      svg.appendChild(n);
    });
    return svg;
  }

  // ---------- left sidebar ----------
  // Projects are the FIRST level and every one of them is always on screen, so
  // switching between two projects is one click rather than a trip back to a
  // list. The open project expands into its own sections underneath, which is
  // also why the old row of tabs above the content is gone: two places naming
  // the current section would eventually disagree.
  var PROJECT_SECTIONS = [
    // The documentation's pages, as MxScout's own screens (Karol, 2026-10-13):
    // what the application is, its processes and modules, and how it is built.
    // Read from the model, with what an agent wrote marked as the agent's.
    { key: 'overview', label: 'Overview', countKey: null, group: 'Application' },
    { key: 'processes', label: 'Processes', countKey: null, group: 'Application' },
    { key: 'modules', label: 'Modules', countKey: null, group: 'Application' },
    { key: 'arch', label: 'Architecture', countKey: null, group: 'Application' },
    { key: 'entities', label: 'Entities', countKey: 'entities', group: 'Model' },
    { key: 'microflows', label: 'Microflows', countKey: 'microflows', group: 'Model' },
    { key: 'nanoflows', label: 'Nanoflows', countKey: 'nanoflows', group: 'Model' },
    { key: 'pages', label: 'Pages', countKey: 'pages', group: 'Model' },
    // No count: the honest one would be "how many roles", and a number next
    // to "Security" reads as a problem count, which it is not.
    { key: 'security', label: 'Security', countKey: null, group: 'Model', dev: true },
    { key: 'performance', label: 'Performance', countKey: null, group: 'Runtime', dev: true },
    { key: 'risks', label: 'Risks', countKey: null, group: 'Review' },
    // What an agent helped with (Karol, 2026-10-15), by the items still open; Tickets and Changes are its tabs now.
    { key: 'assist', label: 'Assist', countKey: null, group: 'Review', assist: true },
    { key: 'cases', label: 'Solved cases', countKey: null, group: 'Review', cases: true }, // knowledge.js: the notes in knowledge/, counted
    { key: 'quality', label: 'Model quality', countKey: null, group: 'Review' },
    { key: 'dev', label: 'For developers', countKey: null, group: 'Review' },
    { key: 'comments', label: 'Comments', countKey: null, group: 'Review', dev: true },
    // Everything the model says about itself, drawn in the mendix-docs look and
    // exportable as one encrypted HTML file. Rebuilt from the model, so no
    // count: it is the whole project, not a pile of one kind of thing.
    { key: 'docs', label: 'Documentation', countKey: null, group: 'Review' },
    // What was put aside to talk over with a chat assistant (basket.js, Karol 2026-10-16), by how many elements.
    { key: 'context', label: 'Context', countKey: null, group: 'Review', basket: true },
    // The project's logs, read against its own model: a warning that names a microflow opens that
    // microflow, and can be turned into a comment on it. Also reachable with no project open (Tools).
    { key: 'logs', label: 'Logs', countKey: null, group: 'Runtime', dev: true },
    { key: 'live', label: 'Live app', countKey: null, group: 'Runtime', dev: true },
    // At the foot of the sidebar, not in a group (spec 01 §3.1.4).
    { key: 'settings', label: 'Settings', countKey: null, group: null }
  ];
  // The groups, in the redesign's order.
  var SECTION_GROUPS = ['Application', 'Model', 'Runtime', 'Review'];

  function sectionCount(project, section) {
    if (section.basket) return window.MxBasket.count(project.id) || null;
    if (section.cases) return window.MxKnowledge.count(project.id); if (section.assist) { var items = window.MxAssist.peek(project.id); return items && items.length ? window.MxAssist.openCount(items) : null; } // open, in progress or waiting
    if (section.key === 'comments') {
      // Comments are loaded only for the open project, so an unopened one has
      // no honest number to show rather than a wrong one.
      if (state.activeId !== project.id) return null;
      var n = window.MxComments.countFor(project.id);
      return n || null;
    }
    if (!section.countKey) return null;
    // The open project counts from the model it already has in memory; the
    // others from the summary stored on the row, which is exactly why that
    // summary exists — listing projects must never load a model.
    if (state.activeId === project.id && state.detail) {
      var list = state.detail.model[section.countKey];
      // No list at all is not a count of zero. A model from a JSON import, or
      // one stored before MxScout read the project tree, has no `documents` —
      // and a "0" beside App Explorer would say the project has no documents
      // in it, which is a different claim from "this model cannot say".
      return Array.isArray(list) ? list.length : null;
    }
    var summary = project.summary || {};
    return typeof summary[section.countKey] === 'number' ? summary[section.countKey] : null;
  }

  function goToSection(key) {
    var tab = { tickets: 'ticket', changes: 'idea' }[key]; // Tickets and Changes became tabs of Assist (2026-10-15)
    if (tab) { state.detail.docPatch = { view: 'assist', patch: { view: 'assist', akind: tab, aid: null } }; key = 'assist'; }
    state.about = null;
    state.guide = null;
    state.logs = null;
    state.newProject.open = false;
    state.detail.view = key;
    state.detail.selectedEntity = null;
    render();
  }

  // Settings with no project open: MxScout's own (settings.js); with one open, its Settings section shows both.
  function openAppSettings() { leaveOverlays(); state.newProject.open = false; if (state.activeId && state.detail) { state.detail.view = 'settings'; } else state.appSettings = true; render(); }
  function leaveOverlays() {
    state.appSettings = null;
    state.about = null;
    state.guide = null;
    state.logs = null;
    state.switcher = false;
  }

  // The projects, as the list a closed sidebar shows and the switcher's menu
  // shows: one row each, a click opens it.
  function renderProjectTree() {
    if (!state.projects.length) {
      return el('p', { class: 'tree-empty', text: 'No projects yet.' });
    }
    return el('div', { class: 'tree' }, state.projects.map(function (project) {
      var isActive = state.activeId === project.id && !!state.detail;
      return el('button', {
        class: 'tree-project' + (isActive ? ' active' : ''),
        'aria-current': isActive ? 'true' : null,
        onclick: function () {
          leaveOverlays();
          state.newProject.open = false;
          if (isActive) { render(); return; }
          openProject(project.id).then(render);
        }
      }, [
        // The initial is drawn by the stylesheet from data-initial, so the
        // row's text stays the project's name and nothing else.
        el('span', { class: 'tree-project-avatar', 'aria-hidden': 'true', 'data-initial': String(project.name || '?').charAt(0).toUpperCase() }),
        el('span', { class: 'tree-project-name', text: project.name })
      ]);
    }));
  }

  // "Mendix 11.12.5 · model of 12.10": the version, and the day the model
  // was read, as day.month.
  function projectSubline(project, model) {
    var meta = (model && model.meta) || {};
    var when = meta.generatedAt || project.updatedAt;
    var d = when ? new Date(when) : null;
    var day = d && !isNaN(d) ? ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) : null;
    return [meta.mendixVersion ? 'Mendix ' + meta.mendixVersion : null, day ? 'model of ' + day : null].filter(Boolean).join(' · ') || 'Model loaded';
  }

  // The open project, as a button that opens the list of projects (Karol,
  // 2026-10-13): switching is one click away without a list on screen all
  // the time.
  function renderProjectSwitcher(project) {
    var btn = el('button', {
      class: 'switcher', 'aria-label': 'Switch project — ' + project.name, 'aria-expanded': state.switcher ? 'true' : 'false',
      onclick: function () { state.switcher = !state.switcher; render(); }
    }, [
      el('span', { class: 'switcher-avatar', 'aria-hidden': 'true', 'data-initial': String(project.name || '?').charAt(0).toUpperCase() }),
      el('span', { class: 'switcher-text' }, [
        el('span', { class: 'switcher-name', text: project.name }),
        el('span', { class: 'switcher-sub', text: projectSubline(project, state.detail && state.detail.model) })
      ]),
      navIcon('switch', 14)
    ]);
    var menu = state.switcher ? el('div', { class: 'switcher-menu', role: 'menu' }, [
      el('div', { class: 'sidebar-label', text: 'Projects' }),
      renderProjectTree(),
      el('button', {
        class: 'tree-all', text: 'All projects',
        onclick: function () { leaveOverlays(); state.newProject.open = false; closeProject(); render(); }
      })
    ]) : null;
    return el('div', { class: 'switcher-wrap' }, [btn, menu]);
  }

  function navItem(section, project) {
    var active = !state.about && !state.guide && !state.newProject.open && state.detail.view === section.key;
    var count = sectionCount(project, section);
    return el('button', {
      class: 'tree-section' + (active ? ' active' : ''),
      'aria-current': active ? 'page' : null,
      onclick: function () { state.switcher = false; goToSection(section.key); }
    }, [
      navIcon(section.key, 16),
      el('span', { class: 'tree-section-label', text: section.label }),
      count === null ? null : el('span', { class: 'tree-count', text: String(count) })
    ]);
  }

  function renderSidebar() {
    var project = state.activeId && state.detail ? findProject(state.activeId) : null;
    var newBtn = el('button', {
      class: 'sidebar-new', 'aria-label': 'New project', title: 'New project',
      onclick: function () {
        leaveOverlays();
        state.newProject.open = true;
        setMessage(null);
        render();
      }
    }, [navIcon('plus', 14)]);
    // The logo and the name lead home: the projects page (home.js), Karol 2026-10-16.
    var brand = el('div', { class: 'sidebar-head' }, [
      el('button', { type: 'button', class: 'sidebar-home', title: 'All projects', 'aria-label': 'MxScout — all projects',
        onclick: function () { leaveOverlays(); state.newProject.open = false; closeProject(); render(); } }, [
        renderLogo(22),
        el('span', { class: 'sidebar-brand' }, [document.createTextNode('MxScout'), devTools(project) ? el('span', { class: 'sidebar-dev', text: 'Dev', title: 'Developer tools are on for this project' }) : null])
      ]),
      newBtn
    ]);

    var middle;
    if (project) {
      middle = SECTION_GROUPS.map(function (g) { // Developer tools off: their sections, and a group left empty, are not drawn
        var secs = PROJECT_SECTIONS.filter(function (sec) { return sec.group === g && (!sec.dev || devTools(project)); });
        return secs.length ? el('div', { class: 'nav-group' }, [el('div', { class: 'sidebar-label', text: g })].concat(secs.map(function (sec) { return navItem(sec, project); }))) : null;
      }).filter(Boolean);
    } else {
      // No project open: the projects themselves, and the log reader, which
      // works with none.
      middle = [
        el('div', { class: 'nav-group' }, [
          el('button', {
            class: 'tree-all' + ((!state.about && !state.guide && !state.logs) ? ' active' : ''),
            text: 'All projects',
            onclick: function () { leaveOverlays(); state.newProject.open = false; closeProject(); render(); }
          })
        ]),
        window.MxDevTools.any() ? el('div', { class: 'nav-group' }, [ // the log reader, a Developer tool: offered once any project has them on
          el('div', { class: 'sidebar-label', text: 'Tools' }),
          el('button', {
            class: 'tree-all' + (state.logs ? ' active' : ''),
            text: 'Log analysis',
            title: 'Read a Mendix log: the stream, Insights and the slow queries',
            onclick: function () { if (state.logs) closeLogs(); else openLogs(); render(); }
          })
        ]) : null,
        el('div', { class: 'nav-group' }, [el('div', { class: 'sidebar-label', text: 'Projects' }), renderProjectTree()])
      ].filter(Boolean);
    }

    var about = el('button', {
      class: 'sidebar-foot-link' + (state.about ? ' active' : ''),
      text: 'About & security',
      // Toggles: pressing it again is the way back out.
      onclick: function () { state.switcher = false; if (state.about) closeAbout(); else openAbout(); render(); }
    });
    // The version sits at the foot because that is where someone looks when
    // they want to know what they are running — and it is a plain label, not a
    // notification: MxScout never learns that a newer one exists.
    var versionBtn = el('button', {
      class: 'sidebar-version' + (window.MxVersion.isOpen() ? ' active' : ''),
      text: window.MxVersion.version() ? ('v' + window.MxVersion.version()) : 'v…',
      title: 'What is in this version, and how to move to a newer one',
      onclick: function () { window.MxVersion.open(); }
    });
    var settings = PROJECT_SECTIONS.filter(function (sec) { return sec.key === 'settings'; })[0];

    // No search box here (Karol): the palette is opened with / or Ctrl-K.
    return el('nav', { class: 'sidebar', 'aria-label': 'MxScout' }, [
      brand,
      project ? renderProjectSwitcher(project) : null,
      el('div', { class: 'sidebar-scroll', 'data-keep-scroll': 'sidebar' }, middle),
      el('div', { class: 'sidebar-foot' }, [
        project ? navItem(settings, project) : el('button', { type: 'button', class: 'tree-section foot-settings' + (state.appSettings ? ' active' : ''), onclick: function () { if (state.appSettings) { state.appSettings = null; render(); } else openAppSettings(); } }, [navIcon('settings', 16), el('span', { class: 'tree-section-label', text: 'Settings' })]),
        // One line (Karol, 2026-10-16): the theme, the version, and Help — About & security and the team guide.
        el('div', { class: 'sidebar-foot-row' }, [window.MxTheme.switcher(), versionBtn, helpMenu(about)])
      ].filter(Boolean))
    ].filter(Boolean));
  }

  // Help, at the foot: a small menu with About & security and the team guide, opened upwards. Its items are
  // always there, hidden while it is closed; Escape or a click elsewhere closes it.
  function helpMenu(about) {
    about.setAttribute('role', 'menuitem');
    var guide = el('a', { class: 'sidebar-foot-link', role: 'menuitem', href: '/guide-team.html', target: '_blank', rel: 'noopener', text: 'Team guide ↗', title: 'The team guide, English and Polish (public/guide-team.html) — opens in a new tab' });
    var menu = el('div', { class: 'help-menu', role: 'menu', 'aria-label': 'Help' }, [about, guide]);
    var btn = el('button', { type: 'button', class: 'sidebar-foot-link help-btn' + (state.about ? ' active' : ''), text: 'Help', title: 'About & security, and the team guide', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    function show(open) {
      menu.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) setTimeout(function () { document.addEventListener('click', away, true); document.addEventListener('keydown', esc, true); }, 0);
      else { document.removeEventListener('click', away, true); document.removeEventListener('keydown', esc, true); }
    }
    function away(e) { if (!wrap.contains(e.target) || e.target !== btn && menu.contains(e.target)) show(false); }
    function esc(e) { if (e.key === 'Escape') { show(false); btn.focus(); } }
    btn.addEventListener('click', function () { show(menu.hidden); });
    menu.hidden = true;
    var wrap = el('div', { class: 'help-wrap' }, [btn, menu]);
    return wrap;
  }

  // ---------- new-project form ----------
  function renderNewProjectCard() {
    if (!state.newProject.open) {
      return el('button', {
        class: 'btn btn-primary', text: '+ New project',
        onclick: function () { state.newProject.open = true; setMessage(null); render(); }
      });
    }

    var nameInput = el('input', {
      type: 'text', placeholder: 'e.g. Customer Portal (acceptance)', value: state.newProject.name
    });
    nameInput.addEventListener('input', function () { state.newProject.name = nameInput.value; });
    // Where it is kept, chosen first: a folder on disk (recommended), or this browser only.
    if (!state.newProject.store) state.newProject.store = window.MxFolderUI.freshChoice(true);
    var storeBox = state.newProject.store;
    function storeChosen() {
      if (window.MxFolderUI.choiceReady(storeBox)) return true;
      setMessage('Choose the folder to keep the project in first — or keep it in this browser only.', 'error');
      render();
      return false;
    }

    // On Chromium, this card offers exactly two things, not a blurred choice
    // between three: a Mendix project FOLDER (any format, one pick — see
    // folderPrimary below), or a JSON file (a model exported from MxSonar, or
    // a .mxscout package). Picking a single loose .mpr file is no longer
    // offered as its own option here, since the folder pick already covers
    // every Mendix project — it still works if someone drops one on the JSON
    // box anyway (handleModelFile below), routed straight to mprImport.js,
    // just not advertised as a path of its own. Elsewhere (no File System
    // Access API — Firefox, Safari), there is no folder option to offer at
    // all, so this box keeps doing double duty exactly as it always did:
    // a single file, .mpr included.
    var canPickFolder = window.MxMprImport.supportsDirectoryPicker();
    var picked = state.newProject.file;
    var drop = el('div', { class: 'file-drop' }, [
      picked
        ? el('div', {}, [
            el('div', {}, [el('strong', { text: picked.fileName })]),
            el('div', { class: 'muted', text: formatBytes(picked.text.length) + ' — click to choose a different file' })
          ])
        : canPickFolder
        ? el('div', {}, [
            el('div', {}, [el('strong', { text: 'Choose a JSON file' })]),
            el('div', { class: 'muted', text: 'A model exported from MxSonar, or a .mxscout package — or drop it here' })
          ])
        : el('div', {}, [
            el('div', {}, [el('strong', { text: 'Choose a project file' })]),
            el('div', { class: 'muted', text: 'A Mendix .mpr file, or a model exported from MxSonar — or drop it here' })
          ])
    ]);
    // A .mpr is binary and needs its own multi-step flow (mprImport.js may
    // still need a second pick, for a v2 project's mprcontents/ folder), so
    // it branches off before anything here tries to read it as text — a
    // .json/.mxscout keeps working exactly as it always did.
    function handleModelFile(file) {
      if (/\.mpr$/i.test(file.name)) {
        if (!storeChosen()) return;
        creatingIn = storeBox;
        state.newProject = { open: false, name: '', file: null, busy: false, store: null };
        window.MxMprImport.open();
        window.MxMprImport.handleMprFile(file);
        return;
      }
      readFileText(file, function (fileName, text) {
        if (window.MxTransfer.handlePickedFile(fileName, text, 'new', null, storeBox)) {
          state.newProject.open = false; // the unlock dialog takes over from here
          return;
        }
        state.newProject.file = { fileName: fileName, text: text };
        if (!state.newProject.name) state.newProject.name = fileName.replace(/\.json$/i, '');
        setMessage(null);
        render();
      });
    }
    drop.addEventListener('click', function () { pickModelFile(handleModelFile, canPickFolder ? '.mxscout,.json,application/json' : '.mxscout,.json,application/json,.mpr'); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('dragover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      handleModelFile(file);
    });
    // The primary path on Chromium: point at the Mendix project's own root
    // folder once, and mprImport.js finds the .mpr and (only for a
    // v2-format project) its mprcontents/ subfolder by itself — no second
    // pick, whatever the project format. See mprImport.js's own header
    // comment for why a plain <input type=file>/drop can't do this, and why
    // it's a folder pick rather than typing a path the way MxSonar's own
    // (server-side, disk-reading) picker works: MxScout's server never
    // touches the model, so the browser tab has to be the one reading files,
    // and a browser tab has no way to resolve a typed path to real files —
    // only an explicit pick or drop.
    var folderPrimary = canPickFolder ? el('div', { class: 'folder-pick' }, [
      el('div', {}, [el('strong', { text: 'Choose the Mendix project folder' })]),
      el('div', { class: 'muted', text: 'One pick — MxScout finds the .mpr file, and its mprcontents folder if the format needs one, by itself' })
    ]) : null;
    if (folderPrimary) {
      folderPrimary.addEventListener('click', function () {
        if (!storeChosen()) return;
        creatingIn = storeBox;
        state.newProject = { open: false, name: '', file: null, busy: false, store: null };
        window.MxMprImport.open();
        window.MxMprImport.pickProjectFolder();
      });
    }

    function submit() {
      var name = (state.newProject.name || '').trim();
      if (!name) { setMessage('Give the project a name first.', 'error'); render(); return; }
      if (!state.newProject.file) { setMessage('Choose a project file first.', 'error'); render(); return; }
      if (!storeChosen()) return;
      var created;
      creatingIn = storeBox;
      try {
        created = createProject(name, state.newProject.file.fileName, state.newProject.file.text);
      } catch (err) {
        // parseModelText rejects a bad file synchronously, before any write.
        creatingIn = null;
        setMessage((err && err.message) || 'Could not create that project.', 'error');
        render();
        return;
      }
      state.newProject = { open: false, name: '', file: null, busy: true, store: null };
      render();
      created.then(function (record) {
        return openProject(record.id).then(function () {
          setMessage('Project "' + record.name + '" created.', 'ok');
        });
      }, function (err) {
        setMessage((err && err.message) || 'Could not create that project.', 'error');
      }).then(function () {
        state.newProject.busy = false;
        render();
      });
    }

    var canKeep = window.MxFolderUI.supported();
    return el('div', { class: 'card new-project' }, [
      el('h2', { text: 'New project', style: 'margin:0 0 14px;font-size:15px' }),
      el('label', { class: 'field' }, [el('span', { text: 'Project name' }), nameInput]),
      el('div', { class: 'field' }, [el('span', { text: 'Where to keep it' }), window.MxFolderUI.choice(storeBox)]),
      folderPrimary ? el('label', { class: 'field' }, [el('span', { text: 'Mendix project folder' }), folderPrimary]) : null,
      storeBox.mode === 'repo' ? window.MxFolderUI.repoFileNote() : el('label', { class: 'field' }, [el('span', { text: 'Project file' }), drop]),
      canKeep ? el('p', { class: 'hint new-open-folder' }, [
        document.createTextNode('Already have an MxScout project folder — from git, or another machine? '),
        el('button', { type: 'button', class: 'link-btn', text: 'Open a project folder…', onclick: function () { window.MxFolderUI.openFolder(); } })
      ]) : null,
      // Where it goes, said plainly: the Mendix project's mxscout/, a folder, or this browser (folderui.js).
      el('p', { class: 'hint', text: window.MxFolderUI.choiceHint(storeBox) }),
      el('div', { class: 'modal-actions', style: 'margin-top:14px' }, [
        el('button', {
          class: 'btn', text: 'Cancel',
          onclick: function () { state.newProject = { open: false, name: '', file: null, busy: false, store: null }; setMessage(null); render(); }
        }),
        el('button', { class: 'btn btn-primary', text: 'Create project', onclick: submit })
      ])
    ]);
  }

  function openReplaceModel(id) {
    state.replaceModel = { id: id };
    setMessage(null);
    render();
  }

  // Same choice as "New project" (public/app.js's renderNewProjectCard): a
  // Mendix project folder, or a JSON/.mxscout file — replacing used to split
  // this into two separate buttons ("Replace model" for JSON only, "Replace
  // from folder…" elsewhere), which meant picking the wrong one on a project
  // you thought was the other format got you a confusing error instead of
  // the option you needed. One modal, both paths, exactly like creating one.
  function renderReplaceModelModal() {
    if (!state.replaceModel) return null;
    var project = findProject(state.replaceModel.id);
    if (!project) { state.replaceModel = null; return null; }

    var canPickFolder = window.MxMprImport.supportsDirectoryPicker();

    function onFilePicked(file) {
      if (/\.mpr$/i.test(file.name)) {
        state.replaceModel = null;
        window.MxMprImport.openReplace(project.id);
        window.MxMprImport.handleMprFile(file);
        return;
      }
      readFileText(file, function (fileName, text) {
        if (window.MxTransfer.handlePickedFile(fileName, text, 'replace', project.id)) {
          state.replaceModel = null; // the unlock dialog takes over from here
          render();
          return;
        }
        state.replaceModel = null;
        var work;
        try { work = replaceProjectModel(project.id, fileName, text); }
        catch (err) {
          setMessage((err && err.message) || 'Could not update that model.', 'error');
          render();
          return;
        }
        render();
        work.then(function (updated) {
          setMessage('Model updated for "' + updated.name + '".', 'ok');
        }, function (err) {
          setMessage((err && err.message) || 'Could not update that model.', 'error');
        }).then(render);
      });
    }

    var folderBox = canPickFolder ? el('div', { class: 'file-drop' }, [
      el('div', {}, [el('strong', { text: 'Choose the Mendix project folder' })]),
      el('div', { class: 'muted', text: 'One pick — MxScout finds the .mpr file, and its mprcontents folder if the format needs one, by itself' })
    ]) : null;
    if (folderBox) {
      folderBox.addEventListener('click', function () {
        state.replaceModel = null;
        window.MxMprImport.openReplace(project.id);
        window.MxMprImport.pickProjectFolder();
      });
    }

    var fileBox = el('div', { class: 'file-drop' }, [
      el('div', {}, [el('strong', { text: canPickFolder ? 'Choose a JSON file' : 'Choose a project file' })]),
      el('div', { class: 'muted', text: canPickFolder ? 'A model exported from MxSonar, or a .mxscout package — or drop it here' : 'A Mendix .mpr file, or a model exported from MxSonar — or drop it here' })
    ]);
    fileBox.addEventListener('click', function () { pickModelFile(onFilePicked, canPickFolder ? '.mxscout,.json,application/json' : '.mxscout,.json,application/json,.mpr'); });
    fileBox.addEventListener('dragover', function (e) { e.preventDefault(); fileBox.classList.add('dragover'); });
    fileBox.addEventListener('dragleave', function () { fileBox.classList.remove('dragover'); });
    fileBox.addEventListener('drop', function (e) {
      e.preventDefault();
      fileBox.classList.remove('dragover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) onFilePicked(file);
    });

    var closeReplace = function () { state.replaceModel = null; render(); };
    return el('div', { class: 'modal-backdrop' }, [
      window.MxDialog.modal(el('div', { class: 'modal' }, [
        el('h3', { text: 'Replace model for "' + project.name + '"' }),
        el('p', { class: 'muted', text: 'Loads a newer model over this project’s current one. Comments stay — matched by qualified name — but one on something renamed or removed since will show as orphaned rather than disappearing.' }),
        folderBox ? el('label', { class: 'field' }, [el('span', { text: 'Project folder' }), folderBox]) : null,
        el('label', { class: 'field' }, [el('span', { text: 'Project file' }), fileBox]),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: closeReplace })
        ])
      ].filter(Boolean)), closeReplace)
    ]);
  }

  // The projects page is home.js's (MxHome): where MxScout opens and where the logo leads.

  // ---------- server API ----------
  // MxScout's server does almost nothing — it serves these files and holds the
  // current live-session scan. This helper defaults the JSON content type the
  // server requires on every POST (closing the enctype=text/plain CSRF trick,
  // same as MxSonar's api()), so no call site has to remember it.
  function api(path, opts) {
    opts = opts || {};
    if (opts.body && !(opts.headers && opts.headers['Content-Type'])) {
      opts.headers = Object.assign({}, opts.headers, { 'Content-Type': 'application/json' });
    }
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
        return body;
      });
    });
  }

  // A model lookup, not a popup concern: the popups, the live layer, the
  // comments API and the row-level rule reader all need it. Looked up by name, not searched: a large model asks
  // it thousands of times per screen. The first entity of that name, as a
  // search of the list would find.
  var entityIndex = typeof WeakMap === 'function' ? new WeakMap() : null;
  function findEntity(model, qn) {
    var list = model.entities || [];
    var ix = entityIndex && entityIndex.get(list);
    if (!ix || ix.n !== list.length) {
      var by = Object.create(null);
      list.forEach(function (e) { if (e && typeof e.qualifiedName === 'string' && !(e.qualifiedName in by)) by[e.qualifiedName] = e; });
      ix = { n: list.length, by: by };
      if (entityIndex) entityIndex.set(list, ix);
    }
    return ix.by[qn] || null;
  }

  // ---------- role + access helpers ----------
  // These turn the raw model into the "what can this role actually see/do"
  // picture the browsing views show. A role here is a project User Role (the
  // Security screen's named bundle) — e.g. "Manager" -> ["Sales.Manager",
  // "Support.Agent"]. state.detail.role is one of those names, or 'all' for
  // the unfiltered everything-view.
  function userRolesOf(model) { return Array.isArray(model.userRoles) ? model.userRoles : []; }

  // The set of per-module roles ("Module.Role") a chosen User Role maps to,
  // as a plain lookup object. Returns null for 'all', which every consumer
  // reads as "no role filter — show everything".
  function moduleRoleSetFor(model, roleName) {
    if (!roleName || roleName === 'all') return null;
    // The person signed in to the app can hold more than one user role, and
    // reaches what all of them reach together.
    var signed = state.detail && state.detail.signedIn;
    var names = signed && roleName === signed.label ? signed.roles : [roleName];
    var set = {};
    userRolesOf(model).forEach(function (r) {
      if (names.indexOf(r.name) !== -1) (r.moduleRoles || []).forEach(function (mr) { set[mr] = true; });
    });
    return set;
  }

  // Who is signed in to the app the bridge is connected to, as the bridge
  // reported it: a name and the names of their user roles. Remembered on the
  // project view, so "view as" stays meaningful if the bridge drops.
  function signedInUser() {
    var live = state.detail && state.detail.live;
    var st = live && live.exec && live.exec.status;
    var u = st && st.listenerConnected && st.user;
    if (!u || !(u.roles || []).length) return null;
    return { label: (u.name || 'Signed-in user') + ' (signed in)', name: u.name || null, roles: u.roles.slice() };
  }

  function listHitsSet(list, set) {
    if (!set) return true; // no filter
    return (list || []).some(function (mr) { return set[mr]; });
  }

  // Collapses every access rule that applies to the chosen role into one
  // plain answer per entity. Mendix grants read by the mere existence of a
  // matching rule; 'rw' on any attribute/association means write; create and
  // delete are their own flags. With no role filter, an entity is treated as
  // fully visible so the list still renders.
  function entityAccessFor(entity, set) {
    if (!set) return { matched: true, read: true, write: null, create: null, del: null, filtered: false };
    var out = { matched: false, read: false, write: false, create: false, del: false, filtered: true };
    (entity.accessRules || []).forEach(function (rule) {
      if (!set[rule.moduleRole]) return;
      out.matched = true;
      out.read = true;
      if (rule.allowCreate) out.create = true;
      if (rule.allowDelete) out.del = true;
      var lvls = [].concat(
        Object.keys(rule.attrAccess || {}).map(function (k) { return rule.attrAccess[k]; }),
        Object.keys(rule.assocAccess || {}).map(function (k) { return rule.assocAccess[k]; })
      );
      if (lvls.indexOf('rw') !== -1) out.write = true;
    });
    return out;
  }

  // Per-attribute access for the selected role, across the rules that apply to
  // it: 'rw' if any writes it, else 'r' if any reads it, else 'none'. Null in
  // the everything-view, where there is no single role to colour by. Feeds the
  // map card's per-attribute dots.
  function attrLevelsFor(entity, set) {
    if (!set) return null;
    var out = {};
    (entity.attributes || []).forEach(function (a) { out[a.name] = 'none'; });
    (entity.accessRules || []).forEach(function (rule) {
      if (!set[rule.moduleRole]) return;
      var acc = rule.attrAccess || {};
      Object.keys(acc).forEach(function (name) {
        if (out[name] === undefined) return;
        if (acc[name] === 'rw') out[name] = 'rw';
        else if (acc[name] === 'r' && out[name] !== 'rw') out[name] = 'r';
      });
    });
    return out;
  }

  // ---------- colour by kind, not by module ----------
  // Every module used to get a hue of its own, hashed from its name. Karol,
  // 2026-10-13: in the new style "different module colours are out — all the
  // same": colour says what KIND of thing it is, as Studio Pro does — a
  // microflow blue, a nanoflow green, an entity blue, a non-persistable one
  // gold, a view entity green — and anything else carries the accent.
  //
  // moduleColor keeps its name and its callers: it answers with the accent as
  // a real colour, for the places that cannot read a CSS variable (the badge
  // on the app's own tab, a canvas).
  function moduleColor() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return v || (window.MxTheme.inEffect() === 'light' ? '#2148D0' : '#8EA8FF');
  }
  // The kind's colour as a CSS variable. `entity` tells a non-persistable and
  // a view entity from an ordinary one.
  function kindColor(kind, entity) {
    if (kind === 'nanoflow') return 'var(--ok)';
    if (kind === 'microflow') return 'var(--f-db)';
    if (kind === 'entity' || entity) {
      if (entity && entity.viewEntity) return 'var(--view-c)';
      if (entity && entity.persistable === false) return 'var(--np)';
      return 'var(--f-db)';
    }
    return 'var(--accent)';
  }
  // Every coloured element gets its colour as a CSS custom property, so the
  // stylesheet decides HOW the colour is used (a stripe, a border, text) and
  // this file only decides WHICH. The module name is no longer what decides.
  function withMod(node, moduleName, kind, entity) {
    if (node) node.style.setProperty('--mod', kindColor(kind, entity));
    return node;
  }

  // ---------- shared browsing controls ----------
  function moduleNamesOf(model) {
    var seen = {};
    (model.modules || []).forEach(function (m) { if (m && m.name) seen[m.name] = true; });
    // Some models carry entities/flows in modules not listed in `modules`;
    // fold those in so nothing silently disappears from the chips.
    ['entities', 'microflows', 'nanoflows', 'pages'].forEach(function (k) {
      (model[k] || []).forEach(function (x) { if (x && x.module) seen[x.module] = true; });
    });
    return Object.keys(seen).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
  }

  // A scope set from the palette path wins outright: `/Riverside/entities/
  // Sales` means Sales and nothing else, whatever the chips said before.
  function moduleShown(name) {
    if (state.detail.moduleScope) return name === state.detail.moduleScope;
    return !state.detail.hiddenModules[name];
  }

  function passesFilter(item) {
    var q = (state.detail.filter || '').trim().toLowerCase();
    if (!q) return true;
    var hay = ((item.name || '') + ' ' + (item.qualifiedName || '') + ' ' + (item.module || '')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  // The role filter sits inline in the header row rather than in a panel of
  // its own: it is one control, and a card wrapped around it cost about a
  // hundred pixels of height on every screen. The "maps to N module roles"
  // detail moves into the select's own tooltip — still there when someone
  // wonders what a role covers, but not permanently occupying the page.
  function renderRoleSelector(model) {
    var roles = userRolesOf(model);
    var select = el('select', { class: 'role-select' });
    var optAll = el('option', { value: 'all', text: 'Everything' });
    if (state.detail.role === 'all') optAll.setAttribute('selected', 'selected');
    select.appendChild(optAll);
    // "Which role does a visitor who has not signed in get" is the first
    // question asked of an app that allows one at all, and until the project's
    // security document was read, that role sat in this list looking like any
    // other. It is named here rather than left to be recognised.
    var guestRole = model.security && model.security.guestAccess ? model.security.guestUserRole : null;
    roles.forEach(function (r) {
      var isGuest = guestRole && r.name === guestRole;
      var o = el('option', { value: r.name, text: r.name + (isGuest ? ' (not signed in)' : '') });
      if (r.name === state.detail.role) o.setAttribute('selected', 'selected');
      select.appendChild(o);
    });
    // Besides the roles, the person signed in to the app — the one MxScout
    // is connected through — with every user role they hold together. A
    // tester is often given two, and "what can I see" is then neither role
    // alone (Karol, 2026-10-09).
    var live = signedInUser();
    if (live) state.detail.signedIn = live;
    var signed = state.detail.signedIn;
    if (signed && devTools()) {
      var known = signed.roles.filter(function (n) { return roles.some(function (r) { return r.name === n; }); });
      var so = el('option', { value: signed.label,
        text: signed.label + ' — ' + (signed.roles.join(' + ')) + (live ? '' : ' · not connected') });
      if (state.detail.role === signed.label) so.setAttribute('selected', 'selected');
      if (!known.length) so.setAttribute('disabled', 'disabled');
      select.appendChild(el('optgroup', { label: 'Signed in to the app' }, [so]));
    }
    select.addEventListener('change', function () { state.detail.role = select.value; state.detail.selectedEntity = null; state.detail.selectedFlow = null; render(); });

    var set = moduleRoleSetFor(model, state.detail.role);
    // The select keeps a sensible width (explorer.css) and a long role name is cut there, so the
    // name in full leads its title.
    if (set) {
      var mrs = Object.keys(set);
      select.setAttribute('title', 'View as ' + state.detail.role + (guestRole && state.detail.role === guestRole ? ' (not signed in)' : '') + ' — maps to ' + mrs.length +
        ' module role' + (mrs.length === 1 ? '' : 's') + ': ' + (mrs.join(', ') || '(none)'));
    } else if (roles.length) {
      select.setAttribute('title', 'Showing everything. Pick a role to see only what that role can reach.');
    } else {
      select.setAttribute('title', 'This model has no user roles, so there is nothing to filter by.');
    }

    return el('div', { class: 'role-inline' }, [
      el('span', { class: 'role-select-label', text: 'View as' }),
      select
    ]);
  }

  // A chip for "N from Marketplace" either way — the quick way to show or
  // hide them right where you are, rather than a trip to Settings, for the
  // times that's all you need (setShowMarketplaceModules is the same
  // persisted flag either control uses). When they're hidden, this is the
  // only place they're mentioned at all, so it doubles as the "there's more
  // here" notice; when they're shown, it's the one-click way back to hidden
  // without leaving the view to find the Settings checkbox.
  function renderMarketplaceChip() {
    var marketplaceCount = (state.detail.rawModel.modules || []).filter(function (m) { return m && m.fromAppStore; }).length;
    if (!marketplaceCount) return null;
    var project = findProject(state.activeId);
    if (!project) return null;
    if (state.detail.showMarketplaceModules) {
      return el('button', {
        class: 'chip chip-action', text: 'Hide ' + marketplaceCount + ' from Marketplace',
        title: 'Hide them again while browsing this project',
        onclick: function () { setShowMarketplaceModules(project, false); }
      });
    }
    return el('button', {
      class: 'chip chip-action', text: marketplaceCount + ' from Marketplace',
      title: 'Hidden by default — click to show them while browsing this project',
      onclick: function () { setShowMarketplaceModules(project, true); }
    });
  }

  function renderModuleChips(model) {
    var names = moduleNamesOf(model);
    if (state.detail.moduleScope) {
      // The path already says which module this is, so the chip row would be
      // a second control claiming the same thing. One crumb, one way out.
      return withMod(el('div', { class: 'scope-crumb' }, [
        el('span', { class: 'scope-crumb-dot' }),
        el('span', { class: 'scope-crumb-name', text: state.detail.moduleScope }),
        el('button', {
          class: 'scope-crumb-clear', text: '✕',
          title: 'Show all modules',
          onclick: function () { state.detail.moduleScope = null; render(); }
        })
      ]), state.detail.moduleScope);
    }
    var marketplaceChip = renderMarketplaceChip();
    if (names.length <= 1) return marketplaceChip ? el('div', { class: 'chips' }, [marketplaceChip]) : null;
    var anyHidden = names.some(function (n) { return !moduleShown(n); });
    var chips = names.map(function (n) {
      return withMod(el('button', {
        class: 'chip' + (moduleShown(n) ? ' on' : ''),
        text: n,
        onclick: function () {
          if (state.detail.hiddenModules[n]) delete state.detail.hiddenModules[n];
          else state.detail.hiddenModules[n] = true;
          render();
        }
      }), n);
    });
    chips.push(el('button', {
      class: 'chip chip-action',
      text: anyHidden ? 'Show all' : 'Hide all',
      onclick: function () {
        if (anyHidden) state.detail.hiddenModules = {};
        else { var h = {}; names.forEach(function (n) { h[n] = true; }); state.detail.hiddenModules = h; }
        render();
      }
    }));
    if (marketplaceChip) chips.push(marketplaceChip);
    return el('div', { class: 'chips' }, chips);
  }

  function renderFilterInput(placeholder) {
    var input = el('input', { type: 'text', class: 'filter-input', placeholder: placeholder, value: state.detail.filter });
    input.addEventListener('input', function () {
      state.detail.filter = input.value;
      _filterCaret = input.selectionStart;
      renderInPlace();
    });
    return input;
  }

  // Filtering re-renders on every keystroke; a full render() would rebuild the
  // header and steal focus from the filter box. This swaps only the view body
  // and keeps the caret where it was.
  function renderInPlace() { render(); refocusFilter(); }
  var _filterCaret = null;
  function refocusFilter() {
    var input = document.querySelector('.filter-input');
    if (input) { input.focus(); if (_filterCaret != null) { try { input.setSelectionRange(_filterCaret, _filterCaret); } catch (e) {} } }
  }

  // ---------- access badges ----------
  // One quiet marker rather than a count per severity: the list is for finding
  // objects, and the comments themselves live one click away.
  function commentMarker(qualifiedName) {
    var existing = window.MxComments.findingsFor(qualifiedName);
    if (!existing.length) return [];
    return [el('span', { class: 'comment-marker', text: existing.length + ' comment' + (existing.length === 1 ? '' : 's') })];
  }

  // ---------- microflows / nanoflows / pages ----------
  var FLOW_KIND_OF = { microflows: 'microflow', nanoflows: 'nanoflow', pages: 'page' };

  // Card-sized icons for the role/input row. Same hand-built-SVG approach as
  // renderLogo above (zero dependencies means no icon font, so this is the
  // whole toolkit) — kept to the two shapes this row needs.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }
  function inputIcon() {
    var svg = svgEl('svg', { viewBox: '0 0 16 16', width: '13', height: '13', fill: 'none' });
    svg.appendChild(svgEl('path', { d: 'M2 8h7M6 4.5 9.5 8 6 11.5', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    svg.appendChild(svgEl('rect', { x: '10.5', y: '2.5', width: '3.5', height: '11', rx: '1', stroke: 'currentColor', 'stroke-width': '1.4' }));
    return svg;
  }
  function internalIcon() {
    var svg = svgEl('svg', { viewBox: '0 0 16 16', width: '11', height: '11', fill: 'none' });
    svg.appendChild(svgEl('path', { d: 'M6.5 9.5 9.5 6.5M6 5h-.5A2.5 2.5 0 0 0 3 7.5v0A2.5 2.5 0 0 0 5.5 10H6M10 5h.5A2.5 2.5 0 0 1 13 7.5v0A2.5 2.5 0 0 1 10.5 10H10', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' }));
    return svg;
  }

  // A stable colour per module role, same hashing idea as moduleColor but its
  // own function: a role chip and a module stripe answer different questions
  // ("who can run this" vs "which module owns this") and hashing the role's
  // own string keeps the two from coincidentally matching.
  function roleColor(moduleRole) {
    var h = 0;
    for (var i = 0; i < moduleRole.length; i++) h = (h * 31 + moduleRole.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 55%, 62%)';
  }
  function roleInitials(moduleRole) {
    var role = moduleRole.split('.').pop();
    return role.slice(0, 2).toUpperCase();
  }

  // Replaces the old "Runnable by: ..." text line: a stack of small coloured
  // chips, one per role, with the full "Module.Role" name only on hover — the
  // card itself only needs to say THAT it's gated and by roughly how many
  // roles, not spell every one out. A flow with no allowed roles at all isn't
  // gated, it's an internal helper, so it gets one muted icon instead of an
  // empty stack.
  function roleIndicator(allowed, flow) {
    if (!allowed.length) {
      // "Called from other logic" was a guess dressed as a fact. Now that the
      // model knows what names this flow, the icon can say which of three
      // things is true — reached from N places, reached from nothing, or (on
      // an older model) nobody has looked.
      var knows = state.detail && state.detail.model.meta && state.detail.model.meta.knowsCallSites;
      var sources = (flow && flow.calledBy) || [];
      var title;
      if (sources.length) {
        title = 'Not directly runnable — reached from ' + sources.length +
          ' place' + (sources.length === 1 ? '' : 's') + ' in the model';
      } else if (knows) {
        title = 'Nothing in this model reaches this — no flow, page, scheduled event or published service names it';
      } else {
        title = 'Not directly runnable — this model does not record where things are called from';
      }
      return el('div', { class: 'role-stack' }, [
        el('span', {
          class: 'internal-chip' + (knows && !sources.length ? ' internal-orphan' : ''),
          title: title
        }, [internalIcon()])
      ]);
    }
    return el('div', { class: 'role-stack' }, allowed.map(function (mr) {
      var chip = el('span', { class: 'role-chip', title: mr, text: roleInitials(mr) });
      chip.style.background = roleColor(mr);
      return chip;
    }));
  }

  // Replaces the old "Inputs: ..." text line: an icon plus the parameter
  // count, dimmed when there are none. The actual parameter list (name and
  // type) only shows up as a tooltip — reading it isn't needed to tell at a
  // glance whether a flow takes input.
  function inputIndicator(params) {
    var hasInputs = params.length > 0;
    return el('span', {
      class: 'input-badge' + (hasInputs ? ' has-inputs' : ''),
      title: hasInputs ? params.join(', ') : 'No inputs'
    }, [inputIcon(), el('span', { text: String(params.length) })]);
  }

  function openFlowPopup(kind, qualifiedName) {
    state.detail.selectedFlow = { kind: kind, qualifiedName: qualifiedName };
    state.detail.flowTab = 'run';
    state.detail.flowStep = null;
    // Chosen objects and typed values belong to the flow they were chosen
    // for — carrying them into a different flow would arm a run with inputs
    // nobody picked for it.
    state.detail.flowPick = {};
    state.detail.flowScalars = {};
    state.detail.flowOverrides = {};
    state.detail.objectPicker = null;
    // exec is shared across every flow in the project (one Run tab worth of
    // state, not one per flow), so a failed arm attempt on one flow used to
    // still show its error when a completely different flow's Run tab was
    // opened next. A stale error/confirmation never belongs to whatever is
    // being opened now, so both always clear; an in-flight run's own status
    // only survives if it is THIS flow's run being reopened, not carried
    // over from a different one.
    var ex = state.detail.live && state.detail.live.exec;
    if (ex) {
      ex.armError = null;
      ex.confirm = null;
      var sameFlow = ex.armedFlow && ex.armedFlow.kind === kind && ex.armedFlow.qualifiedName === qualifiedName;
      if (!sameFlow) {
        ex.armedCommandId = null;
        ex.armedFlow = null;
        ex.armedAt = null;
        if (ex.status) ex.status.result = null;
      }
    }
    render();
  }

  // Which flows the list is showing right now: the module chips, the text
  // filter and the role selector, applied in one place. The export button
  // beside the list exports exactly this, so the two cannot disagree about
  // what "shown" means — the whole reason the count is on the button.
  function shownFlows(model, key) {
    var set = moduleRoleSetFor(model, state.detail.role);
    return (model[key] || []).filter(function (f) {
      if (!moduleShown(f.module)) return false;
      if (!passesFilter(f)) return false;
      // A specific role sees only what it can actually run — same rule the
      // entity list already applies (entityAccessFor: hidden unless a rule
      // matches the selected role). A flow with NO allowed roles at all
      // isn't runnable by any role either, internal helper or not, so under
      // a specific role it is hidden same as a genuinely role-gated one it
      // can't reach; only "Everything" (set === null) shows it, with its own
      // "not directly runnable" label in the popup.
      return !(set && !listHitsSet(f.allowedModuleRoles || [], set));
    });
  }

  // ---------- handing a drawing to MxScaffold ----------
  // One call behind every way of asking for it, so the file is the same
  // whichever button produced it (public/exchange.js explains why the two
  // tools are joined by a file and not by code). Writing it is a download:
  // no connection opens, which is why this needed no change to the server.
  function exportFlows(model, scope, fileHint) {
    var built = window.MxExchange.buildFlowsDocument(model, {
      scope: scope, version: window.MxVersion && window.MxVersion.version()
    });
    if (!built.included) {
      // A model imported as JSON, or built before MxScout read flow drawings,
      // holds no drawing to export. Writing the file anyway would hand over
      // flows with no steps, which reads as "these flows do nothing".
      setMessage(built.skipped
        ? 'This project’s model has no flow drawings in it — re-import the project folder to read them.'
        : 'Nothing to export: no flows are shown.', 'error');
      render();
      return;
    }
    var when = new Date().toISOString().slice(0, 10);
    var fileName = 'mxscout-flows-' + safeFileName(fileHint) + '-' + when + '.json';
    // Indented rather than compact, at about 60 % more bytes on a whole
    // project: this is a tool whose argument is "open it and read it
    // yourself", and a handover file nobody can read by eye would be an odd
    // exception to that. A single flow, the common case, is a few kilobytes.
    downloadText(JSON.stringify(built.doc, null, 1), fileName, 'application/json');
    setMessage(built.included + (built.included === 1 ? ' flow' : ' flows') + ' written to ' + fileName +
      (built.skipped ? ' · ' + built.skipped + ' left out, no drawing stored for them' : ''), 'ok');
    // setMessage only sets state — whoever asked for it repaints the screen.
    render();
  }

  // The Microflows screen's export: every flow of the kind that View as
  // shows — that screen has no other filter whose state could narrow it out
  // of sight. The count is in the title, so the scope is still stated.
  function renderDrawingsExportButton(model, key) {
    if (!devTools()) return null; // MxScaffold's drawings: a Developer tool
    var set = moduleRoleSetFor(model, state.detail.role);
    var drawable = (model[key] || []).filter(function (f) { return listHitsSet(f.allowedModuleRoles, set) && f.graph && f.graph.nodes; });
    if (!drawable.length) return null;
    var names = {};
    drawable.forEach(function (f) { names[f.qualifiedName] = true; });
    return el('button', {
      class: 'mf-btn', text: 'Export drawings',
      title: 'Write the drawings of the ' + drawable.length + ' ' + (drawable.length === 1 ? key.replace(/s$/, '') : key) + ' shown for this role to a .json file for MxScaffold. A download — nothing is sent anywhere.',
      onclick: function () {
        exportFlows(model, function (flow) { return names[flow.qualifiedName]; },
          (state.detail.model.meta && state.detail.model.meta.appName) || 'project');
      }
    });
  }

  function renderFlowList(model, key, noun) {
    var byModule = {};
    shownFlows(model, key).forEach(function (f) {
      (byModule[f.module] = byModule[f.module] || []).push({ flow: f, allowed: f.allowedModuleRoles || [] });
    });
    var modules = Object.keys(byModule).sort();
    if (!modules.length) return el('div', { class: 'empty' }, [el('p', { text: 'No ' + noun + ' match the current filter.' })]);

    return el('div', {}, modules.map(function (mod) {
      var cards = byModule[mod]
        .sort(function (a, b) { return a.flow.name.toLowerCase() < b.flow.name.toLowerCase() ? -1 : 1; })
        .map(function (row) {
          var f = row.flow;
          var params = (f.parameters || []).map(function (p) { return p.name + (p.type ? ' (' + p.type + ')' : ''); });
          var flowKind = key === 'microflows' ? 'microflow' : key === 'nanoflows' ? 'nanoflow' : 'page';
          var marks = commentMarker(f.qualifiedName);
          var card = withMod(el('div', { class: 'flow-card' }, [
            el('div', { class: 'flow-card-name', text: f.name }),
            el('div', { class: 'flow-card-meta' }, [
              roleIndicator(row.allowed, f),
              el('div', { class: 'meta-spacer' }),
              inputIndicator(params)
            ]),
            // Only a marker that comments exist — writing one happens in the
            // object's own window, where the thing being commented on is
            // actually in front of you. A write action on a browsing card is
            // a click you make without having looked. With nothing to mark,
            // the row is left out rather than reserved: an empty strip at the
            // bottom of most cards in the grid is a ragged grid.
            marks.length ? el('div', { class: 'flow-card-badges' }, marks) : null
          ].filter(Boolean)), f.module);
          card.addEventListener('click', function () { openFlowPopup(flowKind, f.qualifiedName); });
          return card;
        });
      return withMod(el('div', { class: 'module-group' }, [
        el('div', { class: 'module-group-head' }, [
          el('span', { class: 'module-group-name', text: mod }),
          el('span', { class: 'module-group-count', text: cards.length + ' shown' })
        ]),
        el('div', { class: 'flow-grid' }, cards)
      ]), mod);
    }));
  }

  // ---------- project detail ----------
  function renderProjectDetail(project) {
    if (DEV_SECTIONS[state.detail.view] && !devTools(project)) state.detail.view = 'overview';
    var model = state.detail.model;
    // Microflows and nanoflows: one screen, the list beside the drawn flow (microflows.js).
    if (state.detail.view === 'microflows' || state.detail.view === 'nanoflows' || state.detail.view === 'pages') return window.MxMicroflows.renderScreen(project);
    if (state.detail.view === 'entities') return window.MxDomain.renderScreen(project);
    if (DOC_VIEW[state.detail.view]) return renderDocPage(model, project);

    // View body + its own controls.
    var body, controls;
    var showModuleChips = renderModuleChips(model);
    if (state.detail.view === 'pages') {
      controls = el('div', { class: 'view-controls' }, [renderFilterInput('Filter pages…'), showModuleChips].filter(Boolean));
      body = renderFlowList(model, 'pages', 'pages');
    } else if (state.detail.view === 'security') {
      controls = null;
      body = window.MxSecurity.renderPanel(model);
    } else if (state.detail.view === 'live') {
      controls = null;
      body = window.MxLive.renderPanel(model, project);
    } else if (state.detail.view === 'performance') {
      controls = null;
      body = window.MxPerf.renderPanel(model, project);
    } else if (state.detail.view === 'comments') {
      controls = null;
      body = window.MxComments.renderList(model);
    } else if (state.detail.view === 'settings') {
      controls = null;
      body = window.MxSettings.render(project);
    } else if (state.detail.view === 'context') {
      controls = null;
      body = window.MxBasket.render(project);
    }

    // View as is offered only where it narrows the screen — Entities, Microflows,
    // Nanoflows and Pages, which draw their own headers (Karol, 2026-10-14: a
    // control that does nothing is a lie). None of the screens drawn here
    // does: the Live app works through the session signed in to the app,
    // whatever role is picked (a role still shapes an entity's data window,
    // which has its own selector); Comments and a performance recording are
    // what real sessions did, and re-labelling that with another role would be
    // a claim MxScout cannot make; Security shows every role at once; Settings
    // is the project's.
    //
    // If the app does not enforce its access rules, what the Live app reads is
    // not what the model's rules describe — so it says so before showing
    // anything. The Security section carries its own copy of this and does
    // not need it twice; a Production project is the normal case and gets no
    // banner.
    //
    // The screen around it is the redesigned screens' own (Karol, 2026-10-13:
    // Security and Live app did not match the rest): the section's name and
    // what it is for, the search and the project's menu, then the section
    // itself from the left edge, the whole width.
    var warnLevel = state.detail.view === 'live';
    return el('div', { class: 'xe xe-pagescreen' }, [
      screenHeader(model, project, false),
      warnLevel ? window.MxSecurity.renderLevelWarning(model) : null,
      controls ? el('div', { class: 'xe-page-controls' }, [controls]) : null,
      el('div', { class: 'xe-page view-body', 'data-keep-scroll': ['page', state.detail.view].concat(state.detail.view === 'performance' && state.detail.perf ? [state.detail.perf.selectedId, state.detail.perf.tab] : []).join('|') }, [body])
    ].filter(Boolean));
  }

  // ---------- the documentation's pages as screens ----------
  // MxScout's section key → the documentation page it shows (docs-view.js).
  var DOC_VIEW = { overview: 'start', processes: 'processes', assist: 'assist', cases: 'cases', modules: 'modules', arch: 'arch', risks: 'risks', quality: 'quality', dev: 'dev' };
  var DOC_SECTION = {};
  Object.keys(DOC_VIEW).forEach(function (k) { DOC_SECTION[DOC_VIEW[k]] = k; });
  // The whole model with the System module added, Marketplace modules
  // included: what the documentation's pages and the Entities screen read.
  // One object per model, so the documentation data built from it
  // (docs.js) is built once for all of those screens, not once for each.
  var docModel = { raw: null, model: null };
  function fullModelOf(raw) {
    if (docModel.raw !== raw) docModel = { raw: raw, model: deriveModel(raw, true) };
    return docModel.model;
  }
  // A link on one of these pages opens MxScout's own screen for what it names.
  function docRoute(patch) {
    var v = patch.view;
    if (v === 'refs') {
      var key = String(patch.key || ''), i = key.indexOf(':');
      // The documentation keys a flow as "mf:Module.Name"; its kind is in seg.
      var pre = i > 0 ? key.slice(0, i) : '';
      var kind = patch.seg || { mf: 'microflow', nf: 'nanoflow', pg: 'page' }[pre] || pre || 'microflow', qn = i > 0 ? key.slice(i + 1) : null;
      state.detail.view = kind === 'nanoflow' ? 'nanoflows' : kind === 'page' ? 'pages' : 'microflows';
      if (qn) window.MxMicroflows.select(qn); else render();
      return true;
    }
    if (v === 'domain') { state.detail.view = 'entities'; state.detail.docPatch = { view: 'entities', patch: patch }; render(); return true; }
    var section = DOC_SECTION[v];
    if (!section) return false;
    state.detail.view = section;
    state.detail.docPatch = { view: section, patch: patch };
    render();
    return true;
  }
  // The patch a link left for the screen it opened, taken once.
  function takeDocPatch(view) {
    var p = state.detail.docPatch && state.detail.docPatch.view === view ? state.detail.docPatch.patch : null;
    state.detail.docPatch = null;
    return p;
  }
  function renderDocPage(model, project) {
    var view = state.detail.view;
    var raw = state.detail.rawModel || model;
    var pg = window.MxDocs.pageScreen(DOC_VIEW[view], fullModelOf(raw), project, { route: docRoute, patch: takeDocPatch(view), cases: window.MxKnowledge.hook(project.id), assist: window.MxAssist.hook(project.id, function (err) { setMessage('Could not save that: ' + ((err && err.message) || err), 'error'); render(); }),
      // On the Risks page, a risk's own buttons: False positive…, Mark fixed…, Reopen (triage.js).
      riskActions: function (r) { return devTools(project) ? window.MxTriage.actions(project.id, r) : []; } });
    var body = pg.has ? el('div', { class: 'dm-host' }, [pg.host]) : el('div', { class: 'xe-page view-body', 'data-keep-scroll': 'page|' + view }, [
      el('div', { class: 'card doc-empty' }, [
        el('h3', { text: 'An agent writes this page' }),
        el('p', { class: 'hint', text: 'It is drawn from descriptions an AI agent wrote from the model. Keep the project in a folder (Documentation → Write with Claude) and ask Claude there — or share it with an agent, or import a descriptions file — and it appears here.' }),
        el('button', { class: 'btn btn-primary btn-sm', text: 'Open Documentation', onclick: function () { goToSection('docs'); } })
      ])
    ]);
    return el('div', { class: 'xe dm-screen doc-screen' }, [screenHeader(model, project, false, pg.has ? pg.sub : null), body]);
  }

  var SCREEN_TITLE = { overview: 'Overview', processes: 'Processes', assist: 'Assist', cases: 'Solved cases', modules: 'Modules', arch: 'Architecture', risks: 'Risks', quality: 'Model quality', dev: 'For developers', pages: 'Pages', security: 'Security', live: 'Live app', performance: 'Performance', comments: 'Comments', context: 'Context', settings: 'Settings' };
  var SCREEN_SUB = {
    overview: 'What this application is, who uses it and how it is built',
    processes: 'What the application does for the business, step by step',
    assist: 'What an agent helped with: tickets, Jira issues, ideas and your workbook, each with its status',
    cases: 'What stayed behind when a case was solved: the problem, the cause, the solution, the dead ends',
    modules: 'Each module: what it is for, what is in it, and what it depends on',
    arch: 'How the application is built and what it talks to',
    risks: 'What could go wrong in this model, ranked P1 to P3',
    quality: 'Checks read straight from the model, against Mendix’s own guidelines',
    dev: 'What to know before you change this model',
    pages: 'Every page, by module, with who may open it and what it takes',
    security: 'How the app is secured, as the project itself records it',
    live: 'Read real rows and run flows against the running app you are testing',
    performance: 'Record what the running app does, and where the time goes',
    comments: 'What was noted about this model, and where each note stands',
    context: 'What you put aside to talk over with a chat assistant, and the prompt made of it',
    settings: 'MxScout, and this project'
  };
  function screenHeader(model, project, withRoles, sub) {
    var search = el('input', { type: 'text', class: 'xe-search-input', placeholder: 'Search modules, flows, pages, entities…', 'aria-label': 'Search' });
    function toPalette() { var v = search.value; search.value = ''; search.blur(); window.MxPalette.open(v); }
    search.addEventListener('focus', toPalette);
    search.addEventListener('input', toPalette);
    var open = !!state.detail.screenMenu;
    var menu = open ? el('div', { class: 'xe-menu', role: 'menu' }, [
      el('button', { type: 'button', role: 'menuitem', text: 'Rename…', onclick: function () { state.detail.screenMenu = false; state.renameProject = project.id; render(); } }),
      el('button', { type: 'button', role: 'menuitem', text: 'Replace model…', onclick: function () { state.detail.screenMenu = false; openReplaceModel(project.id); } }),
      el('button', { type: 'button', role: 'menuitem', text: 'Package…', onclick: function () { state.detail.screenMenu = false; window.MxTransfer.startPackaging(project.id); } }),
      folderMenuItem(project, function () { state.detail.screenMenu = false; }),
      el('button', { type: 'button', role: 'menuitem', class: 'danger', text: 'Delete project', onclick: function () { state.detail.screenMenu = false; state.confirmDelete = project.id; render(); } })
    ]) : null;
    var more = el('div', { class: 'xe-more' }, [el('button', {
      type: 'button', class: 'xe-icon-btn', 'aria-label': 'Project actions — rename, replace model, package, delete',
      title: 'Rename · Replace model · Package · Delete project', 'aria-expanded': open ? 'true' : 'false', text: '⋯',
      onclick: function () { state.detail.screenMenu = !open; render(); }
    }), menu].filter(Boolean));
    var view = state.detail.view;
    return el('header', { class: 'xe-head' }, [
      el('div', { class: 'xe-title' }, [el('h1', { text: SCREEN_TITLE[view] || project.name }), el('p', { class: 'xe-sub', text: sub || SCREEN_SUB[view] || '' })]),
      el('label', { class: 'xe-search' }, [search, el('kbd', { text: 'Ctrl K' })]),
      el('div', { class: 'xe-head-right' }, [window.MxFolderUI.headerButton(project), withRoles ? renderRoleSelector(model) : null, more].filter(Boolean))
    ]);
  }

  // The project menu's folder entry, on every screen's header (folderui.js).
  function folderMenuItem(project, close) { return window.MxFolderUI.menuItem(project, close); }

  // ---------- renaming a project ----------
  // Karol, 2026-10-14: a project's name was fixed once it was created. Only the
  // name changes; the model, descriptions and everything kept with it stay.
  var PROJECT_NAME_MAX = 120;
  function renderRenameProject() {
    var project = findProject(state.renameProject);
    if (!project) return null;
    var input = el('input', { type: 'text', value: project.name, maxlength: String(PROJECT_NAME_MAX), 'aria-label': 'Project name' });
    var hint = el('p', { class: 'hint', text: '' });
    function close() { state.renameProject = null; render(); }
    function save() {
      var name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { hint.textContent = 'A project needs a name.'; input.focus(); return; }
      if (name === project.name) { close(); return; }
      var was = project.name;
      project.name = name;
      project.updatedAt = new Date().toISOString();
      state.renameProject = null;
      saveProjectMeta(project).then(function () {
        sortProjects();
        setMessage('Project "' + was + '" is now "' + name + '".', 'ok');
        render();
      });
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } });
    setTimeout(function () { if (input.isConnected) { input.focus(); input.select(); } }, 0);
    return el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === e.currentTarget) close(); } }, [
      window.MxDialog.modal(el('div', { class: 'modal' }, [
        el('h3', { text: 'Rename project' }),
        el('label', { class: 'field' }, [el('span', { text: 'Project name' }), input]),
        hint,
        el('p', { class: 'hint', text: 'Only the name changes: the model, its descriptions and everything kept with the project stay as they are.' }),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: close }),
          el('button', { class: 'btn btn-primary', text: 'Rename', onclick: save })
        ])
      ]), close)
    ]);
  }

  // ---------- delete confirmation ----------
  function renderConfirmDelete() {
    var project = findProject(state.confirmDelete);
    if (!project) return null;
    var closeDelete = function () { state.confirmDelete = null; render(); };
    return el('div', { class: 'modal-backdrop' }, [
      window.MxDialog.modal(el('div', { class: 'modal' }, [
        el('h3', { text: 'Delete this project?' }),
        el('p', { text: '"' + project.name + '" and its stored model will be removed from this browser. Export it first if you want to keep a copy — this cannot be undone.' }),
        store.hasFolder(project.id) ? el('p', { class: 'muted', text: 'The folder it is kept in, ' + store.folderInfo(project.id).name + ', is not touched: its files stay on disk, and Open a project folder… brings the project back.' }) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: closeDelete }),
          el('button', {
            class: 'btn', text: 'Package it first',
            onclick: function () { window.MxTransfer.startPackaging(project.id); }
          }),
          el('button', {
            class: 'btn btn-danger-outline', text: 'Delete',
            onclick: function () {
              var name = project.name;
              state.confirmDelete = null;
              render();
              deleteProject(project.id).then(function () {
                setMessage('Project "' + name + '" deleted.', 'ok');
              }, function (err) {
                setMessage((err && err.message) || 'Could not delete that project.', 'error');
              }).then(render);
            }
          })
        ])
      ]), closeDelete)
    ]);
  }

  // ---------- about (the page you hand to a security reviewer) ----------
  // The document itself lives in about.js — it is the one thing here that a
  // person outside the project reads end to end. What stays is only which
  // screen is showing and where the version comes from.
  function openAbout() {
    state.appSettings = null;
    state.about = { health: null };
    state.guide = null;
    state.logs = null;
    setMessage(null);
    // Version comes from the running server rather than a constant in this
    // file, so the page can never claim a version that isn't the one serving
    // it. A failure here is not worth an error banner — the row says so.
    api('/api/health').then(function (health) {
      if (state.about) { state.about.health = health; render(); }
    }, function () { /* the Version row reports it instead */ });
  }

  function closeAbout() {
    state.about = null;
    setMessage(null);
  }

  // ---------- log analysis ----------
  // The screens and the engines behind them live in public/logs/. All that
  // belongs here is whether the section is showing: opening it leaves the
  // open project exactly as it was, and the module keeps its own state — a
  // loaded log is large, lives in memory only, and must survive this file
  // redrawing the page around it.
  function openLogs() {
    state.logs = {};
    state.about = null;
    state.guide = null;
    state.newProject.open = false;
    setMessage(null);
    window.MxLogs.open();
  }

  function closeLogs() {
    state.logs = null;
    setMessage(null);
  }

  // The open project's model, handed to the log screen: a PostgreSQL message names a table (`shop$order`)
  // where a developer thinks in entities (`Shop.Order`), and a warning that says `Sales.ACT_Save` can open
  // that microflow and be turned into a comment on it. Only the model of the OPEN project is ever offered,
  // and it is withdrawn when none is. Rebuilt only when the model object itself changes, not on every redraw.
  var lastLogModel;
  var LOG_SECTIONS = [['entities', 'entity'], ['microflows', 'microflow'], ['nanoflows', 'nanoflow'], ['pages', 'page']];
  function syncLogEntities() {
    var model = state.detail ? state.detail.model : null;
    if (model === lastLogModel) return;
    lastLogModel = model;
    if (!model) {
      window.MxLogs.setTableMap(null);
      window.MxLogs.setEntityResolver(null);
      window.MxLogs.setModel(null);
      return;
    }
    var index = {}, tables = {};
    LOG_SECTIONS.forEach(function (pair) {
      (model[pair[0]] || []).forEach(function (item) {
        if (!item || !item.qualifiedName) return;
        index[item.qualifiedName] = { kind: pair[1], section: pair[0], qualifiedName: item.qualifiedName, module: item.module, name: item.name };
        if (pair[0] === 'entities') tables[item.qualifiedName.replace('.', '$').toLowerCase()] = item.qualifiedName;
      });
    });
    window.MxLogs.setTableMap(tables);
    window.MxLogs.setEntityResolver(function (table) { return tables[String(table).toLowerCase()] || null; });
    var project = findProject(state.activeId);
    window.MxLogs.setModel({
      projectName: project ? project.name : 'This project',
      index: index,
      tables: tables,
      // Open it as an ASIDE, over the log: closing it puts the reader back on the same line.
      open: function (o) { peekObject(o.section, { name: o.name, qualifiedName: o.qualifiedName }); },
      // Start a comment on it, with the log lines already written in. Nothing is saved until Save comment.
      report: function (o, draft) {
        var item = (model[o.section] || []).filter(function (x) { return x.qualifiedName === o.qualifiedName; })[0] || o;
        window.MxComments.openEditor(commentTargetFor(o.section, item), null, draft);
      },
      findings: function (o) {
        return window.MxComments.findingsFor(o.qualifiedName).filter(function (f) { return f.status === 'open'; }).length;
      }
    });
  }

  // ---------- guide (the Getting started walkthrough) ----------
  // The document itself lives in guide.js, built the same way about.js is —
  // data rendered by one function. Nothing here needs a project or the
  // server, so opening it is just a flag, same shape as About above.
  function openGuide() {
    state.guide = {};
    state.about = null;
    state.logs = null;
    setMessage(null);
  }

  function closeGuide() {
    state.guide = null;
    state.logs = null;
    setMessage(null);
  }

  // The Logs section of the open project (as opposed to the model-less Tools entry, state.logs).
  function logsInProject() {
    return !!(state.detail && state.activeId && state.detail.view === 'logs' &&
      !state.about && !state.guide && !state.newProject.open && !state.storageError);
  }

  // The Documentation section is where the documentation file is made: what
  // it holds, a look at it, and the export. Wide, for the previews.
  function docsInProject() {
    return !!(state.detail && state.activeId && state.detail.view === 'docs' &&
      !state.about && !state.guide && !state.newProject.open && !state.storageError);
  }

  // ---------- render ----------
  // A screen that throws while it is drawn used to leave the page blank
  // (Karol, 2026-10-13: "sometimes I click something and get an empty
  // screen"). Now it says what broke, and offers a way back.
  function render() {
    try { renderScreen(); }
    catch (err) {
      if (window.console) console.error(err);
      var app = document.getElementById('app');
      while (app.firstChild) app.removeChild(app.firstChild);
      var where = String((err && err.stack) || '').split('\n').slice(0, 4).join('\n');
      app.appendChild(el('div', { class: 'render-error' }, [
        el('h2', { text: 'This screen could not be drawn' }),
        el('p', { text: 'Something in MxScout went wrong while drawing it. Nothing was changed or lost. Please send what is below to whoever maintains MxScout.' }),
        el('pre', { class: 'render-error-text', text: ((err && err.message) || String(err)) + (where ? '\n\n' + where : '') }),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Back to Overview', onclick: function () {
            if (state.detail) { state.detail.view = 'overview'; state.detail.selectedEntity = null; state.detail.selectedFlow = null; state.detail.entityDataOnly = false; }
            state.about = null; state.guide = null;
            render();
          } }),
          el('button', { class: 'btn btn-primary', text: 'Reload', onclick: function () { window.location.reload(); } })
        ])
      ]));
    }
  }

  // Every click draws the app again. A box marked data-keep-scroll — the
  // sidebar, a page's list of modules — comes back where the reader left it,
  // matched by its key (Karol, 2026-10-14: a click near the bottom of a menu
  // moved the menu and cut off the link clicked). docs-view.js keeps the
  // same marks across its own redraws.
  function scrollsOf(box) {
    var o = {};
    Array.prototype.forEach.call(box.querySelectorAll('[data-keep-scroll]'), function (n) { o[n.getAttribute('data-keep-scroll')] = [n.scrollTop, n.scrollLeft]; });
    return o;
  }
  function putScrolls(box, o) {
    function put() {
      Array.prototype.forEach.call(box.querySelectorAll('[data-keep-scroll]'), function (n) {
        var at = o[n.getAttribute('data-keep-scroll')];
        if (at && (at[0] || at[1])) { void n.offsetHeight; n.scrollTop = at[0]; n.scrollLeft = at[1]; }
      });
    }
    put();
    if (!window.requestAnimationFrame) return;
    window.requestAnimationFrame(put);
    // Cut short at its bottom by content that comes a moment later: put back while it grows (docs-view.js does the same).
    var tries = 8;
    (function again() { if (tries--) window.requestAnimationFrame(function () { var short = false; Array.prototype.forEach.call(box.querySelectorAll('[data-keep-scroll]'), function (n) { var at = o[n.getAttribute('data-keep-scroll')]; if (at && at[0] > n.scrollTop + 1 && n.scrollTop >= n.scrollHeight - n.clientHeight - 1) { n.scrollTop = at[0]; short = short || n.scrollTop < at[0] - 1; } }); if (short) again(); }); })();
  }

  // Every screen's own scrolling box carries a key naming the screen and its item (Karol, 2026-10-15: "the page
  // jumps back to the top by itself"); a link that moves a page to a place on it (a docPatch) does not keep it.
  function renderScreen() {
    var app = document.getElementById('app');
    var kept = scrollsOf(app);
    if (state.detail && state.detail.docPatch) kept = { sidebar: kept.sidebar };
    // A field kept across the drawing (a screen that keeps its nodes) keeps the focus too: a draw no longer takes the cursor out of it.
    var had = focusedBeforeDraw = document.activeElement;
    try { drawScreen(app); } finally { putScrolls(app, kept); if (had && had !== document.body && had !== document.activeElement && app.contains(had)) try { had.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  var focusedBeforeDraw = null; // what had the focus when this draw began (settings.js keeps its screen while a field of it has)
  function drawScreen(app) {
    while (app.firstChild) app.removeChild(app.firstChild);

    var body;
    // About comes first: it must render even when storage is blocked, since
    // "why is this tool safe" is a fair question to ask before anything works.
    if (state.about) {
      body = window.MxAbout.render(state.about.health ? state.about.health.version : null);
    } else if (state.guide) {
      body = window.MxGuide.render();
    } else if (state.appSettings && !state.activeId) {
      body = window.MxHome.shell('Settings', 'Global settings — what MxScout keeps for every project. Open a project for its own.', window.MxSettings.render(null));
    } else if (state.logs || logsInProject()) {
      syncLogEntities();
      body = window.MxLogs.render();
    } else if (docsInProject()) {
      // The whole model, Marketplace modules included: the export offers every
      // module and leaves the Marketplace ones unticked.
      body = window.MxDocs.render(state.detail.rawModel || state.detail.model, findProject(state.activeId));
    } else if (state.storageError) {
      body = el('div', { class: 'empty' }, [
        el('h2', { text: 'This browser’s storage is unavailable' }),
        el('p', { text: 'MxScout keeps your projects in this browser’s own database (IndexedDB). It is blocked here — private-browsing mode or a site-data restriction is the usual cause.' }),
        state.storageErrorDetail ? el('p', { class: 'muted', text: state.storageErrorDetail }) : null
      ].filter(Boolean));
    } else if (state.newProject.open || !state.activeId || !state.detail) {
      // The new-project form lives on the list screen, so opening it from the
      // sidebar shows that screen without closing the project underneath —
      // Cancel puts the user back where they were.
      body = window.MxHome.render();
    } else {
      body = renderProjectDetail(findProject(state.activeId));
    }

    // The entities map and the flow views can get wide; let them use the full
    // width of the main column instead of the reading-width it otherwise wants.
    // Security too: it is tables of chips and a grid of modules, and at
    // reading width a real project's role table wrapped chips mid-name.
    // About stays at reading width — its tables and paragraphs both read
    // better narrow than stretched across a wide screen.
    var showingLogs = !!(state.logs || logsInProject());
    var showingDocs = docsInProject();
    var d = (state.about || state.guide || state.logs || state.newProject.open) ? null : state.detail;
    var fullBleed = d && (
      d.view === 'microflows' || d.view === 'nanoflows' || d.view === 'pages' || d.view === 'entities' ||
      d.view === 'comments' || d.view === 'performance' || d.view === 'security' || !!DOC_VIEW[d.view]
    );
    // Log analysis takes the whole width AND the whole height: a log is wide,
    // and its lists scroll inside the screen rather than the page.
    var explorer = d && (d.view === 'microflows' || d.view === 'nanoflows' || d.view === 'entities' ||
      d.view === 'pages' || d.view === 'security' || d.view === 'live' || d.view === 'performance' || d.view === 'comments' || d.view === 'settings' || !!DOC_VIEW[d.view]) && !showingLogs && !showingDocs && state.activeId;
    // The projects page and Settings with no project open are drawn in the redesigned screens' frame too (home.js).
    var homeScreen = !state.about && !state.guide && !showingLogs && !showingDocs && !state.storageError && (state.newProject.open || !state.activeId || !state.detail);
    var wrap = el('div', { class: 'content-wrap' + ((fullBleed || showingLogs || showingDocs) ? ' wide' : '') + (showingLogs ? ' lg-wrap' : '') + (explorer || homeScreen ? ' flush' : '') }, [body]);
    if (state.message) {
      var msgNode = el('div', { class: 'msg ' + state.message.kind, text: state.message.text });
      if (state.message.action) {
        msgNode.appendChild(el('button', {
          class: 'msg-action', text: state.message.action.label,
          onclick: state.message.action.onclick
        }));
      }
      wrap.appendChild(msgNode);
    }
    if (state.folderNotice) {
      wrap.appendChild(el('div', { class: 'msg error folder-notice', text: state.folderNotice }, [
        el('button', { class: 'msg-action', text: 'Close', onclick: function () { state.folderNotice = null; render(); } })
      ]));
    }

    app.appendChild(el('div', { class: 'shell' }, [
      renderSidebar(),
      // The screen keeps its place while it is the same screen: a button on it (Share with an agent,
      // Karol 2026-10-14) draws the app again and the page used to jump back to its top. Another
      // screen has another key, and starts at the top.
      el('main', { class: 'main', 'data-keep-scroll': ['main', state.about ? 'about' : '', state.guide ? 'guide' : '', showingLogs ? 'logs' : '', showingDocs ? 'docs' : '', state.activeId || '', d ? d.view : ''].join('|') }, [wrap])
    ]));
    // Put back what a detach took: scroll positions inside the log screen.
    if (showingLogs) window.MxLogs.afterAttach();

    // The package dialogs sit above everything else that is not the palette:
    // both are mid-transaction, and losing one to a stray click would lose an
    // access code that cannot be recovered.
    var unlockModal = window.MxTransfer.renderUnlockModal();
    if (unlockModal) { app.appendChild(unlockModal); return; }
    var packModal = window.MxTransfer.renderPackagingModal();
    if (packModal) { app.appendChild(packModal); return; }
    var bundleModal = window.MxBundle.renderModal();
    if (bundleModal) { app.appendChild(bundleModal); return; }
    var mprImportModal = window.MxMprImport.renderModal();
    if (mprImportModal) { app.appendChild(mprImportModal); return; }

    var replaceModelModal = renderReplaceModelModal();
    if (replaceModelModal) { app.appendChild(replaceModelModal); return; }

    var reportModal = window.MxComments.renderReportModal();
    if (reportModal) { app.appendChild(reportModal); return; }

    var folderModal = window.MxFolderUI.renderMoveAll() || window.MxFolderUI.renderClash();
    if (folderModal) { app.appendChild(folderModal); return; }

    var docsExportModal = window.MxDocs.renderExportModal();
    if (docsExportModal) { app.appendChild(docsExportModal); return; }

    var triageModal = window.MxTriage.renderDialog();
    if (triageModal) { app.appendChild(triageModal); return; }

    var commentsOn = window.MxComments.renderObjectDialog();
    if (commentsOn) app.appendChild(commentsOn);
    var commentEditor = window.MxComments.renderEditor();
    if (commentEditor) app.appendChild(commentEditor);

    // The palette floats over everything, About included — it is how you leave
    // any screen, so it cannot be gated on which screen you are on.
    var palette = window.MxPalette.render();
    if (palette) {
      app.appendChild(palette);
      window.MxPalette.focusIfNeeded(palette);
      return;
    }

    // Every modal belongs to a screen underneath it; none of them may float
    // over the About page or the guide.
    if (state.about || state.guide || state.logs) return;

    if (state.renameProject) {
      var rn = renderRenameProject();
      if (rn) app.appendChild(rn);
      else state.renameProject = null;
    }
    if (state.confirmDelete) {
      var modal = renderConfirmDelete();
      if (modal) app.appendChild(modal);
      else state.confirmDelete = null;
    }
    if (state.detail && state.detail.selectedEntity) {
      var pop = window.MxObjects.renderEntity(state.detail.selectedEntity);
      if (pop) app.appendChild(pop);
    }
    if (state.detail && state.detail.selectedFlow) {
      var flowPop = window.MxObjects.renderFlow(state.detail.selectedFlow);
      if (flowPop) app.appendChild(flowPop);
      // Sits ON TOP of the flow popup, one parameter at a time — appended
      // after it so it stacks above without the flow popup being torn down.
      var picker = window.MxObjects.renderObjectPicker();
      if (picker) app.appendChild(picker);
    }
    if (state.detail && state.detail.live) {
      // Creating a non-persistable object has its own window, over the entity
      // popup or the object picker; the ack gate and the confirm sit above it.
      var createModal = window.MxLive.renderCreateModal();
      if (createModal) app.appendChild(createModal);
      var ackGate = window.MxLive.renderAckGate();
      if (ackGate) app.appendChild(ackGate);
      var confirmModal = window.MxLive.renderConfirmModal();
      if (confirmModal) app.appendChild(confirmModal);
    }
    var versionPanel = window.MxVersion.renderPanel() || window.MxVersion.renderWhatsNew();
    if (versionPanel) app.appendChild(versionPanel);
  }

  // ---------- navigating to an object ----------
  // Shared by the command palette and by a comment's "go to this object" link.
  // It lives here because it mutates state.detail, and that belongs to this
  // file — the palette closes itself first and then calls in.
  function jumpToObject(sectionKey, item) {
    state.detail.view = sectionKey;
    state.detail.moduleScope = null;
    // Land ON the object, not next to it. A microflow, a nanoflow or a page
    // is its own screen now: the search goes there, with it chosen, rather
    // than opening it in a popup over wherever you were (Karol, 2026-10-14).
    var kind = FLOW_KIND_OF[sectionKey] || null;
    if (kind) {
      state.detail.filter = '';
      state.detail.selectedEntity = null;
      state.detail.selectedFlow = null;
      window.MxMicroflows.select(item.qualifiedName);
      return;
    }
    state.detail.filter = item.name;
    state.detail.selectedEntity = sectionKey === 'entities' ? item.qualifiedName : null;
    state.detail.entityDataOnly = false;
    state.detail.selectedFlow = kind ? { kind: kind, qualifiedName: item.qualifiedName } : null;
    state.detail.flowTab = kind && kind !== 'page' ? 'flow' : 'run';
    state.detail.flowStep = null;
    // Chosen objects and typed values belong to the flow they were chosen
    // for, same reset openFlowPopup does — jumping here from a comment or
    // the palette is just a different door into the same popup, and the Run
    // tab's param rows read these as plain objects, never null.
    state.detail.flowPick = {};
    state.detail.flowScalars = {};
    state.detail.flowOverrides = {};
    render();
  }

  // The same popup, WITHOUT leaving the screen that asked for it. Every popup
  // in MxScout is already an overlay over whatever `view` is showing, so this
  // is jumpToObject minus the navigation: the entity or flow opens on top, and
  // closing it puts the reader back exactly where they were.
  //
  // Karol, 2026-09-10, from the performance analyzer: "możemy nacisnąć na
  // Entity albo na Microflow, ale niech się to pojawi w popupie i po
  // kliknięciu nadal jesteśmy w tym miejscu, w którym teraz jesteśmy" — a
  // recording takes real effort to make, and clicking a name in it to see
  // what that microflow is threw the whole analyzer away, tab, zoom, picked
  // span and all. Anywhere the object is an ASIDE to what is on screen this is
  // the right door; jumpToObject stays for the palette and for a comment's
  // "go to this object", where going there IS the point.
  function peekObject(sectionKey, item) {
    var kind = FLOW_KIND_OF[sectionKey] || null;
    state.detail.selectedEntity = sectionKey === 'entities' ? item.qualifiedName : null;
    state.detail.entityDataOnly = false;
    state.detail.selectedFlow = kind ? { kind: kind, qualifiedName: item.qualifiedName } : null;
    // Opened as an aside, a flow shows itself drawn first (objects.js flowPane).
    state.detail.flowTab = kind && kind !== 'page' ? 'flow' : 'run';
    state.detail.flowStep = null;
    state.detail.flowPick = {};
    state.detail.flowScalars = {};
    state.detail.flowOverrides = {};
    render();
  }

  function scopeToModule(moduleName, sectionKey) {
    state.detail.view = sectionKey || (state.detail.view === 'comments' || state.detail.view === 'settings' ? 'entities' : state.detail.view);
    state.detail.moduleScope = moduleName;
    state.detail.hiddenModules = {};
    state.detail.filter = '';
    state.detail.selectedEntity = null;
    state.detail.selectedFlow = null;
    render();
  }

  // What a comment needs to point at one object, built from a model item and
  // the section it came from. objects.js builds the same shape inline for the
  // popup it is already standing in; this is for whoever picked an object
  // instead of opening it.
  var COMMENT_KIND_OF = { entities: 'entity', microflows: 'microflow', nanoflows: 'nanoflow', pages: 'page' };
  function commentTargetFor(sectionKey, item) {
    return {
      kind: COMMENT_KIND_OF[sectionKey] || 'entity',
      qualifiedName: item.qualifiedName,
      module: item.module,
      name: item.name,
      attributes: item.attributes || []
    };
  }

  function objectsOfSection(model, sectionKey) {
    if (sectionKey === 'entities') return model.entities || [];
    if (sectionKey === 'microflows' || sectionKey === 'nanoflows' || sectionKey === 'pages') return model[sectionKey] || [];
    return [];
  }

  // ---------- what comments.js is allowed to reach ----------
  // An explicit surface rather than a pile of globals: comments.js can render,
  // store, and navigate, and nothing else in this file is reachable from it.
  // The rest of the split will follow this shape.
  function jumpToFinding(finding) {
    var t = finding.target;
    var section = t.kind === 'entity' ? 'entities'
      : t.kind === 'microflow' ? 'microflows'
      : t.kind === 'nanoflow' ? 'nanoflows' : 'pages';
    var item = { name: t.name, qualifiedName: t.qualifiedName };
    function isIn(model) {
      return objectsOfSection(model, section).some(function (o) { return o.qualifiedName === t.qualifiedName; });
    }
    // A flow or a page: its own screen, with it picked (Karol, 2026-10-13 — a
    // comment about a microflow takes you to the microflow). An entity opens
    // in its window, as everywhere.
    if (isIn(state.detail.model)) {
      if (section === 'entities') { jumpToObject(section, item); return; }
      state.detail.view = section;
      state.detail.selectedFlow = null;
      window.MxMicroflows.select(t.qualifiedName);
      return;
    }
    // Still in the project, in a Marketplace module this project hides. That
    // is a view setting, not a change to the model, so the way there is to
    // show the module — offered, not done behind the reader's back, because
    // it is a project setting that outlives this click.
    if (isIn(state.detail.rawModel)) {
      setMessage('“' + t.qualifiedName + '” is in a Marketplace module, and this project hides those.', 'error', {
        label: 'Show Marketplace modules',
        onclick: function () {
          setMessage(null);
          setShowMarketplaceModules(findProject(state.activeId), true).then(function () { jumpToFinding(finding); });
        }
      });
      render();
      return;
    }
    // An object renamed out of the model since the comment was written has
    // nowhere to jump to; say so instead of landing on an empty list.
    setMessage('“' + t.qualifiedName + '” is not in the current model — it may have been renamed or removed since this comment was written.', 'error');
    render();
  }

  // Where a comment's object stands: 'shown', 'hidden' (still in the project,
  // in a Marketplace module this project hides) or 'missing' (renamed or
  // deleted since the comment was written). Hidden used to count as missing,
  // so a comment on a CommunityCommons entity was reported as orphaned in a
  // project where nothing had changed. Answering here keeps comments.js from
  // needing to know how a model is shaped.
  function objectState(qualifiedName) {
    if (!state.detail) return 'shown';
    function isIn(model) {
      return ['entities', 'microflows', 'nanoflows', 'pages'].some(function (key) {
        return (model[key] || []).some(function (o) { return o.qualifiedName === qualifiedName; });
      });
    }
    if (isIn(state.detail.model)) return 'shown';
    return isIn(state.detail.rawModel) ? 'hidden' : 'missing';
  }

  function attributesOf(qualifiedName) {
    var entity = findEntity(state.detail.model, qualifiedName);
    return entity ? (entity.attributes || []) : [];
  }

  window.MxComments.init({
    el: el,
    state: state,
    goToSection: goToSection,
    store: store,
    render: render,
    newId: newId,
    withMod: withMod,
    moduleColor: moduleColor,
    moduleNamesOf: moduleNamesOf,
    formatDate: formatDate,
    setMessage: setMessage,
    reportWriteFailure: reportWriteFailure,
    jumpToFinding: jumpToFinding,
    attributesOf: attributesOf,
    objectState: objectState,
    showMarketplaceModules: function () {
      return setShowMarketplaceModules(findProject(state.activeId), true);
    },
    // Comments can be started from the comments view itself, where no object
    // is open — the palette does the choosing.
    pickObject: function (prompt, onPick) {
      window.MxPalette.openPicker(prompt, function (sectionKey, item) {
        onPick(commentTargetFor(sectionKey, item));
      });
    },
    downloadText: downloadText,
    findProject: findProject,
    // Every way a review leaves MxScout is recorded the same way, so "what
    // have I already sent" does not depend on which button was used.
    recordExport: function (projectId, format, label, fileName, findings) {
      var record = {
        id: newId(),
        projectId: projectId,
        at: new Date().toISOString(),
        author: (state.settings.author && state.settings.author.name) || null,
        format: format,
        label: label,
        fileName: fileName || null,
        findings: findings.map(window.MxComments.serialize)
      };
      return store.put('exports', record).then(function () {
        if (state.activeId === projectId) state.exports.unshift(record);
        return record;
      });
    },
    formatDateOnly: function (iso) { return String(iso || '').slice(0, 10); }
  });

  // ---------- boot ----------
  // Storage is asynchronous now, so the first paint happens before any of it
  // resolves. That is deliberate: the shell appears immediately and fills in,
  // rather than the page sitting blank while IndexedDB opens.
  window.MxDialog.init(); // every window over the screen a modal dialog: name, focus, Tab, Escape (dialog.js)
  window.MxAbout.init({ el: el });
  window.MxGuide.init({ el: el, close: function () { closeGuide(); render(); } });
  window.MxTransfer.init({
    el: el, state: state, store: store, render: render, setMessage: setMessage,
    newId: newId, findProject: findProject, sortProjects: sortProjects,
    openProject: openProject, summarize: summarize, safeFileName: safeFileName,
    downloadText: downloadText, withBuiltinSystemModule: withBuiltinSystemModule,
    // A package opened as a new project goes into a folder first, like any new project.
    folderChoice: window.MxFolderUI.choice, freshChoice: window.MxFolderUI.freshChoice,
    choiceReady: window.MxFolderUI.choiceReady, linkNewProject: function (r, b) { return window.MxFolderUI.linkNew(r, b); }
  });
  // The project folder: store.js writes it through folder.js, and hands back what someone else wrote there.
  store.useFolder(window.MxFolder, {
    toFile: window.MxDescribe.toFile,
    assistFiles: window.MxAssist.toFiles, knowledgeFiles: window.MxKnowledge.toFiles,
    version: function () { return window.MxVersion.version(); },
    adopt: function (id, changed) { return window.MxFolderUI.adopt(id, changed); }, reread: function (id) { return window.MxRepoUI.reread(id); }, repoDocs: function (id, h) { return window.MxDocs.repoDocs(id, h); }, skills: function () { return window.MxRepoUI.skills(); }, guide: function () { return window.MxRepoUI.guide(); },
    // Developer tools' two more files, comments.json and triage.json (folderui.js).
    files: window.MxFolderUI.files
  });
  store.onFolder(function (id, info, what) { window.MxFolderUI.onFolder(id, info, what); });
  // Reading a row-level rule is its own topic, and two screens ask about it:
  // the access matrix and the Security section.
  window.MxAccessRule.init({ el: el, state: state, findEntity: findEntity });
  // The Documentation section, built from the model and exportable as one
  // HTML file, or one Markdown file, neither of them encrypted.
  window.MxDocs.init({ el: el, state: state, render: render, store: store, setMessage: setMessage, findProject: findProject, downloadText: downloadText,
    keepInFolder: function (p) { window.MxFolderUI.keep(p); }, keepInRepo: function (p) { window.MxRepoUI.startMove(p); }, reconnectFolder: function (p) { window.MxFolderUI.reconnect(p); }, unkeepFolder: function (p) { window.MxFolderUI.unkeep(p); } });
  window.MxFolderUI.init({ el: el, state: state, store: store, render: render, setMessage: setMessage, findProject: findProject, openProject: openProject,
    summarize: summarize, sortProjects: sortProjects, newId: newId, docs: window.MxDocs, assist: window.MxAssist,
    finishReplacingProject: finishReplacingProject, deriveModel: deriveModel, nameMax: PROJECT_NAME_MAX });
  window.MxAssist.init({ store: store, onChange: function () { render(); }, appendix: function (projectId, x) { return window.MxBasket.appendix(projectId, x); } }); window.MxKnowledge.init({ store: store, onChange: function () { render(); } }); // the Assist items and the solved cases, drawn again whenever one moves
  // Risk triage: what a person decided about each risk, kept apart from the descriptions, checked
  // against new ones when they come in. It reads the comments marked as risks, and says on a comment
  // that is a risk what was decided about it.
  window.MxTriage.init({
    el: el, store: store, render: render, setMessage: setMessage,
    findings: function (projectId) { return state.activeId === projectId ? state.findings : []; },
    author: function () { return (state.settings.author && state.settings.author.name) || null; },
    setCommentStatus: function (id, status) { window.MxComments.setStatusById(id, status); }
  });
  // Descriptions through an AI chat assistant that cannot run code: parts out, answers in.
  window.MxCopilot.init({ el: el, setMessage: setMessage, downloadText: downloadText });
  window.MxBundle.init({ el: el, state: state, store: store, render: render, setMessage: setMessage, newId: newId, sortProjects: sortProjects, summarize: summarize, downloadText: downloadText });
  window.MxSettings.init({ el: el, state: state, store: store, render: render, setMessage: setMessage, renameProject: renameProject, setShowMarketplaceModules: setShowMarketplaceModules,
    reportWriteFailure: reportWriteFailure, formatBytes: formatBytes, formatDate: formatDate, focused: function () { return focusedBeforeDraw; } });
  window.MxTheme.init({ el: el, state: state, render: render, store: store, navIcon: navIcon });
  // The projects page (home.js): the cards, where each project is kept, setting MxScout up once.
  window.MxHome.init({ el: el, state: state, store: store, render: render, setMessage: setMessage, navIcon: navIcon,
    openProject: openProject, openGuide: openGuide, openAbout: openAbout, openAppSettings: openAppSettings, openReplaceModel: openReplaceModel,
    newProjectCard: renderNewProjectCard, formatDate: formatDate, formatBytes: formatBytes });
  window.MxDevTools.init({ el: el, state: state, saveProjectMeta: saveProjectMeta, render: render, setMessage: setMessage, closeLogs: function () { closeLogs(); } });
  window.MxObjects.init({
    devTools: function () { return devTools(); },
    el: el, state: state, render: render, setMessage: setMessage,
    withMod: withMod, moduleRoleSetFor: moduleRoleSetFor,
    listHitsSet: listHitsSet, findEntity: findEntity, exportFlows: exportFlows,
    // "Reached from" opens the thing that reaches this one OVER this popup.
    // objects.js has asked for this since the list was built (2026-09-12) and
    // was never given it, so every one of those links threw and did nothing.
    peekObject: peekObject
  });
  window.MxLive.init({
    el: el, state: state, api: api, render: render, setMessage: setMessage,
    saveProjectMeta: saveProjectMeta, findEntity: findEntity,
    moduleRoleSetFor: moduleRoleSetFor, moduleColor: moduleColor
  });
  window.MxPerf.init({
    el: el, state: state, store: store, render: render, setMessage: setMessage,
    api: api,
    // The analyzer opens objects as an ASIDE — over the recording, not instead
    // of it — so it gets peekObject and deliberately not jumpToObject.
    peekObject: peekObject, objectsOfSection: objectsOfSection,
    newId: newId, formatDate: formatDate, withMod: withMod, moduleColor: moduleColor,
    downloadText: downloadText, pickFile: pickModelFile, readFileText: readFileText
  });
  window.MxMprImport.init({
    el: el, state: state, store: store, render: render, setMessage: setMessage,
    finishCreatingProject: finishCreatingProject, finishReplacingProject: finishReplacingProject,
    openProject: openProject, findProject: findProject
  });
  // An element by its kind and name: an entity opens in its own window over the screen, a flow or a page
  // moves the screen to it. The flows' "Refers to" and the context's list (basket.js).
  function openElement(kind, qn) {
    var model = state.detail.model;
    if (kind === 'microflow' || kind === 'nanoflow') {
      state.detail.view = kind === 'nanoflow' ? 'nanoflows' : 'microflows';
      window.MxMicroflows.select(qn);
      return;
    }
    if (kind === 'page') {
      state.detail.view = 'pages';
      window.MxMicroflows.select(qn);
      return;
    }
    var en = (model.entities || []).filter(function (x) { return x.qualifiedName === qn; })[0];
    if (en) peekObject('entities', en);
  }
  window.MxMicroflows.init({
    devTools: function () { return devTools(); },
    el: el, state: state, render: render, setMessage: setMessage,
    roleSet: function (model) { return moduleRoleSetFor(model, state.detail.role); },
    listHitsSet: listHitsSet, roleSelector: renderRoleSelector, levelWarning: window.MxSecurity.renderLevelWarning,
    exportButton: renderDrawingsExportButton,
    marketplaceChip: renderMarketplaceChip,
    descriptions: function (projectId) { return window.MxDocs.descriptionsFor(projectId); },
    replaceModel: openReplaceModel,
    packageProject: function (id) { window.MxTransfer.startPackaging(id); },
    deleteProject: function (id) { state.confirmDelete = id; render(); },
    // The flow's own window, where it runs against a connected app.
    openWindow: openFlowPopup,
    addComment: function (sectionKey, item) { window.MxComments.openEditor(commentTargetFor(sectionKey, item), null); },
    renameProject: function (id) { state.renameProject = id; render(); },
    folderMenuItem: folderMenuItem, folderButton: function (p) { return window.MxFolderUI.headerButton(p); },
    openFlow: function (kind, qn) {
      state.detail.view = kind === 'nanoflow' ? 'nanoflows' : kind === 'page' ? 'pages' : 'microflows';
      window.MxMicroflows.select(qn);
    },
    // "Refers to": an entity opens in its own window over the screen, a flow
    // or a page moves the screen to it.
    openRef: openElement,
    contextButton: function (kind, qn) { return window.MxBasket.button(state.activeId, kind, qn); },
    contextMenu: function (ev, kind, qn) { window.MxBasket.menu(ev, state.activeId, kind, qn); }
  });
  window.MxDomain.init({
    devTools: function () { return devTools(); },
    el: el, state: state, render: render, roleSelector: renderRoleSelector, levelWarning: window.MxSecurity.renderLevelWarning,
    roleSet: function (model) { return moduleRoleSetFor(model, state.detail.role); },
    fullModel: fullModelOf,
    // A link on the Domain model to another documentation page opens its screen; one that led here leaves its place.
    docRoute: docRoute, docPatch: function () { return takeDocPatch('entities'); },
    replaceModel: openReplaceModel,
    packageProject: function (id) { window.MxTransfer.startPackaging(id); },
    deleteProject: function (id) { state.confirmDelete = id; render(); },
    // Browse data: only the entity's rows in the connected app, over the screen (objects.js renderEntityData).
    browseData: function (item) {
      state.detail.selectedEntity = item.qualifiedName;
      state.detail.entityDataOnly = true;
      state.detail.selectedFlow = null;
      render();
    },
    commentButton: function (sectionKey, item) { return window.MxComments.addButton(commentTargetFor(sectionKey, item), 'Add comment'); },
    contextButton: function (qn) { return window.MxBasket.button(state.activeId, 'entity', qn); },
    contextMenu: function (ev, qn) { window.MxBasket.menu(ev, state.activeId, 'entity', qn); },
    renameProject: function (id) { state.renameProject = id; render(); },
    folderMenuItem: folderMenuItem, folderButton: function (p) { return window.MxFolderUI.headerButton(p); }
  });
  // The context: what was put aside to talk over with a chat assistant (basket.js).
  window.MxBasket.init({
    el: el, store: store, render: render, setMessage: setMessage, downloadText: downloadText,
    // The documentation's data of the project open on the screen — what the prompt and the appendix are written from.
    data: function (projectId) {
      if (!state.detail || state.activeId !== projectId) return null;
      var raw = state.detail.rawModel || state.detail.model;
      return raw ? window.MxDocs.dataFor(fullModelOf(raw), findProject(projectId)) : null;
    },
    language: function (project) { return (project && project.contentLanguage) || window.MxDocs.defaultLanguage() || 'en'; },
    open: openElement,
    openContext: function () { goToSection('context'); },
    openAssist: function (kind, id) { goToSection('assist'); state.detail.docPatch = { view: 'assist', patch: { view: 'assist', akind: kind, aid: id } }; render(); }
  });
  window.MxSecurity.init({ el: el, state: state, moduleColor: moduleColor, withMod: withMod,
    // A rule MxScout could not follow is listed on this page and read in the
    // entity that holds it — as an aside, so closing it lands back here.
    peekObject: peekObject });
  window.MxPalette.init({
    el: el, state: state, render: render, sections: PROJECT_SECTIONS,
    devTools: function () { return devTools(); },
    findProject: findProject, openProject: openProject, goToSection: goToSection,
    jumpToObject: jumpToObject, peekObject: peekObject, scopeToModule: scopeToModule, objectsOfSection: objectsOfSection,
    sectionCount: sectionCount, moduleColor: moduleColor, moduleNamesOf: moduleNamesOf
  });
  window.MxPalette.installShortcuts();
  render();

  store.open().then(function () {
    // Projects used to live in localStorage. Move them across BEFORE reading
    // the list, so an upgrading user sees their projects on this first load
    // rather than an empty screen followed by a surprise. store.js copies and
    // verifies before it removes anything.
    var carriedOver = store.legacyActiveId();
    return store.migrateFromLocalStorage().then(function (result) {
      if (result.migrated) {
        setMessage(
          'Moved ' + result.migrated + ' project' + (result.migrated === 1 ? '' : 's') +
          ' into this browser\u2019s database. Nothing changed for you \u2014 there is simply more room now.',
          'ok'
        );
      }
      if (result.failed.length) {
        setMessage(
          'Could not move ' + result.failed.length + ' project' + (result.failed.length === 1 ? '' : 's') +
          ' out of the old storage (' + result.failed.join(', ') + '). Nothing was deleted \u2014 the old copy is still there.',
          'error'
        );
      }
      // Findings are the one thing here nobody can reproduce, so ask the
      // browser not to evict this origin. A refusal changes nothing today,
      // but Settings reports it so the answer is not invisible.
      store.requestPersistence().then(function (granted) {
        state.settings.persisted = granted;
      });
      // Version and "what changed since you last ran this" — no network is
      // involved, so this cannot fail in a way that should hold up the boot.
      window.MxVersion.init({ api: api, store: store, el: el, render: render }).then(render);
      return store.get('settings', 'author');
    }).then(function (row) {
      state.settings.author = row ? row.value : null;
      return store.get('settings', window.MxTheme.SETTING);
    }).then(function (row) {
      state.settings.theme = row && /^(light|dark|auto)$/.test(row.value) ? row.value : 'light';
      window.MxTheme.apply();
      return loadProjects();
    }).then(function () {
      // Which projects are kept in folders. Each is checked when it is opened (or written).
      // The MxScout folder first (store.js home): a link kept in a Mendix project finds its local part there.
      return store.loadHome().then(function () { return store.loadFolderLinks(); }).catch(function () { return []; });
    }).then(function () {
      // The default language, and every project with none of its own given it (docs.js).
      return window.MxDocs.loadDefaultLanguage();
    }).then(function () {
      if (!state.activeId && carriedOver &&
          state.projects.some(function (p) { return p.id === carriedOver; })) {
        state.activeId = carriedOver; // the project they had open before the move
      }
      // A project id persisted from a previous visit — reopen it so the browser
      // lands straight back in the detail view, but fall back to the list if the
      // stored model has since gone missing.
      if (!state.activeId) return null;
      return openProject(state.activeId).then(function (ok) { if (!ok) closeProject(); });
    });
  }).catch(function (err) {
    state.storageError = true;
    state.storageErrorDetail = (err && err.message) || null;
  }).then(render);
})();
