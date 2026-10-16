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
 * And the three about what a role DOES:
 *   Sales.Customer — Agent may write Name and Phone and create customers;
 *                    the page edits Name only: Phone and create go unused.
 *   Sales.NewRefund — a nanoflow Agent may run creates a Refund, which Agent
 *                    may not create: it fails for Agent.
 *   Sales.ForceClose — a microflow without entity access Agent may call sets
 *                    an Order's Status and deletes Notes, neither of which
 *                    Agent may do itself.
 */
'use strict';
const { openSeededProject, goToSection } = require('./helpers');

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
    { module: 'Sales', name: 'Customer', qualifiedName: 'Sales.Customer', attributes: [], accessRules: [
      { moduleRole: 'Sales.Agent', defaultAccess: null, attrAccess: { Name: 'rw', Phone: 'rw' }, assocAccess: {}, allowCreate: true, allowDelete: false, xpathConstraint: null }] },
    { module: 'Sales', name: 'Refund', qualifiedName: 'Sales.Refund', attributes: [], accessRules: [rule('Sales.Agent', '[Open = true]')] },
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
      snippets: ['Sales.OrderNotes'], flowRefs: [], mentions: ['Sales.Customer', 'Sales.Order'],
      edits: ['Sales.Customer.Name'], creates: [], deletes: []
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
      creates: ['Sales.Log'], changes: [], deletes: [], commits: [], calls: [], writes: {} }
  }, {
    module: 'Sales', name: 'ForceClose', qualifiedName: 'Sales.ForceClose', allowedModuleRoles: ['Sales.Agent'],
    applyEntityAccess: false, parameters: [], calledBy: [],
    activity: { reads: [], retrieves: [], creates: [], changes: ['Sales.Order'], deletes: ['Sales.Note'], commits: ['Sales.Order'], calls: [],
      writes: { 'Sales.Order': ['Status'] } }
  }],
  nanoflows: [{
    module: 'Sales', name: 'NewRefund', qualifiedName: 'Sales.NewRefund', allowedModuleRoles: ['Sales.Agent'],
    parameters: [], calledBy: [],
    activity: { reads: [], retrieves: [], creates: ['Sales.Refund'], changes: [], deletes: [], commits: [], calls: [], writes: {} }
  }],
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

  // ---- what a role does ----
  t.ok(JSON.stringify(r.unwritten) === JSON.stringify([{ entity: 'Sales.Customer', name: 'Customer', module: 'Sales', userRole: 'Agent', attributes: ['Phone'], create: true, del: false }]),
    'a write right nothing writes, and a create right nothing uses, are reported; the attribute the page edits is not: ' + JSON.stringify(r.unwritten));
  t.ok(JSON.stringify(r.cannotDo) === JSON.stringify([{ flow: 'Sales.NewRefund', name: 'NewRefund', module: 'Sales', kind: 'nanoflow',
    items: [{ userRoles: ['Agent'], what: 'create', entity: 'Sales.Refund' }] }]),
    'a nanoflow a role may run that creates what the role may not create is reported, with who it fails for: ' + JSON.stringify(r.cannotDo));
  const past = r.pastAccess[0] || { items: [] };
  t.ok(r.pastAccess.length === 1 && past.flow === 'Sales.ForceClose' &&
    past.items.some(function (i) { return i.what === 'write' && i.entity === 'Sales.Order' && i.members[0] === 'Status'; }) &&
    past.items.some(function (i) { return i.what === 'delete' && i.entity === 'Sales.Note'; }),
    'a microflow without entity access that does for a role what its rules forbid is reported, step by step: ' + JSON.stringify(r.pastAccess));

  // ---- told at the entity, not on the Security page (Karol, 2026-10-13) ----
  await goToSection(mx, 'Security', '.sec-band');
  const line = await mx.evaluate(`(function(){ var l = document.querySelector('.sec-au-line'); return l ? l.textContent : ''; })()`);
  t.ok(!(await mx.evaluate(`!!document.querySelector('.au-card, .au-item')`)) && /entities have notes on their access rules/.test(line),
    'the Security page lists no entity or flow, it says how many entities have notes: ' + line);

  await goToSection(mx, 'Entities', '.dm-screen .dx-dm-box');
  async function checksOf(name) {
    await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.dx-dm-mrow')).find(function (x) { return x.firstChild.textContent === 'Sales'; }); if (r && !r.classList.contains('on')) r.click(); return true; })()`);
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.dx-dm-box')).find(b => b.querySelector('.dx-dm-bh b').textContent === ${JSON.stringify(name)})`, 5000, name);
    await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-box')).find(b => b.querySelector('.dx-dm-bh b').textContent === ${JSON.stringify(name)}).click()`);
    await mx.waitFor(`!!document.querySelector('.dx-dm-box.on')`, 3000, 'picked');
    const chips = await mx.evaluate(`Array.from(document.querySelectorAll('.dx-ac-chk')).map(c => c.className + ':' + c.textContent)`);
    if (!chips.length) return { chips: chips, text: '' };
    await mx.evaluate(`document.querySelector('.dx-ac-chk').click()`);
    const text = await mx.waitFor(`(function(){ var d = document.querySelector('.dx-ac-notes'); return d && d.textContent; })()`, 3000, 'notes');
    await mx.evaluate(`document.querySelector('.dx-ac-close').click()`);
    return { chips: chips, text: text };
  }
  const order = await checksOf('Order');
  t.ok(order.chips.length === 1 && /Reads every row, sees fewer/.test(order.text) && /Strict mode is off in this project/.test(order.text),
    'a rule wider than its use says so in its Access window, with the strict mode it depends on: ' + JSON.stringify(order).slice(0, 300));
  t.ok(/page Sales\.MyOrders · myOrders/.test(order.text) && /\[System\.owner = '\[%CurrentUser%\]'\]/.test(order.text),
    'naming the places that narrow it, the XPath kept exact');
  t.ok(/ForceClose changes Sales\.Order \(Status\)/.test(order.text), 'and a microflow that does for the role what the rule does not allow');
  const customer = await checksOf('Customer');
  t.ok(/May write, nothing writes/.test(customer.text) && /write Phone · create/.test(customer.text), 'unused write and create rights are told at their entity: ' + customer.text);
  const refund = await checksOf('Refund');
  t.ok(refund.chips.some(c => /find/.test(c)) && /NewRefund creates Sales\.Refund for Agent — without the right, so it fails/.test(refund.text),
    'a flow that fails for a role is marked as one to act on, at the entity it fails on: ' + JSON.stringify(refund));
  const invoice = await checksOf('Invoice');
  t.ok(/Granted, never used/.test(invoice.text), 'and a rule nothing uses: ' + invoice.text);

  await mx.close();
};
