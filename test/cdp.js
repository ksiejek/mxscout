// A small Chrome DevTools Protocol driver on Node's built-in WebSocket: launching the browser, opening tabs,
// evaluating, waiting, and — for the runner — every command bounded in time, the console kept, a screenshot,
// and clearing what a page stored. No npm, in keeping with the project it tests.
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

// Every run gets a fresh profile, and the profile goes when the browser does (closeBrowser, and
// killBrowser for an exit that cannot wait). It used not to: 2026-10-15 the machine ran out of disk
// with 1,193 profiles left in the temp folder, 46 GB, and the next runs failed on storage quota.
async function launch(port) {
  if (!CHROME) CHROME = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-cdp-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  proc.profile = profile;
  // Without this, a browser that cannot start takes the whole runner down with
  // an unhandled 'error' event and a stack trace about child_process, three
  // frames from anything that names a browser.
  let spawnError = null;
  proc.on('error', (e) => { spawnError = e; });
  for (let i = 0; i < 100; i++) {
    if (spawnError) { killBrowser(proc); throw new Error('could not start ' + CHROME + ': ' + spawnError.message); }
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) return proc; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await closeBrowser(proc);
  throw new Error(CHROME + ' started but never answered on the debugging port ' + port);
}

function removeProfile(proc) {
  // On Windows the browser's helper processes hold files in it for a moment after the browser itself is gone.
  const tries = process.platform === 'win32' ? 40 : 5;
  if (proc && proc.profile) { try { fs.rmSync(proc.profile, { recursive: true, force: true, maxRetries: tries, retryDelay: 150 }); } catch (e) { /* the runner checks */ } }
}
function running(proc) { return proc.exitCode === null && proc.signalCode === null; }
// The browser asked to quit and waited for, then killed if it would not, then its profile removed.
async function closeBrowser(proc) {
  if (!proc) return;
  const gone = new Promise((r) => { if (!running(proc)) r(); else proc.once('exit', r); });
  const wait = (ms) => Promise.race([gone, new Promise((r) => setTimeout(r, ms))]);
  if (running(proc)) { try { proc.kill(); } catch (e) { /* already gone */ } await wait(5000); }
  if (running(proc)) { try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ } await wait(2000); }
  removeProfile(proc);
}
// The same where nothing can be waited for (process.on('exit')): killed, and the profile removed at once.
function killBrowser(proc) {
  if (!proc) return;
  try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ }
  removeProfile(proc);
}

// How long one DevTools command may go unanswered before it fails, naming itself. It used to be forever:
// a tab that crashed, or a page stuck in a promise that never settled, left the runner waiting with no
// word of where (the audit of 2026-10-15 saw a full run stop in 87-assist-folder and never end). A
// Runtime.evaluate that awaits the page's own work counts too, so the bound is generous; the per-test
// bound in run.js sits above it. CDP_COMMAND_TIMEOUT (seconds) changes it.
const COMMAND_MS = (Number(process.env.CDP_COMMAND_TIMEOUT) || 60) * 1000;
// The last console lines and page errors each tab saw, kept for the runner to save when a test fails.
const CONSOLE_KEPT = 200;

// One DevTools connection: commands with ids, each answered or failed — by its own timeout, or all at once
// when the socket closes (a closed tab, a browser that went away), never left pending.
async function connect(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not open the DevTools connection ' + wsUrl)); });
  let id = 0, closed = null;
  const pending = new Map();
  function failAll(why) {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(why + ' while waiting for ' + p.method)); }
    pending.clear();
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg); }
    else if (msg.method && onEvent) onEvent(msg);
  };
  ws.onclose = () => { closed = 'the DevTools connection closed'; failAll(closed); };
  ws.onerror = () => { closed = closed || 'the DevTools connection failed'; };
  function send(method, params, ms) {
    if (closed || ws.readyState !== 1) return Promise.reject(new Error((closed || 'the DevTools connection is not open') + ' — cannot send ' + method));
    const mid = ++id;
    return new Promise((resolve, reject) => {
      const limit = ms || COMMAND_MS;
      const timer = setTimeout(() => {
        pending.delete(mid);
        reject(new Error(method + ' had no answer in ' + Math.round(limit / 1000) + ' s'));
      }, limit);
      pending.set(mid, { resolve, reject, method, timer });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }
  function close() { try { ws.close(); } catch (e) { /* already gone */ } failAll('the DevTools connection was closed'); }
  return { send, close };
}

// Everything stored for MxScout's origin — IndexedDB, the private file system, localStorage, caches —
// cleared through the browser itself. The runner does it between test files: each file starts from an
// empty browser instead of from whatever the files before it left, so a test passes or fails on its own.
// Asked of a blank tab of its own: the browser's own target answers this command with an internal error.
async function clearOrigin(port, origin) {
  const info = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  const c = await connect(info.webSocketDebuggerUrl);
  try {
    const r = await c.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }, 20000);
    if (r.error) throw new Error('Storage.clearDataForOrigin: ' + JSON.stringify(r.error));
  } finally {
    c.close();
    try { await fetch('http://127.0.0.1:' + port + '/json/close/' + info.id); } catch (e) { /* already gone */ }
  }
}

async function newTab(port, url) {
  const r = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  const info = await r.json();
  const consoleLines = [];
  const keep = (line) => { consoleLines.push(new Date().toISOString().slice(11, 23) + ' ' + line); if (consoleLines.length > CONSOLE_KEPT) consoleLines.shift(); };
  const conn = await connect(info.webSocketDebuggerUrl, (msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      keep(msg.params.type + ': ' + (msg.params.args || []).map((a) => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type)).join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      keep('uncaught: ' + ((d.exception && d.exception.description) || d.text));
    } else if (msg.method === 'Log.entryAdded') {
      keep(msg.params.entry.level + ' (' + msg.params.entry.source + '): ' + msg.params.entry.text + (msg.params.entry.url ? ' ' + msg.params.entry.url : ''));
    }
  });
  // What the test last asked of this tab — a failure or a timeout says where it stood.
  let last = 'opening ' + url;
  function send(method, params, ms) {
    if (method !== 'Runtime.evaluate') last = method;
    return conn.send(method, params, ms);
  }
  // The console and the page's errors, for the runner's report when a test fails.
  await send('Runtime.enable');
  await send('Log.enable');
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(JSON.stringify(r.error));
    const res = r.result;
    if (res.exceptionDetails) throw new Error('page error: ' + JSON.stringify(res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
    return res.result.value;
  }
  async function waitFor(expr, ms, label) {
    const until = Date.now() + (ms || 10000);
    last = 'waiting for ' + (label || expr).slice(0, 300);
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
  let isClosed = false;
  async function close() {
    isClosed = true;
    conn.close();
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

  // The window size a layout test measures against (the redesign is drawn at
  // 1440 × 900 and 2560 × 1440). Lasts as long as the tab.
  async function viewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  // For the runner's report: what the page looks like now, as PNG bytes (null when it cannot say).
  async function screenshot() {
    try {
      const r = await conn.send('Page.captureScreenshot', { format: 'png' }, 15000);
      return r.result && r.result.data ? Buffer.from(r.result.data, 'base64') : null;
    } catch (e) { return null; }
  }

  return {
    send, evaluate, waitFor, navigate, close, viewport, screenshot, url,
    get consoleLines() { return consoleLines.slice(); },
    get lastStep() { return last; },
    get closed() { return isClosed; }
  };
}

module.exports = { launch, newTab, clearOrigin, closeBrowser, killBrowser };
