/* MxScout — the App Explorer: the project as its own tree.
 *
 * Every other browsing view here answers "show me all the X". This one answers
 * the question those cannot: where does this thing LIVE, and what else lives
 * next to it. A Mendix team builds that answer deliberately — 1,643 folders
 * across the four projects measured for this, with names like `_USE_ME`,
 * `Deprecated`, `ver 1.2` — and until now MxScout read the folder, used it to
 * work out which module a document belonged to, and threw the name away.
 *
 * It is also the only view that shows a document whose insides MxScout does
 * NOT model. 29 kinds in one measured project, 3 of them modelled; a snippet,
 * a Java action, a constant or a layout was simply absent from this tool, and
 * absent looks exactly like not in the project. Here it is a row with its kind
 * on it and nothing to click, which is a true answer instead of no answer.
 *
 * WHAT IT DOES NOT DO. It does not rename, move, create or delete anything.
 * MxScout never writes a .mpr (public/bson.js has no encoder, on purpose), so
 * a tree that offered to reorganise a project would be offering something it
 * cannot deliver. Karol's ask was "management like in Mendix — modules,
 * folders, actions"; this is the half of that which can be true today, and the
 * editing half belongs to the tool on the other side of the handover file.
 *
 * One object on window, one init(), no reaching into app.js's internals —
 * same contract as every other file here.
 */
(function () {
  'use strict';

  var el = null;
  var state = null;
  var render = null;
  var moduleShown = null;
  var withMod = null;
  var peekObject = null;
  var scopeToModule = null;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    render = deps.render;
    moduleShown = deps.moduleShown;
    withMod = deps.withMod;
    peekObject = deps.peekObject;
    scopeToModule = deps.scopeToModule;
  }

  // Which sections of the app can open a document of this kind. A kind that is
  // not here gets a row that is plainly text: MxScout read its name and what
  // it mentions, and has nothing else to show. Offering a dead link instead
  // would be the worse half of both options.
  var OPENS_IN = {
    'Microflows$Microflow': 'microflows',
    'Microflows$Nanoflow': 'nanoflows',
    'Forms$Page': 'pages'
  };

  // A node's identity, used only as a key for "is this one open". JSON rather
  // than a joined string for the same reason paths are lists in the model: a
  // folder name can contain any character a person can type, so no separator
  // is safe. Nothing reads these keys apart from the open/closed map.
  function keyOf(moduleName, path) {
    return JSON.stringify([moduleName].concat(path || []));
  }

  function explorerState() {
    if (!state.detail.explorer) state.detail.explorer = { open: {} };
    return state.detail.explorer;
  }

  function isOpen(key) {
    return explorerState().open[key] === true;
  }

  function toggle(key) {
    var open = explorerState().open;
    if (open[key]) delete open[key]; else open[key] = true;
    render();
  }

  // Deliberately WIDER than app.js's passesFilter, which matches a name, a
  // qualified name and a module. Here the folder path and the kind are part of
  // what is on screen, so they are part of what a search means: typing "Stats"
  // when that is a folder name, or "java" when that is a kind, has an obvious
  // intent and the shared rule would answer nothing.
  function matches(doc, query) {
    if (!query) return true;
    var hay = (doc.name + ' ' + doc.qualifiedName + ' ' + (doc.kind || '') + ' ' +
      (doc.path || []).join(' ')).toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  function pathStartsWith(path, prefix) {
    if (path.length < prefix.length) return false;
    for (var i = 0; i < prefix.length; i++) if (path[i] !== prefix[i]) return false;
    return true;
  }

  function countBeneath(docs, path) {
    var n = 0;
    for (var i = 0; i < docs.length; i++) if (pathStartsWith(docs[i].path || [], path)) n++;
    return n;
  }

  function chevron(open) {
    return el('span', { class: 'ex-chev' + (open ? ' open' : ''), text: '›' });
  }

  function countLabel(n, noun) {
    return n + ' ' + noun + (n === 1 ? '' : 's');
  }

  // One row per document. Clickable only for the three kinds that have a
  // window to open; the rest say what they are and say, on hover, exactly how
  // far MxScout read them — which is the honest version of a row that does
  // nothing when clicked.
  function documentRow(doc, depth) {
    var section = OPENS_IN[doc.type] || null;
    var children = [
      el('span', { class: 'ex-name', text: doc.name }),
      el('span', { class: 'ex-kind', text: doc.kind || '' })
    ];
    if (!section) {
      var row = el('div', { class: 'ex-row ex-doc ex-doc-flat', title: 'MxScout read this document’s name and the flows and pages it mentions. ' +
        'It does not model what is inside a ' + (doc.kind || 'document') + ', so there is nothing to open.' }, children);
      row.style.setProperty('--ex-depth', String(depth));
      return row;
    }
    var button = el('button', {
      class: 'ex-row ex-doc', title: 'Open ' + doc.qualifiedName,
      onclick: function () { peekObject(section, doc); }
    }, children);
    button.style.setProperty('--ex-depth', String(depth));
    return button;
  }

  function childFolders(folders, path) {
    return folders.filter(function (f) {
      return (f.path || []).length === path.length && pathStartsWith(f.path || [], path);
    });
  }

  function folderRow(moduleName, folder, depth, folders, docs, forceOpen) {
    var path = (folder.path || []).concat([folder.name]);
    var key = keyOf(moduleName, path);
    var total = countBeneath(docs, path);
    // Nothing underneath means no chevron and nothing to click. An empty
    // folder is not a mistake and is not hidden — in every project measured
    // some of them are a note, `#v1.0.0` being how a team records which
    // version of a Marketplace module it took — but a disclosure arrow on a
    // row that discloses nothing is a promise the row cannot keep.
    var hasChildren = total > 0 || childFolders(folders, path).length > 0;
    var open = hasChildren && (forceOpen || isOpen(key));
    var parts = [
      hasChildren ? chevron(open) : el('span', { class: 'ex-chev' }),
      el('span', { class: 'ex-name', text: folder.name }),
      el('span', { class: 'ex-count', text: total ? countLabel(total, 'document') : 'empty' })
    ];
    var row = hasChildren
      ? el('button', { class: 'ex-row ex-folder' + (open ? ' open' : ''), onclick: function () { toggle(key); } }, parts)
      : el('div', { class: 'ex-row ex-folder ex-folder-empty' }, parts);
    row.style.setProperty('--ex-depth', String(depth));
    return { row: row, open: open, path: path };
  }

  // Everything directly inside one folder path, folders before documents and
  // each alphabetical — Studio Pro's own order, and the one a person reading a
  // tree expects. The model already arrives sorted (MxMpr's treeOrder), so
  // this only has to pick out the level.
  function levelOf(moduleName, path, folders, docs, query, forceOpen, depth) {
    var out = [];
    childFolders(folders, path).forEach(function (folder) {
      var here = folderRow(moduleName, folder, depth, folders, docs, forceOpen);
      // A folder with nothing matching the filter under it is not drawn at all
      // — the alternative is a tree of empty folders with one leaf somewhere.
      if (query && !countBeneath(docs, here.path)) return;
      out.push(here.row);
      if (here.open) {
        levelOf(moduleName, here.path, folders, docs, query, forceOpen, depth + 1)
          .forEach(function (node) { out.push(node); });
      }
    });
    docs.filter(function (d) {
      return (d.path || []).length === path.length && pathStartsWith(d.path || [], path);
    }).forEach(function (doc) { out.push(documentRow(doc, depth)); });
    return out;
  }

  function moduleNode(moduleName, folders, docs, query, entityCount) {
    var key = keyOf(moduleName, []);
    // A filter is a search, and a search that leaves you to open 52 modules by
    // hand is not one. Typing anything opens whatever still has something in
    // it; clearing it puts every module back the way it was.
    var forceOpen = !!query;
    var open = forceOpen || isOpen(key);
    var head = el('button', {
      class: 'ex-row ex-module' + (open ? ' open' : ''),
      onclick: function () { toggle(key); }
    }, [
      chevron(open),
      el('span', { class: 'ex-name', text: moduleName }),
      el('span', { class: 'ex-count', text: countLabel(docs.length, 'document') })
    ]);
    head.style.setProperty('--ex-depth', '0');

    var rows = [head];
    if (open) {
      // The domain model is a module's first child in Studio Pro too, and it
      // is the one child here that is not a document in the tree: MxScout
      // models entities on their own screen, so this row goes there with the
      // module already picked rather than pretending to be a document.
      var dm = el('button', {
        class: 'ex-row ex-domain', title: 'Show this module’s entities',
        onclick: function () { scopeToModule(moduleName, 'entities'); }
      }, [
        el('span', { class: 'ex-name', text: 'Domain model' }),
        el('span', { class: 'ex-count', text: entityCount + (entityCount === 1 ? ' entity' : ' entities') })
      ]);
      dm.style.setProperty('--ex-depth', '1');
      rows.push(dm);
      levelOf(moduleName, [], folders, docs, query, forceOpen, 1)
        .forEach(function (node) { rows.push(node); });
    }
    return withMod(el('div', { class: 'ex-module-block' }, rows), moduleName);
  }

  function renderPanel(model) {
    var documents = model.documents || [];
    var folders = model.folders || [];
    // A model with no tree is not an error: a JSON import, a .mxscout package
    // made before this existed, or any model built by an older MxScout. Saying
    // which, and what to do about it, beats an empty screen that reads as "this
    // project has nothing in it".
    if (!documents.length) {
      return el('div', { class: 'empty' }, [
        el('p', { text: 'This project’s model does not carry the project tree.' }),
        el('p', { class: 'hint', text: 'It was built before MxScout read folders, or imported from a model JSON that has no tree in it. ' +
          'Re-import the Mendix project folder (Replace model…) and the modules, folders and documents appear here.' })
      ]);
    }

    var query = (state.detail.filter || '').trim().toLowerCase();
    var shown = documents.filter(function (d) { return moduleShown(d.module) && matches(d, query); });
    var byModule = {};
    shown.forEach(function (d) { (byModule[d.module] = byModule[d.module] || []).push(d); });
    var entityCounts = {};
    (model.entities || []).forEach(function (e) {
      entityCounts[e.module] = (entityCounts[e.module] || 0) + 1;
    });

    // Every module that is on screen, including one whose documents the filter
    // removed entirely ONLY when nothing is being filtered — an empty module is
    // a fact about the project, an empty search result is noise.
    var names = (model.modules || []).map(function (m) { return m.name; })
      .filter(function (name) {
        if (!moduleShown(name)) return false;
        return query ? !!byModule[name] : true;
      })
      .sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });

    if (!names.length) {
      return el('div', { class: 'empty' }, [el('p', { text: 'Nothing in this project matches the current filter.' })]);
    }

    // Two different sentences, because under a filter the only honest numbers
    // are about what matched. Counting the project's folders while showing one
    // of them says the wrong thing in the one place a reader is checking
    // whether the search found everything.
    var head = el('p', { class: 'hint ex-hint', text: query
      ? shown.length + ' of ' + documents.length + ' documents match, in ' +
        names.length + ' ' + (names.length === 1 ? 'module' : 'modules') + '.'
      : countLabel(shown.length, 'document') + ' in ' +
        countLabel(names.length, 'module') + ' and ' +
        countLabel(folders.filter(function (f) { return moduleShown(f.module); }).length, 'folder') +
        '. Folders, and which document sits in which, are the project’s own — read from the file, not arranged here.' });

    return el('div', { class: 'ex-tree' }, [head].concat(names.map(function (name) {
      var docs = byModule[name] || [];
      var mine = folders.filter(function (f) { return f.module === name; });
      return moduleNode(name, mine, docs, query, entityCounts[name] || 0);
    })));
  }

  window.MxExplorer = { init: init, renderPanel: renderPanel };
})();
