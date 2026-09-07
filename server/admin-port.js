/* MxScout — the ONE place in this codebase that opens an outbound connection.
 *
 * Everything else in MxScout only ever answers. This file exists because the
 * Mendix Runtime's admin port is the only source of the internal action stack
 * behind a request — nested microflow calls, the activity running right now,
 * the XPath behind a retrieve — and there is no way to read it from a browser
 * tab: the admin API needs a custom X-M2EE-Authentication header, which makes
 * it a preflighted cross-origin request, and the admin port answers no CORS
 * at all. MxScout used to work around that by having the user paste a bridge
 * script into a tab open ON the admin port (public/admin-bridge.js, deleted
 * in this step). Karol's call, 2026-09-07: the paste step goes, the server
 * connects.
 *
 * That is a deliberate, narrow break of an invariant this project wrote on
 * its own About page, so the break is written down in code, not just in prose:
 *
 *   - The host is NOT taken from the caller. It is a loopback literal from
 *     LOOPBACK_HOSTS, so there is no name to resolve and no way to point this
 *     at anything but this machine. The caller supplies a port and nothing
 *     else.
 *   - The action is NOT taken from the caller either — only the two names in
 *     ALLOWED_ACTIONS get through. This matters more than it looks: the same
 *     admin API also answers `shutdown` and `set_log_level`. A generic proxy
 *     here would be an SSRF gadget wired straight into the runtime's kill
 *     switch. Two read-only actions is the whole surface.
 *   - Nothing here runs unless a recording is running. startSampling() is
 *     called by the recording's Start and stopSampling() by its Finish; with
 *     no recording in progress this module holds no timer and opens no
 *     socket.
 *   - The m2ee password lives in server/state.js's module memory for the
 *     length of the session and is used only to build the auth header below.
 *     It is never logged, never written to disk (the server writes nothing to
 *     disk at all — that invariant is untouched), and never returned by any
 *     route, including the status route the UI polls.
 *
 * The sampling loop is here rather than in a route because it is the same
 * topic: talking to the admin port. It carries over the two lessons the
 * pasted bridge learned the hard way — never start a round while the previous
 * one is still in flight, and say so out loud when the port stops answering
 * (see ROADMAP step 46, Phase 1c).
 */
'use strict';

const http = require('http');

// Loopback literals, tried in this order at connect time. Literals only: a
// name would go through the resolver, and a resolver is exactly the thing
// that could send this somewhere other than this machine.
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];

// The complete list of what MxScout is allowed to ask the runtime. Both are
// read-only. Adding a third name here is a change to what the About page
// promises, not a detail.
const ALLOWED_ACTIONS = new Set(['get_current_runtime_requests', 'runtime_statistics']);

const REQUEST_TIMEOUT_MS = 4000;
const RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const SAMPLE_MAX_BYTES = 200 * 1024;   // drop an outsized sample rather than let the buffer grow unbounded
const TROUBLE_AFTER_ROUNDS = 10;       // consecutive rounds where BOTH calls failed before we say so

function authHeader(password) {
  return Buffer.from(String(password), 'utf8').toString('base64');
}

// One admin call. Resolves to the parsed body, or to null for every kind of
// failure — a refused connection, a timeout, a 401, a body that is not JSON.
// The caller cannot tell those apart and does not need to: during a recording
// they all mean "no data this round", and at connect time verify() below asks
// a sharper question.
function invoke(host, port, password, action) {
  if (!ALLOWED_ACTIONS.has(action)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const body = JSON.stringify({ action, params: {} });
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    const req = http.request({
      host, port, method: 'POST', path: '/',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-M2EE-Authentication': authHeader(password)
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > RESPONSE_MAX_BYTES) { req.destroy(); done(null); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode !== 200) { done(null); return; }
        try { done(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { done(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
    req.end(body);
  });
}

// Connect-time check, and the only place that reports WHY something failed.
// Resolves to { ok: true, host } or { ok: false, reason }, where reason is
// one of 'unreachable' | 'password' | 'not-admin-port' — the three things
// that actually go wrong, each of which needs different words in the UI.
// Both loopback addresses are tried because a Mendix runtime on Windows may
// be listening on either.
async function verify(port, password) {
  let sawSomething = false;
  for (const host of LOOPBACK_HOSTS) {
    const probe = await probeOnce(host, port, password);
    if (probe === 'ok') return { ok: true, host };
    if (probe === 'password') return { ok: false, reason: 'password' };
    if (probe === 'not-admin-port') { sawSomething = true; continue; }
  }
  return { ok: false, reason: sawSomething ? 'not-admin-port' : 'unreachable' };
}

// Distinguishes the failures verify() reports, which invoke() deliberately
// flattens: a 401 is a wrong password, a 200 that is not JSON is something
// else listening on that port, no answer at all is nothing listening.
function probeOnce(host, port, password) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ action: 'runtime_statistics', params: {} });
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    const req = http.request({
      host, port, method: 'POST', path: '/',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-M2EE-Authentication': authHeader(password)
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (res) => {
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > RESPONSE_MAX_BYTES) { req.destroy(); done('not-admin-port'); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) { done('password'); return; }
        if (res.statusCode !== 200) { done('not-admin-port'); return; }
        try { JSON.parse(Buffer.concat(chunks).toString('utf8')); done('ok'); }
        catch (e) { done('not-admin-port'); }
      });
    });
    req.on('timeout', () => { req.destroy(); done('unreachable'); });
    req.on('error', () => done('unreachable'));
    req.end(body);
  });
}

// ---------- the sampling loop ----------
// Only ever one, because MxScout is single-user and single-session by design
// (see state.js). Kept as module state next to the calls it repeats.
let timer = null;
let inFlight = false;   // never start a round before the last one settled
let startedAt = 0;
let failStreak = 0;
let trouble = null;     // a sentence for the UI once the port has gone quiet for a while

function nowMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

function sizeOk(sample) {
  try { return Buffer.byteLength(JSON.stringify(sample)) <= SAMPLE_MAX_BYTES; }
  catch (e) { return false; }
}

// A slow admin port must sample SLOWER, never not at all. The pasted bridge
// shipped without this guard and the result was "always 0 samples": at 50 ms
// a fresh pair of calls went out regardless of whether the previous pair had
// answered, until every one of them queued and timed out. Same fix, same
// reasoning, now on this side of the wire.
function tick(cfg) {
  if (inFlight) return;
  inFlight = true;
  Promise.all([
    invoke(cfg.host, cfg.port, cfg.password, 'get_current_runtime_requests'),
    invoke(cfg.host, cfg.port, cfg.password, 'runtime_statistics')
  ]).then(([requests, stats]) => {
    inFlight = false;
    if (!timer) return; // stopped while this round was in flight

    // Both null means the calls themselves did not answer — genuinely
    // different from "the app is idle", which runtime_statistics still
    // answers for. Worth saying out loud after a run of them, not the first:
    // one blip is normal, ten straight is a real problem, and without this
    // the only symptom is an empty recording.
    if (requests === null && stats === null) {
      failStreak++;
      if (failStreak === TROUBLE_AFTER_ROUNDS) {
        trouble = 'The admin port stopped answering — check that the app is still running, and that the password is still the one from this run.';
      }
      return;
    }
    failStreak = 0;
    trouble = null;

    const hasRequests = requests && typeof requests === 'object' && Object.keys(requests).length > 0;
    if (!hasRequests && !stats) return; // nothing worth a sample this round
    const sample = {
      t: Math.max(0, Math.round(nowMs() - startedAt)),
      requests: hasRequests ? requests : {},
      stats: stats || null
    };
    if (sizeOk(sample)) cfg.onSample(sample);
  }).catch(() => { inFlight = false; });
}

function startSampling(cfg) {
  stopSampling();
  startedAt = nowMs();
  inFlight = false;
  failStreak = 0;
  trouble = null;
  timer = setInterval(() => tick(cfg), cfg.intervalMs);
  if (timer.unref) timer.unref(); // a recording must never hold the process open
  tick(cfg);
}

function stopSampling() {
  if (timer) { clearInterval(timer); timer = null; }
  inFlight = false;
  failStreak = 0;
}

function isSampling() { return !!timer; }
function getTrouble() { return trouble; }

module.exports = {
  LOOPBACK_HOSTS, ALLOWED_ACTIONS,
  invoke, verify,
  startSampling, stopSampling, isSampling, getTrouble
};
