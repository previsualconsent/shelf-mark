# Design: back-button history, themed dialogs, syncing state

Three independent fixes for GitHub issues #59, #53, #54. Each touches `index.html` only; no shared code between them beyond the general render/state patterns already in the app.

## #59 — Browser back button should navigate screens, not exit the app

**Problem**: `store.view = { screen, bookId }` is a plain in-memory object with no browser history entries. Every screen transition (roster↔home↔book, ~10 call sites) does `store.view = {...}; render();` with no `pushState`. Pressing hardware/browser back leaves the PWA entirely.

**Approach**:
- Add a `pushHistory(view)` helper that calls `history.pushState({ screen: view.screen, bookId: view.bookId }, '')` and a `popHistory` handler wired to `window.addEventListener('popstate', ...)`.
- Every existing `store.view = {...}; render();` transition site becomes `navigateTo({...})`, a small wrapper that sets `store.view`, calls `pushHistory`, then `render()`.
- On `popstate`, read `event.state` (falling back to `{screen:'roster'}` if null, e.g. user reached the very first history entry) and set `store.view` + `render()` directly — **not** via `navigateTo`, so we don't push a duplicate entry.
- On initial load (`init()`), `history.replaceState(...)` the starting view so the first back-press has a defined entry to compare against, mirroring the existing `replaceState` already used in `mergeIncomingAddParam()`.
- **Sheets are in scope**: `openSheet()` also calls `pushHistory({ ...store.view, sheet: true })` (or similar marker) when opening, so a back-press while a sheet is open closes the sheet (via the `popstate` handler calling `closeSheet()`) instead of also changing screens. `closeSheet()`'s existing callers (Cancel buttons, backdrop click) don't need to change — they just won't have consumed the pushed history entry, which is fine; the next real back-press consumes it as a no-op screen-restate. To avoid a "back twice" experience when the user manually clicks Cancel/backdrop instead of pressing hardware back, `closeSheet()` should also call `history.back()` if the top history entry is the sheet-marker one it pushed — this keeps history and UI state in sync regardless of how the sheet was dismissed.

## #53 — Replace native `prompt`/`alert`/`confirm` with themed sheets

**Problem**: 9 call sites across `showShareLink`, `ensureInitialReader`, `importData`, and `openBookMoreSheet` use native dialogs, breaking the art-directed look. First-run reader naming (native `prompt`) is the worst offender since it's the first thing a new user sees.

**Approach** — three small helpers built on the existing `openSheet(html, onMount)`/`closeSheet()` primitive, modeled on `openAddBookSheet()` (form-style) and `openBookMoreSheet()` (button-menu style):

- `alertSheet(message)` → sheet with the message and a single "OK" button that calls `closeSheet()`. Replaces the 5 `alert()` calls (clipboard-copy confirmation in `showShareLink`, 4 import success/error messages in `importData`).
- `confirmSheet(message, onConfirm)` → sheet with the message and Cancel/Confirm buttons; Confirm calls `closeSheet()` then `onConfirm()`. Single-tap, same friction as today's native `confirm()`. Replaces the import-replace-warning and delete-book confirmations.
- `promptSheet(message, defaultValue, onSubmit)` → sheet with the message, a text `<input>` pre-filled with `defaultValue`, and Cancel/Save buttons; Save calls `closeSheet()` then `onSubmit(inputValue)`. Replaces first-run reader naming (`ensureInitialReader`) and the share-link clipboard-fallback in `showShareLink`.

All three are async-callback style (not `window.prompt`'s synchronous return), so call sites restructure slightly — e.g. `ensureInitialReader()` becomes event-driven rather than blocking on a returned value, similar to how `openAddReaderSheet`'s save handler already works today.

## #54 — Distinguish "syncing" from "actually empty"

**Problem**: A reader added via share link has no local cache; `personTotalPages`/`loadCachedData` default to `{books:[]}`, so "0 pages read" is shown identically whether the reader has no books or Firestore's first snapshot just hasn't arrived yet.

**Approach**:
- Add `store.hasSyncedOnce = {}` (a uid→bool map, in-memory only — no need to persist across reloads since a fresh page load re-attaches listeners and re-derives this).
- In `loadCachedData(uid)`, if an existing localStorage entry is found (not just the freshly-seeded default), immediately set `store.hasSyncedOnce[uid] = true` — a returning/offline reader with real cached data should never show "syncing".
- In `attachListener(uid)`'s `onSnapshot` callback, set `store.hasSyncedOnce[uid] = true` on every invocation (idempotent after the first) before calling `render()`.
- `renderRoster()`'s per-reader row and `renderHome()`'s shelf total both check `store.hasSyncedOnce[uid]` (falling back to `true` if Firebase isn't configured / `isDevNoSync`, so local-only/dev-fixture usage is unaffected) — if false, render "Syncing…" in place of the pages-read number/label.

## Scope / non-goals
- No changes to Firestore rules, sync logic, or data model — all three fixes are UI/state-plumbing only.
- #53's helpers are intentionally minimal (no generic "dialog queue" or animation system) — just enough to cover the 9 existing call sites.
- #59 does not add deep-linkable URLs (e.g. `#/book/123`) — history state carries `{screen, bookId}` but the URL bar itself doesn't need to change for this fix to work, since the issue is about back-button behavior, not shareable/bookmarkable URLs.
