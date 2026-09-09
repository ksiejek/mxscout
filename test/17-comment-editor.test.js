/* The comment editor drawer is opened from on top of an entity or flow
 * popup, which is itself on top of the page. A validation error and a
 * save/update confirmation show INSIDE the drawer itself — the app-wide
 * message banner renders in the page underneath both overlays, so routed
 * there they'd be invisible until both were closed by hand. Delete is the
 * exception: there is nothing left to look at once the comment is gone, so
 * it closes the drawer immediately and reports through that same page-level
 * banner instead of lingering on a confirmation. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');

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

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('*')).find(n => n.textContent.trim() === 'Order')`, 8000, 'entity list');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(e => e.textContent.indexOf('Sales.Order') !== -1 || e.textContent.trim() === 'Order');
    n[n.length-1].click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'entity popup open');

  // Writing a comment happens from the object's own window and nowhere
  // else — the browsing lists carry a marker that comments exist, but no
  // button that writes one.
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.entity-card button, .flow-card button')).some(b => /Comment/.test(b.textContent))`),
    'no comment can be written straight from a browsing card');
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-head-actions button')).find(b => b.textContent === '+ Comment').click()`);
  await mx.waitFor(`!!document.querySelector('.editor-backdrop')`, 5000, 'editor open');
  t.ok(await mx.evaluate(`document.querySelectorAll('.popup-tab').length === 3`),
    'the entity popup stays open underneath the comment editor');

  // ---- validation error: must show INSIDE the editor, not on the page ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.editor-foot button')).find(b => /Save comment/.test(b.textContent)).click()`);
  const errText = await mx.waitFor(`(function(){ var m = document.querySelector('.editor .msg.error'); return m && m.textContent; })()`, 5000, 'inline validation error');
  t.ok(/needs at least a problem/.test(errText), 'a missing problem is reported inside the editor drawer: ' + errText);
  t.ok(await mx.evaluate(`!document.querySelector('.content-wrap > .msg')`),
    'and NOT as the page-level message banner, which would be hidden behind the popup and the drawer');

  // ---- adding a comment CLOSES the window ----
  // A new comment is done once it is saved: the drawer closes rather than
  // lingering with a confirmation the writer then has to dismiss.
  await mx.evaluate(`(function(){ var a = document.querySelector('.editor-area'); a.value = 'Anyone can read this without a role'; a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.editor-foot button')).find(b => /Save comment/.test(b.textContent)).click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.editor-backdrop')`, 5000, 'editor closed after add'),
    'adding a comment closes the editor window');
  t.ok(await mx.evaluate(`document.querySelectorAll('.popup-tab').length === 3`),
    'and drops back to the entity popup underneath');

  // ---- the object's Comments tab shows the whole comment, and edits it ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).find(t => t.textContent === 'Comments').click()`);
  const row = await mx.waitFor(`(function(){ var r = document.querySelector('.popup-comment-list .comment-row'); return r && r.textContent; })()`, 5000, 'full comment row in popup');
  t.ok(/Anyone can read this without a role/.test(row), 'the object’s Comments tab shows the full comment, not a stripped one-liner: ' + row);
  t.ok(await mx.evaluate(`!!document.querySelector('.popup-comment-list .comment-row select.comment-status')`),
    'the popup row carries the full controls (status), same as the Comments page');

  // Edit from the popup row keeps the editor open with its confirmation.
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-comment-list .comment-row button')).find(b => b.textContent.trim() === 'Edit').click()`);
  await mx.waitFor(`!!document.querySelector('.editor-backdrop')`, 5000, 'editor reopened for edit');
  t.ok(await mx.evaluate(`document.querySelector('.editor-head h3').textContent === 'Edit comment'`),
    'editing an existing comment opens the editor in edit mode');
  await mx.evaluate(`(function(){ var a = document.querySelector('.editor-area'); a.value = 'Anyone can read this without a role (clarified)'; a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.editor-foot button')).find(b => /Save changes/.test(b.textContent)).click()`);
  const okText = await mx.waitFor(`(function(){ var m = document.querySelector('.editor .msg.ok'); return m && m.textContent; })()`, 5000, 'inline update confirmation');
  t.ok(/Comment updated/.test(okText), 'editing shows its confirmation inside the drawer, which stays open: ' + okText);
  t.ok(await mx.evaluate(`!!document.querySelector('.editor-backdrop')`),
    'the drawer stays open on an edit, so the confirmation is actually seen');

  // ---- deleting it closes the window right away ----
  // Unlike editing, there is nothing left to look at once a comment is gone,
  // so delete does not linger on a confirmation the writer has to dismiss —
  // it closes the drawer immediately and reports through the page-level
  // banner instead, the same one every other one-off confirmation uses.
  await mx.evaluate(`Array.from(document.querySelectorAll('.editor-foot button')).find(b => /Delete/.test(b.textContent)).click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.editor-backdrop')`, 5000, 'editor closed after delete'),
    'deleting a comment closes the editor window immediately');
  const delText = await mx.waitFor(`(function(){ var m = document.querySelector('.content-wrap > .msg'); return m && m.textContent; })()`, 5000, 'delete confirmation banner');
  t.ok(/Comment deleted/.test(delText), 'and reports it through the page-level banner: ' + delText);
  t.ok(await mx.evaluate(`document.querySelectorAll('.popup-tab').length === 3`),
    'dropping back to the entity popup underneath, same as adding a comment does');

  await mx.close();
};
