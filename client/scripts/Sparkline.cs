using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Minimal sparkline: takes a list of doubles, normalizes them to the widget's
/// rect, and draws a polyline. Uses Godot's custom <c>_Draw</c> API, so it's a
/// lightweight UI control (no full charting library needed).
/// </summary>
public partial class Sparkline : Control
{
    private List<double> _values = new();

    [Export]
    public Color LineColor { get; set; } = new Color(0.45f, 0.85f, 1.0f);

    [Export]
    public Color BackgroundColor { get; set; } = new Color(0.08f, 0.09f, 0.13f);

    [Export]
    public float LineWidth { get; set; } = 2.0f;

    public void SetValues(IReadOnlyList<double> values)
    {
        _values = values.ToList();
        QueueRedraw();
    }

    public override void _Draw()
    {
        var size = GetRect().Size;
        DrawRect(new Rect2(Vector2.Zero, size), BackgroundColor, filled: true);

        if (_values.Count < 2) return;

        var min = _values.Min();
        var max = _values.Max();
        var range = max - min;
        if (range < 1e-9) range = 1.0;

        const float padding = 4f;
        var innerW = size.X - 2f * padding;
        var innerH = size.Y - 2f * padding;
        if (innerW <= 0 || innerH <= 0) return;

        var points = new Vector2[_values.Count];
        for (var i = 0; i < _values.Count; i++)
        {
            var x = padding + innerW * (i / (float)(_values.Count - 1));
            var yNorm = (float)((_values[i] - min) / range);
            var y = padding + innerH - yNorm * innerH;
            points[i] = new Vector2(x, y);
        }

        DrawPolyline(points, LineColor, LineWidth, antialiased: true);
    }
}
