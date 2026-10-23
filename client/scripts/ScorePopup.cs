using System.Collections.Generic;
using System.Globalization;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Reusable floating score-popup helper. Any scene can call
/// <see cref="Spawn"/> or <see cref="SpawnText"/> to spawn a label that
/// rises ~60px and fades from alpha 1.0 → 0.0 over ~1.2 seconds before
/// freeing itself. The "+$1,234" feel from idle/business games. No
/// autoload, no project.godot changes — purely additive. Existing
/// scenes are untouched; phases adopt incrementally:
/// <code>
/// ScorePopup.Spawn(retailButton.GlobalPosition + retailButton.Size / 2, saleAmount);
/// ScorePopup.SpawnText(centerOfScreen, "Goal achieved!", Colors.Gold);
/// </code>
/// Popups parent to a shared <see cref="CanvasLayer"/> (layer 105)
/// lazily created under the active scene root. Lifecycle is driven by
/// <see cref="Tween"/> running position + modulate animations in
/// parallel; ease-out so the text is readable as it fades.
/// </summary>
public static class ScorePopup
{
    private const float LifetimeSec = 1.2f;
    private const float RiseDistance = 60f;
    private const float JitterRange = 5f;
    private const int FontSize = 22;
    private const int CanvasLayerIndex = 105;

    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");
    private static readonly Color PositiveColor = new(0.30f, 0.78f, 0.40f);
    private static readonly Color NegativeColor = new(0.85f, 0.30f, 0.30f);
    private static readonly Color ZeroColor = new(0.65f, 0.65f, 0.68f);
    private static readonly Color OutlineColor = new(0, 0, 0, 0.6f);

    private static CanvasLayer? _layer;
    private static readonly List<Label> _activePopups = new();
    private static readonly RandomNumberGenerator _rng = new();

    /// <summary>
    /// Spawns a floating "+$X" / "-$X" label at <paramref name="globalPosition"/>.
    /// Color is auto-derived from the sign of <paramref name="amount"/> unless
    /// <paramref name="color"/> is supplied. Looks up the active
    /// <see cref="SceneTree"/> via <see cref="Engine.GetMainLoop"/>.
    /// </summary>
    public static void Spawn(Vector2 globalPosition, decimal amount, Color? color = null)
    {
        if (Godot.Engine.GetMainLoop() is not SceneTree tree) return;
        var sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
        var magnitude = System.Math.Abs(amount);
        var text = sign + magnitude.ToString("C0", Money);
        var resolved = color ?? (amount > 0 ? PositiveColor : amount < 0 ? NegativeColor : ZeroColor);
        SpawnInternal(tree, globalPosition, text, resolved);
    }

    /// <summary>
    /// Spawns arbitrary <paramref name="text"/> at <paramref name="globalPosition"/>
    /// with the given <paramref name="color"/>. Useful for "+5 Brand!" or
    /// "Goal achieved!" — anything that isn't a $-amount.
    /// </summary>
    public static void SpawnText(Vector2 globalPosition, string text, Color color)
    {
        if (Godot.Engine.GetMainLoop() is not SceneTree tree) return;
        SpawnInternal(tree, globalPosition, text, color);
    }

    /// <summary>
    /// Removes every active popup and clears the active list. Idempotent.
    /// </summary>
    public static void ClearAll()
    {
        foreach (var popup in _activePopups.ToArray())
        {
            if (IsInstanceValid(popup)) popup.QueueFree();
        }
        _activePopups.Clear();
    }

    private static async void SpawnInternal(SceneTree tree, Vector2 globalPosition, string text, Color color)
    {
        var layer = EnsureLayer(tree);
        if (layer == null) return;

        var label = BuildLabel(text, color);

        // Subtle horizontal jitter for organic feel.
        var jitterX = _rng.RandfRange(-JitterRange, JitterRange);
        var startPos = new Vector2(globalPosition.X + jitterX, globalPosition.Y);

        // Center the label horizontally on the spawn point. Defer until
        // size is computed so we know the actual width.
        label.Position = startPos;
        layer.AddChild(label);
        label.CallDeferred(nameof(Control.SetPosition),
            new Vector2(startPos.X - label.Size.X / 2f, startPos.Y - label.Size.Y / 2f));

        // Defensive cleanup so stale references don't pile up across
        // scene transitions.
        label.TreeExiting += () => _activePopups.Remove(label);

        _activePopups.Add(label);

        var endY = startPos.Y - RiseDistance - label.Size.Y / 2f;

        // Parallel tween: position rises while modulate alpha fades.
        // Ease-out on alpha so the text stays readable, fading slow at end.
        var tween = label.CreateTween();
        tween.SetParallel(true);
        tween.TweenProperty(label, "position:y", endY, LifetimeSec);
        tween.TweenProperty(label, "modulate:a", 0.0f, LifetimeSec)
            .SetEase(Tween.EaseType.Out);

        await label.ToSignal(tween, Tween.SignalName.Finished);
        if (!IsInstanceValid(label)) return;

        label.QueueFree();
    }

    private static Label BuildLabel(string text, Color color)
    {
        var label = new Label
        {
            Text = text,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            ZIndex = 1,
        };
        label.AddThemeFontSizeOverride("font_size", FontSize);
        label.AddThemeColorOverride("font_color", color);
        label.AddThemeColorOverride("font_outline_color", OutlineColor);
        label.AddThemeConstantOverride("outline_size", 2);
        return label;
    }

    private static CanvasLayer? EnsureLayer(SceneTree tree)
    {
        if (_layer != null && IsInstanceValid(_layer) && _layer.IsInsideTree())
            return _layer;

        var root = (Node?)tree.CurrentScene ?? tree.Root;
        if (root == null) return null;

        _layer = new CanvasLayer { Layer = CanvasLayerIndex, Name = "ScorePopupLayer" };
        root.AddChild(_layer);
        return _layer;
    }

    private static bool IsInstanceValid(GodotObject o) => GodotObject.IsInstanceValid(o);
}
