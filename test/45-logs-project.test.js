/* Log analysis as a section of a project: the log read against its own model.
 *
 * What this has to get right: with a project open the screen is the project's Logs section (and the model-less
 * Tools entry steps aside); a warning or error that names a microflow or entity of THAT project says so and
 * opens it over the log; and "Report" starts a comment on it with the log lines already written — saved only
 * when the reader saves it, and then it is an ordinary comment on that object. */
'use strict';
const MODEL = require('./model');

const LOG = [
  '2026-07-18 09:00:00.100 [runtime-container/abc]   INFO - Core: Mendix Runtime started',
  "2026-07-18 09:00:01.200 [runtime-container/abc]  ERROR - MicroflowEngine: An error occurred in microflow 'Sales.CancelOrder': Something broke\n\tat com.mendix.A.run(A.java:10)",
  "2026-07-18 09:00:02.300 [runtime-container/abc]  ERROR - MicroflowEngine: An error occurred in microflow 'Sales.CancelOrder': Something broke again",
  "2026-07-18 09:00:03.400 [runtime-container/abc]   WARN - ConnectionBus_Queries: Query executed in 2 seconds and 150 milliseconds: SELECT \"sales$order\".\"id\" FROM \"sales$order\" WHERE \"sales$order\".\"x\" = 5",
  "2026-07-18 09:00:04.500 [runtime-container/abc]   INFO - Core: Sales.CancelOrder mentioned at INFO level only"
].join('\n') + '\n';

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxLogs', 15000, 'MxScout loaded');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'pl', name: 'LogDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null }, ${JSON.stringify(MODEL)});
    return true; })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'LogDemo')`, 10000, 'project in sidebar');
  const btn = (re) => `Array.from(document.querySelectorAll('button')).filter(b => ${re}.test(b.textContent.trim()))`;

  await mx.evaluate(`(Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All projects') || { click() {} }).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Log analysis')`, 5000, 'tools entry');
  // No project open: the Tools entry is there. With one open it is the project's section instead.
  t.ok(await mx.evaluate(`${btn(/^Log analysis$/)}.length === 1`), 'with no project open, Log analysis is offered under Tools');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'LogDemo').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(n => /^Logs/.test(n.textContent))`, 10000, 'Logs section');
  t.ok(await mx.evaluate(`${btn(/^Log analysis$/)}.length === 0`), 'with a project open the Tools entry steps aside');
  await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(n => /^Logs/.test(n.textContent)).click()`);
  await mx.waitFor(`!!document.querySelector('.lg')`, 8000, 'log screen');
  t.ok(/LogDemo/.test(await mx.evaluate(`document.querySelector('.lg-head-project').textContent`)), 'the screen says which project it is read against');
  t.ok(await mx.evaluate(`!!document.querySelector('.tree-section.active') && /^Logs/.test(document.querySelector('.tree-section.active').textContent)`), 'and the section is highlighted in the project');

  await mx.evaluate(`MxLogs.tools['log-viewer'].loadFiles([new File([${JSON.stringify(LOG)}], 'app.log')])`);
  await mx.waitFor(`document.querySelectorAll('.lg-row').length >= 4`, 10000, 'rows');

  // Errors and warnings that name a model object carry chips; the INFO line that names one does not.
  const chips = await mx.evaluate(`Array.from(document.querySelectorAll('.lg-row')).map(r => ({ text: r.textContent.slice(0, 40), names: Array.from(r.querySelectorAll('.lg-mname')).map(n => n.textContent) }))`);
  t.ok(chips.filter((r) => r.names.indexOf('Sales.CancelOrder') !== -1).length === 2, 'both errors naming Sales.CancelOrder carry its chip: ' + JSON.stringify(chips));
  t.ok(chips.some((r) => r.names.indexOf('Sales.Order') !== -1), 'a table in a warning (sales$order) resolves to the entity Sales.Order');
  t.ok(!chips.some((r) => /INFO level only/.test(r.text) && r.names.length), 'a quiet INFO line is not decorated');

  // The In your model tab groups them.
  await mx.evaluate(`Array.from(document.querySelectorAll('.lg-tab')).find(b => /In your model/.test(b.textContent)).click()`);
  const cards = await mx.evaluate(`Array.from(document.querySelectorAll('.lg-model-card')).map(c => c.querySelector('.lg-mname').textContent + ' | ' + c.querySelector('.lg-model-counts').textContent)`);
  t.ok(cards.length === 2 && /^Sales\.CancelOrder \| 2 errors/.test(cards[0]), 'the tab ranks objects by their errors: ' + JSON.stringify(cards));

  // Open: the microflow opens as an aside over the log; closing it leaves the log where it was.
  await mx.evaluate(`document.querySelector('.lg-model-card .lg-mname').click()`);
  await mx.waitFor(`/Can be triggered by/.test(document.body.innerText)`, 8000, 'microflow popup');
  t.ok(/Sales\.CancelOrder · microflow/.test(await mx.evaluate(`document.body.innerText`)) && await mx.evaluate(`!!document.querySelector('.lg')`), 'Open shows the microflow over the log');
  await mx.evaluate(`(document.querySelector('.popup-close, .modal-close') || Array.from(document.querySelectorAll('button')).find(b => /^(Close|×|✕)$/.test(b.textContent.trim()))).click()`);
  await new Promise((r) => setTimeout(r, 400));
  t.ok(await mx.evaluate(`!!document.querySelector('.lg-model-card')`), 'closing it puts the reader back on the log');

  // Report: a comment on that microflow with the lines already in it.
  await mx.evaluate(`document.querySelector('.lg-model-card .lg-mflag').click()`);
  await mx.waitFor(`!!document.querySelector('.editor')`, 8000, 'comment editor');
  const draft = await mx.evaluate(`({ target: document.querySelector('.editor-target-name').textContent, problem: document.querySelector('.editor-area').value, sev: document.querySelector('.editor select').value })`);
  t.ok(draft.target === 'Sales.CancelOrder', 'the comment is on the microflow: ' + draft.target);
  t.ok(/Something broke/.test(draft.problem) && /2 errors/.test(draft.problem) && draft.sev === 'high', 'with the log lines already written and a severity from the level');
  t.ok(await mx.evaluate(`window.MxComments.countFor('pl') === 0`), 'nothing is saved until the reader saves');
  await mx.evaluate(`Array.from(document.querySelectorAll('.editor button')).find(b => /Save comment/.test(b.textContent)).click()`);
  await mx.waitFor(`window.MxComments.countFor('pl') === 1`, 5000, 'saved');
  t.ok(await mx.evaluate(`MxComments.findingsFor('Sales.CancelOrder').length === 1 && /Something broke/.test(MxComments.findingsFor('Sales.CancelOrder')[0].problem)`), 'it is saved as an ordinary comment on Sales.CancelOrder');
  t.ok(await mx.evaluate(`!!document.querySelector('.lg')`), 'and the reader is still on the log');

  // Leaving the project withdraws the model: the same screen, without links.
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'All projects').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'Log analysis')`, 5000, 'tools entry back');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'Log analysis').click()`);
  await mx.waitFor(`!!document.querySelector('.lg')`, 5000, 'standalone');
  t.ok(await mx.evaluate(`window.MxLogs.model === null && document.querySelector('.lg-head-project').hidden`), 'with no project the log tools keep working but name nothing in a model');
  await mx.close();
};
