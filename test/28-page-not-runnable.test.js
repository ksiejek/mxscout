/* A page is browsable, never runnable.
 *
 * MxScout used to offer "Open" on a page's popup, driving mx.ui.openForm from
 * the bridge. It does not any more: a page opens through the app's own
 * navigation, with the context that navigation built, and there is no
 * dependable way to do that from outside the client. What has to stay true is
 * that the popup still shows what the page takes and who may open it — and
 * that nothing on it can set the page off. */
'use strict';
const { openSeededProject, goToSection } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  // ---- the Pages screen (Karol, 2026-10-13: like the rest — the list, then the page on the right) ----
  await goToSection(mx, 'Pages', '.mf-mod-card, .mf-row');
  await mx.evaluate(`(function(){ var c = Array.from(document.querySelectorAll('.mf-mod-card')).find(function (x) { return /^Sales/.test(x.textContent); }); if (c) c.click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.mf-row')).find(n => /Order_Overview/.test(n.textContent))`, 8000, 'the page');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(n => /Order_Overview/.test(n.textContent)).click()`);
  const detail = await mx.waitFor(`(function(){ var d = document.querySelector('.mf-detail'); return d && /Order_Overview/.test(d.getAttribute('aria-label')) && d.textContent; })()`, 5000, 'page detail');
  t.ok(/Sales\.Agent/.test(detail) && /Order/.test(detail), 'the Pages screen shows who may open the page and what it takes, beside the list');
  const screenButtons = await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.mf-detail .mf-btn')).map(b => b.textContent))`);
  t.ok(!/Run|Open /.test(screenButtons), 'and nothing on it can set the page off: ' + screenButtons);

  // ---- its window, from the search with Shift ----
  await mx.evaluate(`window.MxPalette.open('Order_Overview')`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.palette-row')).find(r => r.querySelector('.palette-kind').textContent === 'Page')`, 5000, 'search');
  await mx.evaluate(`Array.from(document.querySelectorAll('.palette-row')).find(r => r.querySelector('.palette-kind').textContent === 'Page').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);

  const tabs = await mx.waitFor(`document.querySelectorAll('.popup-tab').length >= 2 && Array.from(document.querySelectorAll('.popup-tab')).map(t => t.textContent).join(',')`, 8000, 'page tabs');
  t.ok(tabs === 'Inputs,Comments', 'a page opens on Inputs — there is no Run tab: ' + tabs);

  const runText = await mx.evaluate(`document.querySelector('.flow-col-run').textContent`);
  t.ok(/Order/.test(runText), 'its inputs are still there to read');
  t.ok(/cannot open a page/.test(runText), 'and it says plainly that MxScout will not open it');

  const buttons = await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.modal button')).map(b => b.textContent))`);
  t.ok(!/Open |Run |Enable running flows|Choose…/.test(buttons), 'nothing on the popup can set the page off: ' + buttons);

  const sideText = await mx.evaluate(`document.querySelector('.flow-col-side').textContent`);
  t.ok(/Sales\.Agent/.test(sideText), 'who may open it is still beside the inputs');

  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.modal .popup-head-actions button')); b[b.length-1].click(); return true; })()`);
};
