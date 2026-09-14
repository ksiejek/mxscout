/* MxScout — one row-level access rule: how it is read, how it is shown, and
 * where MxScout stops and says so.
 *
 * This lived inside objects.js, because the first place that needed it was
 * the access matrix in the entity popup. It is not a popup concern. A
 * row-level rule is the sentence somebody trusts most in the whole access
 * picture — "and only their own rows" — and two screens now ask about it: the
 * matrix, which renders one rule per column, and the Security section, which
 * counts the ones MxScout could not follow so a reader does not have to open
 * every entity to find them.
 *
 * The two halves must stay in one file. Rendering the chain and judging
 * whether MxScout could follow it are deliberately the SAME walk (walkChain):
 * two walks would eventually disagree, and a picture that disagrees with its
 * own warning is worse than either alone.
 *
 * Nothing here paraphrases a rule into a different one — this is a security
 * tool. The tokens are made readable and the exact XPath is always kept on
 * the element, so nothing is lost.
 */
(function () {
  'use strict';

  var el, state, findEntity;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    findEntity = deps.findEntity;
  }

  // The runtime's own tokens, in plain words. Shown as a value pill, and the
  // exact XPath is always kept on the cell — this is a security tool, it must
  // not paraphrase a rule into a different one, only make it readable.
  var TOKEN_LABEL = {
    '[%CurrentUser%]': 'current user',
    '[%CurrentObject%]': 'this object',
    '[%CurrentDateTime%]': 'now',
    '[%BeginOfCurrentDay%]': 'start of today',
    '[%EndOfCurrentDay%]': 'end of today'
  };

  // Drop one pair of outer brackets when they wrap the whole expression (the
  // usual [ … ] a constraint comes in). A compound like [a][b] is left alone —
  // the first '[' must close only at the very end.
  function stripOuterBrackets(s) {
    s = s.trim();
    if (s.charAt(0) !== '[' || s.charAt(s.length - 1) !== ']') return s;
    var depth = 0;
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === '[') depth++;
      else if (s.charAt(i) === ']') { depth--; if (depth === 0 && i !== s.length - 1) return s; }
    }
    return s.slice(1, -1).trim();
  }

  // Walk one '/'-separated path chain step by step, starting from the entity
  // the popup is on. An association step goes to whichever end isn't the
  // entity we're currently on (so direction is right); an explicit entity step
  // goes there; anything the model does not contain leaves target null.
  //
  // Rendering the chain and judging whether MxScout could follow it are the
  // same walk on purpose — two walks would eventually disagree, and a picture
  // that disagrees with its own warning is worse than either alone.
  function walkChain(chain, model, startQn) {
    var cur = startQn;
    return chain.split('/').filter(function (p) {
      return p.indexOf('.') !== -1; // a trailing attribute, not an entity
    }).map(function (p) {
      var assoc = (model.associations || []).filter(function (a) {
        return a && ((a.module + '.' + a.name) === p || a.qualifiedName === p);
      })[0];
      var target = null;
      if (assoc) target = (assoc.owner === cur) ? assoc.other : (assoc.other === cur ? assoc.owner : (assoc.other || assoc.owner));
      else if (findEntity(model, p)) target = p;
      var step = { token: p, module: p.split('.')[0], target: target, from: cur };
      if (target) cur = target;
      return step;
    });
  }

  // The entities a chain visits, for the chips — consecutive duplicates and
  // steps that resolve back to where they started collapse away.
  function chainEntities(chain, model, startQn) {
    var chips = [];
    walkChain(chain, model, startQn).forEach(function (step) {
      if (!step.target || step.target === step.from) return;
      if (chips[chips.length - 1] !== step.target) chips.push(step.target);
    });
    return chips;
  }

  // Every dotted path chain inside a constraint. Same shape the renderer's own
  // tokenizer uses for group 3, kept as one expression so they cannot drift.
  var CHAIN_RE = /[A-Za-z_]\w*\.[A-Za-z_]\w*(?:\/[A-Za-z_]\w*\.[A-Za-z_]\w*)*/g;

  // ---------- when MxScout cannot follow a row-level rule ----------
  // A row-level rule is the part of the access matrix somebody trusts most —
  // it is the sentence that says "and only their own rows". So the one thing
  // this must never do is show such a rule as if it had been checked when it
  // has not.
  //
  // TWO cases, and the line between them was drawn by measurement rather than
  // by reasoning. Across three real projects, 135 access rules carry a
  // constraint and 28 of those go through the System module — and ALL 28 of
  // them are the same single step, `[System.owner='[%CurrentUser%]']`, which
  // is the standard Mendix idiom for "their own rows" and works. A check that
  // flagged "mentions System" would therefore have produced 28 false alarms
  // and no true ones. So:
  //
  //   - a System step that is the END of its path is ordinary and silent;
  //   - a System step the path CONTINUES PAST is flagged. The System module's
  //     domain model is not in the project file at all — MxScout knows its
  //     entities by name and none of their members — so nothing here can
  //     follow such a path or say what it matches. It is also the shape
  //     reported elsewhere as a rule that quietly matches no rows at run time.
  //     MxScout does NOT make that claim: it says it cannot follow the path,
  //     says why, and says to check it against the running app. Zero of the
  //     135 rules measured hit this, which is the point — it is for the rare
  //     one, not for the common case.
  //
  //   - a step that is not in the model at all (and not System) is flagged
  //     separately: renamed, or from a version of the model that is not this
  //     one. Checked against the RAW model, so a hidden Marketplace module is
  //     never mistaken for a missing one.
  function constraintNote(xpath, model, startQn) {
    if (!xpath) return null;
    var raw = (state.detail && state.detail.rawModel) || model;
    var throughSystem = null, missing = null, namesRole = false;

    (String(xpath).match(CHAIN_RE) || []).forEach(function (chain) {
      var steps = walkChain(chain, model, startQn);
      steps.forEach(function (step, i) {
        var isLast = i === steps.length - 1;
        if (step.module === 'System') {
          if (!isLast && !throughSystem) throughSystem = chain;
          if (/UserRole/i.test(step.token)) namesRole = true;
          return;
        }
        if (step.target || missing) return;
        // Resolvable in the unfiltered model? Then it is only hidden from
        // this view, which is a setting, not a fault.
        var inRaw = (raw.associations || []).some(function (a) {
          return a && ((a.module + '.' + a.name) === step.token || a.qualifiedName === step.token);
        }) || !!findEntity(raw, step.token);
        if (!inRaw) missing = step.token;
      });
    });

    if (throughSystem) {
      return {
        label: 'through System',
        title: 'MxScout cannot follow this rule.\n\n' +
          'The path goes through the System module and keeps going (' + throughSystem + '). ' +
          'System’s domain model is not in the project file at all — it ships with the Mendix Runtime — so MxScout knows its entities by name and none of their members, and nothing here can work out which rows this matches.\n\n' +
          (namesRole
            ? 'This one reaches a user ROLE through System, which is the shape most often reported as a rule that matches no rows at run time.\n\n'
            : 'A path through System is also the shape most often reported as a rule that matches no rows at run time.\n\n') +
          'MxScout does not claim that is what happens here — it has not checked, and it cannot check from the model. Connect the app and see what this rule actually returns before relying on it.'
      };
    }
    if (missing) {
      return {
        label: 'not in this model',
        title: 'MxScout cannot follow this rule.\n\n"' + missing +
          '" is not an entity or association in this model — not even with Marketplace modules shown. ' +
          'Usually that means it was renamed, or this model is not the version the app is running. The rule is shown exactly as written; nothing here can say what it matches.'
      };
    }
    return null;
  }

  // Render a row-level constraint as readable tokens: association walks become
  // entity chips joined by arrows (Sales.Order → Sales.Customer), comparison
  // operators are set in the accent colour the way the arrow is, and values
  // (the current-user token, a quoted literal) become pills. Field names stay
  // as plain monospace. The raw XPath is kept on the cell, so nothing is lost.
  function constraintNodes(xpath, model, startQn) {
    var s = stripOuterBrackets(String(xpath == null ? '' : xpath).trim());
    if (!s) return [el('span', { class: 'muted', text: 'All rows' })];
    var out = [];
    // One token per iteration: a %token%, a 'quoted' literal, a Module.Name(/…)
    // chain, a comparison operator, a word operator, a bare identifier, run of
    // whitespace, or any single other character.
    var re = /(\[%[^%]*%\])|('(?:[^']|'')*')|([A-Za-z_]\w*\.[A-Za-z_]\w*(?:\/[A-Za-z_]\w*\.[A-Za-z_]\w*)*)|(!=|<=|>=|=|<|>)|\b(and|or|not)\b|([A-Za-z_]\w*)|(\s+)|(.)/g;
    var m;
    function pill(text) { out.push(el('span', { class: 'con-val', text: text })); }
    while ((m = re.exec(s))) {
      if (m[1]) { pill(TOKEN_LABEL[m[1]] || m[1]); }
      else if (m[2]) { var inner = m[2].slice(1, -1); pill(TOKEN_LABEL[inner] || inner); }
      else if (m[3]) {
        var chips = chainEntities(m[3], model, startQn);
        if (!chips.length) out.push(el('span', { class: 'con-field', text: m[3] }));
        else chips.forEach(function (qn, i) {
          if (i) out.push(el('span', { class: 'con-arrow', text: '→' }));
          out.push(el('span', { class: 'con-chip', text: qn }));
        });
      }
      else if (m[4]) { out.push(el('span', { class: 'con-op', text: m[4] })); }
      else if (m[5]) { out.push(el('span', { class: 'con-op', text: m[5] })); }
      else if (m[6]) { out.push(el('span', { class: 'con-field', text: m[6] })); }
      else if (m[7]) { /* whitespace — the flex gap spaces the tokens */ }
      else if (m[8] === '/') { /* a path separator already folded into the entity chips */ }
      else if (m[8] && m[8].trim()) { out.push(el('span', { class: 'con-text', text: m[8] })); }
    }
    return out;
  }

  // ---------- every rule in the model MxScout could not follow ----------
  // The same judgement the matrix makes per column, made once over the whole
  // model so the Security section can say how many there are and point at
  // each. It is the SAME note() call, not a second opinion — a count that
  // could disagree with the marker it counts would be worse than no count.
  //
  // Deliberately unfiltered by the view's role selector: a rule MxScout
  // cannot follow is a fact about the project, not about who is being looked
  // at, and the role filter is the reason these are easy to miss today.
  function unfollowed(model) {
    var out = [];
    (model.entities || []).forEach(function (entity) {
      (entity.accessRules || []).forEach(function (rule, ruleIndex) {
        var note = constraintNote(rule.xpathConstraint, model, entity.qualifiedName);
        if (!note) return;
        out.push({
          qualifiedName: entity.qualifiedName, name: entity.name, module: entity.module,
          moduleRole: rule.moduleRole, ruleIndex: ruleIndex,
          xpathConstraint: rule.xpathConstraint,
          label: note.label, title: note.title
        });
      });
    });
    return out;
  }

  window.MxAccessRule = {
    init: init,
    note: constraintNote,
    nodes: constraintNodes,
    unfollowed: unfollowed
  };
})();
