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

  // ---- the band: what was found, before any scrolling ----
  // The page used to open on a settings table where "Page URL check: On" and
  // "the administrator password is weak" had the same geometry, so the reader
  // had to read all of it to learn which two lines mattered. Karol,
  // 2026-09-14: "trochę mi się one zlewają". The band is the answer first.
  const band = await mx.evaluate(`document.querySelector('.sec-band').textContent`);
  t.ok(/Production/.test(band) && /checks pages, microflows and entity access/.test(band),
    'the section opens on a verdict, not on a settings table: ' + band.slice(0, 60));
  t.ok(await mx.evaluate(`!document.querySelector('.sec-panel .sec-banner')`),
    'and the old banner is gone from THIS page — the verdict says the same thing, and two of them stacked was half the noise');

  const findings = JSON.parse(await mx.evaluate(`JSON.stringify(
    Array.from(document.querySelectorAll('.sec-found li')).map(function (li) {
      var m = li.querySelector('.mark');
      return { mark: m ? m.className : null, text: li.textContent };
    }))`));
  const toActOn = findings.filter(function (f) { return /mark-find/.test(f.mark || ''); });
  t.ok(toActOn.length === 2,
    'a finding is listed once, in full, with the filled mark: ' + toActOn.map(function (f) { return f.text.slice(0, 40); }).join(' | '));
  t.ok(toActOn.some(function (f) { return /administrator password/i.test(f.text) && /weak/.test(f.text); }),
    'a weak administrator password is one of them — the strongest single thing this page can say');
  t.ok(toActOn.some(function (f) { return /demo_agent/.test(f.text) && /weak/.test(f.text); }),
    'and so is a weak demo account, named');
  t.ok(!/(score|rating|out of 10|risk level)/i.test(band),
    'the band orders what was found and does NOT grade it — inventing severity is the one thing a security tool cannot do and keep its reader');

  // The rules MxScout could not follow. Until this existed they were reachable
  // only by opening the right entity with the role filter set to Everything —
  // which is to say, by stumbling on them.
  const unchecked = findings.filter(function (f) { return /mark-unchecked/.test(f.mark || ''); });
  t.ok(unchecked.length === 3,
    'every row-level rule MxScout could not follow is listed here, across all entities and all roles: ' +
      unchecked.map(function (f) { return f.text; }).join(' | '));
  t.ok(unchecked.some(function (f) { return /Sales.Order/.test(f.text); }),
    'including one on an entity whose OTHER rule is perfectly ordinary — the case a reader would never think to open');
  t.ok(unchecked.every(function (f) { return /through System|not in this model/.test(f.text); }),
    'each one says which of the two reasons it is, rather than only that something is wrong');

  // Clicking one has to land on a popup that actually CONTAINS the rule. The
  // matrix shows only the selected role's rules, so the jump drops the role
  // filter — otherwise the reader lands on an entity with the clicked rule
  // filtered out, which is the exact trap this list exists to end.
  await mx.evaluate(`document.querySelectorAll('.sec-found-unchecked .link-btn')[1].click()`);
  await mx.waitFor(`!!document.querySelector('.access-matrix')`, 8000, 'entity popup from the band');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.access-matrix thead .am-rule-col'))
    .some(function (th) { var r = th.querySelector('.am-role'), m = th.querySelector('.mark-unchecked');
      return r && m && r.textContent === 'Sales.Viewer'; })`),
    'the rule the reader clicked is in the popup they landed in, marked — not filtered out by a role selector they never touched');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).filter(function (b) { return b.textContent.trim() === 'Close'; })[0].click()`);
  await mx.waitFor(`!document.querySelector('.access-matrix')`, 8000, 'popup closed');
  t.ok(await mx.evaluate(`!!document.querySelector('.sec-band')`),
    'and closing it puts them back on the Security section they were reading, not in the entity list');

  const panel = await mx.evaluate(`document.querySelector('.sec-panel').textContent`);
  t.ok(/Security level/.test(panel) && /Production/.test(panel),
    'it names the security level in the Security screen’s own word for it: ' + panel.slice(0, 80));
  t.ok(/checks pages, microflows and entity access/.test(panel),
    'and says what that level actually means for everything else MxScout shows');
  t.ok(/Anonymous access/.test(panel) && /Everything requires a sign-in/.test(panel),
    'anonymous access is answered even when the answer is no');
  t.ok(/8 characters minimum, a digit/.test(panel),
    'the password policy is spelled out, not just "set": ' + panel.slice(0, 60));

  // ---- secrets are judged, never carried ----
  // "Set" is hygiene; "set, and shorter than the 8 characters this project
  // demands of its own users" is the thing somebody has to act on. The model
  // carries the verdict and never the password, so the page can say the
  // second without ever holding a secret.
  t.ok(/set, in plain text — weak/.test(panel),
    'a weak password is called weak, not merely "set": ' + (/set, in plain text[^.]*/.exec(panel) || [''])[0]);
  t.ok(/3 characters, shorter than the 8 characters this project requires/.test(panel),
    'and says exactly what is wrong with it, measured against the project’s OWN policy');
  t.ok(/no digit, which this project requires/.test(panel),
    'listing every rule of that policy it breaks, not just the first');
  t.ok(/one of the most common passwords there are/.test(panel),
    'a password that needs no cracking is called out as that, separately from being short');
  t.ok(/It meets this project’s own password policy/.test(panel),
    'and a password that passes is told apart from one that does not — otherwise the warning means nothing');
  t.ok(/demo_agent/.test(panel) && /demo_strong/.test(panel), 'each demo account is listed by name');
  // Said ONCE, in the card that shows the accounts, rather than hung off every
  // row. It was true every time and told the reader nothing new after the
  // first — but it must still be on the page, because a page that judges a
  // secret and does not say what it did with it is the one thing this must
  // never be.
  t.ok(/kept only the conclusion/.test(panel) && /no password reaches this browser’s database, a package, or a report/.test(panel),
    'the page says what it did: read the password to judge it, kept the judgement');

  // ---- user roles: what a role unlocks, and what it can hand out ----
  t.ok(/Agent/.test(panel) && /Sales\.Agent/.test(panel),
    'a user role is shown with the module roles it carries');
  t.ok(/manages all roles/.test(panel),
    'a role that can assign every other role is flagged, because that is how a role becomes every role');

  // ---- module roles: the ones no rule mentions ----
  t.ok(/Archivist/.test(panel),
    'a module role that no access rule, microflow or page mentions is still listed — it is read from the module, not inferred from the rules');
  // No longer a badge. A module role no user role carries drops out of its
  // module group into a group of its own, because where it sits is the fact —
  // the reader was otherwise being asked to join two tables by eye.
  t.ok(/Carried by no user role/.test(panel),
    'and one that no user role carries is called out: nobody can ever have it');
  t.ok(await mx.evaluate(`(function(){
    var g = Array.from(document.querySelectorAll('.sec-orphans'))[0];
    return !!g && g.textContent.indexOf('Archivist') !== -1 &&
      Array.from(document.querySelectorAll('.module-group:not(.sec-orphans)'))
        .every(function (o) { return o.textContent.indexOf('Archivist') === -1; });
  })()`),
    'and it is IN that group rather than listed twice — a role nobody holds is not also filed under its module');
  t.ok(/Left over from the old archive screen/.test(panel),
    'with the one line of description somebody wrote for it');

  // Karol, 2026-09-16, on a real project: the whole section sat in a narrow
  // reading column, chips wrapped mid-name, and every module's own table put
  // its second column somewhere else — a column that said "no description" on
  // nearly every row. It uses the full width now, modules are framed boxes in
  // a grid, and a module with no descriptions says so once, in its heading.
  const layout = await mx.evaluate(`(function(){
    var grid = document.querySelector('.sec-mod-grid');
    return {
      wide: !!document.querySelector('.content-wrap.wide .sec-panel'),
      gridded: !!grid && getComputedStyle(grid).display === 'grid' && grid.querySelectorAll('.module-group').length > 0,
      perRow: /no description/.test(Array.from(document.querySelectorAll('.sec-roles li')).map(function (l) { return l.textContent; }).join(' ')),
      heads: Array.from(document.querySelectorAll('.sec-mod-grid .module-group-count')).map(function (h) { return h.textContent; })
    };
  })()`);
  t.ok(layout.wide && layout.gridded,
    'the section uses the full width, with module roles as a grid of framed modules: ' + JSON.stringify(layout));
  t.ok(!layout.perRow && layout.heads.every(function (h) { return /^\d+ roles?( · (none described|no description))?$/.test(h); }),
    'and "no description" is said once per module, not once per role: ' + JSON.stringify(layout.heads));

  // ---- what the app publishes, which no role filter can answer ----
  t.ok(/Open to the outside/.test(panel) && /orders/.test(panel),
    'the services the app publishes get their own block — none of them go through the access rules the other views show');
  t.ok(/Basic/.test(panel), 'with what stands between the service and a caller');
  t.ok(/nothing gates it/.test(panel),
    'and a service with neither a role list nor authentication is marked as exactly that');

  // ---- what runs with nobody signed in ----
  t.ok(/Runs without a user/.test(panel) && /NightlyTotals/.test(panel) && /every day/.test(panel),
    'a scheduled event is listed with what it runs and when — it executes outside every role in the model');
  t.ok(/Sales\.RecalculateTotals/.test(panel), 'naming the microflow it sets off');
  t.ok(/off/.test(panel), 'and a queue or event that is switched off says so rather than looking live');

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
