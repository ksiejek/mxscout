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

  const desc = {
    format: 'mxscout-descriptions', version: 1, project: 'DescDemo', language: 'en', by: 'test agent',
    app: { summary: 'Takes orders and keeps them tidy.', audience: 'Sales staff.',
      processes: [{ name: 'Taking an order', summary: 'A clerk records an order.', steps: ['Open a new order', 'Save it'], flows: ['Sales.CreateOrder'] }] },
    modules: { Sales: 'Orders and customers.' },
    microflows: { 'Sales.CreateOrder': { hash: pack.microflows['Sales.CreateOrder'].hash, text: 'Opens a fresh order for a customer.' } }
  };
  const after = todo(pack, desc);
  t.ok(after.flows === before.flows - 1 && !after.overview, 'a described flow drops off the list: ' + after.flows + ' left');
  t.ok(check(pack, desc).filter((p) => p.level === 'error').length === 0, 'a correct file passes the check');
  const stale = JSON.parse(JSON.stringify(desc));
  stale.microflows['Sales.CreateOrder'].hash = '00000000';
  t.ok(check(pack, stale).some((p) => p.level === 'warning' && /does not match/.test(p.text)) && todo(pack, stale).flows === before.flows,
    'a fingerprint that moved is flagged, and the flow is back on the list');
  const invented = JSON.parse(JSON.stringify(desc));
  invented.microflows['Sales.NoSuchFlow'] = { hash: 'abcdef12', text: 'Made up.' };
  t.ok(check(pack, invented).some((p) => p.level === 'error' && /Sales\.NoSuchFlow/.test(p.text)), 'a name that is not in the pack is an error');
  const merged = merge([{ format: 'mxscout-descriptions', version: 1, microflows: { 'Sales.A': 'one' } }, desc]);
  t.ok(merged.microflows['Sales.A'] === 'one' && merged.microflows['Sales.CreateOrder'] && merged.app, 'merge joins parts into one file');

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
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.docs-ai button')).find(b => b.textContent === 'Export AI pack')`), 'the pack is one button away');

  // A flow that changed after it was described says so.
  const marked = await mx.evaluate(`(function(){ var d = MxDocs.current(); var x = JSON.parse(JSON.stringify(d)); var v = MxDescribe.parse(${JSON.stringify(JSON.stringify(stale))}).value; MxDescribe.attach(x, v); return x.flows['microflow:Sales.CreateOrder'].descStale; })()`);
  t.ok(marked === true, 'a description whose flow changed since is marked out of date, not passed off as current');
  await mx.close();
};
