/* Three bugs in the same area, fixed together: the Live tab used to render
 * the "Connect your app tab" instructions and its snippet TWICE
 * (renderLivePanel called renderBridgeSection directly, and again inside
 * renderExecSection) — two identical boxes, two "Copy the code" buttons, no
 * way to tell they were the same thing. A rejected fetch() to MxScout was
 * always reported as "this app blocks the connection" (a CSP diagnosis),
 * even when the real reason was that MxScout simply couldn't be reached at
 * all — the most common real case being MxScout and the app tab on
 * different machines, where a loopback address never crosses the boundary.
 * And — the one a real screenshot from a real failed connection caught —
 * a response that DID come back but wasn't ok (most often a 403 for a
 * stale token, from reloading MxScout or a second tab replacing the one
 * active session) was ALSO folded into "bad status" and read as
 * unreachable, discarding the server's own, exact answer for why. */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  // ---- exactly one connect snippet on the Live tab, not two ----
  const mx = await openSeededProject(t, t.APP);
  // The snippet only appears once the session token comes back, so wait for
  // it to exist before counting — otherwise this races the first render,
  // which legitimately shows a spinner and no snippet at all.
  await mx.waitFor(`!!document.querySelector('.scan-script')`, 10000, 'snippet rendered');
  t.ok(await mx.evaluate(`document.querySelectorAll('.scan-script').length === 1`),
    'the Live tab shows exactly one connect snippet, not a duplicate');
  t.ok(await mx.evaluate(`document.querySelectorAll('.scan-copy-row').length === 1`),
    'and exactly one Copy button with it');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('h4')).filter(h => h.textContent === 'Connect your app tab').length === 1`),
    'and the instructions appear once, not twice');

  // ---- a genuinely unreachable MxScout is diagnosed differently from a CSP block ----
  const snippet = await mx.evaluate(`document.querySelector('.scan-script').value`);
  // No CSP header is served by t.APP without ?csp=1 — this is a plain page,
  // so any connection failure here can only be a real network failure, not
  // a policy block. Point the snippet at a port nothing listens on instead
  // of MxScout's real one.
  const brokenSnippet = snippet.replace(/"origin":"[^"]*"/, '"origin":"http://127.0.0.1:1"');
  t.ok(brokenSnippet !== snippet, 'the origin was actually rewritten for this test');

  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + brokenSnippet + ' return true; })()');
  const diagnosis = await app.waitFor(`(function(){ var t = document.body.textContent; return /Could not reach MxScout/.test(t) && t; })()`, 12000, 'unreachable diagnosis');
  t.ok(/not.*a security policy/i.test(diagnosis) || /not a security policy/.test(diagnosis),
    'an unreachable MxScout is diagnosed as unreachable, not as a CSP block: ' + diagnosis.slice(0, 300));
  t.ok(!/blocks the connection to MxScout/.test(diagnosis),
    'and does NOT claim the app blocked it, since nothing here actually did');
  t.ok(/same machine|VM/.test(diagnosis), 'and points at the actual common cause: ' + diagnosis.slice(0, 300));

  // ---- a stale/wrong token reaches the real MxScout, and gets its real answer ----
  // A fresh page load first: each snippet paste mounts its own panel without
  // removing an earlier one, and the previous scenario's diagnosis text is
  // still sitting in this same document otherwise — real usage never pastes
  // three snippets onto one unreloaded page, so this just keeps the test
  // honest about which panel it is reading.
  await app.navigate(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab reloaded');
  const staleSnippet = snippet.replace(/"token":"[^"]*"/, '"token":"0000000000000000000000000000000000000000"');
  t.ok(staleSnippet !== snippet, 'the token was actually rewritten for this test');
  await app.evaluate('(function(){ ' + staleSnippet + ' return true; })()');
  const refused = await app.waitFor(`(function(){ var t = document.body.textContent; return /MxScout refused this connection/.test(t) && t; })()`, 12000, 'refusal diagnosis');
  t.ok(/reconnect in MxScout for a fresh/.test(refused), 'the server’s own reason for the 403 is shown, not a generic failure: ' + refused.slice(0, 300));
  t.ok(!/blocks the connection to MxScout/.test(refused) && !/Could not reach MxScout/.test(refused),
    'and it is told apart from both a CSP block and an unreachable host, since neither is what actually happened');

  await mx.close(); await app.close();
};
