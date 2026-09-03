/* MxScout — a simple, local Mendix model explorer for developers and testers.
 * Single vanilla-JS IIFE, no framework, no bundler (same shape as MxSonar's
 * public/app.js, deliberately much smaller).
 *
 * Regions below are marked with ---------- name ---------- banners; grep for
 * those to jump around.
 *
 * Everything on this screen is client-side: the server serves these static
 * files and nothing else. Projects (a name + one model) live in the browser's
 * own database — see store.js — never on disk and never on a server.
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
      busy: false
    },
    replaceModel: null,  // { id } — the "Replace model" modal, offering folder or file just like New project
    confirmDelete: null, // project id awaiting delete confirmation
    findings: [],        // comments for the open project (see comments.js)
    exports: [],         // what has been sent from this project, and when
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
    // Set by openProject() while a project is open, cleared by closeProject().
    // Holds the PARSED model (kept out of the project index so the list stays
    // cheap) plus everything the browsing views need — which view is active,
    // the text/module filters, the entity popup, and the chosen role.
    detail: null         // { model, view, entitySub, filter, hiddenModules, selectedEntity, role }
  };

  var _messageTimer = null;
  function setMessage(text, kind) {
    if (_messageTimer) { clearTimeout(_messageTimer); _messageTimer = null; }
    state.message = text ? { text: text, kind: kind || 'error' } : null;
    // A success toast is about what just happened, not a standing fact about
    // the screen — unlike an error, which stays until the thing it complains
    // about is fixed, it should get out of the way on its own instead of
    // following the user to every page they visit next.
    if (state.message && state.message.kind === 'ok') {
      var mine = state.message;
      _messageTimer = setTimeout(function () {
        _messageTimer = null;
        if (state.message === mine) { state.message = null; render(); }
      }, 4000);
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
      userRoles: (model.userRoles || []).map(function (r) {
        return Object.assign({}, r, {
          moduleRoles: (r.moduleRoles || []).filter(function (mr) { return !hiddenNames[String(mr).split('.')[0]]; })
        });
      })
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
        view: 'entities',        // entities | microflows | nanoflows | pages
        entitySub: 'list',       // list | map  (only meaningful in the entities view)
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
        data: null,              // the page of live rows a Data tab is showing
        transient: null,         // non-persistable entity: looked-up/created objects this session
        // 'all' shows everything regardless of role; otherwise a user-role name.
        // Default to the first role so a tester lands on a realistic, filtered
        // picture instead of the raw everything-view.
        role: roles.length ? roles[0].name : 'all',
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
      window.MxComments.loadFindings(id).then(render);
      store.byIndex('exports', 'byProject', id).then(function (rows) {
        state.exports = rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        render();
      });
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
      userRoles: countOf(model, 'userRoles')
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
  function finishCreatingProject(name, source, model) {
    var now = new Date().toISOString();
    var record = {
      id: newId(),
      name: name,
      createdAt: now,
      updatedAt: now,
      source: source,
      fileName: (source && source.fileName) || null,
      bytes: JSON.stringify(model).length,
      summary: summarize(model)
    };
    return store.saveProjectWithModel(record, model).then(function () {
      state.projects.push(record);
      sortProjects();
      return record;
    });
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
  function finishReplacingProject(id, source, model) {
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
      showMarketplaceModules: project.showMarketplaceModules || false
    };
    return store.saveProjectWithModel(updated, model).then(function () {
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
    // one transaction (see store.js).
    return store.deleteProjectDeep(id).then(function () {
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
    var input = el('input', { type: 'file', accept: accept || '.mxscout,.json,application/json,.mpr' });
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
  // finer stops reading at that size.
  var LOGO_COLOR = '#e8a33d';
  function renderLogo(size) {
    var svgNs = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 34 34');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    // Edges first, so the nodes sit on top of them.
    [['9', '12', '24', '9'], ['9', '12', '17', '25']].forEach(function (e) {
      var line = document.createElementNS(svgNs, 'line');
      line.setAttribute('x1', e[0]); line.setAttribute('y1', e[1]);
      line.setAttribute('x2', e[2]); line.setAttribute('y2', e[3]);
      line.setAttribute('stroke', LOGO_COLOR); line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    });
    [['9', '12'], ['24', '9'], ['17', '25']].forEach(function (c) {
      var circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', c[0]); circle.setAttribute('cy', c[1]); circle.setAttribute('r', '4.2');
      circle.setAttribute('fill', LOGO_COLOR);
      svg.appendChild(circle);
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
    { key: 'entities', label: 'Entities', countKey: 'entities' },
    { key: 'microflows', label: 'Microflows', countKey: 'microflows' },
    { key: 'nanoflows', label: 'Nanoflows', countKey: 'nanoflows' },
    { key: 'pages', label: 'Pages', countKey: 'pages' },
    { key: 'comments', label: 'Comments', countKey: null },
    { key: 'live', label: 'Live app', countKey: null, apart: true },
    { key: 'settings', label: 'Settings', countKey: null, apart: true }
  ];

  function sectionCount(project, section) {
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
      return Array.isArray(list) ? list.length : 0;
    }
    var summary = project.summary || {};
    return typeof summary[section.countKey] === 'number' ? summary[section.countKey] : null;
  }

  function goToSection(key) {
    state.about = null;
    state.guide = null;
    state.newProject.open = false;
    state.detail.view = key;
    state.detail.selectedEntity = null;
    render();
  }

  function renderProjectTree() {
    if (!state.projects.length) {
      return el('p', { class: 'tree-empty', text: 'No projects yet.' });
    }
    return el('div', { class: 'tree' }, state.projects.map(function (project) {
      var isActive = state.activeId === project.id && !!state.detail;
      var row = el('button', {
        class: 'tree-project' + (isActive ? ' active' : ''),
        onclick: function () {
          if (isActive) return;
          state.about = null;
          state.guide = null;
          state.newProject.open = false;
          openProject(project.id).then(render);
        }
      }, [
        el('span', { class: 'tree-project-name', text: project.name })
      ]);

      // Each project is a card. Closed, it is just its own title; open, the
      // card grows a tinted title bar and holds its sections inside — which
      // is the whole point: the boundary of a project is drawn, not implied
      // by weight and indentation the eye has to reconstruct.
      if (!isActive) return el('div', { class: 'tree-node' }, [row]);

      var sections = PROJECT_SECTIONS.map(function (section) {
        var count = sectionCount(project, section);
        return el('button', {
          class: 'tree-section' + (state.detail.view === section.key ? ' active' : '') + (section.apart ? ' apart' : ''),
          onclick: function () { goToSection(section.key); }
        }, [
          el('span', { text: section.label }),
          count === null ? null : el('span', { class: 'tree-count', text: String(count) })
        ].filter(Boolean));
      });

      return el('div', { class: 'tree-node open' }, [row, el('div', { class: 'tree-sections' }, sections)]);
    }));
  }

  function renderSidebar() {
    var brand = el('div', { class: 'sidebar-head' }, [
      renderLogo(30),
      el('div', {}, [
        el('div', { class: 'sidebar-brand', text: 'MxScout' }),
        el('div', { class: 'sidebar-brand-sub', text: 'Mendix model explorer' })
      ])
    ]);

    var newBtn = el('button', {
      class: 'btn btn-primary sidebar-new',
      text: '+ New project',
      onclick: function () {
        state.about = null;
        state.guide = null;
        state.newProject.open = true;
        setMessage(null);
        render();
      }
    });

    var allProjects = el('button', {
      class: 'tree-all' + ((!state.detail && !state.about && !state.guide) ? ' active' : ''),
      text: 'All projects',
      onclick: function () {
        state.about = null;
        state.guide = null;
        state.newProject.open = false;
        closeProject();
        render();
      }
    });

    var guide = el('button', {
      class: 'sidebar-foot-btn' + (state.guide ? ' active' : ''),
      text: 'Getting started',
      // Same toggle as About: with the topbar gone, pressing it again is the
      // only way back out of it.
      onclick: function () {
        if (state.guide) closeGuide(); else openGuide();
        render();
      }
    });

    var about = el('button', {
      class: 'sidebar-foot-btn' + (state.about ? ' active' : ''),
      text: 'About & security',
      // Toggles: with the topbar gone this is the only control for the page,
      // so pressing it again has to be the way back out.
      onclick: function () {
        if (state.about) closeAbout(); else openAbout();
        render();
      }
    });

    // The version sits next to About because that is where someone looks when
    // they want to know what they are running — and it is a plain label, not a
    // notification: MxScout never learns that a newer one exists.
    var versionBtn = el('button', {
      class: 'sidebar-foot-btn sidebar-version' + (window.MxVersion.isOpen() ? ' active' : ''),
      text: window.MxVersion.version() ? ('Version ' + window.MxVersion.version()) : 'Version',
      title: 'What is in this version, and how to move to a newer one',
      onclick: function () { window.MxVersion.open(); }
    });

    // No search box here any more (Karol): the palette is opened with / or
    // Ctrl-K, and a permanent box in the sidebar bought discoverability at
    // the price of a control that looked like it filtered the list under it
    // and did not.
    return el('aside', { class: 'sidebar' }, [
      brand,
      newBtn,
      el('div', { class: 'sidebar-scroll' }, [
        allProjects,
        el('div', { class: 'sidebar-label', text: 'Projects' }),
        renderProjectTree()
      ]),
      el('div', { class: 'sidebar-foot' }, [guide, about, versionBtn])
    ]);
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
        state.newProject = { open: false, name: '', file: null, busy: false };
        window.MxMprImport.open();
        window.MxMprImport.handleMprFile(file);
        return;
      }
      readFileText(file, function (fileName, text) {
        if (window.MxTransfer.handlePickedFile(fileName, text, 'new', null)) {
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
        state.newProject = { open: false, name: '', file: null, busy: false };
        window.MxMprImport.open();
        window.MxMprImport.pickProjectFolder();
      });
    }

    function submit() {
      var name = (state.newProject.name || '').trim();
      if (!name) { setMessage('Give the project a name first.', 'error'); render(); return; }
      if (!state.newProject.file) { setMessage('Choose a project file first.', 'error'); render(); return; }
      var created;
      try {
        created = createProject(name, state.newProject.file.fileName, state.newProject.file.text);
      } catch (err) {
        // parseModelText rejects a bad file synchronously, before any write.
        setMessage((err && err.message) || 'Could not create that project.', 'error');
        render();
        return;
      }
      state.newProject = { open: false, name: '', file: null, busy: true };
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

    return el('div', { class: 'card' }, [
      el('h2', { text: 'New project', style: 'margin:0 0 14px;font-size:15px' }),
      el('label', { class: 'field' }, [el('span', { text: 'Project name' }), nameInput]),
      folderPrimary ? el('label', { class: 'field' }, [el('span', { text: 'Project folder' }), folderPrimary]) : null,
      el('label', { class: 'field' }, [el('span', { text: 'Project file' }), drop]),
      el('p', { class: 'hint', text: 'Nothing here is uploaded anywhere — it is read in this browser and saved to this browser’s own database on this machine.' }),
      el('div', { class: 'modal-actions', style: 'margin-top:14px' }, [
        el('button', {
          class: 'btn', text: 'Cancel',
          onclick: function () { state.newProject = { open: false, name: '', file: null, busy: false }; setMessage(null); render(); }
        }),
        el('button', { class: 'btn btn-primary', text: 'Create project', onclick: submit })
      ])
    ]);
  }

  // ---------- project list ----------
  function renderCountPills(summary) {
    var pills = [
      ['modules', 'modules'], ['entities', 'entities'], ['associations', 'associations'],
      ['microflows', 'microflows'], ['nanoflows', 'nanoflows'], ['pages', 'pages'], ['userRoles', 'user roles']
    ];
    return el('div', { class: 'counts' }, pills.map(function (p) {
      var n = summary && summary[p[0]];
      if (!n) return null;
      return el('span', { class: 'count-pill' }, [el('b', { text: String(n) }), document.createTextNode(' ' + p[1])]);
    }).filter(Boolean));
  }

  function projectSubtitle(project) {
    var parts = [];
    if (project.summary && project.summary.appName) parts.push(project.summary.appName);
    if (project.summary && project.summary.mendixVersion) parts.push('Mendix ' + project.summary.mendixVersion);
    parts.push('updated ' + formatDate(project.updatedAt));
    parts.push(formatBytes(project.bytes));
    return parts.join(' · ');
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

    return el('div', { class: 'modal-backdrop' }, [
      el('div', { class: 'modal' }, [
        el('h3', { text: 'Replace model for "' + project.name + '"' }),
        el('p', { class: 'muted', text: 'Loads a newer model over this project’s current one. Comments stay — matched by qualified name — but one on something renamed or removed since will show as orphaned rather than disappearing.' }),
        folderBox ? el('label', { class: 'field' }, [el('span', { text: 'Project folder' }), folderBox]) : null,
        el('label', { class: 'field' }, [el('span', { text: 'Project file' }), fileBox]),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: function () { state.replaceModel = null; render(); } })
        ])
      ].filter(Boolean))
    ]);
  }

  function renderProjectCard(project) {
    return el('div', { class: 'project-card' + (project.id === state.activeId ? ' active' : '') }, [
      el('div', { class: 'project-main' }, [
        el('p', { class: 'project-name', text: project.name }),
        el('p', { class: 'project-meta', text: projectSubtitle(project) }),
        renderCountPills(project.summary)
      ]),
      el('div', { class: 'project-actions' }, [
        el('button', {
          class: 'btn btn-primary btn-sm', text: 'Open',
          onclick: function () { openProject(project.id).then(render); }
        }),
        el('button', { class: 'btn btn-sm', text: 'Replace model…', title: 'Load a newer model, from a project folder or a file', onclick: function () { openReplaceModel(project.id); } }),
        el('button', {
          class: 'btn btn-sm', text: 'Package…',
          title: 'Encrypt this project for someone else',
          onclick: function () { window.MxTransfer.startPackaging(project.id); }
        }),
        el('button', {
          class: 'btn btn-danger-outline btn-sm', text: 'Delete',
          onclick: function () { state.confirmDelete = project.id; render(); }
        })
      ])
    ]);
  }

  function renderProjectList() {
    // Creating a project shows the form and nothing else. The existing
    // projects already live in the left sidebar, so re-listing them as cards
    // under the form was noise — the "attached below" list the user asked to
    // drop.
    if (state.newProject.open) {
      return el('div', {}, [renderNewProjectCard()]);
    }

    var children = [
      el('div', { class: 'section-head' }, [
        state.projects.length ? el('h2', { text: 'Your projects' }) : el('span'),
        renderNewProjectCard()
      ])
    ];

    if (!state.projects.length) {
      children.push(el('div', { class: 'empty' }, [
        el('h2', { text: 'No projects yet' }),
        el('p', { text: 'A project is a name plus one model JSON exported from MxSonar. Everything stays in this browser.' })
      ]));
    } else {
      children.push(el('div', { class: 'project-list' }, state.projects.map(renderProjectCard)));
    }

    return el('div', {}, children);
  }

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

  // A model lookup, not a popup concern: the popups, the live layer and the
  // comments API all need it.
  function findEntity(model, qn) {
    return (model.entities || []).filter(function (e) { return e.qualifiedName === qn; })[0] || null;
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
    var set = {};
    userRolesOf(model).forEach(function (r) {
      if (r.name === roleName) (r.moduleRoles || []).forEach(function (mr) { set[mr] = true; });
    });
    return set;
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

  // ---------- module colour ----------
  // A stable hue per module, derived from its name — the same module keeps the
  // same colour across reloads and across screens, and two people looking at
  // the same project see the same colours without anything being stored.
  // Ported from MxSonar (which took it from the legacy inspector), so someone
  // moving between the two tools recognises a module by its colour.
  //
  // Where colour is allowed at all: the shell is greyscale on purpose, and the
  // accent is reserved for things you can act on. Module hue is IDENTITY — it
  // says which module a thing belongs to and nothing about its importance.
  // Severity, when comments land, is the opposite: a fixed scale that says how
  // much something matters. Keeping those two jobs in different visual
  // channels is what stops a list of 200 comments turning into confetti.
  function moduleHue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }
  function moduleColor(name) {
    return 'hsl(' + moduleHue(name) + ', 58%, 63%)';
  }
  // Every module-coloured element gets its hue as a CSS custom property, so
  // the stylesheet decides HOW the colour is used (a stripe, a border, text)
  // and this file only decides WHICH colour.
  function withMod(node, moduleName) {
    if (node && moduleName) node.style.setProperty('--mod', moduleColor(moduleName));
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

  // A scope set from the palette path wins outright: `/HeadQuarters/entities/
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
    roles.forEach(function (r) {
      var o = el('option', { value: r.name, text: r.name });
      if (r.name === state.detail.role) o.setAttribute('selected', 'selected');
      select.appendChild(o);
    });
    select.addEventListener('change', function () { state.detail.role = select.value; state.detail.selectedEntity = null; state.detail.selectedFlow = null; render(); });

    var set = moduleRoleSetFor(model, state.detail.role);
    if (set) {
      var mrs = Object.keys(set);
      select.setAttribute('title', state.detail.role + ' maps to ' + mrs.length +
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

  function accessBadges(acc) {
    if (!acc.filtered) return [];
    if (!acc.matched) return [el('span', { class: 'badge badge-none', text: 'No access' })];
    var badges = [el('span', { class: 'badge badge-read', text: acc.write ? 'Read + write' : 'Read only' })];
    if (acc.create) badges.push(el('span', { class: 'badge badge-cd', text: 'Create' }));
    if (acc.del) badges.push(el('span', { class: 'badge badge-cd', text: 'Delete' }));
    return badges;
  }

  // ---------- entities: list view ----------
  function renderEntitiesList(model) {
    var set = moduleRoleSetFor(model, state.detail.role);
    var byModule = {};
    (model.entities || []).forEach(function (e) {
      if (!moduleShown(e.module)) return;
      if (!passesFilter(e)) return;
      var acc = entityAccessFor(e, set);
      if (set && !acc.matched) return;
      (byModule[e.module] = byModule[e.module] || []).push({ entity: e, acc: acc });
    });
    var modules = Object.keys(byModule).sort();
    if (!modules.length) return el('div', { class: 'empty' }, [el('p', { text: 'No entities match the current filter.' })]);

    return el('div', {}, modules.map(function (mod) {
      var cards = byModule[mod]
        .sort(function (a, b) { return a.entity.name.toLowerCase() < b.entity.name.toLowerCase() ? -1 : 1; })
        .map(function (row) {
          var e = row.entity;
          return withMod(el('button', {
            class: 'entity-card',
            onclick: function () { state.detail.selectedEntity = e.qualifiedName; render(); }
          }, [
            el('div', { class: 'entity-card-name', text: e.name }),
            el('div', { class: 'entity-card-sub', text: (e.attributes || []).length + ' attribute' + ((e.attributes || []).length === 1 ? '' : 's') + (e.persistable === false ? ' · non-persistable' : '') }),
            el('div', { class: 'entity-card-badges' }, accessBadges(row.acc).concat(
              commentMarker(e.qualifiedName)
            ))
          ]), e.module);
        });
      return withMod(el('div', { class: 'module-group' }, [
        el('div', { class: 'module-group-head' }, [
          el('span', { class: 'module-group-name', text: mod }),
          el('span', { class: 'module-group-count', text: cards.length + ' shown' })
        ]),
        el('div', { class: 'entity-grid' }, cards)
      ]), mod);
    }));
  }

  // ---------- entities: map view ----------
  // A domain overview rather than a full ERD: each module is a panel of its
  // entity chips, followed by the associations that wire entities together,
  // written as plain "A → B" lines a non-technical reader can follow.
  // The attribute list on a map card: real names and types, one per row, the
  // way MxSonar's own map draws them — a strip of anonymous marks said only
  // "roughly this many fields", which is not what anyone opens a domain map
  // to find out. Capped so a 60-attribute entity doesn't blow out its card;
  // the entity's own popup has the full list.
  var MAP_ATTR_MAX = 8;
  // levels: attrName -> 'rw' | 'r' | 'none' for the selected role, or null in
  // the everything-view (no per-role access to colour by). The dot is the
  // traffic-light cue Karol asked for — on the attribute, not the entity.
  function renderAttrStrip(entity, levels) {
    var attrs = entity.attributes || [];
    if (!attrs.length) return el('div', { class: 'map-attrs' }, [el('span', { class: 'map-attr-more', text: 'no attributes' })]);
    var rows = attrs.slice(0, MAP_ATTR_MAX).map(function (a) {
      var lvl = levels ? (levels[a.name] || 'none') : null;
      return el('div', { class: 'map-attr-row' }, [
        levels ? el('span', { class: 'map-attr-dot map-attr-dot-' + lvl,
          title: lvl === 'rw' ? 'read + write' : (lvl === 'r' ? 'read' : 'no access') }) : null,
        el('span', { class: 'map-attr-name', text: a.name }),
        el('span', { class: 'map-attr-type', text: String(a.type || '').toLowerCase() })
      ].filter(Boolean));
    });
    var box = el('div', { class: 'map-attrs' }, rows);
    if (attrs.length > MAP_ATTR_MAX) {
      box.appendChild(el('span', { class: 'map-attr-more', text: '+' + (attrs.length - MAP_ATTR_MAX) + ' more' }));
    }
    return box;
  }

  function renderEntitiesMap(model) {
    var set = moduleRoleSetFor(model, state.detail.role);
    var byModule = {};
    (model.entities || []).forEach(function (e) {
      if (!moduleShown(e.module)) return;
      if (!passesFilter(e)) return;
      var acc = entityAccessFor(e, set);
      if (set && !acc.matched) return;
      (byModule[e.module] = byModule[e.module] || []).push({ entity: e, acc: acc });
    });
    var modules = Object.keys(byModule).sort();

    // How many entity cards wide a module's frame is. Square-ish rather than
    // one-size-fits-all: a two-entity module should be a small box, not the
    // same width as a twenty-entity one padded with empty space, and the
    // frames then pack together instead of ruling the page into equal
    // columns. Capped at 4 so one huge module can't take the whole row.
    var MAP_MAX_COLS = 4;
    function panelColumns(count) {
      return Math.max(1, Math.min(MAP_MAX_COLS, Math.ceil(Math.sqrt(count))));
    }

    var panels = modules.map(function (mod) {
      var rows = byModule[mod].sort(function (a, b) { return a.entity.name.toLowerCase() < b.entity.name.toLowerCase() ? -1 : 1; });
      var cards = rows.map(function (row) {
        var e = row.entity;
        var card = el('button', { class: 'map-entity', onclick: function () { state.detail.selectedEntity = e.qualifiedName; render(); } }, [
          el('div', { class: 'map-entity-top' }, [
            el('span', { class: 'map-entity-name', text: e.name })
          ]),
          renderAttrStrip(e, attrLevelsFor(e, set))
        ]);
        card.style.setProperty('--mod', moduleColor(mod));
        return card;
      });
      var cols = panelColumns(rows.length);
      var body = el('div', { class: 'map-panel-body' }, cards);
      body.style.setProperty('--cols', String(cols));
      var panel = el('div', { class: 'map-panel' }, [
        el('div', { class: 'map-panel-head' }, [
          el('span', { class: 'map-panel-name', text: mod }),
          el('span', { class: 'map-panel-count', text: rows.length + (rows.length === 1 ? ' entity' : ' entities') })
        ]),
        body
      ]);
      panel.style.setProperty('--mod', moduleColor(mod));
      // The frame takes as many of the outer grid's columns as it has entity
      // cards across, so a small module stays small and a wide one is
      // genuinely wide — the packing the eye reads as "modules laid out",
      // rather than every module stretched to an identical box.
      panel.style.setProperty('grid-column', 'span ' + cols);
      return panel;
    });

    if (!modules.length) {
      return el('div', {}, [el('div', { class: 'empty' }, [el('p', { text: 'No entities match the current filter.' })])]);
    }

    // The map is a grid of module frames inside a bounded viewport you drag to
    // pan and scroll to zoom. The grid is scaled with a CSS transform; a sizer
    // around it grows to the scaled size so the viewport can actually scroll to
    // every corner when zoomed in. The cards are still buttons — a press that
    // lands on one opens it, a press on empty space grabs and pans.
    var grid = el('div', { class: 'map-grid' }, panels);
    var sizer = el('div', { class: 'map-zoom' }, [grid]);
    var viewport = el('div', { class: 'map-viewport' }, [sizer]);
    enableMapPan(viewport);
    enableMapZoom(viewport, grid, sizer);
    requestAnimationFrame(function () {
      fitMapViewport(viewport);
      applyMapZoom(viewport, grid, sizer, state.detail.mapZoom || 1);
    });

    return el('div', {}, [viewport]);
  }

  // The map takes whatever height is left below it, so the window has ONE
  // scrollbar (the map's) instead of two — the map's own plus the page's,
  // which is what a fixed max-height produced whenever the module chips
  // wrapped onto a second row. Measured rather than computed from a constant:
  // the chip row's height depends on how many modules the project has.
  function fitMapViewport(viewport) {
    if (!viewport || !document.contains(viewport)) return;
    var top = viewport.getBoundingClientRect().top;
    viewport.style.height = Math.max(320, Math.round(window.innerHeight - top - 24)) + 'px';
  }

  // Apply a zoom factor: scale the grid and size the sizer to match, so the
  // viewport's scrollable area follows the visual size (a transform alone
  // doesn't move the scroll bounds). The grid is pinned to a fixed natural
  // width — the viewport's own content width — so it lays out the same at every
  // zoom instead of stretching to the (growing) sizer, which would feed its own
  // width back in and run away. A transform never changes the layout box, so
  // the pinned grid's scrollHeight is the true unscaled height.
  //
  // Returns the horizontal offset it used. Zoomed OUT far enough, the scaled
  // grid is narrower than the viewport; with everything pinned to the left
  // edge the browser then clamps scrollLeft to 0 and the whole map slides
  // into the left margin as you zoom. Centring it in that case keeps it where
  // the eye left it, and the offset has to come back out so the wheel handler
  // can keep the point under the cursor where it was.
  function applyMapZoom(viewport, grid, sizer, z) {
    var cs = getComputedStyle(viewport);
    var naturalW = viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!(naturalW > 0)) return 0;
    grid.style.width = naturalW + 'px';
    var naturalH = grid.scrollHeight;
    var scaledW = naturalW * z;
    var offsetX = Math.max(0, (naturalW - scaledW) / 2);
    grid.style.transformOrigin = '0 0';
    grid.style.transform = 'translateX(' + offsetX + 'px) scale(' + z + ')';
    sizer.style.width = Math.max(naturalW, scaledW) + 'px';
    sizer.style.height = (naturalH * z) + 'px';
    return offsetX;
  }

  // Scroll-to-zoom, centred on the cursor. Plain wheel zooms (drag is how you
  // pan), so the page never scrolls under the map. The factor is kept in state
  // so it survives a re-render; the transform is applied imperatively for a
  // smooth wheel rather than through a full render per tick.
  var MAP_ZOOM_MIN = 0.4, MAP_ZOOM_MAX = 2.5;
  // The translateX applyMapZoom last wrote, read back off the element rather
  // than kept in a variable — a re-render replaces these nodes, and a stale
  // copy of the offset would jump the map on the first wheel tick after one.
  function currentMapOffset(grid) {
    var m = /translateX\(([-\d.]+)px\)/.exec(grid.style.transform || '');
    return m ? parseFloat(m[1]) : 0;
  }
  function enableMapZoom(viewport, grid, sizer) {
    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var z0 = state.detail.mapZoom || 1;
      var factor = Math.exp(-e.deltaY * 0.0015);
      var z1 = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, z0 * factor));
      if (z1 === z0) return;
      var rect = viewport.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      // Content point under the cursor, before the change — measured past
      // whatever centring offset the current zoom is using.
      var off0 = currentMapOffset(grid);
      var cx = (viewport.scrollLeft + mx - off0) / z0, cy = (viewport.scrollTop + my) / z0;
      state.detail.mapZoom = z1;
      var off1 = applyMapZoom(viewport, grid, sizer, z1);
      // Keep that same content point under the cursor after the change.
      viewport.scrollLeft = cx * z1 + off1 - mx;
      viewport.scrollTop = cy * z1 - my;
    }, { passive: false });
  }

  // Grab-to-pan for the map viewport. Uses pointer capture so the move/up
  // handlers are added only for the duration of one drag and removed on
  // release — no listeners accumulate across re-renders. A press that starts
  // on a card (or any control) is left alone, so clicking an entity still
  // opens it.
  function enableMapPan(node) {
    node.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      var startX = e.clientX, startY = e.clientY, sl = node.scrollLeft, st = node.scrollTop;
      try { node.setPointerCapture(e.pointerId); } catch (_) {}
      node.classList.add('is-panning');
      function move(ev) {
        node.scrollLeft = sl - (ev.clientX - startX);
        node.scrollTop = st - (ev.clientY - startY);
      }
      function up() {
        node.classList.remove('is-panning');
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        try { node.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
      e.preventDefault();
    });
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
  function roleIndicator(allowed) {
    if (!allowed.length) {
      return el('div', { class: 'role-stack' }, [
        el('span', { class: 'internal-chip', title: 'Not directly runnable — called from other logic' }, [internalIcon()])
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

  function renderFlowList(model, key, noun) {
    var set = moduleRoleSetFor(model, state.detail.role);
    var byModule = {};
    (model[key] || []).forEach(function (f) {
      if (!moduleShown(f.module)) return;
      if (!passesFilter(f)) return;
      var allowed = f.allowedModuleRoles || [];
      // A specific role sees only what it can actually run — same rule the
      // entity list already applies (entityAccessFor: hidden unless a rule
      // matches the selected role). A flow with NO allowed roles at all
      // isn't runnable by any role either, internal helper or not, so under
      // a specific role it is hidden same as a genuinely role-gated one it
      // can't reach; only "Everything" (set === null) shows it, with its own
      // "not directly runnable" label in the popup.
      if (set && !listHitsSet(allowed, set)) return;
      (byModule[f.module] = byModule[f.module] || []).push({ flow: f, allowed: allowed });
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
          var card = withMod(el('div', { class: 'flow-card' }, [
            el('div', { class: 'flow-card-name', text: f.name }),
            el('div', { class: 'flow-card-meta' }, [
              roleIndicator(row.allowed),
              el('div', { class: 'meta-spacer' }),
              inputIndicator(params)
            ]),
            // Only a marker that comments exist — writing one happens in the
            // object's own window, where the thing being commented on is
            // actually in front of you. A write action on a browsing card is
            // a click you make without having looked.
            el('div', { class: 'flow-card-badges' }, commentMarker(f.qualifiedName))
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

  // ---------- project settings ----------
  function renderProjectSettings(project) {
    var nameInput = el('input', { type: 'text', value: project.name });
    nameInput.addEventListener('change', function () {
      var value = nameInput.value.trim();
      if (!value || value === project.name) { nameInput.value = project.name; return; }
      renameProject(project.id, value).then(render);
    });

    var authorInput = el('input', {
      type: 'text', placeholder: 'e.g. Karol, QA',
      value: (state.settings.author && state.settings.author.name) || ''
    });
    authorInput.addEventListener('change', function () {
      var value = authorInput.value.trim();
      state.settings.author = { name: value };
      // Who wrote a finding is stamped on it when it is created, so this has
      // to be set before the review starts, not at export time.
      store.put('settings', { key: 'author', value: { name: value } }).then(function () {
        setMessage(value ? 'Your name is set to "' + value + '".' : 'Your name is cleared.', 'ok');
        render();
      }, reportWriteFailure);
    });

    var storageRows = [
      ['Source', project.source && project.source.kind === 'legacy-json' ? 'Imported model JSON' : (project.source && project.source.kind) || 'unknown'],
      ['Model size', formatBytes(project.bytes)],
      ['Created', formatDate(project.createdAt)],
      ['Last updated', formatDate(project.updatedAt)],
      ['Eviction protection', state.settings.persisted === true ? 'Granted — this browser will not clear MxScout under disk pressure'
        : state.settings.persisted === false ? 'Not granted — export regularly, this browser may clear MxScout under disk pressure'
        : 'Unknown']
    ];

    // Read from rawModel, never the already-filtered state.detail.model — the
    // whole point is knowing what's hidden right now, which the filtered
    // model can't say by definition.
    var marketplaceModules = (state.detail.rawModel.modules || [])
      .filter(function (m) { return m && m.fromAppStore; })
      .map(function (m) { return m.name; })
      .sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    var marketplaceCard = null;
    if (marketplaceModules.length) {
      var showMarketplaceCheckbox = el('input', { type: 'checkbox' });
      if (state.detail.showMarketplaceModules) showMarketplaceCheckbox.setAttribute('checked', 'checked');
      showMarketplaceCheckbox.addEventListener('change', function () {
        setShowMarketplaceModules(project, showMarketplaceCheckbox.checked);
      });
      marketplaceCard = el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'Marketplace modules' }),
        el('label', { class: 'ack-row' }, [showMarketplaceCheckbox, el('span', { text: ' Show them while browsing' })]),
        el('p', { class: 'hint', text: (state.detail.showMarketplaceModules ? 'Shown: ' : 'Hidden by default, not just dimmed — the chip row, lists and map act as if they were not in the project at all: ')
          + marketplaceModules.join(', ') + '.' }
        )
      ]);
    }

    return el('div', {}, [
      el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'This project' }),
        el('label', { class: 'field' }, [el('span', { text: 'Project name' }), nameInput]),
        el('div', { class: 'kv' }, storageRows.map(function (row) {
          return el('div', { class: 'kv-row' }, [
            el('span', { class: 'kv-key', text: row[0] }),
            el('span', { class: 'kv-val', text: row[1] })
          ]);
        }))
      ]),
      el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'You' }),
        el('label', { class: 'field' }, [el('span', { text: 'Your name' }), authorInput]),
        el('p', { class: 'hint', text: 'Stamped on the comments you write, and on what you send. It stays in this browser and is never sent anywhere by MxScout.' })
      ]),
      marketplaceCard
    ].filter(Boolean));
  }

  // ---------- project detail ----------
  function renderProjectDetail(project) {
    var model = state.detail.model;

    var title = el('div', { class: 'detail-title' }, [
      el('h2', { text: project.name }),
      el('p', { class: 'muted', text: [
        model.meta && model.meta.appName,
        model.meta && model.meta.mendixVersion ? 'Mendix ' + model.meta.mendixVersion : null
      ].filter(Boolean).join(' · ') || 'Model loaded' })
    ]);
    var actions = el('div', { class: 'project-actions' }, [
      el('button', { class: 'btn btn-sm', text: 'Replace model…', title: 'Load a newer model, from a project folder or a file', onclick: function () { openReplaceModel(project.id); } }),
      el('button', {
        class: 'btn btn-sm', text: 'Package…',
        title: 'Encrypt this project for someone else',
        onclick: function () { window.MxTransfer.startPackaging(project.id); }
      }),
      el('button', { class: 'btn btn-danger-outline btn-sm', text: 'Delete', onclick: function () { state.confirmDelete = project.id; render(); } })
    ]);

    // View body + its own controls.
    var body, controls;
    var showModuleChips = renderModuleChips(model);
    if (state.detail.view === 'entities') {
      var subToggle = el('div', { class: 'sub-toggle' }, [
        el('button', { class: 'btn btn-sm' + (state.detail.entitySub === 'list' ? ' btn-primary' : ''), text: 'List', onclick: function () { state.detail.entitySub = 'list'; render(); } }),
        el('button', { class: 'btn btn-sm' + (state.detail.entitySub === 'map' ? ' btn-primary' : ''), text: 'Map', onclick: function () { state.detail.entitySub = 'map'; render(); } })
      ]);
      controls = el('div', { class: 'view-controls' }, [subToggle, renderFilterInput('Filter entities…'), showModuleChips].filter(Boolean));
      body = state.detail.entitySub === 'map' ? renderEntitiesMap(model) : renderEntitiesList(model);
    } else if (state.detail.view === 'microflows') {
      controls = el('div', { class: 'view-controls' }, [renderFilterInput('Filter microflows…'), showModuleChips].filter(Boolean));
      body = renderFlowList(model, 'microflows', 'microflows');
    } else if (state.detail.view === 'nanoflows') {
      controls = el('div', { class: 'view-controls' }, [renderFilterInput('Filter nanoflows…'), showModuleChips].filter(Boolean));
      body = renderFlowList(model, 'nanoflows', 'nanoflows');
    } else if (state.detail.view === 'pages') {
      controls = el('div', { class: 'view-controls' }, [renderFilterInput('Filter pages…'), showModuleChips].filter(Boolean));
      body = renderFlowList(model, 'pages', 'pages');
    } else if (state.detail.view === 'live') {
      controls = null;
      body = window.MxLive.renderPanel(model, project);
    } else if (state.detail.view === 'comments') {
      controls = null;
      body = window.MxComments.renderList(model);
    } else if (state.detail.view === 'settings') {
      controls = null;
      body = renderProjectSettings(project);
    }

    // The role selector only means something for the views that filter by
    // role; Comments and Settings are not among them — the app measured what
    // the signed-in session did, and re-labelling that with another role
    // would be a claim MxScout cannot make.
    var roleFilterApplies = state.detail.view !== 'comments' &&
      state.detail.view !== 'settings';
    return el('div', { class: 'detail' }, [
      el('div', { class: 'detail-head' }, [
        title,
        el('div', { class: 'detail-head-right' }, [
          roleFilterApplies ? renderRoleSelector(model) : null,
          actions
        ].filter(Boolean))
      ]),
      controls,
      el('div', { class: 'view-body' }, [body])
    ].filter(Boolean));
  }

  // ---------- delete confirmation ----------
  function renderConfirmDelete() {
    var project = findProject(state.confirmDelete);
    if (!project) return null;
    return el('div', { class: 'modal-backdrop' }, [
      el('div', { class: 'modal' }, [
        el('h3', { text: 'Delete this project?' }),
        el('p', { text: '"' + project.name + '" and its stored model will be removed from this browser. Export it first if you want to keep a copy — this cannot be undone.' }),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: function () { state.confirmDelete = null; render(); } }),
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
      ])
    ]);
  }

  // ---------- about (the page you hand to a security reviewer) ----------
  // The document itself lives in about.js — it is the one thing here that a
  // person outside the project reads end to end. What stays is only which
  // screen is showing and where the version comes from.
  function openAbout() {
    state.about = { health: null };
    state.guide = null;
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

  // ---------- guide (the Getting started walkthrough) ----------
  // The document itself lives in guide.js, built the same way about.js is —
  // data rendered by one function. Nothing here needs a project or the
  // server, so opening it is just a flag, same shape as About above.
  function openGuide() {
    state.guide = {};
    state.about = null;
    setMessage(null);
  }

  function closeGuide() {
    state.guide = null;
    setMessage(null);
  }

  // ---------- render ----------
  function render() {
    var app = document.getElementById('app');
    while (app.firstChild) app.removeChild(app.firstChild);

    var body;
    // About comes first: it must render even when storage is blocked, since
    // "why is this tool safe" is a fair question to ask before anything works.
    if (state.about) {
      body = window.MxAbout.render(state.about.health ? state.about.health.version : null);
    } else if (state.guide) {
      body = window.MxGuide.render();
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
      body = renderProjectList();
    } else {
      body = renderProjectDetail(findProject(state.activeId));
    }

    // The entities map and the flow views can get wide; let them use the full
    // width of the main column instead of the reading-width it otherwise wants.
    // About stays at reading width — its tables and paragraphs both read
    // better narrow than stretched across a wide screen.
    var d = (state.about || state.guide || state.newProject.open) ? null : state.detail;
    var fullBleed = d && (
      d.view === 'microflows' || d.view === 'nanoflows' || d.view === 'pages' || d.view === 'entities' ||
      d.view === 'comments'
    );
    var wrap = el('div', { class: 'content-wrap' + (fullBleed ? ' wide' : '') }, [body]);
    if (state.message) {
      wrap.appendChild(el('div', { class: 'msg ' + state.message.kind, text: state.message.text }));
    }

    app.appendChild(el('div', { class: 'shell' }, [
      renderSidebar(),
      el('main', { class: 'main' }, [wrap])
    ]));

    // The package dialogs sit above everything else that is not the palette:
    // both are mid-transaction, and losing one to a stray click would lose an
    // access code that cannot be recovered.
    var unlockModal = window.MxTransfer.renderUnlockModal();
    if (unlockModal) { app.appendChild(unlockModal); return; }
    var packModal = window.MxTransfer.renderPackagingModal();
    if (packModal) { app.appendChild(packModal); return; }
    var mprImportModal = window.MxMprImport.renderModal();
    if (mprImportModal) { app.appendChild(mprImportModal); return; }

    var replaceModelModal = renderReplaceModelModal();
    if (replaceModelModal) { app.appendChild(replaceModelModal); return; }

    var reportModal = window.MxComments.renderReportModal();
    if (reportModal) { app.appendChild(reportModal); return; }

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
    if (state.about || state.guide) return;

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
    state.detail.filter = item.name;
    // Land ON the object, not next to it. A comment about a microflow should
    // open that microflow, the same way one about an entity opens the entity.
    var kind = FLOW_KIND_OF[sectionKey] || null;
    state.detail.selectedEntity = sectionKey === 'entities' ? item.qualifiedName : null;
    state.detail.selectedFlow = kind ? { kind: kind, qualifiedName: item.qualifiedName } : null;
    state.detail.flowTab = 'run';
    // Chosen objects and typed values belong to the flow they were chosen
    // for, same reset openFlowPopup does — jumping here from a comment or
    // the palette is just a different door into the same popup, and the Run
    // tab's param rows read these as plain objects, never null.
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
    // An object renamed out of the model since the comment was written has
    // nowhere to jump to; say so instead of landing on an empty list.
    var exists = objectsOfSection(state.detail.model, section).some(function (o) {
      return o.qualifiedName === t.qualifiedName;
    });
    if (!exists) {
      setMessage('“' + t.qualifiedName + '” is not in the current model — it may have been renamed or removed since this comment was written.', 'error');
      render();
      return;
    }
    jumpToObject(section, item);
  }

  // A comment written months ago can point at an entity that has since been
  // renamed or deleted. Answering that here keeps comments.js from needing to
  // know how a model is shaped.
  function objectExists(qualifiedName) {
    if (!state.detail) return true;
    var model = state.detail.model;
    return ['entities', 'microflows', 'nanoflows', 'pages'].some(function (key) {
      return (model[key] || []).some(function (o) { return o.qualifiedName === qualifiedName; });
    });
  }

  function attributesOf(qualifiedName) {
    var entity = findEntity(state.detail.model, qualifiedName);
    return entity ? (entity.attributes || []) : [];
  }

  window.MxComments.init({
    el: el,
    state: state,
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
    objectExists: objectExists,
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
  window.MxAbout.init({ el: el });
  window.MxGuide.init({ el: el });
  window.MxTransfer.init({
    el: el, state: state, store: store, render: render, setMessage: setMessage,
    newId: newId, findProject: findProject, sortProjects: sortProjects,
    openProject: openProject, summarize: summarize, safeFileName: safeFileName,
    downloadText: downloadText, withBuiltinSystemModule: withBuiltinSystemModule
  });
  window.MxObjects.init({
    el: el, state: state, render: render, setMessage: setMessage,
    withMod: withMod, moduleRoleSetFor: moduleRoleSetFor,
    listHitsSet: listHitsSet, findEntity: findEntity
  });
  window.MxLive.init({
    el: el, state: state, api: api, render: render, setMessage: setMessage,
    saveProjectMeta: saveProjectMeta, findEntity: findEntity,
    moduleRoleSetFor: moduleRoleSetFor, moduleColor: moduleColor
  });
  window.MxMprImport.init({
    el: el, state: state, store: store, render: render, setMessage: setMessage,
    finishCreatingProject: finishCreatingProject, finishReplacingProject: finishReplacingProject,
    openProject: openProject, findProject: findProject
  });
  window.MxPalette.init({
    el: el, state: state, render: render, sections: PROJECT_SECTIONS,
    findProject: findProject, openProject: openProject, goToSection: goToSection,
    jumpToObject: jumpToObject, scopeToModule: scopeToModule, objectsOfSection: objectsOfSection,
    sectionCount: sectionCount, moduleColor: moduleColor, moduleNamesOf: moduleNamesOf
  });
  window.MxPalette.installShortcuts();
  // One listener for the life of the page rather than one per render: the map
  // is rebuilt by every render(), so anything attached to the window from
  // inside it would pile up. It looks the current map up when it fires, and
  // does nothing when there isn't one.
  window.addEventListener('resize', function () {
    fitMapViewport(document.querySelector('.map-viewport'));
  });
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
      return loadProjects();
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
