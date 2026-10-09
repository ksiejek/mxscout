/* MxScout — entity access measured against what actually uses it.
 *
 * An access rule says how much of an entity a role may read. The pages,
 * nanoflows and microflows that role can reach say how much of it the app
 * ever SHOWS that role. The two are written in different places, by
 * different people, and nothing in Studio Pro compares them. This does, from
 * the model alone, without a running app and without any AI:
 *
 *   WIDER THAN ITS USE — the role reads every row of the entity (a rule with
 *     no XPath), but every place it meets that entity narrows it: a list over
 *     an association, a list with an XPath, the object a page was opened
 *     with, a microflow that hands it over. Nothing the role can reach lists
 *     the whole table.
 *   NEVER USED — the role has a rule on the entity, and nothing the role can
 *     reach shows it, reads it, takes it or returns it.
 *
 * Why the first one matters at all: a page is not a security boundary. What
 * a signed-in user can fetch is decided by the rule, not by the list that
 * happens to be on screen, so a rule wider than every page is the real
 * extent of that role's access. Strict mode narrows what the client may ask
 * for directly, which is why the Security section says which mode the
 * project is in next to these.
 *
 * PER USER ROLE, not per module role, and that is not a presentation choice.
 * A page allows the module roles of ITS module, an entity's rule names the
 * module roles of ITS module, and the only thing that joins a page in one
 * module to a rule in another is the user role carrying both. Measured per
 * module role, Helpdesk reported 244 rules "never used" that its own pages
 * use every day, through a different module's role on the same person.
 *
 * What counts as "reaching" an entity, for one user role:
 *   - a page any of its module roles may open: every data source on it and
 *     on every snippet it places (recursively), its parameters, and every
 *     entity its widgets name, an attribute shown over an association too;
 *   - every nanoflow and microflow it may call, every microflow behind a
 *     published REST operation it may call, and every flow those pages name,
 *     followed through the calls they make;
 *   - of those, a nanoflow, or a microflow that applies entity access,
 *     counts its retrieves and the objects it creates or changes, since it
 *     does all of that with the role's rights;
 *   - a microflow that does NOT apply entity access counts only what crosses
 *     into the client: its object parameters and what it returns, when the
 *     role may call it, and what it returns to a page that uses it as a data
 *     source. What it does inside is done with no rights at all.
 *   - a specialization is reached wherever its generalization is: a list of
 *     every Document shows every Invoice.
 *
 * Where it stops: a published OData service hands out whole entity sets by
 * its own role list, and which entity a set is cannot be read from here, so
 * a user role that a service is open to is set aside and named rather than
 * judged. A Java action is not followed either.
 */
(function () {
  'use strict';

  // How a use narrows the entity, in the order a reader is told about them.
  // 'all' is the one that does not narrow.
  var HOW = ['all', 'xpath', 'association', 'context', 'microflow', 'parameter', 'mention'];

  function grantsRead(rule) {
    if (!rule) return false;
    if (rule.defaultAccess === 'r' || rule.defaultAccess === 'rw') return true;
    var maps = [rule.attrAccess || {}, rule.assocAccess || {}];
    return maps.some(function (m) {
      return Object.keys(m).some(function (k) { return m[k] === 'r' || m[k] === 'rw'; });
    });
  }

  // "List of Sales.Order", "Sales.Order" — only names that ARE entities.
  function entitiesIn(text, entityByName) {
    var out = [];
    if (typeof text !== 'string') return out;
    var re = /([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g, m;
    while ((m = re.exec(text))) {
      var qn = m[1] + '.' + m[2];
      if (entityByName[qn] && out.indexOf(qn) === -1) out.push(qn);
    }
    return out;
  }

  function analyse(model, options) {
    options = options || {};
    var entities = model.entities || [];
    var entityByName = {};
    entities.forEach(function (e) { entityByName[e.qualifiedName] = e; });

    // Every ancestor of an entity, so a use of the generalization counts
    // for each specialization under it.
    function ancestors(qn) {
      var out = [], seen = {};
      var e = entityByName[qn];
      while (e && e.generalization && !seen[e.generalization]) {
        seen[e.generalization] = true;
        out.push(e.generalization);
        e = entityByName[e.generalization];
      }
      return out;
    }

    var flowByName = {};
    (model.microflows || []).forEach(function (f) { flowByName[f.qualifiedName] = [{ flow: f, kind: 'microflow' }]; });
    (model.nanoflows || []).forEach(function (f) {
      // A nanoflow and a microflow can share a qualified name, and a call
      // site does not always say which, so both are followed.
      (flowByName[f.qualifiedName] = flowByName[f.qualifiedName] || []).push({ flow: f, kind: 'nanoflow' });
    });
    var snippetByName = {};
    (model.snippets || []).forEach(function (s) { snippetByName[s.qualifiedName] = s; });

    // Published services, by the module roles they are open to. A REST
    // operation names the microflow behind it ("POST order → Sales.Cancel"),
    // so that one is followed; an OData entity set is not.
    var restFlowsFor = {}, odataFor = {};
    (model.publishedServices || []).forEach(function (s) {
      (s.allowedModuleRoles || []).forEach(function (mr) {
        if (s.kind === 'OData') {
          (odataFor[mr] = odataFor[mr] || []).push(s.name);
          return;
        }
        (s.exposes || []).forEach(function (op) {
          var m = /→\s*(\S+)\s*$/.exec(String(op));
          if (m) (restFlowsFor[mr] = restFlowsFor[mr] || []).push(m[1]);
        });
      });
    });

    // Who is judged: the user roles, since that is what a person holds. A
    // model with none (a JSON export from elsewhere) is judged per module
    // role instead, which is the best it can say.
    var subjects = (model.userRoles || []).filter(function (r) { return (r.moduleRoles || []).length; })
      .map(function (r) { return { name: r.name, moduleRoles: r.moduleRoles.slice() }; });
    if (!(model.userRoles || []).length) {
      var seenRole = {};
      entities.forEach(function (e) {
        (e.accessRules || []).forEach(function (rule) {
          if (rule && rule.moduleRole && !seenRole[rule.moduleRole]) {
            seenRole[rule.moduleRole] = true;
            subjects.push({ name: rule.moduleRole, moduleRoles: [rule.moduleRole] });
          }
        });
      });
    }

    var visible = options.visible || null; // a Set of entity names to report on
    var wider = [], unused = [], setAside = [];

    subjects.forEach(function (subject) {
      var roles = {};
      subject.moduleRoles.forEach(function (mr) { roles[mr] = true; });

      var services = [];
      subject.moduleRoles.forEach(function (mr) {
        (odataFor[mr] || []).forEach(function (name) { if (services.indexOf(name) === -1) services.push(name); });
      });
      if (services.length) {
        setAside.push({ userRole: subject.name, services: services.sort() });
        return;
      }

      var uses = reachFor(roles);
      entities.forEach(function (entity) {
        var qn = entity.qualifiedName;
        if (visible && !visible.has(qn)) return;
        var rules = (entity.accessRules || []).filter(function (rule) { return rule && roles[rule.moduleRole]; });
        if (!rules.length) return;

        var found = (uses[qn] || []).slice();
        ancestors(qn).forEach(function (a) {
          (uses[a] || []).forEach(function (u) { found.push(Object.assign({ through: a }, u)); });
        });
        found.sort(function (a, b) { return HOW.indexOf(a.how) - HOW.indexOf(b.how); });

        var item = {
          entity: qn, name: entity.name, module: entity.module, userRole: subject.name,
          // The module roles whose rules gave this user role the entity,
          // which are the rules somebody would change.
          moduleRoles: unique(rules.map(function (r) { return r.moduleRole; })),
          openRoles: unique(rules.filter(function (r) { return grantsRead(r) && !r.xpathConstraint; })
            .map(function (r) { return r.moduleRole; })),
          uses: found
        };
        if (!found.length) {
          unused.push(item);
          return;
        }
        // "Every row in the database" means nothing for an entity that is
        // never stored.
        if (!item.openRoles.length || entity.persistable === false) return;
        if (found.some(function (u) { return u.how === 'all'; })) return;
        wider.push(item);
      });
    });

    return { wider: wider, unused: unused, setAside: setAside, judged: subjects.length - setAside.length };

    function unique(list) {
      return list.filter(function (v, i) { return list.indexOf(v) === i; }).sort();
    }

    // Everything one user role reaches, as entity name -> [use].
    function reachFor(roles) {
      var uses = {};
      function use(qn, how, where) {
        if (!qn || !entityByName[qn]) return;
        (uses[qn] = uses[qn] || []).push(Object.assign({ how: how }, where));
      }
      function allowed(item) {
        return (item.allowedModuleRoles || []).some(function (mr) { return roles[mr]; });
      }

      var flowQueue = [], flowSeen = {};
      function queueFlow(name) {
        if (!name || flowSeen[name]) return;
        flowSeen[name] = true;
        flowQueue.push(name);
      }

      function readContainer(c, where, snippetSeen) {
        (c.dataSources || []).forEach(function (s) {
          var at = { via: where.via, name: where.name, widget: s.widget || null };
          if (s.kind === 'database') {
            use(s.entity, s.xpath ? 'xpath' : 'all', Object.assign({ xpath: s.xpath }, at));
          } else if (s.kind === 'association') {
            use(s.entity, 'association', Object.assign({ path: s.path || [], xpath: s.xpath || null }, at));
          } else if (s.kind === 'context') {
            use(s.entity, 'context', at);
          } else if (s.kind === 'microflow' || s.kind === 'nanoflow') {
            queueFlow(s.flow);
            // What a data source flow returns reaches the client whatever
            // the flow did to find it.
            (flowByName[s.flow] || []).forEach(function (target) {
              entitiesIn(target.flow.returnType, entityByName).forEach(function (qn) {
                use(qn, 'microflow', Object.assign({ flow: s.flow }, at));
              });
            });
          }
        });
        (c.flowRefs || []).forEach(queueFlow);
        (c.mentions || []).forEach(function (qn) { use(qn, 'mention', { via: where.via, name: where.name }); });
        (c.snippets || []).forEach(function (name) {
          if (snippetSeen[name]) return;
          snippetSeen[name] = true;
          var snippet = snippetByName[name];
          if (snippet) readContainer(snippet, { via: 'snippet', name: name }, snippetSeen);
        });
      }

      (model.pages || []).forEach(function (p) {
        if (!allowed(p)) return;
        (p.parameters || []).forEach(function (param) {
          use(param.entityQualifiedName, 'context', { via: 'page', name: p.qualifiedName, parameter: param.name });
        });
        readContainer(p, { via: 'page', name: p.qualifiedName }, {});
      });

      // Flows the role may call from the client or through a REST operation:
      // their parameters and what they return cross over whatever they do
      // inside.
      var callable = {};
      ['microflows', 'nanoflows'].forEach(function (key) {
        (model[key] || []).forEach(function (f) {
          if (!allowed(f)) return;
          callable[f.qualifiedName] = true;
          queueFlow(f.qualifiedName);
        });
      });
      Object.keys(roles).forEach(function (mr) {
        (restFlowsFor[mr] || []).forEach(function (name) {
          callable[name] = true;
          queueFlow(name);
        });
      });

      while (flowQueue.length) {
        var name = flowQueue.shift();
        (flowByName[name] || []).forEach(function (e) { readFlow(e.flow, e.kind, callable[name]); });
      }

      function readFlow(f, kind, isCallable) {
        var act = f.activity;
        var withRights = kind === 'nanoflow' || f.applyEntityAccess === true;
        var where = { via: kind, name: f.qualifiedName };
        if (withRights && act) {
          (act.retrieves || []).forEach(function (r) {
            use(r.entity, r.over === 'association' ? 'association' : (r.xpath ? 'xpath' : 'all'),
              Object.assign({ xpath: r.xpath || null }, where));
          });
          // A flow read before retrieves were recorded still names what it
          // reads: a use of unknown extent, so it counts as one that narrows.
          if (!act.retrieves) (act.reads || []).forEach(function (qn) { use(qn, 'mention', where); });
          [act.creates, act.changes, act.deletes, act.commits].forEach(function (list) {
            (list || []).forEach(function (qn) { use(qn, 'mention', where); });
          });
        }
        if (withRights || isCallable) {
          (f.parameters || []).forEach(function (param) {
            use(param.entityQualifiedName, 'parameter', Object.assign({ parameter: param.name }, where));
          });
          entitiesIn(f.returnType, entityByName).forEach(function (qn) { use(qn, 'microflow', where); });
        }
        if (act) (act.calls || []).forEach(queueFlow);
      }

      return uses;
    }
  }

  // "2 over an association · 1 with an XPath": how the uses narrow, counted.
  var HOW_TEXT = {
    all: ['lists every row', 'list every row'],
    xpath: ['with an XPath', 'with an XPath'],
    association: ['over an association', 'over an association'],
    context: ['the object a page was given', 'objects a page was given'],
    microflow: ['handed over by a flow', 'handed over by a flow'],
    parameter: ['a flow parameter', 'flow parameters'],
    mention: ['named on a page or in a flow', 'named on a page or in a flow']
  };
  function summary(uses) {
    var counts = {};
    uses.forEach(function (u) { counts[u.how] = (counts[u.how] || 0) + 1; });
    return HOW.filter(function (h) { return counts[h]; }).map(function (h) {
      return counts[h] + ' ' + HOW_TEXT[h][counts[h] === 1 ? 0 : 1];
    }).join(' · ');
  }

  window.MxAccessUse = { analyse: analyse, summary: summary, grantsRead: grantsRead, HOW: HOW };
})();
