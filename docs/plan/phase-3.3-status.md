# Phase 3.3 — Reports scene

**Goal**: put the engine's rich reporting surface (accrual P&L, WAC balance sheet, per-product margins, R&D progress, ad campaigns, live goal status) on screen. Pure UI wiring — zero new engine code.

## Delivered

### New scene — `Reports.tscn`

A full-window TabContainer with five tabs, each backed by a RichTextLabel (BBCode on):

| Tab | Content |
|---|---|
| **Income Statement** | Accrual P&L for the current month AND year-to-date. Revenue / COGS / Gross Profit / Opex / **Net Income**. Inline reminder that InputPurchase / RetailRestock / ShippingCost are capitalized to inventory (not Opex). |
| **Balance Sheet** | Assets section (Cash, Inventory at WAC, Buildings at cost, Total Assets), Liabilities (always 0 until debt lands), Equity, plus a note that the books close — equity = starting capital + cumulative NI. |
| **Per-Product P&L** | Sorted-by-margin table of every product the player sold, with Revenue / COGS / Marketing spend / Net / %. |
| **R&D and Ads** | Tech level + research progress per product the player engages with (retail OR production OR research). Active ad campaigns with product / city / channel / monthly budget / current brand (0-100). |
| **Goals** | Live goal evaluation via `ScenarioRunner.EvaluateGoals`. Each goal gets a progress bar `[█████░░░░░]`, achievement mark, and detail text. Tab is contextual: shows "(no active scenario)" on save-loads, "(sandbox mode)" for goal-free scenarios, and a "scenario won" message when every goal is green. |

### Main HUD integration

`Main.tscn` gained a **Reports** button in the second button row (alongside Save / Back to Title). Clicking it:
1. Pauses the sim (`_running = false`)
2. Transitions to `Reports.tscn`

Reports' Back button returns to `Main.tscn`. Since `GameState.World` is a static reference, the same `World` instance is resumed — all state survives the detour.

### `GameState.ActiveScenario` (new)

Added a nullable `Scenario` property so the Goals tab can evaluate live. `ScenarioPicker` sets it on Start. `SaveBrowser` leaves it null (scenario identity isn't in the save file yet — noted as future work).

### BBCode usage

RichTextLabels render bold for headings and tables, italic for explanatory notes, and `[color=green]` / `[color=yellow]` for goal status marks. No custom fonts — alignment relies on RichTextLabel's default proportional font; narrow columns with right-justified currency still look clean enough to read.

## Build status

- `dotnet build client` → **0 warnings, 0 errors**
- Engine regression: **120/120 tests passing**

No new engine tests in this phase — Reports is a pure read-only consumer of existing engine query methods (`GetIncomeStatement`, `GetBalanceSheet`, `GetProductProfitability`, `GetTech`, `GetResearchProgress`, `GetBrandAwareness`, `AdCampaigns`, `ScenarioRunner.EvaluateGoals`). Each was already covered by existing engine tests.

## The satisfying part

After 13 phases of building engine capability, the Reports scene is the first screen where it all lands in one place:

```
┌─ Reports ─────────────────────────────────────────────┐
│ Scenario: Soft Drink War  ·  Date: 2027-04  ·  Acme   │
│  ┌─ Tabs ─────────────────────────────────────────┐   │
│  │ [Income] [Balance] [Products] [R&D/Ads] [Goals]│   │
│  ├────────────────────────────────────────────────┤   │
│  │ Per-product P&L — 2026-02 → 2027-04            │   │
│  │                                                │   │
│  │ Product          Revenue     COGS   Marketing  │   │
│  │ soft_drink    $54,822,106  $42,377  $1,200,000 │   │
│  │ sugar          $2,304,000       $0          $0 │   │
│  │ sugarcane        $192,000       $0          $0 │   │
│  │ ...                                            │   │
│  └────────────────────────────────────────────────┘   │
│           [ Back ]                                    │
└───────────────────────────────────────────────────────┘
```

Accrual books. Vertical-chain margins. Tech level and research progress. Brand curves per city. Live goal bars. Every phase since 1.1 is visible on one screen.

## Out of scope (future)

- **Live-refresh while sim is running** — Reports renders once on scene enter. Returning to Main to tick and then reopening Reports re-renders. A periodic update or a "Refresh" button would be trivial.
- **Multi-period comparisons** — e.g. "this quarter vs last quarter". Engine already supports any date range; the UI just needs a period selector.
- **Company selector** — only the player's books are shown. A drop-down to inspect a competitor's reports (as you'd see in a stock-market screen later) is a natural addition.
- **Chart visualizations** — BBCode tables are fine for MVP, but NetIncome / cash / brand curves as sparklines would be much nicer. Godot can draw lines; adding a small charting helper is a Phase 3.5 candidate.
- **Scenario identity in save files** — `SaveBrowser` has no way to restore `ActiveScenario` on load. Adding a `ScenarioId` field to `WorldSaveFile` (schema v2) fixes this.

## Files

Added:
- `client/scenes/Reports.tscn`
- `client/scripts/Reports.cs`
- `docs/plan/phase-3.3-status.md`

Modified:
- `client/scripts/GameState.cs` (adds `ActiveScenario`)
- `client/scripts/ScenarioPicker.cs` (sets `ActiveScenario` on Start)
- `client/scenes/Main.tscn` (adds Reports button)
- `client/scripts/Main.cs` (Reports button handler, pauses on open)
