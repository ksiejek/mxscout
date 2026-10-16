#!/usr/bin/env node
/* The mendix-describe skill's way into an MxScout project. No dependencies — Node only.
 *
 * Two ways, the same commands:
 *
 *  1. The project's folder (the first way). MxScout keeps a project in a folder the person chose and
 *     writes it as they work: project.json, model.json, descriptions.json, documentation.md, ai-pack.md,
 *     README.md and inbox/. These commands read those files, and `send` writes the descriptions file
 *     into inbox/, which MxScout takes while the project is open. Nothing has to be running to read.
 *     --folder <dir>, or MXSCOUT_FOLDER, or simply run it inside the folder (it finds project.json).
 *
 *     Or the project is kept INSIDE the Mendix project, in mxscout/, and shared through the app's own git
 *     (layout 2): mxscout.json, descriptions/ (small files), docs/ (Markdown), AGENTS.md — committed — and
 *     .local/ with documentation.md, ai-pack.md, inbox/ and assist/ — this machine only. --folder takes the
 *     Mendix project's directory or its mxscout/; run inside either and it finds mxscout/. There, `write`
 *     puts the descriptions straight into descriptions/ (MxScout need not be open; when it is, it takes
 *     them within seconds, with Undo) and stamps them with the commit HEAD names; `send` still hands a file
 *     to .local/inbox/. This never runs git: committing mxscout/ is the person's.
 *     docs/ is made from the descriptions and the solved cases in knowledge/ — by MxScout, and here too, so
 *     a team that works with an agent alone keeps it current: `write` and `update-docs` read the model from
 *     the .mpr beside mxscout/ with MxScout's own engine (engine/, the files MxScout runs in the browser,
 *     unchanged) and write docs/ byte for byte as MxScout would.
 *
 *     The current model, one way for every command (audit 2026-10-15, B02/B10): status, module, pack, write,
 *     send, case and check-descriptions.js todo/check --folder all take the pack from the model as it is NOW
 *     — made from the .mpr (and mprcontents/) with the engine, and kept in the work folder under a stamp: a
 *     content hash of the .mpr, the list of mprcontents/ files with their sizes and times, the commit HEAD
 *     names and the engine's own version. A stamp that differs means the model (or the engine) changed, and
 *     the pack is made again; --refresh makes it again regardless. .local/ai-pack.md, which MxScout writes in
 *     the browser, carries no such stamp, so it is used only when the .mpr cannot be read — and then said to
 *     be unverified. Every command says which snapshot it used: "snapshot: <id>", the id a hash of the pack's
 *     text without the lines that say when or at which commit it was made — the same model, the same id.
 *
 *  2. The agent channel. MxScout, when the person presses "Share with an agent" in a project's
 *     Documentation, holds the AI pack in memory and gives out a token — and, when the project has
 *     descriptions, the documentation as Markdown beside it. MXSCOUT_TOKEN and MXSCOUT_URL in the
 *     environment, or --token and --url.
 *
 *   node agent.js workdir                   the work folder: where everything an agent makes while it works goes —
 *                                           packs, notes, drafts, JSON before it is sent. $MXSCOUT_WORK, or
 *                                           <temp>/mxscout-work/<project id, or a slug of its name>; made on demand.
 *   node agent.js status                    what the project is: its modules with their counts, the language
 *                                           its content is written in, which version of the app the model is and
 *                                           which one the descriptions describe (from the Mendix project's git),
 *                                           whether there is documentation (how much of it is out of date), and
 *                                           what waits for the person
 *   node agent.js docs [--out docs.md]      the documentation as Markdown: what an agent understood earlier.
 *                                           Read it first, as the map; check what matters in the pack.
 *   node agent.js module <Name> [--out f]   one module's section of the pack (to stdout, or to a file)
 *   node agent.js pack <file>               the whole pack, to a FILE — for check-descriptions.js todo/check.
 *                                           Never read it whole; read it by module.
 *   node agent.js snapshot [--json]         which model the commands use now: the snapshot's id, where its pack is
 *                                           and how it was made (--refresh makes it again from the .mpr)
 *   node agent.js send <file>               hand the finished descriptions (or Assist items, or a case note) to
 *                                           MxScout; the person accepts them there. Checked first, as write is.
 *   node agent.js write <descriptions.json> inside the Mendix project only: the descriptions laid over the ones in
 *                                           mxscout/descriptions/ (merge — nothing the file does not name is removed;
 *                                           --replace makes the file the whole of them, and says what goes), then
 *                                           docs/ brought up to date from them — all of it checked and made first,
 *                                           and written only when every part of it could be made
 *   node agent.js update-docs [--repair]    inside the Mendix project only: mxscout/docs/ — the documentation by
 *                                           topic, its manifest, the index of solved cases — written from the .mpr,
 *                                           descriptions/ and knowledge/, as MxScout writes it; nothing when
 *                                           docs/manifest.json says it is made from these already and every file
 *                                           it lists is there with its SHA-256; --repair writes the ones that are not
 *   node agent.js verify-docs [--json]      inside the Mendix project only: whether every file docs/manifest.json
 *                                           lists is there, unchanged, and made from the descriptions there now
 *   node agent.js case <id>-<slug>.md       a solved case's note (mendix-assist), checked, into knowledge/ — inside the
 *                                           Mendix project mxscout/knowledge/ (made when there is none yet), with
 *                                           docs/ brought up to date in the same step; through the channel, handed
 *                                           to MxScout
 *
 * write, send and case check everything before they touch a file (B03): the format and its version, the
 * schema (check-descriptions.js check, check-assist.js check, the case note's rules), every name against the
 * current model, and — when the file says which "snapshot" it was written from — that the model is still that
 * one; another project's name is a warning. One error and nothing is written; the exit code is 1. --dry-run prints what would be
 * added, changed and removed (--json: the same as JSON) and writes nothing. Inside the Mendix project the
 * whole result — descriptions/, mxscout.json, docs/, a case note — is made first, each file staged beside its
 * place, and renamed into place only when all of it was made; what it replaces is kept first in the work
 * folder (backup/<time>/). docs/ that cannot be made means nothing is written, exit code 1 — unless
 * --no-docs says to write the rest and leave docs/ for update-docs or MxScout.
 *
 * The Mendix project stays clean (Karol, 2026-10-15). A file given without a path — `--out docs.md`,
 * `pack pack.md`, `send descriptions.json` — is in the work folder; this prints the full path of every file it
 * writes. It refuses to write anywhere inside the Mendix project (the directory with the .mpr) except the
 * documentation it writes itself — mxscout/descriptions/, docs/, knowledge/, mxscout.json, .local/inbox/ —
 * and in a project folder of its own (layout 1) except inbox/ and knowledge/. The rule and the work folder
 * are check-descriptions.js's ("the work folder"), which the checkers share.
 *
 * Channel: prefer the environment for the token: an argument is visible to every process on the machine
 * (ps) and stays in the shell's history. The url defaults to http://127.0.0.1:4289. The person gets both
 * from MxScout ("Copy for the agent"). It refuses any address that is not this machine and follows no
 * redirect: the token and the descriptions go nowhere else. A call that has no answer within 30 seconds
 * is given up (MXSCOUT_TIMEOUT_MS to change it).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
function take(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v === undefined ? null : v;
}
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
const dryRun = flag('--dry-run'), asJson = flag('--json'), replaceAll = flag('--replace'), repair = flag('--repair'), refresh = flag('--refresh'), noDocs = flag('--no-docs');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
// One line on stderr and exit code 1 — never a stack trace: the person reads it, not a debugger.
function fail(message) { console.error(String(message).split('\n')[0]); process.exit(1); }

const folderArg = take('--folder') || process.env.MXSCOUT_FOLDER || null;
const urlArg = take('--url');
const tokenArg = take('--token');
const out = take('--out');
const [cmd, arg] = args;

const LAYOUT = 2;
function readProject(file) {
  try { const p = JSON.parse(fs.readFileSync(file, 'utf8')); return p && p.format === 'mxscout-project' ? p : null; } catch (e) { return null; }
}
function isProjectFolder(dir) { return !!readProject(path.join(dir, 'project.json')) || !!readProject(path.join(dir, 'mxscout.json')); }
// A Mendix project's directory with MxScout's files in it: its mxscout/.
function inRepo(dir) { return readProject(path.join(dir, 'mxscout', 'mxscout.json')) ? path.join(dir, 'mxscout') : null; }
// The folder: given, or the one this runs in (or above it) when no token says "the channel".
function findFolder() {
  if (folderArg) {
    const given = path.resolve(folderArg.replace(/^~(?=$|\/)/, process.env.HOME || '~'));
    return inRepo(given) || given;
  }
  if (tokenArg || process.env.MXSCOUT_TOKEN) return null;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (isProjectFolder(dir)) return dir;
    if (inRepo(dir)) return inRepo(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  // A Mendix project with no mxscout/ beside its .mpr is often kept, on purpose, in the person's MxScout folder
  // instead (Karol, 2026-10-16: "it says there is no mxscout/ in the project — there isn't, I don't want it
  // there"): the one project there read from this .mpr is the project.
  const m = mendixHere();
  if (m) {
    const lib = libraryMatches(m);
    if (lib.found.length === 1) {
      process.stderr.write('This Mendix project is kept in your MxScout folder, not in the Mendix project: using ' + lib.found[0] + '\n');
      return lib.found[0];
    }
  }
  return null;
}
// The person's MxScout folder: $MXSCOUT_PROJECTS, or the one ~/.mxscout/library.json names (the mxscout-project skill sets it).
function libraryHome() {
  if (process.env.MXSCOUT_PROJECTS) return path.resolve(process.env.MXSCOUT_PROJECTS);
  try { const c = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.mxscout', 'library.json'), 'utf8')); return c && c.library ? c.library : null; } catch (e) { return null; }
}
// The project folders in it (not the local part of one kept in its Mendix project) whose model was read from this .mpr. → { home, found: [folders] }
function libraryMatches(m) {
  const home = libraryHome();
  if (!home) return { home: null, found: [] };
  let names = [];
  try { names = fs.readdirSync(home); } catch (e) { return { home, found: [] }; }
  const want = String(m.mpr).toLowerCase();
  const found = names.map((n) => path.join(home, n)).filter((d) => {
    const pj = readProject(path.join(d, 'project.json'));
    return pj && pj.part !== 'local' && pj.source && typeof pj.source.fileName === 'string' && pj.source.fileName.toLowerCase() === want;
  });
  return { home, found };
}
const folder = findFolder();
// No MxScout folder here: is this (or a folder above) a Mendix project — a .mpr — that has no mxscout/ yet?
function mendixHere() {
  let dir = folderArg ? path.resolve(folderArg.replace(/^~(?=$|\/)/, process.env.HOME || '~')) : process.cwd();
  for (let i = 0; i < 6; i++) {
    let mpr = null;
    try { mpr = fs.readdirSync(dir).find((f) => /\.mpr$/i.test(f)); } catch (e) { mpr = null; }
    if (mpr) return { dir, mpr };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
// Where the project may be, said in the order a person keeps it (MxScout's projects page says the same, on each
// card: "Kept in"). The MxScout folder first — keeping the Mendix project clean is a choice, not a fault.
function noProject() {
  const m = mendixHere();
  const share = 'For this session only: in MxScout, Documentation → Other ways → Share with an agent → Copy for the agent, then set MXSCOUT_TOKEN.';
  const repoWay = 'To have the documentation in the Mendix project, for the team through git: in MxScout, the project\'s Settings → Kept in → Keep in the Mendix project (mxscout/)….';
  if (m) {
    const lib = libraryMatches(m);
    if (lib.found.length > 1) return 'This Mendix project (' + m.mpr + ') has no mxscout/, and your MxScout folder (' + lib.home + ') has ' + lib.found.length + ' projects read from ' + m.mpr + ': ' + lib.found.map((f) => path.basename(f)).join(', ') + '. Pass --folder <one of them>, or use /mxscout-project <name>.';
    if (!lib.home) return 'This Mendix project (' + m.mpr + ') has no mxscout/ — which is right if MxScout keeps the project in your MxScout folder (MxScout\'s projects page says where each project is kept). Tell this skill where that folder is, once: node ../mxscout-project/projects.js set <your MxScout folder> (or set MXSCOUT_PROJECTS), then run this again here — or use /mxscout-project <name>, or pass --folder <the project\'s folder>. ' + repoWay + ' ' + share;
    return 'This Mendix project (' + m.mpr + ') has no mxscout/, and no project in your MxScout folder (' + lib.home + ') was read from ' + m.mpr + '. In MxScout, the project\'s card on the projects page says where it is kept: pass --folder <that folder>, or use /mxscout-project <name>. ' + repoWay + ' ' + share;
  }
  return 'No MxScout project here. MxScout\'s projects page says where each project is kept: in your MxScout folder — use /mxscout-project <name>, or pass --folder <its folder>; in its Mendix project — run this in the Mendix project folder. ' + share;
}
// The local part of a project kept in its Mendix project (Karol, 2026-10-16): a folder of its own in the
// person's MxScout folder — $MXSCOUT_PROJECTS, or the one ~/.mxscout/library.json names (the mxscout-project
// skill sets it) — whose project.json has this project's id and "part": "local"; else mxscout/.local/, as before.
function localPartOf(mxscoutDir) {
  const os = require('os');
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  const mx = read(path.join(mxscoutDir, 'mxscout.json'));
  let home = process.env.MXSCOUT_PROJECTS || null;
  if (!home) { const c = read(path.join(os.homedir(), '.mxscout', 'library.json')); home = c && c.library; }
  if (mx && mx.id && home) {
    let names = [];
    try { names = fs.readdirSync(home); } catch (e) { names = []; }
    for (const n of names) {
      const pj = read(path.join(home, n, 'project.json'));
      if (pj && pj.part === 'local' && pj.id === mx.id) return path.join(home, n);
    }
  }
  return path.join(mxscoutDir, '.local');
}
// Layout 2: mxscout/ inside the Mendix project. What stays on this machine: its local part (above).
const repo = !!(folder && readProject(path.join(folder, 'mxscout.json')));
const local = folder ? (repo ? localPartOf(folder) : folder) : null;

// ---------- the work folder, and the Mendix project kept clean ----------
// Everything an agent makes while it works goes into the work folder, outside the project; inside the Mendix
// project (and a project folder of its own) this writes only the documentation, through the writers below.
// The rule is check-descriptions.js's (workplace), shared with the checkers.
const W = require('./check-descriptions.js').workplace;
const starts = [folder, folderArg ? path.resolve(folderArg.replace(/^~(?=$|\/)/, process.env.HOME || '~')) : null, process.cwd()];
const roots = W.protectedRoots(starts);
let workAt = null;
// name: the shared project's name, through the channel, when nothing on disk says which project this is.
// make: create it now (workdir does — the agent writes there next); a file written there makes it anyway.
function workDir(name, make) {
  if (!workAt) {
    const dir = W.workFolder(starts, name);
    const inside = W.refusedWrite(path.join(dir, 'x'), W.protectedRoots(starts.concat([dir])), false);
    if (inside) fail('The work folder ' + dir + ' is inside the project — set MXSCOUT_WORK to a folder outside it.');
    workAt = dir;
  }
  if (make) { try { fs.mkdirSync(workAt, { recursive: true }); } catch (e) { fail('Cannot make the work folder ' + workAt + ': ' + ((e && e.message) || e)); } }
  return workAt;
}
// Whether the work folder needs the channel to say which project it is for.
function workNeedsName() { return !process.env.MXSCOUT_WORK && !starts.some((s) => { const pl = W.placesFrom(s); return pl.project || pl.mpr; }); }
// A working file: into the work folder when given without a path; never inside the project. → its full path.
function writeOut(given, text) {
  const file = W.inWork(given, workDir(), false);
  const refused = W.refusedWrite(file, W.protectedRoots(starts.concat([path.dirname(file)])), false);
  if (refused) fail(refused);
  // The work folder is made when first written to; a folder named in full must be there already.
  try { if (file.startsWith(workDir() + path.sep)) fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } catch (e) { fail('Cannot write ' + file + ': ' + ((e && e.message) || e)); }
  return file;
}
// A file the agent hands in: from the work folder when given without a path (or from here when it is only here).
function readIn(given) {
  const file = W.inWork(given, workDir(), true);
  if (fs.existsSync(file) && W.refusedWrite(file, roots, true)) console.error('Note: ' + file + ' is inside the project. Working files belong in the work folder (node agent.js workdir) — move it there, and leave nothing behind in the project.');
  return file;
}
// The documentation this writes itself — only where it belongs (descriptions/, docs/, knowledge/, mxscout.json, the inbox).
function official(file) {
  const refused = W.refusedWrite(file, W.protectedRoots(starts.concat([path.dirname(file)])), true);
  if (refused) fail(refused);
  return file;
}

// ---------- layout 2: the files MxScout writes, the same way (repodocs.js, MxScout's own) ----------
function repoDocs() {
  const vm = require('vm');
  const ctx = { console, TextEncoder, crypto: require('crypto').webcrypto };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'repodocs.js'), 'utf8'), ctx, { filename: 'repodocs.js' });
  return ctx.MxRepoDocs;
}
function descriptionFiles() {
  const dir = path.join(folder, 'descriptions'), out = [];
  (function walk(d, rel) {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    names.forEach((n) => {
      if (n.name[0] === '.') return;
      if (n.isDirectory()) walk(path.join(d, n.name), rel + n.name + '/');
      else if (/\.json$/i.test(n.name)) out.push({ path: 'descriptions/' + rel + n.name, text: fs.readFileSync(path.join(d, n.name), 'utf8') });
    });
  })(dir, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}
// Which commit the Mendix project's HEAD names, read from its .git as files (no git program): { commit, short,
// branch, date, message } — the date and message from the reflog's line for it, when there is one.
function gitHead(repoDir) {
  let git = path.join(repoDir, '.git');
  try {
    if (fs.statSync(git).isFile()) { const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(git, 'utf8')); if (!m) return null; git = path.resolve(repoDir, m[1].trim()); }
    const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*(refs\/\S+)$/.exec(head);
    let commit = ref ? null : head;
    if (ref) {
      const common = fs.existsSync(path.join(git, 'commondir')) ? path.resolve(git, fs.readFileSync(path.join(git, 'commondir'), 'utf8').trim()) : git;
      try { commit = fs.readFileSync(path.join(common, ref[1]), 'utf8').trim(); } catch (e) {
        try { const l = fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split('\n').find((x) => x.endsWith(' ' + ref[1])); commit = l ? l.split(' ')[0] : null; } catch (e2) { commit = null; }
      }
    }
    if (!/^[0-9a-f]{40,64}$/.test(commit || '')) return null;
    let date = null, message = null;
    try {
      const lines = fs.readFileSync(path.join(git, 'logs', 'HEAD'), 'utf8').trim().split('\n').reverse();
      const hit = lines.map((l) => /^[0-9a-f]+ ([0-9a-f]+) .*? (\d+) [+-]\d{4}\t(.*)$/.exec(l)).find((m) => m && m[1] === commit);
      if (hit) { date = new Date(Number(hit[2]) * 1000).toISOString(); message = hit[3].replace(/^commit[^:]*:\s*/, '').slice(0, 200) || null; }
    } catch (e) { /* no reflog */ }
    return { commit, short: commit.slice(0, 7), branch: ref ? ref[1].replace(/^refs\/heads\//, '') : null, date, message };
  } catch (e) { return null; }
}
// Written whole: a hidden temporary file beside it, renamed into place — a reader never sees half of one.
function writeWhole(file, text) {
  official(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), '.' + path.basename(file) + '.tmp');
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
// A descriptions file in the shape MxScout keeps it (describe.js toFile), so what MxScout reads back and
// writes again is the same file: a flow's sentence as { text, hash, story, notes }.
function shaped(f) {
  const out = { format: 'mxscout-descriptions', version: 1, project: f.project || null, language: f.language || null, by: f.by || null, written: f.written || null };
  const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (f.app && typeof f.app === 'object') {
    out.app = { summary: s(f.app.summary), story: s(f.app.story), audience: f.app.audience === undefined ? null : f.app.audience,
      processes: (Array.isArray(f.app.processes) ? f.app.processes : []).filter((p) => p && s(p.name)).map((p) => ({ name: s(p.name), summary: s(p.summary), story: s(p.story),
        steps: Array.isArray(p.steps) ? p.steps : [], flows: Array.isArray(p.flows) ? p.flows : [], diagram: Array.isArray(p.diagram) ? p.diagram : [] })) };
  }
  ['modules', 'microflows', 'nanoflows', 'pages', 'entities'].forEach((k) => {
    out[k] = {};
    Object.keys(f[k] || {}).sort().forEach((q) => {
      const v = f[k][q];
      const text = typeof v === 'string' ? s(v) : v && typeof v === 'object' ? s(v.text) || s(v.summary) : null;
      const obj = v && typeof v === 'object' ? v : {};
      if (text || obj.notes) out[k][q] = { text, hash: s(obj.hash), story: s(obj.story), notes: Array.isArray(obj.notes) ? obj.notes : null };
    });
  });
  if (f.c4) out.c4 = f.c4;
  // MxScout keeps a risk's id (reference/risk-levels.md): the triage follows a risk by it.
  out.risks = Array.isArray(f.risks) ? f.risks.map((r) => ({ id: typeof r.id === 'string' ? r.id : null, level: r.level, title: s(r.title), detail: s(r.detail), fix: s(r.fix), theme: r.theme || null, where: Array.isArray(r.where) ? r.where : [] })) : [];
  if (f.context) out.context = f.context;
  return out;
}


// ---------- MxScout's engine, carried in engine/: the model from the .mpr, the pack, docs/ ----------
// The same files MxScout runs in the browser (public/), copied unchanged — the test suite checks they are —
// each an IIFE that puts one object on window, run here in a context of their own. Nothing else is loaded.
// Developer tools: what was decided about the risks (triage.js) and how the Risks page draws it (docs-triage.js) too.
const ENGINE = ['sqlite.js', 'bson.js', 'mpr.js', 'modelversion.js', 'docs-data.js', 'describe.js', 'reportdata.js', 'triage.js', 'docs-triage.js', 'docs-view.js', 'docs-file.js'];
let engineCtx = null;
function engine() {
  if (engineCtx) return engineCtx;
  const dir = path.join(__dirname, 'engine');
  if (!fs.existsSync(path.join(dir, 'docs-file.js'))) fail('This copy of mendix-describe has no engine/ folder: reinstall the skill (MxScout writes it whole into .claude/skills/).');
  const vm = require('vm');
  const ctx = { console, TextDecoder, TextEncoder, document: {}, crypto: require('crypto').webcrypto, Blob, Response, DecompressionStream, setTimeout, clearTimeout };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  ENGINE.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'repodocs.js'), 'utf8'), ctx, { filename: 'repodocs.js' });
  engineCtx = ctx;
  return ctx;
}
// The Mendix project's .git, as MxScout's modelversion.js reads it in the browser: plain files, no git program.
function gitSource(repoDir) {
  const git = path.join(repoDir, '.git');
  let st = null;
  try { st = fs.statSync(git); } catch (e) { return null; }
  if (st.isFile()) return { kind: 'file' };
  const read = (p) => { try { return fs.readFileSync(path.join(git, p)); } catch (e) { return null; } };
  return {
    kind: 'dir',
    text: (p, tail) => { const b = read(p); return Promise.resolve(b === null ? null : (tail && b.length > tail ? b.subarray(b.length - tail) : b).toString('utf8')); },
    bytes: (p) => { const b = read(p); return Promise.resolve(b === null ? null : new Uint8Array(b)); }
  };
}
// The model of the Mendix project, read from its .mpr (and mprcontents/ for Mendix 10+) — what MxScout reads.
// Read once per run: the pack and docs/ are made from the same reading.
const modelRead = {};
function mprModel(repoDir) {
  if (!modelRead[repoDir]) modelRead[repoDir] = readMprModel(repoDir);
  return modelRead[repoDir];
}
async function readMprModel(repoDir) {
  const E = engine();
  const mprs = fs.readdirSync(repoDir).filter((f) => /\.mpr$/i.test(f));
  if (mprs.length !== 1) throw new Error(mprs.length ? 'more than one .mpr in ' + repoDir : 'no .mpr in ' + repoDir);
  const buf = fs.readFileSync(path.join(repoDir, mprs[0]));
  const contents = path.join(repoDir, 'mprcontents');
  let asked = 0, found = 0;
  const model = await E.MxMpr.buildModel({
    mprBytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), appName: mprs[0].replace(/\.mpr$/i, ''),
    readContentsFile: (rel) => {
      asked++;
      const f = path.join(contents, rel);
      if (!f.startsWith(contents + path.sep)) return null;
      try { const b = fs.readFileSync(f); found++; return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } catch (e) { return null; }
    }
  });
  if (asked && !found) throw new Error('the .mpr names ' + asked + ' documents in mprcontents/ and none of them could be read');
  model.version = await E.MxModelVersion.readGit(gitSource(repoDir), path.basename(repoDir));
  return model;
}
// The solved cases in knowledge/, as files: [{ path: 'knowledge/<name>.md', text }].
function caseFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'knowledge')).filter((f) => /\.md$/i.test(f) && f[0] !== '.').sort(); } catch (e) { return []; }
  return names.map((f) => ({ path: 'knowledge/' + f, text: fs.readFileSync(path.join(dir, 'knowledge', f), 'utf8') }));
}
// Developer tools: the team's comments (comments/<id>.json) and what was decided about the risks (triage.json), as
// mxscout/ holds them — the files, for what docs/ is made from, and the comments as MxScout lists them (by
// severity, the newest first) with the decisions, for the Risks the documentation draws.
function devFiles(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'comments')).filter((f) => /\.json$/i.test(f) && f[0] !== '.').sort(); } catch (e) { names = []; }
  names.forEach((f) => out.push({ path: 'comments/' + f, text: fs.readFileSync(path.join(dir, 'comments', f), 'utf8') }));
  try { out.push({ path: 'triage.json', text: fs.readFileSync(path.join(dir, 'triage.json'), 'utf8') }); } catch (e) { /* none */ }
  return out;
}
const RANK = { critical: 0, high: 1, medium: 2, low: 3 };
function devState(files) {
  const comments = [];
  let triage = null;
  files.forEach((f) => {
    let v = null;
    try { v = JSON.parse(f.text); } catch (e) { v = null; }
    if (f.path === 'triage.json') { if (v && v.format === 'mxscout-triage') triage = v.triage || null; } else if (v && v.id && v.target) comments.push(v);
  });
  comments.sort((a, b) => (RANK[a.severity] !== RANK[b.severity] ? RANK[a.severity] - RANK[b.severity] : String(b.updatedAt).localeCompare(String(a.updatedAt))));
  return { comments, triage };
}
// The documentation's data of the own modules, with the descriptions on it — as MxScout's docs.js makes it.
async function docsData(E, model, project, value, dev) {
  const data = E.MxDocsData.build(model, { id: project.id, name: project.name });
  E.MxDescribe.attach(data, value);
  // Developer tools: only open and reopened risks count; the rest with what was decided (triage.js apply).
  if (dev) {
    const st = devState(dev);
    E.MxTriage.init({ store: { get: () => Promise.resolve(null), put: () => Promise.resolve(), delete: () => Promise.resolve() }, findings: () => st.comments, render: () => {} });
    await E.MxTriage.restore(project.id, st.triage ? { projectId: project.id, risks: E.MxTriage.clean(st.triage), updatedAt: null } : null);
    E.MxTriage.apply(data, project.id, value);
  }
  return data;
}
// The manifest's word for each file it lists, checked against the disk: [{ path, why: 'missing' | 'changed' }].
// A file is unchanged when its SHA-256 is the manifest's — of its text as written, or with Windows line ends
// put back to \n (a checkout with core.autocrlf), so a CRLF checkout is not "changed".
function manifestDamage(man) {
  const bad = [];
  (man && Array.isArray(man.files) ? man.files : []).forEach((f) => {
    const p = String((f && f.path) || '');
    if (!/^(docs|knowledge)\/[^\u0000]+$/.test(p) || p.split('/').indexOf('..') !== -1) return;
    let text = null;
    try { text = fs.readFileSync(path.join(folder, p), 'utf8'); } catch (e) { text = null; }
    if (text === null) bad.push({ path: p, why: 'missing' });
    else if (f.sha256 && sha256(text) !== f.sha256 && sha256(text.replace(/\r\n/g, '\n')) !== f.sha256) bad.push({ path: p, why: 'changed' });
  });
  return bad;
}
function readManifest() {
  let text = null, man = null;
  try { text = fs.readFileSync(path.join(folder, 'docs', 'manifest.json'), 'utf8'); man = JSON.parse(text); } catch (e) { man = null; }
  return { text, man: man && typeof man === 'object' ? man : null };
}
// What mxscout/docs/ should hold, made in memory, as store.js and docs.js write it in the browser — only when what
// it is made from (the descriptions, the commit they describe, the solved cases) is not what docs/manifest.json
// names, or (opts.repair) when a file the manifest lists is missing or changed; a file only when its text
// changed; one the manifest listed and that is not made any more, removed. Nothing is written here: the caller
// publishes the ops. project: mxscout.json as it will be; parts: descriptions/ as it will be; opts.cases:
// knowledge/ as it will be (default: as it is).
// → { state: 'current' | 'damaged' | 'written' | 'none', ops: [{ path, text } | { path, remove: true }], files, damage }
async function docsPlan(project, parts, opts) {
  opts = opts || {};
  const E = engine(), R = E.MxRepoDocs;
  const repoDir = path.dirname(folder);
  const at = project.describedAt && project.describedAt.commit ? project.describedAt : null;
  const joined = R.join(parts, at);
  if (joined.error) throw new Error(joined.error);
  const { text: manText, man } = readManifest();
  let had = man && Array.isArray(man.files) ? man.files.map((f) => String(f.path || '')) : [];
  if (manText !== null && !man) {
    (function walk(d, rel) { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } l.forEach((n) => { if (n.isDirectory()) walk(path.join(d, n.name), rel + n.name + '/'); else if (/\.md$/i.test(n.name)) had.push('docs/' + rel + n.name); }); })(path.join(folder, 'docs'), '');
  }
  had = had.filter((p, i, all) => /^docs\/[^/.][^\u0000]*\.(md|json)$/.test(p) && p.indexOf('..') === -1 && all.indexOf(p) === i);
  const exists = (p) => fs.existsSync(path.join(folder, p));
  if (!joined.value) {
    if (manText === null) return { state: 'none', ops: [], files: 0, damage: [] };
    return { state: 'none', ops: had.filter((p) => p !== 'docs/manifest.json').concat(['docs/manifest.json']).filter(exists).map((p) => ({ path: p, remove: true })), files: 0, damage: [] };
  }
  const value = E.MxDescribe.parse(JSON.stringify(joined.value)).value;
  const cases = opts.cases || caseFiles(folder);
  const listed = R.casesOf(cases).map((c) => ({ path: c.path, text: c.text }));
  const dev = devFiles(folder);
  const hash = await R.descriptionsHash(R.split(E.MxDescribe.toFile(value)).concat(dev, listed), value.describedAt);
  let damage = [];
  if (man && man.descriptions === hash) {
    damage = manifestDamage(man);
    if (!damage.length) return { state: 'current', ops: [], files: man.files.length, damage };
    if (!opts.repair) return { state: 'damaged', ops: [], files: man.files.length, damage };
  }
  const model = await mprModel(repoDir);
  const data = await docsData(E, model, project, value, dev);
  const own = {};
  data.modules.forEach((m) => { own[m.name] = !m.marketplace; });
  const files = await R.docsFiles(E.MxDocsFile.withDerived(E.MxDocsFile.subset(data, own)), { id: project.id, app: project.name, describedAt: value.describedAt || null, descriptions: hash, cases: cases });
  const now = {}, ops = [];
  files.forEach((f) => {
    now[f.path] = true;
    let was = null;
    try { was = fs.readFileSync(path.join(folder, f.path), 'utf8'); } catch (e) { was = null; }
    if (was !== f.text) ops.push({ path: f.path, text: f.text });
  });
  had.filter((p) => !now[p] && exists(p)).forEach((p) => ops.push({ path: p, remove: true }));
  return { state: 'written', ops, files: files.length, damage };
}
// The pack of a model: the own modules, as MxScout's documentation reads them — and, with Developer tools on, its
// "## risk triage": the risks described and what was decided about them (triage.json, the comments), so
// those go in, and in its stamp (packInputs).
async function packFromMpr(project) {
  const E = engine(), R = E.MxRepoDocs;
  const parts = descriptionFiles();
  const joined = parts.some((p) => R.conflicted(p.text)) ? { value: null } : R.join(parts, project.describedAt && project.describedAt.commit ? project.describedAt : null);
  const value = joined.value ? E.MxDescribe.parse(JSON.stringify(joined.value)).value : null;
  const data = await docsData(E, await mprModel(path.dirname(folder)), project, value, devFiles(folder));
  return E.MxDescribe.pack(E.MxDocsFile.withDerived(data)).text;
}
// What else the pack is made from, for its stamp: with Developer tools on the descriptions and the triage files.
function packInputs() { return descriptionFiles().concat(devFiles(folder)); }

// ---------- the current model: one snapshot for every command (audit B02, B10) ----------
// The stamp of what the pack is made from: the .mpr's bytes, mprcontents/ as a list of files with their sizes
// and times (an edit, a pull, a checkout all move them; reading every unit to hash it would cost as much as
// making the pack), the commit HEAD names (the pack's header says it), and the engine — its files and this
// one — so a newer skill makes the pack again. Throws when there is no single .mpr to read.
function modelStamp(repoDir) {
  const mprs = fs.readdirSync(repoDir).filter((f) => /\.mpr$/i.test(f));
  if (mprs.length !== 1) throw new Error(mprs.length ? 'more than one .mpr in ' + repoDir : 'no .mpr in ' + repoDir);
  const h = crypto.createHash('sha256');
  h.update('mpr\u0000' + mprs[0] + '\u0000');
  h.update(fs.readFileSync(path.join(repoDir, mprs[0])));
  let units = 0;
  const contents = path.join(repoDir, 'mprcontents');
  const list = [];
  (function walk(d, rel) {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    names.forEach((n) => {
      if (n.isDirectory()) walk(path.join(d, n.name), rel + n.name + '/');
      else { try { const st = fs.statSync(path.join(d, n.name)); list.push(rel + n.name + '\u0000' + st.size + '\u0000' + Math.floor(st.mtimeMs)); } catch (e) { /* gone while read */ } }
    });
  })(contents, '');
  list.sort().forEach((l) => { units++; h.update(l + '\n'); });
  const head = gitHead(repoDir);
  h.update('head\u0000' + (head ? head.commit : '') + '\n');
  h.update('engine\u0000' + engineVersion() + '\n');
  packInputs().forEach((f) => h.update(f.path + '\u0000' + f.text + '\u0000'));
  return { stamp: h.digest('hex'), mpr: mprs[0], units };
}
let engineVer = null;
function engineVersion() {
  if (engineVer) return engineVer;
  const h = crypto.createHash('sha256');
  ENGINE.map((f) => path.join(__dirname, 'engine', f)).concat([path.join(__dirname, 'repodocs.js'), __filename]).forEach((f) => {
    try { h.update(fs.readFileSync(f)); } catch (e) { h.update('missing ' + path.basename(f)); }
  });
  engineVer = h.digest('hex').slice(0, 16);
  return engineVer;
}
const snapshotOf = (text) => require('./check-descriptions.js').snapshotOf(text);
// The pack of the model as it is now, inside the Mendix project → { text, id, file, from, verified }.
// From the work folder when its stamp is the model's; made from the .mpr otherwise (or with --refresh), and
// kept there for the next command. Only when the .mpr cannot be read: .local/ai-pack.md, said to be unverified.
async function currentPack(project) {
  const repoDir = path.dirname(folder);
  let st = null, why = null;
  try { st = modelStamp(repoDir); } catch (e) { why = (e && e.message) || String(e); }
  if (st) {
    const dir = path.join(workDir(), 'snapshot');
    const file = path.join(dir, 'pack-' + st.stamp.slice(0, 32) + '.md');
    const read = st.mpr + (st.units ? ' and ' + st.units + ' file(s) in mprcontents/' : '');
    if (!refresh) {
      let text = null;
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { text = null; }
      if (text && /^format: mxscout-ai-pack 1\b/m.test(text)) return { text, id: snapshotOf(text), file, from: 'made from ' + read + ', kept in the work folder — the model has not changed since (stamp ' + st.stamp.slice(0, 12) + ')', verified: true, stamp: st.stamp };
    }
    try {
      const text = await packFromMpr(project);
      const refused = W.refusedWrite(file, W.protectedRoots(starts.concat([dir])), false);
      if (refused) fail(refused);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
      // One snapshot kept: an older one is of a model that is gone.
      fs.readdirSync(dir).filter((f) => /^pack-[0-9a-f]+\.md$/.test(f) && path.join(dir, f) !== file).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* another run's */ } });
      return { text, id: snapshotOf(text), file, from: 'made from ' + read + ' now' + (refresh ? ' (--refresh)' : ''), verified: true, stamp: st.stamp };
    } catch (e) { why = (e && e.message) || String(e); }
  }
  const localPack = path.join(local, 'ai-pack.md');
  let text = null;
  try { text = fs.readFileSync(localPack, 'utf8'); } catch (e) { text = null; }
  if (!text) throw new Error('the model could not be read (' + why + '), and there is no .local/ai-pack.md either');
  return { text, id: snapshotOf(text), file: localPack, from: 'UNVERIFIED — .local/ai-pack.md as MxScout wrote it' + (header(text, 'generated') ? ' (model read ' + header(text, 'generated') + ')' : '') +
    '; the model could not be read (' + why + '), so nothing says it is the model as it is now', verified: false };
}
function snapshotLine(p) { return 'snapshot: ' + p.id + ' — ' + p.from; }

// ---------- checked before anything is written (audit B03) ----------
// A descriptions file against the format and its version, the project, the snapshot it says it was written
// from, and the model (check-descriptions.js check: names, fingerprints, the schema). → { errors, warnings }
function checkDescriptions(given, pack, projectName, opts) {
  opts = opts || {};
  const C = require('./check-descriptions.js');
  const errors = [], warnings = [];
  if (!given || typeof given !== 'object' || Array.isArray(given)) return { errors: ['The file is not a JSON object.'], warnings };
  if (given.format !== C.DESC_FORMAT) errors.push('"format" is ' + JSON.stringify(given.format === undefined ? null : given.format) + ' — a descriptions file says "format": "' + C.DESC_FORMAT + '".');
  if (given.version !== 1) errors.push('"version" is ' + JSON.stringify(given.version === undefined ? null : given.version) + ' — this skill and MxScout read version 1' + (typeof given.version === 'number' && given.version > 1 ? '; a newer one wrote it — update the skill' : '') + '.');
  if (errors.length) return { errors, warnings };
  // Another project's name is a warning: a project is renamed, and mendix-docs names it after the .mpr — the names
  // checked against the model below are what tell a file for another application.
  if (projectName && typeof given.project === 'string' && given.project.trim() && given.project.trim() !== projectName) warnings.push('"project" is "' + given.project.trim() + '", but this is ' + projectName + ' — written for another project, or before it was renamed? Every name in it is checked against this model.');
  if (given.snapshot !== undefined && pack && given.snapshot !== pack.id) errors.push('"snapshot" is ' + JSON.stringify(given.snapshot) + ', but the model now is snapshot ' + pack.id + ' — it changed since the file was written: run check-descriptions.js todo again and describe what changed.');
  if (opts.noChanges) ['changes', 'tickets'].forEach((k) => { if (given[k] !== undefined) errors.push('"' + k + '" are not descriptions any more: a change is an Assist item (kind "idea") and a ticket one of kind "ticket" — the mendix-assist skill writes them, and agent.js send hands them over. Take "' + k + '" out of this file.'); });
  if (pack) C.check(C.readPack(pack.text), given).forEach((p) => { if (!/^"project" is /.test(p.text)) (p.level === 'error' ? errors : warnings).push(p.text); });
  return { errors, warnings };
}
// An Assist envelope by mendix-assist's checker, beside this skill; a case envelope by MxScout's case rules.
function checkAssist(json, pack) {
  let A = null;
  try { A = require(path.join(__dirname, '..', 'mendix-assist', 'check-assist.js')); } catch (e) { A = null; }
  if (!A) {
    const errors = [];
    if (json.version !== 1) errors.push('"version" is ' + JSON.stringify(json.version === undefined ? null : json.version) + ' — MxScout reads version 1.');
    if (!Array.isArray(json.items) || !json.items.length) errors.push('"items" must be a list with at least one item.');
    return { errors, warnings: ['mendix-assist is not installed beside this skill, so the items were checked only for their format.'] };
  }
  const C = require('./check-descriptions.js');
  return A.check(json, { pack: pack ? C.readPack(pack.text) : null });
}
function checkCaseEnvelope(json) {
  const errors = [], warnings = [];
  if (json.version !== 1) errors.push('"version" is ' + JSON.stringify(json.version === undefined ? null : json.version) + ' — MxScout reads version 1.');
  if (!Array.isArray(json.cases) || !json.cases.length) errors.push('"cases" must be a list of { "path": "knowledge/<id>-<slug>.md", "text" }.');
  else json.cases.forEach((c, i) => {
    if (!c || typeof c.path !== 'string' || !/^knowledge\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(c.path) || typeof c.text !== 'string') { errors.push('cases[' + i + ']: needs "path" (knowledge/<id>-<slug>.md) and "text".'); return; }
    const r = repoDocs().caseCheck(c.text, c.path);
    r.errors.forEach((x) => errors.push(c.path + ': ' + x));
    r.warnings.forEach((x) => warnings.push(c.path + ': ' + x));
  });
  return { errors, warnings };
}
// The names a case note's front matter gives (flows, entities, pages) against the model: a warning each, never
// an error — the fix may have removed what the case was about.
function caseNames(text, pack) {
  if (!pack) return [];
  const P = require('./check-descriptions.js').readPack(pack.text);
  const out = [];
  [['flows', (q) => P.microflows[q] || P.nanoflows[q]], ['entities', (q) => P.entities[q]], ['pages', (q) => P.pages[q]]].forEach(([k, has]) => {
    const m = new RegExp('^' + k + ':\\s*(\\[.*\\])\\s*$', 'm').exec(String(text).replace(/\r\n/g, '\n').split(/\n---\s*\n/)[0] || '');
    let list = [];
    try { list = m ? JSON.parse(m[1]) : []; } catch (e) { list = []; }
    (Array.isArray(list) ? list : []).forEach((q) => { if (typeof q === 'string' && !has(q)) out.push(k + ': ' + q + ' is not in the model now (snapshot ' + pack.id + ') — fine when the fix removed it; otherwise name it as the pack does.'); });
  });
  return out;
}
// Errors stop it: each said, then one line on stderr and exit code 1. Warnings are said and do not stop it.
function report(r, what) {
  if (asJson && dryRun) {
    if (!r.errors.length) return;
    console.log(JSON.stringify({ dryRun: true, ok: false, file: what, errors: r.errors, warnings: r.warnings }, null, 2));
    process.exit(1);
  }
  r.warnings.slice(0, 12).forEach((w) => console.log('warning: ' + w));
  if (r.warnings.length > 12) console.log('warning: … and ' + (r.warnings.length - 12) + ' more — check-descriptions.js check (or check-assist.js check) lists them all.');
  if (!r.errors.length) return;
  r.errors.forEach((e) => console.log('ERROR  ' + e));
  fail(what + ': ' + r.errors.length + ' error(s), so nothing was written. Fix them and run it again.');
}

// ---------- the plan, and publishing it whole ----------
// ops: [{ path: relative to the folder, text } | { path, remove: true }] → added / changed / removed, as text or JSON.
function planOf(ops) {
  return ops.map((o) => ({ path: o.path, action: o.remove ? 'remove' : fs.existsSync(path.join(folder, o.path)) ? 'change' : 'add' }));
}
function printPlan(plan, extra) {
  if (asJson) { console.log(JSON.stringify(Object.assign({ dryRun: true, files: plan }, extra || {}), null, 2)); return; }
  const count = (a) => plan.filter((p) => p.action === a).length;
  console.log('Dry run — nothing written. ' + (plan.length ? count('add') + ' to add, ' + count('change') + ' to change, ' + count('remove') + ' to remove' : 'Nothing would change') + (folder ? ', in ' + folder : '') + ':');
  plan.forEach((p) => console.log('  ' + (p.action + '    ').slice(0, 7) + ' ' + p.path));
}
// Every file made first — a hidden file beside its place, so the rename is on the same disk — and renamed into
// place only when all of them were made; the files removed go last. What it replaces or removes is copied
// first into the work folder (backup/<time>/), the way back if anything goes wrong.
function publish(ops) {
  if (!ops.length) return null;
  const full = ops.map((o) => Object.assign({}, o, { abs: official(path.join(folder, o.path)) }));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(workDir(), 'backup', stamp);
  const kept = full.filter((o) => fs.existsSync(o.abs));
  if (kept.length) {
    try {
      kept.forEach((o) => { const to = path.join(backup, o.path); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(o.abs, to); });
      const all = fs.readdirSync(path.join(workDir(), 'backup')).sort();
      all.slice(0, Math.max(0, all.length - 10)).forEach((d) => { try { fs.rmSync(path.join(workDir(), 'backup', d), { recursive: true, force: true }); } catch (e) { /* in use */ } });
    } catch (e) { fail('Cannot keep the earlier files in ' + backup + ' (' + ((e && e.message) || e) + ') — nothing was written.'); }
  }
  const staged = [];
  try {
    full.filter((o) => !o.remove).forEach((o) => {
      fs.mkdirSync(path.dirname(o.abs), { recursive: true });
      const tmp = path.join(path.dirname(o.abs), '.' + path.basename(o.abs) + '.' + process.pid + '.tmp');
      fs.writeFileSync(tmp, o.text);
      staged.push({ tmp, abs: o.abs });
    });
  } catch (e) {
    staged.forEach((s) => { try { fs.unlinkSync(s.tmp); } catch (x) { /* never made */ } });
    fail('Cannot write into ' + folder + ' (' + ((e && e.message) || e) + ') — nothing was changed.');
  }
  const done = [];
  try {
    staged.forEach((s) => { fs.renameSync(s.tmp, s.abs); done.push(s.abs); });
    full.filter((o) => o.remove).forEach((o) => { try { fs.unlinkSync(o.abs); } catch (e) { if (e.code !== 'ENOENT') throw e; } done.push(o.abs); });
  } catch (e) {
    staged.forEach((s) => { try { fs.unlinkSync(s.tmp); } catch (x) { /* renamed already */ } });
    console.error('Stopped half way (' + ((e && e.message) || e) + '): ' + done.length + ' of ' + full.length + ' file(s) were put in place. The earlier files are in ' + backup + ' — copy them back into ' + folder + ' to return to where it was.');
    process.exit(1);
  }
  return kept.length ? backup : null;
}

// The pack's own index: "module | from-to | microflows | nanoflows | pages | entities", 1-based, inclusive.
function parseIndex(lines) {
  const at = lines.indexOf('## index');
  if (at < 0) return null;
  const modules = [];
  for (let i = at + 2; i < lines.length && lines[i].trim() !== ''; i++) {
    const m = /^(.+?) \| (\d+)-(\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)$/.exec(lines[i]);
    if (!m) return null;
    modules.push({ name: m[1], from: Number(m[2]), to: Number(m[3]), microflows: Number(m[4]), nanoflows: Number(m[5]), pages: Number(m[6]), entities: Number(m[7]) });
  }
  return modules;
}
function header(text, key) {
  const l = String(text).split('\n').slice(0, 24).find((x) => x.startsWith(key + ': '));
  return l ? l.slice(key.length + 2) : null;
}
// Which version of the app the model is, and which one the descriptions describe — from the pack's and the
// documentation's headers (MxScout reads both from the Mendix project's git). With both commits known and
// different, the way to see what changed: git log in the Mendix project, locally, read-only.
function versionLines(model, modelCommit, describedAt, describedCommit, since) {
  const out = ['model: ' + (model || 'version unknown')];
  if (describedAt) {
    out.push('described at: ' + describedAt);
    if (since) out.push('since then: ' + since);
    if (modelCommit && describedCommit && modelCommit !== describedCommit) {
      out.push('what changed: in the Mendix project directory, git log --oneline ' + describedCommit.slice(0, 12) + '..' + modelCommit.slice(0, 12) +
        ' — local and read-only (never fetch or pull); combine it with check-descriptions.js todo, and describe only what changed');
    }
  }
  return out;
}
// The project's language of written content, as MxScout names it: "pl" → "Polish (pl)".
const NAMES = { en: 'English', pl: 'Polish', de: 'German', nl: 'Dutch', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', cs: 'Czech', sk: 'Slovak', sv: 'Swedish', da: 'Danish', nb: 'Norwegian', fi: 'Finnish', hu: 'Hungarian', ro: 'Romanian', uk: 'Ukrainian', lt: 'Lithuanian' };
function languageLine(code) {
  return code ? 'language: ' + (NAMES[code] || code) + ' (' + code + ') — write everything in it; do not ask again'
    : 'language: not set yet — ask the person once "In which language should I write? (default: English)"; the answer is kept for the project';
}

// ---------- the folder ----------
function inFolder() {
  // documentation.md, ai-pack.md and inbox/ are in .local/ inside the Mendix project (layout 2).
  const read = (f, need) => {
    const p = path.join(/^(documentation\.md|ai-pack\.md)$/.test(f) ? local : folder, f);
    if (!fs.existsSync(p)) { if (need) fail('No ' + (repo && f !== 'mxscout.json' ? '.local/' : '') + f + ' in ' + folder + (f === 'ai-pack.md' ? ' — open the project in MxScout once on this machine: it writes ' + (repo ? '.local/' : '') + 'ai-pack.md while the project is open.' : '.')); return null; }
    return fs.readFileSync(p, 'utf8');
  };
  const pjName = repo ? 'mxscout.json' : 'project.json';
  let project;
  try { project = JSON.parse(read(pjName, true)); } catch (e) { fail(pjName + ' in ' + folder + ' is not valid JSON' + (/^[<=>]{7}/m.test(read(pjName, false) || '') ? ' — it has a git conflict; resolve it first.' : '.')); }
  if (!project || project.format !== 'mxscout-project') fail(folder + ' is not an MxScout project folder (its ' + pjName + ' does not say "format": "mxscout-project").');
  if (project.layout > LAYOUT) fail(folder + ' was written by a newer MxScout (layout ' + project.layout + '); update the skill.');
  const inbox = path.join(local, 'inbox');
  if (repo) return inRepoFolder(project, read, inbox);

  // A project folder of its own has no .mpr beside it: its pack is the one MxScout writes, and rewrites
  // whenever it reads the model again.
  const folderPack = (need) => {
    const text = read('ai-pack.md', need);
    return text === null ? null : { text, id: snapshotOf(text), file: path.join(folder, 'ai-pack.md'),
      from: 'ai-pack.md as MxScout wrote it' + (header(text, 'generated') ? ', model read ' + header(text, 'generated') : '') + ' — MxScout writes it again whenever it reads the model again', verified: null };
  };
  if (refresh && ['status', 'module', 'pack', 'snapshot'].indexOf(cmd) !== -1) console.error('Note: --refresh does nothing here — a project folder of its own has no .mpr to read; MxScout rewrites ai-pack.md when it reads the model again.');

  if (cmd === 'snapshot') {
    const p = folderPack(true);
    if (asJson) console.log(JSON.stringify({ id: p.id, file: p.file, from: p.from, verified: p.verified }, null, 2)); else console.log(snapshotLine(p) + '\npack: ' + p.file);
  } else if (cmd === 'status') {
    const pack = read('ai-pack.md', false), docs = read('documentation.md', false);
    console.log('project: ' + project.name + (project.model && project.model.mendix ? ' (Mendix ' + project.model.mendix + ')' : '') + ' — folder ' + folder);
    console.log(languageLine(project.contentLanguage || null));
    const modules = pack ? parseIndex(pack.split('\n')) : null;
    const v = project.model && project.model.version;
    versionLines(header(pack || '', 'model') || (v && v.commit ? (v.branch ? v.branch + ' @ ' : '') + v.short : null), header(pack || '', 'model commit') || (v && v.commit) || null,
      header(docs || '', 'described at'), header(docs || '', 'described commit'), header(docs || '', 'since then')).forEach((l) => console.log(l));
    if (pack) console.log(snapshotLine(folderPack(false)));
    if (modules) {
      console.log('pack: ai-pack.md' + (header(pack, 'generated') ? ' · model read ' + header(pack, 'generated') : ''));
      console.log('module | lines | microflows | nanoflows | pages | entities');
      modules.forEach((m) => console.log(m.name + ' | ' + m.from + '-' + m.to + ' | ' + m.microflows + ' | ' + m.nanoflows + ' | ' + m.pages + ' | ' + m.entities));
    } else console.log('pack: none yet — open the project in MxScout once; it writes ai-pack.md while the project is open.');
    const described = /^(\d+) of (\d+)$/.exec(header(docs || '', 'flows described') || '');
    if (docs && described && Number(described[1]) > 0) {
      const stale = parseInt(header(docs, 'out of date') || '0', 10) || 0;
      console.log('documentation: yes — ' + described[1] + ' of ' + described[2] + ' flows described, ' + (stale ? stale + ' out of date (the flow changed since)' : 'none out of date') + '. Read it first: ' + path.join(folder, 'documentation.md'));
    } else console.log('documentation: none yet — this project has no descriptions; the pack is all there is.');
    console.log('descriptions: ' + (fs.existsSync(path.join(folder, 'descriptions.json')) ? path.join(folder, 'descriptions.json') + ' (for check-descriptions.js todo --folder)' : 'none yet'));
    const waiting = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => /\.json$/i.test(f) && f[0] !== '.') : [];
    console.log('inbox: ' + (waiting.length ? waiting.length + ' file(s) waiting for MxScout to take them: ' + waiting.join(', ') + ' — MxScout takes them while the project is open in it' : 'empty'));
    console.log('work folder: ' + workDir() + ' — every working file goes here (packs, notes, drafts, JSON before it is sent), never into the project');
  } else if (cmd === 'docs') {
    const docs = read('documentation.md', false);
    if (!docs) { console.log('No documentation.md yet: open the project in MxScout once. The AI pack is all there is — read it by module.'); return; }
    if (out) { const f = writeOut(out, docs); console.log('Wrote ' + f + ' (' + docs.split('\n').length + ' lines) — what an agent understood earlier; verify against the pack.'); } else process.stdout.write(docs);
  } else if (cmd === 'module' && arg) {
    const p = folderPack(true);
    const lines = p.text.split('\n');
    const mod = (parseIndex(lines) || []).find((m) => m.name === arg);
    if (!mod) fail('No module ' + arg + ' in ' + path.join(folder, 'ai-pack.md') + ' (its ## index lists the modules).');
    const text = lines.slice(mod.from - 1, mod.to).join('\n') + '\n';
    if (out) { const f = writeOut(out, text); console.log('Wrote ' + f + ' (' + text.split('\n').length + ' lines). ' + snapshotLine(p)); } else { console.error(snapshotLine(p)); process.stdout.write(text); }
  } else if (cmd === 'pack' && arg) {
    const p = folderPack(true);
    const f = writeOut(arg, p.text);
    console.log('Wrote ' + f + ' — for the checker, not for reading whole. (The folder\'s own ' + path.join(folder, 'ai-pack.md') + ' does as well.)');
    console.log(snapshotLine(p));
  } else if (cmd === 'send' && arg) {
    sendTo(inbox, folderPack(false), project.name);
  } else if (cmd === 'case' && arg) {
    const c = caseNote(folderPack(false));
    const to = path.join(folder, 'knowledge', c.name);
    if (dryRun) { printPlan(planOf([{ path: 'knowledge/' + c.name, text: c.text }])); return; }
    writeWhole(to, c.text);
    console.log('Wrote ' + to + ' — MxScout shows it under Solved cases the next time the project is open in it.');
  } else usage();
}
// A solved case's note (mendix-assist's reference/knowledge-format.md), checked by MxScout's own rules (repodocs.js
// caseCheck: the front matter, the five sections, the file's name against its id, no personal data) before it goes in.
function caseNote(pack) {
  const file = readIn(arg);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail('Cannot read ' + file + '.'); }
  const name = path.basename(file);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name)) fail(file + ': a case note is named <id>-<slug>.md (reference/knowledge-format.md).');
  const r = repoDocs().caseCheck(text, 'knowledge/' + name);
  if (r.errors.length) fail(file + ': ' + r.errors.length + ' error(s), so it was not written. ' + r.errors[0] + (r.errors.length > 1 ? ' — node ../mendix-assist/check-assist.js knowledge ' + file + ' lists them all.' : ''));
  if (!(asJson && dryRun)) r.warnings.concat(caseNames(text, pack)).forEach((w) => console.log('warning: ' + w));
  return { name, text };
}
// What is handed over — a descriptions file, Assist items, a solved case (an envelope, or the note itself, a .md
// file) — read and checked whole before it goes anywhere. pack: the current model's, to check the names
// against; projectName: the project's, when it is known. → { body, json, note, kind }
function handedIn(pack, projectName) {
  const file = readIn(arg);
  let body;
  try { body = fs.readFileSync(file, 'utf8'); } catch (e) { fail('Cannot read ' + file + '.'); }
  const note = /\.md$/i.test(file);
  let json = null;
  if (!note) { try { json = JSON.parse(body); } catch (e) { fail('Cannot read ' + file + ' as JSON.'); } }
  if (note ? !/^---\r?\n/.test(body) : !json || ['mxscout-descriptions', 'mxscout-assist', 'mxscout-knowledge'].indexOf(json.format) === -1) {
    fail(file + (note ? ' is not a case note (it should start with its front matter, "---").' : ' is not a descriptions file, Assist items or a solved case (its "format" should be "mxscout-descriptions", "mxscout-assist" or "mxscout-knowledge").'));
  }
  if (pack && !(asJson && dryRun)) console.log(snapshotLine(pack));
  if (note) { caseNote(pack); return { file, body, json, note, kind: 'case' }; }
  if (json.format === 'mxscout-descriptions') {
    // A descriptions file needs the model to be checked against: without it, nothing goes.
    if (!pack) fail('No pack to check ' + file + ' against (no ai-pack.md here) — open the project in MxScout once, then send it again.');
    report(checkDescriptions(json, pack, projectName), file);
    if (!(asJson && dryRun) && (json.changes !== undefined || json.tickets !== undefined)) console.log('Note: "changes" and "tickets" are the older format — MxScout moves them to its Assist page. New work goes as an Assist item (kind "idea" for a change) through the mendix-assist skill (reference/migration.md).');
    return { file, body, json, note, kind: 'descriptions' };
  }
  if (json.format === 'mxscout-assist') { report(checkAssist(json, pack), file); return { file, body, json, note, kind: 'assist' }; }
  report(checkCaseEnvelope(json), file);
  return { file, body, json, note, kind: 'case' };
}
// A descriptions (or Assist) file into the inbox MxScout reads while the project is open — checked first.
function sendTo(ib, pack, projectName) {
  const h = handedIn(pack, projectName);
  // Written whole: a hidden temporary file first, renamed into place — MxScout never reads half of it.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(h.file).replace(/\.(json|md)$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'descriptions';
  const name = stamp + '-' + base + (h.note ? '.md' : '.json');
  official(path.join(ib, name));
  if (dryRun) {
    const rel = path.relative(folder, path.join(ib, name)).split(path.sep).join('/');
    printPlan([{ path: rel, action: 'add' }], { kind: h.kind });
    return;
  }
  fs.mkdirSync(ib, { recursive: true });
  const tmp = path.join(ib, '.' + name + '.tmp');
  fs.writeFileSync(tmp, h.body);
  fs.renameSync(tmp, path.join(ib, name));
  console.log('Written to ' + path.join(ib, name) + '. MxScout takes it while the project is open — saved at once, with Undo, unless the person turned that off, or it is a whole file that would replace the descriptions kept: then it waits for them to press Import them.' + (h.kind === 'case' ? ' A solved case is written into knowledge/.' : ''));
}

// ---------- layout 2: inside the Mendix project ----------
function inRepoFolder(project, read, inbox) {
  const R = repoDocs();
  const repoDir = path.dirname(folder);
  const head = gitHead(repoDir);
  const parts = descriptionFiles();
  const conflicted = parts.filter((p) => R.conflicted(p.text)).map((p) => p.path);
  const at = project.describedAt && project.describedAt.commit ? project.describedAt : null;
  // The pack of the model as it is now (currentPack): made from the .mpr, or the work folder's copy of it.
  const packText = async (need) => {
    try { return await currentPack(project); } catch (e) { if (need) fail('No pack: ' + ((e && e.message) || e) + '.'); return null; }
  };
  const docsLine = (r) => r.state === 'current' ? 'docs/ is current — made from these descriptions and solved cases already, and every one of the ' + r.files + ' file(s) docs/manifest.json lists is there, unchanged; nothing written.'
    : r.state === 'none' ? 'docs/: no descriptions, so no documentation' + (r.ops.length ? ' — removed the ' + r.ops.length + ' file(s) it had.' : '.')
    : 'docs/ written from them: ' + r.ops.filter((o) => !o.remove).length + ' of ' + r.files + ' file(s) changed' + (r.ops.some((o) => o.remove) ? ', ' + r.ops.filter((o) => o.remove).length + ' removed' : '') +
      (r.damage.length ? ' (' + r.damage.length + ' that docs/manifest.json lists were missing or changed: ' + r.damage.map((d) => d.path).slice(0, 5).join(', ') + (r.damage.length > 5 ? ', …' : '') + ')' : '') + ' — the same files MxScout writes.';
  const damageLines = (damage) => damage.map((d) => '  ' + (d.why === 'missing' ? 'missing ' : 'changed ') + d.path);
  const versionOf = (h) => (h ? (h.branch ? h.branch + ' @ ' : '') + h.short : 'a version that is not known (no readable .git)');
  // The docs/ part of a write or a case: made with the rest, or (--no-docs) left, and said so.
  async function docsPart(pj, nextParts, cases) {
    if (noDocs) return null;
    try { return await docsPlan(pj, nextParts, { repair: true, cases }); }
    catch (e) { fail('docs/ could not be made (' + ((e && e.message) || e) + '), so nothing was written. Fix that (the .mpr must be readable) and run it again — or pass --no-docs to write the rest and leave docs/ for node agent.js update-docs or MxScout.'); }
    return null;
  }
  return (async function () {
    if (cmd === 'snapshot') {
      const p = await packText(true);
      if (asJson) console.log(JSON.stringify({ id: p.id, file: p.file, from: p.from, verified: p.verified, stamp: p.stamp || null }, null, 2));
      else console.log(snapshotLine(p) + '\npack: ' + p.file);
    } else if (cmd === 'status') {
      const docs = read('documentation.md', false);
      const pack = await packText(false);
      console.log('project: ' + project.name + ' — kept in the Mendix project, ' + folder + ' (layout 2: mxscout/ is committed with the app)');
      console.log('local part: ' + local + (local === path.join(folder, '.local') ? ' (mxscout/.local/ — no MxScout folder found)' : ' (in the MxScout folder — this person\'s, never committed)'));
      console.log(languageLine(project.contentLanguage || null));
      console.log('model in the repository: ' + (head ? (head.branch ? head.branch + ' @ ' : '') + head.short + (head.message ? ' · ' + head.message : '') : 'unknown — no readable .git beside mxscout/'));
      if (!parts.length) console.log('descriptions: none yet in mxscout/descriptions/');
      else if (conflicted.length) console.log('descriptions: GIT CONFLICT in ' + conflicted.join(', ') + ' — resolve it (or keep one side in MxScout) before anything else');
      else if (!at) console.log('descriptions: ' + parts.length + ' files in mxscout/descriptions/, describing a version that is not known');
      else if (head && head.commit === at.commit) console.log('descriptions: describe HEAD (' + at.short + ') — up to date. Nothing to update unless the person asks for more.');
      else console.log('descriptions: describe ' + at.short + (at.date ? ' (' + at.date.slice(0, 10) + ')' : '') + '; HEAD is ' + (head ? head.short : 'unknown') +
        ' — what changed: git log --oneline ' + at.short + '..HEAD in ' + repoDir + ' (local, read-only); combine it with check-descriptions.js todo --folder and describe only that');
      let docsState = 'none yet';
      const { text: manText, man } = readManifest();
      if (man) {
        const damage = manifestDamage(man);
        docsState = (man.descriptions ? 'made from ' + (man.described ? man.described.slice(0, 7) : 'an unknown version') : 'unknown') +
          (damage.length ? ' — ' + damage.length + ' file(s) docs/manifest.json lists are missing or changed: node agent.js update-docs --repair writes them again' : '');
      } else if (manText !== null || fs.existsSync(path.join(folder, 'docs'))) docsState = 'docs/manifest.json unreadable (a git conflict?) — node agent.js update-docs writes docs/ again';
      console.log('docs: ' + docsState + ' — committed Markdown, docs/index.md is the map; made from the descriptions and the solved cases (MxScout writes it, or node agent.js update-docs)');
      const cases = R.casesOf(caseFiles(folder));
      console.log('solved cases: ' + (cases.length ? cases.length + ' in mxscout/knowledge/ — search them first for a similar problem (grep the front matter), and cite one by its id' : 'none yet in mxscout/knowledge/'));
      if (pack) console.log(snapshotLine(pack) + (header(pack.text, 'model') ? ' · model ' + header(pack.text, 'model') : ''));
      else console.log('snapshot: none — the .mpr could not be read and there is no .local/ai-pack.md; read docs/ and the model in Studio Pro');
      const modules = pack ? parseIndex(pack.text.split('\n')) : null;
      if (modules) { console.log('module | lines | microflows | nanoflows | pages | entities'); modules.forEach((m) => console.log(m.name + ' | ' + m.from + '-' + m.to + ' | ' + m.microflows + ' | ' + m.nanoflows + ' | ' + m.pages + ' | ' + m.entities)); }
      if (docs) console.log('documentation: ' + path.join(local, 'documentation.md') + ' (the whole documentation; read it first, as the map)');
      const waiting = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => /\.(json|md)$/i.test(f) && f[0] !== '.') : [];
      console.log('inbox: ' + (waiting.length ? waiting.length + ' file(s) waiting in .local/inbox/: ' + waiting.join(', ') : 'empty'));
      console.log('commit: MxScout never runs git. When the descriptions are updated, the person commits mxscout/ on its own ("Update documentation").');
      console.log('work folder: ' + workDir() + ' — every working file goes here (packs, notes, drafts, JSON before it is sent), never into the project');
    } else if (cmd === 'docs') {
      const docs = read('documentation.md', false);
      const text = docs || (fs.existsSync(path.join(folder, 'docs', 'index.md')) ? null : '');
      if (text === null) { console.log('No .local/documentation.md on this machine. Read ' + path.join(folder, 'docs', 'index.md') + ' — the map — and the files it links: the same documentation, by topic.'); return; }
      if (!text) { console.log('No documentation yet: this project has no descriptions. The AI pack is all there is — read it by module.'); return; }
      if (out) { const f = writeOut(out, text); console.log('Wrote ' + f + ' (' + text.split('\n').length + ' lines) — what an agent understood earlier; verify against the pack.'); } else process.stdout.write(text);
    } else if (cmd === 'module' && arg) {
      const pack = await packText(true);
      const lines = pack.text.split('\n');
      const mod = (parseIndex(lines) || []).find((m) => m.name === arg);
      if (!mod) fail('No module ' + arg + ' in the pack (snapshot ' + pack.id + '; its ## index lists the modules).');
      const text = lines.slice(mod.from - 1, mod.to).join('\n') + '\n';
      if (out) { const f = writeOut(out, text); console.log('Wrote ' + f + ' (' + text.split('\n').length + ' lines). ' + snapshotLine(pack)); } else { console.error(snapshotLine(pack)); process.stdout.write(text); }
    } else if (cmd === 'pack' && arg) {
      const pack = await packText(true);
      const f = writeOut(arg, pack.text);
      console.log('Wrote ' + f + ' — for the checker, not for reading whole.');
      console.log(snapshotLine(pack));
    } else if (cmd === 'send' && arg) {
      sendTo(inbox, await packText(false), project.name);
    } else if (cmd === 'verify-docs') {
      const { text: manText, man } = readManifest();
      if (!man) {
        const msg = manText === null ? 'docs/: no docs/manifest.json — no documentation written yet (node agent.js update-docs writes it).' : 'docs/manifest.json cannot be read (a git conflict?) — node agent.js update-docs writes docs/ again.';
        if (asJson) console.log(JSON.stringify({ ok: false, manifest: manText === null ? 'missing' : 'unreadable', damage: [], current: null }, null, 2)); else console.log(msg);
        process.exit(1);
      }
      const damage = manifestDamage(man);
      let current = null;
      if (!conflicted.length) {
        try {
          const E = engine();
          const joined = R.join(parts, at);
          if (!joined.error && joined.value) {
            const value = E.MxDescribe.parse(JSON.stringify(joined.value)).value;
            const listed = R.casesOf(caseFiles(folder)).map((c) => ({ path: c.path, text: c.text }));
            current = man.descriptions === await R.descriptionsHash(R.split(E.MxDescribe.toFile(value)).concat(listed), value.describedAt);
          } else if (!joined.error) current = false;
        } catch (e) { current = null; }
      }
      const ok = !damage.length && current !== false;
      if (asJson) console.log(JSON.stringify({ ok, files: man.files.length, damage, current }, null, 2));
      else {
        console.log(damage.length ? 'docs/: ' + damage.length + ' of the ' + man.files.length + ' file(s) docs/manifest.json lists are missing or changed:' : 'docs/: every one of the ' + man.files.length + ' file(s) docs/manifest.json lists is there, with its SHA-256.');
        damageLines(damage).forEach((l) => console.log(l));
        console.log(current === true ? 'It is made from the descriptions and solved cases there now.' : current === false ? 'It is made from other descriptions or solved cases than the ones there now — node agent.js update-docs brings it up to date.' : 'Whether it is made from the descriptions there now could not be told' + (conflicted.length ? ' (a git conflict in ' + conflicted[0] + ')' : '') + '.');
        if (damage.length) console.log('node agent.js update-docs --repair writes them again.');
      }
      process.exit(ok ? 0 : 1);
    } else if (cmd === 'update-docs') {
      if (conflicted.length) fail('mxscout/' + conflicted[0] + ' has a git conflict: resolve it first (or keep one side in MxScout), then update docs/.');
      let r;
      try { r = await docsPlan(project, parts, { repair }); } catch (e) { fail('docs/ could not be made: ' + ((e && e.message) || e) + ' — nothing was written.'); }
      if (r.state === 'damaged') {
        console.log('docs/ is made from these descriptions and solved cases, but ' + r.damage.length + ' of the ' + r.files + ' file(s) docs/manifest.json lists are missing or changed:');
        damageLines(r.damage).forEach((l) => console.log(l));
        fail('docs/ is not as its manifest says — nothing written. node agent.js update-docs --repair writes them again.');
      }
      if (dryRun) { printPlan(planOf(r.ops), { state: r.state }); return; }
      const backup = publish(r.ops);
      console.log(docsLine(r));
      if (backup) console.log('The files it replaced or removed are kept in ' + backup + '.');
      if (r.ops.length) console.log('Commit mxscout/ with it: git add mxscout && git commit -m "Update documentation" (MxScout never runs git).');
    } else if (cmd === 'case' && arg) {
      const pack = await packText(false);
      if (pack && !(asJson && dryRun)) console.log(snapshotLine(pack));
      const c = caseNote(pack);
      const rel = 'knowledge/' + c.name;
      let was = null;
      try { was = fs.readFileSync(path.join(folder, rel), 'utf8'); } catch (e) { was = null; }
      const ops = was === c.text ? [] : [{ path: rel, text: c.text }];
      // docs/ with the note in it, made before anything is written; a git conflict leaves docs/ for later, and says so.
      let d = null;
      if (conflicted.length) { if (!noDocs) console.log('docs/ is left as it is: mxscout/' + conflicted[0] + ' has a git conflict — resolve it, then node agent.js update-docs.'); }
      else d = await docsPart(project, parts, caseFiles(folder).filter((f) => f.path !== rel).concat([{ path: rel, text: c.text }]).sort((a, b) => (a.path < b.path ? -1 : 1)));
      const all = ops.concat(d ? d.ops : []);
      if (dryRun) { printPlan(planOf(all), { snapshot: pack ? pack.id : null }); return; }
      const backup = publish(all);
      console.log((was === null ? 'Wrote ' : was === c.text ? 'Already there, the same: ' : 'Rewrote ') + path.join(folder, rel) + '.');
      if (d) console.log(docsLine(d));
      else if (noDocs) console.log('docs/ was left as it is (--no-docs): node agent.js update-docs brings it up to date, or MxScout the next time the project is open there.');
      if (backup) console.log('The files it replaced or removed are kept in ' + backup + '.');
      console.log('The person commits it with the fix: git add mxscout && git commit (MxScout never runs git).');
    } else if (cmd === 'write' && arg) {
      if (conflicted.length) fail('mxscout/' + conflicted[0] + ' has a git conflict: resolve it first (or keep one side in MxScout), then write.');
      const from = readIn(arg);
      let given;
      try { given = JSON.parse(fs.readFileSync(from, 'utf8')); } catch (e) { fail('Cannot read ' + from + ' as JSON.'); }
      if (!given || given.format !== 'mxscout-descriptions') fail(from + ' is not a descriptions file (it should say "format": "mxscout-descriptions").');
      if (replaceAll && given.add === true) fail(from + ' says "add": true, and --replace says to replace everything — one or the other. Nothing was written.');
      // Everything checked against the model as it is now, before a byte is written.
      const pack = await packText(true);
      if (!(asJson && dryRun)) console.log(snapshotLine(pack));
      report(checkDescriptions(given, pack, project.name, { noChanges: true }), from);
      const joined = R.join(parts, at);
      if (joined.error) fail(joined.error + ' — fix it before writing.');
      // Merge, unless --replace: the file laid over what is there, as MxScout imports a file with "add": true —
      // nothing it does not name goes. --replace: the file is the whole of the descriptions.
      const mode = replaceAll ? 'replace' : 'merge';
      if (mode === 'merge' && given.add !== true && joined.value && !(asJson && dryRun)) console.log('Note: the file has no "add": true; it is laid over the descriptions there (merge), and nothing it leaves out is removed. To make it the whole of them, pass --replace (--dry-run first shows what would go).');
      const C = require('./check-descriptions.js');
      const merged = mode === 'merge' && joined.value ? C.merge([joined.value, Object.assign({}, given, { add: true })]) : given;
      const next = R.split(shaped(merged));
      const ops = [];
      const now = {};
      next.forEach((p) => {
        now[p.path] = true;
        let was = null;
        try { was = fs.readFileSync(path.join(folder, p.path), 'utf8'); } catch (e) { was = null; }
        if (was !== p.text) ops.push({ path: p.path, text: p.text });
      });
      const left = parts.filter((p) => !now[p.path]);
      // A part the file does not replace stays, whatever: only --replace removes one.
      if (mode === 'replace') left.forEach((p) => ops.push({ path: p.path, remove: true }));
      const nextParts = mode === 'replace' ? next : next.concat(left);
      // mxscout.json: the version they describe is HEAD now; the language, when the file sets it.
      const lang = given.setLanguage === true && typeof given.language === 'string' ? given.language.trim().toLowerCase().slice(0, 20) : project.contentLanguage || null;
      const pj = R.projectJson({ id: project.id, name: project.name, contentLanguage: lang }, head);
      if (read('mxscout.json', false) !== pj) ops.push({ path: 'mxscout.json', text: pj });
      // docs/ from what descriptions/ will hold — made now, or nothing is written.
      const d = await docsPart(JSON.parse(pj), nextParts.slice().sort((a, b) => (a.path < b.path ? -1 : 1)));
      const all = ops.concat(d ? d.ops : []);
      if (dryRun) { printPlan(planOf(all), { mode, snapshot: pack.id, describes: head ? head.commit : null }); return; }
      const backup = publish(all);
      const wrote = ops.filter((o) => !o.remove && o.path !== 'mxscout.json').length, removed = ops.filter((o) => o.remove).length;
      console.log('Wrote ' + wrote + ' file(s) in ' + path.join(folder, 'descriptions') + (removed ? ', removed ' + removed : '') + (wrote || removed ? '' : ' — nothing changed') +
        ' (' + mode + '); they describe ' + versionOf(head) + '.');
      if (removed) ops.filter((o) => o.remove).forEach((o) => console.log('  removed ' + o.path));
      // docs/ follows them in the same step, as MxScout would write it — so the commit carries docs/ that match.
      if (d) console.log(docsLine(d));
      else console.log('docs/ was left as it is (--no-docs): node agent.js update-docs brings it up to date, or MxScout the next time the project is open there.');
      if (backup) console.log('The files it replaced or removed are kept in ' + backup + '.');
      console.log('Then the person commits mxscout/ on its own: git add mxscout && git commit -m "Update documentation" (MxScout never runs git).');
    } else usage();
  })().catch((e) => fail('agent.js: ' + ((e && e.message) || e)));
}

// ---------- the channel ----------
function viaChannel() {
  const base = String(urlArg || process.env.MXSCOUT_URL || 'http://127.0.0.1:4289').replace(/\/+$/, '');
  const token = tokenArg || process.env.MXSCOUT_TOKEN;
  let host;
  try { host = new URL(base).hostname; } catch (e) { fail('Not an address: ' + base); }
  if (host !== '127.0.0.1' && host !== 'localhost') fail('Refusing ' + base + ': MxScout is on this machine, at 127.0.0.1.');
  if (!token) fail(noProject());
  const waitMs = Number(process.env.MXSCOUT_TIMEOUT_MS) > 0 ? Number(process.env.MXSCOUT_TIMEOUT_MS) : 30000;
  const gaveUp = () => 'MxScout at ' + base + ' did not answer within ' + (waitMs / 1000) + ' s — is it busy, or stopped? (MXSCOUT_TIMEOUT_MS sets the wait.)';

  async function call(p, opts, quiet) {
    // Given up after waitMs, the answer's body included; the timer does not keep a finished command waiting.
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), waitMs).unref();
    let res;
    try { res = await fetch(base + p, Object.assign({ headers: { Authorization: 'Bearer ' + token } }, opts, { redirect: 'error', signal: ctl.signal })); }
    catch (e) {
      if (ctl.signal.aborted) fail(gaveUp());
      // MxScout never redirects; whatever does is not MxScout, and the token does not follow it.
      if (/redirect/i.test(String((e && e.cause && e.cause.message) || (e && e.message) || ''))) fail('Refusing a redirect from ' + base + p + ': the token goes to MxScout on this machine only.');
      fail('Could not reach MxScout at ' + base + ' — is it running?');
    }
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch (e) { /* not JSON */ }
      // No documentation yet is an answer, not an error: the caller says so plainly.
      if (quiet && body.documentation === false) return null;
      fail('MxScout says: ' + (body.error || res.status));
    }
    return res;
  }

  // The work folder is named after the shared project when nothing on disk says which project this is.
  async function named() {
    if (workAt || !workNeedsName()) return;
    const s = await (await call('/api/agent/status')).json();
    workDir(s.project);
  }

  // The pack MxScout shares — the model as it has it now; the snapshot every command says it used.
  let sharedPack = null;
  async function shared() {
    if (!sharedPack) {
      const text = await (await call('/api/agent/pack')).text();
      sharedPack = { text, id: snapshotOf(text), file: null, from: 'the pack MxScout shares at ' + base + (header(text, 'generated') ? ', model read ' + header(text, 'generated') : ''), verified: null };
    }
    return sharedPack;
  }
  async function post(body) {
    await call('/api/agent/descriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body });
  }

  return (async function () {
    if (cmd === 'workdir') {
      await named();
      console.log(workDir(null, true));
      return;
    }
    if (refresh && ['status', 'module', 'pack', 'snapshot'].indexOf(cmd) !== -1) console.error('Note: --refresh does nothing through the channel — MxScout shares the model it has; reading the model again is done in MxScout.');
    if (out || ['pack', 'send', 'case'].indexOf(cmd) !== -1) await named();
    if (cmd === 'snapshot') {
      const p = await shared();
      if (asJson) console.log(JSON.stringify({ id: p.id, file: null, from: p.from, verified: p.verified }, null, 2)); else console.log(snapshotLine(p));
    } else if (cmd === 'status') {
      const s = await (await call('/api/agent/status')).json();
      if (workNeedsName()) workDir(s.project);
      console.log('project: ' + s.project + (s.mendix ? ' (Mendix ' + s.mendix + ')' : ''));
      console.log(languageLine(s.language || null));
      // The commits themselves are in the documentation's header (node agent.js docs): model commit, described commit.
      versionLines(s.model || null, null, s.documentation && s.documentation.describedAt, null, null).forEach((l) => console.log(l));
      if (s.documentation && s.documentation.describedAt) console.log('the commits, and what moved since: the header of node agent.js docs (model commit, described commit, since then)');
      console.log('shared: ' + s.sharedAt + (s.generated ? ' · model read ' + s.generated : ''));
      console.log(snapshotLine(await shared()));
      console.log('module | microflows | nanoflows | pages | entities');
      s.modules.forEach((m) => console.log(m.name + ' | ' + m.microflows + ' | ' + m.nanoflows + ' | ' + m.pages + ' | ' + m.entities));
      const d = s.documentation;
      if (d) console.log('documentation: yes — ' + d.described + ' of ' + d.flows + ' flows described, ' + (d.stale ? d.stale + ' out of date (the flow changed since)' : 'none out of date') + '; generated ' + d.generatedAt + '. Read it first: node agent.js docs --out docs.md');
      else console.log('documentation: none yet — this project has no descriptions; the pack is all there is.');
      if (s.descriptions) console.log('waiting in MxScout for the person to accept: descriptions sent ' + s.descriptions.receivedAt);
      console.log('work folder: ' + workDir() + ' — every working file goes here (packs, notes, drafts, JSON before it is sent), never into the project');
    } else if (cmd === 'docs') {
      const res = await call('/api/agent/docs', undefined, true);
      if (!res) { console.log('No documentation yet: this project has no descriptions. The AI pack is all there is — read it by module.'); return; }
      const text = await res.text();
      if (out) { const f = writeOut(out, text); console.log('Wrote ' + f + ' (' + text.split('\n').length + ' lines) — what an agent understood earlier; verify against the pack.'); } else process.stdout.write(text);
    } else if (cmd === 'module' && arg) {
      const text = await (await call('/api/agent/module?name=' + encodeURIComponent(arg))).text();
      const p = await shared();
      if (out) { const f = writeOut(out, text); console.log('Wrote ' + f + ' (' + text.split('\n').length + ' lines). ' + snapshotLine(p)); } else { console.error(snapshotLine(p)); process.stdout.write(text); }
    } else if (cmd === 'pack' && arg) {
      const p = await shared();
      const f = writeOut(arg, p.text);
      console.log('Wrote ' + f + ' — for the checker, not for reading whole.');
      console.log(snapshotLine(p));
    } else if (cmd === 'send' && arg) {
      // Checked against the model MxScout shares, before it goes.
      const s = await (await call('/api/agent/status')).json();
      const h = handedIn(await shared(), s.project || null);
      if (dryRun) { printPlan([{ path: 'MxScout at ' + base + ' (' + h.kind + ')', action: 'add' }], { kind: h.kind }); return; }
      const body = h.note ? JSON.stringify({ format: 'mxscout-knowledge', version: 1, cases: [{ path: 'knowledge/' + path.basename(h.file), text: h.body }] }) : h.body;
      await post(body);
      console.log('Sent. MxScout saves it at once, with Undo — unless the person turned that off, or it is a whole file that would replace the descriptions kept: then it waits for them to press Import them.');
    } else if (cmd === 'case' && arg) {
      const p = await shared();
      if (!(asJson && dryRun)) console.log(snapshotLine(p));
      const c = caseNote(p);
      if (dryRun) { printPlan([{ path: 'knowledge/' + c.name + ' (through MxScout at ' + base + ')', action: 'add' }]); return; }
      await post(JSON.stringify({ format: 'mxscout-knowledge', version: 1, cases: [{ path: 'knowledge/' + c.name, text: c.text }] }));
      console.log('Sent. MxScout writes it into the project\'s knowledge/ at once, with Undo.');
    } else usage();
  })().catch((e) => fail(e && e.name === 'AbortError' ? gaveUp() : 'agent.js: ' + ((e && e.message) || e)));
}

function usage() {
  console.error('Usage: node agent.js workdir | snapshot [--json] | status | docs [--out file] | module <Name> [--out file] | pack <file> | send <file> | write <descriptions.json> [--replace] | update-docs [--repair] | verify-docs [--json] | case <note.md>\n' +
    '  write, send, case, update-docs: --dry-run prints what would be added, changed and removed (--json as JSON) and writes nothing\n' +
    '  status, snapshot, module, pack: --refresh makes the pack from the .mpr again; write, case: --no-docs leaves docs/ as it is\n' +
    '  a file without a path is in the work folder (node agent.js workdir prints it)\n' +
    '  in a project folder: --folder <dir> (or MXSCOUT_FOLDER, or run it inside the folder); inside a Mendix project: its directory or its mxscout/\n' +
    '  through the agent channel: MXSCOUT_TOKEN, MXSCOUT_URL (or --token T, --url U)');
  process.exit(2);
}

const channel = !!(tokenArg || process.env.MXSCOUT_TOKEN);
if (cmd === 'workdir' && (folder || !channel || !workNeedsName())) {
  console.log(workDir(null, true));
} else if (cmd === 'case' && arg && !folder && !channel && mendixHere()) {
  // A Mendix project with no MxScout at all: the note goes into its mxscout/knowledge/, made for it — nothing else.
  const c = caseNote();
  const to = path.join(mendixHere().dir, 'mxscout', 'knowledge', c.name);
  if (dryRun) {
    if (asJson) console.log(JSON.stringify({ dryRun: true, files: [{ path: to, action: fs.existsSync(to) ? 'change' : 'add' }] }, null, 2));
    else console.log('Dry run — nothing written. ' + (fs.existsSync(to) ? 'change ' : 'add ') + to);
    process.exit(0);
  }
  writeWhole(to, c.text);
  console.log('Wrote ' + to + ' — the person commits it with the fix (MxScout never runs git). It needs nothing else beside it.');
} else if (folder) {
  if (!fs.existsSync(path.join(folder, 'project.json')) && !repo && mendixHere()) fail(noProject());
  if (!fs.existsSync(path.join(folder, 'project.json')) && !repo) fail('No project.json or mxscout.json in ' + folder + ' — that is not an MxScout project folder, nor a Mendix project with MxScout\'s files in mxscout/. In MxScout: Documentation → Write with Claude shows where the project is kept.');
  if (cmd === 'write' && !repo) fail('write is for a project kept inside the Mendix project (mxscout/); in a project folder of its own, use send — MxScout takes it from inbox/.');
  if ((cmd === 'update-docs' || cmd === 'verify-docs') && !repo) fail(cmd + ' is for a project kept inside the Mendix project (mxscout/docs/); a project folder of its own has no docs/ — MxScout writes documentation.md there.');
  inFolder();
} else viaChannel();
