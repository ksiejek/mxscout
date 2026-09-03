/* MxScout — the bridge: ONE snippet the user pastes into their app tab.
 *
 * Before this file there were two snippets (a read-only scan and a separate
 * execution listener) and the user had to paste both. There is now one. It
 * connects to the app's data AND accepts run commands, because "paste this,
 * then paste this other thing too" is a step nobody remembers on the second
 * day.
 *
 * The snippet is not assembled from string fragments. `bridgeBody` below is
 * REAL JavaScript in this file, serialized at generate time with
 * Function.prototype.toString(). That matters for more than tidiness:
 *
 *  - the production guard now exists ONCE, as code, instead of being copied
 *    into two string literals that could silently drift apart;
 *  - a syntax error is caught by the browser loading this file, not by the
 *    user pasting a broken snippet into their console;
 *  - a test can call bridgeBody's helpers directly.
 *
 * It relies on the source text of a function being preserved, which is true
 * everywhere and stays true here because MxScout has no build step and no
 * minifier. If one is ever added, this breaks loudly and immediately.
 *
 * TWO MODES, decided at runtime by the snippet itself:
 *
 *  LINKED     — it can reach MxScout on loopback. It long-polls for commands
 *               (browse an entity, run a flow) and answers them. The user
 *               works in the MxScout window; this tab just serves.
 *
 *  STANDALONE — the app's Content-Security-Policy blocks connect-src to
 *               127.0.0.1, so nothing can be sent back. Instead of failing,
 *               the snippet renders MxScout's own entity panel INSIDE the app
 *               page, in MxScout's colours, for the one object the snippet was
 *               generated for. It is deliberately a dead end: no navigation to
 *               other entities, no model browsing. It is the fallback view of
 *               one thing, not a second copy of MxScout.
 *
 * Both modes get the same centred progress panel that says, in words, what is
 * happening — because "paste this and hope" is how the old flow felt when a
 * CSP quietly ate the first request.
 */
(function () {
  'use strict';

  // Everything below runs on the TARGET app's page, not on MxScout's. It may
  // reference only its own argument and browser/Mendix globals — no closure
  // over anything in this file, or the serialized copy breaks.
  function bridgeBody(CFG) {
    // ---------- production guard ----------
    // The single source of this rule. Whole-token matching, fail closed; see
    // classifyAppUrl in app.js for the reasoning. This is the copy that
    // actually runs, on the tab's own location, so editing the check in the
    // MxScout UI changes nothing here.
    var NONPROD = {
      dev: 1, development: 1, test: 1, testing: 1, tst: 1,
      accept: 1, acceptance: 1, acc: 1, acp: 1, accp: 1,
      sandbox: 1, staging: 1, stage: 1, uat: 1, qa: 1, local: 1
    };
    function envAllowed(host) {
      host = (host || '').toLowerCase().replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
          host.slice(-6) === '.local' || host.slice(-10) === '.localhost') return true;
      var t = host.split(/[.\-]/);
      for (var i = 0; i < t.length; i++) { if (NONPROD[t[i]]) return true; }
      return false;
    }
    if (!envAllowed(location.hostname)) {
      console.error('MxScout: this environment is not supported. Nothing was read, sent or run.');
      return;
    }
    if (typeof mx === 'undefined' || !mx.data || typeof mx.data.get !== 'function') {
      console.error('MxScout: mx.data was not found on this page. Open a logged-in Mendix app tab and paste this there.');
      return;
    }

    var P = CFG.palette;
    var TARGET = CFG.target || null;
    var PAGE_SIZE = 10;

    // ---------- tiny DOM kit ----------
    // Built with createElement + CSSOM only. A <style> element or a style=""
    // attribute would be refused by any app whose CSP omits 'unsafe-inline';
    // assigning el.style.cssText is CSSOM and is never subject to CSP, which
    // is why the panel can look right even on the strictest host.
    function mk(tag, css, text) {
      var n = document.createElement(tag);
      if (css) n.style.cssText = css;
      if (text != null) n.textContent = String(text);
      return n;
    }
    function add(parent, child) { parent.appendChild(child); return child; }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
    var FONT = '13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    var MONO = '12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace';
    // The same green MxScout's own access matrix uses for read+write, so a
    // writable value looks the same in this panel as it does in the app.
    var WRITE_TEXT = '#8fe0a2';
    var WRITE_LINE = '#46b45c';

    function btn(label, kind) {
      var base = 'font:' + FONT + ';padding:5px 11px;border-radius:7px;cursor:pointer;border:1px solid ' + P.border + ';';
      var skin = kind === 'primary'
        ? 'background:' + P.accent + ';border-color:' + P.accent + ';color:#1b1206;font-weight:600;'
        : (kind === 'danger'
          ? 'background:transparent;border-color:' + P.alarm + ';color:' + P.alarm + ';'
          : 'background:' + P.panel2 + ';color:' + P.text + ';');
      var b = mk('button', base + skin, label);
      b.type = 'button';
      return b;
    }

    // ---------- the centred progress panel ----------
    // Centred rather than tucked in a corner on purpose: until the snippet
    // knows whether it can reach MxScout, this IS the app's state, and the
    // user needs to read it. It names each step and its outcome, so a CSP
    // block reads as a diagnosis instead of as silence.
    var shell = null, stepsBox = null, bodyBox = null, headTitle = null;

    function mountShell() {
      if (shell) return;
      var back = mk('div', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(0,0,0,.55);');
      shell = mk('div', 'width:min(820px,94vw);max-height:88vh;display:flex;flex-direction:column;' +
        'background:' + P.panel + ';color:' + P.text + ';font:' + FONT + ';border:1px solid ' + P.border + ';' +
        'border-top:2px solid ' + (TARGET && TARGET.mod ? TARGET.mod : P.accent) + ';' +
        'border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.6);overflow:hidden;');
      var head = mk('div', 'display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid ' + P.border + ';');
      add(head, logoMark());
      headTitle = add(head, mk('div', 'font-weight:650;', 'MxScout'));
      add(head, mk('div', 'flex:1;'));
      var close = add(head, mk('span', 'cursor:pointer;opacity:.6;padding:0 4px;font-size:16px;', '✕'));
      close.addEventListener('click', teardown);
      add(shell, head);
      bodyBox = add(shell, mk('div', 'padding:14px 16px 16px;overflow:auto;'));
      stepsBox = add(bodyBox, mk('div', ''));
      add(back, shell);
      document.body.appendChild(back);
      shell.__back = back;
    }

    // The three-node mark from MxScout's own header, drawn with divs so no
    // inline SVG markup is needed.
    function logoMark() {
      var wrap = mk('div', 'position:relative;width:18px;height:18px;flex:none;');
      [[0, 6], [12, 0], [12, 12]].forEach(function (p) {
        add(wrap, mk('div', 'position:absolute;left:' + p[0] + 'px;top:' + p[1] + 'px;width:6px;height:6px;' +
          'border-radius:50%;background:' + P.accent + ';'));
      });
      return wrap;
    }

    function teardown() {
      running = false;
      if (shell && shell.__back && shell.__back.parentNode) shell.__back.parentNode.removeChild(shell.__back);
      shell = null;
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      badge = null;
    }

    var steps = [];
    function step(label) {
      var row = mk('div', 'display:flex;align-items:baseline;gap:9px;padding:3px 0;');
      var icon = add(row, mk('span', 'width:14px;flex:none;color:' + P.muted + ';', '·'));
      var text = add(row, mk('span', 'color:' + P.muted + ';', label));
      add(stepsBox, row);
      var s = {
        run: function (t) { icon.textContent = '●'; icon.style.color = P.accent; text.style.color = P.text; if (t) text.textContent = t; },
        ok: function (t) { icon.textContent = '✓'; icon.style.color = '#6fbf73'; text.style.color = P.text; if (t) text.textContent = t; },
        fail: function (t) { icon.textContent = '✕'; icon.style.color = P.alarm; text.style.color = P.text; if (t) text.textContent = t; }
      };
      steps.push(s);
      return s;
    }
    function note(text, color) {
      return add(bodyBox, mk('p', 'margin:10px 0 0;color:' + (color || P.muted) + ';', text));
    }

    // ---------- session ----------
    function attempt(fn) { try { return fn(); } catch (e) { return undefined; } }
    function readSession() {
      var user = attempt(function () { return mx.session.getUserName(); }) || null;
      if (!user) user = attempt(function () { return mx.session.getUserAttribute('Name'); }) || null;
      var guest = !!attempt(function () { return mx.session.isGuest(); });
      return { user: user, guest: guest };
    }
    function csrf() { return attempt(function () { return mx.session.getConfig('csrftoken'); }) || ''; }

    // ---------- passively noticing objects the app itself touches ----------
    // The one genuinely useful, read-only idea worth taking from a pentest
    // tool: a non-persistable object has no store to list from (confirmed —
    // there is no enumerable client cache), but the moment the app's OWN
    // logic runs a microflow against one, its guid goes past on the wire. So
    // wrap mx.data.action ONCE and note the guids and action name that flow
    // through it — never calling it, never changing it, only watching what
    // the user's own clicks already send. That gives a tester the id they
    // could otherwise only spot by hand in the console, and it is the only
    // way MxScout can point at a temporary object at all.
    //
    // This is observation, not access: nothing here initiates a call, reads
    // a cookie, or touches anything the user's own session did not already
    // touch. The buffer is bounded, in-memory, and never leaves the tab
    // except when MxScout explicitly asks for it (the `observed` command).
    var OBSERVED_MAX = 100;
    var observedCalls = [];
    function guidsFromActionParams(p) {
      // mx.data.action has been called two shapes over the years:
      // { params: { actionname, guids } , context } and a flatter
      // { actionname, guids }. Read guids from wherever they sit, and from
      // the MxContext too, defensively — all read-only.
      var out = [];
      function pushAll(v) {
        if (!v) return;
        if (Array.isArray(v)) v.forEach(function (g) { if (g != null) out.push(String(g)); });
        else out.push(String(v));
      }
      var inner = (p && p.params) ? p.params : p;
      if (inner) { pushAll(inner.guids); pushAll(inner.guid); }
      var ctx = p && p.context;
      var ctxGuids = ctx && attempt(function () { return typeof ctx.getTrackGuid === 'function' ? ctx.getTrackGuid() : (ctx.getGuid && ctx.getGuid()); });
      if (ctxGuids) pushAll(ctxGuids);
      // De-duplicate within one call.
      var seen = {};
      return out.filter(function (g) { if (seen[g]) return false; seen[g] = 1; return true; });
    }
    function installActionObserver() {
      if (!mx.data || typeof mx.data.action !== 'function' || mx.data.action.__mxsObserved) return;
      var original = mx.data.action;
      var wrapper = function (params) {
        var name = null;
        try {
          var inner = (params && params.params) ? params.params : params;
          name = (inner && inner.actionname) || null;
          var guids = guidsFromActionParams(params);
          if (name || guids.length) {
            observedCalls.push({ actionname: name, guids: guids, at: Date.now() });
            if (observedCalls.length > OBSERVED_MAX) observedCalls.splice(0, observedCalls.length - OBSERVED_MAX);
          }
        } catch (e) { /* never let watching break the app's own call */ }
        // This wrapper's one job is watching the guids go by, which it just did.
        return original.apply(this, arguments);
      };
      wrapper.__mxsObserved = true;
      // Preserve anything hung off the original function object.
      Object.keys(original).forEach(function (k) { try { wrapper[k] = original[k]; } catch (e) {} });
      mx.data.action = wrapper;
    }

    function nowMs() {
      return (window.performance && typeof performance.now === 'function') ? performance.now() : Date.now();
    }

    // Everything the BRIDGE itself calls must stay out of the app's numbers,
    // or MxScout ends up measuring MxScout. Two mechanisms, because there are
    // two kinds of call: mx.* goes through wrappers that can be told
    // synchronously (ourDepth), while raw /xas/ requests only surface later,
    // through PerformanceObserver, and can only be excluded by when they
    // happened (ourNet). Commands are handled one at a time, so one open
    // interval is enough to cover the command in flight.
    var ourDepth = 0;
    function ours(fn) {
      ourDepth++;
      try { return fn(); } finally { ourDepth--; }
    }
    var ourNet = null;
    function ourNetBegin() {
      ourNetEnd();
      ourNet = { from: nowMs(), to: null };
      // A command whose result never comes back must not leave the exclusion
      // window open forever — that would silently swallow the app's own
      // traffic from then on.
      setTimeout(ourNetEnd, 15000);
    }
    function ourNetEnd() { if (ourNet && ourNet.to === null) ourNet.to = nowMs(); }
    // Close the exclusion window a breath after OUR command settles, not 15s
    // later. The old 15s backstop was fine when this only gated byte counts,
    // but now it gates every timing: leaving it open would drop the tester's
    // own app clicks for 15 seconds after each read. The 150ms grace lets the
    // async record of our own in-flight /xas/ land inside the window first.
    function finishOurNet() { setTimeout(ourNetEnd, 150); }
    function wasOurNet(start, end) {
      if (!ourNet) return false;
      return end >= ourNet.from && start <= (ourNet.to === null ? Infinity : ourNet.to);
    }

    // The bridge's OWN way of calling the Mendix client. Everything MxScout
    // does goes through these three, so the wrappers above can tell the app's
    // work from ours by one synchronous flag instead of by guessing. Reading
    // a page of rows for the tester is not something the app did.
    function mxGet(o) { return ours(function () { return mx.data.get(o); }); }
    function mxCreate(o) { return ours(function () { return mx.data.create(o); }); }
    function mxAction(o) { return ours(function () { return mx.data.action(o); }); }
    // The distinct guids seen, newest first, each with the last action that
    // carried it and how many times it was seen — a small, honest summary
    // rather than a raw call log.
    function observedGuidRows() {
      var byGuid = {};
      var order = [];
      observedCalls.forEach(function (c) {
        (c.guids || []).forEach(function (g) {
          if (!byGuid[g]) { byGuid[g] = { guid: g, actions: {}, count: 0, at: c.at }; order.push(g); }
          var e = byGuid[g];
          e.count++;
          e.at = Math.max(e.at, c.at);
          if (c.actionname) e.actions[c.actionname] = 1;
        });
      });
      return order.map(function (g) {
        var e = byGuid[g];
        return { guid: g, count: e.count, at: e.at, actions: Object.keys(e.actions) };
      }).sort(function (a, b) { return b.at - a.at; });
    }

    // ---------- reading data out of the app ----------
    // Two halves, deliberately different in kind:
    //
    //  rows  — mx.data.get, the documented, version-stable client API.
    //  total — POST /xas/ with count:true, which is what the Mendix client
    //          itself does behind every paged data grid. It is same-origin,
    //          read-only, and carries the user's own session and CSRF token.
    //
    // The count is an ENHANCEMENT and is allowed to fail: if the XAS shape
    // ever changes, or the token is missing, the table still pages correctly
    // and simply says "10+" instead of "of 253". The load-bearing path stays
    // on the documented API.
    // `spec` is { qualifiedName, columns, searchAttrs } — passed in rather than
    // read from TARGET, because a flow's picker reads a DIFFERENT entity than
    // the flow itself. An earlier version swapped TARGET in and out around the
    // call; it worked until something read TARGET.name in between, and then
    // the run button said "Run undefined".
    // Building the search predicate. The old version could only ever
    // `contains()` across String attributes, which quietly did nothing on an
    // entity whose interesting fields are numbers, enums or booleans — the
    // predicate came out empty and the unfiltered '//Entity' was returned,
    // so the search box looked broken rather than unsupported. A named
    // field (spec.searchField, chosen in the UI) is matched by its OWN type
    // instead: contains() only where contains() is meaningful, equality
    // everywhere else. With no field named, the old any-text behaviour
    // stands, since that is still the useful default.
    function searchPredicate(field, type, term) {
      var t = String(type || '').toLowerCase();
      if (field === 'id') return /^\d+$/.test(term) ? ("id = '" + term + "'") : null;
      if (/^(integer|long|autonumber)$/.test(t)) return /^-?\d+$/.test(term) ? (field + ' = ' + term) : null;
      if (/^(decimal|float)$/.test(t)) return /^-?\d*\.?\d+$/.test(term) ? (field + ' = ' + term) : null;
      if (/^bool/.test(t)) {
        if (/^(true|yes|1)$/i.test(term)) return field + ' = true()';
        if (/^(false|no|0)$/i.test(term)) return field + ' = false()';
        return null;
      }
      // An enumeration compares against its key, not a substring of it.
      if (/^enum/.test(t)) return field + " = '" + term + "'";
      if (/^(datetime|date)$/.test(t)) return null; // needs a date format both sides agree on
      return "contains(" + field + ",'" + term + "')";
    }

    function xpathFor(spec, search) {
      var qn = spec.qualifiedName;
      if (!search) return '//' + qn;
      var term = String(search).replace(/'/g, '').trim();
      if (!term) return '//' + qn;

      if (spec.searchField) {
        var one = searchPredicate(spec.searchField, spec.searchType, term);
        // A term that cannot mean anything for this field (letters in a
        // number field, say) must match NOTHING rather than silently
        // matching everything — "0 rows" is a true answer, a full unfiltered
        // page is not.
        if (!one) return '//' + qn + "[id = '-1']";
        return '//' + qn + '[' + one + ']';
      }

      var parts = [];
      (spec.searchAttrs || []).forEach(function (a) {
        parts.push("contains(" + a + ",'" + term + "')");
      });
      // A bare number is almost always someone pasting an object id.
      if (/^\d+$/.test(term)) parts.push("id = '" + term + "'");
      if (!parts.length) return '//' + qn;
      return '//' + qn + '[' + parts.join(' or ') + ']';
    }

    function countByXpath(xpath, done) {
      var token = csrf();
      if (!token) { done(null); return; }
      fetch('/xas/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': token },
        body: JSON.stringify({
          action: 'retrieve_by_xpath',
          params: { xpath: xpath, schema: { offset: 0, amount: 1, sort: [] }, count: true }
        })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { done(j && typeof j.count === 'number' ? j.count : null); })
        .catch(function () { done(null); });
    }

    // Which of these values the app itself would let this session WRITE, asked
    // per OBJECT and not per column. Two rows of one entity can fall under
    // different access rules — a rule's XPath decides which rows it covers —
    // so "can I write Status" is a property of the row, not of the column.
    // The Mendix client already knows: isReadonlyAttr is what its own widgets
    // ask before they let a field be edited, and the answer comes from the
    // object the runtime returned under this session's rights. Nothing is
    // written, and nothing extra is fetched: this is a question about an
    // object already in hand. A runtime that does not expose it returns null,
    // and the table then simply marks nothing.
    function writableCells(obj, columns) {
      if (!obj || typeof obj.isReadonlyAttr !== 'function') return null;
      var objectReadOnly = attempt(function () {
        return typeof obj.isObjectReadOnly === 'function' ? !!obj.isObjectReadOnly() : false;
      });
      var out = {};
      (columns || []).forEach(function (c) {
        var ro = attempt(function () { return obj.isReadonlyAttr(c); });
        // undefined = the runtime would not answer for this member; say
        // nothing rather than guess, since a wrong green is worse than none.
        out[c] = ro === undefined ? null : (objectReadOnly ? false : !ro);
      });
      return out;
    }

    function cellValue(obj, name) {
      try {
        var v = typeof obj.get === 'function' ? obj.get(name) : undefined;
        if (v === undefined || v === null) return null;
        if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      } catch (e) { return null; }
    }

    // Asks for one row more than the page needs, so "is there a next page"
    // is answerable even when the exact count is not.
    function queryPage(spec, search, offset, amount, done) {
      var xpath = xpathFor(spec, search);
      var out = { rows: [], offset: offset, amount: amount, total: null, more: false, error: null };
      var pending = 2;
      function settle() { if (--pending === 0) done(out); }

      countByXpath(xpath, function (n) { out.total = n; settle(); });

      try {
        mxGet({
          xpath: xpath,
          filter: { offset: offset, amount: amount + 1, sort: [] },
          callback: function (objs) {
            var list = objs || [];
            out.more = list.length > amount;
            out.rows = list.slice(0, amount).map(function (o) {
              var row = { id: attempt(function () { return o.getGuid(); }) || null, cells: {} };
              (spec.columns || []).forEach(function (c) { row.cells[c] = cellValue(o, c); });
              row.writable = writableCells(o, spec.columns);
              return row;
            });
            settle();
          },
          error: function (err) { out.error = (err && err.message) || String(err); settle(); }
        });
      } catch (e) { out.error = (e && e.message) || String(e); settle(); }
    }

    // ---------- running a flow ----------
    // `list` is [{name, guids: [...one or more], entityQualifiedName}] — a
    // single-Object parameter and a List-typed one are the same shape here,
    // just a different array length. Flatten to one mx.data.get per id,
    // order preserved, so `objs.length` downstream is exactly how many
    // objects the one supported parameter actually carries.
    function loadObjectParams(list, done) {
      var flat = [];
      // A single-object parameter may carry `overrides` — attribute values to
      // set on the object before the run. Only the FIRST guid of a param gets
      // them (a single-object param has exactly one guid; a list has no
      // overrides), so a list run never sets anything.
      (list || []).forEach(function (p) {
        (p.guids || []).forEach(function (g, i) {
          flat.push({ name: p.name, guid: g, overrides: i === 0 ? p.overrides : null });
        });
      });
      if (!flat.length) { done([]); return; }
      var loaded = new Array(flat.length), pending = flat.length, failed = false;
      flat.forEach(function (p, idx) {
        mxGet({
          guid: p.guid,
          callback: function (obj) {
            // Apply the overrides as uncommitted changes. mx.data.action sends
            // a dirty object's pending changes with the call, so the flow sees
            // these values; nothing is committed to the database here. A key
            // that isn't a real attribute is skipped rather than failing the
            // whole run.
            if (p.overrides) {
              Object.keys(p.overrides).forEach(function (k) {
                try { obj.set(k, p.overrides[k]); } catch (e) { /* skip that one field */ }
              });
            }
            loaded[idx] = obj;
            if (--pending === 0 && !failed) done(loaded);
          },
          error: function (err) {
            if (failed) return;
            failed = true;
            done(null, 'Could not load ' + (p.name || 'object') + ' (' + p.guid + '): ' + ((err && err.message) || String(err)));
          }
        });
      });
    }
    function fallbackMxContext() {
      if (typeof mxui !== 'undefined' && mxui.lib && typeof mxui.lib.MxContext === 'function') return mxui.lib.MxContext;
      if (typeof mx !== 'undefined' && mx.lib && typeof mx.lib.MxContext === 'function') return mx.lib.MxContext;
      return null;
    }
    function withMxContext(cb) {
      try {
        if (typeof require === 'function') {
          require(['mendix/lib/MxContext'], function (M) { cb(typeof M === 'function' ? M : fallbackMxContext()); }, function () { cb(fallbackMxContext()); });
          return;
        }
      } catch (e) {}
      cb(fallbackMxContext());
    }
    function buildContext(objs, cb) {
      if (!objs.length) { cb(undefined); return; }
      withMxContext(function (MxContext) {
        if (typeof MxContext !== 'function') { cb(null); return; }
        try {
          var ctx = new MxContext();
          objs.forEach(function (obj) {
            if (typeof ctx.setContext === 'function') ctx.setContext(obj.getEntity(), obj.getGuid());
            else if (typeof ctx.setTrackObject === 'function') ctx.setTrackObject(obj);
          });
          cb(ctx);
        } catch (e) { cb(null); }
      });
    }
    function runFlow(cmd, done) {
      loadObjectParams(cmd.objectParams, function (objs, err) {
        if (err) { done(false, err); return; }
        buildContext(objs, function (ctx) {
          // How a microflow/nanoflow gets its object parameter(s) turns on the
          // number of PARAMETERS, not the number of objects:
          //  - ONE object parameter — a single Object OR a List — is carried by
          //    applyto:'selection' + its guids (a list is simply more than one
          //    guid of the one parameter). This is Mendix's grid-selection
          //    mechanism and the case most client versions honour directly.
          //  - MORE THAN ONE parameter cannot go through a flat guids selection
          //    at all: Mendix maps at most one guid per entity type and drops
          //    the rest, so the earlier code (all guids in one selection) ran
          //    multi-parameter flows with empty parameters. The MxContext,
          //    setContext-per-object and matched to the parameters by entity
          //    type, is the only mechanism that reaches more than one — so
          //    require it, and fail honestly rather than supply only some.
          var objParamCount = (cmd.objectParams || []).filter(function (p) { return (p.guids || []).length; }).length;
          var params = { actionname: cmd.qualifiedName };
          if (objParamCount <= 1 && objs.length >= 1) { params.applyto = 'selection'; params.guids = objs.map(function (o) { return o.getGuid(); }); }
          if (objParamCount > 1 && !ctx) {
            done(false, 'Could not load MxContext on this client — more than one object parameter cannot be supplied here.');
            return;
          }
          // Plain-value inputs (String/Integer/Boolean/…). mx.data.action
          // carries these in its own `params.xasdata`-style bag keyed by
          // parameter name — the same shape the Mendix client itself uses
          // when a button passes a literal to a microflow.
          if (cmd.scalarParams && cmd.scalarParams.length) {
            var vals = {};
            cmd.scalarParams.forEach(function (p) { vals[p.name] = p.value; });
            params.applyto = params.applyto || 'none';
            params.arguments = vals;
          }
          mxAction({
            params: params, context: ctx,
            callback: function () { done(true); },
            error: function (e) { done(false, (e && e.message) || String(e)); }
          });
        });
      });
    }

    // ---------- LINKED mode ----------
    var running = true, badge = null;

    function post(url, payload) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    function showBadge(session) {
      badge = mk('div', 'position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;align-items:center;' +
        'gap:8px;background:' + P.panel + ';color:' + P.text + ';font:' + FONT + ';padding:8px 12px;' +
        'border:1px solid ' + P.border + ';border-left:3px solid ' + P.accent + ';border-radius:9px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.45);max-width:300px;');
      add(badge, logoMark());
      var txt = add(badge, mk('span', '', 'Connected as ' + (session.user || 'unknown') + (session.guest ? ' (guest)' : '')));
      var x = add(badge, mk('span', 'cursor:pointer;opacity:.6;padding-left:4px;', '✕'));
      x.addEventListener('click', teardown);
      document.body.appendChild(badge);
      badge.__txt = txt;
      return txt;
    }
    function setBadge(t) { if (badge && badge.__txt) badge.__txt.textContent = t; }

    // lookup/create report through the SAME channel a query's rows do — one
    // row (or none, on error) is exactly that shape already, whether it came
    // from an xpath page, a guid lookup, or a freshly created object.
    function reportOneRow(cmd, session, obj, err) {
      setBadge('Connected as ' + (session.user || 'unknown') + (session.guest ? ' (guest)' : ''));
      if (err) {
        var message = (err && err.message) || String(err);
        post(CFG.origin + '/api/session/data', {
          token: CFG.token, commandId: cmd.id, ok: false, message: message,
          data: { rows: [], offset: 0, amount: 1, total: 0, more: false, error: message }
        }).catch(function () {});
        finishOurNet();
        return;
      }
      var row = { id: attempt(function () { return obj.getGuid(); }) || null, cells: {} };
      (cmd.columns || []).forEach(function (c) { row.cells[c] = cellValue(obj, c); });
      row.writable = writableCells(obj, cmd.columns);
      post(CFG.origin + '/api/session/data', {
        token: CFG.token, commandId: cmd.id, ok: true, message: null,
        data: { rows: [row], offset: 0, amount: 1, total: 1, more: false, error: null }
      }).catch(function () {});
      finishOurNet();
    }

    function handleCommand(cmd, session) {
      // From here until the answer is posted, any /xas/ request is ours (see
      // ourNetBegin) — the tester's own page opens must not be charged for
      // the row MxScout is reading on their behalf.
      ourNetBegin();
      if (cmd.kind === 'query') {
        setBadge('Reading ' + cmd.qualifiedName + '…');
        // A linked query names its own entity; the columns and searchable
        // fields ride along with the command's target only in standalone mode,
        // so here they come from what MxScout asked for.
        var spec = {
          qualifiedName: cmd.qualifiedName,
          columns: cmd.columns || (TARGET && TARGET.columns) || [],
          searchAttrs: cmd.searchAttrs || (TARGET && TARGET.searchAttrs) || [],
          searchField: cmd.searchField || '',
          searchType: cmd.searchType || ''
        };
        queryPage(spec, cmd.search, cmd.offset || 0, cmd.amount || PAGE_SIZE, function (out) {
          setBadge('Connected as ' + (session.user || 'unknown') + (session.guest ? ' (guest)' : ''));
          post(CFG.origin + '/api/session/data', {
            token: CFG.token, commandId: cmd.id, ok: !out.error, message: out.error, data: out
          }).catch(function () {});
          finishOurNet();
        });
        return;
      }
      if (cmd.kind === 'lookup') {
        setBadge('Looking up ' + cmd.qualifiedName + ' ' + cmd.guid + '…');
        mxGet({
          guid: cmd.guid,
          callback: function (obj) { reportOneRow(cmd, session, obj, null); },
          error: function (err) { reportOneRow(cmd, session, null, err); }
        });
        return;
      }
      if (cmd.kind === 'create') {
        setBadge('Creating ' + cmd.qualifiedName + '…');
        try {
          mxCreate({
            entity: cmd.qualifiedName,
            callback: function (obj) {
              var values = cmd.values || {};
              Object.keys(values).forEach(function (k) {
                // An attribute name that doesn't exist on this entity (a
                // model gone stale, or a name that slipped past validation)
                // must not fail the WHOLE create — the object already exists
                // by this point, and skipping one bad field is honest; only
                // .commit() would need to be all-or-nothing, and this never
                // commits.
                try { obj.set(k, values[k]); } catch (e) { /* skip that one field */ }
              });
              reportOneRow(cmd, session, obj, null);
            },
            error: function (err) { reportOneRow(cmd, session, null, err); }
          });
        } catch (e) { reportOneRow(cmd, session, null, e); }
        return;
      }
      if (cmd.kind === 'observed') {
        // Report the guids seen passing through the app's own microflow
        // calls this session. Shaped as query rows so it rides the same data
        // channel and MxScout's existing table code renders it: the id is
        // the guid, and the cells carry the human-readable summary.
        var rows = observedGuidRows().map(function (o) {
          return { id: o.guid, cells: { seen: String(o.count), microflows: o.actions.join(', ') } };
        });
        post(CFG.origin + '/api/session/data', {
          token: CFG.token, commandId: cmd.id, ok: true, message: null,
          data: { rows: rows, offset: 0, amount: rows.length, total: rows.length, more: false, error: null }
        }).catch(function () {});
        finishOurNet();
        return;
      }
      setBadge('Running ' + cmd.qualifiedName + '…');
      runFlow(cmd, function (ok, message) {
        setBadge((ok ? 'Ran ' : 'Failed: ') + cmd.qualifiedName + (message ? (' — ' + message) : ''));
        post(CFG.origin + '/api/session/exec/result', {
          token: CFG.token, commandId: cmd.id, ok: ok, message: message || null
        }).catch(function () {});
        finishOurNet();
      });
    }

    // Long-poll: the server holds the request open until there is something to
    // do. Idle costs one open request instead of a request every second, and a
    // keystroke in MxScout's search box reaches this tab immediately instead
    // of on the next tick — which is the difference between a search box that
    // feels live and one that feels broken.
    function pollLoop(session) {
      if (!running) return;
      fetch(CFG.origin + '/api/session/exec/poll?wait=1&token=' + encodeURIComponent(CFG.token))
        .then(function (r) {
          // 403 means MxScout started a new session, so this snippet's token is
          // dead and no amount of retrying will revive it. Stop, and say why —
          // otherwise this loops against a closed door for as long as the tab
          // stays open.
          if (r.status === 403) {
            running = false;
            setBadge('This code is out of date — MxScout reconnected. Copy the new code from MxScout.');
            return null;
          }
          return r.json();
        })
        .then(function (data) { if (data && data.command) handleCommand(data.command, session); })
        .catch(function () { setBadge('Lost contact with MxScout — retrying…'); })
        .then(function () { if (running) setTimeout(function () { pollLoop(session); }, 150); });
    }

    // ---------- STANDALONE mode ----------
    // Everything below draws MxScout's entity panel inside the app page. It
    // shows ONE object and goes no further: no entity list, no links to
    // related entities, no model. A dead end is the correct shape for a
    // fallback — someone who wants to browse has MxScout open already.
    function renderStandalone(session) {
      clear(bodyBox);
      headTitle.textContent = TARGET ? TARGET.name : 'MxScout';
      var sub = add(bodyBox, mk('div', 'display:flex;gap:10px;align-items:baseline;margin:-4px 0 12px;'));
      add(sub, mk('code', 'font:' + MONO + ';color:' + P.muted + ';', TARGET ? TARGET.qualifiedName : ''));
      add(sub, mk('span', 'color:' + P.muted + ';', '· ' + (session.user || 'unknown user') + (session.guest ? ' (guest)' : '')));

      if (!TARGET) { note('Nothing was selected in MxScout, so there is nothing to show here.'); return; }
      if (TARGET.kind === 'flow') { renderFlowPanel(); return; }

      var tabsRow = add(bodyBox, mk('div', 'display:flex;gap:2px;border-bottom:1px solid ' + P.border + ';margin-bottom:12px;'));
      var pane = add(bodyBox, mk('div', ''));
      var tabs = [
        ['Attributes', renderAttributes],
        ['Constraints', renderConstraints],
        ['Data', renderData]
      ];
      var buttons = [];
      tabs.forEach(function (t, i) {
        var b = mk('button', 'font:' + FONT + ';background:none;border:0;border-bottom:2px solid transparent;' +
          'color:' + P.muted + ';padding:7px 12px;cursor:pointer;', t[0]);
        b.type = 'button';
        b.addEventListener('click', function () { select(i); });
        add(tabsRow, b);
        buttons.push(b);
      });
      function select(i) {
        buttons.forEach(function (b, j) {
          b.style.color = i === j ? P.text : P.muted;
          b.style.borderBottomColor = i === j ? P.accent : 'transparent';
        });
        clear(pane);
        tabs[i][1](pane);
      }
      select(0);
    }

    function kvList(host, rows) {
      var box = add(host, mk('div', 'display:grid;grid-template-columns:auto 1fr;gap:2px 18px;'));
      rows.forEach(function (r) {
        add(box, mk('div', 'color:' + P.text + ';', r[0]));
        add(box, mk('div', 'color:' + P.muted + ';font:' + MONO + ';', r[1]));
      });
    }

    function renderAttributes(host) {
      var attrs = TARGET.attributes || [];
      if (!attrs.length) { note('No attributes.'); return; }
      kvList(host, attrs.map(function (a) { return [a.name, a.type + (a.length ? ' (' + a.length + ')' : '')]; }));
    }

    function renderConstraints(host) {
      var rules = TARGET.rules || [];
      if (!rules.length) {
        add(host, mk('p', 'color:' + P.muted + ';margin:0;', 'No access rules apply to the selected role.'));
        return;
      }
      rules.forEach(function (r) {
        var card = add(host, mk('div', 'border:1px solid ' + P.border + ';border-radius:9px;padding:10px 12px;margin-bottom:8px;'));
        var head = add(card, mk('div', 'display:flex;gap:8px;align-items:baseline;'));
        add(head, mk('strong', '', r.moduleRole));
        add(head, mk('span', 'color:' + P.muted + ';', r.level === 'rw' ? 'Read + write' : 'Read only'));
        if (r.create) add(head, mk('span', 'color:' + P.muted + ';', '· Create'));
        if (r.del) add(head, mk('span', 'color:' + P.muted + ';', '· Delete'));
        if (r.xpath) {
          add(card, mk('div', 'color:' + P.muted + ';margin-top:6px;', 'Only rows matching this are visible:'));
          add(card, mk('code', 'display:block;font:' + MONO + ';color:' + P.text + ';background:' + P.panel2 +
            ';padding:6px 8px;border-radius:6px;margin-top:4px;overflow-x:auto;', r.xpath));
        }
      });
    }

    // The Data tab: ten rows, a real count, live search, paging. Same
    // behaviour as MxScout's own Data tab, because it is the same design —
    // only the renderer differs.
    function renderData(host) {
      var state = { offset: 0, search: '', busy: false, timer: null };

      var bar = add(host, mk('div', 'display:flex;gap:8px;align-items:center;margin-bottom:10px;'));
      var input = add(bar, mk('input', 'flex:1 1 240px;min-width:0;font:' + FONT + ';background:' + P.panel2 +
        ';color:' + P.text + ';border:1px solid ' + P.border + ';border-radius:7px;padding:6px 10px;'));
      input.type = 'search';
      input.placeholder = 'Search this entity…';
      var summary = add(bar, mk('span', 'color:' + P.muted + ';white-space:nowrap;', ''));

      var tableBox = add(host, mk('div', 'overflow-x:auto;border:1px solid ' + P.border + ';border-radius:9px;'));
      var pager = add(host, mk('div', 'display:flex;gap:8px;align-items:center;margin-top:10px;'));
      var prev = add(pager, btn('← Previous'));
      var next = add(pager, btn('Next →'));
      var pageInfo = add(pager, mk('span', 'color:' + P.muted + ';', ''));

      input.addEventListener('input', function () {
        clearTimeout(state.timer);
        state.timer = setTimeout(function () { state.search = input.value; state.offset = 0; load(); }, 220);
      });
      prev.addEventListener('click', function () { if (state.offset > 0) { state.offset = Math.max(0, state.offset - PAGE_SIZE); load(); } });
      next.addEventListener('click', function () { state.offset += PAGE_SIZE; load(); });

      function load() {
        if (state.busy) return;
        state.busy = true;
        summary.textContent = 'Counting…';
        queryPage(TARGET, state.search, state.offset, PAGE_SIZE, function (out) {
          state.busy = false;
          if (out.error) {
            clear(tableBox);
            add(tableBox, mk('p', 'color:' + P.alarm + ';padding:12px;margin:0;', out.error));
            summary.textContent = '';
            return;
          }
          drawTable(tableBox, out, TARGET);
          summary.textContent = describe(out);
          pageInfo.textContent = out.rows.length ? '' : 'Nothing on this page.';
          prev.disabled = state.offset === 0;
          prev.style.opacity = state.offset === 0 ? '.45' : '1';
          var atEnd = !out.more;
          next.disabled = atEnd;
          next.style.opacity = atEnd ? '.45' : '1';
        });
      }
      function describe(out) {
        if (!out.rows.length) return state.search ? 'No matches.' : 'No rows visible to this session.';
        var from = out.offset + 1, to = out.offset + out.rows.length;
        if (out.total != null) return from + '–' + to + ' of ' + out.total;
        return from + '–' + to + (out.more ? '+' : '');
      }
      load();
    }

    function drawTable(host, out, spec) {
      clear(host);
      if (!out.rows.length) {
        add(host, mk('p', 'color:' + P.muted + ';padding:12px;margin:0;', 'Nothing to show.'));
        return;
      }
      var cols = ['id'].concat(spec.columns || []);
      var table = add(host, mk('table', 'border-collapse:collapse;width:100%;font:' + MONO + ';'));
      var thead = add(table, mk('thead', ''));
      var hr = add(thead, mk('tr', ''));
      cols.forEach(function (c) {
        add(hr, mk('th', 'text-align:left;padding:7px 10px;white-space:nowrap;color:' + P.muted +
          ';border-bottom:1px solid ' + P.border + ';font-weight:600;', c));
      });
      var tbody = add(table, mk('tbody', ''));
      var anyWritable = false;
      out.rows.forEach(function (row) {
        var tr = add(tbody, mk('tr', ''));
        cols.forEach(function (c) {
          var v = c === 'id' ? row.id : row.cells[c];
          // Green marks a value this session may write on THIS row — see
          // writableCells: the answer is the runtime's, per object, because a
          // rule's XPath decides which rows it covers.
          var writable = c !== 'id' && row.writable && row.writable[c] === true;
          if (writable) anyWritable = true;
          var td = add(tr, mk('td', 'padding:6px 10px;border-bottom:1px solid ' + P.border +
            ';max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            (writable ? 'background:rgba(70,180,92,0.12);color:' + WRITE_TEXT + ';'
                      : 'color:' + (v == null ? P.muted : P.text) + ';'), v == null ? '—' : v));
          if (v != null) td.title = String(v);
        });
      });
      if (anyWritable) {
        var legend = add(host, mk('div', 'display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:' + P.muted + ';'));
        add(legend, mk('span', 'display:inline-block;width:10px;height:10px;border-radius:3px;background:rgba(70,180,92,0.35);border:1px solid ' + WRITE_LINE + ';'));
        add(legend, mk('span', '', 'Green: this session may write that value on that row.'));
      }
    }

    // A flow snippet in standalone mode: pick an id from the parameter
    // entity's rows, then run. Same table, same colours; the only extra is the
    // confirm, which is not optional.
    function renderFlowPanel() {
      var picked = { guid: null };
      add(bodyBox, mk('p', 'margin:0 0 10px;color:' + P.muted + ';',
        'MxScout could not be reached from this page, so this runs here instead. ' +
        'Nothing is sent anywhere — it runs in this tab, as you.'));

      var pick = TARGET.pickEntity;
      var runBtn;
      if (pick) {
        add(bodyBox, mk('div', 'font-weight:650;margin:8px 0 6px;', 'Pick a ' + pick.name + ' for ' + TARGET.paramName));
        var box = add(bodyBox, mk('div', 'overflow-x:auto;border:1px solid ' + P.border + ';border-radius:9px;'));
        queryPage(pick, '', 0, PAGE_SIZE, function (out) {
          clear(box);
          if (out.error || !out.rows.length) {
            add(box, mk('p', 'color:' + P.muted + ';padding:12px;margin:0;', out.error || 'No rows visible to this session.'));
            return;
          }
          out.rows.forEach(function (row) {
            var line = add(box, mk('div', 'display:flex;gap:10px;align-items:center;padding:7px 10px;cursor:pointer;' +
              'border-bottom:1px solid ' + P.border + ';font:' + MONO + ';'));
            line.className = 'mxs-pick-row';
            add(line, mk('span', 'color:' + P.accent + ';', row.id));
            add(line, mk('span', 'color:' + P.muted + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
              (pick.columns || []).map(function (c) { return row.cells[c]; }).filter(Boolean).join('  ·  ')));
            line.addEventListener('click', function () {
              picked.guid = row.id;
              Array.prototype.forEach.call(box.children, function (n) { n.style.background = 'transparent'; });
              line.style.background = P.panel2;
              runBtn.disabled = false;
              runBtn.style.opacity = '1';
            });
          });
        });
      }

      var actions = add(bodyBox, mk('div', 'display:flex;gap:8px;align-items:center;margin-top:14px;'));
      runBtn = add(actions, btn('Run ' + TARGET.name, 'danger'));
      var status = add(actions, mk('span', 'color:' + P.muted + ';', ''));
      if (pick) { runBtn.disabled = true; runBtn.style.opacity = '.45'; }
      runBtn.addEventListener('click', function () {
        if (!confirm('Run ' + TARGET.qualifiedName + ' now?\n\nThis really runs in this app, as you. If it writes, deletes or sends something, that happens for real.')) return;
        status.textContent = 'Running…';
        runFlow({
          kind: TARGET.flowKind,
          qualifiedName: TARGET.qualifiedName,
          objectParams: picked.guid ? [{ name: TARGET.paramName, guids: [picked.guid] }] : []
        }, function (ok, message) {
          status.textContent = (ok ? '✓ Done' : '✕ Failed') + (message ? (' — ' + message) : '');
          status.style.color = ok ? '#6fbf73' : P.alarm;
        });
      });
    }

    // ---------- boot ----------
    mountShell();
    var sEnv = step('Checking this environment');
    var sSession = step('Reading your Mendix session');
    var sLink = step('Reaching MxScout on ' + CFG.origin.replace(/^https?:\/\//, ''));

    sEnv.ok('Environment allowed — ' + location.hostname);
    sSession.run();
    var session = readSession();
    sSession.ok('Signed in as ' + (session.user || 'unknown') + (session.guest ? ' — anonymous/guest session' : ''));
    // Start watching the app's own microflow calls from here — whichever
    // mode we end up in, LINKED or STANDALONE, the wrapper is read-only and
    // costs nothing until MxScout (or the standalone panel) asks what it saw.
    installActionObserver();
    sLink.run();

    // A rejected fetch() gives no reason — browsers deliberately hide WHY, so
    // a genuine CSP block, an unreachable host, a CORS mismatch and a bad
    // response status all land in the same .catch() and used to all be
    // reported as "this app blocks the connection", even when the real
    // reason was something else entirely (most often: MxScout and this app
    // are on different machines — 127.0.0.1 does not cross into a VM). A CSP
    // connect-src violation DOES fire its own event, though, and that one IS
    // specific — so it decides which message below is actually true.
    // Nothing else in this snippet's boot sequence makes a network request
    // before this point (readSession() only calls local mx.session.*
    // methods), so any connect-src violation that fires while this fetch is
    // in flight can only be about this fetch — no need to match blockedURI,
    // whose exact format (with/without port, trailing slash) isn't reliable
    // across browsers.
    var cspBlockedOrigin = false;
    function onCspViolation(e) {
      if (e && e.violatedDirective && e.violatedDirective.indexOf('connect-src') === 0) cspBlockedOrigin = true;
    }
    document.addEventListener('securitypolicyviolation', onCspViolation);

    fetch(CFG.origin + '/api/session/ping?token=' + encodeURIComponent(CFG.token))
      .then(function (r) {
        if (r.ok) return r.json();
        // A response DID come back — this reached MxScout, and MxScout said
        // no. Most often a stale token: this exact code was generated for
        // an earlier session that a page reload (or a second MxScout tab —
        // there is only ever one active session) already replaced. That is
        // a completely different problem from "unreachable" or "blocked",
        // and MxScout's own answer already says so in words; read it rather
        // than translating a real diagnosis into "bad status".
        return r.json().catch(function () { return null; }).then(function (body) {
          var err = new Error((body && body.error) || ('MxScout answered with HTTP ' + r.status + '.'));
          err.reachedMxScout = true;
          throw err;
        });
      })
      .then(function () {
        document.removeEventListener('securitypolicyviolation', onCspViolation);
        sLink.ok('Connected to MxScout');
        note('You can go back to the MxScout window now. Leave this tab open — it answers MxScout’s requests. Nothing runs unless you ask for it there.');
        var go = add(bodyBox, mk('div', 'margin-top:14px;'));
        var b = add(go, btn('Got it', 'primary'));
        b.addEventListener('click', function () {
          if (shell && shell.__back && shell.__back.parentNode) shell.__back.parentNode.removeChild(shell.__back);
          shell = null;
          showBadge(session);
        });
        pollLoop(session);
      })
      .catch(function (err) {
        // The browser dispatches securitypolicyviolation as its own task,
        // which can run AFTER this promise's microtask — so a genuine CSP
        // block might not have set cspBlockedOrigin yet at this exact
        // instant. A macrotask's worth of delay (setTimeout 0) lets it land
        // first; the user never perceives it.
        setTimeout(function () {
          document.removeEventListener('securitypolicyviolation', onCspViolation);
          if (err && err.reachedMxScout) {
            sLink.fail('MxScout refused this connection');
            note(err.message + ' Paste a freshly-copied code from MxScout’s Data or Run tab to fix this. ' +
              'Everything happens here instead — in this tab, in your own session.', P.text);
          } else if (cspBlockedOrigin) {
            sLink.fail('This app blocks the connection to MxScout');
            note('The app’s security policy (CSP) will not let this page talk to MxScout, so nothing can be sent back. ' +
              'Everything happens here instead — in this tab, in your own session.', P.text);
          } else {
            sLink.fail('Could not reach MxScout at ' + CFG.origin);
            note('That is usually not a security policy — this page could not reach that address at all. The most common cause: MxScout and this app are not on the same machine (a loopback address like 127.0.0.1 never reaches out of a VM or a different device). Check that MxScout is running, and that this app and the MxScout window are on the same computer. Everything happens here instead — in this tab, in your own session.', P.text);
          }
          var go = add(bodyBox, mk('div', 'margin-top:14px;'));
          var b = add(go, btn(TARGET ? ('Open ' + TARGET.name + ' here') : 'Continue', 'primary'));
          b.addEventListener('click', function () { renderStandalone(session); });
        }, 0);
      });
  }

  function buildScript(cfg) {
    return '(' + bridgeBody.toString() + ')(' + JSON.stringify(cfg) + ');';
  }

  window.MxBridge = { buildScript: buildScript, bridgeBody: bridgeBody };
})();
