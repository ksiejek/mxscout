/* MxScout — the flows exchange document: MxScout's half of the contract with
 * MxScaffold (a separate tool, separate repo, Vite + React + Zustand).
 *
 * WHY A FILE AND NOT SHARED CODE. MxScout has zero npm dependencies and no
 * build step, and that is its whole argument to a security department.
 * MxScaffold is 38 thousand lines of React with a node_modules. Sharing code
 * either breaks that promise or rewrites the other tool, so the boundary
 * between them is this document — nothing more. Writing it opens no
 * connection: it is handed to the browser's own download, exactly like the
 * encrypted report and the .mxscout package already are.
 *
 * THE SHAPE is modelled on the one MxScaffold already defines for a domain
 * model (`{ mxscaffold: 'domain-model', schemaVersion: 1 }`, its
 * src/import/json/exchangeSchema.ts): references by qualified name rather than
 * by anybody's ids, positions optional, unknown fields ignored so an older
 * reader does not reject a newer writer's file. This is the second kind.
 *
 * TWO JOBS THAT BELONG HERE AND NOT IN THE READER:
 *
 *   1. Translation. public/mpr.js keeps Mendix's own names for everything it
 *      reads (`RetrieveAction`), on purpose: it then needs no table of another
 *      tool's vocabulary, and a Mendix release that adds an action still gets
 *      read and drawn. Turning that into MxScaffold's `retrieve` happens once,
 *      here, where the other tool's names belong. An action with no
 *      counterpart gets NO type rather than a plausible wrong one — the Mendix
 *      name is still on the step, so the far side can decide for itself.
 *
 *   2. Compaction. The model keeps a fixed shape with explicit nulls, because
 *      there a null means "the reader looked and there was nothing" — worth
 *      saying. In a file on its way elsewhere it is worth nothing, 22,562
 *      times over, so absent fields and short per-flow ids replace it.
 *
 * SCOPE is a predicate, so "this one flow" and "all of them" are the same call
 * and the far side cannot tell which button produced the file.
 *
 * No DOM, no dependencies, no init(): a pure transform, called by app.js and
 * tested directly.
 */
(function (root) {
  'use strict';

  var EXCHANGE_KIND = 'flows';
  var SCHEMA_VERSION = 1;

  // Mendix's action type -> MxScaffold's WorkflowStepType, which is itself
  // copied one-to-one from Studio Pro's toolbox (its src/workflow/catalog.ts,
  // 64 elements). Every action type that occurs in a real project has a
  // counterpart there, which is what makes this a translation and not a
  // redesign: both lists came from the same Mendix documentation.
  var STEP_TYPES = {
    RetrieveAction: 'retrieve',
    CreateChangeAction: 'create',
    CreateListAction: 'createList',
    ChangeAction: 'change',
    ChangeListAction: 'changeList',
    ChangeVariableAction: 'changeVariable',
    CreateVariableAction: 'createVariable',
    CommitAction: 'commit',
    DeleteAction: 'delete',
    RollbackAction: 'rollback',
    CastAction: 'cast',
    AggregateAction: 'aggregateList',
    ListOperationsAction: 'listOperation',
    MicroflowCallAction: 'callMicroflow',
    NanoflowCallAction: 'callNanoflow',
    JavaActionCallAction: 'javaAction',
    JavaScriptActionCallAction: 'javascriptAction',
    ShowFormAction: 'showPage',
    CloseFormAction: 'closePage',
    ShowHomePageAction: 'showHomePage',
    ShowMessageAction: 'message',
    ValidationFeedbackAction: 'validationFeedback',
    LogMessageAction: 'logMessage',
    RestCallAction: 'callRest',
    CallWebServiceAction: 'callWebService',
    CallExternalAction: 'callExternalAction',
    DownloadFileAction: 'downloadFile',
    ImportXmlAction: 'importMapping',
    ExportXmlAction: 'exportMapping',
    IncrementCounterMeterAction: 'metricsIncrementCounter',
    SendEmailAction: 'sendEmail'
  };

  // The node kinds mpr.js names are already MxScaffold's own words, with one
  // exception: an activity's type comes from the action it holds.
  var NODE_TYPES = {
    start: 'start', end: 'end', errorEvent: 'errorEvent', break: 'break', continue: 'continue',
    decision: 'decision', objectTypeDecision: 'objectTypeDecision', merge: 'merge',
    loop: 'loop', annotation: 'annotation', parameter: 'parameter'
  };

  // Synchronize is two different elements in Studio Pro's toolbox — "Synchronize
  // to device" in a microflow, "Synchronize" in a nanoflow — behind one action
  // type in the file. The flow it sits in is what tells them apart.
  function stepTypeOf(actionType, flowKind) {
    if (actionType === 'SynchronizeAction') {
      return flowKind === 'nanoflow' ? 'synchronize' : 'synchronizeToDevice';
    }
    return STEP_TYPES[actionType] || null;
  }

  // A parameter in the notation MxScaffold writes types in: the entity itself
  // for an object, "List of <Entity>" for a list, the primitive's name
  // otherwise. Not our internal {type, entityQualifiedName, isList} triple —
  // that shape is ours and means nothing on the far side.
  function parameterType(parameter) {
    if (parameter.isList) {
      return parameter.entityQualifiedName ? 'List of ' + parameter.entityQualifiedName : 'List';
    }
    if (parameter.entityQualifiedName) return parameter.entityQualifiedName;
    if (parameter.enumerationQualifiedName) return parameter.enumerationQualifiedName;
    return parameter.type || 'Unknown';
  }

  // Writes a key only when there is something to write. An absent field and a
  // field set to null say the same thing to a reader, and only one of them
  // costs bytes on every one of twenty thousand steps.
  function put(target, key, value) {
    if (value === null || value === undefined || value === '') return;
    target[key] = value;
  }

  function buildFlow(flow, kind) {
    var graph = flow.graph;
    var shortId = {};
    graph.nodes.forEach(function (node, index) { shortId[node.id] = 'n' + (index + 1); });

    var steps = graph.nodes.map(function (node) {
      var step = { id: shortId[node.id], kind: node.kind };
      put(step, 'type', node.kind === 'activity'
        ? stepTypeOf(node.action, kind)
        : (NODE_TYPES[node.kind] || null));
      // Mendix's own name stays on an activity even when the type above is
      // known, so the far side never has to trust this table to know what the
      // file said.
      put(step, 'action', node.action);
      put(step, 'kicker', node.kicker);
      put(step, 'title', node.title);
      put(step, 'meta', node.meta);
      put(step, 'ref', node.ref);
      put(step, 'at', node.at);
      put(step, 'size', node.size);
      put(step, 'parent', node.parentId ? shortId[node.parentId] : null);
      put(step, 'caption', node.caption);
      put(step, 'documentation', node.documentation);
      put(step, 'expression', node.expression);
      put(step, 'rule', node.rule);
      put(step, 'variable', node.variable);
      put(step, 'returnValue', node.returnValue);
      put(step, 'loop', node.loop);
      if (node.disabled) step.disabled = true;
      return step;
    });

    var edges = graph.edges.map(function (edge) {
      var out = { from: shortId[edge.from] || null, to: shortId[edge.to] || null };
      // MxScaffold models the error outlet and the annotation line as KINDS of
      // connector, not as flags, and a plain sequence edge as the absence of
      // one. Matching that here means its importer has nothing to convert.
      if (edge.isError) out.kind = 'error';
      else if (edge.kind === 'annotation') out.kind = 'annotation';
      put(out, 'caseValue', edge.caseValue);
      put(out, 'caseKind', edge.caseKind);
      put(out, 'fromSide', edge.fromSide);
      put(out, 'toSide', edge.toSide);
      put(out, 'fromVector', edge.fromVector);
      put(out, 'toVector', edge.toVector);
      return out;
    }).filter(function (edge) { return edge.from && edge.to; });

    var out = { name: flow.qualifiedName, kind: kind, module: flow.module };
    // Where it sits inside its module, outermost folder first, omitted when it
    // sits directly in the module. MxScaffold is building a project explorer
    // of its own (its WORKFLOW.md, step E), and a flow handed over without
    // this would arrive in a flat heap: in the projects measured here, over
    // 99 % of microflows live in a folder somebody chose to make.
    put(out, 'path', (flow.path && flow.path.length) ? flow.path : null);
    put(out, 'parameters', (flow.parameters || []).map(function (p) {
      return { name: p.name, type: parameterType(p) };
    }));
    put(out, 'allowedModuleRoles', flow.allowedModuleRoles && flow.allowedModuleRoles.length
      ? flow.allowedModuleRoles : null);
    if (typeof flow.applyEntityAccess === 'boolean') out.applyEntityAccess = flow.applyEntityAccess;
    out.steps = steps;
    out.edges = edges;
    return out;
  }

  /* model    — a built model (MxMpr.buildModel, or a JSON import of one)
   * options  — { scope: (flow, kind) => boolean, version: string }
   * returns  — { doc, included, skipped }
   *
   * `skipped` counts flows left out because the model holds no drawing for
   * them: a model imported as JSON, or built before the graph was read, has
   * no `graph`. Such a flow is NOT written with an empty step list — an empty
   * drawing reads as "this flow does nothing", which is a different and
   * wrong claim. The caller is told the number so it can say so.
   */
  function buildFlowsDocument(model, options) {
    var opts = options || {};
    var scope = typeof opts.scope === 'function' ? opts.scope : null;
    var flows = [];
    var skipped = 0;

    [['microflows', 'microflow'], ['nanoflows', 'nanoflow']].forEach(function (pair) {
      (model[pair[0]] || []).forEach(function (flow) {
        if (scope && !scope(flow, pair[1])) return;
        if (!flow.graph || !flow.graph.nodes) { skipped++; return; }
        flows.push(buildFlow(flow, pair[1]));
      });
    });

    var meta = model.meta || {};
    var doc = {
      mxscaffold: EXCHANGE_KIND,
      schemaVersion: SCHEMA_VERSION,
      source: {
        tool: 'mxscout',
        version: opts.version || null,
        exportedAt: new Date().toISOString()
      },
      project: {},
      flows: flows
    };
    put(doc.project, 'name', meta.appName);
    put(doc.project, 'mendixVersion', meta.mendixVersion);
    if (!doc.source.version) delete doc.source.version;

    return { doc: doc, included: flows.length, skipped: skipped };
  }

  root.MxExchange = {
    EXCHANGE_KIND: EXCHANGE_KIND,
    SCHEMA_VERSION: SCHEMA_VERSION,
    stepTypeOf: stepTypeOf,
    buildFlowsDocument: buildFlowsDocument
  };
})(typeof self !== 'undefined' ? self : this);
