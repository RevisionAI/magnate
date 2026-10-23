using System.Collections.Generic;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Reusable hover-tooltip helper. Any <see cref="Control"/> can opt in via
/// <see cref="Attach"/>; after <c>hoverDelaySec</c> of sustained hover a
/// styled popup (BBCode-enabled) appears just below the control, clamped to
/// the viewport. No autoload, no project.godot changes — purely additive.
/// Existing scenes are untouched; polish phases adopt incrementally:
/// <code>
/// Tooltip.Attach(myButton, "[b]Advance[/b] one month ([code].[/code])");
/// </code>
/// Popup is parented to a shared <see cref="CanvasLayer"/> (layer 100) that
/// is lazily created under the control's scene root. Generation counter
/// cancels in-flight delay timers if the cursor leaves first.
/// </summary>
public static class Tooltip
{
    private sealed class Binding
    {
        public required Control Control;
        public required string BBCode;
        public required float Delay;
        public int Generation;
        public Callable EnterCallable;
        public Callable ExitCallable;
        public Callable ExitingCallable;
    }

    private static readonly Dictionary<ulong, Binding> _bindings = new();
    private static PanelContainer? _activePopup;
    private static CanvasLayer? _layer;

    /// <summary>
    /// Hooks hover signals on <paramref name="control"/>; after
    /// <paramref name="hoverDelaySec"/> of continuous hover a popup appears
    /// rendering <paramref name="bbcodeText"/>. Safe to call multiple times
    /// on the same control — the previous binding is detached first.
    /// </summary>
    public static void Attach(Control control, string bbcodeText, float hoverDelaySec = 0.25f)
    {
        ArgumentNullException.ThrowIfNull(control);
        Detach(control);

        var binding = new Binding
        {
            Control = control,
            BBCode = bbcodeText,
            Delay = hoverDelaySec,
            EnterCallable = default,
            ExitCallable = default,
            ExitingCallable = default,
        };

        binding.EnterCallable = Callable.From(() => OnEnter(binding));
        binding.ExitCallable = Callable.From(() => OnExit(binding));
        binding.ExitingCallable = Callable.From(() => Detach(control));

        control.Connect(Control.SignalName.MouseEntered, binding.EnterCallable);
        control.Connect(Control.SignalName.MouseExited, binding.ExitCallable);
        control.Connect(Node.SignalName.TreeExiting, binding.ExitingCallable);

        _bindings[control.GetInstanceId()] = binding;
    }

    /// <summary>
    /// Disconnects signals and forgets the binding for <paramref name="control"/>.
    /// Idempotent; safe to call on an un-attached control.
    /// </summary>
    public static void Detach(Control control)
    {
        if (control == null) return;
        var id = control.GetInstanceId();
        if (!_bindings.TryGetValue(id, out var binding)) return;

        if (control.IsConnected(Control.SignalName.MouseEntered, binding.EnterCallable))
            control.Disconnect(Control.SignalName.MouseEntered, binding.EnterCallable);
        if (control.IsConnected(Control.SignalName.MouseExited, binding.ExitCallable))
            control.Disconnect(Control.SignalName.MouseExited, binding.ExitCallable);
        if (control.IsConnected(Node.SignalName.TreeExiting, binding.ExitingCallable))
            control.Disconnect(Node.SignalName.TreeExiting, binding.ExitingCallable);

        binding.Generation++;
        _bindings.Remove(id);

        // If the active popup belonged to this control, clear it.
        HidePopup();
    }

    private static async void OnEnter(Binding binding)
    {
        var gen = ++binding.Generation;
        var control = binding.Control;
        if (!IsInstanceValid(control) || !control.IsInsideTree()) return;

        var timer = control.GetTree().CreateTimer(binding.Delay);
        await control.ToSignal(timer, SceneTreeTimer.SignalName.Timeout);

        // Cancelled by exit or re-enter.
        if (gen != binding.Generation) return;
        if (!IsInstanceValid(control) || !control.IsInsideTree()) return;

        ShowPopup(control, binding.BBCode);
    }

    private static void OnExit(Binding binding)
    {
        binding.Generation++;
        HidePopup();
    }

    private static void ShowPopup(Control anchor, string bbcode)
    {
        HidePopup();

        var layer = GetOrCreateLayer(anchor);
        if (layer == null) return;

        var popup = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore };

        var style = new StyleBoxFlat
        {
            BgColor = new Color(0.10f, 0.10f, 0.13f, 0.95f),
            BorderColor = new Color(0.4f, 0.4f, 0.45f),
            CornerRadiusTopLeft = 4,
            CornerRadiusTopRight = 4,
            CornerRadiusBottomLeft = 4,
            CornerRadiusBottomRight = 4,
            BorderWidthLeft = 1,
            BorderWidthTop = 1,
            BorderWidthRight = 1,
            BorderWidthBottom = 1,
            ContentMarginLeft = 8,
            ContentMarginRight = 8,
            ContentMarginTop = 6,
            ContentMarginBottom = 6,
        };
        popup.AddThemeStyleboxOverride("panel", style);

        var label = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            CustomMinimumSize = new Vector2(200, 0),
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        label.Text = bbcode;
        // Cap the wrap width so long tooltips stay readable.
        label.SetDeferred(Control.PropertyName.Size, new Vector2(400, 0));
        popup.AddChild(label);

        layer.AddChild(popup);

        // Position after a frame so popup.Size reflects content.
        popup.CallDeferred(nameof(Control.SetPosition), ComputePosition(anchor, popup));
        _activePopup = popup;
    }

    private static Vector2 ComputePosition(Control anchor, PanelContainer popup)
    {
        var viewport = anchor.GetViewport();
        if (viewport == null) return anchor.GlobalPosition;

        var size = popup.Size;
        if (size == Vector2.Zero) size = popup.GetCombinedMinimumSize();

        var viewSize = viewport.GetVisibleRect().Size;
        var pos = anchor.GlobalPosition + new Vector2(0, anchor.Size.Y + 4);

        // Clamp to viewport: keep popup fully on-screen.
        pos.X = Mathf.Clamp(pos.X, 0, Mathf.Max(0, viewSize.X - size.X));
        if (pos.Y + size.Y > viewSize.Y)
        {
            // Flip above the anchor if there's no room below.
            pos.Y = Mathf.Max(0, anchor.GlobalPosition.Y - size.Y - 4);
        }
        return pos;
    }

    private static void HidePopup()
    {
        if (_activePopup == null) return;
        if (IsInstanceValid(_activePopup)) _activePopup.QueueFree();
        _activePopup = null;
    }

    private static CanvasLayer? GetOrCreateLayer(Node anchor)
    {
        if (_layer != null && IsInstanceValid(_layer) && _layer.IsInsideTree())
            return _layer;

        var tree = anchor.GetTree();
        var root = tree?.CurrentScene ?? anchor.GetTree()?.Root;
        if (root == null) return null;

        _layer = new CanvasLayer { Layer = 100, Name = "TooltipLayer" };
        root.AddChild(_layer);
        return _layer;
    }

    private static bool IsInstanceValid(GodotObject o) => GodotObject.IsInstanceValid(o);
}
