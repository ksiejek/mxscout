#!/usr/bin/env node
/* The runner. Brings up MxScout and the stand-in Mendix app, runs every
 * *.test.js in this directory, and exits non-zero if any assertion failed.
 *
 * Each test file exports `async function (t)` and calls t.ok(cond, message).
 * There is no describe/it, no matchers and no reporter plugin, because there
 * are a dozen assertions and none of that would earn its keep. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, newTab } = require('./cdp');

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
  // Everything this run started, in one place — the browser is added to the
  // list the moment it is launched, so a signal takes it down too. It was
  // missing from here once, and a killed run left a Chromium holding the
  // debugging port for the next one.
  const started = servers.slice();
  const stop = () => started.forEach((s) => { try { s.kill(); } catch (e) { /* already gone */ } });
  process.on('exit', stop);
  // A normal exit runs the handler above. Ctrl-C, or the runner being killed
  // from outside, does not — and the servers then outlive it, hold the ports,
  // and the NEXT run refuses to start. Catch the signals too.
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => process.on(sig, () => { stop(); process.exit(130); }));

  await waitForHttp(MX + '/api/health', 8000);
  await waitForHttp(APP + '/', 8000);
  await waitForHttp(ADMIN + '/', 8000);

  // One browser for the whole run. Launching Chromium per file would triple
  // the wall time for no isolation the tests actually need — each one opens
  // its own tab with its own storage.
  let browser = null;
  async function tab(url) {
    if (!browser) { browser = await launch(CDP_PORT); started.push(browser); }
    return newTab(CDP_PORT, url);
  }

  let failed = 0, passed = 0;
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
    const t = {
      MX, APP, ADMIN, CDP_PORT, tab,
      ok(cond, message) {
        if (cond) { passed++; console.log('  ok   ' + message); }
        else { failed++; console.log('  FAIL ' + message); }
      }
    };
    try {
      await require(path.join(__dirname, file))(t);
    } catch (e) {
      failed++;
      console.log('  FAIL threw: ' + (e && e.stack || e));
    }
  }

  stop();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
