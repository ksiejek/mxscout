'use strict';
/* The Claude skills that ship with this copy of MxScout — mendix-describe and mendix-assist — handed to
 * the browser tab, read-only, so it can write them into a Mendix project's .claude/skills/ when a project
 * is kept inside that project (public/repoui.js, store.js). Karol, 2026-10-15: people who never open
 * MxScout get Claude and the latest skills by pulling the Mendix repository.
 *
 * GET only, same-origin like every route, no parameters. It serves exactly the files named in FILES
 * below — a fixed allowlist, checked against the disk by the test suite — read fresh from skills/ on
 * each request, as text, bounded. It writes nothing: the files reach the project through the browser's
 * own File System Access API, never through this server. */
const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const { sendJson } = require('../http-util');

const ROOT = path.join(__dirname, '..', '..', 'skills');
const FILES = {
  'mendix-describe': ['SKILL.md', 'README.md', 'agent.js', 'check-descriptions.js', 'repodocs.js',
    'reference/business-narrative.md', 'reference/c4.md', 'reference/descriptions-format.md', 'reference/migration.md', 'reference/module-notes.md',
    'reference/pack-format.md', 'reference/risk-levels.md',
    // MxScout's own engine, copies of public/ (the suite checks they are byte for byte): with it agent.js reads the
    // .mpr and writes mxscout/docs/ as MxScout does, for a team that works with an agent alone.
    'engine/sqlite.js', 'engine/bson.js', 'engine/mpr.js', 'engine/modelversion.js', 'engine/docs-data.js', 'engine/describe.js',
    'engine/reportdata.js', 'engine/triage.js', 'engine/docs-triage.js', 'engine/docs-view.js', 'engine/docs-file.js'],
  'mendix-assist': ['SKILL.md', 'README.md', 'check-assist.js', 'selftest.js', 'reference/assist-format.md', 'reference/knowledge-format.md']
};
const MAX_BYTES = 2 * 1024 * 1024;

function handleSkills(req, res) {
  let total = 0;
  const skills = Object.keys(FILES).map((name) => ({
    name,
    files: FILES[name].map((p) => {
      let text = null;
      // With LF, whatever this checkout's line endings: what is written into a project is the same text from
      // every copy of MxScout, so a copy already there compares equal and is not written again.
      try { text = fs.readFileSync(path.join(ROOT, name, p), 'utf8').replace(/\r\n?/g, '\n'); } catch (e) { text = null; }
      total += text ? text.length : 0;
      return { path: p, text };
    })
  }));
  const missing = [];
  skills.forEach((s) => s.files.forEach((f) => { if (f.text === null) missing.push(s.name + '/' + f.path); }));
  if (missing.length || total > MAX_BYTES) {
    sendJson(res, 500, { error: missing.length ? 'This copy of MxScout is missing skill files: ' + missing.join(', ') : 'The skills are larger than expected.' });
    return;
  }
  sendJson(res, 200, { version: pkg.version, skills });
}

module.exports = { handleSkills, FILES };
