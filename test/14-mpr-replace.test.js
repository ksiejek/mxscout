/* "Replace model…" on an existing project offers the same choice as "New
 * project" (test/13, test/16): a project folder, or a file — one button and
 * one small modal instead of the two separate buttons this used to be split
 * across. The folder path re-reads a Mendix project folder, but — unlike
 * "Import Mendix project folder…" on a new project — stops at a diff summary
 * (added/removed by name, per category) and only writes anything once the
 * user confirms. Seeds a project with a hand-built OLD model that partially
 * overlaps the same v2 fixture used by the other mpr tests, so the diff has
 * a controlled mix: something added, something removed, and something
 * unchanged (which must NOT show up in the diff at all — a "no differences"
 * category is the thing this test is checking for as much as the
 * differences themselves). Clicking through to the real folder picker can't
 * be automated (same limitation as test/16), so once the modal's shape is
 * checked, the folder route is entered directly via
 * window.MxMprImport.openReplace — exactly what the modal's own click
 * handler does, minus the unmockable native dialog in between. */
'use strict';
const fs = require('fs');
const path = require('path');

const OLD_MODEL = {
  meta: { source: 'test' },
  modules: [{ name: 'Sales' }],
  entities: [
    { module: 'Sales', name: 'Customer', qualifiedName: 'Sales.Customer', attributes: [], accessRules: [] }, // unchanged
    { module: 'Sales', name: 'Legacy', qualifiedName: 'Sales.Legacy', attributes: [], accessRules: [] }        // removed by the new model
  ],
  associations: [],
  userRoles: [{ name: 'User', moduleRoles: ['Sales.User'] }], // unchanged
  microflows: [{ module: 'Sales', name: 'OldFlow', qualifiedName: 'Sales.OldFlow', allowedModuleRoles: [], parameters: [] }], // removed
  nanoflows: [], pages: []
};

module.exports = async function (t) {
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8'));

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');

  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'replace-target', name: 'ReplaceTarget', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(OLD_MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.evaluate(`(function(){
    var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects');
    if (b) b.click();
    return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.project-card')).find(c => /ReplaceTarget/.test(c.textContent))`, 10000, 'seeded project listed');

  await mx.evaluate(`(function(){
    var card = Array.from(document.querySelectorAll('.project-card')).find(c => /ReplaceTarget/.test(c.textContent));
    Array.from(card.querySelectorAll('button')).find(b => /Replace model/.test(b.textContent)).click();
    return true; })()`);
  await mx.waitFor(`!!document.querySelector('.modal')`, 8000, 'replace-choice modal');
  const choiceModal = await mx.evaluate(`document.querySelector('.modal').textContent`);
  t.ok(/Replace model for .ReplaceTarget./.test(choiceModal), 'the modal names the project it will replace: ' + choiceModal);
  t.ok(await mx.evaluate(`!!document.querySelector('.modal .file-drop')`) &&
    /Choose the Mendix project folder/.test(choiceModal) && /Choose a JSON file/.test(choiceModal),
    'the same choice as New project — a project folder or a file, not two separate buttons: ' + choiceModal);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Cancel').click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'choice modal closed'), 'Cancel leaves the project untouched and closes the modal');

  // The folder tile's click handler calls window.showDirectoryPicker(), a
  // native OS dialog nothing here can drive — entering the folder route
  // directly is what test/16 does for the same reason.
  await mx.evaluate(`window.MxMprImport.openReplace('replace-target')`);
  await mx.waitFor(`!!document.querySelector('.modal')`, 8000, 'replace modal');
  t.ok(await mx.evaluate(`document.querySelector('.modal h3').textContent`) === 'Replace model from Mendix project folder',
    'the modal is clearly labelled as a replace, not a new import');

  await mx.evaluate(`(function(){
    var sidecar = ${JSON.stringify(sidecar)};
    function b64ToBytes(b64) { var bin = atob(b64); var u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
    var mprBytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); });
    var entries = [{ relativePath: 'TestProject/App.mpr', file: new File([mprBytes], 'App.mpr') }].concat(
      Object.keys(sidecar).map(function (relPath) {
        return { relativePath: 'TestProject/mprcontents/' + relPath, file: new File([b64ToBytes(sidecar[relPath])], relPath.split('/').pop()) };
      })
    );
    window.MxMprImport.handleEntries(entries);
    return true; })()`);

  const ready = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Found App\\.mpr/.test(m.textContent) && m.textContent; })()`, 8000, 'ready step');
  t.ok(/compare it against the model already stored for .ReplaceTarget./.test(ready), 'the ready step names what it will compare against, before doing anything: ' + ready);
  t.ok(!/Project name/.test(ready), 'there is no project-name field to fill in — the project already has one');

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Compare').click()`);
  const diffText = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && document.querySelector('.modal .popup-section') && m.textContent; })()`, 15000, 'diff step');

  t.ok(/entities/.test(diffText) && /\+1 \/ −1/.test(diffText), 'entities shows one added and one removed: ' + diffText);
  t.ok(/Sales\.Order/.test(diffText) && /Sales\.Legacy/.test(diffText), 'names the specific entity added (Order) and removed (Legacy): ' + diffText);
  t.ok(/associations/.test(diffText) && /Sales\.Order_Customer/.test(diffText), 'the new association shows as added: ' + diffText);
  t.ok(/microflows/.test(diffText) && /Sales\.CreateOrder/.test(diffText) && /Sales\.OldFlow/.test(diffText),
    'microflows shows the new one added and the old one removed: ' + diffText);
  t.ok(!/user role/.test(diffText), 'user roles are identical in both models, so that category does not appear at all: ' + diffText);
  t.ok(!/Sales\.Customer/.test(diffText), 'an entity present in both models is not mentioned — this is a diff, not a full listing');

  // Nothing has been written yet — Cancel here must leave the old model untouched.
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Cancel').click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'modal closed'), 'Cancel at the diff step closes without confirming');
  const stillOld = await mx.evaluate(`MxStore.getModel('replace-target').then(m => m.entities.map(e => e.qualifiedName).sort())`);
  t.ok(JSON.stringify(stillOld) === JSON.stringify(['Sales.Customer', 'Sales.Legacy']),
    'and the stored model is untouched: ' + JSON.stringify(stillOld));

  // ---- do it again, and this time confirm ----
  await mx.evaluate(`window.MxMprImport.openReplace('replace-target')`);
  await mx.waitFor(`!!document.querySelector('.modal')`, 8000, 'replace modal again');
  await mx.evaluate(`(function(){
    var sidecar = ${JSON.stringify(sidecar)};
    function b64ToBytes(b64) { var bin = atob(b64); var u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
    var mprBytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); });
    var entries = [{ relativePath: 'TestProject/App.mpr', file: new File([mprBytes], 'App.mpr') }].concat(
      Object.keys(sidecar).map(function (relPath) {
        return { relativePath: 'TestProject/mprcontents/' + relPath, file: new File([b64ToBytes(sidecar[relPath])], relPath.split('/').pop()) };
      })
    );
    window.MxMprImport.handleEntries(entries);
    return true; })()`);
  await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Found App\\.mpr/.test(m.textContent); })()`, 8000, 'ready again');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Compare').click()`);
  await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Sales\\.Order_Customer/.test(m.textContent); })()`, 15000, 'diff again');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Replace model').click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.modal')`, 8000, 'modal closed after confirm'), 'confirming closes the modal');
  t.ok(await mx.waitFor(`/replaced from App\\.mpr/.test(document.body.textContent)`, 5000, 'success message'),
    'a plain success message says the model was replaced, and from which file');

  const newModel = await mx.evaluate(`MxStore.getModel('replace-target').then(m => m.entities.map(e => e.qualifiedName).sort())`);
  t.ok(JSON.stringify(newModel) === JSON.stringify(['Sales.Customer', 'Sales.Order']),
    'the stored model is now the new one: ' + JSON.stringify(newModel));

  await mx.close();
};
