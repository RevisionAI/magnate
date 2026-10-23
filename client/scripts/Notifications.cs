using System.Collections.Generic;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Reusable notification toast helper. Any scene can call
/// <see cref="Show"/> to spawn a top-right toast popup that fades in,
/// holds briefly, and fades out. Multiple toasts stack vertically with
/// 8px separation and re-layout when one expires. Severity tints the
/// border (Info / Success / Warning / Error). No autoload, no
/// project.godot changes — purely additive. Existing scenes are
/// untouched; phases adopt incrementally:
/// <code>
/// Notifications.Show("[b]Goal[/b]: $50M reached", Notifications.Severity.Success);
/// </code>
/// Toasts parent to a shared <see cref="CanvasLayer"/> (layer 110)
/// lazily created under the active scene root. Lifecycle is driven by
/// <see cref="SceneTreeTimer"/> + <see cref="Tween"/> for fade-in /
/// fade-out animations.
/// </summary>
public static class Notifications
{
    public enum Severity { Info, Success, Warning, Error }

    private const int ToastWidth = 380;
    private const int ToastMinWidth = 280;
    private const int EdgeMargin = 24;
    private const int StackSeparation = 8;
    private const float FadeInSec = 0.20f;
    private const float FadeOutSec = 0.20f;
    private const int CanvasLayerIndex = 110;

    private static CanvasLayer? _layer;
    private static readonly List<PanelContainer> _activeToasts = new();

    /// <summary>
    /// Spawns a toast in the running scene. Looks up the active
    /// <see cref="SceneTree"/> via <see cref="Engine.GetMainLoop"/>.
    /// </summary>
    public static void Show(string bbcodeText, Severity severity = Severity.Info, float durationSec = 4.0f)
    {
        if (Godot.Engine.GetMainLoop() is not SceneTree tree) return;
        SpawnToast(tree, bbcodeText, severity, durationSec);
    }

    /// <summary>
    /// Explicit form when the static main-loop lookup is risky (e.g.
    /// during scene transitions). Uses <paramref name="sceneRoot"/>'s
    /// <see cref="SceneTree"/>.
    /// </summary>
    public static void ShowFor(Node sceneRoot, string bbcodeText, Severity severity, float durationSec)
    {
        ArgumentNullException.ThrowIfNull(sceneRoot);
        var tree = sceneRoot.GetTree();
        if (tree == null) return;
        SpawnToast(tree, bbcodeText, severity, durationSec);
    }

    /// <summary>
    /// Removes every active toast and clears the active list.
    /// Idempotent.
    /// </summary>
    public static void ClearAll()
    {
        foreach (var toast in _activeToasts.ToArray())
        {
            if (IsInstanceValid(toast)) toast.QueueFree();
        }
        _activeToasts.Clear();
    }

    private static async void SpawnToast(SceneTree tree, string bbcodeText, Severity severity, float durationSec)
    {
        var layer = EnsureLayer(tree);
        if (layer == null) return;

        var toast = BuildToast(bbcodeText, severity);
        toast.Modulate = new Color(1, 1, 1, 0);
        layer.AddChild(toast);

        // TreeExiting → defensive cleanup so stale references don't pile
        // up across scene transitions.
        toast.TreeExiting += () =>
        {
            if (_activeToasts.Remove(toast)) RelayoutStack();
        };

        _activeToasts.Add(toast);
        RelayoutStack();

        // Fade-in: alpha 0 → 1.
        var fadeIn = toast.CreateTween();
        fadeIn.TweenProperty(toast, "modulate:a", 1.0f, FadeInSec);
        await toast.ToSignal(fadeIn, Tween.SignalName.Finished);
        if (!IsInstanceValid(toast)) return;

        // Hold.
        var holdTimer = tree.CreateTimer(durationSec);
        await toast.ToSignal(holdTimer, SceneTreeTimer.SignalName.Timeout);
        if (!IsInstanceValid(toast)) return;

        // Fade-out: alpha 1 → 0.
        var fadeOut = toast.CreateTween();
        fadeOut.TweenProperty(toast, "modulate:a", 0.0f, FadeOutSec);
        await toast.ToSignal(fadeOut, Tween.SignalName.Finished);
        if (!IsInstanceValid(toast)) return;

        // Remove. TreeExiting handler re-lays out the remaining stack.
        toast.QueueFree();
    }

    private static PanelContainer BuildToast(string bbcodeText, Severity severity)
    {
        var panel = new PanelContainer
        {
            MouseFilter = Control.MouseFilterEnum.Ignore,
            CustomMinimumSize = new Vector2(ToastMinWidth, 0),
        };

        var style = new StyleBoxFlat
        {
            BgColor = new Color(0.10f, 0.10f, 0.13f, 0.95f),
            BorderColor = SeverityColor(severity),
            CornerRadiusTopLeft = 4,
            CornerRadiusTopRight = 4,
            CornerRadiusBottomLeft = 4,
            CornerRadiusBottomRight = 4,
            BorderWidthLeft = 2,
            BorderWidthTop = 2,
            BorderWidthRight = 2,
            BorderWidthBottom = 2,
            ContentMarginLeft = 12,
            ContentMarginRight = 12,
            ContentMarginTop = 12,
            ContentMarginBottom = 12,
        };
        panel.AddThemeStyleboxOverride("panel", style);

        var hbox = new HBoxContainer
        {
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        hbox.AddThemeConstantOverride("separation", 8);
        panel.AddChild(hbox);

        var icon = new Label
        {
            Text = SeverityIcon(severity),
            MouseFilter = Control.MouseFilterEnum.Ignore,
            VerticalAlignment = VerticalAlignment.Top,
        };
        icon.AddThemeColorOverride("font_color", SeverityColor(severity));
        hbox.AddChild(icon);

        var label = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            CustomMinimumSize = new Vector2(ToastMinWidth, 0),
            MouseFilter = Control.MouseFilterEnum.Ignore,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        label.Text = bbcodeText;
        // Cap the wrap width so long toasts stay readable.
        label.SetDeferred(Control.PropertyName.Size, new Vector2(ToastWidth, 0));
        hbox.AddChild(label);

        // Top-right anchored: anchor_left=anchor_right=1.0 with negative
        // offsets gives a fixed-width column hugging the right edge.
        panel.AnchorLeft = 1.0f;
        panel.AnchorRight = 1.0f;
        panel.AnchorTop = 0.0f;
        panel.AnchorBottom = 0.0f;
        panel.OffsetLeft = -EdgeMargin - ToastWidth;
        panel.OffsetRight = -EdgeMargin;
        panel.GrowHorizontal = Control.GrowDirection.Begin;
        panel.GrowVertical = Control.GrowDirection.End;

        return panel;
    }

    private static void RelayoutStack()
    {
        float y = EdgeMargin;
        foreach (var toast in _activeToasts)
        {
            if (!IsInstanceValid(toast)) continue;
            var size = toast.Size;
            if (size == Vector2.Zero) size = toast.GetCombinedMinimumSize();

            toast.OffsetTop = y;
            toast.OffsetBottom = y + size.Y;
            y += size.Y + StackSeparation;
        }
    }

    private static Color SeverityColor(Severity s) => s switch
    {
        Severity.Success => new Color(0.30f, 0.78f, 0.40f),
        Severity.Warning => new Color(0.85f, 0.65f, 0.20f),
        Severity.Error => new Color(0.85f, 0.30f, 0.30f),
        _ => new Color(0.40f, 0.40f, 0.45f),
    };

    private static string SeverityIcon(Severity s) => s switch
    {
        Severity.Success => "✓",  // ✓
        Severity.Warning => "⚠",  // ⚠
        Severity.Error => "✕",    // ✕
        _ => "ℹ",                 // ℹ
    };

    private static CanvasLayer? EnsureLayer(SceneTree tree)
    {
        if (_layer != null && IsInstanceValid(_layer) && _layer.IsInsideTree())
            return _layer;

        var root = (Node?)tree.CurrentScene ?? tree.Root;
        if (root == null) return null;

        _layer = new CanvasLayer { Layer = CanvasLayerIndex, Name = "NotificationLayer" };
        root.AddChild(_layer);
        return _layer;
    }

    private static bool IsInstanceValid(GodotObject o) => GodotObject.IsInstanceValid(o);
}
