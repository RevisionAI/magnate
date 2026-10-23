using Godot;

namespace Magnate.Client;

/// <summary>
/// Demo scene for the Phase 3.66 notification toast framework. Wires
/// six buttons that fire toasts at each severity, a "Show All" stress
/// test, and a "Clear" button. Existing polished scenes are untouched;
/// future phases adopt <see cref="Notifications.Show"/> incrementally
/// from their event-handlers.
/// </summary>
public partial class NotificationsDemo : Node
{
    public override void _Ready()
    {
        GetNode<Button>("Panel/VBox/Grid/InfoButton").Pressed += OnInfo;
        GetNode<Button>("Panel/VBox/Grid/SuccessButton").Pressed += OnSuccess;
        GetNode<Button>("Panel/VBox/Grid/WarningButton").Pressed += OnWarning;
        GetNode<Button>("Panel/VBox/Grid/ErrorButton").Pressed += OnError;
        GetNode<Button>("Panel/VBox/Grid/ShowAllButton").Pressed += OnShowAll;
        GetNode<Button>("Panel/VBox/Grid/ClearButton").Pressed += OnClear;
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

    private void OnInfo() =>
        Notifications.Show("[b]Info[/b]: Q3 financial report is now available.",
            Notifications.Severity.Info);

    private void OnSuccess() =>
        Notifications.Show("[b]Success[/b]: Reached [color=#8fd98f]$50M[/color] corporate value.",
            Notifications.Severity.Success);

    private void OnWarning() =>
        Notifications.Show("[b]Warning[/b]: Inventory of [i]Widgets[/i] running low.",
            Notifications.Severity.Warning);

    private void OnError() =>
        Notifications.Show("[b]Error[/b]: Loan payment failed — insufficient cash.",
            Notifications.Severity.Error);

    private void OnShowAll()
    {
        Notifications.Show("[b]Info[/b]: Stack-test toast 1.", Notifications.Severity.Info);
        Notifications.Show("[b]Success[/b]: Stack-test toast 2.", Notifications.Severity.Success);
        Notifications.Show("[b]Warning[/b]: Stack-test toast 3.", Notifications.Severity.Warning);
        Notifications.Show("[b]Error[/b]: Stack-test toast 4.", Notifications.Severity.Error);
    }

    private void OnClear() => Notifications.ClearAll();

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/TitleScreen.tscn");
}
