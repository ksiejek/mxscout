/* Asking the running app what a row-level rule really matches.
 *
 * Everything else on the entity popup is read out of the project file.
 * Whether a constraint actually SELECTS anything is a property of the running
 * application and of the data in it, so the model cannot answer it and
 * MxScout does not pretend to — it asks, because it is already connected to
 * that app for the Data tab.
 *
 * The `count` command exists for this and can answer with nothing but two
 * numbers: how many rows this session can see, and how many of those also
 * match the constraint. The pairing is the whole point — "0 matched" means
 * nothing if the table is empty and everything if it has 253 rows — and so is
 * the caveat, because the runtime applies the CURRENT session's rights to
 * both counts. */
'use strict';
const { openSeededProject, openEntityPopup, clickTab } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);
  await openEntityPopup(mx);

  // Before there is a bridge there is nothing to ask, and the popup does not
  // offer a button that could only fail.
  t.ok(await mx.evaluate(`!document.querySelector('.con-check-btn')`),
    'with no app connected there is no check to offer — the Data tab already says how to connect');

  await mx.evaluate(clickTab('Data'));
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');

  // Back to the rules. Sales.Order carries two, both for the same role: the
  // ordinary "their own rows" idiom, and one that reaches a user role through
  // System — which MxScout has already marked as a rule it cannot follow.
  await mx.evaluate(`(function(){ var t = Array.from(document.querySelectorAll('.popup-tab')).filter(function (x) { return /Attributes/.test(x.textContent); })[0]; if (t) t.click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.con-check-btn').length === 2`, 12000, 'a check per rule');
  t.ok(true, 'once the app is connected, every rule with a constraint offers a check');

  async function check(index) {
    await mx.evaluate(`document.querySelectorAll('.con-check-btn')[${index}].click()`);
    return mx.waitFor(`(function(){
      var box = document.querySelectorAll('.con-check-box')[${index}];
      var line = box && box.querySelector('.con-check');
      return line && line.textContent;
    })()`, 20000, 'count ' + index);
  }

  // ---- a rule that really does select a subset ----
  const owned = await check(0);
  t.ok(/Matches 84 of the 253 rows this session can see/.test(owned),
    'a rule that selects a subset says how many of how many — both numbers, because either alone means nothing: ' + owned);
  t.ok(await mx.evaluate(`document.querySelectorAll('.con-check-box')[0].querySelector('.con-check').className.indexOf('ok-text') !== -1`),
    'and reads as an ordinary answer, not a warning');

  // ---- a rule that selects nothing: the whole reason this exists ----
  const none = await check(1);
  t.ok(/Matches none of the 253 rows this session can see/.test(none),
    'a rule that matches nothing while the entity has rows says exactly that: ' + none);
  t.ok(await mx.evaluate(`document.querySelectorAll('.con-check-box')[1].querySelector('.con-check').className.indexOf('warn-text') !== -1`),
    'and this one IS a warning — a rule that looks like protection and selects nothing is the finding');

  // The rule MxScout could not follow from the model is the one the app just
  // answered for. Both statements stand together: "I could not check this"
  // and "the app says it matches nothing".
  t.ok(await mx.evaluate(`document.querySelectorAll('.am-rule-col')[1].textContent.indexOf('through System') !== -1`),
    'the model-side marker is still there next to it — MxScout says both what it could not do and what the app answered');

  // ---- nothing is asserted about rows nobody has ----
  // Sales.AuditEntry has no rows in the app at all, and "0 matched" out of 0
  // is not a finding about the rule.
  await mx.evaluate(`(function(){ var b = document.querySelector('.modal-backdrop'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.access-matrix')`, 5000, 'popup closed');
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(function (e) { return e.textContent.trim() === 'AuditEntry'; });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.con-check-btn')`, 8000, 'audit popup');
  const empty = await check(0);
  t.ok(/sees no rows of AuditEntry at all, so this says nothing about the rule/.test(empty),
    'an entity with no visible rows is reported as nothing to conclude, not as a rule matching nothing: ' + empty);

  // ---- the caveat that keeps the number honest ----
  // The runtime counted with the rights of whoever is signed in on the app
  // tab. MxScout is told that session's user name, never its role list, so it
  // cannot know whether those rights are the rule's — and says so every time
  // rather than guessing from the view's role dropdown, which is a setting
  // here and says nothing about anyone's real rights.
  const caveat = await mx.evaluate(`document.querySelector('.con-check-box').textContent`);
  t.ok(/Counted with the rights of the session signed in on the app tab/.test(caveat),
    'every count says whose rights it was counted with: ' + caveat.slice(-160));
  t.ok(/does not hold Sales\.Agent/.test(caveat),
    'and names the role the number would have to be read against to mean what it looks like');

  // ---- the command can carry nothing but the question ----
  const shape = await mx.evaluate(`fetch('/api/session/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'count', qualifiedName: 'Sales.Order', constraint: "[System.owner = '[%CurrentUser%]']",
                           columns: ['Number','Customer'], amount: 100, objectParams: [{ name: 'x', guids: ['1'] }] })
  }).then(function (r) { return r.json(); }).then(function () {
    return fetch('/api/session/exec').then(function (r) { return r.json(); });
  })`);
  var cmd = shape && shape.pending;
  t.ok(cmd && cmd.kind === 'count' && !cmd.columns && !cmd.amount,
    'a count carries no columns and no page size — fields that could bring data back are absent, not emptied: ' + JSON.stringify(cmd && Object.keys(cmd)));
  t.ok(cmd && Array.isArray(cmd.objectParams) && cmd.objectParams.length === 0,
    'and object parameters sent alongside are dropped: a count can never become a run');

  const refused = await mx.evaluate(`fetch('/api/session/exec', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'count', qualifiedName: 'Sales.Order' })
  }).then(function (r) { return r.status + ' ' + JSON.stringify(r.ok); })`);
  t.ok(/^400/.test(refused), 'a count with no constraint is refused rather than turned into "count everything": ' + refused);

  await app.close();
  await mx.close();
};
