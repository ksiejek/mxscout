/* MxScout — how a project leaves this browser, and how one arrives.
 *
 * There is exactly one way out: an encrypted `.mxscout` package, opened only
 * with an access code MxScout generates and shows once. What is protected is
 * the file IN TRANSIT — mail, chat, a network share — and the code travels by
 * a different channel, which is the entire point and is said on the screen
 * that offers it.
 *
 * What goes in is decided in ONE place, from a whitelist. A field added to a
 * project record next year cannot ride along by accident, and — the rule this
 * exists to enforce — nothing that came from a live application is expressible
 * here at all.
 *
 * Coming back the other way, comments MERGE rather than replace, because a
 * package travels in both directions: the developer sends one, the tester
 * sends it back with their findings. "Replace everything" would quietly
 * destroy whichever side imported second. The rule itself lives in
 * comments.js, where a finding's own business belongs.
 *
 * The envelope and the code are crypto.js's. This file is the dialogs, the
 * bookkeeping and the merge into storage.
 */
(function () {
  'use strict';

  // Bound in init(), under the names the code already used.
  var el, state, store, render, setMessage, newId, findProject, sortProjects,
      openProject, summarize, safeFileName, downloadText, withBuiltinSystemModule;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    store = deps.store;
    render = deps.render;
    setMessage = deps.setMessage;
    newId = deps.newId;
    findProject = deps.findProject;
    sortProjects = deps.sortProjects;
    openProject = deps.openProject;
    summarize = deps.summarize;
    safeFileName = deps.safeFileName;
    downloadText = deps.downloadText;
    withBuiltinSystemModule = deps.withBuiltinSystemModule;
  }

  // ---------- packaging a project for someone else ----------
  // The only way a project leaves this browser. What goes in is decided in ONE
  // place, from a whitelist: a field added to a project record later cannot
  // ride along by accident, and — the rule this exists to enforce — nothing
  // that came from a live application is expressible here at all. Scan reports
  // and run results live in the server's memory and never enter a project, so
  // there is nothing to filter out; this function is what keeps that true when
  // someone adds a field in a year's time.
  function serializeProjectForExport(project, model, findings, includeComments) {
    var payload = {
      project: {
        name: project.name,
        createdAt: project.createdAt,
        source: project.source || null
      },
      model: model,
      findings: includeComments ? findings.map(window.MxComments.serialize) : []
    };
    // appUrl is deliberately absent: the environment the developer connected
    // to is not the environment the tester will use, and it is the one field
    // on a project that names a real host.
    return payload;
  }

  function packageFileName(project) {
    var date = new Date().toISOString().slice(0, 10);
    return safeFileName(project.name) + '-' + date + '.mxscout';
  }


  function startPackaging(projectId) {
    state.packaging = {
      projectId: projectId,
      step: 'confirm',
      includeComments: true,
      code: null,
      fileName: null,
      busy: false,
      error: null,
      copied: null
    };
    render();
  }

  function buildPackage() {
    var pack = state.packaging;
    var project = findProject(pack.projectId);
    if (!project) { pack.error = 'That project no longer exists.'; render(); return; }

    pack.busy = true;
    pack.error = null;
    render();

    // state.detail.model, if the project happens to be open, carries the
    // built-in System module folded in for browsing — never what actually
    // went into storage, and not something to hand to whoever opens this
    // package. rawModel is the one that matches what is on disk.
    var modelPromise = (state.activeId === pack.projectId && state.detail)
      ? Promise.resolve(state.detail.rawModel)
      : store.getModel(pack.projectId);

    var findingsPromise = (state.activeId === pack.projectId)
      ? Promise.resolve(state.findings)
      : store.byIndex('findings', 'byProject', pack.projectId);

    var code = window.MxCrypto.generateCode();

    Promise.all([modelPromise, findingsPromise]).then(function (both) {
      var model = both[0];
      var findings = both[1] || [];
      if (!model) throw new Error('That project’s model is missing from this browser’s storage.');
      var payload = serializeProjectForExport(project, model, findings, pack.includeComments);
      return window.MxCrypto.pack(payload, code).then(function (envelope) {
        var fileName = packageFileName(project);
        downloadText(JSON.stringify(envelope, null, 2), fileName);
        // An export is a record, not a flag on each comment: the same comment
        // travels in several packages, and "which ones have I not sent yet"
        // is a question only a list of sends can answer.
        if (pack.includeComments && findings.length) {
          store.put('exports', {
            id: newId(),
            label: 'Package',
            projectId: pack.projectId,
            at: new Date().toISOString(),
            author: (state.settings.author && state.settings.author.name) || null,
            format: 'package',
            fileName: fileName,
            findings: findings.map(window.MxComments.serialize) // a snapshot: history stays true even if a comment is edited or deleted later
          }).then(function (record) {
          if (state.activeId === pack.projectId) state.exports.unshift(record);
        }, function () { /* the file is already downloaded; a lost record must not look like a failed export */ });
        }
        pack.step = 'done';
        pack.code = code;
        pack.fileName = fileName;
        pack.busy = false;
        render();
      });
    }).catch(function (err) {
      pack.busy = false;
      pack.error = (err && err.message) || 'Could not build the package.';
      render();
    });
  }

  function copyToClipboard(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { onDone(true); }, function () { onDone(false); });
      return;
    }
    onDone(false);
  }

  function renderPackagingModal() {
    if (!state.packaging) return null;
    var pack = state.packaging;
    var project = findProject(pack.projectId);
    if (!project) { state.packaging = null; return null; }

    var close = function () { state.packaging = null; render(); };
    var kids;

    if (pack.step === 'confirm') {
      var commentCount = (state.activeId === pack.projectId ? state.findings.length : null);
      var includeBox = el('input', { type: 'checkbox' });
      includeBox.checked = pack.includeComments;
      includeBox.addEventListener('change', function () { pack.includeComments = includeBox.checked; });

      kids = [
        el('h3', { text: 'Package “' + project.name + '” for someone else' }),
        el('p', { class: 'muted', text: 'The package is encrypted. Whoever receives it needs both the file and an access code — and the whole point is that those two travel separately.' }),
        commentCount === null ? null : el('label', { class: 'ack-row' }, [
          includeBox,
          el('span', { text: 'Include the ' + commentCount + ' comment' + (commentCount === 1 ? '' : 's') + ' on this project' })
        ]),
        el('p', { class: 'hint', text: 'The model and the project name travel inside the encrypted part. The file name is the only thing about the contents that is readable without the code — rename it if even that is too much.' }),
        pack.error ? el('p', { class: 'warn-text', text: pack.error }) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: close }),
          el('button', {
            class: 'btn btn-primary',
            text: pack.busy ? 'Encrypting…' : 'Create package',
            disabled: pack.busy ? 'disabled' : null,
            onclick: buildPackage
          })
        ])
      ].filter(Boolean);
    } else {
      var message = 'I am sending you the MxScout package "' + pack.fileName + '".\n' +
        'Open MxScout, choose New project, and pick that file — it will ask for an access code.\n' +
        'I will send the code separately.';

      kids = [
        el('h3', { text: 'Package created' }),
        el('p', { class: 'muted', text: pack.fileName + ' has been downloaded. Now the code — MxScout does not keep it, and there is no way to recover it. A new export means a new code.' }),
        el('div', { class: 'code-display' }, [
          el('code', { class: 'code-value', text: pack.code }),
          el('button', {
            class: 'btn btn-sm',
            text: pack.copied === 'code' ? 'Copied' : 'Copy code',
            onclick: function () {
              copyToClipboard(pack.code, function (ok) {
                pack.copied = ok ? 'code' : null;
                if (!ok) pack.error = 'Could not copy automatically — select the code and copy it.';
                render();
              });
            }
          })
        ]),
        el('p', { class: 'warn-text', text: 'Send the code by a different channel than the file. Both in one email means the encryption bought you nothing.' }),
        el('button', {
          class: 'btn btn-sm',
          text: pack.copied === 'message' ? 'Message copied' : 'Copy a message for them',
          onclick: function () {
            copyToClipboard(message, function (ok) {
              pack.copied = ok ? 'message' : null;
              render();
            });
          }
        }),
        pack.error ? el('p', { class: 'warn-text', text: pack.error }) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-primary', text: 'Done', onclick: close })
        ])
      ].filter(Boolean);
    }

    var backdrop = el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop && !pack.busy) close(); }
    }, [el('div', { class: 'modal' }, kids)]);
    return backdrop;
  }

  // ---------- opening a package: one dialog, both routes in ----------
  // A package can arrive as a new project or as a replacement for one that
  // already exists. The difference is what happens after it opens, not how the
  // code is asked for, so both routes share this.
  function askForCode(purpose, fileName, envelope, defaults) {
    state.unlock = {
      purpose: purpose,                  // 'new' | 'replace'
      projectId: defaults.projectId || null,
      name: defaults.name || fileName.replace(/\.mxscout$/i, ''),
      fileName: fileName,
      envelope: envelope,
      code: '',
      error: null,
      busy: false
    };
    setMessage(null);
    render();
  }

  function renderUnlockModal() {
    if (!state.unlock) return null;
    var unlock = state.unlock;
    var close = function () { state.unlock = null; render(); };

    var nameInput = el('input', { type: 'text', value: unlock.name, placeholder: 'Project name' });
    nameInput.addEventListener('input', function () { unlock.name = nameInput.value; });

    var codeInput = el('input', {
      class: 'code-input', type: 'text', value: unlock.code,
      placeholder: 'MXS-XXXXX-XXXXX-XXXXX-XXXXX',
      autocomplete: 'off', spellcheck: 'false'
    });
    codeInput.addEventListener('input', function () { unlock.code = codeInput.value; });
    codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    function submit() {
      var code = unlock.code;
      if (!window.MxCrypto.codeLooksComplete(code)) {
        unlock.error = 'That code is incomplete — it is 20 characters, usually written as MXS and four groups of five.';
        render();
        return;
      }
      unlock.busy = true;
      unlock.error = null;
      render();

      var work = unlock.purpose === 'new'
        ? importPackage((unlock.name || '').trim(), unlock.envelope, code)
        : replaceFromPackage(unlock.projectId, unlock.envelope, code);

      work.then(function (result) {
        state.unlock = null;
        var extra = result.added || result.updated
          ? ' ' + result.added + ' comment' + (result.added === 1 ? '' : 's') + ' added' +
            (result.updated ? ', ' + result.updated + ' updated' : '') + '.'
          : '';
        if (unlock.purpose === 'new') {
          openProject(result.record.id).then(function () {
            setMessage('Opened “' + result.record.name + '”.' + extra, 'ok');
            render();
          });
        } else {
          setMessage('Model replaced.' + extra, 'ok');
          render();
        }
      }, function (err) {
        unlock.busy = false;
        unlock.error = (err && err.message) || 'Could not open that package.';
        render();
      });
    }

    var kids = [
      el('h3', { text: 'This file is encrypted' }),
      el('p', { class: 'muted', text: unlock.fileName + ' is an MxScout package. It opens with the access code from whoever sent it — the code travels separately from the file, so check your other messages if you do not have it.' }),
      unlock.purpose === 'new' ? el('label', { class: 'field' }, [el('span', { text: 'Project name' }), nameInput]) : null,
      el('label', { class: 'field' }, [el('span', { text: 'Access code' }), codeInput]),
      unlock.error ? el('p', { class: 'warn-text', text: unlock.error }) : null,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', {
          class: 'btn btn-primary',
          text: unlock.busy ? 'Opening…' : 'Open',
          disabled: unlock.busy ? 'disabled' : null,
          onclick: submit
        })
      ])
    ].filter(Boolean);

    var backdrop = el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop && !unlock.busy) close(); }
    }, [el('div', { class: 'modal' }, kids)]);
    return backdrop;
  }

  // Deciding what a dropped file actually is, once, so no caller has to.
  function handlePickedFile(fileName, text, purpose, projectId) {
    if (window.MxCrypto.looksLikePackage(text)) {
      var envelope;
      try { envelope = JSON.parse(text); }
      catch (e) { setMessage('That package file is damaged — it is not readable JSON.', 'error'); render(); return true; }
      askForCode(purpose, fileName, envelope, { projectId: projectId, name: null });
      return true;
    }
    return false;
  }

  function replaceFromPackage(id, envelope, code) {
    var project = findProject(id);
    if (!project) return Promise.reject(new Error('That project no longer exists.'));
    return window.MxCrypto.open(envelope, code).then(function (payload) {
      var model = payload && payload.model;
      if (!model || !Array.isArray(model.modules) || !Array.isArray(model.entities)) {
        throw new Error('That package’s model is not in a shape MxScout understands.');
      }
      var updated = {
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: new Date().toISOString(),
        source: { kind: 'package', fileName: null, packagedAt: envelope.createdAt || null },
        bytes: JSON.stringify(model).length,
        summary: summarize(model),
        appUrl: project.appUrl || null
      };
      return store.saveProjectWithModel(updated, model).then(function () {
        var i = state.projects.indexOf(project);
        if (i !== -1) state.projects[i] = updated;
        if (state.activeId === id && state.detail) {
          state.detail.rawModel = model;
          state.detail.model = withBuiltinSystemModule(model);
        }

        var incoming = Array.isArray(payload.findings) ? payload.findings : [];
        if (!incoming.length) return { record: updated, added: 0, updated: 0 };
        return store.byIndex('findings', 'byProject', id).then(function (existing) {
          var merged = window.MxComments.merge(existing, incoming, id);
          return store.putMany('findings', merged.merged).then(function () {
            if (state.activeId === id) return window.MxComments.loadFindings(id).then(function () {
              return { record: updated, added: merged.added, updated: merged.updated };
            });
            return { record: updated, added: merged.added, updated: merged.updated };
          });
        });
      });
    });
  }

  // ---------- opening a package ----------
  // Comments merge by id, newest write wins — the rule and its reasoning live
  // in comments.js (MxComments.merge). A package travels in both directions —
  // the developer sends one, the tester sends it back with their own findings
  // — so "replace everything" would quietly destroy whichever side imported
  // second.
  function importPackage(name, envelope, code) {
    return window.MxCrypto.open(envelope, code).then(function (payload) {
      if (!payload || !payload.model) throw new Error('That package does not contain a model.');
      var model = payload.model;
      if (!Array.isArray(model.modules) || !Array.isArray(model.entities)) {
        throw new Error('That package’s model is not in a shape MxScout understands.');
      }
      var now = new Date().toISOString();
      var record = {
        id: newId(),
        name: name || (payload.project && payload.project.name) || 'Imported project',
        createdAt: now,
        updatedAt: now,
        source: { kind: 'package', fileName: null, packagedAt: envelope.createdAt || null },
        bytes: JSON.stringify(model).length,
        summary: summarize(model)
      };
      return store.saveProjectWithModel(record, model).then(function () {
        var incoming = Array.isArray(payload.findings) ? payload.findings : [];
        if (!incoming.length) return { record: record, added: 0, updated: 0 };
        var merged = window.MxComments.merge([], incoming, record.id);
        return store.putMany('findings', merged.merged).then(function () {
          return { record: record, added: merged.added, updated: merged.updated };
        });
      }).then(function (result) {
        state.projects.push(record);
        sortProjects();
        return result;
      });
    });
  }

  window.MxTransfer = {
    init: init,
    startPackaging: startPackaging,
    renderPackagingModal: renderPackagingModal,
    renderUnlockModal: renderUnlockModal,
    // Returns true when the file WAS a package and the code dialog is now up,
    // so the caller knows not to try reading it as plain JSON.
    handlePickedFile: handlePickedFile
  };
})();
