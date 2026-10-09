/* MxScout — documentation, the reader.
 *
 * Draws what docs-data.js builds, in MxScout's own look: its mark, its amber,
 * its sidebar; dark and light, the two palettes MxScout itself has, the light one designed on the same
 * rules for whoever reads the exported file in daylight. Every microflow and
 * nanoflow is a WORKFLOW — cards from top to bottom, what it takes at the top,
 * where it can end at the bottom, a decision's branches side by side, loops as
 * frames, error handling to the side — and a click on a card pins everything
 * that step says, down to the value each member it creates or changes gets.
 * The domain model is a map: the entity in the middle, the entities that point
 * to it on one side and the ones it points to on the other.
 *
 * It has to run in three places: the exported file, on a machine that has
 * never seen MxScout; the previews on the Documentation section; and a flow's
 * own window in MxScout, which draws its Diagram with this same workflow so
 * the two can never disagree. So the whole reader is ONE function with no
 * outside references — the export carries its source text
 * (factory.toString()) next to the encrypted data.
 *
 * It builds its DOM with createElement and textContent only: the text it
 * shows comes from a model, and none of it can become markup.
 */
(function () {
  'use strict';

  function factory() {
    var doc = document;
    var SVG = 'http://www.w3.org/2000/svg';

    function h(tag, attrs, kids) {
      var n = doc.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') n.textContent = v;
        else if (k === 'class') n.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : String(v));
      });
      add(n, kids);
      return n;
    }
    function add(n, kids) {
      if (kids === null || kids === undefined || kids === false) return n;
      if (!Array.isArray(kids)) kids = [kids];
      kids.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) add(n, c);
        else n.appendChild(typeof c === 'string' || typeof c === 'number' ? doc.createTextNode(String(c)) : c);
      });
      return n;
    }
    function s(tag, attrs) {
      var n = doc.createElementNS(SVG, tag);
      Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k])); });
      return n;
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    // What a card may say about itself. A short plain value ("'Comics'",
    // "$Order/Number", "from $Ticket") belongs on the card; an expression with
    // logic in it ("if $Supplier/Name = empty then …") makes the card as wide
    // as the expression and says nothing at a glance, so it is shown only in
    // the step's details, laid out (Karol, 2026-10-09).
    function simpleText(text) {
      var t = String(text || '');
      return t.length <= 48 && t.indexOf('\n') === -1 && !/\b(if|then|else)\b/i.test(t);
    }
    // A Mendix expression, laid out to be read: "then" and "else" each start a
    // line, indented under the "if" they belong to, and a long condition
    // breaks before its "and" / "or". Text in quotes is never touched.
    function prettyExpr(src) {
      var text = String(src || '').replace(/\s+/g, ' ').trim();
      if (simpleText(text)) return text;
      var re = /'(?:[^']|'')*'|\b(?:if|then|else|and|or)\b|[^'\s]+|\s+/gi;
      var lines = [], line = '', depth = 0, m;
      function pad(n) { return new Array(n + 1).join('  '); }
      function flush() { if (line.trim()) lines.push(line.replace(/\s+$/, '')); line = ''; }
      while ((m = re.exec(text))) {
        var tok = m[0], kw = tok.toLowerCase();
        if (kw === 'if') { if (line.trim() && !/^\s*(then|else)\s*$/i.test(line)) { flush(); line = pad(depth); } depth++; line += 'if '; continue; }
        if (kw === 'then' || kw === 'else') { flush(); line = pad(Math.max(depth, 1)) + kw + ' '; continue; }
        if ((kw === 'and' || kw === 'or') && line.replace(/^\s+/, '').length > 40) {
          var ind = /^\s*/.exec(line)[0].length / 2;
          flush(); line = pad(ind + 1) + kw + ' '; continue;
        }
        if (/^\s+$/.test(tok)) { if (line && !/\s$/.test(line)) line += ' '; continue; }
        // An XPath's next [constraint] starts a line of its own.
        if (tok.charAt(0) === '[' && /\]\s*$/.test(line) && line.trim().length > 30) { var at = /^\s*/.exec(line)[0]; flush(); line = at; }
        line += tok;
      }
      flush();
      return lines.join('\n');
    }
    function shortName(qn) { return String(qn || '').split('.').pop(); }
    function badgeOf(f) {
      if (f.kind === 'page') return 'PG';
      if (f.kind === 'nanoflow') return 'NF';
      var p = String(f.name).split('_')[0];
      return /^[A-Z]{2,5}$/.test(p) ? p : 'MF';
    }
    // Every sentence an AI agent wrote carries this mark. The rest of the
    // documentation is read from the model and says so; these are not, and a
    // reader must be able to tell the two apart at a glance.
    function aiMark() { return h('span', { class: 'dx-ai', title: 'Written by an AI agent from this model, not read from it', text: '✦ AI' }); }

    // The long layer of the business narrative (skills/mendix-describe/reference/business-narrative.md):
    // under a summary that is always shown, folded, and opened by the reader. Paragraphs are split on a
    // blank line and set as text — the file is somebody else's writing.
    function story(text) {
      if (!text) return null;
      var paras = String(text).split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean);
      if (!paras.length) return null;
      return h('details', { class: 'dx-more' }, [
        h('summary', { text: 'Read the full description' }),
        h('div', { class: 'dx-more-body' }, paras.map(function (p) { return h('p', { text: p }); }))
      ]);
    }
    // A module's description used to be one string; a file imported before the two layers still is.
    function layers(v) { return typeof v === 'string' ? { summary: v, story: null } : v || { summary: null, story: null }; }
    function kindClass(kind) { return kind === 'nanoflow' ? ' nf' : kind === 'page' ? ' pg' : kind === 'entity' ? ' en' : ''; }

    // MxScout's mark: a model is a graph, so the mark is one.
    function logo(size) {
      var svg = s('svg', { viewBox: '0 0 34 34', width: size, height: size, class: 'dx-mark', 'aria-hidden': 'true' });
      [[9, 12, 24, 9], [9, 12, 17, 25]].forEach(function (e) {
        svg.appendChild(s('line', { x1: e[0], y1: e[1], x2: e[2], y2: e[3], 'stroke-width': 3, 'stroke-linecap': 'round' }));
      });
      [[9, 12], [24, 9], [17, 25]].forEach(function (c) { svg.appendChild(s('circle', { cx: c[0], cy: c[1], r: 4.2 })); });
      return svg;
    }

    var FAM_ICON = { db: '⛁', obj: '✎', save: '✔', call: 'ƒ', ext: '⇄', ui: '▭', msg: '!', var: 'x', act: '•' };
    var LEGEND = [['if', 'decision'], ['db', 'reads data'], ['obj', 'create / change'], ['save', 'commit / delete'], ['call', 'call'],
      ['ui', 'page / file'], ['msg', 'message / log'], ['ext', 'outside the app'], ['loop', 'loop']];
    var CASE = { 'true': 'true', 'false': 'false', error: 'on error', '(empty)': 'empty' };
    var CALLER = { microflow: 'microflows', nanoflow: 'nanoflows', page: 'pages' };

    function themeOf(t) {
      return t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    // ================================================================ the workflow
    // Shared by the reader and by a flow's window in MxScout. `env` knows which
    // other flows exist and how to open one; `f` is a docs-data flow entry.
    function flowView(f, env) {
      env = env || {};
      var known = env.known || function () { return false; };
      var open = env.open || function () {};
      var wrap = h('div', { class: 'wf-wrap' });
      if (!f.workflow) {
        add(wrap, ends(f, env));
        wrap.appendChild(h('div', { class: 'dx-note', text: 'No drawing for this ' + f.kind + ' in the model — it was imported as JSON, or the flow is empty.' }));
        return wrap;
      }
      // A step's details open NEXT TO the step, inside the drawing, and move
      // with it as the drawing scrolls: a panel at the side of the canvas
      // read as a separate window, far from what was clicked (Karol,
      // 2026-10-09). Right of the step when there is room, left when not,
      // under it when neither side has room.
      var detail = h('aside', { class: 'wfx-detail', hidden: true });
      // What it takes sits above Start and what it hands back below the last
      // step, inside the drawing: two cards above the canvas took the room
      // the workflow needed and gave the page a second scrollbar (Karol,
      // 2026-10-09).
      var inner = h('div', { class: 'wfx' }, [entryNode(f), link()].concat(seqNodes(f.workflow, f), [exitNode(f)]));
      inner.appendChild(detail);
      var canvas = h('div', { class: 'wfx-canvas' }, [inner]);
      var stage = h('div', { class: 'wfx-stage' }, [canvas]);
      var pinned = null;
      var POP = 360, GAP = 16;
      function place(node) {
        var ir = inner.getBoundingClientRect(), nr = node.getBoundingClientRect();
        // Previews are drawn scaled; positions are worked out inside the scale.
        var k = inner.offsetWidth ? ir.width / inner.offsetWidth : 1;
        var left = (nr.left - ir.left) / k, right = (nr.right - ir.left) / k, top = (nr.top - ir.top) / k;
        var width = Math.max(inner.scrollWidth, inner.offsetWidth);
        var side = right + GAP + POP <= width + 8 ? 'right' : left - GAP - POP >= 0 ? 'left' : 'below';
        detail.className = 'wfx-detail at-' + side;
        detail.style.left = (side === 'right' ? right + GAP : side === 'left' ? left - GAP - POP : Math.max(0, left)) + 'px';
        detail.style.top = (side === 'below' ? (nr.bottom - ir.top) / k + 10 : top - 4) + 'px';
        if (detail.scrollIntoView) detail.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      function pin(node) {
        if (pinned) pinned.classList.remove('pinned');
        if (!node || node === pinned) { pinned = null; detail.hidden = true; return; }
        pinned = node; node.classList.add('pinned');
        clear(detail).appendChild(node._detail());
        detail.hidden = false;
        place(node);
      }
      canvas.addEventListener('click', function (e) {
        if (detail.contains(e.target)) return;
        var n = e.target.closest ? e.target.closest('[data-pick]') : null;
        if (n && canvas.contains(n)) pin(n); else pin(null);
      });
      detail.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.wfx-d-x')) pin(null);
      });
      canvas.addEventListener('keydown', function (e) {
        var n = e.target.closest ? e.target.closest('[data-pick]') : null;
        if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pin(n); }
      });
      var big = h('button', { type: 'button', class: 'dx-btn', text: '⤢ Enlarge', onclick: function () {
        var on = !stage.classList.contains('full');
        stage.classList.toggle('full', on);
        big.textContent = on ? '✕ Close' : '⤢ Enlarge';
        big.classList.toggle('over', on);
        if (pinned) place(pinned);
      } });
      if (!env.preview) {
        doc.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape' || !wrap.isConnected) return;
          if (pinned) pin(null); else if (stage.classList.contains('full')) big.click();
        });
      }
      wrap.appendChild(h('div', { class: 'wfh' }, [
        h('span', { class: 'wfh-t', text: 'Top to bottom, as it runs. Branches of a decision sit side by side; ↻ frames are loops; the dashed red line is error handling. Click a step to see everything it does — and the data it sets.' }),
        h('span', { class: 'leg' }, LEGEND.map(function (x) { return h('i', { class: 'wk-' + x[0], text: x[1] }); })),
        big
      ]));
      wrap.appendChild(stage);
      // Branches grow to both sides of the middle, so a wide workflow opened
      // at its left edge shows only empty canvas: start it centred.
      function centre() { if (canvas.isConnected && canvas.scrollWidth > canvas.clientWidth) canvas.scrollLeft = (canvas.scrollWidth - canvas.clientWidth) / 2; }
      if (window.requestAnimationFrame) window.requestAnimationFrame(function () { window.requestAnimationFrame(centre); });
      return wrap;

      // ---------- the cards ----------
      function link() { return h('div', { class: 'wfx-link' }); }
      function caseTag(l) {
        if (l === null || l === undefined || l === '') return null;
        return h('span', { class: 'wfx-case' + (l === 'true' ? ' yes' : l === 'false' ? ' no' : l === 'error' ? ' err' : ''), title: String(l), text: CASE[l] || String(l) });
      }
      function seqNodes(list) {
        var out = [];
        list.forEach(function (b, i) {
          if (i) out.push(link());
          if (b.t === 'start') {
            out.push(h('div', { class: 'wfx-term start' }, [h('i', { text: '▶' }), 'Start']));
          } else if (b.t === 'end') {
            out.push(h('div', { class: 'wfx-term ' + (b.kind === 'errorEvent' ? 'err' : 'end') }, [h('i', { text: b.kind === 'errorEvent' ? '!' : b.kind === 'continue' ? '↻' : '■' }), b.label, b.returns ? h('small', { text: 'returns ' + b.returns }) : null]));
          } else if (b.t === 'go') {
            out.push(h('div', { class: 'wfx-go', text: '↪ continues at step ' + (b.no || '?') }));
          } else if (b.t === 'orphan') {
            out.push(h('div', { class: 'wfx-orphan', text: 'Separate path' }));
            out = out.concat(seqNodes(b.body));
          } else if (b.t === 'loop') {
            out.push(h('div', { class: 'wfx-loop' }, [
              h('div', { class: 'wfx-loop-head' }, b.cond !== null && b.cond !== undefined
                ? ['↻ While ', h('span', { class: 'mono', text: b.cond || 'condition holds' })]
                : ['↻ For each ', h('span', { class: 'mono', text: b.each || 'item' }), ' in ', h('span', { class: 'mono', text: b.over || 'list' }), b.title ? ' · ' + b.title : '']),
              h('div', { class: 'wfx-seq' }, b.body.length ? seqNodes(b.body) : [h('div', { class: 'wfx-go', text: 'empty loop' })])
            ]));
          } else if (b.t === 'split') {
            var dec = h('div', { class: 'wfx-dec', 'data-pick': '1', tabindex: '0' }, [h('span', { class: 'dia' }, [h('b', { text: '?' })]),
              h('div', null, [h('div', { class: 't', text: b.title }),
                b.cond && simpleText(b.cond) && b.cond !== b.title ? h('div', { class: 'd mono', text: b.cond }) : null,
                b.cond && !simpleText(b.cond) ? h('span', { class: 'tag', text: 'ƒx condition' }) : null])]);
            dec._detail = function () {
              return detailOf(b.kind === 'decision' ? 'Decision' : 'Object type decision', b.title, b.no, 'if',
                [b.cond ? ['Condition', prettyExpr(b.cond), true] : null, ['Branches', b.branches.map(function (x) { return CASE[x.label] || x.label || '–'; }).join(' · ')]].filter(Boolean), null, b.doc);
            };
            var going = b.branches.map(function (x, k) { return x.ends ? -1 : k; }).filter(function (k) { return k >= 0; });
            var lo = going.length ? Math.min.apply(null, going) : -1, hi = going.length ? Math.max.apply(null, going) : -1;
            out.push(dec);
            out.push(h('div', { class: 'wfx-stub' }));
            out.push(h('div', { class: 'wfx-split' }, b.branches.map(function (x, k) {
              var bar = !b.after ? '' : k === lo && k === hi ? ' j-one' : k === lo ? ' j-first' : k === hi ? ' j-last' : (k > lo && k < hi ? ' j-mid' : '');
              return h('div', { class: 'wfx-branch' + bar }, [caseTag(x.label),
                h('div', { class: 'wfx-seq' }, x.body.length ? seqNodes(x.body) : [h('div', { class: 'wfx-pass' })]),
                bar ? h('i', { class: 'wfx-jb' }) : null]);
            })));
            if (b.after) out.push(h('div', { class: 'wfx-stub' }));
          } else if (b.t === 'step') {
            var c = b.card;
            var target = c.ref ? c.ref.kind + ':' + c.ref.qn : null;
            var count = c.fields ? c.fields.length : 0;
            var node = h('div', { class: 'wfx-step wk-' + c.fam + (c.off ? ' off' : '') + (target && known(target) ? ' calls' : ''), 'data-pick': '1', tabindex: '0', role: 'button' }, [
              h('span', { class: 'ic', text: FAM_ICON[c.fam] || '•' }),
              h('div', { class: 'tx' }, [h('div', { class: 'k' }, [c.kick, h('span', { class: 'no', text: String(b.no) })]), h('div', { class: 't', text: c.title }),
                c.detail && simpleText(c.detail) ? h('div', { class: 'd', text: c.detail }) : null,
                c.detail && !simpleText(c.detail) ? h('span', { class: 'tag', text: 'ƒx expression' }) : null,
                count ? h('span', { class: 'tag data', text: count + (c.ref && c.ref.kind !== 'page' && !c.creates && c.fam === 'call' ? (count === 1 ? ' argument' : ' arguments') : count === 1 ? ' field' : ' fields') }) : null,
                c.err ? h('span', { class: 'tag', text: 'custom error handling' }) : null, c.off ? h('span', { class: 'tag', text: 'disabled' }) : null])
            ]);
            node._detail = function () {
              var go = target && known(target)
                ? h('button', { type: 'button', class: 'dx-btn primary go', text: 'Open ' + shortName(c.ref.qn) + ' →', onclick: function (e) { e.stopPropagation(); open(target); } })
                : (c.ref && c.ref.kind ? h('div', { class: 'go dim', text: c.ref.qn + ' is not in this documentation' }) : null);
              var ent = c.creates && c.rows && env.openEntity ? c.rows.filter(function (r) { return r[0] === 'Refers to'; })[0] : null;
              return detailOf(c.kick, c.title, b.no, c.fam, c.rows.map(function (r) {
                var code = /^(Detail|Value|Refers to)$/.test(r[0]);
                return [r[0], code && r[0] !== 'Refers to' ? prettyExpr(r[1]) : r[1], code];
              }),
                fieldTable(c, f), c.doc, [go, ent && env.knownEntity && env.knownEntity(ent[1])
                  ? h('button', { type: 'button', class: 'dx-btn go', text: 'Show ' + shortName(ent[1]) + ' in the domain model', onclick: function (e) { e.stopPropagation(); env.openEntity(ent[1]); } }) : null]);
            };
            if (b.error) {
              out.push(h('div', { class: 'wfx-side' }, [node, h('div', { class: 'wfx-errline' }), h('div', { class: 'wfx-seq wfx-errcol' }, [caseTag('error')].concat(seqNodes(b.error)))]));
            } else out.push(node);
          }
        });
        return out;
      }
    }

    // What the flow takes, drawn where Studio Pro draws its parameters: above
    // Start, as yellow shapes pointing into the flow. Under them, who starts
    // it, in one line.
    function entryNode(f) {
      var callers = {};
      (f.calledBy || []).forEach(function (c) { (callers[c.kind] = callers[c.kind] || []).push(c); });
      var from = [f.roles.length ? h('span', { class: 'dx-pill', title: f.roles.join(', '), text: 'by ' + plural(f.roles.length, 'role', 'roles') }) : null]
        .concat(Object.keys(callers).map(function (k) {
          return h('span', { class: 'dx-pill', title: callers[k].map(function (c) { return c.qn; }).join('\n'), text: plural(callers[k].length, k, CALLER[k] || k + 's') });
        })).filter(Boolean);
      return h('div', { class: 'wfx-in' }, [
        h('div', { class: 'wfx-in-params' }, f.params.length ? f.params.map(function (p) {
          var type = String(p.type || '');
          return h('div', { class: 'wfx-param', title: p.name + ' : ' + type }, [h('b', { class: 'mono', text: p.name }),
            h('small', { class: 'mono', text: /^[\w]+\.[\w]+$/.test(type) ? shortName(type) : type })]);
        }) : [h('div', { class: 'wfx-param none', text: 'no parameters' })]),
        h('div', { class: 'wfx-in-from' }, [h('span', { class: 'wfx-in-k', text: 'started' })]
          .concat(from.length ? from : [h('span', { class: 'dx-end-none', text: 'by nothing in the model' })]))
      ]);
    }
    // What it hands back, once, under the whole drawing; each end in the
    // drawing still says what it returns.
    function exitNode(f) {
      var exits = f.exits || [], ends = 0, errors = 0;
      exits.forEach(function (x) { if (x.error) errors += x.count || 1; else ends += x.count || 1; });
      return h('div', { class: 'wfx-out' }, [
        h('span', { class: 'wfx-in-k', text: 'returns' }),
        h('span', { class: 'wfx-ret' + (f.returns ? ' mono' : ''), title: f.returns || '', text: f.returns || 'nothing' }),
        h('span', { class: 'wfx-out-n', text: [ends ? plural(ends, 'end', 'ends') : null, errors ? plural(errors, 'error end', 'error ends') : null].filter(Boolean).join(' · ') })
      ]);
    }

    // What the flow takes and where it can end — the two things to know before
    // reading a single step. Used where there is no drawing to put them in.
    function ends(f, env) {
      if (f.kind === 'page') return null;
      var callers = {};
      (f.calledBy || []).forEach(function (c) { (callers[c.kind] = callers[c.kind] || []).push(c); });
      var entry = h('div', { class: 'dx-end in' }, [
        h('div', { class: 'dx-end-h' }, [h('i', { text: '→' }), 'Entry']),
        h('div', { class: 'dx-end-k', text: 'Takes' }),
        f.params.length ? h('ul', { class: 'dx-end-l' }, f.params.map(function (p) { return h('li', null, [h('b', { class: 'mono', text: p.name }), h('span', { class: 'mono', text: p.type })]); }))
          : h('div', { class: 'dx-end-none', text: 'No parameters' }),
        h('div', { class: 'dx-end-k', text: 'Started from' }),
        h('div', { class: 'dx-end-from' }, [
          f.roles.length ? h('span', { class: 'dx-pill', title: f.roles.join(', '), text: 'directly by ' + plural(f.roles.length, 'role', 'roles') }) : null
        ].concat(Object.keys(callers).map(function (k) {
          return h('span', { class: 'dx-pill', title: callers[k].map(function (c) { return c.qn; }).join('\n'), text: plural(callers[k].length, k, CALLER[k] || k + 's') });
        })).concat(!f.roles.length && !(f.calledBy || []).length ? [h('span', { class: 'dx-end-none', text: 'Nothing in the model starts it' })] : []))
      ]);
      var exits = f.exits || [];
      var exit = h('div', { class: 'dx-end out' }, [
        h('div', { class: 'dx-end-h' }, [h('i', { text: '■' }), 'Exit']),
        h('div', { class: 'dx-end-k', text: 'Returns' }),
        h('div', { class: 'dx-end-ret' + (f.returns ? ' mono' : ''), text: f.returns || 'nothing' }),
        h('div', { class: 'dx-end-k', text: 'Ends' }),
        exits.length ? h('ul', { class: 'dx-end-l' }, exits.map(function (x) {
          return h('li', { class: x.error ? 'err' : null }, [h('b', { text: x.error ? 'Error end' : x.returns ? 'Ends with' : 'Ends' }),
            x.returns ? h('span', { class: 'mono', text: x.returns }) : h('span'), x.count > 1 ? h('small', { text: '×' + x.count }) : null]);
        })) : h('div', { class: 'dx-end-none', text: 'No end event in the drawing' })
      ]);
      return h('div', { class: 'dx-ends' }, [entry, exit]);
    }

    // The data a step works with. A member set to a parameter of the same name
    // is folded into one line, so the rows that carry real logic stand out.
    function fieldTable(c, f) {
      if (!c.fields) return null;
      var params = {};
      (f.params || []).forEach(function (p) { params[p.name] = true; });
      var plain = [], rows = [];
      c.fields.forEach(function (x) {
        var v = String(x.value || '');
        var m = /^\$([A-Za-z_]\w*)$/.exec(v);
        if (m && (m[1] === x.name || params[m[1]]) && (!x.op || x.op === 'Set')) plain.push(x.name + ' ← ' + v);
        else rows.push(x);
      });
      var isCall = c.fam === 'call' || c.fam === 'ext' || (c.ref && c.ref.kind === 'page');
      var title = c.creates ? 'Created with' : isCall ? 'Called with' : 'Sets';
      return h('div', { class: 'wfx-fields' }, [
        h('div', { class: 'wfx-fields-h', text: title }),
        rows.length ? h('table', null, rows.map(function (x) {
          return h('tr', null, [
            h('td', { class: 'mono n' }, [x.association ? h('i', { class: 'as', title: 'association', text: '↔ ' }) : null, x.name]),
            h('td', { class: 'op', text: x.op && x.op !== 'Set' ? x.op.toLowerCase() : '=' }),
            h('td', { class: 'mono v', text: x.value === '' ? '(empty)' : prettyExpr(x.value) })
          ]);
        })) : null,
        plain.length ? h('div', { class: 'wfx-plain' }, [h('span', { text: 'Passed on unchanged: ' }), h('span', { class: 'mono', text: plain.join(', ') })]) : null
      ]);
    }

    function detailOf(kick, title, no, fam, rows, extra, docText, actions) {
      return h('div', { class: 'wfx-d wk-' + fam }, [
        h('div', { class: 'wfx-d-head' }, [h('div', { class: 'k' }, [kick, no ? h('span', { class: 'no', text: 'step ' + no }) : null]),
          h('button', { type: 'button', class: 'wfx-d-x', title: 'Close (Esc)', text: '✕' })]),
        title ? h('div', { class: 't', text: title }) : null,
        rows.length ? h('dl', null, rows.map(function (r) { return [h('dt', { text: r[0] }), h('dd', { class: r[2] ? 'mono' : null, text: r[1] })]; })) : null,
        extra || null,
        docText ? h('div', { class: 'doc', text: docText }) : null,
        h('div', { class: 'wfx-d-go' }, actions || [])
      ]);
    }

    // ================================================================ mount
    function mount(data, host, opts) {
      opts = opts || {};
      var st = { view: 'start', module: null, seg: 'microflow', key: null, entity: null, q: '' };
      if (opts.state) Object.keys(opts.state).forEach(function (k) { st[k] = opts.state[k]; });
      if (opts.hash) readHash();
      var theme = opts.theme || 'auto';
      if (!opts.preview) { try { theme = localStorage.getItem('mxdocs-theme') || theme; } catch (e) { /* storage may be blocked */ } }

      var root = h('div', { class: 'dx' + (opts.preview ? ' preview' : '') });
      var titleEl = h('h1'), subEl = h('div', { class: 'dx-sub' });
      var search = h('input', { type: 'search', class: 'dx-search', placeholder: 'Search…  Ctrl K', 'aria-label': 'Search the documentation' });
      var results = h('div', { class: 'dx-results', hidden: true });
      var themeBtns = {};
      var themeBox = h('div', { class: 'dx-theme', role: 'group', 'aria-label': 'Theme' }, [['light', '☀', 'Light'], ['dark', '☾', 'Dark'], ['auto', 'Auto', 'Follow the system']].map(function (t) {
        themeBtns[t[0]] = h('button', { type: 'button', text: t[1], title: t[2], onclick: function () { setTheme(t[0]); } });
        return themeBtns[t[0]];
      }));
      var top = h('header', { class: 'dx-top' }, [
        h('div', { class: 'dx-brand' }, [logo(26), h('div', null, [h('b', { text: 'MxScout' }), h('small', { text: 'Documentation' })])]),
        h('div', { class: 'dx-title' }, [titleEl, subEl]),
        h('div', { class: 'dx-searchbox' }, [search, results]),
        opts.encrypted ? h('div', { class: 'dx-lock', title: 'This file opened with an access code', text: '🔒 Encrypted' }) : null,
        themeBox,
        opts.actions ? h('div', { class: 'dx-actions' }, opts.actions) : null
      ]);
      var NAV = [['start', 'Overview'], ['modules', 'Modules'], ['refs', 'Microflows & pages'], ['domain', 'Domain model'], ['quality', 'Model quality']];
      var counts = { modules: data.kpi.modules, refs: data.kpi.microflows + data.kpi.nanoflows + data.kpi.pages, domain: data.kpi.entities,
        quality: data.quality.unreached.length };
      var navBtns = {};
      var nav = h('nav', { class: 'dx-nav', 'aria-label': 'Sections' }, [
        h('div', { class: 'dx-nav-project' }, [h('b', { text: data.project }), h('small', { text: (data.mendix ? 'Mendix ' + data.mendix + ' · ' : '') + 'generated ' + fmtDate(data.generatedAt) })])
      ].concat(NAV.map(function (r) {
        navBtns[r[0]] = h('button', { type: 'button', class: 'dx-nav-item', onclick: function () { go({ view: r[0] }); } }, [h('span', { text: r[1] }), counts[r[0]] !== undefined ? h('span', { class: 'dx-count', text: String(counts[r[0]]) }) : null]);
        return navBtns[r[0]];
      })));
      var list = h('aside', { class: 'dx-list' });
      var main = h('main', { class: 'dx-main' });
      var body = h('div', { class: 'dx-body' }, [nav, list, main]);
      add(root, [top, body]);
      clear(host).appendChild(root);

      function setTheme(t) {
        theme = t;
        if (!opts.preview) { try { localStorage.setItem('mxdocs-theme', t); } catch (e) { /* fine */ } }
        root.setAttribute('data-theme', themeOf(t));
        Object.keys(themeBtns).forEach(function (k) { themeBtns[k].classList.toggle('on', k === t); });
        if (st.view === 'domain' && drawLines) drawLines();
      }
      var drawLines = null;
      setTheme(theme);

      // ---------- navigation ----------
      function go(patch) {
        Object.keys(patch).forEach(function (k) { st[k] = patch[k]; });
        if (opts.hash) writeHash();
        if (opts.onState) opts.onState(st);
        draw();
        main.scrollTop = 0;
      }
      function openKey(key) {
        var f = data.flows[key];
        if (!f) return false;
        go({ view: 'refs', module: f.module, seg: f.kind, key: key });
        return true;
      }
      var env = {
        preview: !!opts.preview,
        known: function (k) { return !!data.flows[k]; },
        open: openKey,
        knownEntity: function (q) { return !!data.entities[q]; },
        openEntity: function (q) { go({ view: 'domain', entity: q }); }
      };
      function readHash() {
        var m = /^#\/(\w+)(?:\/(.*))?$/.exec(location.hash || '');
        if (!m) return;
        st.view = m[1];
        var arg = m[2] ? decodeURIComponent(m[2]) : null;
        if (st.view === 'refs' && arg && data.flows[arg]) { st.key = arg; st.module = data.flows[arg].module; st.seg = data.flows[arg].kind; }
        if (st.view === 'domain' && arg) st.entity = arg;
        if (st.view === 'modules' && arg) st.module = arg;
      }
      function writeHash() {
        var arg = st.view === 'refs' ? st.key : st.view === 'domain' ? st.entity : st.view === 'modules' ? st.module : null;
        var h2 = '#/' + st.view + (arg ? '/' + encodeURIComponent(arg) : '');
        if (location.hash !== h2) history.pushState(null, '', h2);
      }
      if (opts.hash) window.addEventListener('popstate', function () { readHash(); draw(); });

      // ---------- search ----------
      var index = [];
      Object.keys(data.flows).forEach(function (k) { var f = data.flows[k]; index.push({ key: k, kind: f.kind, name: f.name, module: f.module, l: f.name.toLowerCase() }); });
      Object.keys(data.entities).forEach(function (q) { var e = data.entities[q]; index.push({ entity: q, kind: 'entity', name: e.name, module: e.module, l: e.name.toLowerCase() }); });
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        clear(results);
        if (!q) { results.hidden = true; return; }
        var hits = index.filter(function (x) { return x.l.indexOf(q) !== -1 || (x.module + '.' + x.l).toLowerCase().indexOf(q) !== -1; })
          .sort(function (a, b) { return (a.l.indexOf(q) === 0 ? 0 : 1) - (b.l.indexOf(q) === 0 ? 0 : 1) || a.l.localeCompare(b.l); }).slice(0, 30);
        results.hidden = false;
        if (!hits.length) { results.appendChild(h('div', { class: 'dx-r-empty', text: 'Nothing named like that.' })); return; }
        hits.forEach(function (x) {
          results.appendChild(h('button', { type: 'button', class: 'dx-r', onclick: function () {
            results.hidden = true; search.value = '';
            if (x.entity) go({ view: 'domain', entity: x.entity }); else openKey(x.key);
          } }, [h('span', { class: 'dx-badge' + kindClass(x.kind), text: x.kind === 'entity' ? 'E' : x.kind === 'page' ? 'PG' : x.kind === 'nanoflow' ? 'NF' : 'MF' }),
            h('b', { text: x.name }), h('small', { text: x.module })]));
        });
      });
      if (!opts.preview) {
        doc.addEventListener('keydown', function (e) {
          if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K') && root.isConnected) { e.preventDefault(); search.focus(); }
          if (e.key === 'Escape') results.hidden = true;
        });
      }

      // ---------- drawing ----------
      function draw() {
        Object.keys(navBtns).forEach(function (k) { navBtns[k].classList.toggle('on', k === st.view); });
        clear(list); clear(main);
        drawLines = null;
        root.classList.toggle('no-list', st.view === 'start' || st.view === 'quality');
        var V = { start: drawStart, modules: drawModules, refs: drawRefs, domain: drawDomain, quality: drawQuality }[st.view] || drawStart;
        V();
      }
      function setTitle(t, sub) { titleEl.textContent = t; subEl.textContent = sub; }
      function crumbs(parts) {
        return h('div', { class: 'dx-crumbs' }, parts.map(function (p, i) {
          var last = i === parts.length - 1;
          return [i ? h('span', { class: 'dx-sep', text: '/' }) : null, last || !p[1] ? h('b', { text: p[0] }) : h('button', { type: 'button', class: 'dx-link', text: p[0], onclick: p[1] })];
        }));
      }
      function tile(n, label, sub, onclick) {
        return h(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: 'dx-card dx-kpi' + (onclick ? ' link' : ''), onclick: onclick || null }, [h('b', { text: String(n) }), h('span', { text: label }), sub ? h('small', { text: sub }) : null]);
      }

      function drawStart() {
        var k = data.kpi;
        setTitle(data.project, plural(k.modules, 'module', 'modules') + ' · ' + plural(k.microflows, 'microflow', 'microflows') + ' · ' + plural(k.nanoflows, 'nanoflow', 'nanoflows'));
        main.appendChild(h('div', { class: 'dx-hero' }, [
          h('div', { class: 'dx-hero-k' }, [logo(16), 'Generated by MxScout from the Mendix model']),
          h('h2', { text: data.project }),
          h('p', { text: 'Everything here is read from the Mendix model' + (data.app ? ' of ' + data.app : '') + ': every module, microflow, nanoflow, page and entity — what each flow takes and returns, every step it runs and the data it sets, who may start it, what calls what, and where the model looks unfinished.' + (data.ai
            ? ' The exception is the descriptions marked ✦ AI: an AI agent wrote them from this model' + (data.ai.by ? ' (' + data.ai.by + ')' : '') + ', and they can be wrong where the model is ambiguous.'
            : ' Nothing in it was written by hand.') }),
          h('div', { class: 'dx-hero-tags' }, [data.mendix ? h('span', { text: 'Mendix ' + data.mendix }) : null, h('span', { text: 'model of ' + fmtDate(data.generatedAt) }), opts.preview ? null : h('span', { text: 'Ctrl K — search everything' })])
        ]));
        main.appendChild(h('div', { class: 'dx-kpis' }, [
          tile(k.modules, 'own modules', k.marketplace ? '+ ' + k.marketplace + ' from the Marketplace' : null, function () { go({ view: 'modules' }); }),
          tile(k.microflows, 'microflows', null, function () { go({ view: 'refs', seg: 'microflow' }); }),
          tile(k.nanoflows, 'nanoflows', null, function () { go({ view: 'refs', seg: 'nanoflow' }); }),
          tile(k.pages, 'pages', null, function () { go({ view: 'refs', seg: 'page' }); }),
          tile(k.entities, 'entities', null, function () { go({ view: 'domain' }); }),
          tile(k.roles, 'user roles'),
          tile(k.scheduled, 'scheduled events', k.scheduled ? k.scheduledOn + ' of ' + k.scheduled + ' enabled' : null),
          tile(k.services, 'published services')
        ]));
        var app = data.ai && data.ai.app;
        if (app && (app.summary || app.story || app.processes.length)) {
          main.appendChild(h('h3', { class: 'dx-h' }, ['About the application ', aiMark()]));
          if (app.summary || app.story) {
            main.appendChild(h('div', { class: 'dx-card dx-about' }, [
              app.summary ? h('p', { class: 'dx-lead', text: app.summary }) : null,
              app.audience ? h('p', { class: 'dx-about-who', text: app.audience }) : null,
              story(app.story)
            ]));
          }
          if (app.processes.length) {
            main.appendChild(h('h3', { class: 'dx-h' }, ['Main processes ', aiMark()]));
            main.appendChild(h('div', { class: 'dx-procs' }, app.processes.map(function (pr, i) {
              return h('div', { class: 'dx-card dx-proc' }, [
                h('div', { class: 'dx-proc-h' }, [h('span', { class: 'dx-proc-n', text: String(i + 1) }), h('b', { text: pr.name })]),
                pr.summary ? h('p', { class: 'dx-lead', text: pr.summary }) : null,
                story(pr.story),
                pr.steps.length ? h('ol', null, pr.steps.map(function (x) { return h('li', { text: x }); })) : null,
                pr.flows.length ? h('div', { class: 'dx-chips' }, pr.flows.map(function (qn) {
                  var key = ['microflow', 'nanoflow', 'page'].map(function (k) { return k + ':' + qn; }).filter(function (k) { return data.flows[k]; })[0];
                  return key ? h('button', { type: 'button', class: 'dx-chip', onclick: function () { openKey(key); } }, [h('span', { class: 'dx-badge' + kindClass(data.flows[key].kind), text: badgeOf(data.flows[key]) }), data.flows[key].name])
                    : h('span', { class: 'dx-chip dim', text: qn });
                })) : null
              ]);
            })));
          }
        }
        var q = data.quality;
        var cards = [
          ['ƒ', 'Microflows & pages', 'What each flow takes and where it ends, every step top to bottom, and the data each step creates or changes.', function () { go({ view: 'refs' }); }],
          ['⬡', 'Domain model', 'A map per entity: the entities that point to it on one side, the ones it points to on the other.', function () { go({ view: 'domain' }); }],
          ['▦', 'Modules', 'What each module holds — own modules first, Marketplace modules after.', function () { go({ view: 'modules' }); }],
          ['✓', 'Model quality', plural(q.unreached.length, 'element nothing reaches', 'elements nothing reaches') + ' · ' + plural(q.disabled, 'disabled step', 'disabled steps') + '.', function () { go({ view: 'quality' }); }]
        ];
        main.appendChild(h('h3', { class: 'dx-h', text: 'Where to start' }));
        main.appendChild(h('div', { class: 'dx-cards' }, cards.map(function (c) {
          return h('button', { type: 'button', class: 'dx-card dx-start', onclick: c[3] }, [h('i', { text: c[0] }), h('b', { text: c[1] }), h('span', { text: c[2] })]);
        })));
        if (!data.drawings) main.appendChild(h('div', { class: 'dx-note', text: 'This model was imported as JSON and carries no drawings, so the workflows are not shown. Load the model from the Mendix project folder to see them.' }));
      }

      function moduleList(onPick, current) {
        list.appendChild(h('div', { class: 'dx-list-head' }, [h('h2', null, ['Modules', h('small', { text: String(data.modules.length) })])]));
        data.modules.forEach(function (m) {
          var n = m.microflows.length + m.nanoflows.length;
          list.appendChild(h('button', { type: 'button', class: 'dx-item' + (current === m.name ? ' on' : ''), onclick: function () { onPick(m.name); } }, [
            h('span', { class: 'dx-badge' + (m.marketplace ? ' mk' : ''), text: m.marketplace ? 'MP' : 'MOD' }),
            h('span', { class: 'dx-item-t' }, [h('b', { text: m.name }), h('small', { text: plural(n, 'flow', 'flows') + ' · ' + plural(m.pages.length, 'page', 'pages') + ' · ' + plural(m.entities.length, 'entity', 'entities') })])
          ]));
        });
      }

      function drawModules() {
        var name = st.module || (data.modules[0] && data.modules[0].name);
        moduleList(function (n) { go({ module: n }); }, name);
        var m = data.modules.filter(function (x) { return x.name === name; })[0];
        setTitle('Modules', plural(data.modules.length, 'module', 'modules'));
        if (!m) return;
        main.appendChild(crumbs([['Overview', function () { go({ view: 'start' }); }], ['Modules'], [m.name]]));
        main.appendChild(h('div', { class: 'dx-card dx-head' }, [h('span', { class: 'dx-badge big' + (m.marketplace ? ' mk' : ''), text: m.marketplace ? 'MP' : 'MOD' }),
          h('div', null, [h('h2', { class: 'mono', text: m.name }), h('p', { text: m.marketplace ? 'Marketplace module' : 'Own module' })])]));
        var md = data.ai && data.ai.modules[m.name] ? layers(data.ai.modules[m.name]) : null;
        if (md && (md.summary || md.story)) {
          main.appendChild(h('div', { class: 'dx-card dx-about dx-mod-about' }, [
            h('p', { class: 'dx-lead' }, [aiMark(), ' ', md.summary || '']),
            story(md.story)
          ]));
        }
        main.appendChild(h('div', { class: 'dx-kpis four' }, [tile(m.microflows.length, 'microflows'), tile(m.nanoflows.length, 'nanoflows'), tile(m.pages.length, 'pages'), tile(m.entities.length, 'entities')]));
        [['Microflows', m.microflows], ['Nanoflows', m.nanoflows], ['Pages', m.pages]].forEach(function (sec) {
          if (!sec[1].length) return;
          main.appendChild(h('h3', { class: 'dx-h', text: sec[0] + ' (' + sec[1].length + ')' }));
          main.appendChild(h('div', { class: 'dx-chips' }, sec[1].map(function (k) {
            var f = data.flows[k];
            return h('button', { type: 'button', class: 'dx-chip', onclick: function () { openKey(k); } }, [h('span', { class: 'dx-badge' + kindClass(f.kind), text: badgeOf(f) }), f.name]);
          })));
        });
        if (m.entities.length) {
          main.appendChild(h('h3', { class: 'dx-h', text: 'Entities (' + m.entities.length + ')' }));
          main.appendChild(h('div', { class: 'dx-chips' }, m.entities.map(function (q) {
            return h('button', { type: 'button', class: 'dx-chip', onclick: function () { go({ view: 'domain', entity: q }); } }, [h('span', { class: 'dx-badge en', text: 'E' }), shortName(q)]);
          })));
        }
      }

      // ---------- microflows, nanoflows and pages ----------
      function drawRefs() {
        var mods = data.modules.filter(function (m) { return m.microflows.length + m.nanoflows.length + m.pages.length; });
        var name = st.module || (mods[0] && mods[0].name);
        var m = data.modules.filter(function (x) { return x.name === name; })[0] || mods[0];
        if (!m) { setTitle('Microflows & pages', data.project); main.appendChild(h('div', { class: 'dx-note', text: 'This model has no microflows, nanoflows or pages.' })); return; }
        var seg = st.seg || 'microflow';
        var keys = seg === 'nanoflow' ? m.nanoflows : seg === 'page' ? m.pages : m.microflows;
        if (!keys.length) { seg = m.microflows.length ? 'microflow' : m.nanoflows.length ? 'nanoflow' : 'page'; keys = seg === 'nanoflow' ? m.nanoflows : seg === 'page' ? m.pages : m.microflows; }
        var key = st.key && data.flows[st.key] && data.flows[st.key].module === m.name ? st.key : keys[0];
        setTitle('Microflows & pages', m.name);

        var filter = h('input', { type: 'search', class: 'dx-filter', placeholder: 'Filter by name, e.g. ACT_, SUB_…', value: st.q || '' });
        var modSel = h('select', { class: 'dx-filter dx-modsel', 'aria-label': 'Module', onchange: function () { go({ module: modSel.value, key: null, q: '' }); } },
          mods.map(function (x) { var o = h('option', { value: x.name, text: x.name + '  (' + (x.microflows.length + x.nanoflows.length + x.pages.length) + ')' }); if (x.name === m.name) o.selected = true; return o; }));
        var items = h('div', { class: 'dx-items' });
        list.appendChild(h('div', { class: 'dx-list-head' }, [modSel, filter]));
        list.appendChild(h('div', { class: 'dx-seg' }, [['microflow', 'Microflows', m.microflows], ['nanoflow', 'Nanoflows', m.nanoflows], ['page', 'Pages', m.pages]].map(function (sx) {
          return h('button', { type: 'button', class: sx[0] === seg ? 'on' : '', onclick: function () { go({ seg: sx[0], key: null }); } }, [sx[1], h('i', { text: String(sx[2].length) })]);
        })));
        list.appendChild(items);
        function fill() {
          clear(items);
          var q = filter.value.trim().toLowerCase();
          keys.forEach(function (k) {
            var f = data.flows[k];
            if (q && f.name.toLowerCase().indexOf(q) === -1) return;
            items.appendChild(h('button', { type: 'button', class: 'dx-item' + (k === key ? ' on' : ''), onclick: function () { go({ key: k }); } }, [
              h('span', { class: 'dx-badge' + kindClass(f.kind), text: badgeOf(f) }),
              h('span', { class: 'dx-item-t' }, [h('b', { class: 'mono', text: f.name }), h('small', { text: f.desc || (f.roles.length ? f.roles.map(shortName).join(', ') : '–') })]),
              f.kind === 'page' ? null : h('span', { class: 'dx-num', title: 'steps', text: String(f.steps || 0) })
            ]));
          });
          if (!items.firstChild) items.appendChild(h('div', { class: 'dx-r-empty', text: 'Nothing matches.' }));
        }
        filter.addEventListener('input', function () { st.q = filter.value; fill(); });
        fill();
        if (key) drawFocus(data.flows[key]);
      }

      function drawFocus(f) {
        main.appendChild(crumbs([['Overview', function () { go({ view: 'start' }); }], ['Microflows & pages', function () { go({ view: 'refs', key: null }); }], [f.module, function () { go({ view: 'refs', module: f.module, key: null }); }], [f.name]]));
        var kindWord = f.kind === 'page' ? 'page' : f.kind;
        main.appendChild(h('div', { class: 'dx-card dx-head' }, [
          h('span', { class: 'dx-badge big' + kindClass(f.kind), text: badgeOf(f) }),
          h('div', { class: 'dx-head-t' }, [h('h2', { class: 'mono', text: f.name }),
            f.desc ? h('p', { class: 'desc' }, [aiMark(), ' ', f.desc, f.descStale ? h('span', { class: 'dx-stale', title: 'The flow changed after this was written', text: 'may be out of date' }) : null]) : null,
            h('p', { text: f.module + ' · ' + kindWord + (f.kind === 'page' ? '' : ' · ' + plural(f.steps || 0, 'step', 'steps') + ' · ' + plural(f.calls.length, 'call', 'calls')) + (f.path && f.path.length ? ' · ' + f.path.join(' / ') : '') })]),
          h('div', { class: 'dx-roles' }, f.roles.map(function (r) { return h('span', { text: shortName(r) }); }))
        ]));
        if (f.doc) main.appendChild(h('div', { class: 'dx-note doc', text: f.doc }));

        var panel = h('div', { class: 'dx-panel' });
        var TABS = f.kind === 'page'
          ? [['details', 'Details'], ['by', 'Opened from', f.calledBy.length]]
          : [['wf', 'Workflow'], ['calls', 'Calls', f.calls.length], ['by', 'Called by', f.calledBy.length], ['details', 'Details']];
        var tabBtns = {};
        var tabs = h('div', { class: 'dx-tabs', role: 'tablist' }, TABS.map(function (t) {
          tabBtns[t[0]] = h('button', { type: 'button', role: 'tab', onclick: function () { show(t[0]); } }, [t[1], t[2] !== undefined ? h('i', { text: String(t[2]) }) : null]);
          return tabBtns[t[0]];
        }));
        main.appendChild(h('div', { class: 'dx-card dx-tabcard' }, [tabs, panel]));
        function show(k) {
          Object.keys(tabBtns).forEach(function (x) { tabBtns[x].classList.toggle('on', x === k); tabBtns[x].setAttribute('aria-selected', x === k ? 'true' : 'false'); });
          clear(panel);
          if (k === 'wf') panel.appendChild(flowView(f, env));
          if (k === 'calls') panel.appendChild(refList(f.calls, 'This ' + f.kind + ' calls nothing else and opens no page.'));
          if (k === 'by') panel.appendChild(refList(f.calledBy, f.kind === 'page' ? 'Nothing in the model opens this page.' : 'Nothing in the model calls this ' + f.kind + '.' + (f.roles.length ? ' Its roles can still run it from the app.' : '')));
          if (k === 'details') panel.appendChild(details(f));
        }
        show(TABS[0][0]);
      }
      function refList(refs, empty) {
        if (!refs.length) return h('div', { class: 'dx-note', text: empty });
        return h('div', { class: 'dx-xl' }, refs.map(function (r) {
          var key = (r.kind === 'microflow' || r.kind === 'nanoflow' || r.kind === 'page') ? r.kind + ':' + r.qn : null;
          var here = key && data.flows[key];
          return h(here ? 'button' : 'div', { type: here ? 'button' : null, class: 'dx-xl-row' + (here ? ' link' : ''), onclick: here ? function () { openKey(key); } : null }, [
            h('span', { class: 'dx-badge' + kindClass(r.kind), text: r.kind === 'page' ? 'PG' : r.kind === 'nanoflow' ? 'NF' : r.kind === 'microflow' ? 'MF' : String(r.kind || '').slice(0, 3).toUpperCase() }),
            h('b', { class: 'mono', text: r.qn }), h('small', { text: r.kind + (here ? ' ↗' : '') })]);
        }));
      }
      function details(f) {
        var rows = [['Qualified name', f.qn], ['Kind', f.kind], ['Folder', f.path && f.path.length ? f.path.join(' / ') : '–']];
        if (f.params && f.params.length) rows.push(['Parameters', f.params.map(function (p) { return p.name + ' : ' + p.type; }).join(', ')]);
        if (f.kind !== 'page') rows.push(['Returns', f.returns || '–']);
        rows.push(['Roles', f.roles.length ? f.roles.map(shortName).join(', ') : '–']);
        if (f.kind === 'microflow') rows.push(['Entity access', f.entityAccess ? 'applied — the caller’s access rules hold' : 'not applied — reads and writes past the access rules']);
        if (f.reads && f.reads.length) rows.push(['Reads', f.reads.join(', ')]);
        if (f.writes && f.writes.length) rows.push(['Writes', f.writes.join(', ')]);
        return h('dl', { class: 'dx-dl' }, rows.map(function (r) { return [h('dt', { text: r[0] }), h('dd', { text: r[1] })]; }));
      }

      // ---------- domain model: a map around one entity ----------
      function drawDomain() {
        var all = Object.keys(data.entities).sort(function (a, b) { return shortName(a).localeCompare(shortName(b)); });
        var q = st.entity && data.entities[st.entity] ? st.entity : all[0];
        setTitle('Domain model', plural(all.length, 'entity', 'entities'));
        var filter = h('input', { type: 'search', class: 'dx-filter', placeholder: 'Filter entities…' });
        var items = h('div', { class: 'dx-items' });
        list.appendChild(h('div', { class: 'dx-list-head' }, [h('h2', null, ['Entities', h('small', { text: String(all.length) })]), filter]));
        list.appendChild(items);
        function fill() {
          clear(items);
          var t = filter.value.trim().toLowerCase();
          all.forEach(function (k) {
            var e = data.entities[k];
            if (t && k.toLowerCase().indexOf(t) === -1) return;
            items.appendChild(h('button', { type: 'button', class: 'dx-item' + (k === q ? ' on' : ''), onclick: function () { go({ entity: k }); } }, [
              h('span', { class: 'dx-badge en', text: 'E' }), h('span', { class: 'dx-item-t' }, [h('b', { class: 'mono', text: e.name }), h('small', { text: e.module + (e.persistable ? '' : ' · not persistable') })]),
              h('span', { class: 'dx-num', title: 'attributes', text: String(e.attributes.length) })]));
          });
        }
        filter.addEventListener('input', fill);
        fill();
        if (!q) { main.appendChild(h('div', { class: 'dx-note', text: 'This model has no entities.' })); return; }
        var e = data.entities[q];
        main.appendChild(crumbs([['Overview', function () { go({ view: 'start' }); }], ['Domain model', null], [e.module], [e.name]]));
        main.appendChild(accessCard(e));

        var inn = {}, out = {}, self = [];
        data.associations.forEach(function (a) {
          if (a.from === q && a.to === q) { self.push(a); return; }
          if (a.from === q) (out[a.to] = out[a.to] || []).push(a);
          if (a.to === q) (inn[a.from] = inn[a.from] || []).push(a);
        });
        var specials = Object.keys(data.entities).filter(function (k) { return data.entities[k].generalization === q; });
        function node(k, assocs, side) {
          var known = data.entities[k];
          return h(known ? 'button' : 'div', { type: known ? 'button' : null, class: 'dm-n ' + side + (known ? ' link' : '') + (k.split('.')[0] !== e.module ? ' other' : ''), 'data-q': k, onclick: known ? function () { go({ entity: k }); } : null }, [
            h('b', { class: 'mono', text: shortName(k) }),
            k.split('.')[0] !== e.module ? h('small', { text: k.split('.')[0] }) : null,
            h('span', { class: 'dm-a' }, assocs.map(function (a, i) { return [i ? ', ' : '', h('span', { class: 'mono', text: a.name }), h('i', { text: a.many ? ' *–*' : ' *–1' })]; }))]);
        }
        function column(map, side, title) {
          var ks = Object.keys(map).sort(function (a, b) { return shortName(a).localeCompare(shortName(b)); });
          return h('div', { class: 'dm-col ' + side }, [h('div', { class: 'dm-col-h', text: title + ' · ' + ks.length })]
            .concat(ks.length ? ks.map(function (k) { return node(k, map[k], side); }) : [h('div', { class: 'dm-empty', text: side === 'in' ? 'Nothing points to it.' : 'It points to nothing.' })]));
        }
        var center = h('div', { class: 'dm-center' }, [
          e.generalization ? h('button', { type: 'button', class: 'dm-gen' + (data.entities[e.generalization] ? ' link' : ''), onclick: data.entities[e.generalization] ? function () { go({ entity: e.generalization }); } : null }, ['▲ specializes ', h('b', { class: 'mono', text: shortName(e.generalization) })]) : null,
          h('div', { class: 'dm-c', 'data-q': q }, [
            h('div', { class: 'dm-c-k', text: e.module + (e.view ? ' · view entity' : e.persistable ? '' : ' · not persistable') }),
            h('h2', { class: 'mono', text: e.name }),
            e.doc ? h('p', { class: 'dm-doc', text: e.doc }) : null,
            e.desc ? h('p', { class: 'dm-doc' }, [aiMark(), ' ', e.desc]) : null,
            h('div', { class: 'dm-stats' }, [h('span', { text: plural(e.attributes.length, 'attribute', 'attributes') }),
              h('span', { text: plural(Object.keys(inn).length + Object.keys(out).length, 'related entity', 'related entities') }),
              h('span', { text: e.rules ? plural(e.rules, 'access rule', 'access rules') : (e.persistable ? 'no access rules' : 'no access rules apply') })]),
            self.length ? h('div', { class: 'dm-self', text: '↻ to itself: ' + self.map(function (a) { return a.name; }).join(', ') }) : null
          ]),
          specials.length ? h('div', { class: 'dm-specs' }, ['▼ specialized by ', specials.map(function (k, i) { return [i ? ' ' : '', h('button', { type: 'button', class: 'dm-spec link mono', text: shortName(k), onclick: function () { go({ entity: k }); } })]; })]) : null
        ]);
        var lines = s('svg', { class: 'dm-lines', 'aria-hidden': 'true' });
        var map = h('div', { class: 'dm-map' }, [lines, column(inn, 'in', 'Point to it'), center, column(out, 'out', 'It points to')]);
        main.appendChild(map);
        main.appendChild(h('div', { class: 'dm-legend', text: 'Arrows follow the association’s owner: entities on the left own an association to ' + e.name + ', the ones on the right are owned by it. *–1 is a reference, *–* a reference set. Click an entity to put it in the middle.' }));

        drawLines = function () {
          if (!map.isConnected) return;
          clear(lines);
          var box = map.getBoundingClientRect();
          if (!box.width || !map.offsetWidth) return;
          // A preview is drawn scaled down; the lines live inside that scale.
          var k = box.width / map.offsetWidth;
          lines.setAttribute('width', map.offsetWidth); lines.setAttribute('height', map.offsetHeight);
          lines.setAttribute('viewBox', '0 0 ' + map.offsetWidth + ' ' + map.offsetHeight);
          var defs = s('defs');
          var mk = s('marker', { id: 'dm-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
          mk.appendChild(s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'dm-arrowhead' }));
          defs.appendChild(mk); lines.appendChild(defs);
          var c = center.querySelector('.dm-c').getBoundingClientRect();
          // On a narrow page the three columns stack, and lines would cross the cards.
          if (c.left <= map.querySelector('.dm-col.in').getBoundingClientRect().right + 8) return;
          ['in', 'out'].forEach(function (side) {
            var nodes = Array.prototype.slice.call(map.querySelectorAll('.dm-n.' + side));
            nodes.forEach(function (n, i) {
              var r = n.getBoundingClientRect();
              var y1 = (r.top + r.height / 2 - box.top) / k;
              var span = Math.min(c.height / k - 24, Math.max(0, nodes.length - 1) * 14);
              var y2 = (c.top - box.top + c.height / 2) / k + (nodes.length > 1 ? (i / (nodes.length - 1) - 0.5) * span : 0);
              var x1 = (side === 'in' ? r.right - box.left : r.left - box.left) / k;
              var x2 = (side === 'in' ? c.left - box.left : c.right - box.left) / k;
              var mid = (x1 + x2) / 2;
              lines.appendChild(s('path', { d: 'M' + x1 + ',' + y1 + ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + x2 + ',' + y2,
                class: 'dm-line', 'marker-end': side === 'in' ? 'url(#dm-arrow)' : null, 'marker-start': side === 'out' ? 'url(#dm-arrow)' : null }));
            });
          });
        };
        // Arrows run owner → other: into the middle from the left, out of it to
        // the right (marker-start with auto-start-reverse points at the node).
        var redraw = function () { if (drawLines) drawLines(); };
        if (window.requestAnimationFrame) window.requestAnimationFrame(redraw); else setTimeout(redraw, 0);
        if (window.ResizeObserver) { var ro = new ResizeObserver(redraw); ro.observe(map); }

        main.appendChild(h('h3', { class: 'dx-h', text: 'Attributes (' + e.attributes.length + ')' }));
        if (e.attributes.length) {
          main.appendChild(h('div', { class: 'dx-card dx-table' }, [h('table', null, [h('thead', null, h('tr', null, [h('th', { text: 'Name' }), h('th', { text: 'Type' })]))].concat([h('tbody', null,
            e.attributes.map(function (a) { return h('tr', null, [h('td', { class: 'mono', text: a.name }), h('td', { class: 'mono', text: a.type })]); }))]))]));
        } else main.appendChild(h('div', { class: 'dx-note', text: 'No attributes of its own' + (e.generalization ? ' — it inherits those of ' + shortName(e.generalization) + '.' : '.') }));
      }

      // Who may do what with an entity — the first thing on its page, not a
      // muted line under the attributes where it went unseen (Karol,
      // 2026-10-09). One row per rule: the user roles that carry it as
      // badges, what it allows as marks, and the XPath that limits the rows.
      function accessCard(e) {
        var rows = e.access || [];
        var head = h('div', { class: 'dx-acc-h' }, [h('b', { text: 'Who can access it' }),
          h('span', { class: 'dx-acc-sub', text: rows.length ? plural(rows.length, 'access rule', 'access rules')
            : e.persistable ? 'No access rules — no role can read it from the client, only microflows that skip entity access.'
            : 'No access rules.' })]);
        if (!rows.length) return h('div', { class: 'dx-card dx-acc empty' }, [head]);
        return h('div', { class: 'dx-card dx-acc' }, [head, h('div', { class: 'dx-acc-rows' }, rows.map(function (r) {
          var can = [];
          if (r.read) can.push(h('span', { class: 'dx-can r', text: 'read ' + r.read })); else can.push(h('span', { class: 'dx-can no', text: 'no read' }));
          if (r.write) can.push(h('span', { class: 'dx-can w', text: 'write ' + r.write }));
          if (r.create) can.push(h('span', { class: 'dx-can c', text: 'create' }));
          if (r.del) can.push(h('span', { class: 'dx-can d', text: 'delete' }));
          return h('div', { class: 'dx-acc-row' }, [
            h('div', { class: 'dx-acc-who' }, [
              h('div', { class: 'dx-acc-users' }, r.userRoles.length ? r.userRoles.map(function (u) { return h('span', { class: 'dx-urole', text: u }); })
                : [h('span', { class: 'dx-urole none', text: 'no user role carries it' })]),
              h('small', { class: 'mono', text: r.role })
            ]),
            h('div', { class: 'dx-acc-can' }, can),
            h('div', { class: 'dx-acc-rows-x' }, r.xpath
              ? [h('span', { class: 'dx-acc-k', text: 'only rows where' }), h('code', { class: 'dx-acc-x', text: prettyExpr(r.xpath) })]
              : [h('span', { class: 'dx-acc-all', text: 'every row' })])
          ]);
        }))]);
      }

      // ---------- model quality ----------
      function drawQuality() {
        var Q = data.quality;
        setTitle('Model quality', data.project);
        main.appendChild(crumbs([['Overview', function () { go({ view: 'start' }); }], ['Model quality']]));
        main.appendChild(h('div', { class: 'dx-kpis two' }, [tile(Q.unreached.length, 'nothing reaches'), tile(Q.disabled, 'disabled steps')]));
        function table(title, note, keys, row) {
          main.appendChild(h('h3', { class: 'dx-h', text: title + ' (' + keys.length + ')' }));
          main.appendChild(h('p', { class: 'dx-p', text: note }));
          if (!keys.length) { main.appendChild(h('div', { class: 'dx-note ok', text: 'None.' })); return; }
          main.appendChild(h('div', { class: 'dx-xl' }, keys.map(row)));
        }
        function flowRow(k) {
          var f = data.flows[k];
          return h('button', { type: 'button', class: 'dx-xl-row link', onclick: function () { openKey(k); } }, [h('span', { class: 'dx-badge' + kindClass(f.kind), text: badgeOf(f) }), h('b', { class: 'mono', text: f.qn }), h('small', { text: f.kind + ' ↗' })]);
        }
        table('Nothing reaches these', 'No microflow, page, menu, schedule, service or button in the model refers to them, and no role may run them directly. Candidates for removal — or for a reference that was forgotten. Marketplace modules are left out.', Q.unreached, flowRow);
      }

      draw();
      return { go: go, state: function () { return st; } };
    }

    // ================================================================ one flow, on its own
    // A flow's window in MxScout draws its Diagram with this: the same entry
    // and the same workflow the documentation shows.
    function flow(entry, opts) {
      opts = opts || {};
      var root = h('div', { class: 'dx dx-embed' });
      root.setAttribute('data-theme', themeOf(opts.theme || 'dark'));
      root.appendChild(flowView(entry, { known: opts.known, open: opts.open }));
      return root;
    }

    function fmtDate(iso) {
      var d = new Date(iso);
      if (isNaN(d)) return String(iso || '');
      function p(n) { return n < 10 ? '0' + n : String(n); }
      return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    return { mount: mount, flow: flow, logo: logo };
  }

  window.MxDocsView = factory();
  // The source of the reader, for the exported file (see docs.js).
  window.MxDocsView.source = '(' + factory.toString() + ')()';
})();
