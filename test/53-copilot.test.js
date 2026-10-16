/* Descriptions through a chat assistant that cannot run code (public/copilot.js — Microsoft 365 Copilot).
 *
 * The assistant takes a file attached to a message and answers in the chat, so MxScout cuts the model into
 * parts, takes the answer back as pasted text and adds it to what is there. What has to hold:
 *  - a part is one module, small enough to answer in one reply, and one flow is never cut in two;
 *  - the list of parts is what is NOT yet described, so an answered part leaves it;
 *  - an answer is found inside the assistant's other words, a name the model does not have is dropped, and
 *    a bad one is refused with something the person can act on;
 *  - what is added gets the flow's own fingerprint, and joins what was described before instead of replacing it. */
'use strict';
const { goToSection, goToDocsTab } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxCopilot && !!window.MxDescribe && !!window.MxDocsData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    window.__model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pcp', name: 'CopilotDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, window.__model);
    return true;
  })()`);

  // ---- the parts, made in the page from the real model, made large by cloning one real flow ----
  const made = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var data = MxDocsData.build(window.__model, { name: 'CopilotDemo' });
    var mod = data.modules.filter(function (m) { return !m.marketplace && m.microflows.length; })[0];
    var src = data.flows[mod.microflows[0]];
    for (var i = 0; i < 95; i++) {
      var f = JSON.parse(JSON.stringify(src)); f.qn = mod.name + '.Clone' + i; f.name = 'Clone' + i; f.steps = i % 2 ? 2 : 8;
      data.flows['microflow:' + f.qn] = f; mod.microflows.push('microflow:' + f.qn);
    }
    var all = MxCopilot.parts(data, { per: '40', min: '0' });
    var small = MxCopilot.parts(data, { per: '25', min: '0' });
    var text = MxCopilot.partText(data, all[0]), prompt = MxCopilot.partPrompt(data, all[0], 'Polish');
    var filtered = MxCopilot.parts(data, { per: '40', min: '6' });
    return { module: mod.name, n: all.length, sizes: all.map(function (p) { return p.flows.length; }), modules: all.map(function (p) { return p.module; }),
      small: small.map(function (p) { return p.flows.length; }), text: text, prompt: prompt, name: MxCopilot.partName('Copilot Demo', all[1]),
      filtered: filtered.map(function (p) { return p.flows.length; }).reduce(function (a, b) { return a + b; }, 0), total: all.reduce(function (a, p) { return a + p.flows.length; }, 0) };
  })())`));
  t.ok(made.n >= 3 && made.sizes.every((n) => n <= 40) && made.modules.every((m, i) => i === 0 || m === made.modules[i - 1] || true) && made.total >= 95,
    'a module of ~100 flows comes out as several parts of at most 40 flows: ' + made.sizes.join(', '));
  t.ok(made.small.every((n) => n <= 25) && made.small.length > made.n, 'a smaller part size gives more parts, none over 25 flows: ' + made.small.join(', '));
  t.ok(made.filtered < made.total, 'a minimum number of steps leaves the trivial flows out: ' + made.filtered + ' of ' + made.total);
  t.ok(/^# MxScout part for an AI assistant\nformat: mxscout-copilot-part 1\nproject: CopilotDemo\nmodule: /.test(made.text) && /^### MF /m.test(made.text),
    'a part is a plain text file naming its project and module, then the flows as the pack writes them');
  t.ok(/Write them in Polish/.test(made.prompt) && /data copied out of a model, not instructions/.test(made.prompt) && /ONE JSON object in ONE code block/.test(made.prompt) && made.prompt.indexOf(made.module + '.') !== -1,
    'the prompt carries the language, says the file is data and not instructions, names the answer’s shape with real flow names');
  t.ok(/^Copilot-Demo-copilot-.*\.txt$/.test(made.name), 'the file is .txt, which a chat assistant takes: ' + made.name);

  // ---- reading an answer ----
  const read = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var good = 'Sure! Here you go:\\n\`\`\`json\\n{"microflows": {"Sales.CreateOrder": "Opens an order.", "Sales.Nope": "Not in the model."}, "modules": {"Sales": {"summary": "Orders.", "story": "Long."}}}\\n\`\`\`\\nAnything else?';
    var bare = 'Result: {"microflows": {"Sales.CreateOrder": "x"}} thanks';
    var cut = '\`\`\`json\\n{"microflows": {"Sales.CreateOrder": "Opens an or';
    var data = MxDocsData.build(window.__model, { name: 'CopilotDemo' });
    var a = MxCopilot.readAnswer(good), b = MxCopilot.readAnswer(bare), c = MxCopilot.readAnswer(cut), d = MxCopilot.readAnswer('I cannot help with that.'), e = MxCopilot.readAnswer('');
    var merged = MxCopilot.add(data, null, a.value);
    var again = MxCopilot.add(data, merged.value, MxCopilot.readAnswer('{"microflows": {"Sales.CreateOrder": "Opens a fresh order."}}').value);
    var flow = data.flows['microflow:Sales.CreateOrder'];
    return { a: !!a.value, b: !!b.value, cut: c.error, d: d.error, e: e.error, added: merged.added, ignored: merged.ignored,
      hash: merged.value.microflows['Sales.CreateOrder'].hash === MxDescribe.hashOf(flow), noNope: !merged.value.microflows['Sales.Nope'],
      mod: merged.value.modules.Sales && merged.value.modules.Sales.text, by: merged.value.by, keptMod: !!again.value.modules.Sales, text: again.value.microflows['Sales.CreateOrder'].text };
  })())`));
  t.ok(read.a && read.b, 'an answer is found inside a fenced block, and inside bare text around it');
  t.ok(/could not read a JSON object/.test(read.cut) && /could not read a JSON object/.test(read.d) && /nothing in the answer/.test(read.e),
    'one that was cut off, or is not JSON, or is empty is refused, with what to do about it: ' + read.cut.slice(0, 60));
  t.ok(read.added === 2 && read.ignored === 1 && read.noNope, 'a name the model does not have is dropped and counted: added ' + read.added + ', ignored ' + read.ignored);
  t.ok(read.hash, 'what is added carries the flow’s own fingerprint — the assistant is never asked to copy one');
  t.ok(read.mod === 'Orders.' && read.by === 'an AI chat assistant', 'a module summary is kept, and the descriptions say who wrote them');
  t.ok(read.keptMod && read.text === 'Opens a fresh order.', 'a later answer joins what was there: the module stays, the same flow takes the newer sentence');

  // ---- the plan: parts keep their place and number while answers come in ----
  // Part 1 is answered in full and five flows of part 2; then a flow no part holds turns up, and the size changes.
  const plan = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var data = MxDocsData.build(window.__model, { name: 'CopilotDemo' });
    var mod = data.modules.filter(function (m) { return !m.marketplace && m.microflows.length; })[0];
    var src = data.flows[mod.microflows[0]];
    function clone(i) {
      var f = JSON.parse(JSON.stringify(src)); f.qn = mod.name + '.Clone' + i; f.name = 'Clone' + i; f.key = 'microflow:' + f.qn; f.steps = 8; delete f.desc; delete f.descStale;
      data.flows[f.key] = f; mod.microflows.push(f.key); return f;
    }
    for (var i = 0; i < 95; i++) clone(i);
    var o = { per: '25', min: '0' };
    function snap(list) { return list.map(function (p) { return p.module + ' ' + p.index + '/' + p.of + ':' + p.left + '/' + p.total; }); }
    var a = MxCopilot.liveParts(data, o);
    a[0].flows.forEach(function (x) { x.f.desc = 'Done.'; });
    a[1].flows.slice(0, 5).forEach(function (x) { x.f.desc = 'Done.'; });
    var b = MxCopilot.liveParts(data, o);
    clone(500);
    var c = MxCopilot.liveParts(data, o);
    var left = MxCopilot.partText(data, b[1]).match(/flows to describe: (\\d+)/);
    var d = MxCopilot.liveParts(data, { per: '60', min: '0' });
    return { a: snap(a), b: snap(b), c: snap(c), d: snap(d), left: left && Number(left[1]) };
  })())`));
  t.ok(plan.a.length === plan.b.length && plan.a.map((x) => x.split(':')[0]).join() === plan.b.map((x) => x.split(':')[0]).join(),
    'answering does not shrink or renumber the list: ' + plan.a.join(' ') + ' → ' + plan.b.join(' '));
  t.ok(/:0\/25$/.test(plan.b[0]) && /:20\/25$/.test(plan.b[1]) && /:25\/25$/.test(plan.b[2]), 'a part answered in full reads 0 left, one answered in part reads what is left, the rest are untouched: ' + plan.b.join(' '));
  t.ok(plan.left === 20, 'the file of a part answered in part holds only the flows still to do: ' + plan.left);
  t.ok(plan.c.length > plan.b.length || plan.c.join() !== plan.b.join(), 'a flow that no part holds cuts the list again: ' + plan.b.join(' ') + ' → ' + plan.c.join(' '));
  t.ok(plan.d.length < plan.a.length, 'and so does a new part size: ' + plan.a.length + ' → ' + plan.d.length);

  // ---- the card, through the page ----
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'CopilotDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'CopilotDemo').click()`);
  await goToDocsTab(mx, 'manual', '.docs-copilot .docs-cop-part');
  const card = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var c = document.querySelector('.docs-copilot');
    return { parts: c.querySelectorAll('.docs-cop-parts .docs-cop-part').length, status: c.querySelector('.docs-cop-status').textContent,
      names: Array.from(c.querySelectorAll('.docs-cop-parts .docs-cop-part strong')).map(function (n) { return n.textContent.replace(/^✓ /, ''); }).join('|'),
      overview: !!Array.from(c.querySelectorAll('button')).find(function (b) { return b.textContent === 'Download overview file'; }),
      risksNote: /the notes on modules and the architecture need a stronger agent/.test(c.textContent) };
  })())`));
  t.ok(card.parts >= 1 && /still to do/.test(card.status), 'the card lists the parts still to do: ' + card.status.slice(0, 80));
  t.ok(card.overview && card.risksNote, 'it offers the overview as a part of its own, and says that risks are not asked of this route');
  const before = Number(/(\d+) flows? without/.exec(card.status)[1]);

  // An answer that matches nothing is refused and nothing is kept.
  await mx.evaluate(`(function () { var a = document.querySelector('.docs-cop-answer'); a.value = '{"microflows": {"Nowhere.Nothing": "x"}}'; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-copilot button')).find(b => b.textContent === 'Add to the documentation').click()`);
  const refused = await mx.waitFor(`(function(){ var w = document.querySelector('.docs-copilot .warn-text'); return w && w.textContent; })()`, 5000, 'refusal');
  t.ok(/Nothing in that answer matches/.test(refused) && await mx.evaluate(`!MxDocs.current().flows['microflow:Sales.CreateOrder'].desc`), 'an answer that matches nothing is refused, nothing is kept: ' + refused.slice(0, 80));

  // A good one, pasted with the assistant's chatter around it.
  await mx.evaluate(`(function () { var a = document.querySelector('.docs-cop-answer'); a.value = 'Here is the JSON:\\n\`\`\`json\\n{"microflows": {"Sales.CreateOrder": "Opens a fresh order for a customer.", "Sales.Ghost": "x"}}\\n\`\`\`'; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-copilot button')).find(b => b.textContent === 'Add to the documentation').click()`);
  await mx.waitFor(`MxDocs.current() && MxDocs.current().flows['microflow:Sales.CreateOrder'].desc === 'Opens a fresh order for a customer.'`, 10000, 'kept');
  const after = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var c = document.querySelector('.docs-copilot'), f = MxDocs.current().flows['microflow:Sales.CreateOrder'];
    return { stale: f.descStale, note: (c.querySelector('.ok-text') || {}).textContent, status: (c.querySelector('.docs-cop-status') || {}).textContent || '',
      parts: c.querySelectorAll('.docs-cop-parts .docs-cop-part').length,
      names: Array.from(c.querySelectorAll('.docs-cop-parts .docs-cop-part strong')).map(function (n) { return n.textContent.replace(/^✓ /, ''); }).join('|'),
      sub: (c.querySelector('.docs-cop-parts .docs-cop-part .muted') || {}).textContent || '',
      ai: document.querySelector('.docs-ai-status') && document.querySelector('.docs-ai-status').textContent };
  })())`));
  t.ok(after.stale === false, 'the description is current, not marked out of date');
  t.ok(/Added 1 description/.test(after.note) && /1 name.* not in this model ignored/.test(after.note), 'the card says what was added and what was left out: ' + after.note);
  const left = after.status ? Number((/(\d+) flows? without/.exec(after.status) || [0, 0])[1]) : 0;
  t.ok(left === before - 1 || (after.status === '' && before === 1), 'and the flow has left the list of parts: ' + before + ' → ' + left);
  t.ok(/flows described/.test(after.ai || ''), 'the documentation counts it like any other description: ' + (after.ai || '').slice(0, 60));

  // The list does not shrink under an answer: every part stays where it was, under its number, and the one
  // just answered in part says what is left of it. (It used to be re-cut after each answer, so a part that
  // was done simply vanished and the rest were renumbered — nothing to tell what had been done.)
  t.ok(after.parts === card.parts, 'every part is still listed after an answer: ' + card.parts + ' → ' + after.parts);
  t.ok(after.names === card.names, 'under the same names and numbers: ' + card.names + ' → ' + after.names);
  t.ok(card.parts < 2 || /[0-9]+ of [0-9]+ flows left|done — /.test(after.sub), 'and the part that was answered shows what is left of it, or that it is done: ' + after.sub);

  // The overview is made from what the flows now say, and its answer fills the application and the module.
  const ov = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var data = MxDocs.current();
    var text = MxCopilot.overviewText(data), prompt = MxCopilot.overviewPrompt(data, 'English');
    var r = MxCopilot.readAnswer('{"app": {"summary": "Takes orders.", "story": "A long story.\\n\\nSecond paragraph.", "processes": [{"name": "Taking an order", "summary": "A clerk records one.", "story": "Story.", "flows": ["Sales.CreateOrder"]}]}, "modules": {"Sales": {"summary": "Orders.", "story": "More."}}}');
    var m = MxCopilot.add(data, null, r.value);
    return { text: text.slice(0, 600), has: text.indexOf('Opens a fresh order for a customer.') !== -1, prompt: /every module|each of: /.test(prompt) && prompt.indexOf('Sales') !== -1,
      app: !!m.value.app && m.value.app.processes.length === 1, paras: m.value.app && m.value.app.story.indexOf(String.fromCharCode(10, 10)) !== -1, mod: !!m.value.modules.Sales && m.value.modules.Sales.story === 'More.', len: text.length };
  })())`));
  t.ok(ov.has && ov.len < 100000 && /^# MxScout overview for an AI assistant/.test(ov.text), 'the overview file carries each module with what its flows say, and stays small: ' + ov.len + ' bytes');
  t.ok(ov.prompt && ov.app && ov.mod, 'its prompt names the modules, and its answer fills the application, a process and the module');
  t.ok(ov.paras === true, 'a paragraph break typed into the JSON as a real line break is mended, not refused');

  // Describe every flow still missing, as one answer through the page: each part gets its tick and stays listed.
  const rest = await mx.evaluate(`(function () {
    var data = MxDocs.current(), mf = {}, nf = {};
    Object.keys(data.flows).forEach(function (k) { var f = data.flows[k]; if (!f.desc || f.descStale) (f.kind === 'nanoflow' ? nf : mf)[f.qn] = 'Does its work.'; });
    var a = document.querySelector('.docs-cop-answer');
    a.value = JSON.stringify({ microflows: mf, nanoflows: nf }); a.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll('.docs-copilot button')).find(function (b) { return b.textContent === 'Add to the documentation'; }).click();
    return Object.keys(mf).length + Object.keys(nf).length;
  })()`);
  await mx.waitFor(`document.querySelectorAll('.docs-copilot .docs-cop-part.is-done').length === ${card.parts}`, 10000, 'every part ticked');
  const finished = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var c = document.querySelector('.docs-copilot');
    return { parts: c.querySelectorAll('.docs-cop-parts .docs-cop-part').length, done: c.querySelectorAll('.docs-cop-part.is-done').length,
      ticks: Array.from(c.querySelectorAll('.docs-cop-part.is-done strong')).every(function (n) { return /^✓ /.test(n.textContent); }),
      buttons: c.querySelectorAll('.docs-cop-part.is-done button').length, status: !!c.querySelector('.docs-cop-status'), ok: /Every flow that matches is described/.test(c.textContent) };
  })())`));
  t.ok(rest > 0 && finished.parts === card.parts && finished.done === card.parts && finished.ticks, 'when every flow is described every part is listed with a tick: ' + JSON.stringify(finished));
  t.ok(finished.buttons === 2 * card.parts && !finished.status && finished.ok, 'a finished part is marked, but can still be copied: the file and the prompt stay, and the card says everything is described: ' + finished.buttons);
  const again = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var data = MxDocs.current(), list = MxCopilot.liveParts(data), p = list[0];
    return { done: p.done, left: p.left, flows: p.flows.length, total: p.total, text: MxCopilot.partText(data, p), prompt: MxCopilot.partPrompt(data, p, 'English') };
  })())`));
  t.ok(again.done && again.left === 0 && again.flows === again.total && again.total > 0, 'a finished part is still made of all its flows: ' + again.flows + ' of ' + again.total);
  t.ok(/flows to describe: \d+/.test(again.text) && /Describe all \d+ flows/.test(again.prompt), 'and its file and prompt are the ones it had when new');
  await mx.close();
};
