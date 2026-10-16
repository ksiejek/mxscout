#!/usr/bin/env node
/* A self-test of check-assist.js, with invented items of an invented sales app. No dependencies — Node only.
 *
 *   node selftest.js
 *
 * It checks that every example in reference/assist-format.md passes the checker (so the format and the
 * checker cannot drift apart), that what MxScout would refuse is an error, that `list` reads a project
 * folder's assist/ and inbox/, that a solved case's note is checked — personal data among it — and found
 * by `cases`, and that the command line answers with the right exit codes — with the reference files' lines
 * ending in \n or in \r\n (a Windows checkout), alike. It writes
 * only into a temporary folder of its own, removed at the end.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { check, list, cases } = require('./check-assist.js');

let passed = 0, failed = 0;
function ok(cond, message) {
  if (cond) { passed++; console.log('  ok  ' + message); } else { failed++; console.log('  FAIL ' + message); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- the examples in the format reference pass, with no warning ----
// Read with Windows line ends too (a checkout with core.autocrlf): the examples are found by \n alone.
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const format = lf(fs.readFileSync(path.join(__dirname, 'reference', 'assist-format.md'), 'utf8'));
const examples = [];
format.replace(/```json\n([\s\S]*?)\n```/g, (m, body) => { examples.push(JSON.parse(body)); return m; });
ok(examples.length >= 3 && examples.every((e) => e.format === 'mxscout-assist'), 'assist-format.md carries ' + examples.length + ' examples, each JSON and an Assist envelope');
const kindsShown = new Set();
examples.forEach((e, i) => {
  const r = check(e);
  e.items.forEach((it) => kindsShown.add(it.kind));
  ok(r.errors.length === 0 && r.warnings.length === 0, 'example ' + (i + 1) + ' (' + e.items.map((it) => it.kind + ' ' + it.id).join(', ') + ') passes' + (r.errors.length + r.warnings.length ? ': ' + r.errors.concat(r.warnings).join(' / ') : ''));
});
ok(['ticket', 'jira', 'idea', 'other'].every((k) => kindsShown.has(k)), 'the examples show every kind');

// ---- invented items, and what the checker makes of them ----
const ticket = examples[0].items[0];
const jira = examples[1].items[0];
const idea = examples[2].items.find((it) => it.kind === 'idea');
const other = examples[2].items.find((it) => it.kind === 'other');
const env = (...items) => ({ format: 'mxscout-assist', version: 1, items });
const errorsOf = (e) => check(e).errors.join(' / ');
const warningsOf = (e) => check(e).warnings.join(' / ');

ok(/"format" must be "mxscout-assist"/.test(errorsOf({ format: 'mxscout-descriptions', version: 1, items: [ticket] })), 'a descriptions file is not an Assist envelope');
ok(/"tickets" belongs to no file/.test(errorsOf(Object.assign(env(ticket), { tickets: [] }))), 'tickets in the envelope are refused: they are items now');
ok(/at least one item/.test(errorsOf(env())), 'an envelope with no items is refused');
ok(/"kind" must be one of/.test(errorsOf(env(Object.assign(clone(ticket), { kind: 'bug' })))), 'an unknown kind is refused');
ok(/"verdict" must be one of/.test(errorsOf(env(Object.assign(clone(ticket), { verdict: 'maybe' })))), 'a verdict outside its list is refused');
ok(/"status" must be one of/.test(errorsOf(env(Object.assign(clone(jira), { status: 'closed' })))), 'a status outside its list is refused');
ok(/drop the leading #/.test(errorsOf(env(Object.assign(clone(ticket), { id: '#4711' })))), 'a ticket number with a # is refused, with the reason');
ok(/no number in it/.test(warningsOf(env(Object.assign(clone(jira), { id: 'discounts' })))), 'a Jira key without a number is a warning: ask for it');
ok(/must be a slug/.test(errorsOf(env(Object.assign(clone(idea), { id: 'Reorder From History' })))), 'an idea id that is not a slug is refused');
ok(/must be a slug/.test(errorsOf(env(Object.assign(clone(other), { id: '../escape' })))), 'an id that would leave assist/ is refused');
ok(/appear twice/.test(errorsOf(env(ticket, ticket))), 'the same kind and id twice in one file is refused');
ok(/not an ISO date/.test(errorsOf(env(Object.assign(clone(ticket), { created: '15.10.2026' })))), 'a date that is not ISO is refused');
ok(/"planned" must be an ISO date/.test(errorsOf(env(Object.assign(clone(jira), { planned: '2026-02-30' })))), 'a date that does not exist is refused');
ok(/"by" must be "person" or "agent"/.test(errorsOf(env(Object.assign(clone(ticket), { history: [{ date: '2026-10-15', what: 'Checked.', by: 'claude' }] })))), 'history says who: a person or the agent');
ok(/"history" is required/.test(errorsOf(env(Object.assign(clone(other), { history: undefined })))), 'an item without history is refused');
ok(/set "closed"/.test(warningsOf(env(Object.assign(clone(jira), { status: 'done' })))), 'done without a closed date is a warning');
ok(/"scope" is required/.test(errorsOf(env(Object.assign(clone(jira), { scope: undefined })))), 'a Jira issue needs its scope');
ok(/scope.feasible must be one of/.test(errorsOf(env(Object.assign(clone(jira), { scope: Object.assign({}, jira.scope, { feasible: 'sure' }) })))), 'feasibility is yes, partly or no');
ok(/proposal.changes must list/.test(errorsOf(env(Object.assign(clone(idea), { proposal: Object.assign({}, idea.proposal, { changes: [] }) })))), 'a proposal names at least one model change');
ok(/"action" must be add, change or remove/.test(errorsOf(env(Object.assign(clone(idea), { proposal: Object.assign({}, idea.proposal, { changes: [{ kind: 'page', target: 'Orders.Order_Detail_Customer', action: 'rename', what: 'x' }] }) })))), 'a model change is added, changed or removed');
ok(/"now" is required/.test(errorsOf(env(Object.assign(clone(idea), { now: undefined })))), 'an idea says how it works now');
ok(/propose the fix/.test(warningsOf(env(Object.assign(clone(ticket), { fix: undefined })))), 'a bug without a fix is a warning');
ok(/what would settle it/.test(warningsOf(env(Object.assign(clone(ticket), { verdict: 'cannot-tell', fix: undefined, needs: [] })))), 'cannot-tell without needs is a warning');
ok(/not a field of a ticket \(it is one of a Jira issue, of an idea\)/.test(warningsOf(env(Object.assign(clone(ticket), { effort: 'small' })))), 'a field of another kind is a warning, and says whose it is');

ok(/ISO 639 code/.test(warningsOf(env(Object.assign(clone(ticket), { language: 'Polish' })))) && !warningsOf(env(Object.assign(clone(ticket), { language: 'pl' }))), 'an item\'s language is an ISO code ("pl"), not a name');

ok(/"setLanguage": true needs "language"/.test(errorsOf(Object.assign(env(ticket), { setLanguage: true }))) && !errorsOf(Object.assign(env(ticket), { setLanguage: true, language: 'pl' })), 'setLanguage sets the project\'s language, so it needs one');

// ---- questions to the reporter, the thread, waiting, and an update ----
const waiting = examples[3].items[0];
const update = examples[4].items[0];
ok(waiting.status === 'waiting' && waiting.questions.length === 2 && waiting.thread.length === 1, 'the format shows a ticket waiting for the reporter, with its questions and thread');
ok(update.update === true && !update.title, 'and an update that carries only what changed');
ok(/"status" must be one of/.test(errorsOf(env(Object.assign(clone(waiting), { questions: [Object.assign({}, waiting.questions[0], { status: 'pending' })] })))), 'a question is open, answered or dropped');
ok(/"why" is required/.test(errorsOf(env(Object.assign(clone(waiting), { questions: [Object.assign({}, waiting.questions[0], { why: '' })] })))), 'a question says why it matters');
ok(/the id appears twice/.test(errorsOf(env(Object.assign(clone(waiting), { questions: [waiting.questions[0], waiting.questions[0]] })))), 'question ids are unique in the item');
ok(/the status is "waiting"/.test(warningsOf(env(Object.assign(clone(waiting), { status: 'open' })))), 'open questions on an open item: the status is waiting');
ok(/"waiting" with no open question/.test(warningsOf(env(Object.assign(clone(waiting), { questions: waiting.questions.map((q) => Object.assign({}, q, { status: 'dropped' })) })))), 'waiting with nothing asked is a warning');
ok(/"from" must be one of reporter, person, agent/.test(errorsOf(env(Object.assign(clone(waiting), { thread: [{ date: '2026-10-17', from: 'customer', text: 'x' }] })))), 'a thread entry is from the reporter, the person or the agent');
ok(/not one of the item's questions/.test(errorsOf(env(Object.assign(clone(waiting), { thread: [{ date: '2026-10-17', from: 'reporter', text: 'A customer.', answers: ['q9'] }] })))), 'a thread entry answers the item\'s own questions');
ok(/still open — mark it answered/.test(warningsOf(env(Object.assign(clone(waiting), { thread: waiting.thread.concat([{ date: '2026-10-18', from: 'reporter', text: 'A customer.', answers: ['q2'] }]) })))), 'an answered question left open is a warning');
ok(/set "answered" to the date/.test(warningsOf(env(Object.assign(clone(waiting), { status: 'open', questions: waiting.questions.map((q) => Object.assign({}, q, { status: 'answered' })) })))), 'an answered question carries its date');
const answer = { id: 'SD-4720', kind: 'ticket', update: true, updated: '2026-10-18', status: 'in-progress',
  questions: [{ id: 'q1', status: 'answered', answered: '2026-10-18' }, { id: 'q2', status: 'answered', answered: '2026-10-18' }],
  thread: [{ date: '2026-10-18', from: 'reporter', text: "I'm a customer, it says I'm not allowed to change Notes.", answers: ['q1', 'q2'] }] };
ok(!errorsOf(env(answer)) && !warningsOf(env(answer)), 'an update records the reporter\'s answer and the questions it answers, without the whole item');
ok(/an update carries only/.test(errorsOf(env(Object.assign(clone(answer), { verdict: 'bug' })))), 'an update cannot change the verdict: that is the whole item again');
ok(/"updated" is required/.test(errorsOf(env(Object.assign(clone(answer), { updated: undefined })))), 'an update says when');
ok(/"text" is required/.test(errorsOf(env(Object.assign(clone(answer), { questions: [{ id: 'q3', status: 'open', text: '' }] })))), 'a new question in an update comes whole');

// ---- --pack: names against the model ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mendix-assist-selftest-'));
try {
  const packFile = path.join(tmp, 'ai-pack.md');
  fs.writeFileSync(packFile, [
    '# MxScout AI pack', 'format: mxscout-ai-pack 1', 'project: Sales', '', '## index', 'module | lines', 'Orders | 7-12', '',
    '## module Orders', '### entities', 'E Order #1a2b3c4d | attrs: Status:Enumeration Orders.ENUM_OrderStatus',
    '### MF Orders.ACT_Order_Cancel #0a1b2c3d', '### MF Orders.SUB_Order_ChangeStatus #1b2c3d4e', '### MF Orders.DS_Order_QueueForClerk #2c3d4e5f', ''
  ].join('\n'));
  const goodFile = path.join(tmp, 'assist.SD-4711.json');
  fs.writeFileSync(goodFile, JSON.stringify(examples[0], null, 2));
  const run = (args) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(__dirname, 'check-assist.js')].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  let r = run(['check', goodFile, '--pack', packFile]);
  ok(r.code === 0 && /OK: 1 item/.test(r.out) && !/not in the pack/.test(r.out), 'check --pack: a ticket naming flows the pack has passes');
  const typo = clone(examples[0]); typo.items[0].traced.flows.push('Orders.DS_Order_QueueForClerks');
  fs.writeFileSync(goodFile, JSON.stringify(typo));
  r = run(['check', goodFile, '--pack', packFile]);
  ok(r.code === 0 && /Orders\.DS_Order_QueueForClerks, which is not in the pack/.test(r.out), 'check --pack: a name the model does not have is a warning');
  fs.writeFileSync(goodFile, JSON.stringify(env(Object.assign(clone(ticket), { verdict: 'wontfix' }))));
  r = run(['check', goodFile]);
  ok(r.code === 1 && /MxScout would refuse/.test(r.out), 'check: a file with errors exits 1');
  r = run(['nonsense']);
  ok(r.code === 2 && /Usage/.test(r.out), 'an unknown command prints the usage and exits 2');

  // ---- list: a project folder ----
  const folder = path.join(tmp, 'Sales');
  const put = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true }); fs.writeFileSync(path.join(folder, rel), JSON.stringify(obj, null, 2)); };
  r = run(['list', path.join(tmp, 'nowhere')]);
  ok(r.code === 1, 'list: a folder that is not there exits 1');
  fs.mkdirSync(folder);
  ok(list(folder).hasAssist === false && /no items kept/.test(run(['list', folder]).out), 'list: a project with no assist/ says so');
  put('assist/tickets/SD-4711.json', ticket);
  put('assist/jira/SALES-88.json', jira);
  put('assist/ideas/reorder-from-history.json', idea);
  put('assist/other/who-can-reopen-an-order.json', other);
  put('assist/tickets/SD-4720.json', waiting);
  put('inbox/assist-SD-4712.json', env(Object.assign(clone(ticket), { id: 'SD-4712' })));
  fs.writeFileSync(path.join(folder, 'assist', 'tickets', 'broken.json'), '{ not json');
  const all = list(folder);
  ok(all.items.length === 5 && ['SD-4720', 'SD-4711', 'SALES-88', 'reorder-from-history', 'who-can-reopen-an-order'].every((id) => all.items.some((x) => x.id === id)), 'list: reads one item per file, every kind');
  ok(all.items.find((x) => x.id === 'SALES-88').planned === '2026-11-20' && all.items.find((x) => x.id === 'who-can-reopen-an-order').status === 'done', 'list: with each one\'s status and planned date');
  ok(all.problems.length === 1 && /broken\.json/.test(all.problems[0]), 'list: an unreadable file is named, not skipped silently');
  ok(all.waiting.length === 1 && /assist-SD-4712\.json/.test(all.waiting[0]), 'list: the files still waiting in inbox/');
  ok(list(folder, { status: 'open,in-progress' }).items.every((x) => x.status === 'open' || x.status === 'in-progress') && list(folder, { status: 'open,in-progress' }).items.length === 3 && list(folder, { status: 'waiting' }).items.length === 1, 'list --status keeps only those statuses');
  ok(list(folder, { kind: 'jira' }).items.length === 1, 'list --kind keeps only that kind');
  ok(all.items.find((x) => x.id === 'SD-4720').asked === 2, 'list counts the questions still open');
  r = run(['list', folder]);
  ok(r.code === 0 && /SALES-88 \| open \| - \| 2026-11-20/.test(r.out) && /SD-4711 \| open \(bug\) \| -/.test(r.out) && /SD-4720 \| waiting \(cannot-tell\) \| 2/.test(r.out) && /waiting in inbox/.test(r.out), 'list on the command line prints status, verdict and planned date');

  // ---- list: a project kept inside the Mendix project (mxscout/), its Assist items personal, in .local/ ----
  const app = path.join(tmp, 'OrderPortal');
  fs.mkdirSync(path.join(app, 'mxscout', '.local', 'assist', 'jira'), { recursive: true });
  fs.writeFileSync(path.join(app, 'OrderPortal.mpr'), '');
  fs.writeFileSync(path.join(app, 'mxscout', 'mxscout.json'), JSON.stringify({ format: 'mxscout-project', layout: 2, id: 'x', name: 'OrderPortal' }));
  fs.writeFileSync(path.join(app, 'mxscout', '.local', 'assist', 'jira', 'SALES-88.json'), JSON.stringify(jira));
  ok(list(app).items.length === 1 && list(path.join(app, 'mxscout')).items.length === 1, 'list: the Mendix project, or its mxscout/, reads the items in mxscout/.local/assist/');
  r = run(['list', app]);
  ok(r.code === 0 && /SALES-88/.test(r.out), 'list on the command line, given the Mendix project');

  // ---- a solved case: the note, checked, and found ----
  const kf = lf(fs.readFileSync(path.join(__dirname, 'reference', 'knowledge-format.md'), 'utf8'));
  const note = (/```markdown\n([\s\S]*?)\n```/.exec(kf) || [])[1] + '\n';
  ok(/^---\nid: "SD-4711"/.test(note), 'knowledge-format.md carries a whole case note as its example');
  const kdir = path.join(app, 'mxscout', 'knowledge');
  fs.mkdirSync(kdir, { recursive: true });
  const kfile = path.join(kdir, 'SD-4711-cancelled-orders-still-in-the-queue.md');
  fs.writeFileSync(kfile, note);
  r = run(['knowledge', kfile]);
  ok(r.code === 0 && /^OK: ticket SD-4711/m.test(r.out) && !/warning/.test(r.out), 'knowledge: the format\'s example passes, with no warning: ' + r.out.trim().split('\n').pop());
  const bad = (edit, name) => { const f = path.join(kdir, name || 'SD-4711-x.md'); fs.writeFileSync(f, edit(note)); const x = run(['knowledge', f]); fs.unlinkSync(f); return x; };
  r = bad((t) => t.replace('A clerk\'s queue', 'Reported by Anna Nowak (anna.nowak@example.com, +48 600 700 800): a clerk\'s queue'));
  ok(r.code === 1 && /an e-mail address/.test(r.out) && /a phone number/.test(r.out) && /who reported it/.test(r.out), 'knowledge: an e-mail address, a phone number and a "Reported by" line are errors — no personal data');
  r = bad((t) => t.replace('Records in a list', 'Order 281474976710657 and records in a list'));
  ok(r.code === 1 && /a long number/.test(r.out), 'knowledge: a long number (a record id from production) is an error');
  r = bad((t) => t.replace('## What did not work', '## Notes'));
  ok(r.code === 1 && /"## What did not work" is missing/.test(r.out), 'knowledge: each of the five sections is required');
  r = bad((t) => t.replace('status: "solved"', 'status: "fixed"'));
  ok(r.code === 1 && /"status" must be one of solved, workaround, wont-fix, as-designed/.test(r.out), 'knowledge: the status is one of its list');
  r = bad((t) => t, 'other-name.md');
  ok(r.code === 1 && /must start with the id/.test(r.out), 'knowledge: the file name starts with the id');
  r = bad((t) => t.replace(/^---\n/, ''));
  ok(r.code === 1 && /front matter/.test(r.out), 'knowledge: a note without front matter cannot be read');
  fs.writeFileSync(path.join(kdir, 'SALES-90-discount-rules.md'), note.replace(/SD-4711/g, 'SALES-90').replace('kind: "ticket"', 'kind: "jira"').replace(/Cancelled orders still in the queue/g, 'Discount rules').replace(/"queue", "cancelled", "status", "clerk"/, '"discount"').replace(/"Orders\.ACT_Queue_Retrieve", "Orders\.ACT_Order_Cancel"/, '"Sales.ACT_Discount"').replace(/fingerprints: .*\n/, '').replace(/\n# [\s\S]*$/, '\n# SALES-90 — Discount rules\n\n## Problem\n\nDiscounts were applied twice.\n\n## Cause\n\nTwo flows applied them.\n\n## Solution\n\nOne does now.\n\n## What did not work\n\nNothing else was tried.\n\n## How to recognise it next time\n\nA price lower than expected.\n'));
  const found = cases(app, { find: 'queue cancelled' });
  ok(found.cases.length === 2 && found.cases[0].id === 'SD-4711' && found.cases[0].score > found.cases[1].score, 'cases: every note in mxscout/knowledge/, the best match first');
  const packText = ['format: mxscout-ai-pack 1', 'project: OrderPortal', '', '## module Orders', '### MF Orders.ACT_Queue_Retrieve #77777777', '### MF Orders.ACT_Order_Cancel #0b9a3e44'].join('\n') + '\n';
  fs.writeFileSync(path.join(tmp, 'pack.md'), packText);
  r = run(['cases', app, '--find', 'queue', '--pack', path.join(tmp, 'pack.md')]);
  ok(r.code === 0 && /of 2 cases match/.test(r.out) && /may be out of date: Orders\.ACT_Queue_Retrieve changed since \(#5c0e7d21 → #77777777\)/.test(r.out) && !/ACT_Order_Cancel changed/.test(r.out),
    'cases --pack: a flow whose fingerprint moved since the case marks it "may be out of date"');
  ok(/checked against a1b2c3d/.test(r.out), 'cases says which commit each case was checked against');
  ok(cases(path.join(tmp, 'Sales')).cases.length === 0 && /No solved cases/.test(run(['cases', path.join(tmp, 'Sales')]).out), 'cases: a project with no knowledge/ says so');

  // ---- the Mendix project kept clean: working files in the work folder, only the documentation in the project ----
  const agent = path.join(__dirname, '..', 'mendix-describe', 'agent.js');
  if (fs.existsSync(agent)) {
    const work = path.join(tmp, 'work');
    const envW = Object.assign({}, process.env, { MXSCOUT_WORK: work, MXSCOUT_TOKEN: '', MXSCOUT_FOLDER: '' });
    const runIn = (file, args) => { try { return { code: 0, out: execFileSync(process.execPath, [file].concat(args), { cwd: app, env: envW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
    const files = (dir) => { const out = []; (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((n) => { if (n.isDirectory()) walk(path.join(d, n.name)); else out.push(path.relative(dir, path.join(d, n.name)).split(path.sep).join('/')); }); })(dir); return out.sort(); };
    fs.writeFileSync(path.join(app, 'mxscout', '.local', 'documentation.md'), '# MxScout documentation\n\nproject: OrderPortal\n');
    r = runIn(agent, ['workdir']);
    ok(r.code === 0 && r.out.trim() === work && fs.existsSync(work), 'agent.js workdir prints the work folder ($MXSCOUT_WORK here) and makes it');
    const had = files(app);
    r = runIn(agent, ['docs', '--out', 'docs.md']);
    ok(r.code === 0 && fs.existsSync(path.join(work, 'docs.md')) && r.out.indexOf(path.join(work, 'docs.md')) !== -1, 'agent.js docs --out docs.md, run in the Mendix project, lands in the work folder and says the full path');
    r = runIn(agent, ['docs', '--out', path.join(app, 'docs.md')]);
    ok(r.code === 1 && /Refusing to write/.test(r.out) && /agent\.js workdir/.test(r.out), 'an --out inside the Mendix project is refused, pointing at the work folder');
    r = runIn(agent, ['docs', '--out', path.join(app, 'mxscout', 'docs', 'mine.md')]);
    ok(r.code === 1 && /Refusing to write/.test(r.out), 'even into mxscout/docs/: only agent.js\'s own writers write there');
    fs.writeFileSync(path.join(work, 'assist.SD-4711.json'), JSON.stringify(examples[0], null, 2));
    r = runIn(path.join(__dirname, 'check-assist.js'), ['check', 'assist.SD-4711.json']);
    ok(r.code === 0 && /OK: 1 item/.test(r.out), 'check-assist.js check finds a file named alone in the work folder');
    r = runIn(agent, ['send', 'assist.SD-4711.json']);
    ok(r.code === 0 && fs.readdirSync(path.join(app, 'mxscout', '.local', 'inbox')).some((f) => /assist\.SD-4711\.json$/.test(f)), 'agent.js send hands it from the work folder to mxscout/.local/inbox/');
    const draft = 'SD-4800-cancelled-orders-still-in-the-queue.md';
    fs.writeFileSync(path.join(work, draft), note.replace(/SD-4711/g, 'SD-4800'));
    r = runIn(path.join(__dirname, 'check-assist.js'), ['knowledge', draft]);
    ok(r.code === 0 && /^OK: ticket SD-4800/m.test(r.out) && !/warning/.test(r.out), 'a case note drafted in the work folder is checked there, with no warning');
    fs.writeFileSync(path.join(work, 'SD-4801-x.md'), note.replace(/SD-4711/g, 'SD-4801').replace('A clerk\'s queue', 'Reported by anna.nowak@example.com: a clerk\'s queue'));
    r = runIn(agent, ['case', 'SD-4801-x.md']);
    ok(r.code === 1 && /not written/.test(r.out) && !fs.existsSync(path.join(kdir, 'SD-4801-x.md')), 'agent.js case refuses a note with personal data, and writes nothing');
    r = runIn(agent, ['case', draft]);
    ok(r.code === 0 && fs.readFileSync(path.join(kdir, draft), 'utf8') === note.replace(/SD-4711/g, 'SD-4800') && r.out.indexOf(path.join(kdir, draft)) !== -1, 'agent.js case writes the checked note into mxscout/knowledge/');
    const added = files(app).filter((f) => had.indexOf(f) === -1);
    ok(added.length === 2 && added.some((f) => /^mxscout\/\.local\/inbox\/[^/]+assist\.SD-4711\.json$/.test(f)) && added.indexOf('mxscout/knowledge/' + draft) !== -1,
      'and the Mendix project gained only the documentation and the inbox file — no working file: ' + added.join(', '));
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log((failed ? 'FAILED: ' : 'All passed: ') + passed + ' passed, ' + failed + ' failed.');
process.exit(failed ? 1 : 0);
