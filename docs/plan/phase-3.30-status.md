# Phase 3.30 — Keyboard Help Overlay

## Scope

Added a read-only modal overlay listing every keyboard shortcut in Magnate,
grouped by category and styled to match the existing `Reports.tscn` pattern
(Panel anchors_preset=15 + 24 px margin, VBox separation=12, HeaderLabel
font_size=24, SubLabel, centered Back button).

## Keybindings documented

Verified against `client/scripts/Main.cs` `_UnhandledInput` (Sprint 6 source
of truth). No keybinds invented; no keybinds omitted.

**Playback**
- `Space` — toggle play / pause
- `.` — advance one month (only when paused, per Main.cs comment)
- `1` — speed 1× (1.00 s/month)
- `2` — speed 2× (0.50 s/month)
- `3` — speed 5× (0.20 s/month)

**Scenes** (all live in Main's `_UnhandledInput` + `Hud/VBox/HBox2/` buttons)
- `M` Manage · `R` Reports · `C` City Map · `T` Research Tree
- `S` Save / Load menu · `F` Financial Statements
- `I` Market Intelligence · `A` Activity Feed

**Navigation**
- `Esc` — back to title (from Main) / close modal (from Help + sub-scenes)

**Help**
- `?` — toggle this overlay (closes on `?` or `Esc` via `_UnhandledInput`)

## New files

- `client/scripts/HelpOverlay.cs` — `Node` subclass; wires
  `Panel/VBox/Footer/BackButton` → `Main.tscn`, and closes on
  `Key.Escape` / `Key.Question` / `Shift+Slash`.
- `client/scenes/HelpOverlay.tscn` — `format=3`, root `Node "HelpOverlay"`,
  Panel > VBox > (HeaderLabel, SubLabel, Scroll > Content > 4 BBCode
  RichTextLabels: PlaybackSection, ScenesSection, NavigationSection,
  HelpSection, Footer > BackButton).

## Node-path map (for integrator)

```
HelpOverlay (Node, script)
└─ Panel (anchors_preset=15)
   └─ VBox (separation=12, margin 24)
      ├─ HeaderLabel          "Keyboard Shortcuts" (font_size=24, centered)
      ├─ SubLabel             "Press Esc or ? to close" (centered)
      ├─ Scroll (ScrollContainer, v_expand)
      │  └─ Content (VBox, separation=16)
      │     ├─ PlaybackSection    (RichTextLabel, bbcode)
      │     ├─ ScenesSection      (RichTextLabel, bbcode)
      │     ├─ NavigationSection  (RichTextLabel, bbcode)
      │     └─ HelpSection        (RichTextLabel, bbcode)
      └─ Footer (HBox, alignment=1)
         └─ BackButton        "Back"
```

## Integrator wiring (Main.cs / Main.tscn — NOT touched here)

1. In `client/scenes/Main.tscn`, add a Button named `HelpButton` with
   text `"Help (?)"` to the `Hud/VBox/HBox2/` row (alongside ManageButton,
   ReportsButton, etc.).
2. In `Main.cs` `_Ready`, resolve it and wire:
   `helpButton.Pressed += () => GetTree().ChangeSceneToFile("res://scenes/HelpOverlay.tscn");`
3. In `Main.cs` `_UnhandledInput`, add a `case Key.Question:` (and/or
   `Key.Slash` + ShiftPressed) that calls the same scene-change.
4. `Esc` inside HelpOverlay routes back to `Main.tscn` (not to title) —
   this is intentional and does not conflict with Main's own `Esc → title`
   since the two handlers belong to different scene contexts.

## Verification

- `dotnet build` → **0 errors, 0 warnings**.
- No test run required (no test files in this phase's ownership).
- Godot scene boot deferred to the integrator (sandbox denies the binary).
