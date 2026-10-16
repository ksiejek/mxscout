#!/usr/bin/env node
/* The mxscout-project skill's script. No dependencies — Node only.
 *
 * A library of MxScout projects is one folder on disk with a folder of its own for each project — what
 * MxScout writes when documentation is imported into a library folder, or with Move all projects to
 * folders… (each holds project.json, documentation.md, ai-pack.md, descriptions.json, knowledge/ …). A
 * Mendix project kept with mxscout/ inside it counts too.
 *
 *   node projects.js where              where the library is: $MXSCOUT_PROJECTS, else the folder saved with `set`
 *   node projects.js set <folder>       remember the library (in ~/.mxscout/library.json — outside every project)
 *   node projects.js list [--find w]    the projects in it, numbered: name, whether described, the model's version
 *   node projects.js show <n | name>    one project: its folder, and the head of its documentation
 *
 * It reads; the only file it writes is ~/.mxscout/library.json, with `set`. It never writes into the
 * library or into a Mendix project.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = path.join(os.homedir(), '.mxscout', 'library.json');

function out(s) { process.stdout.write(s + '\n'); }
function fail(s) { process.stderr.write(s + '\n'); process.exit(1); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
function lf(t) { return String(t).replace(/\r\n?/g, '\n'); }

function where() {
  if (process.env.MXSCOUT_PROJECTS) return { dir: path.resolve(process.env.MXSCOUT_PROJECTS), from: 'MXSCOUT_PROJECTS' };
  const c = readJson(CONFIG);
  if (c && typeof c.library === 'string' && c.library) return { dir: c.library, from: CONFIG };
  return null;
}

// One project of the library: a folder holding project.json (a project folder), or a Mendix project with mxscout/.
function projectIn(dir) {
  const pj = readJson(path.join(dir, 'project.json'));
  // The local part of a project kept in its Mendix project: its documentation.md and ai-pack.md are here.
  if (pj && pj.format === 'mxscout-project' && pj.part === 'local') {
    return { name: pj.name || path.basename(dir), dir: dir, docs: path.join(dir, 'documentation.md'), pack: path.join(dir, 'ai-pack.md'),
      described: fs.existsSync(path.join(dir, 'documentation.md')), version: null, language: null, kind: 'mendix' };
  }
  if (pj && pj.format === 'mxscout-project') {
    return { name: pj.name || path.basename(dir), dir: dir, docs: path.join(dir, 'documentation.md'), pack: path.join(dir, 'ai-pack.md'),
      described: !!pj.descriptions || fs.existsSync(path.join(dir, 'descriptions.json')), version: (pj.model && pj.model.version) || null, language: pj.contentLanguage || null, kind: 'folder' };
  }
  const mx = readJson(path.join(dir, 'mxscout', 'mxscout.json'));
  if (mx) {
    const local = path.join(dir, 'mxscout', '.local');
    return { name: mx.name || path.basename(dir), dir: dir, docs: path.join(local, 'documentation.md'), pack: path.join(local, 'ai-pack.md'),
      described: fs.existsSync(path.join(dir, 'mxscout', 'descriptions')), version: mx.described || null, language: mx.contentLanguage || null, kind: 'mendix' };
  }
  return null;
}

function projects(lib) {
  let names;
  try { names = fs.readdirSync(lib, { withFileTypes: true }); } catch (e) { fail('The library ' + lib + ' cannot be read: ' + e.message); }
  return names.filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => projectIn(path.join(lib, d.name))).filter(Boolean)
    .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
}

function versionText(v) {
  if (!v) return 'version unknown';
  if (typeof v === 'string') return v;
  return [v.branch, v.short || (v.commit ? String(v.commit).slice(0, 7) : null)].filter(Boolean).join(' @ ') || 'version unknown';
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === 'where') {
    const w = where();
    out(w ? 'library: ' + w.dir + '\n(from ' + w.from + ')' : 'No library yet. Ask the person which folder holds their MxScout projects, then: node projects.js set <folder>');
    return 0;
  }
  if (cmd === 'set') {
    if (!argv[1]) fail('Name the folder: node projects.js set <folder>');
    const dir = path.resolve(argv[1]);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(dir + ' is not a folder.');
    fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
    fs.writeFileSync(CONFIG, JSON.stringify({ library: dir }, null, 2) + '\n');
    out('library: ' + dir + ' (saved in ' + CONFIG + ')\n' + projects(dir).length + ' projects in it.');
    return 0;
  }
  const w = where();
  if (!w) fail('No library yet. Ask the person which folder holds their MxScout projects, then: node projects.js set <folder>');
  const list = projects(w.dir);
  if (cmd === 'list' || !cmd) {
    const i = argv.indexOf('--find'), words = i >= 0 ? String(argv[i + 1] || '').toLowerCase().split(/\s+/).filter(Boolean) : [];
    const shown = list.map((p, n) => [n + 1, p]).filter(([, p]) => words.every((x) => p.name.toLowerCase().indexOf(x) !== -1));
    out('library: ' + w.dir + ' — ' + list.length + ' project' + (list.length === 1 ? '' : 's'));
    shown.forEach(([n, p]) => out(n + '. ' + p.name + ' — ' + (p.described ? 'described' : 'model only') + ' · ' + versionText(p.version) + (p.kind === 'mendix' ? ' · in its Mendix project' : '')));
    if (!shown.length) out(list.length ? 'No project matches.' : 'No MxScout project in it yet — import documentation into this folder in MxScout, or Move all projects to folders….');
    return 0;
  }
  if (cmd === 'show') {
    const q = argv.slice(1).join(' ').trim();
    if (!q) fail('Name the project, or its number in the list: node projects.js show <n | name>');
    let p = /^\d+$/.test(q) ? list[Number(q) - 1] : null;
    if (!p) {
      const lower = q.toLowerCase();
      const hits = list.filter((x) => x.name.toLowerCase() === lower);
      const near = hits.length ? hits : list.filter((x) => x.name.toLowerCase().indexOf(lower) !== -1);
      if (near.length > 1) { out('More than one project matches "' + q + '":'); near.forEach((x) => out('- ' + x.name)); return 2; }
      p = near[0];
    }
    if (!p) fail('No project "' + q + '" in ' + w.dir + '. node projects.js list shows them.');
    out('project: ' + p.name);
    out('folder: ' + p.dir);
    out('documentation: ' + (fs.existsSync(p.docs) ? p.docs : 'none yet (' + p.docs + ')'));
    out('ai pack: ' + (fs.existsSync(p.pack) ? p.pack : 'none'));
    out('model: ' + versionText(p.version) + (p.language ? ' · written in ' + p.language : ''));
    if (fs.existsSync(p.docs)) {
      const head = lf(fs.readFileSync(p.docs, 'utf8')).split('\n').slice(0, 40).join('\n');
      out('\n--- the start of documentation.md ---\n' + head);
    }
    return 0;
  }
  fail('Unknown command. node projects.js where | set <folder> | list [--find words] | show <n | name>');
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)) || 0);
module.exports = { main, projects, projectIn, where, CONFIG };
