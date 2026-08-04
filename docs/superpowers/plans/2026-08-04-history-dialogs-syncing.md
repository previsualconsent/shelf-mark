# Back-button history, themed dialogs, syncing state — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GitHub issues #59 (back button exits the app instead of navigating screens), #53 (native `prompt`/`alert`/`confirm` break the themed aesthetic), and #54 (no way to tell "syncing" apart from "empty").

**Architecture:** All three fixes live entirely in `index.html`'s inline `<script>` — no build step, no other files change. #59 adds `history.pushState`/`popstate` around the existing `store.view` screen-stack and the existing `openSheet`/`closeSheet` sheet primitive. #53 adds three small helpers (`alertSheet`/`confirmSheet`/`promptSheet`) built on the same `openSheet` primitive, then swaps in the 9 existing native-dialog call sites. #54 adds a per-uid `hasSyncedOnce` flag read by the two places pages-read totals are rendered.

**Tech Stack:** Vanilla JS, no framework, no bundler. Manual browser verification only — this repo has no test runner (see `CLAUDE.md`). Verification steps below use the local dev server (`node dev-server.js`) with `?dev=<fixture>` URLs and Playwright MCP browser tools, per the project's documented workflow.

## Global Constraints

- Do NOT bump `APP_VERSION`, `VERSION_HISTORY`, or `sw.js`'s `CACHE_NAME` — those are bumped only in the dedicated `main`→`prod` deploy PR, never in a feature PR.
- No new files, no new CSS classes unless explicitly noted — follow the existing pattern of inline `style` attributes for one-off sheet text (see `openMilestoneCelebration`'s message div at index.html:395-397).
- Every sheet UI added must use the existing `openSheet(html, onMount)` / `closeSheet()` primitives (index.html:1028-1034) and existing `.field`, `.btn`, `.btn-row`, `.btn-secondary`, `.btn-primary`, `.btn-danger` CSS classes — do not invent new dialog machinery.
- Always start the dev server with the Bash tool's `run_in_background: true` option and stop it with `TaskStop` when done — never `&`. Confirm it started by reading its output for the `Shelfmark dev server: http://localhost:<port> ...` line, not `curl`.
- Always drive Playwright against a `?dev=<fixture>` URL (e.g. `?dev=sample`), never the bare root — the bare root hits a blocking `prompt()` dialog Playwright can't reliably answer. (Task 4 removes that `prompt()`, but until Task 4 lands, keep using `?dev=` for testing.)
- Playwright screenshots (if taken) must use `filename: '.playwright-mcp/<name>.png'`.

---

### Task 1: Screen-transition history (pushState / popstate for screens, no sheets yet)

**Files:**
- Modify: `index.html:284-292` (store definition), `:411-419` (render), `:464-467` (roster row click), `:509` (add-reader save), `:524` (home→roster back), `:703` (import success), `:749` (book card click), `:922` (renderBook not-found guard), `:930` (book→home back), `:1212-1230` (init)

**Interfaces:**
- Produces: `historyStateFor(view)` — `(view: {screen, bookId}) => {screen, bookId}` (normalizes `bookId` to `null` if omitted). `navigateTo(view)` — sets `store.view`, pushes a history entry via `historyStateFor`, calls `render()`. Both are used by Task 2 (sheets) and by the call sites in this task.
- Consumes: existing `store.view`, `render()`, `renderHome()`.

- [ ] **Step 1: Add `historyStateFor` and `navigateTo`, and a `popstate` listener**

Add right after the `store` object definition (`index.html:292`, after the closing `};` of `const store = {...}`):

```js
function historyStateFor(view){
  return { screen: view.screen, bookId: view.bookId || null };
}
function navigateTo(view){
  store.view = view;
  history.pushState(historyStateFor(view), '');
  render();
}
window.addEventListener('popstate', (e)=>{
  const state = e.state || { screen: store.roster.length > 1 ? 'roster' : 'home', bookId: null };
  store.view = { screen: state.screen, bookId: state.bookId || null };
  render();
});
```

(This popstate handler will grow a "skip stale sheet marker" branch in Task 2 — that's expected, don't worry about sheets yet.)

- [ ] **Step 2: Replace the 6 user-triggered `store.view = {...}; render();` call sites with `navigateTo(...)`**

`index.html:464-467`, inside `renderRoster()`'s roster-row click handler:

```js
    el.addEventListener('click', (e)=>{
      if(e.target.closest('[data-share]')) return;
      selectPerson(r.uid); render();
    });
```
→
```js
    el.addEventListener('click', (e)=>{
      if(e.target.closest('[data-share]')) return;
      selectPerson(r.uid);
      navigateTo(store.view);
    });
```

`index.html:509`, inside `openAddReaderSheet`'s save handler (leave `closeSheet()` as-is for now — Task 2 revisits this exact line):
```js
      closeSheet();
      store.view = { screen:'roster' };
      render();
      showShareLink(newUid);
```
→
```js
      closeSheet();
      navigateTo({ screen:'roster', bookId:null });
      showShareLink(newUid);
```

`index.html:524`, `renderHome()`'s back-link:
```js
    back.addEventListener('click', ()=>{ store.view = { screen:'roster' }; render(); });
```
→
```js
    back.addEventListener('click', ()=> navigateTo({ screen:'roster', bookId:null }));
```

`index.html:703`, `importData()` success path:
```js
    store.view = {screen:'home'};
    render();
    alert('Import complete.');
```
→
```js
    navigateTo({ screen:'home', bookId:null });
    alert('Import complete.');
```

`index.html:749`, `bookCard()` click handler:
```js
  el.addEventListener('click', ()=>{ store.view = {screen:'book', bookId:b.id}; render(); });
```
→
```js
  el.addEventListener('click', ()=> navigateTo({ screen:'book', bookId:b.id }));
```

`index.html:930`, `renderBook()`'s back-link:
```js
  back.addEventListener('click', ()=>{ store.view={screen:'home'}; render(); });
```
→
```js
  back.addEventListener('click', ()=> navigateTo({ screen:'home', bookId:null }));
```

- [ ] **Step 3: Fix the `renderBook` not-found guard to correct history in place, not push a new entry**

This one runs *during* a `render()` pass (it's a fallback inside `renderBook`, called from `render()` itself), so it must not call `navigateTo` (that would call `render()` recursively) or leave history out of sync with the corrected view.

`index.html:922`:
```js
  if(!b){ store.view={screen:'home'}; return renderHome(); }
```
→
```js
  if(!b){
    store.view = { screen:'home', bookId:null };
    history.replaceState(historyStateFor(store.view), '');
    return renderHome();
  }
```

- [ ] **Step 4: Set the initial history entry once `init()` has settled on a starting view**

`index.html:1222-1229`:
```js
  if(!devLoaded){
    if(store.roster.length <= 1){
      selectPerson(store.roster[0].uid);
    } else {
      store.view = { screen:'roster' };
    }
  }
  render();
```
→
```js
  if(!devLoaded){
    if(store.roster.length <= 1){
      selectPerson(store.roster[0].uid);
    } else {
      store.view = { screen:'roster', bookId:null };
    }
  }
  history.replaceState(historyStateFor(store.view), '');
  render();
```

- [ ] **Step 5: Manually verify screen navigation and back button**

Start the dev server in the background:
```bash
node dev-server.js 8123
```
(Use the Bash tool's `run_in_background: true`; confirm it started by reading its output for the `Shelfmark dev server:` line.)

Using Playwright:
1. Navigate to `http://localhost:8123/?dev=full-sample` (a fixture with multiple books, so roster/home/book screens are all reachable).
2. Click a book card → confirm the book detail screen renders.
3. Press the browser back button (`browser_navigate_back`) → confirm it returns to the home screen (not a blank tab / not leaving the page).
4. Click a book card again, then click "← Books" → confirm it returns to home; press back → since there's only one reader in this fixture, confirm back from home doesn't crash (goes to home again or a defined state, not an error).
5. Check console for errors (`browser_console_messages`) — should be empty.

Stop the dev server with `TaskStop`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Push browser history entries on screen transitions (#59)

Wires history.pushState/popstate around the existing store.view screen
stack so the back button navigates within the app instead of leaving it.
Sheets are not yet history-aware — that's the next commit.
EOF
)"
```

---

### Task 2: Sheet history integration (back button closes an open sheet)

**Files:**
- Modify: `index.html:1025-1034` (`openSheet`/`closeSheet`), the `popstate` listener added in Task 1, and the sheet call sites that both close a sheet *and* navigate or open another sheet: `index.html:509` (add-reader save, revisited), `index.html:1139-1144` (delete-book confirm+action), `index.html:1195-1209` (log-progress save, which may chain into `openMilestoneCelebration`).

**Interfaces:**
- Produces: `hideSheetUI()` — hides the sheet DOM without touching history (for call sites that immediately navigate or open another sheet afterward). `closeSheet()` keeps its existing signature but now also consumes its own history entry via `history.back()` when safe (i.e. when nothing else touches history in the same call).
- Consumes: `historyStateFor`, `navigateTo` from Task 1.

**Why the `hideSheetUI` / `closeSheet` split:** `history.back()` triggers `popstate` asynchronously. If a call site did `closeSheet(); navigateTo(x)` back-to-back, the pending `back()` and the immediate `pushState` from `navigateTo` could race. So: plain "just dismiss this sheet, nothing else happens" call sites keep using `closeSheet()` (safe — nothing else touches history afterward). Call sites that close a sheet *and then* immediately navigate or open another sheet use `hideSheetUI()` instead, leaving a stale history entry behind; the `popstate` handler's new "skip stale sheet marker" branch transparently skips over it the next time the user presses back.

- [ ] **Step 1: Push a history entry when a sheet opens; make `closeSheet` consume it when safe; add `hideSheetUI`**

`index.html:1025-1034`:
```js
/* ---------- sheets (modals) ---------- */
const backdrop = document.getElementById('sheetBackdrop');
const sheetContent = document.getElementById('sheetContent');
function openSheet(html, onMount){
  sheetContent.innerHTML = html;
  backdrop.classList.add('open');
  if(onMount) onMount(sheetContent);
}
function closeSheet(){ backdrop.classList.remove('open'); sheetContent.innerHTML=''; }
backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) closeSheet(); });
```
→
```js
/* ---------- sheets (modals) ---------- */
const backdrop = document.getElementById('sheetBackdrop');
const sheetContent = document.getElementById('sheetContent');
function openSheet(html, onMount){
  sheetContent.innerHTML = html;
  backdrop.classList.add('open');
  history.pushState({ ...historyStateFor(store.view), sheet:true }, '');
  if(onMount) onMount(sheetContent);
}
/* Hides the sheet without touching history — use this when the caller is
   about to navigate or open another sheet right after, to avoid racing
   with closeSheet()'s history.back(). */
function hideSheetUI(){ backdrop.classList.remove('open'); sheetContent.innerHTML=''; }
function closeSheet(){
  hideSheetUI();
  if(history.state && history.state.sheet) history.back();
}
backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) closeSheet(); });
```

- [ ] **Step 2: Teach the `popstate` handler to close an open sheet, and to skip stale sheet markers**

In the `popstate` listener added in Task 1 (right after the `store` definition):
```js
window.addEventListener('popstate', (e)=>{
  const state = e.state || { screen: store.roster.length > 1 ? 'roster' : 'home', bookId: null };
  store.view = { screen: state.screen, bookId: state.bookId || null };
  render();
});
```
→
```js
window.addEventListener('popstate', (e)=>{
  const state = e.state || { screen: store.roster.length > 1 ? 'roster' : 'home', bookId: null };
  if(state.sheet){
    // Landed on a sheet's history marker that's no longer showing
    // (its sheet was already dismissed via hideSheetUI) — skip past it.
    history.back();
    return;
  }
  hideSheetUI();
  store.view = { screen: state.screen, bookId: state.bookId || null };
  render();
});
```

- [ ] **Step 3: Fix the add-reader-save call site (Task 1 made it call `closeSheet()` then `navigateTo` — that's the race case, switch to `hideSheetUI`)**

`index.html:509` area (as left by Task 1):
```js
      closeSheet();
      navigateTo({ screen:'roster', bookId:null });
      showShareLink(newUid);
```
→
```js
      hideSheetUI();
      navigateTo({ screen:'roster', bookId:null });
      showShareLink(newUid);
```

- [ ] **Step 4: Fix the delete-book call site the same way**

`index.html:1139-1144`:
```js
    root.querySelector('#f-delete').addEventListener('click', ()=>{
      if(confirm('Delete "'+b.title+'" and all its history?')){
        store.data.books = store.data.books.filter(x=>x.id!==bookId);
        saveData(); closeSheet(); store.view={screen:'home'}; render();
      }
    });
```
→
```js
    root.querySelector('#f-delete').addEventListener('click', ()=>{
      if(confirm('Delete "'+b.title+'" and all its history?')){
        store.data.books = store.data.books.filter(x=>x.id!==bookId);
        saveData();
        hideSheetUI();
        navigateTo({ screen:'home', bookId:null });
      }
    });
```
(This still uses native `confirm()` — Task 4 swaps it for `confirmSheet`, reusing this same body unchanged.)

- [ ] **Step 5: Fix the log-progress save handler, which may chain into `openMilestoneCelebration` (another `openSheet` call)**

`index.html:1195-1206`:
```js
    root.querySelector('#f-save').addEventListener('click', ()=>{
      const date = root.querySelector('#f-date').value || todayStr();
      const page = parseInt(pageInput.value, 10);
      if(isNaN(page) || page < 0) return;
      const beforeTotal = totalPagesRead(store.data.books);
      b.entries = b.entries.filter(e=>e.date!==date);
      b.entries.push({date, page});
      b.updatedAt = Date.now();
      saveData(); closeSheet(); render();
      const afterTotal = totalPagesRead(store.data.books);
      const crossedMilestone = newlyCrossedMilestone(beforeTotal, afterTotal);
      if(crossedMilestone) openMilestoneCelebration(crossedMilestone);
    });
```
→
```js
    root.querySelector('#f-save').addEventListener('click', ()=>{
      const date = root.querySelector('#f-date').value || todayStr();
      const page = parseInt(pageInput.value, 10);
      if(isNaN(page) || page < 0) return;
      const beforeTotal = totalPagesRead(store.data.books);
      b.entries = b.entries.filter(e=>e.date!==date);
      b.entries.push({date, page});
      b.updatedAt = Date.now();
      saveData(); hideSheetUI(); render();
      const afterTotal = totalPagesRead(store.data.books);
      const crossedMilestone = newlyCrossedMilestone(beforeTotal, afterTotal);
      if(crossedMilestone) openMilestoneCelebration(crossedMilestone);
    });
```

- [ ] **Step 6: Manually verify sheet + back-button interplay**

Start the dev server in the background (`run_in_background: true`), then with Playwright against `http://localhost:8123/?dev=full-sample`:
1. Open a book, click the "⋯" (More) button → sheet opens.
2. Press back (`browser_navigate_back`) → confirm the sheet closes and you're still on the book detail screen (not bumped to home).
3. Press back again → confirm you now go to home.
4. Go to a book, open "⋯", click "Close" (plain dismiss) → sheet closes. Press back once → confirm you go straight to home (not a wasted no-op back press).
5. Go to a book, open "⋯", click "Delete this book" and confirm the native `confirm()` → confirm you land on home with no sheet showing. Press back → confirm you don't get stuck cycling through stale sheet markers (should resolve to a normal screen, e.g. roster or home, within one or two back presses) and check the console (`browser_console_messages`) for errors.
6. Log progress on a book with a fixture where the multiplier/target doesn't matter, entering a page number that doesn't cross a milestone — confirm the entry sheet closes normally and back button still works afterward.

Stop the dev server with `TaskStop`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Make the back button close open sheets before leaving a screen (#59)

Sheets now push their own history marker on open; closeSheet() consumes
it via history.back() when safe, while call sites that close-then-navigate
use the new hideSheetUI() to avoid racing pushState against a pending
history.back(). A stale marker left behind by such a combo is silently
skipped by the popstate handler.
EOF
)"
```

---

### Task 3: `alertSheet` / `confirmSheet` / `promptSheet` helpers

**Files:**
- Modify: `index.html` — add three new functions directly after `closeSheet()`/the backdrop click listener (i.e. right after the code Task 2 left at the end of the "sheets (modals)" section, before `document.getElementById('fab')...`).

**Interfaces:**
- Produces:
  - `alertSheet(message: string): void` — shows `message` with a single "OK" button.
  - `confirmSheet(message: string, onConfirm: () => void): void` — shows `message` with Cancel/Confirm; `onConfirm` runs after the sheet closes.
  - `promptSheet(message: string, defaultValue: string, onSubmit: (value: string) => void, opts?: { cancelable?: boolean }): void` — shows `message` + a text input (seeded with `defaultValue`) with Cancel/Save (Cancel omitted if `opts.cancelable === false`); `onSubmit(inputValue)` runs after the sheet closes.
- Consumes: `openSheet`, `closeSheet`, `hideSheetUI`, `escapeHtml` (all already defined).

- [ ] **Step 1: Write the three helpers**

Insert after the backdrop click listener (right after `backdrop.addEventListener('click', (e)=>{ if(e.target===backdrop) closeSheet(); });`, before `document.getElementById('fab').addEventListener('click', openAddBookSheet);`):

```js
function alertSheet(message){
  openSheet(`
    <div style="font-family:'Inter',sans-serif; font-size:14px; color:var(--ink-soft); margin-bottom:16px; white-space:pre-wrap;">${escapeHtml(message)}</div>
    <div class="btn-row">
      <button class="btn btn-primary" id="f-ok" style="width:100%;">OK</button>
    </div>
  `, (root)=>{
    root.querySelector('#f-ok').addEventListener('click', closeSheet);
  });
}

function confirmSheet(message, onConfirm){
  openSheet(`
    <div style="font-family:'Inter',sans-serif; font-size:14px; color:var(--ink-soft); margin-bottom:16px; white-space:pre-wrap;">${escapeHtml(message)}</div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="f-cancel">Cancel</button>
      <button class="btn btn-primary" id="f-confirm">Confirm</button>
    </div>
  `, (root)=>{
    root.querySelector('#f-cancel').addEventListener('click', closeSheet);
    root.querySelector('#f-confirm').addEventListener('click', ()=>{
      hideSheetUI();
      onConfirm();
    });
  });
}

function promptSheet(message, defaultValue, onSubmit, opts){
  const cancelable = !opts || opts.cancelable !== false;
  openSheet(`
    <div style="font-family:'Inter',sans-serif; font-size:14px; color:var(--ink-soft); margin-bottom:16px; white-space:pre-wrap;">${escapeHtml(message)}</div>
    <div class="field"><input id="f-prompt-input" type="text" value="${escapeHtml(defaultValue||'')}"></div>
    <div class="btn-row">
      ${cancelable ? `<button class="btn btn-secondary" id="f-cancel">Cancel</button>` : ''}
      <button class="btn btn-primary" id="f-submit">Save</button>
    </div>
  `, (root)=>{
    const input = root.querySelector('#f-prompt-input');
    if(cancelable) root.querySelector('#f-cancel').addEventListener('click', closeSheet);
    root.querySelector('#f-submit').addEventListener('click', ()=>{
      const value = input.value;
      hideSheetUI();
      onSubmit(value);
    });
    input.focus();
  });
}
```

Note both `confirmSheet`'s Confirm handler and `promptSheet`'s Save handler use `hideSheetUI()`, not `closeSheet()` — their callbacks (`onConfirm`/`onSubmit`) are caller-supplied and may themselves call `navigateTo` or re-open another sheet (e.g. Task 4's `ensureInitialReader` re-asking on an empty name), so they must avoid the same close+navigate race Task 2 fixed elsewhere.

- [ ] **Step 2: Manually verify the helpers in isolation**

Start the dev server in the background, then with Playwright against `http://localhost:8123/?dev=sample`, run each helper directly via `browser_evaluate` (they're not wired to any UI yet — that's Task 4):
1. `alertSheet('Test message')` → confirm a themed sheet appears with the message and an OK button; click OK → sheet closes.
2. `confirmSheet('Are you sure?', () => console.log('confirmed'))` → confirm Cancel closes without logging; re-run and click Confirm → confirm `confirmed` is logged (check via `browser_console_messages`) and the sheet closes.
3. `promptSheet('Name?', 'Default', (v) => console.log('submitted:', v))` → confirm the input shows "Default"; change it and click Save → confirm the typed value is logged.
4. Check the console for errors throughout.

Stop the dev server with `TaskStop`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Add alertSheet/confirmSheet/promptSheet helpers (#53)

Themed bottom-sheet replacements for window.alert/confirm/prompt, built on
the existing openSheet primitive. Not wired to any call sites yet.
EOF
)"
```

---

### Task 4: Replace native dialogs with the new sheet helpers

**Files:**
- Modify: `index.html:139-147` (`showShareLink`), `:235-242` (`ensureInitialReader`), `:690-709` (`importData`), `:1139-1146` (delete-book confirm, body already fixed in Task 2), `:1212-1230` (`init`, to await the now-async `ensureInitialReader`)

**Interfaces:**
- Consumes: `alertSheet`, `confirmSheet`, `promptSheet` from Task 3; `hideSheetUI`, `navigateTo` from Tasks 1–2.
- Produces: `ensureInitialReader(): Promise<void>` — same name, now truly asynchronous (previously it awaited a *blocking* `prompt()` inside a loop; now it returns a promise that resolves once the user submits a name via `promptSheet`). `init()`'s existing `await ensureInitialReader();` call keeps working unchanged.

- [ ] **Step 1: `showShareLink` — replace `alert`/`prompt` fallback**

`index.html:139-147`:
```js
function showShareLink(uid){
  const link = shareLinkFor(uid);
  const message = 'Send this link to the other device to add "'+rosterNameFor(uid)+'" there:\n\n'+link;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(link).then(()=> alert('Link copied!\n\n'+message)).catch(()=> prompt(message, link));
  } else {
    prompt(message, link);
  }
}
```
→
```js
function showShareLink(uid){
  const link = shareLinkFor(uid);
  const message = 'Send this link to the other device to add "'+rosterNameFor(uid)+'" there:\n\n'+link;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(link).then(()=> alertSheet('Link copied!\n\n'+message)).catch(()=> promptSheet(message, link, ()=>{}));
  } else {
    promptSheet(message, link, ()=>{});
  }
}
```
(The fallback `promptSheet` here is read-only in spirit — same as the old `prompt(message, link)`, which just let the user select/copy the pre-filled text; `onSubmit` is a no-op since there's nothing to do with the value.)

- [ ] **Step 2: `ensureInitialReader` — replace the blocking `prompt()` loop with a promise around `promptSheet`**

`index.html:235-242`:
```js
async function ensureInitialReader(){
  if(store.roster.length > 0) return;
  let name = '';
  while(!name){
    name = (prompt('Welcome to Shelfmark! Whose reading shelf is this?') || '').trim();
  }
  await createReader(name);
}
```
→
```js
function ensureInitialReader(){
  if(store.roster.length > 0) return Promise.resolve();
  return new Promise((resolve)=>{
    const ask = ()=>{
      promptSheet('Welcome to Shelfmark! Whose reading shelf is this?', '', async (name)=>{
        const trimmed = (name||'').trim();
        if(!trimmed){ ask(); return; }
        await createReader(trimmed);
        resolve();
      }, { cancelable:false });
    };
    ask();
  });
}
```
`init()` at `index.html:1212-1230` already does `await ensureInitialReader();` — no change needed there since the function still returns a promise that resolves once a reader exists.

- [ ] **Step 3: `importData` — replace 4 `alert`s and 1 `confirm`**

`index.html:690-709`:
```js
function importData(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    let parsed;
    try{ parsed = JSON.parse(reader.result); }
    catch(e){ alert('That file isn\'t valid Shelfmark data (couldn\'t read it as JSON).'); return; }
    if(!parsed || !Array.isArray(parsed.books) || !parsed.books.every(isValidBook) || (parsed.rewardLabels != null && !isValidRewardLabels(parsed.rewardLabels))){
      alert('That file isn\'t valid Shelfmark data.'); return;
    }
    const proceed = confirm('Import will replace all current books, history, and rewards with the contents of this file. Continue?');
    if(!proceed) return;
    store.data = { books: parsed.books, rewardLabels: normalizeRewardLabels(isValidRewardLabels(parsed.rewardLabels) ? parsed.rewardLabels : {}), rewardInterval: parsed.rewardInterval || 100 };
    saveData();
    navigateTo({ screen:'home', bookId:null });
    alert('Import complete.');
  };
  reader.onerror = ()=> alert('Could not read that file.');
  reader.readAsText(file);
}
```
→
```js
function importData(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    let parsed;
    try{ parsed = JSON.parse(reader.result); }
    catch(e){ alertSheet('That file isn\'t valid Shelfmark data (couldn\'t read it as JSON).'); return; }
    if(!parsed || !Array.isArray(parsed.books) || !parsed.books.every(isValidBook) || (parsed.rewardLabels != null && !isValidRewardLabels(parsed.rewardLabels))){
      alertSheet('That file isn\'t valid Shelfmark data.'); return;
    }
    confirmSheet('Import will replace all current books, history, and rewards with the contents of this file. Continue?', ()=>{
      store.data = { books: parsed.books, rewardLabels: normalizeRewardLabels(isValidRewardLabels(parsed.rewardLabels) ? parsed.rewardLabels : {}), rewardInterval: parsed.rewardInterval || 100 };
      saveData();
      navigateTo({ screen:'home', bookId:null });
      alertSheet('Import complete.');
    });
  };
  reader.onerror = ()=> alertSheet('Could not read that file.');
  reader.readAsText(file);
}
```
(Note: `navigateTo({ screen:'home', bookId:null });` was already correct from Task 1 — this step only swaps the dialog calls and moves the replace logic inside `confirmSheet`'s callback since there's no more synchronous `proceed` boolean to check.)

- [ ] **Step 4: `openBookMoreSheet`'s delete confirmation — replace `confirm()`**

`index.html:1139-1146` (body already updated by Task 2 Step 4):
```js
    root.querySelector('#f-delete').addEventListener('click', ()=>{
      if(confirm('Delete "'+b.title+'" and all its history?')){
        store.data.books = store.data.books.filter(x=>x.id!==bookId);
        saveData();
        hideSheetUI();
        navigateTo({ screen:'home', bookId:null });
      }
    });
```
→
```js
    root.querySelector('#f-delete').addEventListener('click', ()=>{
      confirmSheet('Delete "'+b.title+'" and all its history?', ()=>{
        store.data.books = store.data.books.filter(x=>x.id!==bookId);
        saveData();
        hideSheetUI();
        navigateTo({ screen:'home', bookId:null });
      });
    });
```

- [ ] **Step 5: Manually verify no native dialogs remain and each flow works**

Start the dev server in the background, then with Playwright:
1. Navigate to the bare root `http://localhost:8123/` (a fresh profile / cleared localStorage — use `browser_evaluate` to run `localStorage.clear()` first if reusing a profile, then reload) → confirm the first-run "Whose reading shelf is this?" now appears as a themed sheet, not a native `prompt()`; try clicking Save with an empty input → confirm the sheet stays open (re-asks); type a name and Save → confirm a reader is created and you land on home.
2. Navigate to `http://localhost:8123/?dev=full-sample`. Go to Options → Export data (unaffected), then Import data with an invalid file (e.g. upload a non-JSON file if easy, or skip if awkward via Playwright) — or more simply, directly call `importData` with a bad `Blob` via `browser_evaluate` — confirm a themed alert sheet appears, not a native `alert()`.
3. Options → Import data with a valid exported backup file → confirm a themed confirm sheet appears ("Import will replace..."), Cancel it → confirm nothing changes; retry and Confirm → confirm data replaces and a themed "Import complete." alert sheet shows.
4. Open a book → "⋯" → "Delete this book" → confirm a themed confirm sheet appears (not native `confirm()`); Cancel it → book still exists; retry and Confirm → book is deleted, you land on home.
5. Options → "Share this shelf" → confirm either a themed "Link copied!" alert (if clipboard write succeeds in the test environment) or a themed prompt sheet with the link pre-filled (if it doesn't) — not a native dialog either way.
6. Check the console (`browser_console_messages`) for errors across all of the above.

Stop the dev server with `TaskStop`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Replace native prompt/alert/confirm with themed sheets (#53)

Wires alertSheet/confirmSheet/promptSheet into showShareLink,
ensureInitialReader, importData, and the delete-book confirmation —
the first-run "whose shelf is this" prompt was the biggest offender
since it's the very first thing a new user sees.
EOF
)"
```

---

### Task 5: Distinguish "syncing" from "actually empty"

**Files:**
- Modify: `index.html:164-174` (`loadCachedData`), `:195-212` (`attachListener`, `personTotalPages`), `:452-463` (`renderRoster` per-reader row), `:536,564-569` (`renderHome` shelf total)

**Interfaces:**
- Produces: `store.hasSyncedOnce` — a `{ [uid]: boolean }` map on the existing `store` object. `hasReaderSynced(uid)` — `(uid: string) => boolean`, true if Firebase isn't configured, the uid is dev/no-sync, or a snapshot/cached-data check has already confirmed this uid's data is real.
- Consumes: `firebaseReady`, `isDevNoSync` (existing).

- [ ] **Step 1: Add the `hasSyncedOnce` map and a `hasReaderSynced` helper**

`index.html:284-292`, add a field to `store`:
```js
const store = {
  roster: [],
  peopleCache: {},
  listeners: {},
  currentUid: null,
  data: { books: [], rewardLabels: {}, rewardInterval: 100 },
  view: { screen:'home', bookId:null },
  syncError: null,
};
```
→
```js
const store = {
  roster: [],
  peopleCache: {},
  listeners: {},
  currentUid: null,
  data: { books: [], rewardLabels: {}, rewardInterval: 100 },
  view: { screen:'home', bookId:null },
  syncError: null,
  hasSyncedOnce: {},
};
```

Add right after `personTotalPages` (`index.html:208-212`):
```js
function personTotalPages(uid){
  const pd = store.peopleCache[uid];
  if(!pd) return 0;
  return (pd.books||[]).reduce((sum,b)=>sum+bookEffectivePages(b),0);
}
```
→
```js
function personTotalPages(uid){
  const pd = store.peopleCache[uid];
  if(!pd) return 0;
  return (pd.books||[]).reduce((sum,b)=>sum+bookEffectivePages(b),0);
}
function hasReaderSynced(uid){
  return !firebaseReady || isDevNoSync(uid) || !!store.hasSyncedOnce[uid];
}
```

- [ ] **Step 2: Mark a uid as synced when real cached data is found, and on every Firestore snapshot**

`index.html:164-174`:
```js
function loadCachedData(uid){
  try{
    const raw = localStorage.getItem('shelfmark-data-'+uid);
    if(!raw) return { books: [], rewardLabels: {}, rewardInterval: 100 };
    const parsed = JSON.parse(raw);
    parsed.books = parsed.books || [];
    parsed.rewardLabels = normalizeRewardLabels(parsed.rewardLabels || {});
    parsed.rewardInterval = parsed.rewardInterval || 100;
    return parsed;
  }catch(e){ return { books: [], rewardLabels: {}, rewardInterval: 100 }; }
}
```
→
```js
function loadCachedData(uid){
  try{
    const raw = localStorage.getItem('shelfmark-data-'+uid);
    if(!raw) return { books: [], rewardLabels: {}, rewardInterval: 100 };
    store.hasSyncedOnce[uid] = true;
    const parsed = JSON.parse(raw);
    parsed.books = parsed.books || [];
    parsed.rewardLabels = normalizeRewardLabels(parsed.rewardLabels || {});
    parsed.rewardInterval = parsed.rewardInterval || 100;
    return parsed;
  }catch(e){ return { books: [], rewardLabels: {}, rewardInterval: 100 }; }
}
```

`index.html:195-207`:
```js
function attachListener(uid){
  if(!firebaseReady || store.listeners[uid] || isDevNoSync(uid)) return;
  store.listeners[uid] = personDocRef(uid).onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return; // echo of our own optimistic write
    const remote = snap.data();
    if(!remote) return;
    const fresh = { books: remote.books || [], rewardLabels: normalizeRewardLabels(remote.rewardLabels || {}), rewardInterval: remote.rewardInterval || 100 };
    store.peopleCache[uid] = fresh;
    try{ localStorage.setItem('shelfmark-data-'+uid, JSON.stringify(fresh)); }catch(e){}
    if(uid === store.currentUid) store.data = fresh;
    render();
  }, err=> console.error('Snapshot error for', uid, err));
}
```
→
```js
function attachListener(uid){
  if(!firebaseReady || store.listeners[uid] || isDevNoSync(uid)) return;
  store.listeners[uid] = personDocRef(uid).onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return; // echo of our own optimistic write
    const remote = snap.data();
    if(!remote) return;
    const fresh = { books: remote.books || [], rewardLabels: normalizeRewardLabels(remote.rewardLabels || {}), rewardInterval: remote.rewardInterval || 100 };
    store.peopleCache[uid] = fresh;
    store.hasSyncedOnce[uid] = true;
    try{ localStorage.setItem('shelfmark-data-'+uid, JSON.stringify(fresh)); }catch(e){}
    if(uid === store.currentUid) store.data = fresh;
    render();
  }, err=> console.error('Snapshot error for', uid, err));
}
```

- [ ] **Step 3: Show "Syncing…" in the roster row instead of a bogus "0 pages read"**

`index.html:452-463`:
```js
  store.roster.forEach(r=>{
    const el = document.createElement('div');
    el.className = 'card book-card';
    const total = personTotalPages(r.uid);
    el.innerHTML = `
      <div class="book-row">
        <div>
          <div class="roster-name">${escapeHtml(r.name)}</div>
          <div class="book-meta">${fmtNum(total)} pages read</div>
        </div>
        <button class="icon-btn" data-share="${r.uid}" title="Share link" aria-label="Share link for ${escapeHtml(r.name)}">${shareIconSvg()}</button>
      </div>`;
```
→
```js
  store.roster.forEach(r=>{
    const el = document.createElement('div');
    el.className = 'card book-card';
    const total = personTotalPages(r.uid);
    const synced = hasReaderSynced(r.uid);
    el.innerHTML = `
      <div class="book-row">
        <div>
          <div class="roster-name">${escapeHtml(r.name)}</div>
          <div class="book-meta">${synced ? `${fmtNum(total)} pages read` : 'Syncing…'}</div>
        </div>
        <button class="icon-btn" data-share="${r.uid}" title="Share link" aria-label="Share link for ${escapeHtml(r.name)}">${shareIconSvg()}</button>
      </div>`;
```

- [ ] **Step 4: Show "Syncing…" in the home screen's shelf total for the current reader**

`index.html:536` and `:564-569`:
```js
  const total = totalPagesRead(store.data.books);
  const interval = rewardInterval();
```
→
```js
  const total = totalPagesRead(store.data.books);
  const synced = hasReaderSynced(store.currentUid);
  const interval = rewardInterval();
```

```js
  shelf.innerHTML = `
    <div class="shelf-total">
      <div>
        <div class="num">${fmtNum(total)}</div>
        <div class="label">Total pages read</div>
      </div>
    </div>
```
→
```js
  shelf.innerHTML = `
    <div class="shelf-total">
      <div>
        <div class="num">${synced ? fmtNum(total) : '—'}</div>
        <div class="label">${synced ? 'Total pages read' : 'Syncing…'}</div>
      </div>
    </div>
```

- [ ] **Step 5: Manually verify with a simulated not-yet-synced reader**

There's no Firestore emulator in this project, so simulate the "listener attached but first snapshot hasn't arrived" state directly via `browser_evaluate` rather than a real cross-device share-link round trip.

Start the dev server in the background, then with Playwright against `http://localhost:8123/?dev=sample`:
1. `browser_evaluate`: confirm `hasReaderSynced('dev-sample')` returns `true` (dev fixtures are `isDevNoSync`, so they should never show "Syncing…").
2. `browser_evaluate`: run `store.roster.push({name:'Fake Fresh Reader', uid:'fake-uid-1'}); store.peopleCache['fake-uid-1'] = {books:[], rewardLabels:{}, rewardInterval:100}; render();` (this simulates a freshly-added share-link reader whose local cache defaults to empty and whose listener hasn't fired yet — do NOT call `loadCachedData`/`attachListener` for it, matching a real fresh-add). Navigate to the roster screen (if not already showing — with only one real reader plus this fake one, `renderRoster` may not be reachable via UI navigation since `store.roster.length <= 1` logic only applies at init; instead directly call `render()` after setting `store.view = {screen:'roster', bookId:null}` via `browser_evaluate`) and confirm the fake reader's row shows "Syncing…", not "0 pages read".
3. `browser_evaluate`: run `store.hasSyncedOnce['fake-uid-1'] = true; render();` and confirm the row now shows "0 pages read" for that reader.
4. Check the console for errors.

Stop the dev server with `TaskStop`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Show "Syncing…" instead of a bogus 0 for not-yet-synced readers (#54)

Tracks a per-uid hasSyncedOnce flag, set once real local cache data is
found or a reader's first Firestore snapshot arrives, so a freshly
share-linked reader isn't indistinguishable from an empty one.
EOF
)"
```
