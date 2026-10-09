/* Entity access measured against what uses it (public/accessuse.js), and the
 * card on the Security section that shows it.
 *
 * A model of its own, with every case once:
 *   Sales.Order    — Agent reads every row (no XPath), the only list of it
 *                    has an XPath: wider than its use.
 *   Sales.Note     — Agent reads every row, and sees notes only over an
 *                    association, in a SNIPPET placed on the page: wider,
 *                    and only found by following the snippet.
 *   Sales.Customer — Agent reads every row and a page lists every row: fits.
 *   Sales.Invoice  — Agent holds a rule and nothing Agent reaches uses it.
 *   Admin.Setting  — the rule belongs to Admin.Clerk, the page that lists it
 *                    to Sales.Clerk; only the USER ROLE carrying both joins
 *                    them. Judged per module role, this was "never used".
 *   Sales.Log      — read only by a microflow WITHOUT entity access, which
 *                    Agent cannot call: what it does inside does not count.
 *   Odata          — a published OData service is open to it: set aside and
 *                    named, never judged.
 */
'use strict';
const { openSeededProject } = require('./helpers');

function rule(moduleRole, xpath) {
  return { moduleRole: moduleRole, defaultAccess: 'r', attrAccess: {}, assocAccess: {},
    allowCreate: false, allowDelete: false, xpathConstraint: xpath || null };
}

const MODEL = {
  meta: { source: 'mpr', knowsCallSites: true },
  modules: [{ name: 'Sales' }, { name: 'Admin' }],
  security: { level: 'CheckEverything', checkSecurity: true, strictMode: false, guestAccess: false },
  userRoles: [
    { name: 'Agent', moduleRoles: ['Sales.Agent'] },
    { name: 'Clerk', moduleRoles: ['Sales.Clerk', 'Admin.Clerk'] },
    { name: 'Odata', moduleRoles: ['Sales.Odata'] }
  ],
  moduleRoles: [
    { module: 'Sales', name: 'Agent', qualifiedName: 'Sales.Agent' },
    { module: 'Sales', name: 'Clerk', qualifiedName: 'Sales.Clerk' },
    { module: 'Sales', name: 'Odata', qualifiedName: 'Sales.Odata' },
    { module: 'Admin', name: 'Clerk', qualifiedName: 'Admin.Clerk' }
  ],
  entities: [
    { module: 'Sales', name: 'Order', qualifiedName: 'Sales.Order', attributes: [], accessRules: [rule('Sales.Agent'), rule('Sales.Odata')] },
    { module: 'Sales', name: 'Note', qualifiedName: 'Sales.Note', attributes: [], accessRules: [rule('Sales.Agent')] },
    { module: 'Sales', name: 'Customer', qualifiedName: 'Sales.Customer', attributes: [], accessRules: [rule('Sales.Agent')] },
    { module: 'Sales', name: 'Invoice', qualifiedName: 'Sales.Invoice', attributes: [], accessRules: [rule('Sales.Agent', '[Paid = false]')] },
    { module: 'Sales', name: 'Log', qualifiedName: 'Sales.Log', attributes: [], accessRules: [rule('Sales.Agent')] },
    { module: 'Admin', name: 'Setting', qualifiedName: 'Admin.Setting', attributes: [], accessRules: [rule('Admin.Clerk')] }
  ],
  associations: [{ name: 'Note_Order', module: 'Sales', owner: 'Sales.Note', other: 'Sales.Order', type: 'Reference' }],
  pages: [
    {
      module: 'Sales', name: 'MyOrders', qualifiedName: 'Sales.MyOrders', allowedModuleRoles: ['Sales.Agent'],
      parameters: [], calledBy: [],
      dataSources: [
        { kind: 'database', entity: 'Sales.Order', path: [], xpath: "[System.owner = '[%CurrentUser%]']", widget: 'myOrders' },
        { kind: 'database', entity: 'Sales.Customer', path: [], xpath: null, widget: 'customers' }
      ],
      snippets: ['Sales.OrderNotes'], flowRefs: [], mentions: ['Sales.Customer', 'Sales.Order']
    },
    {
      module: 'Sales', name: 'ClerkHome', qualifiedName: 'Sales.ClerkHome', allowedModuleRoles: ['Sales.Clerk'],
      parameters: [], calledBy: [],
      dataSources: [{ kind: 'database', entity: 'Admin.Setting', path: [], xpath: null, widget: 'settings' }],
      snippets: [], flowRefs: [], mentions: ['Admin.Setting']
    }
  ],
  snippets: [{
    module: 'Sales', name: 'OrderNotes', qualifiedName: 'Sales.OrderNotes',
    dataSources: [{ kind: 'association', entity: 'Sales.Note', path: ['Sales.Note_Order'], xpath: null, widget: 'notes' }],
    snippets: [], flowRefs: [], mentions: ['Sales.Note']
  }],
  microflows: [{
    module: 'Sales', name: 'WriteLog', qualifiedName: 'Sales.WriteLog', allowedModuleRoles: [],
    applyEntityAccess: false, parameters: [], calledBy: [],
    activity: { reads: ['Sales.Log'], retrieves: [{ entity: 'Sales.Log', over: 'database', xpath: null }],
      creates: ['Sales.Log'], changes: [], deletes: [], commits: [], calls: [] }
  }],
  nanoflows: [],
  publishedServices: [{
    kind: 'OData', module: 'Sales', name: 'Reporting', qualifiedName: 'Sales.Reporting',
    allowedModuleRoles: ['Sales.Odata'], authentication: ['Basic'], authenticationMicroflow: null, exposes: ['Orders']
  }],
  automation: []
};

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP, MODEL);

  // ---- the analysis itself ----
  const r = JSON.parse(await mx.evaluate(`JSON.stringify(window.MxAccessUse.analyse(${JSON.stringify(MODEL)}))`));
  const pairs = function (list) { return list.map(function (i) { return i.userRole + ':' + i.entity; }).sort(); };

  t.ok(JSON.stringify(pairs(r.wider)) === JSON.stringify(['Agent:Sales.Note', 'Agent:Sales.Order']),
    'a rule that reads every row is wider than its use when everything the role reaches narrows it: ' + JSON.stringify(pairs(r.wider)));
  const note = r.wider.filter(function (i) { return i.entity === 'Sales.Note'; })[0];
  t.ok(note && note.uses.some(function (u) { return u.how === 'association' && u.via === 'snippet' && u.name === 'Sales.OrderNotes'; }),
    'and a use inside a snippet the page places is found, with the snippet named: ' + JSON.stringify(note && note.uses));
  t.ok(!pairs(r.wider).concat(pairs(r.unused)).some(function (p) { return /Customer/.test(p); }),
    'a rule that reads every row is NOT reported where a page does list every row');
  t.ok(JSON.stringify(pairs(r.unused)) === JSON.stringify(['Agent:Sales.Invoice', 'Agent:Sales.Log']),
    'a rule nothing the role reaches uses is reported, including one only a microflow without entity access reads: ' + JSON.stringify(pairs(r.unused)));
  t.ok(!pairs(r.wider).concat(pairs(r.unused)).some(function (p) { return /Setting/.test(p); }),
    'a page in one module and a rule in another are joined by the user role carrying both: Clerk uses Admin.Setting');
  t.ok(JSON.stringify(r.setAside) === JSON.stringify([{ userRole: 'Odata', services: ['Reporting'] }]),
    'a user role a published OData service is open to is set aside and named, never reported as unused: ' + JSON.stringify(r.setAside));

  // ---- the card ----
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,a')).filter(function (e) { return /^Security/.test(e.textContent.trim()); });
    n[n.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.au-card')`, 8000, 'access card');
  const counts = await mx.evaluate(`document.querySelector('.sec-counts').textContent`);
  t.ok(/2 entities read wider than used/.test(counts) && /2 with access nothing uses/.test(counts),
    'the band counts entities, not role-and-entity pairs: ' + counts);
  const card = await mx.evaluate(`document.querySelector('.au-card').textContent`);
  t.ok(/Strict mode is off in this project/.test(card),
    'the card says which mode the project is in, since that decides how open a wide rule is');
  t.ok(/Odata/.test(card) && /Reporting/.test(card) && /not judged/.test(card),
    'and names the role it did not judge, with the service that is why');
  const entities = await mx.evaluate(`Array.from(document.querySelectorAll('.au-item .au-entity-name')).map(function (n) { return n.textContent; }).join('|')`);
  t.ok(entities === 'Sales.Note|Sales.Order', 'one row per entity, collapsed: ' + entities);

  // Opening one shows the narrowing places as badges, and a badge opens the
  // page it names over the Security section.
  await mx.evaluate(`(function(){ var d = Array.from(document.querySelectorAll('.au-item')).find(function (x) { return /Sales.Order$/.test(x.querySelector('.au-entity-name').textContent); }); d.open = true; return true; })()`);
  const body = await mx.evaluate(`Array.from(document.querySelectorAll('.au-item')).find(function (x) { return x.open; }).textContent`);
  t.ok(/Rule without an XPath: Sales.Agent/.test(body) && /With an XPath \(1\)/.test(body) && /Sales.MyOrders · myOrders/.test(body),
    'the body names the rule to change and where the role meets the entity, by page and widget: ' + body.slice(0, 200));
  const title = await mx.evaluate(`Array.from(document.querySelectorAll('.au-item[open] .au-place'))[0].getAttribute('title')`);
  t.ok(/\[System\.owner = '\[%CurrentUser%\]'\]/.test(title), 'the XPath itself is kept on the badge, exactly: ' + title);
  await mx.evaluate(`Array.from(document.querySelectorAll('.au-item[open] button.au-place'))[0].click()`);
  t.ok(await mx.waitFor(`!!document.querySelector('.popup-tabs') && /MyOrders/.test(document.querySelector('.modal').textContent)`, 8000, 'page popup'),
    'and clicking it opens that page');

  await mx.close();
};
