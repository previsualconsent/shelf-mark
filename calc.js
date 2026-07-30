/* Pure calculation helpers, shared between the app and any future tests.
   No module system in use elsewhere in this repo, so this attaches to the
   global scope like a plain script when loaded via <script src="calc.js">,
   but also exports via CommonJS when required from Node (e.g. a test runner). */
(function (global) {
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

  function totalPagesRead(books) {
    return books.reduce((sum, b) => sum + bookEffectivePages(b), 0);
  }

  const api = { bookPagesRead, bookMultiplier, bookEffectivePages, totalPagesRead };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(global, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
