/* MxScout — the storage layer. Everything MxScout keeps between visits goes
 * through this file and nowhere else.
 *
 * Why IndexedDB and not localStorage (which this replaces): comments are
 * coming, and they change the calculus completely. A model is reproducible —
 * lose it and you re-import the project folder in half a minute. A reviewer's
 * findings are not: they are hours of someone's attention and there is nowhere
 * to get them back from. localStorage is the wrong home for that. It is
 * synchronous and string-only, so appending one comment re-serialises the
 * whole model and blocks the UI thread; it has no transactions, so a quota
 * failure mid-write can leave the index and the bodies disagreeing; its quota
 * is shared across the whole origin (Safari caps around 5 MB and a single
 * model already eats ~2 MB); and it can be evicted under disk pressure.
 *
 * The layout below exists to keep those two kinds of data apart. A model is
 * written once, at import. A finding is written constantly. Putting them in
 * separate stores means saving a comment writes one small record and never
 * touches the model at all.
 *
 * Still true, and still the point: nothing here goes to the server. This is
 * the browser's own storage on the user's own machine — and, for a project the
 * person chose to keep in a folder, that folder too (see "the project folder"
 * below): the browser writes it, through folder.js, after every write here.
 */
(function () {
  'use strict';

  var DB_NAME = 'mxscout';
  var DB_VERSION = 7;

  // projects   — metadata only, so listing projects never parses a model
  // models     — one record per project, written at import and never again
  // findings   — one record PER COMMENT; this is the store that is hot
  // exports    — one record per export, each holding a snapshot of what was
  //              sent (see ROADMAP: this is what makes "not exported yet",
  //              the delivery history and "changed since you sent it" work)
  // recordings — one record PER performance recording (see perf.js): a
  //              session captured through the admin-port bridge, with its own
  //              start time. A project can hold many, browsed and deleted
  //              individually — same shape as findings/exports.
  // descriptions — one record per project: the descriptions an AI agent
  //              wrote from the AI pack (describe.js), as imported. v4.
  // triage     — one record per project: what a person decided about the
  //              risks (false positive, fixed, reopened) and what MxScout
  //              found when new descriptions came in (triage.js). Kept apart
  //              from `descriptions` on purpose: an import replaces those, and
  //              the decisions must outlive it. v5.
  // assist     — one record per project: the items on the Assist page — what an
  //              agent helped with, each with its status (assist.js). A local
  //              base: never in a package, never in the exported documentation.
  //              v6 — the same store at the same version as the public MxScout,
  //              so the two editions keep one schema.
  // knowledge  — one record per project: the solved cases, the notes an agent wrote in knowledge/
  //              (knowledge.js), as { path, text }. The team's, committed with the app when the project
  //              is kept inside the Mendix project; in a package; in the exported documentation only when
  //              asked for. v7 — added in both editions at the same number, like `assist`.
  // settings   — small key/value pairs: the author identity, UI preferences, a project folder's handle,
  //              a project's package key (a WebCrypto key — see "the project's package key" below),
  //              and a project's context for a chat assistant (basket.js — see "the context" below)
  var STORES = {
    projects: { keyPath: 'id', indexes: [] },
    models: { keyPath: 'projectId', indexes: [] },
    findings: { keyPath: 'id', indexes: [['byProject', 'projectId'], ['byUpdated', 'updatedAt']] },
    exports: { keyPath: 'id', indexes: [['byProject', 'projectId']] },
    recordings: { keyPath: 'id', indexes: [['byProject', 'projectId'], ['byStarted', 'started']] },
    descriptions: { keyPath: 'projectId', indexes: [] },
    triage: { keyPath: 'projectId', indexes: [] },
    assist: { keyPath: 'projectId', indexes: [] },
    knowledge: { keyPath: 'projectId', indexes: [] },
    settings: { keyPath: 'key', indexes: [] }
  };

  var db = null;

  // ---------- opening ----------
  function open() {
    return new Promise(function (resolve, reject) {
      if (db) { resolve(db); return; }
      if (!window.indexedDB) {
        reject(new Error('This browser has no IndexedDB — MxScout cannot keep projects here.'));
        return;
      }
      var req;
      try { req = window.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }

      req.onupgradeneeded = function (event) {
        var d = event.target.result;
        // v2's `recordings` was keyed by projectId (one recording per
        // project); v3 keys it by its own id so a project can hold many. An
        // object store's keyPath cannot be changed in place, so the old
        // store — at most one row per project, from Phase 1 — is dropped and
        // recreated below rather than migrated. A one-time, one-machine loss
        // of an already-imported recording, not a general migration.
        if (event.oldVersion > 0 && event.oldVersion < 3 && d.objectStoreNames.contains('recordings')) {
          d.deleteObjectStore('recordings');
        }
        Object.keys(STORES).forEach(function (name) {
          if (d.objectStoreNames.contains(name)) return;
          var spec = STORES[name];
          var os = d.createObjectStore(name, { keyPath: spec.keyPath });
          spec.indexes.forEach(function (ix) { os.createIndex(ix[0], ix[1]); });
        });
      };
      req.onsuccess = function () {
        db = req.result;
        // A second tab opening a newer version would otherwise leave this one
        // holding a blocked connection forever.
        db.onversionchange = function () { db.close(); db = null; };
        resolve(db);
      };
      // Private-browsing modes and site-data restrictions surface here rather
      // than by throwing above, which is why the caller gets a rejected
      // promise instead of an exception to catch.
      req.onerror = function () { reject(req.error || new Error('IndexedDB could not be opened.')); };
      req.onblocked = function () { reject(new Error('Another MxScout tab is holding the database open — close it and reload.')); };
    });
  }

  // ---------- one transaction, one promise ----------
  // Resolves on the TRANSACTION completing, not on the request succeeding: a
  // request can report success and still be rolled back if a later write in
  // the same transaction fails. Anything that reports "saved" must wait for
  // the transaction, or it will eventually report a save that did not happen.
  function run(storeNames, mode, body) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(storeNames, mode);
        var out;
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = function () { reject(tx.error || new Error('Storage transaction failed.')); };
        tx.onabort = function () { reject(tx.error || new Error('Storage transaction was aborted.')); };
        try {
          out = body(function (name) { return tx.objectStore(name); }, function (value) { out = value; });
        } catch (e) {
          try { tx.abort(); } catch (e2) { /* already gone */ }
          reject(e);
        }
      });
    });
  }

  function reqPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  // ---------- generic record access ----------
  function getAll(storeName) {
    return run([storeName], 'readonly', function (store, set) {
      reqPromise(store(storeName).getAll()).then(set);
    }).then(function (rows) { return rows || []; });
  }

  function get(storeName, key) {
    return run([storeName], 'readonly', function (store, set) {
      reqPromise(store(storeName).get(key)).then(set);
    });
  }

  function put(storeName, value) {
    return run([storeName], 'readwrite', function (store) {
      store(storeName).put(value);
    }).then(function () { mirrorPut(storeName, value); told(storeName, value && value[STORES[storeName].keyPath], value && value.rev); return value; });
  }

  // Read, change and write ONE record in ONE transaction, on the record as the database holds it
  // now — never on a copy a tab read earlier. Two tabs of MxScout share this database, and a copy
  // kept in a tab's memory goes stale the moment the other one saves: written back whole, it
  // silently undid the other tab's change (an external audit, 2026-10-15, B05). IndexedDB runs
  // readwrite transactions on one store one after the other, across tabs, so nothing lands between
  // the read and the write here. `change(current)` must work synchronously (a transaction closes
  // once nothing is asked of it): it returns the new record, or undefined to leave it as it is,
  // or throws — then nothing is written and the promise rejects with that error. The new record
  // gets the next revision number (`rev`), which is how a caller tells the record it read from a
  // newer one. → { value: the record kept now, changed: whether it was written }.
  function update(storeName, key, change) {
    return open().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction([storeName], 'readwrite');
        var os = tx.objectStore(storeName), out = null, failed = null;
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = function () { reject(failed || tx.error || new Error('Storage transaction failed.')); };
        tx.onabort = function () { reject(failed || tx.error || new Error('Storage transaction was aborted.')); };
        var req = os.get(key);
        req.onsuccess = function () {
          var cur = req.result || null;
          try {
            var next = change(cur);
            if (next === undefined) { out = { value: cur, changed: false }; return; }
            next.rev = ((cur && cur.rev) || 0) + 1;
            os.put(next);
            out = { value: next, changed: true };
          } catch (e) {
            failed = e;
            try { tx.abort(); } catch (e2) { /* already gone */ }
          }
        };
      });
    }).then(function (r) {
      if (r.changed) { mirrorPut(storeName, r.value); told(storeName, key, r.value.rev); }
      return r;
    });
  }

  // ---------- other tabs ----------
  // A record one tab saved is news to every other tab of MxScout in this browser: they read it again
  // rather than keep drawing — and later saving over — the copy they hold. A BroadcastChannel carries
  // only which record moved (its store, its key, its revision), never the record, and it reaches
  // nothing but the tabs of this very origin in this browser — no server, no other site, no other
  // browser. A tab does not hear its own messages.
  var TOLD = { projects: true, descriptions: true, assist: true, knowledge: true, triage: true, findings: true };
  var channel = null, listeners = [];
  try { channel = window.BroadcastChannel ? new window.BroadcastChannel('mxscout-store') : null; } catch (e) { channel = null; }
  if (channel) {
    channel.onmessage = function (ev) {
      var m = ev && ev.data;
      if (!m || typeof m.store !== 'string' || !TOLD[m.store]) return;
      listeners.forEach(function (fn) { try { fn(m.store, m.key, m.rev || null, !!m.deleted); } catch (e) { /* a listener's own problem */ } });
    };
  }
  function told(storeName, key, rev, deleted) {
    if (!channel || !TOLD[storeName] || key == null) return;
    try { channel.postMessage({ store: storeName, key: key, rev: rev || null, deleted: !!deleted }); } catch (e) { /* the other tabs read it when they next load it */ }
  }
  // fn(storeName, key, rev, deleted) — another tab saved (or deleted) that record.
  function onOtherTab(fn) { listeners.push(fn); }

  function putMany(storeName, values) {
    if (!values.length) return Promise.resolve([]);
    return run([storeName], 'readwrite', function (store) {
      var os = store(storeName);
      values.forEach(function (v) { os.put(v); });
    }).then(function () {
      var seen = {};
      values.forEach(function (v) { if (v && v.projectId && !seen[v.projectId]) { seen[v.projectId] = true; mirrorPut(storeName, v); } });
      return values;
    });
  }

  function del(storeName, key) {
    return run([storeName], 'readwrite', function (store) {
      store(storeName).delete(key);
    }).then(function () { mirrorDelete(storeName, key); told(storeName, key, null, true); });
  }

  function byIndex(storeName, indexName, key) {
    return run([storeName], 'readonly', function (store, set) {
      reqPromise(store(storeName).index(indexName).getAll(key)).then(set);
    }).then(function (rows) { return rows || []; });
  }

  // ---------- project-level operations ----------
  // A project and its model are written in ONE transaction. Half an import —
  // a project row with no model behind it — is exactly the inconsistency
  // localStorage could not rule out, and the reason for moving here.
  // opts.mirror === false: the model came FROM the project's folder, so it is not written back there.
  function saveProjectWithModel(project, model, opts) {
    return run(['projects', 'models'], 'readwrite', function (store) {
      store('projects').put(project);
      store('models').put({ projectId: project.id, model: model });
    }).then(function () {
      if (!(opts && opts.mirror === false)) mirror(project.id, ['model.json', 'project.json']);
      else mirror(project.id, ['project.json']);
      told('projects', project.id, null);
      return project;
    });
  }

  // Deleting a project takes its model, findings, export history,
  // recordings, imported descriptions, risk triage and Assist items with it, in one transaction. Orphaned findings pointing at a
  // project that no longer exists would be invisible and permanent.
  // A project kept in a folder forgets the folder too — and leaves the folder's
  // files where they are: they are the person's files on their own disk.
  function deleteProjectDeep(projectId) {
    return run(['projects', 'models', 'findings', 'exports', 'recordings', 'descriptions', 'triage', 'assist', 'knowledge', 'settings'], 'readwrite', function (store) {
      store('projects').delete(projectId);
      store('models').delete(projectId);
      store('descriptions').delete(projectId);
      store('triage').delete(projectId);
      store('assist').delete(projectId);
      store('knowledge').delete(projectId);
      store('settings').delete(linkKey(projectId));
      store('settings').delete(packageKeyOf(projectId));
      store('settings').delete(basketOf(projectId));
      forgetLink(projectId);
      ['findings', 'exports', 'recordings'].forEach(function (name) {
        var index = store(name).index('byProject');
        index.openKeyCursor(window.IDBKeyRange.only(projectId)).onsuccess = function (event) {
          var cursor = event.target.result;
          if (!cursor) return;
          store(name).delete(cursor.primaryKey);
          cursor.continue();
        };
      });
    });
  }

  function getModel(projectId) {
    return get('models', projectId).then(function (row) { return row ? row.model : null; });
  }

  // ---------- the context (basket.js) ----------
  // The model elements a person put aside to talk about with a chat assistant: one list per project, kept
  // in `settings` under "basket.<projectId>" — no store of its own, so no version upgrade. Personal and
  // local: nothing mirrors `settings` into a folder, and no package or export carries it. Deleting the
  // project deletes it.
  function basketOf(id) { return 'basket.' + id; }
  function getBasket(projectId) {
    return get('settings', basketOf(projectId)).then(function (r) { return r && Array.isArray(r.items) ? r.items : []; });
  }
  // change(items) → the new list (or null to leave it), worked out on the list as the database holds it
  // now, in one transaction (update) — a second tab may have added to it since this one read it.
  function changeBasket(projectId, change) {
    return update('settings', basketOf(projectId), function (cur) {
      var items = change(cur && Array.isArray(cur.items) ? cur.items.slice() : []);
      return items ? { key: basketOf(projectId), projectId: projectId, items: items, updatedAt: new Date().toISOString() } : undefined;
    }).then(function (r) { return r.value && Array.isArray(r.value.items) ? r.value.items : []; });
  }

  // ---------- the project's package key ----------
  // One per project, once a package of it was made or opened here with the code (crypto.js): the
  // WebCrypto key itself (structured-cloned into the database, never as text), its random id, and when
  // and how it came. Kept in `settings` under "packageKey.<projectId>" — no store of its own, so no
  // version upgrade, and nothing mirrors `settings` into a project's folder: the key is never written
  // there, not in project.json and not anywhere else. A package whose key id matches opens without the
  // code (transfer.js); Forget this project's key deletes it, and so does deleting the project.
  function packageKeyOf(id) { return 'packageKey.' + id; }
  function getPackageKey(projectId) {
    return get('settings', packageKeyOf(projectId)).then(function (r) { return r && r.cryptoKey && r.keyId ? { id: r.keyId, key: r.cryptoKey, savedAt: r.savedAt, how: r.how } : null; });
  }
  // how: 'made' (this browser packed the project first) or 'opened' (it came with a package opened with the code).
  function putPackageKey(projectId, pk, how) {
    return put('settings', { key: packageKeyOf(projectId), projectId: projectId, keyId: pk.id, cryptoKey: pk.key, savedAt: new Date().toISOString(), how: how || 'opened' });
  }
  function forgetPackageKey(projectId) { return del('settings', packageKeyOf(projectId)); }
  // The projects in this browser that keep the key with this id, newest first: [{ projectId, id, key }].
  function projectsWithPackageKey(keyId) {
    return getAll('settings').then(function (rows) {
      return rows.filter(function (r) { return String(r.key).indexOf('packageKey.') === 0 && r.keyId === keyId && r.cryptoKey; })
        .sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); })
        .map(function (r) { return { projectId: r.projectId, id: r.keyId, key: r.cryptoKey }; });
    });
  }

  // ---------- eviction resistance ----------
  // Browser storage is best-effort by default: under disk pressure the
  // browser may clear it without asking. Findings are the one thing here that
  // cannot be regenerated, so ask to be exempt. A refusal is not an error —
  // Chrome grants it on engagement signals, Firefox prompts, Safari decides
  // on its own — it just means the export reminder matters more.
  function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(null);
    return navigator.storage.persisted().then(function (already) {
      return already ? true : navigator.storage.persist();
    }).catch(function () { return null; });
  }

  function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate().catch(function () { return null; });
  }

  // ---------- migration off localStorage ----------
  // MxScout kept projects in localStorage up to this version. The move is a
  // real move: copy, VERIFY the copy landed, and only then drop the old key.
  // A migration that deletes first and copies second is one interrupted
  // reload away from losing someone's project.
  var LS_INDEX = 'mxscout.projects.v1';
  var LS_ACTIVE = 'mxscout.activeProject.v1';
  function lsModelKey(id) { return 'mxscout.project.' + id + '.model.v1'; }

  function readLegacyIndex() {
    var raw;
    try { raw = window.localStorage.getItem(LS_INDEX); }
    catch (e) { return []; } // storage blocked entirely — nothing to migrate
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function migrateFromLocalStorage() {
    var legacy = readLegacyIndex();
    if (!legacy.length) return Promise.resolve({ migrated: 0, failed: [] });

    var migrated = 0;
    var failed = [];

    // Sequential on purpose. These are multi-megabyte values and a migration
    // is a one-time event; doing them one at a time keeps peak memory to a
    // single model and makes a partial failure easy to report precisely.
    var chain = Promise.resolve();
    legacy.forEach(function (entry) {
      chain = chain.then(function () {
        if (!entry || !entry.id) return null;
        var text;
        try { text = window.localStorage.getItem(lsModelKey(entry.id)); }
        catch (e) { text = null; }
        if (text == null) { failed.push(entry.name || entry.id); return null; }

        var model;
        try { model = JSON.parse(text); }
        catch (e) { failed.push(entry.name || entry.id); return null; }

        var project = {
          id: entry.id,
          name: entry.name || 'Untitled',
          createdAt: entry.createdAt || new Date().toISOString(),
          updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
          source: { kind: 'legacy-json', fileName: entry.fileName || null },
          bytes: entry.bytes || text.length,
          summary: entry.summary || null,
          appUrl: entry.appUrl || null
        };

        return saveProjectWithModel(project, model)
          .then(function () { return getModel(entry.id); })
          .then(function (readBack) {
            // Verify before removing. "put resolved" is not the same claim as
            // "it is readable now".
            if (!readBack) { failed.push(project.name); return; }
            migrated += 1;
            try { window.localStorage.removeItem(lsModelKey(entry.id)); } catch (e) { /* leave it */ }
          })
          .catch(function () { failed.push(project.name); });
      });
    });

    return chain.then(function () {
      // The index goes only once every model it named is safely across.
      if (!failed.length) {
        try {
          window.localStorage.removeItem(LS_INDEX);
          window.localStorage.removeItem(LS_ACTIVE);
        } catch (e) { /* leave it */ }
      }
      return put('settings', {
        key: 'migration.localStorage.v1',
        at: new Date().toISOString(),
        migrated: migrated,
        failed: failed
      }).then(function () { return { migrated: migrated, failed: failed }; });
    });
  }

  function legacyActiveId() {
    try { return window.localStorage.getItem(LS_ACTIVE); }
    catch (e) { return null; }
  }

  // ---------- the project folder ----------
  // A project the person chose to keep in a folder on disk is written there
  // too, by this tab, after every write above lands in the database
  // (write-through): the database stays the copy MxScout always has, the
  // folder is the one people and agents read. folder.js does the file work;
  // WHEN and WHAT is decided here, so nothing else writes the folder.
  //
  // A link is { handle, wrote, pending, … } per project, kept in `settings`
  // under "folder.<projectId>" — a directory handle can be kept in IndexedDB,
  // and keeping it there needs no new object store, so the database version
  // stays 5.
  //
  // The rules:
  //  - the database is written first, always. A folder that cannot be written
  //    (no permission after a browser restart, moved, a write that failed)
  //    loses nothing: the files are marked pending — kept with the link, so a
  //    reload remembers them — and written when the folder is back;
  //  - before anything is written to a folder MxScout has not just been
  //    writing, what changed THERE is read first (syncFolder): a file whose
  //    date is newer than MxScout's own last write of it was written by
  //    someone else — an agent, git, a person — and the folder wins (the app
  //    takes it in, with Undo for the descriptions);
  //  - documentation.md and ai-pack.md are made by docs.js and handed here
  //    (folderDerived), and written only when their text changed;
  //  - MxScout removes only a file of its own it no longer needs (descriptions.json
  //    when the descriptions are removed, comments.json or triage.json when there
  //    is nothing left in them, an Assist item's file when Undo takes the item
  //    back), never anything else, not even when the project is deleted:
  //    deleting it forgets the folder and leaves the files.
  //
  // A project kept INSIDE the Mendix project (layout 2, repodocs.js) is the same
  // write-through with two roots: what a team shares through git in mxscout/
  // (link.handle) — mxscout.json, descriptions/ split into small files, docs/,
  // AGENTS.md, README.md, .gitignore — and what stays on this machine in
  // mxscout/.local/ (link.local) — model.json, documentation.md, ai-pack.md, inbox/,
  // assist/. The Mendix project's own directory (link.repo) is only read: its .mpr
  // and .git, by the app (repoui.js). Nothing is written outside mxscout/. A file
  // that is shared is written only when its text changes, so a teammate who only
  // pulls finds git's status clean; docs/ only when the descriptions it was made
  // from changed (docs/manifest.json says which); and while a JSON file in mxscout/
  // has git's conflict markers, nothing shared is taken or written until the person
  // keeps one side or resolves it in git.
  var folder = null;      // folder.js, installed by app.js (useFolder)
  var folderOpts = {};    // { toFile, version, adopt, assistFiles, repoDocs, reread }
  var links = {};         // projectId -> link
  var watchers = [];
  var ORDER = ['inbox/', 'model.json', 'descriptions.json', 'assist/', 'knowledge/', 'comments.json', 'triage.json', 'documentation.md', 'ai-pack.md', 'README.md', 'project.json'];

  function linkKey(id) { return 'folder.' + id; }
  function useFolder(backend, opts) { folder = backend; folderOpts = opts || {}; }
  function onFolder(fn) { watchers.push(fn); }
  function tell(l, what) {
    if (l.quiet) return;
    var info = infoOf(l);
    watchers.forEach(function (fn) { try { fn(l.projectId, info, what); } catch (e) { /* a watcher's own problem */ } });
  }

  function newLink(id, handle, from) {
    from = from || {};
    var pending = {};
    (from.pending || []).forEach(function (f) { pending[f] = true; });
    var repo = from.layout === 2 ? from.repo || null : null;
    return { projectId: id, handle: handle, name: repo ? repo.name + '/' + handle.name : handle.name, linkedAt: from.linkedAt || new Date().toISOString(),
      wrote: Object.assign({}, from.wrote || {}), pending: pending, path: from.path || '', lastWriteAt: from.lastWriteAt || null,
      layout: repo ? 2 : 1, repo: repo, local: null, localName: from.localName || null, mpr: from.mpr || null, conflicts: [], skills: !!from.skills, skillsOnce: false, skillsSeen: {},
      derived: {}, lastText: {}, status: 'unknown', error: null, busy: null, again: false, timer: null, saveTimer: null, syncing: null };
  }
  // A link read back from `settings`: the project's own file as last written or read comes back with it (baseOf).
  function linkFrom(id, r) {
    var l = newLink(id, r.handle, r);
    if (typeof r.projectText === 'string') l.lastText[isRepo(l) ? 'mxscout.json' : 'project.json'] = r.projectText;
    return l;
  }
  function recordOf(l) {
    return { key: linkKey(l.projectId), projectId: l.projectId, handle: l.handle, linkedAt: l.linkedAt, wrote: l.wrote,
      pending: Object.keys(l.pending), path: l.path, lastWriteAt: l.lastWriteAt, layout: l.layout, repo: l.repo, localName: l.localName || null, mpr: l.mpr, skills: l.skills,
      projectText: l.lastText[isRepo(l) ? 'mxscout.json' : 'project.json'] || null };
  }
  // ---------- layout 2: the project inside the Mendix project ----------
  function isRepo(l) { return l.layout === 2; }
  var LOCAL_FILES = { 'model.json': true, 'documentation.md': true, 'ai-pack.md': true, 'inbox/': true, 'assist/': true };
  function localPath(p) { return LOCAL_FILES[p] || /^(assist|inbox)\//.test(p); }
  // Where a file of the project is written: mxscout/.local/ for what stays on this machine, else the project's folder.
  function rootOf(l, p) { return isRepo(l) && localPath(p) ? l.local : l.handle; }
  // How a file is known in `wrote` and `lastText`: its path inside mxscout/ for layout 2.
  function wk(l, p) { return isRepo(l) && localPath(p) ? '.local/' + p : p; }
  function R() { return window.MxRepoDocs; }
  // What stays on this machine, for a project kept in its Mendix project (Karol, 2026-10-16): a folder of
  // its own in the MxScout folder (home, below) when one is set — nothing personal in the Mendix project at
  // all — else mxscout/.local/, which git ignores. Made when it is not there yet; a .local/ left from before
  // is moved into it (moveLocal).
  function localDir(l) {
    if (!isRepo(l)) return Promise.resolve(l.handle);
    if (l.local) return Promise.resolve(l.local);
    if (!home) return l.handle.getDirectoryHandle('.local', { create: true }).then(function (d) { l.local = d; return d; });
    var h = home;
    return folder.permission(h, false).then(function (p) {
      if (p !== 'granted') { var e = new Error('MxScout needs your permission for its folder, ' + h.name + ', again.'); e.name = 'NotAllowedError'; throw e; }
      return l.localName ? h.getDirectoryHandle(l.localName, { create: true }) : folder.childFor(h, l.repo ? l.repo.name : l.handle.name, l.projectId);
    }).then(function (d) {
      var named = l.localName !== d.name;
      l.local = d; l.localName = d.name;
      return writeLocalStamp(l).then(function () { return moveLocal(l); }).then(function () {
        if (named && links[l.projectId] === l) return put('settings', recordOf(l)).catch(function () { return null; });
        return null;
      }).then(function () { return d; });
    });
  }
  // The local folder says whose it is: its project's id (as mxscout.json in the Mendix project does), so an
  // agent finds it from there (mendix-describe agent.js, mendix-assist check-assist.js, mxscout-project).
  function writeLocalStamp(l) {
    return folder.readFile(l.local, 'project.json').then(function (r) {
      if (r && r.text && r.text.indexOf('"' + l.projectId + '"') !== -1) return null;
      return folder.write(l.local, 'project.json', JSON.stringify({ format: 'mxscout-project', layout: 2, part: 'local', id: l.projectId,
        name: l.repo ? l.repo.name : l.handle.name, edition: folder.EDITION, note: 'What stays on this machine for a project kept in its Mendix project (mxscout/ there is committed). Written by MxScout.' }, null, 2) + '\n');
    });
  }
  // A mxscout/.local/ from before the MxScout folder was set: every file copied into the local folder (one
  // already there kept), checked, and only then .local/ removed from the Mendix project — MxScout's own folder.
  function moveLocal(l) {
    return l.handle.getDirectoryHandle('.local', { create: false }).then(function (old) {
      return folder.listAll(old, '', /.*/).then(function (files) {
        return files.reduce(function (p, f) {
          var rel = f.path.replace(/^\//, '');
          return p.then(function () {
            return folder.stat(l.local, rel).then(function (there) {
              if (there) return null;
              return folder.readFile(old, rel).then(function (r) { return r ? folder.write(l.local, rel, r.text).then(function (at) { l.wrote['.local/' + rel] = at; }) : null; });
            });
          });
        }, Promise.resolve()).then(function () {
          return Promise.all(files.map(function (f) { return folder.stat(l.local, f.path.replace(/^\//, '')); }));
        }).then(function (st) {
          if (st.some(function (x) { return !x; })) throw new Error('mxscout/.local/ could not be moved into ' + home.name + ' whole; it is left where it is.');
          return l.handle.removeEntry('.local', { recursive: true });
        });
      });
    }, function () { return null; });
  }

  // ---------- the MxScout folder (Karol, 2026-10-16) ----------
  // One folder, chosen once, where MxScout keeps what is not the team's: a folder of its own for every
  // project — a project folder (layout 1) whole, or the local part of one kept in its Mendix project. It is
  // also the library an agent reads (the mxscout-project skill). Kept in `settings` as a handle; the browser
  // may ask for permission again after a restart (permissionHome(true), from a click).
  var HOME_KEY = 'homeFolder';
  var home = null;
  function loadHome() {
    return get('settings', HOME_KEY).then(function (r) { home = r && r.handle ? r.handle : null; return home; }, function () { return null; });
  }
  function setHome(handle) {
    home = handle || null;
    // Every layout-2 link finds its local folder again, in the new place.
    Object.keys(links).forEach(function (id) { if (isRepo(links[id])) { links[id].local = null; links[id].localName = null; } });
    return (home ? put('settings', { key: HOME_KEY, handle: home, at: new Date().toISOString() }) : del('settings', HOME_KEY)).then(function () { return homeInfo(); });
  }
  function homeHandle() { return home; }
  function homeInfo() { return home ? { name: home.name } : null; }
  function permissionHome(ask) { return home && folder ? folder.permission(home, ask) : Promise.resolve('none'); }
  // A shared file, written only when its text is not already what the file holds (read first, so a file
  // git brought with the same text is not touched). Resolves with the file's date.
  function writeShared(l, path, text) {
    if (l.lastText[path] === text && l.wrote[path]) return Promise.resolve(l.wrote[path]);
    return folder.readFile(l.handle, path).then(function (r) {
      if (r && r.text === text) return r.lastModified;
      return folder.write(l.handle, path, text);
    }).then(function (at) { l.wrote[path] = at; l.lastText[path] = text; return at; });
  }
  function removeShared(l, path) {
    return folder.remove(l.handle, path).then(function () { delete l.wrote[path]; delete l.lastText[path]; });
  }
  // A shared file someone else changed (or added, or removed) since MxScout last wrote or read it:
  // descriptions/ and mxscout.json. True when there is one — then nothing shared is written before it is taken in.
  // The solved cases in knowledge/ count too.
  function sharedMoved(l) {
    // Developer tools: triage.json and comments/ are the team's too.
    return Promise.all([folder.stat(l.handle, 'mxscout.json'), folder.listAll(l.handle, 'descriptions'), folder.stat(l.handle, 'triage.json'), folder.listAll(l.handle, 'comments'), caseList(l)]).then(function (b) {
      var mx = b[0], list = b[1].concat(b[3], b[4]), on = {};
      if (mx && !(l.wrote['mxscout.json'] && mx.lastModified <= l.wrote['mxscout.json'])) return true;
      if (b[2] && !(l.wrote['triage.json'] && b[2].lastModified <= l.wrote['triage.json'])) return true;
      var moved = list.some(function (s) { on[s.path] = true; return !(l.wrote[s.path] && s.lastModified <= l.wrote[s.path]); });
      return moved || Object.keys(l.wrote).some(function (p) { return (/^(descriptions|comments)\//.test(p) || CASE.test(p)) && !on[p]; });
    });
  }
  // The solved cases' files in knowledge/ (one level, *.md) — under the project's folder in both layouts.
  var CASE = /^knowledge\/[^/]+\.md$/;
  function caseList(l) { return folder.listAll(l.handle, 'knowledge', /\.md$/i).then(function (all) { return all.filter(function (s) { return CASE.test(s.path); }); }); }
  // A note the project no longer keeps, removed — only when what is there is a note MxScout could keep: a file it
  // read and could not take (an error in it, personal data among them) stays for the person to fix.
  function removeCase(l, path) {
    return folder.readFile(l.handle, path).then(function (r) {
      if (r && !R().caseOf({ path: path, text: r.text })) return null;
      return removeShared(l, path);
    });
  }
  // A solved case's note, written only when its text is not what the file holds — and never over a file there
  // that does not pass as a note (git's conflict markers in it, a hand edit gone wrong): that one is the person's.
  function writeCase(l, path, text) {
    if (l.lastText[path] === text && l.wrote[path]) return Promise.resolve(l.wrote[path]);
    return folder.readFile(l.handle, path).then(function (r) {
      if (r && r.text !== text && R().caseCheck(r.text, path).errors.length) return null;
      return writeShared(l, path, text);
    });
  }
  function saveLinkSoon(l) {
    if (l.saveTimer || links[l.projectId] !== l) return;
    l.saveTimer = setTimeout(function () { l.saveTimer = null; if (links[l.projectId] === l) put('settings', recordOf(l)).catch(function () {}); }, 150);
  }
  function forgetLink(id) {
    var l = links[id];
    if (!l) return;
    if (l.timer) clearTimeout(l.timer);
    if (l.saveTimer) clearTimeout(l.saveTimer);
    delete links[id];
  }

  function loadFolderLinks() {
    if (!folder) return Promise.resolve([]);
    return getAll('settings').then(function (rows) {
      rows.forEach(function (r) {
        if (String(r.key).indexOf('folder.') === 0 && r.handle && r.projectId) links[r.projectId] = linkFrom(r.projectId, r);
      });
      return Object.keys(links);
    });
  }

  function infoOf(l) {
    if (!l) return null;
    return { name: l.name, path: l.path, status: l.status, error: l.error, wrote: Object.assign({}, l.wrote),
      pending: Object.keys(l.pending), writing: !!l.busy, lastWriteAt: l.lastWriteAt, linkedAt: l.linkedAt,
      layout: l.layout, repoName: l.repo ? l.repo.name : null, localName: l.localName || null, homeName: home ? home.name : null, mpr: l.mpr, skills: l.skills, skillsSeen: Object.assign({}, l.skillsSeen), conflicts: l.conflicts.map(function (c) { return { path: c.path, text: c.text }; }) };
  }
  function folderInfo(id) { return infoOf(links[id]); }
  // Whether what is this machine's of a project — a project folder whole, or the local part of one kept in its
  // Mendix project — is inside the MxScout folder: what the projects list and Settings say about where it is
  // kept (home.js). Asked of the browser once per link (FileSystemHandle.resolve), and remembered. → true | false | null (cannot tell).
  function inHome(id) {
    var l = links[id];
    if (!l || !home) return Promise.resolve(l ? false : null);
    if (l.inHome !== undefined && l.inHomeOf === home) return Promise.resolve(l.inHome);
    var h = isRepo(l) ? (l.local && l.local !== l.handle ? l.local : null) : l.handle;
    if (!h || typeof home.resolve !== 'function') return Promise.resolve(isRepo(l) && l.localName ? true : null);
    return home.resolve(h).then(function (parts) { l.inHome = !!parts; l.inHomeOf = home; return l.inHome; }, function () { return null; });
  }

  function errorText(err) { return (err && err.message) || String(err || 'unknown error'); }
  function statusOf(err) {
    var n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'needs-permission';
    if (n === 'NotFoundError') return 'missing';
    return 'error';
  }
  function setStatus(l, status, err) {
    var was = l.status;
    l.status = status;
    l.error = err ? errorText(err) : null;
    if (was !== status || err) tell(l, status);
  }

  // The project's own file (project.json, or mxscout.json inside the Mendix project) as MxScout last wrote or
  // read it, and whether this browser's settings are still to be written there: what the app needs to tell a
  // setting someone else changed in the file from one the person just changed here and that is not written
  // yet — which the file, read in that moment, still holds the OLD value of (folderui.js adoptChanges).
  function baseOf(l, path) { return { text: l.lastText[path] != null ? l.lastText[path] : null, pending: !!l.pending['project.json'] }; }

  // What is written for each file, read from the database at the moment of writing — so a burst
  // of saves writes the last state once. Returns the file's date after the write, or null.
  // Layout 2's shared files wait while git left a conflict in one of them, or while someone else's newer
  // ones are still to be taken in (sharedMoved): the writer then answers HOLD, and the file stays pending.
  var HOLD = { hold: true };
  function sharedGate(l, work) {
    if (l.conflicts.length) return Promise.resolve(HOLD);
    return sharedMoved(l).then(function (moved) { if (moved) { l.refresh = true; return HOLD; } return work(); });
  }
  // Developer tools, inside the Mendix project: the comments as comments/<id>.json, triage.json as one file.
  function devParts(l) {
    if (!folderOpts.files || !folderOpts.files['comments/']) return Promise.resolve([]);
    return Promise.all([folderOpts.files['comments/'](l.projectId), folderOpts.files['triage.json'](l.projectId)]).then(function (b) {
      return (b[0] || []).concat(b[1] == null ? [] : [{ path: 'triage.json', text: b[1] }]);
    });
  }
  function writeComments(l) {
    return Promise.resolve(folderOpts.files['comments/'](l.projectId)).then(function (files) {
      var now = {};
      files.forEach(function (f) { now[f.path] = true; });
      var gone = Object.keys(l.wrote).filter(function (p) { return /^comments\//.test(p) && !now[p]; });
      return files.reduce(function (p, f) { return p.then(function () { return writeShared(l, f.path, f.text); }); }, Promise.resolve())
        .then(function () { return gone.reduce(function (p, path) { return p.then(function () { return removeShared(l, path); }); }, Promise.resolve()); })
        .then(function () { return null; });
    });
  }
  function writeTriage(l) {
    return Promise.resolve(folderOpts.files['triage.json'](l.projectId)).then(function (text) {
      if (text != null) return writeShared(l, 'triage.json', text).then(function () { return null; });
      return folder.stat(l.handle, 'triage.json').then(function (s) { return s ? removeShared(l, 'triage.json').then(function () { return null; }) : null; });
    });
  }
  function stampNow() { return R().stamp(folder.EDITION, folderOpts.version ? folderOpts.version() : null); }
  function descriptionsOf(l) {
    return get('descriptions', l.projectId).then(function (row) {
      var file = row && row.value ? folderOpts.toFile(row.value) : null;
      return { file: file, parts: file ? R().split(file) : [], describedAt: file && file.describedAt ? file.describedAt : null };
    });
  }
  var SOURCES = {
    'inbox/': function (l) { return folder.ensureDir(rootOf(l, 'inbox/'), 'inbox/'); },
    'README.md': function (l) {
      // Layout 2: README.md, AGENTS.md, GUIDE.md and GUIDE.html — the same text for every project, stamped with the MxScout
      // that wrote it and replaced only by a newer one (a teammate's older MxScout never downgrades them);
      // .gitignore only when it is missing.
      if (isRepo(l)) {
        var st = stampNow();
        // The guide twice: GUIDE.md, and GUIDE.html, the same guide as one page — { md, html }, either may be missing.
        return Promise.resolve(folderOpts.guide ? folderOpts.guide() : null).catch(function () { return null; }).then(function (g) {
          g = g || {};
          var files = [['README.md', R().readme(st)], ['AGENTS.md', R().agents(st)]]
            .concat(g.md ? [['GUIDE.md', R().guide(g.md, st)]] : [], g.html ? [['GUIDE.html', R().guideHtml(g.html, st)]] : []);
          return files.reduce(function (p, f) {
            return p.then(function () { return folder.readFile(l.handle, f[0]).then(function (r) { return !r || R().newer(st, r.text) ? writeShared(l, f[0], f[1]) : null; }); });
          }, Promise.resolve()).then(function () { return folder.stat(l.handle, '.gitignore'); })
            .then(function (s) { return s ? null : writeShared(l, '.gitignore', R().gitignore()); });
        }).then(function () { return null; });
      }
      return get('projects', l.projectId).then(function (p) { return p ? folder.write(l.handle, 'README.md', folder.readme(p)) : null; });
    },
    'project.json': function (l) {
      if (isRepo(l)) {
        return sharedGate(l, function () {
          return Promise.all([get('projects', l.projectId), descriptionsOf(l)]).then(function (b) {
            return b[0] ? writeShared(l, 'mxscout.json', R().projectJson(b[0], b[1].describedAt)).then(function () { return null; }) : null;
          });
        });
      }
      return Promise.all([get('projects', l.projectId), get('descriptions', l.projectId)]).then(function (b) {
        if (!b[0]) return null;
        var text = folder.projectJson(b[0], b[1], folderOpts.version ? folderOpts.version() : null);
        return folder.write(l.handle, 'project.json', text).then(function (at) { l.lastText['project.json'] = text; return at; });
      });
    },
    'model.json': function (l) { return getModel(l.projectId).then(function (m) { return m ? folder.writeJson(rootOf(l, 'model.json'), 'model.json', m) : null; }); },
    'descriptions.json': function (l) {
      // Layout 2: the descriptions split into small files (repodocs.js); a file whose text did not change is
      // not touched, and one MxScout wrote or read that the descriptions no longer have is removed.
      if (isRepo(l)) {
        return sharedGate(l, function () {
          return descriptionsOf(l).then(function (d) {
            var now = {};
            d.parts.forEach(function (p) { now[p.path] = true; });
            var gone = Object.keys(l.wrote).filter(function (p) { return /^descriptions\//.test(p) && !now[p]; });
            return d.parts.reduce(function (p, f) { return p.then(function () { return writeShared(l, f.path, f.text); }); }, Promise.resolve())
              .then(function () { return gone.reduce(function (p, path) { return p.then(function () { return removeShared(l, path); }); }, Promise.resolve()); })
              .then(function () { return null; });
          });
        });
      }
      return get('descriptions', l.projectId).then(function (row) {
        return row && row.value ? folder.write(l.handle, 'descriptions.json', JSON.stringify(folderOpts.toFile(row.value), null, 2) + '\n') : folder.remove(l.handle, 'descriptions.json');
      });
    },
    // Layout 2, and only when the person chose it (l.skills, or the Update button once): the Claude skills
    // that ship with this MxScout (folderOpts.skills: /api/skills), into the Mendix project's own
    // .claude/skills/mendix-describe/ and .claude/skills/mendix-assist/ — the one place outside mxscout/ it
    // writes, through the Mendix project's handle, and nothing else in .claude/. A skill is written only when
    // this copy is newer than the one there (its VERSION); a file an older copy listed and this one does not
    // have is removed, never another. Read either way, so the Folder tab can say what the project has.
    'skills/': function (l) {
      if (!isRepo(l) || !l.repo || !folderOpts.skills) return Promise.resolve(null);
      var st = stampNow(), write = l.skills || l.skillsOnce;
      l.skillsOnce = false;
      var D = R().SKILLS_DIR;
      return R().SKILLS.reduce(function (p, name) {
        return p.then(function () {
          return folder.readFile(l.repo, D + name + '/VERSION').then(function (v) {
            var there = v ? v.text : null;
            if (!write || !R().newer(st, there)) { l.skillsSeen[name] = { stamp: there ? there.split('\n')[0] : null, wrote: false, mine: st }; return null; }
            return Promise.resolve(folderOpts.skills()).then(function (bundle) {
              var skill = (bundle && bundle.skills || []).filter(function (x) { return x.name === name; })[0];
              if (!skill) throw new Error('this MxScout has no ' + name + ' skill to write.');
              var now = {};
              skill.files.forEach(function (f) { now[f.path] = true; });
              var gone = R().skillFiles(there).filter(function (f) { return !now[f]; });
              return skill.files.reduce(function (q, f) {
                return q.then(function () {
                  return folder.readFile(l.repo, D + name + '/' + f.path).then(function (r) { return r && r.text === f.text ? null : folder.write(l.repo, D + name + '/' + f.path, f.text); });
                });
              }, Promise.resolve()).then(function () {
                return gone.reduce(function (q, f) { return q.then(function () { return folder.remove(l.repo, D + name + '/' + f); }); }, Promise.resolve());
              }).then(function () { return folder.write(l.repo, D + name + '/VERSION', R().skillVersion(name, st, skill.files.map(function (f) { return f.path; }))); })
                .then(function () { l.skillsSeen[name] = { stamp: st, wrote: true, mine: st }; });
            });
          });
        });
      }, Promise.resolve()).then(function () { return null; });
    },
    // The solved cases (knowledge.js toFiles), one note per file in knowledge/ — in both layouts, and inside the
    // Mendix project they are shared, committed. A note is written when its text is not what the file holds; one
    // MxScout wrote or read that the project no longer keeps (an Undo, a note removed in a pull) is removed — never another.
    'knowledge/': function (l) {
      if (!folderOpts.knowledgeFiles) return Promise.resolve(null);
      function work() {
        return get('knowledge', l.projectId).then(function (row) {
          var files = folderOpts.knowledgeFiles(row ? row.files : []), now = {};
          files.forEach(function (f) { now[f.path] = true; });
          var gone = Object.keys(l.wrote).filter(function (p) { return CASE.test(p) && !now[p]; });
          return files.reduce(function (p, f) { return p.then(function () { return writeCase(l, f.path, f.text); }); }, Promise.resolve())
            .then(function () { return gone.reduce(function (p, path) { return p.then(function () { return removeCase(l, path); }); }, Promise.resolve()); })
            .then(function () { return null; });
        });
      }
      return isRepo(l) ? sharedGate(l, work) : work();
    },
    // Layout 2: docs/, made by docs.js (folderOpts.repoDocs) from the model and the descriptions — only when the
    // descriptions — and the solved cases, which index.md and the manifest list — are not the ones docs/manifest.json
    // says it was made from. Reading the model again after a pull never writes it. A file it had that is not made any more is removed; with no descriptions, docs/ goes.
    'docs/': function (l) {
      if (!isRepo(l) || !folderOpts.repoDocs) return Promise.resolve(null);
      return sharedGate(l, function () {
        return Promise.all([descriptionsOf(l), folder.readFile(l.handle, 'docs/manifest.json'), get('knowledge', l.projectId)]).then(function (b) {
          var d = b[0], man = null, cases = folderOpts.knowledgeFiles && b[2] ? folderOpts.knowledgeFiles(b[2].files) : [];
          try { man = b[1] ? JSON.parse(b[1].text) : null; } catch (e) { man = null; }
          // What docs/ held: the files its manifest lists and the ones MxScout wrote — or, with a manifest git
          // left in conflict, every Markdown file in it.
          var had = (man && Array.isArray(man.files) ? man.files.map(function (f) { return String(f.path || ''); }) : [])
            .concat(Object.keys(l.wrote)).filter(function (p, i, all) { return /^docs\/[^/.][^\u0000]*\.(md|json)$/.test(p) && p.indexOf('..') === -1 && all.indexOf(p) === i; });
          function drop(paths) { return paths.reduce(function (p, path) { return p.then(function () { return removeShared(l, path); }); }, Promise.resolve()); }
          var listed = b[1] && !man ? folder.listAll(l.handle, 'docs', /\.md$/i).then(function (list) { list.forEach(function (x) { if (had.indexOf(x.path) === -1) had.push(x.path); }); }) : Promise.resolve();
          return listed.then(function () {
          if (!d.file) return b[1] ? drop(had.filter(function (p) { return p !== 'docs/manifest.json'; }).concat(['docs/manifest.json'])).then(function () { return null; }) : null;
          // With Developer tools on, MxScout draws the documentation with what was decided about the risks and the comments
          // raised as risks: docs/ follows those too.
          return devParts(l).then(function (extra) { return R().descriptionsHash(d.parts.concat(extra, cases), d.describedAt); }).then(function (hash) {
            if (man && man.descriptions === hash) return null;
            return folderOpts.repoDocs(l.projectId, hash).then(function (files) {
              var now = {};
              files.forEach(function (f) { now[f.path] = true; });
              return files.reduce(function (p, f) { return p.then(function () { return writeShared(l, f.path, f.text); }); }, Promise.resolve())
                .then(function () { return drop(had.filter(function (p) { return !now[p]; })); })
                .then(function () { return null; });
            });
          });
          });
        });
      });
    },
    // The Assist items, one file per item (folderOpts.assistFiles: assist.js toFiles): a file is written
    // when its text changed. A file is removed only when the record says its item was taken out on purpose
    // (an Undo — files.gone), and only one MxScout wrote or read: an item that is simply not in the record
    // never loses its file (B07: a limit that dropped items used to take their files with them).
    'assist/': function (l) {
      if (!folderOpts.assistFiles) return Promise.resolve(null);
      return get('assist', l.projectId).then(function (row) {
        var files = folderOpts.assistFiles(row ? row.items : [], row ? row.removed : []), now = {}, out = {};
        var root = rootOf(l, 'assist/'), pre = wk(l, 'assist/').slice(0, -'assist/'.length);
        files.forEach(function (f) { now[pre + f.path] = true; });
        (files.gone || []).forEach(function (p) { out[pre + p] = true; });
        var gone = Object.keys(l.wrote).filter(function (p) { return out[p] && !now[p]; });
        var chain = files.filter(function (f) { return l.lastText[pre + f.path] !== f.text; }).reduce(function (p, f) {
          return p.then(function () { return folder.write(root, f.path, f.text).then(function (at) { l.wrote[pre + f.path] = at; l.lastText[pre + f.path] = f.text; }); });
        }, Promise.resolve());
        return gone.reduce(function (p, path) {
          return p.then(function () { return folder.remove(root, path.slice(pre.length)).then(function () { delete l.wrote[path]; delete l.lastText[path]; }); });
        }, chain).then(function () { return Date.now(); });
      });
    }
  };
  function writeOne(l, f) {
    if (SOURCES[f]) return SOURCES[f](l);
    // Developer tools' comments.json and triage.json: the text made by the app (comments.js, triage.js
    // serialize — the same whitelists a package uses), null when there is nothing to keep.
    if (folderOpts.files && folderOpts.files[f]) {
      // Inside the Mendix project both are the team's, committed: triage.json whole, the comments one file
      // each in comments/ (two reviewers adding comments never touch the same file), written only when changed.
      if (isRepo(l)) return sharedGate(l, function () { return f === 'comments.json' ? writeComments(l) : writeTriage(l); });
      return Promise.resolve(folderOpts.files[f](l.projectId)).then(function (text) {
        return text == null ? folder.remove(l.handle, f) : folder.write(l.handle, f, text);
      });
    }
    if (l.derived[f] == null) return Promise.resolve(null);
    var text = l.derived[f];
    return folder.write(rootOf(l, f), f, text).then(function (at) {
      l.lastText[f] = text;
      if (l.derived[f] === text) delete l.derived[f];
      return at;
    });
  }

  function schedule(l) {
    if (l.timer) return;
    l.timer = setTimeout(function () { l.timer = null; flush(l); }, 40);
  }
  // Every pending file, in order, one at a time. A failure stops the rest — they stay pending —
  // and says so (status); the database already holds all of it.
  function flush(l) {
    if (!folder || l.status !== 'connected') return Promise.resolve(false);
    if (l.busy) { l.again = true; return l.busy; }
    var files = Object.keys(l.pending).sort(function (a, b) { return (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99); });
    if (!files.length) return Promise.resolve(true);
    files.forEach(function (f) { delete l.pending[f]; });
    var failed = null;
    var chain = files.reduce(function (p, f) {
      return p.then(function () {
        if (failed) { l.pending[f] = true; return null; }
        return writeOne(l, f).then(function (at) {
          if (at === HOLD) { l.pending[f] = true; return; }
          if (at != null) l.wrote[wk(l, f)] = at;
          l.lastWriteAt = Date.now();
        }, function (err) { failed = err; l.pending[f] = true; });
      });
    }, Promise.resolve());
    l.busy = chain.then(function () {
      l.busy = null;
      saveLinkSoon(l);
      if (failed) { setStatus(l, statusOf(failed), failed); return false; }
      tell(l, 'written');
      // Someone else's newer shared files: taken in first (refreshFolder), then what waited is written.
      if (l.refresh) { l.refresh = false; refreshFolder(l.projectId); return true; }
      if (l.again || (Object.keys(l.pending).length && !l.conflicts.length)) { l.again = false; schedule(l); }
      return true;
    });
    return l.busy;
  }

  function mirror(id, files) {
    var l = links[id];
    if (!l || !folder) return;
    files.forEach(function (f) { if (f !== 'docs/' || isRepo(l)) l.pending[f] = true; });
    if (l.status === 'connected') schedule(l);
    else {
      saveLinkSoon(l);
      // Not checked yet in this visit (a project not open): checked, without asking for anything, before it is written.
      if (l.status === 'unknown') syncFolder(id, false);
      else tell(l, 'pending');
    }
  }
  function mirrorPut(storeName, value) {
    if (!value) return;
    if (storeName === 'projects') mirror(value.id, ['project.json']);
    else if (storeName === 'descriptions') mirror(value.projectId, ['descriptions.json', 'project.json', 'docs/']);
    // Developer tools' own two: the comments (one record each) and what was decided about the risks —
    // inside the Mendix project the documentation is drawn with both, so docs/ is checked too.
    else if (storeName === 'findings') mirror(value.projectId, ['comments.json', 'docs/']);
    else if (storeName === 'knowledge') mirror(value.projectId, ['knowledge/', 'docs/']);
    else if (storeName === 'triage') mirror(value.projectId, ['triage.json', 'docs/']);
    else if (storeName === 'assist') mirror(value.projectId, ['assist/']);
  }
  function mirrorDelete(storeName, key) {
    if (storeName === 'descriptions') mirror(key, ['descriptions.json', 'project.json', 'docs/']);
    else if (storeName === 'triage') mirror(key, ['triage.json', 'docs/']);
    else if (storeName === 'assist') mirror(key, ['assist/']);
    else if (storeName === 'knowledge') mirror(key, ['knowledge/', 'docs/']);
    // A comment is deleted by its own id: which project it was in is not known here, so every
    // project kept in a folder writes its comments.json again — a small file.
    else if (storeName === 'findings') Object.keys(links).forEach(function (id) { mirror(id, ['comments.json', 'docs/']); });
  }

  // documentation.md and ai-pack.md, handed in by docs.js: written when their text changed.
  function folderDerived(id, file, text) {
    var l = links[id];
    if (!l || text == null || l.lastText[file] === text || l.derived[file] === text) return;
    l.derived[file] = text;
    mirror(id, [file]);
  }

  // Back in touch with a project's folder: permission (asked for only with ask — that needs a
  // click), the folder still there, what changed in it handed to the app (folderOpts.adopt) BEFORE
  // anything is written, and then everything pending written. Resolves with the folder's state.
  function syncFolder(id, ask) {
    var l = links[id];
    if (!l || !folder) return Promise.resolve(null);
    if (l.syncing && !ask) return l.syncing;
    l.syncing = folder.permission(l.repo || l.handle, ask).then(function (p) {
      // Kept in its Mendix project with the MxScout folder set: that folder's permission too, asked in the same click.
      return p === 'granted' && isRepo(l) && home ? folder.permission(home, ask) : p;
    }).then(function (p) {
      if (p !== 'granted') { setStatus(l, 'needs-permission'); return null; }
      return folder.exists(l.handle).then(function (yes) {
        if (!yes) { setStatus(l, 'missing'); return null; }
        setStatus(l, 'checking');
        return localDir(l).then(function () { return folderChanges(l); }).then(function (changed) {
          return Object.keys(changed).length && folderOpts.adopt ? Promise.resolve(folderOpts.adopt(id, changed)).catch(function () {}) : null;
        }).then(function () {
          // Layout 2: the model read again from the .mpr beside when it changed (the app does it: repoui.js),
          // before anything is written — docs/ never follows it, but documentation.md and ai-pack.md do.
          return isRepo(l) && folderOpts.reread ? Promise.resolve(folderOpts.reread(id)).catch(function () {}) : null;
        }).then(function () { return folder.stat(l.handle, 'README.md'); }).then(function (readmeThere) {
          l.pending['inbox/'] = true;
          l.pending['knowledge/'] = true;
          if (!readmeThere || isRepo(l)) l.pending['README.md'] = true;
          if (isRepo(l)) { l.pending['docs/'] = true; l.pending['skills/'] = true; }
          if (links[id] !== l) return null;
          setStatus(l, 'connected');
          return flush(l);
        });
      });
    }).catch(function (err) { setStatus(l, statusOf(err), err); return null; })
      .then(function () { l.syncing = null; return infoOf(l); });
    return l.syncing;
  }

  // The files someone else wrote since MxScout last did: { 'model.json': text, … }. A file that is
  // newer here wins over what was pending for it.
  // The Assist items' files come as one entry, 'assist/': [{ path, text }] — each one newer than
  // MxScout's own last write of it.
  function folderChanges(l) {
    var names = isRepo(l) ? [] : ['project.json', 'model.json', 'descriptions.json', 'comments.json', 'triage.json'];
    var out = {};
    var root = rootOf(l, 'assist/');
    var assist = folder.assistFiles ? folder.assistFiles(root).then(function (list) {
      return Promise.all(list.filter(function (s) { return !(l.wrote[wk(l, s.path)] && s.lastModified <= l.wrote[wk(l, s.path)]); }).map(function (s) {
        return folder.readFile(root, s.path).then(function (r) {
          if (!r) return;
          (out['assist/'] = out['assist/'] || []).push({ path: s.path, text: r.text });
          l.wrote[wk(l, s.path)] = r.lastModified;
          l.lastText[wk(l, s.path)] = r.text;
        });
      }));
    }) : null;
    var shared = isRepo(l) ? repoChanges(l, out) : null;
    return Promise.all([assist, shared, knowledgeChanges(l, out)].concat(names.map(function (f) {
      return folder.stat(l.handle, f).then(function (s) {
        if (!s || (l.wrote[f] && s.lastModified <= l.wrote[f])) return null;
        return folder.readFile(l.handle, f).then(function (r) {
          if (!r) return;
          if (f === 'project.json') { out.projectBase = baseOf(l, 'project.json'); l.lastText[f] = r.text; }
          out[f] = r.text;
          l.wrote[f] = r.lastModified;
          if (f !== 'project.json') delete l.pending[f];
        });
      });
    }))).then(function () { saveLinkSoon(l); return out; });
  }

  // Layout 2: what someone else changed in mxscout/ — mxscout.json and descriptions/ — since MxScout last
  // wrote or read it, read whole: { 'project.json': mxscout.json's text, 'descriptions.json': the descriptions
  // joined back into one file (repodocs.js join), or null when there are none }. A JSON file with git's
  // conflict markers stops it: l.conflicts says which, and nothing shared is taken (or written) until it is gone.
  function repoChanges(l, out) {
    return sharedMoved(l).then(function (moved) {
      if (!moved && !l.conflicts.length) return null;
      return Promise.all([folder.readFile(l.handle, 'mxscout.json'), folder.listAll(l.handle, 'descriptions'), folder.readFile(l.handle, 'triage.json'), folder.listAll(l.handle, 'comments')]).then(function (b) {
        var mx = b[0], tri = b[2];
        var read = function (list) { return Promise.all(list.map(function (s) { return folder.readFile(l.handle, s.path).then(function (r) { return r ? { path: s.path, text: r.text, lastModified: r.lastModified } : null; }); })); };
        return Promise.all([read(b[1]), read(b[3])]).then(function (both) { var comments = both[1].filter(Boolean); return { files: both[0], comments: comments }; })
          .then(function (got) {
            var files = got.files.filter(Boolean), comments = got.comments;
            var all = (mx ? [{ path: 'mxscout.json', text: mx.text, lastModified: mx.lastModified }] : []).concat(files)
              .concat(tri ? [{ path: 'triage.json', text: tri.text, lastModified: tri.lastModified }] : []).concat(comments);
            var was = l.conflicts.map(function (c) { return c.path; }).join('\n');
            l.conflicts = all.filter(function (f) { return R().conflicted(f.text); }).map(function (f) { return { path: f.path, text: f.text }; });
            if (l.conflicts.length) { if (l.conflicts.map(function (c) { return c.path; }).join('\n') !== was) tell(l, 'conflict'); return null; }
            if (was) tell(l, 'resolved');
            var known = {};
            if (mx) out.projectBase = baseOf(l, 'mxscout.json');
            all.forEach(function (f) { known[f.path] = true; l.wrote[f.path] = f.lastModified; l.lastText[f.path] = f.text; });
            // A comment file MxScout wrote or read that is gone from disk was deleted by someone (a pull): said to the
            // app as comments-removed — with the text it last had, so a comment changed here since is kept, not lost.
            var gone = [];
            Object.keys(l.wrote).forEach(function (p) {
              if (!/^(descriptions|comments)\//.test(p) || known[p]) return;
              if (/^comments\//.test(p)) gone.push({ path: p, text: l.lastText[p] == null ? null : l.lastText[p], at: l.wrote[p] });
              delete l.wrote[p]; delete l.lastText[p];
            });
            if (gone.length) out['comments-removed'] = gone;
            // Developer tools: what was decided about the risks, and the comments — merged into this browser's by
            // their own rules (folderui.js): per risk and per comment id, the newest winning.
            if (tri) out['triage.json'] = tri.text;
            if (comments.length) {
              var list = [];
              comments.forEach(function (c) { try { list.push(JSON.parse(c.text)); } catch (e) { out.repoError = c.path + ' is not valid JSON'; } });
              out['comments.json'] = JSON.stringify({ format: 'mxscout-comments', version: 1, comments: list });
            }
            var pj = null;
            try { pj = mx ? JSON.parse(mx.text) : null; } catch (e) { pj = null; }
            if (mx) out['project.json'] = mx.text;
            var joined = R().join(files, pj && pj.describedAt ? pj.describedAt : null);
            if (joined.error) { out.repoError = joined.error; return null; }
            if (joined.value) out['descriptions.json'] = JSON.stringify(joined.value, null, 2) + '\n';
            return null;
          });
      });
    });
  }

  // The solved cases someone else wrote, changed or removed in knowledge/ since MxScout last wrote or read
  // them: out['knowledge/'] = { files: [{ path, text }], removed: [paths] }. A file with git's conflict markers
  // is read too — knowledge.js leaves it alone, and writeCase never writes over it.
  function knowledgeChanges(l, out) {
    if (!folderOpts.knowledgeFiles) return null;
    return caseList(l).then(function (list) {
      var on = {}, files = [];
      list.forEach(function (s) { on[s.path] = true; });
      var removed = Object.keys(l.wrote).filter(function (p) { return CASE.test(p) && !on[p]; });
      removed.forEach(function (p) { delete l.wrote[p]; delete l.lastText[p]; });
      return Promise.all(list.filter(function (s) { return !(l.wrote[s.path] && s.lastModified <= l.wrote[s.path]); }).map(function (s) {
        return folder.readFile(l.handle, s.path).then(function (r) {
          if (!r) return;
          files.push({ path: s.path, text: r.text });
          l.wrote[s.path] = r.lastModified;
          l.lastText[s.path] = r.text;
        });
      })).then(function () { if (files.length || removed.length) out['knowledge/'] = { files: files, removed: removed }; });
    });
  }

  // While a layout-2 project is open, someone else's newer shared files (an agent writing descriptions/
  // directly, a git pull) are taken in within a tick: what changed, handed to the app, then what waits written.
  function refreshFolder(id) {
    var l = links[id];
    if (!l || !folder || !isRepo(l) || l.status !== 'connected' || l.syncing || l.refreshing) return Promise.resolve(null);
    l.refreshing = folderChanges(l).then(function (changed) {
      return Object.keys(changed).length && folderOpts.adopt ? Promise.resolve(folderOpts.adopt(id, changed)).catch(function () {}) : null;
    }).then(function () { l.pending['docs/'] = true; return flush(l); })
      .catch(function (err) { setStatus(l, statusOf(err), err); })
      .then(function () { l.refreshing = null; return infoOf(l); });
    return l.refreshing;
  }

  // Layout 2: one side of a file with git's conflict markers, kept as the person chose — written over it, and
  // the folder read again (that file is newer now, so it is taken in).
  function resolveConflict(id, path, text) {
    var l = links[id];
    if (!l || !isRepo(l) || !l.conflicts.some(function (c) { return c.path === path; })) return Promise.reject(new Error('That file has no conflict to resolve.'));
    return folder.write(l.handle, path, text).then(function () {
      l.conflicts = l.conflicts.filter(function (c) { return c.path !== path; });
      delete l.wrote[path];
      return l.conflicts.length ? infoOf(l) : syncFolder(id, false);
    });
  }

  // Layout 2: which .mpr the model was last read from — { name, size, lastModified, commit } — kept with the link.
  function setRepoMpr(id, mpr) {
    var l = links[id];
    if (!l || !isRepo(l)) return Promise.resolve();
    l.mpr = mpr || null;
    return put('settings', recordOf(l));
  }
  // Layout 2: whether the Claude skills are kept in the Mendix project's .claude/skills/ (on: written now, when
  // this MxScout's copy is newer), and the Update button: written once now, by the same newer-only rule.
  function setRepoSkills(id, on) {
    var l = links[id];
    if (!l || !isRepo(l)) return Promise.resolve(null);
    l.skills = !!on;
    return put('settings', recordOf(l)).then(function () { if (on) { l.pending['skills/'] = true; return flush(l); } return null; }).then(function () { return infoOf(l); });
  }
  function updateSkills(id) {
    var l = links[id];
    if (!l || !isRepo(l)) return Promise.resolve(null);
    l.skillsOnce = true;
    l.pending['skills/'] = true;
    return flush(l).then(function () { return l.busy || null; }).then(function () { return infoOf(l); });
  }
  function repoHandle(id) { var l = links[id]; return l && isRepo(l) ? l.repo : null; }

  // Keep a project in a folder: every file is written there first, and only once all of them are on
  // disk is the project linked to it — a failure leaves the project as it was, in this browser.
  // opts.derived: { 'documentation.md': text, 'ai-pack.md': text } when the caller has them.
  // opts.repo: the Mendix project's directory — handle is then its mxscout/ (layout 2), and opts.mpr which .mpr was read.
  function linkFolder(id, handle, opts) {
    if (!folder) return Promise.reject(new Error('This browser cannot keep a project in a folder.'));
    opts = opts || {};
    var l = newLink(id, handle, { path: opts.path, layout: opts.repo ? 2 : 1, repo: opts.repo, mpr: opts.mpr, skills: opts.skills });
    l.status = 'connected';
    folder.CORE.forEach(function (f) { l.pending[f] = true; });
    l.pending['knowledge/'] = true;
    if (isRepo(l)) { l.pending['docs/'] = true; l.pending['skills/'] = true; }
    Object.keys(opts.derived || {}).forEach(function (f) { if (opts.derived[f] != null) { l.derived[f] = opts.derived[f]; l.pending[f] = true; } });
    // Quiet until it is linked: a failure here is the caller's to report, not a folder's status.
    l.quiet = true;
    return localDir(l).then(function () { return flush(l); }).then(function (ok) {
      l.quiet = false;
      if (!ok) throw new Error(l.error || 'The folder could not be written.');
      forgetLink(id);
      links[id] = l;
      return put('settings', recordOf(l));
    }, function (err) { l.quiet = false; throw err; }).then(function () { tell(l, 'linked'); return infoOf(l); });
  }

  // Link a project to a folder that already holds it (Open a project folder): nothing is written
  // first. opts.wrote: the dates of the files as read, so they do not count as newer; without it,
  // every file in the folder is newer, and the folder wins when the project is synced.
  // opts.repo: as for linkFolder — a project in mxscout/ a teammate committed; its files are all newer, and win.
  function openFolder(id, handle, opts) {
    opts = opts || {};
    forgetLink(id);
    var l = newLink(id, handle, { wrote: opts.wrote || {}, pending: (opts.pending || []).concat(opts.repo ? ['model.json', 'README.md'] : []), layout: opts.repo ? 2 : 1, repo: opts.repo, mpr: opts.mpr, skills: opts.skills });
    links[id] = l;
    return put('settings', recordOf(l)).then(function () { tell(l, 'linked'); return infoOf(l); });
  }

  // The project as its folder holds it, read and checked: { project (project.json), model, descriptions
  // (the text of descriptions.json, or null), wrote (each file's date) }. Rejects with a sentence.
  function readFolderProject(handle) {
    return folder.inspect(handle).then(function (what) {
      if (what.kind !== 'project') throw new Error('That folder does not hold an MxScout project — there is no project.json in it.' + (what.kind === 'other' ? ' Choose the folder MxScout wrote, the one with project.json, model.json and inbox/.' : ''));
      if (what.error) throw new Error('That folder is not an MxScout project MxScout can open: ' + what.error);
      return Promise.all(['model.json', 'descriptions.json', 'project.json'].map(function (f) { return folder.readFile(handle, f); }).concat([readAssist(handle)])).then(function (files) {
        if (!files[0]) throw new Error('That project folder has no model.json, so there is no model to open.');
        var model;
        try { model = JSON.parse(files[0].text); } catch (e) { throw new Error('model.json in that folder is not valid JSON.'); }
        if (!model || !Array.isArray(model.modules) || !Array.isArray(model.entities)) throw new Error('model.json in that folder is not a Mendix model.');
        var wrote = { 'model.json': files[0].lastModified, 'project.json': files[2].lastModified };
        if (files[1]) wrote['descriptions.json'] = files[1].lastModified;
        files[3].forEach(function (f) { wrote[f.path] = f.lastModified; });
        return { project: what.project, model: model, descriptions: files[1] ? files[1].text : null, assist: files[3].map(function (f) { return { path: f.path, text: f.text }; }), wrote: wrote, bytes: files[0].size };
      });
    });
  }

  // The Assist files a folder holds: [{ path, text, lastModified }].
  function readAssist(handle) {
    if (!folder.assistFiles) return Promise.resolve([]);
    return folder.assistFiles(handle).then(function (list) {
      return Promise.all(list.map(function (s) { return folder.readFile(handle, s.path).then(function (r) { return r ? { path: s.path, text: r.text, lastModified: r.lastModified } : null; }); }));
    }).then(function (l) { return l.filter(Boolean); });
  }

  // Stop keeping a project in its folder: the browser keeps it, the files stay on disk.
  function unlinkFolder(id) {
    forgetLink(id);
    return del('settings', linkKey(id));
  }
  function setFolderPath(id, path) {
    var l = links[id];
    if (!l) return Promise.resolve();
    l.path = String(path || '').slice(0, 1000);
    return put('settings', recordOf(l));
  }

  function needsFolderLink(id) { return !!links[id]; }
  // The projects kept in this very folder (one folder holds one project).
  function linkedTo(handle) {
    return Promise.all(Object.keys(links).map(function (id) {
      var h = links[id].handle;
      return h && h.isSameEntry ? h.isSameEntry(handle).then(function (same) { return same ? id : null; }, function () { return null; }) : null;
    })).then(function (ids) { return ids.filter(Boolean); });
  }

  // The inbox, while the project is open and its folder connected (docs.js polls it).
  function guarded(l, work) {
    return work.catch(function (err) { setStatus(l, statusOf(err), err); throw err; });
  }
  function folderInbox(id) { var l = links[id]; return l && l.status === 'connected' ? guarded(l, localDir(l).then(function (r) { return folder.inbox(r); })) : Promise.resolve([]); }
  function folderInboxRead(id, name) { var l = links[id]; return l ? guarded(l, localDir(l).then(function (r) { return folder.readFile(r, 'inbox/' + name); })) : Promise.resolve(null); }
  function folderInboxDone(id, name) { var l = links[id]; return l ? guarded(l, localDir(l).then(function (r) { return folder.done(r, name); })) : Promise.resolve(null); }

  window.MxStore = {
    open: open,
    getAll: getAll, get: get, put: put, update: update, putMany: putMany, delete: del, byIndex: byIndex, onOtherTab: onOtherTab,
    saveProjectWithModel: saveProjectWithModel,
    deleteProjectDeep: deleteProjectDeep,
    getModel: getModel,
    requestPersistence: requestPersistence,
    estimate: estimate,
    migrateFromLocalStorage: migrateFromLocalStorage,
    legacyActiveId: legacyActiveId,
    // the project's package key
    getPackageKey: getPackageKey, putPackageKey: putPackageKey, forgetPackageKey: forgetPackageKey, projectsWithPackageKey: projectsWithPackageKey,
    // the context put aside for a chat assistant
    getBasket: getBasket, changeBasket: changeBasket,
    // the project folder
    useFolder: useFolder, onFolder: onFolder, loadFolderLinks: loadFolderLinks, folderInfo: folderInfo, inHome: inHome,
    loadHome: loadHome, setHome: setHome, homeHandle: homeHandle, homeInfo: homeInfo, permissionHome: permissionHome,
    linkFolder: linkFolder, openFolder: openFolder, unlinkFolder: unlinkFolder, readFolderProject: readFolderProject,
    syncFolder: syncFolder, folderDerived: folderDerived, setFolderPath: setFolderPath, hasFolder: needsFolderLink, linkedTo: linkedTo,
    refreshFolder: refreshFolder, resolveConflict: resolveConflict, setRepoMpr: setRepoMpr, repoHandle: repoHandle, setRepoSkills: setRepoSkills, updateSkills: updateSkills,
    folderInbox: folderInbox, folderInboxRead: folderInboxRead, folderInboxDone: folderInboxDone
  };
})();
