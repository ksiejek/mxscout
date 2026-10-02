/* The App Explorer — the project drawn as its own tree.
 *
 * What this has to get right is mostly about honesty rather than layout:
 *   - a document of a kind MxScout does not model is SHOWN, with its kind, and
 *     is not clickable — because absent looks exactly like "not in the
 *     project", and a dead link looks exactly like a bug;
 *   - an empty folder is shown (it is how a team writes down a module
 *     version), but gets no disclosure arrow, because it discloses nothing;
 *   - a model with no tree in it — a JSON import, or anything stored before
 *     MxScout read folders — says so instead of rendering an empty project;
 *   - opening a microflow from here is an ASIDE: closing it leaves the tree
 *     exactly as it was, branches and all.
 *
 * The model below is the shared one plus a tree, so the microflow the tree
 * opens is a real one with a real popup behind it. */
'use strict';
const BASE = require('./model');

function doc(module, path, name, type, kind) {
  return { module: module, name: name, qualifiedName: module + '.' + name, type: type, kind: kind, path: path };
}

const MODEL = Object.assign({}, BASE, {
  folders: [
    { module: 'Sales', name: 'Orders', path: [] },
    { module: 'Sales', name: 'Export/Import', path: ['Orders'] },
    { module: 'Sales', name: '#v1.0.0', path: [] },
    { module: 'Admin', name: 'Timeline', path: [] }
  ],
  documents: [
    doc('Admin', ['Timeline'], 'SNIP_Timeline', 'Forms$Snippet', 'snippet'),
    doc('Sales', [], 'MaxOrders', 'Constants$Constant', 'constant'),
    doc('Sales', [], 'SendMail', 'JavaActions$JavaAction', 'Java action'),
    doc('Sales', ['Orders'], 'CancelOrder', 'Microflows$Microflow', 'microflow'),
    doc('Sales', ['Orders'], 'Order_Overview', 'Forms$Page', 'page'),
    doc('Sales', ['Orders', 'Export/Import'], 'OrderExport', 'ExportMappings$ExportMapping', 'export mapping')
  ]
});

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');

  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'tree-p', name: 'TreeProj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(MODEL)});
    await MxStore.saveProjectWithModel(
      { id: 'flat-p', name: 'FlatProj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(BASE)});
    return true;
  })()`);

  async function openProject(name) {
    await mx.navigate(t.MX);
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-project')).find(b => b.textContent.trim() === '${name}')`, 10000, name);
    await mx.evaluate(`Array.from(document.querySelectorAll('.tree-project')).find(b => b.textContent.trim() === '${name}').click()`);
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /App Explorer/.test(b.textContent))`, 8000, 'sections');
    await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(b => /App Explorer/.test(b.textContent)).click()`);
  }
  // The rows on screen, in order, as "class | text" — the whole tree in one
  // string, so every assertion below reads against the same picture.
  const rows = () => mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.ex-row')).map(function (r) {
    return r.className.replace('ex-row ', '') + ' | ' + r.textContent;
  }))`).then(JSON.parse);
  const clickRow = (sel, text) => mx.evaluate(`(function(){
    var row = Array.from(document.querySelectorAll('${sel}')).filter(function (r) { return r.textContent.indexOf(${JSON.stringify(text)}) !== -1; })[0];
    if (!row) return false;
    row.click();
    return true;
  })()`);

  await openProject('TreeProj');
  await mx.waitFor(`!!document.querySelector('.ex-tree')`, 8000, 'the tree');

  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(b => /App Explorer/.test(b.textContent)).textContent`) === 'App Explorer6',
    'the sidebar counts documents, which is more than the three kinds MxScout models');

  const collapsed = await rows();
  t.ok(collapsed.length === 3 && collapsed.every(function (r) { return /^ex-module \|/.test(r); }),
    'it opens collapsed: one row per module, nothing expanded: ' + JSON.stringify(collapsed));
  t.ok(/Sales5 documents/.test(collapsed[1]),
    'with the count of what is inside, folders and all: ' + collapsed[1]);
  // System is MxScout's own addition — it is in no .mpr, because it ships with
  // the Mendix Runtime — so it has no documents and must not pretend to. A
  // module with a domain model and nothing else is exactly what it is.
  t.ok(/System0 documents/.test(collapsed[2]),
    'including the built-in System module, carrying the nothing it really has: ' + collapsed[2]);

  t.ok(await clickRow('button.ex-module', 'Sales'), 'a module expands');
  const level1 = await rows();
  t.ok(JSON.stringify(level1.map(function (r) { return r.split(' | ')[0]; })) ===
    JSON.stringify(['ex-module', 'ex-module open', 'ex-domain', 'ex-folder', 'ex-folder ex-folder-empty',
      'ex-doc ex-doc-flat', 'ex-doc ex-doc-flat', 'ex-module']),
    'folders come before the documents beside them, and the domain model before both: ' + JSON.stringify(level1));
  t.ok(/Domain model3 entities/.test(level1[2]),
    'a module leads with its domain model, the one child here that is not a document: ' + level1[2]);

  // ---- a kind MxScout does not model ----
  t.ok(level1.some(function (r) { return /ex-doc-flat \| SendMailJava action/.test(r); }),
    'a Java action is on the tree with its kind on it: ' + JSON.stringify(level1.filter(function (r) { return /SendMail/.test(r); })));
  t.ok(await mx.evaluate(`(function(){
    var row = Array.from(document.querySelectorAll('.ex-doc-flat')).filter(function (r) { return /SendMail/.test(r.textContent); })[0];
    return row.tagName + '|' + (row.getAttribute('title') || '');
  })()`) === 'DIV|MxScout read this document’s name and the flows and pages it mentions. It does not model what is inside a Java action, so there is nothing to open.',
    'and it is not a button — it says how far MxScout read it instead of offering a window it does not have');

  // ---- the empty folder ----
  const emptyRow = level1.filter(function (r) { return /#v1\.0\.0/.test(r); })[0];
  t.ok(/ex-folder-empty \| #v1\.0\.0empty/.test(emptyRow),
    'a folder with nothing in it is still drawn, and says so: ' + emptyRow);
  t.ok(await mx.evaluate(`(function(){
    var row = Array.from(document.querySelectorAll('.ex-folder-empty'))[0];
    return row.tagName + '|' + row.querySelectorAll('.ex-chev.open').length + '|' + row.querySelector('.ex-chev').textContent;
  })()`) === 'DIV|0|',
    'with no disclosure arrow and nothing to click — it discloses nothing');

  // ---- nesting, and the slash that is part of a name ----
  await clickRow('button.ex-folder', 'Orders');
  const level2 = await rows();
  t.ok(level2.some(function (r) { return /ex-folder \| .*Export\/Import1 document/.test(r); }),
    'a folder inside a folder opens with its own count: ' + JSON.stringify(level2.filter(function (r) { return /Export/.test(r); })));
  await clickRow('button.ex-folder', 'Export/Import');
  const level3 = await rows();
  const depths = await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.ex-row')).map(function (r) {
    return r.textContent.slice(0, 14) + '=' + getComputedStyle(r).paddingLeft;
  }))`).then(JSON.parse);
  t.ok(level3.some(function (r) { return /ex-doc ex-doc-flat \| OrderExportexport mapping/.test(r); }),
    'and what is inside it appears, kind and all: ' + JSON.stringify(level3.filter(function (r) { return /OrderExport/.test(r); })));
  t.ok(depths.filter(function (d) { return /OrderExport/.test(d); })[0].indexOf('=80px') !== -1,
    'each level is one indent further in, from the depth rather than from a class per level: ' + JSON.stringify(depths));

  // ---- the filter opens what it finds ----
  await mx.evaluate(`(function(){
    var input = document.querySelector('.filter-input');
    input.value = 'snip';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const found = await rows();
  t.ok(JSON.stringify(found.map(function (r) { return r.split(' | ')[1]; })) ===
    JSON.stringify(['›Admin1 document', 'Domain model1 entity', '›Timeline1 document', 'SNIP_Timelinesnippet']),
    'typing opens whatever still has something in it, folders included, and drops the rest: ' + JSON.stringify(found));
  t.ok(/1 of 6 documents match, in 1 module\./.test(await mx.evaluate(`document.querySelector('.ex-hint').textContent`)),
    'and the line above counts the matches rather than the project: ' + await mx.evaluate(`document.querySelector('.ex-hint').textContent`));
  t.ok(await mx.evaluate(`document.activeElement.className`) === 'filter-input',
    'the caret stays in the filter box while the tree is rebuilt under it');

  await mx.evaluate(`(function(){
    var input = document.querySelector('.filter-input');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const cleared = await rows();
  t.ok(cleared.filter(function (r) { return /ex-module open/.test(r); }).length === 1 &&
    /Sales/.test(cleared.filter(function (r) { return /ex-module open/.test(r); })[0]),
    'clearing it puts the tree back the way the reader left it, not the way the search left it: ' + JSON.stringify(cleared));

  // ---- opening a document is an aside ----
  const openRowsBefore = (await rows()).length;
  t.ok(await clickRow('button.ex-doc', 'CancelOrder'), 'a microflow in the tree is clickable');
  t.ok(await mx.waitFor(`!!document.querySelector('.popup-head')`, 5000, 'popup'),
    'and opens its own window');
  await mx.evaluate(`(function(){
    var close = Array.from(document.querySelectorAll('button')).filter(function (b) { return b.textContent.trim() === 'Close'; })[0];
    if (close) close.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  await mx.waitFor(`!document.querySelector('.popup-head')`, 5000, 'closed');
  t.ok((await rows()).length === openRowsBefore,
    'closing it leaves the tree exactly as it was — the branches are the reader’s work, not something to redo');

  // ---- the domain model row goes to the entities, scoped ----
  t.ok(await clickRow('button.ex-domain', 'Domain model'), 'the domain model row is clickable');
  await mx.waitFor(`!!document.querySelector('.entity-card')`, 5000, 'entities');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.module-group-name')).map(function (n) { return n.textContent; }).join(',')`) === 'Sales',
    'and lands on that module’s entities rather than on all of them');

  // ---- a model with no tree says so ----
  await openProject('FlatProj');
  await mx.waitFor(`!!document.querySelector('.view-body')`, 8000, 'the view');
  const flat = await mx.evaluate(`document.querySelector('.view-body').textContent`);
  t.ok(/does not carry the project tree/.test(flat) && /Replace model/.test(flat),
    'a model with no tree in it explains itself and says what to do: ' + flat);
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(b => /App Explorer/.test(b.textContent)).textContent`) === 'App Explorer',
    'and the sidebar shows no number beside it — no list is not a count of zero');

  await mx.close();
};
