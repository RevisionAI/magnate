using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using Godot;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Always-visible scrolling banner that surfaces the latest entries from
/// <c>World.NewsLog</c> (the field added by Phase 3.65). Defensive: uses
/// reflection to detect the property — if the engine doesn't expose
/// <c>NewsLog</c> yet (Phase 3.65 hasn't landed), the ticker shows a
/// placeholder and never throws.
///
/// Implementation (approach 1 from the spec): a single <see cref="RichTextLabel"/>
/// whose X position is advanced each <c>_Process</c> by ScrollPixelsPerSecond.
/// All current headlines are composed into one long BBCode string with
/// "   •   " separators and severity-coded colors. The text is rebuilt
/// only when the upstream NewsLog count changes (cheap polling).
///
/// Standalone preview scene — final integration will embed this widget into
/// Main's HUD; see <c>docs/plan/phase-3.67-status.md</c>.
/// </summary>
public partial class NewsTicker : Node
{
    /// <summary>Horizontal scroll speed in pixels per real-time second.</summary>
    private const float ScrollPixelsPerSecond = 30f;

    /// <summary>Visual height of the ticker strip.</summary>
    private const float StripHeight = 36f;

    /// <summary>Separator inserted between adjacent headlines.</summary>
    private const string Separator = "   •   ";

    // BBCode color codes per severity. White ("Notable") emits no color tag —
    // the RichTextLabel's default modulate applies.
    private const string ColorInfo  = "#888888";
    private const string ColorMajor = "#F5C050";

    // Scene refs.
    private PanelContainer? _strip;
    private Control? _scroller;       // moved by _Process
    private RichTextLabel? _label;

    // Cached state.
    private int _lastNewsLogCount = -1;
    private bool _hasNewsLog;          // false → placeholder mode, no scroll
    private float _stripWidth;         // cached width of the visible strip

    public override void _Ready()
    {
        _strip   = GetNode<PanelContainer>("Panel/VBox/TickerStrip");
        _scroller = GetNode<Control>("Panel/VBox/TickerStrip/Scroller");
        _label   = GetNode<RichTextLabel>("Panel/VBox/TickerStrip/Scroller/Headlines");

        var back = GetNodeOrNull<Button>("Panel/VBox/BackButton");
        if (back is not null) back.Pressed += OnBack;

        // Apply the dark navy + gold underline style.
        _strip.AddThemeStyleboxOverride("panel", BuildStripStylebox());

        Rebuild(force: true);
    }

    public override void _Process(double delta)
    {
        if (_strip is null || _scroller is null || _label is null) return;

        // Cache strip width — recomputed each frame; cheap and resize-safe.
        _stripWidth = _strip.Size.X;

        var world = GameState.World;
        var log = world is null ? null : GetNewsLog(world);

        // Did the upstream count change? Rebuild text. (Cheap: just a property read.)
        var currentCount = log?.Count ?? -1;
        if (currentCount != _lastNewsLogCount)
        {
            _lastNewsLogCount = currentCount;
            Rebuild(force: false);
        }

        if (!_hasNewsLog) return;  // placeholder mode: do not scroll

        // Advance position; loop when the label has fully exited to the left.
        var labelWidth = _label.Size.X;
        var pos = _scroller.Position;
        pos.X -= ScrollPixelsPerSecond * (float)delta;

        // Wrap: reset to right-edge once the label has fully scrolled past the
        // left edge. We reset to +stripWidth (not 0) so there's a clean gap.
        if (pos.X + labelWidth < 0f)
        {
            pos.X = _stripWidth;
        }

        _scroller.Position = pos;
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.Escape }) OnBack();
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>
    /// Rebuild the headline text from the current NewsLog. If
    /// <paramref name="force"/> is true, also resets the scroller position
    /// to the right edge (used on first ready / mode swap).
    /// </summary>
    private void Rebuild(bool force)
    {
        if (_label is null || _scroller is null) return;

        var world = GameState.World;
        var log = world is null ? null : GetNewsLog(world);

        if (log is null || log.Count == 0)
        {
            _hasNewsLog = false;
            _label.Text = "[i]No news yet[/i]";
            _scroller.Position = new Vector2(8f, 0f);  // pinned, no scroll
            return;
        }

        var wasPlaceholder = !_hasNewsLog;
        _hasNewsLog = true;
        _label.Text = RenderHeadlines(log);

        if (force || wasPlaceholder)
        {
            // Start the scroll just past the right edge for a clean entry.
            _scroller.Position = new Vector2(_stripWidth > 0 ? _stripWidth : 800f, 0f);
        }
    }

    /// <summary>
    /// Reflection probe for <c>World.NewsLog</c> (added by Phase 3.65). Returns
    /// null when the property is missing or not enumerable. Returned items are
    /// the raw <c>NewsEntry</c> records — caller uses
    /// <see cref="ExtractHeadline"/> / <see cref="ExtractSeverity"/> to read
    /// fields by name.
    /// </summary>
    internal static IList? GetNewsLog(World world)
    {
        var prop = world.GetType().GetProperty("NewsLog", BindingFlags.Public | BindingFlags.Instance);
        if (prop is null) return null;
        return prop.GetValue(world) as IList;
    }

    private static string ExtractHeadline(object newsEntry)
    {
        var headline = newsEntry.GetType().GetProperty("Headline")?.GetValue(newsEntry) as string;
        return headline ?? "(unknown)";
    }

    /// <summary>
    /// Extract the severity field. Returns the enum's <c>ToString()</c> — we
    /// don't compile-couple to <c>EventSeverity</c>, so we match by name.
    /// </summary>
    private static string ExtractSeverity(object newsEntry)
    {
        var sev = newsEntry.GetType().GetProperty("Severity")?.GetValue(newsEntry);
        return sev?.ToString() ?? "Notable";
    }

    /// <summary>
    /// Compose the headlines into one BBCode string. Public-static so it's
    /// trivially testable from any future smoke test that wants to verify the
    /// rendering without instantiating Godot nodes.
    /// </summary>
    internal static string RenderHeadlines(IList newsLog)
    {
        var sb = new StringBuilder();
        var first = true;
        foreach (var entry in newsLog)
        {
            if (entry is null) continue;
            if (!first) sb.Append(Separator);
            first = false;

            var headline = EscapeBbcode(ExtractHeadline(entry));
            var severity = ExtractSeverity(entry);
            switch (severity)
            {
                case "Info":
                    sb.Append("[color=").Append(ColorInfo).Append(']').Append(headline).Append("[/color]");
                    break;
                case "Major":
                    sb.Append("[color=").Append(ColorMajor).Append("][b]").Append(headline).Append("[/b][/color]");
                    break;
                default:  // "Notable" or unknown — render in default white.
                    sb.Append(headline);
                    break;
            }
        }
        return sb.ToString();
    }

    /// <summary>Defend the RichTextLabel against incidental '[' in headlines.</summary>
    private static string EscapeBbcode(string s) => s.Replace("[", "[lb]");

    private static StyleBoxFlat BuildStripStylebox()
    {
        var sb = new StyleBoxFlat
        {
            BgColor = new Color(0.06f, 0.07f, 0.10f, 0.95f),
            BorderColor = new Color(0.94f, 0.78f, 0.31f),
            BorderWidthBottom = 2,
        };
        sb.SetContentMarginAll(4f);
        return sb;
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
}
