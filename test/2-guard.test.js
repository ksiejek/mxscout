/* The production guard. It exists in two places by necessity — live.js decides
 * what the UI offers, and bridge.js carries the copy that actually runs on the
 * target page — so the first thing to check is that they still agree. Drift
 * between them is silent and would only ever be discovered by someone scanning
 * production. */
'use strict';
const fs = require('fs');
const path = require('path');

function tokensFrom(file, varName) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
  const m = new RegExp('var ' + varName + ' = \\{([\\s\\S]*?)\\};').exec(src);
  if (!m) throw new Error('could not find ' + varName + ' in ' + file);
  return m[1].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean).sort();
}

module.exports = async function (t) {
  const ui = tokensFrom('live.js', 'NONPROD_TOKENS');
  const bridge = tokensFrom('bridge.js', 'NONPROD');
  t.ok(ui.length > 10, 'the UI copy of the token list was found (' + ui.length + ' tokens)');
  t.ok(ui.join(',') === bridge.join(','),
    'the two copies of the non-production token list are identical');

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!document.querySelector(".sidebar")', 15000, 'MxScout loaded');

  // Drive the real input, because the contract that matters is what the user
  // is allowed to do — not what a function returns.
  async function verdict(url) {
    await mx.evaluate(
      '(function(){' +
      '  var i = document.querySelector(".live-url-input");' +
      '  if (!i) return false;' +
      '  i.value = ' + JSON.stringify(url) + ';' +
      '  i.dispatchEvent(new Event("input", { bubbles: true }));' +
      '  Array.from(document.querySelectorAll("button")).filter(function (b) { return b.textContent.trim() === "Check"; })[0].click();' +
      '  return true; })()'
    );
    await new Promise((r) => setTimeout(r, 150));
    return mx.evaluate(
      'document.querySelector(".live-status-ok") ? "allow" :' +
      ' (document.querySelector(".live-status-blocked") ? "block" : "none")'
    );
  }

  const MODEL = require('./model');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel({ id: 'g1', name: 'Guard', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, ${JSON.stringify(MODEL)});
    return true; })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Guard')`, 10000, 'project');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Guard'); e[e.length-1].click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 600));
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /Live/i.test(n.textContent))[0].click()`);
  await mx.waitFor('!!document.querySelector(".live-url-input")', 8000, 'live tab');

  const cases = [
    ['http://localhost:8080', 'allow', 'localhost'],
    ['http://127.0.0.1:8080', 'allow', 'loopback'],
    ['https://myapp-test.mendixcloud.com', 'allow', 'a -test label'],
    ['https://myapp.acc.example.com', 'allow', 'an acc label'],
    ['https://shop-uat.example.com', 'allow', 'a uat label'],
    ['https://myapp.mendixcloud.com', 'block', 'a bare mendixcloud host'],
    ['https://account.company.com', 'block', '"account" is not an acc environment'],
    ['https://contest.example.com', 'block', '"contest" is not a test environment'],
    ['https://devices.example.com', 'block', '"devices" is not a dev environment'],
    ['https://10.4.2.9', 'block', 'a LAN address'],
    ['ftp://test.example.com', 'block', 'a non-http scheme'],
    ['not a url at all', 'block', 'unparseable input']
  ];
  for (const [url, want, why] of cases) {
    const got = await verdict(url);
    t.ok(got === want, why + ' → ' + want + (got === want ? '' : ' (got ' + got + ')'));
  }

  // Close the tab. MxScout is single-session by design — a second window mints
  // a fresh token and supersedes the first — so a tab left open here would be
  // competing with the next test for the one session.
  await mx.close();
};
