using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Godot;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Research Tree node-graph visualizer (Phase 3.36).
///
/// Each product in the catalog is drawn as a panel-node, laid out in three
/// columns by <see cref="ProductTier"/> (Raw on the left, Intermediate in the
/// middle, Finished on the right). Recipe inputs become directed edges drawn
/// by overriding <c>_Draw</c> on the <see cref="ResearchCanvas"/> control —
/// straight lines with a small arrowhead ending a few pixels short of the
/// target node's left edge. Tech level and R&amp;D progress render inside each
/// node (label + progress bar).
///
/// Keyboard: ← / → switch columns (tier), ↑ / ↓ move within a column, Enter
/// toggles a sidebar detail panel, Escape returns to Main. Live: re-renders
/// on every sim tick via <see cref="GameState.TickIfRunning"/>.
/// </summary>
public partial class ResearchTree : Node
{
    private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-US");

    private static readonly ProductTier[] TierOrder =
    {
        ProductTier.Raw,
        ProductTier.Intermediate,
        ProductTier.Finished,
    };

    // Layout constants — tuned so the default ~15-product content fits in the
    // built-in 1152x648 window without horizontal scrolling, but the Canvas is
    // allowed to grow if there are more products.
    private const float NodeWidth = 240f;
    private const float NodeHeight = 92f;
    private const float ColumnGap = 80f;      // gap between tier columns
    private const float RowGap = 14f;         // gap between nodes in the same column
    private const float MarginX = 24f;
    private const float MarginY = 24f;

    // Color palette (matches Phase 3.20 polish pass).
    private static readonly Color RawColor          = new Color(0x5A / 255f, 0xA5 / 255f, 0x5A / 255f);
    private static readonly Color IntermediateColor = new Color(0xC7 / 255f, 0x9A / 255f, 0x3F / 255f);
    private static readonly Color FinishedColor     = new Color(0x4C / 255f, 0x80 / 255f, 0xC6 / 255f);
    private static readonly Color SelectedColor     = new Color(0xF5 / 255f, 0xF5 / 255f, 0xF5 / 255f);
    private static readonly Color EdgeColor         = new Color(0.55f, 0.55f, 0.60f, 0.85f);
    private static readonly Color EdgeHighlight     = new Color(1.00f, 0.85f, 0.30f, 1.00f);
    private static readonly Color ResearchingColor  = new Color(1.00f, 0.62f, 0.10f);

    // Flat ordering of products used for selection indexing and drawing. Built
    // once per refresh; keeps selection index stable across ticks as long as
    // catalog content doesn't change mid-game (it can't).
    private readonly List<Product> _order = new();

    // Per-product node info (layout + widget handles) by ProductId.
    private readonly Dictionary<ProductId, NodeInfo> _nodes = new();

    private int _selectedIndex;
    private bool _sidebarVisible;

    private ResearchCanvas? _canvas;
    private Label? _subLabel;
    private PanelContainer? _sidebar;
    private Label? _sidebarTitle;
    private RichTextLabel? _sidebarBody;

    public override void _Ready()
    {
        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;

        ApplyChrome();

        // Promote the bare Control in the tscn to our drawing subclass so we can
        // override _Draw for edge rendering. We keep the node name "Canvas" so
        // the scene path is stable for anyone reading it.
        var rawCanvas = GetNode<Control>("Panel/VBox/Body/Scroll/Canvas");
        _canvas = new ResearchCanvas
        {
            Name = "Canvas",
            CustomMinimumSize = rawCanvas.CustomMinimumSize,
            SizeFlagsHorizontal = rawCanvas.SizeFlagsHorizontal,
            SizeFlagsVertical = rawCanvas.SizeFlagsVertical,
        };
        _canvas.Tree = this;
        var parent = rawCanvas.GetParent();
        var idx = rawCanvas.GetIndex();
        parent.RemoveChild(rawCanvas);
        rawCanvas.QueueFree();
        parent.AddChild(_canvas);
        parent.MoveChild(_canvas, idx);

        _subLabel = GetNode<Label>("Panel/VBox/SubLabel");
        _sidebar = GetNode<PanelContainer>("Panel/VBox/Body/Sidebar");
        _sidebarTitle = GetNode<Label>("Panel/VBox/Body/Sidebar/SidebarMargin/SidebarVBox/SidebarTitle");
        _sidebarBody = GetNode<RichTextLabel>("Panel/VBox/Body/Sidebar/SidebarMargin/SidebarVBox/SidebarBody");
        _sidebar.Visible = _sidebarVisible;

        Refresh();
    }

    public override void _Process(double delta)
    {
        if (GameState.TickIfRunning((float)delta))
        {
            Refresh();
        }
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is not InputEventKey key || !key.Pressed || key.Echo) return;
        if (_order.Count == 0) return;

        switch (key.Keycode)
        {
            case Key.Escape:
                OnBack();
                GetViewport().SetInputAsHandled();
                break;
            case Key.Enter:
            case Key.KpEnter:
                ToggleSidebar();
                GetViewport().SetInputAsHandled();
                break;
            case Key.Up:
                MoveSelectionWithinColumn(-1);
                GetViewport().SetInputAsHandled();
                break;
            case Key.Down:
                MoveSelectionWithinColumn(+1);
                GetViewport().SetInputAsHandled();
                break;
            case Key.Left:
                MoveSelectionAcrossColumns(-1);
                GetViewport().SetInputAsHandled();
                break;
            case Key.Right:
                MoveSelectionAcrossColumns(+1);
                GetViewport().SetInputAsHandled();
                break;
        }
    }

    // ------------------------------------------------------------------ chrome

    private void ApplyChrome()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.80f),
            new Color(0.02f, 0.04f, 0.055f, 0.82f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.20f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        header.AddThemeFontSizeOverride("font_size", 30);

        GetNode<Label>("Panel/VBox/SubLabel").AddThemeColorOverride("font_color", UiChrome.Muted);
        GetNode<Label>("Panel/VBox/HintLabel").AddThemeColorOverride("font_color", UiChrome.Muted);

        var sidebar = GetNode<PanelContainer>("Panel/VBox/Body/Sidebar");
        sidebar.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.92f),
            new Color(0.70f, 0.58f, 0.29f, 0.55f),
            radius: 6));

        var vbox = GetNode<VBoxContainer>("Panel/VBox");
        var banner = BuildAccentBanner(
            GamePresentation.ResearchArt,
            "Compound product technology across the value chain — inputs feed finished goods.",
            UiChrome.Gold);
        vbox.AddChild(banner);
        vbox.MoveChild(banner, 2); // below HeaderLabel + SubLabel, above Body
    }

    private static Control BuildAccentBanner(string artPath, string caption, Color accent)
    {
        var plate = new PanelContainer { CustomMinimumSize = new Vector2(0, 58) };
        plate.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.085f, 0.80f),
            new Color(accent.R, accent.G, accent.B, 0.5f),
            radius: 6, marginX: 14, marginY: 8));

        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 14);
        plate.AddChild(row);

        var tex = UiChrome.LoadTexture(artPath);
        if (tex is not null)
        {
            row.AddChild(new TextureRect
            {
                Texture = tex,
                CustomMinimumSize = new Vector2(72, 42),
                ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
                StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
                MouseFilter = Control.MouseFilterEnum.Ignore,
            });
        }

        var label = new Label
        {
            Text = caption,
            VerticalAlignment = VerticalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        label.AddThemeFontSizeOverride("font_size", 15);
        label.AddThemeColorOverride("font_color", new Color(0.92f, 0.95f, 0.98f));
        row.AddChild(label);

        return plate;
    }

    // ------------------------------------------------------------------ render

    private void Refresh()
    {
        if (_canvas is null || _subLabel is null) return;

        // Clear previous node widgets.
        foreach (var child in _canvas.GetChildren()) child.QueueFree();
        _nodes.Clear();
        _order.Clear();

        var world = GameState.World;
        if (world is null)
        {
            _subLabel.Text = "No active game.";
            var empty = new Label
            {
                Text = "No active game — start a scenario from the title screen to see the research tree.",
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            empty.AddThemeColorOverride("font_color", UiChrome.Blue);
            empty.Position = new Vector2(MarginX, MarginY);
            _canvas.AddChild(empty);
            _canvas.CustomMinimumSize = new Vector2(600, 200);
            _canvas.QueueRedraw();
            HideSidebar();
            return;
        }

        _subLabel.Text =
            $"Scenario: {GameState.ScenarioName}  ·  Date: {world.Clock.Now}  ·  " +
            $"Company: {PlayerName(world)}";

        // R&D slots currently researching which products, for the tag.
        var activeResearch = new HashSet<ProductId>(
            world.Buildings.Values
                .Where(b => b.Owner == GameState.PlayerId)
                .SelectMany(b => b.ResearchSlots.Select(s => s.Product)));

        // Deterministic ordering: tier first (column), then ProductId ordinal
        // (row). Matches the style guide's ordering rule.
        var grouped = world.Catalog.Products.Values
            .OrderBy(p => (int)p.Tier)
            .ThenBy(p => p.Id.Value, StringComparer.Ordinal)
            .GroupBy(p => p.Tier)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Compute layout: each tier is its own vertical column of nodes.
        var maxColumnHeight = 0f;
        for (var col = 0; col < TierOrder.Length; col++)
        {
            var tier = TierOrder[col];
            if (!grouped.TryGetValue(tier, out var list)) continue;

            var colX = MarginX + col * (NodeWidth + ColumnGap);
            for (var row = 0; row < list.Count; row++)
            {
                var product = list[row];
                var y = MarginY + row * (NodeHeight + RowGap);
                var pos = new Vector2(colX, y);
                var node = BuildNode(world, product, activeResearch.Contains(product.Id));
                node.Position = pos;
                node.Size = new Vector2(NodeWidth, NodeHeight);
                _canvas.AddChild(node);

                _order.Add(product);
                _nodes[product.Id] = new NodeInfo(product, pos, new Vector2(NodeWidth, NodeHeight), node, col, row);
            }

            var colHeight = (list?.Count ?? 0) * (NodeHeight + RowGap);
            if (colHeight > maxColumnHeight) maxColumnHeight = colHeight;
        }

        // Size the canvas so the ScrollContainer activates if needed.
        var totalWidth = MarginX * 2 + TierOrder.Length * NodeWidth + (TierOrder.Length - 1) * ColumnGap;
        var totalHeight = MarginY * 2 + maxColumnHeight;
        _canvas.CustomMinimumSize = new Vector2(totalWidth, totalHeight);

        // Clamp selection in case the product count shrank (it can't in practice,
        // but keep the invariant defensive).
        if (_selectedIndex >= _order.Count) _selectedIndex = _order.Count - 1;
        if (_selectedIndex < 0) _selectedIndex = 0;

        RestyleSelection();
        RefreshSidebar();
        _canvas.QueueRedraw();
    }

    // ------------------------------------------------------------------ nodes

    private static PanelContainer BuildNode(World world, Product product, bool researching)
    {
        var panel = new PanelContainer();
        panel.AddThemeStyleboxOverride("panel", MakeNodeStyle(product.Tier, selected: false));

        var margin = new MarginContainer();
        margin.AddThemeConstantOverride("margin_left", 10);
        margin.AddThemeConstantOverride("margin_right", 10);
        margin.AddThemeConstantOverride("margin_top", 8);
        margin.AddThemeConstantOverride("margin_bottom", 8);
        panel.AddChild(margin);

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);
        margin.AddChild(vbox);

        // Title row: name (left) + tier badge (right).
        var titleRow = new HBoxContainer();
        titleRow.AddThemeConstantOverride("separation", 6);
        titleRow.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        vbox.AddChild(titleRow);

        var name = new Label { Text = product.Name };
        name.AddThemeFontSizeOverride("font_size", 14);
        name.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        name.ClipText = true;
        titleRow.AddChild(name);

        titleRow.AddChild(MakeBadge(TierAbbrev(product.Tier), TierColor(product.Tier)));

        // Tech + progress row.
        var tech = world.GetTech(GameState.PlayerId, product.Id);
        var max = product.MaxTechLevel;
        var techLabel = new Label
        {
            Text = researching
                ? $"Tech {tech}/{max}  ·  R&D active"
                : $"Tech {tech}/{max}",
        };
        techLabel.AddThemeFontSizeOverride("font_size", 12);
        if (researching) techLabel.AddThemeColorOverride("font_color", ResearchingColor);
        vbox.AddChild(techLabel);

        var progressToNext = tech < max ? world.GetResearchProgress(GameState.PlayerId, product.Id) : 0.0;
        var thresholdToNext = tech < max ? SimulationConstants.BaseResearchThreshold * tech : 1.0;
        var bar = new ProgressBar
        {
            MinValue = 0,
            MaxValue = thresholdToNext,
            Step = 1,
            Value = Math.Min(progressToNext, thresholdToNext),
            ShowPercentage = false,
            CustomMinimumSize = new Vector2(0, 10),
        };
        bar.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        if (tech >= max)
        {
            bar.MaxValue = 1;
            bar.Value = 1;
        }
        vbox.AddChild(bar);

        return panel;
    }

    private static StyleBoxFlat MakeNodeStyle(ProductTier tier, bool selected)
    {
        var border = selected ? SelectedColor : TierColor(tier);
        var bw = selected ? 3 : 2;
        var bg = TierColor(tier);
        bg.A = 0.18f;
        return new StyleBoxFlat
        {
            BgColor = bg,
            BorderColor = border,
            BorderWidthLeft = bw,
            BorderWidthRight = bw,
            BorderWidthTop = bw,
            BorderWidthBottom = bw,
            CornerRadiusTopLeft = 6,
            CornerRadiusTopRight = 6,
            CornerRadiusBottomLeft = 6,
            CornerRadiusBottomRight = 6,
            ContentMarginLeft = 2,
            ContentMarginRight = 2,
            ContentMarginTop = 2,
            ContentMarginBottom = 2,
        };
    }

    private static PanelContainer MakeBadge(string text, Color background)
    {
        var panel = new PanelContainer();
        var style = new StyleBoxFlat
        {
            BgColor = background,
            ContentMarginLeft = 6,
            ContentMarginRight = 6,
            ContentMarginTop = 1,
            ContentMarginBottom = 1,
            CornerRadiusTopLeft = 4,
            CornerRadiusTopRight = 4,
            CornerRadiusBottomLeft = 4,
            CornerRadiusBottomRight = 4,
        };
        panel.AddThemeStyleboxOverride("panel", style);

        var label = new Label { Text = text };
        label.AddThemeFontSizeOverride("font_size", 11);
        label.AddThemeColorOverride("font_color", new Color(1f, 1f, 1f));
        panel.AddChild(label);
        return panel;
    }

    private void RestyleSelection()
    {
        for (var i = 0; i < _order.Count; i++)
        {
            var product = _order[i];
            if (!_nodes.TryGetValue(product.Id, out var info)) continue;
            info.Panel.AddThemeStyleboxOverride("panel", MakeNodeStyle(product.Tier, selected: i == _selectedIndex));
        }
    }

    // ------------------------------------------------------------------ selection

    private void MoveSelectionWithinColumn(int direction)
    {
        if (_order.Count == 0) return;
        var cur = _order[_selectedIndex];
        if (!_nodes.TryGetValue(cur.Id, out var info)) return;

        // Walk candidates in the same column, pick the closest row.
        var sameCol = _order
            .Select((p, i) => (Product: p, Index: i, Info: _nodes[p.Id]))
            .Where(t => t.Info.Column == info.Column)
            .OrderBy(t => t.Info.Row)
            .ToList();

        var here = sameCol.FindIndex(t => t.Index == _selectedIndex);
        if (here < 0) return;
        var next = here + direction;
        if (next < 0 || next >= sameCol.Count) return;
        _selectedIndex = sameCol[next].Index;
        OnSelectionChanged();
    }

    private void MoveSelectionAcrossColumns(int direction)
    {
        if (_order.Count == 0) return;
        var cur = _order[_selectedIndex];
        if (!_nodes.TryGetValue(cur.Id, out var info)) return;
        var targetColumn = info.Column + direction;
        if (targetColumn < 0 || targetColumn >= TierOrder.Length) return;

        // Find the column and pick the node nearest in Y to the current one.
        var currentY = info.Position.Y;
        var inTarget = _order
            .Select((p, i) => (Product: p, Index: i, Info: _nodes[p.Id]))
            .Where(t => t.Info.Column == targetColumn)
            .ToList();
        if (inTarget.Count == 0) return;

        var best = inTarget.OrderBy(t => Math.Abs(t.Info.Position.Y - currentY)).First();
        _selectedIndex = best.Index;
        OnSelectionChanged();
    }

    private void OnSelectionChanged()
    {
        RestyleSelection();
        RefreshSidebar();
        _canvas?.QueueRedraw();
        ScrollSelectionIntoView();
    }

    private void ScrollSelectionIntoView()
    {
        if (_order.Count == 0) return;
        var scroll = GetNodeOrNull<ScrollContainer>("Panel/VBox/Body/Scroll");
        if (scroll is null) return;
        var product = _order[_selectedIndex];
        if (!_nodes.TryGetValue(product.Id, out var info)) return;

        var visible = scroll.Size;
        var nodeTop = info.Position.Y;
        var nodeBottom = info.Position.Y + info.Size.Y;
        var nodeLeft = info.Position.X;
        var nodeRight = info.Position.X + info.Size.X;

        var vs = scroll.ScrollVertical;
        if (nodeTop < vs) scroll.ScrollVertical = (int)MathF.Max(0, nodeTop - 8);
        else if (nodeBottom > vs + visible.Y) scroll.ScrollVertical = (int)(nodeBottom - visible.Y + 8);

        var hs = scroll.ScrollHorizontal;
        if (nodeLeft < hs) scroll.ScrollHorizontal = (int)MathF.Max(0, nodeLeft - 8);
        else if (nodeRight > hs + visible.X) scroll.ScrollHorizontal = (int)(nodeRight - visible.X + 8);
    }

    // ------------------------------------------------------------------ sidebar

    private void ToggleSidebar()
    {
        _sidebarVisible = !_sidebarVisible;
        if (_sidebar is not null) _sidebar.Visible = _sidebarVisible;
        if (_sidebarVisible) RefreshSidebar();
    }

    private void HideSidebar()
    {
        _sidebarVisible = false;
        if (_sidebar is not null) _sidebar.Visible = false;
    }

    private void RefreshSidebar()
    {
        if (!_sidebarVisible || _sidebar is null || _sidebarTitle is null || _sidebarBody is null) return;
        if (_order.Count == 0) { _sidebar.Visible = false; return; }

        var world = GameState.World;
        if (world is null) { _sidebar.Visible = false; return; }

        var product = _order[_selectedIndex];
        var tech = world.GetTech(GameState.PlayerId, product.Id);
        var max = product.MaxTechLevel;
        var progress = world.GetResearchProgress(GameState.PlayerId, product.Id);
        var threshold = SimulationConstants.BaseResearchThreshold * tech;

        _sidebarTitle.Text = product.Name;

        var sb = new StringBuilder();
        sb.Append("[b]Tier:[/b] ").Append(product.Tier).Append('\n');
        sb.Append("[b]Category:[/b] ").Append(product.Category).Append('\n');
        sb.Append("[b]Unit:[/b] ").Append(product.Unit).Append('\n');
        sb.Append("[b]World price:[/b] $")
            .Append(product.BaseWorldMarketPrice.ToString("N2", Culture))
            .Append('\n');
        sb.Append("[b]Tech level:[/b] ").Append(tech).Append(" / ").Append(max).Append('\n');
        if (tech < max)
        {
            var slotMonths = threshold / SimulationConstants.ResearchPointsPerSlotPerMonth;
            sb.Append("[b]R&D progress:[/b] ")
                .Append(progress.ToString("N0", Culture))
                .Append(" / ")
                .Append(threshold.ToString("N0", Culture))
                .Append(" pts  (~")
                .Append(slotMonths.ToString("N1", Culture))
                .Append(" slot-months to next level)\n");
        }
        else
        {
            sb.Append("[b]R&D progress:[/b] max level reached\n");
        }

        sb.Append('\n');
        if (product.Recipe is null)
        {
            sb.Append("[b]Recipe:[/b] none (raw material).\n");
            if (product.Extraction is not null)
            {
                sb.Append("Extracted at ")
                    .Append(product.Extraction.SourceCategory)
                    .Append(" · yield ")
                    .Append(product.Extraction.YieldPerSlotPerMonth.ToString("N1", Culture))
                    .Append(' ')
                    .Append(product.Unit)
                    .Append(" per slot-month.\n");
            }
        }
        else
        {
            sb.Append("[b]Recipe:[/b] produces ")
                .Append(product.Recipe.OutputQuantity.ToString("N1", Culture))
                .Append(' ').Append(product.Unit)
                .Append(" / cycle (labor ")
                .Append(product.Recipe.LaborUnits.ToString("N1", Culture))
                .Append(")\n");
            if (product.Recipe.Inputs.Count == 0)
            {
                sb.Append("Inputs: (none — synthesized)\n");
            }
            else
            {
                sb.Append("[b]Inputs:[/b]\n");
                foreach (var input in product.Recipe.Inputs)
                {
                    var inputProduct = world.Catalog.Products.TryGetValue(input.ProductId, out var p) ? p.Name : input.ProductId.Value;
                    sb.Append("  • ")
                        .Append(input.Quantity.ToString("N1", Culture))
                        .Append(" × ").Append(inputProduct).Append('\n');
                }
            }
        }

        // Downstream: products whose recipe references this one as an input.
        var downstream = world.Catalog.Products.Values
            .Where(p => p.Recipe is not null && p.Recipe.Inputs.Any(i => i.ProductId == product.Id))
            .OrderBy(p => p.Name, StringComparer.Ordinal)
            .ToList();
        if (downstream.Count > 0)
        {
            sb.Append("\n[b]Feeds into:[/b]\n");
            foreach (var d in downstream)
            {
                sb.Append("  → ").Append(d.Name).Append('\n');
            }
        }

        _sidebarBody.Text = sb.ToString();
    }

    // ------------------------------------------------------------------ helpers

    private static Color TierColor(ProductTier tier) => tier switch
    {
        ProductTier.Raw => RawColor,
        ProductTier.Intermediate => IntermediateColor,
        ProductTier.Finished => FinishedColor,
        _ => new Color(0.5f, 0.5f, 0.5f),
    };

    private static string TierAbbrev(ProductTier tier) => tier switch
    {
        ProductTier.Raw => "RAW",
        ProductTier.Intermediate => "INT",
        ProductTier.Finished => "FIN",
        _ => tier.ToString().ToUpperInvariant(),
    };

    private static string PlayerName(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Name : "(unknown)";

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");

    // ------------------------------------------------------------------ types

    private sealed record NodeInfo(
        Product Product,
        Vector2 Position,
        Vector2 Size,
        PanelContainer Panel,
        int Column,
        int Row);

    /// <summary>
    /// Custom <see cref="Control"/> that hosts the per-product node panels and
    /// draws recipe edges underneath them via <c>_Draw</c>. Kept as a nested
    /// type so the scene only references the outer <see cref="ResearchTree"/>
    /// script — the Canvas node is rebuilt programmatically in _Ready.
    /// </summary>
    public partial class ResearchCanvas : Control
    {
        public ResearchTree? Tree { get; set; }

        public override void _Draw()
        {
            if (Tree is null) return;
            var selectedProduct = Tree._order.Count > 0 ? Tree._order[Tree._selectedIndex] : null;

            foreach (var target in Tree._order)
            {
                if (target.Recipe is null) continue;
                if (!Tree._nodes.TryGetValue(target.Id, out var targetInfo)) continue;

                foreach (var input in target.Recipe.Inputs)
                {
                    if (!Tree._nodes.TryGetValue(input.ProductId, out var sourceInfo)) continue;

                    var from = new Vector2(
                        sourceInfo.Position.X + sourceInfo.Size.X,
                        sourceInfo.Position.Y + sourceInfo.Size.Y * 0.5f);
                    var to = new Vector2(
                        targetInfo.Position.X - 2f,
                        targetInfo.Position.Y + targetInfo.Size.Y * 0.5f);

                    var highlighted = selectedProduct is not null
                        && (selectedProduct.Id == target.Id || selectedProduct.Id == input.ProductId);
                    var color = highlighted ? EdgeHighlight : EdgeColor;
                    var width = highlighted ? 2.5f : 1.5f;

                    DrawEdge(from, to, color, width);
                }
            }
        }

        private void DrawEdge(Vector2 from, Vector2 to, Color color, float width)
        {
            // Cubic-ish curve: horizontal tangents so edges fan in/out cleanly
            // even when source and target are vertically far apart.
            var dx = MathF.Max(40f, MathF.Abs(to.X - from.X) * 0.5f);
            var c1 = new Vector2(from.X + dx, from.Y);
            var c2 = new Vector2(to.X - dx,   to.Y);

            const int steps = 18;
            var prev = from;
            for (var i = 1; i <= steps; i++)
            {
                var t = i / (float)steps;
                var pt = CubicBezier(from, c1, c2, to, t);
                DrawLine(prev, pt, color, width, antialiased: true);
                prev = pt;
            }

            // Arrowhead at the target end.
            var tangent = (to - c2).Normalized();
            if (tangent.LengthSquared() < 1e-6) tangent = new Vector2(1, 0);
            var normal = new Vector2(-tangent.Y, tangent.X);
            const float headLen = 8f;
            const float headWid = 4f;
            var baseMid = to - tangent * headLen;
            var left = baseMid + normal * headWid;
            var right = baseMid - normal * headWid;
            DrawLine(to, left, color, width, antialiased: true);
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
}
