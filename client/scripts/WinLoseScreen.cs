using System;
using System.Collections.Generic;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Modal end-of-game overlay instanced into Main. <see cref="ShowWin"/> renders a
/// celebratory gold panel when every scenario goal is met; <see cref="ShowLose"/>
/// renders a red panel for bankruptcy or a passed scenario end-date. The overlay
/// dims and blocks the HUD beneath it and fades in. Both buttons route through the
/// <see cref="OnContinue"/> / <see cref="OnBackToTitle"/> callbacks the owner wires
/// up, so Main controls whether play resumes. Styled with the game's chrome via
/// <see cref="UiChrome"/>; the accent colours are replicated locally so the panel
/// stays self-contained.
/// </summary>
public partial class WinLoseScreen : CanvasLayer
{
    /// <summary>Invoked by "Continue playing" / "Keep playing (sandbox)".</summary>
    public Action? OnContinue;

    /// <summary>Invoked by "Back to title".</summary>
    public Action? OnBackToTitle;

    public void ShowWin(string scenarioName, int elapsedMonths, decimal cash, decimal corporateValue, IReadOnlyList<string> achievements)
    {
        Build(
            win: true,
            heading: "Victory",
            scenarioName: scenarioName,
            elapsedMonths: elapsedMonths,
            cash: cash,
            corporateValue: corporateValue,
            reason: "Every objective in this scenario is complete.",
            statLines: achievements,
            primaryLabel: "Continue playing",
            secondaryLabel: "Back to title");
    }

    public void ShowLose(string heading, string reason, string scenarioName, int elapsedMonths, decimal cash, decimal corporateValue)
    {
        Build(
            win: false,
            heading: heading,
            scenarioName: scenarioName,
            elapsedMonths: elapsedMonths,
            cash: cash,
            corporateValue: corporateValue,
            reason: reason,
            statLines: Array.Empty<string>(),
            primaryLabel: "Keep playing (sandbox)",
            secondaryLabel: "Back to title");
    }

    private void Build(
        bool win,
        string heading,
        string scenarioName,
        int elapsedMonths,
        decimal cash,
        decimal corporateValue,
        string reason,
        IReadOnlyList<string> statLines,
        string primaryLabel,
        string secondaryLabel)
    {
        var accent = win ? UiChrome.Gold : UiChrome.Red;

        // Full-screen dimmer that also swallows input to the HUD beneath.
        var dim = new ColorRect
        {
            Color = new Color(0f, 0f, 0f, 0.62f),
            MouseFilter = Control.MouseFilterEnum.Stop,
        };
        UiChrome.FullRect(dim);
        AddChild(dim);

        var center = new CenterContainer();
        UiChrome.FullRect(center);
        dim.AddChild(center);

        var panel = new PanelContainer { CustomMinimumSize = new Vector2(560, 0) };
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.070f, 0.088f, 0.98f),
            new Color(accent.R, accent.G, accent.B, 0.85f),
            borderWidth: 2,
            radius: 8,
            marginX: 28,
            marginY: 24));
        center.AddChild(panel);

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 12);
        panel.AddChild(vbox);

        var kicker = new Label { Text = win ? "SCENARIO COMPLETE" : "GAME OVER" };
        kicker.AddThemeFontSizeOverride("font_size", 12);
        kicker.AddThemeColorOverride("font_color", accent);
        vbox.AddChild(kicker);

        var title = new Label { Text = heading };
        title.AddThemeFontSizeOverride("font_size", 40);
        title.AddThemeColorOverride("font_color", accent);
        vbox.AddChild(title);

        var sub = new Label
        {
            Text = $"{scenarioName}  ·  {elapsedMonths} month{(elapsedMonths == 1 ? "" : "s")} elapsed",
        };
        sub.AddThemeColorOverride("font_color", UiChrome.Muted);
        vbox.AddChild(sub);

        var reasonLabel = new Label { Text = reason, AutowrapMode = TextServer.AutowrapMode.WordSmart };
        vbox.AddChild(reasonLabel);

        vbox.AddChild(new HSeparator());

        var metrics = new GridContainer { Columns = 2 };
        metrics.AddThemeConstantOverride("h_separation", 12);
        metrics.AddThemeConstantOverride("v_separation", 8);
        vbox.AddChild(metrics);
        metrics.AddChild(StatCard("Final cash", UiChrome.MoneyShort(cash), UiChrome.Green));
        metrics.AddChild(StatCard("Corporate value", UiChrome.MoneyShort(corporateValue), UiChrome.Blue));

        foreach (var line in statLines)
        {
            var l = new Label { Text = "•  " + line, AutowrapMode = TextServer.AutowrapMode.WordSmart };
            l.AddThemeColorOverride("font_color", new Color(0.84f, 0.90f, 0.92f));
            vbox.AddChild(l);
        }

        vbox.AddChild(new HSeparator());

        var buttons = new HBoxContainer();
        buttons.AddThemeConstantOverride("separation", 12);
        buttons.Alignment = BoxContainer.AlignmentMode.Center;
        vbox.AddChild(buttons);

        var primary = new Button { Text = primaryLabel, CustomMinimumSize = new Vector2(200, 42) };
        primary.Pressed += () => OnContinue?.Invoke();
        buttons.AddChild(primary);

        var secondary = new Button { Text = secondaryLabel, CustomMinimumSize = new Vector2(160, 42) };
        secondary.Pressed += () => OnBackToTitle?.Invoke();
        buttons.AddChild(secondary);

        // Fade in.
        dim.Modulate = new Color(1, 1, 1, 0);
        var tween = dim.CreateTween();
        tween.TweenProperty(dim, "modulate:a", 1.0f, 0.25f);
    }

    private static PanelContainer StatCard(string title, string value, Color accent)
    {
        var card = new PanelContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        card.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.06f, 0.10f, 0.13f, 0.90f),
            new Color(accent.R, accent.G, accent.B, 0.55f),
            marginX: 14,
            marginY: 10));

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);
        card.AddChild(vbox);

        var t = new Label { Text = title };
        t.AddThemeColorOverride("font_color", UiChrome.Muted);
        t.AddThemeFontSizeOverride("font_size", 12);
        vbox.AddChild(t);

        var v = new Label { Text = value, ClipText = true };
        v.AddThemeColorOverride("font_color", accent);
        v.AddThemeFontSizeOverride("font_size", 24);
        vbox.AddChild(v);
        return card;
    }
}
