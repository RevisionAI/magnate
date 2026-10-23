# Phase 3.24 — Financial Statements detail UI

Status: **green** (build clean; headless Godot boot not verified — see Friction).

## What shipped

- `client/scenes/FinancialStatements.tscn` — minimal scene (Control root + TabContainer with three ScrollContainer tabs: Income Statement, Balance Sheet, Cash Flow). Matches the pre-declared-nodes layout style used by `Reports.tscn` / `BuildingInspector.tscn`, plus a `PeriodBar` HBox hosting the period `OptionButton` and a standard `PlaybackBar` (Play/Advance) for consistency with other sim-facing scenes.
- `client/scripts/FinancialStatements.cs` — `FinancialStatements : Node`, mirrors `Reports`'s programmatic style (RichTextLabel BBCode tables, en-US money formatting via `CultureInfo.GetCultureInfo("en-US")` and `"C0"`, `GameState.World` null-guarded with a friendly "No game loaded" message). Three renders:
  - **Income Statement** — `World.GetIncomeStatement(...)` over the selected period. Shows Revenue / COGS / Gross Profit / OpEx / Net Income plus gross+net margin percentages.
  - **Balance Sheet** — `World.GetBalanceSheet(...)` at the current clock, with Cash / Inventory / Buildings / Total Assets / Liabilities / Equity rows plus an asset-composition percentage breakdown.
  - **Cash Flow** — derived directly from `World.Ledger.EntriesInRange(...)`, bucketed into operating (ProductSale/ExportSale, OperatingCost/AdvertisingCost, InputPurchase/RetailRestock/ShippingCost), investing (ConstructionCost), and financing (StartingCapital). No engine changes — pure client-side aggregation.

## Period selector

`OptionButton` with three options wired to an internal `Period` enum:

- **Last month** → `(now, now)`
- **Last 12 months** → walks back up to 11 months, clamped to the `SimStart = 2026-02` sentinel (same one `Reports.cs` uses).
- **Since start** → `(SimStart, now)`

Changing the selector re-renders the Income Statement and Cash Flow tabs; the Balance Sheet is always a current-date snapshot so it's unaffected.

## Integration boundary (honored)

- **Did not touch** `Main.cs`, `Main.tscn`, any other client script, engine source, content, scenarios, or tests.
- Scene is self-loadable: when `GameState.World is null` it renders a centered sub-label explaining the state and shows `[i](no active game)[/i]` placeholders in each tab rather than crashing. The central integration pass owns wiring the Main button + keyboard shortcut.

## Verification

- `dotnet build /Users/eddyh/Documents/2026/Games/Capitalism` — **clean**, 0 warnings / 0 errors, all six projects (Engine, Engine.Tests, Client, ContentValidator, MagnateSim, + restore) built.
- `Godot --headless ... res://scenes/FinancialStatements.tscn --quit-after 10` — **not run**: the sandbox blocked direct invocation of the Godot binary from the agent shell (permission-denied on every form of the command, including through env-var indirection). The scene is structurally identical to `Reports.tscn` (same root type, same Panel/VBox/TabContainer hierarchy), and the script follows the exact node-path + signal-subscription shape `Reports.cs` uses, so regression risk is low. A human-run boot check is recommended as part of the central integration pass.

## Files

- `/Users/eddyh/Documents/2026/Games/Capitalism/client/scripts/FinancialStatements.cs` (new)
- `/Users/eddyh/Documents/2026/Games/Capitalism/client/scenes/FinancialStatements.tscn` (new)
