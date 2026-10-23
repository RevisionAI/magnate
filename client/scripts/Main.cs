using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Godot;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Persistence;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// In-game HUD scene. Reads the active <see cref="World"/> from <see cref="GameState"/>
/// (set by ScenarioPicker or SaveBrowser). If launched directly with no state
/// (e.g. editor runs this scene in isolation), bootstraps a default demo so the
/// scene still renders something meaningful.
/// </summary>
public partial class Main : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    private World? _world;
    private CompanyId _playerId;

    private Label? _scenarioLabel;
    private Label? _dateLabel;
    private Label? _playerLabel;
    private Label? _aiLabel;
    private Label? _worldLabel;
    private Label? _statusLabel;
    private Button? _playButton;
    private Button? _speed1xButton;
    private Button? _speed2xButton;
    private Button? _speed5xButton;
    private Label? _cashMetric;
    private Label? _incomeMetric;
    private Label? _assetsMetric;
    private Label? _buildingsMetric;
    private Label? _rivalMetric;
    private Label? _briefingTitle;
    private Label? _briefingBody;

    private PanelContainer? _tipPanel;
    private Label? _tipBody;
    private ProgressBar? _tipProgress;
    private Label? _tipDetail;

    private Node? _newsTicker;
    private WinLoseScreen? _endScreen;

    public override void _Ready()
    {
        _scenarioLabel = GetNode<Label>("Hud/VBox/ScenarioLabel");
        _dateLabel     = GetNode<Label>("Hud/VBox/DateLabel");
        _playerLabel   = GetNode<Label>("Hud/VBox/PlayerLabel");
        _aiLabel       = GetNode<Label>("Hud/VBox/AiLabel");
        _worldLabel    = GetNode<Label>("Hud/VBox/WorldLabel");
        _statusLabel   = GetNode<Label>("Hud/VBox/StatusLabel");
        _playButton    = GetNode<Button>("Hud/VBox/HBox/PlayButton");
        _speed1xButton = GetNode<Button>("Hud/VBox/SpeedHBox/Speed1x");
        _speed2xButton = GetNode<Button>("Hud/VBox/SpeedHBox/Speed2x");
        _speed5xButton = GetNode<Button>("Hud/VBox/SpeedHBox/Speed5x");
        _tipPanel      = GetNode<PanelContainer>("Hud/VBox/TipPanel");
        _tipBody       = GetNode<Label>("Hud/VBox/TipPanel/TipVBox/TipBody");
        _tipProgress   = GetNode<ProgressBar>("Hud/VBox/TipPanel/TipVBox/TipProgress");
        _tipDetail     = GetNode<Label>("Hud/VBox/TipPanel/TipVBox/TipDetail");
        var advanceButton = GetNode<Button>("Hud/VBox/HBox/AdvanceButton");
        var manageButton  = GetNode<Button>("Hud/VBox/HBox2/ManageButton");
        var reportsButton = GetNode<Button>("Hud/VBox/HBox2/ReportsButton");
        var cityMapButton = GetNode<Button>("Hud/VBox/HBox2/CityMapButton");
        var researchButton = GetNode<Button>("Hud/VBox/HBox2/ResearchButton");
        var saveButton    = GetNode<Button>("Hud/VBox/HBox2/SaveButton");
        var saveLoadButton = GetNode<Button>("Hud/VBox/HBox2/SaveLoadButton");
        var financialsButton = GetNode<Button>("Hud/VBox/HBox2/FinancialsButton");
        var marketIntelButton = GetNode<Button>("Hud/VBox/HBox2/MarketIntelButton");
        var activityFeedButton = GetNode<Button>("Hud/VBox/HBox2/ActivityFeedButton");
        var replayButton  = GetNode<Button>("Hud/VBox/HBox2/ReplayButton");
        var statsButton   = GetNode<Button>("Hud/VBox/HBox2/StatsButton");
        var tutorialButton = GetNode<Button>("Hud/VBox/HBox2/TutorialButton");
        var helpButton    = GetNode<Button>("Hud/VBox/HBox2/HelpButton");
        var backButton    = GetNode<Button>("Hud/VBox/HBox2/BackButton");

        ApplyVisualPolish(
            manageButton, reportsButton, cityMapButton, researchButton, saveButton,
            saveLoadButton, financialsButton, marketIntelButton, activityFeedButton,
            replayButton, statsButton, tutorialButton, helpButton, backButton);

        _playButton.Pressed   += OnTogglePlay;
        advanceButton.Pressed += OnAdvanceOne;
        manageButton.Pressed  += OnOpenManage;
        reportsButton.Pressed += OnOpenReports;
        cityMapButton.Pressed += OnOpenCityMap;
        researchButton.Pressed += OnOpenResearchTree;
        saveButton.Pressed    += OnSave;
        saveLoadButton.Pressed += OnOpenSaveMenu;
        financialsButton.Pressed += OnOpenFinancials;
        marketIntelButton.Pressed += OnOpenMarketIntel;
        activityFeedButton.Pressed += OnOpenActivityFeed;
        replayButton.Pressed  += OnOpenReplay;
        statsButton.Pressed   += OnOpenStats;
        tutorialButton.Pressed += OnOpenTutorial;
        helpButton.Pressed    += OnOpenHelp;
        backButton.Pressed    += OnBackToTitle;

        _speed1xButton!.Pressed += () => SetSpeed(1.0f);
        _speed2xButton!.Pressed += () => SetSpeed(0.5f);
        _speed5xButton!.Pressed += () => SetSpeed(0.2f);

        // Hotkey hints — mirror the keybinds handled in _UnhandledInput.
        advanceButton.Text     = "Advance 1 Month (.)";
        manageButton.Text      = "Manage (M)";
        reportsButton.Text     = "Reports (R)";
        cityMapButton.Text     = "City Map (C)";
        researchButton.Text    = "Research (T)";
        saveLoadButton.Text    = "Save/Load (S)";
        financialsButton.Text  = "Financials (F)";
        marketIntelButton.Text = "Market Intel (I)";
        activityFeedButton.Text = "Activity (A)";
        replayButton.Text      = "Replay (P)";
        statsButton.Text       = "Stats (X)";
        helpButton.Text        = "Help (?)";
        backButton.Text        = "Back to Title (Esc)";
        _speed1xButton.Text    = "1× (1)";
        _speed2xButton.Text    = "2× (2)";
        _speed5xButton.Text    = "5× (3)";

        EnsureWorld();

        EmbedNewsTicker();

        // Reflect the shared play state when re-entering the scene.
        if (_playButton is not null) _playButton.Text = GameState.IsPlaying ? "Pause (Space)" : "Play (Space)";
        RefreshSpeedButtons();
        UpdateStatusLabel();

        // Only surface headlines that fire while watching this scene.
        if (_world is not null) GameState.LastNewsCountSeen = _world.NewsLog.Count;

        UpdateHud();
        GuidedTutorial.TryAttach(this);
        SoundManager.PlayMusic("gameplay_loop");
    }

    private void ApplyVisualPolish(params Button[] commandButtons)
    {
        var hud = GetNode<Control>("Hud");
        var oldButtonRow = GetNode<HBoxContainer>("Hud/VBox/HBox2");
        UiChrome.InstallBackdrop(
            hud,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.92f),
            new Color(0.02f, 0.04f, 0.055f, 0.66f));

        var content = GetNode<VBoxContainer>("Hud/VBox");
        hud.RemoveChild(content);

        var shell = new PanelContainer
        {
            Name = "DashboardShell",
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(shell);
        shell.OffsetLeft = 28f;
        shell.OffsetTop = 28f;
        shell.OffsetRight = -28f;
        // Leave a bottom band for the embedded NewsTicker strip.
        shell.OffsetBottom = -60f;
        shell.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.035f, 0.060f, 0.075f, 0.72f),
            new Color(0.50f, 0.70f, 0.78f, 0.36f),
            radius: 6,
            marginX: 18,
            marginY: 18));
        hud.AddChild(shell);

        var body = new HBoxContainer
        {
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsVertical = Control.SizeFlags.ExpandFill,
        };
        body.AddThemeConstantOverride("separation", 18);
        shell.AddChild(body);

        content.CustomMinimumSize = new Vector2(460, 0);
        content.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        content.SizeFlagsVertical = Control.SizeFlags.ExpandFill;
        content.AddThemeConstantOverride("separation", 10);
        body.AddChild(content);

        var right = new VBoxContainer
        {
            CustomMinimumSize = new Vector2(520, 0),
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsVertical = Control.SizeFlags.ExpandFill,
        };
        right.AddThemeConstantOverride("separation", 12);
        body.AddChild(right);

        right.AddChild(BuildArtPlate());
        right.AddChild(UiChrome.SectionTitle("Command Center"));

        var metrics = new GridContainer
        {
            Columns = 2,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        metrics.AddThemeConstantOverride("h_separation", 10);
        metrics.AddThemeConstantOverride("v_separation", 10);
        right.AddChild(metrics);

        _cashMetric = AddMetric(metrics, "Cash", UiChrome.Gold);
        _incomeMetric = AddMetric(metrics, "This Month", UiChrome.Green);
        _assetsMetric = AddMetric(metrics, "Assets", UiChrome.Blue);
        _buildingsMetric = AddMetric(metrics, "Buildings", new Color(0.94f, 0.56f, 0.30f));

        var commandShell = new PanelContainer { SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        commandShell.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.04f, 0.075f, 0.095f, 0.84f),
            new Color(0.32f, 0.50f, 0.58f, 0.65f),
            radius: 6,
            marginX: 12,
            marginY: 12));
        right.AddChild(commandShell);

        var commandBox = new VBoxContainer { SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        commandBox.AddThemeConstantOverride("separation", 10);
        commandShell.AddChild(commandBox);

        _rivalMetric = new Label { Text = "Rival: —" };
        _rivalMetric.AddThemeColorOverride("font_color", UiChrome.Muted);
        commandBox.AddChild(_rivalMetric);

        var grid = new GridContainer
        {
            Columns = 3,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        grid.AddThemeConstantOverride("h_separation", 8);
        grid.AddThemeConstantOverride("v_separation", 8);
        commandBox.AddChild(grid);

        foreach (var button in commandButtons)
        {
            if (button.GetParent() == oldButtonRow) oldButtonRow.RemoveChild(button);
            button.CustomMinimumSize = new Vector2(0, 36);
            button.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
            grid.AddChild(button);
        }
        oldButtonRow.Visible = false;
    }

    private Control BuildArtPlate()
    {
        var focus = GamePresentation.ForScenario(GameState.ActiveScenario);
        var plate = new PanelContainer { CustomMinimumSize = new Vector2(0, 224) };
        plate.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.03f, 0.05f, 0.06f, 0.72f),
            new Color(focus.Accent.R, focus.Accent.G, focus.Accent.B, 0.62f),
            radius: 6,
            marginX: 0,
            marginY: 0));

        var canvas = new Control { MouseFilter = Control.MouseFilterEnum.Ignore };
        plate.AddChild(canvas);

        var texture = UiChrome.LoadTexture(focus.ImagePath);
        if (texture is null) return plate;

        var image = new TextureRect
        {
            Texture = texture,
            ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
            StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(image);
        canvas.AddChild(image);

        var shade = new ColorRect
        {
            Color = new Color(0f, 0f, 0f, 0.28f),
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(shade);
        canvas.AddChild(shade);

        var copyPanel = new PanelContainer
        {
            AnchorLeft = 0f,
            AnchorTop = 1f,
            AnchorRight = 1f,
            AnchorBottom = 1f,
            OffsetLeft = 12f,
            OffsetTop = -100f,
            OffsetRight = -12f,
            OffsetBottom = -12f,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        copyPanel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.025f, 0.045f, 0.055f, 0.90f),
            new Color(focus.Accent.R, focus.Accent.G, focus.Accent.B, 0.46f),
            radius: 5,
            marginX: 12,
            marginY: 8));
        canvas.AddChild(copyPanel);

        var copy = new VBoxContainer();
        copy.AddThemeConstantOverride("separation", 3);
        copyPanel.AddChild(copy);

        var kicker = new Label { Text = focus.Pillar.ToUpperInvariant() };
        kicker.AddThemeFontSizeOverride("font_size", 11);
        kicker.AddThemeColorOverride("font_color", focus.Accent);
        copy.AddChild(kicker);

        _briefingTitle = new Label { Text = focus.Title, ClipText = true };
        _briefingTitle.AddThemeFontSizeOverride("font_size", 18);
        copy.AddChild(_briefingTitle);

        _briefingBody = new Label
        {
            Text = focus.Subtitle,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            MaxLinesVisible = 2,
        };
        _briefingBody.AddThemeFontSizeOverride("font_size", 12);
        _briefingBody.Modulate = new Color(0.84f, 0.90f, 0.92f);
        copy.AddChild(_briefingBody);

        return plate;
    }

    private static Label AddMetric(GridContainer parent, string title, Color accent)
    {
        var card = new PanelContainer
        {
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            CustomMinimumSize = new Vector2(0, 84),
        };
        card.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.055f, 0.085f, 0.105f, 0.86f),
            new Color(accent.R, accent.G, accent.B, 0.55f),
            radius: 5,
            marginX: 12,
            marginY: 8));
        parent.AddChild(card);

        var vbox = new VBoxContainer();
        card.AddChild(vbox);

        var header = new Label { Text = title };
        header.Modulate = UiChrome.Muted;
        header.AddThemeFontSizeOverride("font_size", 12);
        vbox.AddChild(header);

        var value = new Label { Text = "—", ClipText = true };
        value.AddThemeColorOverride("font_color", accent);
        value.AddThemeFontSizeOverride("font_size", 23);
        vbox.AddChild(value);
        return value;
    }

    public override void _Process(double delta)
    {
        if (GameState.TickIfRunning((float)delta))
        {
            OnMonthTicked();
            UpdateHud();
        }
    }

    // ---------------------------------------------------------- setup

    private void EnsureWorld()
    {
        if (GameState.World is not null)
        {
            _world = GameState.World;
            _playerId = GameState.PlayerId;
            return;
        }

        // Scene launched outside the normal flow — bootstrap a demo world so
        // the HUD isn't empty.
        try
        {
            var contentPath = TitleScreen.ResolveContentPath();
            var catalog = GameState.Catalog ?? ContentLoader.Load(contentPath);
            GameState.Catalog = catalog;

            var world = new World(catalog, seed: 42, new GameDate(2026, 1));
            var player = world.CreateCompany("Acme Corp", 30_000_000m);
            _playerId = player.Id;
            GameState.PlayerId = player.Id;

            var rival = world.CreateCompany("RivalCo", 25_000_000m);
            world.RegisterAi(rival.Id, new AdaptiveStrategy());
            world.RegisterAi(_playerId, new AdaptiveStrategy());

            _world = world;
            GameState.World = world;
            GameState.ScenarioName = "Demo";
            GameState.History.Clear();
            GameState.RecordSnapshot();
        }
        catch (Exception ex)
        {
            GD.PushError($"[Magnate.Client] World bootstrap failed: {ex.Message}");
            if (_statusLabel is not null) _statusLabel.Text = $"Error: {ex.Message}";
        }
    }

    // ---------------------------------------------------------- input

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is not InputEventKey key || !key.Pressed || key.Echo) return;

        switch (key.Keycode)
        {
            case Key.Space:
                OnTogglePlay();
                break;
            case Key.Period:
                // Only advance manually when paused — holding Space to pause and
                // tapping "." feels natural; ignoring when playing avoids surprise.
                if (!GameState.IsPlaying) OnAdvanceOne();
                else return;
                break;
            case Key.Key1:
                SetSpeed(1.0f);
                break;
            case Key.Key2:
                SetSpeed(0.5f);
                break;
            case Key.Key3:
                SetSpeed(0.2f);
                break;
            case Key.M:
                OnOpenManage();
                break;
            case Key.R:
                OnOpenReports();
                break;
            case Key.C:
                OnOpenCityMap();
                break;
            case Key.T:
                OnOpenResearchTree();
                break;
            case Key.S:
                OnOpenSaveMenu();
                break;
            case Key.F:
                OnOpenFinancials();
                break;
            case Key.I:
                OnOpenMarketIntel();
                break;
            case Key.A:
                OnOpenActivityFeed();
                break;
            case Key.P:
                OnOpenReplay();
                break;
            case Key.X:
                OnOpenStats();
                break;
            case Key.Question:
            case Key.Slash:
                OnOpenHelp();
                break;
            case Key.Escape:
                OnBackToTitle();
                break;
            default:
                return;
        }

        GetViewport().SetInputAsHandled();
    }

    private void OnTogglePlay()
    {
        GameState.IsPlaying = !GameState.IsPlaying;
        if (_playButton is not null) _playButton.Text = GameState.IsPlaying ? "Pause (Space)" : "Play (Space)";
        UpdateStatusLabel();
    }

    private void SetSpeed(float secondsPerMonth)
    {
        GameState.SecondsPerMonth = secondsPerMonth;
        // Reset accumulator so the new rate takes effect from "now" rather than
        // immediately firing a queued tick from a previously-slower cadence.
        GameState.TickAccumulator = 0f;
        RefreshSpeedButtons();
        UpdateStatusLabel();
    }

    private void RefreshSpeedButtons()
    {
        if (_speed1xButton is null || _speed2xButton is null || _speed5xButton is null) return;
        // Compare via small epsilon since SecondsPerMonth is a float.
        var s = GameState.SecondsPerMonth;
        _speed1xButton.ButtonPressed = Math.Abs(s - 1.0f) < 0.01f;
        _speed2xButton.ButtonPressed = Math.Abs(s - 0.5f) < 0.01f;
        _speed5xButton.ButtonPressed = Math.Abs(s - 0.2f) < 0.01f;
    }

    private void UpdateStatusLabel()
    {
        if (_statusLabel is null) return;
        var mult = SpeedMultiplierLabel(GameState.SecondsPerMonth);
        _statusLabel.Text = GameState.IsPlaying ? $"Running at {mult}" : $"Paused ({mult})";
    }

    private static string SpeedMultiplierLabel(float secondsPerMonth)
    {
        if (Math.Abs(secondsPerMonth - 1.0f) < 0.01f) return "1×";
        if (Math.Abs(secondsPerMonth - 0.5f) < 0.01f) return "2×";
        if (Math.Abs(secondsPerMonth - 0.2f) < 0.01f) return "5×";
        return $"{1f / Math.Max(0.01f, secondsPerMonth):0.0}×";
    }

    private void OnAdvanceOne()
    {
        if (_world is null) return;
        _world.AdvanceMonth();
        GameState.RecordSnapshot();
        UpdateHud();
    }

    private void OnSave()
    {
        if (_world is null || _statusLabel is null) return;
        try
        {
            var savesDir = OS.GetUserDataDir();
            if (!Directory.Exists(savesDir)) Directory.CreateDirectory(savesDir);

            var safe = string.Join("_", GameState.ScenarioName.Split(Path.GetInvalidFileNameChars()));
            var fileName = $"{safe}-{DateTime.Now:yyyyMMdd-HHmmss}.json";
            var path = Path.Combine(savesDir, fileName);

            // Phase 3.9: carry scenario + player metadata into the save file so
            // loads can restore the Goals tab and the correct player company.
            WorldSaver.Save(_world, path, GameState.ActiveScenario?.Id, _playerId);
            _statusLabel.Text = $"Saved: {fileName}";
        }
        catch (Exception ex)
        {
            _statusLabel.Text = $"Save failed: {ex.Message}";
            GD.PushError($"[Main] save failed: {ex.Message}");
        }
    }

    private void OnBackToTitle()
    {
        GameState.IsPlaying = false;
        GetTree().ChangeSceneToFile("res://scenes/TitleScreen.tscn");
    }

    private void OnOpenReports()
    {
        // Reports is live — don't pause. Play state carries over via GameState.
        GetTree().ChangeSceneToFile("res://scenes/Reports.tscn");
    }

    private void OnOpenManage()
    {
        GameState.IsPlaying = false;
        GetTree().ChangeSceneToFile("res://scenes/Manage.tscn");
    }

    private void OnOpenCityMap()
    {
        // City Map is read-only + live — same pattern as Reports; don't pause.
        GetTree().ChangeSceneToFile("res://scenes/CityMap.tscn");
    }

    private void OnOpenResearchTree()
    {
        // Research Tree is read-only + live — same pattern as Reports; don't pause.
        GetTree().ChangeSceneToFile("res://scenes/ResearchTree.tscn");
    }

    private void OnOpenSaveMenu()
    {
        // Pause while the player manages saves — load is destructive to the
        // current world, and it would be surprising to have time continue passing.
        GameState.IsPlaying = false;
        GetTree().ChangeSceneToFile("res://scenes/SaveMenu.tscn");
    }

    private void OnOpenFinancials()
        => GetTree().ChangeSceneToFile("res://scenes/FinancialStatements.tscn");

    private void OnOpenMarketIntel()
        => GetTree().ChangeSceneToFile("res://scenes/MarketIntel.tscn");

    private void OnOpenActivityFeed()
        => GetTree().ChangeSceneToFile("res://scenes/ActivityFeed.tscn");

    private void OnOpenHelp()
        => GetTree().ChangeSceneToFile("res://scenes/HelpOverlay.tscn");

    private void OnOpenReplay()
        => GetTree().ChangeSceneToFile("res://scenes/ReplayViewer.tscn");

    private void OnOpenStats()
        => GetTree().ChangeSceneToFile("res://scenes/StatsDashboard.tscn");

    private void OnOpenTutorial()
        => GetTree().ChangeSceneToFile("res://scenes/Tutorial.tscn");

    // ---------------------------------------------------------- rendering

    private void UpdateHud()
    {
        if (_world is null) return;

        if (_scenarioLabel is not null) _scenarioLabel.Text = $"Scenario: {GameState.ScenarioName}";
        _dateLabel!.Text = $"Date: {_world.Clock.Now}";

        if (_world.Companies.TryGetValue(_playerId, out var player))
        {
            _playerLabel!.Text = $"{player.Name}: {player.Cash.ToString("C0", Money)}";
            if (_cashMetric is not null) _cashMetric.Text = UiChrome.MoneyShort(player.Cash);
            UpdateExecutiveBrief(_world, player);
        }

        var ai = FindFirstNonPlayer();
        _aiLabel!.Text = ai is null ? "(no competitors)" : $"{ai.Name}: {ai.Cash.ToString("C0", Money)}";
        if (_rivalMetric is not null)
        {
            _rivalMetric.Text = ai is null
                ? "Rival: no competitors in this scenario"
                : $"Rival: {ai.Name} · {UiChrome.MoneyShort(ai.Cash)} cash";
        }

        _worldLabel!.Text = $"{_world.Buildings.Count} buildings, {_world.Ledger.Entries.Count} ledger entries";
        if (_buildingsMetric is not null) _buildingsMetric.Text = _world.Buildings.Count.ToString("N0");
        if (_incomeMetric is not null)
        {
            var now = _world.Clock.Now;
            var pnl = _world.GetIncomeStatement(_playerId, now, now);
            _incomeMetric.Text = UiChrome.MoneyShort(pnl.NetIncome);
            _incomeMetric.AddThemeColorOverride("font_color", pnl.NetIncome >= 0 ? UiChrome.Green : UiChrome.Red);
        }
        if (_assetsMetric is not null)
        {
            var bs = _world.GetBalanceSheet(_playerId);
            _assetsMetric.Text = UiChrome.MoneyShort(bs.TotalAssets);
        }

        var scenario = GameState.ActiveScenario;
        IReadOnlyList<GoalEvaluation>? evals = null;
        if (scenario is not null && scenario.Goals.Count > 0)
            evals = ScenarioRunner.EvaluateGoals(_world, scenario, _playerId);

        UpdateTipPanel(scenario, evals);
        CheckGoalsAndEndStates(scenario, evals);
    }

    private void UpdateExecutiveBrief(World world, Company player)
    {
        if (_briefingTitle is null || _briefingBody is null) return;

        var owned = world.Buildings.Values.Where(b => b.Owner.Equals(_playerId)).ToList();
        var retailers = owned.Count(b => world.Catalog.BuildingType(b.TypeId).Retail);
        var producers = owned.Count(b => world.Catalog.BuildingType(b.TypeId).ProducibleTiers.Count > 0);
        var researchers = owned.Count(b => world.Catalog.BuildingType(b.TypeId).Category == "rd_center");
        var unconfigured = owned.Count(b =>
            b.RetailSlots.Count + b.ProductionSlots.Count + b.ExtractionSlots.Count
            + b.WarehouseSlots.Count + b.ResearchSlots.Count == 0);
        var campaigns = world.AdCampaigns.Count(c => c.Company.Equals(_playerId));
        var now = world.Clock.Now;
        var pnl = world.GetIncomeStatement(_playerId, now, now);

        if (owned.Count == 0)
        {
            _briefingTitle.Text = "Priority: establish your first revenue stream";
            _briefingBody.Text = "Open Build & Operate and use a Starter Investment to enter a city market immediately.";
        }
        else if (unconfigured > 0)
        {
            _briefingTitle.Text = $"Priority: activate {unconfigured} idle building{(unconfigured == 1 ? "" : "s")}";
            _briefingBody.Text = "Unconfigured facilities still consume capital. Assign products and stock targets in the building inspector.";
        }
        else if (retailers == 0)
        {
            _briefingTitle.Text = "Priority: connect production to customers";
            _briefingBody.Text = "You have operating assets but no retail outlet. Add a store so finished goods can earn consumer margin.";
        }
        else if (pnl.NetIncome < 0)
        {
            _briefingTitle.Text = "Priority: restore monthly profitability";
            _briefingBody.Text = $"This month is {UiChrome.MoneyShort(pnl.NetIncome)}. Review prices, idle capacity, advertising spend, and building opex.";
        }
        else if (campaigns == 0)
        {
            _briefingTitle.Text = "Priority: turn availability into preference";
            _briefingBody.Text = "You are selling without active advertising. Build product brand in the city where your retail footprint is strongest.";
        }
        else if (researchers == 0)
        {
            _briefingTitle.Text = "Priority: protect the next margin cycle";
            _briefingBody.Text = "Your commercial engine is working. Add R&D before rivals compound a technology advantage.";
        }
        else
        {
            _briefingTitle.Text = "Priority: scale the strongest operating model";
            _briefingBody.Text = $"{retailers} retail, {producers} production, {researchers} R&D, {campaigns} campaigns. Use Market Intel to choose the next city-product pair.";
        }
    }

    /// <summary>
    /// If an active scenario is set, show the first unachieved goal's description
    /// and progress as a "current goal" tip. Hides entirely for save-loaded games
    /// (no ActiveScenario) or sandbox scenarios (no goals).
    /// </summary>
    private void UpdateTipPanel(Scenario? scenario, IReadOnlyList<GoalEvaluation>? evals)
    {
        if (_tipPanel is null || _tipBody is null || _tipProgress is null || _tipDetail is null) return;
        if (_world is null) return;

        if (scenario is null || evals is null || evals.Count == 0)
        {
            _tipPanel.Visible = false;
            return;
        }

        var nextUnachieved = evals.FirstOrDefault(e => !e.Achieved);

        _tipPanel.Visible = true;
        if (nextUnachieved is null)
        {
            _tipBody.Text = "All goals achieved. You won!";
            _tipProgress.Value = 1.0;
            _tipDetail.Text = $"{evals.Count} / {evals.Count} complete";
        }
        else
        {
            _tipBody.Text = nextUnachieved.Description;
            _tipProgress.Value = nextUnachieved.Progress;
            var completed = evals.Count(e => e.Achieved);
            _tipDetail.Text = $"{nextUnachieved.Detail}  ·  Step {completed + 1} of {evals.Count}";
        }
    }

    // ---------------------------------------------------------- game feel

    /// <summary>
    /// Instances the standalone NewsTicker preview scene and reshapes it into a
    /// thin live strip pinned to the bottom of the HUD. Its Escape/Back handlers
    /// would otherwise hijack Main's navigation, so unhandled input is disabled
    /// and the preview chrome (header, back button) is hidden.
    /// </summary>
    private void EmbedNewsTicker()
    {
        if (_newsTicker is not null) return;
        var scene = GD.Load<PackedScene>("res://scenes/NewsTicker.tscn");
        if (scene is null) return;

        var ticker = scene.Instantiate();
        ticker.SetProcessUnhandledInput(false);
        AddChild(ticker);
        _newsTicker = ticker;

        if (ticker.GetNodeOrNull<Control>("Panel") is { } panel)
        {
            panel.AnchorLeft = 0f;
            panel.AnchorRight = 1f;
            panel.AnchorTop = 1f;
            panel.AnchorBottom = 1f;
            panel.OffsetLeft = 28f;
            panel.OffsetRight = -28f;
            panel.OffsetTop = -44f;
            panel.OffsetBottom = -12f;
            panel.GrowVertical = Control.GrowDirection.Begin;
        }
        if (ticker.GetNodeOrNull<Control>("Panel/VBox") is { } vbox)
        {
            vbox.OffsetLeft = 8f;
            vbox.OffsetRight = -8f;
            vbox.OffsetTop = 2f;
            vbox.OffsetBottom = -2f;
        }
        HideTickerChild(ticker, "Panel/VBox/HeaderLabel");
        HideTickerChild(ticker, "Panel/VBox/SubLabel");
        HideTickerChild(ticker, "Panel/VBox/Spacer");
        HideTickerChild(ticker, "Panel/VBox/BackButton");
    }

    private static void HideTickerChild(Node root, string path)
    {
        if (root.GetNodeOrNull<CanvasItem>(path) is { } n) n.Visible = false;
    }

    /// <summary>
    /// Per-tick notification toasts: net-income sign flips, the one-shot low-cash
    /// warning, and headlines fired this month. Rate-limited so 5× speed can't
    /// spam the stack.
    /// </summary>
    private void OnMonthTicked()
    {
        if (_world is null) return;
        var budget = 2;

        // Subtle tick only at 1× — 5× would turn it into a metronome.
        if (GameState.SecondsPerMonth >= 1.0f) SoundManager.PlaySfx("month_tick");

        if (_world.Companies.TryGetValue(_playerId, out var player))
        {
            var now = _world.Clock.Now;
            var pnl = _world.GetIncomeStatement(_playerId, now, now);
            var sign = pnl.NetIncome < 0m ? -1 : pnl.NetIncome > 0m ? 1 : 0;
            if (sign != 0)
            {
                var prev = GameState.LastNetIncomeSign;
                if (prev == 1 && sign == -1 && budget > 0)
                {
                    Notifications.Show("[b]Monthly net income turned negative[/b]", Notifications.Severity.Warning);
                    SoundManager.PlaySfx("notify_warning");
                    budget--;
                }
                else if (prev == -1 && sign == 1 && budget > 0)
                {
                    Notifications.Show("[b]Back in the black[/b] — monthly net income is positive again", Notifications.Severity.Success);
                    SoundManager.PlaySfx("cash_sale");
                    budget--;
                }
                GameState.LastNetIncomeSign = sign;
            }

            if (!GameState.LowCashWarned && player.Cash < 1_000_000m)
            {
                GameState.LowCashWarned = true;
                if (budget > 0)
                {
                    Notifications.Show($"[b]Cash is low[/b] — {UiChrome.MoneyShort(player.Cash)} remaining", Notifications.Severity.Warning);
                    SoundManager.PlaySfx("notify_warning");
                    budget--;
                }
            }
        }

        var news = _world.NewsLog;
        if (news.Count > GameState.LastNewsCountSeen)
        {
            for (var i = GameState.LastNewsCountSeen; i < news.Count && budget > 0; i++)
            {
                var entry = news[i];
                var sev = entry.Severity == EventSeverity.Major
                    ? Notifications.Severity.Warning
                    : Notifications.Severity.Info;
                Notifications.Show(entry.Headline, sev);
                SoundManager.PlaySfx(sev == Notifications.Severity.Warning ? "notify_warning" : "notify_info");
                budget--;
            }
            GameState.LastNewsCountSeen = news.Count;
        }
    }

    /// <summary>
    /// Celebrates newly-completed goals and fires the win/lose modal at most once
    /// per game. Runs from <see cref="UpdateHud"/> so it also catches states
    /// reached while the player was in a sub-screen.
    /// </summary>
    private void CheckGoalsAndEndStates(Scenario? scenario, IReadOnlyList<GoalEvaluation>? evals)
    {
        if (_world is null) return;

        if (evals is not null)
        {
            if (!GameState.GoalTrackingInitialized)
            {
                // Seed silently so already-achieved goals (e.g. on load) don't burst-toast.
                foreach (var e in evals)
                    if (e.Achieved) GameState.AchievedGoalKeys.Add(e.Description);
                GameState.GoalTrackingInitialized = true;
            }
            else
            {
                foreach (var e in evals)
                {
                    if (!e.Achieved || GameState.AchievedGoalKeys.Contains(e.Description)) continue;
                    GameState.AchievedGoalKeys.Add(e.Description);
                    Notifications.Show($"[b]Goal achieved:[/b] {e.Description}", Notifications.Severity.Success);
                    ScorePopup.SpawnText(ScreenCenter(), "Goal achieved!", UiChrome.Gold);
                    SoundManager.PlaySfx("goal_achieved");
                }
            }
        }

        if (GameState.WinLoseShown) return;

        // WIN — every scenario goal is complete.
        if (evals is not null && evals.Count > 0 && evals.All(e => e.Achieved))
        {
            ShowEndScreen(win: true, "Victory", "Every objective in this scenario is complete.", evals);
            return;
        }

        // LOSE — sustained negative cash.
        if (GameState.ConsecutiveNegativeCashMonths >= 6)
        {
            ShowEndScreen(win: false, "Bankruptcy",
                "Your company held negative cash for six consecutive months.", evals);
            return;
        }

        // LOSE — scenario deadline passed with goals unmet.
        if (scenario?.EndDate is { } end
            && _world.Clock.Now.AsMonthIndex() >= end.AsMonthIndex())
        {
            ShowEndScreen(win: false, "Time's Up",
                $"The scenario deadline ({end}) passed before every objective was met.", evals);
        }
    }

    private void ShowEndScreen(bool win, string heading, string reason, IReadOnlyList<GoalEvaluation>? evals)
    {
        if (GameState.WinLoseShown || _world is null) return;
        GameState.WinLoseShown = true;
        GameState.IsPlaying = false;
        if (_playButton is not null) _playButton.Text = "Play (Space)";
        UpdateStatusLabel();

        var cash = _world.Companies.TryGetValue(_playerId, out var p) ? p.Cash : 0m;
        var corpValue = GameState.History.Count > 0 ? GameState.History[^1].CorporateValue : 0m;
        var months = ElapsedMonths();
        var name = GameState.ScenarioName;

        var scene = GD.Load<PackedScene>("res://scenes/WinLoseScreen.tscn");
        _endScreen = scene.Instantiate<WinLoseScreen>();
        _endScreen.OnContinue = () =>
        {
            if (_endScreen is null) return;
            _endScreen.QueueFree();
            _endScreen = null;
            SoundManager.PlayMusic("gameplay_loop");
        };
        _endScreen.OnBackToTitle = () =>
        {
            GameState.IsPlaying = false;
            GetTree().ChangeSceneToFile("res://scenes/TitleScreen.tscn");
        };
        AddChild(_endScreen);

        if (win)
        {
            var achievements = evals is null
                ? Array.Empty<string>()
                : evals.Select(e => e.Description).ToArray();
            _endScreen.ShowWin(name, months, cash, corpValue, achievements);
            ScorePopup.SpawnText(ScreenCenter(), "You win!", UiChrome.Gold);
            SoundManager.PlayMusic("victory_theme");
            SoundManager.PlaySfx("victory_fanfare");
            SoundManager.PlayVoice("vo_victory");
        }
        else
        {
            _endScreen.ShowLose(heading, reason, name, months, cash, corpValue);
            SoundManager.StopMusic();
            SoundManager.PlaySfx("defeat");
            SoundManager.PlayVoice(heading == "Bankruptcy" ? "vo_defeat_bankrupt" : "vo_defeat_timeup");
        }
    }

    private int ElapsedMonths()
    {
        if (_world is null) return 0;
        var nowIdx = _world.Clock.Now.AsMonthIndex();
        var start = GameState.ActiveScenario?.StartDate;
        if (start is not null) return Math.Max(0, nowIdx - start.Value.AsMonthIndex());
        if (GameState.History.Count > 0) return Math.Max(0, nowIdx - GameState.History[0].Date.AsMonthIndex());
        return 0;
    }

    private Vector2 ScreenCenter() => GetViewport().GetVisibleRect().Size / 2f;

    private Company? FindFirstNonPlayer()
    {
        if (_world is null) return null;
        foreach (var company in _world.Companies.Values)
        {
            if (company.Id != _playerId) return company;
        }
        return null;
    }
}
