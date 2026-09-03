/* MxScout — everything about talking to a RUNNING application.
 *
 * One file, because it is one subject: deciding whether an environment may be
 * touched at all, handing the user the code that connects their app tab, and
 * then reading rows out of it or running a flow in it. Splitting those apart
 * would put the guard in one place and the thing it guards in another.
 *
 * What lives here:
 *   the non-production guard        classifyAppUrl — the copy the UI consults
 *   the snippet                     built from bridge.js, generated per target
 *   the session                     one token per project view
 *   the connection                  long-poll status, connected or not
 *   reading rows                    query, paging, search, the data pane
 *   running a flow                  arming, the two gates, the result
 *
 * It keeps no state of its own beyond timers. Everything durable lives in
 * app.state.detail.live and app.state.detail.data, because app.js owns the
 * detail view and a second copy of that would drift.
 */
(function () {
  'use strict';

  // Bound once, in init(). Named exactly as they were in app.js so the code
  // below reads the same as it did before it moved.
  var el, state, api, render, setMessage, saveProjectMeta, findEntity, moduleRoleSetFor, moduleColor;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    api = deps.api;
    render = deps.render;
    setMessage = deps.setMessage;
    saveProjectMeta = deps.saveProjectMeta;
    findEntity = deps.findEntity;
    moduleRoleSetFor = deps.moduleRoleSetFor;
    moduleColor = deps.moduleColor;
  }

  // ---------- environment classifier ----------
  // MxScout will connect a live browser session to a running app (to scan what
  // a logged-in user really sees, and to run flows). That must never point at
  // a production system by accident — the people using this tool are testers
  // and developers, and a live scan or a run against prod is a real incident.
  //
  // So before any of that is offered, the target app's URL is classified.
  // Only clearly non-production environments are allowed through: loopback/
  // local hosts, and hosts carrying a conventional dev/test/acceptance marker
  // as a whole dot- or dash-separated label. EVERYTHING else — a bare
  // *.mendixcloud.com, a custom company domain, a LAN IP — is treated as
  // production and refused. This is deliberately strict ("block the unknown").
  //
  // Two properties matter:
  //  - Tokens are matched WHOLE, split on '.' and '-', never as substrings —
  //    so "account.company.com" is NOT mistaken for an 'acc' environment and
  //    "myapp-test.mendixcloud.com" is. A substring test would wave real
  //    production hosts through, which is the exact failure to avoid.
  //  - Anything unparseable or non-http(s) blocks. Failing closed is the point.
  //
  // This is a guardrail against accidents, not a security control: the source
  // is public, so a determined technical user can bypass it. It is here to
  // stop a non-technical tester from footgunning production by mistake — and
  // the same check is re-embedded in the generated live scripts (where it
  // actually runs), so editing it away in the UI alone changes nothing.
  var NONPROD_TOKENS = {
    dev: 1, development: 1, test: 1, testing: 1, tst: 1,
    accept: 1, acceptance: 1, acc: 1, acp: 1, accp: 1,
    sandbox: 1, staging: 1, stage: 1, uat: 1, qa: 1, local: 1
  };
  function classifyAppUrl(raw) {
    var url = String(raw || '').trim();
    if (!url) return { verdict: 'empty', host: null };
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = 'https://' + url;
    var parsed;
    try { parsed = new URL(url); } catch (e) { return { verdict: 'block', host: null }; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { verdict: 'block', host: parsed.host };
    var host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
        host.slice(-6) === '.local' || host.slice(-10) === '.localhost') {
      return { verdict: 'allow', host: host, origin: parsed.origin };
    }
    var tokens = host.split(/[.\-]/);
    for (var i = 0; i < tokens.length; i++) {
      if (NONPROD_TOKENS[tokens[i]]) return { verdict: 'allow', host: host, origin: parsed.origin };
    }
    return { verdict: 'block', host: host };
  }

  // ---------- live app: connect + environment gate ----------
  // Step in the live flow where the user names the running app to connect to.
  // The environment gate lives here: an approved (non-production) URL unlocks
  // the scan / run tools that follow; anything that looks like production is
  // refused with a neutral message and no way to proceed — see classifyAppUrl.
  function persistAppUrl(project, url) {
    project.appUrl = url || null;
    saveProjectMeta(project);
  }

  // ---------- the bridge: one snippet for data AND execution ----------
  // There used to be two snippets: a read-only scan and a separate execution
  // listener. The user had to paste both, in the right order, and a CSP that
  // blocked the first failed silently. There is now ONE snippet — see
  // bridge.js, where it lives as real code rather than string fragments.
  //
  // The snippet is generated FOR A TARGET (this entity, this flow). That only
  // matters when the app's CSP blocks the connection back here: the snippet
  // then renders the panel for that one object inside the app page itself, so
  // it needs the object's metadata baked in. A bridge that DID connect serves
  // queries for anything — the target is the fallback's subject, not a limit.

  // Read the palette out of the live stylesheet rather than repeating the hex
  // values here. The injected panel then matches MxScout automatically, and
  // stays matching when the palette changes — which is the whole point of the
  // user asking for "the same colours".
  function currentPalette(moduleName) {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) { return (cs.getPropertyValue(name) || '').trim() || fallback; }
    return {
      bg: v('--bg', '#121212'),
      panel: v('--panel', '#1a1a1a'),
      panel2: v('--panel-2', '#222222'),
      text: v('--text', '#ededed'),
      muted: v('--muted', '#9b9b9b'),
      accent: v('--accent', '#e8a33d'),
      border: v('--border', '#2e2e2e'),
      alarm: v('--alarm', '#ff6b6b'),
      mod: moduleName ? moduleColor(moduleName) : v('--accent', '#e8a33d')
    };
  }

  // Types a single named field can be searched by. DateTime is left out on
  // purpose: matching one needs a date format the UI, the bridge and the
  // Mendix runtime all agree on, and inventing one here would produce
  // confidently wrong results rather than an honest gap. Binary and
  // HashedString are not comparable at all.
  var SEARCHABLE_TYPE = /^(string|integer|long|decimal|float|autonumber|boolean|enum)/i;

  // Which attributes the "any text field" search looks inside. Only String
  // attributes: contains() on a number or a date is either an error or a
  // surprise. Searching those is what naming ONE field is for — see
  // SEARCHABLE_TYPE and the field picker in renderDataPane.
  function searchableAttrs(entity) {
    return (entity.attributes || [])
      .filter(function (a) { return /string/i.test(a.type || ''); })
      .map(function (a) { return a.name; })
      .slice(0, 12);
  }

  // Columns for the data table. All attributes, in model order — the table
  // scrolls sideways rather than deciding for the user which fields matter.
  function dataColumns(entity) {
    return (entity.attributes || []).map(function (a) { return a.name; });
  }

  function bridgeTargetForEntity(model, entity) {
    var set = moduleRoleSetFor(model, state.detail.role);
    var rules = (entity.accessRules || []).filter(function (r) { return !set || set[r.moduleRole]; });
    return {
      kind: 'entity',
      qualifiedName: entity.qualifiedName,
      name: entity.name,
      module: entity.module,
      mod: moduleColor(entity.module),
      attributes: (entity.attributes || []).map(function (a) { return { name: a.name, type: a.type, length: a.length || null }; }),
      columns: dataColumns(entity),
      searchAttrs: searchableAttrs(entity),
      rules: rules.map(function (r) {
        var lvls = [].concat(
          Object.keys(r.attrAccess || {}).map(function (k) { return r.attrAccess[k]; }),
          Object.keys(r.assocAccess || {}).map(function (k) { return r.assocAccess[k]; })
        );
        return {
          moduleRole: r.moduleRole,
          level: lvls.indexOf('rw') !== -1 ? 'rw' : 'r',
          xpath: r.xpathConstraint || null,
          create: !!r.allowCreate,
          del: !!r.allowDelete
        };
      })
    };
  }

  function bridgeTargetForFlow(model, entry) {
    var objectParam = (entry.flow.parameters || []).filter(function (p) { return p.entityQualifiedName; })[0] || null;
    var pick = null;
    if (objectParam) {
      var pe = findEntity(model, objectParam.entityQualifiedName);
      if (pe) {
        pick = {
          qualifiedName: pe.qualifiedName, name: pe.name,
          columns: dataColumns(pe).slice(0, 4), searchAttrs: searchableAttrs(pe)
        };
      }
    }
    return {
      kind: 'flow', flowKind: entry.kind,
      qualifiedName: entry.flow.qualifiedName, name: entry.flow.name,
      module: entry.flow.module, mod: moduleColor(entry.flow.module),
      paramName: objectParam ? objectParam.name : null,
      pickEntity: pick
    };
  }

  function buildBridgeScript(token, target) {
    return window.MxBridge.buildScript({
      origin: window.location.origin,
      token: token,
      palette: currentPalette(target && target.module),
      target: target || null
    });
  }

  // ---------- session ----------
  // One token per project view, shared by everything the bridge does. Reused
  // if one already exists, so opening a second entity does not invalidate the
  // snippet the user already pasted.
  function ensureSession(cb) {
    var live = state.detail.live;
    if (live.token) { cb(live.token); return; }
    api('/api/session/start', { method: 'POST' })
      .then(function (resp) { live.token = resp.token; cb(resp.token); })
      .catch(function (err) { setMessage((err && err.message) || 'Could not start the session.', 'error'); render(); });
  }

  // The snippet shown for a target. Cached per target so re-rendering does not
  // regenerate (and visually re-shuffle) the text under the user's cursor.
  function bridgeScriptFor(target) {
    var live = state.detail.live;
    var key = target ? (target.kind + ':' + target.qualifiedName) : 'none';
    if (live.scriptKey === key && live.script) return live.script;
    if (!live.token) return null;
    live.scriptKey = key;
    live.script = buildBridgeScript(live.token, target);
    return live.script;
  }

  // ---------- connection status ----------
  // One poller for the whole bridge (see startExecPolling below) — whether the
  // app tab is answering is one fact, not one per feature.
  var DATA_PAGE_SIZE = 10;
  function bridgeConnected() {
    var live = state.detail && state.detail.live;
    return !!(live && live.exec && live.exec.status && live.exec.status.listenerConnected);
  }

  // ---------- asking the app for a page of rows ----------
  // Arm a query, then collect its answer. The bridge is parked on a held-open
  // poll, so the command reaches the app tab as soon as it is armed; the wait
  // here is one network hop plus however long the app takes to answer.
  //
  // Every query supersedes the one before it: a user typing in the search box
  // produces a query per keystroke-batch, and only the newest matters. The
  // sequence number is what stops a slow earlier answer from overwriting a
  // fast later one.
  var _querySeq = 0;
  var _queryPoll = null;
  var QUERY_TIMEOUT_MS = 20000;

  // Shared by query/lookup/create: arm one command, poll /api/session/data
  // until it answers. Only one of the three is ever in flight at once — the
  // sequence guard means starting any of them supersedes whichever of the
  // other two was still waiting, same as one search keystroke superseding
  // the last.
  function armAndPoll(payload, done) {
    var seq = ++_querySeq;
    if (_queryPoll) { clearInterval(_queryPoll); _queryPoll = null; }
    api('/api/session/exec', { method: 'POST', body: JSON.stringify(payload) }).then(function (resp) {
      var commandId = resp.commandId;
      var startedAt = Date.now();
      _queryPoll = setInterval(function () {
        if (seq !== _querySeq) { clearInterval(_queryPoll); _queryPoll = null; return; }
        fetch('/api/session/data').then(function (r) { return r.json(); }).then(function (result) {
          if (seq !== _querySeq) return;
          if (result && result.id === commandId) {
            clearInterval(_queryPoll); _queryPoll = null;
            done(result.ok ? null : (result.message || 'The app could not do that.'), result.data);
            return;
          }
          if (Date.now() - startedAt > QUERY_TIMEOUT_MS) {
            clearInterval(_queryPoll); _queryPoll = null;
            done('No answer from the app tab. Is it still open with the snippet running?', null);
          }
        }).catch(function () {});
      }, 250);
    }).catch(function (err) {
      if (seq === _querySeq) done((err && err.message) || 'Could not reach the app.', null);
    });
  }

  function runQuery(opts, done) {
    armAndPoll({
      kind: 'query', qualifiedName: opts.qualifiedName,
      // The columns travel WITH the query. The bridge was generated for one
      // object, but it serves whatever is asked of it afterwards — reading
      // the columns off the snippet's own target would show the first
      // entity's fields for every entity opened after it.
      columns: opts.columns || [], searchAttrs: opts.searchAttrs || [],
      searchField: opts.searchField || '', searchType: opts.searchType || '',
      search: opts.search || '', offset: opts.offset || 0, amount: opts.amount || DATA_PAGE_SIZE
    }, done);
  }

  // Both report through the SAME channel a query's rows do (see
  // server/routes/session.js and bridge.js's reportOneRow) — one row, or an
  // error, is exactly a query result with total:1.
  function runLookup(qualifiedName, guid, columns, done) {
    armAndPoll({ kind: 'lookup', qualifiedName: qualifiedName, guid: guid, columns: columns || [] }, done);
  }
  function runCreate(qualifiedName, values, columns, done) {
    armAndPoll({ kind: 'create', qualifiedName: qualifiedName, values: values || {}, columns: columns || [] }, done);
  }
  // Ask the bridge what guids it has watched the app's own microflow calls
  // carry this session. No target — it reads the bridge's own buffer.
  function runObserved(done) {
    armAndPoll({ kind: 'observed' }, done);
  }
  // ---------- the Live app tab ----------
  function renderLivePanel(model, project) {
    var live = state.detail.live;

    var input = el('input', { type: 'text', class: 'live-url-input', placeholder: 'https://your-app-test.mendixcloud.com', value: live.url });
    input.addEventListener('input', function () { live.url = input.value; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doCheck(); });

    function doCheck() {
      var res = classifyAppUrl(live.url);
      live.result = res;
      if (res.verdict === 'allow') persistAppUrl(project, live.url.trim());
      else persistAppUrl(project, null);
      render();
    }

    var connectCard = el('div', { class: 'card' }, [
      el('h3', { class: 'live-h', text: 'Connect to the running app' }),
      el('p', { class: 'muted', text: 'To read real data — or to run a flow — MxScout needs the web address of the running app you are testing. Open the app in another browser tab, copy its address, and paste it here.' }),
      el('label', { class: 'field' }, [
        el('span', { text: 'App address' }),
        el('div', { class: 'live-url-row' }, [
          input,
          el('button', { class: 'btn btn-primary', text: 'Check', onclick: doCheck })
        ])
      ])
    ]);

    var resultCard = null;
    var res = live.result;
    if (res && res.verdict === 'allow') {
      resultCard = el('div', { class: 'card live-ok' }, [
        el('div', { class: 'live-status live-status-ok' }, [
          el('span', { class: 'live-dot' }),
          el('span', { text: 'Ready to connect to ' + res.host })
        ]),
        el('p', { class: 'muted', text: 'This looks like a development, test or acceptance environment.' }),
        renderExecSection(model, project)
      ]);
    } else if (res && res.verdict === 'block') {
      // Neutral, hidden refusal: no mention of "production", no override, no
      // continue button. To a non-technical user this reads as an unsupported
      // environment, which is exactly the intent — stop the accident without
      // advertising a switch to flip.
      resultCard = el('div', { class: 'card live-blocked' }, [
        el('div', { class: 'live-status live-status-blocked' }, [
          el('span', { class: 'live-dot' }),
          el('span', { text: 'This environment isn\u2019t supported here' })
        ]),
        el('p', { class: 'muted', text: 'MxScout can connect only to local, test and acceptance environments. This address isn\u2019t one of them, so reading data and running flows are not available for it.' })
      ]);
    }

    return el('div', {}, [connectCard, resultCard].filter(Boolean));
  }

  // The one connect step, reused wherever a bridge is needed: the Live tab,
  // and inside the entity popup's Data tab. Same snippet, same words, so the
  // user learns it once.
  function renderBridgeSection(target) {
    var live = state.detail.live;

    if (!live.token) {
      ensureSession(function () { render(); });
      return el('div', { class: 'scan-section' }, [el('span', { class: 'spinner' })]);
    }
    if (!_execPoll) startExecPolling();

    if (bridgeConnected()) {
      return el('div', { class: 'scan-section bridge-connected' }, [
        el('div', { class: 'live-status live-status-ok' }, [
          el('span', { class: 'live-dot' }),
          el('span', { text: 'Connected to your app tab.' })
        ]),
        el('p', { class: 'muted', text: 'Leave that tab open. Nothing runs there unless you ask for it here.' })
      ]);
    }

    var script = bridgeScriptFor(target);
    var copyStatus = el('span', { class: 'muted' });
    var copyBtn = el('button', {
      class: 'btn btn-primary', text: 'Copy the code',
      onclick: function () {
        navigator.clipboard.writeText(script).then(
          function () { copyStatus.textContent = 'Copied.'; },
          function () { copyStatus.textContent = 'Could not copy automatically \u2014 select the text and copy it.'; }
        );
      }
    });

    return el('div', { class: 'scan-section' }, [
      el('h4', { class: 'scan-h', text: 'Connect your app tab' }),
      el('ol', { class: 'scan-steps' }, [
        el('li', { text: 'Open the app in another browser tab, logged in as the role you want to test.' }),
        el('li', { text: 'On that tab press F12, then open the Console.' }),
        el('li', { text: 'Paste the code below and press Enter. A panel appears in that tab telling you what it is doing.' }),
        el('li', { text: 'Come back here. If the app blocks the connection, that panel keeps working on its own \u2014 it will say so.' })
      ]),
      el('textarea', { class: 'scan-script', readonly: 'readonly', spellcheck: 'false', text: script || '' }),
      el('div', { class: 'scan-copy-row' }, [copyBtn, copyStatus]),
      el('div', { class: 'scan-waiting' }, [
        el('span', { class: 'spinner' }),
        el('span', { text: 'Waiting for the code to run in your app tab\u2026' })
      ])
    ]);
  }

  // ---------- live execute: session control + status polling ----------
  var _execPoll = null;
  function stopExecPolling() { if (_execPoll) { clearInterval(_execPoll); _execPoll = null; } }
  function startExecPolling() { stopExecPolling(); _execPoll = setInterval(fetchExecStatus, 1500); fetchExecStatus(); }
  // Runs while a project is open, not only on the Live tab: the entity popup's
  // Data tab needs to know whether the app tab is answering, and it is not the
  // Live tab.
  function fetchExecStatus() {
    if (!state.detail) { stopExecPolling(); return; }
    fetch('/api/session/exec')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!state.detail || !state.detail.live) return;
        var was = bridgeConnected();
        if (s) state.detail.live.exec.status = s;
        // Connecting or dropping changes what every screen should be showing —
        // a waiting spinner has to become a table by itself, or the user is
        // left looking at a stale instruction telling them to do what they
        // just did.
        if (bridgeConnected() !== was) { render(); return; }
        updateExecStatusInPlace();
      })
      .catch(function () {});
  }
  function updateExecStatusInPlace() {
    var host = document.getElementById('exec-status-area');
    if (!host || !state.detail) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    var node = renderExecStatusArea();
    if (node) host.appendChild(node);
  }

  function disconnectBridge() {
    stopExecPolling();
    api('/api/session/exec', { method: 'DELETE' }).catch(function () {});
    var live = state.detail.live;
    live.script = null; live.scriptKey = null;
    var ex = live.exec;
    ex.status = {}; ex.armedCommandId = null; ex.armedFlow = null; ex.armedAt = null; ex.armError = null;
    render();
  }

  var EXEC_RESULT_TIMEOUT_MS = 20000;
  var KIND_LABEL = { microflow: 'microflow', nanoflow: 'nanoflow' };

  function armCommand(c) {
    var ex = state.detail.live.exec;
    ex.confirm = null; ex.armError = null;
    api('/api/session/exec', {
      method: 'POST',
      body: JSON.stringify({
        kind: c.kind, qualifiedName: c.qualifiedName,
        objectParams: c.objectParams.map(function (p) {
          var entry = { name: p.name, guids: p.guids, entityQualifiedName: p.entityQualifiedName };
          if (p.overrides && Object.keys(p.overrides).length) entry.overrides = p.overrides;
          return entry;
        }),
        scalarParams: (c.scalarParams || []).map(function (p) { return { name: p.name, value: p.value }; })
      })
    }).then(function (resp) {
      ex.armedCommandId = resp.commandId;
      ex.armedFlow = { kind: c.kind, qualifiedName: c.qualifiedName };
      ex.armedAt = Date.now();
      render();
      if (!_execPoll) startExecPolling();
    }).catch(function (e) { ex.armError = e.message; render(); });
  }

  // ---------- live execute: the danger acknowledgment gate ----------
  // One-time, in-session-only (never persisted, resets on reload / reopen).
  // Its own modal, not a checkbox tucked into the panel, so it can't be
  // clicked past without reading it.
  function renderExecAckGate() {
    var ex = state.detail.live.exec;
    if (!ex.ackOpen) return null;
    var checkbox = el('input', { type: 'checkbox' });
    var enableBtn = el('button', {
      class: 'btn btn-danger', text: 'Enable', disabled: 'disabled',
      onclick: function () { ex.acknowledged = true; ex.ackOpen = false; render(); }
    });
    checkbox.addEventListener('change', function () { if (checkbox.checked) enableBtn.removeAttribute('disabled'); else enableBtn.setAttribute('disabled', 'disabled'); });
    var backdrop = el('div', { class: 'modal-backdrop modal-backdrop-over', onclick: function (e) { if (e.target === backdrop) { ex.ackOpen = false; render(); } } }, [
      el('div', { class: 'modal' }, [
        el('h3', { text: 'Live execution — read this first' }),
        el('p', { class: 'warn-text', text: 'This lets MxScout trigger a real microflow or nanoflow in your connected app tab, using its real logged-in session.' }),
        el('p', { class: 'warn-text', text: 'If what you run writes, deletes or sends something, that really happens — it is not a simulation. Only use this on environments you are allowed to test. Production is blocked.' }),
        el('label', { class: 'ack-row' }, [checkbox, el('span', { text: ' I understand.' })]),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: function () { ex.ackOpen = false; render(); } }),
          enableBtn
        ])
      ])
    ]);
    return backdrop;
  }

  // ---------- live execute: confirm modal ----------
  // Shared by a flow run AND creating a temporary object — both are the two
  // things in MxScout that can change the app tab's/session's state, so both
  // stop here for the same one-more-confirmation gate. `c.onConfirm`, when
  // set, is called instead of armCommand(c) — creating an object doesn't go
  // through the exec/result channel at all (see renderTransientPane), so it
  // needs its own action rather than the flow-run one.
  function renderExecConfirmModal() {
    if (!state.detail || !state.detail.live) return null;
    var c = state.detail.live.exec.confirm;
    if (!c) return null;
    var close = function () { state.detail.live.exec.confirm = null; render(); };
    var isCreate = c.kind === 'create';
    var body = isCreate
      ? [
          el('h3', { text: 'Create this object now?' }),
          el('p', { class: 'warn-text', text: 'This will actually create an object in your connected app tab, using its real logged-in session.' }),
          el('p', {}, [el('span', { class: 'muted', text: 'Entity: ' }), el('strong', { text: c.qualifiedName })])
        ].concat(Object.keys(c.values || {}).map(function (k) {
          return el('p', {}, [el('span', { class: 'muted', text: k + ': ' }), el('strong', { text: String(c.values[k]) })]);
        }))
      : [
          el('h3', { text: 'Run this now?' }),
          el('p', { class: 'warn-text', text: 'This will actually run in your connected app tab, using its real logged-in session. If this ' + KIND_LABEL[c.kind] + ' writes, deletes or sends something, that really happens.' }),
          el('p', {}, [el('span', { class: 'muted', text: 'Target: ' }), el('strong', { text: c.qualifiedName })])
        ].concat((c.objectParams || []).map(function (p) {
          var guids = p.guids || [];
          var idsText = guids.length === 1
            ? ('id ' + guids[0])
            : (guids.length + ' objects (ids ' + guids.slice(0, 5).join(', ') + (guids.length > 5 ? ', …' : '') + ')');
          var line = [el('span', { class: 'muted', text: p.name + ': ' }), el('strong', { text: idsText })];
          // Name the attribute values that will be set on the object, so the
          // confirmation says exactly what the run will do, not only which
          // object it targets.
          if (p.overrides && Object.keys(p.overrides).length) {
            var ovText = Object.keys(p.overrides).map(function (k) { return k + ' = ' + String(p.overrides[k]); }).join(', ');
            line.push(el('span', { class: 'muted', text: ' — set ' }), el('strong', { text: ovText }));
          }
          return el('p', {}, line);
        })).concat((c.scalarParams || []).map(function (p) {
          return el('p', {}, [el('span', { class: 'muted', text: p.name + ': ' }), el('strong', { text: String(p.value) })]);
        }));
    var backdrop = el('div', { class: 'modal-backdrop modal-backdrop-over', onclick: function (e) { if (e.target === backdrop) close(); } }, [
      el('div', { class: 'modal' }, body.concat([
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', text: 'Cancel', onclick: close }),
          el('button', { class: 'btn btn-danger', text: isCreate ? 'Create it' : 'Run it', onclick: function () { if (c.onConfirm) c.onConfirm(); else armCommand(c); } })
        ])
      ]))
    ]);
    return backdrop;
  }

  // ---------- live execute: status/result area (updated in place by poll) ----------
  function renderExecStatusArea() {
    var ex = state.detail.live.exec;
    var status = ex.status || {};
    var kids = [];
    kids.push(status.listenerConnected
      ? el('div', { class: 'exec-listener exec-listener-ok' }, [el('span', { class: 'live-dot' }), el('span', { text: 'Listener connected in your app tab.' })])
      : el('div', { class: 'exec-listener exec-listener-wait' }, [el('span', { class: 'spinner' }), el('span', { text: 'Waiting for the listener snippet to be pasted and running…' })]));

    if (ex.armedFlow) {
      var result = (status.result && status.result.id === ex.armedCommandId) ? status.result : null;
      if (result) {
        kids.push(el('p', { class: result.ok ? 'ok-text' : 'warn-text', text: (result.ok ? '✅ Success' : '❌ Failed') + (result.message ? (' — ' + result.message) : '') + ' — ' + ex.armedFlow.qualifiedName }));
      } else if (Date.now() - ex.armedAt > EXEC_RESULT_TIMEOUT_MS) {
        kids.push(el('p', { class: 'warn-text', text: '⏱ Timed out waiting for ' + ex.armedFlow.qualifiedName + ' — the app tab may have been closed or navigated away.' }));
      } else {
        kids.push(el('div', { class: 'exec-listener exec-listener-wait' }, [el('span', { class: 'spinner' }), el('span', { text: 'Running ' + ex.armedFlow.qualifiedName + ' in the app tab…' })]));
      }
    }
    if (ex.armError) kids.push(el('p', { class: 'warn-text', text: ex.armError }));
    return el('div', {}, kids);
  }

  // ---------- live execute: the Live app tab ----------
  // Connecting lives here; RUNNING does not. Picking a flow used to happen on
  // this tab, which meant choosing it in one place, reading about it in
  // another, and hand-copying an object id between them. It moved onto the
  // flow itself — open a microflow or nanoflow and use its Run tab.
  function renderExecSection(model, project) {
    var ex = state.detail.live.exec;
    return el('div', { class: 'scan-section' }, [
      el('div', { class: 'scan-head-row' }, [
        el('h4', { class: 'scan-h', text: 'Connected app' }),
        bridgeConnected() ? el('button', { class: 'btn btn-sm', text: 'Disconnect', onclick: disconnectBridge }) : null
      ].filter(Boolean)),
      renderBridgeSection(null),
      bridgeConnected() ? el('p', { class: 'muted', text: 'Open an entity to read its rows, or a microflow or nanoflow to run it. Everything happens on the object itself.' }) : null,
      bridgeConnected() && !ex.acknowledged ? el('p', { class: 'hint', text: 'Running a flow asks for one extra confirmation the first time, every time you open a project.' }) : null,
      el('div', { id: 'exec-status-area', class: 'exec-status-area' }, [renderExecStatusArea()])
    ].filter(Boolean));
  }

  // ---------- the data pane ----------
  // The nodes of the pane currently on screen, so a page of rows can be
  // repainted without rebuilding the search box the user is typing into. It is
  // a cache of the DOM, not state: whoever takes the pane off screen says so
  // through forgetDataPane(), and a repaint for a pane that is gone is a no-op
  // rather than a write into a detached node.
  var _dataUI = null;
  function forgetDataPane() { _dataUI = null; }

  function dataState(qn) {
    var d = state.detail.data;
    if (!d || d.qn !== qn) {
      d = state.detail.data = { qn: qn, offset: 0, search: '', searchField: '', searchType: '', rows: null, total: null, more: false, error: null, busy: false, timer: null };
    }
    return d;
  }

  function loadDataPage(qn) {
    var d = dataState(qn);
    d.busy = true;
    d.error = null;
    paintData(qn);
    var entity = findEntity(state.detail.model, qn);
    runQuery({
      qualifiedName: qn,
      columns: entity ? dataColumns(entity) : [],
      searchAttrs: entity ? searchableAttrs(entity) : [],
      searchField: d.searchField || '', searchType: d.searchType || '',
      search: d.search, offset: d.offset, amount: DATA_PAGE_SIZE
    }, function (err, data) {
      var cur = state.detail && state.detail.data;
      if (!cur || cur.qn !== qn) return; // the user moved on
      cur.busy = false;
      cur.error = err;
      if (data) {
        cur.rows = data.rows || [];
        cur.total = typeof data.total === 'number' ? data.total : null;
        cur.more = !!data.more;
      }
      paintData(qn);
    });
  }

  // Repaints only the parts that change, so typing in the search box never
  // loses focus and the table does not flicker between pages.
  function paintData(qn) {
    if (!_dataUI || _dataUI.qn !== qn) return;
    var d = dataState(qn);
    var entity = findEntity(state.detail.model, qn);
    if (!entity) return;

    _dataUI.summary.textContent = d.busy ? 'Reading\u2026' : describeDataPage(d);
    while (_dataUI.body.firstChild) _dataUI.body.removeChild(_dataUI.body.firstChild);
    _dataUI.body.appendChild(renderDataTable(entity, d, _dataUI.onPick, _dataUI.selectedSet));

    var atStart = d.offset === 0;
    var atEnd = !d.more;
    _dataUI.prev.disabled = atStart || d.busy;
    _dataUI.next.disabled = atEnd || d.busy;
  }

  function describeDataPage(d) {
    if (d.error) return '';
    if (!d.rows) return '';
    if (!d.rows.length) return d.search ? 'No matches.' : 'No rows this session can see.';
    var from = d.offset + 1;
    var to = d.offset + d.rows.length;
    if (d.total != null) return from + '\u2013' + to + ' of ' + d.total;
    // The exact count is an enhancement, not a promise: say so rather than
    // inventing a number.
    return from + '\u2013' + to + (d.more ? '+' : '');
  }

  // Did the app say this value is writable on this row? Only an explicit true
  // counts: a runtime that would not answer leaves it null, and nothing is
  // marked rather than something marked wrongly.
  function isWritable(row, column) {
    return !!(row && row.writable && row.writable[column] === true);
  }

  // Shown under a table that has at least one writable value, because a green
  // cell with nothing naming it is decoration.
  function writeLegend(rows, columns) {
    var any = (rows || []).some(function (row) {
      return (columns || []).some(function (c) { return isWritable(row, c); });
    });
    if (!any) return null;
    return el('div', { class: 'data-write-legend' }, [
      el('span', { class: 'data-write-swatch' }),
      el('span', { text: 'Green: this session may write that value on that row. Everything else is read-only here.' })
    ]);
  }

  // `selectedSet`, when given, switches picking from single (click replaces
  // d.picked, used for a single-Object flow parameter) to multi (click
  // toggles membership in the Set, used for a List-typed one) \u2014 a checkbox
  // column makes which mode is active visible rather than implied.
  function renderDataTable(entity, d, onPick, selectedSet) {
    if (d.error) return el('p', { class: 'warn-text data-empty', text: d.error });
    if (!d.rows) return el('div', { class: 'data-empty muted' }, [el('span', { class: 'spinner' }), el('span', { text: ' Asking the app\u2026' })]);
    if (!d.rows.length) return el('p', { class: 'data-empty muted', text: d.search ? 'Nothing matches \u201C' + d.search + '\u201D.' : 'This session can see no rows of this entity.' });

    var cols = (selectedSet ? [''] : []).concat(['id'], dataColumns(entity));
    var head = el('tr', {}, cols.map(function (c) { return el('th', { text: c }); }));
    var body = d.rows.map(function (row) {
      var picked = selectedSet ? selectedSet.has(row.id) : d.picked === row.id;
      var tr = el('tr', { class: onPick ? ('data-pickable' + (picked ? ' is-picked' : '')) : '' }, cols.map(function (c) {
        if (c === '') {
          var box = el('input', { type: 'checkbox' });
          box.checked = picked;
          box.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
          return el('td', {}, [box]);
        }
        var v = c === 'id' ? row.id : (row.cells || {})[c];
        var cls = v == null ? 'data-null' : (c === 'id' ? 'data-id' : '');
        // Green says this session may WRITE this value on THIS row. The answer
        // is the running app's own (see writableCells in bridge.js), asked per
        // object rather than per column, because a rule's XPath decides which
        // rows it covers \u2014 the same attribute can be writable on one row and
        // read-only on the next.
        if (c !== 'id' && isWritable(row, c)) cls += (cls ? ' ' : '') + 'data-write';
        var td = el('td', { class: cls || null, text: v == null ? '\u2014' : String(v) });
        if (v != null) td.setAttribute('title', String(v));
        return td;
      }));
      function toggle() {
        if (selectedSet) { if (selectedSet.has(row.id)) selectedSet.delete(row.id); else selectedSet.add(row.id); }
        else d.picked = row.id;
        onPick(row.id);
        paintData(d.qn);
      }
      // Picking is a click on the row rather than only the checkbox: the id
      // IS the thing being chosen, and the row already shows it.
      if (onPick) tr.addEventListener('click', toggle);
      return tr;
    });
    return el('div', {}, [
      el('div', { class: 'data-scroll' }, [
        el('table', { class: 'data-table' }, [el('thead', {}, [head]), el('tbody', {}, body)])
      ]),
      writeLegend(d.rows, dataColumns(entity))
    ].filter(Boolean));
  }

  // Reading real data needs an approved app AND a bridge in its tab. Returns
  // the step that is missing, or null when there is nothing in the way. Both
  // popups ask the same question, so they ask it in one place.
  function bridgeBlocker(target) {
    var approved = state.detail.live.result && state.detail.live.result.verdict === 'allow';
    if (!approved) {
      return el('div', { class: 'popup-section' }, [
        el('p', { class: 'muted', text: 'To reach real data, MxScout needs the address of the running app you are testing.' }),
        el('button', {
          class: 'btn btn-primary', text: 'Connect to the app\u2026',
          onclick: function () {
            state.detail.selectedEntity = null;
            state.detail.selectedFlow = null;
            state.detail.view = 'live';
            render();
          }
        })
      ]);
    }
    if (!bridgeConnected()) return renderBridgeSection(target);
    return null;
  }

  // The rows pane: search, table, pager. Shared by the entity's Data tab and
  // by the object picker a flow needs before it can run — they are the same
  // thing, and the picker only adds a click handler.
  function renderDataPane(model, entity, onPick, selectedSet) {
    var qn = entity.qualifiedName;
    var d = dataState(qn);
    var input = el('input', { type: 'search', class: 'data-search', placeholder: 'Search ' + entity.name + '\u2026', value: d.search });
    input.addEventListener('input', function () {
      clearTimeout(d.timer);
      // Live, but not once per keystroke: every query supersedes the last, and
      // a short pause is the difference between searching and thrashing.
      d.timer = setTimeout(function () {
        d.search = input.value;
        d.offset = 0;
        loadDataPage(qn);
      }, 220);
    });

    // WHICH field the term is matched against. Without this, a search could
    // only ever be a contains() across the entity's String attributes \u2014 on
    // an entity whose interesting fields are numbers, enums or booleans it
    // matched nothing and looked broken. Naming the field also lets the
    // bridge compare by that field's own type instead of guessing.
    var fieldSelect = el('select', { class: 'data-search-field role-select' });
    fieldSelect.appendChild(el('option', { value: '', text: 'any text field' }));
    fieldSelect.appendChild(el('option', { value: 'id', text: 'object id' }));
    (entity.attributes || []).forEach(function (a) {
      if (!SEARCHABLE_TYPE.test(String(a.type || ''))) return;
      var o = el('option', { value: a.name, text: a.name });
      if (d.searchField === a.name) o.setAttribute('selected', 'selected');
      fieldSelect.appendChild(o);
    });
    if (d.searchField === 'id') fieldSelect.value = 'id';
    else if (!d.searchField) fieldSelect.value = '';
    fieldSelect.addEventListener('change', function () {
      d.searchField = fieldSelect.value;
      var attr = (entity.attributes || []).filter(function (a) { return a.name === d.searchField; })[0];
      d.searchType = d.searchField === 'id' ? 'AutoNumber' : (attr ? attr.type : '');
      d.offset = 0;
      if (d.search) loadDataPage(qn);
    });

    var summary = el('span', { class: 'data-summary muted' });
    var prev = el('button', { class: 'btn btn-sm', text: '\u2190 Previous', onclick: function () {
      var st = dataState(qn);
      if (st.offset === 0) return;
      st.offset = Math.max(0, st.offset - DATA_PAGE_SIZE);
      loadDataPage(qn);
    } });
    var next = el('button', { class: 'btn btn-sm', text: 'Next \u2192', onclick: function () {
      var st = dataState(qn);
      st.offset += DATA_PAGE_SIZE;
      loadDataPage(qn);
    } });
    var body = el('div', { class: 'data-body' });

    _dataUI = { qn: qn, summary: summary, body: body, prev: prev, next: next, onPick: onPick || null, selectedSet: selectedSet || null };

    // Entering the tab is what asks the app how many rows there are — the
    // count is a question, not a background job, so it is asked when someone
    // is actually looking.
    if (d.rows === null && !d.busy) loadDataPage(qn);
    else paintData(qn);

    return el('div', { class: 'data-pane' }, [
      el('div', { class: 'data-bar' }, [input, el('span', { class: 'data-search-in muted', text: 'in' }), fieldSelect, summary]),
      body,
      el('div', { class: 'data-pager' }, [prev, next])
    ]);
  }

  // ---------- the transient pane: non-persistable entities ----------
  // A non-persistable entity has no store to run an xpath query against —
  // there is no "list all of them" here, ever (see the file header on
  // renderDataPane's own limits for the persistable case this ISN'T). What
  // IS real: an object whose id you already have — seen in the console, a
  // network request, a microflow's log message — is fully reachable by
  // mx.data.get({guid}), same as a persistable one, because Mendix keeps it
  // in the session server-side, not only in browser memory. So: look one up
  // by id, or create a fresh one.
  var SETTABLE_ATTR_TYPES = { String: 'text', Integer: 'number', Long: 'number', Decimal: 'number', Float: 'number', Boolean: 'checkbox' };

  function transientState(qn) {
    var t = state.detail.transient;
    if (!t || t.qn !== qn) {
      t = state.detail.transient = {
        qn: qn, lookupGuid: '', lookupBusy: false, lookupError: null,
        createValues: {}, createBusy: false, createError: null,
        items: [], pickedId: null,
        observed: null, observedBusy: false, observedError: null
      };
    }
    return t;
  }

  function buildCreateValues(entity, t) {
    var out = {};
    (entity.attributes || []).forEach(function (a) {
      var kind = SETTABLE_ATTR_TYPES[a.type];
      if (!kind) return;
      var raw = t.createValues[a.name];
      if (raw === undefined || raw === null) return;
      if (kind === 'checkbox') { out[a.name] = !!raw; return; }
      if (kind === 'number') {
        var trimmed = String(raw).trim();
        if (trimmed === '') return;
        var n = Number(trimmed);
        if (Number.isFinite(n)) out[a.name] = n;
        return;
      }
      out[a.name] = String(raw);
    });
    return out;
  }

  function renderTransientPane(model, entity, onPick) {
    var qn = entity.qualifiedName;
    var t = transientState(qn);
    var columns = dataColumns(entity);
    var ex = state.detail.live.exec;

    var kids = [
      el('p', { class: 'muted', text: entity.name + ' is non-persistable — Mendix has no store to list its objects from, so there is no browsable table here. An object whose id you already know (seen in the console, a network request, a microflow log) can still be read directly, and a new one can be created.' })
    ];

    // ---- look up by a known id ----
    var guidInput = el('input', { type: 'text', placeholder: 'Object id' });
    guidInput.value = t.lookupGuid;
    guidInput.addEventListener('input', function () { t.lookupGuid = guidInput.value; });
    var lookupBtn = el('button', {
      class: 'btn btn-sm', text: t.lookupBusy ? 'Looking up…' : 'Look up',
      disabled: t.lookupBusy ? 'disabled' : null,
      onclick: function () {
        var guid = (t.lookupGuid || '').trim();
        if (!/^\d+$/.test(guid)) { t.lookupError = 'That doesn’t look like an object id — it should be a plain number.'; render(); return; }
        t.lookupBusy = true; t.lookupError = null; render();
        runLookup(qn, guid, columns, function (err, data) {
          var cur = transientState(qn);
          cur.lookupBusy = false;
          var row = data && data.rows && data.rows[0];
          if (err || !row) { cur.lookupError = 'Could not find that object — it may no longer exist in this session' + (err ? (' (' + err + ')') : '') + '.'; render(); return; }
          cur.items = [{ id: row.id, cells: row.cells, writable: row.writable || null }].concat(cur.items.filter(function (i) { return i.id !== row.id; })).slice(0, 20);
          render();
        });
      }
    });
    kids.push(el('div', { class: 'popup-section' }, [
      el('h4', { text: 'Look up by id' }),
      el('div', { class: 'live-url-row' }, [guidInput, lookupBtn]),
      t.lookupError ? el('p', { class: 'warn-text', text: t.lookupError }) : null
    ].filter(Boolean)));

    // ---- create a new one — in its own window ----
    // The form used to sit inline here; it opens as its own popup now (Karol),
    // and that popup is where the role's Create access is checked.
    kids.push(el('div', { class: 'popup-section' }, [
      el('h4', { text: 'Create a new ' + entity.name }),
      el('p', { class: 'muted', text: 'Opens a window to fill in and create one, in your own app session.' }),
      el('button', { class: 'btn', text: '+ Create a new ' + entity.name,
        onclick: function () { state.detail.createObject = qn; render(); } })
    ]));

    // ---- guids the app itself touched (passive observation) ----
    // The bridge watches the app's own mx.data.action calls and notes which
    // object ids they carry (see bridge.js). For a non-persistable entity —
    // which has no store to browse — this is the one way to point at a real
    // object without the tester copying an id out of the console by hand.
    // Read-only: MxScout initiates nothing here, it just asks what the
    // user's own clicks already sent.
    var observeBtn = el('button', {
      class: 'btn btn-sm', text: t.observedBusy ? 'Checking…' : (t.observed ? 'Refresh' : 'Check what the app has touched'),
      disabled: t.observedBusy ? 'disabled' : null,
      onclick: function () {
        t.observedBusy = true; t.observedError = null; render();
        runObserved(function (err, data) {
          var cur = transientState(qn);
          cur.observedBusy = false;
          if (err) { cur.observedError = err; cur.observed = cur.observed || []; render(); return; }
          cur.observed = (data && data.rows) || [];
          render();
        });
      }
    });
    // Heading, then what this is, THEN the button, then what came back. The
    // button used to sit between the heading and its own explanation, which
    // put the sentence describing it underneath it and left the empty-state
    // line running straight into the window's Cancel button at the bottom.
    var observeKids = [
      el('h4', { text: 'Seen passing through the app' + (t.observed ? ' (' + t.observed.length + ')' : '') }),
      el('p', { class: 'muted', text: 'Object ids that microflow calls in this app tab have carried this session — the app’s own, and any you ran from MxScout. Click one to look it up. They are not filtered by entity, so an id may belong to something other than ' + entity.name + '.' }),
      el('div', { class: 'observed-actions' }, [observeBtn])
    ];
    if (t.observedError) observeKids.push(el('p', { class: 'warn-text', text: t.observedError }));
    if (t.observed && t.observed.length) {
      observeKids.push(el('div', { class: 'observed-list' }, t.observed.map(function (row) {
        var sub = (row.cells && row.cells.microflows) ? row.cells.microflows : '';
        return el('button', { class: 'observed-item', onclick: function () {
          var cur = transientState(qn);
          cur.lookupGuid = row.id;
          guidInput.value = row.id;
          lookupBtn.click();
        } }, [
          el('span', { class: 'observed-guid', text: row.id }),
          sub ? el('span', { class: 'observed-sub', text: sub }) : null
        ].filter(Boolean));
      })));
    } else if (t.observed) {
      // A box rather than one more paragraph: an empty RESULT is a different
      // kind of thing from the prose above it, and as loose text it read as
      // the end of that prose.
      observeKids.push(el('div', { class: 'observed-empty' }, [
        el('span', { text: 'Nothing yet — click around the app (open a page, run something) and refresh. Only ids the app itself puts through a microflow show up here.' })
      ]));
    }
    kids.push(el('div', { class: 'popup-section' }, observeKids));

    // ---- seen this session ----
    if (t.items.length) {
      var rows = t.items.map(function (item) {
        var tds = ['id'].concat(columns).map(function (c) {
          var v = c === 'id' ? item.id : (item.cells || {})[c];
          var cls = v == null ? 'data-null' : '';
          if (c !== 'id' && isWritable(item, c)) cls += (cls ? ' ' : '') + 'data-write';
          return el('td', { class: cls || null, text: v == null ? '—' : String(v) });
        });
        var tr = el('tr', { class: onPick ? ('data-pickable' + (t.pickedId === item.id ? ' is-picked' : '')) : '' }, tds);
        if (onPick) tr.addEventListener('click', function () { t.pickedId = item.id; onPick(item.id); render(); });
        return tr;
      });
      var head = el('tr', {}, ['id'].concat(columns).map(function (c) { return el('th', { text: c }); }));
      kids.push(el('div', { class: 'popup-section' }, [
        el('h4', { text: 'Seen this session (' + t.items.length + ')' }),
        el('div', { class: 'data-scroll' }, [el('table', { class: 'data-table' }, [el('thead', {}, [head]), el('tbody', {}, rows)])]),
        writeLegend(t.items, columns)
      ].filter(Boolean)));
    }

    return el('div', { class: 'data-pane' }, kids);
  }

  // The create-a-non-persistable-object window. Opened from the transient pane
  // (state.detail.createObject = the entity's qn), it sits over the entity
  // popup or the object picker. The created object lands in "Seen this session"
  // in the pane underneath, where a flow's picker can then choose it.
  function renderCreateModal() {
    if (!state.detail || !state.detail.createObject) return null;
    var qn = state.detail.createObject;
    var model = state.detail.model;
    var entity = findEntity(model, qn);
    if (!entity || entity.persistable !== false) { state.detail.createObject = null; return null; }
    var t = transientState(qn);
    var ex = state.detail.live.exec;
    var columns = dataColumns(entity);
    var close = function () { state.detail.createObject = null; render(); };

    // Create-access gate for the selected role. The everything-view has no one
    // role to check, so creating is offered; a specific role with no Create
    // rule on the entity is blocked — the app runs the create under the
    // tester's own rights and would refuse it, so there is nothing to try.
    var setRoles = moduleRoleSetFor(model, state.detail.role);
    var roleHasCreate = !setRoles || (entity.accessRules || []).some(function (r) { return setRoles[r.moduleRole] && r.allowCreate; });

    var head = [
      el('h3', { text: 'Create a new ' + entity.name }),
      el('p', { class: 'muted', text: entity.qualifiedName })
    ];

    var body, actions;
    if (!roleHasCreate) {
      body = [el('div', { class: 'create-blocked' }, [
        el('p', { text: state.detail.role + ' has no Create rule on ' + entity.qualifiedName + '.' }),
        el('p', { text: 'The app runs a create under your own session’s rights and would refuse this, so MxScout doesn’t offer it here. Switch to a role that may create it.' })
      ])];
      actions = [el('button', { class: 'btn', text: 'Close', onclick: close })];
    } else if (!ex.acknowledged) {
      body = [el('p', { class: 'warn-text', text: 'Creating an object is real: it happens in your app tab, in your own logged-in session.' })];
      actions = [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-danger-outline', text: 'Enable creating objects', onclick: function () { ex.ackOpen = true; render(); } })
      ];
    } else {
      var settable = (entity.attributes || []).filter(function (a) { return SETTABLE_ATTR_TYPES[a.type]; });
      var unsettable = (entity.attributes || []).filter(function (a) { return !SETTABLE_ATTR_TYPES[a.type]; });
      var createRows = settable.map(function (a) {
        var kind = SETTABLE_ATTR_TYPES[a.type], field;
        if (kind === 'checkbox') {
          field = el('input', { type: 'checkbox' });
          field.checked = t.createValues[a.name] === true;
          field.addEventListener('change', function () { t.createValues[a.name] = field.checked; });
        } else {
          field = el('input', { type: 'text', placeholder: a.type });
          field.value = t.createValues[a.name] != null ? String(t.createValues[a.name]) : '';
          field.addEventListener('input', function () { t.createValues[a.name] = field.value; });
        }
        return el('div', { class: 'kv-row' }, [el('span', { class: 'kv-key', text: a.name }), field]);
      });
      unsettable.forEach(function (a) {
        createRows.push(el('div', { class: 'kv-row' }, [
          el('span', { class: 'kv-key', text: a.name }),
          el('span', { class: 'kv-val muted', text: a.type + ' — not settable here yet' })
        ]));
      });
      body = [
        // Short on purpose: the qualified name is already in the line above the
      // window's title, and saying it a third time is what pushed this window
      // to the height of the entity popup behind it.
      el('div', { class: 'create-access-ok', text: setRoles ? (state.detail.role + ' may create it.') : 'Creating in your own app session.' }),
        createRows.length ? el('div', { class: 'kv' }, createRows) : el('p', { class: 'muted', text: 'This entity has no settable attributes here — it is created empty.' }),
        el('p', { class: 'create-note', text: 'Creating is real — it happens in your app tab, in your own session.' }),
        t.createError ? el('p', { class: 'warn-text', text: t.createError }) : null
      ].filter(Boolean);
      actions = [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { class: 'btn btn-danger', text: t.createBusy ? 'Creating…' : 'Create', disabled: t.createBusy ? 'disabled' : null, onclick: function () {
          var values = buildCreateValues(entity, t);
          ex.confirm = {
            kind: 'create', qualifiedName: qn, values: values,
            onConfirm: function () {
              ex.confirm = null;
              t.createBusy = true; t.createError = null; render();
              runCreate(qn, values, columns, function (err, data) {
                var cur = transientState(qn);
                cur.createBusy = false;
                var row = data && data.rows && data.rows[0];
                if (err || !row) { cur.createError = err || 'Could not create that object.'; render(); return; }
                cur.items = [{ id: row.id, cells: row.cells, writable: row.writable || null }].concat(cur.items).slice(0, 20);
                cur.createValues = {};
                state.detail.createObject = null; // the window has done its job
                render();
              });
            }
          };
          render();
        } })
      ];
    }

    var backdrop = el('div', { class: 'modal-backdrop modal-backdrop-over', onclick: function (e) { if (e.target === backdrop) close(); } }, [
      // Its own width, NOT the entity popup's `modal-detail` (1200px): this
      // window is a short form, and at that width one attribute got an input
      // the length of the screen with a label lost at the far left of it.
      el('div', { class: 'modal modal-create' }, head.concat(body, [el('div', { class: 'modal-actions' }, actions)]))
    ]);
    return backdrop;
  }

  window.MxLive = {
    init: init,
    // the guard
    classifyAppUrl: classifyAppUrl,
    persistAppUrl: persistAppUrl,
    // the connection
    renderPanel: renderLivePanel,
    renderConnect: renderBridgeSection,
    connected: bridgeConnected,
    startPolling: startExecPolling,
    stopPolling: stopExecPolling,
    // what a snippet is generated FOR
    targetForEntity: bridgeTargetForEntity,
    targetForFlow: bridgeTargetForFlow,
    // reading rows
    blocker: bridgeBlocker,
    renderDataPane: renderDataPane,
    renderTransientPane: renderTransientPane,
    renderCreateModal: renderCreateModal,
    forgetDataPane: forgetDataPane,
    // running a flow
    renderAckGate: renderExecAckGate,
    renderConfirmModal: renderExecConfirmModal,
    renderStatusArea: renderExecStatusArea
  };
})();
