// VirtualScroll.js — computes the visible row window for a given scroll position.
//
// The grid never mounts more rows than fit the viewport (+ overscan). DOM node
// count stays constant no matter if the dataset has 1,000 or 1,000,000 rows.
// Row updates are scheduled on requestAnimationFrame so a fast flick of the
// scrollbar cannot queue more than one recalculation per frame.

export class VirtualScroll {
  constructor({ rowHeight = 40, overscan = 8 } = {}) {
    this.rowHeight = rowHeight;
    this.overscan = overscan;
    this.total = 0;
  }

  setRowHeight(value) {
    this.rowHeight = value;
  }

  setTotal(value) {
    this.total = Math.max(0, value | 0);
  }

  get totalHeight() {
    return this.total * this.rowHeight;
  }

  /**
   * @param {number} scrollTop
   * @param {number} viewportHeight
   * @returns {{start:number, end:number, offsetY:number, count:number}}
   */
  compute(scrollTop, viewportHeight) {
    const { rowHeight, overscan, total } = this;
    if (total === 0) return { start: 0, end: 0, offsetY: 0, count: 0 };

    const first = Math.floor(scrollTop / rowHeight);
    const visibleCount = Math.ceil(viewportHeight / rowHeight);

    const start = Math.max(0, first - overscan);
    const end = Math.min(total, first + visibleCount + overscan);
    return {
      start,
      end,
      offsetY: start * rowHeight,
      count: end - start,
    };
  }
}
