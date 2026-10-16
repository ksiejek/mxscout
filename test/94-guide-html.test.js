/* The team guide as one HTML page (public/guide-team.html · tools/build-guide.js · server/index.js · repodocs.js).
 *
 * Karol, 2026-10-15: one canonical page people can be pointed at — committed in the repository (anyone can
 * download it from GitHub), served by MxScout, written into each Mendix project as mxscout/GUIDE.html. It is
 * made from public/guide-team.md by a script run by hand, so what is checked here is what would drift
 * silently: the committed page is exactly what the script makes from the Markdown now; it loads nothing
 * (no remote script, stylesheet, font or image — its links are plain links a person may follow); it holds
 * both languages; the server serves it with a policy that allows its one script by hash and nothing else,
 * and under that policy the fonts load and the language switch works; the app links to it; and the copy
 * written into a project carries the stamp on its second line, so it stays a valid page and only a newer
 * MxScout replaces it. (Writing it into mxscout/ is test/91-repo-folder.test.js.)
 */
'use strict';
const { readText } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const root = path.join(__dirname, '..');
  const build = require(path.join(root, 'tools', 'build-guide.js'));
  const page = readText(path.join(root, 'public', 'guide-team.html'));
  const md = readText(path.join(root, 'public', 'guide-team.md'));

  // ---- the committed page is what the Markdown makes ----
  t.ok(build.make() === page, 'public/guide-team.html is exactly what tools/build-guide.js makes from public/guide-team.md now — run it after changing the guide');
  t.ok(page.startsWith('<!doctype html>\n<html lang="en">\n') && /<\/html>\n$/.test(page), 'a whole page, <!doctype html> on its first line');

  // ---- both languages, every section ----
  const sections = (lang) => (page.match(new RegExp('<h3 id="' + lang + '-\\d+">', 'g')) || []).length;
  const mdSections = (md.match(/^### /gm) || []).length;
  t.ok(/<div lang="en" class="show">/.test(page) && /<div lang="pl">/.test(page), 'both languages are in it, English shown first');
  t.ok(sections('en') + sections('pl') === mdSections && sections('en') === sections('pl'),
    'every section of the guide in both: ' + sections('en') + ' + ' + sections('pl') + ' of ' + mdSections);
  t.ok(/What this is/.test(page) && /Co to jest/.test(page) && /Where to find this guide/.test(page) && /Gdzie jest ten przewodnik/.test(page),
    'the English and the Polish text, with where to find the guide in each');

  // ---- it loads nothing ----
  t.ok(!/<script[^>]*\ssrc\s*=/i.test(page) && (page.match(/<script/gi) || []).length === 1, 'one script, inline — no <script src>');
  t.ok(!/<link\b/i.test(page) && !/<(img|iframe|object|embed|video|audio|source)\b/i.test(page) && !/\ssrc\s*=/i.test(page), 'no <link>, no image or frame, no src= of any kind');
  t.ok(!/@import/i.test(page) && !/url\((?!data:font\/woff2;base64,)/.test(page), 'no @import, and every url() in the stylesheet is a data: font');
  const hrefs = page.match(/<[a-z]+\b[^>]*\shref="[^"]*"/gi) || [];
  const outbound = hrefs.filter((h) => !/\shref="#/.test(h));
  t.ok(outbound.every((h) => /^<a\s/.test(h) && /\shref="https:\/\//.test(h)), 'every href outside the page is a plain link in the text, which a person may follow: ' + JSON.stringify(outbound));
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
  t.ok(!/fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|cookie|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(script),
    'its script reaches nothing, stores nothing and writes no markup — only the language switch');

  // ---- served with a policy of its own ----
  const hash = build.scriptHash(page);
  const server = readText(path.join(root, 'server', 'index.js'));
  t.ok(hash && server.indexOf("script-src " + hash + ";") !== -1, 'server/index.js names the page’s script by its SHA-256: ' + hash);
  const res = await fetch(t.MX + '/guide-team.html');
  const csp = res.headers.get('content-security-policy') || '';
  t.ok(res.status === 200 && (await res.text()) === page, 'MxScout serves the committed page as it is');
  t.ok(/^default-src 'none'; /.test(csp) && csp.indexOf("script-src " + hash + ";") !== -1 && /style-src 'unsafe-inline'/.test(csp) && /font-src data:/.test(csp) &&
    !/'self'|unsafe-eval|https?:/.test(csp.replace("style-src 'unsafe-inline'", '')) && /frame-ancestors 'none'/.test(csp),
    'with a policy that loads nothing, this server included, and runs only that script: ' + csp);
  const appCsp = (await fetch(t.MX + '/')).headers.get('content-security-policy') || '';
  t.ok(/script-src 'self';/.test(appCsp) && appCsp.indexOf('sha256') === -1, 'the app’s own policy is unchanged: ' + appCsp);

  // ---- under that policy it works: the fonts load, the switch switches ----
  const g = await t.tab(t.MX + '/guide-team.html#en');
  await g.waitFor(`document.documentElement.lang === 'en' && getComputedStyle(document.querySelector('div[lang="en"]')).display === 'block'`, 8000, 'the guide, in English');
  const fonts = await g.evaluate(`Promise.all(Array.from(document.fonts).map(function (f) { return f.load().then(function () { return f.family + ':' + f.status; }, function () { return f.family + ':error'; }); })).then(function (r) { return r.join(','); })`);
  t.ok(fonts === 'Instrument Sans:loaded,JetBrains Mono:loaded', 'its two fonts load from inside the page, under its policy: ' + fonts);
  t.ok(await g.evaluate(`getComputedStyle(document.documentElement).display !== 'none' && getComputedStyle(document.querySelector('div[lang="pl"]')).display === 'none' && document.querySelector('.toc a') !== null`),
    'the page shows, one language at a time, with its contents');
  await g.evaluate(`document.getElementById('b-pl').click()`);
  const pl = await g.waitFor(`document.documentElement.lang === 'pl' && getComputedStyle(document.querySelector('div[lang="pl"]')).display === 'block' && getComputedStyle(document.querySelector('div[lang="en"]')).display === 'none' && JSON.stringify([location.hash, document.querySelector('.mark span').textContent, document.getElementById('b-pl').getAttribute('aria-pressed')])`, 5000, 'Polish');
  t.ok(pl === JSON.stringify(['#pl', 'Przewodnik dla zespołu', 'true']), 'PL switches it to Polish, kept in the address and not in storage: ' + pl);
  await g.close();

  // ---- the app links to it ----
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!document.querySelector(".help-menu")', 15000, 'MxScout loaded');
  const link = await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.help-menu a')).map(function (a) { return [a.textContent, a.getAttribute('href'), a.target, a.rel]; }))`);
  t.ok(link === JSON.stringify([['Team guide ↗', '/guide-team.html', '_blank', 'noopener']]), 'the sidebar’s foot has Team guide beside About & security, opening the page in a new tab: ' + link);
  // The projects screen, as test/27-guide.test.js reaches it: with a project open (an earlier test's, in this
  // browser), the switcher's menu leads there.
  await mx.evaluate(`(function(){
    var s = document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click();
    var b = Array.from(document.querySelectorAll('button')).find(function (n) { return n.textContent.trim() === 'All projects'; }); if (b) b.click();
    return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent.trim() === 'Getting started'; })`, 8000, 'projects screen');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent.trim() === 'Getting started'; }).click()`);
  const fromGuide = await mx.waitFor(`(function(){ var a = document.querySelector('.guide-team-link a'); return a && JSON.stringify([a.getAttribute('href'), a.target]); })()`, 8000, 'Getting started');
  t.ok(fromGuide === JSON.stringify(['/guide-team.html', '_blank']), 'and Getting started points to it too: ' + fromGuide);

  // ---- the copy written into a project: stamped on its second line, replaced only by a newer MxScout ----
  const st = await mx.evaluate(`MxRepoDocs.stamp(MxFolder.EDITION, '1.13.0')`);
  const stamped = await mx.evaluate(`fetch('/guide-team.html').then(function (r) { return r.text(); }).then(function (h) { return MxRepoDocs.guideHtml(h, ${JSON.stringify(st)}); })`);
  const lines = stamped.split('\n');
  t.ok(lines[0] === '<!doctype html>' && lines[1] === '<!-- ' + st + ' — written by MxScout; it replaces this file only with a newer copy. -->' && lines.slice(2).join('\n') === page.split('\n').slice(1).join('\n'),
    'GUIDE.html is the page with the stamp as an HTML comment on its second line — still a valid page: ' + lines[1]);
  const rules = JSON.parse(await mx.evaluate(`(function(){ var R = MxRepoDocs, h = ${JSON.stringify(stamped)};
    return JSON.stringify({ same: R.guideHtml(h.split('\\n').filter(function (l, i) { return i !== 1; }).join('\\n'), ${JSON.stringify(st)}) === h,
      parsed: R.parseStamp(h), newerOverOld: R.newer(${JSON.stringify(st)}, R.guideHtml(h, R.stamp(MxFolder.EDITION, '1.0.0'))),
      sameAgain: R.newer(${JSON.stringify(st)}, h), olderOverNew: R.newer(R.stamp(MxFolder.EDITION, '1.0.0'), h) }); })()`));
  t.ok(rules.same && rules.parsed && rules.parsed.v.join('.') === '1.13.0' && rules.newerOverOld && !rules.sameAgain && !rules.olderOverNew,
    'the same text from the same version byte for byte; a newer MxScout replaces it, the same or an older one does not: ' + JSON.stringify(rules));
  await mx.close();
};
