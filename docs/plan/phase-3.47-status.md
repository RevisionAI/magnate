# Phase 3.47 — SaveMenu enhancements

**Status:** complete. Sprint 10 parallel agent. Client-only; engine untouched.

## Shipped

1. **Rename save** — per-row "Rename" button opens an `AcceptDialog` with a
   pre-filled `LineEdit` and an inline error label. Validation rejects empty
   names, `Path.GetInvalidFileNameChars()`, path separators (`/`, `\`),
   names not ending in `.json`, and collisions (target file already exists).
   On a validation or `File.Move` failure the dialog re-pops with the error
   message visible (deferred re-popup via `CallDeferred`).
2. **Delete with confirmation** — per-row "Delete" now opens a Godot
   `ConfirmationDialog` ("Permanently delete X? This cannot be undone.")
   before calling `File.Delete`. Replaces the previous one-click delete.
3. **Autosave indicator** — autosave rows render with a subtle blue tinted
   `StyleBoxFlat` and a BBCode `[bgcolor]…[ A ]` badge prefixing the filename.
   Pattern: `name.StartsWith("autosave_", OrdinalIgnoreCase)` (also used by
   the quick-save lookup).
4. **Sort dropdown** — new `SortRow` in the scene with an `OptionButton`
   exposing Modified ↓ (default), Name A→Z, Size ↓, Schema ↓. Sort applies
   to manual and autosave sections separately; `RefreshList` re-renders.
5. **Quick save (Ctrl+S / ⌘+S)** — `_UnhandledInput` watches `InputEventKey`
   for `Key.S` with `CtrlPressed || MetaPressed`. Overwrites the most-recent
   non-autosave file, falling back to `quicksave.json`.

Existing "Save Now" with manual filename + scenario-aware suggestion is
preserved (covers the "save as new" need without a separate modal).

## Files

- `client/scripts/SaveMenu.cs` — extended.
- `client/scenes/SaveMenu.tscn` — added `SortRow` (`Label` + `OptionButton`).

## Verification

- `dotnet build` → 0 warn / 0 err.
- `dotnet test engine/Magnate.Engine.Tests --no-build` → 179/179 passing.

No engine, content, tools, or other client file modified.
