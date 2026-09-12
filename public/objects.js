/* MxScout — what you see when you open an object.
 *
 * Two popups, one shape. An entity opens on Attributes & access / Data /
 * Comments; a flow opens on Run / Comments, with its inputs and who may
 * trigger it side by side inside Run. In both cases the tabs are the order
 * the questions actually arrive in: what is this thing and who is allowed
 * near it — together, one matrix — then what is actually there right now.
 *
 * Data (and Run) is the tab that reaches the running application, and in the
 * flow's case running it is the only thing in MxScout that can change data —
 * so it sits behind two gates, and object parameters are chosen from a picker
 * that opens over the panel rather than asking anyone to copy an object id
 * between two screens.
 *
 * Everything about the live application is MxLive's; everything about
 * comments is MxComments'. This file is the arrangement.
 */
(function () {
  'use strict';

  // Bound in init(), under the names the code already used.
  var el, state, render, setMessage, withMod, moduleRoleSetFor, listHitsSet, findEntity, peekObject;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    render = deps.render;
    setMessage = deps.setMessage;
    withMod = deps.withMod;
    moduleRoleSetFor = deps.moduleRoleSetFor;
    listHitsSet = deps.listHitsSet;
    findEntity = deps.findEntity;
    peekObject = deps.peekObject;
  }

  var FLOW_SECTION_OF = { microflow: 'microflows', nanoflow: 'nanoflows', page: 'pages' };

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

  // Attribute types whose value can be set on an object before a run — the
  // same set the "create a temporary object" form uses (live.js). Anything
  // else (Enum, DateTime, AutoNumber, Binary, HashedString) is left alone,
  // because setting it needs a value protocol MxScout does not have yet.
  var SETTABLE_OVERRIDE = { String: 'text', Integer: 'number', Long: 'number', Decimal: 'number', Float: 'number', Boolean: 'boolean' };

  function shortNameOf(qualifiedName) {
    var idx = String(qualifiedName || '').lastIndexOf('.');
    return idx === -1 ? String(qualifiedName || '') : String(qualifiedName).slice(idx + 1);
  }
  // The values an enumeration can hold, or null when this model does not
  // carry them — a JSON export, or a project imported before they were read.
  function enumValuesOf(qualifiedName) {
    var list = (state.detail.model.enumerations || []).filter(function (e) {
      return e && e.qualifiedName === qualifiedName;
    })[0];
    return list && list.values && list.values.length ? list.values : null;
  }

  // ---------- entity/flow detail popup: the Comments tab ----------
  // Its own tab, not a block sitting above every other tab — adding a
  // comment happens here and only here, same as everything else the popup
  // can do. `target` is the same shape addButton always took (kind,
  // qualifiedName, module, name, attributes), shared by the entity and flow
  // popups below rather than duplicated per popup.
  function renderCommentsTab(target) {
    var existing = window.MxComments.findingsFor(target.qualifiedName);
    return el('div', { class: 'popup-section' }, [
      el('h4', { text: 'Comments (' + existing.length + ')' }),
      existing.length
        // Full comment rows — the same ones the Comments page shows, so the
        // popup carries the whole finding (problem, change, meta, status,
        // Edit, history) rather than a stripped one-liner. Edit opens the
        // editor in place.
        ? el('div', { class: 'comment-list popup-comment-list' }, existing.map(function (f) {
            return window.MxComments.renderRow(f);
          }))
        : el('p', { class: 'muted', text: 'No comments yet — “+ Comment”, top right, writes one about this object.' })
    ]);
  }

  // Data: ten rows at a time, a real count, live search, paging. It needs
  // the app tab connected, so the connect step lives inside the tab rather
  // than in a separate screen the user has to find first.
  function renderEntityDataTab(model, entity) {
    // Building either pane has side effects (arming a query/lookup against
    // the bridge) — only do that once we know the bridge is actually there
    // to ask, same as the original short-circuited `blocker(...) || pane()`.
    var blocked = window.MxLive.blocker(window.MxLive.targetForEntity(model, entity));
    if (blocked) return blocked;
    return entity.persistable === false
      ? window.MxLive.renderTransientPane(model, entity, null)
      : window.MxLive.renderDataPane(model, entity, null);
  }

  function renderEntityPopup(qn) {
    var model = state.detail.model;
    var entity = findEntity(model, qn);
    if (!entity) return null;
    var set = moduleRoleSetFor(model, state.detail.role);

    // Create / Delete for the current selection, aggregated across the rules
    // that apply — shown next to the entity name rather than repeated per rule
    // column. Any applicable rule that grants it is enough.
    var canCreate = false, canDelete = false;
    (entity.accessRules || []).forEach(function (r) {
      if (set && !set[r.moduleRole]) return;
      if (r.allowCreate) canCreate = true;
      if (r.allowDelete) canDelete = true;
    });

    // A role selector in the popup itself, so the role can be changed without
    // closing it — it drives the same state.detail.role the toolbar does.
    function roleSelect() {
      var current = state.detail.role;
      var opts = [el('option', { value: 'all', text: 'everything', selected: current === 'all' ? 'selected' : null })];
      (model.userRoles || []).forEach(function (r) {
        opts.push(el('option', { value: r.name, text: r.name, selected: current === r.name ? 'selected' : null }));
      });
      var sel = el('select', { class: 'popup-role-select', onchange: function (e) {
        state.detail.role = e.target.value; render();
      } }, opts);
      return el('label', { class: 'popup-role' }, [el('span', { class: 'popup-role-label', text: 'Viewing as' }), sel]);
    }

    // ---- Attributes & access: one tab, not two. The old Attributes and
    // Constraints tabs answered the same question from opposite ends, so they
    // are merged into the accessMatrix below. Relationships (part of the
    // entity's shape) stay underneath \u2014 and each end that is a different
    // entity in this model is now a link, so you can walk the domain model
    // from one entity to the next without leaving the popup.
    function navigateToEntity(qn2) {
      state.detail.selectedEntity = qn2;
      state.detail.entityTab = 'access';
      window.MxLive.forgetDataPane();
      render();
    }
    function assocEnd(endQn) {
      if (endQn && endQn !== qn && findEntity(model, endQn)) {
        return el('button', { class: 'assoc-end assoc-link', text: endQn, title: 'Open ' + endQn,
          onclick: function () { navigateToEntity(endQn); } });
      }
      return el('span', { class: 'assoc-end' + (endQn === qn ? ' assoc-self' : ''), text: endQn || '?' });
    }
    function relationshipsBlock() {
      var related = (model.associations || []).filter(function (a) { return a && (a.owner === qn || a.other === qn); });
      if (!related.length) return [];
      return [
        el('h4', { class: 'popup-h-second', text: 'Relationships (' + related.length + ')' }),
        el('div', {}, related.map(function (a) {
          return el('div', { class: 'map-assoc-row' }, [
            assocEnd(a.owner),
            el('span', { class: 'assoc-arrow', text: '\u2192' }),
            assocEnd(a.other),
            el('span', { class: 'assoc-type', text: a.type || 'Reference' })
          ]);
        }))
      ];
    }

    // The associations this entity OWNS. In Studio Pro they are members of the
    // entity exactly as its attributes are, and an access rule grants read or
    // read+write on them the same way — so they belong in the same table, not
    // only in Relationships below. Only the owned end is listed: an incoming
    // association is a member of the entity at the other end, and this
    // entity's rules say nothing about it.
    function ownedAssocs() {
      return (model.associations || []).filter(function (a) { return a && a.owner === qn; });
    }
    function assocTypeText(a) {
      return '\u2192 ' + (a.other || '?');
    }

    // An enumeration attribute used to say only "Enumeration" \u2014 the name of
    // the enumeration was in the model and the VALUES, the thing anybody
    // actually wants when reading a row or writing a constraint, were one
    // document away and unread. They are read now, so the type cell names the
    // enumeration and carries its values on hover: short enough for the
    // column, complete enough to answer the question without leaving.
    function attrTypeText(a) {
      if (a.enumerationQualifiedName) {
        var values = enumValuesOf(a.enumerationQualifiedName);
        var count = values ? values.length : 0;
        return shortNameOf(a.enumerationQualifiedName) + (count ? ' (' + count + ')' : '');
      }
      return a.type + (a.length ? ' (' + a.length + ')' : '');
    }
    function attrTypeTitle(a) {
      if (!a.enumerationQualifiedName) return null;
      var values = enumValuesOf(a.enumerationQualifiedName);
      if (!values || !values.length) {
        return a.enumerationQualifiedName + ' \u2014 this model does not carry its values.';
      }
      return a.enumerationQualifiedName + '\n' + values.map(function (v) {
        // Both, when they differ: the caption is what a person sees and the
        // name is what comes back in the data.
        return v.caption && v.caption !== v.name ? '\u00b7 ' + v.caption + '  (' + v.name + ')' : '\u00b7 ' + v.name;
      }).join('\n');
    }

    function memberOnly(attrs, assocs) {
      var rows = attrs.map(function (a) {
        var typeCell = el('span', { class: 'kv-val', text: attrTypeText(a) });
        var title = attrTypeTitle(a);
        if (title) typeCell.setAttribute('title', title);
        return el('div', { class: 'kv-row' }, [
          el('span', { class: 'kv-key', text: a.name }),
          typeCell
        ]);
      }).concat(assocs.map(function (a) {
        return el('div', { class: 'kv-row' }, [
          el('span', { class: 'kv-key', text: a.name }),
          el('span', { class: 'kv-val', text: assocTypeText(a) })
        ]);
      }));
      return el('div', { class: 'kv' }, rows);
    }

    // Best access this selection grants a member, across the shown rules:
    // 'rw' if any rule writes it, else 'r' if any reads it, else 'none'. Drives
    // the per-member traffic-light dot — the cue Karol wanted on attributes,
    // and now on associations, which carry their own level per rule ('map' is
    // whichever of the two the row came from).
    function bestLevel(name, rules, map) {
      var lvl = 'none';
      rules.forEach(function (r) {
        var v = (r[map] || {})[name];
        if (v === 'rw') lvl = 'rw';
        else if (v === 'r' && lvl !== 'rw') lvl = 'r';
      });
      return lvl;
    }

    // The row-level rule used to sit ABOVE the attribute list as a card per
    // rule. With two rules for the SAME module role — which is normal, one
    // per constraint — that gave two identical-looking cards above two
    // identical-looking columns and nothing tying either pair together. So
    // the rule now lives in the header of its own column (see accessMatrix)
    // and only the caption stays here, once, to say what the columns are.
    // Create/Delete are not repeated in either place; they sit by the entity
    // name.
    function constraintCaption() {
      return el('div', { class: 'con-heading' }, [
        el('span', { class: 'con-heading-label', text: 'Row-level rule' }),
        el('span', { class: 'con-heading-hint', text: 'each column below is one access rule \u2014 the line under the role name says which rows it sees' })
      ]);
    }

    // ---------- asking the app what a row-level rule really matches ----------
    // The one question the model cannot answer. Everything else on this popup
    // is read out of the file; whether a constraint actually selects anything
    // is a property of the running application and of the data in it, so the
    // only honest way to know is to ask — which MxScout can, because it is
    // already connected to that app for the Data tab.
    //
    // Two numbers come back and nothing else (see the `count` command in
    // server/routes/session.js): how many rows of this entity this session can
    // see, and how many of those also match the constraint. That pairing is
    // the whole point — "0 matched" means nothing if the table is empty, and
    // everything if the entity has ten thousand rows.
    //
    // What it is NOT: the rule's own population. The runtime applies the
    // rights of whoever is signed in on the app tab to both counts, so the
    // answer is about THAT session's rows. MxScout has no way to know which
    // module roles that session holds — the app tells it a user name, not a
    // role list — so the caveat is stated every time rather than guessed at
    // from the view's role dropdown, which is a setting here and says nothing
    // about anyone's real rights.
    function constraintCheck(ent, rule, ruleIndex) {
      if (!rule.xpathConstraint) return null;
      if (!window.MxLive.connected()) return null; // the Data tab already explains how to connect

      var key = ent.qualifiedName + '#' + ruleIndex;
      var got = state.detail.constraintCounts[key];

      function ask() {
        state.detail.constraintCounts[key] = { busy: true };
        render();
        window.MxLive.countConstraint(ent.qualifiedName, rule.xpathConstraint, function (err, data) {
          state.detail.constraintCounts[key] = err
            ? { error: err.message || String(err) }
            : { total: data ? data.total : null, matched: data ? data.matched : null };
          render();
        });
      }

      var kids = [];
      if (got && got.busy) {
        kids.push(el('span', { class: 'con-check-busy' }, [el('span', { class: 'spinner' }), el('span', { text: ' asking the app…' })]));
      } else {
        kids.push(el('button', {
          class: 'link-btn con-check-btn',
          text: got ? 'Check again' : 'Check against the app',
          title: 'Ask the connected app how many rows this rule’s constraint actually matches',
          onclick: ask
        }));
      }

      if (got && got.error) {
        kids.push(el('div', { class: 'con-check warn-text', text: got.error }));
      } else if (got && !got.busy) {
        var total = got.total, matched = got.matched;
        var line, tone;
        if (matched === null || total === null) {
          line = 'The app did not answer with a number.';
          tone = 'warn-text';
        } else if (total === 0) {
          // Nothing to conclude, and saying so beats a zero that reads as a
          // finding: an empty table matches no constraint either.
          line = 'This session sees no rows of ' + ent.name + ' at all, so this says nothing about the rule.';
          tone = 'muted';
        } else if (matched === 0) {
          line = 'Matches none of the ' + total + ' row' + (total === 1 ? '' : 's') + ' this session can see.';
          tone = 'warn-text';
        } else {
          line = 'Matches ' + matched + ' of the ' + total + ' row' + (total === 1 ? '' : 's') + ' this session can see.';
          tone = 'ok-text';
        }
        kids.push(el('div', { class: 'con-check ' + tone, text: line }));
        // The caveat that keeps the number honest. Always said, because it is
        // always true and MxScout cannot tell when it stops mattering.
        if (total !== null) {
          kids.push(el('div', { class: 'con-check muted',
            text: 'Counted with the rights of the session signed in on the app tab, whatever those are — if it does not hold ' +
              rule.moduleRole + ', these are its rows and not the rows this rule governs.' }));
        }
      }
      return el('div', { class: 'con-check-box' }, kids);
    }

    // The member matrix: a row per attribute AND per owned association, with a
    // traffic-light dot for its access under the current selection, and a cell
    // per applicable rule giving that rule's read / read+write level. The
    // row-level rule and the Create/Delete flags moved out (above, and by the
    // entity name).
    function accessMatrix(attrs, assocs, rules) {
      var headCells = [el('th', { class: 'am-h-attr', text: 'Member' }), el('th', { class: 'am-h-type', text: 'Type' })];
      rules.forEach(function (r, ruleIndex) {
        // Role name, then directly under it the rows that rule lets it see.
        // Same .con-line as before — same tokens, same raw XPath on the
        // title — just moved to where its column is, which is the only place
        // the reader can tell two rules of one role apart.
        var note = constraintNote(r.xpathConstraint, model, entity.qualifiedName);
        headCells.push(el('th', { class: 'am-rule-col' }, [
          el('div', { class: 'am-role', text: r.moduleRole }),
          el('div', { class: 'con-line', title: r.xpathConstraint || 'All rows' },
            constraintNodes(r.xpathConstraint, model, entity.qualifiedName)),
          // Said where the rule is, not in a list somewhere else: the reader
          // who is about to trust this line is the one who needs to know it
          // was not checked.
          note ? el('div', { class: 'con-unfollowed', title: note.title, text: note.label }) : null,
          constraintCheck(entity, r, ruleIndex)
        ].filter(Boolean)));
      });

      // One row builder for both kinds of member: they differ only in what the
      // Type column says and which of the rule's two maps holds the level.
      function memberRow(name, typeText, map, typeTitle) {
        var lvl = bestLevel(name, rules, map);
        var cells = [
          el('td', { class: 'am-attr' }, [
            el('span', { class: 'am-dot am-dot-' + lvl, title: lvl === 'rw' ? 'read + write' : (lvl === 'r' ? 'read' : 'no access') }),
            el('span', { text: name })
          ]),
          el('td', { class: 'am-type', text: typeText, title: typeTitle || typeText })
        ];
        rules.forEach(function (r) {
          var v = (r[map] || {})[name];
          if (v === 'none') v = null;
          cells.push(el('td', { class: 'am-rule-col am-lvl am-lvl-' + (v || 'none'),
            text: v === 'rw' ? 'read + write' : (v === 'r' ? 'read' : '—') }));
        });
        return el('tr', {}, cells);
      }

      var bodyRows = attrs.map(function (a) {
        return memberRow(a.name, attrTypeText(a), 'attrAccess', attrTypeTitle(a));
      });
      if (assocs.length) {
        // A labelled break rather than a second table: the associations are
        // read against the SAME rule columns, and splitting the table would
        // repeat every column header to say nothing new.
        bodyRows.push(el('tr', { class: 'am-group' }, [
          el('td', { class: 'am-group-cell', colspan: String(2 + rules.length), text: 'Associations' })
        ]));
        assocs.forEach(function (a) {
          bodyRows.push(memberRow(a.name, assocTypeText(a), 'assocAccess'));
        });
      }

      return el('div', { class: 'access-matrix-wrap' }, [
        el('table', { class: 'access-matrix' }, [
          el('thead', {}, [el('tr', {}, headCells)]),
          el('tbody', {}, bodyRows)
        ])
      ]);
    }

    function accessTab() {
      if (entity.builtin) {
        return el('div', { class: 'popup-section' }, [
          el('h4', { text: 'Built-in Mendix module' }),
          el('p', { text: entity.description || '' }),
          el('p', { class: 'muted', text: 'System.' + entity.name + ' ships with the Mendix Runtime, not with this project, so neither its attributes nor its access rules are stored in the .mpr file, and MxScout has no accurate list to show. The Data tab still works — it queries the running app directly, not this list.' })
        ]);
      }
      var attrs = entity.attributes || [];
      var assocs = ownedAssocs();
      var rules = (entity.accessRules || []).filter(function (r) { return !set || set[r.moduleRole]; });

      // No "Attributes & access — as <role>" heading any more: the tab already
      // names it, and the role selector in the header says (and changes) which
      // role this is for.
      var kids = [];
      if (!attrs.length && !assocs.length) {
        kids.push(el('p', { class: 'muted', text: 'No attributes and no associations.' }));
      } else if (!rules.length) {
        kids.push(el('p', { class: 'muted', text: set
          ? (state.detail.role + ' has no access rule on this entity — these members exist, but this role cannot reach them.')
          : 'No access rules are defined on this entity — these members have no role-based access configured.' }));
        kids.push(memberOnly(attrs, assocs));
      } else {
        // The caption, then the matrix that carries each rule in its own
        // column header.
        kids.push(constraintCaption());
        kids.push(accessMatrix(attrs, assocs, rules));
      }
      return el('div', { class: 'popup-section' }, kids.concat(relationshipsBlock()));
    }

    var commentTarget = { kind: 'entity', qualifiedName: entity.qualifiedName, module: entity.module, name: entity.name, attributes: entity.attributes || [] };
    var TABS = [
      ['access', 'Attributes & access', accessTab],
      ['data', 'Data', function () { return renderEntityDataTab(model, entity); }],
      ['comments', 'Comments', function () { return renderCommentsTab(commentTarget); }]
    ];
    // 'attributes'/'constraints' were two separate tabs; both now map to the
    // merged 'access' tab, so a remembered old value still lands somewhere.
    var activeTab = state.detail.entityTab || 'access';
    if (activeTab === 'attributes' || activeTab === 'constraints') activeTab = 'access';
    if (!TABS.some(function (t) { return t[0] === activeTab; })) activeTab = 'access';

    var tabRow = el('div', { class: 'popup-tabs' }, TABS.map(function (t) {
      return el('button', {
        class: 'popup-tab' + (t[0] === activeTab ? ' is-active' : ''),
        text: t[1],
        onclick: function () { state.detail.entityTab = t[0]; render(); }
      });
    }));
    var pane = TABS.filter(function (t) { return t[0] === activeTab; })[0][2]();

    var close = function () { state.detail.selectedEntity = null; state.detail.createObject = null; window.MxLive.forgetDataPane(); render(); };
    var backdrop = el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [
      withMod(el('div', { class: 'modal modal-detail modal-mod' }, [
        el('div', { class: 'popup-head' }, [
          el('div', {}, [
            el('div', { class: 'popup-title-row' }, [
              el('h3', { text: entity.name }),
              canCreate ? el('span', { class: 'badge badge-cd', text: 'Create' }) : null,
              canDelete ? el('span', { class: 'badge badge-cd', text: 'Delete' }) : null
            ].filter(Boolean)),
            el('p', { class: 'muted', text: entity.qualifiedName + (entity.generalization ? ' \u00B7 extends ' + entity.generalization : '') })
          ]),
          el('div', { class: 'popup-head-actions' }, [
            entity.builtin ? null : roleSelect(),
            window.MxComments.addButton(commentTarget, '+ Comment'),
            el('button', { class: 'btn btn-sm', text: 'Close', onclick: close })
          ].filter(Boolean))
        ]),
        tabRow,
        pane
      ].filter(Boolean)), entity.module)
    ]);
    return backdrop;
  }

  // ---------- flow detail popup (microflow / nanoflow / page) ----------
  // The same shape as the entity popup, and the same three questions in the
  // same order: what does it take, who may set it off, and then — deliberately
  // last and behind two gates — actually set it off.
  //
  // Running used to live on the Live app tab, which meant picking a flow in
  // one place and looking at it in another, and copying an object id between
  // them by hand. It belongs on the object.
  function findFlow(model, kind, qn) {
    var list = model[FLOW_SECTION_OF[kind]] || [];
    return list.filter(function (f) { return f.qualifiedName === qn; })[0] || null;
  }

  var FLOW_NOUN = { microflow: 'microflow', nanoflow: 'nanoflow', page: 'page' };

  function renderFlowPopup(sel) {
    var model = state.detail.model;
    var flow = findFlow(model, sel.kind, sel.qualifiedName);
    if (!flow) return null;
    var set = moduleRoleSetFor(model, state.detail.role);
    var noun = FLOW_NOUN[sel.kind] || 'flow';
    var params = flow.parameters || [];
    var objectParams = params.filter(function (p) { return p.entityQualifiedName; });
    var scalarParams = params.filter(function (p) { return !p.entityQualifiedName; });
    var allowed = flow.allowedModuleRoles || [];

    // A page is opened, not triggered — same fact, and the word a tester uses
    // for it is the word the panel should use.
    var verb = sel.kind === 'page' ? 'open' : 'trigger';

    function accessPane() {
      var kids = [el('h4', { text: sel.kind === 'page' ? 'Can be opened by' : 'Can be triggered by' })];
      if (!allowed.length) {
        kids.push(el('p', { class: 'muted', text: sel.kind === 'page'
          // What DOES reach it is the panel below's job, now that MxScout
          // works that out instead of guessing at it here.
          ? 'No user role can open this directly.'
          : 'No user role can trigger this directly.' }));
      } else {
        kids.push(el('div', { class: 'rule-badges' }, allowed.map(function (r) {
          var mine = !set || set[r];
          return el('span', { class: 'badge ' + (mine ? 'badge-read' : 'badge-none'), text: r });
        })));
        if (set) {
          kids.push(el('p', {
            class: listHitsSet(allowed, set) ? 'ok-text' : 'muted',
            text: listHitsSet(allowed, set)
              ? state.detail.role + ' can ' + verb + ' this ' + noun + '.'
              : state.detail.role + ' cannot ' + verb + ' this ' + noun + ' \u2014 the roles above are not part of it.'
          }));
        }
      }
      return el('div', { class: 'popup-section' }, kids);
    }

    // ---- What reaches this, when no role does ----
    // "No user role can trigger this directly" is true about the client and
    // says nothing about the application: measured on a real project, 363 of
    // its documents have no role at all and 278 of those ARE reached by
    // something — another flow, a page's button, a scheduled event, a
    // published REST operation, an entity event. That is the answer somebody
    // opening a role-less flow actually wants.
    //
    // A model that predates this reader has an empty calledBy that means
    // "nobody looked", which is a completely different claim from "nothing
    // reaches this" — so meta.knowsCallSites decides which sentence is said.
    function triggeredFromPane() {
      var knows = !!(model.meta && model.meta.knowsCallSites);
      var sources = flow.calledBy || [];
      // A model from a JSON export carries plain strings here; normalise so
      // one renderer handles both without pretending to know the kind.
      var rows = sources.map(function (s) {
        return typeof s === 'string' ? { kind: null, name: s } : s;
      }).filter(function (s) { return s && (s.name || s.kind); });

      if (!knows && !rows.length) {
        if (allowed.length) return null; // a role can reach it; nothing is missing
        return el('div', { class: 'popup-section' }, [
          el('h4', { text: 'Reached from' }),
          el('p', { class: 'muted', text: 'This model does not record where things are called from. Replace it from the Mendix project folder and MxScout will work it out.' })
        ]);
      }
      if (!rows.length) {
        if (allowed.length) return null;
        return el('div', { class: 'popup-section' }, [
          el('h4', { text: 'Reached from' }),
          el('p', { class: 'warn-text', text: 'Nothing in this model reaches this ' + noun + ' — no flow, page, scheduled event or published service names it.' })
        ]);
      }

      var kids = [el('h4', { text: 'Reached from (' + rows.length + ')' })];
      kids.push(el('div', { class: 'trig-list' }, rows.map(function (s) {
        var target = s.name ? findFlow(model, 'microflow', s.name) || findFlow(model, 'nanoflow', s.name) || findFlow(model, 'page', s.name) : null;
        var kindLabel = el('span', { class: 'trig-kind', text: s.kind || 'names it' });
        if (!target) {
          // A scheduled event, a published service, a snippet: real, named,
          // and not something MxScout has a page for. Say it plainly rather
          // than offering a link that goes nowhere.
          return el('div', { class: 'trig-row' }, [
            kindLabel,
            el('span', { class: 'trig-name', text: s.name || '—' })
          ]);
        }
        var sectionKey = target === findFlow(model, 'microflow', s.name) ? 'microflows'
          : target === findFlow(model, 'nanoflow', s.name) ? 'nanoflows' : 'pages';
        return el('div', { class: 'trig-row' }, [
          kindLabel,
          el('button', {
            class: 'link-btn trig-name', text: s.name,
            title: 'Open ' + s.name + ' over this one',
            onclick: function () { peekObject(sectionKey, target); }
          })
        ]);
      })));
      if (!allowed.length) {
        kids.push(el('p', { class: 'hint', text: 'No role can set this ' + noun + ' off from the client — it runs because one of the above runs it.' }));
      }
      return el('div', { class: 'popup-section' }, kids);
    }

    // ---- What it does, before you set it off ----
    // MxScout really runs this flow: in the tester's own session, against a
    // real test environment, with their real rights. Everything else here is
    // read-only; this one button is not. So the panel that asks you to press
    // it also says what pressing it does — read out of the flow's own body
    // (see readFlowActivity in mpr.js), not guessed from its name.
    //
    // A model with no activity on it — a JSON export, or a project imported
    // before this was read — gets nothing rather than an empty summary that
    // would read as "this flow does nothing".
    function activityPane() {
      var act = flow.activity;
      if (!act) return null;

      // One line first, because that is what a person reads before a table:
      // strongest true statement about what this does to data.
      var verdict, tone;
      if (act.deleteCount) { verdict = 'Deletes data'; tone = 'act-danger'; }
      else if (act.commitCount || act.creates.length) { verdict = 'Writes data'; tone = 'act-danger'; }
      else if (act.changes.length) { verdict = 'Changes objects without committing'; tone = 'act-warn'; }
      else if (act.restCalls) { verdict = 'Calls out of the app'; tone = 'act-warn'; }
      else if (act.reads.length) { verdict = 'Reads only'; tone = 'act-calm'; }
      else { verdict = 'Touches no data'; tone = 'act-calm'; }

      var kids = [
        el('h4', { text: 'What it does' }),
        el('div', { class: 'act-verdict ' + tone, text: verdict })
      ];

      var rows = [];
      function line(label, value, title) {
        if (!value) return;
        rows.push(el('div', { class: 'act-row' }, [
          el('span', { class: 'act-label', text: label }),
          el('span', { class: 'act-value', text: value, title: title || value })
        ]));
      }
      function names(list, fallback, count) {
        if (list.length) return list.join(', ');
        return count ? fallback : null;
      }
      line('Reads', names(act.reads, null, 0));
      line('Creates', names(act.creates, null, 0));
      line('Changes', names(act.changes, null, 0));
      // A commit or a delete whose entity the body never names still has to
      // be reported — "it deletes something" is the part that matters.
      line('Commits', names(act.commits, act.commitCount + ' object' + (act.commitCount === 1 ? '' : 's'), act.commitCount));
      line('Deletes', names(act.deletes, act.deleteCount + ' object' + (act.deleteCount === 1 ? '' : 's'), act.deleteCount));

      var callsOut = [];
      if (act.calls.length) callsOut.push(act.calls.length + ' ' + (act.calls.length === 1 ? 'flow' : 'flows'));
      if (act.javaActions.length) callsOut.push(act.javaActions.length + ' Java ' + (act.javaActions.length === 1 ? 'action' : 'actions'));
      if (act.jsActions.length) callsOut.push(act.jsActions.length + ' JavaScript ' + (act.jsActions.length === 1 ? 'action' : 'actions'));
      line('Calls', callsOut.join(', ') || null,
        act.calls.concat(act.javaActions, act.jsActions).join('\n') || null);
      line('Outside the app', act.restCalls ? act.restCalls + ' REST call' + (act.restCalls === 1 ? '' : 's') : null);
      line('Opens', act.opensPages.join(', ') || null);

      var tells = [];
      if (act.messages) tells.push(act.messages + ' message' + (act.messages === 1 ? '' : 's'));
      if (act.validations) tells.push(act.validations + ' validation' + (act.validations === 1 ? '' : 's'));
      line('Shows', tells.join(', ') || null);

      if (rows.length) kids.push(el('div', { class: 'act-rows' }, rows));
      else kids.push(el('p', { class: 'muted', text: 'No activity in this ' + noun + ' reads or writes anything.' }));

      // A retrieve or a commit inside a loop is one database round trip per
      // row at run time. It is the cheapest performance problem in Mendix to
      // spot from the model and the most common one to find in the log after.
      var loop = act.inLoop;
      var inLoop = [];
      if (loop.reads) inLoop.push(loop.reads === 1 ? 'a retrieve' : loop.reads + ' retrieves');
      if (loop.commits) inLoop.push(loop.commits === 1 ? 'a commit' : loop.commits + ' commits');
      if (loop.deletes) inLoop.push(loop.deletes === 1 ? 'a delete' : loop.deletes + ' deletes');
      if (inLoop.length) {
        kids.push(el('p', { class: 'act-loop', text: 'Inside a loop: ' + inLoop.join(' and ') +
          ' — that runs once per item, so it costs one database round trip per row.' }));
      }

      // Only a microflow has this switch, and it decides whether the access
      // rules shown two panels up apply to what it just did.
      if (sel.kind === 'microflow' && flow.applyEntityAccess === false &&
        (act.reads.length || act.changes.length || act.creates.length || act.deleteCount)) {
        kids.push(el('p', { class: 'act-loop', text: 'Entity access is not applied: this microflow reads and writes past the access rules, whatever role sets it off.' }));
      }

      return el('div', { class: 'popup-section' }, kids);
    }

    // ---- Run: the only place in MxScout that can change anything ----
    // One row per parameter, in the flow's own signature order, each saying
    // what it wants and what it currently holds. Objects are chosen in a
    // picker that opens OVER this panel (renderObjectPickerModal) rather
    // than a full rows-table embedded in the middle of it: that table pushed
    // the run button off the bottom of the window, and — being one table —
    // could only ever serve ONE parameter, which is why a flow taking four
    // objects used to be refused outright instead of simply asked about
    // four times.
    var picks = state.detail.flowPick;      // paramName -> { guids: [...] }
    var scalars = state.detail.flowScalars; // paramName -> raw input value
    var overrides = state.detail.flowOverrides; // paramName -> { attrName: rawValue }

    // Attribute values to set on the chosen object before the run. The bridge
    // applies them as UNCOMMITTED changes (obj.set) to the loaded object and
    // passes it to the flow — the flow sees the values, nothing is written to
    // the database unless the flow itself commits. Only single-object
    // parameters get this (a list would need per-object overrides, which is
    // not worth the UI here).
    function renderOverrideEditor(p, pickEntity) {
      var settable = (pickEntity.attributes || []).filter(function (a) { return SETTABLE_OVERRIDE[a.type]; });
      if (!settable.length) return null;
      var ov = overrides[p.name] = overrides[p.name] || {};
      var rows = settable.map(function (a) {
        var kind = SETTABLE_OVERRIDE[a.type];
        var field;
        if (kind === 'boolean') {
          field = el('select', { class: 'role-select' });
          [['', '(no change)'], ['true', 'true'], ['false', 'false']].forEach(function (o) {
            var opt = el('option', { value: o[0], text: o[1] });
            var cur = ov[a.name] === true ? 'true' : (ov[a.name] === false ? 'false' : '');
            if (cur === o[0]) opt.setAttribute('selected', 'selected');
            field.appendChild(opt);
          });
          field.addEventListener('change', function () {
            if (field.value === '') delete ov[a.name]; else ov[a.name] = field.value === 'true';
          });
        } else {
          field = el('input', { type: kind === 'number' ? 'number' : 'text', placeholder: 'leave blank to keep' });
          field.value = ov[a.name] != null ? String(ov[a.name]) : '';
          field.addEventListener('input', function () {
            if (field.value === '') delete ov[a.name]; else ov[a.name] = field.value;
          });
        }
        return el('div', { class: 'kv-row' }, [el('span', { class: 'kv-key', text: a.name + ' (' + a.type + ')' }), field]);
      });
      return el('details', { class: 'override-editor' }, [
        el('summary', { text: 'Override attribute values (optional)' }),
        el('p', { class: 'muted', text: 'Set values here to run against this object as if it held them. They are applied as uncommitted changes — the ' + noun + ' sees them, but nothing is written to the database unless it commits. Leave a field blank to keep the object’s own value.' }),
        el('div', { class: 'kv' }, rows)
      ]);
    }

    function collectObjectOverrides(p) {
      var ov = overrides[p.name];
      if (!ov) return null;
      var pickEntity = findEntity(model, p.entityQualifiedName);
      if (!pickEntity) return null;
      var byName = {};
      (pickEntity.attributes || []).forEach(function (a) { byName[a.name] = a; });
      var out = {};
      Object.keys(ov).forEach(function (k) {
        var a = byName[k]; if (!a) return;
        var kind = SETTABLE_OVERRIDE[a.type]; if (!kind) return;
        var raw = ov[k];
        if (kind === 'boolean') { out[k] = !!raw; return; }
        if (kind === 'number') {
          var s = String(raw).trim();
          if (s === '') return;
          var n = Number(s);
          if (isFinite(n)) out[k] = n;
          return;
        }
        if (String(raw) !== '') out[k] = String(raw);
      });
      return Object.keys(out).length ? out : null;
    }

    function paramReady(p) {
      if (!p.entityQualifiedName) return true; // a value may legitimately be left empty
      var got = picks[p.name] && picks[p.name].guids;
      return !!(got && got.length);
    }
    function describePick(p) {
      var got = (picks[p.name] && picks[p.name].guids) || [];
      if (!got.length) return null;
      return got.length === 1 ? ('id ' + got[0]) : (got.length + ' objects');
    }

    function renderParamRow(p, connected) {
      var isObject = !!p.entityQualifiedName;
      var typeText = isObject ? (p.entityQualifiedName + (p.isList ? ' (list)' : '')) : (p.type || 'value');
      var control;

      if (isObject) {
        var chosenText = describePick(p);
        var pickEntity = findEntity(model, p.entityQualifiedName);
        if (!pickEntity) {
          control = el('span', { class: 'warn-text', text: 'not in this model' });
        } else if (!connected) {
          control = el('span', { class: 'muted', text: 'connect the app tab first' });
        } else {
          var choiceRow = el('div', { class: 'param-choice' }, [
            el('span', { class: chosenText ? 'param-chosen' : 'muted', text: chosenText || 'not set' }),
            el('button', {
              class: 'btn btn-sm', text: chosenText ? 'Change…' : 'Choose…',
              onclick: function () {
                state.detail.objectPicker = { paramName: p.name, entityQualifiedName: p.entityQualifiedName, isList: !!p.isList };
                window.MxLive.forgetDataPane();
                render();
              }
            })
          ]);
          // Once an object is chosen, offer to override its attribute values
          // for the run. Single-object parameters only — a list would need
          // per-object overrides.
          var controlKids = [choiceRow];
          if (chosenText && !p.isList) {
            var ovEditor = renderOverrideEditor(p, pickEntity);
            if (ovEditor) controlKids.push(ovEditor);
          }
          control = el('div', {}, controlKids);
        }
      } else {
        var type = String(p.type || '');
        var input;
        if (/^bool/i.test(type)) {
          input = el('select', { class: 'role-select' });
          [['', '(default)'], ['true', 'true'], ['false', 'false']].forEach(function (o) {
            var opt = el('option', { value: o[0], text: o[1] });
            if ((scalars[p.name] || '') === o[0]) opt.setAttribute('selected', 'selected');
            input.appendChild(opt);
          });
        } else {
          input = el('input', {
            type: /^(integer|long|decimal|float)$/i.test(type) ? 'number' : 'text',
            placeholder: 'flow’s own default',
            value: scalars[p.name] || ''
          });
        }
        // Kept in state, not only in the DOM: choosing an object re-renders
        // the whole popup, and a value typed before that would otherwise be
        // silently wiped.
        input.addEventListener('input', function () { scalars[p.name] = input.value; });
        input.addEventListener('change', function () { scalars[p.name] = input.value; });
        control = input;
      }

      return el('div', { class: 'param-row' }, [
        el('div', { class: 'param-id' }, [
          el('span', { class: 'param-name', text: p.name }),
          el('span', { class: 'param-type', text: typeText })
        ]),
        el('div', { class: 'param-control' }, [control])
      ]);
    }

    function collectScalarParams() {
      return scalarParams.map(function (p) {
        var raw = scalars[p.name];
        if (raw == null || raw === '') return null;
        var type = String(p.type || '');
        var value = raw;
        if (/^bool/i.test(type)) value = raw === 'true';
        else if (/^(integer|long)$/i.test(type)) value = parseInt(raw, 10);
        else if (/^(decimal|float)$/i.test(type)) value = parseFloat(raw);
        if (typeof value === 'number' && !isFinite(value)) return null;
        return { name: p.name, value: value };
      }).filter(Boolean);
    }

    function runPane() {
      var ex = state.detail.live.exec;

      // Only ask the bridge for its connection state (which can start a
      // session — a real side effect) once running has actually been
      // enabled; before that, params render as not-connected.
      var blocked = ex.acknowledged
        ? window.MxLive.blocker(window.MxLive.targetForFlow(model, { kind: sel.kind, flow: flow }))
        : null;
      var connected = ex.acknowledged && !blocked;

      // The signature — what it takes, in what shape — is static information
      // from the model, not something running it needs to happen for: it
      // belongs on the tab from the moment it opens, same as the entity
      // popup's attribute list. Only the parts that reach the running app
      // (choosing objects, the run button itself) stay behind the ack gate
      // below.
      var kids = [el('h4', { text: 'Inputs' + (params.length ? ' (' + params.length + ')' : '') })];
      if (!allowed.length) {
        kids.push(el('p', { class: 'warn-text', text: 'The model says no user role may trigger this directly, so the app will most likely refuse it. You can still try — the app decides, not MxScout.' }));
      }
      if (!params.length) {
        kids.push(el('p', { class: 'muted', text: 'Takes no input — it can be run as it is.' }));
      } else {
        kids.push(el('div', { class: 'param-table' }, params.map(function (p) { return renderParamRow(p, connected); })));
      }

      if (!ex.acknowledged) {
        kids.push(el('p', { class: 'warn-text', text: 'Running a ' + noun + ' is real: it happens in your app tab, in your own logged-in session. If it writes, deletes or sends something, that actually happens.' }));
        kids.push(el('button', { class: 'btn btn-danger-outline', text: 'Enable running flows', onclick: function () { ex.ackOpen = true; render(); } }));
        return el('div', { class: 'popup-section' }, kids);
      }

      if (blocked) { kids.push(blocked); return el('div', { class: 'popup-section' }, kids); }

      var missing = params.filter(function (p) { return !paramReady(p); });
      var runBtn = el('button', {
        class: 'btn btn-danger',
        text: 'Run ' + flow.name + '…'
      });
      if (missing.length) runBtn.setAttribute('disabled', 'disabled');
      runBtn.addEventListener('click', function () {
        setMessage(null);
        state.detail.live.exec.confirm = {
          kind: sel.kind,
          qualifiedName: flow.qualifiedName,
          objectParams: objectParams.filter(paramReady).map(function (p) {
            var entry = { name: p.name, guids: picks[p.name].guids.slice(), entityQualifiedName: p.entityQualifiedName };
            if (!p.isList) {
              var ov = collectObjectOverrides(p);
              if (ov) entry.overrides = ov;
            }
            return entry;
          }),
          scalarParams: collectScalarParams()
        };
        render();
      });

      kids.push(el('div', { class: 'flow-run-actions' }, [
        runBtn,
        missing.length
          ? el('span', { class: 'muted', text: 'Still to choose: ' + missing.map(function (p) { return p.name; }).join(', ') })
          : null
      ].filter(Boolean)));
      kids.push(el('div', { id: 'exec-status-area', class: 'exec-status-area' }, [window.MxLive.renderStatusArea()]));
      return el('div', { class: 'popup-section' }, kids);
    }

    // ---- Pages are read-only here ----
    // MxScout used to offer "Open" for a page, through mx.ui.openForm from the
    // bridge. It does not any more: a page opens through the app's own
    // navigation, carrying the context that navigation built, and driving that
    // from outside the client is not something that works dependably enough to
    // put a button on. What a page TAKES and who may open it are still model
    // facts worth reading, so the popup keeps them — it just no longer
    // pretends it can set the page off.
    function pageInfoPane() {
      var kids = [el('h4', { text: 'Inputs' + (params.length ? ' (' + params.length + ')' : '') })];
      if (!params.length) {
        kids.push(el('p', { class: 'muted', text: 'Takes no input.' }));
      } else {
        kids.push(el('div', { class: 'param-table' }, params.map(function (p) {
          var isObject = !!p.entityQualifiedName;
          return el('div', { class: 'param-row' }, [
            el('div', { class: 'param-id' }, [
              el('span', { class: 'param-name', text: p.name }),
              el('span', { class: 'param-type', text: isObject ? (p.entityQualifiedName + (p.isList ? ' (list)' : '')) : (p.type || 'value') })
            ]),
            el('div', { class: 'param-control' }, [
              el('span', { class: 'muted', text: isObject ? 'bound through the page’s context' : 'page default' })
            ])
          ]);
        })));
      }
      kids.push(el('p', { class: 'hint', text: 'MxScout cannot open a page in the connected app tab — that is a navigation the app itself has to make. Open it in the app, in the place that leads to it. Microflows and nanoflows are what MxScout can run.' }));
      return el('div', { class: 'popup-section' }, kids);
    }

    var commentTarget = { kind: sel.kind, qualifiedName: flow.qualifiedName, module: flow.module, name: flow.name, attributes: [] };
    // Two tabs, not four. What a flow IS (its inputs), who may set it off,
    // and setting it off are one continuous question \u2014 reading the signature
    // in one tab and then choosing values for it in another meant flipping
    // back and forth to answer "what does this even want". They sit side by
    // side now, in the width the popup finally has. Comments stay their own
    // tab: a different question, asked at a different time.
    var TABS = [
      sel.kind === 'page'
        ? ['info', 'Inputs', function () {
            return el('div', { class: 'flow-cols' }, [
              el('div', { class: 'flow-col-run' }, [pageInfoPane()]),
              el('div', { class: 'flow-col-side' }, [accessPane(), triggeredFromPane(), activityPane()].filter(Boolean))
            ]);
          }]
        : ['run', 'Run', function () {
            return el('div', { class: 'flow-cols' }, [
              el('div', { class: 'flow-col-run' }, [runPane()]),
              el('div', { class: 'flow-col-side' }, [accessPane(), triggeredFromPane(), activityPane()].filter(Boolean))
            ]);
          }],
      ['comments', 'Comments', function () { return renderCommentsTab(commentTarget); }]
    ];
    var activeTab = state.detail.flowTab || TABS[0][0];
    if (!TABS.some(function (t) { return t[0] === activeTab; })) activeTab = TABS[0][0];

    var tabRow = el('div', { class: 'popup-tabs' }, TABS.map(function (t) {
      return el('button', {
        class: 'popup-tab' + (t[0] === activeTab ? ' is-active' : '') + (t[0] === 'run' ? ' popup-tab-danger' : ''),
        text: t[1],
        onclick: function () { state.detail.flowTab = t[0]; render(); }
      });
    }));

    var close = function () {
      state.detail.selectedFlow = null;
      state.detail.objectPicker = null;
      state.detail.createObject = null;
      window.MxLive.forgetDataPane();
      render();
    };
    var backdrop = el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [
      withMod(el('div', { class: 'modal modal-detail modal-mod' }, [
        el('div', { class: 'popup-head' }, [
          el('div', {}, [
            el('h3', { text: flow.name }),
            el('p', { class: 'muted', text: flow.qualifiedName + ' \u00B7 ' + noun })
          ]),
          el('div', { class: 'popup-head-actions' }, [
            window.MxComments.addButton(commentTarget, '+ Comment'),
            el('button', { class: 'btn btn-sm', text: 'Close', onclick: close })
          ])
        ]),
        tabRow,
        TABS.filter(function (t) { return t[0] === activeTab; })[0][2]()
      ].filter(Boolean)), flow.module)
    ]);
    return backdrop;
  }

  // ---------- choosing an object for one flow parameter ----------
  // Opens over the flow popup, scoped to ONE parameter, so a flow taking
  // four objects is four visits here rather than an unsupported case. Which
  // ways of choosing are offered depends on the entity, not on a mode the
  // user has to pick first: a persistable entity can be browsed and searched
  // (and looked up by id, which is the same query with a bare number);
  // a non-persistable one has no store to browse, so it gets lookup-by-id
  // and create instead \u2014 renderTransientPane already is exactly that.
  function renderObjectPickerModal() {
    if (!state.detail || !state.detail.objectPicker) return null;
    var pk = state.detail.objectPicker;
    var model = state.detail.model;
    var entity = findEntity(model, pk.entityQualifiedName);
    if (!entity) { state.detail.objectPicker = null; return null; }

    var picks = state.detail.flowPick;
    var current = picks[pk.paramName] || { guids: [] };

    var close = function () {
      state.detail.objectPicker = null;
      window.MxLive.forgetDataPane();
      render();
    };

    var body;
    var blocked = window.MxLive.blocker(window.MxLive.targetForEntity(model, entity));
    if (blocked) {
      body = [blocked];
    } else if (entity.persistable === false) {
      body = [
        el('p', { class: 'hint', text: entity.name + ' is non-persistable, so there is no stored table to browse. Look one up by an id you have seen, or create a fresh one to run against.' }),
        window.MxLive.renderTransientPane(model, entity, function (guid) {
          picks[pk.paramName] = { guids: [guid] };
          close();
        })
      ];
    } else if (pk.isList) {
      var selectedSet = new Set(current.guids);
      body = [
        el('p', { class: 'hint', text: 'This input takes a list \u2014 click as many rows as it needs; click one again to take it back out.' }),
        // renderDataPane has ALREADY toggled this Set by the time the
        // callback runs, so this only syncs from it. Toggling again here
        // would add-then-remove and never visibly select anything.
        window.MxLive.renderDataPane(model, entity, function () {
          picks[pk.paramName] = { guids: Array.from(selectedSet) };
          var count = document.querySelector('.picker-count');
          if (count) count.textContent = selectedSet.size + ' chosen';
        }, selectedSet)
      ];
    } else {
      body = [
        el('p', { class: 'hint', text: 'Search it, page through it, or type an object id straight into the search box \u2014 then click the row you mean.' }),
        window.MxLive.renderDataPane(model, entity, function (guid) {
          picks[pk.paramName] = { guids: [guid] };
          close();
        })
      ];
    }

    var actions = [el('button', { class: 'btn', text: pk.isList ? 'Done' : 'Cancel', onclick: close })];
    if (!pk.isList && current.guids.length) {
      actions.unshift(el('button', {
        class: 'btn btn-sm', text: 'Clear',
        onclick: function () { delete picks[pk.paramName]; close(); }
      }));
    }

    var head = [
      el('h3', { text: 'Choose ' + (pk.isList ? entity.name + ' objects' : 'a ' + entity.name) }),
      el('p', { class: 'muted', text: 'for ' + pk.paramName + ' \u00B7 ' + entity.qualifiedName })
    ];
    if (pk.isList) head.push(el('p', { class: 'picker-count', text: current.guids.length + ' chosen' }));

    var backdrop = el('div', { class: 'modal-backdrop modal-backdrop-over', onclick: function (e) { if (e.target === backdrop) close(); } }, [
      withMod(el('div', { class: 'modal modal-detail modal-mod' },
        head.concat(body, [el('div', { class: 'modal-actions' }, actions)])
      ), entity.module)
    ]);
    return backdrop;
  }

  window.MxObjects = {
    init: init,
    renderEntity: renderEntityPopup,
    renderFlow: renderFlowPopup,
    renderObjectPicker: renderObjectPickerModal
  };
})();
