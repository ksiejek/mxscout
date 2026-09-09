/* The banner under the current screen (state.message in app.js, rendered as
 * .content-wrap > .msg) used to sit there until some later action happened
 * to call setMessage(null) — which meant "Project updated" or "Your name is
 * set to X" followed you from page to page indefinitely, since switching
 * sections (goToSection) never cleared it. A success message is a
 * notification about what just happened, not a standing fact about the
 * screen, so it now clears itself a few seconds after it appears — an error
 * does not, since that one is asking the user to actually do something about
 * it. Also checks that the "…or just the .mpr file" link is gone from the
 * project-folder picker (public/mprImport.js): the folder pick already
 * covers a single loose .mpr file (drop it on the same box), so a second,
 * confusingly-worded path to the same place was one option too many — see
 * mprImport.js's own comment on the same line for the fuller reasoning. */
'use strict';

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === '+ New project')`, 10000, 'list screen');

  // ---- an 'ok' message clears itself, without navigating away ----
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === '+ New project').click()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'new project card');
  await mx.evaluate(`(function(){
    var evt = new Event('drop', { bubbles: true, cancelable: true });
    evt.dataTransfer = { files: [new File([JSON.stringify({ modules: [{ name: 'M' }], entities: [], associations: [], userRoles: [], microflows: [], nanoflows: [], pages: [] })], 'auto-dismiss-model.json')] };
    document.querySelector('.file-drop').dispatchEvent(evt);
    return true; })()`);
  await mx.waitFor(`document.querySelector('.file-drop').textContent.indexOf('auto-dismiss-model') !== -1`, 5000, 'file picked');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'Create project').click()`);
  const okMsg = await mx.waitFor(`(function(){ var m = document.querySelector('.content-wrap > .msg.ok'); return m && m.textContent; })()`, 8000, 'success message');
  t.ok(/created/.test(okMsg), 'creating the project shows a plain success message: ' + okMsg);

  t.ok(await mx.evaluate(`!!document.querySelector('.content-wrap > .msg.ok')`), 'and it is still there right after appearing');
  t.ok(await mx.waitFor(`!document.querySelector('.content-wrap > .msg')`, 6000, 'message gone'),
    'but it clears itself a few seconds later, on its own — no click, no navigation needed');

  // ---- an 'error' message does NOT auto-dismiss — it is asking for a fix ----
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === '+ New project').click()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'new project card again');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'Create project').click()`);
  const errMsg = await mx.waitFor(`(function(){ var m = document.querySelector('.content-wrap > .msg.error'); return m && m.textContent; })()`, 5000, 'validation error');
  t.ok(/Give the project a name first/.test(errMsg), 'submitting with nothing filled in shows the validation error: ' + errMsg);
  await new Promise((r) => setTimeout(r, 5000));
  t.ok(await mx.evaluate(`!!document.querySelector('.content-wrap > .msg.error')`),
    'unlike a success message, an error stays put — it names something to fix, not something that already happened');

  // ---- the confusing alt-link is gone from the folder-pick screen ----
  await mx.evaluate(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'Cancel');
    if (b) b.click();
    return true; })()`);
  await mx.evaluate(`window.MxMprImport.open()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'import modal open');
  const pickText = await mx.evaluate(`document.body.textContent`);
  t.ok(!/or just the \.mpr file/.test(pickText), 'the folder-pick screen no longer offers a separately-worded single-file path: ' + pickText.slice(0, 120));
  t.ok(/Choose the project folder/.test(pickText), 'the one clear primary action is still there');
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.modal button')).find(x => x.textContent === 'Cancel'); if (b) b.click(); return true; })()`);

  await mx.close();
};
