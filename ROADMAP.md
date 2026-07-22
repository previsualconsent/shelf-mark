# Maintainability Roadmap

Tracks planned cleanup work from the 2026-07-22 code review. Update checkboxes as items land; bump `APP_VERSION` in `index.html` per the usual convention when a change is user-visible.

## 1. Extract pure calculation functions
- [ ] Move `bookPagesRead`, `bookMultiplier`, `bookEffectivePages`, `totalPagesRead` out of `index.html` into their own module.
- No data migration needed — pure code reorg.
- Highest test-value, lowest risk: good first step, and makes these functions unit-testable.

## 2. Split CSS into its own file
- [ ] Move the `<style>` block (`index.html:16-195`) into `styles.css`, linked via `<link rel="stylesheet">`.
- No data migration needed.
- Zero behavior risk; shrinks `index.html` for JS-focused edits.

## 3. Restructure `rewardLabels` (dual-key → nested object)
- [ ] Change shape from `{ [milestone]: label, [milestone+'_done']: bool }` to `{ [milestone]: { label, done } }`.
- [ ] **Requires migration** — existing readers have live Firestore/localStorage data in the old shape. Add a lazy on-read migration (normalize in `loadCachedData` and the Firestore `onSnapshot` handler); next `saveData()` persists the new shape. No admin script needed given the small, known reader set.
- Fixes a stringly-typed, typo-prone key scheme before more milestone features get added.

## 4. Tighten `importData()` validation
- [ ] Validate individual book shape (title, entries array, numeric pages) on import instead of only checking `Array.isArray(parsed.books)`.
- No data migration needed — only affects the import code path.

## 5. (Optional/lower priority) Global state cleanup
- [ ] Consider consolidating the six loose globals (`roster`, `peopleCache`, `listeners`, `currentUid`, `data`, `view`) into a single `store` object to make mutations greppable.
- No data migration needed.

## Notes
- No build system or test suite exists yet; each item above should remain independently shippable as a single-file static app.
- Firestore write failures currently fail silently to `console.error` (`saveData`, `createReader`) — not on this roadmap yet, but worth a follow-up if sync issues get reported.
