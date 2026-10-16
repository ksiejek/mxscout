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

  // ---- typing a name: results grouped by kind, as the documentation's search (Karol, 2026-10-13) ----
  await mx.evaluate(typeInto(''));
  t.ok(await mx.waitFor(`!!document.querySelector('.palette-empty') && /Type a name/.test(document.querySelector('.palette-empty').textContent) && !document.querySelector('.palette-row')`, 5000, 'hint'),
    'an empty search says what to type instead of listing everything');
  await mx.evaluate(typeInto('ORDER'));
  const found = await mx.waitFor(`/Order/.test(${rows}) && ${rows}`, 5000, 'search');
  t.ok(/Order/.test(found), 'typing a name searches without walking a path, whatever its case: ' + found.slice(0, 80));
  const groups = await mx.evaluate(`Array.from(document.querySelectorAll('.palette-group')).map(function (g) { return g.textContent; }).join('|')`);
  t.ok(/^Microflows\d+\|Pages\d+\|Entities\d+$/.test(groups), 'grouped by kind, each with its count, in a fixed order: ' + groups);
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.palette-row mark')).every(function (m) { return m.textContent.toLowerCase() === 'order'; }) && document.querySelectorAll('.palette-row mark').length > 0`), 'the match is marked in each name');
  t.ok(/result/.test(await mx.evaluate(`document.querySelector('.palette-total').textContent`)), 'and the footer counts the results');

  // Typing and moving the highlight draw the palette, not the screen under it: on a large model that
  // screen cost more per keystroke than the search did.
  await mx.evaluate(`(function(){ window.__under = document.querySelector('.main'); window.__pal = document.querySelector('.palette-backdrop'); return true; })()`);
  await mx.evaluate(typeInto('ORDE'));
  await mx.evaluate(inputKey('ArrowDown'));
  const kept = JSON.parse(await mx.evaluate(`JSON.stringify({ under: document.querySelector('.main') === window.__under, pal: document.querySelector('.palette-backdrop') !== window.__pal,
    one: document.querySelectorAll('.palette-backdrop').length, active: Array.from(document.querySelectorAll('.palette-row')).indexOf(document.querySelector('.palette-row.active')),
    focus: document.activeElement === document.querySelector('.palette-input'), value: document.querySelector('.palette-input').value })`));
  t.ok(kept.under && kept.pal && kept.one === 1 && kept.active === 1 && kept.focus && kept.value === 'ORDE',
    'typing and the arrows redraw the palette alone, keep the screen under it, and keep the focus in the field: ' + JSON.stringify(kept));
  await mx.evaluate(typeInto('ORDER'));
  await mx.waitFor(`/Order/.test(${rows})`, 5000, 'search again');

  // ---- and it actually navigates ----
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.palette-row')).find(function (x) { return x.querySelector('.palette-kind').textContent === 'Entity' && /Order/.test(x.textContent); }); r.click(); return true; })()`);
  t.ok(await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'landed'),
    'choosing an entity lands ON it — the popup opens, not just the list');
  t.ok(await mx.evaluate(`!document.querySelector('.palette-input')`),
    'and the palette closes behind it');

  // A microflow, a nanoflow or a page is its own screen: the palette goes there, with it chosen, and opens no popup.
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab, .modal button')).find(function (b) { return b.textContent === 'Close'; }).click()`);
  await new Promise((r) => setTimeout(r, 200));
  await mx.evaluate(keydown('/'));
  await mx.waitFor(`!!document.querySelector('.palette-input')`, 5000, 'reopened');
  await mx.evaluate(typeInto('CancelOrder'));
  await mx.waitFor(`/CancelOrder/.test(${rows})`, 5000, 'mf row');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.palette-row')).find(function (x) { return /CancelOrder/.test(x.textContent); }); r.click(); return true; })()`);
  const flowHead = await mx.waitFor(`(function(){ var d = document.querySelector('.mf-detail'); return d && d.getAttribute('aria-label'); })()`, 8000, 'the microflow');
  const flowScreen = JSON.parse(await mx.evaluate(`JSON.stringify({ popup: !!document.querySelector('.modal-detail'), on: (document.querySelector('.mf-row.on .mf-row-name') || {}).textContent })`));
  t.ok(flowHead === 'Selected microflow: CancelOrder' && !flowScreen.popup && flowScreen.on === 'CancelOrder',
    'and a microflow lands on the Microflows screen, chosen in its list, with no popup: ' + flowHead + ' ' + JSON.stringify(flowScreen));

  // With Shift it opens in a window over the screen instead, for a look that keeps your place.
  await mx.evaluate(keydown('/'));
  await mx.waitFor(`!!document.querySelector('.palette-input')`, 5000, 'reopened');
  await mx.evaluate(typeInto('CancelOrder'));
  await mx.waitFor(`/CancelOrder/.test(${rows})`, 5000, 'mf row');
  await mx.evaluate(`Array.from(document.querySelectorAll('.palette-row')).find(function (x) { return /CancelOrder/.test(x.textContent); }).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
  const peekHead = await mx.waitFor(`(function(){ var h = document.querySelector('.modal-detail .popup-head p'); return h && h.textContent; })()`, 8000, 'flow popup');
  t.ok(peekHead === 'Sales.CancelOrder · microflow', 'and with Shift it opens in a window over the screen instead: ' + peekHead);
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab, .modal button')).find(function (b) { return b.textContent === 'Close'; }).click()`);

  // A page, too: the Pages screen, the page chosen.
  await mx.evaluate(keydown('/'));
  await mx.waitFor(`!!document.querySelector('.palette-input')`, 5000, 'reopened');
  await mx.evaluate(typeInto('Order_Overview'));
  const pageRow = await mx.waitFor(`Array.from(document.querySelectorAll('.palette-row')).some(function (x) { return x.querySelector('.palette-kind').textContent === 'Page'; })`, 5000, 'page row');
  if (pageRow) {
    await mx.evaluate(`Array.from(document.querySelectorAll('.palette-row')).find(function (x) { return x.querySelector('.palette-kind').textContent === 'Page'; }).click()`);
    const pageHead = await mx.waitFor(`(function(){ var d = document.querySelector('.mf-detail'); return d && /^Selected page/.test(d.getAttribute('aria-label')) && d.getAttribute('aria-label'); })()`, 8000, 'the page');
    t.ok(pageHead === 'Selected page: Order_Overview' && !(await mx.evaluate(`!!document.querySelector('.modal-detail')`)),
      'and a page lands on the Pages screen, with no popup: ' + pageHead);
  } else t.ok(false, 'the seeded project offers its page Order_Overview in the palette');

  t.ok(await mx.evaluate(`typeof window.MxPalette === 'object' && typeof window.MxPalette.render === 'function'`),
    'the palette is its own module now, reached through one named surface');

  await mx.close();
};
