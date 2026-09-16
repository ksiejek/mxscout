/* The copy control in the recording setup (ROADMAP step 63).
 *
 * "Copied." used to be written once into a span beside the button, with no
 * timer: it then sat there unchanged for the rest of the session, saying
 * nothing about whether the last press had worked. The answer belongs on the
 * button the user pressed, and it has to end.
 *
 * The clipboard itself is not what is under test and cannot be: a headless
 * tab has no focus, so navigator.clipboard.writeText rejects. That rejection
 * is useful — it exercises the failure branch for real — and the success
 * branch is exercised by standing the clipboard call down to a resolved
 * promise, which leaves this file testing the feedback logic rather than the
 * browser's permission model. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');

  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'copy-p', name: 'CopyProj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'CopyProj')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'CopyProj'); e[e.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Performance')`, 8000, 'project open');
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Performance')[0].click()`);
  await mx.waitFor(`!!document.querySelector('.live-url-input')`, 10000, 'setup step 1');

  // Step 2 is where the PowerShell script and its copy button live, and it is
  // one reachable address away.
  await mx.evaluate(`(function(){
    var i = document.querySelector('.live-url-input');
    i.value = ${JSON.stringify(t.ADMIN)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Continue')[0].click();
    return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Copy the code')`, 10000, 'step 2, with the copy button');

  // ---------- the failure branch, for real ----------
  await mx.evaluate(`(function(){ Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Copy the code').click(); return true; })()`);
  const failNote = await mx.waitFor(`(function(){
    var p = Array.from(document.querySelectorAll('p[role=status]')).map(function(n){ return n.textContent; }).filter(Boolean).join(' ');
    return /select the text/.test(p) ? p : null;
  })()`, 6000, 'the fallback instruction');
  t.ok(/Could not copy automatically/.test(failNote),
    'a clipboard the browser refuses gets an instruction the reader can act on: ' + failNote);
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Copy the code')`) === true,
    'and the button keeps its label, because nothing was copied');

  // ---------- the success branch ----------
  await mx.evaluate(`(function(){
    window.__origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = function(){ return Promise.resolve(); };
    Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === 'Copy the code'; }).click();
    return true; })()`);
  t.ok(await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === 'Copied.'; })`, 3000, 'the button says Copied.'),
    'the answer lands on the button that was pressed, not in a span beside it');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('p[role=status]')).every(function(n){ return !/select the text/.test(n.textContent); })`) === true,
    'and a success clears the failure left over from the attempt before it');

  t.ok(await mx.waitFor(`!Array.from(document.querySelectorAll('button')).some(function(b){ return b.textContent.trim() === 'Copied.'; })`, 6000, 'the label goes back'),
    'and it ends: "Copied." does not outlive the press that earned it');

  await mx.evaluate(`(function(){ navigator.clipboard.writeText = window.__origWrite; return true; })()`);
};
