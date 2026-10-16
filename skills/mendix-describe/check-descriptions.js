#!/usr/bin/env node
/* The mendix-describe skill's checker. No dependencies — Node only.
 *
 *   node check-descriptions.js todo  <pack.md> [descriptions.json | docs.md] [--list]
 *       What is left to describe, per module: new flows, flows that changed
 *       since they were described (their fingerprint moved), whether the
 *       application overview is there, which modules have no long
 *       description yet, and whether risks and the developers' context are
 *       written. Run it first; describe only that.
 *       Connected to MxScout there is no descriptions file to give it — MxScout
 *       keeps it — so give it the documentation instead (node agent.js docs
 *       --out docs.md, which lands in the work folder): what is described
 *       there, and what is marked out of date, is read from it.
 *
 *   node check-descriptions.js todo --folder <project folder> [--list] [--refresh]
 *       The same, for a project MxScout keeps in a folder: its ai-pack.md and
 *       its descriptions.json. For a project kept inside the Mendix project
 *       (mxscout/), give the Mendix project's directory or its mxscout/: the
 *       pack is the current model's, as `agent.js snapshot` gives it — made
 *       from the .mpr when the work folder has none of this model yet, so a
 *       fresh checkout with no .local/ works (--refresh makes it again) — and
 *       the descriptions are the files in descriptions/, joined by MxScout's
 *       own rules (repodocs.js beside this file). The first line says which
 *       snapshot it used.
 *
 *   node check-descriptions.js check <pack.md> <descriptions.json>
 *   node check-descriptions.js check --folder <project folder> <descriptions.json>
 *       Whether MxScout will accept the file, and whether it says what it
 *       should: the format, every name exists in the pack, every fingerprint
 *       matches, no description is empty or overlong, and the application,
 *       its processes and its modules each have both layers of
 *       reference/business-narrative.md; every risk has a level of
 *       reference/risk-levels.md, its places and a fix; and, in an older file
 *       (reference/migration.md — the mendix-assist skill writes Assist items
 *       now), every change has an id, how it works now traced through flows
 *       that exist, a proposal and model changes that name what is there,
 *       unless they add it, and every ticket a verdict, its reasoning, evidence
 *       that names what is in the pack, and for a bug the change that fixes
 *       it. It warns about anything over the
 *       bounds MxScout keeps (CAPS below; reference/descriptions-format.md,
 *       "What MxScout keeps"). Exit code 1 on errors.
 *
 *   node check-descriptions.js merge <out.json> <part.json> [<part.json> …]
 *       One file from several, later parts winning per name (a change or a ticket per id,
 *       a risk per id, or per level and title) — for describing module by module, or in parallel, one part per
 *       batch. By the rules MxScout imports a file with "add": true by; parts that all
 *       add make a file that adds.
 *
 * A file named without a path is in the work folder (node agent.js workdir prints it: $MXSCOUT_WORK, or
 * <temp>/mxscout-work/<project>) — merge writes <out.json> there; a file to read is taken from there, or
 * from the current directory when it is not there. merge never writes inside the Mendix project or an
 * MxScout project folder: those hold only the documentation, which agent.js writes.
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
// A summary is two to four sentences; a story is several paragraphs (reference/business-narrative.md).
const LIMITS = { flow: 300, entity: 300, module: 600, summary: 900, story: 12000, storyMin: 300 };

// ---------- reading the pack ----------
function readPack(text) {
  const lines = String(text).split(/\r?\n/);
  if (!/^format: mxscout-ai-pack 1\b/m.test(text)) throw new Error('This is not an MxScout AI pack (no "format: mxscout-ai-pack 1" line).');
  const pack = { project: null, modules: {}, microflows: {}, nanoflows: {}, pages: {}, entities: {}, triage: [] };
  const project = /^project: (.+)$/m.exec(text);
  pack.project = project ? project[1].trim() : null;
  let module = null, inTriage = false;
  lines.forEach((line, i) => {
    // What a person decided about risks (reference/pack-format.md, "Risk triage"): id | level | status | who | title …
    if (line === '## risk triage') { inTriage = true; return; }
    if (/^## /.test(line)) inTriage = false;
    if (inTriage) {
      const t = /^- (\S+) \| (P[123]) \| ([a-z-]+) \| (ai|raised by [^|]*?) \| ([^|]*?)(?: \| where: [^|]*)?(?: \| note: (.*))?$/.exec(line);
      if (t) pack.triage.push({ id: t[1], level: t[2], status: t[3], person: t[4] !== 'ai', title: t[5], note: t[6] || null });
      return;
    }
    let m = /^## module (\S+)/.exec(line);
    if (m) { module = m[1]; pack.modules[module] = { line: i + 1, flows: 0 }; return; }
    m = /^### (MF|NF|PG) (\S+) #([0-9a-f]{8})/.exec(line);
    if (m) { pack[KINDS[m[1]]][m[2]] = { hash: m[3], module, line: i + 1 }; if (m[1] !== 'PG' && module) pack.modules[module].flows++; return; }
    m = /^E (\S+) #([0-9a-f]{8})/.exec(line);
    if (m && module) pack.entities[module + '.' + m[1]] = { hash: m[2], module, line: i + 1 };
  });
  return pack;
}

// The model a pack was made from, as an id: a hash of its text without the header lines that say when, or at
// which commit, it was made — the same model gives the same id, made by MxScout or by agent.js. agent.js prints
// it as "snapshot: <id>"; a descriptions file may carry it as "snapshot", and agent.js write and send refuse
// the file when the model is another one by then.
function snapshotOf(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  // Not the model either: Developer tools' "## risk triage", what people decided about the risks described, and
  // the "## index", whose line numbers move with it.
  let skip = false;
  const body = lines.filter((l, i) => {
    if (/^## /.test(l)) skip = l === '## risk triage' || l === '## index';
    return !skip && !(i < 40 && /^(generated|model|model commit): /.test(l));
  }).join('\n');
  return require('crypto').createHash('sha256').update(body).digest('hex').slice(0, 12);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(file + ': ' + e.message); }
}
// A flow's description is a string or { text }; a module's is a string or { summary, story }.
function textOf(v) {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return null;
  return typeof v.text === 'string' ? v.text : typeof v.summary === 'string' ? v.summary : null;
}
function storyOf(v) { return v && typeof v === 'object' && typeof v.story === 'string' && v.story.trim() ? v.story : null; }
// The layers are plain prose: a blank line between paragraphs, and nothing a renderer would have to read
// as markup — it is shown as text, so a list or a heading would arrive as stray characters.
function markupIn(text) {
  return /^\s*(?:[-*•]\s|#{1,6}\s|\d+[.)]\s|\|)|\*\*|<\/?[a-z][^>]*>|\]\(/im.test(text);
}
function hashOf(v) { return v && typeof v === 'object' && typeof v.hash === 'string' ? v.hash : null; }

// ---------- the documentation, in place of a descriptions file ----------
// The Markdown MxScout gives an agent (GET /api/agent/docs, `node agent.js docs`), or the Markdown
// copy exported from its Documentation: a described flow is a "#### `Module.Name` — microflow"
// section with the agent's line and the description under it, followed by "(out of date — …)" when
// the flow changed since. Read into the shape todo() takes: a description that is current gets the
// pack's own fingerprint, one marked out of date a fingerprint that matches nothing.
function isDocs(text) { return /^\s*#/.test(text); }
function readDocs(text, pack) {
  const lines = String(text).split(/\r?\n/);
  const AGENT = '> Written by an agent from the model.';
  const desc = { microflows: {}, nanoflows: {}, modules: {}, fromDocs: true };
  let h2 = null, flow = null, mod = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = /^## (.+)$/.exec(l);
    if (m) { h2 = m[1].trim(); flow = mod = null; continue; }
    m = /^#### `([^`]+)` — (microflow|nanoflow)$/.exec(l);
    if (m && h2 === 'Microflows & pages') { flow = { qn: m[1], kind: m[2] + 's' }; mod = null; continue; }
    m = /^### `([^`]+)` \((?:own|Marketplace) module\)$/.exec(l);
    if (m && h2 === 'Modules') { mod = m[1]; flow = null; continue; }
    if (/^#{3,4} /.test(l)) { flow = null; if (/^### /.test(l)) mod = null; continue; }
    if (l.trim() !== AGENT || !(flow || mod)) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const said = (lines[j] || '').trim();
    if (flow) {
      const stale = /\(out of date — the (?:micro|nano)flow changed since this was written\)$/.test(said) || /\(written before the (?:micro|nano)flow changed\)$/.test(said);
      const p = (pack[flow.kind] || {})[flow.qn];
      if (said) desc[flow.kind][flow.qn] = { text: said, hash: stale || !p ? 'outofdate' : p.hash };
      flow = null;
    } else {
      if (said) desc.modules[mod] = { summary: said };
      mod = null;
    }
  }
  if (lines.indexOf('### The application') !== -1) desc.app = { summary: 'described', story: 'described' };
  if (lines.indexOf('## Risks') !== -1) desc.risks = [];
  if (lines.indexOf('## For developers') !== -1) desc.context = {};
  if (lines.indexOf('### Runtime') !== -1 || lines.indexOf('### Context') !== -1) desc.c4 = { context: {} };
  return desc;
}

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
  const shortModules = Object.keys(pack.modules).filter((m) => textOf((desc.modules || {})[m]) && !storyOf((desc.modules || {})[m]));
  const app = desc.app && typeof desc.app === 'object' ? desc.app : null;
  // Notes on a module (reference/module-notes.md): wanted for a module that has flows.
  const noNotes = Object.keys(pack.modules).filter((m) => {
    const v = (desc.modules || {})[m];
    return !(v && typeof v === 'object' && Array.isArray(v.notes) && v.notes.length);
  });
  return {
    modules: modules,
    flows: modules.reduce((n, r) => n + r.fresh.length + r.changed.length, 0),
    overview: !(app && typeof app.summary === 'string' && app.summary.trim()),
    overviewStory: !!app && !storyOf(app),
    missingModules: missingModules,
    shortModules: shortModules,
    risks: !Array.isArray(desc.risks),
    context: !(desc.context && typeof desc.context === 'object'),
    noNotes: noNotes,
    c4: !(desc.c4 && typeof desc.c4 === 'object' && (desc.c4.context || desc.c4.containers)),
    // Risk triage (SKILL.md): fixed risks to check again, false positives not to raise again, a person's fixed risks to answer in "verify".
    recheck: pack.triage.filter((r) => !r.person && r.status === 'fixed').map((r) => r.id),
    falsePositives: pack.triage.filter((r) => !r.person && r.status === 'false-positive').map((r) => r.id),
    verify: pack.triage.filter((r) => r.person && r.status === 'fixed').map((r) => r.id)
  };
}

// ---------- what MxScout keeps ----------
// The bounds public/describe.js parse() cuts a file to: so many entries in a list, so many characters in a
// text. Past them MxScout drops the rest of the list, or cuts the text short — without a word, so the checker
// says it. reference/descriptions-format.md ("What MxScout keeps") lists the same numbers, and test 48 holds
// these against parse() itself.
const STORY_MAX = 16000;
const CAPS = {
  file: { project: 200, language: 20, by: 200, written: 40 },
  app: { summary: 6000, story: STORY_MAX, audienceText: 1000, audience: 30, who: 120, what: 600, processes: 200 },
  process: { name: 200, summary: 2000, story: STORY_MAX, steps: 100, step: 600, flows: 60, flow: 300 },
  // A diagram: items per list, ways per decision, and how deep a way's "then" may nest below the top list.
  diagram: { items: 60, ways: 6, depth: 6, decision: 200, label: 60, end: 160, join: 200, step: 200, who: 60 },
  table: { text: 4000, story: STORY_MAX },
  notes: { sections: 16, title: 160, text: 6000, items: 60, item: 800, columns: 6, column: 60, rows: 80, cell: 500 },
  c4: { nodes: 100, id: 40, name: 80, note: 140, group: 60, links: 250, label: 60, diagramNote: 600, open: 30, question: 500 },
  risks: { list: 2000, title: 300, detail: 3000, fix: 1000, where: 40, place: 300 },
  context: { list: 80, key: 300, text: 1000 },
  changes: { list: 100, id: 80, title: 200, asked: 2000, date: 40, summary: 2000, story: STORY_MAX, steps: 100, step: 600, flows: 60, flow: 300,
    changes: 60, target: 300, what: 1000, roles: 30, role: 120, data: 3000, risks: 30, open: 30, question: 1000, effort: 300 },
  tickets: { list: 200, id: 80, title: 200, reported: 8000, source: 300, date: 40, summary: 2000, story: STORY_MAX, steps: 100, step: 600, flows: 60, flow: 300,
    evidence: 60, target: 300, what: 1000, needs: 30, need: 1000, reply: 4000, risks: 30 },
  // A change's or a ticket's own risks.
  smallRisk: { title: 300, detail: 3000, fix: 1000 },
  // What the agent says about the risks a person raised (risk triage).
  verify: { list: 500, why: 1000 }
};
function caps(desc, warn) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  // A list MxScout takes as it is: entries past the cap are dropped. Returns the entries it keeps.
  const list = (what, v, n) => {
    if (!Array.isArray(v)) return [];
    if (v.length > n) warn(what + ': ' + v.length + ' entries — MxScout keeps ' + n + '; the rest is dropped.');
    return v.slice(0, n);
  };
  // A text MxScout cuts at so many characters, once trimmed.
  const text = (what, v, n) => { if (typeof v === 'string' && v.trim().length > n) warn(what + ' is ' + v.trim().length + ' characters — MxScout keeps ' + n + '; the rest is cut off.'); };
  // A list of sentences: the empty ones are not counted, the rest is cut at n, each at max characters.
  const texts = (what, v, n, max) => {
    if (!Array.isArray(v)) return;
    const kept = v.filter((x) => typeof x === 'string' && x.trim());
    if (kept.length > n) warn(what + ': ' + kept.length + ' entries — MxScout keeps ' + n + '; the rest is dropped.');
    kept.slice(0, n).forEach((x, i) => text(what + '[' + i + ']', x, max));
  };
  const D = CAPS.diagram;
  const diagram = (what, items, depth) => {
    if (!Array.isArray(items)) return;
    if (depth > D.depth) { warn(what + ': nested ' + depth + ' deep — MxScout keeps ' + D.depth + ' levels of "then" under the top; this is dropped.'); return; }
    list(what, items, D.items).forEach((x, i) => {
      const w = what + '[' + i + ']';
      if (!obj(x)) return;
      if (typeof x.decision === 'string' && x.decision.trim()) {
        text(w + '.decision', x.decision, D.decision);
        list(w + '.ways', x.ways, D.ways).forEach((y, j) => {
          if (!obj(y)) return;
          const wy = w + '.ways[' + j + ']';
          text(wy + '.label', y.label, D.label); text(wy + '.end', y.end, D.end); text(wy + '.join', y.join, D.join);
          diagram(wy + '.then', y.then, depth + 1);
        });
      } else if (typeof x.step === 'string' && x.step.trim()) { text(w + '.step', x.step, D.step); text(w + '.who', x.who, D.who); }
      else text(w + '.end', x.end, D.end);
    });
  };
  const smallRisks = (what, v, n) => list(what, v, n).forEach((r, i) => {
    if (!obj(r)) return;
    const S = CAPS.smallRisk;
    text(what + '[' + i + '].title', r.title, S.title); text(what + '[' + i + '].detail', r.detail, S.detail); text(what + '[' + i + '].fix', r.fix, S.fix);
  });
  Object.keys(CAPS.file).forEach((k) => text('"' + k + '"', desc[k], CAPS.file[k]));
  const a = obj(desc.app);
  if (a) {
    const A = CAPS.app, P = CAPS.process;
    text('app.summary', a.summary, A.summary); text('app.story', a.story, A.story);
    if (typeof a.audience === 'string') text('app.audience', a.audience, A.audienceText);
    list('app.audience', a.audience, A.audience).forEach((u, i) => { if (obj(u)) { text('app.audience[' + i + '].who', u.who, A.who); text('app.audience[' + i + '].what', u.what, A.what); } });
    list('app.processes', a.processes, A.processes).forEach((p, i) => {
      if (!obj(p)) return;
      const w = 'process "' + (typeof p.name === 'string' ? p.name : i) + '"';
      text(w + ' name', p.name, P.name); text(w + ' summary', p.summary, P.summary); text(w + ' story', p.story, P.story);
      texts(w + ' steps', p.steps, P.steps, P.step); texts(w + ' flows', p.flows, P.flows, P.flow);
      diagram(w + ' diagram', p.diagram, 0);
    });
  }
  TABLES.forEach((k) => {
    const t = obj(desc[k]);
    if (!t) return;
    Object.keys(t).forEach((name) => {
      const v = t[name], w = k + ' ' + name;
      text(w, typeof v === 'string' ? v : v && (typeof v.text === 'string' ? v.text : v.summary), CAPS.table.text);
      if (!obj(v)) return;
      text(w + ' story', v.story, CAPS.table.story);
      if (k !== 'modules') return;
      const N = CAPS.notes;
      list(w + ' notes', v.notes, N.sections).forEach((sec, i) => {
        if (!obj(sec)) return;
        const ws = w + ' notes[' + i + ']';
        text(ws + '.title', sec.title, N.title); text(ws + '.text', sec.text, N.text);
        list(ws + '.items', sec.items, N.items).forEach((x, j) => text(ws + '.items[' + j + ']', x, N.item));
        const tb = obj(sec.table);
        if (!tb) return;
        const cols = list(ws + '.table.columns', tb.columns, N.columns);
        cols.forEach((c, j) => text(ws + '.table.columns[' + j + ']', c, N.column));
        list(ws + '.table.rows', tb.rows, N.rows).forEach((r, j) => (Array.isArray(r) ? r : []).slice(0, cols.length).forEach((c, m) => {
          if (typeof c === 'string' && c.replace(/\s+/g, ' ').trim().length > N.cell) warn(ws + '.table.rows[' + j + '][' + m + '] is ' + c.replace(/\s+/g, ' ').trim().length + ' characters — MxScout keeps ' + N.cell + '; the rest is cut off.');
        }));
      });
    });
  });
  const c4 = obj(desc.c4);
  if (c4) {
    const C = CAPS.c4;
    ['context', 'containers'].forEach((k) => {
      const d = obj(c4[k]);
      if (!d) return;
      const w = 'c4.' + k;
      list(w + '.nodes', d.nodes, C.nodes).forEach((n, i) => {
        if (!obj(n)) return;
        const wn = w + '.nodes[' + i + ']';
        text(wn + '.id', n.id, C.id); text(wn + '.name', n.name, C.name); text(wn + '.note', n.note, C.note); text(wn + '.group', n.group, C.group);
      });
      list(w + '.links', d.links, C.links).forEach((l, i) => { if (obj(l)) text(w + '.links[' + i + '].label', l.label, C.label); });
      text(w + '.note', d.note, C.diagramNote);
    });
    list('c4.open', c4.open, C.open).forEach((x, i) => text('c4.open[' + i + ']', x, C.question));
  }
  const R = CAPS.risks;
  list('"risks"', desc.risks, R.list).forEach((r, i) => {
    if (!obj(r)) return;
    const w = 'risks[' + i + ']';
    text(w + '.title', r.title, R.title); text(w + '.detail', r.detail, R.detail); text(w + '.fix', r.fix, R.fix);
    texts(w + '.where', r.where, R.where, R.place);
  });
  list('"verify"', desc.verify, CAPS.verify.list).forEach((v, i) => { if (obj(v)) text('verify[' + i + '].why', v.why, CAPS.verify.why); });
  const cx = obj(desc.context);
  if (cx) {
    const X = CAPS.context;
    [['where', 'topic', 'place'], ['conventions', 'pattern', 'meaning']].forEach(([k, f1, f2]) => list('context.' + k, cx[k], X.list).forEach((x, i) => {
      if (obj(x)) { text('context.' + k + '[' + i + '].' + f1, x[f1], X.key); text('context.' + k + '[' + i + '].' + f2, x[f2], X.text); }
    }));
    texts('context.pitfalls', cx.pitfalls, X.list, X.text);
  }
  const H = CAPS.changes;
  list('"changes"', desc.changes, H.list).forEach((c, i) => {
    if (!obj(c)) return;
    const w = 'change ' + (typeof c.id === 'string' ? '"' + c.id + '"' : '[' + i + ']');
    text(w + ' id', c.id, H.id); text(w + ' title', c.title, H.title); text(w + ' asked', c.asked, H.asked); text(w + ' date', c.date, H.date);
    [['now', c.now], ['proposal', c.proposal]].forEach(([side, v]) => {
      if (!obj(v)) return;
      text(w + ' ' + side + ' summary', v.summary, H.summary); text(w + ' ' + side + ' story', v.story, H.story);
      texts(w + ' ' + side + ' steps', v.steps, H.steps, H.step);
      if (side === 'now') texts(w + ' now flows', v.flows, H.flows, H.flow);
      diagram(w + ' ' + side + ' diagram', v.diagram, 0);
    });
    if (obj(c.proposal)) list(w + ' proposal.changes', c.proposal.changes, H.changes).forEach((x, j) => {
      if (obj(x)) { text(w + ' proposal.changes[' + j + '].target', x.target, H.target); text(w + ' proposal.changes[' + j + '].what', x.what, H.what); }
    });
    if (obj(c.impact)) { texts(w + ' impact.flows', c.impact.flows, H.flows, H.flow); texts(w + ' impact.roles', c.impact.roles, H.roles, H.role); text(w + ' impact.data', c.impact.data, H.data); }
    smallRisks(w + ' risks', c.risks, H.risks);
    texts(w + ' open', c.open, H.open, H.question);
    text(w + ' effort', c.effort, H.effort);
  });
  const T = CAPS.tickets;
  list('"tickets"', desc.tickets, T.list).forEach((t, i) => {
    if (!obj(t)) return;
    const w = 'ticket ' + (typeof t.id === 'string' ? '"' + t.id + '"' : '[' + i + ']');
    ['id', 'title', 'reported', 'source', 'date', 'summary', 'story', 'reply'].forEach((k) => text(w + ' ' + k, t[k], T[k]));
    const tr = obj(t.traced);
    if (tr) { texts(w + ' traced.steps', tr.steps, T.steps, T.step); texts(w + ' traced.flows', tr.flows, T.flows, T.flow); diagram(w + ' traced.diagram', tr.diagram, 0); }
    list(w + ' evidence', t.evidence, T.evidence).forEach((x, j) => { if (obj(x)) { text(w + ' evidence[' + j + '].target', x.target, T.target); text(w + ' evidence[' + j + '].what', x.what, T.what); } });
    texts(w + ' needs', t.needs, T.needs, T.need);
    smallRisks(w + ' risks', t.risks, T.risks);
  });
}

// ---------- check ----------
function check(pack, desc) {
  const problems = [];
  const err = (text) => problems.push({ level: 'error', text });
  const warn = (text) => problems.push({ level: 'warning', text });
  // The two layers of reference/business-narrative.md, on the application, a process or a module.
  // min: a floor, not a target — below it a story of this kind is clearly too thin to say what it must
  // (reference/business-narrative.md, "When a story is complete"); a warning, never an error. Karol found the
  // documentation too short once, so the floor stays; the audit of 2026-10-15 found the old ranges pushed
  // stories to be long for length's sake, so the floor is low and the message names what is missing instead.
  function layers(what, v, min) {
    const summary = typeof v === 'string' ? v : v && typeof v.summary === 'string' ? v.summary : null;
    const story = storyOf(v);
    if (summary && summary.length > LIMITS.summary) warn(what + ': the summary is ' + summary.length + ' characters — a summary is two to four sentences; the rest belongs in "story".');
    if (summary && markupIn(summary)) warn(what + ': the summary carries markup or a list — it is shown as plain text.');
    if (!story) { warn(what + ': no "story" — the long description is half of the business layer (reference/business-narrative.md).'); return; }
    const words = story.split(/\s+/).filter(Boolean).length;
    if (story.length < LIMITS.storyMin) warn(what + ': the story is ' + story.length + ' characters — a description is several paragraphs, not a second summary.');
    else if (min && words < min.words) warn(what + ': the story is ' + words + ' words — ' + min.why);
    if (story.length > LIMITS.story) warn(what + ': the story is ' + story.length + ' characters; aim for under ' + LIMITS.story + '.');
    if (markupIn(story)) warn(what + ': the story carries markup, a list or a heading — it is shown as text; write paragraphs, a blank line between them.');
  }
  // Notes on a module: sections of text, lines and one small table (reference/module-notes.md).
  function notes(what, list) {
    if (!Array.isArray(list)) { err(what + ': "notes" must be a list of sections.'); return; }
    list.forEach((s, i) => {
      const w = what + ' notes[' + i + ']' + (s && typeof s.title === 'string' ? ' "' + s.title + '"' : '');
      if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !s.title.trim()) { err(w + ': a section needs a "title" — MxScout drops it otherwise.'); return; }
      const t = s.table;
      const hasTable = t && typeof t === 'object' && Array.isArray(t.columns) && t.columns.length && Array.isArray(t.rows) && t.rows.length;
      if (!(typeof s.text === 'string' && s.text.trim()) && !(Array.isArray(s.items) && s.items.length) && !hasTable) warn(w + ': nothing in it — "text", "items" or a "table"; MxScout drops an empty section.');
      if (s.items !== undefined && (!Array.isArray(s.items) || s.items.some((x) => typeof x !== 'string'))) err(w + ': "items" must be a list of sentences.');
      if (t !== undefined) {
        if (!t || typeof t !== 'object' || !Array.isArray(t.columns) || !Array.isArray(t.rows)) err(w + ': a "table" needs "columns" and "rows" (lists).');
        else {
          t.rows.forEach((r, j) => { if (!Array.isArray(r)) err(w + ' row ' + j + ' is not a list of cells.'); else if (r.length !== t.columns.length) warn(w + ' row ' + j + ' has ' + r.length + ' cells for ' + t.columns.length + ' columns.'); });
        }
      }
    });
  }
  // The architecture (reference/c4.md): nodes and links; MxScout drops a link to a node that is not there.
  const C4_KINDS = ['person', 'system', 'app', 'store', 'part'];
  function diagram(what, d) {
    if (d === undefined) return;
    if (!d || typeof d !== 'object' || !Array.isArray(d.nodes) || !d.nodes.length) { err(what + ': needs a non-empty "nodes" list.'); return; }
    // The import keeps 100 nodes and 250 links — sized on a large application (2026-10-14: a dozen systems
    // around it, five groups of people, the runtime's parts) with room to spare; caps() says when a file goes past.
    const ids = {};
    d.nodes.forEach((n, i) => {
      const w = what + ' nodes[' + i + ']';
      if (!n || typeof n.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(n.id) || typeof n.name !== 'string' || !n.name.trim()) { err(w + ': "id" (letters, digits, _ and -) and "name" are required — MxScout drops the node.'); return; }
      if (ids[n.id]) err(w + ': id "' + n.id + '" is used twice.');
      ids[n.id] = true;
      if (n.kind !== undefined && C4_KINDS.indexOf(n.kind) === -1) warn(w + ': kind "' + n.kind + '" is not one of ' + C4_KINDS.join(', ') + ' — drawn as a system.');
    });
    (Array.isArray(d.links) ? d.links : []).forEach((l, i) => {
      if (!l || !ids[l.from] || !ids[l.to] || l.from === l.to) warn(what + ' links[' + i + ']: "from" and "to" must be two different node ids — MxScout drops the link.');
    });
  }
  // A process's simplified diagram, and a change's two (reference/descriptions-format.md, "diagram"):
  // steps, decisions with their ways, ends. `who` names what it belongs to in the messages.
  function flowDiagram(who, diagram, name) {
    let decisions = 0;
    const walk = (list, where) => {
      if (!Array.isArray(list)) { err(who + ': ' + where + ' must be a list.'); return; }
      list.forEach((x, i) => {
        const w = where + '[' + i + ']';
        if (x && typeof x.decision === 'string' && x.decision.trim()) {
          decisions++;
          if (!Array.isArray(x.ways) || x.ways.length < 2) warn(who + ': ' + w + ' is a decision with fewer than two ways.');
          (Array.isArray(x.ways) ? x.ways : []).forEach((y, j) => {
            // A way ends, goes on at a later step, or rejoins the main path — one of the three.
            if (y && typeof y.end === 'string' && y.end.trim() && typeof y.join === 'string' && y.join.trim()) warn(who + ': ' + w + '.ways[' + j + '] has both "end" and "join" — it is drawn as ending there and the join is ignored; keep one.');
            if (y && y.then !== undefined) walk(y.then, w + '.ways[' + j + '].then');
          });
        } else if (x && typeof x.step === 'string' && x.step.trim() && x.by !== undefined && x.by !== 'person' && x.by !== 'app') {
          warn(who + ': ' + w + ' has "by": ' + JSON.stringify(x.by) + ' — it is "person" or "app"; MxScout draws it as a person\'s step.');
        } else if (!(x && ((typeof x.step === 'string' && x.step.trim()) || (typeof x.end === 'string' && x.end.trim())))) {
          err(who + ': ' + w + ' is neither a "step", a "decision" nor an "end" — MxScout drops it.');
        }
      });
    };
    walk(diagram, name);
    const texts = {};
    (function names(list) { (Array.isArray(list) ? list : []).forEach((x) => { if (x && typeof x.step === 'string') texts[x.step.trim()] = true; if (x && Array.isArray(x.ways)) x.ways.forEach((y) => names(y && y.then)); }); })(diagram);
    (function joins(list) { (Array.isArray(list) ? list : []).forEach((x) => { if (x && Array.isArray(x.ways)) x.ways.forEach((y) => { if (y && typeof y.join === 'string' && !texts[y.join.trim()]) warn(who + ': a way joins "' + y.join + '", which is no step of its ' + name + ' — drawn as if it rejoined the main path.'); joins(y && y.then); }); }); })(diagram);
    if (Array.isArray(diagram) && !decisions) warn(who + ': its ' + name + ' has no decision — a straight line, which the steps already say; leave the ' + name + ' out.');
  }
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
      if (k === 'modules') {
        if (!pack.modules[name]) warn('modules ' + name + ': no such module in the pack.');
        layers('modules ' + name, v);
        if (v && typeof v === 'object' && v.notes !== undefined) notes('modules ' + name, v.notes);
        return;
      }
      const known = pack[k][name];
      if (!known) { err(k + ' ' + name + ': not in the pack — a misspelt or invented name never shows in MxScout.'); return; }
      if (k !== 'pages' && !hashOf(v)) warn(k + ' ' + name + ': no "hash" — copy the #fingerprint from the pack, or MxScout cannot tell when it goes out of date.');
      else if (hashOf(v) && hashOf(v) !== known.hash) warn(k + ' ' + name + ': hash ' + hashOf(v) + ' does not match the pack (' + known.hash + ') — the flow changed; describe it again.');
    });
  });
  // Risks by reference/risk-levels.md; MxScout drops a risk without a level or a title.
  const inPack = (qn) => !!(pack.microflows[qn] || pack.nanoflows[qn] || pack.pages[qn] || pack.entities[qn]);
  if (desc.risks !== undefined) {
    const ids = {};
    if (!Array.isArray(desc.risks)) err('"risks" must be a list.');
    else desc.risks.forEach((r, i) => {
      const what = 'risks[' + i + ']' + (r && typeof r.title === 'string' ? ' "' + r.title + '"' : '');
      if (!r || typeof r !== 'object') { err(what + ' is not an object.'); return; }
      // The id is how MxScout knows a risk again on the next update, and keeps what a person decided about it.
      if (r.id === undefined || r.id === null) warn(what + ': no "id" — give it a short slug (p1-anon-delete-ticket) and keep it on every update, or MxScout knows it only by its level and title.');
      else if (typeof r.id !== 'string' || !RISK_ID.test(r.id) || r.id.length > 80) err(what + ': "id" "' + r.id + '" must be a slug — lower-case letters, digits and single hyphens, at most 80 characters; MxScout drops it otherwise.');
      else if (ids[r.id]) err(what + ': id "' + r.id + '" is used by risks[' + ids[r.id].i + '] too — one id, one risk.');
      else ids[r.id] = { i: i };
      if (!/^P[123]$/.test(r.level)) err(what + ': "level" must be "P1", "P2" or "P3" — MxScout drops it otherwise.');
      if (typeof r.title !== 'string' || !r.title.trim()) err(what + ': no "title" — MxScout drops it.');
      if (typeof r.fix !== 'string' || !r.fix.trim()) warn(what + ': no "fix" — every risk says what to do (reference/risk-levels.md).');
      if (r.theme === undefined) warn(what + ': no "theme" — MxScout guesses the pattern from the title; name it (reference/risk-levels.md, Patterns).');
      else if (THEMES.indexOf(r.theme) === -1) warn(what + ': "theme" "' + r.theme + '" is not one of ' + THEMES.join(', ') + ' — MxScout drops it and guesses from the title.');
      const where = Array.isArray(r.where) ? r.where : [];
      if (!where.length) warn(what + ': no "where" — every risk names the flows, pages or entities it is in.');
      where.forEach((qn) => { if (!inPack(qn)) warn(what + ' names ' + qn + ', which is not in the pack — it shows as plain text, not a link.'); });
    });
  }
  // Risk triage (SKILL.md): a false positive comes back only with a reason; a person's risk is never the agent's to write.
  if (Array.isArray(desc.risks)) {
    const fp = {}, person = {};
    (pack.triage || []).forEach((r) => { if (r.person) person[r.id] = r; else if (r.status === 'false-positive') fp[r.id] = r; });
    desc.risks.forEach((r, i) => {
      if (!r || typeof r.id !== 'string') return;
      if (fp[r.id]) warn('risks[' + i + '] "' + r.id + '" was marked a false positive (' + (fp[r.id].note || 'no reason given') + ') — report it again only if the model changed so the reason no longer holds, and say why in its detail.');
      if (person[r.id]) err('risks[' + i + '] "' + r.id + '" is a risk a person raised — answer for it in "verify", not in "risks".');
    });
  }
  if (desc.verify !== undefined) {
    if (!Array.isArray(desc.verify)) err('"verify" must be a list of { "id", "still", "why" }.');
    else desc.verify.forEach((v, i) => {
      if (!v || typeof v.id !== 'string' || !/^c-[A-Za-z0-9_-]{1,80}$/.test(v.id) || typeof v.still !== 'boolean') err('verify[' + i + '] needs "id" (the c-… id from the pack\'s risk triage) and "still": true or false — MxScout drops it otherwise.');
      else if (pack.triage && pack.triage.length && !pack.triage.some((r) => r.person && r.id === v.id)) warn('verify[' + i + '] "' + v.id + '" is not a risk a person raised in this pack.');
    });
  }
  if (desc.context !== undefined) {
    const c = desc.context;
    if (!c || typeof c !== 'object' || Array.isArray(c)) err('"context" must be an object with "where", "conventions" and "pitfalls".');
    else {
      [['where', 'topic', 'place'], ['conventions', 'pattern', 'meaning']].forEach(([k, a, b]) => {
        if (c[k] === undefined) return;
        if (!Array.isArray(c[k])) { err('context.' + k + ' must be a list.'); return; }
        c[k].forEach((x, i) => { if (!x || typeof x[a] !== 'string' || typeof x[b] !== 'string') err('context.' + k + '[' + i + '] needs "' + a + '" and "' + b + '" — MxScout drops it otherwise.'); });
      });
      if (c.pitfalls !== undefined && (!Array.isArray(c.pitfalls) || c.pitfalls.some((p) => typeof p !== 'string'))) err('context.pitfalls must be a list of sentences.');
    }
  }
  if (desc.c4 !== undefined) {
    const c = desc.c4;
    if (!c || typeof c !== 'object' || Array.isArray(c)) err('"c4" must be an object with "context" and "containers".');
    else {
      if (!c.context && !c.containers) err('"c4" has neither "context" nor "containers" — MxScout drops it.');
      diagram('c4.context', c.context); diagram('c4.containers', c.containers);
      // The overview draws the context's groups around the application (reference/c4.md).
      if (c.context && Array.isArray(c.context.nodes)) {
        const g = {};
        c.context.nodes.forEach((n) => { if (n && n.group) g[n.group] = true; });
        if (Object.keys(g).length > 5) warn('c4.context has ' + Object.keys(g).length + ' groups — the overview draws five at most around the application; merge some.');
      }
      if (c.open !== undefined && (!Array.isArray(c.open) || c.open.some((x) => typeof x !== 'string'))) err('c4.open must be a list of sentences.');
    }
  }
  if (desc.app !== undefined) {
    const a = desc.app;
    if (!a || typeof a !== 'object') err('"app" must be an object.');
    else {
      // A file that adds (one more process, say) to what MxScout keeps leaves the application's own layers as they are.
      if (desc.add !== true || (Array.isArray(desc.replace) && desc.replace.indexOf('app') !== -1)) {
        if (typeof a.summary !== 'string' || !a.summary.trim()) warn('app.summary is empty — it is the first thing a business reader sees.');
        layers('app', a, { words: 150, why: 'clearly too thin for the application: say what it is for, who works in it, how a case goes through it and what it connects to (reference/business-narrative.md). Length follows what there is to tell; this is only a floor.' });
      }
      // Who uses it: groups of { who, what } (reference/descriptions-format.md); one sentence is still read.
      if (Array.isArray(a.audience)) {
        a.audience.forEach((u, i) => { if (!u || typeof u.who !== 'string' || !u.who.trim()) err('app.audience[' + i + '] has no "who" — MxScout drops the group.'); });
      } else if (typeof a.audience === 'string') warn('app.audience is one sentence — write it as a list of { "who", "what" }, so the overview can show each group on its own line.');
      else if (a.audience !== undefined) err('app.audience must be a list of { "who", "what" }.');
      (Array.isArray(a.processes) ? a.processes : []).forEach((p, i) => {
        if (!p || typeof p.name !== 'string' || !p.name.trim()) { err('app.processes[' + i + '] has no name.'); return; }
        layers('process "' + p.name + '"', p, { words: 80, why: 'a process follows one case stage by stage, and this is clearly too thin to: say where it starts and who starts it, what is checked and decided on what data, what is recorded or sent, who approves or can refuse, what happens when it fails, and how it ends — with the real names of statuses, roles and messages. Trace it through its flows (SKILL.md, step 4), do not summarise it; as long as the case needs, no longer.' });
        if (!Array.isArray(p.flows) || p.flows.length < 2) warn('process "' + p.name + '": ' + (Array.isArray(p.flows) ? p.flows.length : 0) + ' flow' + ((Array.isArray(p.flows) && p.flows.length === 1) ? '' : 's') + ' listed — a process is carried by the flows on its way; list each one you followed.');
        // Steps a reader follows, each saying who does what (reference/business-narrative.md, "A process"):
        // as many as the case has (Karol, 2026-10-14: a count here only cut real processes short).
        const steps = Array.isArray(p.steps) ? p.steps.filter((x) => typeof x === 'string' && x.trim()) : [];
        if (steps.length < 2) warn('process "' + p.name + '": ' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + ' — a reader follows the case by its steps; write each one, naming who does what.');
        // The diagram, when there is one: steps, decisions with ways, ends (reference/descriptions-format.md).
        if (p.diagram !== undefined) flowDiagram('process "' + p.name + '"', p.diagram, 'diagram');
        const bare = steps.filter((x) => x.trim().split(/\s+/).length < 4);
        if (bare.length) warn('process "' + p.name + '": ' + bare.length + ' step' + (bare.length === 1 ? ' is a label' : 's are labels') + ' ("' + bare[0] + '") — write who does what, in one sentence.');
        (Array.isArray(p.flows) ? p.flows : []).forEach((qn) => {
          if (!pack.microflows[qn] && !pack.nanoflows[qn] && !pack.pages[qn]) warn('process "' + p.name + '" names ' + qn + ', which is not in the pack — it shows as plain text, not a link.');
        });
      });
    }
  }
  const flowInPack = (qn) => !!(pack.microflows[qn] || pack.nanoflows[qn] || pack.pages[qn]);
  // Whether a model change's or a ticket's target is in the pack: flows and pages by kind, an entity, and an
  // attribute or an association by the entity or module it belongs to. The other kinds the pack does not list.
  const targetInPack = (kind, qn) => {
    const parts = String(qn).split('.');
    if (kind === 'microflow' || kind === 'nanoflow' || kind === 'page') return !!pack[kind + 's'][qn];
    if (kind === 'entity') return !!pack.entities[qn];
    if (kind === 'attribute') return parts.length === 3 && !!pack.entities[parts[0] + '.' + parts[1]];
    if (kind === 'association') return !!pack.modules[parts[0]];
    return null;
  };
  // Changes (SKILL.md, "A change, when the person asks"): how it works now, traced like a process, and the
  // proposal with the model changes it needs. MxScout drops a change without a slug id or a title, and a
  // model change without a target or with an action other than add, change or remove.
  if (desc.changes !== undefined) {
    if (!Array.isArray(desc.changes)) err('"changes" must be a list.');
    else {
      const ids = {};
      desc.changes.forEach((c, i) => {
        const what = 'change ' + (c && typeof c.id === 'string' ? '"' + c.id + '"' : '[' + i + ']');
        if (!c || typeof c !== 'object') { err(what + ' is not an object.'); return; }
        if (typeof c.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id)) err(what + ': "id" must be a slug — lower-case letters, digits and hyphens ("cancel-order") — MxScout drops the change otherwise.');
        else if (ids[c.id]) err(what + ': the id is used twice — MxScout keeps the first.');
        ids[c.id] = true;
        if (typeof c.title !== 'string' || !c.title.trim()) err(what + ': no "title" — MxScout drops the change.');
        if (typeof c.asked !== 'string' || !c.asked.trim()) warn(what + ': no "asked" — the request in the person\'s own words is what the page opens with.');
        if (c.status !== undefined && CHANGE_STATUS.indexOf(c.status) === -1) warn(what + ': "status" "' + c.status + '" is not one of ' + CHANGE_STATUS.join(', ') + ' — shown as proposed.');
        const now = c.now, pr = c.proposal;
        if (!now || typeof now !== 'object') err(what + ': "now" must be an object — how it works today is half of a change.');
        else {
          layers(what + ' now', now, { words: 80, why: 'how it works now follows one case through its flows, stage by stage, and this is clearly too thin to: where it starts, what is checked, what is set, how it ends (SKILL.md, "A change", step 2). Trace it, do not summarise it.' });
          const steps = Array.isArray(now.steps) ? now.steps.filter((x) => typeof x === 'string' && x.trim()) : [];
          if (steps.length < 2) warn(what + ' now: ' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + ' — write each step of how it works today, naming who does what.');
          const flows = Array.isArray(now.flows) ? now.flows : [];
          if (!flows.length) warn(what + ' now: no flows listed — name the flows you followed; they become links.');
          flows.forEach((qn) => { if (!flowInPack(qn)) warn(what + ' now names ' + qn + ', which is not in the pack — it shows as plain text, not a link.'); });
          if (now.diagram !== undefined) flowDiagram(what + ' now', now.diagram, 'diagram');
        }
        if (!pr || typeof pr !== 'object') err(what + ': "proposal" must be an object — the solution is the other half of a change.');
        else {
          layers(what + ' proposal', pr, { words: 40, why: 'clearly too thin: the proposal says in plain words how the solution works for the people using it.' });
          if (!Array.isArray(pr.steps) || !pr.steps.length) warn(what + ' proposal: no steps — write how the case goes once the change is made.');
          if (pr.diagram !== undefined) flowDiagram(what + ' proposal', pr.diagram, 'diagram');
          if (!Array.isArray(pr.changes) || !pr.changes.length) warn(what + ' proposal: no "changes" — list what to add, change or remove in the model.');
          else {
            pr.changes.forEach((x, j) => {
              const w = what + ' proposal.changes[' + j + ']';
              if (!x || typeof x !== 'object') { err(w + ' is not an object.'); return; }
              if (typeof x.target !== 'string' || !x.target.trim()) err(w + ': no "target" — MxScout drops it.');
              if (CHANGE_ACTIONS.indexOf(x.action) === -1) err(w + ': "action" must be one of ' + CHANGE_ACTIONS.join(', ') + ' — MxScout drops it otherwise.');
              if (CHANGE_KINDS.indexOf(x.kind) === -1) warn(w + ': "kind" "' + x.kind + '" is not one of ' + CHANGE_KINDS.join(', ') + ' — shown under other.');
              if (typeof x.what !== 'string' || !x.what.trim()) warn(w + ': no "what" — say in a sentence what the change is.');
              if (x.action !== 'add' && typeof x.target === 'string' && targetInPack(x.kind, x.target) === false) warn(w + ': ' + x.target + ' is not in the pack — to change or remove it, name it as the pack does; for something new the action is "add".');
            });
          }
        }
        const im = c.impact;
        if (im !== undefined) {
          if (!im || typeof im !== 'object') err(what + ': "impact" must be an object with "flows", "roles" and "data".');
          else (Array.isArray(im.flows) ? im.flows : []).forEach((qn) => { if (!flowInPack(qn)) warn(what + ' impact names ' + qn + ', which is not in the pack — it shows as plain text, not a link.'); });
        }
        if (c.risks !== undefined) {
          if (!Array.isArray(c.risks)) err(what + ': "risks" must be a list.');
          else c.risks.forEach((r, j) => {
            const w = what + ' risks[' + j + ']';
            if (!r || !/^P[123]$/.test(r.level)) err(w + ': "level" must be "P1", "P2" or "P3" — MxScout drops it otherwise.');
            if (!r || typeof r.title !== 'string' || !r.title.trim()) err(w + ': no "title" — MxScout drops it.');
            else if (typeof r.fix !== 'string' || !r.fix.trim()) warn(w + ': no "fix" — every risk says what to do.');
          });
        }
        if (c.open !== undefined && (!Array.isArray(c.open) || c.open.some((x) => typeof x !== 'string'))) err(what + ': "open" must be a list of questions.');
      });
    }
  }
  // Tickets (an older file's; the mendix-assist skill writes Assist items now): a ticket reported on the application, checked against the model.
  // MxScout drops a ticket without an id, a title, a verdict it knows or a summary, and an evidence row
  // without a target; the rest it shows as it is, so the rest is a warning.
  if (desc.tickets !== undefined) {
    if (!Array.isArray(desc.tickets)) err('"tickets" must be a list.');
    else {
      const ids = {};
      const changeIds = {};
      (Array.isArray(desc.changes) ? desc.changes : []).forEach((c) => { if (c && typeof c.id === 'string') changeIds[c.id] = true; });
      // The risks a ticket may name as the one it is about: those the pack's risk triage lists (an agent's by its
      // id, one a person raised by "c-…"), and those this file writes.
      const triage = (pack && pack.triage) || [];
      const knownRisks = new Set(triage.map((r) => r.id).concat((Array.isArray(desc.risks) ? desc.risks : []).map((r) => r && r.id)).filter(Boolean));
      desc.tickets.forEach((t, i) => {
        const what = 'ticket ' + (t && typeof t.id === 'string' ? '"' + t.id + '"' : '[' + i + ']');
        if (!t || typeof t !== 'object') { err(what + ' is not an object.'); return; }
        if (typeof t.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(t.id.trim()) || t.id.length > 80) err(what + ': "id" must be the ticket\'s key as given ("PROJ-12") or a slug — letters, digits, dots, hyphens and underscores — MxScout drops the ticket otherwise.');
        else if (ids[t.id]) err(what + ': the id is used twice — MxScout keeps the first.');
        ids[t.id] = true;
        if (typeof t.title !== 'string' || !t.title.trim()) err(what + ': no "title" — MxScout drops the ticket.');
        if (TICKET_VERDICTS.indexOf(t.verdict) === -1) err(what + ': "verdict" must be one of ' + TICKET_VERDICTS.join(', ') + ' — MxScout drops the ticket otherwise.');
        if (t.confidence === undefined) warn(what + ': no "confidence" — shown as low; say how sure the model lets you be.');
        else if (CONFIDENCE.indexOf(t.confidence) === -1) warn(what + ': "confidence" "' + t.confidence + '" is not one of ' + CONFIDENCE.join(', ') + ' — shown as low.');
        if (typeof t.reported !== 'string' || !t.reported.trim()) warn(what + ': no "reported" — the ticket as it was pasted is what the page opens with.');
        if (typeof t.summary !== 'string' || !t.summary.trim()) err(what + ': no "summary" — the answer in one to three sentences; MxScout drops the ticket without it.');
        else {
          if (t.summary.length > LIMITS.summary) warn(what + ': the summary is ' + t.summary.length + ' characters — the answer in one to three sentences; the reasoning belongs in "story".');
          if (markupIn(t.summary)) warn(what + ': the summary carries markup or a list — it is shown as plain text.');
        }
        if (typeof t.story !== 'string' || !t.story.trim()) err(what + ': no "story" — the reasoning (what the ticket expects, what the model does, why that is or is not a fault) is what makes the verdict checkable.');
        else {
          const words = t.story.split(/\s+/).filter(Boolean).length;
          if (words < 80) warn(what + ': the story is ' + words + ' words — say what the ticket expects, what the model does instead, and why that is or is not a fault, with the names.');
          if (markupIn(t.story)) warn(what + ': the story carries markup, a list or a heading — it is shown as text; write paragraphs, a blank line between them.');
        }
        const tr = t.traced;
        if (tr !== undefined) {
          if (!tr || typeof tr !== 'object') err(what + ': "traced" must be an object with "steps", "flows" and "diagram".');
          else {
            (Array.isArray(tr.flows) ? tr.flows : []).forEach((qn) => { if (!flowInPack(qn)) warn(what + ' traced names ' + qn + ', which is not in the pack — it shows as plain text, not a link.'); });
            if (tr.diagram !== undefined) flowDiagram(what + ' traced', tr.diagram, 'diagram');
          }
        } else if (t.verdict !== 'cannot-tell') warn(what + ': no "traced" — show what the model does, the steps and the flows you followed.');
        const ev = Array.isArray(t.evidence) ? t.evidence : [];
        if (t.evidence !== undefined && !Array.isArray(t.evidence)) err(what + ': "evidence" must be a list.');
        else if (!ev.length && t.verdict !== 'cannot-tell') warn(what + ': no "evidence" — name the places in the model the verdict rests on; they become links.');
        ev.forEach((x, j) => {
          const w = what + ' evidence[' + j + ']';
          if (!x || typeof x !== 'object') { err(w + ' is not an object.'); return; }
          if (typeof x.target !== 'string' || !x.target.trim()) { err(w + ': no "target" — MxScout drops it.'); return; }
          if (CHANGE_KINDS.indexOf(x.kind) === -1) warn(w + ': "kind" "' + x.kind + '" is not one of ' + CHANGE_KINDS.join(', ') + ' — shown as other.');
          if (typeof x.what !== 'string' || !x.what.trim()) warn(w + ': no "what" — say what this place shows.');
          if (targetInPack(x.kind, x.target) === false) warn(w + ': ' + x.target + ' is not in the pack — name it as the pack does.');
        });
        const needs = t.needs;
        if (needs !== undefined && (!Array.isArray(needs) || needs.some((x) => typeof x !== 'string'))) err(what + ': "needs" must be a list of sentences.');
        if ((t.verdict === 'cannot-tell' || t.confidence === 'low') && !(Array.isArray(needs) && needs.length)) warn(what + ': ' + (t.verdict === 'cannot-tell' ? 'cannot tell' : 'low confidence') + ' and no "needs" — say what would settle it (logs, the data, the steps to reproduce, the deployed version).');
        if (t.reply !== undefined && typeof t.reply !== 'string') err(what + ': "reply" must be text.');
        if (t.change !== undefined) {
          if (typeof t.change !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.change)) err(what + ': "change" must be the id of a change — a slug, as the change has it; MxScout drops it otherwise.');
          else if (!changeIds[t.change]) warn(what + ': "change" is "' + t.change + '", which is not in this file — it links only if MxScout already keeps a change with that id.');
        } else if (t.verdict === 'bug') warn(what + ': a bug with no "change" — propose the fix as a change in the same file and name its id.');
        if (t.risk !== undefined && t.risk !== null) {
          if (typeof t.risk !== 'string' || !((RISK_ID.test(t.risk) && t.risk.length <= 80) || /^c-[A-Za-z0-9_-]{1,80}$/.test(t.risk))) warn(what + ': "risk" must be the id of a known risk — an agent\'s risk\'s slug, or "c-…" for one a person raised, as the pack\'s risk triage lists it; MxScout leaves it out otherwise.');
          else if (triage.length && !knownRisks.has(t.risk)) warn(what + ': "risk" is "' + t.risk + '", which neither the pack\'s risk triage nor this file lists — it links only if MxScout keeps a risk with that id.');
        }
        if (t.risks !== undefined) {
          if (!Array.isArray(t.risks)) err(what + ': "risks" must be a list.');
          else t.risks.forEach((r, j) => {
            const w = what + ' risks[' + j + ']';
            if (!r || !/^P[123]$/.test(r.level)) err(w + ': "level" must be "P1", "P2" or "P3" — MxScout drops it otherwise.');
            if (!r || typeof r.title !== 'string' || !r.title.trim()) err(w + ': no "title" — MxScout drops it.');
          });
        }
      });
    }
  }
  // "replace" means something only beside "add": true; without it the file replaces everything anyway.
  if (desc.replace !== undefined && desc.add !== true) warn('"replace" without "add": true — MxScout ignores it: a file without "add" replaces everything it keeps.');
  else if (desc.replace !== undefined && !(Array.isArray(desc.replace) && desc.replace.indexOf('app') !== -1)) warn('"replace" must be ["app"] — MxScout ignores anything else.');
  caps(desc, warn);
  return problems;
}

// A ticket's verdict and how sure it is (reference/descriptions-format.md, "Tickets"; public/describe.js keeps the same lists).
const TICKET_VERDICTS = ['bug', 'as-designed', 'data-config', 'cannot-tell'];
const CONFIDENCE = ['high', 'medium', 'low'];

// A change's status, the kinds of model change and what is done to each (reference/descriptions-format.md, "changes"; public/describe.js keeps the same lists).
const CHANGE_STATUS = ['proposed', 'accepted', 'done', 'dropped'];
const CHANGE_KINDS = ['microflow', 'nanoflow', 'page', 'entity', 'attribute', 'association', 'enumeration', 'security', 'scheduled event', 'integration', 'other'];
const CHANGE_ACTIONS = ['add', 'change', 'remove'];

// A risk's id (reference/descriptions-format.md; public/describe.js reads the same pattern).
const RISK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The ten patterns a risk can belong to (reference/risk-levels.md; public/describe.js keeps the same list).
const THEMES = ['access', 'secrets', 'logic', 'silent', 'delete', 'loops', 'schedule', 'dead', 'hardcoded', 'naming'];

// ---------- merge ----------
// The rules are MxScout's own for a file that says "add": true (public/describe.js merge), so that
// merging parts here and importing them there one by one end the same — test 48 runs both on the
// same files. The first part is the base when it does not say "add"; every other part is laid over it.
// A risk's identity, as public/describe.js riskKey and titleKey have it: its id when it has a good one,
// and its level and title, case and spacing aside — either one matching makes it the same risk.
function titleKey(r) { return 't:' + (r && r.level) + ':' + String((r && r.title) || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function riskKey(r) { return r && typeof r.id === 'string' && r.id.length <= 80 && RISK_ID.test(r.id) ? 'id:' + r.id : titleKey(r); }
function trimmed(v) { return typeof v === 'string' ? v.trim() : v; }
const CONTEXT_KEYS = { where: ['topic', 'place'], conventions: ['pattern', 'meaning'] };
// Who uses it, as the import reads it: groups with a "who", or one sentence.
function audienceGiven(a) {
  if (Array.isArray(a)) return a.some((u) => u && typeof u === 'object' && typeof u.who === 'string' && u.who.trim());
  return typeof a === 'string' && !!a.trim();
}
function merge(parts) {
  const out = { format: DESC_FORMAT, version: 1 };
  parts.forEach((p) => {
    // The project, its language and who wrote it: the first part that says; when it was written: the last.
    ['project', 'language', 'by'].forEach((k) => { if (!out[k] && typeof p[k] === 'string' && p[k].trim()) out[k] = p[k]; });
    if (typeof p.written === 'string' && p.written.trim()) out.written = p.written;
    // A part that says "add": true (one more process) lays its application over the one before: its
    // summary, its story and who uses it when it has them, its processes by name — one of the same name
    // replaced, a new one at the end. Any other part's "app", or one with "replace": ["app"], is the whole of it.
    if (p.app && typeof p.app === 'object') {
      if (p.add === true && out.app && !(Array.isArray(p.replace) && p.replace.indexOf('app') !== -1)) {
        const procs = (Array.isArray(out.app.processes) ? out.app.processes : []).slice();
        (Array.isArray(p.app.processes) ? p.app.processes : []).forEach((x) => {
          const i = procs.findIndex((q) => q && x && typeof q.name === 'string' && typeof x.name === 'string' && q.name.trim().toLowerCase() === x.name.trim().toLowerCase());
          if (i < 0) procs.push(x); else procs[i] = x;
        });
        out.app = Object.assign({}, out.app, p.app.summary ? { summary: p.app.summary } : {}, p.app.story ? { story: p.app.story } : {},
          audienceGiven(p.app.audience) ? { audience: p.app.audience } : {}, { processes: procs });
      } else out.app = p.app;
    }
    if (p.c4 && typeof p.c4 === 'object') out.c4 = p.c4;
    // Changes by id: one written again replaces the one before, a new one goes at the end.
    if (Array.isArray(p.changes)) {
      out.changes = (out.changes || []).slice();
      p.changes.forEach((x) => {
        const i = out.changes.findIndex((y) => y && x && y.id === x.id);
        if (i < 0) out.changes.push(x); else out.changes[i] = x;
      });
    }
    // Tickets the same way, by id.
    if (Array.isArray(p.tickets)) {
      out.tickets = (out.tickets || []).slice();
      p.tickets.forEach((x) => {
        const i = out.tickets.findIndex((y) => y && x && y.id === x.id);
        if (i < 0) out.tickets.push(x); else out.tickets[i] = x;
      });
    }
    TABLES.forEach((k) => {
      if (!p[k] || typeof p[k] !== 'object') return;
      out[k] = Object.assign(out[k] || {}, p[k]);
    });
    // Risks and context come from several parts (one per module, and the application's): they add up.
    // The same risk written again — the same id (ranked at another level, say), or the same level and
    // title — takes the place of the earlier copy; a context entry already there is not repeated.
    if (Array.isArray(p.risks)) {
      out.risks = (out.risks || []).slice();
      p.risks.forEach((x) => {
        if (!x || typeof x !== 'object') { out.risks.push(x); return; }
        const i = out.risks.findIndex((y) => y && typeof y === 'object' && (riskKey(y) === riskKey(x) || titleKey(y) === titleKey(x)));
        if (i < 0) out.risks.push(x); else out.risks[i] = x;
      });
    }
    // What a part says about the risks a person raised (risk triage, "verify"): carried by id, the later word winning.
    if (Array.isArray(p.verify)) {
      out.verify = (out.verify || []).slice();
      p.verify.forEach((x) => {
        const i = out.verify.findIndex((y) => y && x && y.id === x.id);
        if (i < 0) out.verify.push(x); else out.verify[i] = x;
      });
    }
    if (p.context && typeof p.context === 'object') {
      out.context = out.context || {};
      ['where', 'conventions', 'pitfalls'].forEach((k) => {
        if (!Array.isArray(p.context[k])) return;
        const keyOf = (x) => JSON.stringify(CONTEXT_KEYS[k] ? (x && typeof x === 'object' ? CONTEXT_KEYS[k].map((f) => trimmed(x[f])) : x) : trimmed(x));
        const list = (out.context[k] || []).slice();
        const seen = {};
        list.forEach((x) => { seen[keyOf(x)] = true; });
        p.context[k].forEach((x) => { const key = keyOf(x); if (!seen[key]) { seen[key] = true; list.push(x); } });
        out.context[k] = list;
      });
    }
  });
  // Parts that all add, with no whole file under them, make a file that adds too: imported, it is laid
  // over what MxScout keeps, as each part would have been — not put in its place.
  if (parts.length && parts.every((p) => p && p.add === true)) {
    out.add = true;
    if (parts.some((p) => Array.isArray(p.replace) && p.replace.indexOf('app') !== -1)) out.replace = ['app'];
  }
  return out;
}

// MxScout's own rules for the files in mxscout/ (repodocs.js, a copy of MxScout's public/repodocs.js), run as MxScout runs them.
function repoDocs(file) {
  if (!fs.existsSync(file)) throw new Error('repodocs.js is missing beside check-descriptions.js — reinstall the mendix-describe skill.');
  const vm = require('vm');
  const ctx = { console, TextEncoder, crypto: require('crypto').webcrypto };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'repodocs.js' });
  return ctx.MxRepoDocs;
}

// ---------- the work folder, and the Mendix project kept clean ----------
// Karol, 2026-10-15: in the Mendix project an agent writes only the documentation MxScout defines, through
// agent.js — never a working file. What it makes while it works (packs, notes, drafts, JSON before it is
// sent) goes into a work folder outside the project: $MXSCOUT_WORK when set, else
// <the system's temp folder>/mxscout-work/<project id, or a slug of its name>. agent.js loads this file
// (for merge) and so does mendix-assist's checker, so the rule lives once — a file of its own would be one
// more for every copy of the skill to carry.
const path = require('path');
const os = require('os');

function expandHome(p) { return String(p).replace(/^~(?=$|[\\/])/, os.homedir()); }
function mxProjectAt(file) {
  try { const p = JSON.parse(fs.readFileSync(file, 'utf8')); return p && p.format === 'mxscout-project' ? p : null; } catch (e) { return null; }
}
function workSlug(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
// What a directory belongs to, looking up from it: the MxScout project (a folder of its own, layout 1, or
// mxscout/ inside a Mendix project, layout 2) and the Mendix project (the directory that holds the .mpr).
function placesFrom(start) {
  const out = { project: null, projectDir: null, layout: 0, mendix: null, mpr: null };
  if (!start) return out;
  let dir = path.resolve(expandHome(start));
  for (let i = 0; i < 8; i++) {
    if (!out.project) {
      let p = null;
      if ((p = mxProjectAt(path.join(dir, 'project.json')))) Object.assign(out, { project: p, projectDir: dir, layout: 1 });
      else if ((p = mxProjectAt(path.join(dir, 'mxscout.json')))) Object.assign(out, { project: p, projectDir: dir, layout: 2 });
      else if ((p = mxProjectAt(path.join(dir, 'mxscout', 'mxscout.json')))) Object.assign(out, { project: p, projectDir: path.join(dir, 'mxscout'), layout: 2 });
    }
    if (!out.mendix) {
      let mpr = null;
      try { mpr = fs.readdirSync(dir).find((f) => /\.mpr$/i.test(f)) || null; } catch (e) { mpr = null; }
      if (mpr) Object.assign(out, { mendix: dir, mpr });
    }
    if (out.project && out.mendix) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (out.layout === 2 && !out.mendix) out.mendix = path.dirname(out.projectDir);
  return out;
}
// A path as it really is on disk — links followed for the part that exists — and without case where the
// file system ignores it (macOS, Windows): neither a link nor a capital letter is a way into the project.
function realish(p) {
  let full = path.resolve(p);
  const rest = [];
  for (;;) {
    try { full = path.join(fs.realpathSync(full), ...rest); break; } catch (e) { /* not there yet */ }
    const up = path.dirname(full);
    if (up === full) { full = path.join(full, ...rest); break; }
    rest.unshift(path.basename(full));
    full = up;
  }
  return process.platform === 'win32' || process.platform === 'darwin' ? full.toLowerCase() : full;
}
function within(dir, p) { return p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep); }
// The directories an agent's own files stay out of, each with the official outputs inside it: in the Mendix
// project mxscout/descriptions/, docs/, knowledge/, mxscout.json and .local/inbox/; in a project folder of its
// own (layout 1) inbox/ and knowledge/. The deepest directory a path is in decides.
const OFFICIAL_IN_MENDIX = ['mxscout/descriptions/', 'mxscout/docs/', 'mxscout/knowledge/', 'mxscout/mxscout.json', 'mxscout/.local/inbox/'];
const OFFICIAL_IN_FOLDER = ['inbox/', 'knowledge/'];
function protectedRoots(starts) {
  const roots = [];
  const add = (dir, allow, what) => { const real = realish(dir); if (!roots.some((r) => r.dir === real)) roots.push({ dir: real, shown: dir, allow, what }); };
  (starts || []).filter(Boolean).forEach((s) => {
    const pl = placesFrom(s);
    if (pl.mendix) add(pl.mendix, OFFICIAL_IN_MENDIX, 'the Mendix project');
    if (pl.layout === 1) add(pl.projectDir, OFFICIAL_IN_FOLDER, 'the MxScout project folder');
  });
  return roots.sort((a, b) => b.dir.length - a.dir.length);
}
// Whether a file may be written there: null when it may, else why not. official: one of agent.js's own
// writers (the descriptions, docs/, a solved case, the inbox) — those paths only; anything else, nowhere inside.
function refusedWrite(file, roots, official) {
  const p = realish(file);
  const root = (roots || []).find((r) => within(r.dir, p));
  if (!root) return null;
  const rel = p.slice(root.dir.length + 1).split(path.sep).join('/');
  if (official && root.allow.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a))) return null;
  return 'Refusing to write ' + path.resolve(file) + ': it is inside ' + root.what + ' (' + root.shown + '), where only the documentation is written — ' +
    root.allow.join(', ') + ', by agent.js itself. Keep working files in the work folder: node agent.js workdir prints it.';
}
// The work folder: $MXSCOUT_WORK, or <temp>/mxscout-work/<the project's id | a slug of its name | of the .mpr's
// name | default>. name: the project's name when nothing on disk says which project it is (the channel).
function workFolder(starts, name) {
  if (process.env.MXSCOUT_WORK) return path.resolve(expandHome(process.env.MXSCOUT_WORK));
  let key = null;
  (starts || []).filter(Boolean).some((s) => {
    const pl = placesFrom(s);
    const id = pl.project && typeof pl.project.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(pl.project.id) ? pl.project.id : null;
    key = id || (pl.project && workSlug(pl.project.name)) || (pl.mpr && workSlug(pl.mpr.replace(/\.mpr$/i, ''))) || null;
    return !!key;
  });
  return path.join(os.tmpdir(), 'mxscout-work', key || workSlug(name) || 'default');
}
// A path an agent gives: absolute, as it is; relative, in the work folder — to read, from the current
// directory when it is there and not in the work folder.
function inWork(file, work, reading) {
  const f = expandHome(file);
  if (path.isAbsolute(f)) return f;
  const there = path.join(work, f);
  if (!reading || fs.existsSync(there) || !fs.existsSync(path.resolve(f))) return there;
  return path.resolve(f);
}
const workplace = { placesFrom, protectedRoots, refusedWrite, workFolder, inWork, OFFICIAL_IN_MENDIX, OFFICIAL_IN_FOLDER };

// ---------- the command line ----------
function main(argv) {
  const [cmd, ...given0] = argv;
  // --folder <MxScout project folder>: its ai-pack.md is the pack, and — for todo — its
  // descriptions.json the descriptions (MxScout writes both there; see agent.js).
  let rest = given0.slice();
  const refreshing = rest.indexOf('--refresh') !== -1;
  rest = rest.filter((a) => a !== '--refresh');
  const fi = rest.indexOf('--folder');
  let joined; // layout 2: the descriptions joined from descriptions/, or null when there are none
  const folderGiven = fi !== -1 ? rest[fi + 1] || null : null;
  if (fi !== -1) {
    let dir = rest[fi + 1];
    rest.splice(fi, 2);
    // Inside the Mendix project (layout 2): its mxscout/; the pack is the current model's, as agent.js makes it.
    if (dir && fs.existsSync(path.join(dir, 'mxscout', 'mxscout.json'))) dir = path.join(dir, 'mxscout');
    const repo = !!dir && fs.existsSync(path.join(dir, 'mxscout.json'));
    let pack = path.join(dir || '', 'ai-pack.md');
    const desc = path.join(dir || '', 'descriptions.json');
    if (repo) {
      // One resolver of the current model for every command (agent.js snapshot): made from the .mpr when the
      // work folder has no pack of this model yet — a fresh checkout with no .local/ needs nothing else.
      const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'agent.js'), 'snapshot', '--json', '--folder', dir].concat(refreshing ? ['--refresh'] : []),
        { encoding: 'utf8', env: Object.assign({}, process.env, { MXSCOUT_TOKEN: '' }) });
      let snap = null;
      try { snap = r.status === 0 ? JSON.parse(r.stdout) : null; } catch (e) { snap = null; }
      if (!snap || !snap.file) throw new Error('No pack of the model in ' + dir + ': ' + (String(r.stderr || r.stdout || '').trim().split('\n')[0] || 'agent.js snapshot gave none') + '.');
      pack = snap.file;
      console.log('snapshot: ' + snap.id + ' — ' + snap.from);
      const R = repoDocs(path.join(__dirname, 'repodocs.js'));
      const files = [];
      (function walk(d, rel) {
        if (!fs.existsSync(d)) return;
        fs.readdirSync(d, { withFileTypes: true }).forEach((n) => {
          if (n.name[0] === '.') return;
          if (n.isDirectory()) walk(path.join(d, n.name), rel + n.name + '/');
          else if (/\.json$/i.test(n.name)) files.push({ path: 'descriptions/' + rel + n.name, text: fs.readFileSync(path.join(d, n.name), 'utf8') });
        });
      })(path.join(dir, 'descriptions'), '');
      const bad = files.find((f) => R.conflicted(f.text));
      if (bad) throw new Error('mxscout/' + bad.path + ' has a git conflict — resolve it first.');
      const pj = JSON.parse(fs.readFileSync(path.join(dir, 'mxscout.json'), 'utf8'));
      const j = R.join(files, pj.describedAt || null);
      if (j.error) throw new Error(j.error);
      joined = j.value;
      if (cmd === 'todo') rest = [pack].concat(rest);
      else if (cmd === 'check') rest = [pack].concat(rest);
    } else {
      // A project folder of its own: ai-pack.md, which MxScout writes there and rewrites when it reads the model again.
      if (!dir || !fs.existsSync(pack)) throw new Error('No ai-pack.md in ' + dir + ' — is it an MxScout project folder, with the project open in MxScout once?');
      console.log('snapshot: ' + snapshotOf(fs.readFileSync(pack, 'utf8')) + ' — ai-pack.md as MxScout wrote it');
      if (cmd === 'todo') rest = [pack].concat(fs.existsSync(desc) ? [desc] : [], rest);
      else if (cmd === 'check') rest = [pack].concat(rest);
    }
  }
  const list = rest.indexOf('--list') !== -1;
  // A file named without a path is the agent's own, in the work folder (read from here when it is not there).
  const work = workFolder([folderGiven, process.cwd()]);
  const args = rest.filter((a) => a !== '--list').map((a, i) => (cmd === 'merge' && i === 0 ? inWork(a, work, false) : inWork(a, work, true)));
  if (cmd === 'todo' && args[0]) {
    const pack = readPack(fs.readFileSync(args[0], 'utf8'));
    const given = joined !== undefined ? null : args[1] && fs.existsSync(args[1]) ? fs.readFileSync(args[1], 'utf8') : null;
    const docs = given !== null && isDocs(given);
    const desc = joined !== undefined ? joined : given === null ? null : docs ? readDocs(given, pack) : readJson(args[1]);
    const t = todo(pack, desc);
    // From the documentation, a module's long description and its notes cannot be told apart from the rest of its page: not reported.
    console.log(t.flows + ' flows to describe in ' + t.modules.length + ' modules' + (t.overview ? '; the application overview is missing' : !docs && t.overviewStory ? '; the application has no long description' : '') +
      (t.missingModules.length ? '; ' + t.missingModules.length + ' modules have no description' : '') +
      (!docs && t.shortModules.length ? '; ' + t.shortModules.length + ' modules have a summary but no long description (' + t.shortModules.join(', ') + ')' : '') +
      (t.risks ? '; no risks yet' : '') + (t.context ? '; no context for developers yet' : '') +
      (!docs && t.noNotes.length ? '; ' + t.noNotes.length + ' modules have no notes' : '') + (t.c4 ? '; no architecture yet' : '') + '.' +
      (docs ? ' (Read from the documentation: "changed" are the descriptions it marks out of date.)' : ''));
    if (t.recheck.length || t.falsePositives.length || t.verify.length) {
      console.log('Risk triage: ' + [t.recheck.length ? t.recheck.length + ' fixed to check again (' + t.recheck.join(', ') + ')' : null,
        t.falsePositives.length ? t.falsePositives.length + ' false positives not to raise again (' + t.falsePositives.join(', ') + ')' : null,
        t.verify.length ? t.verify.length + ' raised by people, marked fixed, to answer in "verify" (' + t.verify.join(', ') + ')' : null].filter(Boolean).join('; ') + '.');
    }
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
    // Into the work folder — never into the Mendix project or the project folder (agent.js writes the result there).
    const refused = refusedWrite(args[0], protectedRoots([folderGiven, process.cwd(), path.dirname(args[0])]), false);
    if (refused) throw new Error(refused);
    fs.mkdirSync(path.dirname(args[0]), { recursive: true });
    fs.writeFileSync(args[0], JSON.stringify(merged, null, 2) + '\n');
    const n = ['microflows', 'nanoflows', 'pages', 'entities'].reduce((s, k) => s + Object.keys(merged[k] || {}).length, 0);
    console.log('Wrote ' + args[0] + ': ' + n + ' descriptions' + (merged.changes ? ', ' + merged.changes.length + ' change' + (merged.changes.length === 1 ? '' : 's') : '') + (merged.tickets ? ', ' + merged.tickets.length + ' ticket' + (merged.tickets.length === 1 ? '' : 's') : '') + ' from ' + (args.length - 1) + ' parts.');
    return 0;
  }
  console.log('Usage:\n  node check-descriptions.js todo  <pack.md> [descriptions.json | docs.md] [--list]\n  node check-descriptions.js todo  --folder <project folder> [--list] [--refresh]\n  node check-descriptions.js check <pack.md> <descriptions.json>\n  node check-descriptions.js check --folder <project folder> <descriptions.json>\n  node check-descriptions.js merge <out.json> <part.json> [<part.json> …]');
  return 2;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exitCode = 2; }
}
module.exports = { readPack, readDocs, todo, check, merge, snapshotOf, DESC_FORMAT, CAPS, workplace };
