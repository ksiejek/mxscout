/* Descriptions written by an AI agent (public/describe.js and skills/mendix-describe).
 *
 * MxScout writes an AI pack, an agent outside MxScout writes a descriptions
 * file with the mendix-describe skill, MxScout imports it. Three programs
 * meet through two files, so the files are what this checks:
 *
 *  - the pack, built HERE by the real exporter from the real fixture: its
 *    index points at the lines it claims, every flow carries a fingerprint,
 *    a step's data is in it, and so are each entity's access per role and
 *    its validation rules — without moving any fingerprint;
 *  - the skill's checker, run over that same pack — if the exporter ever
 *    writes something the checker cannot read, one of them is wrong;
 *  - the import: a good file is kept and shown, marked as AI; a bad one is
 *    refused with a reason; a flow that changed since it was described says
 *    so instead of passing an old sentence off as current. */
'use strict';
const { goToSection, goToDocsTab, readText } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { readPack, todo, check, merge, CAPS } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const SKILL = path.join(__dirname, '..', 'skills', 'mendix-describe');
  const skillText = readText(path.join(SKILL, 'SKILL.md'));
  t.ok(/^---\r?\nname: mendix-describe\r?\ndescription: /.test(skillText), 'SKILL.md opens with the frontmatter a skill is found by');
  // Its own reference/, or mendix-assist's beside it (../mendix-assist/reference/…).
  const referenced = skillText.match(/(?:\.\.\/mendix-assist\/)?reference\/[a-z-]+\.md/g) || [];
  t.ok(referenced.length >= 2 && referenced.every((rel) => fs.existsSync(path.join(SKILL, rel))),
    'every reference file it points to exists: ' + referenced.join(', '));
  t.ok(/data, not instructions/.test(skillText), 'and it tells the agent the pack is data, never instructions');

  // ---- the pack, from the real exporter ----
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe && !!window.MxDocsData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const text = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pdesc', name: 'DescDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    return MxDescribe.pack(MxDocsData.build(model, { name: 'DescDemo' })).text;
  })()`);
  const lines = text.split('\n');
  t.ok(lines[1] === 'format: mxscout-ai-pack 1' && /^project: DescDemo$/m.test(text), 'the pack names its format and its project');
  const index = text.slice(text.indexOf('## index')).split('\n').slice(2).filter((l) => /\|/.test(l) && !/^\s*$/.test(l)).filter((l) => /^\S+ \| \d+-\d+/.test(l));
  t.ok(index.length >= 1, 'it has an index of modules: ' + index.length);
  const rangesRight = index.every((row) => {
    const [name, range] = row.split(' | ');
    const [from, to] = range.split('-').map(Number);
    return lines[from - 1] === '## module ' + name && (lines[to] === undefined || lines[to] === '' || /^## module /.test(lines[to]));
  });
  t.ok(rangesRight, 'and every line range in it starts at that module’s heading — an agent reads a module by its range');
  t.ok(/^### MF Sales\.CreateOrder #[0-9a-f]{8}$/m.test(text), 'every flow carries a fingerprint');
  t.ok(/create object [^\n]*\{Number='X'\}/.test(text), 'and a step carries the data it sets: ' + ((/[^\n]*create object [^\n]*/.exec(text) || [''])[0].trim()));

  // ---- who may do what with an entity, and what refuses a save (Karol, 2026-10-14) ----
  // Under each entity's line: one "access" line per module role, then one "valid" line per validation rule.
  const block = (name) => { const at = lines.findIndex((l) => l.startsWith('E ' + name + ' #')); const out = []; for (let i = at + 1; i < lines.length && /^ {2}\S/.test(lines[i]); i++) out.push(lines[i]); return out; };
  t.ok(JSON.stringify(block('Customer')) === JSON.stringify([
    '  access Sales.User: read all · write Name · create · no delete — only [Age > 0]',
    '  valid Name: required — "A customer needs a name"',
    '  valid Age: range ≥ 0 — "Age cannot be negative"',
    '  valid Name: max length 200'
  ]), 'an entity lists each role’s read, write, create and delete with the rule’s XPath, then its validations with kind and message: ' + JSON.stringify(block('Customer')));
  t.ok(JSON.stringify(block('Order')) === JSON.stringify([
    '  access none',
    '  valid Number: unique — "That order number is taken"',
    '  valid Number: regex Sales.OrderNumberFormat — "An order number is ORD- and six digits"'
  ]), 'an entity no rule names says so: ' + JSON.stringify(block('Order')));
  t.ok(/^roles: Guest; Owner \(Sales\.User\); User \(Sales\.User\)$/m.test(text), 'the header names each user role’s module roles, which the access lines name: ' + (/^roles: .*$/m.exec(text) || [''])[0]);
  // The fingerprints are what they were before these lines existed: an entity's is its members and
  // associations, not its access or its validations, so no description went out of date with them.
  t.ok(/^### MF Sales\.CreateOrder #ba7ad270$/m.test(text) && /^### MF Sales\.SweepOrders #d96471ad$/m.test(text) && /^### PG Sales\.Order_Overview #a34ac53e$/m.test(text) &&
    /^E Customer #121f8e56 /m.test(text) && /^E Order #656610af /m.test(text),
    'flow, page and entity fingerprints are unchanged by the access and validation lines');
  const shapes = JSON.parse(await mx.evaluate(`(function () {
    var m = ${JSON.stringify(require('./model'))};
    m.entities.forEach(function (e) { if (e.name === 'Order') e.validations = [
      { attribute: 'Total', kind: 'range', message: 'Between nothing and the limit', min: { value: '0' }, max: { attribute: 'Limit' } },
      { attribute: 'Total', kind: 'range', message: null, min: null, max: { value: '10000' } },
      { attribute: 'Customer', kind: 'equals', message: 'Same as before\\nplease', to: { value: 'Known' } }]; });
    var p = MxDescribe.pack(MxDocsData.build(m, { name: 'Shapes' })).text;
    var bare = JSON.parse(JSON.stringify(m)); bare.entities.forEach(function (e) { e.accessRules = []; delete e.validations; });
    var q = MxDescribe.pack(MxDocsData.build(bare, { name: 'Shapes' })).text;
    function heads(t) { return t.split('\\n').filter(function (l) { return /^(E |### )/.test(l); }).join('\\n'); }
    return JSON.stringify({ lines: p.split('\\n').filter(function (l) { return /^  (access|valid) /.test(l); }), same: heads(p) === heads(q) });
  })()`));
  const want = [
    "  access Sales.Agent: read Number, Customer · write Customer · create · no delete · assoc read Order_Setting · assoc write Order_Setting — only [System.owner = '[%CurrentUser%]']",
    "  access Sales.Agent: read Number · write none · no create · no delete · assoc read none · assoc write none — only [System.owner/System.UserRoles/System.UserRole/Name = 'Administrator']",
    '  valid Total: range 0..attribute Limit — "Between nothing and the limit"',
    '  valid Total: range ≤ 10000',
    '  valid Customer: equals Known — "Same as before please"',
    '  access Sales.Agent: read all except Priority · write all except Priority · create · no delete — all rows'
  ];
  t.ok(want.every((l) => shapes.lines.indexOf(l) !== -1),
    'a role with two rules has two lines; the associations the entity owns are said apart; a range with an attribute bound, an open range, an equals; "all except" and "all rows": ' + JSON.stringify(shapes.lines));
  t.ok(shapes.same, 'and every entity, flow and page fingerprint is the same with or without access rules and validations');

  // ---- what a page shows and lets edit only on a condition (Karol, 2026-10-14) ----
  // Under the page's own lines: one line per widget shown or editable on a condition, with it.
  const pageBlock = (() => { const at = lines.indexOf('### PG Sales.Order_Overview #a34ac53e'); const out = []; for (let i = at + 1; i < lines.length && lines[i] !== ''; i++) out.push(lines[i]); return out; })();
  t.ok(JSON.stringify(pageBlock.filter((l) => /^ {2}\S/.test(l))) === JSON.stringify([
    '  editable Name (text box) — never',
    '  shows Cancel order (button) — when $currentObject/Number != empty',
    '  shows auditPanel (container) — for roles Sales.Auditor · holds Order number',
    "  editable Order number (text box) — when $currentObject/Number = empty or startsWith($currentObject/Number, 'DRAFT')"
  ]), 'a page lists the widgets it shows or lets edit only on a condition — an expression, module roles, never — and a hidden container what it hides: ' + JSON.stringify(pageBlock));
  t.ok(/"shows <widget>" is a widget visible only on a condition/.test(text), 'and the legend says what those lines are');
  const widgets = JSON.parse(await mx.evaluate(`(function () {
    var m = ${JSON.stringify(require('./model'))};
    var cond = { expression: "$Order/Status = Sales.ENUM_Status.Placed" };
    function btn(caption, visible) { var b = { kind: 'button', type: 'ActionButton', caption: caption }; if (visible) b.visible = visible; return b; }
    m.snippets = [{ qualifiedName: 'Sales.Address', name: 'Address', module: 'Sales', parameters: [], structure: { regions: [{ kind: 'region', name: 'Snippet', widgets: [
      { kind: 'input', type: 'Combo box', name: 'country', attribute: 'Sales.Address.Country', visible: { attribute: 'Sales.Address.IsAbroad', values: ['true'], of: '$Address' } },
      { kind: 'input', type: 'Text box', attribute: 'Sales.Address.Street' }] }] } }];
    var many = []; for (var i = 0; i < 205; i++) many.push(btn('B' + i, cond));
    m.pages[0].structure = { regions: [{ kind: 'region', name: 'Main', widgets: [
      { kind: 'tabs', type: 'TabControl', name: 'tabs1', widgets: [
        { kind: 'tab', caption: 'General', widgets: [btn('Cancel', cond)] },
        { kind: 'tab', caption: 'Refunds', visible: { roles: ['Sales.Manager'] }, widgets: [btn('Refund'), { kind: 'input', type: 'Text box', caption: 'Amount' }] }] },
      { kind: 'dataview', type: 'DataView', name: 'history', readOnly: true, widgets: [
        { kind: 'input', type: 'Date picker', caption: 'Delivery date' },
        { kind: 'snippet', type: 'SnippetCallWidget', snippet: 'Sales.Address' },
        btn('Cancel', { attribute: 'Sales.Order.Status', values: ['Placed', 'Confirmed'] })] },
      { kind: 'dataview', type: 'DataView', name: 'delivery', editableIf: { expression: '$Order/Shipped = false' }, widgets: [{ kind: 'input', type: 'Text box', attribute: 'Sales.Order.Address' }] },
      { kind: 'grid', type: 'LayoutGrid', name: 'grid1', widgets: [{ kind: 'row', widgets: [] }, { kind: 'row', visible: { attribute: 'Sales.Order.Paid', values: [] }, widgets: [] }] },
      { kind: 'container', type: 'DivContainer', name: 'lots', widgets: many }] }] };
    var data = MxDocsData.build(m, { name: 'Widgets' });
    var p = MxDescribe.pack(data).text;
    var bare = JSON.parse(JSON.stringify(m)); delete bare.pages[0].structure; delete bare.snippets;
    var q = MxDescribe.pack(MxDocsData.build(bare, { name: 'Widgets' })).text;
    function heads(t) { return t.split('\\n').filter(function (l) { return /^(E |### (MF|NF|PG) )/.test(l); }).join('\\n'); }
    var pl = p.split('\\n'), at = pl.findIndex(function (l) { return /^### PG Sales\\.Order_Overview /.test(l); }), sn = pl.indexOf('### SN Sales.Address');
    function block(from) { var out = []; for (var i = from + 1; i < pl.length && pl[i] !== ''; i++) out.push(pl[i]); return out; }
    return JSON.stringify({ page: block(at), snippet: sn === -1 ? null : block(sn), same: heads(p) === heads(q) });
  })()`));
  const wantPage = [
    '  shows Cancel (button) in General (tab) — when $Order/Status = Sales.ENUM_Status.Placed',
    '  shows Refunds (tab) — for roles Sales.Manager · holds Refund, Amount',
    '  read-only Delivery date (date picker) — inside history (data view), which is not editable',
    '  places Sales.Address (snippet) — see SN Sales.Address; inside history (data view), which is not editable, so neither are its inputs',
    '  shows Cancel (button) in history (data view) — when Sales.Order.Status is Placed or Confirmed',
    '  editable delivery (data view) — when $Order/Shipped = false (and the inputs inside it)',
    '  editable Address (text box) — when $Order/Shipped = false (from delivery (data view))',
    '  shows row 2 of grid1 (row) — when Sales.Order.Paid is none of its values (no value ticked)'
  ];
  t.ok(wantPage.every((l, i) => widgets.page.indexOf(l) !== -1 && (i === 0 || widgets.page.indexOf(l) > widgets.page.indexOf(wantPage[i - 1]))),
    'roles on a tab with what it hides, an input read-only from its data view, a data view editable on a condition, an attribute’s values, a grid row, two widgets of one caption told apart by where they are: ' + JSON.stringify(widgets.page.slice(0, 12)));
  t.ok(widgets.page.filter((l) => /^ {2}(shows|editable|read-only|places) /.test(l)).length === 200 && widgets.page[widgets.page.length - 1] === '  … 13 more widgets shown or editable on a condition',
    'a page lists 200 such widgets at the most, then says how many more: ' + widgets.page[widgets.page.length - 1]);
  t.ok(JSON.stringify(widgets.snippet) === JSON.stringify(['on pages: Order_Overview', '  shows Country (combo box) — when $Address/Sales.Address.IsAbroad is true']),
    'a snippet’s widgets are listed once, in its own block with the pages that place it: ' + JSON.stringify(widgets.snippet));
  t.ok(widgets.same, 'and no flow, page or entity fingerprint moves with these lines');

  // ---- the skill's checker reads the same pack ----
  const pack = readPack(text);
  const flowNames = Object.keys(pack.microflows);
  t.ok(flowNames.indexOf('Sales.CreateOrder') !== -1 && pack.microflows['Sales.CreateOrder'].hash.length === 8,
    'the skill’s checker reads the flows and fingerprints out of the exporter’s pack: ' + flowNames.join(', '));
  t.ok(Object.keys(pack.entities).sort().join(',') === 'Sales.Customer,Sales.OpenOrders,Sales.Order' && pack.entities['Sales.Customer'].hash === '121f8e56',
    'and the entities, the access and validation lines under them read as part of their entity: ' + Object.keys(pack.entities).join(', '));
  const before = todo(pack, null);
  t.ok(before.flows === flowNames.length + Object.keys(pack.nanoflows).length && before.overview,
    'with nothing described, todo lists every flow and the missing overview: ' + before.flows);

  // The application, its processes and its modules in the two layers of reference/business-narrative.md.
  const STORY = 'Sales is where the shop keeps its orders, from the moment a clerk opens one until it is paid and shipped. Without it the shop would track orders on paper, and nobody would know which customer is waiting for what.\n\n' +
    'A clerk opens a new order for a customer, adds what was bought, and saves it. The model does not show who approves large orders, if anyone does.';
  // An application's and a process's description run to hundreds of words (the checker warns below 300 and 150).
  const LONG = STORY.split('\n\n').map((para) => [para, para, para, para, para].join(' ')).join('\n\n');
  const FLOW2 = flowNames.filter((n) => n !== 'Sales.CreateOrder')[0];
  const desc = {
    format: 'mxscout-descriptions', version: 1, project: 'DescDemo', language: 'en', by: 'test agent',
    app: { summary: 'Takes orders and keeps them tidy.', story: LONG, audience: 'Sales staff.',
      processes: [{ name: 'Taking an order', summary: 'A clerk records an order.', story: LONG, steps: ['Open a new order', 'Save it'], flows: ['Sales.CreateOrder', FLOW2],
        // Karol, 2026-10-14: a process that branches gets a simplified diagram.
        diagram: [{ step: 'Opens a new order', who: 'Clerk' }, { decision: 'Is the customer known?', ways: [
          { label: 'no', then: [{ step: 'Asks for the customer’s details', who: 'Clerk' }], end: 'The order waits' }, { label: 'yes' }] },
          { decision: 'Paid in advance?', ways: [{ label: 'yes', join: 'Ships the order' }, { label: 'no' }] },
          { step: 'Numbers and saves the order', by: 'app' }, { step: 'Ships the order', who: 'Clerk' }, { end: 'Saved' }] }] },
    modules: { Sales: { summary: 'Orders and customers.', story: STORY } },
    microflows: { 'Sales.CreateOrder': { hash: pack.microflows['Sales.CreateOrder'].hash, text: 'Opens a fresh order for a customer.' } },
    // Ranked by reference/risk-levels.md, and the context a developer reads before a change.
    risks: [{ level: 'P2', title: 'An order can be saved twice', detail: 'Nothing stops a second click.', where: ['Sales.CreateOrder'], fix: 'Disable the button while the flow runs.' }],
    context: { where: [{ topic: 'Where an order starts', place: 'Sales.CreateOrder, from the order page.' }], conventions: [{ pattern: 'Create*', meaning: 'Makes a new record.' }], pitfalls: ['Saving outside Sales.CreateOrder skips the number.'] }
  };
  const after = todo(pack, desc);
  t.ok(after.flows === before.flows - 1 && !after.overview && !after.overviewStory && after.shortModules.length === 0, 'a described flow drops off the list: ' + after.flows + ' left');
  t.ok(check(pack, desc).filter((p) => p.level === 'error').length === 0, 'a correct file passes the check');
  t.ok(check(pack, desc).filter((p) => /story/.test(p.text)).length === 0, 'and both layers are there for the application, its process and its module');
  const thin = JSON.parse(JSON.stringify(desc));
  thin.app.story = STORY; thin.app.processes[0].story = STORY; thin.app.processes[0].flows = ['Sales.CreateOrder'];
  const thinWarn = check(pack, thin).map((p) => p.text);
  t.ok(thinWarn.some((x) => /^app: the story is \d+ words/.test(x)) && thinWarn.some((x) => /^process "Taking an order": the story is \d+ words — a process follows one case/.test(x)) &&
    thinWarn.some((x) => /^process "Taking an order": 1 flow listed/.test(x)),
    'a process told in a paragraph, an overview that is a summary and a process with one flow are warned about: ' + JSON.stringify(thinWarn.filter((x) => /words|flow listed/.test(x))));
  const short = JSON.parse(JSON.stringify(desc));
  delete short.app.story; short.modules.Sales = 'Orders and customers.';
  const shortWarn = check(pack, short).filter((p) => /no "story"/.test(p.text)).map((p) => p.text.split(':')[0]);
  t.ok(shortWarn.indexOf('app') !== -1 && shortWarn.indexOf('modules Sales') !== -1 && todo(pack, short).shortModules[0] === 'Sales' && todo(pack, short).overviewStory,
    'a summary without its long description is flagged, by check and by todo: ' + JSON.stringify(shortWarn));
  const listy = JSON.parse(JSON.stringify(desc));
  listy.app.story = '- orders\n- customers\n- **payments**';
  t.ok(check(pack, listy).some((p) => /app: the story carries markup/.test(p.text)), 'and a story written as a list is flagged: it is shown as text');
  // Karol, 2026-10-14: a process told too briefly. Its steps are sentences saying who does what — as many as the
  // case has: no count is asked for, a bare label and a process of one step are flagged.
  t.ok(check(pack, desc).some((p) => /process "Taking an order": 1 step is a label \("Save it"\)/.test(p.text)) &&
    !check(pack, desc).some((p) => /process "Taking an order": 2 steps/.test(p.text)),
    'a step that is a bare label is flagged, the number of steps is not: ' + JSON.stringify(check(pack, desc).filter((p) => /step/.test(p.text)).map((p) => p.text)));
  const oneStep = JSON.parse(JSON.stringify(desc)); oneStep.app.processes[0].steps = ['A clerk opens a new order'];
  t.ok(check(pack, oneStep).some((p) => /process "Taking an order": 1 step — a reader follows the case/.test(p.text)), 'a process of one step is flagged');
  const stale = JSON.parse(JSON.stringify(desc));
  stale.microflows['Sales.CreateOrder'].hash = '00000000';
  t.ok(check(pack, stale).some((p) => p.level === 'warning' && /does not match/.test(p.text)) && todo(pack, stale).flows === before.flows,
    'a fingerprint that moved is flagged, and the flow is back on the list');
  const invented = JSON.parse(JSON.stringify(desc));
  invented.microflows['Sales.NoSuchFlow'] = { hash: 'abcdef12', text: 'Made up.' };
  t.ok(check(pack, invented).some((p) => p.level === 'error' && /Sales\.NoSuchFlow/.test(p.text)), 'a name that is not in the pack is an error');
  const merged = merge([{ format: 'mxscout-descriptions', version: 1, microflows: { 'Sales.A': 'one' } }, desc]);
  t.ok(merged.microflows['Sales.A'] === 'one' && merged.microflows['Sales.CreateOrder'] && merged.app, 'merge joins parts into one file');
  const unranked = JSON.parse(JSON.stringify(desc));
  unranked.risks.push({ level: 'High', title: 'Something', where: ['Sales.Nowhere'] });
  const rp = check(pack, unranked).map((p) => p.level + ' ' + p.text);
  t.ok(rp.some((p) => /^error .*"level" must be/.test(p)) && rp.some((p) => /no "fix"/.test(p)) && rp.some((p) => /Sales\.Nowhere, which is not in the pack/.test(p)),
    'a risk without a P1–P3 level is an error, one without a fix or with an unknown place a warning: ' + rp.filter((p) => /risks/.test(p)).length);
  const parts = merge([desc, { risks: [{ level: 'P1', title: 'Another' }, { level: 'P2', title: 'An order can be saved twice', fix: 'newer' }], context: { pitfalls: ['Saving outside Sales.CreateOrder skips the number.', 'A second pitfall.'] } }]);
  t.ok(parts.risks.length === 2 && parts.risks.find((r) => r.title === 'An order can be saved twice').fix === 'newer' && parts.context.pitfalls.length === 2 && parts.context.where.length === 1,
    'merge adds the parts’ risks and context up, a risk written twice kept once');
  t.ok(todo(pack, { format: 'mxscout-descriptions', version: 1 }).risks && !todo(pack, desc).risks && !todo(pack, desc).context, 'todo says whether risks and context are written');

  // ---- one more process, asked for after reading (Karol, 2026-10-14) ----
  // A part that says "add": true carries the one process and the flows on its way. The checker does not ask it
  // for the application's own layers; merge adds the process to the ones kept, and MxScout does the same on import.
  const STEPS = ['A clerk opens a new order for a customer', 'The clerk saves the order and it gets a number', 'A manager reviews orders still waiting', 'The order is closed when it is paid'];
  const addPart = { format: 'mxscout-descriptions', version: 1, add: true,
    app: { processes: [{ name: 'Numbering an order', summary: 'Every saved order gets the next number.', story: LONG, steps: STEPS, flows: ['Sales.CreateOrder', FLOW2] }] },
    microflows: { 'Sales.CreateOrder': { text: 'Opens an order and numbers it.' } } };
  const addProblems = check(pack, addPart).map((p) => p.text);
  t.ok(!addProblems.some((x) => /^app[.:]/.test(x)) && !addProblems.some((x) => /Numbering an order/.test(x)),
    'a part that adds one process is not asked for the application’s summary or story: ' + JSON.stringify(addProblems));
  const grown = merge([desc, addPart]);
  t.ok(grown.app.summary === desc.app.summary && grown.app.processes.map((x) => x.name).join('|') === 'Taking an order|Numbering an order' && grown.microflows['Sales.CreateOrder'].text === 'Opens an order and numbers it.',
    'merge adds the process after the ones kept and keeps the application’s own text: ' + JSON.stringify(grown.app.processes.map((x) => x.name)));
  const again = merge([grown, Object.assign({}, addPart, { app: { processes: [Object.assign({}, addPart.app.processes[0], { name: 'numbering an ORDER', summary: 'Told again.' })] } })]);
  t.ok(again.app.processes.length === 2 && again.app.processes[1].summary === 'Told again.', 'the same process told again replaces itself, whatever its case');
  const onImport = JSON.parse(await mx.evaluate(`(function () {
    var base = MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value;
    var more = MxDescribe.parse(${JSON.stringify(JSON.stringify(addPart))}).value;
    var whole = MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value;
    var m = MxDescribe.merge(base, more);
    return JSON.stringify({ add: more.add, plain: whole.add === undefined, procs: m.app.processes.map(function (p) { return p.name; }), summary: m.app.summary === base.app.summary,
      risks: m.risks.length === base.risks.length, flow: m.microflows['Sales.CreateOrder'].text, flag: m.add === undefined, untouched: base.app.processes.length });
  })()`));
  t.ok(onImport.add === true && onImport.plain && onImport.procs.join('|') === 'Taking an order|Numbering an order' && onImport.summary && onImport.risks && onImport.flow === 'Opens an order and numbers it.' && onImport.flag && onImport.untouched === 1,
    'MxScout reads "add" and lays the part over what it keeps, the rest as it was and the kept copy untouched: ' + JSON.stringify(onImport));

  // The overview written again from the start: "replace": ["app"] puts it in place of the one kept, processes and all.
  const anew = JSON.parse(await mx.evaluate(`(function () {
    var base = MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value;
    var more = MxDescribe.parse(${JSON.stringify(JSON.stringify(Object.assign({}, addPart, { replace: ['app'], app: { summary: 'New summary.', story: STORY, processes: addPart.app.processes } })))}).value;
    var plainAdd = MxDescribe.parse(${JSON.stringify(JSON.stringify(Object.assign({}, desc, { replace: ['app'] })))}).value;
    var m = MxDescribe.merge(base, more);
    return JSON.stringify({ procs: m.app.processes.map(function (p) { return p.name; }), summary: m.app.summary, flows: Object.keys(m.microflows).length === Object.keys(base.microflows).length, risks: m.risks.length, flag: m.replace === undefined, ignored: plainAdd.replace === undefined });
  })()`));
  t.ok(anew.procs.join('|') === 'Numbering an order' && anew.summary === 'New summary.' && anew.flows && anew.risks === 1 && anew.flag && anew.ignored,
    '"replace": ["app"] puts the new overview in place of the kept one, its processes only, the rest kept; without "add" it means nothing: ' + JSON.stringify(anew));
  t.ok(merge([desc, Object.assign({}, addPart, { replace: ['app'] })]).app.processes.map((x) => x.name).join('|') === 'Numbering an order', 'and merge does the same');

  // ---- the checker's merge and MxScout's import end the same (review, 2026-10-14) ----
  // The same files both ways: the checker merges them into one file which MxScout then reads, and MxScout lays
  // each one over what it keeps, one by one. Who uses it given by a part that adds, a risk told again under
  // another level and in other words' case and spacing, context already kept: the two must not drift apart.
  const P1 = { format: 'mxscout-descriptions', version: 1, add: true, language: 'pl', by: 'another agent', written: '2026-10-14',
    app: { audience: 'Clerks and their managers.', processes: [Object.assign({}, addPart.app.processes[0]), Object.assign({}, desc.app.processes[0], { name: 'taking an ORDER', summary: 'Told again.' })] },
    risks: [{ level: 'P2', title: ' an order can be SAVED  twice', detail: 'Told again.', where: ['Sales.CreateOrder'], fix: 'Lock it.' }, { id: 'p3-new-one', level: 'P3', title: 'A new one', fix: 'Look.' }],
    context: { where: [desc.context.where[0], { topic: 'Where an order ends', place: FLOW2 }], pitfalls: [desc.context.pitfalls[0], 'A second pitfall.', 'A second pitfall.'] },
    microflows: { [FLOW2]: { text: 'Closes an order.' } } };
  const P2 = { format: 'mxscout-descriptions', version: 1, add: true,
    app: { audience: [{ who: 'Clerks', what: 'Take the orders.' }], processes: [Object.assign({}, addPart.app.processes[0], { summary: 'Told a third time.' })] },
    risks: [{ id: 'p3-new-one', level: 'P1', title: 'A new one, ranked up', fix: 'Look closer.' }], context: { conventions: [desc.context.conventions[0], { pattern: 'Close*', meaning: 'Ends a record.' }] } };
  const viaChecker = merge([desc, P1, P2]);
  const allAdd = merge([P1, P2]);
  t.ok(viaChecker.add === undefined && allAdd.add === true && allAdd.replace === undefined && merge([P1, Object.assign({}, P2, { replace: ['app'] })]).replace.join() === 'app',
    'merge writes "add": true when every part adds and none is a whole file under them, and keeps "replace" with it: ' + JSON.stringify([viaChecker.add, allAdd.add]));
  const parity = JSON.parse(await mx.evaluate(`(function () {
    function canon(v) {
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      if (v && typeof v === 'object') return '{' + Object.keys(v).filter(function (k) { return ['add', 'replace', 'risksListed', 'verify'].indexOf(k) === -1 && v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
      return JSON.stringify(v);
    }
    function read(f) { return MxDescribe.parse(JSON.stringify(f)).value; }
    var base = ${JSON.stringify(desc)}, p1 = ${JSON.stringify(P1)}, p2 = ${JSON.stringify(P2)};
    var oneByOne = MxDescribe.merge(MxDescribe.merge(read(base), read(p1)), read(p2));
    var merged = read(${JSON.stringify(viaChecker)});
    var kept = read(base);
    var addsOneByOne = MxDescribe.merge(MxDescribe.merge(kept, read(p1)), read(p2));
    var addsMerged = MxDescribe.merge(kept, read(${JSON.stringify(allAdd)}));
    return JSON.stringify({ same: canon(oneByOne) === canon(merged), sameAdds: canon(addsOneByOne) === canon(addsMerged),
      a: canon(oneByOne).slice(0, 4000), b: canon(merged).slice(0, 4000),
      users: oneByOne.app.users.map(function (u) { return u.who; }), audience: oneByOne.app.audience, language: oneByOne.language, written: oneByOne.written,
      procs: oneByOne.app.processes.map(function (p) { return p.name + ':' + p.summary; }),
      risks: oneByOne.risks.map(function (r) { return r.level + ':' + r.title; }),
      pitfalls: oneByOne.context.pitfalls.length, where: oneByOne.context.where.length, conventions: oneByOne.context.conventions.length });
  })()`));
  t.ok(parity.same && parity.sameAdds, 'the checker’s merge and MxScout’s import give the same descriptions on the same files — over a whole file, and as parts that only add' +
    (parity.same && parity.sameAdds ? '' : ': ' + JSON.stringify(parity)));
  t.ok(parity.users.join() === 'Clerks' && parity.audience === null && parity.language === 'en' && parity.written === '2026-10-14',
    'who uses it, given by a part that adds, replaces what was kept; the language stays the first file’s, the date is the last: ' + JSON.stringify([parity.users, parity.language, parity.written]));
  t.ok(parity.procs.join('|') === 'taking an ORDER:Told again.|Numbering an order:Told a third time.',
    'a process told again takes its place, a new one goes at the end: ' + JSON.stringify(parity.procs));
  t.ok(parity.risks.join('|') === 'P2:an order can be SAVED  twice|P1:A new one, ranked up',
    'a risk told again — by its id at another level and in other words, or by its level and title in another case — takes the place of the one kept, the later copy winning: ' + JSON.stringify(parity.risks));
  t.ok(parity.pitfalls === 2 && parity.where === 2 && parity.conventions === 2, 'and the developers’ context adds up without repeating what is kept: ' + JSON.stringify([parity.pitfalls, parity.where, parity.conventions]));

  // ---- what MxScout keeps, and the checker says so (review, 2026-10-14) ----
  // One file over every bound the checker knows; MxScout's parse cuts it to exactly those numbers.
  const C = CAPS, chars = (n, ch) => (ch || 'x').repeat(n + 25);
  const many = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i));
  let nest = [{ end: 'Bottom' }];
  for (let i = 0; i < C.diagram.depth + 3; i++) nest = [{ decision: 'Level ' + i + '?', ways: [{ label: 'a', then: nest }, { label: 'b' }] }];
  const over = { format: 'mxscout-descriptions', version: 1, project: chars(C.file.project),
    app: { summary: chars(C.app.summary), audience: many(C.app.audience, (i) => ({ who: chars(C.app.who), what: chars(C.app.what) })),
      processes: [{ name: chars(C.process.name), summary: 'S.', steps: many(C.process.steps, () => chars(C.process.step)), flows: many(C.process.flows, () => chars(C.process.flow)),
        diagram: many(C.diagram.items, (i) => (i ? { step: chars(C.diagram.step), who: chars(C.diagram.who) } : { decision: chars(C.diagram.decision), ways: many(C.diagram.ways, () => ({ label: chars(C.diagram.label), end: chars(C.diagram.end) })) }))
      }].concat(many(C.app.processes, (i) => ({ name: 'P' + i }))) },
    modules: { Sales: { summary: chars(C.table.text), notes: many(C.notes.sections, (i) => (i ? { title: 'T' + i, text: 'x' } : { title: chars(C.notes.title), items: many(C.notes.items, () => chars(C.notes.item)),
      table: { columns: many(C.notes.columns, () => chars(C.notes.column)), rows: many(C.notes.rows, () => many(C.notes.columns, () => chars(C.notes.cell))) } })) } },
    c4: { context: { nodes: many(C.c4.nodes, (i) => ({ id: 'n' + i + 'a'.repeat(C.c4.id), name: chars(C.c4.name) })), links: many(C.c4.links, () => ({ from: 'n0' + 'a'.repeat(C.c4.id), to: 'n1' + 'a'.repeat(C.c4.id) })) },
      open: many(C.c4.open, () => chars(C.c4.question)) },
    risks: many(C.risks.list, (i) => (i ? { level: 'P3', title: 'R' + i } : { level: 'P1', title: chars(C.risks.title), where: many(C.risks.where, () => chars(C.risks.place)) })),
    context: { where: many(C.context.list, (i) => ({ topic: chars(C.context.key), place: 'p' + i })), conventions: many(C.context.list, (i) => ({ pattern: 'c' + i, meaning: chars(C.context.text) })), pitfalls: many(C.context.list, (i) => 'Pitfall ' + i) },
    changes: many(C.changes.list, (i) => ({ id: 'c' + i, title: 'Change ' + i, now: {}, proposal: i ? {} : { changes: many(C.changes.changes, () => ({ kind: 'microflow', target: chars(C.changes.target), action: 'add' })) },
      risks: i ? [] : many(C.changes.risks, () => ({ level: 'P2', title: 'r' })), open: i ? [] : many(C.changes.open, () => 'Q?') })),
    tickets: many(C.tickets.list, (i) => ({ id: 'T-' + i, title: 'Ticket ' + i, verdict: 'cannot-tell', summary: 'S.', reported: i ? 'x' : chars(C.tickets.reported),
      evidence: i ? [] : many(C.tickets.evidence, () => ({ kind: 'microflow', target: 'Sales.X' })), needs: i ? [] : many(C.tickets.needs, () => 'Logs.') })) };
  const probes = [
    ['project', 'v.project.length', C.file.project, /^"project" is \d+ characters — MxScout keeps 200; the rest is cut off\.$/],
    ['app summary', 'v.app.summary.length', C.app.summary, /^app\.summary is \d+ characters/],
    ['audience groups', 'v.app.users.length', C.app.audience, /^app\.audience: 31 entries — MxScout keeps 30; the rest is dropped\.$/],
    ['a group’s who', 'v.app.users[0].who.length', C.app.who, /^app\.audience\[0\]\.who is/],
    ['processes', 'v.app.processes.length', C.app.processes, /^app\.processes: \d+ entries — MxScout keeps 200/],
    ['a process’s name', 'v.app.processes[0].name.length', C.process.name, / name is \d+ characters/],
    ['steps', 'v.app.processes[0].steps.length', C.process.steps, / steps: 101 entries/],
    ['a step', 'v.app.processes[0].steps[0].length', C.process.step, / steps\[0\] is/],
    ['flows', 'v.app.processes[0].flows.length', C.process.flows, / flows: 61 entries/],
    ['diagram items', 'v.app.processes[0].diagram.length', C.diagram.items, / diagram: 61 entries/],
    ['ways', 'v.app.processes[0].diagram[0].ways.length', C.diagram.ways, / diagram\[0\]\.ways: 7 entries/],
    ['a step’s who', 'v.app.processes[0].diagram[1].who.length', C.diagram.who, / diagram\[1\]\.who is/],
    ['a module’s summary', 'v.modules.Sales.text.length', C.table.text, /^modules Sales is \d+ characters/],
    ['note sections', 'v.modules.Sales.notes.length', C.notes.sections, / notes: 17 entries/],
    ['note items', 'v.modules.Sales.notes[0].items.length', C.notes.items, / notes\[0\]\.items: 61 entries/],
    ['table columns', 'v.modules.Sales.notes[0].table.columns.length', C.notes.columns, /\.table\.columns: 7 entries/],
    ['table rows', 'v.modules.Sales.notes[0].table.rows.length', C.notes.rows, /\.table\.rows: 81 entries/],
    ['a cell', 'v.modules.Sales.notes[0].table.rows[0][0].length', C.notes.cell, /\.table\.rows\[0\]\[0\] is/],
    ['nodes', 'v.c4.context.nodes.length', C.c4.nodes, /^c4\.context\.nodes: 101 entries/],
    ['a node’s id', 'v.c4.context.nodes[0].id.length', C.c4.id, /^c4\.context\.nodes\[0\]\.id is/],
    ['a node’s name', 'v.c4.context.nodes[0].name.length', C.c4.name, /^c4\.context\.nodes\[0\]\.name is/],
    ['open questions', 'v.c4.open.length', C.c4.open, /^c4\.open: 31 entries/],
    ['risks', 'v.risks.length', C.risks.list, /^"risks": 2001 entries/],
    ['where per risk', 'v.risks[0].where.length', C.risks.where, /^risks\[0\]\.where: 41 entries/],
    ['context lists', 'v.context.where.length + v.context.conventions.length + v.context.pitfalls.length', 3 * C.context.list, /^context\.pitfalls: 81 entries/],
    ['changes', 'v.changes.length', C.changes.list, /^"changes": 101 entries/],
    ['model changes', 'v.changes[0].proposal.changes.length', C.changes.changes, /proposal\.changes: 61 entries/],
    ['a change’s risks', 'v.changes[0].risks.length', C.changes.risks, /^change "c0" risks: 31 entries/],
    ['a change’s questions', 'v.changes[0].open.length', C.changes.open, /^change "c0" open: 31 entries/],
    ['tickets', 'v.tickets.length', C.tickets.list, /^"tickets": 201 entries/],
    ['a ticket as reported', 'v.tickets[0].reported.length', C.tickets.reported, /^ticket "T-0" reported is/],
    ['evidence', 'v.tickets[0].evidence.length', C.tickets.evidence, /^ticket "T-0" evidence: 61 entries/],
    ['needs', 'v.tickets[0].needs.length', C.tickets.needs, /^ticket "T-0" needs: 31 entries/]
  ];
  const measured = JSON.parse(await mx.evaluate(`(function () {
    var v = MxDescribe.parse(${JSON.stringify(JSON.stringify(over))}).value;
    var deep = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, app: { processes: [{ name: 'Deep', diagram: ${JSON.stringify(nest)} }] } })).value;
    function levels(items) { var d = 0; items.forEach(function (x) { if (x.t === 'decision') x.ways.forEach(function (w) { d = Math.max(d, 1 + levels(w.items)); }); }); return d; }
    return JSON.stringify({ got: [${probes.map((p) => p[1]).join(', ')}], deep: levels(deep.app.processes[0].diagram) });
  })()`));
  const overWarn = check(pack, over).filter((p) => /MxScout keeps/.test(p.text)).map((p) => p.text);
  const off = probes.filter((p, i) => measured.got[i] !== p[2]).map((p, i) => p[0] + ' ' + measured.got[probes.indexOf(p)] + '≠' + p[2]);
  t.ok(!off.length && measured.deep === C.diagram.depth + 1,
    'every bound the checker knows is the one MxScout’s import keeps (' + probes.length + ' of them, and a diagram ' + C.diagram.depth + ' levels deep)' + (off.length ? ': ' + JSON.stringify(off) : ''));
  const unsaid = probes.filter((p) => !overWarn.some((x) => p[3].test(x))).map((p) => p[0]);
  t.ok(!unsaid.length && check(pack, { format: 'mxscout-descriptions', version: 1, app: { processes: [{ name: 'Deep', diagram: nest }] } }).some((p) => /nested 7 deep — MxScout keeps 6 levels/.test(p.text)),
    'and the checker warns about each one a file goes past, saying what MxScout keeps' + (unsaid.length ? ': not said — ' + JSON.stringify(unsaid) : ''));
  t.ok(!check(pack, desc).some((p) => /MxScout keeps/.test(p.text)), 'a file within the bounds gets none of those warnings');
  const longId = 'p1-' + 'a'.repeat(78);
  const ids = JSON.parse(await mx.evaluate(`JSON.stringify(MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, risks: [{ id: '${longId}', level: 'P1', title: 'Long' }, { id: '${longId.slice(0, 80)}', level: 'P1', title: 'Just right' }] })).value.risks.map(function (r) { return r.id && r.id.length; }))`));
  const carried = merge([{ format: 'mxscout-descriptions', version: 1, add: true, verify: [{ id: 'c-1', still: true, why: 'a' }] }, { format: 'mxscout-descriptions', version: 1, add: true, verify: [{ id: 'c-1', still: false, why: 'b' }, { id: 'c-2', still: true }] }]);
  t.ok(JSON.stringify(ids) === '[null,80]' && check(pack, { format: 'mxscout-descriptions', version: 1, risks: [{ id: longId, level: 'P1', title: 'Long', fix: 'x' }] }).some((p) => p.level === 'error' && /at most 80 characters/.test(p.text)) &&
    carried.verify.map((v) => v.id + ':' + v.still).join() === 'c-1:false,c-2:true',
    'a risk id over 80 characters is dropped by the import and refused by the checker, and merge carries "verify" by id, the later word winning: ' + JSON.stringify([ids, carried.verify]));

  // ---- what the import ignores, said by the checker ----
  const odd = JSON.parse(JSON.stringify(desc));
  odd.replace = ['app'];
  odd.app.processes[0].diagram[0].by = 'robot';
  odd.app.processes[0].diagram[1].ways[0].join = 'Ships the order';
  const oddWarn = check(pack, odd).map((p) => p.level + ' ' + p.text);
  t.ok(oddWarn.some((x) => /^warning "replace" without "add": true — MxScout ignores it/.test(x)) &&
    oddWarn.some((x) => /^warning process "Taking an order": diagram\[0\] has "by": "robot" — it is "person" or "app"/.test(x)) &&
    oddWarn.some((x) => /^warning process "Taking an order": diagram\[1\]\.ways\[0\] has both "end" and "join"/.test(x)),
    '"replace" without "add", a step "by" something other than a person or the app, and a way that both ends and joins are warned about: ' + JSON.stringify(oddWarn.filter((x) => /replace|by|join/.test(x))));

  // ---- MxScout's own reading of the file ----
  const refused = await mx.evaluate(`JSON.stringify([MxDescribe.parse('nope').error, MxDescribe.parse('{"format":"other"}').error, MxDescribe.parse('{"format":"mxscout-descriptions","version":1}').error])`);
  t.ok(JSON.parse(refused).every(Boolean), 'MxScout refuses a file that is not JSON, not this format, or empty, each with a reason: ' + refused);
  const kept = await mx.evaluate(`(function () {
    var p = MxDescribe.parse(${JSON.stringify(JSON.stringify(Object.assign({}, desc, { microflows: Object.assign({}, desc.microflows, { 'Sales.X': { text: '<img src=x onerror=alert(1)>' } }) })))});
    return p.value && p.value.microflows['Sales.CreateOrder'].text;
  })()`);
  t.ok(kept === 'Opens a fresh order for a customer.', 'and keeps a good one as text');

  // Imported into the project, it reaches the documentation, marked as AI.
  await mx.evaluate(`MxStore.put('descriptions', { projectId: 'pdesc', importedAt: new Date().toISOString(), fileName: 'descriptions.json', value: MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value })`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'DescDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'DescDemo').click()`);
  await goToSection(mx, 'Documentation', '.docs-ai-status');
  const status = await mx.evaluate(`document.querySelector('.docs-ai-status').textContent`);
  t.ok(/1 of \d+ flows described/.test(status) && /main processes/.test(status), 'the section says how much is described: ' + status.slice(0, 120));
  const data = await mx.evaluate(`JSON.stringify((function(){ var d = MxDocs.current(); return { desc: d.flows['microflow:Sales.CreateOrder'].desc, stale: d.flows['microflow:Sales.CreateOrder'].descStale, app: !!(d.ai && d.ai.app) }; })())`);
  const D = JSON.parse(data);
  t.ok(D.desc === 'Opens a fresh order for a customer.' && D.stale === false && D.app, 'the documentation carries the descriptions, current, and the overview');
  await goToDocsTab(mx, 'export', '.docs-shot');
  t.ok(await mx.waitFor(`!!document.querySelector('.docs-shot .dx-ov-lead')`, 5000, 'preview') &&
    await mx.evaluate(`document.querySelector('.docs-shot .dx-ov-lead').textContent`) === 'Takes orders and keeps them tidy.',
    'the overview leads with the application’s summary');
  t.ok(await mx.evaluate(`/written from it by an agent \\(test agent\\)/.test(document.querySelector('.docs-shot .dx-ov-prov').textContent)`),
    'and says the texts were written by an agent, naming it — it no longer claims nothing in it was written by a machine');

  // The two layers on screen: the summary on the overview, the whole story on Processes, under the application.
  const shown = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var host = document.createElement('div'); document.body.appendChild(host);
    var v = MxDocsView.mount(MxDocs.current(), host, { preview: true, state: { view: 'processes', proc: 0 } });
    var r = { lead: host.querySelector('.dx-pd-lead').textContent, paras: host.querySelectorAll('.dx-pd-story p').length,
      who: host.querySelector('.dx-pd-who') && host.querySelector('.dx-pd-who').textContent };
    v.go({ proc: 1 });
    r.procParas = host.querySelectorAll('.dx-pd-story p').length;
    r.steps = Array.from(host.querySelectorAll('.dx-pd-steps li')).map(function (li) { return li.textContent; });
    var g = host.querySelector('.dx-pd-diagram .fg');
    r.diagram = g ? { cards: Array.from(g.querySelectorAll('.fg-card .fg-main')).map(function (x) { return x.textContent; }), who: Array.from(g.querySelectorAll('.fg-card .fg-kind')).map(function (x) { return x.textContent; }),
      decision: (g.querySelector('.fg-decision .fg-dec-title') || {}).textContent, sideEnd: (g.querySelector('.fg-side-end') || {}).textContent,
      label: (g.querySelector('.fg-side .fg-label') || {}).textContent, end: (g.querySelector('.fg-pill.fg-end') || {}).textContent,
      join: Array.from(g.querySelectorAll('.fg-side .fg-rejoin')).map(function (x) { return x.textContent; }) } : null;
    host.remove();
    return r;
  })())`));
  t.ok(shown.lead === 'Takes orders and keeps them tidy.' && shown.paras === 2 && shown.who === 'Who uses it. Sales staff.',
    'the application’s page on Processes has its summary, who uses it, and the whole description in its paragraphs: ' + JSON.stringify(shown));
  const mod = JSON.parse(await mx.evaluate(`JSON.stringify(MxDocs.current().ai.modules.Sales)`));
  t.ok(mod && mod.summary === 'Orders and customers.' && /paid and shipped/.test(mod.story), 'a module carries both layers into the documentation');
  const old = await mx.evaluate(`(function () { var v = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, modules: { Sales: 'Orders and customers.' } })).value; return v && v.modules.Sales.text; })()`);
  t.ok(old === 'Orders and customers.', 'and a file from before the two layers, a module as one string, is still read — as its summary');
  t.ok(shown.procParas === 2 && shown.steps.join('|') === '1Open a new order|2Save it', 'a process has its own description, and its steps numbered from 1');
  const dg = shown.diagram;
  t.ok(dg && dg.cards.slice().sort().join('|') === 'Asks for the customer’s details|Numbers and saves the order|Opens a new order|Ships the order' && dg.who.slice().sort().join('|') === 'Application|Clerk|Clerk|Clerk' &&
    dg.join.indexOf('continues at step 6') !== -1 &&
    dg.decision === 'Is the customer known?' && dg.label === 'no' && /The order waits/.test(dg.sideEnd) && /Saved/.test(dg.end),
    'its diagram is drawn as a flow is: the main path down, the way that ends to the side, who takes each step: ' + JSON.stringify(dg));
  const straight = JSON.parse(JSON.stringify(desc)); straight.app.processes[0].diagram = [{ step: 'Opens it' }, { end: 'Done' }];
  const broken = JSON.parse(JSON.stringify(desc)); broken.app.processes[0].diagram = [{ step: 'Opens it' }, { note: 'x' }];
  t.ok(check(pack, straight).some((x) => /its diagram has no decision/.test(x.text)) && check(pack, broken).some((x) => x.level === 'error' && /diagram\[1\] is neither/.test(x.text)) &&
    !check(pack, desc).some((x) => /diagram/.test(x.text)), 'the checker asks to leave out a diagram with no decision, and refuses an item it does not know');
  await goToDocsTab(mx, 'manual', '.docs-ai');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.docs-ai button')).find(b => b.textContent === 'Export AI pack')`), 'the pack is one button away');

  // Risks and the developer's context: kept as text, each on a page of its own, names as links.
  const extra = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var d = MxDocs.current(), host = document.createElement('div');
    document.body.appendChild(host);
    var v = MxDocsView.mount(d, host, { preview: true, state: { view: 'risks' } });
    var nav = Array.from(host.querySelectorAll('.dx-nav-item')).map(function (b) { return b.textContent; });
    var risk = host.querySelector('.dx-rk-detail');
    var r = { nav: nav, title: risk && risk.querySelector('h2').textContent, lv: risk && risk.querySelector('.dx-rk-sev').textContent, link: !!(risk && risk.querySelector('button.dx-rk-where')),
      fix: risk && /What to do/.test(risk.querySelector('.dx-rk-fix').textContent) && /Disable the button/.test(risk.querySelector('.dx-rk-fix').textContent),
      ai: /An agent read the model and wrote this finding/.test(risk.querySelector('.dx-rk-foot').textContent) };
    v.go({ view: 'dev' });
    r.dev = Array.from(host.querySelectorAll('.dx-dv-tab')).map(function (x) { return x.firstChild.firstChild.textContent; });
    r.devLinks = host.querySelectorAll('.dx-dv-list .dx-code.link').length;
    r.status = document.querySelector('.docs-ai-status').textContent;
    var dropped = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, risks: [{ level: 'P7', title: 'x' }, { level: 'P1', title: '<b>y</b>' }] })).value;
    r.kept = dropped.risks.map(function (x) { return x.level + ':' + x.title; });
    var old = JSON.parse(JSON.stringify(d)); delete old.ai.risks; delete old.ai.context;
    var h2 = document.createElement('div'); MxDocsView.mount(old, h2, { preview: true });
    r.oldNav = Array.from(h2.querySelectorAll('.dx-nav-item')).length;
    host.remove();
    return r;
  })())`));
  t.ok(extra.nav.some((n) => /^Risks1$/.test(n)) && extra.nav.some((n) => /^For developers\d+$/.test(n)), 'the documentation gets a Risks page and a page for developers: ' + JSON.stringify(extra.nav));
  t.ok(extra.title === 'An order can be saved twice' && /^P2Functional errors$/.test(extra.lv) && extra.link && extra.fix && extra.ai, 'a risk shows its level, its places as links and what to do, and says an agent wrote it: ' + JSON.stringify(extra));
  t.ok(extra.dev.join('|') === 'Where things are|Naming|Before you change' && extra.devLinks >= 1, 'the developer page has its three parts as tabs, names inside sentences linked: ' + extra.devLinks);
  t.ok(/1 risk/.test(extra.status) && /notes for developers/.test(extra.status), 'the section counts them');
  t.ok(extra.kept.join() === 'P1:<b>y</b>', 'a risk with a level outside P1–P3 is dropped, and a title is kept as text');
  t.ok(extra.oldNav === 9, 'a file imported before risks existed adds no empty pages — its processes and Architecture are there, Risks and For developers are not: ' + extra.oldNav);

  // A flow that changed after it was described says so.
  const marked = await mx.evaluate(`(function(){ var d = MxDocs.current(); var x = JSON.parse(JSON.stringify(d)); var v = MxDescribe.parse(${JSON.stringify(JSON.stringify(stale))}).value; MxDescribe.attach(x, v); return x.flows['microflow:Sales.CreateOrder'].descStale; })()`);
  t.ok(marked === true, 'a description whose flow changed since is marked out of date, not passed off as current');

  // The exported page says the language the descriptions are written in, when it is a language tag (review, 2026-10-14).
  const langs = JSON.parse(await mx.evaluate(`JSON.stringify(['pl', 'en-GB', 'Polish', '"><b>', null].map(function (l) {
    var d = JSON.parse(JSON.stringify(MxDocs.current())); d.ai = Object.assign({}, d.ai, { language: l });
    return /^<!doctype html>\\n<html lang="([^"]*)">/.exec(MxDocsFile.build(d, '', 'x', []))[1];
  }).concat([/^<!doctype html>\\n<html lang="([^"]*)">/.exec(MxDocsFile.build(MxDocs.current(), '', 'x', [], 'de'))[1]]))`));
  t.ok(langs.join() === 'pl,en-GB,en,en,en,de', 'the exported file’s language is the descriptions’, when it is a language tag, and English otherwise: ' + JSON.stringify(langs));
  await mx.close();
};
