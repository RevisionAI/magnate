# Phase 3.51 — Onboarding tutorial overlay

## Summary

A standalone 10-page tutorial scene that teaches a new player what Magnate is,
how to navigate its scenes, and what levers drive demand. Read-only: the
scene never touches `GameState` — opening it mid-game does not perturb the
sim. Can be launched from the title screen (via integrator wiring, below)
or directly as a standalone scene.

## Files added

- `client/scripts/Tutorial.cs` — `public partial class Tutorial : Node`. Holds a
  static `_pages` array of ten `(title, body)` tuples (BBCode bodies, each
  ≤150 words), a current-page index, button/input wiring, and a `Render`
  helper that updates title, body, and a `"N / 10"` counter.
- `client/scenes/Tutorial.tscn` — Panel → VBox → HeaderLabel (size 24) →
  PageCounterLabel (dimmed, centered) → ScrollContainer → `BodyText`
  RichTextLabel (`bbcode_enabled=true`, `fit_content=true`) → HBox centered
  with Back / Next / Skip / Close buttons.

## Page titles

1. Welcome to Magnate
2. Picking a scenario
3. The HUD
4. Building your first retailer
5. The supply chain
6. Demand and Q/B/T
7. Time and ticks
8. Reports and goals
9. Beating the AI
10. Tips and wrap-up

## Navigation

- **Buttons** — Back / Next move one page; Skip and Close both exit.
- **Keys** — Right/Down → Next, Left/Up → Back, Esc → exit.
- **Edge cases** — Back is disabled on page 1. On the final page, Next is
  relabeled "Finish" and behaves like Close.

## Fallback on exit

`OnExit` checks `GameState.World`: if non-null (player opened the tutorial
from a live game) it jumps to `Main.tscn`; otherwise (standalone boot, no
scenario loaded) it returns to `TitleScreen.tscn`. Safe on cold boot — never
assumes a world exists.

## Integrator wiring (not done in this phase)

Add a Button to `client/scenes/Main.tscn` under `Hud/VBox/HBox2/`:

```
[node name="TutorialButton" type="Button" parent="Hud/VBox/HBox2"]
layout_mode = 2
text = "Tutorial"
```

Then in `Main.cs::_Ready` wire it:

```csharp
GetNode<Button>("Hud/VBox/HBox2/TutorialButton").Pressed +=
    () => GetTree().ChangeSceneToFile("res://scenes/Tutorial.tscn");
```

No keybind requested — the button is the only HUD entry point, to avoid a
collision with existing single-letter shortcuts.

## Verification

- `dotnet build` — 0 errors (209 pre-existing XML-doc warnings, unchanged).
- `dotnet test engine/Magnate.Engine.Tests` — 191/191 pass.
- No existing script or scene was modified.
