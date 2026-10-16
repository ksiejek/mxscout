/* MxScout — the project folder: the files a project is kept in on disk.
 *
 * A project can be kept in a folder the person picks (Karol, 2026-10-15: the
 * browser database alone made the project awkward and slow to reach, and an
 * agent could only read it while the agent channel ran). The BROWSER writes
 * that folder, through the File System Access API (showDirectoryPicker and the
 * FileSystemDirectoryHandle it hands back) — Chromium only. The server is not
 * involved: it still writes nothing to disk, and nothing here reaches it.
 *
 * This file is the folder as a backend, and nothing else: picking one, asking
 * for permission to write it, reading and writing its files, its inbox, and
 * what each file holds (the layout). WHEN a file is written is store.js's call
 * — every persistent read and write still goes through store.js, which keeps
 * the browser's own database as the copy MxScout always has and writes the
 * folder after it (write-through). Nobody else calls this file to write.
 *
 * The layout (LAYOUT 1), one folder per project:
 *   project.json       name, source, the model's version (git), settings, MxScout version, layout version
 *   model.json         the model as read from the .mpr
 *   descriptions.json  the descriptions, as a descriptions file (MxDescribe.toFile)
 *   assist/            the Assist items, one file per item: tickets/, jira/, ideas/, other/<id>.json (MxAssist.toFiles)
 *   documentation.md   the documentation as Markdown, what an agent reads first
 *   ai-pack.md         the AI pack — the evidence an agent checks it against
 *   knowledge/         the solved cases, one Markdown note per case (knowledge.js; repodocs.js reads them)
 *   inbox/             an agent drops a descriptions or an Assist file, or a solved case's note, here; MxScout takes it
 *   inbox/done/        where a taken file goes; the last KEEP_DONE are kept
 *   README.md          what each file is, for a person and an agent
 *   comments.json      (Developer tools) the comments on the model, as a package carries them
 *   triage.json        (Developer tools) what was decided about the risks
 *
 * A folder can be anywhere — beside the Mendix project, in a git repository —
 * and MxScout says nothing about where. The browser tells MxScout the folder's
 * name, never its path.
 *
 * LAYOUT 2 is the project kept inside the Mendix project's own directory, in
 * mxscout/ (repodocs.js says what each file holds; store.js decides when). The
 * same functions read and write it: store.js hands them mxscout/ for what the
 * team shares and mxscout/.local/ for what stays on this machine. inspectRepo
 * reads what a picked Mendix project holds: its .mpr, and its mxscout/.
 *
 * Tests cannot click a directory picker, so `test` below lets the suite hand
 * in a folder of the Origin Private File System instead, and simulate a lost
 * permission or a failing write. Nothing in the app sets it.
 */
(function () {
  'use strict';

  var FORMAT = 'mxscout-project';
  // The newest layout this MxScout reads: 1, a folder of its own (below), and 2, inside the Mendix
  // project's directory, in mxscout/ (repodocs.js). Each is written as what it is.
  var LAYOUT = 2;
  var EDITION = 'MxScout';
  var KEEP_DONE = 20;
  // Developer tools write two more: the comments and what was decided about the risks. A performance
  // recording stays in the browser — it came from a running application, and a folder in git is not
  // where that belongs.
  var CORE = ['project.json', 'model.json', 'descriptions.json', 'assist/', 'comments.json', 'triage.json', 'README.md', 'inbox/'];
  // The Assist items, one file per item (assist.js toFiles): assist/<folder>/<id>.json.
  var ASSIST_DIRS = ['tickets', 'jira', 'ideas', 'other'];
  var DERIVED = ['documentation.md', 'ai-pack.md'];

  // What each file is for — the Folder tab lists them with these words, and README.md says the same.
  var ROLES = [
    ['project.json', 'The project: its name, where the model came from and which version of the app it is (the Mendix project’s git commit), which version the descriptions describe, its settings — the language written content is in among them — the MxScout version and the layout version.'],
    ['model.json', 'The model as MxScout read it from the .mpr.'],
    ['descriptions.json', 'The descriptions — what an AI agent wrote, as a descriptions file. Edit it, or let an agent replace it: MxScout takes the newer one when the project is opened.'],
    ['documentation.md', 'The documentation as Markdown, with the descriptions and what is out of date. What an agent reads first, as the map.'],
    ['ai-pack.md', 'The AI pack: the model as text, one section per module, with an index of line ranges. The evidence — read by module, never whole.'],
    ['comments.json', 'The comments on the model — each with its author, severity and status, as a package carries them. Merged by id, the newest change winning, when it is read back.'],
    ['triage.json', 'What was decided about the risks: false positive, fixed, reopened, with the reason. Read back per risk, the latest decision winning.'],
    ['assist/', 'The Assist items — tickets, Jira issues, ideas and the workbook (larger pieces of work, other help), each with its status, notes and history — one file per item in assist/tickets/, jira/, ideas/ and other/ (the workbook). MxScout writes them; an agent reads them and hands changes back through inbox/. A newer file here wins when the project is opened.'],
    ['knowledge/', 'The solved cases: one Markdown note per ticket, Jira issue or idea an agent helped solve — the problem, its cause, the solution, what did not work — with front matter to search by. Written by the agent; no personal data.'],
    ['inbox/', 'Where an agent hands its results back: a descriptions file or an Assist file (*.json), or a solved case’s note (*.md), dropped here is taken by MxScout while the project is open, and moved to inbox/done/.']
  ];

  var test = { picker: null, permission: null, failWrites: null };

  function supported() { return !!test.picker || typeof window.showDirectoryPicker === 'function'; }

  function pick() {
    if (test.picker) return Promise.resolve(test.picker());
    return window.showDirectoryPicker({ id: 'mxscout-project', mode: 'readwrite' });
  }

  // 'granted', 'prompt' or 'denied'. Asking (ask: true) needs a click: Chrome asks the person again
  // after a browser restart, and only from inside a user gesture.
  function permission(handle, ask) {
    if (test.permission) {
      if (ask) { test.permission = null; return Promise.resolve('granted'); }
      return Promise.resolve(test.permission);
    }
    if (!handle || typeof handle.queryPermission !== 'function') return Promise.resolve('granted');
    var mode = { mode: 'readwrite' };
    return handle.queryPermission(mode).then(function (p) {
      return p === 'granted' || !ask ? p : handle.requestPermission(mode);
    });
  }

  // ---------- paths ----------
  function walk(root, path, create) {
    var parts = String(path).split('/');
    var name = parts.pop();
    var at = Promise.resolve(root);
    parts.forEach(function (seg) {
      if (seg) at = at.then(function (d) { return d.getDirectoryHandle(seg, { create: !!create }); });
    });
    return at.then(function (dir) { return { dir: dir, name: name }; });
  }
  function missing(err) { return err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError'); }

  // The folder itself is still there (a folder deleted or moved since it was picked throws NotFoundError).
  function exists(root) {
    return root.values().next().then(function () { return true; }, function (err) { if (missing(err)) return false; throw err; });
  }

  function stat(root, path) {
    return walk(root, path).then(function (w) { return w.dir.getFileHandle(w.name); })
      .then(function (fh) { return fh.getFile(); })
      .then(function (f) { return { lastModified: f.lastModified, size: f.size }; }, function (err) { if (missing(err)) return null; throw err; });
  }

  // A file's text, with CRLF read as LF. The folder may be in someone's git checkout, and git on Windows
  // (core.autocrlf=true) hands every text file back with CRLF: a JSON file does not mind, but a Markdown
  // file read line by line, a stamp on a first line or a list after "files:" does. One rule, here, for every
  // file MxScout reads from a folder — and a file it wrote compares equal to the same text read back.
  function readFile(root, path) {
    return walk(root, path).then(function (w) { return w.dir.getFileHandle(w.name); })
      .then(function (fh) { return fh.getFile(); })
      .then(function (f) { return f.text().then(function (text) { return { text: text.indexOf('\r') === -1 ? text : text.replace(/\r\n?/g, '\n'), lastModified: f.lastModified, size: f.size }; }); },
        function (err) { if (missing(err)) return null; throw err; });
  }

  function failing(root, path) {
    var f = test.failWrites;
    if (!f) return false;
    return f === true || String((root && root.name) + '/' + path).indexOf(f) !== -1;
  }
  function refused(path) { var e = new Error('Could not write ' + path + ' (a test made it fail).'); e.name = 'InvalidStateError'; return e; }

  // One file, whole. createWritable writes beside the file and swaps it in on close, so a reader —
  // an agent, git — sees the old file or the new one, never half of one. Resolves with the file's
  // lastModified after the write, which store.js keeps to tell its own writes from someone else's.
  function write(root, path, body) {
    if (failing(root, path)) return Promise.reject(refused(path));
    var fh;
    return walk(root, path, true).then(function (w) { return w.dir.getFileHandle(w.name, { create: true }); })
      .then(function (h) { fh = h; return h.createWritable(); })
      .then(function (w) {
        var done = typeof body === 'function' ? body(w) : w.write(body);
        return Promise.resolve(done).then(function () { return w.close(); }, function (err) { return w.abort().then(function () { throw err; }, function () { throw err; }); });
      })
      .then(function () { return fh.getFile(); })
      .then(function (f) { return f.lastModified; });
  }

  // A large value (a model is tens of megabytes) written in pieces: each long list a few hundred
  // items at a time, with a pause between, so the page is never held up and no single string of the
  // whole model is made. The text is exactly what JSON.stringify would give.
  var BATCH = 300;
  function piece(v) { var s = JSON.stringify(v); return s === undefined ? 'null' : s; }
  function writeJson(root, path, value) {
    return write(root, path, function (w) {
      var keys = Object.keys(value || {}).filter(function (k) { var v = value[k]; return v !== undefined && typeof v !== 'function'; });
      var i = 0;
      function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }
      function list(arr) {
        var at = 0;
        function more() {
          if (at >= arr.length) return w.write(']');
          var part = arr.slice(at, at + BATCH).map(piece).join(',');
          var lead = at ? ',' : '';
          at += BATCH;
          return w.write(lead + part).then(pause).then(more);
        }
        return w.write('[').then(more);
      }
      function next() {
        if (i >= keys.length) return w.write('}');
        var k = keys[i], v = value[k];
        var head = (i ? ',' : '') + JSON.stringify(k) + ':';
        i++;
        if (Array.isArray(v) && v.length > BATCH) return w.write(head).then(function () { return list(v); }).then(next);
        return w.write(head + piece(v)).then(next);
      }
      return w.write('{').then(next);
    });
  }

  function ensureDir(root, path) {
    if (failing(root, path)) return Promise.reject(refused(path));
    return walk(root, path.replace(/\/$/, '') + '/x', true).then(function () { return Date.now(); });
  }

  function remove(root, path) {
    if (failing(root, path)) return Promise.reject(refused(path));
    return walk(root, path).then(function (w) { return w.dir.removeEntry(w.name); })
      .then(function () { return Date.now(); }, function (err) { if (missing(err)) return Date.now(); throw err; });
  }

  function entries(dir) {
    var it = dir.values(), out = [];
    function next() { return it.next().then(function (r) { if (r.done) return out; out.push(r.value); return next(); }); }
    return next();
  }

  // The *.json files in one folder of the project's (assist/tickets …): [{ path, name, lastModified, size }], [] when it is not there.
  function list(root, path) {
    var at = Promise.resolve(root);
    String(path).split('/').filter(Boolean).forEach(function (seg) { at = at.then(function (d) { return d.getDirectoryHandle(seg, { create: false }); }); });
    return at.then(function (dir) {
      return entries(dir).then(function (hs) {
        return Promise.all(hs.filter(function (h) { return h.kind === 'file' && h.name.charAt(0) !== '.' && /\.json$/i.test(h.name); }).map(function (h) {
          return h.getFile().then(function (f) { return { path: path.replace(/\/$/, '') + '/' + h.name, name: h.name, lastModified: f.lastModified, size: f.size }; }, function () { return null; });
        }));
      });
    }, function (err) { if (missing(err)) return []; throw err; }).then(function (l) { return l.filter(Boolean); });
  }
  // Every *.json — or, with `re`, every file whose name matches — under one folder of the project's, at
  // any depth: [{ path, name, lastModified, size }] sorted by path, [] when the folder is not there.
  function listAll(root, path, re) {
    re = re || /\.json$/i;
    var out = [];
    function walkDir(dir, at) {
      return entries(dir).then(function (hs) {
        return Promise.all(hs.filter(function (h) { return h.name.charAt(0) !== '.'; }).map(function (h) {
          var p = at + '/' + h.name;
          if (h.kind === 'directory') return walkDir(h, p);
          if (!re.test(h.name)) return null;
          return h.getFile().then(function (f) { out.push({ path: p, name: h.name, lastModified: f.lastModified, size: f.size }); }, function () {});
        }));
      });
    }
    var at = Promise.resolve(root);
    String(path).split('/').filter(Boolean).forEach(function (seg) { at = at.then(function (d) { return d.getDirectoryHandle(seg, { create: false }); }); });
    return at.then(function (dir) { return walkDir(dir, String(path).replace(/\/$/, '')); }, function (err) { if (missing(err)) return null; throw err; })
      .then(function () { return out.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }); });
  }

  // Every Assist file in the project's folder.
  function assistFiles(root) {
    return Promise.all(ASSIST_DIRS.map(function (d) { return list(root, 'assist/' + d); })).then(function (all) { return [].concat.apply([], all); });
  }

  // ---------- what a picked folder holds ----------
  // 'empty' (nothing, or only hidden files such as .git), 'project' (an MxScout project.json, valid
  // or not — `error` says what is wrong with it) or 'other' (files that are not MxScout's).
  function inspect(root) {
    return entries(root).then(function (list) {
      var seen = list.filter(function (h) { return h.name.charAt(0) !== '.'; });
      var pj = list.filter(function (h) { return h.kind === 'file' && h.name === 'project.json'; })[0];
      if (!pj) return { kind: seen.length ? 'other' : 'empty', names: seen.map(function (h) { return h.name; }) };
      return pj.getFile().then(function (f) { return f.text(); }).then(function (text) {
        var parsed = parseProject(text);
        return { kind: 'project', project: parsed.value, error: parsed.error, names: seen.map(function (h) { return h.name; }) };
      });
    });
  }

  // A Mendix project's directory, as picked: its one .mpr at the top, and the mxscout/ folder in it with
  // what its mxscout.json says (repodocs.js, layout 2) — { mpr, mxscout: handle|null, project, error, conflict }.
  function inspectRepo(root) {
    return entries(root).then(function (list) {
      var mprs = list.filter(function (h) { return h.kind === 'file' && /\.mpr$/i.test(h.name); });
      var dir = list.filter(function (h) { return h.kind === 'directory' && h.name === 'mxscout'; })[0] || null;
      var out = { mpr: mprs.length === 1 ? mprs[0].name : null, mprs: mprs.length, mxscout: dir, project: null, error: null, conflict: false };
      if (!dir) return out;
      return readFile(dir, 'mxscout.json').then(function (f) {
        if (!f) return out;
        if (window.MxRepoDocs && window.MxRepoDocs.conflicted(f.text)) { out.conflict = true; out.error = 'its mxscout/mxscout.json has a git conflict — resolve it in git first.'; return out; }
        var parsed = parseProject(f.text);
        out.project = parsed.value || null;
        out.error = parsed.error ? parsed.error.replace(/project\.json/g, 'mxscout/mxscout.json') : parsed.value && parsed.value.layout !== 2 ? 'its mxscout/mxscout.json is not a project kept in the Mendix project (layout 2).' : null;
        if (out.error) out.project = null;
        return out;
      });
    });
  }

  function parseProject(text) {
    var v;
    try { v = JSON.parse(text); } catch (e) { return { error: 'its project.json is not valid JSON.' }; }
    if (!v || typeof v !== 'object' || v.format !== FORMAT) return { error: 'its project.json is not an MxScout project file.' };
    // The local part of a project kept in its Mendix project (store.js localDir, in the MxScout folder): known by its id, not a project to open.
    if (v.part === 'local' && typeof v.id === 'string' && v.id) return { value: v };
    if (typeof v.layout !== 'number' || v.layout < 1) return { error: 'its project.json has no layout version.' };
    if (v.layout > LAYOUT) return { error: 'it was written by a newer MxScout (layout ' + v.layout + '; this one reads up to ' + LAYOUT + '). Update MxScout to open it.' };
    if (typeof v.id !== 'string' || !v.id || typeof v.name !== 'string') return { error: 'its project.json has no project id or name.' };
    return { value: v };
  }

  // ---------- the inbox ----------
  // The files an agent left, oldest first: *.json (descriptions, Assist items, solved cases) and *.md (a
  // solved case's note). A hidden file (agent.js writes ".name.tmp" and renames it) and anything else are not offered.
  function inbox(root) {
    return root.getDirectoryHandle('inbox', { create: false }).then(function (dir) {
      return entries(dir).then(function (list) {
        var files = list.filter(function (h) { return h.kind === 'file' && h.name.charAt(0) !== '.' && /\.(json|md)$/i.test(h.name); });
        return Promise.all(files.map(function (h) {
          return h.getFile().then(function (f) { return { name: h.name, lastModified: f.lastModified, size: f.size }; }, function () { return null; });
        }));
      });
    }, function (err) { if (missing(err)) return []; throw err; }).then(function (list) {
      return list.filter(Boolean).sort(function (a, b) { return a.lastModified - b.lastModified || (a.name < b.name ? -1 : 1); });
    });
  }

  // A taken file goes to inbox/done/ under its own name (a number added when that name is there),
  // and only the newest KEEP_DONE stay there.
  function done(root, name) {
    var path = 'inbox/' + name;
    return readFile(root, path).then(function (f) {
      if (!f) return null;
      return root.getDirectoryHandle('inbox', { create: true }).then(function (ib) { return ib.getDirectoryHandle('done', { create: true }); })
        .then(function (dir) {
          return entries(dir).then(function (list) {
            var have = {};
            list.forEach(function (h) { have[h.name] = true; });
            var to = name, n = 2;
            while (have[to]) to = name.replace(/(\.json|\.md)?$/i, '-' + (n++) + '$1');
            return write(root, 'inbox/done/' + to, f.text).then(function () { return remove(root, path); })
              .then(function () { return prune(dir); }).then(function () { return to; });
          });
        });
    });
  }
  function prune(dir) {
    return entries(dir).then(function (list) {
      var files = list.filter(function (h) { return h.kind === 'file'; });
      if (files.length <= KEEP_DONE) return null;
      return Promise.all(files.map(function (h) { return h.getFile().then(function (f) { return { name: h.name, at: f.lastModified }; }); }))
        .then(function (stats) {
          stats.sort(function (a, b) { return b.at - a.at; });
          return Promise.all(stats.slice(KEEP_DONE).map(function (s) { return dir.removeEntry(s.name).catch(function () {}); }));
        });
    });
  }

  // A folder inside `root` for a project, named from it and not yet holding anything that is not
  // this project: "Order-Portal", "Order-Portal-2", …
  function safeName(name) {
    return String(name || 'project').replace(/[^a-zA-Z0-9._ -]+/g, '-').replace(/\s+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'project';
  }
  function childFor(root, name, projectId) {
    var base = safeName(name), n = 1;
    function attempt() {
      var nm = n === 1 ? base : base + '-' + n;
      n++;
      return root.getDirectoryHandle(nm, { create: false }).then(function (dir) {
        return inspect(dir).then(function (what) {
          if (what.kind === 'empty' || (what.kind === 'project' && what.project && what.project.id === projectId)) return dir;
          return attempt();
        });
      }, function (err) {
        if (!missing(err)) throw err;
        if (failing(root, nm + '/')) return Promise.reject(refused(nm + '/'));
        return root.getDirectoryHandle(nm, { create: true });
      });
    }
    return attempt();
  }

  // ---------- what the files hold ----------
  function projectJson(project, descRow, version) {
    project = project || {};
    var s = project.summary || {};
    return JSON.stringify({
      format: FORMAT,
      layout: 1,
      edition: EDITION,
      mxscout: version || null,
      id: project.id,
      name: project.name,
      createdAt: project.createdAt || null,
      updatedAt: project.updatedAt || null,
      source: project.source ? { kind: project.source.kind || null, fileName: project.source.fileName || null } : null,
      // The language everything an agent writes for this project is in (ISO code); null: not chosen yet, English.
      contentLanguage: project.contentLanguage || null,
      settings: { showMarketplaceModules: !!project.showMarketplaceModules, agentAutoSave: project.agentAutoSave !== false },
      model: { file: 'model.json', mendix: s.mendixVersion || null, generatedAt: s.generatedAt || null, bytes: project.bytes || null,
        // Which version of the app it is, from the Mendix project's git: { branch, commit, short, date, message }, or why it is unknown.
        version: s.version || null,
        modules: s.modules || 0, microflows: s.microflows || 0, nanoflows: s.nanoflows || 0, pages: s.pages || 0, entities: s.entities || 0 },
      // describedAt: the model version the descriptions were written for.
      descriptions: descRow && descRow.value ? { file: 'descriptions.json', importedAt: descRow.importedAt || null, from: descRow.fileName || null, describedAt: descRow.value.describedAt || null } : null
    }, null, 2) + '\n';
  }

  function readme(project) {
    var name = (project && project.name) || 'this project';
    return [
      '# ' + name + ' — an MxScout project folder',
      '',
      'MxScout (a local tool that reads a Mendix application from its model) keeps this project here.',
      'The files are written by MxScout, in the browser, every time something in the project changes;',
      'the browser keeps a copy of its own as well. They are plain text: read them, keep them in git.',
      '',
      '| File | What it is |',
      '|---|---|'
    ].concat(ROLES.map(function (r) { return '| `' + r[0] + '` | ' + r[1] + ' |'; })).concat([
      '| `inbox/done/` | The files MxScout took from inbox/, the last ' + KEEP_DONE + ' of them. |',
      '| `README.md` | This note. |',
      '',
      '## For an agent',
      '',
      '1. Read `documentation.md` first — it is the map: what was understood before, and what is out of date.',
      '2. Check what matters in `ai-pack.md`, one module at a time: its `## index` gives each module\'s line range. Never read it whole.',
      '3. Before working a ticket, a Jira issue or an idea out, search `knowledge/` for a similar solved case. When one',
      '   is solved, write its note there (the mendix-assist skill, reference/knowledge-format.md) — no personal data.',
      '4. Hand results back as a descriptions file (see the mendix-describe skill) written into `inbox/` — e.g.',
      '   `node agent.js send --folder <this folder> descriptions.json`, which writes it there whole, under a timestamped name.',
      '   MxScout takes it while the project is open: saved at once, with Undo — a whole file that would replace',
      '   the descriptions kept waits for the person to press Import them.',
      '5. Do not edit `model.json`, `project.json`, `documentation.md` or `ai-pack.md`: MxScout rewrites them.',
      '   `descriptions.json` may be edited; MxScout takes the newer file when the project is opened.',
      '',
      'Opening this folder elsewhere (after `git clone`, or on another machine): MxScout → New project →',
      'Open a project folder…',
      ''
    ]).join('\n');
  }

  window.MxFolder = {
    FORMAT: FORMAT, LAYOUT: LAYOUT, EDITION: EDITION, KEEP_DONE: KEEP_DONE, CORE: CORE, DERIVED: DERIVED, ROLES: ROLES,
    supported: supported, pick: pick, permission: permission, exists: exists, inspect: inspect, parseProject: parseProject,
    stat: stat, readFile: readFile, write: write, writeJson: writeJson, ensureDir: ensureDir, remove: remove, list: list, listAll: listAll, assistFiles: assistFiles, ASSIST_DIRS: ASSIST_DIRS,
    inspectRepo: inspectRepo,
    inbox: inbox, done: done, childFor: childFor, safeName: safeName,
    projectJson: projectJson, readme: readme,
    test: test
  };
})();
