/* Versioning, and the decision at the centre of it: MxScout never asks anyone
 * whether a newer version exists. The tests therefore have to check an absence
 * as well as a presence — that the panel works, and that opening it reaches
 * nothing but MxScout itself. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  const health = await (await fetch(t.MX + '/api/health')).json();
  t.ok(health.version === pkg.version, 'the server reports the version from package.json: ' + health.version);

  const log = await (await fetch(t.MX + '/api/changelog')).json();
  t.ok(log.version === pkg.version && typeof log.text === 'string' && log.text.length > 200,
    'the changelog is served from the copy that is running (' + log.text.length + ' bytes)');
  t.ok(log.text.indexOf('## ' + pkg.version) !== -1,
    'and it has an entry for this exact version');

  // The promise this feature is built around, asserted where it is enforced.
  const headers = (await fetch(t.MX + '/')).headers.get('content-security-policy') || '';
  t.ok(/connect-src 'self'/.test(headers),
    'the page may still only talk to MxScout — connect-src is unchanged');

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxVersion', 15000, 'loaded');

  // ---- the tiny Markdown reader ----
  const md = await mx.evaluate(`(function(){
    var blocks = MxVersion.parse('# Title\\n\\n## 1.0\\n\\nSome **bold** and \\\`code\\\`.\\n\\n- one\\n- two\\n');
    var stray = MxVersion.inline('a * b \\\` c ** d');
    return {
      kinds: blocks.map(function (b) { return b.type + (b.level || ''); }).join(','),
      bullets: blocks.filter(function (b) { return b.type === 'ul'; })[0].items.length,
      spans: blocks.filter(function (b) { return b.type === 'p'; })[0].spans.map(function (s) { return s.kind; }).join(','),
      strayText: stray.map(function (s) { return s.text; }).join(''),
      strayKinds: stray.map(function (s) { return s.kind; }).join(',')
    };
  })()`);
  t.ok(md.kinds === 'h1,h2,p,ul', 'headings, paragraphs and bullets are recognised: ' + md.kinds);
  t.ok(md.bullets === 2, 'a two-item list stays a two-item list');
  t.ok(md.spans === 'text,strong,text,code,text', 'bold and inline code become spans: ' + md.spans);
  t.ok(md.strayText === 'a * b ` c ** d' && md.strayKinds === 'text',
    'a stray asterisk or backtick comes out as itself instead of swallowing the line');

  // A bullet wrapped across source lines is ONE bullet. Getting this wrong
  // split the line mid-sentence and left the asterisks of a **bold** run that
  // spanned the wrap showing on the page.
  const wrapped = await mx.evaluate(`(function(){
    var b = MxVersion.parse('- **this bold runs\\n  across the wrap** and ends\\n- second\\n');
    var list = b.filter(function (x) { return x.type === 'ul'; })[0];
    return {
      blocks: b.map(function (x) { return x.type; }).join(','),
      items: list.items.length,
      first: list.items[0].map(function (s) { return s.kind + ':' + s.text; }).join('|')
    };
  })()`);
  t.ok(wrapped.blocks === 'ul' && wrapped.items === 2,
    'a wrapped bullet stays one bullet, and the list stays a list: ' + wrapped.blocks);
  t.ok(wrapped.first === 'strong:this bold runs across the wrap|text: and ends',
    'bold spanning the wrap survives it: ' + wrapped.first);

  // Nothing in the reader can produce markup. Checked across the WHOLE of
  // public/ rather than this one file, because the About page makes this claim
  // about the codebase: one place assigns markup, it is named there, and a
  // second one appearing must fail here rather than quietly making that page
  // wrong. Matches assignment and injection, not the word in a comment.
  const ASSIGNS_MARKUP = /\.(inner|outer)HTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/g;
  const sites = [];
  fs.readdirSync(path.join(__dirname, '..', 'public'))
    .filter((f) => f.endsWith('.js'))
    .forEach((f) => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      let m;
      ASSIGNS_MARKUP.lastIndex = 0;
      while ((m = ASSIGNS_MARKUP.exec(src)) !== null) {
        sites.push(f + ':' + (src.slice(0, m.index).split('\n').length));
      }
    });
  t.ok(sites.length === 1 && sites[0].indexOf('report.js') === 0,
    'exactly one place in public/ assigns markup, and it is the documented clipboard fallback: ' + JSON.stringify(sites));

  // ---- the sidebar label and the panel ----
  // Wait for the SETTLED label, not the first non-empty one. The button reads
  // a bare "Version" until /api/health answers (app.js), so a wait that stops
  // at "any text" catches the in-flight state maybe one run in three, and the
  // failure looks like a version mismatch rather than the race it is.
  t.ok(await mx.waitFor(`(function(){ var b = document.querySelector('.sidebar-version'); return b && b.textContent === ${JSON.stringify('Version ' + pkg.version)} && b.textContent; })()`, 8000, 'version label') === 'Version ' + pkg.version,
    'the sidebar names the running version');

  // Record every request the page makes while the panel is opened.
  await mx.evaluate(`(function(){
    window.__requests = [];
    var realFetch = window.fetch;
    window.fetch = function (input) {
      window.__requests.push(String(typeof input === 'string' ? input : input.url));
      return realFetch.apply(this, arguments);
    };
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url) { window.__requests.push(String(url)); return open.apply(this, arguments); };
    return true; })()`);

  await mx.evaluate(`document.querySelector('.sidebar-version').click()`);
  t.ok(await mx.waitFor(`!!document.querySelector('.update-command')`, 8000, 'panel'),
    'clicking it opens the version panel');

  // The changelog arrives a tick later, so wait for it rather than racing it.
  await mx.waitFor(`/Runs entirely on your own machine/.test(document.querySelector('.modal').textContent)`, 10000, 'changelog rendered');
  const panel = await mx.evaluate(`document.querySelector('.modal').textContent`);
  t.ok(/does not know, and does not ask/.test(panel), 'the panel says plainly that MxScout does not check for updates');
  t.ok(await mx.evaluate(`document.querySelector('.update-command').textContent`) === 'git pull',
    'and gives the one command a person runs instead');
  t.ok(/never rewrites its own files/.test(panel), 'and says it will not update itself');
  t.ok(/Runs entirely on your own machine/.test(panel), 'the changelog for this version is rendered');
  t.ok(await mx.evaluate(`document.querySelectorAll('.changelog-list li').length > 5`),
    'including its bullet lists');
  t.ok(!/What changed in each version of MxScout/.test(panel),
    'the file\u2019s preamble is skipped — the panel already said it, one paragraph up');
  t.ok(await mx.evaluate(`document.querySelectorAll('.changelog-h2').length >= 1`),
    'and it starts at the version headings');

  const requests = await mx.evaluate(`JSON.stringify(window.__requests)`);
  const outside = JSON.parse(requests).filter((u) => /^https?:\/\//.test(u) && u.indexOf(t.MX) !== 0);
  t.ok(outside.length === 0,
    'opening it reached nothing outside MxScout — requests were ' + requests);

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Close').click()`);
  await new Promise((r) => setTimeout(r, 200));

  // ---- "you moved to a new version" ----
  // No network is involved: the fact that the version changed lives in this
  // browser, which is exactly why this can exist at all.
  await mx.evaluate(`MxStore.put('settings', { key: 'version.lastSeen.v1', value: '0.0.9', at: new Date().toISOString() })`);
  await mx.navigate(t.MX);
  // What the panel shows is THIS version's entry, so the thing to look for has
  // to come from THIS version's entry too — read out of the changelog rather
  // than typed in here, or every release breaks this test for no reason.
  const entry = (new RegExp('^## ' + pkg.version.replace(/\./g, '\\.') + '$([\\s\\S]*?)(?=^## |\\Z)', 'm')
    .exec(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8')) || [])[1] || '';
  const entryHeading = ((/^### (.+)$/m.exec(entry) || [])[1] || '').trim();
  t.ok(entryHeading.length > 5, 'this version has a changelog entry with a heading to look for: ' + JSON.stringify(entryHeading));
  const headingRe = new RegExp(entryHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /MxScout was updated/.test(m.textContent); })()`, 15000, 'whats new');
  const whatsNew = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return ` + headingRe.toString() + `.test(m.textContent) && m.textContent; })()`, 10000, 'whats new changelog');
  t.ok(/You were on 0\.0\.9/.test(whatsNew) && new RegExp('This is ' + pkg.version.replace(/\./g, '\\.')).test(whatsNew),
    'on the next start it says which version you left and which you are on');
  t.ok(headingRe.test(whatsNew), 'and shows what changed in the one you moved onto');
  t.ok(!/What changed in each version of MxScout/.test(whatsNew),
    'limited to that version’s entry, not the whole file’s preamble');

  // Reloading WITHOUT confirming must show it again: it is a thing to
  // acknowledge, not a thing to have been ticked off on your behalf.
  await mx.navigate(t.MX);
  t.ok(await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return !!m && /MxScout was updated/.test(m.textContent); })()`, 15000, 'still waiting'),
    'closing without confirming leaves it waiting for next time');

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Got it').click()`);
  await new Promise((r) => setTimeout(r, 300));
  t.ok(await mx.evaluate(`!document.querySelector('.modal')`), 'confirming it closes it');

  await mx.navigate(t.MX);
  await mx.waitFor(`!!document.querySelector('.sidebar-version')`, 10000, 'reloaded');
  await new Promise((r) => setTimeout(r, 800));
  t.ok(await mx.evaluate(`!document.querySelector('.modal')`),
    'and once confirmed it does not come back on the next start');

  // The About page is a promise to a security reviewer, and the rule in this
  // repository is that it moves in the same commit as the behaviour. This
  // feature added an endpoint and a stated policy, so both must be on it.
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => /About & security/.test(b.textContent)).click()`);
  const about = await mx.waitFor(`(function(){ var t = document.body.innerText; return /Every endpoint/.test(t) && t; })()`, 10000, 'about');
  t.ok(!(await mx.evaluate(`document.querySelector('.content-wrap').classList.contains('wide')`)),
    'the About page stays at reading width, not stretched full-bleed like the map/flow views');
  t.ok(/\/api\/changelog/.test(about), 'About lists the new endpoint');
  t.ok(/Versions and updates/.test(about), 'About has a section on versions and updates');
  t.ok(/does not check whether a newer version exists/.test(about), 'and states the policy in those words');
  t.ok(/never rewrites its own files|git pull/.test(about), 'and says who performs an update');
  t.ok(/public\/version\.js/.test(about), 'and the new file is in the source map');
  t.ok(/public\/timeline\.js/.test(about),
    'and so is the timeline, split out of perf.js — a file the source map does not name is a file nobody auditing this can find');
  t.ok(/exactly ONE place/i.test(about), 'the corrected markup claim is on it too');

  await mx.close();
};
