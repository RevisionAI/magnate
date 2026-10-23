# Phase 3.1 — Godot client scaffolding

**Goal**: bring the client online. For 13 phases the entire project has been driven from the CLI (`magnate-sim`). Phase 3.1 creates the Godot 4 project under `client/`, wires up the `Magnate.Engine` reference, and puts a minimum-viable HUD on the screen. Boot the sim, render state, pump a monthly tick — nothing more ambitious yet.

## Delivered

### `client/` layout

```
client/
  project.godot             Godot 4.3 project config (features=4.3, C#, Forward Plus)
  Magnate.Client.csproj     SDK=Godot.NET.Sdk/4.3.0, references ../engine/Magnate.Engine
  scenes/Main.tscn          Main scene — HUD with Labels + Play/Advance buttons
  scripts/Main.cs           Bootstraps World + wires HUD nodes to sim state
  README.md                 How to open + run in the Godot editor
```

### `Main.cs` — what the client does

1. **Bootstraps** a `World` on `_Ready()`:
   - Loads content from `res://../content` (dev-time path)
   - Creates `Acme Corp` ($30M) as player
   - Creates `RivalCo` ($25M) and registers it with `AdaptiveStrategy`
2. **Renders** the current state to five Label nodes: date, player cash, AI cash, building count + ledger size, play-status.
3. **Drives** the clock: `_Process(delta)` accumulates real-seconds. On `SecondsPerMonth` (default 1.0), calls `World.AdvanceMonth()` and refreshes the HUD.
4. **Responds** to two buttons: `Play/Pause` toggles `_running`; `Advance 1 Month` ticks once (works even when paused).

### Solution integration

`Magnate.sln` gets `Magnate.Client` as a 5th project. `dotnet build client` resolves, restores `Godot.NET.Sdk/4.3.0` from NuGet, and produces `client/.godot/mono/temp/bin/Debug/Magnate.Client.dll`. **Verified green** — zero warnings, zero errors. This proves the engine ↔ client contract compiles; Godot the editor isn't installed here, but the user only needs it to actually *run* the scene.

### Engine regression: 120/120 still pass

No engine changes were needed for the client to compile — the public API is already the contract the client uses. That's the payoff for 13 phases of disciplined encapsulation.

## What works (and doesn't) in this phase

✓ Client builds against the Godot 4.3 SDK
✓ `Magnate.Engine` consumed via project reference
✓ Scene text format is valid Godot 4 (`format=3`)
✓ HUD node paths in script match the scene — `GetNode<Label>("Hud/VBox/DateLabel")` etc.
✓ Dev-time content path resolves via `res://../content`

✗ **Not verified in this phase**: actually launching the scene in the Godot editor. That requires Godot installed. The compile check is the best we can do without the editor; the user will install Godot and hit F5 to see it move.
✗ **No city rendering**, no building placement, no tilemap. That's Phase 3.2+.
✗ **Dev-only content path**. Exported builds will need bundled content — Phase 3.4+.
✗ **No persistence wiring in the client yet**. Save/load via `WorldSaver`/`WorldLoader` exists on the engine side; the client doesn't expose a Save button yet.

## How the user opens it

```bash
brew install --cask godot-mono         # or download from godotengine.org/download
open -a "Godot_mono"                    # launches editor
# In the editor: Import → client/project.godot → F5 to run
```

Expected HUD (after pressing Play, waiting ~6 seconds):

```
Magnate
Date: 2026-07
Acme Corp: $29,980,000
RivalCo: $28,785,000
1 buildings, 4 ledger entries
[Pause]  [Advance 1 Month]
Running (1 month per second)
```

## Files

Added:
- `client/project.godot`
- `client/Magnate.Client.csproj`
- `client/scenes/Main.tscn`
- `client/scripts/Main.cs`
- `client/README.md`
- `docs/plan/phase-3.1-status.md`

Modified:
- `Magnate.sln` (adds Magnate.Client as 5th project)
