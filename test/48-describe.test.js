/* Descriptions written by an AI agent (public/describe.js and skills/mendix-describe).
 *
 * MxScout writes an AI pack, an agent outside MxScout writes a descriptions
 * file with the mendix-describe skill, MxScout imports it. Three programs
 * meet through two files, so the files are what this checks:
 *
 *  - the pack, built HERE by the real exporter from the real fixture: its
 *    index points at the lines it claims, every flow carries a fingerprint,
 *    and a step's data is in it;
 *  - the skill's checker, run over that same pack — if the exporter ever
 *    writes something the checker cannot read, one of them is wrong;
 *  - the import: a good file is kept and shown, marked as AI; a bad one is
 *    refused with a reason; a flow that changed since it was described says
 *    so instead of passing an old sentence off as current. */
'use strict';
const fs = require('fs');
const path = require('path');
const { readPack, todo, check, merge } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const SKILL = path.join(__dirname, '..', 'skills', 'mendix-describe');
  const skillText = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  t.ok(/^---\r?\nname: mendix-describe\r?\ndescription: /.test(skillText), 'SKILL.md opens with the frontmatter a skill is found by');
  const referenced = skillText.match(/reference\/[a-z-]+\.md/g) || [];
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

  // ---- the skill's checker reads the same pack ----
  const pack = readPack(text);
  const flowNames = Object.keys(pack.microflows);
  t.ok(flowNames.indexOf('Sales.CreateOrder') !== -1 && pack.microflows['Sales.CreateOrder'].hash.length === 8,
    'the skill’s checker reads the flows and fingerprints out of the exporter’s pack: ' + flowNames.join(', '));
  const before = todo(pack, null);
  t.ok(before.flows === flowNames.length + Object.keys(pack.nanoflows).length && before.overview,
    'with nothing described, todo lists every flow and the missing overview: ' + before.flows);

  // The application, its processes and its modules in the two layers of reference/business-narrative.md.
  const STORY = 'Sales is where the shop keeps its orders, from the moment a clerk opens one until it is paid and shipped. Without it the shop would track orders on paper, and nobody would know which customer is waiting for what.\n\n' +
    'A clerk opens a new order for a customer, adds what was bought, and saves it. The model does not show who approves large orders, if anyone does.';
  const desc = {
    format: 'mxscout-descriptions', version: 1, project: 'DescDemo', language: 'en', by: 'test agent',
    app: { summary: 'Takes orders and keeps them tidy.', story: STORY, audience: 'Sales staff.',
      processes: [{ name: 'Taking an order', summary: 'A clerk records an order.', story: STORY, steps: ['Open a new order', 'Save it'], flows: ['Sales.CreateOrder'] }] },
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
  const short = JSON.parse(JSON.stringify(desc));
  delete short.app.story; short.modules.Sales = 'Orders and customers.';
  const shortWarn = check(pack, short).filter((p) => /no "story"/.test(p.text)).map((p) => p.text.split(':')[0]);
  t.ok(shortWarn.indexOf('app') !== -1 && shortWarn.indexOf('modules Sales') !== -1 && todo(pack, short).shortModules[0] === 'Sales' && todo(pack, short).overviewStory,
    'a summary without its long description is flagged, by check and by todo: ' + JSON.stringify(shortWarn));
  const listy = JSON.parse(JSON.stringify(desc));
  listy.app.story = '- orders\n- customers\n- **payments**';
  t.ok(check(pack, listy).some((p) => /app: the story carries markup/.test(p.text)), 'and a story written as a list is flagged: it is shown as text');
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
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'DescDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'DescDemo').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(n => /^Documentation/.test(n.textContent))`, 8000, 'sections');
  await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(n => /^Documentation/.test(n.textContent)).click()`);
  const status = await mx.waitFor(`(function(){ var s = document.querySelector('.docs-ai-status'); return s && s.textContent; })()`, 8000, 'ai status');
  t.ok(/1 of \d+ flows described/.test(status) && /main processes/.test(status), 'the section says how much is described: ' + status.slice(0, 120));
  const data = await mx.evaluate(`JSON.stringify((function(){ var d = MxDocs.current(); return { desc: d.flows['microflow:Sales.CreateOrder'].desc, stale: d.flows['microflow:Sales.CreateOrder'].descStale, app: !!(d.ai && d.ai.app) }; })())`);
  const D = JSON.parse(data);
  t.ok(D.desc === 'Opens a fresh order for a customer.' && D.stale === false && D.app, 'the documentation carries the descriptions, current, and the overview');
  t.ok(await mx.waitFor(`!!document.querySelector('.docs-shot .dx-about') && !!document.querySelector('.docs-shot .dx-ai')`, 5000, 'preview'),
    'the overview shows “About the application”, marked as AI');
  t.ok(await mx.evaluate(`/descriptions marked ✦ AI/.test(document.querySelector('.docs-shot .dx-hero').textContent)`),
    'and the overview no longer claims nothing in it was written by a machine');

  // The two layers on screen: the summary shown, the story folded under it, one block under another.
  const shown = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var about = document.querySelector('.docs-shot .dx-about'), more = about && about.querySelector('details.dx-more');
    var procs = document.querySelector('.docs-shot .dx-procs');
    return { lead: about && about.querySelector('.dx-lead').textContent, folded: !!more && !more.open, label: more && more.querySelector('summary').textContent,
      paras: more ? more.querySelectorAll('.dx-more-body p').length : 0, procFold: !!(procs && procs.querySelector('.dx-proc details.dx-more')),
      vertical: procs ? getComputedStyle(procs).flexDirection : null };
  })())`));
  t.ok(shown.lead === 'Takes orders and keeps them tidy.' && shown.folded && shown.label === 'Read the full description',
    'the application’s summary is shown, and its description is folded under it: ' + JSON.stringify(shown));
  const mod = JSON.parse(await mx.evaluate(`JSON.stringify(MxDocs.current().ai.modules.Sales)`));
  t.ok(mod && mod.summary === 'Orders and customers.' && /paid and shipped/.test(mod.story), 'a module carries both layers into the documentation');
  const old = await mx.evaluate(`(function () { var v = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, modules: { Sales: 'Orders and customers.' } })).value; return v && v.modules.Sales.text; })()`);
  t.ok(old === 'Orders and customers.', 'and a file from before the two layers, a module as one string, is still read — as its summary');
  t.ok(shown.paras === 2 && shown.procFold, 'the description keeps its paragraphs, and a process has its own fold');
  t.ok(shown.vertical === 'column', 'the processes stand one under another, not as tiles side by side');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.docs-ai button')).find(b => b.textContent === 'Export AI pack')`), 'the pack is one button away');

  // Risks and the developer's context: kept as text, each on a page of its own, names as links.
  const extra = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var d = MxDocs.current(), host = document.createElement('div');
    document.body.appendChild(host);
    var v = MxDocsView.mount(d, host, { preview: true, state: { view: 'risks' } });
    var nav = Array.from(host.querySelectorAll('.dx-nav-item')).map(function (b) { return b.textContent; });
    var risk = host.querySelector('.dx-risk.p2');
    var r = { nav: nav, title: risk && risk.querySelector('.dx-risk-h b').textContent, link: !!(risk && risk.querySelector('button.dx-chip')),
      fix: risk && /What to do: Disable/.test(risk.textContent), ai: !!host.querySelector('.dx-main .dx-ai') };
    v.go({ view: 'dev' });
    r.dev = Array.from(host.querySelectorAll('.dx-main h3')).map(function (x) { return x.textContent; });
    r.devLinks = host.querySelectorAll('.dx-dev button.dx-chip').length;
    r.status = document.querySelector('.docs-ai-status').textContent;
    var dropped = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, risks: [{ level: 'P7', title: 'x' }, { level: 'P1', title: '<b>y</b>' }] })).value;
    r.kept = dropped.risks.map(function (x) { return x.level + ':' + x.title; });
    var old = JSON.parse(JSON.stringify(d)); delete old.ai.risks; delete old.ai.context;
    var h2 = document.createElement('div'); MxDocsView.mount(old, h2, { preview: true });
    r.oldNav = Array.from(h2.querySelectorAll('.dx-nav-item')).length;
    host.remove();
    return r;
  })())`));
  t.ok(extra.nav.some((n) => /^Risks1$/.test(n)) && extra.nav.indexOf('For developers') !== -1, 'the documentation gets a Risks page and a page for developers: ' + JSON.stringify(extra.nav));
  t.ok(extra.title === 'An order can be saved twice' && extra.link && extra.fix && extra.ai, 'a risk shows its level, its places as links and what to do, marked as AI');
  t.ok(extra.dev.join('|') === 'Where things are|Naming conventions|Pitfalls before a change' && extra.devLinks >= 2, 'the developer page has its three parts, names inside sentences linked: ' + extra.devLinks);
  t.ok(/1 risk/.test(extra.status) && /notes for developers/.test(extra.status), 'the section counts them');
  t.ok(extra.kept.join() === 'P1:<b>y</b>', 'a risk with a level outside P1–P3 is dropped, and a title is kept as text');
  t.ok(extra.oldNav === 5, 'a file imported before risks existed adds no empty pages');

  // A flow that changed after it was described says so.
  const marked = await mx.evaluate(`(function(){ var d = MxDocs.current(); var x = JSON.parse(JSON.stringify(d)); var v = MxDescribe.parse(${JSON.stringify(JSON.stringify(stale))}).value; MxDescribe.attach(x, v); return x.flows['microflow:Sales.CreateOrder'].descStale; })()`);
  t.ok(marked === true, 'a description whose flow changed since is marked out of date, not passed off as current');
  await mx.close();
};
