/* A page is browsable, never runnable.
 *
 * MxScout used to offer "Open" on a page's popup, driving mx.ui.openForm from
 * the bridge. It does not any more: a page opens through the app's own
 * navigation, with the context that navigation built, and there is no
 * dependable way to do that from outside the client. What has to stay true is
 * that the popup still shows what the page takes and who may open it — and
 * that nothing on it can set the page off. */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Pages/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'page list');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.flow-card')).find(n => /Order_Overview/.test(n.textContent)); r.click(); return true; })()`);

  const tabs = await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2 && Array.from(document.querySelectorAll('.popup-tab')).map(t => t.textContent).join(',')`, 8000, 'page tabs');
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
