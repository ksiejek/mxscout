/* The skill that sits on top of the exchange file (skills/mendix-change-proposal).
 *
 * It ships with MxScout but is not part of the app: no server route, no
 * browser file, nothing loaded by index.html. What makes it worth a test is
 * that its checker encodes claims about a SECOND program — what MxScaffold's
 * importer does with a file — and those claims are the whole value of the
 * skill. A claim nobody checks is the kind that quietly stops being true.
 *
 * So the first case runs the checker over a document built HERE by the real
 * exporter, from the real fixture: if public/exchange.js ever starts writing
 * something the checker objects to, one of the two is wrong and this says so.
 *
 * The rule the checker exists for: MxScaffold's mergeFlows matches a flow on
 * (module, name) and never overwrites one that is already there — it skips it
 * as "already here". A proposal that keeps the original's name therefore
 * imports as NOTHING, and no screen on either side says so. */
'use strict';
const fs = require('fs');
const path = require('path');

const SKILL = path.join(__dirname, '..', 'skills', 'mendix-change-proposal');
const { review } = require(path.join(SKILL, 'check-proposal.js'));

const levels = (problems) => problems.map((p) => p.level).join(',');
const says = (problems, fragment) => problems.some((p) => p.text.indexOf(fragment) !== -1);
const clone = (value) => JSON.parse(JSON.stringify(value));

const flowsDoc = (flow) => ({
  mxscaffold: 'flows',
  schemaVersion: 1,
  flows: [Object.assign({ name: 'Sales.ACT_X', kind: 'microflow', steps: [], edges: [] }, flow)],
});

module.exports = async function (t) {
  // ---- the skill is a directory somebody can read, and says what it needs ----
  const skillText = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  t.ok(/^---\nname: mendix-change-proposal\ndescription: /.test(skillText),
    'SKILL.md opens with the frontmatter a skill is found by');
  const referenced = (skillText.match(/reference\/[a-z-]+\.md/g) || []);
  t.ok(referenced.length >= 2 &&
    referenced.every((rel) => fs.existsSync(path.join(SKILL, rel))),
    'every reference file it tells the reader to open exists: ' + referenced.join(', '));

  // ---- a document from the real exporter passes as written ----
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8'));

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '${src}';
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('failed to load ${src}')); };
      document.head.appendChild(s);
    })`);
  }
  const built = await mx.evaluate(`(async function () {
    var sidecar = ${JSON.stringify(sidecar)};
    function b64ToBuffer(b64) {
      var bin = atob(b64);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8.buffer;
    }
    var bytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales',
      readContentsFile: function (rel) { return Promise.resolve(sidecar[rel] ? b64ToBuffer(sidecar[rel]) : null); } });
    return window.MxExchange.buildFlowsDocument(model, { version: '9.9.9' }).doc;
  })()`);

  const fromMxScout = review(built, null);
  t.ok(fromMxScout.length === 0,
    'what MxScout itself writes passes the checker untouched (' + built.flows.length + ' flows): ' +
    fromMxScout.map((p) => p.where + ' ' + p.text).join(' · '));

  // ---- the rule the whole skill turns on ----
  const collisions = review(built, built);
  t.ok(collisions.length === built.flows.length && levels(collisions).indexOf('WARNING') === -1,
    'a proposal that keeps the original names is an ERROR on every flow, not a warning: ' + levels(collisions));
  t.ok(says(collisions, 'would import as nothing'),
    'and it says why — the importer skips it as already here, silently');

  const renamed = clone(built);
  renamed.flows.forEach((f) => { f.name = f.name + '_Proposal'; });
  t.ok(review(renamed, built).length === 0,
    'renaming the documents clears it, which is the fix the skill prescribes');

  // A name differing only in case is the SAME name to the importer, which
  // lowercases both sides before matching.
  const recased = clone(built);
  recased.flows.forEach((f) => { f.name = f.name.toUpperCase(); });
  t.ok(review(recased, built).length === built.flows.length,
    'a name that differs only in capitals is still taken: ' + levels(review(recased, built)));

  // ---- what the reader draws differently from what was written ----
  const unknownType = review(flowsDoc({
    steps: [{ id: 'n1', kind: 'activity', type: 'teleportObject', action: 'TeleportAction', at: { x: 0, y: 0 } }],
  }), null);
  t.ok(levels(unknownType) === 'WARNING' && says(unknownType, 'draws it as an annotation'),
    'an invented type is a warning, not an error — the reader draws it as an annotation rather than refusing it');

  const dangling = review(flowsDoc({
    steps: [{ id: 'n1', kind: 'start', type: 'start', at: { x: 0, y: 0 } }],
    edges: [{ from: 'n1', to: 'n9' }],
  }), null);
  t.ok(levels(dangling) === 'ERROR' && says(dangling, 'the arrow is dropped'),
    'an arrow to a step that is not there is an error: the importer drops it');

  const noPositions = review(flowsDoc({
    steps: [{ id: 'n1', kind: 'start', type: 'start' }, { id: 'n2', kind: 'end', type: 'end' }],
    edges: [{ from: 'n1', to: 'n2' }],
  }), null);
  t.ok(levels(noPositions) === 'WARNING' && says(noPositions, 'one pile'),
    'a proposal with no coordinates is flagged — every step lands at 0,0, which is not a layout');

  const bareDecision = review(flowsDoc({
    steps: [
      { id: 'n1', kind: 'decision', type: 'decision', at: { x: 0, y: 0 } },
      { id: 'n2', kind: 'end', type: 'end', at: { x: 200, y: 0 } },
    ],
    edges: [{ from: 'n1', to: 'n2' }],
  }), null);
  t.ok(says(bareDecision, 'they come from the edges'),
    'a branch whose arrows carry no caseValue is flagged where the outcomes actually live');

  const badParent = review(flowsDoc({
    steps: [
      { id: 'n1', kind: 'activity', type: 'retrieve', at: { x: 0, y: 0 } },
      { id: 'n2', kind: 'activity', type: 'commit', at: { x: 200, y: 0 }, parent: 'n1' },
    ],
  }), null);
  t.ok(says(badParent, 'only a loop contains other steps'),
    'a step parented to something that is not a loop is flagged');

  const missingParent = review(flowsDoc({
    steps: [{ id: 'n1', kind: 'activity', type: 'retrieve', at: { x: 0, y: 0 }, parent: 'n7' }],
  }), null);
  t.ok(levels(missingParent) === 'ERROR', 'a parent that is not in the flow is an error: ' + levels(missingParent));

  // ---- the domain model file, where the merge rule is the opposite ----
  const before = {
    mxscaffold: 'domain-model',
    schemaVersion: 1,
    entities: [{ name: 'Sales.Order', attributes: [{ name: 'amount', type: 'Decimal' }] }],
  };
  const addsAttribute = {
    mxscaffold: 'domain-model',
    schemaVersion: 1,
    entities: [{
      name: 'Sales.Order',
      attributes: [{ name: 'amount', type: 'Decimal' }, { name: 'reference', type: 'String' }],
    }],
  };
  t.ok(review(addsAttribute, before).length === 0,
    'adding an attribute to an entity that is already there is fine — the importer merges it in');

  const retypes = clone(addsAttribute);
  retypes.entities[0].attributes[0].type = 'String';
  const retyped = review(retypes, before);
  t.ok(levels(retyped) === 'ERROR' && says(retyped, 'cannot carry this'),
    'changing an existing attribute\'s type is an error: the file has no way to say it, and the import would keep the old one');

  // ---- the wrong file is not a finding about the proposal ----
  let threw = '';
  try {
    review({ mxscaffold: 'something-else', flows: [] }, null);
  } catch (err) {
    threw = err.message;
  }
  t.ok(threw.indexOf('expected "flows" or "domain-model"') !== -1,
    'a file of another kind throws rather than being reported as a bad proposal: ' + threw);
};
