/* MxScout — Log analysis: a fixed-height virtual list.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy), https://github.com/RealMecowhy/MxDevSwissTool —
 * MIT License, Copyright (c) 2026 Mikołaj. Source: public/js/components/virtual-list.js, unchanged.
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
// Reusable fixed-height virtual list — renders only the rows in (and just around)
// the viewport, so a 2 000-row query list keeps ~30 DOM nodes instead of 2 000.
// Dependency-free; attaches window.createVirtualList. First consumer is the Log
// Query Extractor; the REST/WS Extractor (fala 4) reuses it for its own row list.
//
// Contract:
//   const vlist = createVirtualList({
//     container,              // a scrollable element (overflow-y: auto/scroll)
//     renderRow(item, index), // returns an HTMLElement for one row; positioning is
//                             // applied by the component, so don't set top/height
//     overscan                // extra rows above/below the viewport (default 6)
//   });
//   vlist.setItems(array);        // (re)bind data — measures row height, resets scroll
//   vlist.refresh();              // re-render the current window (e.g. after a
//                                 // selection change that restyles rows)
//   vlist.scrollToIndex(i, 'center' | 'start');
//   vlist.itemAt(i); vlist.indexOf(pred); vlist.length; vlist.destroy();
//
// Rows must be uniform height. The height is measured once per setItems from the
// first row, so CSS-variable spacing and theme changes are honoured automatically.

(function (root) {
  function createVirtualList(opts) {
    const container = opts.container;
    const renderRow = opts.renderRow;
    const overscan = opts.overscan != null ? opts.overscan : 6;

    let items = [];
    let rowHeight = 0;
    let lastStart = -1;
    let lastEnd = -1;

    // Absolutely-positioned rows live inside this relative spacer, whose height
    // reserves the full scroll range. flex:0 0 auto keeps a flex container from
    // shrinking it back to fit (which would kill scrolling).
    const sizer = document.createElement('div');
    sizer.className = 'vlist-sizer';
    sizer.style.position = 'relative';
    sizer.style.width = '100%';
    sizer.style.flex = '0 0 auto';

    function measureRowHeight() {
      if (!items.length) { rowHeight = 0; return; }
      const sample = renderRow(items[0], 0);
      if (!sample) { rowHeight = 0; return; }
      sample.style.position = 'absolute';
      sample.style.visibility = 'hidden';
      sample.style.left = '0';
      sample.style.right = '0';
      sizer.appendChild(sample);
      rowHeight = sample.offsetHeight || 0;
      sizer.removeChild(sample);
      if (!rowHeight) rowHeight = 34; // last-resort fallback if layout is unavailable
    }

    function placeRow(el, index) {
      el.style.position = 'absolute';
      el.style.top = (index * rowHeight) + 'px';
      el.style.left = '0';
      el.style.right = '0';
      el.style.height = rowHeight + 'px';
      el.style.boxSizing = 'border-box';
    }

    function paint(force) {
      if (!rowHeight || !items.length) { sizer.textContent = ''; lastStart = lastEnd = -1; return; }
      const viewTop = container.scrollTop;
      const viewH = container.clientHeight || 0;
      let start = Math.floor(viewTop / rowHeight) - overscan;
      let end = Math.ceil((viewTop + viewH) / rowHeight) + overscan;
      start = Math.max(0, start);
      end = Math.min(items.length, end);
      if (!force && start === lastStart && end === lastEnd) return;
      lastStart = start;
      lastEnd = end;

      sizer.textContent = '';
      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        const el = renderRow(items[i], i);
        if (!el) continue;
        placeRow(el, i);
        frag.appendChild(el);
      }
      sizer.appendChild(frag);
    }

    function onScroll() { paint(false); }
    container.addEventListener('scroll', onScroll, { passive: true });

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () { paint(true); });
      ro.observe(container);
    }

    return {
      setItems: function (next) {
        items = next || [];
        if (sizer.parentNode !== container) {
          container.textContent = '';
          container.appendChild(sizer);
        }
        measureRowHeight();
        sizer.style.height = (items.length * rowHeight) + 'px';
        container.scrollTop = 0;
        lastStart = lastEnd = -1;
        paint(true);
      },
      refresh: function () { paint(true); },
      scrollToIndex: function (index, align) {
        if (index < 0 || index >= items.length || !rowHeight) return;
        let top = index * rowHeight;
        if (align === 'center') {
          top -= Math.max(0, ((container.clientHeight || 0) - rowHeight) / 2);
        }
        container.scrollTop = Math.max(0, top);
        paint(true);
      },
      itemAt: function (index) { return items[index]; },
      indexOf: function (pred) { return items.findIndex(pred); },
      get length() { return items.length; },
      destroy: function () {
        container.removeEventListener('scroll', onScroll);
        if (ro) ro.disconnect();
        if (sizer.parentNode) sizer.parentNode.removeChild(sizer);
        items = [];
      }
    };
  }

  root.createVirtualList = createVirtualList;
})(typeof window !== 'undefined' ? window : self);
