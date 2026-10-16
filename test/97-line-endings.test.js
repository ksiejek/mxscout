/* Files written with CRLF read the same as files written with LF (.gitattributes · public/folder.js ·
 * public/repodocs.js · tools/build-guide.js · server/index.js · server/routes/skills.js).
 *
 * The audit of 2026-10-15 (B14) ran the suite on Windows, where git with core.autocrlf=true checks every
 * text file out with CRLF. The repository now asks for LF everywhere (.gitattributes), but two kinds of
 * file can still arrive with CRLF: a Mendix project's mxscout/ folder, which lives in its team's
 * repository under their settings, and this repository in a clone made before .gitattributes existed.
 * What is checked: the attributes say LF for text and CRLF for the one cmd.exe reads; a project folder's
 * files are read as LF, so a stamp on a first line, the skills' list of files and git's conflict
 * markers are found in a CRLF file; the team guide's page written into a project is the same from a CRLF
 * page; the guide's script hash is the same from a CRLF page, and the server serves the page — and the
 * skills — with LF whatever the checkout holds.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers');

module.exports = async function (t) {
  const root = path.join(__dirname, '..');
  const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

  // ---- the repository's own rules ----
  const attrs = readText(path.join(root, '.gitattributes'));
  t.ok(/^\* text=auto eol=lf$/m.test(attrs) && ['js', 'json', 'md', 'html', 'css', 'sh', 'ps1'].every((x) => new RegExp('^\\*\\.' + x + '\\s+text eol=lf$', 'm').test(attrs)) &&
    /^\*\.cmd\s+text eol=crlf$/m.test(attrs) && ['woff2', 'db', 'mpr'].every((x) => new RegExp('^\\*\\.' + x + '\\s+binary$', 'm').test(attrs)),
    '.gitattributes: LF for every text file on every machine, CRLF for MxScout.cmd, fonts, databases and models never converted');

  // ---- the team guide: the same hash, the same page served ----
  const build = require(path.join(root, 'tools', 'build-guide.js'));
  const page = readText(path.join(root, 'public', 'guide-team.html'));
  t.ok(build.scriptHash(crlf(page)) === build.scriptHash(page) && build.make() === page, 'the guide’s script has the same hash from a CRLF copy of the page, and the page is made with LF from the guide');
  const served = await (await fetch(t.MX + '/guide-team.html')).text();
  t.ok(served.indexOf('\r') === -1 && served === page, 'the server serves the page with LF — the bytes its policy’s hash is of');
  const skills = await (await fetch(t.MX + '/api/skills')).json();
  t.ok(skills.skills.every((s) => s.files.every((f) => f.text.indexOf('\r') === -1)), 'and the skills it hands the tab to write into a project with LF too');

  // ---- a project folder's files, read in the page ----
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxRepoDocs && !!window.MxFolder', 15000, 'MxScout loaded');
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var R = MxRepoDocs, F = MxFolder, CR = function (s) { return s.replace(/\\n/g, '\\r\\n'); };
    var st = R.stamp(F.EDITION, '1.13.0');
    var version = R.skillVersion('mendix-describe', st, ['SKILL.md', 'agent.js']);
    var conflict = '[\\n<<<<<<< HEAD\\n  {"level": "P2"}\\n=======\\n  {"level": "P1"}\\n>>>>>>> teammate\\n]\\n';
    var page = await (await fetch('/guide-team.html')).text();
    // A folder of the browser's private file system, a file written there with CRLF, read back through MxFolder.
    var dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('crlf-test', { create: true });
    var w = await (await dir.getFileHandle('VERSION', { create: true })).createWritable();
    await w.write(CR(version)); await w.close();
    var read = await F.readFile(dir, 'VERSION');
    return JSON.stringify({
      files: R.skillFiles(CR(version)),
      stamp: R.parseStamp(CR(R.guide('# Guide\\n', st))),
      conflicted: R.conflicted(CR(conflict)),
      sides: R.sides(CR(conflict)).theirs,
      guideHtml: R.guideHtml(CR(page), st) === R.guideHtml(page, st),
      read: read.text === version
    });
  })()`));
  t.ok(JSON.stringify(r.files) === JSON.stringify(['SKILL.md', 'agent.js']), 'a skill’s VERSION written with CRLF still lists its files: ' + JSON.stringify(r.files));
  t.ok(r.stamp && r.stamp.v.join('.') === '1.13.0', 'a stamp on a CRLF file’s first line is read: ' + JSON.stringify(r.stamp));
  t.ok(r.conflicted && r.sides === '[\n  {"level": "P1"}\n]\n', 'git’s conflict markers in a CRLF file are found, and each side read: ' + JSON.stringify(r.sides));
  t.ok(r.guideHtml, 'GUIDE.html written into a project is the same from a CRLF page as from an LF one');
  t.ok(r.read, 'and a file read from a project folder comes back with LF, so it compares equal to what MxScout would write');
  await mx.close();
  t.ok(fs.existsSync(path.join(root, 'MxScout.cmd')), 'MxScout.cmd is there, the one file kept in CRLF');
};
