/* Log analysis — the module brought over from MxDevSwissTool (see THIRD-PARTY-NOTICES.md).
 *
 * Two layers. The ENGINE is the original's code, so it is checked with the original's own assertions
 * (test/logs/engine-parity.js, plain Node): if one fails, MxScout no longer reads a log the way the original
 * does. The SCREEN is MxScout's own, so it is driven in a real browser: one log loaded, Insights and the
 * slow queries read off it, nothing leaving the tab, nothing thrown.
 *
 * Since 2026-10-09 the section is the Log Viewer alone — the stream, Insights, Slow queries and, inside a
 * project, In your model. The other seven tools were taken out, and this file checks that they stay out. */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

module.exports = async function (t) {
  // ---- the engine, against the original's assertions ----
  const parity = spawnSync(process.execPath, [path.join(__dirname, 'logs', 'engine-parity.js')], { encoding: 'utf8' });
  const summary = /(\d+) passed, (\d+) failed/.exec(parity.stdout || '') || [];
  t.ok(parity.status === 0 && summary[2] === '0' && Number(summary[1]) > 400,
    'the log engine passes the original\'s assertions: ' + (summary[0] || (parity.stdout + parity.stderr).slice(-300)));

  // ---- the credit is where a reader of the repository looks for it ----
  const root = path.join(__dirname, '..');
  const notices = fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  t.ok(/MxDevSwissTool/.test(notices) && /Permission is hereby granted, free of charge/.test(notices) && /RealMecowhy/.test(notices),
    'THIRD-PARTY-NOTICES.md names the original, its author, and carries the MIT licence text');
  t.ok(/MxDevSwissTool/.test(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')), 'the changelog credits it');
  const engineFiles = fs.readdirSync(path.join(root, 'public', 'logs', 'engine'));
  const uncredited = engineFiles.filter((f) => !/RealMecowhy/.test(fs.readFileSync(path.join(root, 'public', 'logs', 'engine', f), 'utf8').slice(0, 1500)));
  t.ok(uncredited.length === 0, 'every ported engine file carries the attribution header: ' + JSON.stringify(uncredited));
  t.ok(engineFiles.sort().join(',') === 'decoder.js,insights.js,parser.js,sql.js',
    'the engine is the parser, Insights with the rules its error card uses, and the SQL highlighter — nothing else: ' + engineFiles.join(', '));

  // ---- the screen ----
  const sample = require('./logs/sample-log.js');
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxLogs', 15000, 'MxScout loaded');
  await mx.evaluate(`window.__errs = []; window.addEventListener('error', function (e) { window.__errs.push(e.message); });
    window.addEventListener('unhandledrejection', function (e) { window.__errs.push(String(e.reason && e.reason.message || e.reason)); });
    window.__requests = [];
    var rf = window.fetch; window.fetch = function (i) { window.__requests.push(String(typeof i === 'string' ? i : i.url)); return rf.apply(this, arguments); };`);
  const click = (re) => mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => ${re}.test(b.textContent)).click()`);
  const tab = (re) => mx.evaluate(`Array.from(document.querySelectorAll('.lg-tab')).find(b => ${re}.test(b.textContent)).click()`);
  const count = (sel) => mx.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

  // Earlier tests leave a project open in this browser; the model-less entry is for when none is.
  // The app reopens the last project on its own once storage answers; wait for that to have happened, or it
  // can reopen it right after "All projects" and take the Tools entry away again.
  await mx.waitFor(`!!document.querySelector('.tree-project, .tree-empty')`, 10000, 'projects listed');
  await new Promise((r) => setTimeout(r, 800));
  await mx.evaluate(`(Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'All projects') || { click() {} }).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Log analysis')`, 5000, 'tools entry');
  await click(/^Log analysis$/);
  await mx.waitFor(`!!document.querySelector('.lg')`, 8000, 'log analysis screen');
  const tabs = await mx.evaluate(`Array.from(document.querySelectorAll('.lg-tab')).map(b => b.textContent.replace(/ ·.*$/, ''))`);
  t.ok(tabs.join('|') === 'Log Stream|Insights|Slow queries|In your model', 'one viewer, four tabs: ' + tabs.join(' | '));
  t.ok(await mx.evaluate(`Object.keys(MxLogs.tools).join(',') === 'log-viewer' && !MxLogs.hub && !MxLogs.goto`),
    'the other tools, the bar that shared a file between them and the navigation between them are gone');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.lg button')).some(b => /Explain|Decode|Anonymize in tool|Query Extractor/.test(b.textContent))`),
    'and nothing on the screen still offers to send a line to one of them');
  t.ok(/MxDevSwissTool/.test(await mx.evaluate(`document.querySelector('.lg-credit').textContent`)), 'the screen says where it comes from');

  await mx.evaluate(`MxLogs.tools['log-viewer'].loadFiles([new File([${JSON.stringify(sample)}], 'sample.log')])`);
  await mx.waitFor(`document.querySelectorAll('.lg-row').length > 5`, 10000, 'rows');
  const stats = await mx.evaluate(`document.querySelector('.lg-stats').textContent`);
  t.ok(/Total:\s*42/.test(stats), 'the stats bar counts the log: ' + stats);

  await tab(/^Insights/);
  t.ok(await count('.lg-insights-card') >= 5, 'insights found the patterns in the sample');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.lg-insights-card')).some(c => /Slow queries/.test(c.textContent) && /3 slow queries/.test(c.textContent))`),
    'the slow-query card counts all three warnings');

  // The card's link leads to the tab, and the tab agrees with the card.
  await click(/^Open Slow queries$/);
  await mx.waitFor(`document.querySelectorAll('.lg-slow-card').length > 0`, 4000, 'slow queries');
  t.ok(/Slow queries · 3/.test(await mx.evaluate(`Array.from(document.querySelectorAll('.lg-tab')).map(b => b.textContent).join('|')`)), 'the tab says how many there are');
  const cards = await mx.evaluate(`Array.from(document.querySelectorAll('.lg-slow-card')).map(c => c.querySelector('.lg-slow-head').textContent)`);
  t.ok(cards.length === 2, 'two statements, the two runs of one grouped together: ' + JSON.stringify(cards));
  t.ok(/a\$b/.test(cards[0]) && /3\.6 s/.test(cards[0]) && /2×/.test(cards[0]) && /sales\$order/.test(cards[1]),
    'ordered by the time each cost in total, not by the worst single run: ' + JSON.stringify(cards));
  await mx.evaluate(`document.querySelector('.lg-slow-head').click()`);
  t.ok(await count('.lg-slow-detail:not([hidden]) .lg-code-sql') === 1, 'opening a statement shows its SQL, highlighted');
  t.ok(await count('.lg-slow-detail:not([hidden]) .lg-slow-run') === 2, 'and both of its executions');
  const firstRun = await mx.evaluate(`document.querySelector('.lg-slow-run').textContent`);
  t.ok(/^2\.2 s/.test(firstRun), 'slowest first, and 2150 ms reads as 2.2 s: ' + firstRun);
  await mx.evaluate(`document.querySelector('.lg-slow-run').click()`);
  await mx.waitFor(`!document.querySelector('.lg-pane-stream').hidden && !!document.querySelector('.lg-row.is-flash')`, 4000, 'jump to the line');
  t.ok(/Query executed in 2 seconds and 150 milliseconds/.test(await mx.evaluate(`document.querySelector('.lg-row.is-flash').textContent`)),
    'an execution opens its own line in the stream');

  await tab(/^Log Stream/);
  await mx.evaluate(`document.querySelector('.lg-lvlchip-error').click()`);
  t.ok(await count('.lg-row') > 0 && await count('.lg-row') < 42, 'filtering to errors narrows the stream');
  await click(/Aggregate errors/);
  await mx.waitFor(`document.querySelectorAll('.lg-sig-card').length > 0`, 4000, 'signatures');
  t.ok(await count('.lg-sig-card') >= 3, 'errors are grouped by signature');
  await mx.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  // Leaving and coming back keeps the work.
  await click(/Getting started/);
  await click(/^Log analysis$/);
  await mx.waitFor(`document.querySelectorAll('.lg-row').length > 0`, 4000, 'state kept');
  t.ok(true, 'the screen keeps its state while the rest of the app redraws');

  const errs = await mx.evaluate('window.__errs');
  t.ok(errs.length === 0, 'nothing was thrown: ' + JSON.stringify(errs));
  const reqs = await mx.evaluate('window.__requests');
  t.ok(reqs.every((r) => r.startsWith('/') || r.startsWith(t.MX)), 'and nothing was requested beyond this server: ' + JSON.stringify(reqs));
  await mx.close();
};
