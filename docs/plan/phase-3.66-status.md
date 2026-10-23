# Phase 3.66 — Notification Toast Framework

**Status:** complete. NEW files only; no existing client / engine / test
file touched. Build clean, engine tests 219/219.

## API

```csharp
public static class Notifications
{
    public enum Severity { Info, Success, Warning, Error }

    public static void Show(string bbcodeText, Severity severity = Severity.Info, float durationSec = 4.0f);
    public static void ShowFor(Node sceneRoot, string bbcodeText, Severity severity, float durationSec);
    public static void ClearAll();
}
```

`Show` resolves the active `SceneTree` via `Engine.GetMainLoop()`.
`ShowFor` is the explicit form for risky moments (scene transitions).
`ClearAll` is idempotent.

## Lifecycle

For each toast: **fade-in 200ms (alpha 0→1) → hold (durationSec, default
4.0s) → fade-out 200ms (alpha 1→0) → queue_free**. Animations are
driven by `Tween` + `await ToSignal(...)`; the hold uses
`SceneTreeTimer`. A `TreeExiting` handler removes the toast from the
active list and re-lays out the stack — this is the defensive cleanup
path for scene transitions.

## Stack layout

`_activeToasts: List<PanelContainer>` tracks live toasts in spawn
order. Each toast is anchored top-right (anchor_left = anchor_right =
1.0) with `offset_right = -24`, `offset_left = -24 - 380` for a
380-px-wide column hugging the right edge. `RelayoutStack` walks the
list and assigns `OffsetTop` / `OffsetBottom` per toast, accumulating
`size.Y + 8px` per row from a 24-px top margin. New arrivals push the
new entry to the bottom of the visible stack; expirations recompact.

## Severity palette

| Severity | Border color           | Icon |
|----------|------------------------|------|
| Info     | `Color(0.40, 0.40, 0.45)` grey  | ℹ |
| Success  | `Color(0.30, 0.78, 0.40)` green | ✓ |
| Warning  | `Color(0.85, 0.65, 0.20)` amber | ⚠ |
| Error    | `Color(0.85, 0.30, 0.30)` red   | ✕ |

Background is `Color(0.10, 0.10, 0.13, 0.95)` for all severities;
border 2 px, corner radius 4, 12 px internal padding. The toast layer
is a CanvasLayer at index 110 (`NotificationLayer`) lazily created
under the current scene root.

## Demo

`res://scenes/NotificationsDemo.tscn` — six buttons (Info / Success /
Warning / Error / Show All / Clear All) plus a Back button.

## Integrator adoption

```csharp
Notifications.Show("[b]Goal achieved[/b]: $50M corporate value",
    Notifications.Severity.Success);
```

No `project.godot` edit, no autoload, no Main.cs change.
