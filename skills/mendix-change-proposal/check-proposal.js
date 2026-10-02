#!/usr/bin/env node
/* Checks a proposal file against what the reader on the far side actually
 * does with it.
 *
 *   node check-proposal.js proposal.json [--against original.json]
 *
 * Not a schema validator and not a reviewer of anybody's Mendix. It answers
 * one question: will MxScaffold draw what this file says, or will it quietly
 * drop or redraw part of it? Hence two levels and no third:
 *
 *   ERROR    the reader drops something — the proposal is incomplete on screen
 *   WARNING  the reader draws something other than what was probably meant
 *
 * `--against` is the one that earns its keep: a flow whose (module, name)
 * already exists is not merged, not overwritten and not reported as a
 * conflict — it is skipped as "already here". A proposal that keeps the
 * original's name therefore imports as nothing at all, and nothing on either
 * screen says so.
 *
 * Zero dependencies, like everything else in this repository.
 */
'use strict';

const fs = require('fs');

/* MxScaffold's element catalog (its src/workflow/catalog.ts, 64 entries),
 * copied here on 2026-10-02 because this repository does not — and must not —
 * depend on that one. Regenerate with:
 *
 *   node -e "const s=require('fs').readFileSync('src/workflow/catalog.ts','utf8');
 *     const b=s.slice(s.indexOf('WORKFLOW_CATALOG'));
 *     console.log([...b.matchAll(/^\s{2}([a-zA-Z0-9]+):\s*(S|MF|NF)\(\{/gm)].map(m=>m[1]).join(' '))"
 *
 * A stale copy only softens a warning: an unknown type is not refused by the
 * reader, it is drawn as an annotation carrying the name. */
const STEP_TYPES = new Set(('start end errorEvent continue break decision objectTypeDecision merge loop cast ' +
  'change commit create delete retrieve rollback aggregateList changeList createList listOperation javaAction ' +
  'javascriptAction callMicroflow changeVariable createVariable callNanoflow closePage downloadFile showHomePage ' +
  'message showPage synchronizeToDevice synchronize validationFeedback callExternalAction callRest callWebService ' +
  'importMapping exportMapping queryExternalDatabase sendRestRequest logMessage metricsCounter ' +
  'metricsIncrementCounter metricsGauge sendEmail callMlModel applyJumpToOption callWorkflow changeWorkflowState ' +
  'completeUserTask generateJumpToOptions retrieveWorkflowActivityRecords retrieveWorkflowContext ' +
  'retrieveWorkflows showUserTaskPage showWorkflowAdminPage lockWorkflow unlockWorkflow notifyWorkflow ' +
  'deleteExternalObject sendExternalObject annotation parameter').split(' '));

/* The kinds the reader falls back to when `type` is missing or unknown. */
const NODE_KINDS = new Set(['start', 'end', 'decision', 'objectTypeDecision', 'merge', 'loop', 'annotation',
  'parameter', 'errorEvent', 'continueEvent', 'breakEvent', 'continue', 'break']);

const moduleOf = (flow) => {
  if (typeof flow.module === 'string' && flow.module) return flow.module;
  const name = typeof flow.name === 'string' ? flow.name : '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(0, dot);
};
const shortName = (name) => {
  const dot = String(name).lastIndexOf('.');
  return dot === -1 ? String(name) : String(name).slice(dot + 1);
};
const flowKey = (flow) => (moduleOf(flow) + '.' + shortName(flow.name)).toLowerCase();

function checkFlows(doc, against, problems) {
  const error = (where, text) => problems.push({ level: 'ERROR', where: where, text: text });
  const warn = (where, text) => problems.push({ level: 'WARNING', where: where, text: text });

  if (!Array.isArray(doc.flows) || doc.flows.length === 0) {
    error('document', 'no `flows` array, or it is empty — the reader refuses the whole file');
    return;
  }

  const taken = new Map();
  if (against && Array.isArray(against.flows)) {
    against.flows.forEach((f) => taken.set(flowKey(f), f.name));
  }

  const seen = new Set();
  doc.flows.forEach((flow, i) => {
    const where = typeof flow.name === 'string' && flow.name ? flow.name : 'flows[' + i + ']';
    if (typeof flow.name !== 'string' || !flow.name) {
      error(where, 'a flow with no `name` is dropped on import');
      return;
    }
    if (!moduleOf(flow)) {
      warn(where, 'no module: qualify the name (`Sales.' + flow.name + '`) or add `"module"`, ' +
        'or the document lands outside every module in the project tree');
    }
    const key = flowKey(flow);
    if (taken.has(key)) {
      error(where, 'the original already has a flow with this module and name (`' + taken.get(key) + '`). ' +
        'The importer skips it as "already here" — the proposal would import as nothing. Give it a new name.');
    }
    if (seen.has(key)) error(where, 'two flows in this file share a module and name');
    seen.add(key);

    checkSteps(flow, where, problems);
  });
}

function checkSteps(flow, where, problems) {
  const error = (at, text) => problems.push({ level: 'ERROR', where: at, text: text });
  const warn = (at, text) => problems.push({ level: 'WARNING', where: at, text: text });

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (steps.length === 0) {
    warn(where, 'no steps: an empty drawing reads as "this flow does nothing", which is a claim of its own');
    return;
  }

  const byId = new Map();
  steps.forEach((step, i) => {
    const at = where + '.' + (step && step.id ? step.id : 'steps[' + i + ']');
    if (!step || typeof step.id !== 'string' || !step.id) {
      error(at, 'a step with no `id` is dropped on import');
      return;
    }
    if (byId.has(step.id)) error(at, 'two steps share this id — the arrows between them become ambiguous');
    byId.set(step.id, step);

    const type = typeof step.type === 'string' ? step.type : '';
    const kind = typeof step.kind === 'string' ? step.kind : '';
    if (type && !STEP_TYPES.has(type) && !NODE_KINDS.has(kind)) {
      warn(at, '`type: "' + type + '"` is not in the catalog — the reader draws it as an annotation ' +
        'reading "Mendix: ' + (step.action || type) + '" rather than guessing a similar activity');
    }
    if (!type && !NODE_KINDS.has(kind)) {
      warn(at, 'neither a known `type` nor a known `kind` — this is drawn as an annotation');
    }
    if (step.at !== undefined &&
      (typeof step.at !== 'object' || step.at === null ||
        typeof step.at.x !== 'number' || typeof step.at.y !== 'number')) {
      error(at, '`at` must be `{x: number, y: number}`; a malformed one is read as {0, 0}');
    }
  });

  const placed = steps.filter((s) => s && s.at && typeof s.at.x === 'number').length;
  if (placed === 0) {
    warn(where, 'no step has `at`: every one of them lands at {0, 0}, one pile. ' +
      'Give positions, or tell the reader to press Auto-arrange after importing.');
  } else if (placed < steps.length) {
    warn(where, (steps.length - placed) + ' of ' + steps.length + ' steps have no `at` and land at {0, 0}, ' +
      'on top of whatever sits there');
  }

  steps.forEach((step) => {
    if (!step || !step.parent) return;
    const at = where + '.' + step.id;
    const parent = byId.get(step.parent);
    if (!parent) error(at, '`parent: "' + step.parent + '"` is not a step in this flow');
    else if (parent.type !== 'loop' && parent.kind !== 'loop') {
      warn(at, 'its `parent` is not a loop — only a loop contains other steps');
    }
  });

  checkParameters(flow, where, steps, problems);
  checkEdges(flow, where, byId, problems);
}

/* A parameter lives in two places: `parameters` on the flow, which the header
 * and the inspector read, and a `parameter` step, which is the chip drawn on
 * the canvas. Every real flow carries both. Adding one half is the easy
 * mistake, and it produces a document whose canvas and header disagree. */
function checkParameters(flow, where, steps, problems) {
  const warn = (at, text) => problems.push({ level: 'WARNING', where: at, text: text });

  const declared = new Set((Array.isArray(flow.parameters) ? flow.parameters : [])
    .filter((p) => p && typeof p.name === 'string').map((p) => p.name));
  const drawn = new Map();
  steps.forEach((step) => {
    if (!step || (step.kind !== 'parameter' && step.type !== 'parameter')) return;
    const name = step.title || step.caption;
    if (name) drawn.set(name, step.id);
  });
  if (declared.size === 0 && drawn.size === 0) return;

  drawn.forEach((id, name) => {
    if (!declared.has(name)) {
      warn(where + '.' + id, 'a parameter chip named "' + name + '" is drawn on the canvas, but `parameters` ' +
        'on the flow does not list it — the header and the drawing would disagree');
    }
  });
  declared.forEach((name) => {
    if (!drawn.has(name)) {
      warn(where, 'parameter "' + name + '" is on the flow but has no `parameter` step, so it is in the header ' +
        'and not on the canvas');
    }
  });
}

function checkEdges(flow, where, byId, problems) {
  const error = (at, text) => problems.push({ level: 'ERROR', where: at, text: text });
  const warn = (at, text) => problems.push({ level: 'WARNING', where: at, text: text });

  const edges = Array.isArray(flow.edges) ? flow.edges : [];
  const outgoing = new Map();

  edges.forEach((edge, i) => {
    const at = where + '.edges[' + i + ']';
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      error(at, 'an edge needs `from` and `to`');
      return;
    }
    if (!byId.has(edge.from)) error(at, '`from: "' + edge.from + '"` is not a step in this flow — the arrow is dropped');
    if (!byId.has(edge.to)) error(at, '`to: "' + edge.to + '"` is not a step in this flow — the arrow is dropped');
    if (edge.kind !== undefined && edge.kind !== 'error' && edge.kind !== 'annotation') {
      warn(at, '`kind: "' + edge.kind + '"` is not one the reader knows (`error`, `annotation`, ' +
        'or absent for an ordinary sequence arrow) — it is drawn as an ordinary arrow');
    }
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  });

  byId.forEach((step, id) => {
    const isSplit = step.type === 'decision' || step.type === 'objectTypeDecision' ||
      step.kind === 'decision' || step.kind === 'objectTypeDecision';
    if (!isSplit) return;
    const out = outgoing.get(id) || [];
    const labelled = out.filter((e) => typeof e.caseValue === 'string' && e.caseValue);
    if (out.length === 0) {
      warn(where + '.' + id, 'a branch with nothing leaving it');
    } else if (labelled.length === 0) {
      warn(where + '.' + id, 'none of its arrows carries `caseValue`, so the branch draws with no outcomes — ' +
        'they come from the edges, not from a field on the step');
    } else if (labelled.length < out.length) {
      warn(where + '.' + id, (out.length - labelled.length) + ' of its arrows have no `caseValue`');
    }
  });
}

function checkDomainModel(doc, against, problems) {
  const error = (at, text) => problems.push({ level: 'ERROR', where: at, text: text });

  if (!Array.isArray(doc.entities)) {
    error('document', 'a domain model file needs an `entities` array');
    return;
  }
  const key = (e) => ((typeof e.module === 'string' && e.module && String(e.name).indexOf('.') === -1
    ? e.module + '.' + e.name : String(e.name))).toLowerCase();

  const before = new Map();
  if (against && Array.isArray(against.entities)) {
    against.entities.forEach((e) => before.set(key(e), e));
  }

  doc.entities.forEach((entity, i) => {
    const where = entity && entity.name ? String(entity.name) : 'entities[' + i + ']';
    if (!entity || typeof entity.name !== 'string' || !entity.name) {
      error(where, 'an entity needs a `name`');
      return;
    }
    const old = before.get(key(entity));
    if (!old) return;
    const had = new Map((old.attributes || []).map((a) => [String(a.name).toLowerCase(), a]));
    (entity.attributes || []).forEach((attr) => {
      const previous = had.get(String(attr.name).toLowerCase());
      if (!previous) return;
      if (previous.type !== attr.type) {
        error(where + '.' + attr.name,
          'this changes an existing attribute\'s type (' + previous.type + ' → ' + attr.type + '). ' +
          'The importer keeps the one it already has and says nothing, so the file cannot carry this — ' +
          'put it in the rationale in words.');
      }
    });
  });
}

/* The whole check as a function of two parsed documents, so it can be called
 * without touching a disk — `against` may be null. Returns the problems in the
 * order they were found; an empty list means the reader draws the file as
 * written. Throws on a document that is not one of the two kinds, because that
 * is not a finding about the proposal, it is the wrong file. */
function review(doc, against) {
  const problems = [];
  if (!doc || typeof doc !== 'object') throw new Error('not a JSON object');
  if (doc.mxscaffold === 'flows') {
    if (against && against.mxscaffold !== 'flows') throw new Error('the original is not a flows file');
    checkFlows(doc, against, problems);
  } else if (doc.mxscaffold === 'domain-model') {
    if (against && against.mxscaffold !== 'domain-model') throw new Error('the original is not a domain model file');
    checkDomainModel(doc, against, problems);
  } else {
    throw new Error('`mxscaffold` is "' + doc.mxscaffold + '": expected "flows" or "domain-model". ' +
      'The reader refuses anything else outright.');
  }
  return problems;
}

function main(argv) {
  const files = argv.filter((a) => a !== '--against');
  const againstAt = argv.indexOf('--against');
  const target = argv[0] && argv[0] !== '--against' ? argv[0] : null;
  const againstPath = againstAt === -1 ? null : argv[againstAt + 1];
  if (!target) {
    console.error('usage: node check-proposal.js <proposal.json> [--against <original.json>]');
    return 2;
  }
  if (files.length > 2) {
    console.error('too many files — one proposal, and one original after --against');
    return 2;
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (err) {
    console.error('cannot read ' + target + ': ' + err.message);
    return 2;
  }
  let against = null;
  if (againstPath) {
    try {
      against = JSON.parse(fs.readFileSync(againstPath, 'utf8'));
    } catch (err) {
      console.error('cannot read ' + againstPath + ': ' + err.message);
      return 2;
    }
  }

  let problems;
  try {
    problems = review(doc, against);
  } catch (err) {
    console.error(err.message);
    return 2;
  }

  const errors = problems.filter((p) => p.level === 'ERROR');
  problems.forEach((p) => console.log(p.level + '  ' + p.where + ': ' + p.text));
  if (problems.length === 0) {
    const what = doc.mxscaffold === 'flows'
      ? doc.flows.length + (doc.flows.length === 1 ? ' flow' : ' flows')
      : doc.entities.length + (doc.entities.length === 1 ? ' entity' : ' entities');
    console.log('OK — ' + what + ', and the reader draws all of it' + (against ? ', with no name taken' : ''));
    if (!against) console.log('(no --against: the name collision that silently skips a flow was not checked)');
  } else {
    console.log('');
    console.log(errors.length + ' error(s), ' + (problems.length - errors.length) + ' warning(s)');
  }
  return errors.length > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main: main, review: review, STEP_TYPES: STEP_TYPES };
