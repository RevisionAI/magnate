# Phase 3.19 — Autosave + Save Menu UI

Status: **Complete** (2026-04-24, Agent B)

## Summary

Two-part feature: a shared engine helper for enumerating save-file metadata,
and a client-side autosave timer + in-session Save/Load menu scene.

## Engine changes

- `engine/Magnate.Engine/Persistence/WorldSaver.cs`
  - Added public record `SaveFileInfo(FileName, FullPath, Timestamp,
    ScenarioId, PlayerId, GameDate, SchemaVersion, FileSize)`.
  - Added public `WorldSaver.ListSaves(directory)` → `IReadOnlyList<SaveFileInfo>`,
    sorted newest-first. Parses just the JSON header (schemaVersion, clock,
    scenarioId, playerId) via `JsonDocument` — no world rebuild. Missing dirs
    return empty. Malformed files are silently skipped.

- `engine/Magnate.Engine.Tests/PersistenceTests.cs`
  - +3 tests appended at bottom:
    - `ListSaves_returns_metadata_for_each_json_in_directory` — saves two
      worlds to a temp dir, asserts count + metadata round-trip.
    - `ListSaves_returns_empty_when_directory_missing`.
    - `ListSaves_skips_malformed_files`.

## Client changes

- `client/scripts/GameState.cs`
  - New constants: `AutosaveIntervalMonths = 12`, `AutosaveRetentionCount = 3`.
  - New field `AutosaveMonthsRemaining`; `TickIfRunning` calls `TickAutosave`
    after each advance. On reaching zero, writes
    `user://autosaves/autosave_YYYY-MM.json` and prunes oldest beyond retention.
  - `Clear()` resets the counter. Errors logged, never thrown.

- `client/scripts/SaveMenu.cs` (new) + `client/scenes/SaveMenu.tscn` (new)
  - Lists manual saves (`user://`) and autosaves (`user://autosaves/`) in two
    sections, each row showing filename, game-date, scenario, timestamp, size,
    schema version.
  - "Save Now" button with editable filename LineEdit (default suggested).
  - Per-row Load (rehydrates into `GameState` and returns to Main) and Delete.

- `client/scripts/Main.cs` + `client/scenes/Main.tscn`
  - Added "Save/Load" button in HBox2; opens `SaveMenu.tscn` and pauses.
  - 'S' key shortcut added alongside M/R/C in `_UnhandledInput`.

## Verification

- `dotnet build` — **clean, 0 errors, 0 warnings**.
- `dotnet test Magnate.Engine.Tests` — **152 passed** (was 149, +3).
- Godot headless smoke/Main/SaveMenu boot checks — **not run**: Bash was
  denied permission to execute the Godot binary in this sandbox. The Main.tscn
  and SaveMenu.tscn scenes were authored using the same patterns already
  proven by SaveBrowser.tscn / Reports.tscn and build cleanly via Roslyn.
  Human verification recommended with:

  ```
  "$GODOT" --headless --path client res://scenes/SmokeTest.tscn
  "$GODOT" --headless --path client res://scenes/Main.tscn --quit-after 20
  "$GODOT" --headless --path client res://scenes/SaveMenu.tscn --quit-after 10
  ```

## Files touched

- `engine/Magnate.Engine/Persistence/WorldSaver.cs` (extend)
- `engine/Magnate.Engine.Tests/PersistenceTests.cs` (+3 tests)
- `client/scripts/GameState.cs` (autosave tick + prune)
- `client/scripts/SaveMenu.cs` (new)
- `client/scenes/SaveMenu.tscn` (new)
- `client/scripts/Main.cs` (Save/Load button + 'S' shortcut)
- `client/scenes/Main.tscn` (new button node)
