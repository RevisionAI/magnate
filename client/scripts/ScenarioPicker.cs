using System.IO;
using System.Linq;
using Godot;
using Magnate.Engine.Ai;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Lists scenarios under <c>content/scenarios/</c>. Each row shows a difficulty
/// star badge, the name, description, and a Start button. A FilterBar at the top
/// lets the player show All / Easy (1-2) / Normal (3) / Hard (4-5) scenarios.
/// Selecting one calls <see cref="ScenarioRunner.Apply"/>, optionally registers
/// the player with <see cref="AdaptiveStrategy"/> (auto-play checkbox), stashes
/// the world in <see cref="GameState"/>, and transitions to the Main scene.
/// </summary>
public partial class ScenarioPicker : Node
{
    private enum Filter { All = 0, Easy = 1, Normal = 2, Hard = 3 }

    private OptionButton? _filterOption;
    private Filter _filter = Filter.All;

    public override void _Ready()
    {
        ApplyVisualPolish();
        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;

        _filterOption = GetNode<OptionButton>("Panel/VBox/FilterBar/FilterOption");
        _filterOption.Clear();
        _filterOption.AddItem("All", (int)Filter.All);
        _filterOption.AddItem("Easy (1-2)", (int)Filter.Easy);
        _filterOption.AddItem("Normal (3)", (int)Filter.Normal);
        _filterOption.AddItem("Hard (4-5)", (int)Filter.Hard);
        _filterOption.Selected = 0;
        _filterOption.ItemSelected += OnFilterChanged;

        BuildScenarioList();
    }

    private void ApplyVisualPolish()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.CityBackdrop,
            new Color(1f, 1f, 1f, 0.82f),
            new Color(0.015f, 0.03f, 0.045f, 0.78f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.16f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.Text = "Choose Your Operating Challenge";
        header.AddThemeFontSizeOverride("font_size", 30);
        header.AddThemeColorOverride("font_color", UiChrome.Gold);

        var autoPlay = GetNode<CheckBox>("Panel/VBox/AutoPlayCheckbox");
        autoPlay.TooltipText = "Spectator mode lets the AI operate your company so you can watch the simulation unfold.";
    }

    private void OnFilterChanged(long index)
    {
        _filter = (Filter)index;
        BuildScenarioList();
    }

    private void BuildScenarioList()
    {
        var container = GetNode<VBoxContainer>("Panel/VBox/Scroll/ScenarioList");
        foreach (var child in container.GetChildren()) child.QueueFree();

        if (GameState.Catalog is null)
        {
            container.AddChild(new Label { Text = "Content catalog not loaded. Return to title." });
            return;
        }

        var scenariosDir = Path.Combine(TitleScreen.ResolveContentPath(), "scenarios");
        var scenarios = ScenarioLoader.LoadAll(scenariosDir);
        if (scenarios.Count == 0)
        {
            container.AddChild(new Label { Text = $"No scenarios found at {scenariosDir}" });
            return;
        }

        // Order: Sandbox pinned at top, then ascending difficulty, then name.
        var ordered = scenarios.Values
            .Select(s => (scenario: s, difficulty: ScenarioDifficulty.Compute(s)))
            .Where(t => MatchesFilter(t.difficulty, _filter))
            .OrderByDescending(t => t.scenario.Id == "sandbox")
            .ThenBy(t => t.difficulty)
            .ThenBy(t => t.scenario.Name)
            .ToList();

        if (ordered.Count == 0)
        {
            container.AddChild(new Label { Text = "No scenarios match this filter." });
            return;
        }

        foreach (var (scenario, difficulty) in ordered)
        {
            container.AddChild(BuildRow(scenario, difficulty));
        }
    }

    private static bool MatchesFilter(int difficulty, Filter filter) => filter switch
    {
        Filter.Easy => difficulty <= 2,
        Filter.Normal => difficulty == 3,
        Filter.Hard => difficulty >= 4,
        _ => true,
    };

    private Control BuildRow(Scenario scenario, int difficulty)
    {
        var focus = GamePresentation.ForScenario(scenario);
        var row = new PanelContainer
        {
            CustomMinimumSize = new Vector2(0, 152),
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        row.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.94f),
            new Color(focus.Accent.R, focus.Accent.G, focus.Accent.B, 0.58f),
            radius: 6,
            marginX: 10,
            marginY: 10));

        var body = new HBoxContainer();
        body.AddThemeConstantOverride("separation", 14);
        row.AddChild(body);

        var art = new TextureRect
        {
            Texture = UiChrome.LoadTexture(focus.ImagePath),
            CustomMinimumSize = new Vector2(230, 132),
            ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
            StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        body.AddChild(art);

        var vbox = new VBoxContainer
        {
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsVertical = Control.SizeFlags.ExpandFill,
        };
        vbox.AddThemeConstantOverride("separation", 5);
        body.AddChild(vbox);

        var header = new HBoxContainer();
        header.AddThemeConstantOverride("separation", 8);
        vbox.AddChild(header);

        var badgeLabel = new Label { Text = ScenarioDifficulty.FormatStars(difficulty), TooltipText = $"Difficulty: {difficulty}/5" };
        badgeLabel.AddThemeFontSizeOverride("font_size", 18);
        header.AddChild(badgeLabel);

        var nameLabel = new Label { Text = scenario.Name };
        nameLabel.AddThemeFontSizeOverride("font_size", 20);
        nameLabel.AddThemeColorOverride("font_color", focus.Accent);
        nameLabel.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        header.AddChild(nameLabel);

        var pillar = new Label { Text = focus.Pillar };
        pillar.Modulate = UiChrome.Muted;
        pillar.AddThemeFontSizeOverride("font_size", 12);
        header.AddChild(pillar);

        var descLabel = new Label { Text = scenario.Description, AutowrapMode = TextServer.AutowrapMode.WordSmart };
        vbox.AddChild(descLabel);

        var aiCount = scenario.AiCompetitors?.Count ?? 0;
        var goalCount = scenario.Goals.Count == 0
            ? "Sandbox (no goals)"
            : $"{scenario.Goals.Count} goal(s)";
        var metaLabel = new Label
        {
            Text = $"{goalCount} · {aiCount} AI competitor(s) · {focus.Subtitle}",
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        metaLabel.Modulate = UiChrome.Muted;
        vbox.AddChild(metaLabel);

        var spacer = new Control { SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        vbox.AddChild(spacer);

        var startButton = new Button
        {
            Text = scenario.Id == "sandbox" ? "Enter Sandbox" : "Start Scenario",
            CustomMinimumSize = new Vector2(150, 34),
            SizeFlagsHorizontal = Control.SizeFlags.ShrinkEnd,
        };
        startButton.Pressed += () => StartScenario(scenario);
        vbox.AddChild(startButton);

        return row;
    }

    private void StartScenario(Scenario scenario)
    {
        if (GameState.Catalog is null)
        {
            GD.PushError("[ScenarioPicker] catalog missing");
            return;
        }

        var (world, playerId) = ScenarioRunner.Apply(GameState.Catalog, scenario, seed: 42);

        // Phase 3.4: the player controls their own company by default. Tick the
        // "Let AI drive" checkbox for the Phase 3.2 spectator experience.
        var autoPlayCheckbox = GetNode<CheckBox>("Panel/VBox/AutoPlayCheckbox");
        if (autoPlayCheckbox.ButtonPressed)
        {
            world.RegisterAi(playerId, new AdaptiveStrategy());
        }

        GameState.World = world;
        GameState.PlayerId = playerId;
        GameState.ScenarioName = scenario.Name;
        GameState.ActiveScenario = scenario;
        GameState.History.Clear();
        GameState.RecordSnapshot();

        GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/TitleScreen.tscn");
}
