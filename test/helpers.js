/* Getting a browser tab to the state every bridge test starts from: a project
 * seeded, an approved environment, and the entity popup open on its Data tab. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const MODEL = require('./model');

// ---------- files as a checkout may hold them ----------
// A clone on Windows with core.autocrlf=true and no .gitattributes — or one made before the repository had
// it — holds every text file with CRLF. .gitattributes now asks for LF everywhere, but a test that reads a
// file of this repository reads it through these, so it checks what the file SAYS, not how its lines end.
function lf(text) { return String(text).replace(/\r\n?/g, '\n'); }
function readText(file) { return lf(fs.readFileSync(file, 'utf8')); }

// The mode git records for a file of this repository ('100755' executable, '100644' not) — what a clone
// gets on a system that keeps the bit, and the only place the bit exists on Windows, where a checkout has
// none. null when git cannot be asked (a download without .git, or no git on the machine).
function gitMode(file) {
  const root = path.join(__dirname, '..');
  const r = spawnSync('git', ['ls-files', '-s', '--', path.relative(root, file).split(path.sep).join('/')], { cwd: root, encoding: 'utf8' });
  const m = r.status === 0 && /^(\d{6}) /.exec(r.stdout || '');
  return m ? m[1] : null;
}

// `model` defaults to the shared one; a test that needs a shape every other
// test must not see (and whose counts it would shift) passes its own.
async function openSeededProject(t, appUrl, model) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');

  // Straight into IndexedDB. The import path has its own concerns; these tests
  // are about the bridge, and driving a file picker to get here would make
  // every one of them fail for the wrong reason.
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        // These tests are about the Live app, a Developer tool: the project has them on.
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null, devTools: true },
      ${JSON.stringify(model || MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  // Not a fixed pause and a click: the project lands on Overview once it has opened, so the click is
  // repeated until the Live app is the screen shown.
  await goToSection(mx, 'Live app', '.live-url-input');
  await mx.evaluate(`(function(){
    var i = document.querySelector('.live-url-input');
    i.value = ${JSON.stringify(appUrl)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Check')[0].click();
    return true; })()`);
  await mx.waitFor(`!!document.querySelector('.live-status-ok')`, 8000, 'environment approved');
  return mx;
}

// An entity's full window (attributes and access, data, comments): through the
// search, the way it opens from anywhere. The Domain model screen's own Browse
// data shows the rows alone (test/67-domain-screen.test.js covers that).
async function openEntity(mx, name) {
  await mx.evaluate(`(function(){ window.MxPalette.open(${JSON.stringify(name)}); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.palette-row')).find(function (r) { return r.querySelector('.palette-kind').textContent === 'Entity' && r.querySelector('.palette-label').textContent === ${JSON.stringify(name)}; })`, 8000, 'entity in the search');
  await mx.evaluate(`Array.from(document.querySelectorAll('.palette-row')).find(function (r) { return r.querySelector('.palette-kind').textContent === 'Entity' && r.querySelector('.palette-label').textContent === ${JSON.stringify(name)}; }).click()`);
  await mx.waitFor(`!!document.querySelector('.modal-detail')`, 8000, 'entity window');
}

async function openEntityPopup(mx) {
  await openEntity(mx, 'Order');
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'popup tabs');
}

function clickTab(name) {
  return `Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === ${JSON.stringify(name)})[0].click()`;
}

// A section of the sidebar, by its label, clicked until its screen is there. Opening a project lands
// on Overview when it has finished opening, and a click made before that is undone by the landing —
// tests 35, 36, 48, 52, 55, 67, 69 and 73 each lost that race on a slow run and were fixed one by
// one. `ready` is a CSS selector that is only there once the screen has drawn; without one, the
// section being the active one is enough. Returns once both hold.
async function goToSection(mx, name, ready, ms) {
  const sel = ready ? JSON.stringify(ready) : null;
  await mx.waitFor(`(function(){
    var b = Array.from(document.querySelectorAll('.tree-section')).find(function (n) {
      var l = n.querySelector('.tree-section-label'); return (l ? l.textContent : n.textContent).trim() === ${JSON.stringify(name)}; });
    if (!b) return false;
    var on = b.classList.contains('active');
    if (on && (${sel ? '!!document.querySelector(' + sel + ')' : 'true'})) return true;
    if (!on) b.click();
    return false; })()`, ms || 12000, 'the ' + name + ' screen');
}

// A tab of the Documentation section (docs.js: Folder, Agent channel, Without an agent tool, Export),
// by its key — 'folder', 'agent', 'manual', 'export' — clicked until it is the one on screen and
// `ready`, a CSS selector, is there.
async function goToDocsTab(mx, tab, ready, ms) {
  // 2026-10-16: the agent channel and "without an agent tool" are one tab, Other ways.
  if (tab === 'agent' || tab === 'manual') tab = 'other';
  await goToSection(mx, 'Documentation', '.docs-landing', ms);
  const sel = ready ? JSON.stringify(ready) : null;
  await mx.waitFor(`(function(){
    var b = document.querySelector('.docs-tab[data-tab="${tab}"]');
    if (!b) return false;
    if (b.classList.contains('on')) return ${sel ? '!!document.querySelector(' + sel + ')' : 'true'};
    b.click();
    return false; })()`, ms || 12000, 'the Documentation tab ' + tab);
}

module.exports = { lf, readText, gitMode, openSeededProject, openEntityPopup, openEntity, clickTab, goToSection, goToDocsTab };
