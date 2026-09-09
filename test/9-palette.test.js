/* The command palette. Refactored into its own file with no behavioural cover
 * at all, which is the wrong order to do things in — so here it is.
 *
 * The thing worth protecting is the PATH: `/` starts one, each level offers
 * only what can follow, Tab commits a segment, and typing a name still finds
 * an object without walking there. */
'use strict';
const { openSeededProject } = require('./helpers');

function keydown(key, opts) {
  const o = Object.assign({ key: key, bubbles: true, cancelable: true }, opts || {});
  return 'document.dispatchEvent(new KeyboardEvent("keydown", ' + JSON.stringify(o) + '))';
}
function typeInto(value) {
  return '(function(){ var i = document.querySelector(".palette-input"); i.value = ' +
    JSON.stringify(value) + '; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()';
}
function inputKey(key) {
  return '(function(){ var i = document.querySelector(".palette-input");' +
    ' i.dispatchEvent(new KeyboardEvent("keydown", { key: ' + JSON.stringify(key) + ', bubbles: true, cancelable: true }));' +
    ' return true; })()';
}
const rows = `Array.from(document.querySelectorAll('.palette-row')).map(function (r) { return r.textContent; }).join(' | ')`;

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  // ---- opening ----
  await mx.evaluate(keydown('/'));
  t.ok(await mx.waitFor(`!!document.querySelector('.palette-input')`, 5000, 'palette'),
    'pressing / opens the palette');
  t.ok(await mx.evaluate(`document.querySelector('.palette-input').value`) === '/',
    'and starts a path with the slash already typed');

  await mx.evaluate(inputKey('Escape'));
  await new Promise((r) => setTimeout(r, 150));
  t.ok(await mx.evaluate(`!document.querySelector('.palette-input')`), 'Escape closes it');

  await mx.evaluate(keydown('k', { ctrlKey: true }));
  t.ok(await mx.waitFor(`!!document.querySelector('.palette-input')`, 5000, 'ctrl-k'),
    'Ctrl-K opens it too');
  t.ok(await mx.evaluate(`document.querySelector('.palette-input').value`) === '',
    'without a path — that one is for searching');

  // ---- the path ----
  await mx.evaluate(typeInto('/'));
  const projects = await mx.waitFor(`${rows}`, 5000, 'project rows');
  t.ok(/Demo/.test(projects), 'the first level of a path is projects: ' + projects);

  await mx.evaluate(typeInto('/Demo/'));
  const sections = await mx.waitFor(`/Entities/.test(${rows}) && ${rows}`, 5000, 'section rows');
  t.ok(/Entities/.test(sections) && /Microflows/.test(sections),
    'the next level is that project’s sections: ' + sections.slice(0, 90));
  t.ok(/Comments/.test(sections) && /Settings/.test(sections),
    'including the ones that are not model objects');

  await mx.evaluate(typeInto('/Demo/Entities/'));
  const modules = await mx.waitFor(`/Sales/.test(${rows}) && ${rows}`, 5000, 'module rows');
  t.ok(/Sales/.test(modules) && /Admin/.test(modules),
    'and below a section, the modules that have objects in it: ' + modules.slice(0, 80));

  // ---- Tab commits, Backspace climbs ----
  await mx.evaluate(typeInto('/Dem'));
  await mx.waitFor(`/Demo/.test(${rows})`, 5000, 'narrowed');
  await mx.evaluate(inputKey('Tab'));
  t.ok(await mx.waitFor(`document.querySelector('.palette-input').value === '/Demo/'`, 5000, 'tab committed'),
    'Tab commits the highlighted row into the path');

  await mx.evaluate(inputKey('Backspace'));
  t.ok(await mx.waitFor(`document.querySelector('.palette-input').value === '/'`, 5000, 'climbed'),
    'Backspace at the end of a committed segment climbs back a level');

  // ---- flat search still works ----
  await mx.evaluate(typeInto('Order'));
  const found = await mx.waitFor(`/Order/.test(${rows}) && ${rows}`, 5000, 'flat search');
  t.ok(/Order/.test(found), 'typing a name searches flat, without walking a path: ' + found.slice(0, 80));

  // ---- and it actually navigates ----
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.palette-row')).find(function (x) { return /Sales\\.Order|Order/.test(x.textContent); }); r.click(); return true; })()`);
  t.ok(await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'landed'),
    'choosing an entity lands ON it — the popup opens, not just the list');
  t.ok(await mx.evaluate(`!document.querySelector('.palette-input')`),
    'and the palette closes behind it');

  // A microflow must land in ITS popup, which is what a comment link relies on.
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab, .modal button')).find(function (b) { return b.textContent === 'Close'; }).click()`);
  await new Promise((r) => setTimeout(r, 200));
  await mx.evaluate(keydown('/'));
  await mx.waitFor(`!!document.querySelector('.palette-input')`, 5000, 'reopened');
  await mx.evaluate(typeInto('CancelOrder'));
  await mx.waitFor(`/CancelOrder/.test(${rows})`, 5000, 'mf row');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.palette-row')).find(function (x) { return /CancelOrder/.test(x.textContent); }); r.click(); return true; })()`);
  const flowTabs = await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2 && Array.from(document.querySelectorAll('.popup-tab')).map(function (x) { return x.textContent; }).join(',')`, 8000, 'flow popup');
  t.ok(flowTabs === 'Run,Comments', 'and a microflow lands in its own popup: ' + flowTabs);

  t.ok(await mx.evaluate(`typeof window.MxPalette === 'object' && typeof window.MxPalette.render === 'function'`),
    'the palette is its own module now, reached through one named surface');

  await mx.close();
};
