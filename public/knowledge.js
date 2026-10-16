/* MxScout — the solved cases: what stays behind when a ticket, a Jira issue or an idea is solved.
 *
 * Karol, 2026-10-15: most people work with an AI agent alone and may never open MxScout. When a case
 * is solved in a conversation, a trace must remain that any agent on another machine can use — this
 * was the problem, this was the solution, these were the dead ends. The agent writes it itself, as one
 * Markdown file per case in knowledge/ (the mendix-assist skill, reference/knowledge-format.md), and the
 * person commits it with the fix: the commit is the approval. repodocs.js says what a note holds and
 * checks it; this file is MxScout's copy of them.
 *
 * Where they live: the browser's own database (the `knowledge` store, through store.js), one record per
 * project — { projectId, files: [{ path: 'knowledge/<id>-<slug>.md', text }], updatedAt } — and, for a
 * project kept in a folder, knowledge/ in that folder (store.js writes it after every save, and reads
 * what someone else wrote there: the folder wins). Inside the Mendix project knowledge/ is committed.
 * They travel in the .mxscout package; they are NOT in the exported documentation unless the person
 * ticks "Include solved cases" on Export. MxScout uploads them nowhere.
 *
 * MxScout never writes a note of its own accord, and has no button that records one: an agent writes
 * them. It takes one an agent hands it — through the agent channel or the folder's inbox, as an
 * envelope { "format": "mxscout-knowledge", "version": 1, "cases": [{ path?, text }] } or as the .md
 * note itself — checked by the same rules as the skill's checker (a note with personal data in it is
 * refused), saved at once with Undo, and written into knowledge/.
 */
(function () {
  'use strict';

  var FORMAT = 'mxscout-knowledge';
  var VERSION = 1;
  var MAX_CASES = 2000;

  var store = null;
  var rows = {};       // projectId -> { projectId, files, updatedAt }, null when none, undefined while it loads
  var loading = {};
  var listed = {};     // projectId -> { files, cases } — the cases read from the files, once per record
  var watchers = [];

  // api: { store, onChange(projectId) } — app.js.
  function init(api) {
    store = api.store;
    if (api.onChange) watchers.push(api.onChange);
    // Another tab saved a project's solved cases: read them again (assist.js does the same for its items).
    if (store.onOtherTab) store.onOtherTab(function (name, projectId) { if (name === 'knowledge' && Object.prototype.hasOwnProperty.call(rows, projectId)) read(projectId); });
  }
  function R() { return window.MxRepoDocs; }
  function tell(projectId) { watchers.forEach(function (fn) { try { fn(projectId); } catch (e) { /* the watcher's own problem */ } }); }
  function now() { return new Date().toISOString(); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  // ---------- the record ----------
  // As for the Assist items (assist.js): `rows` is this tab's copy, for drawing; every change is made on the
  // record as the database holds it now, in one transaction with a revision number (store.update), so a
  // second tab's copy never writes over what the first one saved.
  var reads = {};
  function read(projectId) {
    var n = reads[projectId] = (reads[projectId] || 0) + 1;
    var p = store.get('knowledge', projectId).then(function (row) { return row || null; }, function () { return null; }).then(function (row) {
      if (reads[projectId] === n) { delete loading[projectId]; keep(projectId, row); }
      return rows[projectId];
    });
    loading[projectId] = p;
    return p;
  }
  function keep(projectId, row) {
    var was = rows[projectId];
    if (was && row && (was.rev || 0) > (row.rev || 0)) return;
    rows[projectId] = row;
    tell(projectId);
  }
  function load(projectId) {
    if (rows[projectId] !== undefined && Object.prototype.hasOwnProperty.call(rows, projectId)) return Promise.resolve(rows[projectId]);
    if (loading[projectId]) return loading[projectId];
    rows[projectId] = undefined;
    return read(projectId);
  }
  // fn(current) → { row (or null: nothing to write), result }, worked out synchronously from the record as it is now.
  // Nothing is ever cut to make room: a limit refuses what is new (apply), it never drops what is kept.
  function change(projectId, fn) {
    var out = null;
    return store.update('knowledge', projectId, function (cur) {
      out = fn(cur || null);
      if (!out.row) return undefined;
      out.row.updatedAt = now();
      out.row.files.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
      return out.row;
    }).then(function (r) {
      var row = r.value || null;
      if (r.changed || !rows[projectId] || (row && (rows[projectId].rev || 0) < (row.rev || 0))) keep(projectId, row);
      var res = out.result || {};
      res.row = rows[projectId];
      return res;
    });
  }
  function emptyRow(projectId) { return { projectId: projectId, files: [], updatedAt: null }; }

  // The cases of a project as they are now — every note that reads as one, in path order — or undefined
  // while they are still read (a change is told when they are in).
  function peek(projectId) {
    if (!projectId) return [];
    if (rows[projectId] === undefined) { load(projectId); return undefined; }
    var row = rows[projectId];
    if (!row) return [];
    var memo = listed[projectId];
    if (!memo || memo.files !== row.files) memo = listed[projectId] = { files: row.files, cases: R().casesOf(row.files) };
    return memo.cases;
  }
  function list(projectId) { return load(projectId).then(function () { return peek(projectId) || []; }); }
  function count(projectId) { var c = peek(projectId); return c && c.length ? c.length : null; }

  // ---------- what an agent hands in ----------
  function isEnvelope(text) {
    if (text && typeof text === 'object') return text.format === FORMAT;
    return typeof text === 'string' && /"format"\s*:\s*"mxscout-knowledge"/.test(text.slice(0, 4000));
  }
  // A case note itself, as a .md file: front matter with an id and a kind.
  function isNote(text, name) {
    return typeof text === 'string' && /^---\r?\n/.test(text) && /^id:/m.test(text.slice(0, 2000)) && (!name || /\.md$/i.test(name));
  }
  // An envelope or a note → { value: { files: [{ path, text, id, kind, title }] } } or { error }. Every note is
  // checked by repodocs.js caseCheck — the rules the skill's checker says — and one with an error refuses the
  // whole hand-in: nothing of it is kept. Whatever it says is text to show, never markup or instructions.
  function parse(text, name) {
    var raw = null, notes = [];
    if (isEnvelope(text)) {
      raw = text;
      if (typeof text === 'string') { try { raw = JSON.parse(text); } catch (e) { return { error: 'That is not JSON.' }; } }
      if (raw.version !== VERSION) return { error: 'This solved-case file is version ' + raw.version + '; this MxScout reads version ' + VERSION + '.' };
      if (!Array.isArray(raw.cases) || !raw.cases.length) return { error: 'The file has no "cases".' };
      raw.cases.slice(0, 200).forEach(function (c) { notes.push({ path: c && typeof c.path === 'string' ? c.path : null, text: c && typeof c.text === 'string' ? c.text : '' }); });
    } else if (isNote(text, name)) notes.push({ path: null, text: String(text) });
    else return { error: 'That is not a solved case — a note starts with its front matter ("---"), an envelope says "format": "' + FORMAT + '".' };
    var files = [], problems = [];
    notes.forEach(function (n, i) {
      var first = R().caseCheck(n.text, n.path || null), v = first.value;
      if (!v) { problems.push('case ' + (i + 1) + ': ' + first.errors[0]); return; }
      var path = n.path ? String(n.path).replace(/^(?:.*\/)?knowledge\//, 'knowledge/') : R().caseFile(v.id, v.title);
      if (!/^knowledge\/[^/]+\.md$/.test(path)) path = 'knowledge/' + String(n.path).replace(/^.*\//, '');
      var c = R().caseCheck(n.text, path);
      if (c.errors.length) { problems.push(v.id + ': ' + c.errors.slice(0, 2).join(' ')); return; }
      files.push({ path: c.value.path, text: String(n.text).replace(/\r\n?/g, '\n'), id: c.value.id, kind: c.value.kind, title: c.value.title });
    });
    if (problems.length) return { error: 'Nothing was kept — ' + problems.slice(0, 3).join('; ') };
    return { value: { files: files } };
  }

  // Saves the notes an agent handed in: each in the place of the one at its path, or of the one with its id and
  // kind under another name (a title that changed). → { changed: [{ id, kind, title, path, how }], what, before, row }.
  function apply(projectId, offer) {
    var parsed = offer && offer.files ? { value: offer } : parse(offer);
    if (parsed.error) return Promise.reject(new Error(parsed.error));
    return change(projectId, function (was) {
      var before = clone(was), row = clone(was) || emptyRow(projectId), changed = [];
      var fresh = parsed.value.files.filter(function (f) {
        return !row.files.some(function (x) { if (x.path === f.path) return true; var c = R().caseOf(x); return !!c && c.id === f.id && c.kind === f.kind; });
      }).length;
      if (fresh && row.files.length + fresh > MAX_CASES) throw new Error('Nothing was saved, and nothing was removed: MxScout keeps at most ' + MAX_CASES + ' solved cases for one project, this one has ' + row.files.length + ', and ' + (fresh === 1 ? 'one more' : fresh + ' more') + ' would pass it. A note written again in the place of one kept still goes through.');
      parsed.value.files.forEach(function (f) {
        var how = 'added';
        row.files = row.files.filter(function (x) {
          if (x.path === f.path) { if (x.text !== f.text) how = 'replaced'; else how = 'same'; return false; }
          var c = R().caseOf(x);
          if (c && c.id === f.id && c.kind === f.kind) { how = 'replaced'; return false; }
          return true;
        });
        row.files.push({ path: f.path, text: f.text });
        if (how !== 'same') changed.push({ id: f.id, kind: f.kind, title: f.title, path: f.path, how: how });
      });
      var what = changed.length ? (changed.length === 1 ? 'the solved case ' + changed[0].id : changed.length + ' solved cases, ' + changed.map(function (c) { return c.id; }).join(', ')) : 'nothing new';
      return { row: changed.length ? row : null, result: { changed: changed, what: what, before: before } };
    });
  }
  // Only while the record is the one that save left, by its revision — a change another tab made since is never undone with it.
  function canUndo(projectId, result) { return !!result && !!result.row && !!rows[projectId] && rows[projectId].rev === result.row.rev && result.changed.length > 0; }
  function undo(projectId, result) {
    var refused = 'The solved cases changed since; there is nothing to undo.';
    if (!canUndo(projectId, result)) return Promise.reject(new Error(refused));
    return change(projectId, function (cur) {
      if (!cur || cur.rev !== result.row.rev) throw new Error(refused);
      return { row: clone(result.before) || emptyRow(projectId) };
    });
  }

  // ---------- the folder ----------
  // The notes as store.js writes them into knowledge/: every one that reads as a case. Pure.
  function toFiles(files) { return R().casesOf(files).map(function (c) { return { path: c.path, text: c.text }; }); }
  // What the folder holds that is newer than this browser's copy — and the notes removed there since MxScout
  // last read them (a pull that deleted one): the folder wins. A file that does not pass as a case note is left
  // alone — never written over — and said. → { taken: [paths], removed: [paths], skipped: [{ path, error }] }.
  function adoptFiles(projectId, changes) {
    var files = (changes && changes.files) || [], gone = (changes && changes.removed) || [];
    return change(projectId, function (was) {
      var row = clone(was) || emptyRow(projectId), taken = [], removed = [], skipped = [];
      files.forEach(function (f) {
        // A note with an error — personal data among them — is not taken, nor listed in docs/index.md: said, to be fixed.
        if (!R().caseOf(f)) { skipped.push({ path: f.path, error: String(R().caseCheck(f.text, f.path).errors[0] || '').replace(/\.$/, '') }); return; }
        var at = -1;
        row.files.forEach(function (x, i) { if (x.path === f.path) at = i; });
        if (at >= 0 && row.files[at].text === f.text) return;
        if (at >= 0) row.files[at] = { path: f.path, text: f.text }; else row.files.push({ path: f.path, text: f.text });
        taken.push(f.path);
      });
      gone.forEach(function (p) {
        var n = row.files.length;
        row.files = row.files.filter(function (x) { return x.path !== p; });
        if (row.files.length < n) removed.push(p);
      });
      return { row: taken.length || removed.length ? row : null, result: { taken: taken, removed: removed, skipped: skipped } };
    });
  }

  // ---------- the package ----------
  // The notes a package carries: [{ path, text }] — those that read as a case.
  function forPackage(projectId) { return store.get('knowledge', projectId).then(function (row) { return row ? toFiles(row.files) : []; }, function () { return []; }); }
  // Into the project that opened it: each note in the place of the one at its path; the others stay. → how many.
  function takeFromPackage(projectId, files) {
    var take = R().casesOf(Array.isArray(files) ? files.filter(function (f) { return f && typeof f.path === 'string' && typeof f.text === 'string'; }).map(function (f) { return { path: f.path, text: f.text }; }) : []);
    if (!take.length) return Promise.resolve(0);
    return change(projectId, function (was) {
      var row = clone(was) || emptyRow(projectId), n = 0;
      take.forEach(function (c) {
        var at = -1;
        row.files.forEach(function (x, i) { if (x.path === c.path) at = i; });
        if (at >= 0 && row.files[at].text === c.text) return;
        if (at >= 0) row.files[at] = { path: c.path, text: c.text }; else row.files.push({ path: c.path, text: c.text });
        n++;
      });
      return { row: n ? row : null, result: { n: n } };
    }).then(function (res) { return res.n; });
  }

  // The cases as the documentation's pages take them (docs.js pageScreen, through app.js): one object per
  // project, so a page mounted with it keeps it; `version` moves whenever a note does.
  var hooks = {};
  function hook(projectId) {
    return hooks[projectId] || (hooks[projectId] = {
      items: function () { return peek(projectId) || []; },
      version: function () { return rows[projectId] ? rows[projectId].files : rows[projectId]; }
    });
  }
  function forget(projectId) { delete rows[projectId]; delete loading[projectId]; delete listed[projectId]; reads[projectId] = (reads[projectId] || 0) + 1; }

  window.MxKnowledge = {
    init: init, load: load, peek: peek, list: list, count: count, isEnvelope: isEnvelope, isNote: isNote, parse: parse, apply: apply,
    canUndo: canUndo, undo: undo, toFiles: toFiles, adoptFiles: adoptFiles, forPackage: forPackage, takeFromPackage: takeFromPackage,
    hook: hook, forget: forget, FORMAT: FORMAT
  };
})();
