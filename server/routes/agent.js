'use strict';

// The agent channel: the one place the SERVER ever holds a piece of a model,
// and only because the person pressed "Share with an agent" in the
// Documentation section.
//
// What it holds is the AI pack — the text MxScout already offers as a
// download (public/describe.js) — in this process's memory, until they stop
// sharing, the browser tab says so, or the server exits. It is never written
// to disk and never logged. An agent on the same machine (the mendix-describe
// skill) pulls it from here instead of the person exporting a file and
// dropping it into a folder, and sends the descriptions it wrote back the same
// way — and, the same way, items for the Assist page (tickets it checked, Jira
// issues and ideas it worked out). The server never READS the pack for any purpose of its own; it only
// finds the module ranges in the index the pack already carries, so an agent
// can ask for one module at a time.
//
// Beside the pack, and only with it, the tab hands over the documentation as
// Markdown — the Markdown copy the export writes, of the own modules, with the
// descriptions an agent wrote earlier and a short header — when the project
// has descriptions. It is the agent's map: what was understood before, read
// first, then checked against the pack. Same press, same token, same Host
// check, same memory, dropped with the pack; the tab sends it again whenever
// the descriptions it keeps change. The server reads only its header lines,
// to say in the status how much of it there is.
//
// Who may call. Two things stand between this and anyone else on the machine:
//  - a token minted when sharing starts, returned ONLY to the caller that
//    started it (the browser tab), and required on every other request. A
//    local process, or a page in another browser tab, has no way to read it;
//    starting its own share gets it a token for ITS data, not this one;
//  - a Host check, so a page that rebinds its own name to 127.0.0.1 is
//    refused before the token even matters.
// None of these routes is crossOrigin: a browser page on another origin is
// stopped by the Origin gate in index.js, exactly like the rest of the API.

const crypto = require('crypto');
const { readJsonBody, sendJson } = require('../http-util');
const state = require('../state');

const MAX_PACK_BYTES = 32 * 1024 * 1024;
const MAX_DESCRIPTIONS_BYTES = 16 * 1024 * 1024;
// What an agent sent and the tab has not taken yet waits in a queue, in memory, bounded twice: so many
// messages, so many bytes in all. Past either bound a new one is refused — said, with 429 — and what waits
// stays as it is; nothing is ever dropped to make room.
const MAX_INBOX = 32;
const MAX_INBOX_BYTES = 64 * 1024 * 1024;
const TAKEN_KEPT = 256;   // acknowledged ids and keys remembered, so a resend of one already taken is known
const MAX_DOCS_BYTES = 16 * 1024 * 1024;
const DOCS_HEAD = '# MxScout documentation';

function hostAllowed(req) {
  const host = String(req.headers.host || '').toLowerCase();
  const port = String(process.env.MXSCOUT_PORT || 4289);
  return host === '127.0.0.1:' + port || host === 'localhost:' + port;
}

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
  return m ? m[1] : null;
}

function tokenMatches(provided) {
  const share = state.getAgentShare();
  if (!share || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(share.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Every route except the start of sharing goes through this. 404 when nothing
// is shared (there is nothing to find), 403 for a wrong token.
function guard(req, res) {
  if (!hostAllowed(req)) { sendJson(res, 403, { error: 'This address is not allowed here.' }); return null; }
  const share = state.getAgentShare();
  if (!share) { sendJson(res, 404, { error: 'Nothing is shared. In MxScout: Documentation → Share with an agent.' }); return null; }
  if (!tokenMatches(bearer(req))) { sendJson(res, 403, { error: 'Wrong or missing token.' }); return null; }
  return share;
}

function sendText(res, text) {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

// The pack's own index: "module | from-to | microflows | nanoflows | pages | entities",
// line numbers 1-based and inclusive — see skills/mendix-describe/reference/pack-format.md.
function parseIndex(lines) {
  const at = lines.indexOf('## index');
  if (at < 0) return null;
  const modules = [];
  for (let i = at + 2; i < lines.length && lines[i].trim() !== ''; i++) {
    const m = /^(.+?) \| (\d+)-(\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)$/.exec(lines[i]);
    if (!m) return null;
    const from = Number(m[2]), to = Number(m[3]);
    if (from < 1 || to < from || to > lines.length) return null;
    modules.push({ name: m[1], from, to, microflows: Number(m[4]), nanoflows: Number(m[5]), pages: Number(m[6]), entities: Number(m[7]) });
  }
  return modules;
}

function headerOf(lines) {
  const out = {};
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const m = /^(project|mendix|model|generated): (.*)$/.exec(lines[i]);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// The documentation's header, as public/docs-file.js forAgent writes it: "key: value" lines.
function docsOf(text) {
  const lines = text.split('\n').slice(0, 24);
  const get = (key) => { const l = lines.find((x) => x.startsWith(key + ': ')); return l ? l.slice(key.length + 2) : null; };
  const described = /^(\d+) of (\d+)$/.exec(get('flows described') || '') || [];
  return {
    text, bytes: Buffer.byteLength(text), generatedAt: get('generated'), describedAt: get('described at'),
    described: Number(described[1]) || 0, flows: Number(described[2]) || 0, stale: parseInt(get('out of date') || '0', 10) || 0
  };
}

// POST /api/agent/share — the browser, when the person presses the button.
// Body: { text, docs?, token? }: the pack, and the documentation as Markdown
// when the project has descriptions (null or absent when it has none). The
// same token comes back while the browser keeps sharing (so an agent already
// connected stays connected when the model is replaced or the descriptions
// change); without the current token a new one is minted.
async function handleShare(req, res) {
  if (!hostAllowed(req)) { sendJson(res, 403, { error: 'This address is not allowed here.' }); return; }
  const body = await readJsonBody(req);
  const text = body && body.text;
  if (typeof text !== 'string' || !text.startsWith('# MxScout AI pack\n') || Buffer.byteLength(text) > MAX_PACK_BYTES) {
    sendJson(res, 400, { error: 'That is not an MxScout AI pack, or it is too large.' });
    return;
  }
  const docsText = body.docs === undefined ? null : body.docs;
  if (docsText !== null && (typeof docsText !== 'string' || !docsText.startsWith(DOCS_HEAD) || Buffer.byteLength(docsText) > MAX_DOCS_BYTES)) {
    sendJson(res, 400, { error: 'That is not MxScout documentation, or it is too large.' });
    return;
  }
  const lines = text.split('\n');
  const modules = parseIndex(lines);
  if (!modules) { sendJson(res, 400, { error: 'The pack has no readable index.' }); return; }
  const head = headerOf(lines);
  const previous = state.getAgentShare();
  const keep = previous && typeof body.token === 'string' && tokenMatches(body.token);
  const token = keep ? previous.token : crypto.randomBytes(24).toString('hex');
  // A pack for a different project is a different share: whatever an agent
  // sent back for the old one must not be offered against the new one.
  if (!keep || (previous && previous.project !== head.project)) state.clearAgentInbox();
  const docs = docsText === null ? null : docsOf(docsText);
  // The project's id in the tab's database: an agent may hand it back with what it sends, and the tab then
  // refuses a result meant for another project. Text, bounded; never looked up here.
  const projectId = typeof body.projectId === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(body.projectId) ? body.projectId : null;
  // The project's language of written content, an ISO code ("pl"), or null while it is not chosen.
  const language = typeof body.language === 'string' && /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(body.language) ? body.language.toLowerCase() : null;
  state.setAgentShare({ token, text, lines, modules, docs, language, projectId, project: head.project || '', mendix: head.mendix || null, model: head.model || null, generated: head.generated || null, sharedAt: new Date().toISOString(), lastReadAt: keep ? previous.lastReadAt : null });
  console.log('Agent channel: sharing ' + modules.length + ' modules (' + Math.round(text.length / 1024) + ' KB' + (docs ? ', documentation ' + Math.round(docs.bytes / 1024) + ' KB' : '') + ', held in memory)');
  sendJson(res, 200, { token, modules: modules.length });
}

function handleStopShare(req, res) {
  if (!guard(req, res)) return;
  state.clearAgentShare();
  console.log('Agent channel: sharing stopped');
  sendJson(res, 200, { ok: true });
}

function summary(share) {
  return {
    project: share.project, projectId: share.projectId || null, mendix: share.mendix, model: share.model || null, generated: share.generated, sharedAt: share.sharedAt, language: share.language || null,
    modules: share.modules.map((m) => ({ name: m.name, lines: m.from + '-' + m.to, microflows: m.microflows, nanoflows: m.nanoflows, pages: m.pages, entities: m.entities }))
  };
}

// GET /api/agent/status — the agent's first call: what is shared, by module.
// The browser also reads it, to show whether an agent has connected.
function handleStatus(req, res) {
  const share = guard(req, res);
  if (!share) return;
  const queue = state.getAgentInbox();
  const docs = share.docs;
  const oldest = queue[0] || null;
  sendJson(res, 200, Object.assign(summary(share), {
    lastReadAt: share.lastReadAt,
    // The documentation an agent may read first (GET /api/agent/docs): null when the project has no descriptions yet.
    documentation: docs ? { generatedAt: docs.generatedAt, describedAt: docs.describedAt || null, bytes: docs.bytes, flows: docs.flows, described: docs.described, stale: docs.stale } : null,
    // The oldest result still waiting for the tab, and how many wait.
    descriptions: oldest ? meta(oldest) : null,
    inbox: { waiting: queue.length, max: MAX_INBOX }
  }));
}

// GET /api/agent/module?name=X — one module's section, the lines the index
// gives for it. This is the lazy read: an agent asks for what it is about to
// write about and no more.
function handleModule(req, res) {
  const share = guard(req, res);
  if (!share) return;
  const name = req.query.get('name');
  const mod = share.modules.find((m) => m.name === name);
  if (!mod) { sendJson(res, 404, { error: 'No such module in what is shared.' }); return; }
  share.lastReadAt = new Date().toISOString();
  sendText(res, share.lines.slice(mod.from - 1, mod.to).join('\n') + '\n');
}

// GET /api/agent/pack — the whole text, for the checker that compares
// fingerprints with an earlier descriptions file. It goes to a file on the
// agent's side; it is the agent's reading that is bounded to one module.
function handlePack(req, res) {
  const share = guard(req, res);
  if (!share) return;
  share.lastReadAt = new Date().toISOString();
  sendText(res, share.text);
}

// GET /api/agent/docs — the documentation as Markdown: what an agent
// understood earlier, the map it reads before the pack. 404, saying so, when
// the project has no descriptions yet: the pack is all there is.
function handleDocs(req, res) {
  const share = guard(req, res);
  if (!share) return;
  if (!share.docs) {
    sendJson(res, 404, { error: 'No documentation yet: this project has no descriptions. The AI pack is all there is — read it by module.', documentation: false });
    return;
  }
  share.lastReadAt = new Date().toISOString();
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Length': share.docs.bytes });
  res.end(share.docs.text);
}

// POST /api/agent/descriptions — the agent hands back the descriptions file
// it wrote, or items for the Assist page (an envelope with format
// "mxscout-assist": tickets it checked, Jira issues and ideas it worked out,
// or a move of one — public/assist.js), or solved cases (an envelope with
// format "mxscout-knowledge": the notes an agent wrote when a case was solved,
// for the tab to write into the project's knowledge/ — public/knowledge.js).
// Each waits, unread, in a queue until the tab takes it; the tab checks it with
// the same parser as a file import, and keeps it as the person set the project's
// "save at once". The server looks at the format, the size and the two optional
// fields below, and nothing else — it writes nothing, a solved case included.
//
// The queue (an external audit, 2026-10-15, B04 — it was one slot, so a second
// result replaced an unread first one, and the tab's acknowledgement of the first
// then removed the second):
//  - every message gets an id, in the order it came; the tab takes the oldest;
//  - the same text sent again while it waits is not queued twice: the answer
//    names the message already waiting ("duplicate": true). So is a message with
//    the same Idempotency-Key header (a retry), while it waits or after the tab
//    took it — the last 256 taken are remembered;
//  - full (32 messages, or 64 MB in all), a new one is refused with 429, saying
//    so, and nothing that waits is touched;
//  - "projectId" and "snapshot" in the body, when the agent gives them (the
//    project's id from the status, the model version it read), go with the
//    message, so the tab can refuse a result meant for another project.
const FORMATS_IN = ['mxscout-descriptions', 'mxscout-assist', 'mxscout-knowledge'];
const SAFE = /^[A-Za-z0-9._:@ \/+-]{1,200}$/;
function meta(m) {
  return { id: m.id, receivedAt: m.receivedAt, bytes: m.bytes, format: m.format, projectId: m.projectId, snapshot: m.snapshot };
}
async function handleDescriptionsIn(req, res) {
  const share = guard(req, res);
  if (!share) return;
  const body = await readJsonBody(req);
  const raw = JSON.stringify(body);
  if (!body || typeof body !== 'object' || FORMATS_IN.indexOf(body.format) === -1 || raw.length > MAX_DESCRIPTIONS_BYTES) {
    sendJson(res, 400, { error: 'That is not a descriptions file (format "mxscout-descriptions"), Assist items (format "mxscout-assist") or solved cases (format "mxscout-knowledge"), or it is too large.' });
    return;
  }
  const keyIn = req.headers['idempotency-key'];
  const key = typeof keyIn === 'string' && SAFE.test(keyIn) ? keyIn : null;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const queue = state.getAgentInbox();
  const same = queue.find((m) => m.hash === hash || (key && m.key === key));
  if (same) { sendJson(res, 200, { accepted: true, duplicate: true, id: same.id, format: same.format, waiting: queue.length }); return; }
  const done = key ? state.getAgentTaken().find((x) => x.key === key) : null;
  if (done) { sendJson(res, 200, { accepted: true, duplicate: true, taken: true, id: done.id, format: body.format, waiting: queue.length }); return; }
  const bytes = queue.reduce((n, m) => n + m.bytes, 0);
  if (queue.length >= MAX_INBOX || bytes + raw.length > MAX_INBOX_BYTES) {
    sendJson(res, 429, { error: 'MxScout has ' + queue.length + ' results from an agent still waiting to be taken — the most it holds — so this one was not queued, and nothing that waits was touched. Open the project in MxScout (Documentation) so it takes them, then send this again.', waiting: queue.length, max: MAX_INBOX });
    return;
  }
  const text = (v) => (typeof v === 'string' && SAFE.test(v) ? v : null);
  const m = state.pushAgentInbox({
    id: crypto.randomBytes(6).toString('hex'), receivedAt: new Date().toISOString(), bytes: raw.length, format: body.format, text: raw,
    hash, key, projectId: text(body.projectId), snapshot: text(body.snapshot)
  });
  sendJson(res, 200, { accepted: true, id: m.id, format: body.format, waiting: queue.length });
}

// GET /api/agent/inbox — the tab, for what an agent sent: the oldest message that
// waits, whole, and how many wait; ?list=1 lists them all without their text.
// DELETE /api/agent/inbox?id=<id> — the tab took (or set aside) THAT message: it
// goes, and nothing else does. An id that is not there (taken before, or never
// sent) removes nothing; without an id the request is refused.
function handleInboxGet(req, res) {
  if (!guard(req, res)) return;
  const queue = state.getAgentInbox();
  if (req.query.get('list')) { sendJson(res, 200, { waiting: queue.length, max: MAX_INBOX, messages: queue.map(meta) }); return; }
  const m = queue[0];
  if (!m) { sendJson(res, 200, { pending: false, waiting: 0 }); return; }
  sendJson(res, 200, Object.assign({ pending: true, waiting: queue.length, text: m.text }, meta(m)));
}

function handleInboxClear(req, res) {
  if (!guard(req, res)) return;
  const id = req.query.get('id');
  if (!id) { sendJson(res, 400, { error: 'Say which message was taken: DELETE /api/agent/inbox?id=<id>.' }); return; }
  const m = state.takeAgentInbox(id, TAKEN_KEPT);
  sendJson(res, 200, { ok: true, removed: !!m, waiting: state.getAgentInbox().length });
}

module.exports = {
  handleShare, handleStopShare, handleStatus, handleModule, handlePack, handleDocs,
  handleDescriptionsIn, handleInboxGet, handleInboxClear
};
