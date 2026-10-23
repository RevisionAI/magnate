using System;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Custom <see cref="Control"/> that hosts the slot/input/output card panels and
/// draws cubic-bezier arrows underneath them via <c>_Draw</c>. Mirrors the
/// Phase 3.36 ResearchTree.ResearchCanvas pattern: card widgets are programmatic
/// children, and edges are rendered in <c>_Draw</c> so they live behind the
/// children but on the same Control. The owning <see cref="SlotEditor"/> sets
/// <see cref="Editor"/> and calls <see cref="QueueRedraw"/> after layout.
/// </summary>
public partial class SlotCanvas : Control
{
    private static readonly Color EdgeColor     = new(0.55f, 0.55f, 0.60f, 0.85f);
    private static readonly Color EdgeHighlight = new(0xF0 / 255f, 0xC0 / 255f, 0x50 / 255f);

    public SlotEditor? Editor { get; set; }

    public override void _Draw()
    {
        if (Editor is null) return;
        var edges = Editor.Edges;
        if (edges.Count == 0) return;

        var (selCol, selSlotIndex) = Editor.SelectedKey;

        foreach (var edge in edges)
        {
            // An edge is highlighted whenever the currently-selected card sits
            // at one of its endpoints. The slot column (col 1) participates in
            // both halves: input→slot edges (left half) and slot→output edges
            // (right half). The selected card's slot index threads through both
            // halves so feeder + buyer arrows light up together.
            var highlighted = selCol switch
            {
                0 => edge.Half == 0 && edge.LeftIndex == selSlotIndex,  // input row selected
                1 => edge.SlotIndex == selSlotIndex,                    // middle slot selected
                2 => edge.Half == 1 && edge.RightIndex == selSlotIndex, // output row selected
                _ => false,
            };

            var color = highlighted ? EdgeHighlight : EdgeColor;
            var width = MathF.Max(1.5f, edge.Thickness) + (highlighted ? 1.0f : 0f);
            DrawEdge(edge.From, edge.To, color, width);
        }
    }

    private void DrawEdge(Vector2 from, Vector2 to, Color color, float width)
    {
        // Cubic bezier with horizontal tangents — same approach as ResearchTree.
        var dx = MathF.Max(40f, MathF.Abs(to.X - from.X) * 0.5f);
        var c1 = new Vector2(from.X + dx, from.Y);
        var c2 = new Vector2(to.X - dx,   to.Y);

        const int steps = 20;
        var prev = from;
        for (var i = 1; i <= steps; i++)
        {
            var t = i / (float)steps;
            var pt = CubicBezier(from, c1, c2, to, t);
            DrawLine(prev, pt, color, width, antialiased: true);
            prev = pt;
        }

        // Arrowhead at the target.
        var tangent = (to - c2).Normalized();
        if (tangent.LengthSquared() < 1e-6) tangent = new Vector2(1, 0);
        var normal = new Vector2(-tangent.Y, tangent.X);
        const float headLen = 9f;
        const float headWid = 5f;
        var baseMid = to - tangent * headLen;
        var left  = baseMid + normal * headWid;
        var right = baseMid - normal * headWid;
        DrawLine(to, left,  color, width, antialiased: true);
        DrawLine(to, right, color, width, antialiased: true);
    }

    private static Vector2 CubicBezier(Vector2 p0, Vector2 p1, Vector2 p2, Vector2 p3, float t)
    {
        var u = 1f - t;
        return u * u * u * p0
             + 3f * u * u * t * p1
             + 3f * u * t * t * p2
             + t * t * t * p3;
    }
}
