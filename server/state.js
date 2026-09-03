'use strict';

const crypto = require('crypto');

// MxScout holds NO model server-side — the model lives entirely in the
// browser's own storage. The only server-side state is the current live
// session: a token, the command in flight, and its answer. This is a single-user,
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

// Mint a fresh token and drop any prior report/command — starting a new scan
// session invalidates every script pasted for the previous one.
function startSession() {
  sessionToken = crypto.randomBytes(16).toString('hex');
  pendingCommand = null;
  commandResult = null;
  queryResult = null;
  lastCommandPollAt = null;
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
  wakeCommandWaiters();
}

module.exports = {
  startSession, getSessionToken, clearSession,
  getPendingCommand, setPendingCommand, markCommandDispatched,
  getCommandResult, setCommandResult,
  getQueryResult, setQueryResult,
  getLastCommandPollAt, touchCommandPoll,
  addCommandWaiter, heldPollCount
};
