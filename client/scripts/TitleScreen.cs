using System.Collections.Generic;
using System.IO;
using Godot;
using Magnate.Engine.Content;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// First scene shown at game start. Offers New Game (→ ScenarioPicker),
/// Load Game (→ SaveBrowser), and Quit. Lazily ensures the content catalog
/// is loaded into <see cref="GameState"/>. A light slide-in tween on boot
/// and a slow alpha pulse on the title provide a bit of visual polish
/// without any audio or imported assets.
///
/// Phase 3.46: a horizontal "Showcase" row of 3-4 hand-picked scenarios is
/// added below the buttons. Each card has the scenario name, a difficulty
/// star badge, a one-line description (truncated), and a Play button that
/// jumps straight into Main with the scenario applied (saves a click vs
/// going through ScenarioPicker).
/// </summary>
public partial class TitleScreen : Node
{
    private Label? _titleLabel;
    private float _pulsePhase;

    // Hand-picked showcase scenario ids — covering the difficulty curve plus
    // a narrative-rich pick. Missing ids (e.g. content folder reshuffled)
    // are silently skipped; the row gracefully shrinks.
    private static readonly string[] ShowcaseIds =
    {
        "tutorial",          // Easy intro (1-2★)
        "coffee_monopoly",   // Narrative-rich, vertical chain
        "vertical_showdown", // Hard challenge (4-5★)
        "sandbox",           // Curiosity / free-play
    };

    public override void _Ready()
    {
        ApplyVisualPolish();

        GetNode<Button>("Panel/VBox/NewGameButton").Pressed  += OnNewGame;
        GetNode<Button>("Panel/VBox/LoadGameButton").Pressed += OnLoadGame;
        GetNode<Button>("Panel/VBox/QuitButton").Pressed     += OnQuit;
        foreach (var name in new[] { "NewGameButton", "LoadGameButton", "QuitButton" })
            GetNode<Button>($"Panel/VBox/{name}").Pressed += () => SoundManager.PlaySfx("ui_click");

        _titleLabel = GetNodeOrNull<Label>("Panel/VBox/TitleLabel");

        EnsureCatalogLoaded();
        GameState.Clear();

        BuildShowcase();
        PlaySlideIn();

        SoundManager.PlayMusic("title_theme");
        if (!_welcomePlayed)
        {
            _welcomePlayed = true;
            SoundManager.PlayVoice("vo_welcome");
        }
    }

    // Once per app run — returning to the title screen shouldn't re-greet.
    private static bool _welcomePlayed;

    private void ApplyVisualPolish()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.TitleBackdrop,
            new Color(1f, 1f, 1f, 0.95f),
            new Color(0.02f, 0.04f, 0.06f, 0.56f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.06f, 0.18f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var title = GetNode<Label>("Panel/VBox/TitleLabel");
        title.AddThemeColorOverride("font_color", new Color(0.97f, 0.86f, 0.55f));
        title.AddThemeColorOverride("font_shadow_color", new Color(0f, 0f, 0f, 0.75f));
        title.AddThemeConstantOverride("shadow_offset_x", 2);
        title.AddThemeConstantOverride("shadow_offset_y", 3);

        var subtitle = GetNode<Label>("Panel/VBox/SubtitleLabel");
        subtitle.Text = "Build brands, factories, stores, supply chains, and market power";
        subtitle.AddThemeColorOverride("font_color", new Color(0.86f, 0.92f, 0.95f));
        subtitle.AddThemeColorOverride("font_shadow_color", new Color(0f, 0f, 0f, 0.65f));

        StyleTitleButton(GetNode<Button>("Panel/VBox/NewGameButton"), primary: true);
        StyleTitleButton(GetNode<Button>("Panel/VBox/LoadGameButton"), primary: false);
        StyleTitleButton(GetNode<Button>("Panel/VBox/QuitButton"), primary: false);
    }

    private static void StyleTitleButton(Button button, bool primary)
    {
        button.AddThemeFontSizeOverride("font_size", 18);
        button.AddThemeStyleboxOverride("normal", UiChrome.Box(
            primary ? new Color(0.55f, 0.39f, 0.10f, 0.92f) : new Color(0.06f, 0.10f, 0.13f, 0.84f),
            primary ? new Color(0.95f, 0.78f, 0.36f, 0.92f) : new Color(0.45f, 0.65f, 0.75f, 0.68f),
            borderWidth: 1,
            radius: 5,
            marginY: 9));
        button.AddThemeStyleboxOverride("hover", UiChrome.Box(
            primary ? new Color(0.68f, 0.48f, 0.12f, 0.96f) : new Color(0.10f, 0.17f, 0.22f, 0.92f),
            primary ? new Color(1.0f, 0.86f, 0.48f, 1f) : new Color(0.55f, 0.78f, 0.90f, 0.82f),
            radius: 5,
            marginY: 9));
    }

    public override void _Process(double delta)
    {
        if (_titleLabel is null) return;
        // Slow alpha pulse (~4s period). Stays within 0.82-1.0 so it
        // reads as a breath rather than a flash.
        _pulsePhase += (float)delta;
        float wave = Mathf.Sin(_pulsePhase * 1.6f) * 0.09f + 0.91f;
        var c = _titleLabel.Modulate;
        c.A = wave;
        _titleLabel.Modulate = c;
    }

    private void PlaySlideIn()
    {
        var vbox = GetNodeOrNull<Control>("Panel/VBox");
        if (vbox is null) return;

        var startOffset = vbox.Position + new Vector2(0, -24);
        var target = vbox.Position;
        vbox.Position = startOffset;
        vbox.Modulate = new Color(1, 1, 1, 0f);

        var tween = CreateTween();
        tween.SetParallel(true);
        tween.TweenProperty(vbox, "position", target, 0.45)
             .SetTrans(Tween.TransitionType.Sine)
             .SetEase(Tween.EaseType.Out);
        tween.TweenProperty(vbox, "modulate:a", 1.0f, 0.55);
    }

    private void EnsureCatalogLoaded()
    {
        if (GameState.Catalog is not null) return;
        try
        {
            var contentPath = ResolveContentPath();
            GameState.Catalog = ContentLoader.Load(contentPath);
        }
        catch (System.Exception ex)
        {
            GD.PushError($"[Magnate.Client] Content load failed: {ex.Message}");
            var status = GetNodeOrNull<Label>("Panel/VBox/StatusLabel");
            if (status is not null) status.Text = $"Content error: {ex.Message}";
        }
    }

    private void OnNewGame()  => GetTree().ChangeSceneToFile("res://scenes/ScenarioPicker.tscn");
    private void OnLoadGame() => GetTree().ChangeSceneToFile("res://scenes/SaveBrowser.tscn");
    private void OnQuit()     => GetTree().Quit();

    internal static string ResolveContentPath()
    {
        var projectRoot = ProjectSettings.GlobalizePath("res://");
        return Path.GetFullPath(Path.Combine(projectRoot, "..", "content"));
    }

    // -------------------------------------------------- Showcase row

    /// <summary>
    /// Populate the ShowcaseRow placeholder (declared in TitleScreen.tscn) with
    /// programmatic cards for each available <see cref="ShowcaseIds"/> entry.
    /// If the catalog or scenarios directory is missing, the row stays empty —
    /// the rest of the title screen keeps working.
    /// </summary>
    private void BuildShowcase()
    {
        var row = GetNodeOrNull<HBoxContainer>("Panel/ShowcaseRow");
        if (row is null) return;

        // Clear anything left over (defensive — should be empty on fresh load).
        foreach (var c in row.GetChildren()) c.QueueFree();

        if (GameState.Catalog is null) return;

        IReadOnlyDictionary<string, Scenario>? scenarios;
        try
        {
            var dir = Path.Combine(ResolveContentPath(), "scenarios");
            scenarios = ScenarioLoader.LoadAll(dir);
        }
        catch (System.Exception ex)
        {
            GD.PushWarning($"[TitleScreen] Showcase scenarios load failed: {ex.Message}");
            return;
        }

        foreach (var id in ShowcaseIds)
        {
            if (!scenarios.TryGetValue(id, out var scenario)) continue;
            row.AddChild(BuildShowcaseCard(scenario));
        }
    }

    private Control BuildShowcaseCard(Scenario scenario)
    {
        var difficulty = ScenarioDifficulty.Compute(scenario);

        var card = new PanelContainer();
        card.CustomMinimumSize = new Vector2(220, 160);
        card.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;

        // Subtle dark fill + gold border to match the title's gold underline.
        card.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.05f, 0.08f, 0.10f, 0.88f),
            new Color(0.85f, 0.72f, 0.35f, 0.55f),
            radius: 5,
            marginX: 12,
            marginY: 10));

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 6);
        card.AddChild(vbox);

        var nameLabel = new Label
        {
            Text = scenario.Name,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        nameLabel.AddThemeFontSizeOverride("font_size", 18);
        vbox.AddChild(nameLabel);

        var meta = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
        };
        // Gold stars to mirror the underline color; empty stars dimmed.
        var stars = ScenarioDifficulty.FormatStarsBbcode(difficulty);
        var oneLine = TruncateDescription(scenario.Description, 90);
        meta.Text = $"{stars}  [color=#aaaaaa][{difficulty}/5][/color]\n[color=#cccccc]{oneLine}[/color]";
        vbox.AddChild(meta);

        // Push the Play button to the bottom of the card.
        var spacer = new Control { SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        vbox.AddChild(spacer);

        var play = new Button { Text = "Play" };
        play.Pressed += () => StartScenario(scenario);
        vbox.AddChild(play);

        return card;
    }

    private static string TruncateDescription(string desc, int max)
    {
        if (string.IsNullOrEmpty(desc)) return string.Empty;
        // Use the first sentence (up to '.', '!', '?') if shorter than max,
        // else hard-truncate at the last whitespace before max.
        var firstStop = desc.IndexOfAny(new[] { '.', '!', '?' });
        if (firstStop > 0 && firstStop <= max) return desc.Substring(0, firstStop + 1);
        if (desc.Length <= max) return desc;
        var cut = desc.LastIndexOf(' ', System.Math.Min(max, desc.Length - 1));
        if (cut < max / 2) cut = max;
        return desc.Substring(0, cut) + "…";
    }

    /// <summary>
    /// Quick-pick handler: mirrors <c>ScenarioPicker.StartScenario</c> exactly so
    /// the sim state on Main entry is identical to the normal flow. Note we
    /// default the AI auto-play to OFF — players launching from the title
    /// screen typically want to drive themselves.
    /// </summary>
    private void StartScenario(Scenario scenario)
    {
        if (GameState.Catalog is null)
        {
            GD.PushError("[TitleScreen] catalog missing — cannot start scenario");
            return;
        }

        var (world, playerId) = ScenarioRunner.Apply(GameState.Catalog, scenario, seed: 42);

        // Auto-play off by default for title-screen quick-pick (player wants
        // to drive when launching directly from the showcase).

        GameState.World = world;
        GameState.PlayerId = playerId;
        GameState.ScenarioName = scenario.Name;
        GameState.ActiveScenario = scenario;
        GameState.History.Clear();
        GameState.RecordSnapshot();

        GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
    }
}
