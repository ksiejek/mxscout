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
//
// The loop CHAINS rather than ticks on a fixed interval: the next round is
// scheduled when the previous one has answered, so the cadence is whatever
// the admin port can actually keep up with, floored at MIN_GAP_MS so a fast
// port cannot be hammered without limit. A fixed setInterval could only ever
// be as fast as its slowest round — a round that overran simply skipped the
// next tick, so the real gap jumped to a multiple of the interval.
//
// Why it matters, in Karol's words on a real recording (2026-09-10): a
// microflow he had watched run "kilkadziesiąt razy" showed 4 calls in the
// Call tree. A sampling profiler can only see what is running at the instant
// it looks, so at one look every 62 ms a call shorter than that is a coin
// toss. Two changes buy the resolution back:
//
//   - runtime_statistics is asked for on its OWN, slower schedule
//     (STATS_EVERY_MS). It is the heavier of the two calls and describes the
//     whole process — heap, database counters, sessions — none of which needs
//     to be read as often as "what is running right now". Most rounds are now
//     one HTTP call instead of two.
//   - the gap between rounds is the floor, not a fixed period.
//
// What this does NOT do, and no change here could: turn the sampler into a
// tracer. It is still a sample every ~10-20 ms, and every count derived from
// it is "how often it was CAUGHT running", never how often it ran. The UI
// says so wherever it shows one.
let timer = null;
let running = false;    // the loop's own state; `timer` is null between rounds
let inFlight = false;   // never start a round before the last one settled
let startedAt = 0;
let lastStatsAt = 0;
let bufferedBytes = 0; // how much this recording has collected, against MAX_BUFFER_BYTES
let failStreak = 0;
let trouble = null;     // a sentence for the UI once the port has gone quiet for a while

// The floor on how close two rounds may be, and how often the runtime-wide
// statistics ride along. Both are here rather than passed in: they are facts
// about how hard this file is willing to lean on someone else's runtime, and
// the About page quotes them.
//
// 10 ms is Karol's call, 2026-09-10, after seeing 32 ms come out of a 20 ms
// floor: the resolution is what decides whether a short microflow is caught
// at all, and he would rather pay for it. It is a floor on a LOOPBACK request
// to a dev or test runtime — the only kind this file may open at all — and
// the round trip itself is most of what an interval this small actually
// costs, so the true cadence lands wherever that admin port can keep up.
const MIN_GAP_MS = 10;
const STATS_EVERY_MS = 250;

// How long, and how much, a single recording may collect before it stops
// ITSELF. Both, because neither alone is a guarantee: ten minutes of an idle
// app is a few megabytes and ten minutes of a busy one is tens of them, and a
// megabyte budget alone would let a quiet app record all afternoon.
//
// Ten minutes is Karol's number, 2026-09-10 ("nie wyobrażam sobie, że będziemy
// to na tak długo puszczać"). The byte budget is what actually keeps the
// machine safe: everything collected has to survive being JSON in one HTTP
// response, parsed in the browser, and written into IndexedDB as one row, and
// each of those wants the whole thing in memory at once.
//
// Reaching either one STOPS the recording and says so (see onLimit). It does
// not quietly drop the oldest samples, which is what the buffer's own cap used
// to do: a recording missing its beginning still looks complete, and every
// count on the Overview would be wrong by an amount nobody could see.
const MAX_RECORDING_MS = 10 * 60 * 1000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function nowMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

// The serialized size of one sample, or null if it cannot be serialized at
// all. Measured once and used twice — the per-sample cap and the running total
// for the recording — because measuring it is the expensive part.
function sampleBytes(sample) {
  try { return Buffer.byteLength(JSON.stringify(sample)); }
  catch (e) { return null; }
}

// A slow admin port must sample SLOWER, never not at all. The pasted bridge
// shipped without this guard and the result was "always 0 samples": at 50 ms
// a fresh pair of calls went out regardless of whether the previous pair had
// answered, until every one of them queued and timed out. Same fix, same
// reasoning, now on this side of the wire — and the chained loop below makes
// it structural rather than a check.
//
// Resolves when the round is over, whatever it found: the loop needs to know
// when to schedule the next one, and "it failed" is as much an end as "it
// answered".
function tick(cfg) {
  if (inFlight) return Promise.resolve();
  inFlight = true;
  // Statistics ride along only every so often. A round that skips them still
  // produces a sample — one with `stats: null`, exactly the shape a round
  // whose stats call failed already produced, which every reader in perf.js
  // has always had to tolerate.
  const wantStats = (nowMs() - lastStatsAt) >= STATS_EVERY_MS;
  return Promise.all([
    invoke(cfg.host, cfg.port, cfg.password, 'get_current_runtime_requests'),
    wantStats ? invoke(cfg.host, cfg.port, cfg.password, 'runtime_statistics') : Promise.resolve(undefined)
  ]).then(([requests, stats]) => {
    inFlight = false;
    if (!running) return; // stopped while this round was in flight

    // Nothing answered means the calls themselves did not answer — genuinely
    // different from "the app is idle", which the admin port answers for with
    // an empty object. Worth saying out loud after a run of them, not the
    // first: one blip is normal, ten straight is a real problem, and without
    // this the only symptom is an empty recording.
    if (requests === null && (!wantStats || stats === null)) {
      failStreak++;
      if (failStreak === TROUBLE_AFTER_ROUNDS) {
        trouble = 'The admin port stopped answering — check that the app is still running, and that the password is still the one from this run.';
      }
      return;
    }
    failStreak = 0;
    trouble = null;
    if (wantStats && stats != null) lastStatsAt = nowMs();

    // A round that answered is a sample even when nothing was running. It is
    // what makes the recording's own clock honest: every duration on the page
    // is samples × the gap between them, and dropping the idle rounds would
    // stretch that gap by however long the app sat still.
    const hasRequests = requests && typeof requests === 'object';
    const sample = {
      t: Math.max(0, Math.round(nowMs() - startedAt)),
      requests: hasRequests ? requests : {},
      stats: stats == null ? null : stats
    };
    const bytes = sampleBytes(sample);
    if (bytes != null && bytes <= SAMPLE_MAX_BYTES) {
      bufferedBytes += bytes;
      cfg.onSample(sample);
    }
  }).catch(() => { inFlight = false; });
}

// Which limit, if either, this recording has now reached. Checked between
// rounds rather than inside one, so a recording that has stopped never has a
// round in flight behind it. The time limit is checked even when nothing is
// being collected — an app sitting idle for ten minutes is still a recording
// that has been running for ten minutes.
function limitReached(cfg) {
  const maxMs = cfg.maxMs || MAX_RECORDING_MS;
  const maxBytes = cfg.maxBytes || MAX_BUFFER_BYTES;
  if (nowMs() - startedAt >= maxMs) return 'length';
  if (bufferedBytes >= maxBytes) return 'size';
  return null;
}

// Round, wait out whatever is left of the floor, round again. cfg.intervalMs
// is the caller's floor and MIN_GAP_MS the one this file will not go below,
// so a caller can ask for a gentler cadence but not for a harder one.
//
// A recording that has reached a limit stops HERE, itself, and hands the
// reason back — it does not wait to be told, because the whole point of the
// limit is the case where nobody is watching.
function loop(cfg) {
  const roundStart = nowMs();
  tick(cfg).then(() => {
    if (!running) return;
    const reason = limitReached(cfg);
    if (reason) {
      stopSampling();
      if (cfg.onLimit) cfg.onLimit(reason);
      return;
    }
    const floor = Math.max(MIN_GAP_MS, cfg.intervalMs || 0);
    const wait = Math.max(0, floor - (nowMs() - roundStart));
    timer = setTimeout(() => { timer = null; loop(cfg); }, wait);
    if (timer.unref) timer.unref(); // a recording must never hold the process open
  });
}

function startSampling(cfg) {
  stopSampling();
  startedAt = nowMs();
  lastStatsAt = 0; // the first round carries statistics, so a short recording has them
  bufferedBytes = 0;
  inFlight = false;
  failStreak = 0;
  trouble = null;
  running = true;
  loop(cfg);
}

function stopSampling() {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
  inFlight = false;
  failStreak = 0;
}

function isSampling() { return running; }
function getTrouble() { return trouble; }

module.exports = {
  ALLOWED_ACTIONS, isAllowedHost, unwrap,
  MAX_RECORDING_MS, MAX_BUFFER_BYTES,
  invoke, verify,
  startSampling, stopSampling, isSampling, getTrouble
};
