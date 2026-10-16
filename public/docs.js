/* MxScout — documentation, the section of a project.
 *
 * The documentation is read in ONE place: the exported file. This section is
 * where it is made — what the file holds, a look at it, and one button that
 * builds it. A second reader in the app would be a second thing to keep true;
 * the previews here are the real reader, drawn small, from the same data.
 *
 * The exported file carries four things and nothing else: the documentation
 * data as plain JSON, the reader's own source (docs-view.js, the very function
 * the previews run), its stylesheet with the design tokens, and the two fonts
 * (public/fonts/, SIL Open Font License) inside that stylesheet as data: URIs. It is not encrypted — Karol's call,
 * 2026-10-12, replacing the access code it carried since 2026-10-06. It is built in this page and
 * handed to the browser's download; the server never sees it and nothing is
 * sent anywhere. It is rebuilt from the model every time a model is loaded or
 * replaced — there is nothing to keep in step by hand.
 *
 * The section is a short header — what is described, what is out of date — and
 * four tabs, one for each way to work with an agent (Karol, 2026-10-15):
 *  - Folder, first and the default: the project kept as files in a folder the
 *    person picked (store.js writes it, folder.js is the file work). An agent
 *    reads them directly and drops its results into inbox/, which this file
 *    reads every two seconds while the project is open, and takes exactly as
 *    it takes what comes through the channel: saved at once, with Undo; a
 *    whole file that would replace the descriptions waits for Import them.
 *    documentation.md and ai-pack.md are made here and handed to store.js.
 *  - Agent channel, only when asked: "Share with an agent" hands the AI pack
 *    to the server's memory so an agent on this machine can read it and send
 *    descriptions back without files — and, beside it, the documentation as
 *    Markdown when the project has descriptions, the agent's map of what was
 *    understood before (see "sharing with an agent" below).
 *  - Without an agent tool: the AI pack as a download, a descriptions file
 *    imported by hand, and the chat assistant (copilot.js).
 *  - Export: the file, what is in it, and the previews.
 */
(function () {
  'use strict';

  var app = null; // { el, state, render, store, setMessage, findProject, downloadText, keepInFolder, keepInRepo, reconnectFolder, unkeepFolder }
  var kept = null; // { model, desc, host, data } — the section, kept across redraws
  // projectId -> the imported descriptions record ({ projectId, importedAt,
  // fileName, value }), null when there is none, absent while loading.
  var descs = {};
  var dialog = null; // { busy, fileName, error, keep }

  function init(api) {
    app = api;
    // Sharing lasts as long as this tab: leaving it takes the pack off the server.
    window.addEventListener('pagehide', function () { stopShare(true); });
    if (app.store.onOtherTab) app.store.onOtherTab(otherTab);
    // The open project's folder: its inbox read, and documentation.md and ai-pack.md kept current,
    // every two seconds — nothing at all while no open project is kept in a connected folder.
    setInterval(folderTick, 2000);
  }

  // After a change to the descriptions: the folder's documentation.md, soon, rather than on the next tick.
  var soon = null;
  function folderSoon() {
    if (soon) return;
    soon = setTimeout(function () {
      soon = null;
      var s = app.state;
      var p = s.detail && s.activeId ? app.findProject(s.activeId) : null;
      var info = p ? app.store.folderInfo(p.id) : null;
      if (info && info.status === 'connected' && descs[p.id] !== undefined) writeDerived(p);
    }, 300);
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // The flow a preview shows: an own module's microflow with a real shape —
  // enough steps to read as a workflow, few enough to fit, data on a step.
  function sampleFlow(data) {
    var own = {};
    data.modules.forEach(function (m) { if (!m.marketplace) own[m.name] = true; });
    var best = null, bestScore = -1;
    Object.keys(data.flows).forEach(function (k) {
      var f = data.flows[k];
      if (f.kind !== 'microflow' || !own[f.module] || !f.workflow || f.steps < 6 || f.steps > 22) return;
      var fields = JSON.stringify(f.workflow).indexOf('"fields":[') !== -1 ? 1 : 0;
      var score = fields * 100 + f.calledBy.length * 3 + f.steps + (f.exits && f.exits.length > 1 ? 5 : 0);
      if (score > bestScore) { best = k; bestScore = score; }
    });
    return best;
  }
  // The entity a preview shows: an own entity with the most to draw around it.
  function sampleEntity(data) {
    var degree = {};
    data.associations.forEach(function (a) { degree[a.from] = (degree[a.from] || 0) + 1; degree[a.to] = (degree[a.to] || 0) + 1; });
    var own = {};
    data.modules.forEach(function (m) { if (!m.marketplace) own[m.name] = true; });
    var best = null;
    Object.keys(data.entities).forEach(function (q) {
      var d = degree[q] || 0;
      if (!own[data.entities[q].module] || d > 14) return;
      if (!best || d > (degree[best] || 0)) best = q;
    });
    return best || Object.keys(data.entities)[0] || null;
  }

  function shot(data, state, caption, note) {
    var el = app.el;
    var frame = el('div', { class: 'docs-shot-frame' });
    var host = el('div', { class: 'docs-shot-host' });
    frame.appendChild(host);
    window.MxDocsView.mount(data, host, { theme: document.documentElement.getAttribute('data-mode') || 'dark', preview: true, state: state });
    // The reader is laid out at a desktop size and drawn small: scaled to
    // whatever width the frame gets, so it reads as a screenshot of the file.
    function fit() { if (frame.clientWidth) host.style.transform = 'scale(' + (frame.clientWidth / 1280) + ')'; }
    if (window.ResizeObserver) new ResizeObserver(fit).observe(frame);
    if (window.requestAnimationFrame) window.requestAnimationFrame(fit);
    return el('figure', { class: 'docs-shot' }, [frame, el('figcaption', {}, [el('strong', { text: caption }), el('span', { text: note })])]);
  }

  // The imported descriptions of a project, for the App Explorer: the record,
  // null when there is none, undefined while it loads (a render follows).
  function descriptionsFor(projectId) {
    if (!projectId) return null;
    loadDescriptions(projectId);
    if (descs[projectId] === undefined) waited[projectId] = true;
    return descs[projectId];
  }
  // Opening a project starts reading its descriptions beside its model
  // (app.js openProject) rather than after it: on a large project the model
  // takes a while to read, and the first screen then finds them there
  // instead of waiting for a second read to begin.
  function readAhead(projectId) { if (projectId) loadDescriptions(projectId); }

  // Read again from storage on the next draw: a package brought the project's descriptions in (transfer.js).
  function forgetDescriptions(projectId) { delete descs[projectId]; kept = null; built = []; pagesKept = {}; dom = null; }

  // What was decided about the risks (triage.js), which the documentation is drawn with: read with
  // the descriptions, and part of what decides whether a page is drawn again.
  function triageStamp(project) { return project && window.MxTriage ? (window.MxTriage.recordFor(project.id), window.MxTriage.stamp(project.id)) : ''; }

  // The tickets and changes a descriptions file carries are Assist items now (assist.js): moved there
  // whenever descriptions are read or kept. The move is idempotent — an item already there stays as it is.
  function assistFrom(projectId, row) {
    if (row && row.value && window.MxAssist && ((row.value.tickets || []).length || (row.value.changes || []).length)) window.MxAssist.migrate(projectId, row.value).catch(function () {});
  }

  // Descriptions kept: worked out from the record as the database holds it NOW (store.update: read, change
  // and write in one transaction, with a revision number), so a part that adds goes on top of whatever
  // another tab saved meanwhile instead of this tab's older copy writing over it (an external audit,
  // 2026-10-15, B05). make(the value kept now, or null) → the value to keep, synchronously.
  // → { row: the record kept, before: the one it replaced, for Undo }.
  function keepDescriptions(project, fileName, make) {
    var before = null;
    return app.store.update('descriptions', project.id, function (cur) {
      before = cur;
      return { projectId: project.id, importedAt: new Date().toISOString(), fileName: fileName, value: make(cur && cur.value ? cur.value : null) };
    }).then(function (r) { descs[project.id] = r.value; kept = null; return { row: r.value, before: before }; });
  }
  // A file that says "add": true goes on top of what is kept (describe.js merge); any other replaces it.
  function addOn(value) { return function (was) { return value.add ? window.MxDescribe.merge(was, value) : value; }; }
  // Another tab saved (or removed) this project's descriptions: read again, and drawn again when they moved.
  function otherTab(name, projectId) {
    // A project's settings another tab saved (its language among them): this tab's copy takes them, so it
    // neither shows the old ones nor writes them back with its next save.
    if (name === 'projects') {
      app.store.get('projects', projectId).then(function (row) {
        var p = row && app.findProject(projectId), moved = false;
        if (!p) return;
        ['name', 'contentLanguage', 'agentAutoSave'].forEach(function (k) { if (row[k] !== p[k]) { p[k] = row[k]; moved = true; } });
        if (moved) { kept = null; app.render(); }
      }).catch(function () {});
      return;
    }
    if (name !== 'descriptions' || descs[projectId] === undefined) return;
    app.store.get('descriptions', projectId).then(function (row) {
      if (JSON.stringify(row || null) === JSON.stringify(descs[projectId] || null)) return;
      forgetDescriptions(projectId);
      descs[projectId] = row || null;
      assistFrom(projectId, row);
      app.render();
    }).catch(function () {});
  }

  // Drawn again when they are in — if anything was drawn without them.
  var waited = {};
  function loadDescriptions(projectId) {
    if (Object.prototype.hasOwnProperty.call(descs, projectId)) return;
    descs[projectId] = undefined;
    function done(row) {
      descs[projectId] = row || null; kept = null;
      assistFrom(projectId, row);
      if (waited[projectId]) { delete waited[projectId]; app.render(); }
      held = {};
    }
    app.store.get('descriptions', projectId).then(done, function () { done(null); });
  }
  // While a project's descriptions are still being read, the documentation
  // is not built: it would be built without them and, a moment later, again
  // with them — on a large project, the cost of opening it twice. The read
  // takes a few milliseconds and draws the screen again when it is done.
  // A place a link asked for on a screen that was still waiting is kept for
  // when it is drawn.
  var held = {};
  function reading(project, view, patch) {
    // The descriptions and what was decided about the risks (triage.js, undefined while it loads).
    var wait = !!project && (descs[project.id] === undefined || (window.MxTriage && window.MxTriage.recordFor(project.id) === undefined));
    if (wait) waited[project.id] = true;
    if (wait && view && patch) held[view] = patch;
    return wait;
  }
  function heldPatch(view, patch) { var p = patch || held[view] || null; delete held[view]; return p; }
  function waiting() { return app.el('div', { class: 'docs-wait', 'aria-busy': 'true' }); }

  // The values the report's pages work out (reportdata.js), computed here and
  // carried in the file, so the reader only draws them. Worked out again for
  // a file of some modules only, so its numbers are about what it holds.
  function withDerived(data) { return window.MxDocsFile.withDerived(data); }

  // The documentation's data, with the AI's descriptions on it when there are
  // any. Used for the previews AND the export, so the file says what the
  // section showed.
  //
  // Built once per model, descriptions and project name, and handed back
  // after that: on a large project a build takes a noticeable part of a
  // second, and the section is drawn again on every click — sharing with an
  // agent, a message, an answer from it — while the model has not changed.
  // A few are kept, because the section reads the whole model and the
  // screens and the Entities screen read it with the System module added.
  var built = [];
  var KEEP_BUILT = 3;
  function buildData(model, project) {
    var rec = (project ? descs[project.id] : null) || null;
    var name = project ? project.name : null, tri = triageStamp(project);
    for (var i = 0; i < built.length; i++) {
      var b = built[i];
      if (b.model === model && b.rec === rec && b.name === name && b.tri === tri) return b.out;
    }
    var data = window.MxDocsData.build(model, project);
    var status = window.MxDescribe.attach(data, rec ? rec.value : null);
    // Only open and reopened risks count; the rest go to data.ai.triaged, with what was decided.
    if (project && window.MxTriage) window.MxTriage.apply(data, project.id, rec ? rec.value : null);
    var out = { data: withDerived(data), status: status, rec: rec, since: sinceOf(model, rec) };
    built.unshift({ model: model, rec: rec, name: name, tri: tri, out: out });
    built.length = Math.min(built.length, KEEP_BUILT);
    warm(out.data);
    return out;
  }

  // ---------- the model version the descriptions describe ----------
  // Karol, 2026-10-15: descriptions say which version of the model they were written for, so an
  // update can describe only what changed since. Every save of descriptions from an agent, an import
  // or the chat assistant stamps them with the version the model is now (from the Mendix project's
  // git, modelversion.js) — or drops the stamp, when the model's version is not known. A file someone
  // else wrote whole (descriptions.json in the folder, a package) keeps the stamp it carries.
  function stamped(project, value) {
    var V = window.MxModelVersion, v = project && project.summary ? project.summary.version : null;
    if (V.known(v)) value.describedAt = { commit: v.commit, short: v.short, branch: v.branch || null, date: v.date || null, message: v.message || null };
    else delete value.describedAt;
    return value;
  }
  // What moved in the Mendix project's git between the version the descriptions describe and the
  // model's: { same } or { commits } from the model's reflog, or null when it cannot be told.
  function sinceOf(model, rec) {
    var at = rec && rec.value ? rec.value.describedAt : null;
    return at && model ? window.MxModelVersion.since(at, window.MxModelVersion.clean(model.version, true)) : null;
  }
  // "Descriptions describe 9f8e7d6 (10 Oct 2026); the model is now a1b2c3d — 3 described flows changed since · 2 commits: …"
  function sinceLine(data, made) {
    var V = window.MxModelVersion, at = made.rec && made.rec.value ? made.rec.value.describedAt : null, now = data.version;
    if (!at) return null;
    if (now && now.commit === at.commit) return 'Descriptions describe this version of the model.';
    var head = 'Descriptions describe ' + V.short(at) + (V.day(at.date) ? ' (' + V.day(at.date) + ')' : '') + (now ? '; the model is now ' + V.short(now) : '; the model’s version now is not known');
    var bits = [];
    if (made.status.stale) bits.push(plural(made.status.stale, 'described flow', 'described flows') + ' changed since');
    var s = made.since;
    if (s && s.commits.length) bits.push(plural(s.commits.length, 'commit', 'commits') + ': ' + s.commits.slice(0, 3).map(function (c) { return '“' + (c.msg || c.short) + '”'; }).join(', ') + (s.commits.length > 3 ? ', …' : ''));
    return head + (bits.length ? ' — ' + bits.join(' · ') : '') + '.';
  }

  // Every flow's fingerprint and its text as the AI pack writes it: what the
  // chat assistant's card measures when the section is drawn, and what the
  // pack is made of when it is shared. On a large project that is a read of
  // several million characters, so it is worked out while the browser has
  // nothing else to do — a few flows at a time, never in the way of a click —
  // and kept with the flow (describe.js), for every build that holds it.
  // Nothing is sent or stored; the pack itself still waits to be asked for.
  var warming = null;
  function warm(data) {
    // The own modules' microflows and nanoflows: what the pack and the chat assistant's parts hold.
    var keys = [];
    data.modules.forEach(function (m) { if (!m.marketplace) keys = keys.concat(m.microflows, m.nanoflows); });
    var mine = warming = { data: data, at: 0 };
    var later = window.requestIdleCallback
      ? function (fn) { window.requestIdleCallback(fn, { timeout: 2000 }); }
      : function (fn) { setTimeout(function () { fn(null); }, 50); };
    function slice(deadline) {
      if (warming !== mine) return;
      // While the browser is idle, as long as it stays idle; otherwise a few milliseconds at a time.
      var idle = deadline && !deadline.didTimeout, until = Date.now() + 8;
      while (mine.at < keys.length && (idle ? deadline.timeRemaining() >= 1 : Date.now() <= until)) {
        window.MxDescribe.flowText(data.flows[keys[mine.at++]]);
      }
      if (mine.at < keys.length) later(slice);
      else warming = null;
    }
    later(slice);
  }

  // ---------- the section: a short header, then four tabs ----------
  // Karol, 2026-10-15: the page was one long column of cards and hard to read. Now: what is
  // described, then a tab for each way to work with an agent — the project's folder first (the
  // way in), the agent channel, without an agent tool (files carried by hand, a chat assistant),
  // and the export. The tab is kept with the open project (state.detail.docsTab), so it survives
  // every redraw; only the tab on screen is built — the previews, which mount the reader three
  // times, only on Export.
  // Karol, 2026-10-16: by what you want to do, not by mechanism — write it with Claude (where the project is,
  // and the line to give Claude), share it (the file, a package), or another way in (the agent channel, files
  // carried by hand, a chat assistant). The agent channel and "without an agent tool" were tabs of their own.
  var TABS = [['folder', 'Write with Claude'], ['export', 'Share'], ['other', 'Other ways']];
  var OLD_TAB = { agent: 'other', manual: 'other' };
  function tabOf() {
    var t = app.state.detail && app.state.detail.docsTab;
    t = OLD_TAB[t] || t;
    return TABS.some(function (x) { return x[0] === t; }) ? t : 'folder';
  }
  function setTab(t) {
    if (app.state.detail) app.state.detail.docsTab = OLD_TAB[t] || t;
    kept = null;
    app.render();
  }

  function render(model, project) {
    if (project) loadDescriptions(project.id);
    if (reading(project)) return waiting();
    var rec = (project ? descs[project.id] : null) || null;
    var mode = document.documentElement.getAttribute('data-mode') || 'dark';
    var tab = tabOf(), tri = triageStamp(project);
    // Inside the Mendix project the section also shows a git conflict and the model being read again.
    var repoSig = window.MxRepoUI && project ? window.MxRepoUI.signature(project) : '';
    if (kept && kept.model === model && kept.desc === rec && kept.mode === mode && kept.tab === tab && kept.tri === tri && kept.repoSig === repoSig) return kept.host;
    var el = app.el;
    var made = buildData(model, project);
    var data = made.data;
    syncShare(project, data);

    var body = null, agentBox = null, folderBox = null;
    if (tab === 'folder') body = folderBox = project ? folderCard(project) : null;
    else if (tab === 'other') {
      agentBox = agentCard(project);
      body = el('div', { class: 'docs-tab-body docs-other' }, [
        el('p', { class: 'muted docs-other-lead', text: 'When Claude cannot read the project where it is kept — another agent, another machine, a chat assistant.' }),
        agentBox, manualCard(data, made, project), project ? copilotCard(data, project, rec) : null]);
    }
    else body = exportTab(data, project);

    var host = el('div', { class: 'docs-landing' }, [
      window.MxRepoUI ? window.MxRepoUI.conflictCard(project) : null,
      headCard(data, made, project),
      el('div', { class: 'docs-tabs', role: 'tablist', 'aria-label': 'Ways to work with the documentation' }, TABS.map(function (x) {
        var on = x[0] === tab;
        return el('button', { type: 'button', role: 'tab', class: 'docs-tab' + (on ? ' on' : ''), 'aria-selected': on ? 'true' : 'false', 'data-tab': x[0], text: x[1],
          onclick: function () { if (!on) setTab(x[0]); } });
      })),
      el('div', { class: 'docs-tab-panel', role: 'tabpanel', 'data-tab': tab }, [body])
    ]);
    kept = { model: model, desc: rec, host: host, data: data, mode: mode, tab: tab, tri: tri, agent: agentBox, folder: folderBox, project: project, repoSig: repoSig };
    return host;
  }

  // What the project is and how much of it an agent described — above every tab.
  function headCard(data, made, project) {
    var el = app.el;
    var rec = made.rec, st = made.status, k = data.kpi;
    var own = 0;
    data.modules.forEach(function (m) { if (!m.marketplace) own += m.microflows.length + m.nanoflows.length; });
    var status = rec
      ? el('p', { class: 'docs-ai-status' }, [
          el('strong', { text: st.described + ' of ' + own + ' flows described' }),
          document.createTextNode(st.stale ? ' · ' + st.stale + ' out of date (the flow changed after it was described)' : ''),
          document.createTextNode(rec.value.app ? ' · with an overview of the application' + (rec.value.app.processes.length ? ' and ' + rec.value.app.processes.length + ' main processes' : '') : ''),
          document.createTextNode(rec.value.risks && rec.value.risks.length ? ' · ' + plural(rec.value.risks.length, 'risk', 'risks') : ''),
          document.createTextNode(rec.value.context ? ' · notes for developers' : ''),
          el('span', { class: 'hint', text: 'Imported ' + String(rec.importedAt || '').slice(0, 10) + (rec.fileName ? ' from ' + rec.fileName : '') + (rec.value.by ? ' · written by ' + rec.value.by : '') })
        ])
      : el('p', { class: 'muted docs-ai-none', text: 'No descriptions yet — ' + own + ' flows, none described. The documentation is complete without them; an AI agent adds the sentences a business reader looks for: what the application is for, its processes, a sentence on each flow, the risks ranked P1 to P3.' });
    var V = window.MxModelVersion, since = sinceLine(data, made);
    return el('div', { class: 'card docs-intro docs-head' }, [
      el('div', { class: 'docs-intro-text' }, [
        el('h2', { text: 'Documentation' }),
        el('p', { class: 'docs-lead', text: data.project + ' — ' + plural(k.modules, 'module', 'modules') + ' · ' + plural(k.microflows + k.nanoflows, 'flow', 'flows') + ' · ' + plural(k.entities, 'entity', 'entities') + ', read from its Mendix model.' }),
        el('p', { class: 'model-version-line docs-model-version', 'data-known': data.version ? 'true' : 'false' }, [el('strong', { text: 'Model: ' }),
          document.createTextNode(V.label(data.version || (project && project.summary ? project.summary.version : null)))]),
        status,
        since ? el('p', { class: 'hint docs-since', text: since }) : null,
        // A project kept inside the Mendix project: the model's version against the descriptions', and Re-read.
        window.MxRepoUI ? window.MxRepoUI.statusLine(project, made) : null
      ].filter(Boolean))
    ]);
  }

  // Export: the file, what is in it, and what it looks like.
  function exportTab(data, project) {
    var el = app.el, k = data.kpi;
    var flowKey = sampleFlow(data);
    var entity = sampleEntity(data);
    var inside = [
      ['Overview', 'What the application is, and its numbers at a glance: modules, microflows, nanoflows, pages, entities, roles, scheduled events and published services, each a link to its page. With an AI agent’s descriptions, also who uses it, what it talks to, what it does and what needs attention.'],
      ['Microflows, Nanoflows, Pages', plural(k.microflows, 'microflow', 'microflows') + ', ' + plural(k.nanoflows, 'nanoflow', 'nanoflows') + ' and ' + plural(k.pages, 'page', 'pages') + '. Each flow as the Microflows screen shows it — top to bottom in Workflow, as Studio Pro keeps it in Modeler: click a step for everything it does. Each page with its details and what opens it.'],
      ['Modules', plural(k.modules, 'own module', 'own modules') + ', each with its contents grouped by the first part of the name, which modules it uses and is used by, what it runs on its own, and its risks.'],
      ['Architecture', 'How the modules depend on one another, as a matrix, and which user roles reach which module — read from the model. With an AI agent’s descriptions, also what the application talks to and what it runs as.'],
      ['Entities', 'The domain model: ' + plural(k.entities, 'entity', 'entities') + ' in ' + plural(data.modules.filter(function (m) { return m.entities.length; }).length, 'module', 'modules') + ', one module drawn at a time with its associations, links to other modules at the foot of each entity; beside it the entity you pick — its attributes, associations and who may read, write, create and delete it.'],
      ['Model quality', 'Six checks read from the model, each against Mendix’s own guideline: elements nothing reaches, switched-off steps, scheduled events switched off, flows over 25 elements, prefixes outside the naming convention, and which microflows apply entity access.']
    ];
    var ai = data.ai || {};
    if (ai.app && (ai.app.processes.length || ai.app.story || ai.app.summary)) inside.splice(1, 0, ['Processes', 'The application’s full description, and each main process an AI agent described: its steps, the flows that carry it and the risks on them.']);
    if ((ai.risks && ai.risks.length) || (ai.triaged && ai.triaged.length)) inside.push(['Risks', plural(ai.risks.length, 'open risk', 'open risks') + ' an AI agent found in the model or a person raised in a comment, ranked P1 to P3, filtered by level, pattern, module and status, each with where it is and what to do — and, under their own filters, the ones marked fixed or false positive, with the reason.']);
    if (ai.context) inside.push(['For developers', 'Where things are, the naming the modules follow — each pattern with how many names match it — and what breaks easily, filtered by module and text; written by an AI agent for whoever changes the model next.']);
    var shots = el('div', { class: 'docs-shots' }, [
      shot(data, { view: 'start' }, 'Overview', 'Where the reader starts.'),
      flowKey ? shot(data, { view: 'refs', key: flowKey, module: data.flows[flowKey].module, seg: 'microflow' }, data.flows[flowKey].name, 'A microflow: entry, exit, and its workflow.') : null,
      entity ? shot(data, { view: 'domain', entity: entity }, data.entities[entity].name, 'An entity and the entities around it.') : null
    ]);
    // Sending the project itself, for someone to open in their MxScout — this one, or several (bundle.js).
    var send = project ? el('div', { class: 'card docs-intro docs-send' }, [
      el('div', { class: 'docs-intro-text' }, [
        el('h3', { text: 'Send the project to someone' }),
        el('p', { class: 'muted', text: 'An encrypted package of this project — the model, the descriptions, the solved cases — that a colleague opens in their own MxScout with an access code. Several projects at once: Export documentation… on the projects list.' })
      ]),
      el('div', { class: 'docs-intro-act' }, [el('button', { class: 'btn docs-send-pack', text: 'Package…', onclick: function () { window.MxTransfer.startPackaging(project.id); } })])
    ]) : null;
    return el('div', { class: 'docs-tab-body' }, [
      el('div', { class: 'card docs-intro docs-export' }, [
        el('div', { class: 'docs-intro-text' }, [
          el('h3', { text: 'The documentation as one file' }),
          el('p', { class: 'muted', text: 'One HTML file that documents ' + data.project + ' straight from its Mendix model — for the developers who maintain it, the testers who check it and the people who own it. It opens in any browser, on any machine, without MxScout. Or the same content as one Markdown file, for an AI tool or a wiki.' }),
          el('p', { class: 'muted', text: 'Built in this browser from the model loaded here, and sent nowhere. It is not encrypted: whoever has the file can read it, so share it the way you share the project.' })
        ]),
        el('div', { class: 'docs-intro-act' }, [
          el('button', { class: 'btn btn-primary', text: 'Export documentation…', onclick: function () { openExport(); } }),
          el('span', { class: 'hint', text: 'HTML or Markdown, for the modules you choose' })
        ])
      ]),
      send,
      el('h3', { class: 'docs-h', text: 'What is in it' }),
      el('div', { class: 'docs-inside' }, inside.map(function (x) {
        return el('div', { class: 'card docs-inside-item' }, [el('strong', { text: x[0] }), el('p', { class: 'muted', text: x[1] })]);
      })),
      el('h3', { class: 'docs-h', text: 'What it looks like' }),
      el('p', { class: 'muted docs-shots-note', text: 'These are the file’s own pages, drawn small from this project. In the file they are dark or light — the reader picks, or it follows the system.' }),
      shots
    ]);
  }

  // Sharing started or stopped, an answer came or was set aside, the folder was written: only the
  // card that says so is drawn again, not the section.
  function redrawAgent() { redrawCard('agent', agentCard); }
  function redrawFolder() { redrawCard('folder', folderCard); }
  function redrawCard(which, make) {
    var old = kept && kept[which];
    if (old && old.parentNode && kept.project) {
      var fresh = make(kept.project);
      old.parentNode.replaceChild(fresh, old);
      kept[which] = fresh;
    } else kept = null;
    app.render();
  }

  // ---------- without an agent tool: files carried by hand ----------
  function manualCard(data, made, project) {
    var el = app.el;
    var rec = made.rec;
    return el('div', { class: 'card docs-ai' }, [
      el('div', { class: 'docs-ai-text' }, [
        el('h3', { text: 'Carry the files yourself' }),
        el('p', { class: 'muted', text: 'For an agent that cannot reach this machine’s folders or MxScout — or when you would rather hand it one file. Export the AI pack, give it to the agent with the mendix-describe skill, and import the descriptions file it writes. In the documentation every such sentence is marked as written by AI.' }),
        el('p', { class: 'muted', text: 'For an AI chat assistant that runs no code, the chat assistant below cuts the model into small parts and writes the prompt to paste beside each.' })
      ]),
      el('div', { class: 'docs-ai-act' }, [
        el('button', { class: 'btn', text: 'Export AI pack', title: 'A text file: the model as the documentation reads it, one section per module', onclick: function () { exportPack(); } }),
        el('button', { class: 'btn', text: 'Import descriptions…', onclick: function () { importDescriptions(project); } }),
        rec ? el('button', { class: 'btn btn-ghost btn-sm', text: 'Remove descriptions', onclick: function () { removeDescriptions(project); } }) : null,
        el('span', { class: 'hint', text: 'The pack is not encrypted — it is meant for an agent on this machine. Keep it where you keep the project.' })
      ])
    ]);
  }

  // The AI pack of the data on screen, made when it is asked for — exported,
  // shared, or pushed again after the model changed — and kept with that data.
  var lastPack = null; // { data, pack }
  function packOf(data) {
    if (!lastPack || lastPack.data !== data) lastPack = { data: data, pack: window.MxDescribe.pack(data) };
    return lastPack.pack;
  }

  // The documentation as an agent reads it (docs-file.js forAgent): the Markdown copy of the own
  // modules with a header, null when there are no descriptions. Kept with its data, like the pack,
  // so the same data gives the same text and is not sent again. With it, the project's Assist items as
  // a short list (id, kind, title, status, planned), so the agent knows what is open and what is closed —
  // this text goes to the local agent only, never into the export.
  var lastDocs = null; // { data, lang, items, docs }
  function docsOf(data, project) {
    var lang = langLabel(project), items = project && window.MxAssist ? window.MxAssist.peek(project.id) || [] : [];
    if (!lastDocs || lastDocs.data !== data || lastDocs.lang !== lang || lastDocs.items !== items) {
      var b = built.filter(function (x) { return x.out.data === data; })[0];
      var since = b ? b.out.since : null;
      lastDocs = { data: data, lang: lang, items: items, docs: window.MxDocsFile.forAgent(data, { language: lang, assist: items, since: since && !since.same ? since.commits : null }) };
    }
    return lastDocs.docs;
  }

  // ---------- the language of written content ----------
  // One per project, kept with it (project.contentLanguage, an ISO code; English while it is not set),
  // so an agent writes every run in the same language (Karol, 2026-10-15). It goes to the agent in
  // documentation.md's header, project.json and the channel's status.
  function langLabel(project) { return project && project.contentLanguage ? window.MxDescribe.languageName(project.contentLanguage) : null; }
  function setLanguage(project, code) {
    var c = window.MxDescribe.languageCode(code) || null;
    // The project as the app holds it now: a field drawn earlier may hold an object the app has since replaced
    // (a model read again), and a choice written onto that one would be lost the next time the current one is saved.
    project = app.findProject(project.id) || project;
    if ((project.contentLanguage || null) === c) return Promise.resolve(false);
    project.contentLanguage = c;
    return app.store.put('projects', project).then(function () { kept = null; syncNow(); return true; });
  }
  // What an agent's result says about the language: the first result that names one sets the
  // project's language when it has none; "setLanguage": true sets it whatever it was (the person
  // asked for another). A result in another language than the project's is kept, with a warning.
  function noteLanguage(project, value) {
    var c = window.MxDescribe.languageCode(value && value.language);
    if (!project || !c) return null;
    if (!project.contentLanguage || value.setLanguage) { setLanguage(project, c); return null; }
    if (c === window.MxDescribe.languageCode(project.contentLanguage)) return null;
    return ' Note: it is written in ' + window.MxDescribe.languageName(c) + ', and this project’s descriptions are kept in ' + window.MxDescribe.languageName(project.contentLanguage) +
      ' — it is kept as it is; ask the agent to write in ' + window.MxDescribe.languageName(project.contentLanguage) + ', or change the language in Settings.';
  }
  // ---------- the default language (Karol, 2026-10-16) ----------
  // One choice for every project: a project with no language of its own takes it — all of them at once when
  // it is chosen, and every new one when it is made (app.js, transfer.js, bundle.js, folderui.js, repoui.js).
  // A project's own choice (its Settings) stays its own. Kept in `settings` as DEFAULT_LANG.
  var DEFAULT_LANG = 'contentLanguage';
  var defaultLang = null;
  function loadDefaultLanguage() {
    return app.store.get('settings', DEFAULT_LANG).then(function (r) { defaultLang = r && window.MxDescribe.languageCode(r.value) || null; return fillDefault(); }, function () { return null; });
  }
  function defaultLanguage() { return defaultLang; }
  function setDefaultLanguage(code) {
    defaultLang = window.MxDescribe.languageCode(code) || null;
    return (defaultLang ? app.store.put('settings', { key: DEFAULT_LANG, value: defaultLang }) : app.store.delete('settings', DEFAULT_LANG)).then(fillDefault).then(function (n) {
      app.setMessage(defaultLang ? 'Written content is in ' + window.MxDescribe.languageName(defaultLang) + ' for every project that had no language of its own' + (n ? ' (' + n + ' set now)' : '') + ', and for every new one.' : 'No default language: a project with none chosen is written in English.', 'ok');
      app.render();
    });
  }
  // Every project with no language of its own takes the default — one after another. → how many.
  function fillDefault() {
    if (!defaultLang) return Promise.resolve(0);
    var todo = (app.state.projects || []).filter(function (p) { return !p.contentLanguage; });
    return todo.reduce(function (pr, p) { return pr.then(function () { return setLanguage(p, defaultLang); }); }, Promise.resolve()).then(function () { return todo.length; });
  }
  // The default, as a select (Settings, settings.js).
  function defaultLanguageSelect() {
    var el = app.el, sel = el('select', { class: 'lang-default-select', 'aria-label': 'Default language of written content' });
    [['', 'English (no default)']].concat(window.MxDescribe.LANGUAGES.map(function (l) { return [l[0], l[1] + ' (' + l[0] + ')']; })).forEach(function (o) {
      var op = el('option', { value: o[0], text: o[1] }); if (o[0] === (defaultLang || '')) op.selected = true; sel.appendChild(op);
    });
    sel.addEventListener('change', function () { setDefaultLanguage(sel.value); });
    return sel;
  }

  // A project's language, as a select (Settings, settings.js); languageField wraps it with its label.
  function languageSelect(project, onChange) {
    var el = app.el;
    var sel = el('select', { class: 'lang-select', 'aria-label': 'Language of written content' });
    var cur = project.contentLanguage ? window.MxDescribe.languageCode(project.contentLanguage) : '';
    var opts = [['', defaultLang ? 'The default — ' + window.MxDescribe.languageName(defaultLang) : 'English (default — not chosen yet)']].concat(window.MxDescribe.LANGUAGES.map(function (l) { return [l[0], l[1] + ' (' + l[0] + ')']; }));
    if (cur && !opts.some(function (o) { return o[0] === cur; })) opts.push([cur, cur]);
    opts.forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (o[0] === cur) op.selected = true; sel.appendChild(op); });
    sel.addEventListener('change', function () {
      setLanguage(project, sel.value).then(function () { app.setMessage('Written content for "' + project.name + '" is in ' + window.MxDescribe.languageName(sel.value || (defaultLang || 'en')) + ' from now on.', 'ok'); if (onChange) onChange(); app.render(); });
    });
    return sel;
  }
  function languageField(project, onChange) {
    var el = app.el, sel = languageSelect(project, onChange);
    return el('label', { class: 'field lang-field' }, [el('span', { text: 'Language of written content' }), sel,
      el('span', { class: 'hint', text: 'What an agent writes for this project — descriptions, processes, risks, notes — is in this language, every time. Headings and labels stay English.' })]);
  }

  // ---------- sharing with an agent ----------
  // Instead of a file in each direction, an agent on this machine reads the AI
  // pack from this MxScout and sends the descriptions it wrote back — through
  // the server's memory (server/routes/agent.js), for as long as this tab
  // keeps sharing. The documentation as Markdown goes with the pack when the
  // project has descriptions, and again whenever they change (syncNow). What comes back is not kept until the person says so: it is
  // checked with the same parser as a file import and offered as a button.
  var agent = null; // { projectId, token, packText, docsText, docs, modules, offer, dismissed, timer, error }

  function agentCall(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + agent.token }, opts.headers || {});
    return fetch(path, opts);
  }

  function agentEnded(message) {
    if (agent && agent.timer) clearInterval(agent.timer);
    var projectId = agent && agent.projectId;
    agent = projectId ? { projectId: projectId, token: null, ended: message } : null;
    redrawAgent();
  }

  // What the agent sent waits on the server in a queue (server/routes/agent.js), oldest first; the tab takes one at
  // a time and then says which it took — by its id, so an acknowledgement can never remove a newer message that
  // arrived meanwhile (B04). An id being taken, or taken, is not offered again while the acknowledgement travels.
  function ackAgent(src, id) {
    if (!src || !src.token || !id) return;
    src.taken = src.taken || {};
    src.taken[id] = true;
    fetch('/api/agent/inbox?id=' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + src.token } })
      .then(function () { if (agent === src) pollAgent(true); }).catch(function () { /* the next poll sees it is still there, and it is not taken twice */ });
  }

  function pollAgent(soon) {
    if (!agent || !agent.token) return;
    if (!soon) syncNow();
    var mine = agent;
    agentCall('/api/agent/inbox').then(function (r) {
      if (agent !== mine) return null;
      if (r.status === 404 || r.status === 403) { agentEnded('Sharing has ended — the server no longer holds the pack. Share again to carry on.'); return null; }
      return r.json();
    }).then(function (j) {
      if (!j || agent !== mine) return;
      mine.waiting = j.waiting || 0;
      if (!j.pending) { if (mine.offer) { mine.offer = null; redrawAgent(); } return; }
      if ((mine.offer && mine.offer.id === j.id) || mine.dismissed === j.id || (mine.taken && mine.taken[j.id])) return;
      // A result the agent says is for another project (the id it read in the status) is not this one's to keep.
      if (j.projectId && j.projectId !== mine.projectId) { mine.offer = { id: j.id, error: 'it says it is for another project (' + j.projectId + '), not this one.' }; redrawAgent(); return; }
      mine.offer = makeOffer(j.id, j.text, j.receivedAt);
      // Saved straight away when the person left "save at once" on (Karol, 2026-10-14: no Import
      // step) — except a whole file over descriptions already kept, which would replace them:
      // that one still waits for a press.
      var project = app.findProject(mine.projectId);
      if (project && !mine.offer.error && takesAtOnce(project, mine.offer)) { takeOffer(project, true, mine); return; }
      redrawAgent();
    }).catch(function () { /* the next tick tries again */ });
  }

  function startShare(project) {
    var data = current();
    if (!data || !project) return;
    var p = packOf(data), d = docsOf(data, project);
    var again = agent && agent.projectId === project.id && agent.token ? agent.token : undefined;
    fetch('/api/agent/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: p.text, docs: d ? d.text : null, token: again, language: project.contentLanguage || null, projectId: project.id }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not share the pack.'); return j; }); })
      .then(function (j) {
        if (agent && agent.timer) clearInterval(agent.timer);
        agent = { kind: 'channel', projectId: project.id, token: j.token, packText: p.text, docsText: d ? d.text : null, docs: d, modules: j.modules, offer: null, dismissed: null, timer: null };
        agent.timer = setInterval(function () { pollAgent(); }, 2000);
        redrawAgent();
      })
      .catch(function (err) { agent = { projectId: project.id, token: null, ended: (err && err.message) || 'Could not share the pack.' }; redrawAgent(); });
  }

  // The model was replaced, or the descriptions kept changed, while sharing:
  // the agent reads the new pack and the new documentation, on the same token.
  // Only when one of them actually changed.
  function syncShare(project, data) {
    if (!agent || !agent.token || !project || agent.projectId !== project.id || agent.pushing) return;
    var p = packOf(data), d = docsOf(data, project), dText = d ? d.text : null;
    if (p.text === agent.packText && dText === agent.docsText) return;
    var mine = agent;
    mine.pushing = true;
    fetch('/api/agent/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: p.text, docs: dText, token: mine.token, language: project.contentLanguage || null, projectId: project.id }) })
      .then(function (r) {
        mine.pushing = false;
        if (!r.ok) return;
        var docsMoved = dText !== mine.docsText;
        mine.packText = p.text; mine.docsText = dText; mine.docs = d;
        if (docsMoved && agent === mine) redrawAgent();
      })
      .catch(function () { mine.pushing = false; });
  }
  // The same, from wherever the person is: an agent's save, Undo, an import or
  // a replaced model change what is shared even when this section is not on
  // screen, so the share is checked on every poll and after each of those —
  // against the model of the project that is open, when it is the shared one.
  function syncNow() {
    folderSoon();
    if (!agent || !agent.token) return;
    var s = app.state;
    if (!s.detail || s.activeId !== agent.projectId) return;
    var project = app.findProject(agent.projectId);
    if (!project) return;
    loadDescriptions(project.id);
    if (descs[project.id] === undefined) return;
    syncShare(project, buildData(s.detail.rawModel || s.detail.model, project).data);
  }

  function stopShare(quiet) {
    if (!agent) return;
    var mine = agent;
    if (mine.timer) clearInterval(mine.timer);
    agent = null;
    if (mine.token) fetch('/api/agent/share', { method: 'DELETE', headers: { Authorization: 'Bearer ' + mine.token }, keepalive: true }).catch(function () {});
    if (!quiet) redrawAgent();
  }

  function hasDescriptions(project) { var was = descs[project.id]; return !!(was && was.value); }
  function addedWhat(v) {
    var procs = v.app ? v.app.processes.map(function (p) { return p.name; }) : [];
    var flows = Object.keys(v.microflows).length + Object.keys(v.nanoflows).length;
    // Tickets and changes in a descriptions file go to the Assist page (assistFrom).
    var moved = (v.changes || []).length + (v.tickets || []).length;
    return [procs.length ? (procs.length === 1 ? 'the process ' : 'the processes ') + procs.join(', ') : null,
      moved ? plural(moved, 'ticket or change', 'tickets and changes') + ' for the Assist page' : null,
      flows ? plural(flows, 'flow', 'flows') : null, v.risks && v.risks.length ? plural(v.risks.length, 'risk', 'risks') : null].filter(Boolean).join(', ') || 'nothing new';
  }

  // "Save at once": on unless the person turned it off for this project (kept with the project). One
  // switch for both ways an agent hands results back: the channel and the folder's inbox.
  function autoSave(project) { return project.agentAutoSave !== false; }
  function setAutoSave(project, on) {
    project.agentAutoSave = !!on;
    app.store.put('projects', project).catch(function () {});
    if (kept && kept.tab === 'folder') redrawFolder(); else redrawAgent();
  }
  // A file that adds is saved at once; a whole one only when there is nothing yet for it to replace.
  // Items for the Assist page never replace anything wholesale (an item by its id, its history kept): at once.
  // A solved case is a note of its own, by its path: at once too.
  function takesAtOnce(project, offer) { return autoSave(project) && (offer.assist || offer.knowledge || offer.add || !hasDescriptions(project)); }

  // What an agent handed back, read with the same parser as a file import, before anything is kept.
  // Items for the Assist page (assist.js) come the same ways, in an envelope of their own.
  function makeOffer(id, text, receivedAt) {
    // A solved case (knowledge.js): an envelope of its own, or — in the folder's inbox — the .md note itself.
    if (window.MxKnowledge && (window.MxKnowledge.isEnvelope(text) || window.MxKnowledge.isNote(text, id))) {
      var kn = window.MxKnowledge.parse(text, id);
      return kn.error ? { id: id, error: kn.error } : { id: id, knowledge: kn.value, receivedAt: receivedAt };
    }
    if (window.MxAssist && window.MxAssist.isEnvelope(text)) {
      var env = window.MxAssist.parseEnvelope(text);
      return env.error ? { id: id, error: env.error } : { id: id, assist: env.value, receivedAt: receivedAt };
    }
    var parsed = window.MxDescribe.parse(text);
    if (parsed.error) return { id: id, error: parsed.error };
    var v = parsed.value;
    return { id: id, value: v, receivedAt: receivedAt, add: !!v.add,
      processes: v.app ? v.app.processes.map(function (p) { return p.name; }) : [],
      flows: Object.keys(v.microflows).length + Object.keys(v.nanoflows).length, risks: (v.risks || []).length, app: !!v.app };
  }

  // The two places an offer comes from share this: `src` is the agent channel's state (agent) or the
  // folder's inbox (inboxOf). Taking it keeps it, says so with Undo, and tells the source it was
  // taken — the channel drops it from the server's memory, the inbox moves the file to inbox/done/.
  function takeOffer(project, auto, src) {
    src = src || agent;
    var offer = src && src.offer;
    if (offer && offer.assist && project) { takeAssist(project, auto, src); return; }
    if (offer && offer.knowledge && project) { takeKnowledge(project, auto, src); return; }
    if (!offer || !offer.value || !project) return;
    // What was decided about the risks before this import, which the import reconciles (triage.js):
    // Undo puts it back too.
    var triageBefore = window.MxTriage ? JSON.parse(JSON.stringify(window.MxTriage.recordFor(project.id) || null)) : null;
    var what = offer.value.add ? addedWhat(offer.value) : 'descriptions for the whole application';
    var langNote = offer.fromFile ? null : noteLanguage(project, offer.value);
    var name = src.kind === 'folder' ? offer.fileName || (offer.id + ' from the folder’s inbox') : 'sent by an agent';
    keepDescriptions(project, name, function (was) {
      var value = addOn(offer.value)(was);
      // A descriptions.json someone else wrote keeps the version it names; what an agent sent is for the model as it is now.
      return offer.fromFile ? value : stamped(project, value);
    }).then(function (k) {
      var row = k.row, before = k.before;
      assistFrom(project.id, row);
      src.offer = null;
      // What was kept before, so the save can be taken back from the card.
      src.saved = { what: what, before: before, triage: triageBefore, row: row, at: new Date().toISOString(), auto: !!auto };
      if (src.kind === 'folder' && src.ack) src.ack(offer);
      else if (src.kind !== 'folder') ackAgent(src, offer.id);
      return offer.fromRepo ? '' : reconcile(project, offer.value, before);
    }).then(function (said) {
      if (src.kind === 'folder') {
        var undo = { label: 'Undo', onclick: function () { undoSave(project, src); } };
        app.setMessage((offer.message || ((auto ? 'Saved what the agent left in the folder’s inbox: ' : offer.value.add ? 'Added to the descriptions: ' : 'Imported: ') + what + '.')) + said + (langNote || ''), langNote ? 'error' : 'ok', undo);
      } else {
        app.setMessage((auto ? 'Saved what the agent sent: ' : offer.value.add ? 'Added to the descriptions: ' : 'Imported: ') + what + '.' + said + (langNote || ''), langNote ? 'error' : 'ok');
      }
      app.render();
      syncNow();
    }).catch(function (err) { app.setMessage('Could not import the descriptions: ' + ((err && err.message) || err), 'error'); app.render(); });
  }
  // Items for the Assist page, saved by assist.js: "saved at once" and Undo as for descriptions, from the
  // agent channel and from the folder's inbox alike. An envelope refused whole (an update for an item this
  // project does not keep) is said where it was offered, and nothing of it is kept.
  function takeAssist(project, auto, src) {
    var offer = src.offer;
    window.MxAssist.apply(project.id, offer.assist).then(function (res) {
      src.offer = null;
      src.saved = { what: res.what + ' on the Assist page', assist: res, at: new Date().toISOString(), auto: !!auto };
      var langNote = noteLanguage(project, { language: offer.assist.language, setLanguage: !!offer.assist.setLanguage });
      var said = (auto ? (src.kind === 'folder' ? 'Saved what the agent left in the folder’s inbox: ' : 'Saved what the agent sent: ') : 'Saved: ') + res.what + ' on the Assist page.' +
        (res.dropped.length ? ' Left out: ' + res.dropped.slice(0, 3).join('; ') + '.' : '') + (langNote || '');
      if (src.kind === 'folder') {
        if (src.ack) src.ack(offer);
        app.setMessage(said, langNote || !res.changed.length ? 'error' : 'ok', { label: 'Undo', onclick: function () { undoSave(project, src); } });
      } else {
        ackAgent(src, offer.id);
        app.setMessage(said, langNote || !res.changed.length ? 'error' : 'ok');
      }
      app.render();
      syncNow();
    }).catch(function (err) {
      var msg = (err && err.message) || String(err);
      if (src.offer === offer) {
        src.offer = { id: offer.id, error: msg, inbox: offer.inbox, key: offer.key };
        if (src.kind === 'folder') redrawFolderQuiet(); else redrawAgent();
      }
      app.setMessage('Could not save what the agent sent: ' + msg, 'error'); app.render();
    });
  }
  // A solved case an agent handed in, saved by knowledge.js — and so written into knowledge/ — at once, with Undo,
  // from the channel and the folder's inbox alike. A note with an error (personal data among them) never got here:
  // makeOffer refused it whole.
  function takeKnowledge(project, auto, src) {
    var offer = src.offer;
    window.MxKnowledge.apply(project.id, offer.knowledge).then(function (res) {
      src.offer = null;
      src.saved = { what: res.what, knowledge: res, at: new Date().toISOString(), auto: !!auto };
      var info = app.store.folderInfo(project.id);
      var where = info ? (info.layout === 2 ? (info.repoName || 'the Mendix project') + '/mxscout/knowledge/' : info.name + '/knowledge/') : null;
      var said = (auto ? (src.kind === 'folder' ? 'Saved what the agent left in the folder’s inbox: ' : 'Saved what the agent sent: ') : 'Saved: ') + res.what +
        (!res.changed.length ? ' — the same note is kept already.' : where ? ', written into ' + where + ' — commit it with the fix.' : ' — kept in this browser; it goes into knowledge/ when the project is kept in a folder.');
      if (src.kind === 'folder') {
        if (src.ack) src.ack(offer);
        app.setMessage(said, 'ok', { label: 'Undo', onclick: function () { undoSave(project, src); } });
      } else {
        ackAgent(src, offer.id);
        app.setMessage(said, 'ok');
      }
      if (src.kind === 'folder') redrawFolderQuiet(); else redrawAgent();
      app.render();
    }).catch(function (err) {
      var msg = (err && err.message) || String(err);
      if (src.offer === offer) { src.offer = { id: offer.id, error: msg, inbox: offer.inbox, key: offer.key }; if (src.kind === 'folder') redrawFolderQuiet(); else redrawAgent(); }
      app.setMessage('Could not save the solved case: ' + msg, 'error'); app.render();
    });
  }
  function savedNow(project, s) { return s.assist ? window.MxAssist.canUndo(project.id, s.assist) : s.knowledge ? window.MxKnowledge.canUndo(project.id, s.knowledge) : descs[project.id] === s.row; }

  // Undo the last save from an agent: the descriptions — or the Assist items — go back to what they were before it.
  function undoSave(project, src) {
    src = src || agent;
    var s = src && src.saved;
    if (s && s.knowledge && project) {
      window.MxKnowledge.undo(project.id, s.knowledge).then(function () {
        src.saved = null;
        app.setMessage('Undone: the solved cases are as they were before the agent’s last answer.', 'ok');
        if (src.kind === 'folder') redrawFolderQuiet(); else redrawAgent();
        app.render();
      }).catch(function (err) { app.setMessage('Could not undo: ' + ((err && err.message) || err), 'error'); app.render(); });
      return;
    }
    if (s && s.assist && project) {
      window.MxAssist.undo(project.id, s.assist).then(function () {
        src.saved = null;
        app.setMessage('Undone: the Assist page is as it was before the agent’s last answer.', 'ok');
        app.render();
        syncNow();
      }).catch(function (err) { app.setMessage('Could not undo: ' + ((err && err.message) || err), 'error'); app.render(); });
      return;
    }
    if (!s || !project || descs[project.id] !== s.row) return;
    // Only over the very record that save left (its revision, as the database holds it): what another tab saved since is never undone.
    var back = app.store.update('descriptions', project.id, function (cur) {
      if (!cur || cur.rev !== s.row.rev) throw new Error('the descriptions changed since — another tab or the folder — so there is nothing to undo.');
      if (s.before) { var b = JSON.parse(JSON.stringify(s.before)); return b; }
      return undefined;
    }).then(function (r) { return s.before ? r : app.store.delete('descriptions', project.id).then(function () { return null; }); });
    if (window.MxTriage) back = back.then(function (r) { return window.MxTriage.restore(project.id, s.triage).then(function () { return r; }); });
    back.then(function (r) {
      descs[project.id] = s.before ? r.value : null; kept = null;
      src.saved = null;
      app.setMessage('Undone: the descriptions are as they were before the agent’s last answer.', 'ok');
      app.render();
      syncNow();
    }).catch(function (err) { app.setMessage('Could not undo: ' + ((err && err.message) || err), 'error'); app.render(); });
  }

  // New descriptions came in: what was decided about the risks is checked against them (triage.js) —
  // a risk marked fixed and still reported is reopened, one no longer reported is verified. Resolves
  // to a sentence saying what happened, or ''.
  function reconcile(project, incoming, was) {
    if (!window.MxTriage) return Promise.resolve('');
    return window.MxTriage.afterImport(project.id, incoming, was && was.value).catch(function () { return ''; });
  }

  function leaveOffer(src) {
    src = src && src.kind ? src : agent;
    if (!src || !src.offer) return;
    if (src.kind === 'folder') {
      var o = src.offer;
      src.offer = null;
      // A file MxScout cannot use goes to inbox/done/ (it would be offered again otherwise); one set
      // aside with Not now stays in inbox/ and is offered again the next time the project is opened.
      if (o.error && src.ack) src.ack(o); else src.dismissed[o.key] = true;
      redrawFolder();
      return;
    }
    var id = src.offer.id;
    src.dismissed = id; src.offer = null;
    ackAgent(src, id);
    redrawAgent();
  }

  // What an offer and the last save look like, on the agent card and on the folder card alike.
  function offerNodes(project, src, savedClass) {
    var el = app.el, kids = [];
    if (src.saved && savedNow(project, src.saved)) {
      kids.push(el('div', { class: savedClass }, [
        el('p', { class: 'ok-text', text: 'Saved ' + (src.saved.auto ? 'at once' : '') + ': ' + src.saved.what + '.' }),
        el('button', { class: 'btn btn-ghost btn-sm', text: 'Undo', onclick: function () { undoSave(project, src); } })
      ]));
    }
    var o = src.offer;
    if (o) {
      var from = src.kind === 'folder' ? 'The agent left ' + o.id + ' in inbox/' : 'The agent sent';
      if (o.error) kids.push(el('p', { class: 'warn-text', text: (src.kind === 'folder' ? from + ', a file' : 'The agent sent a file') + ' MxScout cannot use: ' + o.error }));
      else if (o.assist) kids.push(el('p', { class: 'ok-text', text: from + ' ' + plural(o.assist.items.length + o.assist.updates.length, 'item', 'items') + ' for the Assist page. Nothing is kept until you save them.' }));
      else if (o.knowledge) kids.push(el('p', { class: 'ok-text', text: from + ' ' + plural(o.knowledge.files.length, 'solved case', 'solved cases') + ' for knowledge/: ' + o.knowledge.files.map(function (f) { return f.id; }).join(', ') + '. Nothing is kept until you save it.' }));
      else if (o.add) kids.push(el('p', { class: 'ok-text', text: from + ' — more to add to the descriptions you have: ' + addedWhat(o.value) + '. The rest stays as it is; nothing is kept until you import them.' }));
      else {
        kids.push(el('p', { class: 'ok-text', text: from + ' — descriptions: ' + plural(o.flows, 'flow', 'flows') + (o.risks ? ', ' + plural(o.risks, 'risk', 'risks') : '') + (o.app ? ', an overview of the application' : '') + '. Nothing is kept until you import them.' }));
        // A file without "add" replaces what is kept: say so while it can still be refused.
        if (hasDescriptions(project)) kids.push(el('p', { class: 'warn-text', text: 'Importing them replaces the descriptions this project has now. If the agent described only part of the application, ask it to send the file with "add": true to keep the rest.' }));
      }
      kids.push(el('div', { class: 'docs-agent-act' }, [
        o.error ? null : el('button', { class: 'btn btn-primary', text: o.assist || o.knowledge ? 'Save them' : 'Import them', onclick: function () { takeOffer(project, false, src); } }),
        el('button', { class: 'btn btn-ghost', text: o.error ? 'Dismiss' : 'Not now', onclick: function () { leaveOffer(src); } })
      ]));
      // The channel keeps what the agent sent in a queue: the others wait, in the order they came.
      if (src.kind !== 'folder' && src.waiting > 1) kids.push(el('p', { class: 'muted docs-agent-waiting', text: plural(src.waiting - 1, 'more result waits', 'more results wait') + ' after this one; each is offered in turn.' }));
    }
    return kids;
  }

  function copyButton(line) {
    return app.el('button', { class: 'btn btn-sm', text: 'Copy for the agent', onclick: function (ev) {
      var b = ev.currentTarget;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(line).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Select the line to copy it'; });
      else b.textContent = 'Select the line to copy it';
    } });
  }

  function agentCard(project) {
    var el = app.el;
    var on = agent && project && agent.projectId === project.id ? agent : null;
    var kids = [el('h3', { text: 'Let an agent read it through MxScout' })];
    if (!on || !on.token) {
      kids.push(el('p', { class: 'muted', text: 'The second way in, for an agent that reaches MxScout on this machine but not the project’s folder — or for a project not kept in one. An agent reads the AI pack from MxScout, one module at a time — and, when this project has descriptions, the documentation as Markdown, to start from what was understood before — and sends what it wrote back. Both are held in this server’s memory only, behind a token, until you stop sharing or close this tab.' }));
      if (on && on.ended) kids.push(el('p', { class: 'warn-text', text: on.ended }));
      kids.push(el('div', { class: 'docs-agent-act' }, [el('button', { class: 'btn', text: 'Share with an agent', onclick: function () { startShare(project); } })]));
    } else {
      var line = 'Use the mendix-describe skill on the MxScout at ' + location.origin + ', token ' + on.token + '.';
      kids.push(el('p', { class: 'docs-ai-status' }, [el('strong', { text: 'Sharing ' + plural(on.modules, 'module', 'modules') }),
        document.createTextNode(on.docs ? ' and the documentation (' + on.docs.described + ' of ' + on.docs.flows + ' flows described' + (on.docs.stale ? ', ' + on.docs.stale + ' out of date' : '') + ')' : ''),
        document.createTextNode(' — the agent can read it now.')]));
      kids.push(el('div', { class: 'code-display' }, [el('code', { class: 'code-value', text: line }), copyButton(line)]));
      kids.push(el('p', { class: 'hint', text: 'Paste that line to your agent. The token stops working when you stop sharing, reload or close this tab.' }));
      var auto = el('input', { type: 'checkbox' });
      auto.checked = autoSave(project);
      auto.addEventListener('change', function () { setAutoSave(project, auto.checked); });
      kids.push(el('label', { class: 'docs-agent-auto' }, [auto, document.createTextNode(' Save what the agent sends at once — a whole file that would replace the descriptions you have still waits for you')]));
      offerNodes(project, on, 'docs-agent-saved').forEach(function (n) { kids.push(n); });
      kids.push(el('div', { class: 'docs-agent-act' }, [el('button', { class: 'btn btn-ghost btn-sm', text: 'Stop sharing', onclick: function () { stopShare(); } })]));
    }
    return el('div', { class: 'card docs-agent' }, kids);
  }

  // ---------- the project's folder ----------
  // The first way in (Karol, 2026-10-15): the project kept as files in a folder the person picked —
  // store.js writes it after every save — that an agent reads directly and hands its results back
  // to through inbox/. This card says where it is, what each file is and when it was written, what
  // waits in the inbox, and the line to paste to an agent.
  var inboxes = {}; // projectId -> { kind: 'folder', offer, saved, dismissed, files, ack }
  function inboxOf(projectId) {
    if (!inboxes[projectId]) {
      var box = inboxes[projectId] = { kind: 'folder', projectId: projectId, offer: null, saved: null, dismissed: {}, files: null };
      box.ack = function (offer) {
        if (!offer.inbox) return;
        app.store.folderInboxDone(projectId, offer.id).then(function () { box.files = (box.files || []).filter(function (f) { return f.name !== offer.id; }); redrawFolderQuiet(); }, function () {});
      };
    }
    return inboxes[projectId];
  }
  // The Folder card, drawn again when the folder moved (a file written, a tick) — but never from under the
  // person's hands: while a field in it has the focus (the language list open, a path being typed) it waits
  // until they leave it. Inside the Mendix project a tick writes every two seconds, and drawing the card again
  // then closed an open list before the choice landed — the language "reset" (Karol, 2026-10-15).
  function redrawFolderQuiet() {
    if (!(kept && kept.folder && kept.folder.parentNode)) return;
    var a = document.activeElement, box = kept.folder;
    if (a && box.contains(a) && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName)) {
      if (!box.waiting) {
        box.waiting = true;
        a.addEventListener('blur', function () { setTimeout(function () { box.waiting = false; if (kept && kept.folder === box) redrawFolderQuiet(); }, 0); }, { once: true });
      }
      return;
    }
    redrawFolder();
  }

  var polling = false;
  function folderTick() {
    var s = app.state;
    if (!s.detail || !s.activeId || polling) return Promise.resolve();
    var project = app.findProject(s.activeId);
    var info = project ? app.store.folderInfo(project.id) : null;
    if (!info || info.status !== 'connected') return Promise.resolve();
    loadDescriptions(project.id);
    if (descs[project.id] === undefined) return Promise.resolve();
    writeDerived(project);
    var box = inboxOf(project.id);
    polling = true;
    // Inside the Mendix project: descriptions an agent wrote straight into mxscout/descriptions/, or a pull
    // brought, are taken in first (newer files win, with Undo).
    var shared = info.layout === 2 ? app.store.refreshFolder(project.id) : Promise.resolve();
    return shared.then(function () { return app.store.folderInbox(project.id); }).then(function (files) {
      var before = JSON.stringify(box.files);
      box.files = files;
      var next = null;
      for (var i = 0; i < files.length; i++) {
        var f = files[i], key = f.name + ':' + f.lastModified;
        // Not one still being written: a file a minute old has been put down.
        if (box.dismissed[key] || Date.now() - f.lastModified < 1000) continue;
        next = f; break;
      }
      // One at a time, in the order they came: an offer that waits for a press holds the rest.
      if (!next || box.offer) { if (before !== JSON.stringify(files)) redrawFolderQuiet(); return null; }
      return app.store.folderInboxRead(project.id, next.name).then(function (r) {
        if (!r) return;
        var offer = makeOffer(next.name, r.text, new Date(next.lastModified).toISOString());
        offer.inbox = true;
        offer.key = next.name + ':' + next.lastModified;
        box.offer = offer;
        if (!offer.error && takesAtOnce(project, offer)) { takeOffer(project, true, box); return; }
        app.setMessage(offer.error ? 'The agent left ' + next.name + ' in the folder’s inbox, and MxScout cannot use it: ' + offer.error
          : 'The agent left ' + (offer.assist ? 'items for the Assist page' : offer.knowledge ? 'a solved case' : 'descriptions') + ' in the folder’s inbox (' + next.name + ') — they wait for you in Documentation.', offer.error ? 'error' : 'ok',
          { label: 'Open', onclick: function () { if (app.state.detail) { app.state.detail.docsTab = 'folder'; app.state.detail.view = 'docs'; } kept = null; app.setMessage(null); app.render(); } });
        kept = null;
        app.render();
      });
    }).catch(function () { /* the folder's state says what went wrong; the next tick tries again */ })
      .then(function () { polling = false; });
  }

  // documentation.md and ai-pack.md for the open project: made from the same data as the section,
  // handed to store.js, which writes them only when their text changed. Their "generated:" line
  // says when what they hold last changed, not when they were made — so opening the project again
  // does not rewrite a file in someone's git repository with nothing new in it.
  function derivedOf(data, project, rec) {
    var d = docsOf(data, project);
    var when = [rec && rec.importedAt, project && project.updatedAt].filter(Boolean).sort().pop() || data.generatedAt;
    var model = (project && project.summary && project.summary.generatedAt) || (project && project.updatedAt) || data.generatedAt;
    return {
      'documentation.md': steady(d ? d.text : emptyDocs(data, project), when),
      'ai-pack.md': steady(packOf(data).text, model)
    };
  }
  function steady(text, when) { return String(text).replace(/^generated: .*$/m, 'generated: ' + when); }
  function emptyDocs(data, project) {
    var flows = 0;
    data.modules.forEach(function (m) { if (!m.marketplace) flows += m.microflows.length + m.nanoflows.length; });
    return [window.MxDocsFile.AGENT_DOCS_HEAD + ' — ' + data.project, '', 'project: ' + data.project, 'mendix: ' + (data.mendix || 'unknown'),
      'model: ' + (window.MxDocsData.versionText(data.version) || 'version unknown (no git commit was read with this model)')].concat(data.version ? ['model commit: ' + data.version.commit] : []).concat([
      'generated: ' + data.generatedAt, 'flows described: 0 of ' + flows, 'out of date: 0',
      'Write in: ' + (langLabel(project) || 'not set yet — ask the person once (English by default); the answer is kept for the project'), '',
      '> No descriptions yet: nothing has been understood before. Start from ai-pack.md — its ## index, then one module at a time.', '']).join('\n');
  }
  function writeDerived(project) {
    var s = app.state;
    if (!s.detail || s.activeId !== project.id) return;
    var made = buildData(s.detail.rawModel || s.detail.model, project);
    var texts = derivedOf(made.data, project, made.rec);
    app.store.folderDerived(project.id, 'documentation.md', texts['documentation.md']);
    app.store.folderDerived(project.id, 'ai-pack.md', texts['ai-pack.md']);
  }
  // The same two files for a project that is not open — moving projects to folders (folderui.js).
  function derivedFor(model, project, rec) {
    var data = window.MxDocsData.build(model, project);
    window.MxDescribe.attach(data, rec ? rec.value : null);
    return derivedOf(withDerived(data), project, rec);
  }

  // A project kept inside the Mendix project: the files of mxscout/docs/ (repodocs.js), made from the model
  // and the descriptions this browser keeps — the documentation's Markdown of the own modules, split by topic.
  // store.js asks for them only when the descriptions changed; `hash` is what they are made from.
  function repoDocs(projectId, hash) {
    var project = app.findProject(projectId);
    // Developer tools: the risk decisions and the comments come from storage too, as Node reads triage.json and comments/ —
    // never this tab's copies, which may still be loading after a pull or hold only the open project's comments.
    return Promise.all([app.store.getModel(projectId), app.store.get('descriptions', projectId), app.store.get('knowledge', projectId),
      app.store.get('triage', projectId), app.store.byIndex('findings', 'byProject', projectId)]).then(function (b) {
      if (!b[0] || !project) throw new Error('the model is missing from this browser’s storage.');
      var rec = b[1], data = window.MxDocsData.build(b[0], project), cases = b[2] ? b[2].files : [];
      window.MxDescribe.attach(data, rec ? rec.value : null);
      // As the section draws it: only open and reopened risks count; the rest with what was decided (triage.js).
      if (window.MxTriage) window.MxTriage.apply(data, project.id, rec ? rec.value : null, { rec: b[3] || null, findings: b[4] || [] });
      var own = {};
      data.modules.forEach(function (m) { own[m.name] = !m.marketplace; });
      return window.MxRepoDocs.docsFiles(withDerived(window.MxDocsFile.subset(data, own)), {
        id: project.id, app: project.name, describedAt: rec && rec.value ? rec.value.describedAt || null : null, descriptions: hash, cases: cases
      });
    });
  }

  // The descriptions.json in a project's folder was newer than this browser's copy (someone edited
  // it, an agent replaced it, git brought another): the folder wins — saved, with Undo, like an
  // agent's answer. Nothing happens when it says what this browser already holds.
  function adoptFolderDescriptions(project, text, where) {
    if (!project) return Promise.resolve();
    var name = where || 'descriptions.json';
    return app.store.get('descriptions', project.id).then(function (row) {
      // The same record read again is not a new one: a new object here would build the open page anew.
      if (descs[project.id] === undefined || JSON.stringify(descs[project.id]) !== JSON.stringify(row || null)) descs[project.id] = row || null;
      var parsed = window.MxDescribe.parse(text);
      if (parsed.error) { app.setMessage(name + ' in the project’s folder could not be read, so this browser’s copy stays: ' + parsed.error, 'error'); app.render(); return; }
      var same = row && row.value && JSON.stringify(window.MxDescribe.toFile(row.value)) === JSON.stringify(window.MxDescribe.toFile(parsed.value));
      if (same) return;
      var box = inboxOf(project.id);
      var offer = makeOffer('descriptions.json', text, new Date().toISOString());
      offer.value.add = false; offer.add = false;
      offer.fileName = name + ' in the project’s folder';
      offer.fromFile = true;
      // From mxscout/ inside the Mendix project the team's triage.json comes with them, reconciled already
      // by whoever saved them: reconciling again here would only rewrite it (with new times) for nothing.
      offer.fromRepo = !!where;
      offer.message = row && row.value ? 'Took ' + name + ' from the project’s folder — it was newer than this browser’s copy.' : 'Took ' + name + ' from the project’s folder.';
      box.offer = offer;
      takeOffer(project, true, box);
    });
  }

  function fmtWhen(ms) {
    if (!ms) return null;
    var d = new Date(ms);
    var today = new Date().toDateString() === d.toDateString();
    return today ? 'written ' + d.toLocaleTimeString() : 'written ' + d.toLocaleString();
  }

  // Write with Claude (Karol, 2026-10-16: the page must say where the project is and how Claude gets to it, not
  // list mechanisms): where the project is kept — what the team shares in the Mendix project, and what is yours —
  // whether it is connected, the one line to give Claude, and what Claude sent. Files, the inbox, saving and the
  // longer prompt are under Details. The language and the Claude skills are in Settings (settings.js).
  function folderCard(project) {
    var el = app.el;
    var F = window.MxFolder;
    var info = app.store.folderInfo(project.id);
    var home = app.store.homeHandle();
    var kids = [el('h3', { text: 'Where Claude reads this project' })];
    if (!info) {
      if (!F.supported()) {
        kids.push(el('p', { class: 'muted', text: 'This browser cannot keep a project in a folder: that needs the File System Access API, which Chrome and Edge have and this browser does not. Use Other ways: the agent channel, or the AI pack carried as a file.' }));
      } else {
        kids.push(el('p', { class: 'docs-lead', text: 'Keep this project on disk, and Claude reads it there — no file to carry, nothing to start.' }));
        kids.push(el('div', { class: 'docs-agent-act' }, [
          home ? el('button', { class: 'btn btn-primary docs-folder-home', text: 'Keep it in your MxScout folder', title: 'A folder of its own in ' + home.name, onclick: function () { window.MxFolderUI.keepInHome(project); } }) : null,
          el('button', { class: 'btn docs-folder-repo', text: 'Keep it in the Mendix project (mxscout/)…', title: 'Shared with your team through the app’s own git', onclick: function () { app.keepInRepo(project); } }),
          el('button', { class: 'btn' + (home ? ' btn-ghost' : ' btn-primary'), text: home ? 'Another folder…' : 'Keep it in a folder…', onclick: function () { app.keepInFolder(project); } })
        ].filter(Boolean)));
        if (!home) kids.push(el('p', { class: 'hint', text: 'Set your MxScout folder once in Settings, and every project is kept there.' }));
      }
      return el('div', { class: 'card docs-folder docs-folder-none' }, kids);
    }

    var repo = info.layout === 2;
    // Where it is: the team's part (committed) and yours (this machine), or the one folder of a project kept on its own.
    function place(icon, title, where, what, cls) {
      return el('div', { class: 'docs-place ' + cls }, [el('span', { class: 'docs-place-h', text: title }), el('code', { class: 'docs-folder-name', text: where }), el('span', { class: 'docs-place-what', text: what })]);
    }
    var yours = info.localName && info.homeName ? info.homeName + '/' + info.localName + '/' : (info.repoName || info.name) + '/mxscout/.local/';
    kids.push(el('div', { class: 'docs-places' }, repo ? [
      place('git', 'Shared with your team', (info.repoName || '') + '/mxscout/', 'documentation, descriptions, solved cases — you commit it with git', 'shared'),
      place('folder', 'Yours, not in git', yours, 'the model’s copy, Claude’s inbox, your Assist items — this machine only', 'yours')
    ] : [place('folder', 'Kept in', info.name + (info.path ? '  (' + info.path + ')' : ''), 'the model, the documentation, Claude’s inbox — on this machine', 'yours')]));

    var state = {
      connected: ['ok', info.writing || info.pending.length ? 'Connected — writing ' + plural(info.pending.length || 1, 'file', 'files') + '…' : 'Connected — saved as you work.'],
      checking: ['muted', 'Checking what changed in the folder…'],
      unknown: ['muted', 'Not checked yet.'],
      'needs-permission': ['warn', 'The browser needs your permission to write it again — it asks after a restart. Until then MxScout keeps working in this browser and writes the folder when it is back.'],
      missing: ['warn', 'The folder is not where it was — moved, renamed or deleted. Choose it again, or another one: nothing is lost, this browser has all of it.'],
      error: ['warn', 'Writing the folder failed: ' + (info.error || 'unknown error') + '. MxScout keeps working in this browser and writes the folder when it can.']
    }[info.status] || ['muted', info.status];
    var act = info.status === 'needs-permission' ? el('button', { class: 'btn btn-primary btn-sm', text: 'Reconnect the folder', onclick: function () { app.reconnectFolder(project); } })
      : info.status === 'missing' ? el('button', { class: 'btn btn-primary btn-sm', text: 'Choose the folder again…', onclick: function () { app.keepInFolder(project); } })
      : info.status === 'error' ? el('button', { class: 'btn btn-sm', text: 'Try again', onclick: function () { app.reconnectFolder(project); } })
      : null;
    kids.push(el('div', { class: 'docs-folder-where' }, [el('p', { class: 'docs-folder-state ' + state[0] + '-text', 'data-status': info.status, text: state[1] }), act]));

    // The one line for Claude Code (the mxscout-project skill finds the project by its name in the MxScout folder).
    var pick = '/mxscout-project ' + (repo ? (info.repoName || project.name) : project.name);
    kids.push(el('h4', { class: 'docs-folder-h', text: 'In Claude Code' }));
    kids.push(el('div', { class: 'code-display' }, [el('code', { class: 'code-value docs-folder-claude', text: pick }), copyButton(pick)]));
    kids.push(el('p', { class: 'hint docs-folder-then', text: 'Then ask it to “update the documentation”, or how something works. What Claude writes lands here by itself, saved with Undo.' +
      (repo ? ' Started in the Mendix project, “use mendix-describe on mxscout/” does the same.' : '') }));

    // What Claude sent, as it arrives.
    var box = inboxOf(project.id);
    offerNodes(project, box, 'docs-folder-saved').forEach(function (n) { kids.push(n); });

    // Details: the files and when each was written, the inbox, saving, the longer prompt, moving it.
    var pend = {};
    info.pending.forEach(function (f) { pend[f] = true; });
    // Inside the Mendix project the entries are mxscout/'s (repodocs.js), a folder's date its newest file's.
    var REPO_PENDING = { 'mxscout.json': 'project.json', 'descriptions/': 'descriptions.json', 'docs/': 'docs/', 'knowledge/': 'knowledge/', 'README.md': 'README.md', 'comments/': 'comments.json', 'triage.json': 'triage.json' };
    function latest(prefix) { var at = 0; Object.keys(info.wrote).forEach(function (k) { if (k.indexOf(prefix) === 0 && info.wrote[k] > at) at = info.wrote[k]; }); return at || null; }
    var details = [el('div', { class: 'docs-folder-files' }, (repo ? window.MxRepoDocs.ROLES : F.ROLES).map(function (r) {
      var f = r[0];
      var waits = repo ? !!pend[REPO_PENDING[f]] : pend[f];
      var stamp = repo || f === 'knowledge/' ? (/\/$/.test(f) ? latest(f) : info.wrote[f]) : info.wrote[f];
      var when = waits ? 'waiting to be written' : fmtWhen(stamp) || (f === 'inbox/' || f === '.local/' ? '' : '—');
      return el('div', { class: 'docs-folder-file', 'data-file': f }, [el('code', { text: f }), el('span', { class: 'muted', text: r[1] }), el('span', { class: 'hint' + (waits ? ' warn-text' : ''), text: when })]);
    }))];
    var waitingN = (box.files || []).length;
    details.push(el('h4', { class: 'docs-folder-h', text: 'Claude’s inbox' }));
    details.push(el('p', { class: 'muted docs-folder-inbox', text: info.status !== 'connected' ? 'Read again once the folder is connected.'
      : waitingN ? plural(waitingN, 'file waits', 'files wait') + ' in the inbox: ' + box.files.map(function (f) { return f.name; }).join(', ') + '.'
      : 'Empty. What Claude sends is taken within a few seconds while this project is open, and moved to inbox/done/.' }));
    var auto = el('input', { type: 'checkbox' });
    auto.checked = autoSave(project);
    auto.addEventListener('change', function () { setAutoSave(project, auto.checked); });
    details.push(el('label', { class: 'docs-agent-auto docs-folder-auto' }, [auto, document.createTextNode(' Save what Claude sends at once — a whole file that would replace the descriptions you have still waits for you')]));
    var where = info.path || info.name;
    var line = 'Use the mendix-describe skill on the MxScout project in ' + where + '.';
    details.push(el('h4', { class: 'docs-folder-h', text: 'For an agent without /mxscout-project' }));
    details.push(el('div', { class: 'code-display' }, [el('code', { class: 'code-value docs-folder-line', text: line }), copyButton(line)]));
    var path = el('input', { type: 'text', class: 'docs-folder-path', placeholder: repo ? '/path/to/' + (info.repoName || 'MendixProject') + '/mxscout' : '/path/to/' + info.name, value: info.path || '', 'aria-label': 'Where the folder is on disk' });
    path.addEventListener('change', function () { app.store.setFolderPath(project.id, path.value.trim()).then(redrawFolder); });
    details.push(el('label', { class: 'field docs-folder-pathfield' }, [el('span', { text: 'Its full path, if you want it in that line (the browser only knows the folder’s name)' }), path]));
    details.push(el('div', { class: 'docs-agent-act' }, [
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Move to another folder…', onclick: function () { app.keepInFolder(project); } }),
      repo ? null : el('button', { class: 'btn btn-ghost btn-sm docs-folder-repo', text: 'Keep in the Mendix project (mxscout/)…', title: 'Shared with your team through the app’s own git', onclick: function () { app.keepInRepo(project); } }),
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Stop keeping it in a folder', onclick: function () { app.unkeepFolder(project); } })
    ].filter(Boolean)));
    kids.push(el('details', { class: 'docs-folder-details' }, [el('summary', { text: 'Details — files, inbox, saving' })].concat(details)));
    return el('div', { class: 'card docs-folder' }, kids);
  }

  // The third way to get descriptions: a chat assistant that runs nothing and reaches nothing. Its parts
  // and its answers are in copilot.js; this is only where an answer is kept, like any other import.
  function copilotCard(data, project, rec) {
    return window.MxCopilot.card(data, {
      base: rec ? rec.value : null,
      save: function (value, info) {
        var was = descs[project.id];
        noteLanguage(project, value);
        var base = JSON.stringify(rec ? rec.value : null);
        // The assistant's answers went on top of the descriptions shown here; another tab's save since is kept, the answers merged onto it.
        return keepDescriptions(project, 'from an AI chat assistant', function (was) {
          return stamped(project, JSON.stringify(was) === base ? value : window.MxDescribe.merge(was, value));
        }).then(function (k) {
          var row = k.row;
          assistFrom(project.id, row);
          // The assistant answers a part at a time: what it wrote adds, like a file that says so.
          return info && info.risks && info.risks.length ? reconcile(project, { add: true, risks: info.risks }, was) : '';
        }).then(function (said) {
          app.setMessage('Descriptions added from the AI chat assistant.' + said, 'ok');
          app.render();
          syncNow();
        });
      }
    });
  }

  function exportPack() {
    var data = current();
    if (!data) return;
    var p = packOf(data);
    var name = String(data.project).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') + '.mxscout-ai-pack.md';
    app.downloadText(p.text, name, 'text/markdown');
    app.setMessage('AI pack downloaded: ' + name + ' — ' + p.modules + ' modules, ' + p.flows + ' flows. Hand it to an agent with the mendix-describe skill.', 'ok');
    app.render();
  }

  function importDescriptions(project) {
    if (!project) return;
    var input = app.el('input', { type: 'file', accept: '.json,application/json' });
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      file.text().then(function (text) {
        // An Assist file (assist.js) is read by the same rules as one an agent sends, and saved there.
        if (window.MxAssist && window.MxAssist.isEnvelope(text)) {
          return window.MxAssist.apply(project.id, text).then(function (res) {
            var v = window.MxAssist.parseEnvelope(text).value || {};
            var langNote = noteLanguage(project, { language: v.language, setLanguage: !!v.setLanguage });
            app.setMessage('From ' + file.name + ': ' + res.what + ' on the Assist page.' + (res.dropped.length ? ' Left out: ' + res.dropped.slice(0, 3).join('; ') + '.' : '') + (langNote || ''), langNote ? 'error' : 'ok');
            app.render();
            syncNow();
          });
        }
        var parsed = window.MxDescribe.parse(text);
        if (parsed.error) { app.setMessage(parsed.error, 'error'); app.render(); return; }
        var had = hasDescriptions(project);
        var langNote = noteLanguage(project, parsed.value);
        return keepDescriptions(project, file.name, function (was) { return stamped(project, addOn(parsed.value)(was)); }).then(function (k) {
          var row = k.row;
          assistFrom(project.id, row);
          return reconcile(project, parsed.value, k.before);
        }).then(function (said) {
          app.setMessage((parsed.value.add ? 'Added to the descriptions from ' + file.name + ': ' + addedWhat(parsed.value) + '.'
            : 'Descriptions imported from ' + file.name + (had ? '; they replace the ones this project had.' : '.')) + said + (langNote || ''), langNote ? 'error' : 'ok');
          app.render();
          syncNow();
        });
      }).catch(function (err) { app.setMessage('Could not import the descriptions: ' + ((err && err.message) || err), 'error'); app.render(); });
    });
    document.body.appendChild(input);
    input.click();
  }

  function removeDescriptions(project) {
    if (!project) return;
    app.store.delete('descriptions', project.id).then(function () {
      descs[project.id] = null; kept = null;
      app.setMessage('Descriptions removed. The file you imported them from is untouched.', 'ok');
      app.render();
      syncNow();
    });
  }

  function current() { return kept ? kept.data : null; }

  // The Entities screen (domain.js): the reader's Domain model page on its
  // own, on the same data this section builds — mounted once per model and
  // descriptions, and handed back on every render so it keeps its place.
  var dom = null;
  function domainScreen(model, project, hooks) {
    if (project) loadDescriptions(project.id);
    if (reading(project, 'domain', hooks.patch)) return waiting();
    var patch = heldPatch('domain', hooks.patch);
    var rec = (project ? descs[project.id] : null) || null;
    var mode = document.documentElement.getAttribute('data-mode') || 'light';
    var tri = triageStamp(project);
    if (!dom || dom.model !== model || dom.rec !== rec || dom.tri !== tri) {
      var data = dataFor(model, project, rec);
      var host = app.el('div', { class: 'dm-embed' });
      var view = window.MxDocsView.mount(data, host, { only: 'domain', theme: mode, entityActions: hooks.entityActions, entityMenu: hooks.entityMenu, entitySection: hooks.entitySection, accessNotes: hooks.accessNotes, route: hooks.route, state: patch });
      dom = { model: model, rec: rec, tri: tri, host: host, view: view, stamp: hooks.stamp ? hooks.stamp() : '' };
    } else if (patch) {
      dom.view.go(patch);
    } else if (hooks.stamp && hooks.stamp() !== dom.stamp) {
      // What the panel's actions say changed (a comment added or removed): draw it again, in place.
      dom.stamp = hooks.stamp();
      dom.view.go({});
    }
    if (dom.host.firstChild) dom.host.firstChild.setAttribute('data-theme', mode);
    return dom.host;
  }

  // The documentation's other pages as MxScout's own screens (Karol,
  // 2026-10-13: the report's Overview, Processes, Modules, Architecture,
  // Risks, Model quality and For developers belong in MxScout as well). One
  // mount per page, kept like the Domain model's, all on the same data. A link
  // to another page goes through hooks.route, so it opens MxScout's screen for
  // it; hooks.patch moves this page to a place in it (a module, a risk).
  var pagesKept = {};
  // The build is kept per model, descriptions, project name and what was decided about the risks (buildData).
  function dataFor(model, project) { return buildData(model, project).data; }
  function pageScreen(view, model, project, hooks) {
    if (project) loadDescriptions(project.id);
    if (reading(project, view, hooks.patch)) return { host: waiting(), title: '', sub: '', has: true };
    var patch = heldPatch(view, hooks.patch);
    var rec = (project ? descs[project.id] : null) || null;
    var mode = document.documentElement.getAttribute('data-mode') || 'light';
    var tri = triageStamp(project);
    var k = pagesKept[view];
    // hooks.assist: the Assist items and what a click on one does (app.js) — handed to the pages MxScout
    // shows, never to the exported file. When they change, the page is drawn again where it was.
    // hooks.cases: the solved cases (knowledge.js), the same way.
    var av = hooks.assist ? hooks.assist.version() : null, cv = hooks.cases ? hooks.cases.version() : null;
    if (!k || k.model !== model || k.rec !== rec || k.tri !== tri || k.assist !== (hooks.assist || null) || k.cases !== (hooks.cases || null)) {
      var info = { title: '', sub: '' };
      var host = app.el('div', { class: 'dm-embed' });
      // A decision about a risk draws the page again from new data, where the reader was: the same
      // risk, the same filters (only the data changed, not the place).
      var again = k && k.model === model && k.rec === rec && !patch ? { state: k.view.state(), riskFilter: k.view.riskFilter ? k.view.riskFilter() : null } : null;
      var v = window.MxDocsView.mount(dataFor(model, project), host, {
        only: view, theme: mode, route: hooks.route, state: patch || (again && again.state) || null, riskFilter: again && again.riskFilter,
        riskActions: hooks.riskActions || null, assist: hooks.assist || null, cases: hooks.cases || null,
        onTitle: function (t, s) { info.title = t; info.sub = s; }
      });
      k = pagesKept[view] = { model: model, rec: rec, tri: tri, host: host, view: v, info: info, av: av, cv: cv, assist: hooks.assist || null, cases: hooks.cases || null };
    } else if (patch) {
      k.av = av; k.cv = cv;
      k.view.go(patch);
    } else if (k.av !== av || k.cv !== cv) {
      k.av = av; k.cv = cv;
      k.view.redraw();
    }
    if (k.host.firstChild) k.host.firstChild.setAttribute('data-theme', mode);
    return { host: k.host, title: k.info.title, sub: k.info.sub, has: k.view.pages().indexOf(view) !== -1 };
  }

  // ---------- the file ----------
  // Put together in docs-file.js, which also runs in Node, so a tool reading a .mpr builds the same file.
  function buildFile(data, css, title, scripts) { return window.MxDocsFile.build(data, css, title, scripts); }
  function subset(data, keep) { return window.MxDocsFile.subset(data, keep); }

  // The solved cases, in the exported file only when the person ticked it (dialog.cases): what the Solved cases
  // page draws, with what changed since each was solved worked out here — the file has no fingerprints to compare.
  function exportCases(data) {
    var cases = dialog && dialog.cases && app.state.activeId && window.MxKnowledge ? window.MxKnowledge.peek(app.state.activeId) || [] : [];
    if (!cases.length) return data;
    data.cases = window.MxDocsKnowledge.forData(cases, data, function (qn) {
      var k = ['microflow', 'nanoflow', 'page'].map(function (x) { return x + ':' + qn; }).filter(function (x) { return data.flows[x]; })[0];
      return k ? { key: k, f: data.flows[k] } : null;
    }, window.MxDescribe.hashOf);
    return data;
  }
  function doMarkdown() {
    var all = current();
    if (!all || !dialog) return;
    var data = exportCases(withDerived(subset(all, dialog.keep || {})));
    var name = window.MxDocsView.markdownName(data);
    app.downloadText(window.MxDocsView.markdown(data), name, 'text/markdown');
    dialog.fileName = name; dialog.error = null; app.render();
  }
  function doExport() {
    var all = current();
    if (!all) return;
    var keep = dialog.keep || {};
    if (!all.modules.some(function (m) { return keep[m.name]; })) return;
    var data = exportCases(withDerived(subset(all, keep)));
    dialog.busy = true; dialog.error = null; app.render();
    // The stylesheets and fonts are this app's own files, read from this same server.
    Promise.all([stylesheet(), flowScripts()])
      .then(function (both) {
        var html = buildFile(data, both[0], data.project, both[1]);
        var fileName = window.MxDocsFile.fileName(data);
        app.downloadText(html, fileName, 'text/html');
        dialog.busy = false; dialog.fileName = fileName; app.render();
      })
      .catch(function (err) { dialog.busy = false; dialog.error = (err && err.message) || 'Could not build the file.'; app.render(); });
  }

  // tokens.css with its fonts turned into data: URIs, then the flow screen's
  // sheets, then docs.css: one stylesheet the file carries whole, so it needs
  // nothing from anywhere.
  function readFile(path, as) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error('Could not read ' + path + '.');
      return as === 'blob' ? r.blob() : r.text();
    });
  }
  function dataUri(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read a font.')); };
      reader.readAsDataURL(blob);
    });
  }
  function stylesheet() {
    var F = window.MxDocsFile;
    return Promise.all(F.SHEETS.map(function (f) { return readFile('/' + f); })).then(function (sheets) {
      var tokens = sheets[0];
      var fonts = F.fontsIn(tokens);
      return Promise.all(fonts.map(function (u) {
        return readFile('/' + F.fontPath(u), 'blob').then(function (b) { return dataUri(new Blob([b], { type: 'font/woff2' })); });
      })).then(function (uris) {
        fonts.forEach(function (u, i) { tokens = tokens.replace(u, 'url("' + uris[i] + '")'); });
        return [tokens].concat(sheets.slice(1)).join('\n');
      });
    });
  }
  // The flow screen the file's "Microflows & pages" runs (docs-file.js SCRIPTS), read from this same server.
  function flowScripts() { return Promise.all(window.MxDocsFile.SCRIPTS.map(function (f) { return readFile('/' + f); })); }

  // Which modules go into the file, chosen first: every module of the
  // project is offered, the Marketplace ones unticked — they are somebody
  // else's code, and in a real project they are half the model (Karol,
  // 2026-10-09).
  function openExport() {
    var keep = {};
    (current() || { modules: [] }).modules.forEach(function (m) { keep[m.name] = !m.marketplace; });
    dialog = { busy: false, fileName: null, error: null, keep: keep, cases: false };
    app.render();
  }

  function moduleChooser(data) {
    var el = app.el;
    var keep = dialog.keep;
    function set(fn) { return function () { data.modules.forEach(function (m) { keep[m.name] = fn(m); }); dialog.fileName = null; app.render(); }; }
    var chosen = data.modules.filter(function (m) { return keep[m.name]; }).length;
    return el('div', { class: 'docs-mods-wrap' }, [
      el('div', { class: 'docs-mods-head' }, [
        el('strong', { text: 'Modules in the file' }),
        el('span', { class: 'muted', text: chosen + ' of ' + data.modules.length }),
        el('span', { class: 'docs-mods-quick' }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: 'All', onclick: set(function () { return true; }) }),
          el('button', { class: 'btn btn-sm btn-ghost', text: 'Own modules', onclick: set(function (m) { return !m.marketplace; }) }),
          el('button', { class: 'btn btn-sm btn-ghost', text: 'None', onclick: set(function () { return false; }) })
        ])
      ]),
      el('div', { class: 'docs-mods' }, data.modules.map(function (m) {
        var box = el('input', { type: 'checkbox' });
        box.checked = !!keep[m.name];
        box.addEventListener('change', function () { keep[m.name] = box.checked; dialog.fileName = null; app.render(); });
        var n = m.microflows.length + m.nanoflows.length;
        return el('label', { class: 'docs-mod' + (keep[m.name] ? ' on' : '') + (m.marketplace ? ' mk' : '') }, [
          box,
          el('span', { class: 'docs-mod-t' }, [
            el('strong', { text: m.name }),
            el('span', { class: 'muted', text: (m.marketplace ? 'Marketplace · ' : '') + plural(n, 'flow', 'flows') + ' · ' + plural(m.entities.length, 'entity', 'entities') })
          ])
        ]);
      }))
    ]);
  }

  // "Include solved cases": off by default — the notes are the team's working knowledge, not the application's
  // documentation, and the exported file goes further than the repository does.
  function casesChoice() {
    var n = app.state.activeId && window.MxKnowledge ? (window.MxKnowledge.peek(app.state.activeId) || []).length : 0;
    if (!n) return null;
    var box = app.el('input', { type: 'checkbox', class: 'export-cases' });
    box.checked = !!dialog.cases;
    box.addEventListener('change', function () { dialog.cases = box.checked; dialog.fileName = null; app.render(); });
    return app.el('label', { class: 'docs-agent-auto export-cases-choice' }, [box, document.createTextNode(' Include solved cases (' + n + ') — the notes in knowledge/, as a Solved cases page. Left out unless you tick this.')]);
  }
  function renderExportModal() {
    if (!dialog) return null;
    var el = app.el;
    var close = function () { if (dialog.busy) return; dialog = null; app.render(); };
    var all = current() || { kpi: {}, modules: [] };
    var data = all.modules.length ? subset(all, dialog.keep || {}) : all;
    var none = all.modules.length && !data.modules.length;
    var kids = [
      el('h3', { text: 'Export the documentation' }),
      el('p', { class: 'muted', text: 'One HTML file with everything described on this page, for the modules you choose — now ' + (data.kpi.microflows || 0) + ' microflows, ' + (data.kpi.nanoflows || 0) + ' nanoflows, ' + (data.kpi.pages || 0) + ' pages, ' + (data.kpi.entities || 0) + ' entities, every workflow. It opens in any browser; nothing is sent anywhere.' }),
      all.modules.length ? moduleChooser(all) : null,
      casesChoice(),
      el('div', { class: 'report-option' }, [
        el('div', { class: 'report-option-head' }, [
          el('strong', { text: 'HTML file' }),
          el('button', { class: 'btn btn-sm btn-primary', text: dialog.busy ? 'Working…' : 'Build file', disabled: dialog.busy || none ? 'disabled' : null,
            title: none ? 'Choose at least one module' : null, onclick: doExport })
        ]),
        el('p', { class: 'muted', text: 'Not encrypted: it describes the application’s structure and its weak spots to whoever opens it. Keep it where you keep the project.' })
      ]),
      // The same documentation as one Markdown file (redesign spec 20) — the file's own reader writes it, so the two say the same.
      el('div', { class: 'report-option' }, [
        el('div', { class: 'report-option-head' }, [
          el('strong', { text: 'Markdown file' }),
          el('button', { class: 'btn btn-sm', text: 'Build Markdown', disabled: dialog.busy || none ? 'disabled' : null,
            title: none ? 'Choose at least one module' : null, onclick: doMarkdown })
        ]),
        el('p', { class: 'muted', text: 'The same content as one .md file, the drawings as tables and lists, for an AI tool or a wiki. A flow with no risk, no description and no process is one line. The HTML file has a button for it too.' })
      ])
    ];
    if (dialog.fileName) kids.push(el('p', { class: 'ok-text', text: dialog.fileName + ' downloaded.' }));
    if (dialog.error) kids.push(el('p', { class: 'warn-text', text: dialog.error }));
    kids.push(el('div', { class: 'modal-actions' }, [el('button', { class: 'btn', text: 'Close', onclick: close })]));
    var backdrop = el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [window.MxDialog.modal(el('div', { class: 'modal modal-wide' }, kids), close)]);
    return backdrop;
  }

  window.MxDocs = { init: init, dataFor: dataFor, render: render, folderTick: folderTick, folderChanged: function () { redrawFolderQuiet(); }, adoptFolderDescriptions: adoptFolderDescriptions, derivedFor: derivedFor, setTab: setTab, languageField: languageField, defaultLanguage: defaultLanguage, loadDefaultLanguage: loadDefaultLanguage, setDefaultLanguage: setDefaultLanguage, defaultLanguageSelect: defaultLanguageSelect, languageSelect: languageSelect, current: current, renderExportModal: renderExportModal, buildFile: buildFile, stylesheet: stylesheet, flowScripts: flowScripts, descriptionsFor: descriptionsFor, readAhead: readAhead, repoDocs: repoDocs, forgetDescriptions: forgetDescriptions, domainScreen: domainScreen, pageScreen: pageScreen };
})();
