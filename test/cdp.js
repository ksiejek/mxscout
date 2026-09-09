// A ~60-line Chrome DevTools Protocol driver on Node's built-in WebSocket.
// No npm, in keeping with the project it tests.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Which Chromium to drive. The suite deliberately downloads nothing, so it
// takes whatever browser the machine already has — and that path is different
// on every machine. A hardcoded one (it used to be the Linux CI container's)
// fails as a spawn ENOENT halfway through the run, which reads like a broken
// test rather than a missing browser.
//
// Order: an explicit CHROME wins, then the usual per-platform installs. Any
// Chromium-based build works; these tests only speak the DevTools protocol.
function candidates() {
  if (process.env.CHROME) return [process.env.CHROME];
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      home + '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      home + '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
  }
  if (process.platform === 'win32') {
    const dirs = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Chromium\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe'];
    return dirs.reduce((all, d) => all.concat(rel.map((r) => path.join(d, r))), []);
  }
  // Linux: the CI container's bundled Chromium is versioned, so glob it rather
  // than pin the version, then fall back to whatever is on PATH.
  const bundled = [];
  try {
    for (const dir of fs.readdirSync('/opt/pw-browsers')) {
      if (dir.indexOf('chromium') === 0) bundled.push('/opt/pw-browsers/' + dir + '/chrome-linux/chrome');
    }
  } catch (e) { /* no bundle here */ }
  return bundled.concat([
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium'
  ]);
}

function findChrome() {
  const tried = candidates();
  for (const c of tried) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (e) { /* not this one */ }
  }
  throw new Error('No Chromium found to run the browser tests. Install Google Chrome or ' +
    'Chromium, or point CHROME at one:\n  CHROME="/path/to/chrome" npm test\nLooked at:\n  ' +
    tried.join('\n  '));
}

// Resolved on first launch, not at require time: the failure then arrives
// through the runner, as a test error naming a browser, instead of as a stack
// trace out of module loading.
let CHROME = null;

async function launch(port) {
  if (!CHROME) CHROME = findChrome();
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + port, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-cdp-')), 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  // Without this, a browser that cannot start takes the whole runner down with
  // an unhandled 'error' event and a stack trace about child_process, three
  // frames from anything that names a browser.
  let spawnError = null;
  proc.on('error', (e) => { spawnError = e; });
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw new Error('could not start ' + CHROME + ': ' + spawnError.message);
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) return proc; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(CHROME + ' started but never answered on the debugging port ' + port);
}

async function newTab(port, url) {
  const r = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  const info = await r.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  function send(method, params) {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    return new Promise((res) => pending.set(mid, res));
  }
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(JSON.stringify(r.error));
    const res = r.result;
    if (res.exceptionDetails) throw new Error('page error: ' + JSON.stringify(res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
    return res.result.value;
  }
  async function waitFor(expr, ms, label) {
    const until = Date.now() + (ms || 10000);
    for (;;) {
      const v = await evaluate('(function(){try{return (' + expr + ');}catch(e){return false;}})()');
      if (v) return v;
      if (Date.now() > until) throw new Error('timeout waiting for ' + (label || expr));
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  async function navigate(u) { await send('Page.navigate', { url: u }); }

  // Closing the WEBSOCKET only stops us watching — the page keeps running.
  // That mattered: MxScout is single-session by design, so a tab left open by
  // an earlier test kept polling and competing for the one session, and the
  // suite failed intermittently in whichever file ran later. Close the target.
  async function close() {
    try { ws.close(); } catch (e) { /* already gone */ }
    try { await fetch('http://127.0.0.1:' + port + '/json/close/' + info.id); } catch (e) { /* already gone */ }
  }

  // A tab is not usable the moment its WebSocket opens. Chrome answers
  // /json/new as soon as the TARGET exists, which is long before the page has
  // fetched anything or run a line of its own script — measured on this
  // machine, 18 of 20 tabs came back with the fake app's `mx` still
  // undefined, and 17 of 20 with readyState still "loading".
  //
  // That is what made 30-perf-admin-port.test.js fail intermittently for
  // weeks. The bridge snippet pasted into an app tab that had no `mx` yet
  // took the snippet's OWN "mx.data was not found on this page" path and
  // returned — correct behaviour, invisible from here, and the test then sat
  // waiting twelve seconds for a bridge that had already declined to start.
  // Every test that opens a tab had the same hole; none of them should have
  // to know about it, so the wait belongs here and not in any of them.
  await waitFor('document.readyState === "complete"', 15000,
    'the page at ' + url + ' to finish loading before the test touches it');

  return { send, evaluate, waitFor, navigate, close };
}

module.exports = { launch, newTab };
