# Phase 3.60 — Tooltip adoption in Reports + FinancialStatements

Sprint 13 parallel agent. Extends the Phase 3.53 Tooltip framework (adopted in
Manage at Phase 3.56) to two analytics scenes.

## Decision on tab labels

Used Godot's built-in `TabContainer.SetTabTooltip(int, string)` for tab-label
tooltips. Rationale: `TabContainer` exposes tab tooltips natively and uses the
engine's own hover timing, which is the least-surprising UX and avoids the
awkwardness of attaching the custom framework to a synthetic anchor. The
custom `Tooltip.Attach` helper is still used for all other controls (buttons,
period selector) so the scene gets the richer BBCode popup there. Both styles
coexist without interference.

## Reports.cs — 10 tooltips (3 custom + 7 built-in tab)

Wired in a single `WireTooltips()` called from `_Ready`. All targets are
stable controls; the live-tick `RefreshAll` only rewrites the RichTextLabel
contents, never rebuilds these headers.

| Control | Text snippet |
| --- | --- |
| `BackButton` | "Back to main menu. Sim continues in background." |
| `PlayButton` | "Play / Pause auto-advance. 1 real second = 1 in-game month." |
| `AdvanceButton` | "Advance 1 Month — steps sim + records snapshot for Trends." |
| Tab 0 — Income Statement | "Current-month + YTD accrual P&L: Rev − COGS − OpEx = Net." |
| Tab 1 — Balance Sheet | "Cash + Inventory (WAC) + Buildings (cost) = Equity." |
| Tab 2 — Per-Product P&L | "Per-product Revenue / COGS / marketing / net margin (YTD)." |
| Tab 3 — Exports | "Last 12 months of world-market exports by product + building." |
| Tab 4 — R&D and Ads | "Tech progress per product + active campaigns with brand." |
| Tab 5 — Goals | "Scenario victory conditions with progress bars." |
| Tab 6 — Trends | "Sparklines of Cash, Revenue, NetIncome, Brand, Tech." |

## FinancialStatements.cs — 7 tooltips (4 custom + 3 built-in tab)

| Control | Text snippet |
| --- | --- |
| `BackButton` | "Back to main menu. Sim continues in background." |
| `PlayButton` | "Play / Pause auto-advance." |
| `AdvanceButton` | "Advance 1 Month — steps sim + records snapshot." |
| `PeriodOption` | "Period — affects Income Statement + Cash Flow only. BS always 'as of now'." |
| Tab 0 — Income Statement | "Accrual P&L for the selected period, with gross + net margins." |
| Tab 1 — Balance Sheet | "Assets = Equity. Books close: Equity = StartingCapital + ΣNetIncome." |
| Tab 2 — Cash Flow | "Operating / Investing / Financing buckets derived from the ledger." |

## Verification

- `dotnet build` fails with **1 pre-existing error** in
  `engine/Magnate.Engine/Domain/BuildingType.cs:42` (CS1587: XML comment
  misplaced) — inside a positional-record parameter list. This is outside
  Phase 3.60 file ownership (owned by engine / sibling phase 3.59 upgrade-
  ladder work) and was not introduced by this phase's client-side edits.
- Client-side edits are isolated to two files and two `WireTooltips()`
  helpers + one call site each; `Tooltip.Attach` and `SetTabTooltip` usage
  mirrors the Phase 3.56 Manage.cs pattern.
- Tests not runnable until the engine error is fixed by its owner.

## Files touched

- `client/scripts/Reports.cs` — added `WireTooltips()` + `_Ready` call.
- `client/scripts/FinancialStatements.cs` — added `WireTooltips()` + `_Ready` call.
- `docs/plan/phase-3.60-status.md` (this file).

Scene files (`.tscn`) untouched — all targets already exist as named nodes.
