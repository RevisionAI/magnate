using System;
using Godot;
using Magnate.Engine.Scenarios;

namespace Magnate.Client;

/// <summary>
/// A compact, self-sufficient overlay that turns the "tutorial" scenario's five
/// goals into a guided, step-by-step experience. It reads goal-achievement from
/// <see cref="ScenarioRunner.EvaluateGoals"/> (the same source the HUD tip panel
/// uses) and advances itself automatically as each underlying goal is met — no
/// manual "next" button.
///
/// Design notes:
///  • Zero engine / GameState / Main.cs coupling. The integrator calls
///    <see cref="TryAttach"/> once after a world is live; from there the overlay
///    polls <see cref="GameState"/> on its own <c>_Process</c> and needs no ticks.
///  • Only activates when the active scenario id == "tutorial"; a no-op otherwise.
///  • Anchored to the top-right edge with a bounded height so it never covers the
///    left-column playback controls or the bottom-right Manage command grid. A
///    collapse toggle shrinks it to a slim tab for absolute safety.
///  • Each step carries a stable string id (<see cref="CurrentStepId"/>) and the
///    <see cref="StepChanged"/> signal fires on every transition, so a later audio
///    pass can attach per-step voice-over without touching this file's layout.
///
/// The overlay replicates <c>UiChrome</c>'s palette locally (a few Color literals)
/// rather than depending on its helpers, keeping this file drop-in and self-contained.
/// </summary>
public partial class GuidedTutorial : CanvasLayer
{
    /// <summary>Scenario id this overlay is scoped to. Attaching under any other scenario is a no-op.</summary>
    public const string TutorialScenarioId = "tutorial";

    /// <summary>Fires whenever the active step changes, including the initial step and the final "complete" state.</summary>
    [Signal]
    public delegate void StepChangedEventHandler(string stepId);

    /// <summary>
    /// Short, imperative overlay copy per goal, keyed by goal index. Kept here (not in
    /// tutorial.json) so the scenario file stays schema-valid and the fuller goal
    /// descriptions remain the source of truth for the HUD tip panel and Reports.
    /// <c>Id</c> is a stable slug for per-step audio; order must match the scenario's goals.
    /// </summary>
    private static readonly StepCopy[] _steps =
    {
        new("build-store", "Build a supermarket",
            "Open Manage, go to the Build tab, pick any city, choose Supermarket and click Construct.",
            "Buildings are the assets that earn revenue — nothing happens until you own one."),
        new("stock-shelf", "Stock soft drinks",
            "In the store's Inspect view, set a retail slot to soft_drink at about $1.80, restock target ~500,000.",
            "A stocked shelf is what customers actually buy from. No product, no sales."),
        new("let-time-pass", "Play 3 months",
            "Return to the HUD and press Play. Let three months tick by and watch the cash come in.",
            "Sales, costs and cash all accrue each month the simulation runs."),
        new("run-campaign", "Launch a TV campaign",
            "Open Manage → Campaigns and start a soft_drink TV ad in your city at $50,000/month.",
            "Brand awareness builds over time and pulls market share away from rivals who don't advertise."),
        new("grow-value", "Reach $20M value",
            "Tune prices, ad budget and restock targets to grow your corporate value to $20M.",
            "Corporate value — cash plus inventory plus buildings — is the scoreboard for the whole run."),
    };

    // Palette mirrored from UiChrome so this overlay stays visually consistent
    // without taking a dependency on it (UiChrome is owned by another agent).
    private static readonly Color Ink = Hex("0b1117");
    private static readonly Color Gold = Hex("d7b766");
    private static readonly Color Green = Hex("61c28f");
    private static readonly Color Muted = Hex("9fb2bd");
    private static readonly Color Stroke = Hex("375263");

    private Label? _counterLabel;
    private Label? _stepTitle;
    private Label? _stepBody;
    private Label? _whyLabel;
    private Label? _banner;
    private Button? _collapseButton;
    private VBoxContainer? _contentBox;
    private readonly Label[] _rowMarkers = new Label[_steps.Length];
    private readonly Label[] _rowLabels = new Label[_steps.Length];

    private int _currentStep = -1;
    private bool _complete;
    private bool _collapsed;
    private int _lastCompletedCount = -1;
    private float _pollAccumulator;

    /// <summary>Stable id of the active step, or "complete" when all goals are achieved. "idle" before the first refresh.</summary>
    public string CurrentStepId => _complete
        ? "complete"
        : _currentStep >= 0 && _currentStep < _steps.Length ? _steps[_currentStep].Id : "idle";

    /// <summary>
    /// Attaches a guided-tutorial overlay under <paramref name="parent"/> when the
    /// active scenario is the tutorial. Returns the instance, or null if the current
    /// scenario isn't the tutorial (or an overlay is already attached). Safe to call
    /// unconditionally after a world is live.
    /// </summary>
    public static GuidedTutorial? TryAttach(Node parent)
    {
        ArgumentNullException.ThrowIfNull(parent);
        if (GameState.ActiveScenario?.Id != TutorialScenarioId) return null;
        if (parent.GetNodeOrNull("GuidedTutorial") is not null) return null;

        var overlay = new GuidedTutorial { Name = "GuidedTutorial" };
        parent.AddChild(overlay);
        return overlay;
    }

    public override void _Ready()
    {
        Layer = 50; // above the HUD dashboard shell
        BuildUi();
        Refresh();
    }

    public override void _Process(double delta)
    {
        // Self-sufficient polling: the overlay tracks goal state without the
        // integrator wiring any per-tick callback. Throttled — goal state only
        // changes on a month tick or a Manage-scene action, never per frame.
        _pollAccumulator += (float)delta;
        if (_pollAccumulator < 0.2f) return;
        _pollAccumulator = 0f;
        Refresh();
    }

    /// <summary>
    /// Re-reads goal achievement and updates the overlay. Called automatically each
    /// poll; also exposed so an integrator that prefers explicit updates (e.g. right
    /// after a month tick) can drive it directly. Idempotent and cheap.
    /// </summary>
    public void Refresh()
    {
        var scenario = GameState.ActiveScenario;
        var world = GameState.World;
        if (scenario is null || world is null || scenario.Id != TutorialScenarioId)
        {
            Visible = false;
            return;
        }
        Visible = true;

        var evals = ScenarioRunner.EvaluateGoals(world, scenario, GameState.PlayerId);
        var completed = 0;
        var firstUnachieved = -1;
        for (var i = 0; i < evals.Count && i < _steps.Length; i++)
        {
            if (evals[i].Achieved)
            {
                completed++;
            }
            else if (firstUnachieved < 0)
            {
                firstUnachieved = i;
            }
        }

        var nowComplete = firstUnachieved < 0;
        var newStep = nowComplete ? _steps.Length : firstUnachieved;

        // Celebrate whenever the count of completed steps increases.
        if (_lastCompletedCount >= 0 && completed > _lastCompletedCount)
        {
            Celebrate(nowComplete);
        }
        _lastCompletedCount = completed;

        UpdateChecklist(completed, nowComplete ? -1 : firstUnachieved);

        // Fire StepChanged only on an actual transition.
        var stepChanged = newStep != _currentStep || nowComplete != _complete;
        _currentStep = firstUnachieved;
        _complete = nowComplete;
        if (stepChanged)
        {
            RenderStep(completed, evals.Count);
            EmitSignal(SignalName.StepChanged, CurrentStepId);
            SoundManager.PlayVoice(_complete
                ? "vo_tutorial_complete"
                : $"vo_tutorial_step{_currentStep + 1}");
        }
        else
        {
            RenderStep(completed, evals.Count);
        }
    }

    // ---------------------------------------------------------------- rendering

    private void RenderStep(int completed, int total)
    {
        if (_counterLabel is null || _stepTitle is null || _stepBody is null || _whyLabel is null) return;

        if (_complete)
        {
            _counterLabel.Text = $"All {total} steps complete";
            _stepTitle.Text = "Tutorial complete!";
            _stepTitle.AddThemeColorOverride("font_color", Green);
            _stepBody.Text = "You've built a store, shipped a product, run time, advertised, and grown the company. You're ready to run your own scenario.";
            _whyLabel.Visible = false;
            return;
        }

        var step = _steps[Mathf.Clamp(_currentStep, 0, _steps.Length - 1)];
        _counterLabel.Text = $"Step {completed + 1} of {total}";
        _stepTitle.Text = step.Title;
        _stepTitle.AddThemeColorOverride("font_color", Gold);
        _stepBody.Text = step.Body;
        _whyLabel.Visible = true;
        _whyLabel.Text = $"Why: {step.Why}";
    }

    private void UpdateChecklist(int completed, int currentIndex)
    {
        for (var i = 0; i < _steps.Length; i++)
        {
            var marker = _rowMarkers[i];
            var label = _rowLabels[i];
            if (marker is null || label is null) continue;

            if (i < completed)
            {
                marker.Text = "✓"; // ✓
                marker.AddThemeColorOverride("font_color", Green);
                label.AddThemeColorOverride("font_color", Green);
            }
            else if (i == currentIndex)
            {
                marker.Text = "▶"; // ▶
                marker.AddThemeColorOverride("font_color", Gold);
                label.AddThemeColorOverride("font_color", Gold);
            }
            else
            {
                marker.Text = "○"; // ○
                marker.AddThemeColorOverride("font_color", Muted);
                label.AddThemeColorOverride("font_color", Muted);
            }
        }
    }

    /// <summary>Brief in-overlay flash celebrating a just-completed step.</summary>
    private void Celebrate(bool finished)
    {
        if (_banner is null) return;
        _banner.Text = finished ? "Tutorial complete!  ✓" : "Step complete!  ✓";
        _banner.Visible = true;
        _banner.Modulate = new Color(Green.R, Green.G, Green.B, 1f);

        var tween = CreateTween();
        tween.TweenInterval(1.4);
        tween.TweenProperty(_banner, "modulate:a", 0.0, 0.6);
        tween.TweenCallback(Callable.From(() => { if (_banner is not null) _banner.Visible = false; }));
    }

    // ---------------------------------------------------------------- ui build

    private void BuildUi()
    {
        var panel = new PanelContainer
        {
            Name = "Panel",
            AnchorLeft = 1f,
            AnchorRight = 1f,
            AnchorTop = 0f,
            AnchorBottom = 0f,
            GrowHorizontal = Control.GrowDirection.Begin,
            GrowVertical = Control.GrowDirection.End,
            OffsetLeft = -372f,
            OffsetRight = -24f,
            OffsetTop = 92f,
            CustomMinimumSize = new Vector2(348, 0),
            MouseFilter = Control.MouseFilterEnum.Pass,
        };
        panel.AddThemeStyleboxOverride("panel", Box(
            new Color(Ink.R, Ink.G, Ink.B, 0.94f),
            new Color(Gold.R, Gold.G, Gold.B, 0.55f),
            radius: 8, marginX: 16, marginY: 14));
        AddChild(panel);

        var outer = new VBoxContainer();
        outer.AddThemeConstantOverride("separation", 8);
        panel.AddChild(outer);

        // Header: title + collapse toggle.
        var header = new HBoxContainer();
        header.AddThemeConstantOverride("separation", 8);
        outer.AddChild(header);

        var title = new Label { Text = "Guided Tutorial", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        title.AddThemeFontSizeOverride("font_size", 17);
        title.AddThemeColorOverride("font_color", Gold);
        header.AddChild(title);

        _collapseButton = new Button
        {
            Text = "–", // en dash "collapse"
            CustomMinimumSize = new Vector2(30, 26),
            TooltipText = "Collapse / expand the tutorial",
        };
        _collapseButton.Pressed += ToggleCollapsed;
        header.AddChild(_collapseButton);

        _counterLabel = new Label { Text = "Step 1 of 5" };
        _counterLabel.AddThemeFontSizeOverride("font_size", 12);
        _counterLabel.Modulate = Muted;
        outer.AddChild(_counterLabel);

        // Collapsible content.
        _contentBox = new VBoxContainer();
        _contentBox.AddThemeConstantOverride("separation", 8);
        outer.AddChild(_contentBox);

        _stepTitle = new Label { Text = "", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        _stepTitle.AddThemeFontSizeOverride("font_size", 16);
        _stepTitle.AddThemeColorOverride("font_color", Gold);
        _contentBox.AddChild(_stepTitle);

        _stepBody = new Label { Text = "", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        _stepBody.AddThemeFontSizeOverride("font_size", 13);
        _stepBody.Modulate = new Color(0.86f, 0.91f, 0.94f);
        _contentBox.AddChild(_stepBody);

        _whyLabel = new Label { Text = "", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        _whyLabel.AddThemeFontSizeOverride("font_size", 12);
        _whyLabel.Modulate = new Color(Muted.R, Muted.G, Muted.B, 0.95f);
        _contentBox.AddChild(_whyLabel);

        _banner = new Label { Text = "", HorizontalAlignment = HorizontalAlignment.Center, Visible = false };
        _banner.AddThemeFontSizeOverride("font_size", 13);
        _banner.AddThemeColorOverride("font_color", Green);
        _contentBox.AddChild(_banner);

        _contentBox.AddChild(Divider());

        var progressCaption = new Label { Text = "Progress" };
        progressCaption.AddThemeFontSizeOverride("font_size", 11);
        progressCaption.Modulate = Muted;
        _contentBox.AddChild(progressCaption);

        for (var i = 0; i < _steps.Length; i++)
        {
            var row = new HBoxContainer();
            row.AddThemeConstantOverride("separation", 8);
            _contentBox.AddChild(row);

            var marker = new Label { Text = "○", CustomMinimumSize = new Vector2(16, 0) };
            marker.AddThemeFontSizeOverride("font_size", 13);
            marker.AddThemeColorOverride("font_color", Muted);
            row.AddChild(marker);
            _rowMarkers[i] = marker;

            var label = new Label
            {
                Text = _steps[i].Title,
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                AutowrapMode = TextServer.AutowrapMode.WordSmart,
            };
            label.AddThemeFontSizeOverride("font_size", 13);
            label.AddThemeColorOverride("font_color", Muted);
            row.AddChild(label);
            _rowLabels[i] = label;
        }
    }

    private void ToggleCollapsed()
    {
        _collapsed = !_collapsed;
        if (_contentBox is not null) _contentBox.Visible = !_collapsed;
        if (_counterLabel is not null) _counterLabel.Visible = !_collapsed;
        if (_collapseButton is not null) _collapseButton.Text = _collapsed ? "+" : "–";
    }

    // ---------------------------------------------------------------- local chrome

    private static HSeparator Divider()
    {
        var sep = new HSeparator();
        var style = new StyleBoxFlat { BgColor = new Color(Stroke.R, Stroke.G, Stroke.B, 0.5f) };
        style.ContentMarginTop = 1;
        style.ContentMarginBottom = 1;
        sep.AddThemeStyleboxOverride("separator", style);
        return sep;
    }

    private static StyleBoxFlat Box(Color bg, Color border, int radius, int marginX, int marginY)
    {
        var box = new StyleBoxFlat
        {
            BgColor = bg,
            BorderColor = border,
            ContentMarginLeft = marginX,
            ContentMarginRight = marginX,
            ContentMarginTop = marginY,
            ContentMarginBottom = marginY,
            CornerRadiusTopLeft = radius,
            CornerRadiusTopRight = radius,
            CornerRadiusBottomLeft = radius,
            CornerRadiusBottomRight = radius,
        };
        box.BorderWidthLeft = 1;
        box.BorderWidthRight = 1;
        box.BorderWidthTop = 1;
        box.BorderWidthBottom = 1;
        return box;
    }

    private static Color Hex(string hex)
    {
        var r = Convert.ToInt32(hex[..2], 16) / 255f;
        var g = Convert.ToInt32(hex.Substring(2, 2), 16) / 255f;
        var b = Convert.ToInt32(hex.Substring(4, 2), 16) / 255f;
        return new Color(r, g, b);
    }

    /// <summary>Immutable overlay copy for one tutorial step.</summary>
    private readonly record struct StepCopy(string Id, string Title, string Body, string Why);
}
