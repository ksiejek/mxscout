/* The skills' command line on a Mendix project with no MxScout and no browser (skills/mendix-describe/agent.js ·
 * check-descriptions.js · mendix-assist), after the external audit of 2026-10-15:
 *
 *  - B02/B10, the current model: every command takes the pack of the model as it is now — made from the .mpr
 *    (and mprcontents/) and kept in the work folder under a stamp of it — and says which snapshot it used. A
 *    fresh checkout with no .local/ needs nothing else (status, todo --folder, write, update-docs). A stale
 *    .local/ai-pack.md is never used while the .mpr can be read, and a pack kept for an older .mpr (v1), or
 *    for an older unit in mprcontents/ with HEAD the same (v2), is never used once the model changed.
 *  - B03, nothing written unchecked: version 999, a broken schema, a name not in the model, "changes" in a
 *    descriptions file, another snapshot — each an error, exit code 1, and not one byte of
 *    the project changed. --dry-run prints the plan (text and JSON) and writes nothing. write merges by
 *    default and removes nothing the file does not name; --replace removes, says what, and keeps a copy.
 *    docs/ that cannot be made means nothing is written; --no-docs writes the rest and says docs/ was left.
 *  - B09, docs/ as its manifest says: a file missing or changed is found by update-docs (exit 1, nothing
 *    written) and verify-docs, and update-docs --repair writes it again, byte for byte.
 *  - a case note and docs/ in one step; send checks what it hands over too.
 *  - the skills' descriptions: at most 1024 characters each (older Codex refuses longer), the trigger phrases
 *    each answers to, and which one does what; the old "changes" protocol only in reference/migration.md.
 *  - mendix-assist's selftest passes with its reference files in CRLF, as a Windows checkout has them. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

module.exports = async function (t) {
  const skills = path.join(__dirname, '..', 'skills');
  const agent = path.join(skills, 'mendix-describe', 'agent.js');
  const checker = path.join(skills, 'mendix-describe', 'check-descriptions.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-cli-'));
  const work = path.join(tmp, 'work');
  const env = Object.assign({}, process.env, { MXSCOUT_TOKEN: '', MXSCOUT_FOLDER: '', MXSCOUT_WORK: work, MXSCOUT_URL: '' });
  const run = (file, args) => {
    const r = spawnSync(process.execPath, [file].concat(args), { cwd: tmp, env, encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout || '', out: (r.stdout || '') + (r.stderr || '') };
  };
  const A = (...a) => run(agent, a);
  // Every file under a folder with the SHA-256 of its bytes: "not one byte changed" is this, before and after.
  const bytes = (dir) => {
    const out = {};
    (function walk(d, rel) {
      fs.readdirSync(d, { withFileTypes: true }).forEach((n) => {
        if (n.isDirectory()) walk(path.join(d, n.name), rel + n.name + '/');
        else out[rel + n.name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(d, n.name))).digest('hex');
      });
    })(dir, '');
    return JSON.stringify(out);
  };
  const C = 'c'.repeat(40);
  // A Mendix project as a fresh clone has it: the .mpr, .git on main, mxscout/mxscout.json — no .local/.
  function project(name, v2) {
    const dir = path.join(tmp, name);
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'fixtures', v2 ? 'mpr-v2.db' : 'mpr-v1.db'), path.join(dir, name + '.mpr'));
    if (v2) {
      const units = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8'));
      Object.keys(units).forEach((rel) => { fs.mkdirSync(path.dirname(path.join(dir, 'mprcontents', rel)), { recursive: true }); fs.writeFileSync(path.join(dir, 'mprcontents', rel), Buffer.from(units[rel], 'base64')); });
    }
    put('.git/HEAD', 'ref: refs/heads/main\n');
    put('.git/refs/heads/main', C + '\n');
    put('mxscout/mxscout.json', JSON.stringify({ format: 'mxscout-project', layout: 2, id: 'cli-' + name.toLowerCase(), name, contentLanguage: 'en', describedAt: null }, null, 2) + '\n');
    return dir;
  }
  // The same length, so the .mpr's SQLite pages and a unit's BSON stay what they were, only the entity renamed.
  const rename = (file) => { const b = fs.readFileSync(file); const s = b.toString('latin1').split('Customer').join('Customex'); fs.writeFileSync(file, Buffer.from(s, 'latin1')); };

  try {
    // ---- a fresh checkout: no .local/, no MxScout ----
    const repo = project('ShopApp');
    let r = A('status', '--folder', repo);
    const snap = (/^snapshot: ([0-9a-f]{12}) — /m.exec(r.out) || [])[1];
    t.ok(r.code === 0 && snap && /^snapshot: [0-9a-f]{12} — made from ShopApp\.mpr now/m.test(r.out) && /^Sales \| \d+-\d+ \|/m.test(r.out) && !fs.existsSync(path.join(repo, 'mxscout', '.local')),
      'a fresh checkout: status makes the pack from the .mpr, says which snapshot, lists the modules, and writes nothing into the project: ' + (r.out.match(/^snapshot: .*$/m) || [''])[0]);
    r = A('status', '--folder', repo);
    t.ok(/^snapshot: [0-9a-f]{12} — made from ShopApp\.mpr, kept in the work folder — the model has not changed since/m.test(r.out) && fs.readdirSync(path.join(work, 'snapshot')).length === 1,
      'run again, it uses the pack kept in the work folder for the same model');
    r = run(checker, ['todo', '--folder', repo, '--list']);
    t.ok(r.code === 0 && new RegExp('^snapshot: ' + snap + ' — ').test(r.out) && /flows to describe in 1 modules/.test(r.out) && /Sales\.CreateOrder/.test(r.out),
      'check-descriptions.js todo --folder on a fresh checkout: the same resolver, the same snapshot, the work listed: ' + r.out.split('\n')[1]);

    // ---- write: checked, merged, docs/ with it ----
    const pack = fs.readFileSync(path.join(work, 'snapshot', fs.readdirSync(path.join(work, 'snapshot'))[0]), 'utf8');
    const hash = (qn) => (new RegExp('^### MF ' + qn.replace('.', '\\.') + ' #([0-9a-f]{8})', 'm').exec(pack) || [])[1];
    const desc = { format: 'mxscout-descriptions', version: 1, project: 'ShopApp', language: 'en', by: 'test agent', snapshot: snap,
      modules: { Sales: { summary: 'Sales holds the orders.' } },
      microflows: { 'Sales.CreateOrder': { text: 'Creates an order.', hash: hash('Sales.CreateOrder') }, 'Sales.SweepOrders': { text: 'Sweeps old orders.', hash: hash('Sales.SweepOrders') } },
      risks: [{ level: 'P2', title: 'Sweep deletes orders', detail: 'Without a check.', fix: 'Add a check.', theme: 'delete', where: ['Sales.SweepOrders'] }] };
    const putWork = (name, value) => fs.writeFileSync(path.join(work, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    putWork('desc.json', desc);
    r = A('write', 'desc.json', '--folder', repo, '--dry-run');
    t.ok(r.code === 0 && /^Dry run — nothing written\. \d+ to add, 1 to change, 0 to remove/m.test(r.out) && /^ {2}add {5}descriptions\/modules\/Sales\.json$/m.test(r.out) && /^ {2}add {5}docs\/index\.md$/m.test(r.out) &&
      !fs.existsSync(path.join(repo, 'mxscout', 'descriptions')), 'write --dry-run: the files it would add, change and remove — descriptions/, mxscout.json, docs/ — and nothing written');
    r = A('write', 'desc.json', '--folder', repo, '--dry-run', '--json');
    let plan = null;
    try { plan = JSON.parse(r.stdout); } catch (e) { plan = null; }
    t.ok(plan && plan.dryRun === true && plan.mode === 'merge' && plan.snapshot === snap && plan.files.some((f) => f.path === 'mxscout.json' && f.action === 'change') && plan.files.some((f) => f.path === 'docs/manifest.json' && f.action === 'add'),
      'and --json: the same plan as JSON, with the mode and the snapshot');
    r = A('write', 'desc.json', '--folder', repo);
    t.ok(r.code === 0 && /^Wrote 3 file\(s\) in .*descriptions \(merge\); they describe main @ ccccccc\.$/m.test(r.out) && /^docs\/ written from them: \d+ of \d+ file\(s\) changed/m.test(r.out) &&
      fs.existsSync(path.join(repo, 'mxscout', 'docs', 'index.md')) && fs.readdirSync(path.join(repo, 'mxscout', 'descriptions')).every((f) => f[0] !== '.') && fs.readdirSync(path.join(repo, 'mxscout', 'docs')).every((f) => f[0] !== '.'),
      'write: the descriptions and docs/ in one step, nothing staged left behind: ' + r.out.split('\n').find((l) => /^Wrote/.test(l)));
    t.ok(/docs\/ is current/.test(A('update-docs', '--folder', repo).out), 'and update-docs finds docs/ current');

    // ---- B03: one error and not one byte of the project changes ----
    const before = bytes(repo);
    const refused = [
      ['version 999', { format: 'mxscout-descriptions', version: 999 }, /"version" is 999/],
      ['a broken schema', { format: 'mxscout-descriptions', version: 1, add: true, risks: 'lots' }, /"risks" must be a list/],
      ['a flow not in the model', { format: 'mxscout-descriptions', version: 1, add: true, microflows: { 'Sales.NoSuchFlow': 'Does nothing.' } }, /Sales\.NoSuchFlow: not in the pack/],
      ['"changes" in a descriptions file', { format: 'mxscout-descriptions', version: 1, add: true, changes: [] }, /"changes" are not descriptions any more: a change is an Assist item \(kind "idea"\)/],
      ['another snapshot', { format: 'mxscout-descriptions', version: 1, add: true, snapshot: '000000000000', microflows: { 'Sales.CreateOrder': 'Creates.' } }, /the model now is snapshot [0-9a-f]{12} — it changed since/]
    ];
    const held = refused.map(([what, value, re]) => {
      putWork('bad.json', value);
      const x = A('write', 'bad.json', '--folder', repo);
      return { what, ok: x.code === 1 && re.test(x.out) && /nothing was written/.test(x.out) && bytes(repo) === before, out: x.out };
    });
    t.ok(held.every((h) => h.ok), 'write refuses, exit code 1, with not one byte of the project changed: ' + held.map((h) => h.what + (h.ok ? '' : ' FAILED: ' + h.out.trim().split('\n').slice(-2).join(' / '))).join('; '));
    t.ok(fs.existsSync(path.join(repo, 'mxscout', 'descriptions', 'modules', 'Sales.json')), 'the audit’s case: after version 999, the module that was described is still there');
    putWork('other.json', { format: 'mxscout-descriptions', version: 1, add: true, project: 'OtherApp', microflows: { 'Sales.NotHere': 'Creates.' } });
    r = A('write', 'other.json', '--folder', repo);
    t.ok(r.code === 1 && /warning: "project" is "OtherApp", but this is ShopApp/.test(r.out) && /Sales\.NotHere: not in the pack/.test(r.out) && bytes(repo) === before,
      'a file for another project: its name is a warning (projects are renamed), its names not in this model the errors that stop it');
    putWork('bad.json', { format: 'mxscout-descriptions', version: 999 });
    r = A('send', 'bad.json', '--folder', repo);
    t.ok(r.code === 1 && /"version" is 999/.test(r.out) && bytes(repo) === before, 'send checks the same way: refused, and nothing in .local/inbox/');
    putWork('assist.bad.json', { format: 'mxscout-assist', version: 1, items: [{ id: 'SD-1', kind: 'ticket', title: 'x', verdict: 'maybe' }] });
    r = A('send', 'assist.bad.json', '--folder', repo);
    t.ok(r.code === 1 && /"verdict" must be one of/.test(r.out) && bytes(repo) === before, 'and an Assist file with an error, by mendix-assist’s checker');

    // ---- merge by default; --replace says what goes, and keeps a copy ----
    const procOnly = { format: 'mxscout-descriptions', version: 1, project: 'ShopApp', app: { summary: 'Takes orders for an invented shop.', processes: [{ name: 'Order to cash', summary: 'From an order to its payment.', steps: ['A clerk takes the order', 'The app saves it'], flows: ['Sales.CreateOrder', 'Sales.SweepOrders'] }] } };
    putWork('proc.json', procOnly);
    r = A('write', 'proc.json', '--folder', repo, '--dry-run', '--replace');
    t.ok(r.code === 0 && /^ {2}remove {2}descriptions\/modules\/Sales\.json$/m.test(r.out) && /^ {2}remove {2}descriptions\/risks\.json$/m.test(r.out) && bytes(repo) === before,
      'write --replace --dry-run lists the parts it would remove, and writes nothing');
    r = A('write', 'proc.json', '--folder', repo);
    t.ok(r.code === 0 && /has no "add": true; it is laid over the descriptions there \(merge\)/.test(r.out) && !/remove/.test(r.out.split('\n').filter((l) => /^ {2}/.test(l)).join('\n')) &&
      fs.existsSync(path.join(repo, 'mxscout', 'descriptions', 'modules', 'Sales.json')) && fs.existsSync(path.join(repo, 'mxscout', 'descriptions', 'risks.json')) && fs.existsSync(path.join(repo, 'mxscout', 'descriptions', 'processes', 'order-to-cash.json')),
      'a file without "add": true is still laid over what is there: the process added, the module and the risks kept');
    r = A('write', 'proc.json', '--folder', repo, '--replace');
    const backupAt = (/kept in (.*)\.$/m.exec(r.out) || [])[1];
    t.ok(r.code === 0 && /\(replace\)/.test(r.out) && /^ {2}removed descriptions\/modules\/Sales\.json$/m.test(r.out) && !fs.existsSync(path.join(repo, 'mxscout', 'descriptions', 'modules', 'Sales.json')) &&
      backupAt && fs.existsSync(path.join(backupAt, 'descriptions', 'modules', 'Sales.json')) && backupAt.indexOf(work) === 0,
      '--replace makes the file the whole: it says what it removed, and keeps a copy in the work folder');
    putWork('both.json', Object.assign({ add: true }, procOnly));
    r = A('write', 'both.json', '--folder', repo, '--replace');
    t.ok(r.code === 1 && /one or the other/.test(r.out), '"add": true with --replace is refused: one or the other');
    t.ok(A('write', 'desc.json', '--folder', repo).code === 0, 'written again, whole');

    // ---- docs/ that cannot be made: nothing written; --no-docs says what it left ----
    const mpr = path.join(repo, 'ShopApp.mpr');
    const good = fs.readFileSync(mpr);
    fs.mkdirSync(path.join(repo, 'mxscout', '.local'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'mxscout', '.local', 'ai-pack.md'), pack);
    fs.writeFileSync(mpr, 'not a database');
    const broken = bytes(repo);
    putWork('more.json', { format: 'mxscout-descriptions', version: 1, add: true, microflows: { 'Sales.CreateOrder': { text: 'Opens an order and numbers it.', hash: hash('Sales.CreateOrder') } } });
    r = A('write', 'more.json', '--folder', repo);
    t.ok(r.code === 1 && /UNVERIFIED — \.local\/ai-pack\.md/.test(r.out) && /docs\/ could not be made .*so nothing was written/.test(r.out) && bytes(repo) === broken,
      'an unreadable .mpr: the pack is .local/ai-pack.md, said to be UNVERIFIED, and docs/ cannot be made — exit 1, nothing written');
    r = A('write', 'more.json', '--folder', repo, '--no-docs');
    t.ok(r.code === 0 && /docs\/ was left as it is \(--no-docs\)/.test(r.out) && /numbers it/.test(fs.readFileSync(path.join(repo, 'mxscout', 'descriptions', 'modules', 'Sales.json'), 'utf8')),
      '--no-docs writes the descriptions and says docs/ was left for update-docs');
    fs.writeFileSync(mpr, good);
    r = A('update-docs', '--folder', repo);
    t.ok(r.code === 0 && /^docs\/ written from them/m.test(r.out), 'with the .mpr back, update-docs brings docs/ up to date');

    // ---- B02: a stale cache is never the model ----
    fs.writeFileSync(path.join(repo, 'mxscout', '.local', 'ai-pack.md'), pack.replace('project: ShopApp', 'project: ShopApp\nOLD-CACHE STALE-SENTINEL'));
    r = A('pack', 'p.md', '--folder', repo);
    t.ok(r.code === 0 && !/STALE-SENTINEL/.test(fs.readFileSync(path.join(work, 'p.md'), 'utf8')) && /made from ShopApp\.mpr/.test(r.out),
      'a stale .local/ai-pack.md beside a readable .mpr is not used: the pack is the .mpr’s');
    const kept = path.join(work, 'snapshot', fs.readdirSync(path.join(work, 'snapshot'))[0]);
    rename(mpr);
    r = A('module', 'Sales', '--folder', repo);
    t.ok(r.code === 0 && /Customex/.test(r.stdout) && !/E Customer /.test(r.stdout) && /snapshot: [0-9a-f]{12} — made from ShopApp\.mpr now/.test(r.out) && !fs.existsSync(kept),
      'the .mpr changed (HEAD the same): the pack kept for the old one is not used, but made again — the module shows the new entity');
    r = A('status', '--folder', repo, '--refresh');
    t.ok(/^snapshot: [0-9a-f]{12} — made from ShopApp\.mpr now \(--refresh\)/m.test(r.out), '--refresh makes it again regardless');
    const v2 = project('PortalApp', true);
    r = A('snapshot', '--folder', v2, '--json');
    let s1 = null;
    try { s1 = JSON.parse(r.stdout); } catch (e) { s1 = null; }
    const unit = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8')))
      .map((rel) => path.join(v2, 'mprcontents', rel)).find((f) => fs.readFileSync(f).indexOf('Customer') !== -1);
    rename(unit);
    fs.utimesSync(unit, new Date(), new Date(Date.now() + 5000));
    r = A('snapshot', '--folder', v2, '--json');
    let s2 = null;
    try { s2 = JSON.parse(r.stdout); } catch (e) { s2 = null; }
    t.ok(s1 && s2 && s1.verified && s2.verified && /and \d+ file\(s\) in mprcontents\//.test(s1.from) && s1.id !== s2.id && / now$/.test(s2.from) && /Customex/.test(fs.readFileSync(s2.file, 'utf8')),
      'Mendix 10 (mprcontents/): one unit changed, HEAD the same — a new snapshot, made again: ' + (s1 && s1.id) + ' → ' + (s2 && s2.id));

    // ---- B09: docs/ as its manifest says ----
    fs.writeFileSync(mpr, good);
    t.ok(A('update-docs', '--folder', repo).code === 0, '(docs/ brought up to date again)');
    const docs = path.join(repo, 'mxscout', 'docs');
    const index = fs.readFileSync(path.join(docs, 'index.md'), 'utf8');
    fs.unlinkSync(path.join(docs, 'index.md'));
    const risks = fs.readFileSync(path.join(docs, 'risks.md'), 'utf8');
    fs.writeFileSync(path.join(docs, 'risks.md'), risks + '\nEdited by hand.\n');
    const damaged = bytes(repo);
    r = A('update-docs', '--folder', repo);
    t.ok(r.code === 1 && /^ {2}missing docs\/index\.md$/m.test(r.out) && /^ {2}changed docs\/risks\.md$/m.test(r.out) && /update-docs --repair/.test(r.out) && bytes(repo) === damaged,
      'update-docs finds a file of the manifest gone and one changed — exit 1, nothing written, --repair named');
    r = A('verify-docs', '--folder', repo, '--json');
    let v = null;
    try { v = JSON.parse(r.stdout); } catch (e) { v = null; }
    t.ok(r.code === 1 && v && v.ok === false && v.damage.length === 2 && v.current === true, 'verify-docs says the same, as JSON: ' + r.stdout.replace(/\s+/g, ' ').slice(0, 120));
    r = A('update-docs', '--folder', repo, '--repair');
    t.ok(r.code === 0 && fs.readFileSync(path.join(docs, 'index.md'), 'utf8') === index && fs.readFileSync(path.join(docs, 'risks.md'), 'utf8') === risks,
      'update-docs --repair writes both again, byte for byte');
    const repaired = bytes(repo);
    r = A('verify-docs', '--folder', repo);
    t.ok(r.code === 0 && /is there, with its SHA-256/.test(r.out) && /^docs\/ is current/m.test(A('update-docs', '--folder', repo).out) && bytes(repo) === repaired,
      'then verify-docs passes, and update-docs writes nothing');
    const crlf = bytes(repo);
    fs.writeFileSync(path.join(docs, 'index.md'), index.replace(/\n/g, '\r\n'));
    t.ok(A('verify-docs', '--folder', repo).code === 0, 'a file with Windows line ends (core.autocrlf) is not "changed"');
    fs.writeFileSync(path.join(docs, 'index.md'), index);
    t.ok(bytes(repo) === crlf, '(put back)');

    // ---- a case note and docs/ in one step ----
    const note = ['---', 'id: "SD-4711"', 'kind: "ticket"', 'title: "Orders created twice"', 'status: "solved"', 'solved: "2026-10-15"', 'model: "' + C + '"',
      'flows: ["Sales.CreateOrder", "Sales.Gone"]', 'entities: []', 'pages: []', 'keywords: ["duplicate"]', 'related: []', 'language: "en"', '---', '', '# SD-4711 — Orders created twice', '',
      '## Problem', '', 'A clerk saw every new order twice.', '', '## Cause', '', 'The flow does not check it.', '', '## Solution', '', 'Add the check.', '', '## What did not work', '', 'Hiding it on the page.', '',
      '## How to recognise it next time', '', 'Two orders with one number.', ''].join('\n');
    putWork('SD-4711-orders-created-twice.md', note);
    r = A('case', 'SD-4711-orders-created-twice.md', '--folder', repo, '--dry-run');
    t.ok(r.code === 0 && /^ {2}add {5}knowledge\/SD-4711-orders-created-twice\.md$/m.test(r.out) && /^ {2}change {2}docs\/index\.md$/m.test(r.out) && bytes(repo) === crlf,
      'case --dry-run: the note and the docs/ it changes, nothing written');
    r = A('case', 'SD-4711-orders-created-twice.md', '--folder', repo);
    t.ok(r.code === 0 && /warning: flows: Sales\.Gone is not in the model now/.test(r.out) && /SD-4711 — Orders created twice/.test(fs.readFileSync(path.join(docs, 'index.md'), 'utf8')) && A('verify-docs', '--folder', repo).code === 0,
      'case: the note, checked against the model (a name gone is a warning), and docs/ listing it, in one step');

    // ---- the skills: their descriptions, and one protocol for a change ----
    const front = (name) => {
      const text = fs.readFileSync(path.join(skills, name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
      return ((/^---\n[\s\S]*?^description: (.*)$[\s\S]*?\n---\n/m.exec(text) || [])[1] || '');
    };
    const dd = front('mendix-describe'), da = front('mendix-assist');
    t.ok(dd.length > 300 && dd.length <= 1024 && da.length > 300 && da.length <= 1024, 'each skill’s description is at most 1024 characters (older Codex refuses longer): ' + dd.length + ' and ' + da.length);
    t.ok(['zbuduj dokumentację', 'zaktualizuj dokumentację', 'jak działa', 'update the documentation', 'build the documentation'].every((p) => dd.indexOf(p) !== -1) &&
      ['sprawdź zgłoszenie', 'mam Jirę', 'mam pomysł', '/mendix-assist', 'use the mendix-assist skill', 'check this ticket', 'I have a Jira'].every((p) => da.indexOf(p) !== -1),
      'and keeps its trigger phrases, in Polish and English');
    t.ok(['sprawdź zgłoszenie', 'mam Jirę', 'mam pomysł', 'I have a Jira'].every((p) => dd.indexOf(p) === -1) && /mendix-assist's/.test(dd) && ['zbuduj dokumentację', 'jak działa'].every((p) => da.indexOf(p) === -1),
      'the two do not overlap: tickets, Jira issues and ideas are mendix-assist’s, the documentation and questions mendix-describe’s');
    const describeSkill = fs.readFileSync(path.join(skills, 'mendix-describe', 'SKILL.md'), 'utf8');
    const change = describeSkill.slice(describeSkill.indexOf('## A change, when the person asks'), describeSkill.indexOf('## How to write'));
    t.ok(change.length > 500 && /Assist item of kind `idea`/.test(change) && !/descriptions\.change\.json/.test(describeSkill) && !/"add": true` and \*\*only\*\* `"changes"/.test(describeSkill) &&
      /refuses/.test(change) && /reference\/migration\.md/.test(change),
      'mendix-describe hands a change to mendix-assist as an idea; the old "changes" protocol is gone from its instructions');
    const migration = fs.readFileSync(path.join(skills, 'mendix-describe', 'reference', 'migration.md'), 'utf8');
    t.ok(/^# Older files only/.test(migration) && /\*\*Do not write this format\.\*\*/.test(migration) && !/"changes"/.test(fs.readFileSync(path.join(skills, 'mendix-describe', 'reference', 'descriptions-format.md'), 'utf8').replace(/`changes\[\]`, `tickets\[\]`/, '')),
      'the older format lives only in reference/migration.md, marked so');
    t.ok(/Ask only what is really missing/.test(describeSkill) && /When the request or the paste\s+already carries it/.test(fs.readFileSync(path.join(skills, 'mendix-assist', 'SKILL.md'), 'utf8')),
      'neither asks for what the request already says: the language when it is set, a number in the request');

    // ---- mendix-assist's selftest with Windows line ends ----
    const copy = path.join(tmp, 'skills-crlf');
    fs.cpSync(skills, copy, { recursive: true });
    ['assist-format.md', 'knowledge-format.md'].forEach((f) => { const p = path.join(copy, 'mendix-assist', 'reference', f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n')); });
    r = spawnSync(process.execPath, [path.join(copy, 'mendix-assist', 'selftest.js')], { cwd: tmp, env: Object.assign({}, env, { MXSCOUT_WORK: '' }), encoding: 'utf8' });
    t.ok(r.status === 0 && /^All passed: \d+ passed, 0 failed\.$/m.test(r.stdout), 'mendix-assist’s selftest passes with its reference files in CRLF: ' + (r.stdout || '').trim().split('\n').pop());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
