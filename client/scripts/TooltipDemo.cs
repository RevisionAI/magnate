using Godot;

namespace Magnate.Client;

/// <summary>
/// Demo scene for the Phase 3.53 tooltip framework. Wires
/// <see cref="Tooltip.Attach"/> onto a handful of named controls so the
/// tester can hover each and verify delay, positioning, BBCode rendering,
/// and viewport clamping. Existing polished scenes are untouched; future
/// phases adopt Tooltip.Attach incrementally.
/// </summary>
public partial class TooltipDemo : Node
{
    public override void _Ready()
    {
        var button1 = GetNode<Button>("Panel/VBox/Button1");
        Tooltip.Attach(button1, "[b]Bold tooltip[/b] — plain follow-up text.");

        var button2 = GetNode<Button>("Panel/VBox/Button2");
        Tooltip.Attach(button2,
            "[color=#7ec8ff]Colored[/color] heading\n"
            + "Second line for multi-line layout.\n"
            + "Third line demonstrates autowrap and fit-content.");

        var label1 = GetNode<Label>("Panel/VBox/Label1");
        Tooltip.Attach(label1,
            "[b]Labels work too[/b]\n"
            + "Any [code]Control[/code] can opt in — labels, buttons,\n"
            + "panels, sliders, spinboxes, etc.");

        var button3 = GetNode<Button>("Panel/VBox/Button3");
        Tooltip.Attach(button3,
            "[b]BBCode sampler[/b]\n"
            + "[i]italic[/i] · [code]inline code[/code] · "
            + "[color=#8fd98f]green[/color] · [color=#ff8080]red[/color]\n"
            + "Hover delay is 250 ms by default; cancels on mouse-exit.",
            hoverDelaySec: 0.25f);

        GetNode<Button>("Panel/VBox/Footer/BackButton").Pressed += OnBack;
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Echo: false, Keycode: Key.Escape })
        {
            OnBack();
            GetViewport().SetInputAsHandled();
        }
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/TitleScreen.tscn");
}
