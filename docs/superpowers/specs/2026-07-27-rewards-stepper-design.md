# Rewards Callout → Vertical Stepper Redesign

Date: 2026-07-27
Scope: `rewardsCard()` and its CSS in `index.html` only. No changes to book/progress tracking, Firestore sync, or the data model beyond how existing fields are interpreted.

## Background

The current Rewards card renders each milestone as a row with a circular radio-style checkbox, a milestone label, and a text input for the reward name. All not-yet-reached rows currently render the same "locked-but-editable" input (added in the previous change). This redesign replaces the radio-button metaphor with a vertical stepper, tightens the visual states, fixes a contrast failure on the section header, and moves the "Show recent only" control into a pill in the header.

## Data model

No new fields. Existing `data.rewardLabels` keeps its two kinds of entries:
- `rewardLabels[milestone]` — the reward's text label (string).
- `rewardLabels[milestone + '_done']` — whether the reward has been claimed (bool).

`reached` (`total >= milestone`) and `done` remain independent as they are today — a milestone can be reached without being claimed.

## Row state model (derived per render, in ascending milestone order)

For the set of milestones being rendered (`windowStart..milestoneCount`, unchanged windowing logic):

1. **Claimed** — `done === true`.
2. **Active** — the single earliest milestone in the rendered set where `done !== true`. Exactly one row (per book's total) is Active at a time; this is a change from today, where every reached-and-unclaimed row was independently interactive. Two visual/interactive sub-cases, both using the same accent-border row treatment:
   - **Active/ready** (`total >= milestone`): badge is a clickable ring button; clicking it sets `done = true` (claims the reward).
   - **Active/pending** (`total < milestone`): badge is a non-clickable "next goal" ring (no fill). The label input is still fully editable (carrying forward the "write your reward ahead of time" behavior from the last change), it just can't be claimed yet.
3. **Locked** — every rendered milestone after the Active one, regardless of whether `total` has technically already passed it (e.g. a big multi-page jump). Badge is a muted, disabled lock icon. Label and input are muted (~50% opacity). This is a one-at-a-time serial claim flow: a later milestone can't become interactive until the earlier one is claimed, even if pages already cover it — nothing is lost, the row just becomes interactive once its turn comes.

Clicking a Claimed badge again reverts it to unclaimed (`done = false`), same toggle behavior as today, which makes it the new Active row.

## Layout: vertical stepper

Each row becomes a two-column flex layout:
- **Node column** (fixed width, ~26px): a circular badge, then a 2px vertical connector line down to the next row (omitted on the last row). The line renders in dark green (`--cover`) when the row above it is Claimed, otherwise in the neutral `--rule` color — so the filled-in portion of the line visually tracks completed progress up the stepper.
- **Body column** (flex:1): milestone label line, then the reward label/input line.

This matches "Option B" from the mockup review (left accent border for the Active row, no full card highlight — chosen over Option A for being cleaner).

### Badge styling by state
- **Claimed**: solid `--cover` circle, white checkmark. `aria-label="Completed: {milestone} pages"`.
- **Active/ready**: outlined ring (accent border color, decorative — not required to meet text contrast since it carries no text), clickable `<button>`. `aria-label="Reward ready to claim: {milestone} pages"`.
- **Active/pending**: outlined ring, same accent border, non-interactive (`disabled`). `aria-label="Next goal: {milestone} pages"`.
- **Locked**: muted outline circle with a lock glyph, `disabled`. `aria-label="Locked: {milestone} pages"`.

### Row body by state
- **Claimed**: milestone label at full contrast (`--ink`). Reward shown as plain text (falls back to an italic "No reward set" hint if empty) + a small pencil icon-button. Clicking the pencil focuses the input for that row (input exists in the DOM at all times, positioned in place of the text while focused/being edited; on blur it re-renders as plain text). Saving still happens via the existing `change`-event handler on the input.
- **Active** (ready or pending): left accent border on the row (3px, accent color, matching Option B), milestone label in `--cover` (dark green — passes AA on cream, unlike the gold used today), input using the unified clean style (see below), fully enabled.
- **Locked**: milestone label and input both at ~50% opacity (acceptable under WCAG's inactive-component allowance — this is muted specifically because the row is non-interactive, not because it's ordinary body text). Input remains a real `<input>` so a value already typed is preserved, but it's `disabled` until the row becomes Active.

## Input styling unification

Single input style used everywhere (Claimed's hidden input, Active's input, Locked's input): light 1px `--rule` border, `border-radius:8px`, white/cream background, standard padding. No dashed underlines, no yellow/gold background fill. Locked variant is the same style at reduced opacity (via the row's muted wrapper) rather than a separate visual treatment.

## Header changes

- "REWARDS" (uppercase, gold, `.section-title`) → "Rewards" (sentence case). Gold fails AA on the cream card background (~2.1:1, computed), so this becomes its own header style using `--ink` at a readable size/weight, distinct from the shared `.section-title` class used by "Your books" and "Options" (those are unaffected — this ticket is scoped to Rewards only).
- "Show recent only" / "Show all (n) earlier hidden" moves from a left-aligned underlined text link below the rows to a pill-shaped toggle button in the top-right of the header row, next to "Rewards". Pill uses `--ink-soft`-on-`--page-warm` (passes AA) with a small filled/unfilled dot indicating on/off state, replacing the gold underlined link (also a contrast fix).

## Accessibility

- All three badge types get descriptive `aria-label`s as specified above.
- Interactive elements (Active/ready badge button, pencil button, inputs, recent-toggle pill) are real `<button>`/`<input>` elements, so keyboard tab order and Enter/Space activation work without extra JS.
- Locked and Active/pending badges are real `<button disabled>` elements (present in the tab order as disabled, standard behavior) rather than non-semantic divs, so screen readers still announce their label and state.
- Text contrast: every non-muted text/icon combination is checked against the AA 4.5:1 threshold on `--page`/`--page-warm` backgrounds; the two current failures (gold section header, gold "Show recent only" link) are fixed by this redesign. Muted (Locked-state) text is exempted per WCAG's treatment of inactive/disabled UI content.

## Responsiveness

No new breakpoints. The app is already a single-column, max-width-520px layout; the stepper's fixed 26px node column plus a flexible body column continues to fit down to narrow phone widths without horizontal scrolling. Inputs use `width:100%` within their flex body column rather than a fixed pixel width.

## Out of scope

- No change to how `total`, `interval`, or the recent-window (`showAllRewards`) logic compute which milestones are rendered.
- No change to import/export, Firestore sync, or the book-level data model.
- No change to the reward-interval settings input in the Options section.
