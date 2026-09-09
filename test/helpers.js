/* Getting a browser tab to the state every bridge test starts from: a project
 * seeded, an approved environment, and the entity popup open on its Data tab. */
'use strict';
const MODEL = require('./model');

async function openSeededProject(t, appUrl) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');

  // Straight into IndexedDB. The import path has its own concerns; these tests
  // are about the bridge, and driving a file picker to get here would make
  // every one of them fail for the wrong reason.
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Demo')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Demo'); e[e.length-1].click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 700));

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /Live/i.test(n.textContent))[0].click()`);
  await mx.waitFor('!!document.querySelector(".live-url-input")', 10000, 'live tab');
  await mx.evaluate(`(function(){
    var i = document.querySelector('.live-url-input');
    i.value = ${JSON.stringify(appUrl)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Check')[0].click();
    return true; })()`);
  await mx.waitFor(`!!document.querySelector('.live-status-ok')`, 8000, 'environment approved');
  return mx;
}

async function openEntityPopup(mx) {
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('*')).find(n => n.textContent.trim() === 'Order')`, 8000, 'entity list');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(e => e.textContent.indexOf('Sales.Order') !== -1 || e.textContent.trim() === 'Order');
    n[n.length-1].click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'popup tabs');
}

function clickTab(name) {
  return `Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === ${JSON.stringify(name)})[0].click()`;
}

module.exports = { openSeededProject, openEntityPopup, clickTab };
