'use strict';

const crypto = require('crypto');
const { readJsonBody, sendJson } = require('../http-util');
const state = require('../state');

// The bridge runs on the TARGET Mendix app's origin (its own tab), not ours —
// so everything it sends back is cross-origin and needs explicit CORS. This is
// the ONLY route group in MxScout reachable from another origin; everything
// else stays same-origin only (enforced in index.js). We reflect the request's
// own Origin rather than a blanket '*' purely so browsers that refuse
// wildcard-origin POSTs still work — it is no more permissive than '*' would
// be, since these endpoints take no credentials and only hold what the bridge
// just read, in memory.
function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handlePreflight(req, res) {
  setCors(req, res);
  res.writeHead(204);
  res.end();
}

// Every bridge request carries the session token; this is the one check that
// decides whether it is honoured. Compared in constant time so the length of a
// mismatch cannot be read off the response timing — belt-and-braces on a
// loopback-only, 128-bit-random token, but it costs nothing and it is the kind
// of thing a reviewer looks for.
function tokenMatches(provided) {
  const expected = state.getSessionToken();
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Same-origin only (Origin-gated in index.js): the MxScout UI mints a fresh
// session token right before it generates a snippet. A new token invalidates
// any snippet pasted for a previous session.
function handleStartSession(req, res) {
  const token = state.startSession();
  sendJson(res, 200, { token });
}

// ---------- live execution ----------
// Deliberately separate from the read-only report handlers above — arming a
// command is the one thing in MxScout that can make the TARGET app actually
// write/commit/open something, so it gets its own validation.
//
// Unlike MxSonar, the qualifiedName is NOT cross-checked against a server-side
// model — MxScout keeps no model on the server. That check moves to the
// client: arming is same-origin only (Origin-gated in index.js), the UI only
// offers flows that exist in the loaded model, and every run is gated behind
// the one-time danger acknowledgment plus a per-run confirm naming the flow
// and its objects. The server still enforces shape, bounds and the session
// token, and dispatches each command exactly once. There is no malicious
// same-origin actor to defend against here — this is the user's own local
// tool — so this is the equivalent guarantee, not a weaker one.
// `query` is read-only and shares this channel with the run kinds on purpose:
// one bridge in the app tab serves both, so the user pastes one snippet
// instead of two. They are still validated separately below — a query carries
// no object parameters and can never become a run.
const KIND_OK = { microflow: 1, nanoflow: 1, query: 1, lookup: 1, create: 1, observed: 1 };
const GUID_RE = /^\d{1,25}$/;
const PENDING_COMMAND_TTL_MS = 30000; // a command nobody picks up shouldn't wait forever
const LONG_POLL_MS = 25000;          // how long a bridge poll is held open before replying empty
// How long since the last poll STARTED before a bridge counts as gone. It must
// exceed a whole poll cycle, because the timestamp is stamped once per cycle
// (at the top of the handler, right after the token check) and a cycle can
// legitimately last the full long-poll window plus however long the app takes
// to answer a query.
//
// It was 5s, from back when the bridge polled every 1.5s. Long-polling made
// that wrong in a way that showed up as a flicker: while the app tab was busy
// answering, no request was parked and the last one had started more than five
// seconds ago, so the UI decided the bridge had gone — and replaced the table
// the user was reading with the instructions for connecting a bridge that was
// right there, working.
const LISTENER_STALE_MS = LONG_POLL_MS + 10000;
const MAX_PAGE_SIZE = 100;

function isCommandStale(command) {
  if (!command) return false;
  return Date.now() - new Date(command.armedAt).getTime() > PENDING_COMMAND_TTL_MS;
}

// Always an array of ids, never a bare singular one — a List-typed flow
// parameter needs more than one guid bound to the SAME parameter, which is
// a different thing from two DIFFERENT parameters sharing a name (still
// rejected below). Both a single-object parameter and a list one travel the
// same shape; only the array's length differs.
// Shared cap for any user-supplied string reaching the app tab — a flow's
// value input here, an attribute value on a created object below.
const MAX_VALUE_STRING = 1000;

function validateObjectParams(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('objectParams must be an array');
  const seen = new Set();
  return raw.slice(0, 50).map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Each object parameter must be an object');
    const name = typeof entry.name === 'string' ? entry.name.slice(0, 200) : '';
    if (!name) throw new Error('Each object parameter needs a name');
    if (seen.has(name)) throw new Error('Duplicate object parameter: ' + name);
    seen.add(name);
    const rawGuids = Array.isArray(entry.guids) ? entry.guids : [];
    if (!rawGuids.length) throw new Error('Parameter ' + name + ' needs at least one object id');
    const guids = rawGuids.slice(0, 50).map((g) => {
      const guid = typeof g === 'string' ? g : String(g);
      if (!GUID_RE.test(guid)) throw new Error('Parameter ' + name + ': id must be a plain numeric object id');
      return guid;
    });
    const entityQualifiedName = typeof entry.entityQualifiedName === 'string' ? entry.entityQualifiedName.slice(0, 300) : null;
    // Attribute values to set on the object before the run — validated exactly
    // like a create's values (bounded, attribute-shaped keys, JSON-safe
    // primitives; a bad key is dropped, not fatal). Only single-object
    // parameters carry them, but the shape is checked regardless.
    const overrides = validateValues(entry.overrides);
    const out = { name, guids, entityQualifiedName };
    if (Object.keys(overrides).length) out.overrides = overrides;
    return out;
  });
}

// A flow's plain-value inputs (String/Integer/Long/Decimal/Boolean/…), as
// typed by the user. Same posture as validateValues above: bounded, coerced
// to one of three JSON-safe primitive types, no model here to check a name
// against. Unlike objectParams, an entry with an empty value is legal — it
// means "leave this one to the flow's own default" — but the NAME still has
// to be there, since it is what the value gets bound to.
function validateScalarParams(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('scalarParams must be an array');
  const seen = new Set();
  const out = [];
  raw.slice(0, 50).forEach((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Each value parameter must be an object');
    const name = typeof entry.name === 'string' ? entry.name.slice(0, 200) : '';
    if (!name) throw new Error('Each value parameter needs a name');
    if (seen.has(name)) throw new Error('Duplicate value parameter: ' + name);
    seen.add(name);
    let value = entry.value;
    if (value === '' || value == null) return; // not supplied — the flow's own default stands
    if (typeof value === 'boolean') { /* as-is */ }
    else if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Parameter ' + name + ': not a finite number'); }
    else value = String(value).slice(0, MAX_VALUE_STRING);
    out.push({ name, value });
  });
  return out;
}

// The bridge's first call after being pasted: "can this page reach MxScout at
// all?". Cross-origin and token-gated like the poll. Its real job is to make
// the CSP case DIAGNOSABLE — a failure here is what tells the snippet to fall
// back to rendering its panel inside the app page instead of failing silently.
function handleBridgePing(req, res) {
  setCors(req, res);
  if (!tokenMatches(req.query.get('token'))) {
    sendJson(res, 403, { error: 'Invalid or missing token — reconnect in MxScout for a fresh snippet.' });
    return;
  }
  state.touchCommandPoll();
  sendJson(res, 200, { ok: true });
}

const ATTR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function validateAttrNames(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200).filter((n) => typeof n === 'string' && ATTR_NAME_RE.test(n));
}

// Values to set on a freshly `mx.data.create`d object. Same posture as
// validateAttrNames: a bad key is silently dropped rather than a reason to
// reject the whole command — there is no server-side model to check a key
// against (see this file's own header comment), so "attribute name shaped
// like an attribute name" is as far as validation can honestly go here.
function validateValues(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('values must be an object');
  const out = {};
  Object.keys(raw).slice(0, 100).forEach((k) => {
    if (!ATTR_NAME_RE.test(k)) return;
    const v = raw[k];
    if (v === null || v === undefined) { out[k] = null; return; }
    if (typeof v === 'boolean' || typeof v === 'number') { out[k] = v; return; }
    out[k] = String(v).slice(0, MAX_VALUE_STRING);
  });
  return out;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// Same-origin only (Origin-gated in index.js) — a page in another tab cannot
// reach this even though the BRIDGE side (ping/poll/result/data) must be
// cross-origin.
async function handleSetCommand(req, res) {
  const body = await readJsonBody(req);
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!KIND_OK[kind]) { sendJson(res, 400, { error: 'kind must be one of microflow, nanoflow, query, lookup, create, observed' }); return; }
  const qualifiedName = typeof body.qualifiedName === 'string' ? body.qualifiedName.slice(0, 300) : '';
  // `observed` asks the bridge about its OWN watch buffer — what guids went
  // past. It names no entity or flow, so it alone needs no qualifiedName.
  // Everything else must name its target.
  if (kind !== 'observed' && !qualifiedName) { sendJson(res, 400, { error: 'qualifiedName is required' }); return; }

  const command = {
    id: crypto.randomBytes(12).toString('hex'),
    kind, qualifiedName,
    armedAt: new Date().toISOString(), dispatchedAt: null
  };

  // `observed` carries nothing but its kind — no target, no params, no
  // search — so it is armed straight through. The bridge answers it from its
  // own in-memory watch buffer via the shared data channel.
  if (kind === 'observed') {
    command.objectParams = [];
    state.setPendingCommand(command);
    console.log('bridge ' + kind + ': requested');
    sendJson(res, 200, { ok: true, commandId: command.id });
    return;
  }

  // query / lookup / create all report through the SAME data channel
  // (POST/GET /api/session/data) — one row (or none, on error) is exactly
  // that channel's existing shape, whether it came from an xpath page, a
  // guid lookup, or a freshly created object. None of the three carry
  // objectParams — that field cannot be turned into a run by sending extra
  // fields, because nothing here copies it across for these kinds.
  if (kind === 'query' || kind === 'lookup' || kind === 'create') {
    command.objectParams = [];
    command.columns = validateAttrNames(body.columns);
    // searchAttrs are interpolated into an XPath predicate by the bridge, so
    // they are restricted to plain identifiers here. Nothing hostile is
    // expected on this route — it is same-origin from MxScout's own UI — but
    // a name that could carry XPath syntax must not be able to reach that
    // string concatenation, whatever sends it.
    command.searchAttrs = validateAttrNames(body.searchAttrs);
    // Which ONE field the search is aimed at, and its type so the bridge can
    // pick contains() vs equality. Same restriction as searchAttrs and for
    // the same reason: both are interpolated into an XPath predicate, so
    // only a plain identifier may reach that concatenation. 'id' is a legal
    // field name here and passes the same check.
    command.searchField = typeof body.searchField === 'string' && ATTR_NAME_RE.test(body.searchField) ? body.searchField : '';
    command.searchType = typeof body.searchType === 'string' ? body.searchType.slice(0, 40).replace(/[^A-Za-z]/g, '') : '';
    command.search = typeof body.search === 'string' ? body.search.slice(0, 200) : '';
    command.offset = clampInt(body.offset, 0, 1e7, 0);
    command.amount = clampInt(body.amount, 1, MAX_PAGE_SIZE, 10);
    if (kind === 'lookup') {
      const guid = typeof body.guid === 'string' ? body.guid : String(body.guid == null ? '' : body.guid);
      if (!GUID_RE.test(guid)) { sendJson(res, 400, { error: 'guid must be a plain numeric object id' }); return; }
      command.guid = guid;
    }
    if (kind === 'create') {
      try { command.values = validateValues(body.values); }
      catch (e) { sendJson(res, 400, { error: e.message }); return; }
    }
    state.setPendingCommand(command);
    // The entity and the page window — never the search term or the values,
    // which are user input that may echo real data.
    console.log('bridge ' + kind + ':', qualifiedName, 'offset', command.offset, 'amount', command.amount);
    sendJson(res, 200, { ok: true, commandId: command.id });
    return;
  }

  let objectParams, scalarParams;
  try {
    objectParams = validateObjectParams(body.objectParams);
    scalarParams = validateScalarParams(body.scalarParams);
  } catch (e) { sendJson(res, 400, { error: e.message }); return; }
  command.objectParams = objectParams;
  command.scalarParams = scalarParams;
  state.setPendingCommand(command);
  // Which flow/kind and parameter COUNT — never the object ids, the value
  // parameters themselves, or any other data.
  console.log('live-execute ARMED:', kind, qualifiedName,
    '(' + objectParams.length + ' object param(s), ' + scalarParams.length + ' value param(s))');
  sendJson(res, 200, { ok: true, commandId: command.id });
}

function handleClearCommand(req, res) {
  state.setPendingCommand(null);
  sendJson(res, 200, { ok: true });
}

function handleGetCommandStatus(req, res) {
  let pending = state.getPendingCommand();
  if (isCommandStale(pending)) { state.setPendingCommand(null); pending = null; }
  const lastPollAt = state.getLastCommandPollAt();
  const listenerConnected = state.heldPollCount() > 0 ||
    (!!lastPollAt && (Date.now() - new Date(lastPollAt).getTime()) < LISTENER_STALE_MS);
  sendJson(res, 200, { pending, result: state.getCommandResult(), listenerConnected });
}

// Cross-origin — the listener runs on the TARGET app's own tab. Token travels
// as a query param (plain GET, no body); loopback-only traffic and the token
// is never logged.
// Hands out at most one command, exactly once. A second poll arriving before
// the result comes back must NOT re-run the same flow, which is why dispatch
// is marked here and not on the result.
function dispatchIfAny(res) {
  let pending = state.getPendingCommand();
  if (isCommandStale(pending)) { state.setPendingCommand(null); pending = null; }
  if (!pending || pending.dispatchedAt) return false;
  state.markCommandDispatched();
  const command = {
    id: pending.id, kind: pending.kind,
    qualifiedName: pending.qualifiedName,
    objectParams: pending.objectParams,
    scalarParams: pending.scalarParams || []
  };
  if (pending.kind === 'query' || pending.kind === 'lookup' || pending.kind === 'create') {
    command.search = pending.search;
    command.offset = pending.offset;
    command.amount = pending.amount;
    command.columns = pending.columns;
    command.searchAttrs = pending.searchAttrs;
    command.searchField = pending.searchField;
    command.searchType = pending.searchType;
    if (pending.kind === 'lookup') command.guid = pending.guid;
    if (pending.kind === 'create') command.values = pending.values;
  }
  sendJson(res, 200, { command });
  return true;
}

// Cross-origin — the bridge runs on the TARGET app's own tab. Token travels
// as a query param (plain GET, no body); loopback-only traffic and the token
// is never logged.
//
// With ?wait=1 the response is HELD OPEN until a command is armed or
// LONG_POLL_MS passes. That is what makes typing in MxScout's search box feel
// live: the keystroke reaches the app tab as soon as it is armed, instead of
// waiting out a polling interval. An idle bridge costs one parked request
// rather than a request per second.
function handleCommandPoll(req, res) {
  setCors(req, res);
  if (!tokenMatches(req.query.get('token'))) {
    sendJson(res, 403, { error: 'Invalid or missing token — reconnect in MxScout for a fresh snippet.' });
    return;
  }
  state.touchCommandPoll();
  if (dispatchIfAny(res)) return;
  if (req.query.get('wait') !== '1') { sendJson(res, 200, { command: null }); return; }

  let settled = false;
  let removeWaiter = null;
  const timer = setTimeout(() => finish(true), LONG_POLL_MS);

  function finish(timedOut) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (removeWaiter) removeWaiter();
    // No touchCommandPoll() here. The timestamp is stamped once, at the top of
    // this handler, right after the token was checked. Re-stamping it on the
    // way out would re-mark a poll belonging to a SUPERSEDED session as
    // recent — which is how a new session came to inherit an old bridge's
    // "connected" state.
    if (timedOut) { sendJson(res, 200, { command: null }); return; }
    if (!dispatchIfAny(res)) sendJson(res, 200, { command: null });
  }

  removeWaiter = state.addCommandWaiter(() => finish(false));
  // A tab that navigates or closes mid-wait leaves a dead response behind;
  // without this the waiter would sit in the set until the next wake.
  req.on('close', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (removeWaiter) removeWaiter();
  });
}

// The rows a `query` read out of the live app. This is REAL APPLICATION DATA
// arriving cross-origin, so it gets the same treatment as a scan sample:
// every value coerced to a bounded string, nothing logged but counts, nothing
// written to disk.
function sanitizeQueryData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rows = Array.isArray(raw.rows) ? raw.rows.slice(0, MAX_PAGE_SIZE) : [];
  return {
    rows: rows.map((row) => {
      if (!row || typeof row !== 'object') return null;
      const cells = {};
      const src = row.cells && typeof row.cells === 'object' ? row.cells : {};
      Object.keys(src).slice(0, 200).forEach((k) => {
        const v = src[k];
        if (v === null || v === undefined) { cells[String(k).slice(0, 200)] = null; return; }
        const str = typeof v === 'string' ? v : String(v);
        cells[String(k).slice(0, 200)] = str.slice(0, 500);
      });
      // Which of those values the app said this session may write (see
      // writableCells in public/bridge.js). Booleans only, and only for
      // columns that actually came back — the same posture as the cells
      // themselves: whatever shape arrives, what leaves here is a known one.
      // An absent or unusable map becomes null, which the UI reads as "the
      // runtime would not say", and it marks nothing.
      let writable = null;
      const w = row.writable && typeof row.writable === 'object' ? row.writable : null;
      if (w) {
        writable = {};
        Object.keys(cells).forEach((k) => {
          if (w[k] === true) writable[k] = true;
          else if (w[k] === false) writable[k] = false;
        });
        if (!Object.keys(writable).length) writable = null;
      }
      return { id: row.id == null ? null : String(row.id).slice(0, 60), cells, writable };
    }).filter(Boolean),
    total: typeof raw.total === 'number' && Number.isFinite(raw.total) ? raw.total : null,
    offset: clampInt(raw.offset, 0, 1e7, 0),
    amount: clampInt(raw.amount, 1, MAX_PAGE_SIZE, 10),
    more: !!raw.more
  };
}

async function handleReportQueryResult(req, res) {
  setCors(req, res);
  const body = await readJsonBody(req);
  if (!tokenMatches(body.token)) {
    console.log('bridge query result REJECTED — token mismatch');
    sendJson(res, 403, { error: 'Invalid or missing token.' });
    return;
  }
  const pending = state.getPendingCommand();
  const commandId = typeof body.commandId === 'string' ? body.commandId : null;
  if (!pending || !commandId || commandId !== pending.id) {
    // The user typed another character and superseded this page before it came
    // back. Normal, not an error — the bridge does not need to hear about it.
    sendJson(res, 200, { ok: true });
    return;
  }
  const result = {
    id: commandId,
    ok: !!body.ok,
    message: typeof body.message === 'string' ? body.message.slice(0, 300) : null,
    data: sanitizeQueryData(body.data),
    reportedAt: new Date().toISOString()
  };
  state.setQueryResult(result);
  // Row COUNT only. The rows themselves are the customer's data.
  console.log('bridge query result:', pending.qualifiedName || pending.kind, '->',
    result.ok ? ((result.data ? result.data.rows.length : 0) + ' row(s)') : 'FAILED');
  sendJson(res, 200, { ok: true });
}

// Same-origin: the MxScout UI collecting the answer to the query it armed.
function handleGetQueryResult(req, res) {
  sendJson(res, 200, state.getQueryResult());
}

async function handleReportCommandResult(req, res) {
  setCors(req, res);
  const body = await readJsonBody(req);
  if (!tokenMatches(body.token)) {
    console.log('live-execute result REJECTED — token mismatch');
    sendJson(res, 403, { error: 'Invalid or missing token.' });
    return;
  }
  const pending = state.getPendingCommand();
  const commandId = typeof body.commandId === 'string' ? body.commandId : null;
  // A result for an already-cancelled/superseded command is not an error the
  // listener needs to see — just nothing to record.
  if (!pending || !commandId || commandId !== pending.id) {
    console.log('live-execute result ignored — no matching pending command (stale or superseded)');
    sendJson(res, 200, { ok: true });
    return;
  }
  const result = {
    id: commandId,
    ok: !!body.ok,
    message: typeof body.message === 'string' ? body.message.slice(0, 300) : null,
    reportedAt: new Date().toISOString()
  };
  state.setCommandResult(result);
  console.log('live-execute result:', pending.kind, pending.qualifiedName, '->', result.ok ? 'ok' : 'FAILED', result.message || '');
  sendJson(res, 200, { ok: true });
}

module.exports = {
  handlePreflight, handleStartSession, handleBridgePing,
  handleReportQueryResult, handleGetQueryResult,
  handleSetCommand, handleClearCommand, handleGetCommandStatus,
  handleCommandPoll, handleReportCommandResult
};
