# Phase 3.4 — Human gameplay controls

**Goal**: stop spectating. Phases 3.1-3.3 built the client around an AI-driven player; 3.4 gives the human real controls — construct buildings, configure slots, run ad campaigns. The scenario picker now defaults to human play (the old spectator mode is opt-in via a checkbox).

## Delivered

### Scenario picker — AI autopilot is opt-in

`ScenarioPicker.tscn` gained a CheckBox: **"Let AI drive my company (spectator mode — no gameplay controls)"**. Default OFF. When ticked, `ScenarioPicker.cs` calls `world.RegisterAi(playerId, new AdaptiveStrategy())` as before — preserves the Phase 3.2 demo experience. Unticked, the player is unmanaged and the human is expected to drive via the Manage scene.

### New scene — `Manage.tscn`

Three-tab `TabContainer`:

| Tab | Controls |
|---|---|
| **Build** | City dropdown + Building-type dropdown + first-slot Product dropdown + Price SpinBox + Restock-target SpinBox + **Construct** button. The Product dropdown filters itself by the selected building type: extraction buildings show only their category's raws; retail buildings show finished goods; factories show their producible tiers; etc. |
| **Buildings** | Read-only list of player-owned buildings: id, type, city, one-line slot summary, top-3 inventory items. |
| **Campaigns** | Form to start or update an ad campaign (product + city + channel + monthly budget; 0 cancels). Below the form, a list of active campaigns with a Cancel button per campaign. |

All UI is built **programmatically** in `Manage.cs` rather than in scene files — easier to iterate, the `.tscn` stays ~20 nodes.

### Integration

- `Main.tscn` gained a **Manage** button in the second button row (alongside Reports, Save, Back to Title).
- `Main.cs` → `OnOpenManage` pauses the sim and transitions to `Manage.tscn`; Manage's Back button returns to Main.
- `Manage.cs` uses the same `GameState.World` instance — changes persist across scene transitions since `GameState` is static.

### Uses the existing engine API end-to-end

| Manage action | Engine call |
|---|---|
| Construct building | `World.Construct(playerId, typeId, cityId)` |
| Configure retail slot | `World.ConfigureRetailSlot(id, slot, product, price, restockTarget)` |
| Configure production slot | `World.ConfigureProductionSlot(id, slot, product)` |
| Configure extraction slot | `World.ConfigureExtractionSlot(id, slot, product)` |
| Configure warehouse slot | `World.ConfigureWarehouseSlot(id, slot, product, target)` |
| Configure research slot | `World.ConfigureResearchSlot(id, slot, product)` |
| Start / update / cancel campaign | `World.RegisterAdCampaign(company, product, city, channel, budget)` |

All of these were already public and fully tested in the engine — zero new simulation code this phase.

### Error handling

Any engine exception (insufficient cash, invalid slot, tier mismatch, etc.) surfaces in a status label with red tint. On success, the label turns green with a confirmation. Example:

- ✓ `Built Small Farm in metropolis (B3).`
- ✗ `Construction failed: company 'Acme Corp' has $50,000 but factory_large costs $5,000,000`

## Build status

- `dotnet build client` → **0 warnings, 0 errors**
- Engine regression: **120/120 tests passing**

## A real play session

1. Launch → Title → New Game
2. Scenario picker: select "Soft Drink War", leave the auto-play checkbox unticked, Start
3. Main: click **Manage**
4. Build tab: City=Metropolis, Building=Supermarket, Product=soft_drink, Price=$1.80, Restock=500000 → Construct
5. Back to Main, click **Play**
6. Watch RivalCo (the real AI) and you compete
7. When you have some cash, go back to Manage → Campaigns → TV ads for soft_drink in Metropolis at $50k/mo → Apply
8. Reports tab shows your books filling up over time
9. Save anytime via the Save button

## Out of scope (future)

- **Adding additional slots** to an existing building. Currently the Build flow configures slot 0 only; a richer "inspect building" view with an "add slot" affordance is the natural next step.
- **Repricing existing slots** — currently you have to rebuild. A cheap fix: clicking a row in the Buildings list opens a mini-editor with a price SpinBox.
- **Demolish / sell buildings** — no way to decommission a white elephant.
- **Pre-population helpers** — e.g. "build a soft_drink chain template" that places farm + sugar factory + drink factory + store with one click. Quality-of-life for later.
- **Keyboard shortcuts** — everything's mouse-clicked.
- **Visual feedback during construction** — no city map yet to actually place the building on.

## Files

Added:
- `client/scenes/Manage.tscn`
- `client/scripts/Manage.cs`
- `docs/plan/phase-3.4-status.md`

Modified:
- `client/scenes/ScenarioPicker.tscn` (auto-play CheckBox)
- `client/scripts/ScenarioPicker.cs` (honors checkbox)
- `client/scenes/Main.tscn` (Manage button)
- `client/scripts/Main.cs` (Manage button handler)
