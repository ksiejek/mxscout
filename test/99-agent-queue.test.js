/* What an agent sends back waits in a queue, not in one slot (server/routes/agent.js, public/docs.js — an
 * external audit, 2026-10-15, B04: two results A and B were both "accepted", only B was kept, and the tab's
 * acknowledgement — which named nothing — then removed B as well).
 *
 * What has to hold:
 *  - each message gets an id; GET gives the oldest, and how many wait; ?list=1 lists them;
 *  - DELETE names the id it took, and removes that one alone: an acknowledgement of an old id never removes a
 *    newer message; without an id it is refused;
 *  - the same text sent twice while it waits, or the same Idempotency-Key (a retry, also after it was taken),
 *    is not queued twice;
 *  - full, a new one is refused with 429, saying so, and what waits is untouched;
 *  - projectId and snapshot travel with a message, and the tab refuses one for another project;
 *  - in the app: ten results sent before the tab reads arrive exactly once each. */
'use strict';
const { goToDocsTab } = require('./helpers');
const MODEL = require('./model');

module.exports = async function (t) {
  const B = t.MX;
  // The project seeded and opened here, not with the helper: the helper also connects a running app.
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe', 15000, 'MxScout loaded');
  await mx.evaluate(`MxStore.saveProjectWithModel({ id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null }, ${JSON.stringify(MODEL)}).then(function () { return true; })`);
  await mx.navigate(t.MX);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.waitFor(`!!Array.from(${SW}('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(${SW}('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.tree-section')`, 10000, 'project open');
  const pack = await mx.evaluate(`MxStore.getModel('p1').then(function (m) { return MxDescribe.pack(MxDocsData.build(m, { name: 'Demo' })).text; })`);
  const H = (token, more) => Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, more || {});
  const env = (id, title) => JSON.stringify({ format: 'mxscout-assist', version: 1, items: [{ id: id, kind: 'other', title: title || 'Result ' + id }] });
  const post = (token, body, more) => fetch(B + '/api/agent/descriptions', { method: 'POST', headers: H(token, more), body: body });
  const json = async (r) => ({ status: r.status, body: await r.json() });

  // ---- the server alone: a share no tab polls ----
  const started = await json(await fetch(B + '/api/agent/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: pack, projectId: 'p1' }) }));
  const tok = started.body.token;
  t.ok(started.status === 200 && tok, 'a share started');
  const inbox = async () => (await json(await fetch(B + '/api/agent/inbox', { headers: H(tok) }))).body;
  const list = async () => (await json(await fetch(B + '/api/agent/inbox?list=1', { headers: H(tok) }))).body;
  const ack = async (id) => json(await fetch(B + '/api/agent/inbox' + (id ? '?id=' + encodeURIComponent(id) : ''), { method: 'DELETE', headers: H(tok) }));

  const a = await json(await post(tok, env('a-1', 'Result A')));
  const b = await json(await post(tok, env('b-1', 'Result B')));
  t.ok(a.body.accepted && b.body.accepted && a.body.id !== b.body.id, 'two results, each accepted with an id of its own');
  const first = await inbox();
  t.ok(first.pending && first.id === a.body.id && first.waiting === 2 && /Result A/.test(first.text), 'GET gives the oldest, whole, and says two wait');
  t.ok((await ack()).status === 400, 'an acknowledgement that names no id is refused — it cannot clear what it did not read');
  // The race the audit described: the tab read A, B arrived, the tab acknowledges A.
  const c = await json(await post(tok, env('c-1', 'Result C, arriving while A is taken')));
  const ackA = await ack(a.body.id);
  t.ok(ackA.body.removed === true && ackA.body.waiting === 2, 'acknowledging A removes A alone: B and C still wait');
  const stale = await ack(a.body.id);
  t.ok(stale.body.removed === false && stale.body.waiting === 2, 'acknowledging A again — an old id — removes nothing: the newer messages stay');
  const l1 = await list();
  t.ok(JSON.stringify(l1.messages.map((m) => m.id)) === JSON.stringify([b.body.id, c.body.id]) && l1.messages.every((m) => !('text' in m)), '?list=1 lists what waits, in order, without the text');

  // ---- duplicates ----
  const dup = await json(await post(tok, env('b-1', 'Result B')));
  t.ok(dup.body.duplicate === true && dup.body.id === b.body.id && (await list()).waiting === 2, 'the same text sent again while it waits is not queued twice: the answer names the one that waits');
  const k1 = await json(await post(tok, env('k-1', 'With a key'), { 'Idempotency-Key': 'run-42/part-1' }));
  const k2 = await json(await post(tok, env('k-1', 'With a key, sent again, reworded'), { 'Idempotency-Key': 'run-42/part-1' }));
  t.ok(!k1.body.duplicate && k2.body.duplicate === true && k2.body.id === k1.body.id, 'a retry with the same Idempotency-Key is not queued twice, even when its text differs');
  await ack(k1.body.id);
  const k3 = await json(await post(tok, env('k-1', 'With a key, a third time'), { 'Idempotency-Key': 'run-42/part-1' }));
  t.ok(k3.body.duplicate === true && k3.body.taken === true && (await list()).waiting === 2, 'and not after it was taken either: the answer says it was taken');

  // ---- projectId and snapshot travel with a message ----
  const withIds = JSON.stringify({ format: 'mxscout-assist', version: 1, projectId: 'p1', snapshot: 'main @ a1b2c3d', items: [{ id: 'ids-1', kind: 'other', title: 'With ids' }] });
  const ids = await json(await post(tok, withIds));
  const meta = (await list()).messages.find((m) => m.id === ids.body.id);
  const status = (await json(await fetch(B + '/api/agent/status', { headers: H(tok) }))).body;
  t.ok(meta && meta.projectId === 'p1' && meta.snapshot === 'main @ a1b2c3d' && status.projectId === 'p1' && status.inbox.waiting === 3 && status.descriptions.id === b.body.id,
    'projectId and snapshot go with the message; the status names the project’s id, the oldest waiting and how many wait');

  // ---- full ----
  const sent = [];
  for (let i = 0; i < 40; i++) {
    const r = await post(tok, env('fill-' + i));
    sent.push(r.status);
    if (r.status === 429) { const body = await r.json(); sent.push(body.error); break; }
  }
  const after = await list();
  t.ok(sent.indexOf(429) === 29 && /still waiting to be taken/.test(sent[30]) && after.waiting === 32 && after.messages[0].id === b.body.id,
    'full — 32 waiting — the next is refused with 429 and says why; nothing that waited was touched: ' + sent.slice(28).join(' | '));
  await fetch(B + '/api/agent/share', { method: 'DELETE', headers: H(tok) });
  t.ok((await fetch(B + '/api/agent/inbox', { headers: H(tok) })).status === 404, 'stopped, the queue goes with the share');

  // ---- in the app: ten results sent before the tab reads arrive exactly once ----
  await goToDocsTab(mx, 'agent', '.docs-agent button');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent')`, 10000, 'share button');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent').click()`);
  const line = await mx.waitFor(`(function(){ var c = document.querySelector('.docs-agent .code-value'); return c && c.textContent; })()`, 10000, 'connection line');
  const token = (/token ([0-9a-f]{48})\./.exec(line) || [])[1];
  const ten = [];
  for (let i = 1; i <= 10; i++) ten.push(post(token, env('ten-' + i, 'One of ten, number ' + i)));
  const answers = await Promise.all(ten.map(async (p) => (await p).json()));
  t.ok(answers.every((x) => x.accepted && !x.duplicate) && new Set(answers.map((x) => x.id)).size === 10, 'ten results sent at once: each accepted, each with its own id');
  await mx.waitFor(`MxStore.get('assist', 'p1').then(function (r) { return !!r && r.items.filter(function (x) { return /^ten-/.test(x.id); }).length === 10; })`, 30000, 'all ten kept');
  // Every one of them taken once: added once, never written again; and nothing waits.
  await new Promise((r) => setTimeout(r, 2500));
  const once = await mx.evaluate(`MxStore.get('assist', 'p1').then(function (r) {
    var ten = r.items.filter(function (x) { return /^ten-/.test(x.id); });
    return JSON.stringify({ n: ten.length, twice: ten.filter(function (x) { return x.history.filter(function (h) { return /Handed in|Written again/.test(h.what); }).length !== 1; }).map(function (x) { return x.id; }) });
  })`);
  const left = (await json(await fetch(B + '/api/agent/inbox?list=1', { headers: H(token) }))).body;
  t.ok(once === JSON.stringify({ n: 10, twice: [] }) && left.waiting === 0, 'all ten arrive in the app exactly once — each handed in once, never written again — and the queue is empty: ' + once);

  // ---- a result for another project is refused by the tab ----
  await post(token, JSON.stringify({ format: 'mxscout-assist', version: 1, projectId: 'someone-elses', items: [{ id: 'wrong-1', kind: 'other', title: 'For another project' }] }));
  const said = await mx.waitFor(`(function(){ var w = document.querySelector('.docs-agent .warn-text'); return w && /another project \\(someone-elses\\)/.test(w.textContent) && w.textContent; })()`, 8000, 'refused');
  t.ok(!!said && await mx.evaluate(`MxStore.get('assist', 'p1').then(function (r) { return !r.items.some(function (x) { return x.id === 'wrong-1'; }); })`),
    'a result that says it is for another project is not kept, and the card says so: ' + said);
  await mx.evaluate(`(function(){ var x = Array.from(document.querySelectorAll('.docs-agent button')).find(function (n) { return n.textContent === 'Dismiss'; }); if (x) x.click(); return true; })()`);
  await mx.waitFor(`fetch('/api/agent/inbox?list=1', { headers: { Authorization: 'Bearer ${token}' } }).then(function (r) { return r.json(); }).then(function (j) { return j.waiting === 0; })`, 6000, 'dismissed');
  t.ok(true, 'Dismiss takes it off the queue');
  await mx.evaluate(`(function(){ var x = Array.from(document.querySelectorAll('.docs-agent button')).find(function (n) { return n.textContent === 'Stop sharing'; }); if (x) x.click(); return true; })()`);
};
