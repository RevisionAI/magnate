# Phase 3.5 — Building Inspector

**Goal**: close the "one slot only" gap from Phase 3.4. After construction, the player couldn't add another slot, reprice a retail slot, or retarget a warehouse. The Building Inspector gives full ongoing control of an existing building.

## Delivered

### `GameState.SelectedBuilding`

New nullable `BuildingInstanceId?` stashed by the Manage scene before transitioning to the inspector. Cleared on game reset.

### Manage's Buildings tab — Inspect button per row

Each row in the owned-buildings list now gets an "Inspect" button. Clicking it sets `GameState.SelectedBuilding` and navigates to `BuildingInspector.tscn`.

### New scene — `BuildingInspector`

Three sections inside a scroll container:

**Inventory**
A 4-column grid: Product · Qty · WAC Cost · Avg Q. All products with positive quantity, sorted by cost basis descending. Reveals the weighted-average cost and quality values the Phase 2.1/2.2 plumbing tracks per product.

**Settings**
- **Auto-export** checkbox. Toggle on the fly. Takes effect immediately for the next monthly tick.

**Slots**
Each existing slot rendered on one row:
- **Production / Extraction / Research** — read-only; `[index] kind | product`. (Product is immutable once configured.)
- **Warehouse** — editable `TargetStock` SpinBox + Apply button. Writes directly to `slot.TargetStock`.
- **Retail** — editable `Price` + `RestockTarget` SpinBoxes + Apply button. Writes directly to `slot.Price` / `slot.RestockTarget`.

**Add slot** form (shown only if `TotalSlotsUsed(building) < type.MaxUnits`):
- Product dropdown (filtered for this building's category, same rules as Phase 3.4)
- Price + Restock target inputs (used by retail/warehouse only)
- Add-slot button picks the lowest unused integer in `[0, MaxUnits)` and routes to the right `ConfigureX`Slot API

After a successful add, the inspector re-renders so the new slot appears immediately.

### Direct mutation of public slot fields

Retail prices / restock targets and warehouse targets are edited by writing to the slot object directly:

```csharp
slot.Price = newPrice;
slot.RestockTarget = newTarget;
warehouseSlot.TargetStock = newTarget;
building.AutoExport = pressed;
```

These were all already `public { get; set; }` in the engine (Phase 1.6, 2.5). No engine changes.

### Error surface

Any exception from the engine (e.g. the engine's own slot-config validators: wrong category, slot index out of bounds, raw product in a production slot) turns the status label red with the exception message. Valid updates turn it green.

## What's still read-only

Deliberate, to avoid inventory / ledger complexity:

- **Slot product** — once configured, you can't rebind a slot to a different product. Workaround: the user would have to construct a new building.
- **Demolish** — no "sell building" action. Would need engine support for building removal + inventory disposition.
- **Delete slot** — similar; removing a slot mid-game has consequences we haven't designed yet (orphaned inventory, pending orders).

These land cleanly when we add real engine-level demolition. For Phase 3.5 the inspector is purely additive / edit-in-place.

## Build status

- `dotnet build client` → **0 warnings, 0 errors**
- Engine regression: **120/120 tests passing**

## End-to-end play loop after Phase 3.5

```
Title → New Game → Soft Drink War → Start (no autoplay)
  └→ Manage → Build → Construct supermarket w/ soft_drink @ $1.80
       └→ Manage → Buildings → Inspect B1
            └→ bump RestockTarget to 3,000,000 → Apply
            └→ add second slot: bread @ $3.00 RestockTarget 4M → Add slot
       └→ Manage → Campaigns → TV soft_drink $50k/mo → Apply
  └→ Main → Play  (watch the books fill up)
  └→ Main → Reports  (confirm Brand > 0, Net Income > 0)
  └→ Main → Save
```

## Files

Added:
- `client/scenes/BuildingInspector.tscn`
- `client/scripts/BuildingInspector.cs`
- `docs/plan/phase-3.5-status.md`

Modified:
- `client/scripts/GameState.cs` (adds `SelectedBuilding`)
- `client/scripts/Manage.cs` (Inspect button per building row)
