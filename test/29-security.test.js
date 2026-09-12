/* The Security section, and the one claim it makes on every other view.
 *
 * MxScout's whole pitch is "this is what that role can actually see and do".
 * Whether the running app enforces any of it is decided by one field in the
 * project's security document, and until this section existed MxScout read
 * that document for its user roles and dropped the rest — showing an access
 * matrix without ever saying whether the app checks it. The two things worth
 * protecting here are therefore: the section renders what the model records,
 * and a project that does NOT enforce its rules says so at the top of every
 * view that filters by role. */
'use strict';
const { openSeededProject } = require('./helpers');

const bodyText = `document.body.textContent`;

// Sidebar section buttons carry their count in the same element ("Entities3
// items"), so this matches on the leading label rather than the whole text.
async function openSection(mx, label) {
  await mx.evaluate(`(function(){
    var re = new RegExp('^' + ${JSON.stringify(label)});
    var n = Array.from(document.querySelectorAll('button,a')).filter(function (e) { return re.test(e.textContent.trim()); });
    n[n.length - 1].click(); return true; })()`);
}

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  // ---- the section itself, on the shared model (Production, no guest) ----
  await openSection(mx, 'Security');
  t.ok(await mx.waitFor(`!!document.querySelector('.sec-panel')`, 8000, 'security section'),
    'the project has a Security section of its own');

  const panel = await mx.evaluate(`document.querySelector('.sec-panel').textContent`);
  t.ok(/Security level/.test(panel) && /Production/.test(panel),
    'it names the security level in the Security screen’s own word for it: ' + panel.slice(0, 80));
  t.ok(/checks pages, microflows and entity access/.test(panel),
    'and says what that level actually means for everything else MxScout shows');
  t.ok(/Anonymous access/.test(panel) && /Everything requires a sign-in/.test(panel),
    'anonymous access is answered even when the answer is no');
  t.ok(/8 characters minimum, a digit/.test(panel),
    'the password policy is spelled out, not just "set": ' + panel.slice(0, 60));

  // Secrets are facts, never values.
  t.ok(/stored in the project file in plain text/.test(panel),
    'that the admin password sits in the model in plain text is said out loud');
  t.ok(/demo_agent/.test(panel), 'and each demo account is listed by name');
  t.ok(await mx.evaluate(`!/MxScout does not read the value/.test('') && document.querySelector('.sec-panel').textContent.indexOf('hunter') === -1`),
    'no password value appears anywhere on the page — the reader never put one in the model');

  // ---- user roles: what a role unlocks, and what it can hand out ----
  t.ok(/Agent/.test(panel) && /Sales\.Agent/.test(panel),
    'a user role is shown with the module roles it carries');
  t.ok(/manages all roles/.test(panel),
    'a role that can assign every other role is flagged, because that is how a role becomes every role');

  // ---- module roles: the ones no rule mentions ----
  t.ok(/Archivist/.test(panel),
    'a module role that no access rule, microflow or page mentions is still listed — it is read from the module, not inferred from the rules');
  t.ok(/held by nobody/.test(panel),
    'and one that no user role carries is called out: nobody can ever have it');
  t.ok(/Left over from the old archive screen/.test(panel),
    'with the one line of description somebody wrote for it');

  // ---- an enumeration attribute says what it may hold ----
  // The entity popup used to name the enumeration and stop there; the values
  // are one document away and are what anybody reading a row actually needs.
  await openSection(mx, 'Entities');
  await mx.waitFor(`!!document.querySelector('.entity-card, .module-group')`, 8000, 'entities');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(function (e) { return e.textContent.trim() === 'TempNote'; });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.access-matrix')`, 8000, 'entity popup');
  const typeCell = await mx.evaluate(`(function(){
    var row = Array.from(document.querySelectorAll('.access-matrix tr')).filter(function (r) { return /Priority/.test(r.textContent); })[0];
    var cell = row && row.querySelector('.am-type');
    return cell ? JSON.stringify({ text: cell.textContent, title: cell.getAttribute('title') }) : 'null'; })()`);
  const cell = JSON.parse(typeCell);
  t.ok(cell.text === 'Priority (2)',
    'an enumeration attribute names its enumeration and how many values it has: ' + cell.text);
  t.ok(/Rather urgent/.test(cell.title) && /high/.test(cell.title),
    'and carries every value on hover — the caption a person sees and the name that comes back in the data: ' + JSON.stringify(cell.title));
  await mx.evaluate(`(function(){ var b = document.querySelector('.modal-backdrop'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.access-matrix')`, 5000, 'popup closed');

  // ---- no banner when the app does enforce its rules ----
  await openSection(mx, 'Entities');
  await mx.waitFor(`!!document.querySelector('.entity-card, .module-group')`, 8000, 'entities');
  t.ok(await mx.evaluate(`!document.querySelector('.sec-banner')`),
    'a Production project gets no banner — the normal case needs no caveat');

  // ---- a project that does NOT enforce its rules says so, everywhere ----
  // Same shape of model, one field different. Seeded as its own project so
  // the rest of the suite keeps the screen text it expects.
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'p-proto', name: 'Prototype', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 10, summary: null, appUrl: null },
      {
        modules: [{ name: 'Sales' }],
        security: {
          level: 'CheckFormsAndMicroflows', checkSecurity: true, strictMode: false,
          strictPageUrlCheck: false, guestAccess: true, guestUserRole: 'Visitor',
          demoUsersEnabled: false, demoUsers: [], adminUserName: null, adminUserRole: null,
          adminPasswordSet: false, passwordPolicy: null
        },
        userRoles: [
          { name: 'Agent', moduleRoles: ['Sales.Agent'], manageAllRoles: false, manageableRoles: [] },
          { name: 'Visitor', moduleRoles: [], manageAllRoles: false, manageableRoles: [] }
        ],
        moduleRoles: [{ module: 'Sales', name: 'Agent', qualifiedName: 'Sales.Agent', description: null }],
        entities: [{ qualifiedName: 'Sales.Order', name: 'Order', module: 'Sales', attributes: [], accessRules: [] }],
        associations: [], microflows: [], nanoflows: [], pages: []
      });
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Prototype')`, 10000, 'second project');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Prototype'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => /^Entities/i.test(n.textContent.trim()))`, 8000, 'sections listed');
  await openSection(mx, 'Entities');

  const banner = await mx.waitFor(`document.querySelector('.sec-banner') && document.querySelector('.sec-banner').textContent`, 8000, 'banner');
  t.ok(/Security is Prototype in this project/.test(banner),
    'a Prototype project is told, on the view that filters by role, that the picture is not what the app enforces: ' + banner);
  t.ok(/not entity access/.test(banner),
    'and specifically which half of it is not enforced');

  // The role a signed-out visitor is given is named in the dropdown rather
  // than left sitting among the others looking like any signed-in role.
  const options = await mx.evaluate(`Array.from(document.querySelectorAll('.role-select option')).map(function (o) { return o.textContent; }).join(' | ')`);
  t.ok(/Visitor \(not signed in\)/.test(options),
    'the role an anonymous visitor gets is marked as such in the role picker: ' + options);
  t.ok(!/Agent \(not signed in\)/.test(options),
    'and only that one is');

  // ---- a model with no security document says so rather than guessing ----
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'p-old', name: 'OldImport', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 10, summary: null, appUrl: null },
      { modules: [{ name: 'Sales' }], userRoles: [{ name: 'Agent', moduleRoles: ['Sales.Agent'] }],
        entities: [], associations: [], microflows: [], nanoflows: [], pages: [] });
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'OldImport')`, 10000, 'third project');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'OldImport'); e[e.length-1].click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => /^Entities/i.test(n.textContent.trim()))`, 8000, 'sections listed');
  await openSection(mx, 'Security');
  const old = await mx.waitFor(`/security/i.test(${bodyText}) && ${bodyText}`, 8000, 'old-import security view');
  t.ok(/does not carry the project’s security settings/.test(old),
    'a model imported before this existed says it has no security settings, rather than reporting an unsecured app');
  t.ok(/Replace the model/.test(old),
    'and says what to do about it');
  t.ok(!/Security is .* in this project/.test(old),
    'a missing security document is never rendered as a warning banner — absence of a record is not a finding');

  await mx.close();
};
