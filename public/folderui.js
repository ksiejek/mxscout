/* MxScout — keeping projects in folders: the dialogs.
 *
 * What a person does with a project folder, as screens: choosing where a new
 * project (or a project arriving in a .mxscout package) is kept — a folder
 * first, the browser alone second; "Keep in a folder…" for a project that is
 * only in this browser ("Keep in the Mendix project (mxscout/)…" is repoui.js's);
 * "Open a project folder…" for a folder that already
 * holds an MxScout project (from git, or another machine); "Move all projects
 * to folders…"; and "Reconnect the folder" when the browser needs the
 * person's permission again.
 *
 * It also takes in what someone else changed in a project's folder (adopt,
 * handed to store.js), says what store.js reports about a folder, and makes
 * Developer tools' comments.json and triage.json (files).
 *
 * The files themselves are written by store.js through folder.js — nothing
 * here writes a file. Every pick is the person's own click: a browser opens a
 * directory picker, and asks for permission again, only from a user gesture.
 */
(function () {
  'use strict';

  var app = null; // { el, state, store, render, setMessage, findProject, openProject, summarize, sortProjects, newId, docs, finishReplacingProject, deriveModel, nameMax }
  var F = null;

  // The project kept inside the Mendix project (repoui.js) gets the same dependencies.
  function init(api) { app = api; F = window.MxFolder; if (window.MxRepoUI) window.MxRepoUI.init(api); }

  function supported() { return F.supported(); }
  function cancelled(err) { return err && err.name === 'AbortError'; }
  function say(text, kind, action) { app.setMessage(text, kind, action); app.render(); }

  // ---------- where a project goes ----------
  // A picked folder, judged: an empty one is used as it is; one holding THIS project too; one holding
  // another MxScout project is refused; one holding other files (the Mendix project, a repository)
  // gets a folder of MxScout's own inside it, named from the project — made when the project is.
  function judge(handle, projectId) {
    return F.inspect(handle).then(function (what) {
      if (what.kind === 'empty') return { handle: handle };
      if (what.kind === 'project') {
        if (what.project && what.project.id === projectId) return { handle: handle, same: true };
        throw new Error('That folder already holds an MxScout project' + (what.project ? ', "' + what.project.name + '"' : '') +
          '. Choose an empty folder, or one of your own for MxScout to make a folder in — and open that project with Open a project folder….');
      }
      return { handle: handle, inside: true };
    });
  }
  function settle(target, name, projectId) {
    if (!target.inside) return Promise.resolve({ handle: target.handle, note: null });
    return F.childFor(target.handle, name, projectId).then(function (sub) {
      return { handle: sub, note: 'That folder holds other files, so MxScout made one of its own inside it: ' + target.handle.name + '/' + sub.name + '.' };
    });
  }

  // The choice on New project and on opening a package: a folder (recommended, first) or this
  // browser only — and, on New project (withRepo), first of all inside the Mendix project picked below,
  // in mxscout/ (repoui.js). `box` is the caller's own state: { mode, repo, target, name, error }.
  function freshChoice(withRepo) {
    var r = !!withRepo && supported();
    // With the MxScout folder set (store.js home), a project goes there unless it goes into its Mendix project.
    return { mode: supported() ? (r ? 'repo' : app.store.homeHandle() ? 'home' : 'folder') : 'browser', repo: r, skills: true, target: null, name: null, error: null };
  }
  var asked = null; // the choice last checked before a model was picked: whose mode the import follows
  function lastBox() { return asked; }
  function choice(box) {
    var el = app.el;
    if (!supported()) {
      return el('p', { class: 'hint store-choice-none', text: 'Kept in this browser’s own database. Keeping a project in a folder on disk needs the File System Access API, which Chrome and Edge have and this browser does not.' });
    }
    function opt(mode, title, sub) {
      var on = box.mode === mode;
      return el('button', { type: 'button', class: 'store-opt' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-mode': mode,
        onclick: function () { box.mode = mode; box.error = null; app.render(); } }, [el('strong', { text: title }), el('span', { class: 'muted', text: sub })]);
    }
    var home = app.store.homeHandle();
    var kids = [el('div', { class: 'store-opts' }, [
      box.repo ? opt('repo', 'In the Mendix project (mxscout/) — recommended', 'Shared with your team through the app’s own git: the documentation goes into mxscout/ inside the Mendix project folder you choose below; what is yours — the model’s copy, Assist — into ' + (home ? 'your MxScout folder, ' + home.name : 'your MxScout folder once you set one (else mxscout/.local/, which git ignores)') + '.') : null,
      home ? opt('home', 'In your MxScout folder' + (box.repo ? '' : ' — recommended'), 'A folder of its own in ' + home.name + ', where you keep all your projects — and where Claude finds them (/mxscout-project).') : null,
      opt('folder', 'In a folder on disk' + (box.repo || home ? '' : ' — recommended'), home ? 'Somewhere else you choose.' : 'Plain files an agent reads directly; keep them beside the Mendix project or in git.'),
      opt('browser', 'In this browser only', 'In this browser’s own database, as before.')
    ].filter(Boolean))];
    if (!home) kids.push(homeLine(function () { box.mode = box.repo ? 'repo' : 'home'; }));
    // Inside the Mendix project: the Claude skills too, unless the person says no.
    if (box.mode === 'repo') {
      var sk = el('input', { type: 'checkbox', class: 'repo-skills-choice' });
      sk.checked = box.skills !== false;
      sk.addEventListener('change', function () { box.skills = sk.checked; });
      kids.push(el('label', { class: 'store-skills' }, [sk, document.createTextNode(' Add the Claude skills to this project (.claude/skills) — teammates get them with the next pull')]));
    }
    if (box.mode === 'folder') {
      kids.push(el('div', { class: 'store-folder' }, [
        el('button', { type: 'button', class: 'btn btn-sm store-pick', text: box.target ? 'Choose another folder…' : 'Choose a folder…', onclick: function () {
          F.pick().then(function (h) { return judge(h, null); }).then(function (t) {
            box.target = t; box.name = t.handle.name; box.error = null; app.render();
          }, function (err) { if (!cancelled(err)) { box.error = (err && err.message) || String(err); app.render(); } });
        } }),
        el('span', { class: box.target ? 'store-picked' : 'muted', text: box.target ? box.name + (box.target.inside ? ' — MxScout makes a folder of its own inside it' : '') : 'Not chosen yet' })
      ]));
      if (box.error) kids.push(el('p', { class: 'warn-text', text: box.error }));
    }
    return el('div', { class: 'store-choice' }, kids);
  }
  // Whether the choice is complete: a folder chosen, or the browser.
  function choiceReady(box) { asked = box || null; return !box || (box.mode === 'home' ? !!app.store.homeHandle() : box.mode !== 'folder' || !!box.target) || !supported(); }
  // On New project with "In the Mendix project" chosen: a JSON file or a package has no Mendix project to go into.
  function repoFileNote() {
    return app.el('p', { class: 'hint repo-file-note', text: 'A model exported as JSON, or a .mxscout package, has no Mendix project folder beside it: to start from one, choose another place to keep the project.' });
  }
  function choiceHint(box) {
    return box.mode === 'repo' ? 'Nothing here is uploaded anywhere — it is read in this browser and kept in mxscout/ inside the Mendix project, and in this browser’s own database, on this machine. MxScout never runs git: you commit and push.'
      : box.mode === 'folder' && supported() ? 'Nothing here is uploaded anywhere — it is read in this browser and kept in the folder you choose, and in this browser’s own database, on this machine.'
      : 'Nothing here is uploaded anywhere — it is read in this browser and saved to this browser’s own database on this machine.';
  }

  // A project just created (New project, a package): written into the folder that was chosen for it.
  // Never fails the creation: the project is in this browser either way, and a folder that could
  // not be written is said in a notice that stays until it is read (state.folderNotice).
  function linkNew(record, box) {
    if (box && box.mode === 'repo') {
      return window.MxRepoUI.linkNew(record, box.skills).catch(function (err) {
        app.state.folderNotice = 'The project is in this browser only: ' + ((err && err.message) || err) + ' Try Keep in a folder… from the project’s menu, or start again from the Mendix project folder.';
        return null;
      });
    }
    if (box && box.mode === 'home' && app.store.homeHandle()) {
      return intoParent(app.store.homeHandle(), record).then(function (name) { return 'Kept in your MxScout folder, ' + app.store.homeHandle().name + '/' + name + '.'; }).catch(function (err) {
        app.state.folderNotice = 'The project is in this browser, but its folder could not be written: ' + ((err && err.message) || err) + ' Try Keep in a folder… from the project’s menu.';
        return null;
      });
    }
    if (!box || box.mode !== 'folder' || !box.target) return Promise.resolve(null);
    return settle(box.target, record.name, record.id).then(function (t) {
      return app.store.linkFolder(record.id, t.handle).then(function () {
        return 'Kept in the folder ' + t.handle.name + (t.note ? ' (' + t.note + ')' : '') + '.';
      });
    }).catch(function (err) {
      app.state.folderNotice = 'The project is in this browser, but its folder could not be written: ' + ((err && err.message) || err) + ' Try Keep in a folder… from the project’s menu.';
      return null;
    });
  }

  // ---------- an existing project ----------
  // Every file is written into the folder first; only then is the project linked to it.
  function derivedOf(project, model, rec) {
    try { return app.docs.derivedFor(model, project, rec); } catch (e) { return {}; }
  }
  function writeInto(project, handle) {
    return Promise.all([app.store.getModel(project.id), app.store.get('descriptions', project.id).catch(function () { return null; })]).then(function (both) {
      if (!both[0]) throw new Error('its model is missing from this browser’s storage.');
      return app.store.linkFolder(project.id, handle, { derived: derivedOf(project, both[0], both[1]) });
    });
  }
  // ---------- the MxScout folder (store.js home; Karol, 2026-10-16) ----------
  // One folder, set once, where every project is kept — a folder of its own each — and, for one kept in its
  // Mendix project, what is not the team's. Set in Settings (settings.js); offered on New project; Change… picks another.
  function chooseHome(after) {
    F.pick().then(function (h) { return app.store.setHome(h); }).then(function (info) {
      if (after) after();
      say('Your MxScout folder is ' + info.name + '. New projects go there, a folder of their own each; a project kept in its Mendix project keeps what is yours there too. Tell Claude once: /mxscout-project asks for it.', 'ok');
    }, function (err) { if (!cancelled(err)) say((err && err.message) || String(err), 'error'); });
  }
  function homeLine(after) {
    var el = app.el, h = app.store.homeHandle();
    if (!supported()) return null;
    return el('div', { class: 'home-line', 'data-home': h ? 'set' : 'none' }, [
      el('span', { class: 'home-label', text: 'MxScout folder' }),
      el('strong', { class: 'home-name', text: h ? h.name : 'not set' }),
      el('button', { type: 'button', class: 'btn btn-sm home-pick', text: h ? 'Change…' : 'Choose…', title: 'The one folder where MxScout keeps your projects, a folder of their own each', onclick: function () { chooseHome(after); } }),
      h ? null : el('span', { class: 'muted home-hint', text: 'Set it once: every project goes there, and nothing of yours goes into a Mendix project.' })
    ].filter(Boolean));
  }

  // A library of projects (bundle.js, Karol 2026-10-16): one parent folder, picked once; a project goes into a
  // folder of its own in it, named from the project, and is linked to it — as Move all projects to folders does.
  function pickParent() { return F.pick(); }
  function intoParent(parent, project) {
    return F.childFor(parent, project.name, project.id).then(function (sub) { return writeInto(project, sub).then(function () { return sub.name; }); });
  }
  // Keep a project in the MxScout folder, a folder of its own there — no folder to pick (the Documentation page).
  function keepInHome(project) {
    var h = app.store.homeHandle();
    if (!project || !h) return;
    say('Writing "' + project.name + '" into ' + h.name + '…', 'ok');
    intoParent(h, project).then(function (name) { say('"' + project.name + '" is kept in your MxScout folder, ' + h.name + '/' + name + '.', 'ok'); },
      function (err) { say('It could not be written there: ' + ((err && err.message) || err), 'error'); });
  }
  function keep(project) {
    if (!project) return;
    if (!supported()) { say('This browser cannot keep a project in a folder — that needs Chrome or Edge.', 'error'); return; }
    F.pick().then(function (h) { return judge(h, project.id); }).then(function (t) {
      return settle(t, project.name, project.id).then(function (where) {
        say('Writing "' + project.name + '" into ' + where.handle.name + '…', 'ok');
        return writeInto(project, where.handle).then(function () {
          say('"' + project.name + '" is kept in the folder ' + where.handle.name + (where.note ? ' — ' + where.note : '') + '. MxScout writes it there as you work.', 'ok');
        });
      });
    }).catch(function (err) {
      if (cancelled(err)) return;
      say('Not kept in a folder: ' + ((err && err.message) || err) + ' The project is unchanged in this browser.', 'error');
    });
  }

  function reconnect(project) {
    if (!project) return;
    app.store.syncFolder(project.id, true).then(function (info) {
      if (!info) return;
      if (info.status === 'connected') say('The folder ' + info.name + ' is connected again' + (info.pending.length ? '' : ' and up to date') + '.', 'ok');
      else if (info.status === 'needs-permission') say('The browser did not allow MxScout to write ' + info.name + '. The project keeps working in this browser.', 'error');
      else if (info.status === 'missing') say('The folder ' + info.name + ' is not where it was. Choose it again from the project’s Documentation → Write with Claude.', 'error');
      else say('The folder ' + info.name + ' still cannot be written: ' + (info.error || info.status) + '.', 'error');
    });
  }

  function unkeep(project) {
    var info = app.store.folderInfo(project.id);
    app.store.unlinkFolder(project.id).then(function () {
      say('"' + project.name + '" is no longer kept in ' + (info ? info.name : 'its folder') + '. The files there stay as they are; this browser keeps the project.', 'ok');
    });
  }

  // ---------- opening a folder that holds a project ----------
  function openFolder() {
    if (!supported()) { say('This browser cannot open a project folder — that needs Chrome or Edge.', 'error'); return; }
    var handle;
    F.pick().then(function (h) { handle = h; return repoFolder(h); }).then(function (routed) {
      if (routed) return null;
      return app.store.readFolderProject(handle).then(function (read) {
        if (read.project && read.project.part === 'local') throw new Error('That folder is the part of a project that stays on this machine; the project itself is kept in its Mendix project. Open the Mendix project folder (the one with the .mpr) instead.');
        if (app.findProject(read.project.id)) { app.state.folderClash = { handle: handle, read: read }; app.render(); return null; }
        return adopt(handle, read, false);
      });
    }).catch(function (err) {
      if (cancelled(err)) return;
      say((err && err.message) || String(err), 'error');
    });
  }
  // A Mendix project's directory with MxScout's files in mxscout/ opens the way New project opens it: the
  // model read from the .mpr, the project linked to mxscout/. mxscout/ picked itself cannot be: the browser
  // cannot reach the .mpr beside it from there.
  function repoFolder(h) {
    return F.inspectRepo(h).then(function (r) {
      if (r.mpr && r.mxscout && (r.project || r.error)) {
        if (r.error) throw new Error('That Mendix project’s mxscout/ cannot be opened: ' + r.error);
        app.state.newProject.open = false;
        window.MxMprImport.open();
        window.MxMprImport.handleDirectoryHandle(h);
        return true;
      }
      if (r.mpr && !r.mxscout) throw new Error('That is a Mendix project folder without MxScout’s files in it (no mxscout/). Start it with New project → Choose the Mendix project folder.');
      return F.readFile(h, 'mxscout.json').then(function (f) {
        if (f) throw new Error('That is the mxscout/ folder inside a Mendix project. Choose the Mendix project folder itself — the one with the .mpr — so MxScout can read the model beside it.');
        return false;
      });
    });
  }
  // A new project in this browser from what the folder holds, linked to it.
  function adopt(handle, read, asNew) {
    var pj = read.project, now = new Date().toISOString();
    var id = asNew ? app.newId() : pj.id;
    var settings = pj.settings || {};
    var record = {
      id: id, name: pj.name + (asNew ? '' : ''), createdAt: pj.createdAt || now, updatedAt: pj.updatedAt || now,
      source: pj.source || { kind: 'folder', fileName: null }, fileName: (pj.source && pj.source.fileName) || null,
      bytes: read.bytes || 0, summary: app.summarize(read.model),
      showMarketplaceModules: !!settings.showMarketplaceModules, agentAutoSave: settings.agentAutoSave !== false,
      contentLanguage: window.MxDescribe.languageCode(pj.contentLanguage) || window.MxDocs.defaultLanguage() || null
    };
    var descRow = null;
    if (read.descriptions) {
      var parsed = window.MxDescribe.parse(read.descriptions);
      if (parsed.error) say('descriptions.json in that folder could not be read, so the project opens without descriptions: ' + parsed.error, 'error');
      else descRow = { projectId: id, importedAt: (pj.descriptions && pj.descriptions.importedAt) || now, fileName: (pj.descriptions && pj.descriptions.from) || 'descriptions.json in the project’s folder', value: parsed.value };
    }
    return app.store.saveProjectWithModel(record, read.model, { mirror: false })
      .then(function () { return descRow ? app.store.put('descriptions', descRow) : null; })
      .then(function () { return read.assist && read.assist.length ? adoptAssist(id, read.assist, false) : null; })
      // One folder, one project: a project here that was kept in this folder lets go of it.
      .then(function () { return asNew ? app.store.linkedTo(handle).then(function (ids) { return Promise.all(ids.map(function (x) { return app.store.unlinkFolder(x); })); }) : null; })
      .then(function () { return app.store.openFolder(id, handle, { wrote: read.wrote, pending: asNew ? ['project.json', 'README.md'] : [] }); })
      .then(function () {
        app.state.projects.push(record);
        app.sortProjects();
        if (app.docs.forgetDescriptions) app.docs.forgetDescriptions(id);
        app.state.newProject.open = false;
        return app.openProject(id);
      })
      .then(function () { say('Opened "' + record.name + '" from the folder ' + handle.name + (asNew ? ', as a new project' : '') + '. MxScout keeps writing it there.', 'ok'); });
  }

  // The folder holds a project this browser already has: link that one to the folder (the folder's
  // files win, as on any open), or open the folder as a new project of its own.
  function renderClash() {
    var c = app.state.folderClash;
    if (!c) return window.MxRepoUI ? window.MxRepoUI.renderClash() : null;
    var el = app.el;
    var here = app.findProject(c.read.project.id);
    function close() { app.state.folderClash = null; app.render(); }
    function done(p) { app.state.folderClash = null; app.render(); return p.catch(function (err) { say((err && err.message) || String(err), 'error'); }); }
    return el('div', { class: 'modal-backdrop' }, [window.MxDialog.modal(el('div', { class: 'modal folder-clash', 'aria-label': 'This project is already here' }, [
      el('h3', { text: 'This project is already in this browser' }),
      el('p', { text: 'The folder ' + c.handle.name + ' holds "' + c.read.project.name + '", and this browser has the same project' + (here ? ', "' + here.name + '"' : '') + '.' }),
      el('p', { class: 'muted', text: 'Link it: the project here is kept in that folder from now on, and what the folder holds wins — its model and descriptions are taken in, the descriptions with Undo. Open as a new project: a second project, with its own id, kept in that folder; the one here stays as it is.' }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn', text: 'Open as a new project', onclick: function () { done(adopt(c.handle, c.read, true)); } }),
        el('button', { class: 'btn btn-primary', text: 'Link it', onclick: function () {
          var id = c.read.project.id;
          done(app.store.openFolder(id, c.handle, { wrote: {} }).then(function () { return app.openProject(id); }).then(function () {
            say('"' + here.name + '" is kept in the folder ' + c.handle.name + ' now; what the folder held was taken in.', 'ok');
          }));
        } })
      ])
    ]), close)]);
  }

  // ---------- moving every project ----------
  // One parent folder picked once; each project gets a folder of its own in it, named from the
  // project. One at a time; a failure on one is reported and the others go on. A project is linked
  // only once all its files are written, so a failed one is exactly as it was, in this browser.
  function startMoveAll() {
    app.state.moveAll = { step: 'intro', parent: null, rows: app.state.projects.map(function (p) {
      var info = app.store.folderInfo(p.id);
      return { id: p.id, name: p.name, state: info ? 'skipped' : 'waiting', folder: info ? info.name : null, error: null };
    }) };
    app.render();
  }
  function runMoveAll() {
    var m = app.state.moveAll;
    // Into the MxScout folder when one is set: the one place every project is kept.
    (app.store.homeHandle() ? Promise.resolve(app.store.homeHandle()) : F.pick()).then(function (parent) {
      m.parent = parent; m.step = 'running'; app.render();
      return m.rows.reduce(function (p, row) {
        return p.then(function () {
          if (row.state !== 'waiting') return null;
          var project = app.findProject(row.id);
          if (!project) { row.state = 'failed'; row.error = 'no longer in this browser'; return null; }
          row.state = 'writing'; app.render();
          return F.childFor(parent, project.name, project.id).then(function (sub) {
            row.folder = sub.name;
            return writeInto(project, sub);
          }).then(function () { row.state = 'done'; }, function (err) { row.state = 'failed'; row.error = (err && err.message) || String(err); })
            .then(function () { app.render(); return new Promise(function (r) { setTimeout(r, 0); }); });
        });
      }, Promise.resolve());
    }).then(function () { if (m.step === 'running') { m.step = 'done'; app.render(); } }, function (err) {
      if (!cancelled(err)) { m.error = (err && err.message) || String(err); app.render(); }
    });
  }
  function renderMoveAll() {
    var m = app.state.moveAll;
    if (!m) return null;
    var el = app.el;
    var counts = { done: 0, failed: 0, skipped: 0, waiting: 0 };
    m.rows.forEach(function (r) { counts[r.state] = (counts[r.state] || 0) + 1; });
    var label = { waiting: 'waiting', writing: 'writing…', done: 'kept in ', failed: 'failed — ', skipped: 'already in a folder: ' };
    var kids = [
      el('h3', { text: 'Move all projects to folders' }),
      el('p', { class: 'muted', text: 'Choose one folder; each project gets a folder of its own inside it, named from the project, with everything this browser holds for it — the model, the descriptions with their changes and tickets, the comments, what was decided about the risks, the documentation and the AI pack (a performance recording stays here). A project is linked to its folder only once all of it is written; one that fails stays exactly as it is, in this browser.' }),
      el('p', { class: 'hint move-all-team', text: 'Each goes into a folder of its own. A project your team shares belongs inside its Mendix project instead: open it and choose Keep in the Mendix project (mxscout/)… from its menu.' }),
      el('p', { class: 'hint', text: 'This moves the projects this browser keeps for this address (127.0.0.1 and its port). An MxScout started on another port keeps its own projects, and moves them itself.' }),
      el('div', { class: 'move-rows' }, m.rows.map(function (r) {
        return el('div', { class: 'move-row', 'data-state': r.state }, [
          el('strong', { text: r.name }),
          el('span', { class: r.state === 'failed' ? 'warn-text' : r.state === 'done' ? 'ok-text' : 'muted',
            text: label[r.state] + (r.state === 'done' || r.state === 'skipped' ? (r.folder || '') : r.state === 'failed' ? r.error : '') })
        ]);
      }))
    ];
    if (m.error) kids.push(el('p', { class: 'warn-text', text: m.error }));
    if (m.step === 'done') kids.push(el('p', { class: counts.failed ? 'warn-text move-summary' : 'ok-text move-summary',
      text: plural(counts.done, 'project', 'projects') + ' moved' + (counts.failed ? ', ' + counts.failed + ' failed (still in this browser — try again with Keep in a folder…)' : '') + (counts.skipped ? ', ' + counts.skipped + ' already in a folder' : '') + '.' }));
    var close = function () { if (m.step === 'running') return; app.state.moveAll = null; app.render(); };
    kids.push(el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', text: m.step === 'done' ? 'Close' : 'Cancel', disabled: m.step === 'running' ? 'disabled' : null, onclick: close }),
      m.step === 'intro' ? el('button', { class: 'btn btn-primary', text: 'Choose the folder…', disabled: counts.waiting ? null : 'disabled', onclick: runMoveAll }) : null
    ]));
    return el('div', { class: 'modal-backdrop' }, [window.MxDialog.modal(el('div', { class: 'modal modal-wide move-all', 'aria-label': 'Move all projects to folders' }, kids), close)]);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------- what changed in a folder, and what store.js says about one ----------
  // What someone else wrote into a project's folder since MxScout last did (store.js syncFolder): the
  // folder wins. project.json gives the name and settings, model.json the model, descriptions.json
  // the descriptions (docs.js, saved with Undo). A file MxScout cannot read is said, and this
  // browser's copy stays.
  function adoptChanges(id, changed) {
    var project = app.findProject(id);
    if (!project) return null;
    var work = Promise.resolve();
    // The app is drawn again only when something here changed what it shows. A file that was only touched,
    // or written again with what this browser already holds (an agent saving descriptions/ as they were),
    // changes nothing on screen — and every drawing used to send the page being read back to its top
    // (Karol, 2026-10-15). What takes something in (descriptions, Assist items, solved cases) draws it itself.
    var drew = false;
    if (changed['project.json']) {
      var pj = window.MxFolder.parseProject(changed['project.json']).value;
      if (pj && pj.id === id) {
        // A setting is taken from the file when the FILE changed it — it differs from the file as MxScout last
        // wrote or read it (changed.projectBase) — not merely when it differs from this browser's. A setting the
        // person just changed here, not written yet, is still the old value in the file, and taking that undid
        // their choice (the language "reset", Karol, 2026-10-15). Without a known base, the folder wins unless this
        // browser's settings wait to be written. Kept here, they are written over the file next.
        var base = changed.projectBase || {}, bp = base.text ? window.MxFolder.parseProject(base.text).value : null;
        var bst = (bp && bp.settings) || {}, st = pj.settings || {}, moved = false, mine = false;
        var take = function (theirs, was, ours) {
          if (theirs === ours) return false;
          // Theirs when the file moved it and this browser has no unwritten change of its own to it; ours otherwise.
          var ok = bp ? theirs !== was && !(base.pending && ours !== was) : !base.pending;
          if (!ok) mine = true;
          return ok;
        };
        var name = typeof pj.name === 'string' && pj.name.trim() ? pj.name.trim().slice(0, app.nameMax) : null;
        if (name && take(name, bp && typeof bp.name === 'string' ? bp.name.trim().slice(0, app.nameMax) : null, project.name)) { project.name = name; moved = true; }
        if (typeof st.agentAutoSave === 'boolean' && take(st.agentAutoSave, bst.agentAutoSave, project.agentAutoSave !== false)) { project.agentAutoSave = st.agentAutoSave; moved = true; }
        var lang = window.MxDescribe.languageCode(pj.contentLanguage);
        if (lang && take(lang, bp ? window.MxDescribe.languageCode(bp.contentLanguage) : null, project.contentLanguage || null)) { project.contentLanguage = lang; moved = true; }
        if (typeof st.showMarketplaceModules === 'boolean' && take(st.showMarketplaceModules, bst.showMarketplaceModules, !!project.showMarketplaceModules)) {
          project.showMarketplaceModules = st.showMarketplaceModules; moved = true;
          if (app.state.detail && app.state.activeId === id) { app.state.detail.showMarketplaceModules = st.showMarketplaceModules; app.state.detail.model = app.deriveModel(app.state.detail.rawModel, st.showMarketplaceModules); }
        }
        if (moved) drew = true;
        if (moved || mine) work = work.then(function () { app.sortProjects(); return app.store.put('projects', project); });
      }
    }
    if (changed['model.json']) {
      work = work.then(function () {
        var text = changed['model.json'], model;
        try { model = JSON.parse(text); } catch (e) { model = null; }
        if (!model || !Array.isArray(model.modules) || !Array.isArray(model.entities)) {
          drew = true;
          app.setMessage('model.json in the project’s folder could not be read as a Mendix model, so this browser’s model stays.', 'error');
          return null;
        }
        return app.store.getModel(id).then(function (mine) {
          if (mine && JSON.stringify(mine) === text) return null;
          drew = true;
          return app.finishReplacingProject(id, project.source, model, { mirror: false }).then(function () {
            app.docs.forgetDescriptions(id);
            app.setMessage('Took model.json from the project’s folder — it was newer than this browser’s copy.', 'ok');
          });
        });
      });
    }
    var repo = (app.store.folderInfo(id) || {}).layout === 2;
    if (changed.repoError) work = work.then(function () { drew = true; app.setMessage('mxscout/' + changed.repoError.replace(/^descriptions\//, 'descriptions/') + ', so this browser’s descriptions stay.', 'error'); });
    if (changed['descriptions.json']) work = work.then(function () { return app.docs.adoptFolderDescriptions(app.findProject(id), changed['descriptions.json'], repo ? 'mxscout/descriptions/' : null); });
    if (changed['assist/']) work = work.then(function () { return adoptAssist(id, changed['assist/'], true); });
    if (changed['knowledge/']) work = work.then(function () { return adoptKnowledge(id, changed['knowledge/']); });
    // Developer tools: comments merge by id, the newest change winning, and decisions about risks per
    // risk, the latest winning — the rules a package arrives by, so nothing kept here is lost.
    if (changed['comments.json']) {
      work = work.then(function () {
        var c;
        try { c = JSON.parse(changed['comments.json']); } catch (e) { c = null; }
        if (!c || c.format !== 'mxscout-comments' || !Array.isArray(c.comments)) { drew = true; app.setMessage('comments.json in the project’s folder could not be read, so this browser’s comments stay as they are.', 'error'); return null; }
        return app.store.byIndex('findings', 'byProject', id).then(function (existing) {
          var merged = window.MxComments.merge(existing, c.comments, id);
          if (!merged.added && !merged.updated) return null;
          drew = true;
          return app.store.putMany('findings', merged.merged).then(function () {
            if (app.state.activeId === id) return window.MxComments.loadFindings(id);
            return null;
          }).then(function () {
            // The descriptions taken just before are said with their Undo: that message stays.
            if (!(app.state.message && app.state.message.action)) app.setMessage('Took comments.json from the project’s folder: ' + merged.added + ' new, ' + merged.updated + ' updated.', 'ok');
          });
        });
      });
    }
    // Developer tools, inside the Mendix project: a comment whose file a teammate deleted (and a pull brought that) goes
    // here too — unless it was changed here since that file was last written or read; then it stays, and is written back.
    if (changed['comments-removed']) {
      work = work.then(function () {
        return app.store.byIndex('findings', 'byProject', id).then(function (existing) {
          var byPath = {}, drop = [], kept = 0;
          existing.forEach(function (f) { byPath[commentFile(window.MxComments.serialize(f)).path] = f; });
          changed['comments-removed'].forEach(function (g) {
            var f = byPath[g.path];
            if (!f) return;
            var same = g.text != null ? commentFile(window.MxComments.serialize(f)).text === g.text : !(Date.parse(f.updatedAt || '') > g.at);
            if (same) drop.push(f.id); else kept += 1;
          });
          if (!drop.length && !kept) return null;
          drew = true;
          return drop.reduce(function (p, cid) { return p.then(function () { return app.store.delete('findings', cid); }); }, Promise.resolve()).then(function () {
            if (drop.length && app.state.activeId === id) return window.MxComments.loadFindings(id);
            return null;
          }).then(function () {
            var n = function (k) { return k === 1 ? 'a comment' : k + ' comments'; };
            app.setMessage([drop.length ? 'Removed ' + n(drop.length) + ' deleted in mxscout/comments/ by a teammate' : null,
              kept ? 'kept ' + n(kept) + ' deleted there but changed here since — written back' : null].filter(Boolean).join('; ').replace(/^k/, 'K') + '.', 'ok');
          });
        });
      });
    }
    if (changed['triage.json']) {
      work = work.then(function () {
        var tj;
        try { tj = JSON.parse(changed['triage.json']); } catch (e) { tj = null; }
        if (!tj || tj.format !== 'mxscout-triage') { drew = true; app.setMessage('triage.json in the project’s folder could not be read, so this browser’s decisions about the risks stay.', 'error'); return null; }
        return window.MxTriage.takeFromPackage(id, tj.triage).then(function (n) { if (n) drew = true; });
      });
    }
    return work.then(function () { if (drew) app.render(); }, function (err) { app.setMessage('Could not take in what changed in the project’s folder: ' + ((err && err.message) || err), 'error'); app.render(); });
  }

  // A comment as it lives in mxscout/comments/ (Developer tools, inside the Mendix project): one file each, named by its id.
  function commentFile(c) {
    return { path: 'comments/' + (/^[A-Za-z0-9_-]{1,80}$/.test(String(c.id)) ? c.id : window.MxRepoDocs.slug(c.id)) + '.json', text: JSON.stringify(c, null, 2) + '\n' };
  }

  // The Assist files the folder holds (assist.js adoptFiles): newer than this browser's, they win. A file
  // MxScout cannot read is said, and this browser's copy of that item stays.
  function adoptAssist(id, files, newer) {
    return app.assist.adoptFiles(id, files).then(function (r) {
      if (r.errors.length) say('Some Assist files in the project’s folder could not be read, so this browser’s copy of them stays: ' + r.errors.slice(0, 3).map(function (e) { return e.path + ' (' + e.error + ')'; }).join('; ') + '.', 'error');
      else if (r.taken.length && newer) say('Took ' + (r.taken.length === 1 ? 'an Assist item' : r.taken.length + ' Assist items') + ' from the project’s folder — ' + r.taken.map(function (x) { return x.id; }).join(', ') + ' — newer than this browser’s copy.', 'ok');
    });
  }

  // The solved cases the folder holds (knowledge.js adoptFiles): newer than this browser's, or removed there (a pull),
  // the folder wins. A note MxScout cannot keep — personal data in it, a section missing — is said, and left alone there.
  function adoptKnowledge(id, changes) {
    return window.MxKnowledge.adoptFiles(id, changes).then(function (r) {
      if (r.skipped.length) say('Not taken from knowledge/: ' + r.skipped.slice(0, 3).map(function (x) { return x.path + ' (' + x.error + ')'; }).join('; ') + '. Fix the note there — it is not listed until then.', 'error');
      else if (r.taken.length || r.removed.length) say([r.taken.length ? 'Took ' + (r.taken.length === 1 ? 'the solved case ' + r.taken[0] : r.taken.length + ' solved cases') + ' from knowledge/' : null,
        r.removed.length ? (r.removed.length === 1 ? r.removed[0] + ' was removed there' : r.removed.length + ' solved cases were removed there') : null].filter(Boolean).join('; ') + '.', 'ok');
    });
  }

  // What store.js says about a folder: a file written is only the Folder tab's news — the rest of
  // the screen did not change, and drawing it again would take the cursor out of whatever field the
  // person is typing in; a folder that stopped being writable is said once, where the person is (its
  // own card and the header button keep saying it until it is back).
  function onFolder(id, info, what) {
    if (what === 'written' || what === 'pending') { app.docs.folderChanged(); return; }
    if (what === 'conflict' && info && app.state.activeId === id) {
      app.setMessage('mxscout/ has a git conflict in ' + (info.conflicts.length === 1 ? 'mxscout/' + info.conflicts[0].path : info.conflicts.length + ' files') + '. Documentation shows both sides; until it is resolved MxScout neither takes nor writes the descriptions.', 'error',
        { label: 'Show it', onclick: function () { if (app.state.detail) app.state.detail.view = 'docs'; app.setMessage(null); app.render(); } });
    }
    if (info && (what === 'needs-permission' || what === 'missing' || what === 'error') && app.state.activeId === id) {
      app.setMessage(what === 'needs-permission' ? 'The project’s folder ' + info.name + ' needs your permission again — press Reconnect the folder. MxScout keeps working in this browser meanwhile.'
        : what === 'missing' ? 'The project’s folder ' + info.name + ' is not where it was. Nothing is lost — choose it again in Documentation → Write with Claude.'
        : 'Could not write the project’s folder ' + info.name + ': ' + (info.error || 'unknown error') + '. MxScout keeps working in this browser and writes the folder when it can.', 'error');
    }
    app.render();
  }

  // Developer tools' two more files in a project's folder, by the whitelists a package uses
  // (comments.js and triage.js serialize): null when there is nothing to keep, and the file goes.
  var files = {
    'comments.json': function (projectId) {
      return app.store.byIndex('findings', 'byProject', projectId).then(function (rows) {
        return rows.length ? JSON.stringify({ format: 'mxscout-comments', version: 1, comments: rows.map(window.MxComments.serialize) }, null, 2) + '\n' : null;
      });
    },
    // Inside the Mendix project (layout 2, store.js) the comments are one file each, comments/<id>.json, so
    // two reviewers adding comments never change the same file: [{ path, text }].
    'comments/': function (projectId) {
      return app.store.byIndex('findings', 'byProject', projectId).then(function (rows) {
        return rows.map(window.MxComments.serialize).sort(function (a, b) { return a.id < b.id ? -1 : 1; }).map(commentFile);
      });
    },
    'triage.json': function (projectId) {
      return app.store.get('triage', projectId).then(function (rec) {
        var t = rec ? window.MxTriage.serialize(rec, true) : null;
        // As the receiving side reads it (triage.js clean), keys in order: the same decisions give the same
        // text in every browser, so one that took them from the folder writes nothing back.
        var risks = t ? window.MxTriage.clean(t) : {}, keys = Object.keys(risks).sort(), out = {};
        keys.forEach(function (k) { out[k] = risks[k]; });
        return keys.length ? JSON.stringify({ format: 'mxscout-triage', version: 1, triage: { risks: out } }, null, 2) + '\n' : null;
      });
    }
  };

  // ---------- the folder, where the person looks ----------
  // A short line for a project's card and a button for the screen's header when the folder needs them.
  function statusLine(project) {
    var info = app.store.folderInfo(project.id);
    if (!info) return null;
    var t = { 'needs-permission': 'needs your permission again', missing: 'not found', error: 'could not be written' }[info.status];
    return app.el('p', { class: 'project-folder' + (t ? ' warn-text' : ''), text: 'Folder: ' + info.name + (t ? ' — ' + t : '') });
  }
  // The project menu's folder entries, on every screen's header: "Keep in a folder…" for a project
  // only in this browser, "Folder…" (its Documentation tab) for one kept in a folder — and, for one not
  // kept inside the Mendix project yet, "Keep in the Mendix project (mxscout/)…" (repoui.js).
  function menuItem(project, close) {
    if (!supported()) return null;
    var has = app.store.hasFolder(project.id), info = app.store.folderInfo(project.id);
    var out = document.createDocumentFragment();
    out.appendChild(app.el('button', { type: 'button', role: 'menuitem', text: has ? 'Folder…' : 'Keep in a folder…', onclick: function () {
      close();
      if (has) { app.state.detail.view = 'docs'; app.state.detail.docsTab = 'folder'; app.render(); }
      else { app.render(); keep(project); }
    } }));
    if (!info || info.layout !== 2) out.appendChild(app.el('button', { type: 'button', role: 'menuitem', text: 'Keep in the Mendix project (mxscout/)…', onclick: function () { close(); window.MxRepoUI.startMove(project); } }));
    return out;
  }
  function headerButton(project) {
    var info = app.store.folderInfo(project.id);
    if (!info || info.status === 'connected' || info.status === 'checking' || info.status === 'unknown') return null;
    var el = app.el;
    if (info.status === 'missing') return el('button', { class: 'btn btn-sm btn-warn folder-reconnect', title: 'The project’s folder is not where it was', text: 'Folder not found', onclick: function () { app.state.detail.view = 'docs'; app.state.detail.docsTab = 'folder'; app.render(); } });
    return el('button', { class: 'btn btn-sm btn-warn folder-reconnect', title: info.status === 'error' ? 'Writing the folder failed: ' + (info.error || '') : 'The browser needs your permission to write the project’s folder again',
      text: info.status === 'error' ? 'Retry the folder' : 'Reconnect the folder', onclick: function () { reconnect(project); } });
  }

  window.MxFolderUI = {
    init: init, supported: supported, freshChoice: freshChoice, choice: choice, choiceReady: choiceReady, linkNew: linkNew, lastBox: lastBox, repoFileNote: repoFileNote, choiceHint: choiceHint,
    keep: keep, reconnect: reconnect, unkeep: unkeep, openFolder: openFolder, renderClash: renderClash,
    startMoveAll: startMoveAll, renderMoveAll: renderMoveAll, statusLine: statusLine, headerButton: headerButton, menuItem: menuItem,
    adopt: adoptChanges, onFolder: onFolder, files: files, pickParent: pickParent, intoParent: intoParent, keepInHome: keepInHome, cancelled: cancelled, homeLine: homeLine, chooseHome: chooseHome
  };
})();
