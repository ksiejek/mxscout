/* The Getting started guide: a static walkthrough that needs no project and
 * no server round trip, built the same way the About page is (data, one
 * render function, real component classes). What is worth checking here is
 * exactly what would break silently in a refactor: the six steps are all
 * there, its mockups actually reuse the real classes rather than inventing
 * new ones, and it behaves like About's sibling — same toggle, mutually
 * exclusive with it, not floated over by any modal. */
'use strict';

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxGuide', 15000, 'MxScout loaded');

  function clickButtonByText(text) {
    return `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`;
  }

  await mx.evaluate(clickButtonByText('Getting started'));
  await mx.waitFor(`!!document.querySelector('.guide')`, 8000, 'guide open');

  const text = await mx.evaluate(`document.querySelector('.guide').innerText`);
  ['Start a project', 'Browse it as a role', 'Open an object', 'Connect to a running app', 'Run a flow', 'Write it up, then send it']
    .forEach((title) => t.ok(text.indexOf(title) !== -1, 'step is on the page: ' + title));
  t.ok(/Riverside Logistics/.test(text), 'says plainly that the data is fictional');

  // The mockups are supposed to be the real screens' own classes, not a
  // redrawn approximation — this is the difference between "looks like
  // MxScout" and "is MxScout".
  const shapes = await mx.evaluate(`JSON.stringify({
    dataTables: document.querySelectorAll('.guide .data-table').length,
    liveOk: !!document.querySelector('.guide .live-status-ok'),
    liveUrlInput: !!document.querySelector('.guide .live-url-input'),
    popupTabs: document.querySelectorAll('.guide .popup-tab').length,
    paramRow: !!document.querySelector('.guide .param-row'),
    paramChosen: !!document.querySelector('.guide .param-chosen'),
    flowCols: !!document.querySelector('.guide .flow-cols'),
    sevCritical: !!document.querySelector('.guide .sev-critical'),
    sevMedium: !!document.querySelector('.guide .sev-medium'),
    codeDisplay: !!document.querySelector('.guide .code-display'),
    fileDrop: !!document.querySelector('.guide .file-drop'),
    entityCards: document.querySelectorAll('.guide .entity-card').length,
    badgeNone: !!document.querySelector('.guide .badge-none')
  })`);
  const s = JSON.parse(shapes);
  // The entity popup's Data tab is the only remaining .data-table — the run
  // mockup moved to the real param-table/picker shape when the Run tab
  // stopped embedding a rows table (see objects.js).
  t.ok(s.dataTables === 1, 'one data table, on the object popup’s Data tab: ' + s.dataTables);
  t.ok(s.liveOk && s.liveUrlInput, 'shows the real address field next to an accepted result');
  // Object popup: Attributes & access / Data / Comments (3). Flow popup:
  // Run / Comments (2) — Inputs and Access merged into Run itself.
  t.ok(s.popupTabs === 5, 'a three-tab object popup and a two-tab flow popup, five tabs total: ' + s.popupTabs);
  t.ok(s.paramRow && s.paramChosen, 'the run mockup shows a chosen parameter, not a clickable data row');
  t.ok(s.flowCols, 'inputs and access sit side by side, the real flow-cols layout');
  t.ok(s.sevCritical && s.sevMedium, 'findings use the real severity ramp, not invented colours');
  t.ok(s.codeDisplay, 'the access code reuses the real code-display component');
  t.ok(s.fileDrop, 'the first step reuses the real file-drop control');
  t.ok(s.entityCards === 3, 'three demo entities with their access badges: ' + s.entityCards);
  t.ok(s.badgeNone, 'including one with no access at all');

  // The guide is open at this point. Closing it, then reopening it, should
  // reach nothing on the server beyond the static files already served —
  // no project, no storage read, no bridge session.
  await mx.evaluate(`(function(){
    window.__requests = [];
    var realFetch = window.fetch;
    window.fetch = function (input) { window.__requests.push(String(typeof input === 'string' ? input : input.url)); return realFetch.apply(this, arguments); };
    return true; })()`);
  await mx.evaluate(clickButtonByText('Getting started')); // close
  await new Promise((r) => setTimeout(r, 200));
  t.ok(await mx.evaluate(`!document.querySelector('.guide')`), 'pressing it again closes the guide — same toggle as About');
  await mx.evaluate(clickButtonByText('Getting started')); // reopen
  await mx.waitFor(`!!document.querySelector('.guide')`, 8000, 'guide reopened');
  const reqs = JSON.parse(await mx.evaluate(`JSON.stringify(window.__requests)`));
  t.ok(reqs.filter((u) => /^\/api\//.test(u)).length === 0, 'closing and reopening it made no /api call: ' + JSON.stringify(reqs));

  // The two top-level screens are mutually exclusive — opening one puts the
  // other away, same as switching between any two single-screen views.
  // The guide is open at this point.
  await mx.evaluate(clickButtonByText('About & security'));
  await mx.waitFor(`!!document.querySelector('.about')`, 8000, 'about open');
  t.ok(await mx.evaluate(`!document.querySelector('.guide')`), 'opening About closes the guide');

  await mx.evaluate(clickButtonByText('Getting started'));
  await mx.waitFor(`!!document.querySelector('.guide')`, 8000, 'guide open from about');
  t.ok(await mx.evaluate(`!document.querySelector('.about')`), 'and opening the guide closes About');

  await mx.close();
};
