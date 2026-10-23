# Phase 3.7 — Godot install + live run

**Goal**: stop shipping "compiles but never run" client code. Install Godot 4.3, boot the project under the real runtime, walk every scene, and fix whatever surfaces.

## What was actually done

### Godot 4.3 stable (mono) installed

Direct download from the GitHub release (brew cask wants sudo; Microsoft-style download works without):

```bash
curl -sSL -o /tmp/godot.zip \
  "https://github.com/godotengine/godot/releases/download/4.3-stable/Godot_v4.3-stable_mono_macos.universal.zip"
unzip -q /tmp/godot.zip -d ~/Applications/
```

Result: `~/Applications/Godot_mono.app/Contents/MacOS/Godot` (version `4.3.stable.mono.official.77dcf97d8`).

### End-to-end smoke test under the real runtime

New dev-only scene `scenes/SmokeTest.tscn` + script `scripts/HeadlessSmokeTest.cs`. Walks the same code paths the client UI uses, using the same public engine APIs the real scenes call. Runs under `--headless` and exits with code 0 on success or 1 on failure — automation-friendly.

**What it verifies (10 checks, all passing):**

```
[OK]   catalog load                    — ContentLoader against res://../content
[OK]   tutorial scenario loads         — ScenarioLoader picks up tutorial.json
[OK]   scenario runner apply           — ScenarioRunner creates world + AIs
[OK]   construct supermarket (step 1)  — World.Construct + ConfigureRetailSlot
[OK]   advance 3 months (step 3)       — 3× World.AdvanceMonth
[OK]   start ad campaign (step 4)      — World.RegisterAdCampaign
[OK]   tutorial goals 1-4 achieved     — ScenarioRunner.EvaluateGoals
[OK]   reports query                   — GetIncomeStatement / GetBalanceSheet / GetProductProfitability / GetMarketShare
[OK]   save                            — WorldSaver.Save to OS.GetUserDataDir()
[OK]   load round-trip                 — WorldLoader.Load verified
```

### Every scene boots under Godot

Walked each scene with `--quit-after 5` (5 frames). All seven booted without any stderr / `GD.PushError` output. TitleScreen's `_Ready` was verified with a debug print that also confirmed `GameState.Catalog` is populated.

## What didn't surface (and why that's notable)

After 14 phases building the client without ever running it in Godot, you'd expect:

- **Node-path typos**: `GetNode<Label>("Hud/VBox/Wrong")` — would throw `NullReferenceException` on `_Ready`
- **Scene parse errors**: invalid `.tscn` format
- **Missing node types**: referencing a class not available in Godot 4.3
- **Runtime exceptions in `_Ready`** or `_Process`

**None of these surfaced.** The scene-file format (`format=3`), node-path strings, and C# API usage all passed the real runtime on the first try. The `dotnet build` signal was stronger than expected — it caught everything except scene-specific issues, and the scenes were tight enough that there was nothing to find.

## Commands for future runs

```bash
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"
export GODOT="$HOME/Applications/Godot_mono.app/Contents/MacOS/Godot"

# Open editor (GUI)
"$GODOT" --path /path/to/repo/client

# Run smoke test headless
dotnet build /path/to/repo/client
"$GODOT" --headless --path /path/to/repo/client res://scenes/SmokeTest.tscn

# Run the actual game (GUI)
"$GODOT" --path /path/to/repo/client
```

## Build status (final)

| | |
|---|---|
| `dotnet build` (engine + client) | 0 warnings, 0 errors |
| `dotnet test` (engine) | **125/125 passing** |
| Godot smoke test | **10/10 OK** |

## What Phase 3.7 didn't cover (intentionally)

- **GUI run validation**: visually verifying layouts look right. That requires running the game in windowed mode with a display; a human has to eyeball it. CLI sessions can't validate pixel layout.
- **Input simulation**: clicking buttons programmatically. Godot has `Input.ParseInputEvent` but wiring it for a whole tutorial flow is overkill for Phase 3.7.
- **Performance**: the smoke test runs in milliseconds; no load test under 30-year simulation yet.

## New invariant

25. **The client has a headless smoke test.** `scenes/SmokeTest.tscn` + `scripts/HeadlessSmokeTest.cs` exercise the full player journey (catalog load → scenario apply → building construction → monthly advance → ads → goal evaluation → reports → save → load) under the real Godot runtime. Runs in under a second; exits with code 1 if anything fails. Any future client change should keep this green — run it in CI or before committing.

## Files

Added:
- `client/scripts/HeadlessSmokeTest.cs`
- `client/scenes/SmokeTest.tscn`
- `docs/plan/phase-3.7-status.md`

No modifications to engine, no modifications to production client code — Phase 3.7 was purely validation.
