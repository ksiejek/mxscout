'use strict';

const crypto = require('crypto');

// MxScout holds NO model server-side — the model lives entirely in the
// browser's own storage. The server-side state is the current live session (a
// token, the command in flight, its answer) and the performance recorder's
// admin-port connection and sample buffer. This is a single-user,
// single-session local tool by design (one person, one browser, a server on
// their own machine), so a handful of module-level variables is the right
// amount of state — no session store, no persistence.
//
// The token exists for exactly one reason: the bridge's endpoints necessarily
// accept CROSS-ORIGIN requests (the snippet runs on the target app's own
// origin, not ours — see routes/session.js), which means without something
// like this, any website the user has open could plant fabricated data or
// steer a run. The browser mints a fresh token by calling /api/session/start
// right before it generates a snippet; the snippet embeds it and echoes it
// back, and only a request carrying the CURRENT token is accepted. An
// unrelated site has no way to know the value.
let sessionToken = null;

// The command in flight, its result, and when the bridge last polled. One
// session token covers all of it, so reconnecting supersedes everything at
// once.
let pendingCommand = null;   // { id, kind, qualifiedName, objectParams, armedAt, dispatchedAt }
let commandResult = null;    // { id, ok, message, reportedAt }
let lastCommandPollAt = null;

// The answer to a `query` command: one page of rows the bridge read out of the
// live app. Kept in its own slot rather than folded into commandResult because
// it is a different kind of thing — commandResult says whether a flow ran,
// this carries real application data, and the two must not be confused by
// anything that logs or persists. Nothing here is ever written to disk.
let queryResult = null;      // { id, ok, message, data, reportedAt }

// Long-poll waiters. The bridge holds an open request until there is something
// to do, so a keystroke in MxScout's search box reaches the app tab at once
// instead of on the next timer tick. Each waiter is a callback registered by a
// held-open request; arming a command wakes them all.
const commandWaiters = new Set();
function addCommandWaiter(fn) { commandWaiters.add(fn); return () => commandWaiters.delete(fn); }
// A bridge parked on a held-open poll has not gone away — it is doing exactly
// what it should. Without this, a 25-second wait would read as a disconnect
// five seconds in.
function heldPollCount() { return commandWaiters.size; }
function wakeCommandWaiters() {
  const waiters = Array.from(commandWaiters);
  commandWaiters.clear();
  waiters.forEach((fn) => { try { fn(); } catch (e) { /* a dead response is not our problem */ } });
}

// ---------- the performance recorder ----------
// Two separate things live here. The CONNECTION is what server/admin-port.js
// needs to reach the Mendix Runtime's admin port: a loopback host it picked
// at connect time, a port, and the m2ee password.
//
// That password is the one secret this server has ever held, and it is held
// exactly like everything else here — in module memory, for this process, for
// this session. It is never written to disk (this server writes nothing to
// disk), never logged, and never returned by a route: getAdminConnection()
// deliberately omits it, and only the recorder ever calls
// getAdminPassword(). Disconnecting, starting a new session and clearing the
// session all wipe it, so it lives no longer than the run it belongs to —
// Studio Pro mints a new one every time the app restarts anyway.
let adminHost = null;
let adminPort = null;
let adminPassword = null;

// The RECORDING is the buffer the sampling loop fills while it runs. It is
// kept separate from pendingCommand/commandResult so a recording and a live
// app session can be going at once without either noticing the other.
let perfActive = false;
let perfSamples = [];        // { t, requests, stats }[], cleared on start() and on stop()
let perfStartedAt = null;    // when the CURRENT recording began
// A last-resort cap, and no longer the thing that decides how long a recording
// may run: admin-port.js stops the recorder itself at ten minutes or 64 MB,
// and says which, long before this can be reached. It used to drop the OLDEST
// samples when full, which is the worst of the three options — a recording
// missing its beginning still looks complete, and every count on the Overview
// would be short by an amount nobody could see. If this ever fires, the start
// of the recording is the part worth keeping.
const PERF_SAMPLES_MAX = 50000;

// The last drain, kept so that a REPEATED stop of the same recording answers
// the same thing instead of an empty recording. This is not defensive
// programming for its own sake: browsers really do re-send a POST whose
// response was lost on a reused keep-alive socket, and that is precisely what
// the intermittent "0 samples over 0 ms" in the suite turned out to be — one
// fetch on the page, two requests at the server, the second one draining a
// buffer the first had already emptied and saving THAT as the recording
// (diagnosed 2026-09-10 by logging the drained count per request). Cleared
// the moment a new recording starts, so a replay can only ever answer the
// stop it belongs to.
let perfLastDrain = null;    // { at: ms, samples: [...] }
// Why the recorder stopped itself, in the words the tester reads, or null for
// a recording that was stopped by a person. It rides on the status routes and
// on the stop response, and the page keeps it ON the saved recording — a
// recording that ended early has to say so every time it is opened, not once
// in a message that scrolls away.
let perfLimit = null;
const PERF_REPLAY_MS = 15000;

function setAdminConnection(host, port, password) {
  adminHost = host;
  adminPort = port;
  adminPassword = password;
}
function clearAdminConnection() {
  adminHost = null;
  adminPort = null;
  adminPassword = null;
}
function isAdminConnected() { return !!adminPassword; }
// Everything about the connection EXCEPT the password — this is what the
// status route is allowed to say out loud.
function getAdminConnection() { return { host: adminHost, port: adminPort }; }
function getAdminPassword() { return adminPassword; }

function getPerfActive() { return perfActive; }
function startPerfRecording() {
  perfActive = true;
  perfSamples = [];
  perfStartedAt = new Date().toISOString();
  perfLastDrain = null; // a new recording; the previous drain is no longer replayable
  perfLimit = null;
}
// Flips the desired state to "stop" WITHOUT touching the buffer — this is
// what the record button on the app tab's badge asks for. Only MxScout's own
// page can turn samples into a saved recording (they live in ITS IndexedDB),
// so the buffer has to wait for that page's stopPerfRecording() call below,
// whichever side flipped the flag.
function requestStopPerfRecording() { perfActive = false; }
// Hands back everything collected and empties the buffer in one step — the
// caller (the UI, stopping a recording) gets exactly what it needs to build a
// recording, and a sample that lands a moment later cannot be appended to a
// buffer nobody is reading anymore.
// A second stop of the SAME recording — a browser re-sending a POST whose
// answer was lost, or a double click — answers what the first one answered
// rather than an empty recording. "The buffer is empty and I drained it a
// moment ago, with no recording started since" is the only case this can
// fire in: startPerfRecording clears the replay, so a genuinely empty
// recording still reports itself as empty.
function stopPerfRecording() {
  perfActive = false;
  if (!perfSamples.length && perfLastDrain && (Date.now() - perfLastDrain.at) < PERF_REPLAY_MS) {
    return perfLastDrain.samples;
  }
  const samples = perfSamples;
  perfSamples = [];
  perfStartedAt = null;
  perfLastDrain = { at: Date.now(), samples: samples };
  return samples;
}
function addPerfSample(sample) {
  if (!perfActive) return;
  if (perfSamples.length >= PERF_SAMPLES_MAX) return; // see the comment on the cap
  perfSamples.push(sample);
}
function getPerfSampleCount() { return perfSamples.length; }
function getPerfStartedAt() { return perfStartedAt; }
function setPerfLimit(message) { perfLimit = message || null; }
function getPerfLimit() { return perfLimit; }

// Mint a fresh token and drop any prior report/command — starting a new scan
// session invalidates every script pasted for the previous one.
function startSession() {
  sessionToken = crypto.randomBytes(16).toString('hex');
  pendingCommand = null;
  commandResult = null;
  queryResult = null;
  lastCommandPollAt = null;
  // The admin-port connection is deliberately NOT cleared here. A fresh token
  // invalidates the scripts pasted for the previous session, which is what
  // this function is for — but the recorder does not use a pasted script and
  // does not use the token: it is same-origin only. Connecting to a live app
  // must not silently kill a recording that is already running.

  // Release any request parked by the PREVIOUS session's bridge. Without this
  // its waiter sits in the set for the rest of the long-poll window, and
  // heldPollCount — which is what "connected" is read from — keeps reporting a
  // bridge that can no longer authenticate. The UI would then tell the user
  // they are connected while every one of that bridge's polls is being
  // refused. Waking them empties the set; each one re-polls with its stale
  // token, gets a 403, and stops.
  wakeCommandWaiters();
  return sessionToken;
}

function getSessionToken() { return sessionToken; }

function getPendingCommand() { return pendingCommand; }
function setPendingCommand(command) {
  pendingCommand = command;
  if (command) {
    // Arming supersedes any previous answer. A `query` clears only the query
    // slot and a run clears only the run slot, so browsing data never wipes
    // the record of a flow that was run, and vice versa.
    if (command.kind === 'query') queryResult = null;
    else commandResult = null;
    wakeCommandWaiters();
  }
  return pendingCommand;
}
function markCommandDispatched() { if (pendingCommand) pendingCommand.dispatchedAt = new Date().toISOString(); }
function getCommandResult() { return commandResult; }
function getQueryResult() { return queryResult; }
function setQueryResult(result) { queryResult = result; return queryResult; }
function setCommandResult(result) { commandResult = result; return commandResult; }
function getLastCommandPollAt() { return lastCommandPollAt; }
function touchCommandPoll() { lastCommandPollAt = new Date().toISOString(); }

function clearSession() {
  sessionToken = null;
  pendingCommand = null;
  commandResult = null;
  queryResult = null;
  lastCommandPollAt = null;
  // A full teardown DOES drop the admin connection, password included — this
  // is the "forget everything" path, and the secret goes with everything else.
  perfActive = false;
  perfSamples = [];
  perfStartedAt = null;
  clearAdminConnection();
  wakeCommandWaiters();
}

module.exports = {
  startSession, getSessionToken, clearSession,
  getPendingCommand, setPendingCommand, markCommandDispatched,
  getCommandResult, setCommandResult,
  getQueryResult, setQueryResult,
  getLastCommandPollAt, touchCommandPoll,
  addCommandWaiter, heldPollCount,
  setAdminConnection, clearAdminConnection, isAdminConnected,
  getAdminConnection, getAdminPassword,
  getPerfActive, startPerfRecording, requestStopPerfRecording, stopPerfRecording,
  addPerfSample, getPerfSampleCount, getPerfStartedAt,
  setPerfLimit, getPerfLimit
};
