/* MxScout — the Security section: how this app is secured, as the project
 * itself records it.
 *
 * Every other browsing view answers "what can this role reach". This one
 * answers the question underneath that: whether the running app enforces any
 * of it, and who the roles are in the first place. Both come out of one
 * document in the .mpr — the project's Security screen — plus the per-module
 * role lists, and MxScout read neither until this existed: it showed a
 * role-by-role access picture without ever saying whether the app checks it.
 *
 * A project whose SecurityLevel is CheckNothing has an access matrix that is
 * real in the model and inert at run time. Saying that out loud, at the top,
 * is the difference between a true picture and a plausible one.
 *
 * THREE REGISTERS, and they are the whole readability argument. Karol,
 * 2026-09-14: "trochę mi się one zlewają". They did, because MxScout already
 * made this distinction in its words and nowhere in its typography — a
 * settings row and a real finding had the same geometry, and one grey badge
 * carried five different meanings. So everything this section says is now
 * exactly one of:
 *
 *   FINDING     — MxScout concluded it and somebody should act. Rare on
 *                 purpose: a weak password, a security level that enforces
 *                 nothing, a user role that unlocks no module at all.
 *   WORTH KNOWING — true, and quite possibly deliberate. Anonymous access,
 *                 a role that can hand out every other role, a service with
 *                 nothing in front of it (an OIDC callback MUST be reachable
 *                 before anyone is signed in). Marked, never alarmed.
 *   NOT CHECKED — MxScout could not follow it and says so instead of
 *                 implying it did. Row-level rules through the System module,
 *                 steps that are not in this model, settings the model does
 *                 not carry.
 *
 * What this deliberately is NOT is a score. There is no number that ranks a
 * project, because inventing severity is the one thing a security tool cannot
 * do and keep its reader — a service with nothing gating it is a finding in
 * one project and the login flow in the next. The band at the top orders what
 * was found; it does not grade it.
 *
 * SECRETS: this renders what MxScout CONCLUDED about a password, never the
 * password. The model carries the admin password and every demo user's
 * password in plain text; the reader opens them in the Worker, judges them
 * against this project's own password policy and a short list of passwords
 * that need no cracking, then keeps the verdict and drops the value (see
 * judgePassword in mpr.js). So there is nothing here to leak into a .mxscout
 * package and nothing to print into a report — and the finding survives at
 * full strength, because "set" is hygiene while "set, and shorter than the
 * twelve characters this app demands of its own users" is the thing somebody
 * needs to act on.
 *
 * Model shape read here, all of it optional — a model exported from MxSonar,
 * or imported before this existed, simply has none of it and says so rather
 * than claiming the app is unsecured:
 *   model.security     = { level, checkSecurity, strictMode, strictPageUrlCheck,
 *                          guestAccess, guestUserRole, demoUsersEnabled,
 *                          demoUsers[], adminUserName, adminUserRole,
 *                          adminPassword, passwordPolicy }
 *   a password         = { set, length|null, failsPolicy[], common, sameAsUserName }
 *                          — what MxScout concluded, never the password
 *   model.userRoles[]  = { name, moduleRoles[], manageAllRoles, manageableRoles[] }
 *   model.moduleRoles[]= { module, name, qualifiedName, description }
 *   model.publishedServices[] = { kind, module, name, qualifiedName, path,
 *                          version, allowedModuleRoles[]|null, authentication[],
 *                          authenticationMicroflow, exposes[] }
 *   model.automation[] = { kind, module, name, qualifiedName, enabled,
 *                          microflow, schedule, timeZone, parallelism }
 */
(function () {
  'use strict';

  var el, state, moduleColor, withMod, peekObject;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    moduleColor = deps.moduleColor;
    withMod = deps.withMod;
    peekObject = deps.peekObject;
  }

  // ---------- the three security levels, in the words Studio Pro uses ----
  // The enum value in the file, the Security screen's own label, and what it
  // actually means for everything else MxScout shows.
  var LEVELS = {
    CheckNothing: {
      label: 'Off',
      tone: 'bad',
      means: 'The running app enforces none of this. Every role reaches everything, whatever the rules below say.'
    },
    CheckFormsAndMicroflows: {
      label: 'Prototype',
      tone: 'warn',
      means: 'The running app checks pages and microflows, but not entity access. Who can open what is enforced; which rows and fields they then see is not.'
    },
    CheckEverything: {
      label: 'Production',
      tone: 'ok',
      means: 'The running app checks pages, microflows and entity access — the picture in the other views is the one it enforces.'
    }
  };
  function levelOf(security) {
    return (security && LEVELS[security.level]) || null;
  }

  // The banner that belongs at the top of every role-filtered view, not on
  // this page: if the app does not enforce the access rules, a role filter
  // showing "Manager can read Order" is describing an intention, not a
  // behaviour. Returns null for the Production case, which is the one that
  // needs no caveat, and for a model that has no security document to read.
  //
  // The Security section does NOT use this — its own band says the same thing
  // as a verdict line, and two banners stacked was one of the things that
  // made this page read as noise.
  function renderLevelWarning(model) {
    var security = model && model.security;
    var level = levelOf(security);
    if (!level || level.tone === 'ok') return null;
    return el('div', { class: 'sec-banner sec-' + level.tone }, [
      el('strong', { text: 'Security is ' + level.label + ' in this project.' }),
      el('span', { text: ' ' + level.means })
    ]);
  }

  // ---------- the three marks ----------
  // One shape per register, used here AND in the access matrix, so a mark
  // means the same thing wherever the reader meets it.
  function mark(kind, text, title) {
    var node = el('span', { class: 'mark mark-' + kind, text: text });
    if (title) node.setAttribute('title', title);
    return node;
  }
  function markNote(text, title) { return mark('note', text, title); }
  function markUnchecked(text, title) { return mark('unchecked', text, title); }

  // ---------- small display helpers ----------
  function onOff(value, onText, offText) {
    if (value === null || value === undefined) return markUnchecked('not recorded', 'This model does not carry the setting.');
    return el('span', { class: value ? 'sec-on' : 'sec-off', text: value ? onText : offText });
  }
  function row(key, valueNode, note) {
    return el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: key }),
      el('span', { class: 'kv-val' }, [valueNode, note ? el('span', { class: 'muted sec-note', text: note }) : null].filter(Boolean))
    ]);
  }

  // ---------- what was concluded about a password ----------
  // MxScout reads a password once, in the Worker, to judge it, and keeps only
  // the judgement (see judgePassword in mpr.js). So there is never a value to
  // show here — and the verdict is the more useful half anyway: "set" is
  // hygiene, "set, and shorter than the twelve characters this project
  // demands of its own users" is a finding.
  //
  // `reason` is the same sentence without the standing disclaimer about how
  // MxScout knows. That disclaimer is now said ONCE per card instead of once
  // per account — it was true every time and told the reader nothing new
  // after the first.
  //
  // A model from before this was read carries the old boolean instead, so
  // that is normalised rather than rendered as "no password".
  function passwordVerdict(judgement, legacyBoolean) {
    if (!judgement) {
      if (legacyBoolean) return { weak: false, text: 'set, in plain text', reason: null };
      return { weak: false, tone: 'muted', text: 'none', reason: null };
    }
    var reasons = (judgement.failsPolicy || []).slice();
    if (judgement.common) reasons.unshift('one of the most common passwords there are');
    if (judgement.sameAsUserName) reasons.unshift('the same as the user name');
    if (!reasons.length) {
      return { weak: false, text: 'set, in plain text', reason: 'It meets this project’s own password policy.' };
    }
    var length = typeof judgement.length === 'number' ? judgement.length + ' character' + (judgement.length === 1 ? '' : 's') + ', ' : '';
    return { weak: true, text: 'set, in plain text — weak', reason: length + reasons.join('; ') + '.' };
  }
  function passwordNode(verdict) {
    return el('span', { class: verdict.weak ? 'sec-weak' : (verdict.tone || 'sec-off'), text: verdict.text });
  }

  function passwordPolicyText(policy) {
    if (!policy) return null;
    var parts = [];
    if (typeof policy.minimumLength === 'number') parts.push(policy.minimumLength + ' characters minimum');
    if (policy.requireDigit) parts.push('a digit');
    if (policy.requireMixedCase) parts.push('mixed case');
    if (policy.requireSymbol) parts.push('a symbol');
    return parts.length ? parts.join(', ') : 'nothing required';
  }

  // ---------- what this project actually turned up ----------
  // One pass over the model that decides, for every register, what belongs in
  // it. The cards below render the same facts in place; this is what decides
  // which of them the reader is told about before they start scrolling.
  //
  // The rule for the FINDING list is narrow on purpose: MxScout has to have
  // concluded it from the model, and it has to be something somebody would
  // change. Everything that might be deliberate goes to "worth knowing" and
  // is marked where it lives, not promoted here.
  function collect(model) {
    var s = model.security;
    var findings = [], noted = [];

    // --- the verdict: the one statement everything else hangs off ---
    var level = levelOf(s);
    var verdict;
    if (!level) {
      verdict = { tone: 'unchecked', label: 'Not recorded',
        means: 'This model does not carry the project’s security settings, so MxScout cannot say whether the app enforces any of the rules below.' };
    } else {
      verdict = { tone: level.tone, label: level.label, means: level.means };
      // Off and Prototype are findings in their own right: they make every
      // other view in MxScout a statement of intent rather than of behaviour.
      if (level.tone !== 'ok') {
        findings.push({ text: 'Security is ' + level.label + ' — ' +
          (level.tone === 'bad' ? 'the running app enforces none of these rules.'
                                : 'the running app does not check entity access.') });
      }
    }

    if (s) {
      // --- passwords, the one place MxScout judged rather than read ---
      // The administrator password is not a finding (Karol, 2026-10-15): the one in the project is used only when
      // the app runs locally from Studio Pro; every other environment sets its own. The settings below still show it.
      (s.demoUsers || []).forEach(function (u) {
        var v = passwordVerdict(u.password, u.passwordSet);
        if (v.weak) findings.push({ text: 'Demo account ' + u.userName + ' has a weak password — ' + v.reason });
      });

      if (s.guestAccess) {
        noted.push(s.guestUserRole
          ? 'Anonymous visitors are let in as "' + s.guestUserRole + '".'
          : 'Anonymous access is on, but no role is named for it.');
      }
      if (s.strictMode === false) noted.push('Strict mode is off — access rights resolve the older, more permissive way.');
      if (s.strictPageUrlCheck === false) noted.push('Page URLs are not checked strictly.');
    }

    // --- roles that cannot do what a role is for ---
    (model.userRoles || []).forEach(function (r) {
      if (!(r.moduleRoles || []).length) {
        findings.push({ text: 'User role "' + r.name + '" carries no module role — somebody given it can sign in and reach nothing.' });
      }
      if (r.manageAllRoles) noted.push('"' + r.name + '" can assign every other role, including roles above its own.');
    });

    // --- services with nothing in front of them ---
    (model.publishedServices || []).forEach(function (svc) {
      var open = Array.isArray(svc.allowedModuleRoles) && !svc.allowedModuleRoles.length &&
        !(svc.authentication || []).length && !svc.authenticationMicroflow;
      if (open) noted.push(svc.name + ' (' + svc.kind + ') has no role list and no authentication.');
    });

    return { verdict: verdict, findings: findings, noted: noted };
  }

  // ---------- entity access against what uses it ----------
  // Measured on the WHOLE model, Marketplace modules included, and reported
  // only for the entities this view shows: a page in a hidden module still
  // uses an entity, and leaving it out would report that entity as unused.
  var accessUseCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function accessUseOf(model) {
    if (!window.MxAccessUse) return null;
    var whole = (state && state.detail && state.detail.rawModel) || model;
    var visible = new Set((model.entities || []).map(function (e) { return e.qualifiedName; }));
    var cached = accessUseCache && accessUseCache.get(model);
    if (cached && cached.whole === whole) return cached.result;
    var result = window.MxAccessUse.analyse(whole, { visible: visible });
    // Per entity, not per user role: one entity read too widely by six user
    // roles is one thing to look at, not six.
    result.widerByEntity = byEntity(result.wider);
    result.unusedByEntity = byEntity(result.unused);
    result.unwrittenByEntity = byEntity(result.unwritten);
    // A missing create, write or delete right makes the step fail; a missing
    // read makes a retrieve find nothing. Only the first is a fault.
    result.failing = result.cannotDo.filter(function (f) { return f.items.some(function (i) { return i.what !== 'read'; }); }).length;
    if (accessUseCache) accessUseCache.set(model, { whole: whole, result: result });
    return result;
  }
  function byEntity(items) {
    var map = {}, order = [];
    items.forEach(function (item) {
      if (!map[item.entity]) { map[item.entity] = { entity: item.entity, name: item.name, module: item.module, items: [] }; order.push(item.entity); }
      map[item.entity].items.push(item);
    });
    return order.sort().map(function (qn) { return map[qn]; });
  }

  function strictSentence(model) {
    var strict = model.security ? model.security.strictMode : null;
    if (strict === true) {
      return 'Strict mode is on in this project, so the client cannot ask for data the pages do not define. The rule is still what holds the moment a new page, a nanoflow or a microflow with entity access reads this entity.';
    }
    if (strict === false) {
      return 'Strict mode is off in this project, so anyone signed in with the role can ask the app directly for every row the rule allows, whatever the pages show.';
    }
    return 'Whether strict mode is on is not recorded in this model. With it off, anyone signed in with the role can ask the app directly for every row the rule allows, whatever the pages show.';
  }

  // ---------- entity access, told at the entity ----------
  // Karol, 2026-10-13: the Security page shows the app's technical settings,
  // not entities and microflows. What the analysis above finds about an
  // entity is said in that entity's Access window on the Domain model, by the
  // rule it is about: one module role's rule, and the user roles that carry
  // it. Plain data here — the Domain model draws it.
  var WHAT = { read: 'reads', create: 'creates', write: 'changes', del: 'deletes', 'delete': 'deletes' };
  function accessNotes(model, entityQn, moduleRole) {
    var au = accessUseOf(model);
    var carriers = (model.userRoles || []).filter(function (u) { return (u.moduleRoles || []).indexOf(moduleRole) !== -1; }).map(function (u) { return u.name; });
    function carries(userRole) { return carriers.indexOf(userRole) !== -1; }
    var out = [];
    if (au) {
      au.wider.forEach(function (i) {
        if (i.entity !== entityQn || i.openRoles.indexOf(moduleRole) === -1) return;
        out.push({ tone: 'note', title: 'Reads every row, sees fewer',
          text: 'This rule has no XPath, so ' + i.userRole + ' may read every row of ' + i.name + '. Nothing it reaches lists them all — ' + window.MxAccessUse.summary(i.uses) + '. ' + strictSentence(model),
          places: i.uses.filter(function (u) { return u.how !== 'mention'; }).slice(0, 8).map(function (u) { return u.via + ' ' + u.name + (u.widget ? ' · ' + u.widget : '') + (u.xpath ? '  ' + u.xpath : ''); }) });
      });
      au.unused.forEach(function (i) {
        if (i.entity !== entityQn || i.moduleRoles.indexOf(moduleRole) === -1) return;
        out.push({ tone: 'note', title: 'Granted, never used',
          text: i.userRole + ' holds this rule, and nothing it can reach shows, reads, takes or returns ' + i.name + '. Possibly deliberate: a Java action or a published OData service, which MxScout does not follow, may use it.' });
      });
      au.unwritten.forEach(function (i) {
        if (i.entity !== entityQn || !carries(i.userRole)) return;
        var parts = [];
        if (i.attributes.length) parts.push('write ' + i.attributes.join(', '));
        if (i.create) parts.push('create');
        if (i.del) parts.push('delete');
        out.push({ tone: 'note', title: 'May write, nothing writes',
          text: i.userRole + ' may ' + parts.join(' · ') + ', and nothing it reaches does: no input on its pages, no New or Delete button, no flow that runs with its rights.' });
      });
      [[au.cannotDo, true], [au.pastAccess, false]].forEach(function (pair) {
        pair[0].forEach(function (f) {
          f.items.forEach(function (i) {
            if (i.entity !== entityQn) return;
            var who = i.userRoles.filter(carries);
            if (!who.length) return;
            var failing = pair[1], bad = failing && i.what !== 'read';
            out.push({ tone: bad ? 'find' : 'note',
              title: failing ? 'May run it, may not do what it does' : 'Does for a role what its rules do not allow',
              text: (f.kind === 'nanoflow' ? 'Nanoflow ' : 'Microflow ') + f.flow + ' ' + (WHAT[i.what] || i.what) + ' ' + i.entity + (i.members ? ' (' + i.members.join(', ') + ')' : '') + ' for ' + who.join(', ') +
                (failing ? (i.what === 'read' ? ' — with no rule to read it, so it finds nothing.' : ' — without the right, so it fails for them.') : ', which their own rules do not allow. Usually deliberate: a microflow is the controlled way to let a role do it.') });
          });
        });
      });
    }
    window.MxAccessRule.unfollowed(model).forEach(function (u) {
      if (u.qualifiedName !== entityQn || u.moduleRole !== moduleRole) return;
      out.push({ tone: 'unchecked', title: 'Not followed', text: u.label + (u.title ? ' — ' + u.title : '') });
    });
    return out;
  }
  // How many entities have something to say, for the band.
  function accessNoteCount(model) {
    var au = accessUseOf(model), seen = {};
    if (au) {
      au.wider.concat(au.unused, au.unwritten).forEach(function (i) { seen[i.entity] = true; });
      au.cannotDo.concat(au.pastAccess).forEach(function (f) { f.items.forEach(function (i) { seen[i.entity] = true; }); });
    }
    window.MxAccessRule.unfollowed(model).forEach(function (u) { seen[u.qualifiedName] = true; });
    var visible = {};
    (model.entities || []).forEach(function (e) { visible[e.qualifiedName] = true; });
    return Object.keys(seen).filter(function (q) { return visible[q]; }).length;
  }

  // ---------- the band ----------
  // What was found, before the reader starts scrolling. The verdict is a
  // sentence, the findings are one line each, and the rules MxScout could not
  // follow are one line each and clickable — they land in the entity that
  // holds them, which is the only place the rule itself can be read.
  function bandBlock(model, found) {
    // The redesign (Karol, 2026-10-14: "carry on with Security"): the
    // settings as tiles across the top — the level first, the rest each a
    // switch and what it means — then what to act on, one line each. The
    // level is said once, in its tile.
    var s = model.security, level = levelOf(s);
    function tile(label, value, tone, note) {
      return el('div', { class: 'sec-tile' + (tone ? ' ' + tone : '') }, [
        el('span', { class: 'sec-tile-k', text: label }),
        el('span', { class: 'sec-tile-v' }, [value]),
        note ? el('span', { class: 'sec-tile-n', text: note }) : null
      ].filter(Boolean));
    }
    function sw(value, on, off) { return value === null || value === undefined ? markUnchecked('not recorded', 'This model does not carry the setting.') : el('span', { text: value ? on : off }); }
    var tiles = [tile('Security level', el('span', { text: found.verdict.label }), 'sec-' + found.verdict.tone, found.verdict.means)];
    if (s) {
      var policy = passwordPolicyText(s.passwordPolicy);
      tiles.push(
        tile('Anonymous access', sw(s.guestAccess, 'On', 'Off'), s.guestAccess ? 'sec-warn' : null,
          s.guestAccess ? (s.guestUserRole ? 'Someone who has not signed in gets the "' + s.guestUserRole + '" role.' : 'On, but no role is named for it.') : 'Everything requires a sign-in.'),
        tile('Strict mode', sw(s.strictMode, 'On', 'Off'), s.strictMode === false ? 'sec-warn' : null,
          s.strictMode === false ? 'Access rights are resolved the older, more permissive way.' : s.strictMode ? 'The client asks only for what the pages define.' : null),
        tile('Page URL check', sw(s.strictPageUrlCheck, 'On', 'Off'), s.strictPageUrlCheck === false ? 'sec-warn' : null,
          s.strictPageUrlCheck === false ? 'Page URLs are not checked strictly.' : s.strictPageUrlCheck ? 'A page opened by its URL is checked like any other.' : null),
        tile('Password policy', policy ? el('span', { text: policy }) : markUnchecked('not recorded', 'This model does not carry the password policy, so MxScout had nothing to measure a password against.'), null, null)
      );
    }
    var kids = [el('div', { class: 'sec-tiles' }, tiles)];
    var nNotes = accessNoteCount(model);
    var acts = [];
    if (found.findings.length) {
      acts.push(el('div', { class: 'sec-act-h' }, [el('h3', { class: 'xe-caps' }, [el('span', { text: 'To act on' }), el('span', { class: 'xe-caps-n', text: ' ' + found.findings.length })]),
        found.noted.length ? el('span', { class: 'sec-counts', text: found.noted.length + ' more worth knowing, marked below' }) : null]));
      acts.push(el('ul', { class: 'sec-found' }, found.findings.map(function (f) {
        return el('li', {}, [mark('find', '!'), el('span', { text: f.text })]);
      })));
    }
    // Entity access is told at each entity (its Access window on the Domain
    // model), not listed here; this says how many have something to say.
    if (nNotes) acts.push(el('p', { class: 'sec-au-line' }, [
      markNote(nNotes + ' entit' + (nNotes === 1 ? 'y' : 'ies'), 'Entity access set against what uses it, and rules MxScout could not follow'),
      el('span', { text: ' ' + (nNotes === 1 ? 'has' : 'have') + ' notes on their access rules — open the entity on the Domain model and its rule’s checks.' })
    ]));
    if (!found.findings.length && !nNotes) {
      acts.push(el('p', { class: 'sec-nothing', text: found.noted.length
        ? 'Nothing here to act on. What is marked below is worth knowing, and may well be deliberate.'
        : 'Nothing here to act on.' }));
    }
    kids.push(el('div', { class: 'sec-acts' + (found.findings.length ? ' has' : '') }, acts));
    return el('div', { class: 'sec-band sec-band-' + found.verdict.tone }, kids);
  }

  // ---------- how the app is secured ----------
  function settingsBlock(model, found) {
    // The accounts the project carries; its switches are the tiles above.
    var s = model.security;
    var rows = [];
    // The administrator account, and — as a fact, never as a value — whether
    // its password is sitting in the project file in plain text.
    var adminBits = [];
    if (s.adminUserName) adminBits.push(s.adminUserName);
    if (s.adminUserRole) adminBits.push('role ' + s.adminUserRole);
    // Its password is shown as set or not, never judged: only a local run from Studio Pro uses it.
    var adminPassword = passwordVerdict(s.adminPassword, s.adminPasswordSet);
    var adminSet = adminPassword.text !== 'none';
    rows.push(row('Administrator',
      el('span', {}, [
        adminBits.length ? el('span', { text: adminBits.join(' · ') + ' · ' }) : el('span', { class: 'muted', text: 'not recorded · ' }),
        el('span', { class: adminSet ? 'sec-off' : 'muted', text: adminSet ? 'password set, for local runs' : 'no password' })
      ]),
      'Used only when the app runs locally from Studio Pro; every other environment sets its own administrator password, so MxScout does not judge it.'));
    var demo = s.demoUsers || [];
    rows.push(row('Demo users',
      onOff(s.demoUsersEnabled, 'On', 'Off'),
      demo.length
        ? demo.length + ' account' + (demo.length === 1 ? '' : 's') + ' in the model, with passwords in plain text.'
        : (s.demoUsersEnabled ? 'Switched on, but no accounts are defined.' : null)));
    var kids = [el('div', { class: 'kv' }, rows)];
    if (demo.length) {
      kids.push(el('div', { class: 'sec-sub' }, [
        el('h4', { text: 'Demo accounts' }),
        el('table', { class: 'sec-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'User name' }), el('th', { text: 'Roles' }), el('th', { text: 'Password' })
          ])]),
          el('tbody', {}, demo.map(function (u) {
            var verdict = passwordVerdict(u.password, u.passwordSet);
            return el('tr', {}, [
              el('td', { class: 'mono', text: u.userName }),
              el('td', { text: (u.userRoles || []).join(', ') || '—' }),
              el('td', {}, [
                passwordNode(verdict),
                verdict.reason ? el('span', { class: 'muted sec-note', text: verdict.reason }) : null
              ].filter(Boolean))
            ]);
          }))
        ])
      ]));
    }
    kids.push(el('p', { class: 'hint sec-foot', text: 'Names, roles, and what MxScout concluded about each password. It read them here in the browser to work that out and kept only the conclusion — no password reaches this browser’s database, a package, or a report.' }));
    return card('Accounts', null, kids);
  }

  // A section of the page, as the other screens draw one: its name in
  // capitals, a count when there is one, then what it holds.
  function card(title, n, kids, cls) {
    return el('section', { class: 'card sec-card' + (cls ? ' ' + cls : '') }, [
      el('h3', { class: 'xe-caps sec-card-h' }, [el('span', { text: title }), n === null || n === undefined ? null : el('span', { class: 'xe-caps-n', text: ' ' + n })].filter(Boolean))
    ].concat(kids));
  }

  // ---------- roles ----------
  // One card, not two. They were two tables where the second was a join of
  // the first: "held by nobody" is a statement about the user-role list
  // directly above it, and the reader was being asked to do that join by eye.
  //
  // So a module role no user role carries is no longer a badge — it is a
  // POSITION. It drops out of its module group and into a group of its own at
  // the bottom, which is the one thing about it worth seeing. Karol's call,
  // 2026-09-14.
  function rolesBlock(model) {
    var userRoles = model.userRoles || [];
    var moduleRoles = model.moduleRoles || [];
    if (!userRoles.length && !moduleRoles.length) {
      return card('Roles', null, [el('p', { class: 'muted', text: 'This model has no roles.' })]);
    }

    var guestRole = model.security && model.security.guestAccess ? model.security.guestUserRole : null;

    // Which module roles anybody actually holds, and which ones anything
    // actually names. Both are read from the whole model rather than inferred
    // from one list, which is the reason the module roles are read from each
    // module's own security unit in the first place.
    var held = {};
    userRoles.forEach(function (r) {
      (r.moduleRoles || []).forEach(function (mr) { held[mr] = true; });
    });
    var granted = {};
    (model.entities || []).forEach(function (e) {
      (e.accessRules || []).forEach(function (rule) { if (rule && rule.moduleRole) granted[rule.moduleRole] = true; });
    });
    ['microflows', 'nanoflows', 'pages'].forEach(function (key) {
      (model[key] || []).forEach(function (f) {
        (f.allowedModuleRoles || []).forEach(function (mr) { granted[mr] = true; });
      });
    });

    // A module role is shown once: as a chip in the user role that carries it,
    // with its description on hover. A per-module list under the table named
    // every one of them a second time (Karol, 2026-10-13: "remove everything
    // that repeats").
    var described = {};
    moduleRoles.forEach(function (r) { described[r.qualifiedName] = r.description || ''; });
    function moduleChip(mr) {
      var idle = !granted[mr];
      var chip = el('span', { class: 'chip on' + (idle ? ' sec-idle' : ''), text: mr,
        title: [described[mr] || '', idle ? 'Grants nothing: no access rule, microflow or page names this role' : ''].filter(Boolean).join('\n') || null });
      chip.style.setProperty('--mod', moduleColor(String(mr).split('.')[0]));
      return chip;
    }

    var kids = [
      el('p', { class: 'hint', text: 'A user role is what a person is given. What it unlocks is the module roles it carries — those are what access rules, microflows and pages are actually written against.' })
    ];

    if (userRoles.length) {
      kids.push(el('table', { class: 'sec-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'User role' }), el('th', { text: 'Carries these module roles' })])]),
        el('tbody', {}, userRoles.map(function (r) {
          var mrs = r.moduleRoles || [];
          var flags = [];
          if (guestRole && r.name === guestRole) {
            flags.push(markNote('anonymous', 'Someone who has not signed in is given this role'));
          }
          if (r.manageAllRoles) {
            flags.push(markNote('manages all roles', 'This role can assign every other role, including roles above its own'));
          } else if ((r.manageableRoles || []).length) {
            flags.push(markNote('manages ' + r.manageableRoles.length + ' role' + (r.manageableRoles.length === 1 ? '' : 's'),
              'Can assign: ' + r.manageableRoles.join(', ')));
          }
          return el('tr', {}, [
            el('td', {}, [el('strong', { text: r.name })].concat(flags)),
            el('td', {}, mrs.length
              ? mrs.map(moduleChip)
              : [mark('find', 'unlocks nothing', 'This user role carries no module role, so somebody given it can sign in and reach nothing')])
          ]);
        }))
      ]));
    }

    if (moduleRoles.length) {
      var carried = [], orphans = [];
      moduleRoles.forEach(function (r) { (held[r.qualifiedName] ? carried : orphans).push(r); });

      // A list, not a two-column table. Every module got its own table, each
      // sized to its own content, so the second column started somewhere
      // different in every group — and in a real project nearly every row of
      // that column said "no description". The name leads, a description sits
      // under it when there is one, and a module with none says so once, in
      // its heading, instead of once per role (Karol, 2026-09-16).
      function roleList(list, qualified) {
        return el('ul', { class: 'sec-roles' }, list.map(function (r) {
          return el('li', {}, [
            el('div', {}, [el('strong', { text: qualified ? (r.qualifiedName || r.name) : r.name })].concat(
              granted[r.qualifiedName] ? [] : [markNote('grants nothing', 'No access rule, microflow or page names this role')])),
            r.description ? el('div', { class: 'muted sec-note', text: r.description }) : null
          ].filter(Boolean));
        }));
      }
      function countLabel(list) {
        var described = list.filter(function (r) { return !!r.description; }).length;
        return list.length + ' role' + (list.length === 1 ? '' : 's') +
          (described ? '' : (list.length === 1 ? ' · no description' : ' · none described'));
      }

      if (orphans.length) {
        kids.push(el('div', { class: 'module-group sec-orphans' }, [
          el('div', { class: 'module-group-head' }, [
            el('span', { class: 'module-group-name', text: 'Carried by no user role' }),
            el('span', { class: 'module-group-count', text: countLabel(orphans) })
          ]),
          el('p', { class: 'hint', text: 'These are declared by their module, but no user role carries them — so nobody in this app can ever hold one. Shown as a group rather than as a badge, because where they sit is the fact.' }),
          roleList(orphans, true)
        ]));
      }
    }

    return card('Roles', userRoles.length + ' user · ' + moduleRoles.length + ' module', kids, 'sec-roles-card');
  }

  // ---------- open to the outside ----------
  // The role filter cannot answer this one: a published REST or OData service
  // is reachable by anything that can reach the app, gated by its own role
  // list and its own authentication rather than by the access rules every
  // other view shows. A service with neither is worth seeing plainly — it
  // may be entirely deliberate (an OIDC callback has to be reachable before
  // anybody is signed in), which is exactly why it is marked rather than
  // alarmed.
  function publishedBlock(model) {
    var services = model.publishedServices || [];
    if (!services.length) return null;
    var rows = services.map(function (s) {
      var open = Array.isArray(s.allowedModuleRoles) && !s.allowedModuleRoles.length &&
        !(s.authentication || []).length && !s.authenticationMicroflow;
      var access;
      if (s.allowedModuleRoles === null) {
        // A SOAP service is not gated by roles at all, and printing "no
        // roles" for it would read as "open to everyone".
        access = [el('span', { class: 'muted', text: 'not gated by roles' })];
      } else if (s.allowedModuleRoles.length) {
        access = s.allowedModuleRoles.map(function (mr) {
          var chip = el('span', { class: 'chip on', text: mr });
          chip.style.setProperty('--mod', moduleColor(String(mr).split('.')[0]));
          return chip;
        });
      } else {
        access = [el('span', { class: 'sec-off', text: 'no roles listed' })];
      }
      var auth = (s.authentication || []).slice();
      if (s.authenticationMicroflow) auth.push('microflow ' + s.authenticationMicroflow);
      return el('tr', {}, [
        el('td', {}, [
          el('strong', { text: s.name }),
          el('span', { class: 'muted sec-note', text: s.kind + (s.path ? ' · ' + s.path : '') + (s.version ? ' · v' + s.version : '') }),
          open ? markNote('nothing gates it', 'No role list and no authentication: anything that can reach the app can call this') : null
        ].filter(Boolean)),
        el('td', {}, access),
        el('td', {}, [auth.length
          ? el('span', { text: auth.join(', ') })
          : el('span', { class: 'sec-off', text: 'none' })]),
        el('td', {}, [(s.exposes || []).length
          ? el('div', { class: 'sec-exposes', title: s.exposes.join('\n') }, s.exposes.slice(0, 4).map(function (op) {
              // "POST order → Sales.CancelOrder": the operation, and the
              // microflow behind it as a link.
              // The operation only: which microflow answers it is on the
              // Microflows screen, and this page shows what is open, not code.
              var m = /^(.*?)\s*→\s*(\S+)\s*$/.exec(String(op));
              return el('div', { class: 'mono', text: m ? m[1] : String(op) });
            }).concat(s.exposes.length > 4 ? [el('div', { class: 'muted', text: '+ ' + (s.exposes.length - 4) + ' more' })] : []))
          : el('span', { class: 'muted', text: '—' })])
      ]);
    });
    return card('Open to the outside', services.length, [
      el('p', { class: 'hint', text: 'What this app publishes, and what stands between it and a caller. None of it goes through the access rules the other views show — a published service is gated by its own role list and its own authentication.' }),
      el('table', { class: 'sec-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Service' }), el('th', { text: 'Roles' }),
          el('th', { text: 'Authentication' }), el('th', { text: 'Exposes' })
        ])]),
        el('tbody', {}, rows)
      ])
    ]);
  }

  // ---------- runs without a user ----------
  // A scheduled event executes a microflow on a timer, in no session, as
  // nobody — outside every role in the model and therefore outside every
  // other view in MxScout.
  function automationBlock(model) {
    var items = model.automation || [];
    if (!items.length) return null;
    // What runs first; what is switched off after it, greyed.
    var rows = items.slice().sort(function (a, b) { return (a.enabled === false) - (b.enabled === false); }).map(function (a) {
      var what = [];
      if (a.schedule) what.push(a.schedule);
      if (a.timeZone) what.push(a.timeZone);
      if (a.parallelism) what.push(a.parallelism + ' at a time');
      return el('tr', { class: a.enabled === false ? 'sec-row-off' : null }, [
        el('td', {}, [
          el('strong', { text: a.name }),
          el('span', { class: 'muted sec-note', text: a.kind }),
          a.enabled === false ? markNote('off', 'Defined, but switched off') : null
        ].filter(Boolean)),
        el('td', {}, [what.length
          ? el('span', { text: what.join(' · ') })
          : el('span', { class: 'muted', text: '—' })])
      ]);
    });
    var off = items.filter(function (a) { return a.enabled === false; }).length;
    return card('Runs without a user', off ? items.length + ' · ' + off + ' off' : items.length, [
      el('p', { class: 'hint', text: 'A scheduled event runs a microflow on a timer, in no session and as nobody — outside every role in this model, and so outside every other view here. A queue runs work the same way, handed to it by whatever put it there.' }),
      el('table', { class: 'sec-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Name' }), el('th', { text: 'When' })
        ])]),
        el('tbody', {}, rows)
      ])
    ]);
  }

  // ---------- the section ----------
  function renderPanel(model) {
    if (!model.security && !(model.moduleRoles || []).length &&
        !(model.publishedServices || []).length && !(model.automation || []).length) {
      return el('div', { class: 'empty' }, [
        el('p', { text: 'This model does not carry the project’s security settings.' }),
        el('p', { class: 'muted', text: 'It was imported from a JSON export, or from a project folder before MxScout read them. Replace the model from the Mendix project folder to fill this in — the roles below come from the model either way.' }),
        rolesBlock(model)
      ]);
    }
    var found = collect(model);
    return el('div', { class: 'sec-panel' }, [
      bandBlock(model, found),
      el('div', { class: 'sec-cols' }, [model.security ? settingsBlock(model, found) : null, rolesBlock(model)].filter(Boolean)),
      publishedBlock(model),
      automationBlock(model)
    ].filter(Boolean));
  }

  window.MxSecurity = { init: init, renderPanel: renderPanel, renderLevelWarning: renderLevelWarning, accessNotes: accessNotes };
})();
