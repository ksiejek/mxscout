/* MxScout — the documentation of many projects, in one file.
 *
 * Karol, 2026-10-16: "I have 30 projects analysed; I want to say: here is a package of all 30, import it
 * — only the documentation, nothing else." So: Export documentation… on the projects list picks the
 * projects (all, at first), and writes ONE encrypted file with, for each, what its documentation is made
 * of and nothing more — the model (the documentation is drawn from it), the descriptions an agent wrote,
 * and the solved cases. Not the Assist items, not the comments, not what was decided about the risks,
 * not a performance recording, not a project's settings, not its package key.
 *
 * The file is a code-only envelope (crypto.js packCodeOnly, format 1): one access code for the whole
 * file, shown once, never kept. Its readable `kind` says it is a bundle, so the file is recognised before
 * the code is asked for; what it holds is all inside the encrypted part.
 *
 * Importing it (New project, picking the file — transfer.js handPickedFile hands it here): the code, then
 * the list of projects in it, each marked New, Update (this browser has it, from an earlier bundle, and
 * the file's copy is newer) or Up to date — and only the ones ticked come in. A project that came from a
 * bundle remembers where from (project.origin: the sender's project id and the copy's date), which is how
 * the next bundle knows it. An update brings a newer model, descriptions and solved cases into the
 * project; the project keeps its own name, settings and everything else it has.
 *
 * Projects come into this browser; Keep in a folder… keeps one in a folder afterwards, as for any other.
 */
(function () {
  'use strict';

  var KIND = 'mxscout-docs-bundle';
  var VERSION = 1;
  var MAX_PROJECTS = 500;

  var el, state, store, render, setMessage, newId, sortProjects, summarize, downloadText;

  // api: { el, state, store, render, setMessage, newId, sortProjects, summarize, downloadText } — app.js.
  function init(api) {
    el = api.el; state = api.state; store = api.store; render = api.render; setMessage = api.setMessage;
    newId = api.newId; sortProjects = api.sortProjects; summarize = api.summarize; downloadText = api.downloadText;
  }

  function now() { return new Date().toISOString(); }
  function later(a, b) { return String(a || '') > String(b || '') ? a : b; }
  function isBundle(envelope) { return !!envelope && envelope.kind === KIND; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------- export ----------
  function startExport() {
    var picked = {};
    (state.projects || []).forEach(function (p) { picked[p.id] = true; });
    state.bundle = { mode: 'export', step: 'pick', picked: picked, described: {}, busy: false, error: null, code: null, fileName: null, copied: null };
    var b = state.bundle;
    Promise.all((state.projects || []).map(function (p) {
      return store.get('descriptions', p.id).then(function (d) { b.described[p.id] = !!(d && d.value); }, function () { b.described[p.id] = false; });
    })).then(function () { if (state.bundle === b) render(); });
    render();
  }

  // What one project is in the file: a whitelist, as transfer.js's package is — nothing else can ride along.
  function entryOf(project) {
    return Promise.all([
      store.getModel(project.id),
      store.get('descriptions', project.id).catch(function () { return null; }),
      window.MxKnowledge.forPackage(project.id).catch(function () { return []; })
    ]).then(function (got) {
      var model = got[0], d = got[1];
      if (!model) throw new Error('The model of “' + project.name + '” is missing from this browser’s storage.');
      var descriptions = d && d.value ? { importedAt: d.importedAt || null, fileName: d.fileName || null, file: window.MxDescribe.toFile(d.value) } : null;
      return {
        // Who it is, wherever it goes: the id of the project it came from (or that project's own origin, when
        // it came here from a bundle itself), so a later bundle recognises it.
        id: project.origin && project.origin.id ? project.origin.id : project.id,
        name: project.name,
        createdAt: project.createdAt || null,
        // How recent this copy is: the later of when the project or its descriptions last changed.
        stamp: later(project.updatedAt, descriptions && descriptions.importedAt) || now(),
        model: model,
        descriptions: descriptions,
        knowledge: (got[2] || []).map(function (c) { return { path: c.path, text: c.text }; })
      };
    });
  }

  // The file for these projects, encrypted with this code. → the envelope, as JSON is written.
  function makeFile(projects, code) {
    return Promise.all(projects.map(entryOf)).then(function (entries) {
      return window.MxCrypto.packCodeOnly({ format: KIND, version: VERSION, createdAt: now(), projects: entries }, code);
    }).then(function (envelope) {
      envelope.kind = KIND;
      envelope.note = 'Encrypted MxScout documentation of ' + plural(projects.length, 'project', 'projects') + '. It needs the access code from whoever sent it.';
      return envelope;
    });
  }

  function buildExport() {
    var b = state.bundle;
    var chosen = (state.projects || []).filter(function (p) { return b.picked[p.id]; });
    if (!chosen.length) { b.error = 'Tick at least one project.'; render(); return; }
    b.busy = true; b.error = null; render();
    var code = window.MxCrypto.generateCode();
    makeFile(chosen, code).then(function (envelope) {
      var fileName = 'mxscout-documentation-' + now().slice(0, 10) + '.mxscout';
      downloadText(JSON.stringify(envelope), fileName);
      b.busy = false; b.step = 'done'; b.code = code; b.fileName = fileName; b.count = chosen.length;
      render();
    }).catch(function (err) {
      b.busy = false; b.error = (err && err.message) || 'Could not make the file.'; render();
    });
  }

  // ---------- import ----------
  // A picked file that is a bundle (transfer.js asks): the code first.
  function openFile(fileName, envelope) {
    // Where the projects go: a library folder on disk (each project in a folder of its own, where an agent reads it —
    // the mxscout-project skill), or this browser only. The folder first, where the browser can keep one.
    var canKeep = window.MxFolderUI && window.MxFolderUI.supported();
    state.bundle = { mode: 'import', step: 'code', fileName: fileName, envelope: envelope, code: '', rows: null, busy: false, error: null,
      where: canKeep ? 'library' : 'browser', parent: store.homeHandle ? store.homeHandle() : null, canKeep: canKeep };
    setMessage(null);
    render();
  }

  // The project here that a bundle's entry is: one that came from it (origin), or the very one it was made from.
  function matchOf(entry) {
    var list = state.projects || [];
    for (var i = 0; i < list.length; i++) if (list[i].origin && list[i].origin.id === entry.id) return list[i];
    for (var j = 0; j < list.length; j++) if (list[j].id === entry.id) return list[j];
    return null;
  }
  function statusOf(entry, match) {
    if (!match) return 'new';
    var mine = match.origin && match.origin.id === entry.id ? match.origin.stamp : match.updatedAt;
    return String(entry.stamp || '') > String(mine || '') ? 'update' : 'same';
  }

  // The decrypted payload, checked: a list of entries each with a model MxScout understands.
  function entriesOf(payload) {
    if (!payload || payload.format !== KIND || payload.version !== VERSION || !Array.isArray(payload.projects)) throw new Error('That file is not documentation MxScout can read.');
    return payload.projects.slice(0, MAX_PROJECTS).filter(function (e) {
      return e && typeof e.id === 'string' && e.id && e.model && Array.isArray(e.model.modules) && Array.isArray(e.model.entities);
    });
  }

  function unlock() {
    var b = state.bundle;
    if (!window.MxCrypto.codeLooksComplete(b.code)) { b.error = 'That code is incomplete — it is 20 characters, usually written as MXS and four groups of five.'; render(); return; }
    b.busy = true; b.error = null; render();
    window.MxCrypto.openWithCode(b.envelope, b.code).then(function (r) {
      var entries = entriesOf(r.payload);
      if (!entries.length) throw new Error('That file holds no project MxScout can read.');
      b.rows = entries.map(function (e) {
        var match = matchOf(e), status = statusOf(e, match);
        return { entry: e, match: match, status: status, pick: status !== 'same' };
      });
      b.envelope = null; // the decrypted rows are what is needed now
      b.busy = false; b.step = 'pick'; render();
    }).catch(function (err) {
      b.busy = false; b.error = (err && err.message) || 'Could not open that file.'; render();
    });
  }

  function takeDescriptions(projectId, incoming) {
    if (!incoming || !incoming.file) return Promise.resolve(false);
    var parsed = window.MxDescribe.parse(JSON.stringify(incoming.file));
    if (parsed.error) return Promise.resolve(false);
    return store.put('descriptions', { projectId: projectId, importedAt: incoming.importedAt || now(), fileName: incoming.fileName || 'from documentation', value: parsed.value }).then(function () {
      if (window.MxDocs && window.MxDocs.forgetDescriptions) window.MxDocs.forgetDescriptions(projectId);
      return true;
    });
  }
  function takeCases(projectId, entry) {
    return window.MxKnowledge.takeFromPackage(projectId, entry.knowledge || []).catch(function () { return 0; });
  }

  // One row in: a new project, or the newer copy into the one that is here — its own name and settings kept.
  function importRow(row) {
    var e = row.entry, model = e.model, at = now();
    var origin = { id: e.id, stamp: e.stamp || at };
    if (row.status === 'update' && row.match) {
      var p = row.match;
      var updated = Object.assign({}, p, { updatedAt: at, bytes: JSON.stringify(model).length, summary: summarize(model), origin: p.id === e.id ? p.origin : origin });
      return store.saveProjectWithModel(updated, model).then(function () { return takeDescriptions(p.id, e.descriptions); })
        .then(function () { return takeCases(p.id, e); }).then(function () {
          var i = state.projects.indexOf(p);
          if (i !== -1) state.projects[i] = updated;
          return 'updated';
        });
    }
    var record = {
      id: newId(), name: e.name || 'Imported project', createdAt: at, updatedAt: at,
      source: { kind: 'documentation', fileName: state.bundle && state.bundle.fileName || null },
      bytes: JSON.stringify(model).length, summary: summarize(model), origin: origin,
      contentLanguage: window.MxDescribe.languageCode(e.descriptions && e.descriptions.file && e.descriptions.file.language) || window.MxDocs.defaultLanguage() || null
    };
    return store.saveProjectWithModel(record, model).then(function () { return takeDescriptions(record.id, e.descriptions); })
      .then(function () { return takeCases(record.id, e); }).then(function () { state.projects.push(record); return 'added'; });
  }

  // The library is the MxScout folder (store.js home): chosen here, it is set for every project from now on.
  function chooseLibrary() {
    var b = state.bundle;
    window.MxFolderUI.pickParent().then(function (h) { return store.setHome(h).then(function () { return h; }); }).then(function (h) { b.parent = h; b.error = null; render(); },
      function (err) { if (!window.MxFolderUI.cancelled(err)) { b.error = (err && err.message) || 'Could not use that folder.'; render(); } });
  }

  function importPicked() {
    var b = state.bundle;
    var rows = b.rows.filter(function (r) { return r.pick && r.status !== 'same'; });
    if (!rows.length) { b.error = 'Tick at least one project.'; render(); return; }
    if (b.where === 'library' && !b.parent) { b.error = 'Choose your MxScout folder first — or keep them in this browser only.'; render(); return; }
    b.busy = true; b.error = null; render();
    var added = 0, updated = 0, failed = [], unkept = [];
    // One after another: thirty models written at once would hold the database for no gain. A new project goes
    // into the library at once; one updated there already is written through by store.js, as any change.
    rows.reduce(function (p, r) {
      return p.then(function () { return importRow(r); }).then(function (how) {
        if (how === 'added') added++; else updated++;
        var project = how === 'added' ? state.projects[state.projects.length - 1] : r.match;
        if (b.where === 'library' && b.parent && project && !store.hasFolder(project.id)) {
          return window.MxFolderUI.intoParent(b.parent, project).catch(function (err) { unkept.push(project.name + ' (' + ((err && err.message) || 'failed') + ')'); });
        }
        return null;
      }, function (err) { failed.push(r.entry.name + ' (' + ((err && err.message) || 'failed') + ')'); });
    }, Promise.resolve()).then(function () {
      sortProjects();
      state.bundle = null;
      var said = [added ? plural(added, 'project', 'projects') + ' added' : null, updated ? plural(updated, 'project', 'projects') + ' updated' : null].filter(Boolean).join(', ');
      setMessage((said ? 'Documentation imported: ' + said + (b.where === 'library' && b.parent ? ', each in a folder of its own in ' + b.parent.name : '') + '.' : 'Nothing imported.')
        + (failed.length ? ' Not imported: ' + failed.join('; ') + '.' : '') + (unkept.length ? ' In this browser only, not in the folder: ' + unkept.join('; ') + '.' : ''), failed.length || unkept.length ? 'error' : 'ok');
      render();
    });
  }

  // Where the projects go: the library folder (recommended — an agent reads them there), or this browser only.
  function whereField(b) {
    function radio(value, label, hint) {
      var r = el('input', { type: 'radio', name: 'bundle-where', value: value, class: 'bundle-where' });
      r.checked = b.where === value;
      r.addEventListener('change', function () { b.where = value; b.error = null; render(); });
      return el('label', { class: 'bundle-where-row' }, [r, el('span', null, [el('b', { text: label }), el('small', { class: 'muted', text: hint })])]);
    }
    return el('div', { class: 'field bundle-where-field' }, [
      el('span', { text: 'Where to keep them' }),
      radio('library', 'In your MxScout folder', 'Each project in a folder of its own there — where Claude reads them (/mxscout-project). Recommended.'),
      b.where === 'library' ? el('div', { class: 'bundle-lib' }, [
        el('button', { type: 'button', class: 'btn btn-sm bundle-lib-pick', text: b.parent ? 'Change…' : 'Choose the folder…', onclick: chooseLibrary }),
        el('span', { class: 'muted', text: b.parent ? b.parent.name : 'not set yet — e.g. MxScout in your home folder; it is where every project is kept' })]) : null,
      radio('browser', 'In this browser only', 'Keep in a folder… puts one on disk later.')
    ]);
  }

  // ---------- the dialog ----------
  function copy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  function renderModal() {
    var b = state.bundle;
    if (!b) return null;
    var close = function () { if (!b.busy) { state.bundle = null; render(); } };
    var kids;
    if (b.mode === 'export' && b.step === 'pick') {
      var all = state.projects || [];
      var n = all.filter(function (p) { return b.picked[p.id]; }).length;
      var toggleAll = el('input', { type: 'checkbox', class: 'bundle-all' });
      toggleAll.checked = n === all.length;
      toggleAll.addEventListener('change', function () { all.forEach(function (p) { b.picked[p.id] = toggleAll.checked; }); render(); });
      kids = [
        el('h3', { text: 'Export documentation' }),
        el('p', { class: 'muted', text: 'One encrypted file with the documentation of the projects you tick: for each, the model it is drawn from, the descriptions an agent wrote and the solved cases. Nothing else — no Assist items, comments, decisions about risks, recordings or settings.' }),
        el('label', { class: 'ack-row bundle-all-row' }, [toggleAll, el('span', { text: ' All ' + plural(all.length, 'project', 'projects') })]),
        el('div', { class: 'bundle-list' }, all.map(function (p) {
          var box = el('input', { type: 'checkbox', class: 'bundle-pick', 'data-id': p.id });
          box.checked = !!b.picked[p.id];
          box.addEventListener('change', function () { b.picked[p.id] = box.checked; render(); });
          return el('label', { class: 'bundle-row' }, [box, el('span', { class: 'bundle-name', text: p.name }),
            el('small', { class: 'muted', text: b.described[p.id] === undefined ? '' : b.described[p.id] ? 'described' : 'model only, not described yet' })]);
        })),
        b.error ? el('p', { class: 'warn-text', text: b.error }) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: close }),
          el('button', { class: 'btn btn-primary bundle-go', text: b.busy ? 'Encrypting…' : 'Export ' + plural(n, 'project', 'projects'), disabled: b.busy || !n ? 'disabled' : null, onclick: buildExport })
        ])
      ];
    } else if (b.mode === 'export') {
      var msg = 'I am sending you the MxScout documentation of ' + plural(b.count, 'project', 'projects') + ', "' + b.fileName + '".\n' +
        'Open MxScout, choose New project, and pick that file. It asks for an access code — I will send it separately.';
      kids = [
        el('h3', { text: 'Documentation exported' }),
        el('p', { class: 'muted', text: b.fileName + ' has been downloaded, with ' + plural(b.count, 'project', 'projects') + '. Now the code — MxScout does not keep it, and there is no way to recover it. Another export means another code.' }),
        el('div', { class: 'code-display' }, [el('code', { class: 'code-value bundle-code', text: b.code }),
          el('button', { class: 'btn btn-sm', text: b.copied === 'code' ? 'Copied' : 'Copy code', onclick: function () { copy(b.code, function (ok) { b.copied = ok ? 'code' : null; render(); }); } })]),
        el('p', { class: 'warn-text', text: 'Send the code by a different channel than the file. Both in one email means the encryption bought you nothing.' }),
        el('button', { class: 'btn btn-sm', text: b.copied === 'message' ? 'Message copied' : 'Copy a message for them', onclick: function () { copy(msg, function (ok) { b.copied = ok ? 'message' : null; render(); }); } }),
        el('div', { class: 'modal-actions' }, [el('button', { class: 'btn btn-primary', text: 'Done', onclick: function () { state.bundle = null; render(); } })])
      ];
    } else if (b.step === 'code') {
      var input = el('input', { class: 'code-input bundle-code-input', type: 'text', value: b.code, placeholder: 'MXS-XXXXX-XXXXX-XXXXX-XXXXX', autocomplete: 'off', spellcheck: 'false' });
      input.addEventListener('input', function () { b.code = input.value; });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
      kids = [
        el('h3', { text: 'Import documentation' }),
        el('p', { class: 'muted', text: b.fileName + ' is MxScout documentation, encrypted. It opens with the access code from whoever sent it; then you choose which projects to take.' }),
        el('label', { class: 'field' }, [el('span', { text: 'Access code' }), input]),
        b.error ? el('p', { class: 'warn-text', text: b.error }) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: close }),
          el('button', { class: 'btn btn-primary bundle-open', text: b.busy ? 'Opening…' : 'Open', disabled: b.busy ? 'disabled' : null, onclick: unlock })
        ])
      ];
    } else {
      var LABEL = { 'new': 'New', update: 'Update', same: 'Up to date' };
      var go = b.rows.filter(function (r) { return r.pick && r.status !== 'same'; }).length;
      kids = [
        el('h3', { text: 'Import documentation' }),
        el('p', { class: 'muted', text: plural(b.rows.length, 'project', 'projects') + ' in this file. A new one is added to this browser; one you have from an earlier file is updated when this copy is newer — its own name and settings kept.' }),
        el('div', { class: 'bundle-list' }, b.rows.map(function (r) {
          var box = el('input', { type: 'checkbox', class: 'bundle-pick', 'data-id': r.entry.id });
          box.checked = r.pick && r.status !== 'same';
          if (r.status === 'same') box.disabled = true;
          box.addEventListener('change', function () { r.pick = box.checked; render(); });
          return el('label', { class: 'bundle-row', 'data-status': r.status }, [box, el('span', { class: 'bundle-name', text: r.entry.name }),
            el('span', { class: 'bundle-st ' + r.status, text: LABEL[r.status] }),
            el('small', { class: 'muted', text: r.entry.descriptions ? 'described' : 'model only' })]);
        })),
        b.canKeep ? whereField(b) : null,
        b.error ? el('p', { class: 'warn-text', text: b.error }) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: close }),
          el('button', { class: 'btn btn-primary bundle-import', text: b.busy ? 'Importing…' : 'Import ' + plural(go, 'project', 'projects'), disabled: b.busy || !go ? 'disabled' : null, onclick: importPicked })
        ])
      ];
    }
    var backdrop = el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === backdrop && b.step !== 'done') close(); } },
      [window.MxDialog.modal(el('div', { class: 'modal bundle-modal' }, kids.filter(Boolean)), b.step === 'done' ? null : close)]);
    return backdrop;
  }

  window.MxBundle = { init: init, KIND: KIND, isBundle: isBundle, startExport: startExport, openFile: openFile, renderModal: renderModal, entriesOf: entriesOf, makeFile: makeFile };
})();
