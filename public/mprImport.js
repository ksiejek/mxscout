/* MxScout — importing a Mendix project directly, no MxSonar step in between.
 * The heavy lifting (SQLite, BSON, the model walk) all happens in
 * mprWorker.js; this file is the UI around it.
 *
 * Picking is one step when the browser supports it: `showDirectoryPicker()`
 * hands back a handle that can be navigated lazily, so "choose the project
 * folder" reads the .mpr, then — only for a v2-format project — steps into
 * mprcontents/ and reads just that, never touching javasource/, themesource/,
 * deployment/ or anything else in the project — except, when there is one, a
 * few plain files of its .git (HEAD, a ref, the end of the reflog, the commit
 * itself when it is stored loose), for the version stamp (modelversion.js).
 * That is Chromium-only (see
 * supportsDirectoryPicker), which is fine here: it is Studio Pro's own
 * target platform. Elsewhere it falls back to two steps: the .mpr file
 * itself (a single file, as fast as picking a JSON), then — only for v2 —
 * that one mprcontents/ folder. A `webkitdirectory` pick, the mechanism
 * behind both that fallback's folder step and "the whole project folder"
 * link, reads EVERY file under whatever folder is chosen, recursively, with
 * no way to ask for less — pointed at the whole project root, that is
 * thousands of irrelevant files (a real project of that size: ~10,000 files
 * project-wide vs. ~3,900 actually under mprcontents/) for every import;
 * pointed at just mprcontents/, it is only ever the files the model walk
 * actually reads. Dragging the whole project folder in one go still works,
 * for whoever would rather do that — it goes through the same "find the
 * .mpr and mprcontents/ inside whatever was dropped" path this always used.
 *
 * Two modes, one flow: CREATE hands the finished model straight to
 * finishCreatingProject, the same tail createProject(from JSON) already
 * uses. REPLACE re-reads an EXISTING project and, before touching storage,
 * diffs the freshly-parsed model against the one already stored — added and
 * removed modules/entities/associations/flows/pages/user roles by name — and
 * only calls finishReplacingProject once the user confirms what they saw.
 *
 * Cancel is worker.terminate() from here; mprWorker.js doesn't need to know.
 */
(function () {
  'use strict';

  var el, state, store, render, setMessage, finishCreatingProject, finishReplacingProject, openProject, findProject;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    store = deps.store;
    render = deps.render;
    setMessage = deps.setMessage;
    finishCreatingProject = deps.finishCreatingProject;
    finishReplacingProject = deps.finishReplacingProject;
    openProject = deps.openProject;
    findProject = deps.findProject;
  }

  // ---------- loading sqlite.js on the main thread, once ----------
  // Only needed here to answer one question the moment a .mpr is picked —
  // does its Unit table have a Contents column (v1) or not (v2)? — before
  // deciding whether a second pick is even necessary. The real, full parse
  // still happens in mprWorker.js.
  var _sqliteReady = null;
  function loadSqliteOnce() {
    if (window.MxSqlite) return Promise.resolve();
    if (_sqliteReady) return _sqliteReady;
    _sqliteReady = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/sqlite.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load the .mpr reader.')); };
      document.head.appendChild(s);
    });
    return _sqliteReady;
  }

  // 1 = Contents inline (no second pick needed), 2 = needs mprcontents/.
  function detectMprVersion(buffer) {
    var table = window.MxSqlite.readTable(buffer, 'Unit');
    return table.columns.indexOf('Contents') !== -1 ? 1 : 2;
  }

  // ---------- turning a pile of files into "the .mpr" + "its content files" ----------
  function segmentsOf(relativePath) { return relativePath.split('/').filter(Boolean); }

  // The legacy whole-folder path: entries rooted at the picked project
  // folder's own name, mprcontents/ found wherever it sits inside that tree.
  // A Mendix project's .mpr is named after the app, and nothing inside the
  // file says the app's name — so this is where it comes from, for the
  // model's own meta.appName as much as for the project name MxScout
  // suggests.
  function appNameOf(mprFileName) {
    return String(mprFileName || '').replace(/\.mpr$/i, '');
  }

  function groupFileEntries(entries) {
    var mprCandidates = entries.filter(function (e) { return /\.mpr$/i.test(e.relativePath); });
    if (!mprCandidates.length) {
      throw new Error('No .mpr file found in that folder. Choose the folder that directly contains the Mendix project’s own .mpr file.');
    }
    var atRoot = mprCandidates.filter(function (e) { return segmentsOf(e.relativePath).length === 2; });
    var chosen = atRoot.length === 1 ? atRoot[0] : (mprCandidates.length === 1 ? mprCandidates[0] : null);
    if (!chosen) {
      throw new Error('Found more than one .mpr file in that folder — choose the folder for a single Mendix project.');
    }
    var segs = segmentsOf(chosen.relativePath);
    return {
      mprFile: chosen.file,
      mprFileName: segs.slice(-1)[0],
      contentsByRelPath: contentsMapFromTree(entries),
      // The .git beside the .mpr, when the folder handed over holds one: read for the version stamp.
      version: segs.length >= 2 ? window.MxModelVersion.fromEntries(entries, segs.slice(0, -1).join('/')) : Promise.resolve(window.MxModelVersion.none('single-file'))
    };
  }

  // mprcontents/ found anywhere inside a wider tree (the whole-folder path).
  function contentsMapFromTree(entries) {
    var map = new Map();
    entries.forEach(function (e) {
      var segs = segmentsOf(e.relativePath);
      var idx = segs.indexOf('mprcontents');
      if (idx !== -1 && idx < segs.length - 1) map.set(segs.slice(idx + 1).join('/'), e.file);
    });
    return map;
  }

  // The dedicated contents-only pick: the user was told to choose the
  // mprcontents folder itself, so every entry's own root segment (whatever
  // it happens to be named) IS that folder — just strip it, no searching.
  function contentsMapFromOwnRoot(entries) {
    var map = new Map();
    entries.forEach(function (e) {
      var rel = segmentsOf(e.relativePath).slice(1).join('/');
      if (rel) map.set(rel, e.file);
    });
    return map;
  }

  // The `accept` filter only where the folder picker exists (Chromium). Safari
  // maps each listed extension to a system file type, and one it has no type
  // for — .mpr, .mxscout — greys the file out, so nothing can be chosen and
  // the dialog's button stays disabled. Elsewhere the dialog shows every file;
  // what was picked is checked after the pick anyway (a non-SQLite .mpr fails
  // with its own message).
  function acceptFilter(accept) {
    return supportsDirectoryPicker() ? accept : null;
  }

  function pickSingleFile(accept, onFile) {
    var input = el('input', { type: 'file', accept: acceptFilter(accept) });
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (file) onFile(file);
    });
    document.body.appendChild(input);
    input.click();
  }

  // ---------- the File System Access API path: one pick, v1 or v2 alike ----------
  // `showDirectoryPicker()` (Chromium only — Studio Pro's own target platform,
  // which is what this tool runs against) hands back a FileSystemDirectoryHandle
  // that can be navigated lazily: list this folder's own entries, then — only
  // for a v2 project — step into its mprcontents/ subfolder and read just
  // that, and a few files of .git for the version. Nothing else in the project (javasource/, themesource/, deployment/,
  // ...) is ever touched, and there is only one user gesture regardless of
  // format — the two-step pick below stays as the fallback for a browser
  // without this API, unchanged.
  function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === 'function';
  }

  // The .mpr at the folder's top — and its .git, when there is one, seen in the same listing:
  // the version stamp is read from it (modelversion.js), as plain files, nothing else in it.
  function findTopLevelMprHandle(dirHandle) {
    var found = [], git = null;
    return (function next(iter) {
      return iter.next().then(function (r) {
        if (r.done) return found;
        var entry = r.value;
        if (entry.kind === 'file' && /\.mpr$/i.test(entry.name)) found.push(entry);
        else if (entry.name === '.git') git = entry;
        return next(iter);
      });
    })(dirHandle.values()).then(function () {
      if (!found.length) throw new Error('No .mpr file found directly inside that folder — choose the Mendix project’s own root folder.');
      if (found.length > 1) throw new Error('Found more than one .mpr file in that folder — choose the folder for a single Mendix project.');
      return { mpr: found[0], git: git };
    });
  }

  // Enumerating a directory's entries (name + kind, no bytes) is metadata —
  // one async call after another to walk it is fine. Reading a FILE's bytes
  // is a real round trip through Chromium's sandboxed file-system broker,
  // and a real mprcontents/ folder is thousands of them (xx/yy/*.mxunit);
  // awaiting those one at a time in sequence is what made this slower than
  // it should be. So: list a directory's entries first (cheap, sequential —
  // the async iterator has no other shape), then read every file AND recurse
  // into every subfolder concurrently.
  function listDirEntries(dirHandle) {
    var entries = [];
    return (function next(iter) {
      return iter.next().then(function (r) {
        if (r.done) return entries;
        entries.push(r.value);
        return next(iter);
      });
    })(dirHandle.values());
  }

  function readDirRecursive(dirHandle, prefix, map) {
    return listDirEntries(dirHandle).then(function (entries) {
      return Promise.all(entries.map(function (entry) {
        if (entry.kind === 'file') {
          return entry.getFile().then(function (file) { map.set(prefix + entry.name, file); });
        }
        return readDirRecursive(entry, prefix + entry.name + '/', map);
      }));
    }).then(function () { return map; });
  }

  // The seam for the folder-handle path — exposed directly (see
  // handleDirectoryHandle below) because a real showDirectoryPicker() dialog
  // is a native OS picker with no DOM, same as the OS file/folder pickers
  // elsewhere in this file: nothing here can drive it from a test, so a test
  // hands this a small in-memory object shaped like a FileSystemDirectoryHandle
  // instead.
  // A Mendix project's directory, read: the .mpr, its mprcontents/ when the format needs it, the version
  // from its .git — { mprFile, mprFileName, contentsByRelPath, version, mpr: { name, size, lastModified, commit } }.
  function readProjectDir(dirHandle) {
    return findTopLevelMprHandle(dirHandle).then(function (top) {
      var stamp = window.MxModelVersion.fromHandle(top.git, dirHandle.name || null);
      return top.mpr.getFile().then(function (file) {
        return Promise.all([file.arrayBuffer(), stamp]).then(function (both) {
          var buffer = both[0], gitVersion = both[1];
          var grouped = { mprFile: file, mprFileName: file.name, contentsByRelPath: new Map(), version: gitVersion, dir: dirHandle,
            mpr: { name: file.name, size: file.size, lastModified: file.lastModified, commit: gitVersion && gitVersion.commit || null } };
          return loadSqliteOnce().then(function () {
            if (detectMprVersion(buffer) === 1) return grouped;
            return dirHandle.getDirectoryHandle('mprcontents').catch(function () {
              throw new Error(file.name + ' is a v2-format project, but this folder has no mprcontents subfolder next to it.');
            }).then(function (contentsHandle) {
              return readDirRecursive(contentsHandle, '', new Map());
            }).then(function (map) { grouped.contentsByRelPath = map; return grouped; });
          });
        });
      });
    });
  }
  // Which .mpr is there now, and the commit HEAD names — what says whether a model read from it is still current.
  function fingerprint(dirHandle) {
    return findTopLevelMprHandle(dirHandle).then(function (top) {
      return Promise.all([top.mpr.getFile(), window.MxModelVersion.fromHandle(top.git, dirHandle.name || null)]).then(function (b) {
        return { name: b[0].name, size: b[0].size, lastModified: b[0].lastModified, commit: b[1] && b[1].commit || null };
      });
    });
  }
  // The model of a Mendix project's directory, with nobody watching a dialog: a project kept inside it,
  // read again because its .mpr changed (repoui.js). Resolves with { model, mprFileName, mpr }.
  function readModel(dirHandle, onProgress) {
    return readProjectDir(dirHandle).then(function (g) {
      return g.mprFile.arrayBuffer().then(function (buf) {
        return parse(buf, g.contentsByRelPath, appNameOf(g.mprFileName), onProgress).promise;
      }).then(function (model) { model.version = g.version; return { model: model, mprFileName: g.mprFileName, mpr: g.mpr }; });
    });
  }
  // The parse itself, in mprWorker.js: { worker, promise } — the promise resolves with the model.
  function parse(mprBuffer, contents, appName, onProgress) {
    var worker = new Worker('/mprWorker.js');
    var promise = new Promise(function (resolve, reject) {
      worker.onmessage = function (ev) {
        var msg = ev.data;
        if (msg.type === 'progress') { if (onProgress) onProgress(msg); }
        else if (msg.type === 'done') { worker.terminate(); resolve(msg.model); }
        else if (msg.type === 'error') { worker.terminate(); reject(new Error(msg.message)); }
      };
      worker.onerror = function (e) { reject(new Error('The import worker failed: ' + e.message)); };
    });
    worker.postMessage({ mprBuffer: mprBuffer, contentsFiles: contents, appName: appName });
    return { worker: worker, promise: promise };
  }

  function onDirectoryHandlePicked(dirHandle) {
    var imp = state.mprImport;
    if (!imp) return;
    imp.error = null;
    readProjectDir(dirHandle).then(function (grouped) {
      // A new project from a Mendix project's directory: whether its mxscout/ already holds one (repoui.js).
      var repo = imp.mode === 'create' && window.MxRepoUI ? window.MxRepoUI.picked(dirHandle, grouped.mpr) : Promise.resolve(null);
      return repo.then(function (r) {
        var cur = state.mprImport;
        if (!cur) return;
        cur.repo = r;
        toReady(cur, grouped);
        // A project a teammate committed in mxscout/: linked at once — its name is there, nothing to ask.
        if (r && r.existing) startImport();
      });
    }).catch(function (err) {
      var cur = state.mprImport;
      if (!cur) return;
      cur.error = (err && err.message) || 'Could not read that project folder.';
      render();
    });
  }

  function pickProjectFolder() {
    // Kept inside the Mendix project (mxscout/, repoui.js): the browser is asked for leave to write the
    // folder now, while the click is still the person's — mxscout/ is written after the model is read.
    var box = window.MxFolderUI && window.MxFolderUI.lastBox();
    var opts = box && box.mode === 'repo' && state.mprImport && state.mprImport.mode === 'create' ? { mode: 'readwrite' } : undefined;
    window.showDirectoryPicker(opts).then(onDirectoryHandlePicked, function (err) {
      if (err && err.name === 'AbortError') return; // the user closed the picker
      var imp = state.mprImport;
      if (imp) { imp.error = 'Could not open that folder.'; render(); }
    });
  }

  // A folder pick through a webkitdirectory <input> — Safari's and Firefox's
  // only way. It never ends in silence: Safari lists every file in the folder
  // before it says anything, which for a real mprcontents/ (thousands of
  // files) takes a while, so the box says it is waiting from the click on;
  // and a pick that hands over no files says so, with the way that does work
  // (dragging the folder onto the box). `cancel` (Safari 16.4+, Chromium)
  // clears the waiting; a browser without it clears it on the next pick.
  function pickFolder(onEntries) {
    var input = el('input', { type: 'file', webkitdirectory: true, multiple: true });
    var settled = false;
    input.style.display = 'none';
    function settle() {
      if (settled) return false;
      settled = true;
      if (input.parentNode) input.parentNode.removeChild(input);
      var cur = state.mprImport;
      if (cur) cur.waiting = false;
      return true;
    }
    function picked() {
      if (!settle()) return;
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) {
        var cur = state.mprImport;
        if (cur) {
          cur.error = 'The browser handed over no files from that folder. Drag the folder from Finder (or Explorer) onto this box instead.';
          render();
        }
        return;
      }
      onEntries(files.map(function (f) { return { relativePath: f.webkitRelativePath || f.name, file: f }; }));
    }
    input.addEventListener('change', picked);
    input.addEventListener('input', picked);
    input.addEventListener('cancel', function () { if (settle()) render(); });
    document.body.appendChild(input);
    input.click();
    var imp = state.mprImport;
    if (imp && !settled) { imp.waiting = true; imp.error = null; render(); }
  }

  // Recursively walks a dropped file-or-folder's FileSystemEntry tree.
  // Unlike a webkitdirectory <input>, a File obtained this way has no
  // `webkitRelativePath` of its own — the path is built by hand during the
  // walk instead, in the same "root-name/..." shape.
  function entriesFromDataTransfer(dataTransfer) {
    var items = dataTransfer.items ? Array.prototype.slice.call(dataTransfer.items) : [];
    var roots = items.map(function (it) { return it.webkitGetAsEntry && it.webkitGetAsEntry(); }).filter(Boolean);
    if (!roots.length) return Promise.resolve([]);
    var out = [];
    function readAllEntries(reader) {
      return new Promise(function (resolve, reject) {
        var all = [];
        (function next() {
          reader.readEntries(function (batch) {
            if (!batch.length) { resolve(all); return; }
            all = all.concat(batch);
            next();
          }, reject);
        })();
      });
    }
    function walk(entry, parentPath) {
      if (entry.isFile) {
        return new Promise(function (resolve, reject) {
          entry.file(function (file) { out.push({ relativePath: parentPath + entry.name, file: file }); resolve(); }, reject);
        });
      }
      if (entry.isDirectory) {
        return readAllEntries(entry.createReader()).then(function (children) {
          return Promise.all(children.map(function (c) { return walk(c, parentPath + entry.name + '/'); }));
        });
      }
      return Promise.resolve();
    }
    return Promise.all(roots.map(function (r) { return walk(r, ''); })).then(function () { return out; });
  }

  // ---------- diffing two models by name, for the replace flow ----------
  var DIFF_CATEGORIES = [
    { key: 'modules', label: 'modules', keyFn: function (m) { return m.name; } },
    { key: 'entities', label: 'entities', keyFn: function (e) { return e.qualifiedName; } },
    { key: 'associations', label: 'associations', keyFn: function (a) { return a.module + '.' + a.name; } },
    { key: 'microflows', label: 'microflows', keyFn: function (f) { return f.qualifiedName; } },
    { key: 'nanoflows', label: 'nanoflows', keyFn: function (f) { return f.qualifiedName; } },
    { key: 'pages', label: 'pages', keyFn: function (p) { return p.qualifiedName; } },
    { key: 'userRoles', label: 'user roles', keyFn: function (r) { return r.name; } }
  ];

  function keysOf(list, keyFn) {
    var s = new Set();
    (list || []).forEach(function (item) { s.add(keyFn(item)); });
    return s;
  }

  // Only ever added/removed by name — not a structural diff of what changed
  // WITHIN an object that kept its name (an attribute added, an access rule
  // changed). That is a much bigger feature for a much rarer case; what a
  // person re-importing a project actually asks first is "what's new and
  // what's gone", and that is what this answers.
  function diffModels(oldModel, newModel) {
    return DIFF_CATEGORIES.map(function (cat) {
      var oldSet = keysOf(oldModel[cat.key], cat.keyFn);
      var newSet = keysOf(newModel[cat.key], cat.keyFn);
      var added = [], removed = [];
      newSet.forEach(function (k) { if (!oldSet.has(k)) added.push(k); });
      oldSet.forEach(function (k) { if (!newSet.has(k)) removed.push(k); });
      added.sort(); removed.sort();
      return { key: cat.key, label: cat.label, added: added, removed: removed };
    }).filter(function (d) { return d.added.length || d.removed.length; });
  }

  // ---------- the flow ----------
  function freshState(mode, projectId) {
    return {
      mode: mode, projectId: projectId || null,
      step: 'pick', name: '',
      pendingMprFile: null, pendingMprName: null, waiting: false,
      grouped: null,
      phase: '', done: 0, total: 0, error: null, worker: null,
      diff: null
    };
  }
  function open() { state.mprImport = freshState('create', null); render(); }
  function openReplace(projectId) { state.mprImport = freshState('replace', projectId); render(); }

  function close() {
    var imp = state.mprImport;
    if (imp && imp.worker) { try { imp.worker.terminate(); } catch (e) { /* already gone */ } }
    state.mprImport = null;
    render();
  }

  function backToPick() {
    var imp = state.mprImport;
    if (!imp) return;
    imp.step = 'pick'; imp.pendingMprFile = null; imp.pendingMprName = null; imp.grouped = null; imp.error = null;
    render();
  }

  function toReady(imp, grouped) {
    imp.grouped = grouped;
    if (imp.mode === 'create') imp.name = appNameOf(grouped.mprFileName);
    imp.error = null;
    imp.step = 'ready';
    render();
  }

  // The single .mpr file was picked — read just enough to know whether a
  // second pick (mprcontents/) is actually needed before asking for one.
  function onMprFilePicked(file) {
    var imp = state.mprImport;
    if (!imp) return;
    imp.error = null;
    file.arrayBuffer().then(function (buffer) {
      return loadSqliteOnce().then(function () {
        var version = detectMprVersion(buffer);
        var cur = state.mprImport;
        if (!cur) return;
        if (version === 1) {
          toReady(cur, { mprFile: file, mprFileName: file.name, contentsByRelPath: new Map(), version: window.MxModelVersion.none('single-file') });
        } else {
          cur.pendingMprFile = file;
          cur.pendingMprName = file.name;
          cur.step = 'pick-contents';
          render();
        }
      });
    }).catch(function (err) {
      var cur = state.mprImport;
      if (!cur) return;
      cur.error = (err && err.message) || 'That doesn’t look like a Mendix .mpr file.';
      render();
    });
  }

  // The mprcontents/ folder was picked, for the v2 project whose .mpr is
  // already in pendingMprFile.
  function onContentsEntriesPicked(entries) {
    var imp = state.mprImport;
    if (!imp || !imp.pendingMprFile) return;
    imp.waiting = false;
    var map = contentsMapFromOwnRoot(entries);
    if (!map.size) {
      imp.error = 'That folder had no files in it — choose the mprcontents folder that sits next to ' + imp.pendingMprName + '.';
      render();
      return;
    }
    toReady(imp, { mprFile: imp.pendingMprFile, mprFileName: imp.pendingMprName, contentsByRelPath: map, version: window.MxModelVersion.none('single-file') });
  }

  // The legacy whole-project-folder path: one pick (or drop) does everything
  // groupFileEntries can find inside it.
  function onWholeFolderEntriesPicked(entries) {
    var imp = state.mprImport;
    if (!imp) return;
    imp.waiting = false;
    var grouped;
    try { grouped = groupFileEntries(entries); }
    catch (err) {
      imp.error = (err && err.message) || 'Could not read that folder.';
      render();
      return;
    }
    grouped.version.then(function (v) {
      grouped.version = v;
      if (state.mprImport === imp) toReady(imp, grouped);
    });
  }

  function finishWithModel(imp, model) {
    // Which version of the app this is, from the project's git (or why that is unknown): kept with the model.
    model.version = imp.grouped.version || window.MxModelVersion.none('single-file');
    // A project a teammate committed in the Mendix project's mxscout/: linked, not created (repoui.js).
    if (imp.mode === 'create' && imp.repo && imp.repo.existing) {
      window.MxRepoUI.linkExisting(imp.repo, model, imp.grouped).then(function () { if (state.mprImport === imp) state.mprImport = null; render(); }, function (err) {
        imp.step = 'error';
        imp.error = (err && err.message) || 'Could not open the project in that folder’s mxscout/.';
        render();
      });
      return;
    }
    if (imp.mode === 'create') {
      var name = (imp.name || '').trim();
      finishCreatingProject(name, { kind: 'mpr-folder', fileName: imp.grouped.mprFileName }, model).then(function (record) {
        state.mprImport = null;
        return openProject(record.id).then(function () {
          setMessage('Project "' + record.name + '" imported from ' + imp.grouped.mprFileName + '.', 'ok');
        });
      }, function (err) {
        imp.step = 'error';
        imp.error = (err && err.message) || 'Could not create that project.';
        render();
      });
      return;
    }
    // Replace mode never writes anything on its own — it stops at the diff
    // and waits for confirmDiff() below.
    var project = findProject(imp.projectId);
    store.getModel(imp.projectId).then(function (oldModel) {
      imp.newModel = model;
      imp.oldVersion = oldModel ? oldModel.version || null : null;
      imp.diff = diffModels(oldModel || { modules: [], entities: [], associations: [], microflows: [], nanoflows: [], pages: [], userRoles: [] }, model);
      imp.step = 'diff';
      render();
    }, function (err) {
      imp.step = 'error';
      imp.error = (err && err.message) || ('Could not read the stored model for "' + ((project && project.name) || 'this project') + '".');
      render();
    });
  }

  function confirmDiff() {
    var imp = state.mprImport;
    if (!imp || imp.mode !== 'replace' || !imp.newModel) return;
    finishReplacingProject(imp.projectId, { kind: 'mpr-folder', fileName: imp.grouped.mprFileName }, imp.newModel).then(function (project) {
      state.mprImport = null;
      setMessage('Model for "' + project.name + '" replaced from ' + project.fileName + '.', 'ok');
      render();
    }, function (err) {
      imp.step = 'error';
      imp.error = (err && err.message) || 'Could not replace that model.';
      render();
    });
  }

  function startImport() {
    var imp = state.mprImport;
    if (!imp || !imp.grouped) return;
    if (imp.mode === 'create') {
      var name = (imp.name || '').trim();
      if (!name) { imp.error = 'Give the project a name first.'; render(); return; }
    }

    imp.step = 'progress';
    imp.phase = 'Reading ' + imp.grouped.mprFileName + '…';
    imp.done = 0;
    imp.total = 0;
    imp.error = null;
    render();

    imp.grouped.mprFile.arrayBuffer().then(function (mprBuffer) {
      var run = parse(mprBuffer, imp.grouped.contentsByRelPath, appNameOf(imp.grouped.mprFileName), function (msg) {
        imp.phase = msg.phase; imp.done = msg.done; imp.total = msg.total;
        render();
      });
      imp.worker = run.worker;
      run.promise.then(function (model) {
        if (imp.worker !== run.worker) return;
        imp.worker = null;
        finishWithModel(imp, model);
      }, function (err) {
        if (imp.worker !== run.worker) return;
        imp.worker = null;
        imp.step = 'error';
        imp.error = err.message;
        render();
      });
    }, function (err) {
      imp.step = 'error';
      imp.error = (err && err.message) || 'Could not read that .mpr file.';
      render();
    });
  }

  // ---------- rendering ----------
  function renderPickStep(imp) {
    var useFolderPicker = supportsDirectoryPicker();
    var drop = useFolderPicker
      ? el('div', { class: 'file-drop' }, [
          el('div', {}, [el('strong', { text: 'Choose the project folder' })]),
          el('div', { class: 'muted', text: 'One pick — works the same whether it’s a v1 or a v2-format project' })
        ])
      : el('div', { class: 'file-drop' }, [
          el('div', {}, [el('strong', { text: 'Choose the project’s .mpr file' })]),
          el('div', { class: 'muted', text: 'Just that one file — or drop it here' })
        ]);
    drop.addEventListener('click', function () { if (useFolderPicker) pickProjectFolder(); else pickSingleFile('.mpr', onMprFilePicked); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('dragover');
      entriesFromDataTransfer(e.dataTransfer).then(function (entries) {
        // A single .mpr file dropped takes the fast path; a whole folder
        // dropped (the project root, or anything containing the .mpr and
        // its mprcontents/) falls back to finding everything inside it.
        if (entries.length === 1 && /\.mpr$/i.test(entries[0].relativePath)) {
          onMprFilePicked(entries[0].file);
        } else {
          onWholeFolderEntriesPicked(entries);
        }
      }, function (err) {
        imp.error = (err && err.message) || 'Could not read that.';
        render();
      });
    });
    // On Chromium there is no alternate link here any more: the folder pick
    // already covers a single loose .mpr file too (drop it on this same box),
    // so a second, separately-worded path to the same place was one option
    // too many — see renderNewProjectCard in app.js, which made the same call
    // for the same reason. Elsewhere (no File System Access API) a whole-folder
    // fallback is still offered, since there the single-file box is primary.
    var altLink = useFolderPicker
      ? null
      : el('button', { class: 'btn btn-sm', text: '…or choose the whole project folder instead', onclick: function () { pickFolder(onWholeFolderEntriesPicked); } });
    return [
      el('p', { class: 'muted', text: 'Reads the project directly, in this browser — nothing is uploaded anywhere.' }),
      drop,
      altLink,
      !useFolderPicker ? el('p', { class: 'hint', text: 'Slower for a big project, since it reads every file in it, not just the model.' }) : null,
      imp.waiting ? el('p', { class: 'hint mpr-waiting', text: 'Waiting for the folder… the browser lists every file in it first, which takes a while for a big project.' }) : null,
      imp.error ? el('p', { class: 'warn-text', text: imp.error }) : null
    ].filter(Boolean);
  }

  function renderPickContentsStep(imp) {
    var drop = el('div', { class: 'file-drop' }, [
      el('div', {}, [el('strong', { text: 'Choose the mprcontents folder' })]),
      el('div', { class: 'muted', text: 'The folder named "mprcontents", right next to ' + imp.pendingMprName + ' — or drop it here' })
    ]);
    var waiting = imp.waiting ? el('p', { class: 'hint mpr-waiting', text: 'Waiting for the folder… the browser lists every file in it first, which takes a while for a big project.' }) : null;
    drop.addEventListener('click', function () { pickFolder(onContentsEntriesPicked); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('dragover');
      entriesFromDataTransfer(e.dataTransfer).then(onContentsEntriesPicked, function (err) {
        imp.error = (err && err.message) || 'Could not read that folder.';
        render();
      });
    });
    return [
      el('p', { class: 'muted', text: imp.pendingMprName + ' is a v2-format project — its content lives in a separate mprcontents folder, not inside the .mpr file itself. Choose just that folder, not the whole project.' }),
      drop,
      waiting,
      imp.error ? el('p', { class: 'warn-text', text: imp.error }) : null
    ].filter(Boolean);
  }

  function renderReadyStep(imp) {
    var fileCount = imp.grouped.contentsByRelPath.size;
    var found = el('p', { class: 'muted', text: 'Found ' + imp.grouped.mprFileName + (fileCount ? ' with ' + fileCount + ' content file' + (fileCount === 1 ? '' : 's') + ' (v2 project format).' : ' (v1 project format — content is inline).') });
    found = [found, versionLine(imp.grouped.version)];
    if (imp.mode === 'replace') {
      var project = findProject(imp.projectId);
      return found.concat([
        el('p', { class: 'muted', text: 'This will compare it against the model already stored for “' + ((project && project.name) || 'this project') + '” — nothing is replaced until you confirm.' }),
        imp.error ? el('p', { class: 'warn-text', text: imp.error }) : null
      ]).filter(Boolean);
    }
    var nameInput = el('input', { type: 'text', value: imp.name });
    nameInput.addEventListener('input', function () { imp.name = nameInput.value; });
    return found.concat([
      el('label', { class: 'field' }, [el('span', { text: 'Project name' }), nameInput]),
      window.MxRepoUI ? window.MxRepoUI.readyNote(imp) : null,
      imp.error ? el('p', { class: 'warn-text', text: imp.error }) : null
    ]).filter(Boolean);
  }

  // "Version: main @ a1b2c3d · 14 Oct 2026 · “Fix order status”" — or why it is not known.
  function versionLine(v) {
    var V = window.MxModelVersion;
    return el('p', { class: 'model-version-line' + (V.known(v) ? '' : ' muted'), 'data-known': V.known(v) ? 'true' : 'false' }, [
      el('strong', { text: 'Version: ' }), document.createTextNode(V.known(v) ? V.label(v) + ' — from the project’s git' : 'unknown — ' + V.why(v))
    ]);
  }

  function renderDiffStep(imp) {
    var V = window.MxModelVersion;
    var was = el('p', { class: 'model-version-line model-version-diff' }, [el('strong', { text: 'Version: ' }),
      document.createTextNode((V.known(imp.oldVersion) ? V.label(imp.oldVersion, { noMessage: true }) : 'unknown') + ' → ' + (V.known(imp.newModel && imp.newModel.version) ? V.label(imp.newModel.version) : 'unknown'))]);
    // What is compared is which objects are there, by name — not what is inside them. Said as such, before the
    // model is replaced: "no differences" read as the whole model compared (an external audit, 2026-10-15, B08).
    var scope = el('p', { class: 'muted diff-scope', text: 'Only objects added or removed are compared here — changes inside an object that kept its name (an attribute’s type, an access rule, a flow’s steps) are not.' });
    if (!imp.diff.length) {
      return [was, el('p', { class: 'muted diff-none', text: 'No objects added or removed — changes inside objects are not compared here.' })];
    }
    return [was, scope].concat(imp.diff.map(function (d) {
      var counts = [];
      if (d.added.length) counts.push('+' + d.added.length);
      if (d.removed.length) counts.push('−' + d.removed.length);
      var shown = d.added.slice(0, 5).map(function (n) { return '+ ' + n; })
        .concat(d.removed.slice(0, 5).map(function (n) { return '− ' + n; }));
      var totalNamed = d.added.length + d.removed.length;
      var more = totalNamed - shown.length;
      return el('div', { class: 'popup-section' }, [
        el('div', { class: 'kv-row' }, [
          el('span', { class: 'kv-key', text: d.label }),
          el('span', { class: 'kv-val', text: counts.join(' / ') })
        ]),
        el('p', { class: 'muted', text: shown.join(', ') + (more > 0 ? ', and ' + more + ' more' : '') })
      ]);
    }));
  }

  function renderProgressStep(imp) {
    var bar = imp.total > 0
      ? el('progress', { value: imp.done, max: imp.total, style: 'width:100%' })
      : el('progress', { style: 'width:100%' });
    return [
      el('p', { text: imp.phase || 'Working…' }),
      bar,
      imp.total > 0 ? el('p', { class: 'muted', text: imp.done + ' / ' + imp.total }) : null
    ].filter(Boolean);
  }

  function renderErrorStep(imp) {
    return [el('p', { class: 'warn-text', text: imp.error || 'Something went wrong.' })];
  }

  function renderModal() {
    var imp = state.mprImport;
    if (!imp) return null;
    var isReplace = imp.mode === 'replace';

    var body = imp.step === 'pick' ? renderPickStep(imp)
      : imp.step === 'pick-contents' ? renderPickContentsStep(imp)
      : imp.step === 'ready' ? renderReadyStep(imp)
      : imp.step === 'progress' ? renderProgressStep(imp)
      : imp.step === 'diff' ? renderDiffStep(imp)
      : renderErrorStep(imp);

    var actions;
    if (imp.step === 'pick') {
      actions = [el('button', { class: 'btn', text: 'Cancel', onclick: close })];
    } else if (imp.step === 'pick-contents') {
      actions = [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn', text: 'Choose a different .mpr file', onclick: backToPick })
      ];
    } else if (imp.step === 'ready') {
      actions = [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn', text: 'Start over', onclick: backToPick }),
        el('button', { class: 'btn btn-primary', text: isReplace ? 'Compare' : 'Import', onclick: startImport })
      ];
    } else if (imp.step === 'progress') {
      actions = [el('button', { class: 'btn', text: 'Cancel', onclick: function () {
        if (imp.worker) { try { imp.worker.terminate(); } catch (e) { /* already gone */ } }
        imp.worker = null;
        imp.step = 'ready';
        render();
      } })];
    } else if (imp.step === 'diff') {
      actions = [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-primary', text: 'Replace model', onclick: confirmDiff })
      ];
    } else {
      actions = [
        el('button', { class: 'btn', text: 'Close', onclick: close }),
        el('button', { class: 'btn btn-primary', text: 'Try again', onclick: function () { imp.step = imp.grouped ? 'ready' : 'pick'; imp.error = null; render(); } })
      ];
    }

    var busy = imp.step === 'progress';
    var title = isReplace ? 'Replace model from Mendix project folder' : 'Import Mendix project folder';
    var kids = [el('h3', { text: title })].concat(body, [el('div', { class: 'modal-actions' }, actions)]);
    var backdrop = el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop && !busy) close(); }
    }, [window.MxDialog.modal(el('div', { class: 'modal' }, kids), function () { if (!busy) close(); })]);
    return backdrop;
  }

  // handleEntries is the seam between "how files got selected" (a real
  // whole-folder webkitdirectory pick, or a real folder drag&drop) and what
  // happens next. Exposed directly rather than only reachable through
  // pickFolder/entriesFromDataTransfer, so a test can hand it a folder's
  // worth of File objects without needing to automate an OS file-picker
  // dialog — see also handleMprFile/handleContentsEntries for the two-step
  // path's own seams.
  window.MxMprImport = {
    init: init, open: open, openReplace: openReplace, renderModal: renderModal,
    handleEntries: onWholeFolderEntriesPicked,
    handleMprFile: onMprFilePicked,
    handleContentsEntries: onContentsEntriesPicked,
    handleDirectoryHandle: onDirectoryHandlePicked,
    supportsDirectoryPicker: supportsDirectoryPicker, acceptFilter: acceptFilter,
    pickProjectFolder: pickProjectFolder,
    // A project kept inside the Mendix project reads its .mpr again with these (repoui.js).
    readModel: readModel, fingerprint: fingerprint
  };
})();
