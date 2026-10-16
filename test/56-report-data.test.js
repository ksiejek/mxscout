/* The report's derived values (public/reportdata.js) against the reference
 * they were ported from.
 *
 * The redesign handoff ships the reference as a Python script
 * (derive_report_data.py, kept outside the repository with the rest of the
 * handoff). Its output for test/fixtures/report-data-input.json — a small,
 * made-up project with every case the script distinguishes: risks matched
 * to a theme by Polish keywords, one with its own theme, one naming a place
 * the model does not have; calls and associations across modules and into a
 * Marketplace module; prefixes Mendix does and does not recommend; a
 * switched-off step; processes, conventions with patterns, pitfalls — was
 * written once to test/fixtures/report-data-expected.json. This holds the
 * port to it, value for value, so the suite needs no Python to run. */
'use strict';
const { readText } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const input = JSON.parse(readText(path.join(__dirname, 'fixtures', 'report-data-input.json')));
  const expected = JSON.parse(readText(path.join(__dirname, 'fixtures', 'report-data-expected.json')));

  // The port runs in the page; this runs it the same way, against a window of its own.
  const sandbox = {};
  new Function('window', readText(path.join(__dirname, '..', 'public', 'reportdata.js')))(sandbox);
  const R = sandbox.MxReportData;
  const all = R.derive(JSON.parse(JSON.stringify(input)));
  const got = Object.assign({}, all, { domain: { Sales: R.domain(input, 'Sales'), Admin: R.domain(input, 'Admin') } });

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  ['risks', 'arch', 'quality', 'dev', 'proc', 'modules', 'domain'].forEach(function (k) {
    t.ok(same(got[k], expected[k]), k + ' matches the reference' + (same(got[k], expected[k]) ? '' : ':\n      got      ' + JSON.stringify(got[k]).slice(0, 400) + '\n      expected ' + JSON.stringify(expected[k]).slice(0, 400)));
  });

  // The cases worth naming, so a regression says what broke.
  t.ok(got.risks.map(function (r) { return r[1]; }).join(',') === 'delete,secrets,naming,schedule,loops,naming,logic',
    'each risk gets a theme from its Polish title, its own theme when it names one, and the fallback otherwise: ' + got.risks.map(function (r) { return r[1]; }).join(','));
  t.ok(got.risks[6][5][0] === 'Sales.Nowhere|x', 'a place the model does not have is kept, marked x');
  t.ok(same(got.arch.mat, { Sales: { Admin: [1, 1], Atlas_Core: [1, 0] }, Admin: { Sales: [2, 1] } }),
    'calls and associations between modules are counted per pair, the Marketplace module included: ' + JSON.stringify(got.arch.mat));
  t.ok(got.quality.over === 2 && got.quality.pref.map(function (p) { return p[0]; }).join(',') === 'GET,BCo,NF,SCH',
    'model quality: two flows over 25 elements, the prefixes Mendix does not recommend: ' + JSON.stringify(got.quality.pref));
  t.ok(got.dev.conv.map(function (c) { return c[2]; }).join(',') === '2,1,1,,1',
    'a convention counts the names its pattern matches, and none when it is not a pattern: ' + JSON.stringify(got.dev.conv.map(function (c) { return c[2]; })));
  t.ok(same(got.proc.procs[0].flows[2], ['Sales.Nowhere', 'x', 0]) && got.proc.procs[0].risks.map(function (r) { return r[2]; }).join(',') === '0,5,6',
    'a process lists its flows and the risks that name any of them, by level: ' + JSON.stringify(got.proc.procs[0].risks));
  t.ok(got.domain.Sales.ents.Order.access[0][6] === "Order_Owner = '[%CurrentUser%]' or\nOrder_Team/Team/Name = 'X']".replace(/^/, '[') ,
    'an XPath is shown without module prefixes, broken at each or: ' + JSON.stringify(got.domain.Sales.ents.Order.access[0][6]));
};
