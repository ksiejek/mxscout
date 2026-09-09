/* Performance recording (ROADMAP step 46) — the server's own admin-port
 * connection, and the record button that drives it from the app tab.
 *
 * The shape, after Karol's two corrections on 2026-09-07: MxScout's server
 * connects to the Mendix Runtime's admin port itself (no script is ever
 * pasted on the admin port), the address is a URL like every other address in
 * MxScout, and starting/finishing a recording happens on the badge already
 * sitting in the app's own tab — because that is where the tester is while
 * they exercise the app.
 *
 * The server's outbound connection is a deliberate break of an invariant this
 * project wrote on its own About page, so the limits that keep it narrow are
 * tested directly against server/admin-port.js rather than only through the
 * UI: the non-production guard, and the two-action allowlist. Those are the
 * assertions that matter most in this file.
 *
 * test/fake-app.js listens on a SECOND port (t.ADMIN) standing in for the
 * admin port, on loopback, exactly where a real one sits. PowerShell's only
 * remaining job (reading M2EE_ADMIN_PASS out of the runtime process's memory)
 * is unchanged and still verified only by Karol against a real Mendix
 * runtime — buildPasswordScript's TEXT is checked here, never run. */
'use strict';
const MODEL = require('./model');
const adminApi = require('../server/admin-port');

// Must match test/fake-app.js's fixture — there is no real secret to protect
// in a fixture, so it is simply shared knowledge between the two files.
const ADMIN_PASSWORD = 'test-admin-pass';

module.exports = async function (t) {
  const json = async (url, opts) => (await fetch(url, opts)).json();
  const post = (path, body) => fetch(t.MX + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const adminPortNumber = Number(new URL(t.ADMIN).port);

  // ---------- the limits, tested on the module that enforces them ----------
  t.ok(adminApi.isAllowedHost('localhost') && adminApi.isAllowedHost('127.0.0.1') &&
       adminApi.isAllowedHost('build-test.example.com') && adminApi.isAllowedHost('acc.internal'),
    'local and clearly non-production hosts are allowed');
  t.ok(!adminApi.isAllowedHost('app.mendixcloud.com') && !adminApi.isAllowedHost('customer.example.com') &&
       !adminApi.isAllowedHost(''),
    'a production-looking host is refused by the server\'s own copy of the guard, not just the UI\'s');
  t.ok(adminApi.ALLOWED_ACTIONS.size === 2 &&
       adminApi.ALLOWED_ACTIONS.has('get_current_runtime_requests') &&
       adminApi.ALLOWED_ACTIONS.has('runtime_statistics'),
    'exactly two read-only admin actions are permitted');
  t.ok(await adminApi.invoke('127.0.0.1', adminPortNumber, ADMIN_PASSWORD, 'shutdown') === null,
    'an action outside the allowlist is refused before any socket is opened, even against a port that would answer it');
  const statsAnswer = await adminApi.invoke('127.0.0.1', adminPortNumber, ADMIN_PASSWORD, 'runtime_statistics');
  t.ok(statsAnswer !== null,
    'an allowlisted action against the same port does answer — so the refusal above is the allowlist, not a broken call');

  // The m2ee admin API answers { feedback, result }, never the payload alone.
  // Storing the envelope as if it WERE the payload is the bug that made a
  // real recording draw two long grey bars called "feedback" and "result"
  // (2026-09-07), so the unwrapping is asserted on both sides: what invoke()
  // hands back, and what the reader does with a recording already saved wrong.
  t.ok(statsAnswer && statsAnswer.connectionbus && !('feedback' in statsAnswer) && !('result' in statsAnswer),
    'the m2ee envelope is unwrapped at the edge — callers see the answer, not { feedback, result }: ' + JSON.stringify(Object.keys(statsAnswer || {})));
  t.ok(adminApi.unwrap({ feedback: { a: 1 }, result: 0 }).a === 1, 'unwrap takes the feedback out of a successful envelope');
  t.ok(adminApi.unwrap({ feedback: { a: 1 }, result: 3 }) === null, 'a non-zero result is a failure, not an answer');
  t.ok(adminApi.unwrap({ 'req-1': {} })['req-1'] !== undefined,
    'a body with no envelope is passed through rather than dropped — this shape came off one runtime version, not a spec');

  // ---------- the protocol, without a browser ----------
  const idle = await json(t.MX + '/api/session/perf/status');
  t.ok(idle.connected === false && idle.active === false && idle.sampleCount === 0,
    'status starts disconnected, idle, with nothing collected: ' + JSON.stringify(idle));

  t.ok((await post('/api/session/perf/start')).status === 409,
    'starting a recording with no admin port connected is refused, rather than recording nothing');

  // Each of the four ways connecting really fails has to be named, because
  // each needs a different thing done about it.
  const blocked = await post('/api/session/perf/connect', { url: 'http://app.mendixcloud.com:8090', password: ADMIN_PASSWORD });
  t.ok((await blocked.json()).reason === 'blocked',
    'a production-looking address is refused before any connection is attempted');

  const wrongPass = await post('/api/session/perf/connect', { url: t.ADMIN, password: 'wrong-' + ADMIN_PASSWORD });
  t.ok((await wrongPass.json()).reason === 'password', 'a wrong password is reported as a wrong password');
  t.ok((await json(t.MX + '/api/session/perf/status')).connected === false,
    'a password that did not work is never kept');

  const notAdmin = await post('/api/session/perf/connect', { url: t.APP, password: ADMIN_PASSWORD });
  t.ok((await notAdmin.json()).reason === 'not-admin-port',
    'a port that answers something other than the admin API is told apart from a dead one');

  const dead = await post('/api/session/perf/connect', { url: 'http://127.0.0.1:1', password: ADMIN_PASSWORD });
  t.ok((await dead.json()).reason === 'unreachable', 'an address with nothing listening is reported as unreachable');

  const ok = await post('/api/session/perf/connect', { url: t.ADMIN, password: ADMIN_PASSWORD });
  const okBody = await ok.json();
  t.ok(ok.status === 200 && okBody.port === adminPortNumber,
    'connecting answers what it connected to: ' + JSON.stringify(okBody));

  const connected = await json(t.MX + '/api/session/perf/status');
  t.ok(connected.connected === true && connected.active === false, 'status reports the connection, still idle');
  t.ok(JSON.stringify(connected).indexOf(ADMIN_PASSWORD) === -1,
    'the status route never echoes the password back: ' + JSON.stringify(connected));

  // The app tab's own two endpoints — cross-origin, token-gated, same as the
  // exec bridge beside them.
  const s = await json(t.MX + '/api/session/start', { method: 'POST' });
  t.ok((await fetch(t.MX + '/api/session/perf/poll?token=nope')).status === 403,
    'the app tab\'s perf poll refuses a wrong token');
  const badge = await json(t.MX + '/api/session/perf/poll?token=' + s.token);
  t.ok(badge.connected === true && badge.active === false,
    'the app tab is told an admin port is connected, so it may offer a record button: ' + JSON.stringify(badge));
  t.ok(badge.sampleCount === 0 && !('host' in badge),
    'and is told nothing it does not need — no address, no password');

  await post('/api/session/perf/request', { token: s.token, active: true });
  await new Promise((r) => setTimeout(r, 400));
  const recording = await json(t.MX + '/api/session/perf/status');
  t.ok(recording.active === true && recording.sampleCount > 0,
    'the app tab can start a recording, and the SERVER does the sampling: ' + JSON.stringify(recording));

  await post('/api/session/perf/request', { token: s.token, active: false });
  const halted = await json(t.MX + '/api/session/perf/status');
  t.ok(halted.active === false && halted.sampleCount > 0,
    'a stop from the app tab halts sampling but leaves the samples for MxScout to save: ' + JSON.stringify(halted));

  const stopped = await json(t.MX + '/api/session/perf/stop', { method: 'POST' });
  t.ok(stopped.samples.length > 0 && stopped.samples[0].requests['req-1'],
    'and MxScout collects what the admin port actually reported');
  t.ok(typeof stopped.samples[0].t === 'number' && stopped.samples[0].t >= 0,
    'each sample is stamped with ms since the recording began');
  t.ok(stopped.samples[0].stats && stopped.samples[0].stats.note === 'fixture-stats',
    'the second, not-yet-parsed statistics block rides along in every sample');
  t.ok(!('feedback' in stopped.samples[0].requests) && !('feedback' in stopped.samples[0].stats),
    'and neither block is stored as the raw envelope');

  const afterStop = await json(t.MX + '/api/session/perf/status');
  t.ok(afterStop.active === false && afterStop.sampleCount === 0, 'stopping clears the buffer');
  t.ok(afterStop.connected === true, 'stopping a recording does not drop the connection — the next Start needs no password');

  await new Promise((r) => setTimeout(r, 200));
  t.ok((await json(t.MX + '/api/session/perf/status')).sampleCount === 0,
    'no samples accumulate once recording has stopped');

  await post('/api/session/perf/disconnect');
  const gone = await json(t.MX + '/api/session/perf/status');
  t.ok(gone.connected === false && gone.port === null,
    'disconnecting forgets the connection, which is the only way the password leaves memory');
  t.ok((await post('/api/session/perf/start')).status === 409, 'and recording is refused again afterwards');
  t.ok((await json(t.MX + '/api/session/perf/poll?token=' + s.token)).connected === false,
    'and the app tab stops offering a record button');

  // ---------- the password-reveal script (text only — never run here) ----------
  const mxProbe = await t.tab(t.MX);
  await mxProbe.waitFor('!!window.MxPerf', 15000, 'MxScout loaded');
  t.ok(await mxProbe.evaluate('typeof window.MxAdminBridge === "undefined"'),
    'nothing is ever pasted on the admin port any more — that bridge is gone from the app entirely');
  const script = await mxProbe.evaluate(`(function () {
    var custom = MxPerf.buildPasswordScript({ adminPort: 9999 });
    var def = MxPerf.buildPasswordScript({});
    return {
      hasPort: custom.indexOf('$Port = 9999') !== -1,
      hasDefaultPort: def.indexOf('$Port = 8090') !== -1,
      mentionsPassEnvVar: custom.indexOf('M2EE_ADMIN_PASS') !== -1,
      neverPolls: custom.indexOf('X-M2EE-Authentication') === -1 && custom.indexOf('Invoke-RestMethod') === -1
    };
  })()`);
  t.ok(script.hasPort, 'a custom admin port is substituted into the password-reveal script');
  t.ok(script.hasDefaultPort, 'no config given falls back to the documented default (8090)');
  t.ok(script.mentionsPassEnvVar, 'the script reads M2EE_ADMIN_PASS — readable, not obscured');
  t.ok(script.neverPolls, 'this script only reveals the password — it never calls the admin API itself');
  await mxProbe.close();

  // ---------- the browser: three steps, then record from the app tab ----------
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxPerf', 15000, 'MxScout loaded');

  // ---------- buildSpans: the orientation question ROADMAP step 46 was
  // blocked on. Confirmed 2026-09-08 against a real nested sample from
  // Karol's own runtime: action_stack[0] is the frame CURRENTLY EXECUTING,
  // and the array runs inward-to-outward — so depth 0 (the root span) is the
  // LAST array index, not the first. A fixture recording with the same
  // three-frame stack in two adjacent samples should fold into exactly three
  // spans, one per depth, with depth 0 landing on the xpath frame at the end
  // of the array and depth 2 (the leaf) on the bare activity frame at the
  // start — the opposite of array order.
  const spans = await mx.evaluate(`window.MxPerf.buildSpans({
    intervalMs: 50,
    samples: [
      { t: 0, requests: { r1: { action_stack: [
        { current_activity: 'Retrieving' },
        { name: 'Sales.CancelOrder', type: 'Microflow' },
        { xpath: "//Sales.Order[Number = 'X']" }
      ] } } },
      { t: 50, requests: { r1: { action_stack: [
        { current_activity: 'Retrieving' },
        { name: 'Sales.CancelOrder', type: 'Microflow' },
        { xpath: "//Sales.Order[Number = 'X']" }
      ] } } }
    ]
  }, 'r1')`);
  t.ok(spans.length === 3, 'the same identity at each depth across two adjacent samples folds into one span each: ' + JSON.stringify(spans));
  const byDepth = {};
  spans.forEach((s) => { byDepth[s.depth] = s; });
  t.ok(byDepth[0] && byDepth[0].kind === 'xpath' && /Sales\.Order/.test(byDepth[0].xpath || ''),
    'depth 0, the root, is the LAST array entry — the xpath frame: ' + JSON.stringify(byDepth[0]));
  t.ok(byDepth[1] && byDepth[1].kind === 'flow' && byDepth[1].name === 'Sales.CancelOrder',
    'depth 1 is the microflow frame in the middle: ' + JSON.stringify(byDepth[1]));
  t.ok(byDepth[2] && byDepth[2].kind === 'activity' && byDepth[2].t0 === 0 && byDepth[2].t1 === 100,
    'depth 2, the leaf, is the FIRST array entry, spanning both samples plus one interval: ' + JSON.stringify(byDepth[2]));

  // ---------- Phase 2c: buildCallTree / hotFlows / hotXpaths / slowestRequests
  // Two requests call the same root microflow (should merge into one call-tree
  // row with calls:2); within the first, the same retrieve appears, drops out
  // for one sample, then comes back (two separate spans of the same identity —
  // should still merge into one Hotspots row with calls:2, since Hotspots
  // groups by the thing itself, not by tree position).
  const XPATH = "//Sales.Order[Number = 'X']";
  const treeRecording = {
    intervalMs: 50,
    samples: [
      { t: 0, requests: { r1: { request_duration: 10, action_stack: [{ xpath: XPATH }, { name: 'Sales.CancelOrder', type: 'Microflow' }] } } },
      { t: 50, requests: { r1: { request_duration: 60, action_stack: [{ name: 'Sales.CancelOrder', type: 'Microflow' }] } } },
      { t: 100, requests: { r1: { request_duration: 150, action_stack: [{ xpath: XPATH }, { name: 'Sales.CancelOrder', type: 'Microflow' }] } } },
      { t: 150, requests: { r2: { request_duration: 50, action_stack: [{ name: 'Sales.CancelOrder', type: 'Microflow' }] } } }
    ]
  };
  const tree = await mx.evaluate(`window.MxPerf.buildCallTree(${JSON.stringify(treeRecording)})`);
  t.ok(tree.roots.length === 1 && tree.roots[0].name === 'Sales.CancelOrder' && tree.roots[0].calls === 2,
    'the same root microflow from two different requests merges into one call-tree row: ' + JSON.stringify(tree.roots));
  t.ok(tree.roots[0].children.length === 1 && tree.roots[0].children[0].calls === 2,
    'the same retrieve reopening after a gap is two spans, but one merged call-tree row: ' + JSON.stringify(tree.roots[0].children));

  const flows = await mx.evaluate(`window.MxPerf.hotFlows(${JSON.stringify(treeRecording)})`);
  t.ok(flows.length === 1 && flows[0].calls === 2 && flows[0].total === 200 && flows[0].max === 150,
    'hotFlows sums both requests\' root spans, and "max call" is the single longest one, not the sum: ' + JSON.stringify(flows));

  const xpaths = await mx.evaluate(`window.MxPerf.hotXpaths(${JSON.stringify(treeRecording)})`);
  t.ok(xpaths.length === 1 && xpaths[0].calls === 2 && xpaths[0].totalMs === 100,
    'hotXpaths merges the two reopened spans of the same query into one row: ' + JSON.stringify(xpaths));

  const slowest = await mx.evaluate(`window.MxPerf.slowestRequests(${JSON.stringify(treeRecording)})`);
  t.ok(slowest.length === 2 && slowest[0].id === 'r1' && slowest[0].maxDuration === 150,
    'slowestRequests sorts by the runtime\'s own reported duration: ' + JSON.stringify(slowest));

  // ---------- Phase 2d: the `stats` block (runtime_statistics), parsed now
  // that a real one has been seen (ROADMAP step 46). connectionbus counters
  // are cumulative for the runtime's whole life, so connectionbusSeries has
  // to turn them into per-interval deltas, not report them raw.
  const statsRecording = {
    intervalMs: 250,
    samples: [
      { t: 0, requests: {}, stats: { memory: { used_heap: 100, max_heap: 1000 }, connectionbus: { select: 10, insert: 0, update: 0, delete: 0, transaction: 5 }, sessions: { named_users: 2, anonymous_sessions: 1 } } },
      { t: 250, requests: {}, stats: { memory: { used_heap: 150, max_heap: 1000 }, connectionbus: { select: 15, insert: 1, update: 0, delete: 0, transaction: 6 }, sessions: { named_users: 3, anonymous_sessions: 0 } } },
      { t: 500, requests: {}, stats: { memory: { used_heap: 120, max_heap: 1000 }, connectionbus: { select: 20, insert: 1, update: 2, delete: 0, transaction: 6 }, sessions: { named_users: 3, anonymous_sessions: 0 } } }
    ]
  };
  const mem = await mx.evaluate(`window.MxPerf.memorySeries(${JSON.stringify(statsRecording)})`);
  t.ok(mem.length === 3 && mem[1].used === 150 && mem[1].max === 1000,
    'memorySeries is one point per sample that carried a heap reading: ' + JSON.stringify(mem));

  const cb = await mx.evaluate(`window.MxPerf.connectionbusSeries(${JSON.stringify(statsRecording)})`);
  t.ok(cb.length === 2 && cb[0].total === 7 && cb[1].total === 7,
    'connectionbusSeries turns the cumulative counters into per-interval deltas, skipping the first point: ' + JSON.stringify(cb));
  t.ok(cb[0].select === 5 && cb[1].select === 5 && cb[1].update === 2,
    'and keeps the operations apart — "4007 operations" is not a verdict, "3900 of them selects" is: ' + JSON.stringify(cb));

  // ---------- heap by pool (Phase 2f) ----------
  // memorypools carries NON-heap pools in the same array as the G1
  // generations. A real 2026-09-09 sample had 160 MB of Metaspace and
  // CodeHeaps in there; counting those as heap draws a number that is not the
  // heap, so is_heap has to be honoured.
  const poolRecording = {
    intervalMs: 250,
    samples: [
      { t: 0, requests: {}, stats: { memory: { used_heap: 300, committed_heap: 1000, max_heap: 99999, memorypools: [
        { name: 'Metaspace', is_heap: false, usage: 5000 },
        { name: 'G1 Eden Space', is_heap: true, usage: 200 },
        { name: 'G1 Old Gen', is_heap: true, usage: 80 },
        { name: 'G1 Survivor Space', is_heap: true, usage: 20 }
      ] } } },
      { t: 250, requests: {}, stats: { memory: { used_heap: 400, committed_heap: 1000, max_heap: 99999, memorypools: [
        { name: 'Metaspace', is_heap: false, usage: 5000 },
        { name: 'G1 Eden Space', is_heap: true, usage: 300 },
        { name: 'G1 Old Gen', is_heap: true, usage: 80 },
        { name: 'G1 Survivor Space', is_heap: true, usage: 20 }
      ] } } },
      { t: 500, requests: {}, stats: { memory: { used_heap: 120, committed_heap: 1000, max_heap: 99999, memorypools: [
        { name: 'Metaspace', is_heap: false, usage: 5000 },
        { name: 'G1 Eden Space', is_heap: true, usage: 10 },
        { name: 'G1 Old Gen', is_heap: true, usage: 100 },
        { name: 'G1 Survivor Space', is_heap: true, usage: 10 }
      ] } } }
    ]
  };
  const pools = await mx.evaluate(`window.MxPerf.poolSeries(${JSON.stringify(poolRecording)})`);
  t.ok(pools.length === 3 && pools[0].eden === 200 && pools[0].old === 80 && pools[0].survivor === 20,
    'poolSeries splits the heap into the pools that ARE the heap: ' + JSON.stringify(pools[0]));
  t.ok(pools[0].old !== 5080 && pools.every(function (p) { return p.old < 200; }),
    'and leaves Metaspace and the CodeHeaps out of it, however large they are');
  t.ok(pools[0].committed === 1000,
    'committed_heap comes through as the ceiling worth charting, next to the 16 GB max nobody can read a chart against');

  const gcs = await mx.evaluate(`window.MxPerf.gcMarks(${JSON.stringify(poolRecording)})`);
  t.ok(gcs.length === 1 && gcs[0] === 500,
    'gcMarks is where used heap DROPPED — an inference, since the admin API reports no collections: ' + JSON.stringify(gcs));

  const sessionsNow = await mx.evaluate(`window.MxPerf.sessionsNow(${JSON.stringify(statsRecording)})`);
  t.ok(sessionsNow && sessionsNow.named_users === 3 && sessionsNow.anonymous_sessions === 0,
    'sessionsNow is the LAST sample that reported sessions, not a history: ' + JSON.stringify(sessionsNow));

  // ---------- the cadence the sampler ACHIEVED, not the one it asked for.
  // Two real recordings off a live runtime (2026-09-09) claimed intervalMs 50
  // and landed 62-63 ms apart, because a round is two HTTP round trips to the
  // admin port. Every duration here is samples x interval, so trusting the
  // claim understated every one of them by about a fifth.
  const laggingRecording = {
    intervalMs: 50,
    samples: [{ t: 0 }, { t: 62 }, { t: 124 }, { t: 186 }, { t: 400 }, { t: 462 }].map((s) => ({ t: s.t, requests: {} }))
  };
  const observed = await mx.evaluate(`window.MxPerf.observedIntervalMs(${JSON.stringify(laggingRecording)})`);
  t.ok(observed === 62,
    'observedIntervalMs is the MEDIAN real gap, so one stalled round does not stretch every duration: ' + observed);
  const claimed = await mx.evaluate(`window.MxPerf.observedIntervalMs({ intervalMs: 50, samples: [{ t: 0 }, { t: 50 }] })`);
  t.ok(claimed === 50, 'with too few samples to measure, it falls back to what the recorder asked for: ' + claimed);

  // ---------- "Where the time went" counts time VISIBLE in the recording.
  // `request_duration` is the runtime's own counter since the request began:
  // a real recording had a CUSTOM request reporting 321747 ms inside a 7810 ms
  // recording, and summing those made every share on the card meaningless.
  const preexistingRecording = {
    intervalMs: 100,
    samples: [
      { t: 0, requests: { old: { request_duration: 900000, action_stack: [{ name: 'Sales.LongJob', type: 'Microflow' }] } } },
      { t: 100, requests: {
        old: { request_duration: 900100, action_stack: [{ name: 'Sales.LongJob', type: 'Microflow' }] },
        fresh: { request_duration: 50, action_stack: [{ name: 'Sales.Quick', type: 'Microflow' }] }
      } }
    ]
  };
  const totals = await mx.evaluate(`window.MxPerf.entryTotals(${JSON.stringify(preexistingRecording)})`);
  t.ok(totals.total === 300 && totals.list[0].name === 'Sales.LongJob' && totals.list[0].ms === 200,
    'entryTotals counts the time a request was visible, not the runtime counter it arrived with: ' + JSON.stringify(totals));
  t.ok(totals.list[0].share === 67,
    'so a job that started long before Start is a share of THIS recording, not of its own lifetime: ' + totals.list[0].share + '%');

  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: ${JSON.stringify(t.APP)} },
      ${JSON.stringify(MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.chip, .flow-card, .entity-card')`, 8000, 'project open');

  function clickSection(label) {
    return `Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === ${JSON.stringify(label)})[0].click()`;
  }
  function clickButton(label) {
    return `Array.from(document.querySelectorAll('button')).filter(function (b) { return b.textContent.trim() === ${JSON.stringify(label)}; })[0].click()`;
  }

  await mx.evaluate(clickSection('Performance'));
  await mx.waitFor(`document.querySelectorAll('.perf-step').length === 3`, 8000, 'all three setup steps are on screen at once');
  const stepStates = await mx.evaluate(`Array.from(document.querySelectorAll('.perf-step')).map(function (s) { return s.className; }).join(' | ')`);
  t.ok(/is-current/.test(stepStates) && (stepStates.match(/is-todo/g) || []).length === 2,
    'exactly one step is open and the rest are waiting: ' + stepStates);

  // Step 1 — the admin port, as a URL.
  await mx.evaluate(`(function(){
    var i = document.querySelector('.live-url-input');
    i.value = ${JSON.stringify(t.ADMIN)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    ${clickButton('Continue')};
    return true; })()`);
  await mx.waitFor(`!!document.querySelector('input[type=password]')`, 8000, 'step 2 opens');
  t.ok(await mx.evaluate(`(function(){ var d = document.querySelector('.perf-step.is-done'); return !!d && d.textContent.indexOf(${JSON.stringify(t.ADMIN)}) !== -1; })()`),
    'and step 1 collapses to one line carrying the address it produced');

  // Step 2 — the password. Connect verifies it before anything says connected.
  await mx.evaluate(`(function(){
    var i = document.querySelector('input[type=password]');
    i.value = ${JSON.stringify(ADMIN_PASSWORD)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    ${clickButton('Connect')};
    return true; })()`);
  await mx.waitFor(`(function(){ var s = document.querySelectorAll('.perf-step.is-done'); return s.length === 2; })()`,
    10000, 'the admin port connects, and step 3 becomes the open one');

  // Step 3 — the app tab. The snippet offered here must be the LIVE APP one,
  // not a second bridge of the recorder's own.
  const bridgeScript = await mx.waitFor(`(function(){ var s = document.querySelector('.scan-script'); return s && s.value; })()`, 8000, 'the app snippet is offered');
  t.ok(bridgeScript.indexOf('MxScout') !== -1 && bridgeScript.indexOf(ADMIN_PASSWORD) === -1,
    'the app snippet carries no admin password — the server holds it, and this code never needs it');

  const app = await t.tab(t.APP);
  // The snippet's own first act is to check for mx.data and bail if it is not
  // there, so pasting before the app page has defined it is a no-op that
  // looks exactly like a hang. cdp.js waits for the page to finish loading
  // now, but the precondition is stated here too, because THIS is the line
  // that depends on it.
  await app.waitFor(`typeof mx !== 'undefined' && !!mx.data && typeof mx.data.get === 'function'`,
    10000, 'the app page to define mx.data, which the snippet refuses to run without');
  await app.evaluate('(function(){ ' + bridgeScript + ' return true; })()');

  // Diagnosed rather than merely waited for. This step used to be a bare
  // waitFor, and when it failed — intermittently, for weeks — all it said was
  // "timeout", which is the one thing already known. The same lesson as the
  // "always 0 samples" bug: silence has to be reported, so on failure this
  // says which side went quiet. The snippet's own token is probed against a
  // token-gated endpoint, because a snippet carrying a token the server has
  // already replaced is invisible in every other symptom.
  const snippetToken = (bridgeScript.match(/token\s*:\s*"([^"]+)"/) || [])[1] || null;
  const connectDiag = await (async () => {
    const deadline = Date.now() + 12000;
    let last = null;
    while (Date.now() < deadline) {
      if (await mx.evaluate(`!!document.querySelector('.live-status-ok')`)) return { ok: true };
      last = {
        exec: await json(t.MX + '/api/session/exec'),
        tokenAccepted: snippetToken
          ? (await fetch(t.MX + '/api/session/perf/poll?token=' + encodeURIComponent(snippetToken))).status === 200
          : 'no token found in snippet',
        badgeInApp: await app.evaluate(`!!Array.from(document.querySelectorAll('div')).find(function (d) { return /Connected as/.test(d.textContent) && d.children.length < 8; })`),
        pageThinks: await mx.evaluate(`window.MxLive.connected()`),
        scriptOnScreen: await mx.evaluate(`(function(){
          var s = document.querySelector('.scan-script');
          return s ? (s.value.match(/token\\s*:\\s*"([^"]+)"/) || [])[1] || 'no token' : 'no snippet on screen';
        })()`)
      };
      await new Promise((r) => setTimeout(r, 500));
    }
    return { ok: false, last: last };
  })();
  t.ok(connectDiag.ok,
    'MxScout sees the app tab connect, and setup is done' +
    (connectDiag.ok ? '' : ' — it did not: ' + JSON.stringify(connectDiag.last)));
  if (!connectDiag.ok) throw new Error('cannot continue without a connected app tab');

  // The snippet's own connect panel collapses into the corner badge when the
  // tester dismisses it — that badge is what carries the record button.
  await app.waitFor(`!!Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent === 'Got it'; })`,
    10000, 'the app tab reports it connected');
  await app.evaluate(`Array.from(document.querySelectorAll('button')).filter(function (b) { return b.textContent === 'Got it'; })[0].click()`);

  // The record button appears on the APP tab's badge, because an admin port
  // is connected. This is the whole point of the change.
  await app.waitFor(`!!Array.from(document.querySelectorAll('span')).find(function (n) { return n.textContent === '⏺'; })`,
    10000, 'a record button appears on the badge in the app tab');

  // The record dot is red BEFORE it is pressed, not only while it runs —
  // that is the one symbol on this badge that has to read without a label.
  t.ok(await app.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('span')).find(function (n) { return n.textContent === '⏺'; });
    return n && n.style.color;
  })()`) !== '', 'the record dot carries a colour of its own before anything is recording');

  await app.evaluate(`Array.from(document.querySelectorAll('span')).filter(function (n) { return n.textContent === '⏺'; })[0].click()`);
  // Elapsed time, not a sample count: standing in the app tab clicking through
  // a scenario, "how long have I been at this" is the question being asked.
  await app.waitFor(`!!Array.from(document.querySelectorAll('span')).find(function (n) { return /^Recording… \\d+:\\d\\d$/.test(n.textContent); })`,
    10000, 'the badge counts the recording in elapsed time, not in samples');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Finish recording')`,
    10000, 'MxScout\'s own window follows the same state');
  t.ok(await mx.evaluate(`(function(){
    var s = document.querySelector('.live-status-recording');
    return !!s && /Recording… \\d+:\\d\\d/.test(s.textContent);
  })()`), 'and counts it the same way, in the same words');

  await new Promise((r) => setTimeout(r, 400));
  await app.evaluate(`Array.from(document.querySelectorAll('span')).filter(function (n) { return n.textContent === '⏹'; })[0].click()`);

  // Stopping from the app tab has to save the recording, which only MxScout's
  // page can do — it notices the stop and finishes it as if Finish had been
  // pressed here.
  await mx.waitFor(`!!document.querySelector('.perf-analyzer-head')`, 12000,
    'stopping from the app tab saves the recording and opens the analyzer in MxScout');
  await mx.waitFor(`!!document.querySelector('.stat-row')`, 5000, 'the Overview tab shows its stat tiles');

  // The Runtime card, off the SAME `stats` block fake-app.js's admin port
  // already answers with (real shape, trimmed — see its own comment) —
  // proves memorySeries actually reaches the page, not just the pure
  // function tested above.
  const runtimeCardText = await mx.evaluate(`(function(){
    var h = Array.from(document.querySelectorAll('h3')).find(function (n) { return n.textContent === 'Runtime, while this ran'; });
    return h ? h.closest('.card').textContent : null;
  })()`);
  t.ok(runtimeCardText && /peak heap/.test(runtimeCardText), 'the Runtime card rendered with a peak heap tile: ' + runtimeCardText);

  // Every tile says what its number is measured AGAINST. "239 MB" is not
  // something anyone can act on; "239 MB of the 400 MB this runtime has
  // committed" is. The time series that used to sit here moved to the
  // Timeline's tracks, where they share its ruler.
  t.ok(/of 400\.0 MB committed/.test(runtimeCardText),
    'the heap tile reads against committed heap, with the 16 GB max as an aside');
  t.ok(/selects per request/.test(runtimeCardText) && /counted, not measured/.test(runtimeCardText),
    'the one tile that is a verdict on its own is there, and admits it is a ratio rather than a measurement');
  t.ok(!/Heap used, over the recording/.test(runtimeCardText),
    'and the scaleless sparklines are gone from this card — the Timeline owns the time axis now');
  t.ok(/debugger\//.test(runtimeCardText),
    'handlers that moved are listed, debugger/ among them — a debugger attached during a measurement changes what is measured');
  // named_users is how many ACCOUNTS exist, not how many sessions are open:
  // the fixture reports 3736 of them behind a single connected browser, the
  // same way the real runtime did.
  t.ok(/1open sessions/.test(runtimeCardText) && /3736 user accounts exist/.test(runtimeCardText),
    'the sessions tile counts open sessions, and keeps the account count as the aside it is');

  await app.close();

  // Switch to Timeline to reach the bars + flame chart. The live fixture's
  // action_stack is flat (no nested sub-microflow — see the buildSpans
  // assertion above for that), so its two frames become two one-sample-wide
  // spans: the microflow at the root and its retrieve as the leaf.
  await mx.evaluate(clickButton('Timeline'));
  await mx.waitFor(`document.querySelectorAll('.perf-bar').length === 1`, 8000, 'the one request rendered as a bar');
  await mx.evaluate(`document.querySelector('.perf-bar').click()`);
  await mx.waitFor(`document.querySelectorAll('.flame').length >= 2`, 5000, 'the flame shows both levels of the fixture stack');
  const flames = await mx.evaluate(`Array.from(document.querySelectorAll('.flame')).map(function (f) {
    return { text: f.textContent, kind: Array.from(f.classList).filter(function (c) { return c.indexOf('kind-') === 0; })[0] };
  })`);
  t.ok(flames.some(function (f) { return f.text === 'Sales.CancelOrder' && f.kind === 'kind-flow'; }),
    'the microflow frame is its own flow-kind span: ' + JSON.stringify(flames));
  t.ok(flames.some(function (f) { return f.kind === 'kind-xpath' && /Sales\.Order/.test(f.text); }),
    'the retrieve frame is its own xpath-kind span: ' + JSON.stringify(flames));

  // ---------- the time axis (Phase 2f) ----------
  // Zoom is pixels per second, so stretching has to make the canvas WIDER
  // than the panel and hand the browser a scrollbar — that is the whole ask,
  // and "fit to the panel" is what made a short action unclickable.
  // ---------- the module boundary (Phase 2g) ----------
  // The time axis and everything drawn on it is its own topic, in its own
  // file, reached through one named object and handed exactly what it needs
  // through init() — the same shape as every other module here. Written
  // BEFORE the split, because the four moves during the app.js split all
  // looked clean in the diff and twice left the app on a blank screen; each
  // time a test caught it and the review did not (CLAUDE.md).
  const surface = await mx.evaluate(`window.MxTimeline ? Object.keys(window.MxTimeline).sort() : null`);
  t.ok(surface && surface.join(',') === 'init,render,reset,tickStep',
    'the timeline is one named surface, not a grab bag: ' + JSON.stringify(surface));
  t.ok(await mx.evaluate(`typeof window.MxPerf.tickStep`) === 'undefined',
    'and perf.js no longer carries the drawing code it handed over');

  const ladder = await mx.evaluate(`[window.MxTimeline.tickStep(1), window.MxTimeline.tickStep(100), window.MxTimeline.tickStep(400), window.MxTimeline.tickStep(100000)]`);
  t.ok(ladder[0] === 60000 && ladder[3] === 10 && ladder[1] > ladder[2],
    'tickStep walks a ladder of steps a person reads without arithmetic, coarse when zoomed out: ' + JSON.stringify(ladder));

  const fitted = await mx.evaluate(`(function(){
    var sc = document.querySelector('.tl-scroll');
    return { scrollW: sc.scrollWidth, clientW: sc.clientWidth };
  })()`);
  t.ok(fitted.scrollW <= fitted.clientW + 2,
    'it opens fitted to the panel, with nothing to scroll yet: ' + JSON.stringify(fitted));

  await mx.evaluate(`Array.from(document.querySelectorAll('.tl-zoom-btn')).filter(function (b) { return b.textContent === '+'; })[0].click()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.tl-zoom-btn')).filter(function (b) { return b.textContent === '+'; })[0].click()`);
  const stretched = await mx.waitFor(`(function(){
    var sc = document.querySelector('.tl-scroll');
    return sc.scrollWidth > sc.clientWidth + 20 ? { scrollW: sc.scrollWidth, clientW: sc.clientWidth } : null;
  })()`, 5000, 'stretching makes the timeline longer than the panel, and a scrollbar appears');
  t.ok(stretched.scrollW > stretched.clientW, 'the canvas really is wider than what shows: ' + JSON.stringify(stretched));

  // The zoom survives the app's own render(), which rebuilds the whole panel:
  // a level held only in the DOM would snap back to the start on every click.
  const beforeScale = await mx.evaluate(`document.querySelector('.tl-scale').textContent`);
  await mx.evaluate(clickButton('Call tree'));
  await mx.waitFor(`!!document.querySelector('.tree-row, .data-table')`, 5000, 'over to Call tree and back');
  await mx.evaluate(clickButton('Timeline'));
  await mx.waitFor(`!!document.querySelector('.tl-scale')`, 5000, 'Timeline again');
  t.ok(await mx.evaluate(`document.querySelector('.tl-scale').textContent`) === beforeScale,
    'and the zoom level is where it was left: ' + beforeScale);

  await mx.evaluate(clickButton('Fit'));
  await new Promise((r) => setTimeout(r, 400));
  const refit = await mx.evaluate(`(function(){
    var sc = document.querySelector('.tl-scroll');
    return { scrollW: sc.scrollWidth, clientW: sc.clientWidth, canvasW: document.querySelector('.tl-canvas').style.width, scale: document.querySelector('.tl-scale').textContent };
  })()`);
  t.ok(refit.scrollW <= refit.clientW + 2,
    'Fit puts the whole recording back inside the panel: ' + JSON.stringify(refit));

  // ---------- the runtime tracks (Phase 2f) ----------
  // Heap and database live UNDER the requests on the SAME axis: "the heap
  // stepped" is a fact about the runtime, "it stepped under this microflow" is
  // a finding, and the second was impossible while the charts had their own
  // card and their own unlabelled x-axis.
  const trackNames = await mx.evaluate(`Array.from(document.querySelectorAll('.tl-name b')).map(function (n) { return n.textContent; })`);
  t.ok(trackNames.join(',') === 'Time,Requests,Heap,Database,Call stack',
    'the runtime rides the same ruler as the requests, between them and the call stack: ' + JSON.stringify(trackNames));
  const heapRead = await mx.evaluate(`(function(){
    var names = Array.from(document.querySelectorAll('.tl-name'));
    var cell = names.filter(function (n) { return n.querySelector('b').textContent === 'Heap'; })[0];
    return cell.querySelector('.tl-read').textContent;
  })()`);
  t.ok(/of 400\.0 MB$/.test(heapRead),
    'and the heap reads against committed, not against a 16 GB max no chart can be drawn to: ' + heapRead);

  // ---------- what a bar says (Phase 2f) ----------
  // The request bar carries its own name and the request type as a word;
  // colour is the module, the same identity channel the rest of MxScout uses.
  const barLabel = await mx.evaluate(`(function(){
    var b = document.querySelector('.perf-bar');
    return { text: b.textContent, mod: b.style.getPropertyValue('--mod'), hasChip: !!b.querySelector('.tl-type') };
  })()`);
  t.ok(/Sales\.CancelOrder/.test(barLabel.text) && barLabel.hasChip && /^hsl\(/.test(barLabel.mod),
    'the request bar says what it is, in its module colour, with the type as a word: ' + JSON.stringify(barLabel));

  // A label rides the VISIBLE edge of its bar, so a call that began before
  // the viewport still says its own name instead of scrolling out of reach.
  await mx.evaluate(`Array.from(document.querySelectorAll('.tl-zoom-btn')).filter(function (b) { return b.textContent === '+'; })[0].click()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.tl-zoom-btn')).filter(function (b) { return b.textContent === '+'; })[0].click()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.tl-zoom-btn')).filter(function (b) { return b.textContent === '+'; })[0].click()`);
  await new Promise((r) => setTimeout(r, 300));
  const stuck = await mx.evaluate(`(function(){
    var sc = document.querySelector('.tl-scroll');
    sc.scrollLeft = Math.round(sc.scrollWidth / 2);
    sc.dispatchEvent(new Event('scroll'));
    return new Promise(function (resolve) {
      setTimeout(function () {
        var bar = document.querySelector('.perf-bar');
        var lbl = bar.firstChild;
        resolve({ barLeft: parseFloat(bar.style.left), labelOffset: parseFloat(lbl.style.left || '0'), scrollLeft: sc.scrollLeft, shown: lbl.style.display !== 'none' });
      }, 120);
    });
  })()`);
  t.ok(stuck.shown && Math.abs((stuck.barLeft + stuck.labelOffset) - stuck.scrollLeft) < 3,
    'the label sits at the left edge of what is on screen, not at the left edge of the bar: ' + JSON.stringify(stuck));

  // A repeated sub-microflow (the fixture's loop) collapses into one block
  // carrying a count, rather than a row of slivers too narrow to name — and
  // stretching splits it back apart.
  await mx.evaluate(clickButton('Fit'));
  await new Promise((r) => setTimeout(r, 300));
  const collapsed = await mx.evaluate(`(function(){
    var c = document.querySelectorAll('.flame.is-cluster');
    return { clusters: c.length, text: c.length ? c[0].textContent : null, blocks: document.querySelectorAll('.flame').length };
  })()`);
  t.ok(collapsed.clusters > 0 && /×\d+/.test(collapsed.text || ''),
    'calls too narrow to name merge into one block that names them and counts them: ' + JSON.stringify(collapsed));
  await mx.evaluate(`document.querySelector('.perf-bar').click()`);
  await mx.waitFor(`document.querySelectorAll('.flame').length >= 2`, 5000, 'and the flame is still there after all that');

  // Pick the microflow span. Picking selects it and opens the detail panel
  // below — a separate step from resolving it, unlike the old flat list
  // where the frame itself was the link.
  await mx.evaluate(`Array.from(document.querySelectorAll('.flame')).filter(function (f) { return f.textContent === 'Sales.CancelOrder'; })[0].click()`);
  await mx.waitFor(`!!document.querySelector('.perf-detail .perf-nums')`, 5000, 'the span detail opens');

  // ---------- what the detail panel says (Phase 2f) ----------
  // Chips first, so "what am I looking at" is answered before a number is
  // read; then self against what it called, as one bar, which is the only
  // question a caller has and was a line in a flat list nobody compared.
  const detail = await mx.evaluate(`(function(){
    var d = document.querySelector('.perf-detail');
    return {
      chips: Array.from(d.querySelectorAll('.perf-chip')).map(function (c) { return c.textContent; }),
      nums: Array.from(d.querySelectorAll('.perf-num span')).map(function (n) { return n.textContent; }),
      split: !!d.querySelector('.perf-split-self'),
      mod: (d.querySelector('.perf-chip.is-mod') || {}).textContent || null,
      actions: Array.from(d.querySelectorAll('.perf-detail-actions button')).map(function (b) { return b.textContent; })
    };
  })()`);
  t.ok(detail.chips.indexOf('Microflow') !== -1 && detail.mod === 'Sales',
    'the panel leads with what it is and which module it belongs to: ' + JSON.stringify(detail.chips));
  t.ok(detail.split && detail.nums.join(',') === 'Started,Finished,Wall,Self,Samples',
    'self against what it called is a bar, and the numbers are a row rather than a list: ' + JSON.stringify(detail.nums));
  t.ok(detail.actions.some(function (a) { return /^Open Sales\.CancelOrder in the model$/.test(a); }) &&
       detail.actions.indexOf('Stretch to this call') !== -1 &&
       detail.actions.some(function (a) { return /finding/i.test(a); }),
    'and it can reach the model, the zoom and a finding from here: ' + JSON.stringify(detail.actions));

  await mx.evaluate(`Array.from(document.querySelectorAll('.perf-detail-actions button')).filter(function (b) { return /in the model$/.test(b.textContent); })[0].click()`);
  await mx.waitFor(`!!document.querySelector('.modal-detail')`, 5000, 'flow popup opened');
  t.ok(/CancelOrder/.test(await mx.evaluate(`document.querySelector('.modal-detail').textContent`)),
    'clicking through jumps to that microflow, via the same jumpToObject the palette uses');

  await mx.evaluate(`(function(){ document.querySelector('.modal-backdrop') && document.querySelector('.modal-backdrop').click(); })()`);
  await mx.evaluate(clickSection('Performance'));
  await mx.waitFor(`!!document.querySelector('.perf-analyzer-head')`, 8000, 'back on the analyzer');

  // Call tree — the fixture's stack is the retrieve, its microflow, and the
  // sub-microflow that comes and goes with the loop, so every call the flame
  // clustered above is one row here with a count. This proves the tree really
  // renders off buildCallTree rather than only being exercised as a bare data
  // structure above.
  await mx.evaluate(clickButton('Call tree'));
  await mx.waitFor(`document.querySelectorAll('.data-table tbody tr').length >= 2`, 8000, 'the fixture stack becomes a tree: the microflow, its retrieve, and the looped sub-microflow');
  const treeNames = await mx.evaluate(`Array.from(document.querySelectorAll('.tname')).map(function (n) { return n.textContent; })`);
  t.ok(treeNames.indexOf('Sales.CancelOrder') !== -1, 'the microflow is a row in the rendered tree: ' + JSON.stringify(treeNames));
  t.ok(treeNames.indexOf('Sales.CalcLine') !== -1,
    'and the sub-microflow the loop kept calling is one row, not one per call: ' + JSON.stringify(treeNames));

  // Hotspots — same fixture, now ranked. The microflow row's "Add as a
  // finding" button goes through the SAME comments.js editor every other
  // object in MxScout uses, not a perf-specific one.
  await mx.evaluate(clickButton('Hotspots'));
  await mx.waitFor(`!!document.querySelector('.link-btn')`, 8000, 'the Microflows table resolved a row to the real model');
  const xpathCell = await mx.evaluate(`(function(){
    var cell = Array.from(document.querySelectorAll('.data-table td.wide')).find(function (td) { return td.textContent.indexOf('//') === 0; });
    return cell ? cell.textContent : null;
  })()`);
  t.ok(xpathCell && /Sales\.Order/.test(xpathCell), 'the Retrieves table shows the query text: ' + xpathCell);
  await mx.evaluate(`Array.from(document.querySelectorAll('.row-act button')).find(function (b) { return b.textContent === 'Add as a finding'; }).click()`);
  await mx.waitFor(`!!document.querySelector('.editor')`, 5000, 'the finding editor opened from a Hotspots row');
  t.ok(/CancelOrder/.test(await mx.evaluate(`document.querySelector('.editor').textContent`)),
    'and it is editing a finding against that same microflow, via comments.js — not a second finding system');
  await mx.evaluate(`document.querySelector('.editor-head button').click()`);
  await mx.evaluate(clickSection('Performance'));
  await mx.waitFor(`!!document.querySelector('.perf-analyzer-head')`, 8000, 'back on the analyzer, finding editor dismissed');

  await mx.evaluate(clickButton('← Recordings'));
  await mx.waitFor(`document.querySelectorAll('.rec-card').length === 1`, 8000, 'back on the dashboard');

  // The card no longer carries a "Heaviest:" line. Karol, on two real
  // recordings: the name is usually a framework flow nobody went looking for,
  // and the percentage was a share of request_duration — the runtime's counter
  // since the request began, which can predate the recording entirely.
  t.ok(!/Heaviest/.test(await mx.evaluate(`document.querySelector('.rec-card').textContent`)),
    'the recording card leads with the sparkline, not with a "heaviest" name that identifies nothing');

  // Import is on the dashboard whether or not there is anything listed: being
  // sent a recording, with no admin port of your own, is exactly the case
  // where the grid would be empty.
  t.ok(await mx.evaluate(`(function(){
    var h = document.querySelector('.rec-head');
    return !!h && !!Array.from(h.querySelectorAll('button')).find(function (b) { return b.textContent === 'Import…'; });
  })()`), 'a recording exported from another machine can be imported back here');

  await mx.evaluate(clickButton('Disconnect'));
  await mx.waitFor(`document.querySelectorAll('.perf-step').length === 3`, 8000, 'Disconnect drops back to the three setup steps');
  t.ok((await json(t.MX + '/api/session/perf/status')).connected === false,
    'and the server really did forget the password');

  await mx.close();
};
