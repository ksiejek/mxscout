#!/usr/bin/env node
/* The runner. Brings up MxScout and the stand-in Mendix app, runs every
 * *.test.js in this directory, and exits non-zero if any assertion failed.
 *
 * Each test file exports `async function (t)` and calls t.ok(cond, message).
 * There is no describe/it, no matchers and no reporter plugin, because there
 * are a dozen assertions and none of that would earn its keep. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { launch, newTab, clearOrigin, closeBrowser, killBrowser } = require('./cdp');

// How long one test file may run before it fails and the runner moves on: MXSCOUT_TEST_TIMEOUT, in seconds.
// The slowest file takes well under a minute here; the bound is for a file that would otherwise hang the run.
const TEST_MS = (Number(process.env.MXSCOUT_TEST_TIMEOUT) || 300) * 1000;

const MX_PORT = Number(process.env.MXSCOUT_TEST_PORT) || 4390;
const APP_PORT = Number(process.env.FAKE_PORT) || 4501;
// A second listener on the SAME fake-app.js process, standing in for a Mendix
// Runtime's admin port — on loopback, on its own port, exactly where a real
// one sits. That is what lets a test drive the server's own admin-port
// connection (server/admin-port.js) for real rather than around it.
const ADMIN_PORT = Number(process.env.FAKE_ADMIN_PORT) || 4502;
const CDP_PORT = Number(process.env.CDP_PORT) || 9222;
const MX = 'http://127.0.0.1:' + MX_PORT;
const APP = 'http://127.0.0.1:' + APP_PORT;
const ADMIN = 'http://127.0.0.1:' + ADMIN_PORT;

// A port already in use means some other process answers instead of the one we
// just started — and the suite then silently tests THAT. This bit the author:
// a stale server from an earlier session made results depend on which copy
// replied. Refuse to run rather than report on the wrong code.
async function refuseIfBusy(url, what) {
  try {
    await fetch(url);
  } catch (e) {
    return; // nothing listening, which is what we want
  }
  throw new Error('Something is already listening for ' + what + ' at ' + url +
    '. Stop it (or set MXSCOUT_TEST_PORT / FAKE_PORT) — otherwise these tests would run against it, not against this checkout.');
}

function waitForHttp(url, ms) {
  const until = Date.now() + ms;
  return (async function attempt() {
    for (;;) {
      try { if ((await fetch(url)).ok) return true; } catch (e) { /* not up yet */ }
      if (Date.now() > until) throw new Error('server never came up: ' + url);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
}

(async () => {
  await refuseIfBusy(MX + '/api/health', 'MxScout');
  await refuseIfBusy(APP + '/', 'the stand-in app');
  await refuseIfBusy(ADMIN + '/', 'the stand-in admin port');
  // Same trap, third form: a Chromium left over from an interrupted run holds
  // the debugging port, launch() attaches to THAT one, and the tests read a
  // stale profile's IndexedDB.
  await refuseIfBusy('http://127.0.0.1:' + CDP_PORT + '/json/version', 'a debuggable Chromium');

  const servers = [
    spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')],
      { env: Object.assign({}, process.env, { MXSCOUT_PORT: String(MX_PORT) }), stdio: 'ignore' }),
    spawn(process.execPath, [path.join(__dirname, 'fake-app.js')],
      { env: Object.assign({}, process.env, { FAKE_PORT: String(APP_PORT), FAKE_ADMIN_PORT: String(ADMIN_PORT) }), stdio: 'ignore' })
  ];
  servers.forEach((s) => s.on('exit', (code) => {
    if (code) { console.error('a test server exited with code ' + code + ' — aborting'); process.exit(1); }
  }));
  // Everything this run started, in one place — the browser is held in
  // `browser` the moment it is launched, so a signal takes it down too. It was
  // missing from here once, and a killed run left a Chromium holding the
  // debugging port for the next one.
  // The browser is kept apart from the servers: its profile folder goes with it (cdp.js).
  const started = servers.slice();
  let browser = null;
  const stop = () => { started.forEach((s) => { try { s.kill(); } catch (e) { /* already gone */ } }); killBrowser(browser); };
  process.on('exit', stop);
  // A normal exit runs the handler above. Ctrl-C, or the runner being killed
  // from outside, does not — and the servers then outlive it, hold the ports,
  // and the NEXT run refuses to start. Catch the signals too.
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => process.on(sig, () => { stop(); process.exit(130); }));

  await waitForHttp(MX + '/api/health', 8000);
  await waitForHttp(APP + '/', 8000);
  await waitForHttp(ADMIN + '/', 8000);

  // One browser for the whole run. Launching Chromium per file would triple
  // the wall time; what a file needs from isolation it gets below instead —
  // its own tabs, closed after it, and MxScout's storage emptied before it.
  let tabs = [], capturing = null;
  async function tab(url) {
    if (!browser) browser = await launch(CDP_PORT);
    const tb = await newTab(CDP_PORT, url);
    // A failure's report is taken while the test goes on; a tab it closes meanwhile waits for it first.
    const closeNow = tb.close;
    tb.close = async () => { if (capturing) await capturing; return closeNow(); };
    tabs.push(tb);
    return tb;
  }

  // When a test fails: each of its tabs still open — its screenshot, its console and page errors, and what
  // the test last asked of it — saved in a folder of the system's temp folder, whose path is printed.
  let report = null;
  async function saveReport(file, why) {
    const open = tabs.filter((x) => !x.closed);
    if (!report) report = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-test-failures-'));
    const dir = path.join(report, file.replace('.test.js', ''));
    fs.mkdirSync(dir, { recursive: true });
    const lines = ['why: ' + why, ''];
    for (let i = 0; i < open.length; i++) {
      const png = await Promise.race([open[i].screenshot(), new Promise((r) => setTimeout(() => r(null), 20000))]);
      if (png) fs.writeFileSync(path.join(dir, 'tab-' + (i + 1) + '.png'), png);
      lines.push('tab ' + (i + 1) + ': ' + open[i].url, '  last step: ' + open[i].lastStep, '  screenshot: ' + (png ? 'tab-' + (i + 1) + '.png' : 'none — the tab did not answer'), '  console:');
      open[i].consoleLines.forEach((l) => lines.push('    ' + l));
      lines.push('');
    }
    if (!open.length) lines.push('(no tab of this test was still open)');
    fs.writeFileSync(path.join(dir, 'report.txt'), lines.join('\n'));
    console.log('  saved what the browser showed: ' + dir);
  }

  // Between files: the tabs a test left open are closed (a page still running would compete with the next
  // test's), and everything MxScout keeps for its origin is cleared. Before 2026-10-15 the files shared one
  // IndexedDB and one private file system, so a test could pass only because an earlier one ran first.
  async function cleanUp() {
    const open = tabs; tabs = [];
    await Promise.all(open.filter((x) => !x.closed).map((x) => x.close().catch(() => {})));
    if (browser) { await clearOrigin(CDP_PORT, MX); await clearOrigin(CDP_PORT, APP); }
  }

  let failed = 0, passed = 0;

  // A promise a test left behind that fails after nobody waits for it — a timed-out test's tab closed
  // under it, say — is a failure to report, not a reason for Node to end the whole run.
  process.on('unhandledRejection', (e) => { failed++; console.log('  FAIL a promise failed with nobody waiting for it: ' + (e && e.message || e)); });
  // `node test/run.js flow` runs only the files whose name contains "flow".
  // Useful when chasing one intermittent failure without paying for the rest.
  const only = process.argv[2];
  const files = fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => !only || f.indexOf(only) !== -1)
    .sort();
  if (!files.length) { console.error('no test files match ' + JSON.stringify(only)); process.exit(1); }

  for (const file of files) {
    console.log('\n' + file.replace('.test.js', ''));
    let fileFailed = 0, over = false, lastFail = null;
    const t = {
      MX, APP, ADMIN, CDP_PORT, tab,
      ok(cond, message) {
        // A test that ran out of time may still be running; what it says after that is not counted.
        if (over) return;
        if (cond) { passed++; console.log('  ok   ' + message); }
        else { failed++; fileFailed++; console.log('  FAIL ' + message); if (!lastFail) capturing = lastFail = saveReport(file, 'FAIL ' + message).catch(() => {}); }
      }
    };
    let timer = null;
    const timedOut = new Promise((r) => { timer = setTimeout(() => r('timeout'), TEST_MS); });
    let outcome;
    try {
      outcome = await Promise.race([require(path.join(__dirname, file))(t), timedOut]);
    } catch (e) {
      failed++; fileFailed++;
      const msg = 'threw: ' + (e && e.stack || e);
      console.log('  FAIL ' + msg);
      if (!lastFail) lastFail = saveReport(file, msg).catch(() => {});
    }
    clearTimeout(timer);
    if (outcome === 'timeout') {
      over = true;
      failed++; fileFailed++;
      const where = tabs.filter((x) => !x.closed).map((x) => x.lastStep);
      const msg = 'timed out after ' + Math.round(TEST_MS / 1000) + ' s' + (where.length ? ' — it was ' + where.join('; ') : '') + ' (MXSCOUT_TEST_TIMEOUT sets the bound, in seconds)';
      console.log('  FAIL ' + msg);
      if (!lastFail) lastFail = saveReport(file, msg).catch(() => {});
    }
    if (lastFail) await lastFail;
    capturing = null;
    try { await cleanUp(); } catch (e) { failed++; console.log('  FAIL could not reset the browser after ' + file + ': ' + (e && e.message || e)); }
  }

  // The browser closed and its profile removed — and checked: a run that leaves its profile behind fails.
  const profile = browser && browser.profile;
  await closeBrowser(browser);
  browser = null;
  stop();
  if (profile && fs.existsSync(profile)) { failed++; console.log('\n  FAIL the browser profile this run made is still there: ' + profile); }
  if (report) console.log('\nWhat the browser showed when a test failed: ' + report);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
