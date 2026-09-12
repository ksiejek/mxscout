/* "What it does" — the summary of a flow's body, shown next to the button
 * that sets it off.
 *
 * MxScout genuinely runs microflows: in the tester's own session, against a
 * real test environment, with their real rights. Everything else in the tool
 * is read-only. So the one panel that asks somebody to press a button that
 * isn't has to say what pressing it does — and a flow that only reads must
 * NOT be marked, or the marking on the ones that write means nothing. */
'use strict';
const { openSeededProject } = require('./helpers');

async function openFlow(mx, name) {
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,a')).filter(function (e) { return /^Microflows/.test(e.textContent.trim()); });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  await mx.evaluate(`(function(){
    var c = Array.from(document.querySelectorAll('.flow-card')).filter(function (e) { return e.textContent.indexOf(${JSON.stringify(name)}) !== -1; });
    c[0].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.popup-tabs')`, 8000, 'flow popup');
}

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  // ---- the card, before you even open it ----
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,a')).filter(function (e) { return /^Microflows/.test(e.textContent.trim()); });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  // Everything, not one role: a flow no role can trigger is hidden under a
  // role filter, and RecalculateTotals is exactly that case.
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.flow-card').length === 6`, 8000, 'all flows');

  const cards = await mx.evaluate(`(function(){
    var out = {};
    Array.from(document.querySelectorAll('.flow-card')).forEach(function (c) {
      var name = c.querySelector('.flow-card-name').textContent;
      var mark = c.querySelector('.flow-writes');
      out[name] = mark ? mark.textContent : null;
    });
    return JSON.stringify(out); })()`);
  const marks = JSON.parse(cards);
  t.ok(marks.CancelOrder === 'deletes',
    'a flow that deletes says so on the card, before anyone opens it: ' + cards);
  t.ok(marks.RecalculateTotals === null,
    'a flow that only reads carries no marker — otherwise a marker would mean nothing');
  t.ok(marks.BulkCancel === null,
    'and neither does a flow whose body was never read: no marker means "not known", never "safe"');

  // ---- the popup: the verdict, then the detail ----
  await openFlow(mx, 'CancelOrder');
  const pane = await mx.waitFor(`document.querySelector('.act-verdict') && document.querySelector('.flow-col-side').textContent`, 8000, 'activity pane');
  t.ok(/Deletes data/.test(pane),
    'the popup leads with the strongest true statement about what running it does: ' + pane.slice(0, 60));

  const verdictClass = await mx.evaluate(`document.querySelector('.act-verdict').className`);
  t.ok(/act-danger/.test(verdictClass),
    'drawn on the same severity ramp as every other warning, not a colour of its own: ' + verdictClass);

  t.ok(/Sales\.Order/.test(pane) && /Sales\.TempNote/.test(pane),
    'and names the entities it reads, changes and deletes: ' + pane.slice(0, 200));
  t.ok(/REST call/.test(pane), 'a call out of the app is called out');
  t.ok(/1 flow, 1 Java action/.test(pane),
    'calls to other logic are counted, with the names on hover rather than in the way: ' + pane.slice(0, 250));

  // The N+1 in the model, before it is an N+1 in the log.
  t.ok(/Inside a loop: a retrieve and a commit/.test(pane),
    'a retrieve or a commit inside a loop is pointed out — that is one database round trip per row: ' + pane.slice(0, 300));
  t.ok(/once per item/.test(pane), 'in words that say why it matters, not just that it is there');

  // ---- what reaches a flow no role can trigger ----
  // "No user role can trigger this directly" is true about the client and
  // says nothing about the application. On one real project, 278 of the 363
  // role-less documents ARE reached by something in the model.
  await mx.evaluate(`(function(){ var b = document.querySelector('.modal-backdrop'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.popup-tabs')`, 5000, 'popup closed');
  await openFlow(mx, 'RecalculateTotals');
  const side = await mx.waitFor(`document.querySelector('.trig-list') && document.querySelector('.flow-col-side').textContent`, 8000, 'reached-from');
  t.ok(/Reached from \(2\)/.test(side),
    'a flow no role can trigger still says what runs it: ' + side.slice(0, 140));
  t.ok(/scheduled event/.test(side) && /Sales\.NightlyTotals/.test(side),
    'including a source MxScout has no page for — a scheduled event is named, not hidden');
  t.ok(/runs because one of the above runs it/.test(side),
    'and the sentence that ties the two panels together is there');

  const link = await mx.evaluate(`(function(){
    var b = Array.from(document.querySelectorAll('.trig-name')).filter(function (n) { return n.tagName === 'BUTTON'; });
    return b.length + ':' + (b[0] ? b[0].textContent : ''); })()`);
  t.ok(link === '1:Sales.CancelOrder',
    'the one source that IS in the model is a link, and the one that is not stays plain text: ' + link);

  // Clicking it opens that flow OVER this one — the same rule the performance
  // analyzer already follows, so looking at a caller costs nothing.
  await mx.evaluate(`Array.from(document.querySelectorAll('.trig-name')).filter(function (n) { return n.tagName === 'BUTTON'; })[0].click()`);
  t.ok(await mx.waitFor(`/CancelOrder/.test(document.querySelector('.modal').textContent)`, 5000, 'caller opened'),
    'and clicking it opens that caller without leaving the list behind');

  // ---- a flow nothing reaches, on a model that DID look ----
  await mx.evaluate(`(function(){ var b = document.querySelector('.modal-backdrop'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.popup-tabs')`, 5000, 'popup closed');
  await openFlow(mx, 'OrphanSweep');
  const orphan = await mx.waitFor(`document.querySelector('.flow-col-side') && document.querySelector('.flow-col-side').textContent`, 8000, 'orphan side');
  t.ok(/Nothing in this model reaches this microflow/.test(orphan),
    'a flow nothing names is told so outright — that is the whole point of reading call sites: ' + orphan.slice(0, 160));

  // ---- a flow whose body was never read shows nothing rather than "nothing"
  await mx.evaluate(`(function(){ var b = document.querySelector('.modal-backdrop'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.popup-tabs')`, 5000, 'popup closed');
  await openFlow(mx, 'BulkCancel');
  await mx.waitFor(`!!document.querySelector('.flow-col-side')`, 8000, 'side column');
  t.ok(await mx.evaluate(`!document.querySelector('.act-verdict')`),
    'a flow with no activity on it gets no panel at all — an empty summary would read as "this flow does nothing"');

  await mx.close();
};
