# Phase 3.43 — Activity Feed Enhancements

**Status:** Complete · 2026-04-24

## Goal
Upgrade the Phase 3.28 ActivityFeed (a flat scrolling text list) with filtering,
severity color-coding, search, per-month grouping, and live-tick refresh.

## Shipped

1. **Filter chips (CheckBoxes).** A row of nine multi-select toggles —
   Sales, Opex, Construction, Ads, R&D, Goals, Transfers, Milestones, Month —
   wired to a `_activeCategories` set. Default: all on.

2. **Severity color-coding.** Each `FeedEntry` carries a `Category` and an
   optional signed `Amount`. The dollar amount is rendered with magnitude/sign
   colors via `SeverityColor`: large inflow = bright green, large outflow =
   bright red, small = soft variant, opex / ads / transfers stay neutral grey.
   Milestones (goals, R&D, revenue thresholds, new buildings) use gold/cyan.

3. **Search box.** `LineEdit.TextChanged` re-renders the feed using
   case-insensitive substring match against text and the formatted dollar
   amount. A "Clear" button resets it.

4. **Per-month grouping.** Visible entries are partitioned by
   `(Year, Month)` preserving newest-first order. Each section is headed
   `═════ YYYY-MM — Net $±NN ═════` summing all `Amount` values in that
   month. Empty months are skipped.

5. **Live-tick refresh.** Existing `_Process` → `GameState.TickIfRunning`
   pattern preserved; new ledger entries (`world.Ledger.Entries[i]` from
   `_lastLedgerCount` onward) and transfers (`TransferLog`) are detected each
   tick and appended.

6. **New event sources.** Per-ledger-entry events (Sale / ExportSale / Opex
   / Ads / Construction / Restock / Shipping / Input) and TransferLog
   movements now feed the stream, classified by `ClassifyLedger`.

`MaxEntries` raised from 50 → 500 to give the new sources room.

## Deferred
- **Jump-to-month OptionButton (item 5)** — RichTextLabel scroll-to-anchor
  needs deeper plumbing; deferred.

## Verification
- `dotnet build` — clean, 0 warnings, 0 errors.
- `dotnet test engine/Magnate.Engine.Tests` — **179 / 179 pass** (baseline
  was 175; other Sprint 9 agents added 4).

## Files
- `client/scripts/ActivityFeed.cs` — extended.
- `client/scenes/ActivityFeed.tscn` — added FilterRow + SearchRow.
