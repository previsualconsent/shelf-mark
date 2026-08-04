/* Pure calculation helpers, shared between the app and any future tests.
   No module system in use elsewhere in this repo, so this attaches to the
   global scope like a plain script when loaded via <script src="calc.js">,
   but also exports via CommonJS when required from Node (e.g. a test runner). */
(function (global) {
  const SPINE_K_WIDTH = 0.22;
  const SPINE_W_MIN = 46;
  const SPINE_DEFAULT_UNKNOWN_WIDTH = 76;
  const SPINE_UNKNOWN_FILL_PX = 14;

  function hasKnownTargetPages(book) {
    const t = book.targetPages;
    return typeof t === 'number' && !isNaN(t) && t > 0;
  }

  function medianTargetPages(books) {
    const known = books.filter(hasKnownTargetPages).map(b => b.targetPages).sort((a, b) => a - b);
    if (!known.length) return null;
    const mid = Math.floor(known.length / 2);
    return known.length % 2 === 1 ? known[mid] : (known[mid - 1] + known[mid]) / 2;
  }

  function computeSpineWidth(book, books) {
    if (hasKnownTargetPages(book)) {
      return { widthPx: Math.max(book.targetPages * SPINE_K_WIDTH, SPINE_W_MIN), estimated: false };
    }
    const median = medianTargetPages(books);
    if (median) {
      return { widthPx: Math.max(median * SPINE_K_WIDTH, SPINE_W_MIN), estimated: true };
    }
    return { widthPx: SPINE_DEFAULT_UNKNOWN_WIDTH, estimated: true };
  }

  function computeSpineFill(book, heightPx) {
    const read = bookPagesRead(book);
    if (hasKnownTargetPages(book)) {
      const pct = Math.max(0, Math.min(1, read / book.targetPages));
      return { fillPx: Math.round(heightPx * pct), mode: 'proportional' };
    }
    if (bookIsCompleted(book)) {
      return { fillPx: heightPx, mode: 'full-muted' };
    }
    if (read > 0) {
      return { fillPx: Math.min(SPINE_UNKNOWN_FILL_PX, heightPx), mode: 'indeterminate' };
    }
    return { fillPx: 0, mode: 'empty' };
  }

  function computeSpineTicks(book, books, heightPx, fillPx) {
    let total = null;
    let estimatedTotal = false;
    if (hasKnownTargetPages(book)) {
      total = book.targetPages;
    } else {
      const median = medianTargetPages(books);
      if (median) { total = median; estimatedTotal = true; }
    }
    if (!total) return [];
    const tickCount = Math.floor(total / 100);
    const ticks = [];
    for (let n = 0; n < tickCount; n++) {
      const fromBottom = heightPx * ((n + 1) * 100 / total);
      ticks.push({
        topPx: Math.round(heightPx - fromBottom),
        muted: estimatedTotal || fromBottom <= fillPx
      });
    }
    return ticks;
  }

  function bookPagesRead(book) {
    if (!book.entries.length) return 0;
    return Math.max(...book.entries.map(e => e.page));
  }

  function bookMultiplier(book) {
    const m = parseFloat(book.multiplier);
    return (!m || m < 1) ? 1 : m;
  }

  function bookEffectivePages(book) {
    return Math.round(bookPagesRead(book) * bookMultiplier(book));
  }

  function bookAutoCompleted(book) {
    return !!book.targetPages && bookPagesRead(book) >= book.targetPages;
  }

  function bookIsCompleted(book) {
    return bookAutoCompleted(book) || !!book.completed;
  }

  function totalPagesRead(books) {
    return books.reduce((sum, b) => sum + bookEffectivePages(b), 0);
  }

  const api = {
    bookPagesRead, bookMultiplier, bookEffectivePages, totalPagesRead,
    bookAutoCompleted, bookIsCompleted,
    hasKnownTargetPages, medianTargetPages, computeSpineWidth, computeSpineFill, computeSpineTicks,
    SPINE_K_WIDTH, SPINE_W_MIN, SPINE_DEFAULT_UNKNOWN_WIDTH, SPINE_UNKNOWN_FILL_PX
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(global, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
