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
 *   - The address goes through the SAME non-production guard as every other
 *     address MxScout will talk to (isAllowedHost below — this server's own
 *     copy of public/live.js's classifyAppUrl, deliberately duplicated
 *     because this is the copy that actually decides whether a socket opens).
 *     Local and clearly non-production hosts only; a production-looking
 *     address is refused here even if the UI somehow asked for it.
 *   - The action is NOT taken from the caller — only the two names in
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

// This server's own copy of the non-production guard — the same rule and the
// same word list as public/live.js's classifyAppUrl and the copy baked into
// the pasted bridge. Duplicated on purpose: this is the copy that decides
// whether a socket is opened, so it must not depend on some caller having run
// another one first. Fail-closed — anything not recognised as local or
// clearly non-production is refused.
const NONPROD_TOKENS = {
  dev: 1, development: 1, test: 1, testing: 1, tst: 1,
  accept: 1, acceptance: 1, acc: 1, acp: 1, accp: 1,
  sandbox: 1, staging: 1, stage: 1, uat: 1, qa: 1, local: 1
};
function isAllowedHost(host) {
  host = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
      host.slice(-6) === '.local' || host.slice(-10) === '.localhost') return true;
  const tokens = host.split(/[.\-]/);
  for (let i = 0; i < tokens.length; i++) { if (NONPROD_TOKENS[tokens[i]]) return true; }
  return false;
}

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

// The m2ee admin API answers in an envelope — { feedback: <the answer>,
// result: <0 on success> } — not with the answer itself. MxScout stored the
// envelope and treated it as the answer for the whole of Phases 1 and 2a,
// which is why a real recording drew two long grey bars: `feedback` and
// `result` were read as two request ids that were "in flight" for the entire
// recording. Caught 2026-09-07 on Karol's first real run, from a sample he
// pasted back; the fixture had been guessed without it.
//
// Unwrapped here, at the edge, so nothing downstream has to know the envelope
// exists. A non-zero result means the runtime refused the action, which is a
// failure like any other. A body without the envelope is passed through
// rather than dropped: this is a shape read off ONE runtime version, and
// throwing away an answer that does not match it would be the same mistake
// again, in the other direction.
function unwrap(body) {
  if (!body || typeof body !== 'object') return null;
  if (!('feedback' in body) && !('result' in body)) return body;
  if ('result' in body && body.result !== 0) return null;
  return body.feedback == null ? null : body.feedback;
}

// One admin call. Resolves to the parsed body, or to null for every kind of
// failure — a refused connection, a timeout, a 401, a body that is not JSON.
// The caller cannot tell those apart and does not need to: during a recording
// they all mean "no data this round", and at connect time verify() below asks
// a sharper question.
function invoke(host, port, password, action) {
  if (!ALLOWED_ACTIONS.has(action) || !isAllowedHost(host)) return Promise.resolve(null);
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
        try { done(unwrap(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch (e) { done(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
    req.end(body);
  });
}

// Connect-time check, and the only place that reports WHY something failed.
// Resolves to { ok: true, host, port } or { ok: false, reason }, where reason
// is one of 'blocked' | 'unreachable' | 'password' | 'not-admin-port' — the
// four things that actually go wrong, each needing different words in the UI.
// 'blocked' is the non-production guard refusing before any socket exists.
async function verify(host, port, password) {
  if (!isAllowedHost(host)) return { ok: false, reason: 'blocked' };
  const probe = await probeOnce(host, port, password);
  if (probe === 'ok') return { ok: true, host, port };
  return { ok: false, reason: probe };
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
  ALLOWED_ACTIONS, isAllowedHost, unwrap,
  invoke, verify,
  startSampling, stopSampling, isSampling, getTrouble
};
