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
 * Still true, and still the point: nothing here goes to disk and nothing goes
 * to the server. This is the browser's own storage on the user's own machine.
 */
(function () {
  'use strict';

  var DB_NAME = 'mxscout';
  var DB_VERSION = 1;

  // projects  — metadata only, so listing projects never parses a model
  // models    — one record per project, written at import and never again
  // findings  — one record PER COMMENT; this is the store that is hot
  // exports   — one record per export, each holding a snapshot of what was
  //             sent (see ROADMAP: this is what makes "not exported yet",
  //             the delivery history and "changed since you sent it" work)
  // settings  — small key/value pairs: the author identity, UI preferences
  var STORES = {
    projects: { keyPath: 'id', indexes: [] },
    models: { keyPath: 'projectId', indexes: [] },
    findings: { keyPath: 'id', indexes: [['byProject', 'projectId'], ['byUpdated', 'updatedAt']] },
    exports: { keyPath: 'id', indexes: [['byProject', 'projectId']] },
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
    }).then(function () { return value; });
  }

  function putMany(storeName, values) {
    if (!values.length) return Promise.resolve([]);
    return run([storeName], 'readwrite', function (store) {
      var os = store(storeName);
      values.forEach(function (v) { os.put(v); });
    }).then(function () { return values; });
  }

  function del(storeName, key) {
    return run([storeName], 'readwrite', function (store) {
      store(storeName).delete(key);
    });
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
  function saveProjectWithModel(project, model) {
    return run(['projects', 'models'], 'readwrite', function (store) {
      store('projects').put(project);
      store('models').put({ projectId: project.id, model: model });
    }).then(function () { return project; });
  }

  // Deleting a project takes its model, findings and export history with it,
  // in one transaction. Orphaned findings pointing at a project that no
  // longer exists would be invisible and permanent.
  function deleteProjectDeep(projectId) {
    return run(['projects', 'models', 'findings', 'exports'], 'readwrite', function (store) {
      store('projects').delete(projectId);
      store('models').delete(projectId);
      ['findings', 'exports'].forEach(function (name) {
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

  window.MxStore = {
    open: open,
    getAll: getAll, get: get, put: put, putMany: putMany, delete: del, byIndex: byIndex,
    saveProjectWithModel: saveProjectWithModel,
    deleteProjectDeep: deleteProjectDeep,
    getModel: getModel,
    requestPersistence: requestPersistence,
    estimate: estimate,
    migrateFromLocalStorage: migrateFromLocalStorage,
    legacyActiveId: legacyActiveId
  };
})();
