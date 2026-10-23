using Godot;

namespace Magnate.Client;

/// <summary>
/// Demo scene for the Phase 3.68 score-popup framework. Click anywhere
/// on the panel to spawn a random "+$XXX" popup at the cursor; the
/// button grid spawns deterministic amounts (positive, negative, custom
/// text) at each button's center for repeatable visual verification.
/// Existing polished scenes are untouched; future phases adopt
/// <see cref="ScorePopup.Spawn"/> incrementally from their gameplay
/// event-handlers.
/// </summary>
public partial class ScorePopupDemo : Node
{
    private readonly RandomNumberGenerator _rng = new();

    public override void _Ready()
    {
        GetNode<Button>("Panel/VBox/Grid/Spawn100Button").Pressed += OnSpawn100;
        GetNode<Button>("Panel/VBox/Grid/Spawn1kButton").Pressed += OnSpawn1k;
        GetNode<Button>("Panel/VBox/Grid/Spawn10kButton").Pressed += OnSpawn10k;
        GetNode<Button>("Panel/VBox/Grid/SpawnNegButton").Pressed += OnSpawnNegative;
        GetNode<Button>("Panel/VBox/Grid/SpawnGoalButton").Pressed += OnSpawnGoal;
        GetNode<Button>("Panel/VBox/Grid/ClearButton").Pressed += OnClear;
        GetNode<Button>("Panel/VBox/Footer/BackButton").Pressed += OnBack;
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Echo: false, Keycode: Key.Escape })
        {
            OnBack();
            GetViewport().SetInputAsHandled();
            return;
        }

        if (@event is InputEventMouseButton mb &&
            mb.Pressed &&
            mb.ButtonIndex == MouseButton.Left)
        {
            // Random amount in [-2000, +5000] excluding tiny noise.
            decimal amount = _rng.RandiRange(-2000, 5000);
            ScorePopup.Spawn(mb.GlobalPosition, amount);
            GetViewport().SetInputAsHandled();
        }
    }

    private static Vector2 ButtonCenter(Button b) => b.GlobalPosition + b.Size / 2f;

    private void OnSpawn100() =>
        ScorePopup.Spawn(ButtonCenter(GetNode<Button>("Panel/VBox/Grid/Spawn100Button")), 100m);

    private void OnSpawn1k() =>
        ScorePopup.Spawn(ButtonCenter(GetNode<Button>("Panel/VBox/Grid/Spawn1kButton")), 1000m);

    private void OnSpawn10k() =>
        ScorePopup.Spawn(ButtonCenter(GetNode<Button>("Panel/VBox/Grid/Spawn10kButton")), 10000m);

    private void OnSpawnNegative() =>
        ScorePopup.Spawn(ButtonCenter(GetNode<Button>("Panel/VBox/Grid/SpawnNegButton")), -5000m);

    private void OnSpawnGoal() =>
        ScorePopup.SpawnText(ButtonCenter(GetNode<Button>("Panel/VBox/Grid/SpawnGoalButton")),
            "Goal achieved!", Colors.Gold);

    private void OnClear() => ScorePopup.ClearAll();

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/TitleScreen.tscn");
}
