#!/usr/bin/env node
/* The mendix-describe skill's checker. No dependencies — Node only.
 *
 *   node check-descriptions.js todo  <pack.md> [descriptions.json] [--list]
 *       What is left to describe, per module: new flows, flows that changed
 *       since they were described (their fingerprint moved), and whether the
 *       application overview is there. Run it first; describe only that.
 *
 *   node check-descriptions.js check <pack.md> <descriptions.json>
 *       Whether MxScout will accept the file, and whether it says what it
 *       should: the format, every name exists in the pack, every fingerprint
 *       matches, no description is empty or overlong. Exit code 1 on errors.
 *
 *   node check-descriptions.js merge <out.json> <part.json> [<part.json> …]
 *       One file from several, later parts winning per name — for describing
 *       module by module, or in parallel, and writing one part per batch.
 *
 * The format it checks is the one public/describe.js in MxScout parses. If the
 * two ever disagree, MxScout is the one that is right: it is what the person
 * imports the file into.
 */
'use strict';
const fs = require('fs');

const DESC_FORMAT = 'mxscout-descriptions';
const KINDS = { MF: 'microflows', NF: 'nanoflows', PG: 'pages' };
const TABLES = ['modules', 'microflows', 'nanoflows', 'pages', 'entities'];
const LIMITS = { flow: 400, entity: 300, module: 600, summary: 2500 };

// ---------- reading the pack ----------
function readPack(text) {
  const lines = String(text).split(/\r?\n/);
  if (!/^format: mxscout-ai-pack 1\b/m.test(text)) throw new Error('This is not an MxScout AI pack (no "format: mxscout-ai-pack 1" line).');
  const pack = { project: null, modules: {}, microflows: {}, nanoflows: {}, pages: {}, entities: {} };
  const project = /^project: (.+)$/m.exec(text);
  pack.project = project ? project[1].trim() : null;
  let module = null;
  lines.forEach((line, i) => {
    let m = /^## module (\S+)/.exec(line);
    if (m) { module = m[1]; pack.modules[module] = { line: i + 1, flows: 0 }; return; }
    m = /^### (MF|NF|PG) (\S+) #([0-9a-f]{8})/.exec(line);
    if (m) { pack[KINDS[m[1]]][m[2]] = { hash: m[3], module, line: i + 1 }; if (m[1] !== 'PG' && module) pack.modules[module].flows++; return; }
    m = /^E (\S+) #([0-9a-f]{8})/.exec(line);
    if (m && module) pack.entities[module + '.' + m[1]] = { hash: m[2], module, line: i + 1 };
  });
  return pack;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(file + ': ' + e.message); }
}
function textOf(v) { return typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.text === 'string' ? v.text : null); }
function hashOf(v) { return v && typeof v === 'object' && typeof v.hash === 'string' ? v.hash : null; }

// ---------- todo ----------
function todo(pack, desc) {
  desc = desc || {};
  const per = {};
  Object.keys(pack.modules).forEach((m) => { per[m] = { module: m, line: pack.modules[m].line, fresh: [], changed: [] }; });
  ['microflows', 'nanoflows'].forEach((kind) => {
    Object.keys(pack[kind]).forEach((qn) => {
      const p = pack[kind][qn];
      const d = (desc[kind] || {})[qn];
      const row = per[p.module];
      if (!row) return;
      if (!textOf(d)) row.fresh.push(qn);
      else if (hashOf(d) !== p.hash) row.changed.push(qn);
    });
  });
  const modules = Object.keys(per).map((k) => per[k]).filter((r) => r.fresh.length + r.changed.length);
  const missingModules = Object.keys(pack.modules).filter((m) => !textOf((desc.modules || {})[m]));
  return {
    modules: modules,
    flows: modules.reduce((n, r) => n + r.fresh.length + r.changed.length, 0),
    overview: !(desc.app && typeof desc.app === 'object' && typeof desc.app.summary === 'string' && desc.app.summary.trim()),
    missingModules: missingModules
  };
}

// ---------- check ----------
function check(pack, desc) {
  const problems = [];
  const err = (text) => problems.push({ level: 'error', text });
  const warn = (text) => problems.push({ level: 'warning', text });
  if (!desc || typeof desc !== 'object') { err('The file is not a JSON object.'); return problems; }
  if (desc.format !== DESC_FORMAT) err('"format" must be "' + DESC_FORMAT + '" — MxScout refuses the file without it.');
  if (desc.version !== 1) err('"version" must be 1.');
  if (pack.project && desc.project && desc.project !== pack.project) warn('"project" is "' + desc.project + '" but the pack is for "' + pack.project + '".');
  TABLES.forEach((k) => {
    const table = desc[k];
    if (table === undefined) return;
    if (!table || typeof table !== 'object' || Array.isArray(table)) { err('"' + k + '" must be an object keyed by qualified name.'); return; }
    Object.keys(table).forEach((name) => {
      const v = table[name];
      const text = textOf(v);
      if (!text || !text.trim()) { err(k + ' ' + name + ': empty description.'); return; }
      const limit = k === 'modules' ? LIMITS.module : k === 'entities' ? LIMITS.entity : LIMITS.flow;
      if (text.length > limit) warn(k + ' ' + name + ': ' + text.length + ' characters; aim for under ' + limit + ' — it is shown in lists.');
      if (k === 'modules') { if (!pack.modules[name]) warn('modules ' + name + ': no such module in the pack.'); return; }
      const known = pack[k][name];
      if (!known) { err(k + ' ' + name + ': not in the pack — a misspelt or invented name never shows in MxScout.'); return; }
      if (k !== 'pages' && !hashOf(v)) warn(k + ' ' + name + ': no "hash" — copy the #fingerprint from the pack, or MxScout cannot tell when it goes out of date.');
      else if (hashOf(v) && hashOf(v) !== known.hash) warn(k + ' ' + name + ': hash ' + hashOf(v) + ' does not match the pack (' + known.hash + ') — the flow changed; describe it again.');
    });
  });
  if (desc.app !== undefined) {
    const a = desc.app;
    if (!a || typeof a !== 'object') err('"app" must be an object.');
    else {
      if (typeof a.summary !== 'string' || !a.summary.trim()) warn('app.summary is empty — it is the first thing a business reader sees.');
      else if (a.summary.length > LIMITS.summary) warn('app.summary is ' + a.summary.length + ' characters; aim for under ' + LIMITS.summary + '.');
      (Array.isArray(a.processes) ? a.processes : []).forEach((p, i) => {
        if (!p || typeof p.name !== 'string' || !p.name.trim()) { err('app.processes[' + i + '] has no name.'); return; }
        (Array.isArray(p.flows) ? p.flows : []).forEach((qn) => {
          if (!pack.microflows[qn] && !pack.nanoflows[qn] && !pack.pages[qn]) warn('process "' + p.name + '" names ' + qn + ', which is not in the pack — it shows as plain text, not a link.');
        });
      });
    }
  }
  return problems;
}

// ---------- merge ----------
function merge(parts) {
  const out = { format: DESC_FORMAT, version: 1 };
  parts.forEach((p) => {
    ['project', 'language', 'by', 'written'].forEach((k) => { if (typeof p[k] === 'string' && p[k]) out[k] = p[k]; });
    if (p.app && typeof p.app === 'object') out.app = p.app;
    TABLES.forEach((k) => {
      if (!p[k] || typeof p[k] !== 'object') return;
      out[k] = Object.assign(out[k] || {}, p[k]);
    });
  });
  return out;
}

// ---------- the command line ----------
function main(argv) {
  const [cmd, ...rest] = argv;
  const list = rest.indexOf('--list') !== -1;
  const args = rest.filter((a) => a !== '--list');
  if (cmd === 'todo' && args[0]) {
    const pack = readPack(fs.readFileSync(args[0], 'utf8'));
    const desc = args[1] && fs.existsSync(args[1]) ? readJson(args[1]) : null;
    const t = todo(pack, desc);
    console.log(t.flows + ' flows to describe in ' + t.modules.length + ' modules' + (t.overview ? '; the application overview is missing' : '') +
      (t.missingModules.length ? '; ' + t.missingModules.length + ' modules have no description' : '') + '.');
    t.modules.forEach((r) => {
      console.log('  ' + r.module + ' (pack line ' + r.line + '): ' + r.fresh.length + ' new, ' + r.changed.length + ' changed');
      if (list) r.fresh.concat(r.changed).forEach((qn) => console.log('    ' + qn));
    });
    return 0;
  }
  if (cmd === 'check' && args[1]) {
    const problems = check(readPack(fs.readFileSync(args[0], 'utf8')), readJson(args[1]));
    problems.forEach((p) => console.log(p.level.toUpperCase() + '  ' + p.text));
    const errors = problems.filter((p) => p.level === 'error').length;
    console.log(errors ? errors + ' error(s): MxScout will not show what they are about.' : 'OK — MxScout will accept this file' + (problems.length ? ' (' + problems.length + ' warning(s))' : '') + '.');
    return errors ? 1 : 0;
  }
  if (cmd === 'merge' && args.length >= 2) {
    const merged = merge(args.slice(1).map(readJson));
    fs.writeFileSync(args[0], JSON.stringify(merged, null, 2) + '\n');
    const n = ['microflows', 'nanoflows', 'pages', 'entities'].reduce((s, k) => s + Object.keys(merged[k] || {}).length, 0);
    console.log('Wrote ' + args[0] + ': ' + n + ' descriptions from ' + (args.length - 1) + ' parts.');
    return 0;
  }
  console.log('Usage:\n  node check-descriptions.js todo  <pack.md> [descriptions.json] [--list]\n  node check-descriptions.js check <pack.md> <descriptions.json>\n  node check-descriptions.js merge <out.json> <part.json> [<part.json> …]');
  return 2;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exitCode = 2; }
}
module.exports = { readPack, todo, check, merge, DESC_FORMAT };
