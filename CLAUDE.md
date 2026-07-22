# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Shelfmark is a single-page reading tracker PWA. There is no build system, package manager, or test suite — the entire app is `index.html` (HTML + CSS + vanilla JS in one `<script>` tag), plus `sw.js` (service worker) and `manifest.json` (PWA manifest). It's deployed as static files to GitHub Pages at `previsualconsent.github.io/shelf-mark/`.

## Development workflow

- There is no build step. Edit `index.html` directly and open it in a browser (or serve the directory, e.g. `python3 -m http.server`) to test changes.
- There are no automated tests or linter configured. Verify changes manually in a browser.
- Whenever a user-visible feature changes, bump `APP_VERSION` and add an entry to `VERSION_HISTORY` at the top of the `<script>` block in `index.html` (search for `/* ---------- version ---------- */`). The version is shown as a footer tag in the UI so old cached copies can be identified.
- The service worker (`sw.js`) cache-busts on `CACHE_NAME` — bump that string (e.g. `shelfmark-shell-v1` → `v2`) when shell files (`index.html`, `manifest.json`, icons) change, so installed PWA copies pick up updates.

## Architecture

Everything lives in `index.html`. Key sections of the inline script, top to bottom:

1. **Firebase setup** — Firestore is used for cross-device sync. `firebaseConfig` is not a secret (real access control is in `firestore.rules`); the `firebaseReady` flag gates sync on/off if the config is a placeholder.
2. **Roster** — a device can hold multiple "readers" (people), each identified by a `uid` (persisted in `localStorage` under `shelfmark-roster`). Readers are added to a device either locally (`createReader`) or by opening a share link containing `?add=<uid>&name=<name>` (handled by `mergeIncomingAddParam`).
3. **Storage** — each reader's data (`{ books, rewardLabels }`) is mirrored in both `localStorage` (`shelfmark-data-<uid>`) and Firestore (`people/<uid>` doc). `saveData()` writes both; `attachListener(uid)` subscribes to Firestore snapshots for live sync across devices and skips echoes of the local device's own pending writes (`snap.metadata.hasPendingWrites`).
4. **Data model** — a "book" has `{ id, title, targetPages, multiplier, entries, updatedAt }`. Reading progress is tracked as *entries* of `{ date, page }` — a book's pages-read is the max page number across its entries (not a sum), so logging progress means recording the current page, not pages read that session. `multiplier` (bonus factor) scales effective pages counted toward totals/milestones.
5. **Rendering** — no framework; `render()` clears and rebuilds `#app` based on a simple `view` state object (`{ screen: 'roster'|'home'|'book', bookId }`). Screens are built by `renderRoster()`, `renderHome()`, `renderBook(bookId)`, each returning a DOM node tree built with `innerHTML` + manual `addEventListener` wiring.
6. **Sheets (modals)** — bottom-sheet forms (add/edit book, log progress, add reader) are generic via `openSheet(html, onMount)` / `closeSheet()`, backed by `#sheetBackdrop` / `#sheetContent`.
7. **Import/export** — `exportData()`/`importData()` provide JSON backup/restore of a single reader's `data` (books + rewardLabels), independent of the Firestore sync.

`firestore.rules` is the actual security boundary: anyone can read `people/{uid}` docs, but writes must be limited to the `name`/`books`/`rewardLabels`/`updatedAt` fields and under ~900KB — there is no auth, so a reader's `uid` (embedded in share links) functions as the access secret.
