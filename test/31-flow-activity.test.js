/* "What it does" — the summary of a flow's body, shown in the window that
 * holds the button that sets it off.
 *
 * MxScout genuinely runs microflows: in the tester's own session, against a
 * real test environment, with their real rights. Everything else in the tool
 * is read-only. So the window that asks somebody to press a button that isn't
 * has to say what pressing it does — and a flow that only reads must NOT be
 * marked, or the marking on the ones that write means nothing.
 *
 * It is a band across the top of the window rather than a panel in the side
 * rail: what a flow does to data is true of the flow, not of a tab, and the
 * entity names are the widest content in the window — they had the narrowest
 * column in it. The browsing card carries none of this any more; two words on
 * a card could not say which entities, and the window is one click away. */
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

// Every chip in the band, as "tier|LABEL|value" — the tier is the whole point
// of the ramp, so it is asserted alongside the words rather than separately.
const CHIPS = `(function(){
  return JSON.stringify(Array.from(document.querySelectorAll('.act-chip')).map(function (c) {
    var tier = (c.className.match(/act-chip-(\\w+)/) || [])[1];
    return tier + '|' + c.querySelector('.act-chip-label').textContent +
      '|' + c.querySelector('.act-chip-value').textContent;
  })); })()`;

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  // ---- the card carries none of it ----
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,a')).filter(function (e) { return /^Microflows/.test(e.textContent.trim()); });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  // Everything, not one role: a flow no role can trigger is hidden under a
  // role filter, and RecalculateTotals is exactly that case.
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.flow-card').length === 6`, 8000, 'all flows');

  t.ok(await mx.evaluate(`document.querySelectorAll('.flow-writes').length === 0`),
    'no flow wears a write marker in the list — CancelOrder deletes and still shows nothing here');
  t.ok(await mx.evaluate(`/CancelOrder/.test(document.querySelector('.flow-grid').textContent)`),
    'the cards themselves are untouched: the same flows, in the same grid');

  // ---- the band: above the tabs, not in the rail ----
  await openFlow(mx, 'CancelOrder');
  const band = await mx.waitFor(`document.querySelector('.act-band') && document.querySelector('.act-band').textContent`, 8000, 'activity band');

  t.ok(await mx.evaluate(`(function(){
    var b = document.querySelector('.act-band');
    return !b.closest('.flow-col-side') && !!b.nextElementSibling &&
      b.nextElementSibling.classList.contains('popup-tabs'); })()`),
    'it sits between the title and the tabs, at the window’s full width, not in the 240px rail');

  const verdict = await mx.evaluate(`(function(){
    var v = document.querySelector('.act-verdict');
    return v.className + '|' + v.textContent; })()`);
  t.ok(verdict === 'act-verdict act-danger|Deletes data',
    'and leads with the strongest true statement about what running it does: ' + verdict);

  // ---- the ramp: one red, spent on the delete ----
  const chips = JSON.parse(await mx.evaluate(CHIPS));
  t.ok(chips[0] === 'danger|Deletes|Sales.TempNote',
    'the delete comes first and is the only filled-alarm chip there is: ' + chips[0]);
  t.ok(chips.filter(function (c) { return /^danger\|/.test(c); }).length === 1,
    'exactly one — red means "cannot be undone by closing the tab", not "writes": ' + JSON.stringify(chips));
  t.ok(chips.indexOf('write|Commits|Sales.Order') !== -1,
    'a commit is full-strength text with no hue of its own: ' + JSON.stringify(chips));
  t.ok(chips.indexOf('write|Outside the app|1 REST call') !== -1,
    'so is the call that leaves the machine — it writes somewhere, it is just not a delete');
  t.ok(chips.indexOf('read|Reads|Sales.Order') !== -1 &&
    chips.indexOf('read|Calls|1 flow, 1 Java action') !== -1,
    'reads and calls are outlined and muted: complete, but not a reason to hesitate: ' + JSON.stringify(chips));

  // The N+1 in the model, before it is an N+1 in the log.
  t.ok(/Inside a loop: a retrieve and a commit/.test(band),
    'a retrieve or a commit inside a loop is pointed out — that is one database round trip per row: ' + band.slice(0, 300));
  t.ok(/once per item/.test(band), 'in words that say why it matters, not just that it is there');

  // The reason it left the Run tab: it is a fact about the flow, so it is
  // still on screen when the tab under it is not Run.
  await mx.evaluate(`(function(){
    Array.from(document.querySelectorAll('.popup-tab')).filter(function (b) { return b.textContent === 'Comments'; })[0].click();
    return true; })()`);
  await mx.waitFor(`!document.querySelector('.param-table')`, 5000, 'comments tab');
  t.ok(await mx.evaluate(`!!document.querySelector('.act-band') && !!document.querySelector('.act-chip')`),
    'and it stays there on the Comments tab — it is a fact about the flow, not about a tab');

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

  // A read-only flow gets the band too, with nothing in it worth a colour.
  const calm = await mx.evaluate(`(function(){
    var v = document.querySelector('.act-verdict');
    return v.className + '|' + v.textContent; })()`);
  t.ok(calm === 'act-verdict act-calm|Reads only',
    'and a flow that only reads says exactly that, quietly: ' + calm);
  t.ok(await mx.evaluate(`document.querySelectorAll('.act-chip-danger, .act-chip-write').length === 0`),
    'with no chip above the quiet tier — nothing here is a reason to hesitate');

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
  t.ok(await mx.evaluate(`!document.querySelector('.act-band')`),
    'a flow with no activity on it gets no band at all — an empty summary would read as "this flow does nothing"');

  await mx.close();
};
