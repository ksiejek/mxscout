/* Row-level rules MxScout cannot follow.
 *
 * A row-level rule is the line somebody trusts most in the whole access
 * matrix — it is the sentence that says "and only their own rows". So the one
 * thing this must never do is present such a rule as checked when it was not.
 *
 * The line between "ordinary" and "cannot follow" was drawn by measurement,
 * not by reasoning: across three real projects, 135 access rules carry a
 * constraint, 28 of those touch the System module, and all 28 are the same
 * single step — [System.owner='[%CurrentUser%]'], the standard Mendix idiom
 * for "their own rows". A check that flagged "mentions System" would have
 * produced 28 false alarms and no true ones. The first assertion here is
 * therefore the most important one in the file: that rule must stay silent. */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,a')).filter(function (e) { return /^Entities/.test(e.textContent.trim()); });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.entity-card, .module-group')`, 8000, 'entity list');
  // Everything, not one role: the popup shows only the rules that apply to
  // the selected role, and these three are written for three different ones.
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.entity-card, .module-group')`, 8000, 'unfiltered list');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(function (e) { return e.textContent.trim() === 'AuditEntry'; });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.access-matrix')`, 8000, 'entity popup');

  // One column per rule, each with the role name, the readable constraint and
  // — only where it applies — the marker.
  const cols = await mx.evaluate(`(function(){
    return JSON.stringify(Array.from(document.querySelectorAll('.access-matrix thead .am-rule-col')).map(function (th) {
      var role = th.querySelector('.am-role');
      var note = th.querySelector('.con-unfollowed');
      return { role: role ? role.textContent : null, note: note ? note.textContent : null,
               title: note ? note.getAttribute('title') : null };
    })); })()`);
  const rules = JSON.parse(cols);
  const byRole = {};
  rules.forEach(function (r) { byRole[r.role] = r; });

  t.ok(rules.length === 3, 'all three rules of this entity get a column: ' + rules.map(function (r) { return r.role; }).join(', '));

  // THE important one. Every System-touching rule in three real projects is
  // exactly this shape, and it works.
  t.ok(byRole['Sales.Agent'] && byRole['Sales.Agent'].note === null,
    '[System.owner=’[%CurrentUser%]’] — the ordinary "their own rows" rule — is NOT flagged: it was 28 of the 28 System rules measured on real projects, and flagging it would make the marker mean nothing');

  // A path that goes through System and keeps going. Nothing in the model can
  // follow it, because System's domain model is not in the project file.
  const through = byRole['Sales.Viewer'];
  t.ok(through && through.note === 'through System',
    'a path that goes through System and continues past it is marked: ' + (through && through.note));
  t.ok(/System’s domain model is not in the project file/.test(through.title),
    'and says why MxScout cannot follow it — System ships with the Runtime, not with the project');
  t.ok(/user ROLE through System/.test(through.title),
    'naming the specific shape when the path reaches a user role, which is the one most often reported');

  // The honesty requirement: MxScout has not checked, and says so, rather
  // than repeating a claim about run-time behaviour it cannot verify here.
  t.ok(/does not claim that is what happens here/.test(through.title) &&
    /Connect the app and see what this rule actually returns/.test(through.title),
    'and does NOT assert the rule is broken — it says it has not checked, and points at the one thing that could');

  // A step that is simply not in the model.
  const missing = byRole['Sales.Archivist'];
  t.ok(missing && missing.note === 'not in this model',
    'a step the model does not contain is marked separately: ' + (missing && missing.note));
  t.ok(/Sales\.AuditEntry_Gone/.test(missing.title) && /renamed/.test(missing.title),
    'naming the step and the likeliest reason: ' + (missing && missing.title || '').slice(0, 90));

  // The sharpest version of the same point: Sales.Order carries the two
  // shapes side by side, for the SAME role. One is marked and one is not, in
  // adjacent columns of one table.
  await mx.evaluate(`(function(){ var b = document.querySelector('.modal-backdrop'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.access-matrix')`, 5000, 'popup closed');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(function (e) { return e.textContent.trim() === 'Order'; });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.access-matrix thead .am-rule-col').length === 2`, 8000, 'order popup');
  const side = await mx.evaluate(`(function(){
    return JSON.stringify(Array.from(document.querySelectorAll('.access-matrix thead .am-rule-col')).map(function (th) {
      var n = th.querySelector('.con-unfollowed');
      return n ? n.textContent : null;
    })); })()`);
  t.ok(side === '[null,"through System"]',
    'two rules of ONE role, side by side: the ordinary one silent, the one that goes through System marked — ' + side);

  await mx.close();
};
