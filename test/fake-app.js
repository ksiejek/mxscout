// A stand-in Mendix app on loopback: enough mx.* surface for the bridge to be
// exercised for real, plus a /xas/ that answers retrieve_by_xpath with a count.
'use strict';
const http = require('http');
const PORT = Number(process.env.FAKE_PORT) || 4501;

const ROWS = [];
for (let i = 1; i <= 253; i++) {
  ROWS.push({ id: String(1000 + i), Number: 'ORD-' + String(i).padStart(4, '0'), Customer: (i % 3 === 0 ? 'Acme' : (i % 3 === 1 ? 'Globex' : 'Initech')) + ' ' + i, Total: String(i * 7.5) });
}
// A second entity with different fields, so a test can catch a page of rows
// coming back with the wrong entity's columns.
const SETTINGS = [
  { id: '9001', Key: 'retention.days', Value: '30' },
  { id: '9002', Key: 'mail.from', Value: 'noreply@example.com' }
];

function matches(xpath) {
  if (/Admin\.Setting/.test(xpath || '')) return SETTINGS;
  const m = /contains\(\w+,'([^']*)'\)/.exec(xpath || '');
  const idm = /id = '(\d+)'/.exec(xpath || '');
  if (!m && !idm) return ROWS;
  const term = m ? m[1].toLowerCase() : null;
  return ROWS.filter((r) => (term && (r.Number.toLowerCase().includes(term) || r.Customer.toLowerCase().includes(term))) || (idm && r.id === idm[1]));
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>Fake Mendix</title><body><h1>Fake app</h1><script>
window.__ranFlows = [];
// The tracked objects of the MxContext each flow ran with (or null). More than
// one object parameter can only be carried through the context, so a test
// asserts here that a multi-parameter flow's objects actually reached it —
// instead of being flattened into one guids selection that Mendix would drop.
window.__ranContexts = [];
// Attribute values set on an object via obj.set() — the bridge applies a
// flow's "override attribute values" here before running it, so a test can
// confirm those values reached the object the flow was handed.
window.__objectSets = {};
// A minimal MxContext, the mechanism the bridge uses to hand a flow more than
// one object: setContext is called once per object, and the flow binds each
// parameter to the tracked object of the matching entity type.
function MxContextStub(){ this.__tracked = []; }
MxContextStub.prototype.setContext = function(entity, guid){ this.__tracked.push({ entity: entity, guid: guid }); };
function mkObj(r, entity){ return {
  getGuid: function(){ return r.id; },
  getEntity: function(){ return entity || 'Sales.Order'; },
  get: function(k){ return r[k]; },
  set: function(k, v){ r[k] = v; (window.__objectSets[r.id] = window.__objectSets[r.id] || {})[k] = v; return this; },
  // What a real Mendix client answers once the runtime has applied this
  // session's access rules to the object it returned. Deliberately NOT the
  // same answer for every row of a column: Total is never writable, Customer
  // always is, and Number only on the rows an Acme constraint would cover —
  // which is the whole point of asking per object rather than per column.
  isReadonlyAttr: function(k){
    if (k === 'Total') return true;
    if (k === 'Customer') return false;
    if (k === 'Number') return !/^Acme/.test(r.Customer || '');
    return true;
  },
  isObjectReadOnly: function(){ return false; }
}; }

// A minimal stand-in for a non-persistable entity: Mendix keeps these in the
// session server-side (not just in this tab's memory), which is exactly why
// a real one is reachable by guid later — this fake just keeps them in a
// plain object instead, close enough to exercise the same client contract
// (mx.data.create / mx.data.get({guid})) MxScout's bridge actually calls.
window.__transient = {};
window.__nextTransientId = 5000;
function mkTransientObj(guid, entity, fields) {
  return {
    getGuid: function () { return guid; },
    getEntity: function () { return entity; },
    get: function (k) { return fields[k]; },
    set: function (k, v) { fields[k] = v; return this; },
    // A transient object the session just made: everything on it is writable.
    isReadonlyAttr: function () { return false; },
    isObjectReadOnly: function () { return false; }
  };
}

window.mx = {
  session: { getUserName: function(){ return 'tester'; }, isGuest: function(){ return false; }, getConfig: function(k){ return k === 'csrftoken' ? 'CSRF123' : null; } },
  data: {
    get: function (o) {
      if (o.guid) {
        var t = window.__transient[o.guid];
        if (t) { setTimeout(function () { o.callback(mkTransientObj(o.guid, t.entity, t.fields)); }, 5); return; }
        fetch('/fake/byid?id=' + o.guid).then(function(r){return r.json();}).then(function(rows){ rows.length ? o.callback(mkObj(rows[0], rows[0].__entity)) : o.error(new Error('no such object')); });
        return;
      }
      var ent = (/\\/\\/([\\w.]+)/.exec(o.xpath || '') || [])[1];
      fetch('/fake/rows?xpath=' + encodeURIComponent(o.xpath) + '&offset=' + o.filter.offset + '&amount=' + o.filter.amount)
        .then(function(r){ return r.json(); })
        .then(function(rows){ o.callback(rows.map(function(r){ return mkObj(r, ent); })); })
        .catch(function(e){ o.error(e); });
    },
    create: function (o) {
      var guid = String(window.__nextTransientId++);
      var fields = {};
      window.__transient[guid] = { entity: o.entity, fields: fields };
      setTimeout(function () { o.callback(mkTransientObj(guid, o.entity, fields)); }, 5);
    },
    action: function (o) { window.__ranFlows.push(o.params); window.__ranContexts.push((o.context && o.context.__tracked) || null); setTimeout(function(){ o.callback && o.callback(); }, (o.params && o.params.__delay) || 10); }
  },
  ui: { openForm: function (n, o) { window.__ranFlows.push({ page: n }); window.__ranContexts.push((o && o.context && o.context.__tracked) || null); o && o.callback && o.callback(); } },
  lib: { MxContext: MxContextStub }
};
// Lets a test play "the app's own logic ran a microflow" — the bridge's
// passive observer wraps mx.data.action, so a call made here shows up in
// what MxScout can later ask it about (kind:'observed').
window.__appFireMicroflow = function (actionname, guids, delay) {
  window.mx.data.action({ params: { actionname: actionname, applyto: 'selection', guids: guids, __delay: delay || 10 }, callback: function () {} });
};
</script></body>`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/xas/') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p = {};
      try { p = JSON.parse(body).params || {}; } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mxobjects: [], count: matches(p.xpath).length }));
    });
    return;
  }
  if (u.pathname === '/fake/rows') {
    const all = matches(u.searchParams.get('xpath'));
    const off = Number(u.searchParams.get('offset')) || 0;
    const amt = Number(u.searchParams.get('amount')) || 10;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(all.slice(off, off + amt)));
    return;
  }
  if (u.pathname === '/fake/byid') {
    // Look an object up by id across both entities, tagging the second with its
    // entity so the client can report the right getEntity() — a multi-object
    // flow's context is matched to parameters by entity type.
    const byId = ROWS.concat(SETTINGS.map((s) => Object.assign({ __entity: 'Admin.Setting' }, s)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(byId.filter((r) => r.id === u.searchParams.get('id'))));
    return;
  }
  const headers = { 'Content-Type': 'text/html; charset=utf-8' };
  // ?csp=1 serves the page the way a locked-down corporate Mendix app does:
  // connect-src 'self' means the pasted bridge genuinely cannot reach MxScout,
  // which is the case the standalone fallback exists for.
  if (u.searchParams.get('csp') === '1') {
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'self' 'unsafe-inline'";
  }
  res.writeHead(200, headers);
  res.end(PAGE);
}).listen(PORT, '127.0.0.1', () => console.log('fake app on', PORT));

// A second, independent listener on this same process, standing in for a
// Mendix Runtime's admin port (see ROADMAP step 46). A DIFFERENT port on
// loopback is the whole point: that is where MxScout's server dials, and the
// only place it can. The password is fixed and known to the test file — there
// is no real secret to protect in a fixture.
const ADMIN_PORT = Number(process.env.FAKE_ADMIN_PORT) || 4502;
const ADMIN_PASSWORD = 'test-admin-pass';
const ADMIN_AUTH = Buffer.from(ADMIN_PASSWORD, 'utf8').toString('base64');
let requestPolls = 0;
let statsPolls = 0;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.headers['x-m2ee-authentication'] !== ADMIN_AUTH) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'wrong password' }));
        return;
      }
      let action = null;
      try { action = JSON.parse(body).action; } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // The m2ee admin API answers in an ENVELOPE — { feedback, result } —
      // never with the payload on its own. This fixture used to return the
      // payload bare, which is exactly why MxScout shipped a recorder that
      // stored `{feedback, result}` as if it were the map of live requests:
      // the fixture agreed with the mistake. Corrected 2026-09-07 from a real
      // sample Karol pasted back off his own runtime. The Microflow frame's
      // qualified name below was `'Module.Flow'` until 2026-09-08, guessed
      // before any real sample showed a nested call — a real one confirmed
      // the field is `name` (with `type: 'Microflow'`), so the fixture and
      // public/perf.js's frameQualifiedName() were both wrong the same way.
      // Reshaped the same day into two REAL frames instead of three guessed
      // ones: `current_activity` is never its own array entry in a real
      // sample, it is an object living ON the Microflow frame it describes —
      // and action_stack[0] is the currently-executing LEAF (the retrieve),
      // the Microflow its outermost caller, confirmed by the same sample.
      if (action === 'get_current_runtime_requests') {
        // Every other poll, a sub-microflow is on the stack — the fixture's
        // stand-in for a loop calling the same thing over and over, which is
        // what real recordings are full of (2026-09-09: one reported
        // iteration 4312 of 6889). Without a call that comes and goes there
        // is nothing for the flame chart's clustering to cluster, and the
        // rule that a block either carries its own name or merges until it
        // can would go untested.
        requestPolls++;
        const stack = [
          { xpath: "//Sales.Order[Number = 'X']" },
          { current_activity: { caption: 'Retrieving' }, name: 'Sales.CancelOrder', type: 'Microflow' }
        ];
        if (requestPolls % 2 === 0) {
          stack.unshift({ current_activity: { caption: 'Calculate line total' }, name: 'Sales.CalcLine', type: 'Microflow' });
        }
        res.end(JSON.stringify({
          feedback: {
            'req-1': { request_duration: 120, type: 'CLIENT', user: 'tester', action_stack: stack }
          },
          result: 0
        }));
        return;
      }
      if (action === 'runtime_statistics') {
        statsPolls++;
        // Trimmed from the same real sample: the blocks a later step will
        // actually read (connectionbus counters, heap, the per-handler
        // request counters), not an invented placeholder.
        res.end(JSON.stringify({
          feedback: {
            note: 'fixture-stats',
            entities: 277,
            // Counters, not gauges: every one of these is cumulative for the
            // runtime's whole life, so a fixture that returns the same number
            // every poll makes every delta zero and hides whatever reads
            // them. They move here the way a real runtime's do.
            connectionbus: {
              select: 18448 + statsPolls * 7, insert: 269 + statsPolls,
              update: 196, delete: 116, transaction: 17960 + statsPolls * 2
            },
            // Trimmed from the real sample, INCLUDING a non-heap pool: a real
            // runtime reports Metaspace and three CodeHeaps in the same array
            // as the G1 generations, 160 MB of them, and adding those to the
            // heap would draw a number that is not the heap. committed_heap is
            // the ceiling worth charting — max_heap was 16 GB, which is why a
            // chart scaled to it drew a flat line along the bottom.
            memory: {
              used_heap: 250601160, max_heap: 17037262848, committed_heap: 419430400,
              memorypools: [
                { name: 'Metaspace', is_heap: false, usage: 122929504, index: 1 },
                { name: 'G1 Eden Space', is_heap: true, usage: 25165824, index: 4 },
                { name: 'G1 Old Gen', is_heap: true, usage: 104771584, index: 5 },
                { name: 'G1 Survivor Space', is_heap: true, usage: 14680064, index: 6 }
              ]
            },
            // Trimmed from the same real sample as the rest of this block.
            // `named_users` is the number of user ACCOUNTS in the database —
            // that runtime reported 3736 of them with exactly one browser
            // connected — so it is kept far apart from `user_sessions`, which
            // is what "how many sessions are open" actually means.
            sessions: {
              named_users: 3736,
              named_user_sessions: 0,
              anonymous_sessions: 0,
              user_sessions: { '23080948090286843': ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0'] }
            },
            // A real runtime reported a `debugger/` handler that MOVED during
            // both recordings Karol captured — worth surfacing, because a
            // debugger attached during a measurement changes what is being
            // measured. `rest/` sits still, so the reader can tell a handler
            // that did nothing from one that did.
            requests: [
              { name: 'xas/', value: 60 + statsPolls * 2, last_request_timestamp: 1788792710715 },
              { name: 'debugger/', value: 21 + statsPolls, last_request_timestamp: 1788792710700 },
              { name: 'rest/', value: 0, last_request_timestamp: 1788792700000 }
            ]
          },
          result: 0
        }));
        return;
      }
      res.end(JSON.stringify({ feedback: {}, result: 0 }));
    });
    return;
  }
  // A GET (the bridge script navigates here to get a document to run in, same
  // as a browser opening the real admin port) — a blank page is honest: the
  // real admin port serves nothing meant to be looked at either.
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>fake admin port</title>');
}).listen(ADMIN_PORT, '127.0.0.1', () => console.log('fake admin port on', ADMIN_PORT));
