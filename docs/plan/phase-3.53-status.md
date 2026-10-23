# Phase 3.53 — Tooltip framework

**Goal**: ship a reusable hover-tooltip utility any `Control` can opt into, plus a demo scene. No existing scenes modified; future polish phases adopt incrementally. No autoload, no `project.godot` changes.

## API

```csharp
public static class Tooltip
{
    public static void Attach(Control control, string bbcodeText, float hoverDelaySec = 0.25f);
    public static void Detach(Control control);
}
```

`Attach` hooks `MouseEntered` / `MouseExited` / `TreeExiting`. Re-attaching replaces any prior binding. `Detach` is idempotent.

## Hover-delay approach

Each binding owns an `int Generation`. On `MouseEntered` we increment, capture the value, create a `SceneTreeTimer(hoverDelaySec)`, and `await ToSignal(timer, Timeout)`. After the await we compare the captured gen against the current gen — if the mouse exited (or re-entered) in the meantime, the generation advanced and we abort. This cancels the in-flight timer without needing to hold a timer reference.

## Popup positioning

Popup is a `PanelContainer` (dark fill `rgba(0.10,0.10,0.13,0.95)`, border `rgb(0.4,0.4,0.45)`, radius 4, 8×6 content margin) containing a `RichTextLabel` (`BbcodeEnabled`, `FitContent`, `AutowrapMode.WordSmart`, min width 200, wrap cap 400). Parented to a lazily-created `CanvasLayer` (layer 100, name `TooltipLayer`) under `tree.CurrentScene` so it draws above everything else.

Position = `anchor.GlobalPosition + (0, anchor.Size.Y + 4)`, clamped against `GetViewport().GetVisibleRect().Size`; if the popup would overflow vertically we flip it above the anchor. `MouseFilter = Ignore` on both popup and label so the tooltip never steals hover from the anchor.

Defensive cleanup: `TreeExiting` on the anchor auto-detaches; `Detach` clears the active popup if it belonged to the removed control.

## Integrator adoption

```csharp
Tooltip.Attach(advanceButton, "[b]Advance[/b] one month ([code].[/code])");
```

That is the entire adoption cost per control. No scene-file edits, no parent setup — the `CanvasLayer` is created on first use.

## Demo scene

`scenes/TooltipDemo.tscn` + `scripts/TooltipDemo.cs`: header, sub-label, four demo controls (`Button1` bold, `Button2` colored + multi-line, `Label1` proves non-button controls work, `Button3` BBCode sampler with italic / code / colored spans) and a `BackButton` returning to the title screen. Esc also backs out.
