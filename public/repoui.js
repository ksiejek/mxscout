/* MxScout — a project kept inside the Mendix project (mxscout/): what the person sees of it.
 *
 * Karol, 2026-10-15: a team keeps MxScout's files in the Mendix project's own git, in mxscout/
 * (repodocs.js says what is in it; store.js writes it, through folder.js). This file is the screens
 * around that: keeping a new project there, opening one a teammate committed (no package, no code,
 * no import step — the model is read from the .mpr beside it, the descriptions from mxscout/), moving a
 * project that is already here into it ("Keep in the Mendix project (mxscout/)…"), reading
 * the model again when the .mpr changed, the one status line that says whether the descriptions
 * describe the model, and choosing a side of a file git left with conflict markers.
 *
 * MxScout never runs git and never connects to a git server: people pull, commit and push themselves.
 * The Mendix project's directory is read (its .mpr, mprcontents/ and a few files of .git) and only
 * mxscout/ is ever written.
 */
(function () {
  'use strict';

  // { el, state, store, render, setMessage, findProject, openProject, summarize, sortProjects, newId, docs, finishReplacingProject }
  var app = null;
  var lastPick = null;     // the Mendix project directory just picked for a new project: { dir, mpr, existing, mxscout, error }
  var reading = {};        // projectId -> what is being read, while the model is read again
  var clash = null;        // { pick, model, grouped, here } — a teammate's project this browser has, kept elsewhere

  function init(api) { app = api; }

  // ---------- what this MxScout ships for the Mendix project ----------
  // The Claude skills, read-only from this server (GET /api/skills, a fixed allowlist of files in skills/),
  // and the team's guide (public/guide-team.md, and public/guide-team.html) — fetched once, kept for this visit.
  var bundle = null, guideText = null;
  function skills() {
    return bundle || (bundle = fetch('/api/skills').then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'the skills could not be read'); return j; }); })
      .catch(function (err) { bundle = null; throw err; }));
  }
  // { md, html }: public/guide-team.md and the same guide as one page, public/guide-team.html.
  function guide() {
    return guideText || (guideText = Promise.all(['/guide-team.md', '/guide-team.html'].map(function (u) {
      return fetch(u).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
    })).then(function (t) { if (!t[0] && !t[1]) guideText = null; return { md: t[0], html: t[1] }; }));
  }
  function say(text, kind, action) { app.setMessage(text, kind, action); app.render(); }
  function errText(err) { return (err && err.message) || String(err); }

  // ---------- a new project, from a Mendix project's directory ----------
  // mprImport.js tells this the directory it read: whether its mxscout/ holds a project already.
  function picked(dir, mpr) {
    return window.MxFolder.inspectRepo(dir).then(function (r) {
      lastPick = { dir: dir, mpr: mpr, mxscout: r.mxscout, existing: r.project, error: r.error };
      return lastPick;
    }, function () { lastPick = { dir: dir, mpr: mpr, mxscout: null, existing: null, error: null }; return lastPick; });
  }
  // Under the project's name in the import dialog: where it will be kept.
  function readyNote(imp) {
    var box = window.MxFolderUI.lastBox();
    if (!box || box.mode !== 'repo' || imp.mode !== 'create') return null;
    var p = imp.repo;
    if (p && p.error) return app.el('p', { class: 'warn-text repo-ready', text: 'This Mendix project has an mxscout/ folder MxScout cannot open: ' + p.error + ' The project would be kept in this browser only.' });
    return app.el('p', { class: 'hint repo-ready', text: p ? 'Kept in ' + p.dir.name + '/mxscout/ — shared with your team through git. Your Assist items stay on this machine.'
      : 'Keeping it in the Mendix project needs the project folder, not the .mpr alone: it will be kept in this browser only.' });
  }

  // A project just created (folderui.js linkNew, when "In the Mendix project" was chosen): mxscout/ made in the
  // directory its model was read from, and everything written there.
  // skills: whether the Claude skills go into the Mendix project's .claude/skills/ too (the choice, default on).
  function linkNew(record, skillsOn) {
    var p = lastPick;
    lastPick = null;
    if (!p || !p.mpr || (record.source && record.source.fileName && record.source.fileName !== p.mpr.name)) {
      return Promise.reject(new Error('keeping it in the Mendix project needs the Mendix project folder, not the .mpr file alone.'));
    }
    if (p.error) return Promise.reject(new Error('its mxscout/ folder cannot be opened: ' + p.error));
    return p.dir.getDirectoryHandle('mxscout', { create: true }).then(function (mx) {
      return app.store.linkFolder(record.id, mx, { repo: p.dir, mpr: p.mpr, skills: skillsOn !== false });
    }).then(function () { return 'Kept in ' + p.dir.name + '/mxscout/' + (skillsOn !== false ? ', with the Claude skills in .claude/skills/' : '') + ' — commit it to share it with your team.'; });
  }

  // A project a teammate committed: the model just read from the .mpr beside mxscout/, the descriptions
  // taken from mxscout/ when the project opens (its files are all newer than nothing). The same project
  // in this browser is linked to it; when that one is kept somewhere else, the person says which.
  function linkExisting(pick, model, grouped) {
    var pj = pick.existing, here = app.findProject(pj.id);
    lastPick = null;
    if (!here) return create(pick, model, grouped, pj.id);
    var info = app.store.folderInfo(pj.id);
    var same = info && app.store.repoHandle(pj.id) ? app.store.repoHandle(pj.id).isSameEntry(pick.dir).catch(function () { return false; }) : Promise.resolve(!info);
    return same.then(function (yes) {
      if (yes) return relink(pick, model, grouped, pj.id);
      clash = { pick: pick, model: model, grouped: grouped, here: here, info: info };
      app.render();
      return null;
    });
  }
  function source(grouped) { return { kind: 'mpr-folder', fileName: grouped.mprFileName }; }
  function create(pick, model, grouped, id) {
    var pj = pick.existing, now = new Date().toISOString();
    var record = { id: id, name: String(pj.name || 'Mendix application').slice(0, 120), createdAt: now, updatedAt: now, source: source(grouped), fileName: grouped.mprFileName,
      bytes: JSON.stringify(model).length, summary: app.summarize(model), contentLanguage: window.MxDescribe.languageCode(pj.contentLanguage) || window.MxDocs.defaultLanguage() || null };
    return app.store.saveProjectWithModel(record, model, { mirror: false }).then(function () {
      app.state.projects.push(record);
      app.sortProjects();
      return open(pick, grouped, id, 'Opened "' + record.name + '" from ' + pick.dir.name + '/mxscout/ — your team’s documentation, with the model read from ' + grouped.mprFileName + '.');
    });
  }
  function relink(pick, model, grouped, id) {
    return app.finishReplacingProject(id, source(grouped), model, { mirror: false }).then(function (p) {
      return open(pick, grouped, id, '"' + p.name + '" is kept in ' + pick.dir.name + '/mxscout/ now; the model was read from ' + grouped.mprFileName + ' and what mxscout/ holds is taken in.');
    });
  }
  function open(pick, grouped, id, said) {
    if (app.docs.forgetDescriptions) app.docs.forgetDescriptions(id);
    app.state.newProject.open = false;
    // The skills are kept up to date here when the team added them (the project has them already).
    return window.MxFolder.readFile(pick.dir, '.claude/skills/mendix-describe/VERSION').catch(function () { return null; }).then(function (had) {
      return app.store.openFolder(id, pick.mxscout, { repo: pick.dir, mpr: grouped.mpr, skills: !!had });
    }).then(function () { return app.openProject(id); })
      .then(function () { app.setMessage(said, 'ok'); app.render(); });
  }
  function renderClash() {
    var c = clash;
    if (!c) return renderMove();
    var el = app.el;
    function close() { clash = null; app.render(); }
    function run(p) { clash = null; app.render(); p.catch(function (err) { say(errText(err), 'error'); }); }
    return el('div', { class: 'modal-backdrop' }, [window.MxDialog.modal(el('div', { class: 'modal repo-clash', 'aria-label': 'This project is already here' }, [
      el('h3', { text: 'This project is already in this browser' }),
      el('p', { text: c.pick.dir.name + '/mxscout/ holds "' + c.pick.existing.name + '", and this browser has the same project, "' + c.here.name + '", kept in ' + (c.info ? c.info.name : 'another folder') + '.' }),
      el('p', { class: 'muted', text: 'Link it here: the project in this browser is kept in this Mendix project from now on, and what mxscout/ holds wins. Open as a new project: a second project, with its own id; the one here stays as it is.' }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn', text: 'Open as a new project', onclick: function () { run(create(c.pick, c.model, c.grouped, app.newId())); } }),
        el('button', { class: 'btn btn-primary', text: 'Link it here', onclick: function () { run(relink(c.pick, c.model, c.grouped, c.pick.existing.id)); } })
      ])
    ]), close)]);
  }

  // ---------- reading the model again ----------
  // When the .mpr beside mxscout/ is not the one the model was read from (its size, its date or the commit
  // HEAD names moved) — at open (store.js asks) and when the person presses Re-read (force: read it anyway).
  // The .mpr is the truth: the model is replaced without a diff to confirm. docs/ does not follow it.
  function reread(id, force) {
    var dir = app.store.repoHandle(id), info = app.store.folderInfo(id);
    var project = app.findProject(id);
    if (!dir || !project || reading[id]) return Promise.resolve(null);
    var M = window.MxMprImport;
    return M.fingerprint(dir).then(function (now) {
      var was = info && info.mpr;
      if (!force && was && was.name === now.name && was.size === now.size && was.lastModified === now.lastModified && was.commit === now.commit) return 'same';
      reading[id] = 'Reading ' + now.name + '…';
      app.render();
      return M.readModel(dir, function (msg) { reading[id] = msg.phase || reading[id]; }).then(function (r) {
        return app.finishReplacingProject(id, { kind: 'mpr-folder', fileName: r.mprFileName }, r.model).then(function () {
          if (app.docs.forgetDescriptions) app.docs.forgetDescriptions(id);
          return app.store.setRepoMpr(id, r.mpr);
        }).then(function () {
          delete reading[id];
          var V = window.MxModelVersion;
          if (app.state.activeId === id) app.setMessage('Read the model again from ' + r.mprFileName + ' — ' + (V.known(r.model.version) ? V.label(r.model.version, { noMessage: true }) : 'its version is not known') + '.', 'ok');
          app.render();
          return 'read';
        });
      });
    }).catch(function (err) {
      delete reading[id];
      if (app.state.activeId === id) say('Could not read the model again from the Mendix project: ' + errText(err) + ' This browser’s copy stays.', 'error');
      return null;
    });
  }

  // ---------- where the person looks ----------
  // One line in Documentation: which version the model is, and whether the descriptions describe it.
  //   "Model main @ f00ba12 · descriptions a1b2c3d (3 flows changed since)"
  //   "Model main @ f00ba12 · Descriptions describe this version — up to date"
  function statusLine(project, made) {
    var info = project ? app.store.folderInfo(project.id) : null;
    if (!info || info.layout !== 2) return null;
    var el = app.el, V = window.MxModelVersion;
    var v = project.summary ? project.summary.version : null;
    var at = made && made.rec && made.rec.value ? made.rec.value.describedAt : null;
    var model = V.known(v) ? 'Model ' + V.short(v) : 'Model version unknown';
    var desc = !made || !made.rec ? 'no descriptions yet'
      : at && V.known(v) && at.commit === v.commit ? (made.status.stale ? 'descriptions describe this version, ' + made.status.stale + ' flows changed since' : 'Descriptions describe this version — up to date')
      : 'descriptions ' + (at ? (at.short || String(at.commit).slice(0, 7)) : 'of an unknown version') + ' (' + (made.status.stale ? made.status.stale + (made.status.stale === 1 ? ' flow' : ' flows') + ' changed since' : 'no described flow changed since') + ')';
    var busy = reading[project.id];
    // Kept from before the move, while the .mpr beside is another snapshot (runMove): said until Re-read takes it.
    var differs = info.mpr && info.mpr.differs ? el('p', { class: 'warn-text repo-status-differs', text: 'This model is the one this browser had before the move, not the one in ' + info.mpr.name + ' — that is another snapshot of the same application. Re-read takes it.' }) : null;
    return el('div', { class: 'repo-status', 'data-up-to-date': at && V.known(v) && at.commit === v.commit && !made.status.stale && !differs ? 'true' : 'false' }, [
      el('p', { class: 'repo-status-line' }, [el('strong', { text: model }), document.createTextNode(' · ' + desc)]), differs,
      el('p', { class: 'hint repo-status-hint' }, [
        document.createTextNode(busy || 'Pull in Studio Pro or git, then Re-read. '),
        busy ? null : el('button', { type: 'button', class: 'btn btn-sm repo-reread', text: 'Re-read', onclick: function () { reread(project.id, true).then(function () { return app.store.syncFolder(project.id, false); }).then(function () { app.render(); }); } })
      ].filter(Boolean))
    ]);
  }

  // A JSON file in mxscout/ with git's conflict markers: both sides, and a button to keep each.
  function conflictCard(project) {
    var info = project ? app.store.folderInfo(project.id) : null;
    if (!info || info.layout !== 2 || !info.conflicts.length) return null;
    var el = app.el, R = window.MxRepoDocs;
    return el('div', { class: 'card repo-conflicts', role: 'alert' }, [
      el('h3', { text: info.conflicts.length === 1 ? 'A file in mxscout/ has a git conflict' : info.conflicts.length + ' files in mxscout/ have a git conflict' }),
      el('p', { class: 'muted', text: 'Until it is resolved MxScout neither takes the descriptions from mxscout/ nor writes them there. Keep one side of each file here, or resolve it in git and press Re-read. Then stage the file in git (git add) to finish the merge.' })
    ].concat(info.conflicts.map(function (c) {
      var s = R.sides(c.text);
      function side(which, label, text) {
        var ok = true;
        try { JSON.parse(text); } catch (e) { ok = false; }
        return el('div', { class: 'repo-side', 'data-side': which }, [
          el('strong', { text: label }),
          el('pre', { class: 'repo-side-text', text: text.length > 4000 ? text.slice(0, 4000) + '\n…' : text }),
          ok ? el('button', { type: 'button', class: 'btn btn-sm', text: which === 'ours' ? 'Use yours' : 'Use theirs', onclick: function () {
            app.store.resolveConflict(project.id, c.path, text.replace(/\s*$/, '\n')).then(function () {
              say('Kept ' + (which === 'ours' ? 'your' : 'their') + ' side of mxscout/' + c.path + '. Stage it in git (git add) to finish the merge.', 'ok');
            }, function (err) { say('Could not write mxscout/' + c.path + ': ' + errText(err), 'error'); });
          } }) : el('p', { class: 'warn-text', text: 'This side is not valid JSON on its own — resolve this file in git.' })
        ]);
      }
      return el('div', { class: 'repo-conflict', 'data-path': c.path }, [
        el('p', {}, [el('code', { text: 'mxscout/' + c.path }), document.createTextNode(' — this file has a git conflict')]),
        el('div', { class: 'repo-sides' }, [side('ours', 'Yours' + (s.oursLabel ? ' (' + s.oursLabel + ')' : ''), s.ours), side('theirs', 'Theirs' + (s.theirsLabel ? ' (' + s.theirsLabel + ')' : ''), s.theirs)])
      ]);
    })));
  }

  // What the Documentation section shows of this, as one string: drawn again when it changes.
  function signature(project) {
    var info = app.store.folderInfo(project.id);
    if (!info || info.layout !== 2) return '';
    return info.conflicts.map(function (c) { return c.path; }).join('|') + '#' + (reading[project.id] || '');
  }

  // The Claude skills on the Folder tab: what the project has, the switch that keeps them up to date, and the
  // button that writes them once — always by the same rule: only a newer copy replaces the one there.
  function skillsCard(project) {
    var info = app.store.folderInfo(project.id);
    if (!info || info.layout !== 2) return null;
    var el = app.el, seen = info.skillsSeen || {};
    var on = el('input', { type: 'checkbox' });
    on.checked = !!info.skills;
    on.addEventListener('change', function () { app.store.setRepoSkills(project.id, on.checked).then(function () { app.render(); }); });
    var lines = window.MxRepoDocs.SKILLS.map(function (n) {
      var s = seen[n];
      var said = !s ? 'not checked yet' : !s.stamp ? 'not in this project' : s.wrote ? 'written — ' + s.stamp : s.stamp === s.mine ? s.stamp + ' — up to date'
        : window.MxRepoDocs.newer(s.mine, s.stamp) ? s.stamp + ' — this MxScout has a newer copy (' + s.mine + ')' : s.stamp + ' — newer than this MxScout’s, left as it is';
      return el('p', { class: 'hint repo-skill', 'data-skill': n }, [el('code', { text: '.claude/skills/' + n + '/' }), document.createTextNode(' ' + said)]);
    });
    return el('div', { class: 'repo-skills' }, [
      el('h4', { class: 'docs-folder-h', text: 'Claude skills in this project' }),
      el('p', { class: 'muted', text: 'mendix-describe and mendix-assist in the Mendix project’s .claude/skills/, where Claude Code loads them: whoever pulls gets them, without MxScout. Nothing else in .claude/ is touched; only a newer copy replaces the one there.' })
    ].concat(lines).concat([
      el('label', { class: 'docs-agent-auto repo-skills-auto' }, [on, document.createTextNode(' Keep the Claude skills in this project up to date')]),
      el('div', { class: 'docs-agent-act' }, [el('button', { type: 'button', class: 'btn btn-sm repo-skills-update', text: 'Update the skills in this project', onclick: function () {
        app.store.updateSkills(project.id).then(function (i) {
          var s = (i && i.skillsSeen) || {};
          var wrote = window.MxRepoDocs.SKILLS.filter(function (n) { return s[n] && s[n].wrote; });
          say(wrote.length ? 'Wrote ' + wrote.join(' and ') + ' into .claude/skills/ — commit them with mxscout/.' : 'The skills in this project are as new as this MxScout’s, or newer: nothing written.', 'ok');
        }, function (err) { say('Could not write the skills: ' + errText(err), 'error'); });
      } })])
    ]));
  }

  // ---------- a project already here, moved into the Mendix project ----------
  // Karol, 2026-10-15: a project kept in this browser only, or in a folder of its own (layout 1), goes into
  // <MendixProject>/mxscout/ (layout 2) — the project menu's "Keep in the Mendix project (mxscout/)…" and the
  // Folder tab. The person picks the Mendix project folder (its .mpr at the top, leave to write it), and then:
  //  - no project in mxscout/ yet: everything this one has is written there, and only once every file is
  //    written is it linked (store.js linkFolder) — a failure leaves it as it was; its old folder stays on disk;
  //  - mxscout/ holds THIS project (its id): linked to it, as a teammate's project is — what mxscout/ holds wins
  //    for the descriptions (with Undo), the rest merges by its own rules, and what only this browser has is written;
  //  - mxscout/ holds ANOTHER project: never written over. The person may use theirs — a project of its own here,
  //    from mxscout/ — and this one stays as it is, a separate project, until they delete it;
  //  - a file in mxscout/ with git's conflict markers: nothing is moved.
  // The model: the .mpr beside is read. Two questions, kept apart (an external audit, 2026-10-15, B06):
  //  - the same APPLICATION? (most of the project's own modules are in it — likeness). Another application is
  //    said, and moved only when the person says so; the model is then the .mpr's, with its version;
  //  - the same SNAPSHOT? (the same content, the version stamp and the time it was read aside — sameSnapshot).
  //    The same module names say nothing about it. The same snapshot takes the version the Mendix project's git
  //    names, so the status line works. Another snapshot of the same application keeps this browser's model WITH
  //    ITS OWN version — never this model under the .mpr's commit — and the link remembers that the .mpr there
  //    differs: the status line says so, and Re-read takes the .mpr's.
  var move = null;         // { id, step: 'intro'|'reading'|'differs'|'theirs'|'writing', skills, phase, error, dir, repo, read, like, mine }

  function startMove(project) {
    if (!project) return;
    if (!window.MxFolder.supported()) { say('This browser cannot keep a project in the Mendix project — that needs Chrome or Edge.', 'error'); return; }
    var info = app.store.folderInfo(project.id);
    if (info && info.layout === 2) { say('"' + project.name + '" is kept in ' + info.name + ' already.', 'ok'); return; }
    move = { id: project.id, step: 'intro', skills: true, phase: null, error: null };
    app.render();
  }
  function ownModules(model) {
    return ((model && model.modules) || []).filter(function (m) { return m && m.name && !m.fromAppStore && m.name !== 'System'; }).map(function (m) { return m.name; });
  }
  // Whether two models are one snapshot: the same content, the version stamp and when each was read aside.
  function contentOf(model) {
    var x = Object.assign({}, model || {});
    delete x.version;
    if (x.meta) { x.meta = Object.assign({}, x.meta); delete x.meta.generatedAt; }
    return JSON.stringify(x);
  }
  function sameSnapshot(a, b) { return !!a && !!b && contentOf(a) === contentOf(b); }
  // Whether two models are one application: most of the own modules of the larger one are in the other.
  function likeness(mine, theirs) {
    var a = ownModules(mine), b = ownModules(theirs);
    var common = a.filter(function (n) { return b.indexOf(n) !== -1; }).length;
    return { same: !a.length || !b.length || common / Math.max(a.length, b.length) >= 0.5, common: common, mine: a.length, theirs: b.length };
  }
  // The JSON files in mxscout/ git left with conflict markers: the descriptions, and Developer tools' comments and decisions.
  function conflictsIn(mx) {
    var F = window.MxFolder, R = window.MxRepoDocs;
    return Promise.all([F.listAll(mx, 'descriptions'), F.listAll(mx, 'comments'), F.stat(mx, 'triage.json')]).then(function (b) {
      var paths = b[0].concat(b[1]).map(function (s) { return s.path; }).concat(b[2] ? ['triage.json'] : []);
      return Promise.all(paths.map(function (p) { return F.readFile(mx, p).then(function (r) { return r && R.conflicted(r.text) ? p : null; }); }));
    }).then(function (l) { return l.filter(Boolean); });
  }
  function moveFailed(m, text) { if (move !== m) return; m.step = 'intro'; m.error = text; m.phase = null; app.render(); }
  function pickForMove(m) {
    var F = window.MxFolder;
    m.error = null;
    F.pick().then(function (dir) {
      m.dir = dir; m.step = 'reading'; m.phase = 'Looking at ' + dir.name + '…'; app.render();
      return F.inspectRepo(dir).then(function (r) {
        if (!r.mprs) throw new Error('That folder has no .mpr directly inside it — choose the Mendix project’s own folder, the one with the .mpr.');
        if (r.mprs > 1) throw new Error('That folder has more than one .mpr — choose the folder of a single Mendix project.');
        if (r.conflict) throw new Error('mxscout/ has a git conflict in mxscout/mxscout.json — resolve it in git first, then try again.');
        if (r.error) throw new Error('That Mendix project’s mxscout/ cannot be opened: ' + r.error);
        m.repo = r;
        return r.mxscout ? conflictsIn(r.mxscout) : [];
      }).then(function (conflicts) {
        if (conflicts.length) throw new Error('mxscout/ has a git conflict in ' + (conflicts.length === 1 ? 'mxscout/' + conflicts[0] : conflicts.length + ' files') + ' — resolve it in git first, then try again.');
        m.phase = 'Reading ' + m.repo.mpr + '…'; app.render();
        return Promise.all([app.store.getModel(m.id), window.MxMprImport.readModel(dir, function (msg) { if (msg && msg.phase && move === m) { m.phase = msg.phase; app.render(); } })]);
      }).then(function (b) {
        if (move !== m) return;
        if (!b[0]) throw new Error('its model is missing from this browser’s storage.');
        m.read = b[1]; m.mine = b[0]; m.like = likeness(b[0], b[1].model); m.snapshot = sameSnapshot(b[0], b[1].model);
        if (m.repo.project && m.repo.project.id !== m.id) { m.step = 'theirs'; m.phase = null; app.render(); return; }
        if (!m.like.same) { m.step = 'differs'; m.phase = null; app.render(); return; }
        runMove(m);
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      moveFailed(m, 'Not moved: ' + errText(err) + ' The project is unchanged.');
    });
  }
  function runMove(m) {
    var project = app.findProject(m.id), r = m.repo, read = m.read, dir = m.dir;
    if (!project) { moveFailed(m, 'That project is no longer in this browser.'); return; }
    var was = app.store.folderInfo(m.id), where = dir.name + '/mxscout/', same = !!r.project;
    m.step = 'writing'; m.phase = 'Writing into ' + where + '…'; app.render();
    // The same snapshot takes the version read now; another snapshot of the same application keeps its own model
    // and its own version, the .mpr marked as different; another application takes the .mpr's model.
    var keepMine = m.like.same && !m.snapshot;
    var model = !m.like.same ? read.model : m.snapshot ? Object.assign({}, m.mine, { version: read.model.version }) : m.mine;
    var mpr = keepMine ? Object.assign({}, read.mpr, { differs: true }) : read.mpr;
    var work = same
      ? window.MxFolder.listAll(r.mxscout, 'descriptions').then(function (had) {
        // Linked as a teammate's project is: every file there counts as newer and is taken in when it is synced;
        // then what only this browser has is written — its descriptions only when mxscout/ has none.
        var pending = window.MxFolder.CORE.filter(function (f) { return f !== 'descriptions.json' || !had.length; }).concat(['knowledge/']);
        return app.store.openFolder(m.id, r.mxscout, { repo: dir, mpr: mpr, skills: m.skills, pending: pending });
      })
      : Promise.all([r.mxscout || dir.getDirectoryHandle('mxscout', { create: true }), app.store.get('descriptions', m.id).catch(function () { return null; })]).then(function (b) {
        var derived;
        try { derived = app.docs.derivedFor(m.mine, project, b[1]); } catch (e) { derived = {}; }
        return app.store.linkFolder(m.id, b[0], { repo: dir, mpr: mpr, skills: m.skills, derived: derived });
      });
    work.then(function () {
      return app.finishReplacingProject(m.id, source(read), model);
    }).then(function (p) {
      if (app.docs.forgetDescriptions) app.docs.forgetDescriptions(m.id);
      if (move === m) move = null;
      var old = was && was.layout !== 2 ? ' Your old folder ' + was.name + ' is left as it was; delete it when you no longer need it.' : '';
      var V = window.MxModelVersion;
      if (keepMine) old = ' Its model is still the one this browser had (' + (V.known(model.version) ? V.label(model.version, { noMessage: true }) : 'version unknown') + '): ' + read.mprFileName + ' there is another snapshot of the same application — press Re-read on Documentation to take it.' + old;
      return (app.state.activeId === m.id ? app.openProject(m.id) : Promise.resolve()).then(function () {
        // What mxscout/ held, taken in meanwhile, is said with its Undo: that message stays.
        if (same && app.state.message && app.state.message.action) { app.render(); return; }
        app.setMessage(same
          ? '"' + p.name + '" is kept in ' + where + ' now — the project your team keeps there; what mxscout/ holds is taken in, the descriptions with Undo.' + old
          : 'Moved "' + p.name + '" into ' + where + (m.skills ? ', with the Claude skills in .claude/skills/' : '') + ' — commit it to share it with your team. Your Assist items stay on this machine, in mxscout/.local/.' + old, 'ok');
        app.render();
      });
    }).catch(function (err) { moveFailed(m, 'Not moved: ' + errText(err) + ' The project is unchanged.'); });
  }
  // mxscout/ holds another project: theirs, as a project of its own here (linkExisting — the way New project opens it).
  function useTheirs(m) {
    var mine = app.findProject(m.id), theirs = m.repo.project;
    move = null;
    app.render();
    var pick = { dir: m.dir, mpr: m.read.mpr, mxscout: m.repo.mxscout, existing: theirs };
    linkExisting(pick, m.read.model, { mprFileName: m.read.mprFileName, mpr: m.read.mpr }).then(function () {
      var here = app.findProject(theirs.id);
      if (here && app.state.activeId === here.id && mine) {
        app.setMessage('Opened "' + here.name + '" from ' + m.dir.name + '/mxscout/ — your team’s project. Your project "' + mine.name + '" stays in this browser as it was, a separate project; delete it when you no longer need it.', 'ok');
        app.render();
      }
    }, function (err) { say('Could not open the project in ' + m.dir.name + '/mxscout/: ' + errText(err) + ' Your project is unchanged.', 'error'); });
  }
  function renderMove() {
    var m = move;
    if (!m) return null;
    var el = app.el, project = app.findProject(m.id);
    if (!project) { move = null; return null; }
    var info = app.store.folderInfo(m.id);
    var busy = m.step === 'reading' || m.step === 'writing';
    function close() { if (busy) return; move = null; app.render(); }
    var kids = [el('h3', { text: 'Keep in the Mendix project (mxscout/)' })];
    if (m.step === 'theirs') {
      kids.push(el('p', { class: 'repo-move-theirs', text: 'This Mendix project’s mxscout/ already holds "' + m.repo.project.name + '" — a teammate set this app up from another project. MxScout does not write over it.' }));
      kids.push(el('p', { class: 'muted', text: 'Use theirs: this browser takes their project — its id and content from mxscout/, the model from ' + m.read.mprFileName + '. Yours, "' + project.name + '", is kept as a separate project, with everything it has, until you delete it.' }));
      kids.push(el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-primary', text: 'Use theirs', onclick: function () { useTheirs(m); } })
      ]));
    } else if (m.step === 'differs') {
      kids.push(el('p', { class: 'warn-text repo-move-differs', text: m.read.mprFileName + ' looks like another application: ' + m.like.common + ' of this project’s ' + m.like.mine + ' modules are in it, and it has ' + m.like.theirs + '.' }));
      kids.push(el('p', { class: 'muted', text: 'Move anyway, and the model is read from ' + m.read.mprFileName + ', as for every project kept in a Mendix project; the descriptions stay as they are. Or cancel, and choose the right folder.' }));
      kids.push(el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-primary', text: 'Move anyway', onclick: function () { runMove(m); } })
      ]));
    } else {
      var dev = window.MxFolder.CORE.indexOf('comments.json') !== -1;
      kids.push(el('p', { text: '"' + project.name + '" goes into mxscout/ inside the Mendix project folder you choose — the one with the .mpr — with everything it has, shared with your team through the app’s own git: the descriptions, the documentation (docs/) and the solved cases (knowledge/)' + (dev ? ', the comments and what was decided about the risks' : '') + '. Your Assist items stay on this machine, in mxscout/.local/. MxScout never runs git: you commit and push.' }));
      kids.push(el('p', { class: 'hint', text: 'When mxscout/ there already holds this project, it is linked to it, and what mxscout/ holds wins. ' + (info ? 'Its folder ' + info.name + ' is left as it is.' : 'This browser keeps its own copy, as for every project.') }));
      var sk = el('input', { type: 'checkbox', class: 'repo-skills-choice' });
      sk.checked = m.skills !== false;
      sk.disabled = busy;
      sk.addEventListener('change', function () { m.skills = sk.checked; });
      kids.push(el('label', { class: 'store-skills' }, [sk, document.createTextNode(' Add the Claude skills to this project (.claude/skills) — teammates get them with the next pull')]));
      if (m.phase) kids.push(el('p', { class: 'hint repo-move-phase', text: m.phase }));
      if (m.error) kids.push(el('p', { class: 'warn-text repo-move-error', text: m.error }));
      kids.push(el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', text: 'Cancel', disabled: busy ? 'disabled' : null, onclick: close }),
        el('button', { class: 'btn btn-primary repo-move-pick', text: 'Choose the Mendix project folder…', disabled: busy ? 'disabled' : null, onclick: function () { pickForMove(m); } })
      ]));
    }
    return el('div', { class: 'modal-backdrop' }, [window.MxDialog.modal(el('div', { class: 'modal repo-move', 'aria-label': 'Keep in the Mendix project' }, kids), close)]);
  }

  window.MxRepoUI = {
    startMove: startMove, renderMove: renderMove,
    signature: signature, skills: skills, guide: guide, skillsCard: skillsCard,
    init: init, picked: picked, readyNote: readyNote, linkNew: linkNew, linkExisting: linkExisting, renderClash: renderClash,
    reread: reread, statusLine: statusLine, conflictCard: conflictCard
  };
})();
