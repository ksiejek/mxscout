/* The mxscout-project skill (Karol, 2026-10-16: someone receives the documentation of many projects, opens
 * Claude, types /mxscout-project and picks the one to talk about). Its script, projects.js, run as an
 * agent runs it, against a library made here:
 *  - no library yet: it says so and how to set one; `set` remembers it in ~/.mxscout/library.json (HOME is a
 *    folder of this test's), and MXSCOUT_PROJECTS wins over it;
 *  - `list` numbers the projects — a project folder and a Mendix project with mxscout/ — described or not,
 *    with the model's version; `--find` narrows it;
 *  - `show` takes a number or a name, says when a name matches more than one, and prints the folder and the
 *    start of the documentation;
 *  - it writes nothing into the library. And the skill ships with the others: its files are there and the
 *    install scripts put it beside mendix-describe and mendix-assist. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async function (t) {
  const root = path.join(__dirname, '..');
  const script = path.join(root, 'skills', 'mxscout-project', 'projects.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-project-'));
  const home = path.join(tmp, 'home'), lib = path.join(tmp, 'lib');
  fs.mkdirSync(home); fs.mkdirSync(lib);
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(lib, rel)), { recursive: true }); fs.writeFileSync(path.join(lib, rel), text); };
  put('Order-Portal/project.json', JSON.stringify({ format: 'mxscout-project', layout: 1, name: 'Order Portal', contentLanguage: 'pl', model: { version: { branch: 'main', short: 'a1b2c3d' } }, descriptions: { file: 'descriptions.json' } }));
  put('Order-Portal/documentation.md', '# Order Portal\n\nTakes orders and ships them.\n');
  put('Order-Archive/project.json', JSON.stringify({ format: 'mxscout-project', layout: 1, name: 'Order Archive' }));
  put('Billing/mxscout/mxscout.json', JSON.stringify({ name: 'Billing' }));
  put('notes/readme.txt', 'not a project');
  const run = (args, env) => {
    try { return { code: 0, out: execFileSync(process.execPath, [script].concat(args), { env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, MXSCOUT_PROJECTS: '' }, env || {}), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
  };
  const before = fs.readdirSync(lib).join(',');

  const none = run(['list']);
  t.ok(none.code === 1 && /No library yet/.test(none.out) && /projects\.js set <folder>/.test(none.out), 'no library yet: it says so, and how to set one');
  const set = run(['set', lib]);
  const saved = JSON.parse(fs.readFileSync(path.join(home, '.mxscout', 'library.json'), 'utf8'));
  t.ok(set.code === 0 && saved.library === lib && /3 projects in it/.test(set.out), 'set remembers it in ~/.mxscout/library.json: ' + set.out.trim());
  const list = run(['list']);
  t.ok(list.code === 0 && /1\. Billing — model only · version unknown · in its Mendix project/.test(list.out) && /2\. Order Archive — model only/.test(list.out) && /3\. Order Portal — described · main @ a1b2c3d/.test(list.out) && !/notes/.test(list.out),
    'list numbers the projects — a project folder or a Mendix project with mxscout/ — described or not, with the version; a folder that is not a project is left out:\n' + list.out);
  const found = run(['list', '--find', 'portal']).out;
  t.ok(/3\. Order Portal/.test(found) && !/Order Archive|Billing/.test(found), '--find narrows it, keeping each one’s number');
  const two = run(['show', 'order']);
  t.ok(two.code === 2 && /More than one project matches "order"/.test(two.out) && /Order Archive/.test(two.out) && /Order Portal/.test(two.out), 'a name that matches more than one says so, and which');
  const one = run(['show', '3']);
  t.ok(one.code === 0 && /^project: Order Portal$/m.test(one.out) && /folder: .*Order-Portal/.test(one.out) && /model: main @ a1b2c3d · written in pl/.test(one.out) && /Takes orders and ships them\./.test(one.out),
    'show takes a number: the folder, the model, and the start of the documentation');
  const byName = run(['show', 'Order Portal']);
  t.ok(byName.code === 0 && /^project: Order Portal$/m.test(byName.out), 'or a name');
  const env = run(['where'], { MXSCOUT_PROJECTS: path.join(lib, 'Billing') });
  t.ok(/from MXSCOUT_PROJECTS/.test(env.out), 'MXSCOUT_PROJECTS wins over the saved folder');
  t.ok(fs.readdirSync(lib).join(',') === before && !fs.existsSync(path.join(lib, 'library.json')), 'and it wrote nothing into the library');

  // ---- it ships with the others ----
  const skill = fs.readFileSync(path.join(root, 'skills', 'mxscout-project', 'SKILL.md'), 'utf8');
  const front = (/^---\n([\s\S]*?)\n---/.exec(skill.replace(/\r\n/g, '\n')) || [])[1] || '';
  t.ok(/^name: mxscout-project$/m.test(front) && /\/mxscout-project/.test(front) && (/^description: (.*)$/m.exec(front) || [])[1].length <= 1024, 'the skill says when it is used, within the length Codex reads');
  t.ok(/Write nothing into the library or into any Mendix project yourself/.test(skill) && /Never commit/.test(skill), 'and that it writes nothing into the library or a Mendix project, and never commits');
  const sh = fs.readFileSync(path.join(root, 'skills', 'install.sh'), 'utf8'), ps = fs.readFileSync(path.join(root, 'skills', 'install.ps1'), 'utf8');
  t.ok(/for name in mendix-describe mendix-assist mxscout-project; do/.test(sh) && /'mendix-describe', 'mendix-assist', 'mxscout-project'/.test(ps), 'both install scripts put it beside mendix-describe and mendix-assist');
  fs.rmSync(tmp, { recursive: true, force: true });
};
