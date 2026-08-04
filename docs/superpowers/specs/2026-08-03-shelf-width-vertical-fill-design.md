# Shelf Redesign: Width-Encodes-Size, Vertical Fill (Issue #29 follow-up)

Date: 2026-08-03
Scope: `renderHome()`'s shelf block in `index.html` (~lines 552-599), plus `.shelf`/`.spines`/`.spine*` rules in `styles.css` (~lines 64-124). One new helper added to `calc.js`. No data-model changes, no changes to Firestore sync, import/export, or any other screen.

Source spec: `/Users/phansen/Downloads/width-only-vertical-fill-spec.md` ("Shelf Mode — Width Only, Vertical Fill"), adapted to this app's actual field names and constraints (see §2).

## 1. Background

Today, each shelf spine's **height** encodes a book's total page count relative to the largest book currently on the shelf (`h = max(20, round((pages/maxPages)*118))`), and the shelf carries no reading-progress signal at all — progress bars only exist on the book detail/card view. Spines use flex-shrink to always fit the screen without scrolling.

This redesign replaces that entirely: spine **width** encodes total page count on a fixed, real px-per-page scale, height is constant across every spine, and a **vertical, bottom-up fill** shows reading progress directly on the shelf. This is a full swap of what the shelf visualizes — confirmed with the user, not an incremental tweak.

## 2. Data model mapping

No new fields. The source spec's abstract model maps onto this app's existing `book` object and helpers as follows:

| Spec field/concept | This app |
|---|---|
| `totalPages` | `book.targetPages` (number or `null`) — the reader's page goal, used as-is even though a reader could in theory set a partial goal rather than the book's true length (confirmed acceptable) |
| `pagesRead` | `bookPagesRead(book)` (calc.js) — max page across `book.entries`, defaults to 0 |
| `finished` | `bookIsCompleted(book)` (index.html) — `bookAutoCompleted` (`targetPages` reached) OR manual `book.completed` flag |
| `color` | `colorForBook(book.id)` (index.html) — deterministic hash into a fixed 6-color hex palette |

Note: `bookEffectivePages`/`totalPagesRead` (which apply the `multiplier` bonus for the reward total) are **not** used for shelf sizing or fill — the shelf reflects raw page progress against the raw goal, matching what the book detail view already shows.

## 3. Layout constants

```
K_WIDTH        = 0.22   // px per page, same ratio as the source spec
SPINE_W_MIN    = 46     // px floor for known-totalPages spines
FIXED_HEIGHT   = 120    // px, constant for every spine (mid of issue #29's 110-130 ask)

width  = max(targetPages * K_WIDTH, SPINE_W_MIN)   // known-total case
height = FIXED_HEIGHT
```

Shelf layout keeps today's **shrink-to-fit** behavior (flex-shrink, no horizontal scroll) rather than switching to a scrolling row — confirmed with the user as an acceptable approximation, consistent with the app's existing no-scroll shelf. `flex-basis` becomes the computed `width` above (replacing today's fixed `32px` basis); the existing `min-width:6px` floor stays as the shrink limit.

## 4. Visual encoding (known `targetPages`)

Each spine splits into two vertically stacked zones over the fixed height:

- **Unread zone** (top): a light/pale tint of the book's `colorForBook` color — "paper" look for pages not yet read.
- **Read zone** (bottom, fills upward): the book's full solid `colorForBook` color, height = `FIXED_HEIGHT * clamp(pagesRead/targetPages, 0, 1)`.

A book with `pagesRead >= targetPages` (or manually completed) reads as fully solid, since the fill covers the whole height — matching the reference mockup where near/fully-read spines (e.g. "The Hobbit", "Dune", "Atomic Habits") show no visible pale zone.

**Tick marks**: horizontal dashed lines every 100 pages read, spanning the **full spine height** (both zones), not just the unread zone. `tickCount = floor(targetPages/100)`, positioned bottom-up via `tickOffset(n) = FIXED_HEIGHT * ((n+1)*100/targetPages)`. Where a tick crosses the solid read zone, render it at reduced opacity/contrast against that zone so it doesn't disappear but doesn't fight the solid fill either (implementation detail: same dashed line, lower opacity variant layered via a color-mix or a semi-transparent overlay — exact CSS worked out during implementation).

Per the source spec, tick spacing is **book-relative** (a "100 pages" tick sits at a different height on a 200-page book than a 600-page book) since height carries no shared page scale in this mode — this is expected, documented behavior, not a bug.

**Title**: rendered vertically, always visible (no more tap-to-reveal), reading **bottom-to-top** (flipped from today's top-to-bottom `vertical-rl` — implementation: `writing-mode: vertical-rl` plus a 180° rotation, or equivalent). Text still truncates/ellipses if it doesn't fit the spine's height. This drops the current `spine-label` tap interaction and the `sizeSpineTitles()` width-based visibility toggle (`spine-has-title` class) entirely, since width is now always ≥ `SPINE_W_MIN` (46px), enough to render vertical text at the app's font sizes.

**Completion badge**: small gold circular checkmark badge pinned to the spine's **top-right corner**, overlapping the edge slightly (replacing today's top-center floating `✓`). Shown when `bookIsCompleted(book)` is true — this already encodes both the auto (`targetPages` reached) and manual completion paths, satisfying source-spec §5d (never inferred from `pagesRead` alone when `targetPages` is unknown; see §5 below for that case specifically).

## 5. Fallback: `targetPages` unknown

Unknown = `null`, `undefined`, `0`, or `NaN`.

**Width** — library estimate, per source spec §5a option 1:
1. Compute the median `targetPages` across the reader's own books that have a known (non-unknown) `targetPages`.
2. If no books in the reader's library have a known `targetPages` yet, fall back to a flat `DEFAULT_UNKNOWN_WIDTH = 76px`.
3. A spine using either the estimate or the hard default gets a **dashed border** (instead of the normal solid/no border) so it reads as visually distinct from real-data spines.

**Fill**:
- `pagesRead` is 0 or unknown → empty spine, no fill (identical to a not-yet-started book).
- `pagesRead > 0` but `targetPages` unknown → fixed indeterminate mark at the bottom (`UNKNOWN_TOTAL_FILL_PX = 14px`), rendered with a diagonal hatch pattern or muted/reduced-opacity tone — never the book's normal solid fill color, so it can't be mistaken for a real percentage.
- `bookIsCompleted(book)` true but `targetPages` unknown → full-height fill, but still in the muted/estimate styling (not the normal solid color), since completion is known but the page math isn't.

**Ticks**:
- No estimate available (falling back to the 76px hard default) → zero ticks; there's no denominator to place them against.
- Estimate available (median-based width) → ticks render using that estimate, at reduced opacity to flag them as approximate. If a real `targetPages` is later saved for that book, ticks recompute silently on next render — no special transition/animation.

**Badge**: only shown via `bookIsCompleted(book)`'s manual-`completed`-flag path when `targetPages` is unknown (never inferred from `pagesRead` alone, since there's no total to compare against) — this falls out of using `bookIsCompleted()` as-is, no special-casing needed.

## 6. Sort order

Spines render ordered by `updatedAt` **ascending** — the most recently changed book (created, edited, or logged against) appears **rightmost**. This replaces today's unsorted (array/creation-order) rendering. `archived` books remain excluded from the shelf (unaffected by this change) and still count toward the reward total (`totalPagesRead(store.data.books)` stays unfiltered).

## 7. State table (known vs. unknown `targetPages`)

| State | `targetPages` | `pagesRead` | Width | Fill | Ticks | Badge |
|---|---|---|---|---|---|---|
| Normal | known | 0 ≤ read ≤ total | `max(targetPages*K_WIDTH, SPINE_W_MIN)` | proportional, solid color, bottom-up | full height, book-relative spacing, full opacity | ✓ if `bookIsCompleted` |
| Unknown, unread | unknown | 0/unknown | estimate or 76px (dashed border) | none | none (or muted, if estimate used) | none |
| Unknown, in progress | unknown | known > 0 | estimate or 76px (dashed border) | fixed 14px indeterminate mark, muted/hatched | none (or muted, if estimate used) | none |
| Unknown, marked finished | unknown | n/a | estimate or 76px (dashed border) | full height, muted styling | none (or muted, if estimate used) | ✓ (via `completed` flag only) |

## 8. Out of scope

- No change to `.shelf-total`, `.reward-strip`, or any other Home-screen element outside the spines row.
- No change to `bookEffectivePages`/`totalPagesRead`/multiplier logic, book detail view, or the add/edit book sheets.
- No change to archived-book filtering logic or the reward-total calculation.
- No horizontal-scroll shelf (considered and explicitly declined in favor of keeping shrink-to-fit).
