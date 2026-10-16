/* Export documentation… and its import (bundle.js; Karol, 2026-10-16: "here is a package of all 30
 * projects, import it — only the documentation, nothing else").
 *
 * What this holds:
 *  - the file: one code-only envelope, its kind readable, nothing of a project readable without the code;
 *    inside, for each project, its model, descriptions and solved cases and nothing else — a whitelist;
 *  - the projects list offers Export documentation…, every project ticked;
 *  - opening the file (as New project picks it): the code, then the projects, each New, Update or Up to
 *    date; a new one is added, remembering where it came from; a later, newer copy of it updates it. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxBundle', 15000, 'MxScout loaded');
  const desc = JSON.stringify({ format: 'mxscout-descriptions', version: 1, app: { summary: 'Takes orders and ships them.' } });
  await mx.evaluate(`(async function () {
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'bx1', name: 'Bundle One', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, ${JSON.stringify(MODEL)});
    await MxStore.saveProjectWithModel({ id: 'bx2', name: 'Bundle Two', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, ${JSON.stringify(MODEL)});
    await MxStore.put('descriptions', { projectId: 'bx1', importedAt: now, fileName: 'd.json', value: MxDescribe.parse(${JSON.stringify(desc)}).value });
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxBundle', 15000, 'MxScout loaded again');

  // ---- the file ----
  const made = JSON.parse(await mx.evaluate(`(async function () {
    var code = MxCrypto.generateCode();
    var all = await MxStore.getAll('projects');
    var env = await MxBundle.makeFile(all.filter(function (p) { return p.id === 'bx1' || p.id === 'bx2'; }), code);
    var text = JSON.stringify(env);
    var opened = await MxCrypto.openWithCode(env, code);
    var p = opened.payload;
    return JSON.stringify({ env: text, code: code, kind: env.kind, version: env.version, readable: /Bundle One|Takes orders|Sales\\.Order/.test(text), format: p.format,
      names: p.projects.map(function (e) { return e.name; }).sort().join(','), keys: Object.keys(p.projects[0]).sort().join(','),
      desc: p.projects.filter(function (e) { return e.id === 'bx1'; })[0].descriptions ? 'yes' : 'no', none: p.projects.filter(function (e) { return e.id === 'bx2'; })[0].descriptions });
  })()`));
  t.ok(made.kind === 'mxscout-docs-bundle' && made.version === 1 && !made.readable, 'one encrypted file, its kind readable and nothing of a project readable without the code');
  t.ok(made.format === 'mxscout-docs-bundle' && made.names === 'Bundle One,Bundle Two', 'inside, the projects ticked: ' + made.names);
  t.ok(made.keys === 'createdAt,descriptions,id,knowledge,model,name,stamp' && made.desc === 'yes' && made.none === null,
    'each one its model, descriptions and solved cases, and nothing else — no Assist, comments, decisions about risks or settings: ' + made.keys);

  // ---- the projects list offers it ----
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.evaluate(`(Array.from(${SW}('button')).find(function (b) { return b.textContent.trim() === 'All projects'; }) || { click: function () {} }).click()`);
  // Behind the projects page's ⋯ (home.js).
  await mx.waitFor(`(function(){ var m = document.querySelector('.home-head .xe-more .xe-icon-btn'); if (m && !document.querySelector('.home-head .xe-menu')) m.click(); return !!Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent === 'Export documentation…'; }); })()`, 8000, 'the button');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent === 'Export documentation…'; }).click()`);
  await mx.waitFor(`!!document.querySelector('.bundle-modal .bundle-row')`, 5000, 'the export dialog');
  const pick = JSON.parse(await mx.evaluate(`(async function () { return JSON.stringify({ rows: document.querySelectorAll('.bundle-modal .bundle-row').length, ticked: document.querySelectorAll('.bundle-modal .bundle-pick:checked').length,
    projects: (await MxStore.getAll('projects')).length, go: document.querySelector('.bundle-go').textContent, says: /no Assist items, comments, decisions about risks/.test(document.querySelector('.bundle-modal').textContent) }); })()`));
  t.ok(pick.rows === pick.projects && pick.ticked === pick.projects && /^Export \d+ projects?$/.test(pick.go) && pick.says,
    'Export documentation… lists every project, all ticked, and says what goes and what does not: ' + JSON.stringify(pick));
  await mx.evaluate(`Array.from(document.querySelectorAll('.bundle-modal button')).find(function (b) { return b.textContent === 'Cancel'; }).click()`);

  // ---- opened by someone who has one of them already, and not the other ----
  await mx.evaluate(`MxStore.deleteProjectDeep('bx2').then(function () { return true; })`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxBundle', 15000, 'MxScout loaded again');
  const open = async () => {
    await mx.evaluate(`(function(){ MxBundle.openFile('docs.mxscout', JSON.parse(${JSON.stringify(made.env)})); return true; })()`);
    await mx.waitFor(`!!document.querySelector('.bundle-code-input')`, 5000, 'the code step');
    await mx.evaluate(`(function(){ var i = document.querySelector('.bundle-code-input'); i.value = ${JSON.stringify(made.code)}; i.dispatchEvent(new Event('input')); document.querySelector('.bundle-open').click(); return true; })()`);
    await mx.waitFor(`!!document.querySelector('.bundle-import')`, 10000, 'the list of projects');
    // This browser only: the library folder needs a folder picker the suite does not drive.
    await mx.evaluate(`(function(){ var r = document.querySelector('.bundle-where[value="browser"]'); if (r) r.click(); return true; })()`);
    return JSON.parse(await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.bundle-modal .bundle-row')).map(function (r) {
      return r.querySelector('.bundle-name').textContent + ':' + r.querySelector('.bundle-st').textContent + ':' + (r.querySelector('.bundle-pick').checked ? 'ticked' : 'not') + (r.querySelector('.bundle-pick').disabled ? ',disabled' : ''); }).sort())`));
  };
  const rows = await open();
  const where = await mx.evaluate(`!!document.querySelector('.bundle-where[value="library"]') && /mxscout-project/.test(document.querySelector('.bundle-where-field').textContent)`);
  t.ok(rows.join('|') === 'Bundle One:Up to date:not,disabled|Bundle Two:New:ticked', 'the code opens it: the project kept here is up to date, the other new and ticked: ' + rows.join('|'));
  t.ok(where, 'and it offers the library folder on disk first, where Claude reads them (/mxscout-project)');
  await mx.evaluate(`document.querySelector('.bundle-import').click()`);
  const said = await mx.waitFor(`(function(){ var m = document.querySelector('.msg'); return !document.querySelector('.bundle-modal') && m && m.textContent; })()`, 10000, 'imported');
  const two = JSON.parse(await mx.evaluate(`MxStore.getAll('projects').then(function (all) { var p = all.filter(function (x) { return x.name === 'Bundle Two'; })[0]; return JSON.stringify(p ? { origin: p.origin && p.origin.id, source: p.source.kind } : null); })`));
  t.ok(/Documentation imported: 1 project added\./.test(said) && two && two.origin === 'bx2' && two.source === 'documentation',
    'Import adds it, remembering the project it came from: ' + said + ' ' + JSON.stringify(two));

  // ---- a newer copy updates it ----
  await mx.evaluate(`MxStore.getAll('projects').then(function (all) { var p = all.filter(function (x) { return x.name === 'Bundle Two'; })[0]; p.origin.stamp = '2000-01-01T00:00:00.000Z'; return MxStore.put('projects', p); }).then(function () { return true; })`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxBundle', 15000, 'MxScout loaded again');
  const again = await open();
  t.ok(again.join('|') === 'Bundle One:Up to date:not,disabled|Bundle Two:Update:ticked', 'opened again with a newer copy of it: Update, ticked; the other still up to date: ' + again.join('|'));
  await mx.evaluate(`document.querySelector('.bundle-import').click()`);
  const said2 = await mx.waitFor(`(function(){ var m = document.querySelector('.msg'); return !document.querySelector('.bundle-modal') && m && m.textContent; })()`, 10000, 'updated');
  const count = await mx.evaluate(`MxStore.getAll('projects').then(function (all) { return all.filter(function (x) { return x.name === 'Bundle Two'; }).length; })`);
  t.ok(/Documentation imported: 1 project updated\./.test(said2) && count === 1, 'and Import updates it in its place — not a second copy: ' + said2);
  await mx.close();
};
