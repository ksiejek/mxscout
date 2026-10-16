/* The context (public/basket.js — Karol, 2026-10-16): model elements put aside to talk them over with a
 * chat assistant such as Copilot, and the answer brought back as a Workbook item to hand to a developer.
 *
 * What has to hold:
 *  - + Context beside a flow, and a right-click on a row of a list or on an entity's box on the Domain
 *    model, put an element aside — with Developer tools off, since it is not one of them;
 *  - the list is kept per project in the browser's database, and goes with the project;
 *  - the prompt says the model is data, not instructions, names the language and the answer's shape,
 *    and carries each element as the AI pack writes it;
 *  - an answer pasted back is found inside the assistant's other words and becomes a Workbook item: its
 *    id a slug of the title, its sources what the context held plus what the assistant named that the
 *    model has — a name it does not have is left out; one that is not JSON is refused, saying what to do;
 *  - on the Assist page the item opens, its sources are links, and its technical description's HTML and
 *    Markdown carry the elements appended, as the model has them — an e-mail copy does not. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxBasket && !!window.MxAssist && !!window.MxDocsAssist && !!window.MxDocsData', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const names = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'pctx', name: 'ContextDemo', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, contentLanguage: 'pl' }, model);
    var d = MxDocsData.build(model, { name: 'ContextDemo' });
    // A page whose name no flow has (Mendix keeps a module's document names apart; the fixture does not).
    var page = Object.keys(d.flows).filter(function (k) { return /^page:Sales\\./.test(k) && !d.flows['microflow:' + k.slice(5)] && !d.flows['nanoflow:' + k.slice(5)]; })[0];
    return JSON.stringify({ entity: Object.keys(d.entities).filter(function (q) { return /^Sales\\./.test(q); })[0], page: page ? page.slice(5) : null });
  })()`));
  t.ok(!!names.entity && !!names.page, 'the fixture has an entity and a page to put aside: ' + names.entity + ', ' + names.page);
  const entityName = names.entity.split('.').pop();

  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('ContextDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.trim().indexOf('ContextDemo') === 0).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /^Overview/.test(b.textContent))`, 8000, 'sections');

  // ---- empty ----
  await goToSection(mx, 'Context', '.ctx-list');
  const empty = JSON.parse(await mx.evaluate(`JSON.stringify({ h1: document.querySelector('.xe-head h1').textContent, h3: document.querySelector('.ctx-list h3').textContent,
    talk: !!document.querySelector('.ctx-talk'), side: Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|') })`));
  t.ok(empty.h1 === 'Context' && /empty/.test(empty.h3) && !empty.talk, 'Context opens empty, with nothing to copy yet: ' + empty.h3);
  t.ok(/Documentation\|Context/.test(empty.side) && !/Live app|Comments/.test(empty.side), 'it is under Review, after Documentation, with Developer tools off: ' + empty.side);

  // ---- + Context beside a flow ----
  await goToSection(mx, 'Microflows', '.xe.mf');
  await mx.evaluate(`(function(){ window.MxMicroflows.select('Sales.CreateOrder'); return true; })()`);
  await mx.waitFor(`(function(){ var b = document.querySelector('.mf-detail .ctx-toggle'); return !!b && /CreateOrder/.test(document.querySelector('.mf-detail').getAttribute('aria-label')); })()`, 8000, '+ Context beside the flow');
  t.ok(await mx.evaluate(`document.querySelector('.mf-detail .ctx-toggle').textContent === '+ Context' && !document.querySelector('.mf-detail .mf-btn.primary')`),
    'the flow has + Context with Developer tools off, and no Add comment');
  await mx.evaluate(`document.querySelector('.mf-detail .ctx-toggle').click()`);
  await mx.waitFor(`MxBasket.has('pctx', 'microflow', 'Sales.CreateOrder') && document.querySelector('.mf-detail .ctx-toggle').textContent === '✓ In context'`, 5000, 'the flow in the context');
  t.ok(await mx.evaluate(`document.querySelector('.mf-detail .ctx-toggle').getAttribute('aria-pressed') === 'true'`), 'pressed, the button says it is in, and is pressed');

  // ---- a right-click on a page's row ----
  await goToSection(mx, 'Pages', '.xe.mf');
  await mx.evaluate(`(function(){ window.MxMicroflows.select(${JSON.stringify(names.page)}); return true; })()`);
  const rightClick = (sel) => mx.evaluate(`(function(){ var n = ${sel}; if (!n) return false; n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); return true; })()`);
  const pageRow = `Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return r.querySelector('.mf-row-name').textContent === ${JSON.stringify(names.page.split('.').pop())}; })`;
  await mx.waitFor(`!!(${pageRow})`, 8000, 'the page in the list');
  t.ok(await rightClick(pageRow), 'a page row takes a right-click');
  await mx.waitFor(`!!document.querySelector('.ctx-menu')`, 4000, 'the context menu');
  const menu = await mx.evaluate(`Array.from(document.querySelectorAll('.ctx-menu button')).map(function (b) { return b.textContent; }).join('|')`);
  t.ok(/^Add to context\|Open the context \(1\)$/.test(menu), 'the menu offers Add to context, and the context with how much is in it: ' + menu);
  await mx.evaluate(`document.querySelector('.ctx-menu button').click()`);
  await mx.waitFor(`MxBasket.has('pctx', 'page', ${JSON.stringify(names.page)}) && !document.querySelector('.ctx-menu')`, 5000, 'the page in the context');

  // ---- a right-click on an entity on the Domain model ----
  await goToSection(mx, 'Entities', '.dx-dm-box');
  const box = `Array.from(document.querySelectorAll('.dx-dm-box')).find(function (b) { return b.getAttribute('title') === ${JSON.stringify(names.entity)}; })`;
  await mx.waitFor(`!!(${box})`, 8000, 'the entity drawn');
  await rightClick(box);
  await mx.waitFor(`!!document.querySelector('.ctx-menu')`, 4000, 'the context menu on the Domain model');
  await mx.evaluate(`document.querySelector('.ctx-menu button').click()`);
  await mx.waitFor(`MxBasket.has('pctx', 'entity', ${JSON.stringify(names.entity)})`, 5000, 'the entity in the context');
  const kept = JSON.parse(await mx.evaluate(`MxStore.getBasket('pctx').then(function (l) { return JSON.stringify(l.map(function (x) { return x.kind + ':' + x.qn; })); })`));
  t.ok(kept.join('|') === ['microflow:Sales.CreateOrder', 'page:' + names.page, 'entity:' + names.entity].join('|'), 'all three are kept in the database, in the order they were put aside: ' + kept.join(', '));
  // The entity's own panel says so too, once it is picked.
  await mx.evaluate(`(${box}).click()`);
  await mx.waitFor(`(function(){ var b = document.querySelector('.dx-dm-acts .ctx-toggle'); return !!b && b.textContent === '✓ In context'; })()`, 5000, 'the entity panel says it is in the context');
  t.ok(true, 'the entity’s panel has the same button, pressed');

  // ---- the prompt ----
  await goToSection(mx, 'Context', '.ctx-talk');
  const screen = JSON.parse(await mx.evaluate(`JSON.stringify({ rows: Array.from(document.querySelectorAll('.ctx-row .ctx-name')).map(function (n) { return n.textContent; }),
    tags: Array.from(document.querySelectorAll('.ctx-row .mf-kind')).map(function (n) { return n.textContent; }).join(','),
    count: Array.from(document.querySelectorAll('.tree-section')).find(function (b) { return /^Context/.test(b.textContent.trim()); }).textContent.trim(),
    lang: document.querySelector('.ctx-talk p').textContent, kb: document.querySelector('.ctx-kb').textContent,
    buttons: Array.from(document.querySelectorAll('.ctx-talk button, .ctx-back button')).map(function (b) { return b.textContent; }).join('|') })`));
  t.ok(screen.rows.length === 3 && screen.tags === 'MF,PG,E' && screen.count === 'Context3', 'the screen lists the three, each with its kind, and the sidebar counts them: ' + screen.count);
  t.ok(/Written in Polish/.test(screen.lang) && /KB$/.test(screen.kb) && /Copy prompt\|Download as a file\|Add to the Workbook/.test(screen.buttons),
    'it says the language it will be written in and how large the prompt is, with Copy prompt, Download and Add to the Workbook: ' + screen.buttons);
  const prompt = await mx.evaluate(`MxStore.getModel('pctx').then(function (model) {
    var data = MxDocsData.build(model, { name: 'ContextDemo' });
    return MxBasket.prompt(data, { name: 'ContextDemo' }, MxBasket.peek('pctx'), 'A junior builds the approval of an order.', 'pl'); })`);
  t.ok(/^I am the architect of a Mendix application, "ContextDemo"/.test(prompt) && /What I want to work out: A junior builds the approval of an order\./.test(prompt),
    'the prompt opens with what it is about, and what the person wants to work out');
  t.ok(/not instructions/.test(prompt) && /Write in Polish\./.test(prompt) && /Do not write any JSON until I ask for it/.test(prompt) && /give me the JSON/.test(prompt) && /"technical": \{"title"/.test(prompt),
    'it says the model is data, the language, to talk before any JSON, and the answer’s shape');
  t.ok(prompt.indexOf('### MF Sales.CreateOrder') !== -1 && prompt.indexOf('### PG ' + names.page) !== -1 && prompt.indexOf('### E ' + names.entity + '\nE ' + entityName) !== -1 && /\n  access /.test(prompt),
    'it carries each element as the AI pack writes it — the flow, the page, the entity with its access');

  // ---- the answer ----
  const answer = 'Jasne! Oto JSON:\n```json\n' + JSON.stringify({
    id: '', title: 'Zatwierdzanie zamówienia – nowy krok', summary: 'Kierownik zatwierdza zamówienie przed wysyłką.', story: 'Dziś zamówienie od razu idzie do wysyłki.\n\nNie ma kroku zatwierdzenia.',
    sources: ['Sales.CreateOrder', 'Sales.NotInTheModel'],
    business: { title: 'Zatwierdzanie zamówień', summary: 'Nowy krok dla kierownika.', sections: [{ heading: 'Co się zmienia', text: 'Kierownik widzi listę.\n\n- jedno\n- dwa' }] },
    technical: { title: 'Zatwierdzanie — jak zbudować', summary: 'Nowy atrybut i flow.', sections: [{ heading: 'Kroki', text: 'Dodaj atrybut `Approved` do `' + names.entity + '`.' }] }
  }) + '\n```\nCzy coś jeszcze?';
  // Not JSON first: refused, with what to do.
  await mx.evaluate(`(function(){ var a = document.querySelector('.ctx-answer'); a.value = 'Przepraszam, nie mogę.'; a.dispatchEvent(new Event('input')); Array.from(document.querySelectorAll('.ctx-back button')).find(function (b) { return b.textContent === 'Add to the Workbook'; }).click(); return true; })()`);
  const refused = await mx.waitFor(`(function(){ var e = document.querySelector('.ctx-back [role=alert]'); return e && e.textContent; })()`, 4000, 'refused');
  t.ok(/could not read a JSON object/.test(refused) && (await mx.evaluate(`(MxAssist.peek('pctx') || []).length`)) === 0, 'an answer with no JSON is refused, saying what to do, and nothing is kept: ' + refused.slice(0, 60));
  await mx.evaluate(`(function(){ var a = document.querySelector('.ctx-answer'); a.value = ${JSON.stringify(answer)}; a.dispatchEvent(new Event('input')); Array.from(document.querySelectorAll('.ctx-back button')).find(function (b) { return b.textContent === 'Add to the Workbook'; }).click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.ctx-done')`, 6000, 'added to the Workbook');
  const item = JSON.parse(await mx.evaluate(`JSON.stringify((MxAssist.peek('pctx') || [])[0] || null)`));
  t.ok(item && item.kind === 'other' && item.id === 'zatwierdzanie-zamowienia-nowy-krok' && item.language === 'pl', 'it is a Workbook item, its id a slug of the Polish title, in the project’s language: ' + (item && item.id));
  t.ok(item && item.sources.join('|') === ['Sales.CreateOrder', names.page, names.entity].join('|'),
    'its sources: what the assistant named that the model has, then the rest of the context — the name the model lacks is left out: ' + (item && item.sources.join(', ')));
  t.ok(item && item.business && item.technical && item.technical.sections[0].heading === 'Kroki' && /Nie ma kroku/.test(item.story), 'the business and the technical descriptions are kept, and what the model shows');
  t.ok(/Added to the Workbook: Zatwierdzanie zamówienia – nowy krok\./.test(await mx.evaluate(`document.querySelector('.ctx-done').textContent`)) && !(await mx.evaluate(`document.querySelector('.ctx-answer').value`)),
    'the screen says what was added, and the answer box is cleared');

  // ---- on the Assist page ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.ctx-done button')).find(function (b) { return b.textContent === 'Open it'; }).click()`);
  await mx.waitFor(`(function(){ var r = document.querySelector('.doc-screen .dx-as-li.on'); return !!r && r.getAttribute('data-id') === 'zatwierdzanie-zamowienia-nowy-krok'; })()`, 8000, 'the item open on the Assist page');
  const links = await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx-as-pane .dx-code.link')).map(function (a) { return a.textContent; }).join('|')`);
  t.ok(links.indexOf('Sales.CreateOrder') !== -1 && links.indexOf(names.entity) !== -1, 'Open it shows the item on the Assist page, its sources links into the model: ' + links);
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-itab[data-pane="desc"]').click()`);
  await mx.evaluate(`(function(){ var b = document.querySelector('.doc-screen .dx-as-wu-seg button[data-wu="technical"]'); if (b) b.click(); return true; })()`);
  const extraNote = await mx.waitFor(`(function(){ var n = document.querySelector('.doc-screen .dx-as-wu-extra'); return n && n.textContent; })()`, 4000, 'the appendix said');
  t.ok(extraNote === 'With 3 elements of the model appended', 'the technical description says what its download carries: ' + extraNote);
  const out = JSON.parse(await mx.evaluate(`(function(){
    var x = MxAssist.peek('pctx')[0], extra = MxAssist.hook('pctx').appendix(x);
    return JSON.stringify({ n: extra.length, html: MxDocsAssist.asHtml(x, 'technical', false, extra), mail: MxDocsAssist.asHtml(x, 'technical', true, extra), md: MxDocsAssist.asMarkdown(x, 'technical', extra),
      business: MxAssist.hook('pctx').appendix(Object.assign({}, x, { kind: 'idea' })).length });
  })()`));
  t.ok(out.n === 3 && /<h2>From the model<\/h2>/.test(out.html) && out.html.indexOf('<h3>Microflow <code>Sales.CreateOrder</code></h3>') !== -1 && /<pre>### MF Sales\.CreateOrder/.test(out.html) && out.html.indexOf('<pre>### E ' + names.entity) !== -1,
    'the HTML carries the three elements, each under its kind and name, as the pack writes it');
  t.ok(!/From the model/.test(out.mail) && /## From the model/.test(out.md) && /### Entity `/.test(out.md) && /```text\n### MF Sales\.CreateOrder/.test(out.md),
    'the Markdown carries them too, in fenced blocks; the e-mail copy does not');
  t.ok(!/<script|<img/i.test(out.html.replace(/<style>[\s\S]*?<\/style>/, '')) && out.business === 0, 'the page has no markup but its own, and an item of another kind gets no appendix');

  // ---- emptied, and gone with the project ----
  await goToSection(mx, 'Context', '.ctx-list');
  await mx.evaluate(`Array.from(document.querySelectorAll('.ctx-list button')).find(function (b) { return b.textContent === 'Empty the context'; }).click()`);
  await mx.waitFor(`MxBasket.count('pctx') === 0 && /empty/.test(document.querySelector('.ctx-list h3').textContent)`, 5000, 'emptied');
  await mx.evaluate(`MxBasket.add('pctx', 'microflow', 'Sales.CreateOrder')`);
  const gone = await mx.evaluate(`MxStore.getBasket('pctx').then(function (l) { return MxStore.deleteProjectDeep('pctx').then(function () { return MxStore.get('settings', 'basket.pctx'); }).then(function (r) { return l.length + '/' + (r ? 'kept' : 'gone'); }); })`);
  t.ok(gone === '1/gone', 'emptied, the list is empty; deleting the project deletes it: ' + gone);
};
