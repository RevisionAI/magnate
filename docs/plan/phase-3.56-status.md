# Phase 3.56 — Tooltip adoption in Manage scene

First real-world adoption of the Phase 3.53 `Tooltip` framework. All work is
confined to `client/scripts/Manage.cs`; no scene edits, no framework changes,
no engine touches. Pattern established: a private `WireTooltips()` helper is
invoked from `_Ready` for stable controls; per-tab refresh helpers attach
their own tooltips inline because those tabs fully re-render each tick. The
framework's `TreeExiting` cleanup (Phase 3.53) makes re-attachment on freed
controls safe. Dynamic cost tooltip for the building-type picker is rebuilt
via `Tooltip.Attach(...)` (idempotent — it calls `Detach` internally) inside
the `ItemSelected` handler, avoiding tick flicker.

## Tooltips wired (14 total)

**Header / navigation**
- `BackButton` — "Back to the main menu. Simulation continues…"

**Build tab (stable, attached in `_Ready`)**
- `_buildFilterPicker` — category filter explanation
- `_buildCityPicker` — city placement, rent/demand scaling
- `_buildTypePicker` — dynamic: regenerates on selection with the current type's cost/opex/slots
- `_buildProductPicker` — first-slot configuration vs. skip
- `_buildPriceSpin` — retail price / elasticity note
- `_buildRestockSpin` — restock target semantics
- `_buildAffordBadge` — cash-on-hand vs. construction cost comparison
- `constructButton` — "[b]Construct[/b] … deducted immediately; opex begins next tick."

**Buildings tab (re-rendered each tick)**
- `sortPicker` — explains sort keys incl. `LedgerEntry.Building` cashflow attribution
- per-row `inspectButton` — opens BuildingInspector

**Campaigns tab (re-rendered each tick)**
- `channelPicker` — lists cost-per-point per channel pulled from `SimulationConstants` (TV $4k, Radio $5k, Newspaper $6k, Magazine $8k) + media-bonus note
- `budgetSpin` — lift formula: `(budget × media-bonus ÷ cost-per-point) × saturation`
- `reachLabel` — projected brand; cites `BrandDecayRate` 2%/mo
- per-campaign `cancelBtn` — cites decay rate

## Verification
- `dotnet build` — 0 errors, 209 pre-existing warnings.
- `dotnet test engine/Magnate.Engine.Tests` — 198/198 pass.
