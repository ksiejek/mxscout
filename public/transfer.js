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
 * The solved cases (knowledge.js: the notes in knowledge/, Karol 2026-10-15)
 * travel too, each in the place of the note at its path when they come back.
 *
 * The envelope and the code are crypto.js's. This file is the dialogs, the
 * bookkeeping and the merge into storage — and the project's package key
 * (Karol, 2026-10-15): the first package of a project makes one, kept in this
 * browser (store.js); every later package of the project, from here or from
 * anyone who opened one, is encrypted with the same key. A package whose key
 * id matches a key kept here opens without the code — and says so; one that
 * does not, or whose key does not open it, asks for the code as before.
 * Opening a package into a project that is already here (the same key, or
 * Replace model…) first says which is newer, by the model's version
 * (modelversion.js), and asks.
 */
(function () {
  'use strict';

  // Bound in init(), under the names the code already used.
  var el, state, store, render, setMessage, newId, findProject, sortProjects,
      openProject, summarize, safeFileName, downloadText, withBuiltinSystemModule,
      folderChoice, freshChoice, choiceReady, linkNewProject;

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
    // Where a package opened as a new project is kept: a folder first, as on New project (folderui.js).
    folderChoice = deps.folderChoice;
    freshChoice = deps.freshChoice;
    choiceReady = deps.choiceReady;
    linkNewProject = deps.linkNewProject;
  }

  // ---------- packaging a project for someone else ----------
  // The only way a project leaves this browser. What goes in is decided in ONE
  // place, from a whitelist: a field added to a project record later cannot
  // ride along by accident, and — the rule this exists to enforce — nothing
  // that came from a live application is expressible here at all. Scan reports
  // and run results live in the server's memory and never enter a project, so
  // there is nothing to filter out; this function is what keeps that true when
  // someone adds a field in a year's time.
  // The descriptions an AI agent wrote travel too (Karol, 2026-10-14: a package opened on another
  // machine showed the model and nothing of what had been written about it), as a descriptions
  // file (MxDescribe.toFile), which the receiving side reads with the same parser as any import.
  // What was decided about the risks travels with them (triage.js serialize, a whitelist of its own);
  // the decisions about risks raised in comments only when the comments go too.
  // A performance recording does not: it came from a running application.
  function serializeProjectForExport(project, model, findings, includeComments, descriptions, triage, cases) {
    var payload = {
      project: {
        name: project.name,
        createdAt: project.createdAt,
        source: project.source || null
      },
      model: model,
      findings: includeComments ? findings.map(window.MxComments.serialize) : [],
      descriptions: descriptions && descriptions.value ? { importedAt: descriptions.importedAt || null, fileName: descriptions.fileName || null, file: window.MxDescribe.toFile(descriptions.value) } : null,
      triage: window.MxTriage.serialize(triage, includeComments),
      // The solved cases (knowledge.js, Karol 2026-10-15), as their notes: { path: 'knowledge/<id>-<slug>.md', text }.
      knowledge: (cases || []).map(function (c) { return { path: c.path, text: c.text }; })
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
      copied: null,
      // Read for the dialog: whether this project has a package key yet, and what its descriptions describe.
      keyKnown: null,
      described: null
    };
    var pack = state.packaging;
    Promise.all([store.getPackageKey(projectId).catch(function () { return null; }), store.get('descriptions', projectId).catch(function () { return null; })]).then(function (both) {
      if (state.packaging !== pack) return;
      pack.keyKnown = !!both[0];
      pack.described = both[1] && both[1].value ? { at: both[1].value.describedAt || null } : null;
      render();
    });
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

    var descriptionsPromise = store.get('descriptions', pack.projectId).catch(function () { return null; });
    var triagePromise = store.get('triage', pack.projectId).catch(function () { return null; });
    // The project's key: the one kept here, or — for the first package of this project — a new one, kept
    // before the file is made, so whoever opens it and this browser hold the same key.
    var keyPromise = store.getPackageKey(pack.projectId).then(function (pk) {
      if (pk) return pk;
      return window.MxCrypto.newProjectKey().then(function (made) { return store.putPackageKey(pack.projectId, made, 'made').then(function () { keyInfo = null; return made; }); });
    });

    var code = window.MxCrypto.generateCode();

    Promise.all([modelPromise, findingsPromise, descriptionsPromise, triagePromise, keyPromise, window.MxKnowledge.forPackage(pack.projectId)]).then(function (all) {
      var model = all[0];
      var findings = all[1] || [];
      if (!model) throw new Error('That project’s model is missing from this browser’s storage.');
      var payload = serializeProjectForExport(project, model, findings, pack.includeComments, all[2], all[3], all[5]);
      return window.MxCrypto.pack(payload, code, all[4]).then(function (envelope) {
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

      var V = window.MxModelVersion, ver = project.summary ? project.summary.version : null, at = pack.described && pack.described.at;
      kids = [
        el('h3', { text: 'Package “' + project.name + '” for someone else' }),
        // What it packs: the model's version, and the version its descriptions describe.
        el('p', { class: 'model-version-line pkg-version' }, [el('strong', { text: 'Model: ' }), document.createTextNode(V.label(ver))]),
        pack.described ? el('p', { class: 'hint pkg-described', text: 'With its descriptions' + (at ? ', written for ' + V.short(at) + (V.known(ver) && ver.commit === at.commit ? ' — this version' : V.day(at.date) ? ' (' + V.day(at.date) + ')' : '') : '') + '.' }) : null,
        el('p', { class: 'muted', text: 'The package is encrypted. Whoever receives it needs both the file and an access code — and the whole point is that those two travel separately.' }),
        pack.keyKnown === null ? null : el('p', { class: 'hint pkg-key', 'data-key': pack.keyKnown ? 'known' : 'new', text: pack.keyKnown
          ? 'Anyone who already opened a package of this project opens this one without a code. Someone new needs the access code.'
          : 'The first package of this project: it needs the access code once. Later packages of it open for the same people without one.' }),
        commentCount === null ? null : el('label', { class: 'ack-row' }, [
          includeBox,
          el('span', { text: 'Include the ' + commentCount + ' comment' + (commentCount === 1 ? '' : 's') + ' on this project' })
        ]),
        el('p', { class: 'hint', text: 'The model, the project name, the descriptions an AI agent wrote for it, what was decided about its risks and its solved cases travel inside the encrypted part; performance recordings do not. The file name is the only thing about the contents that is readable without the code — rename it if even that is too much.' }),
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
        'Open MxScout, choose New project, and pick that file. The first time, it asks for an access code — I will send it separately.\n' +
        'If you opened a package of this project before, it opens without one.';

      kids = [
        el('h3', { text: 'Package created' }),
        el('p', { class: 'muted', text: pack.fileName + ' has been downloaded. Now the code — MxScout does not keep it, and there is no way to recover it. A new export means a new code.' }),
        el('p', { class: 'hint pkg-key-done', text: 'Whoever opened a package of this project before opens this one without the code; only someone new needs it.' }),
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

    // Escape cancels only before the package is made: once its access code is on screen, Done says it was read.
    var backdrop = el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop && !pack.busy) close(); }
    }, [window.MxDialog.modal(el('div', { class: 'modal' }, kids), pack.step === 'confirm' ? function () { if (!pack.busy) close(); } : null)]);
    return backdrop;
  }

  // ---------- opening a package: one dialog, both routes in ----------
  // A package can arrive as a new project or as a replacement for one that
  // already exists. The difference is what happens after it opens, not how it
  // opens, so both routes share this. The steps:
  //   trying  — the package names a key this browser keeps: tried first, no code asked;
  //   code    — the access code (no key here, or the key kept does not open it);
  //   compare — opened, for a project that is already here: which is newer, and the person decides;
  //   new     — opened with a kept key, to go in as a project of its own: its name and where to keep it.
  function openPicked(purpose, fileName, envelope, defaults) {
    var unlock = state.unlock = {
      purpose: purpose,                  // 'new' | 'replace'
      projectId: defaults.projectId || null,
      name: defaults.name || fileName.replace(/\.mxscout$/i, ''),
      fileName: fileName,
      envelope: envelope,
      code: '',
      error: null,
      busy: false,
      step: 'code',
      keyNote: null,
      opened: null,   // { payload, by: 'key'|'code', projectKey }
      match: null,    // the project here that keeps this package's key (purpose 'new')
      // A new project goes where New project said — or, opened some other way, a folder is offered first.
      store: purpose === 'new' ? (defaults.store || freshChoice()) : null
    };
    setMessage(null);
    var keyId = window.MxCrypto.keyIdOf(envelope);
    if (!keyId) { render(); return; }
    unlock.step = 'trying';
    render();
    store.projectsWithPackageKey(keyId).then(function (list) {
      if (state.unlock !== unlock) return null;
      list = list.filter(function (x) { return !!findProject(x.projectId); });
      var mine = list.filter(function (x) { return x.projectId === unlock.projectId; })[0];
      var pick = mine || list[0];
      if (!pick) { unlock.step = 'code'; render(); return null; }
      return window.MxCrypto.openWithKey(envelope, pick).then(function (payload) {
        if (state.unlock !== unlock) return;
        modelOf(payload);
        unlock.opened = { payload: payload, by: 'key', projectKey: { id: pick.id, key: pick.key } };
        unlock.match = purpose === 'new' ? pick.projectId : null;
        unlock.step = 'compare';
        render();
      }, function (err) {
        if (state.unlock !== unlock) return;
        var kept = findProject(pick.projectId);
        unlock.step = 'code';
        // The project that names this key is still the one the package is for: opened with the code, it is compared with it.
        if (err && err.wrongKey && purpose === 'new') unlock.match = pick.projectId;
        if (err && err.wrongKey) unlock.keyNote = 'The key this browser keeps for “' + (kept ? kept.name : 'this project') + '” does not open this package, so it needs the access code.';
        else unlock.error = (err && err.message) || 'Could not open that package.';
        render();
      });
    }).catch(function () { if (state.unlock === unlock) { unlock.step = 'code'; render(); } });
  }

  // The model a package carries, checked; throws a sentence when it is not one.
  function modelOf(payload) {
    var model = payload && payload.model;
    if (!model) throw new Error('That package does not contain a model.');
    if (!Array.isArray(model.modules) || !Array.isArray(model.entities)) throw new Error('That package’s model is not in a shape MxScout understands.');
    return model;
  }

  // "This package: main @ a1b2c3d · 14 Oct 2026 — newer than yours (yours: 9f8e7d6 · 10 Oct 2026)."
  function comparison(payload, project) {
    var V = window.MxModelVersion;
    var theirs = V.clean(payload.model.version), mine = project.summary ? project.summary.version : null;
    var c = V.compare(theirs, mine, payload.model.meta && payload.model.meta.generatedAt, project.summary && project.summary.generatedAt);
    var rel = c.rel === 'same' ? 'the same version as yours'
      : c.rel === 'newer' ? (c.by === 'read' ? 'read more recently than yours' : 'newer than yours')
      : c.rel === 'older' ? (c.by === 'read' ? 'read before yours' : 'older than yours')
      : 'MxScout cannot tell which is newer';
    return { rel: c.rel, text: 'This package: ' + V.label(theirs, { noMessage: true, bare: true }) + ' — ' + rel + (c.rel === 'same' ? '' : ' (yours: ' + V.label(mine, { noMessage: true, bare: true }) + ')') + '.' };
  }

  function renderUnlockModal() {
    if (!state.unlock) return null;
    var unlock = state.unlock;
    var close = function () { if (unlock.busy) return; state.unlock = null; render(); };
    var kids;
    if (unlock.step === 'trying') {
      kids = [
        el('h3', { text: 'Opening ' + unlock.fileName + '…' }),
        el('p', { class: 'muted', text: 'This package names a key this browser keeps for one of its projects — trying it, so no code is needed.' })
      ];
    } else if (unlock.step === 'compare') kids = compareKids(unlock, close);
    else if (unlock.step === 'new') kids = newKids(unlock, close);
    else kids = codeKids(unlock, close);
    var backdrop = el('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop) close(); }
    }, [window.MxDialog.modal(el('div', { class: 'modal unlock-modal', 'data-step': unlock.step }, kids.filter(Boolean)), close)]);
    return backdrop;
  }

  function nameField(unlock) {
    var nameInput = el('input', { type: 'text', value: unlock.name, placeholder: 'Project name' });
    nameInput.addEventListener('input', function () { unlock.name = nameInput.value; });
    return el('label', { class: 'field' }, [el('span', { text: 'Project name' }), nameInput]);
  }
  function actions(list) { return el('div', { class: 'modal-actions' }, list.filter(Boolean)); }

  function codeKids(unlock, close) {
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
      if (unlock.purpose === 'new' && !choiceReady(unlock.store)) {
        unlock.error = 'Choose the folder to keep the project in first — or keep it in this browser only.';
        render();
        return;
      }
      unlock.busy = true;
      unlock.error = null;
      render();
      window.MxCrypto.openWithCode(unlock.envelope, code).then(function (r) {
        modelOf(r.payload);
        unlock.opened = { payload: r.payload, by: 'code', projectKey: r.projectKey };
        // Into a project that is already here: say which is newer first, and let the person decide.
        if (unlock.purpose === 'replace' || (unlock.match && findProject(unlock.match))) { unlock.busy = false; unlock.step = 'compare'; render(); return null; }
        return importPayload((unlock.name || '').trim(), r.payload, unlock.envelope, r.projectKey, true).then(opened);
      }).catch(function (err) {
        unlock.busy = false;
        unlock.error = (err && err.message) || 'Could not open that package.';
        render();
      });
    }

    return [
      el('h3', { text: 'This file is encrypted' }),
      el('p', { class: 'muted', text: unlock.fileName + ' is an MxScout package. It opens with the access code from whoever sent it — the code travels separately from the file, so check your other messages if you do not have it.' }),
      unlock.keyNote ? el('p', { class: 'warn-text unlock-key-note', text: unlock.keyNote }) : null,
      unlock.purpose === 'new' ? nameField(unlock) : null,
      unlock.purpose === 'new' ? el('div', { class: 'field' }, [el('span', { text: 'Where to keep it' }), folderChoice(unlock.store)]) : null,
      el('label', { class: 'field' }, [el('span', { text: 'Access code' }), codeInput]),
      unlock.error ? el('p', { class: 'warn-text', text: unlock.error }) : null,
      actions([
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-primary', text: unlock.busy ? 'Opening…' : 'Open', disabled: unlock.busy ? 'disabled' : null, onclick: submit })
      ])
    ];
  }

  // Opened, for a project that is already here — the one Replace model… was for, or the one that keeps this
  // package's key: which is newer, and Update / Replace, or (from New project) Open as a new project.
  function compareKids(unlock, close) {
    var payload = unlock.opened.payload;
    var target = findProject(unlock.purpose === 'replace' ? unlock.projectId : unlock.match);
    if (!target) { unlock.step = unlock.purpose === 'new' ? 'new' : 'code'; return unlock.step === 'new' ? newKids(unlock, close) : codeKids(unlock, close); }
    var cmp = comparison(payload, target);
    var older = cmp.rel === 'older';
    function apply() {
      unlock.busy = true; unlock.error = null; render();
      replaceWithPayload(target.id, payload, unlock.envelope, unlock.opened.projectKey, unlock.opened.by === 'code').then(function (result) {
        state.unlock = null;
        setMessage((unlock.purpose === 'replace' ? 'Model replaced from the package.' : 'Updated “' + target.name + '” from the package.') + ' ' + cmp.text + commentsSaid(result), 'ok');
        render();
      }, function (err) {
        unlock.busy = false;
        unlock.error = (err && err.message) || 'Could not take that package.';
        render();
      });
    }
    var verb = unlock.purpose === 'replace' ? (older ? 'Replace with the older one' : 'Replace model') : (older ? 'Update with the older one' : 'Update “' + target.name + '”');
    return [
      el('h3', { text: unlock.purpose === 'replace' ? 'Replace the model of “' + target.name + '”?' : 'You already have “' + target.name + '”' }),
      unlock.opened.by === 'key' ? el('p', { class: 'ok-text unlock-by-key', text: 'Opened with the key you already have for this project; no code needed.' }) : null,
      el('p', { class: 'unlock-compare', 'data-rel': cmp.rel, text: cmp.text }),
      older ? el('p', { class: 'warn-text', text: 'It is older than the model you have: ' + (unlock.purpose === 'replace' ? 'replacing' : 'updating') + ' puts the older one in its place. Descriptions you have that are newer stay.' }) : null,
      unlock.purpose === 'new' ? el('p', { class: 'muted', text: 'Update it, or open the package as a project of its own.' }) : null,
      unlock.error ? el('p', { class: 'warn-text', text: unlock.error }) : null,
      actions([
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        unlock.purpose === 'new' ? el('button', { class: 'btn', text: 'Open as a new project…', onclick: function () { unlock.step = 'new'; unlock.error = null; render(); } }) : null,
        el('button', { class: 'btn btn-primary', text: unlock.busy ? 'Working…' : verb, disabled: unlock.busy ? 'disabled' : null, onclick: apply })
      ])
    ];
  }

  // Opened with a kept key, going in as a project of its own: only its name and where to keep it.
  function newKids(unlock, close) {
    function submit() {
      if (!choiceReady(unlock.store)) { unlock.error = 'Choose the folder to keep the project in first — or keep it in this browser only.'; render(); return; }
      unlock.busy = true; unlock.error = null; render();
      importPayload((unlock.name || '').trim(), unlock.opened.payload, unlock.envelope, unlock.opened.projectKey).then(opened, function (err) {
        unlock.busy = false;
        unlock.error = (err && err.message) || 'Could not open that package.';
        render();
      });
    }
    return [
      el('h3', { text: 'Open as a new project' }),
      el('p', { class: 'ok-text unlock-by-key', text: 'Opened with the key you already have for this project; no code needed.' }),
      nameField(unlock),
      el('div', { class: 'field' }, [el('span', { text: 'Where to keep it' }), folderChoice(unlock.store)]),
      unlock.error ? el('p', { class: 'warn-text', text: unlock.error }) : null,
      actions([
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-primary', text: unlock.busy ? 'Opening…' : 'Open', disabled: unlock.busy ? 'disabled' : null, onclick: submit })
      ])
    ];
  }

  // A package opened as a new project: opened, and said so.
  function commentsSaid(result) {
    return (result.added || result.updated
      ? ' ' + result.added + ' comment' + (result.added === 1 ? '' : 's') + ' added' + (result.updated ? ', ' + result.updated + ' updated' : '') + '.'
      : '') + (result.cases ? ' ' + (result.cases === 1 ? 'A solved case' : result.cases + ' solved cases') + ' came with it.' : '');
  }
  // The solved cases a package carries, into the project that opened it — each note in the place of the one at
  // its path, the others kept; read by the same rules as one an agent hands in. → how many were taken.
  function storeCases(projectId, payload) {
    return window.MxKnowledge.takeFromPackage(projectId, payload && payload.knowledge).catch(function () { return 0; });
  }
  function opened(result) {
    var by = state.unlock && state.unlock.opened && state.unlock.opened.by === 'key';
    state.unlock = null;
    var extra = commentsSaid(result);
    return openProject(result.record.id).then(function () {
      setMessage('Opened “' + result.record.name + '”.' + extra + (by ? ' No code was needed: this browser keeps the project’s key.' : ''), 'ok');
      render();
    });
  }

  // Deciding what a dropped file actually is, once, so no caller has to.
  // storeBox: where a new project goes, when the caller already asked (New project).
  function handlePickedFile(fileName, text, purpose, projectId, storeBox) {
    if (window.MxCrypto.looksLikePackage(text)) {
      var envelope;
      try { envelope = JSON.parse(text); }
      catch (e) { setMessage('That package file is damaged — it is not readable JSON.', 'error'); render(); return true; }
      // The documentation of several projects (bundle.js) opens as a list of projects, not as one.
      if (window.MxBundle && window.MxBundle.isBundle(envelope) && purpose === 'new') { window.MxBundle.openFile(fileName, envelope); return true; }
      openPicked(purpose, fileName, envelope, { projectId: projectId, name: null, store: storeBox || null });
      return true;
    }
    return false;
  }

  // The project keeps the key the package came with — so its next package opens here without the code,
  // and a package made from here reuses it. A key the code unwrapped (byCode) always replaces the one kept:
  // the kept one may be a wrong key under the same id, which is why the code was asked for. A key that
  // opened the package from here (by key) is kept as it is when the project already has it.
  function keepKey(projectId, projectKey, byCode) {
    if (!projectKey) return Promise.resolve(false);
    return store.getPackageKey(projectId).catch(function () { return null; }).then(function (had) {
      if (had && had.id === projectKey.id && !byCode) return false;
      return store.putPackageKey(projectId, projectKey, 'opened').then(function () { keyInfo = null; return true; });
    }).catch(function () { return false; });
  }

  // The package's descriptions, read as an import reads a file: only what MxDescribe.parse lets through.
  // Into an existing project they go only when it has none, or older ones — a package travels both
  // ways, and what was described here since must not be lost to an older copy.
  function takeDescriptions(projectId, incoming, onlyIfNewer) {
    if (!incoming || !incoming.file) return Promise.resolve(false);
    var parsed = window.MxDescribe.parse(JSON.stringify(incoming.file));
    if (parsed.error) return Promise.resolve(false);
    return (onlyIfNewer ? store.get('descriptions', projectId).catch(function () { return null; }) : Promise.resolve(null)).then(function (local) {
      if (local && (!incoming.importedAt || (local.importedAt && local.importedAt >= incoming.importedAt))) return false;
      return store.put('descriptions', { projectId: projectId, importedAt: incoming.importedAt || new Date().toISOString(), fileName: incoming.fileName || 'from a package', value: parsed.value }).then(function () {
        if (window.MxDocs && window.MxDocs.forgetDescriptions) window.MxDocs.forgetDescriptions(projectId);
        return true;
      });
    });
  }

  function replaceWithPayload(id, payload, envelope, projectKey, byCode) {
    var project = findProject(id);
    if (!project) return Promise.reject(new Error('That project no longer exists.'));
    var model;
    try { model = modelOf(payload); } catch (e) { return Promise.reject(e); }
    var updated = {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
      source: { kind: 'package', fileName: null, packagedAt: envelope.createdAt || null },
      bytes: JSON.stringify(model).length,
      summary: summarize(model),
      appUrl: project.appUrl || null,
      // The project's own settings stay: a package brings a model and descriptions, not settings.
      showMarketplaceModules: project.showMarketplaceModules || false,
      agentAutoSave: project.agentAutoSave,
      contentLanguage: project.contentLanguage || null
    };
    return store.saveProjectWithModel(updated, model).then(function () {
      return takeDescriptions(id, payload.descriptions, true);
    }).then(function () {
      // Per risk, the decision made last wins: a package travels both ways.
      return window.MxTriage.takeFromPackage(id, payload.triage);
    }).then(function () {
      return keepKey(id, projectKey, byCode);
    }).then(function () { return storeCases(id, payload); }).then(function (cases) {
      var i = state.projects.indexOf(project);
      if (i !== -1) state.projects[i] = updated;
      if (state.activeId === id && state.detail) {
        state.detail.rawModel = model;
        state.detail.model = withBuiltinSystemModule(model);
      }

      var incoming = Array.isArray(payload.findings) ? payload.findings : [];
      if (!incoming.length) return { record: updated, added: 0, updated: 0, cases: cases };
      return store.byIndex('findings', 'byProject', id).then(function (existing) {
        var merged = window.MxComments.merge(existing, incoming, id);
        return store.putMany('findings', merged.merged).then(function () {
          if (state.activeId === id) return window.MxComments.loadFindings(id).then(function () {
            return { record: updated, added: merged.added, updated: merged.updated, cases: cases };
          });
          return { record: updated, added: merged.added, updated: merged.updated, cases: cases };
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
  function importPayload(name, payload, envelope, projectKey, byCode) {
    return Promise.resolve().then(function () {
      var model = modelOf(payload);
      var now = new Date().toISOString();
      var record = {
        id: newId(),
        name: name || (payload.project && payload.project.name) || 'Imported project',
        createdAt: now,
        updatedAt: now,
        source: { kind: 'package', fileName: null, packagedAt: envelope.createdAt || null },
        bytes: JSON.stringify(model).length,
        summary: summarize(model),
        // The language its descriptions were written in becomes the project's (docs.js noteLanguage).
        contentLanguage: window.MxDescribe.languageCode(payload.descriptions && payload.descriptions.file && payload.descriptions.file.language) || window.MxDocs.defaultLanguage() || null
      };
      return store.saveProjectWithModel(record, model).then(function () {
        return takeDescriptions(record.id, payload.descriptions, false);
      }).then(function () {
        return window.MxTriage.takeFromPackage(record.id, payload.triage);
      }).then(function () {
        return keepKey(record.id, projectKey, byCode);
      }).then(function () { return storeCases(record.id, payload); }).then(function (cases) {
        var incoming = Array.isArray(payload.findings) ? payload.findings : [];
        if (!incoming.length) return { record: record, added: 0, updated: 0, cases: cases };
        var merged = window.MxComments.merge([], incoming, record.id);
        return store.putMany('findings', merged.merged).then(function () {
          return { record: record, added: merged.added, updated: merged.updated, cases: cases };
        });
      }).then(function (result) {
        state.projects.push(record);
        sortProjects();
        // Into the folder chosen for it, at once: the model, the descriptions and the solved cases the package carried.
        return linkNewProject(record, state.unlock && state.unlock.store).then(function () { return result; });
      });
    });
  }

  // ---------- the project's key, in its Settings ----------
  // Whether packages of this project open here without the code, and the way to require it again.
  var keyInfo = null; // { projectId, key: null | { how, savedAt } } — read once per project shown
  function keyCard(project) {
    if (!keyInfo || keyInfo.projectId !== project.id) {
      var mine = keyInfo = { projectId: project.id, loading: true, key: null };
      store.getPackageKey(project.id).catch(function () { return null; }).then(function (pk) {
        if (keyInfo !== mine) return;
        mine.loading = false;
        mine.key = pk ? { how: pk.how, savedAt: pk.savedAt } : null;
        render();
      });
    }
    var info = keyInfo;
    if (info.loading) return el('div', { class: 'card pkg-key-card', 'data-key': 'loading' }, [el('h3', { class: 'live-h', text: 'Packages' })]);
    function forget() {
      store.forgetPackageKey(project.id).then(function () {
        keyInfo = null;
        setMessage('This browser no longer keeps the key of “' + project.name + '”. Its next package asks for the access code.', 'ok');
        render();
      }, function (err) { setMessage('Could not forget the key: ' + ((err && err.message) || err), 'error'); render(); });
    }
    return el('div', { class: 'card pkg-key-card', 'data-key': info.key ? 'kept' : 'none' }, info.key ? [
      el('h3', { class: 'live-h', text: 'Packages' }),
      el('p', { class: 'muted', text: 'This browser keeps the project’s package key, so packages of this project open here without the access code — whoever made them. It came ' +
        (info.key.how === 'made' ? 'with the first package made here' : 'with a package opened here with the code') + (info.key.savedAt ? ', ' + String(info.key.savedAt).slice(0, 10) : '') + '.' }),
      el('div', { class: 'docs-agent-act' }, [el('button', { class: 'btn btn-sm btn-danger-outline', text: 'Forget this project’s key', onclick: forget })]),
      el('p', { class: 'hint', text: 'Then the next package of this project asks for the code again, and the next one you make starts a new key: people who opened earlier packages need the code once more.' })
    ] : [
      el('h3', { class: 'live-h', text: 'Packages' }),
      el('p', { class: 'muted', text: 'No package key yet. The first package you make of this project, or open into it with the access code, keeps one here — later packages of the project then open without the code.' })
    ]);
  }

  window.MxTransfer = {
    init: init,
    keyCard: keyCard,
    startPackaging: startPackaging,
    renderPackagingModal: renderPackagingModal,
    renderUnlockModal: renderUnlockModal,
    // Returns true when the file WAS a package and the code dialog is now up,
    // so the caller knows not to try reading it as plain JSON.
    handlePickedFile: handlePickedFile
  };
})();
