# Handoff Note — World Cup 2026 Sticker Tracker

## What we're building

A multi-user web app for tracking Panini World Cup 2026 sticker collections (1003 stickers across 48 teams + Introduction + World Cup History + Coca-Cola Insert Set). Built as a vanilla HTML/CSS/JS SPA (no framework, no build step) with Supabase for auth + Postgres + RLS. Designed to feel like the physical album: team-color headers, flag-icons SVG flags, 4×5 sticker grids with the team-badge sticker (#1) gold-bordered and the team-photo sticker (#13) rendered landscape.

Family/friends each have their own account, see their own collection, and can trade duplicates with each other through a structured 4-step shipment workflow (sender ships → recipient confirms received → recipient ships → sender confirms received → completed). Reservations prevent committing the same duplicate to two trades at once.

## Current state — Phase 3 complete and verified

**Architecture:** Multi-page SPA with sidebar nav. Six sections, all functional:

1. **Album** — sticker grid, progress counter, filter bar.
2. **Wanted** — two tabs (I'm missing / Others are missing) × two group modes (By sticker / By person). Each row has a "Trade with X" jump button. Search filters by code/player in sticker mode, by name in person mode. Has a label filter strip (shows only when labels exist) and a "Manage labels" button.
3. **Trades** — pending + in-progress trades with Sent/Received milestone buttons + completed trades with trash icon to delete.
4. **Community** — member list with a label filter strip + "Manage labels" button. Each member row shows their labels as colored chips. Click a member → trade builder.
5. **Activity** — chronological feed of trade events (created/accepted/sent/received/completed/declined/cancelled) + member-joined events. Each event has a tinted-circle icon by tone (success/info/danger/muted). Capped at 100 events.
6. **Profile** — user info + sign out.

URL routing via `?view=xxx`, mobile drawer at ≤760px, notification badge on Trades nav for actionable items.

**Visual style:** Warm-neutral palette (cream `#FAF7F2`, white surfaces, warm stone borders, deep teal `#0F766E` accent). Inter font throughout with tight letter-spacing on big titles (700 weight, -0.025em tracking). Auto dark mode via `prefers-color-scheme`. Lucide line icons everywhere (no emoji in chrome). Frosted-glass top bar.

**Backend (Supabase):**
- Tables: `profiles`, `collections`, `trade_requests`, `trade_request_items`, **`labels`** (Phase 3), **`member_labels`** (Phase 3).
- RPCs: each shipment-milestone helper (`mark_sender_sent`, etc.) + `get_user_reservations` + `accept_trade_request` + `maybe_complete_trade`.
- RLS: writes locked per-user; reads of profiles/collections open to all authenticated users (needed for trade matching). Labels and member_labels are **owner-only** in both directions — your labels are invisible to other users.

## Phase 3 — Community labels (just shipped)

Private per-user labels for tagging community members.

- **Schema:** `labels` (id, owner_id, name, color, created_at) + `member_labels` (id, label_id, member_id, created_at, unique(label_id, member_id)). Both RLS-locked to owner_id = auth.uid(). member_labels RLS checks via `exists (select 1 from labels l where l.id = ... and l.owner_id = auth.uid())`.
- **UI:**
  - `#label-filter-bar` strip above the Community member list, with one chip per label + a dashed "Manage labels" button.
  - `#wanted-label-bar` strip above the Wanted controls (hidden when no labels exist).
  - Tiny colored chips next to each member's name in Community rows AND Wanted by-person rows.
  - Label manager modal (`#label-manager-modal`) with: create-row (name input + 7-color swatch picker + Create button), then each label as a row with Edit/Delete. Edit-expanded label shows rename + color picker + member checklist.
- **Scope decisions made:** Labels are private (per-user), filter strip + chips on member rows shipped, group chat **deferred to a later phase**. Sorting labeled members above unlabeled was discussed but **not built** (user only checked the filtering option, not sorting).

## Files changed in Phase 3

- **`app.js`** — added `LABEL_COLOR_PRESETS`, `labelsData`, `activeLabelFilter`, `activeWantedLabelFilter`, `labelManagerState`. New functions: `fetchLabels`, `createLabel`, `updateLabel`, `deleteLabel`, `addMemberToLabel`, `removeMemberFromLabel`, `refreshLabels`, `openLabelManager`, `closeLabelManager`, `renderLabelManager`, `renderLabelManagerRow`, `countLabelMembers`, `wireLabelManagerControls`, `renderLabelFilterBar`, `renderMemberLabelChip`, `renderWantedLabelBar`, `memberPassesWantedFilter`, `onWantedFilterChanged`. Rewrote `renderFamilyList` to use a structured info column with chips. Threaded `memberPassesWantedFilter` into both `computeWantedMatches` and `computeWantedByPerson`. Updated `renderWantedPersonRow` to render label chips on each row. Added `wireLabelManagerControls()` to init.
- **`index.html`** — added `<div id="label-filter-bar">` above family-list, added `<div id="wanted-label-bar">` above wanted-controls, added `#label-manager-modal` dialog at the end of body. Bumped CSS cache-buster to `?v=3`.
- **`styles.css`** — new ~250-line "LABELS (Phase 3)" block covering `.label-filter-bar`, `.label-chip`, `.label-chip-colored`, `.label-chip-dot`, `.label-manage-btn`, `.member-label-chip`, `.member-label-dot`, `.family-member-info`, `.family-member-name-line`, `.wanted-person-name-line`, `.label-manager-card`, `.modal-close-x`, `.label-create`, `.label-create-input`, `.label-color-picker`, `.label-swatch`, `.label-manager-list`, `.label-manager-row`, `.label-manager-row-header`, `.label-manager-row-body`, `.label-rename-wrap`, `.label-member-checklist`, `.label-member-row`.

## Open issues

- **Album width visually unchanged.** Earlier we tried bumping `max-width: 1200px` → `1600px` everywhere to recover dead space on wide displays. The file-on-disk changed (verified 0 matches for `1200px`) but the user reported the album still looked narrow even after Ctrl+Shift+R and a fresh tab. We added `?v=2` and then `?v=3` cache busters on `styles.css`. The user said "let's ignore for now." Could be browser zoom (Ctrl+0 to reset), could be a stubborn `file://` cache, could be a constraint I missed. If it surfaces again, start by checking `<main class="main-content">` computed `max-width` in DevTools Elements → Computed.

## What's next on the roadmap

- **Phase 4 polish** — invite link with QR code, completed-trade pagination, mobile testing pass. Browser push notifications for trade actions still parked.
- **Sorting labeled members above unlabeled in Wanted** — was a non-checked option in Phase 3 questions; revisit if the user asks.
- **Group chat per label** — explicitly deferred. Would need a `messages` table + Supabase Realtime subscriptions + read receipts. Standalone project.
- **Verify album max-width fix** — see "Open issues" above.

## Gotchas

- **Browser cache bites repeatedly.** `file://` URLs are extra-aggressive. The CSS link uses `?v=N` — bump it after meaningful CSS changes. Always mention Ctrl+Shift+R proactively. If that fails, close the tab and open in a fresh tab. If THAT fails, suspect zoom (Ctrl+0).
- **The publishable key in `supabase-config.js` is intentionally committed.** Designed to be client-visible; security is RLS, not key secrecy.
- **Never `--global` git config.** Repo-local only. User's commit identity: `hysam@users.noreply.github.com`.
- **Trade view "empty" bug** — duplicates-only filter MINUS reservations. If trades vanish, check `get_user_reservations` RPC wiring.
- **Status text is deliberately minimal.** Buttons say "Sent" / "Received". Badges say "Not sent" / "Sent" / "Received". Don't reintroduce verbose narration.
- **Sticker #13 is landscape** via `grid-column: span 2; aspect-ratio: 4/3; width: calc((100% - 8px) * 2 / 3)`. Multiple rounds of feedback — don't simplify.
- **Windows doesn't render flag emojis as flags.** Uses `flag-icons` CSS library + `getCountryCode(teamName)` helper. Don't switch back to emoji.
- **Trade row name is two-line.** Header row (flag/code/badge), name on its own line below with `min-width: 0`. Don't try to single-line it.
- **`stickers.js` and `styles.css` are large** — re-Read them if touching.
- **`color-mix(in srgb, ...)` is used in Phase 3 styles** for label chip tints. Requires Chrome 111+ / Firefox 113+ / Safari 16.2+. User is on modern Chrome on Windows — fine.
- **Lucide icon names that aren't obvious in code:** `arrow-left-right` (Trades), `circle-user-round` (Profile), `circle-user-round` again for avatars (we use plain initial in a tinted circle instead — no icon), `settings-2` for "Manage labels", `check-check` for completed trade rows, `package-check` for received items, `party-popper` for completed trades, `chevron-right` for member row arrows, `trash-2` for delete.
- **Confirm before destructive git operations.** Never `--no-verify`.

## Where to pick up

User just confirmed Phase 3 works ("it all works"). No active work. Wait for next ask. Likely candidates: Phase 4 polish, the album width issue, or some new feature they think of.
