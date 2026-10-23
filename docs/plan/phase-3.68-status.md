# Phase 3.68 — Floating Score-Popup Overlay Framework

Sprint 14, parallel sibling of Phase 3.66 notifications and Phase 3.53 tooltip
framework. Pure NEW files; no existing scene or script modified, no
`project.godot` autoload added.

## API surface

```csharp
ScorePopup.Spawn(Vector2 globalPosition, decimal amount, Color? color = null);
ScorePopup.SpawnText(Vector2 globalPosition, string text, Color color);
ScorePopup.ClearAll();
```

`Spawn` formats the amount via `("C0", en-US)` and prefixes `+` / `-`:
positive `Color(0.30, 0.78, 0.40)` green, negative `Color(0.85, 0.30, 0.30)`
red, zero a neutral grey. Caller may override with the optional `color`.
`SpawnText` is for non-monetary blurbs (`"Goal achieved!"`, `"+5 Brand!"`).

## Animation curve

Lifetime `1.2 s`, both properties driven in parallel by a single
`Tween` with `SetParallel(true)`:

- `position:y` lerps from spawn `Y` to `Y - 60` (linear, 1.2 s rise).
- `modulate:a` lerps from `1.0 → 0.0` with `Tween.EaseType.Out` so the
  text stays readable, fading slow at the end.

A subtle `±5px` horizontal jitter (per-spawn `RandomNumberGenerator`)
gives the popup an organic feel without disturbing determinism in the
engine (the framework is client-only). Labels are `font_size=22` with a
2-px black outline (`outline_size=2`, `font_outline_color=Color(0,0,0,0.6)`)
for legibility on light backgrounds.

Popups are parented to a lazily-created `CanvasLayer` (layer `105`,
`name=ScorePopupLayer`) under the active scene root. `EnsureLayer`
re-creates after scene transitions (checks `IsInstanceValid` and
`IsInsideTree`). Each label tracks itself in `_activePopups` and
self-removes on `TreeExiting` so `ClearAll` is idempotent.

## Integrator adoption snippet

```csharp
// When a sale fires (e.g. Phase 3.x retail kiosk handler):
ScorePopup.Spawn(retailButton.GlobalPosition + retailButton.Size / 2,
                 saleAmount);

// When a goal is achieved:
ScorePopup.SpawnText(centerOfScreen, "Goal achieved!", Colors.Gold);

// During scene tear-down or "new game":
ScorePopup.ClearAll();
```

The framework debounces nothing — callers are expected not to spam
`Spawn` from `_Process` for the same event (one popup per discrete
gameplay event).

## Demo scene

`res://scenes/ScorePopupDemo.tscn` (NEW). Full-screen Panel → VBox
header + sub-label → 3-column GridContainer of buttons:

- Spawn $100 / Spawn $1k / Spawn $10k (positive, green)
- Spawn -$5k (negative, red)
- Spawn 'Goal achieved!' (gold via `SpawnText`)
- Clear All

Plus `_UnhandledInput` left-click → spawns a random `[-2000, +5000]`
amount at the cursor for free-form visual sweep. `Esc` / `Back` returns
to the title screen. No keybind reserved in `project.godot`; reach the
demo by editing `Main` scene or running the `.tscn` directly.

## Build / test

```bash
dotnet build 2>&1 | tail -6
dotnet test engine/Magnate.Engine.Tests --no-build --logger "console;verbosity=minimal" 2>&1 | tail -5
```

Both clean — engine tests remain `219/219` (framework is client-only).
