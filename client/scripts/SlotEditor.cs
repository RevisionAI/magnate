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
/// Phase 3.64 — visual slot-and-arrow editor for a single building.
///
/// Three vertical columns: INPUTS (left), MANUFACTURING / production slots
/// (middle), DISTRIBUTION (right). Cubic-bezier arrows feed left → middle and
/// middle → right, drawn by <see cref="SlotCanvas"/>'s _Draw override. The
/// player navigates with arrow keys; Enter on a slot card returns to the
/// BuildingInspector with that slot's product pre-selected via
/// <see cref="GameState.SelectedBuilding"/> (already set on entry).
///
/// Read-only v1: this scene shows the procurement / distribution graph and
/// lets the player drill into a slot, but does not let them add or rewire
/// slots — that remains in BuildingInspector for now.
/// </summary>
public partial class SlotEditor : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");
    private static readonly CultureInfo Inv   = CultureInfo.InvariantCulture;

    // Layout constants — three fixed columns at these x-positions.
    private const float InputColX  = 80f;
    private const float SlotColX   = 480f;
    private const float OutputColX = 880f;
    private const float CardWidth  = 280f;
    private const float CardHeight = 100f;
    private const float CardVGap   = 16f;
    private const float MarginTop  = 32f;

    // Color palette per the phase brief.
    private static readonly Color CanvasBg       = new(0x0E / 255f, 0x10 / 255f, 0x18 / 255f);
    private static readonly Color CardFill       = new(0x1A / 255f, 0x1D / 255f, 0x26 / 255f);
    private static readonly Color RawColor       = new(0x5A / 255f, 0xA5 / 255f, 0x5A / 255f);
    private static readonly Color IntermColor    = new(0xC7 / 255f, 0x9A / 255f, 0x3F / 255f);
    private static readonly Color FinishedColor  = new(0x4C / 255f, 0x80 / 255f, 0xC6 / 255f);
    private static readonly Color SelectedColor  = new(0xF0 / 255f, 0xC0 / 255f, 0x50 / 255f);
    private static readonly Color DimText        = new(0.55f, 0.55f, 0.55f);
    private static readonly Color WarnAmber      = new(0xC7 / 255f, 0x9A / 255f, 0x3F / 255f);

    /// <summary>
    /// Stable card key spanning all three columns. Slot column (1) cards are
    /// keyed by the engine slot index. Input + output cards are keyed by their
    /// row position in their column (0..N-1) since they don't have slot
    /// indices of their own.
    /// </summary>
    private readonly record struct CardKey(int Column, int Index, ProductId Product);

    /// <summary>One arrow rendered by <see cref="SlotCanvas"/>.</summary>
    /// <param name="Half">0 = input→slot (left half), 1 = slot→output (right half).</param>
    /// <param name="LeftIndex">Row index of the left endpoint card within its column.</param>
    /// <param name="SlotIndex">Engine slot-index of the middle card this arrow touches.</param>
    /// <param name="RightIndex">Row index of the right endpoint card within its column (only meaningful when Half=1).</param>
    public sealed record EdgeInfo(
        Vector2 From,
        Vector2 To,
        float Thickness,
        int Half,
        int LeftIndex,
        int SlotIndex,
        int RightIndex);

    private SlotCanvas? _canvas;
    private Label? _titleLabel;
    private Label? _subLabel;
    private Label? _inspectorTitle;
    private RichTextLabel? _inspectorBody;

    private readonly List<CardEntry> _inputs  = new();
    private readonly List<CardEntry> _slots   = new();
    private readonly List<CardEntry> _outputs = new();

    private int _selectedColumn = 1;
    private int _selectedIndex; // index within the selected column's list

    /// <summary>(column, slot-index-or-row-index) of the selected card; consumed by <see cref="SlotCanvas._Draw"/>.</summary>
    public (int column, int slotIndex) SelectedKey { get; private set; }

    /// <summary>Edges to draw, populated each Refresh.</summary>
    public List<EdgeInfo> Edges { get; } = new();

    public override void _Ready()
    {
        GetNode<Button>("Panel/VBox/Header/BackButton").Pressed += OnBack;

        _titleLabel = GetNode<Label>("Panel/VBox/Header/TitleLabel");
        _subLabel   = GetNode<Label>("Panel/VBox/SubLabel");

        // Promote the bare Control from the .tscn into our drawing subclass.
        var rawCanvas = GetNode<Control>("Panel/VBox/Body/Scroll/Canvas");
        _canvas = new SlotCanvas
        {
            Name = "Canvas",
            CustomMinimumSize = rawCanvas.CustomMinimumSize,
            SizeFlagsHorizontal = rawCanvas.SizeFlagsHorizontal,
            SizeFlagsVertical = rawCanvas.SizeFlagsVertical,
            Editor = this,
        };
        var parent = rawCanvas.GetParent();
        var idx = rawCanvas.GetIndex();
        parent.RemoveChild(rawCanvas);
        rawCanvas.QueueFree();
        parent.AddChild(_canvas);
        parent.MoveChild(_canvas, idx);

        _inspectorTitle = GetNode<Label>("Panel/VBox/Body/Inspector/InspectorMargin/InspectorVBox/InspectorTitle");
        _inspectorBody  = GetNode<RichTextLabel>("Panel/VBox/Body/Inspector/InspectorMargin/InspectorVBox/InspectorBody");

        ApplyChrome();
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

        switch (key.Keycode)
        {
            case Key.Escape:
                OnBack();
                GetViewport().SetInputAsHandled();
                break;
            case Key.Enter:
            case Key.KpEnter:
                OnEnterPressed();
                GetViewport().SetInputAsHandled();
                break;
            case Key.Up:
                MoveWithinColumn(-1);
                GetViewport().SetInputAsHandled();
                break;
            case Key.Down:
                MoveWithinColumn(+1);
                GetViewport().SetInputAsHandled();
                break;
            case Key.Left:
                MoveAcrossColumns(-1);
                GetViewport().SetInputAsHandled();
                break;
            case Key.Right:
                MoveAcrossColumns(+1);
                GetViewport().SetInputAsHandled();
                break;
        }
    }

    // ============================================================== Chrome

    private void ApplyChrome()
    {
        var panel = GetNode<Panel>("Panel");
        // Heavy overlay: the transparent canvas draws its dark cards + arrows over
        // this, so keep the backdrop as a faint operational texture only.
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.75f),
            new Color(0.055f, 0.063f, 0.094f, 0.86f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.055f, 0.063f, 0.094f, 0.30f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        _titleLabel?.AddThemeColorOverride("font_color", UiChrome.Gold);
        _titleLabel?.AddThemeFontSizeOverride("font_size", 24);
        _subLabel?.AddThemeColorOverride("font_color", UiChrome.Muted);
        GetNode<Label>("Panel/VBox/HintLabel").AddThemeColorOverride("font_color", UiChrome.Muted);

        var inspector = GetNode<PanelContainer>("Panel/VBox/Body/Inspector");
        inspector.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.92f),
            new Color(0.70f, 0.58f, 0.29f, 0.55f),
            radius: 6));
    }

    // ============================================================== Refresh

    private void Refresh()
    {
        if (_canvas is null || _titleLabel is null || _subLabel is null) return;

        // Clear previous canvas children and per-column entries.
        foreach (var child in _canvas.GetChildren()) child.QueueFree();
        _inputs.Clear();
        _slots.Clear();
        _outputs.Clear();
        Edges.Clear();

        var world = GameState.World;
        var selected = GameState.SelectedBuilding;
        if (world is null || selected is null)
        {
            RenderEmptyState("No building selected. Open BuildingInspector first.");
            return;
        }

        if (!world.Buildings.TryGetValue(selected.Value, out var building))
        {
            RenderEmptyState("Selected building no longer exists.");
            return;
        }

        var type = world.Catalog.BuildingType(building.TypeId);
        var cityName = world.Catalog.Cities.TryGetValue(building.City, out var city) ? city.Name : building.City.Value;

        _titleLabel.Text = $"{type.Name} · {cityName}";
        var ownerName = world.Companies.TryGetValue(building.Owner, out var co) ? co.Name : building.Owner.ToString();
        var slotsUsed = TotalSlotsUsed(building);
        _subLabel.Text =
            $"OWNER: {ownerName.ToUpperInvariant()}  ·  LEVEL {building.Level}  ·  {slotsUsed}/{type.MaxUnits} SLOTS USED  ·  {world.Clock.Now}";

        // Empty-state if no slots are configured at all.
        if (slotsUsed == 0)
        {
            RenderInspectorMessage("No slots", "[i]This building has no configured slots yet.[/i]\n\nOpen BuildingInspector to add slots.");
            // Still render the column headers + a centred placeholder.
            DrawColumnHeaders();
            var placeholder = new Label
            {
                Text = "(no slots configured)",
                Position = new Vector2(SlotColX, MarginTop + 40),
                Modulate = DimText,
            };
            placeholder.CustomMinimumSize = new Vector2(CardWidth, 40);
            _canvas.AddChild(placeholder);
            _canvas.CustomMinimumSize = new Vector2(OutputColX + CardWidth + 32, 200);
            _canvas.QueueRedraw();
            return;
        }

        // ---------------- Build the middle column (slots) ----------------
        var middleSlots = CollectMiddleSlots(building, world);

        // ---------------- Collect inputs (procurement) ----------------
        // Distinct input products across every slot's recipe, ordered by id.
        var inputProductIds = middleSlots
            .SelectMany(ms => ms.Recipe?.Inputs.Select(i => i.ProductId) ?? Enumerable.Empty<ProductId>())
            .Distinct()
            .OrderBy(p => p.Value, StringComparer.Ordinal)
            .ToList();

        // ---------------- Collect outputs (distribution) ----------------
        // For now: each retail slot → one output card; if AutoExport and the
        // produced product is non-finished, add an export output card.
        var outputs = new List<OutputDescriptor>();
        foreach (var ms in middleSlots.OrderBy(m => m.SlotIndex))
        {
            switch (ms.Kind)
            {
                case SlotKind.Retail:
                {
                    var prod = world.Catalog.Product(ms.Product);
                    var monthly = ms.MonthlyThroughput;
                    outputs.Add(new OutputDescriptor(
                        Kind: OutputKind.Retail,
                        Product: ms.Product,
                        ProductName: prod.Name,
                        Tier: prod.Tier,
                        DestinationLabel: $"In-store sales · {cityName}",
                        MonthlyThroughput: monthly,
                        SlotIndex: ms.SlotIndex));
                    break;
                }
                case SlotKind.Production:
                case SlotKind.Extraction:
                {
                    var prod = world.Catalog.Product(ms.Product);
                    var monthly = ms.MonthlyThroughput;

                    // Look for a same-owner retailer in any city with a retail slot for this product.
                    var retailer = world.Buildings.Values
                        .Where(b => b.Owner == building.Owner && b.Id != building.Id)
                        .Where(b => b.RetailSlots.Any(rs => rs.Product == ms.Product))
                        .OrderBy(b => b.City == building.City ? 0 : 1)
                        .ThenBy(b => b.Id.Value)
                        .FirstOrDefault();
                    if (retailer is not null)
                    {
                        var retailerCity = world.Catalog.Cities.TryGetValue(retailer.City, out var rc) ? rc.Name : retailer.City.Value;
                        outputs.Add(new OutputDescriptor(
                            Kind: OutputKind.OwnRetailer,
                            Product: ms.Product,
                            ProductName: prod.Name,
                            Tier: prod.Tier,
                            DestinationLabel: $"Own Retailer #B{retailer.Id.Value} · {retailerCity}",
                            MonthlyThroughput: monthly,
                            SlotIndex: ms.SlotIndex));
                    }

                    if (building.AutoExport && prod.Tier != ProductTier.Finished)
                    {
                        outputs.Add(new OutputDescriptor(
                            Kind: OutputKind.WorldMarketExport,
                            Product: ms.Product,
                            ProductName: prod.Name,
                            Tier: prod.Tier,
                            DestinationLabel: "World Market export",
                            MonthlyThroughput: monthly,
                            SlotIndex: ms.SlotIndex));
                    }
                    break;
                }
                case SlotKind.Warehouse:
                {
                    var prod = world.Catalog.Product(ms.Product);
                    outputs.Add(new OutputDescriptor(
                        Kind: OutputKind.WarehouseStock,
                        Product: ms.Product,
                        ProductName: prod.Name,
                        Tier: prod.Tier,
                        DestinationLabel: "Held in stockpile",
                        MonthlyThroughput: 0.0,
                        SlotIndex: ms.SlotIndex));
                    break;
                }
                case SlotKind.Research:
                    // Research slots don't produce a tradable output — skip in the
                    // distribution column. They still appear in the middle column.
                    break;
            }
        }

        // ---------------- Layout ---------------------------------------------------------
        DrawColumnHeaders();

        // Inputs column.
        for (var i = 0; i < inputProductIds.Count; i++)
        {
            var pid = inputProductIds[i];
            var prod = world.Catalog.Product(pid);
            var sourceLabel = DescribeInputSource(world, building, pid, out var sourceTierWarn);

            var totalNeeded = middleSlots
                .Where(ms => ms.Recipe is not null)
                .Sum(ms => ms.Recipe!.Inputs.Where(ip => ip.ProductId == pid).Sum(ip => ip.Quantity)
                           * SimulationConstants.CyclesPerSlotPerMonth);

            var pos = new Vector2(InputColX, MarginTop + i * (CardHeight + CardVGap) + 24f);
            var card = BuildInputCard(prod, sourceLabel, totalNeeded, sourceTierWarn);
            card.Position = pos;
            card.Size = new Vector2(CardWidth, CardHeight);
            _canvas.AddChild(card);
            _inputs.Add(new CardEntry(i, pid, pos, new Vector2(CardWidth, CardHeight), card));
        }

        // Middle column (slots).
        for (var i = 0; i < middleSlots.Count; i++)
        {
            var ms = middleSlots[i];
            var pos = new Vector2(SlotColX, MarginTop + i * (CardHeight + CardVGap) + 24f);
            var card = BuildSlotCard(ms);
            card.Position = pos;
            card.Size = new Vector2(CardWidth, CardHeight);
            _canvas.AddChild(card);
            _slots.Add(new CardEntry(ms.SlotIndex, ms.Product, pos, new Vector2(CardWidth, CardHeight), card));
        }

        // Output column.
        for (var i = 0; i < outputs.Count; i++)
        {
            var o = outputs[i];
            var pos = new Vector2(OutputColX, MarginTop + i * (CardHeight + CardVGap) + 24f);
            var card = BuildOutputCard(o);
            card.Position = pos;
            card.Size = new Vector2(CardWidth, CardHeight);
            _canvas.AddChild(card);
            _outputs.Add(new CardEntry(i, o.Product, pos, new Vector2(CardWidth, CardHeight), card));
        }

        // ---------------- Build edges ----------------------------------
        // Input → slot: one edge per input that the slot's recipe consumes.
        for (var slotRow = 0; slotRow < middleSlots.Count; slotRow++)
        {
            var ms = middleSlots[slotRow];
            if (ms.Recipe is null) continue;
            foreach (var input in ms.Recipe.Inputs)
            {
                var inputRow = _inputs.FindIndex(e => e.Product == input.ProductId);
                if (inputRow < 0) continue;

                var fromCard = _inputs[inputRow];
                var toCard = _slots[slotRow];
                var from = new Vector2(fromCard.Position.X + fromCard.Size.X, fromCard.Position.Y + fromCard.Size.Y * 0.5f);
                var to   = new Vector2(toCard.Position.X - 2f, toCard.Position.Y + toCard.Size.Y * 0.5f);
                var monthlyConsumed = input.Quantity * SimulationConstants.CyclesPerSlotPerMonth;
                var thickness = ThicknessFor(monthlyConsumed);
                Edges.Add(new EdgeInfo(from, to, thickness, Half: 0, LeftIndex: inputRow, SlotIndex: ms.SlotIndex, RightIndex: -1));
            }
        }

        // Slot → output: one edge per output card, matched on slot index.
        for (var outRow = 0; outRow < outputs.Count; outRow++)
        {
            var o = outputs[outRow];
            var slotRow = _slots.FindIndex(e => e.Index == o.SlotIndex);
            if (slotRow < 0) continue;

            var fromCard = _slots[slotRow];
            var toCard = _outputs[outRow];
            var from = new Vector2(fromCard.Position.X + fromCard.Size.X, fromCard.Position.Y + fromCard.Size.Y * 0.5f);
            var to   = new Vector2(toCard.Position.X - 2f, toCard.Position.Y + toCard.Size.Y * 0.5f);
            var thickness = ThicknessFor(o.MonthlyThroughput);
            Edges.Add(new EdgeInfo(from, to, thickness, Half: 1, LeftIndex: -1, SlotIndex: o.SlotIndex, RightIndex: outRow));
        }

        // Size the canvas so ScrollContainer activates only when needed.
        var maxRows = Math.Max(_inputs.Count, Math.Max(_slots.Count, _outputs.Count));
        var totalHeight = MarginTop + 24f + maxRows * (CardHeight + CardVGap) + 32f;
        _canvas.CustomMinimumSize = new Vector2(OutputColX + CardWidth + 32f, MathF.Max(totalHeight, 600f));

        // Default selection: middle column, slot 0, if not yet pinned in range.
        ClampSelection();
        RestyleSelection();
        RefreshInspector();
        _canvas.QueueRedraw();
    }

    // ============================================================== Empty state

    private void RenderEmptyState(string bbcodeMessage)
    {
        if (_titleLabel is not null) _titleLabel.Text = "Slot Editor";
        if (_subLabel is not null)   _subLabel.Text = "(no building)";
        RenderInspectorMessage("(none)", $"[i]{bbcodeMessage}[/i]");
        if (_canvas is not null)
        {
            _canvas.CustomMinimumSize = new Vector2(900, 200);
            _canvas.QueueRedraw();
        }
    }

    private void RenderInspectorMessage(string title, string bodyBBCode)
    {
        if (_inspectorTitle is not null) _inspectorTitle.Text = title;
        if (_inspectorBody is not null)  _inspectorBody.Text  = bodyBBCode;
    }

    private void DrawColumnHeaders()
    {
        if (_canvas is null) return;
        AddHeader("INPUTS",        new Vector2(InputColX, 4f));
        AddHeader("MANUFACTURING", new Vector2(SlotColX, 4f));
        AddHeader("DISTRIBUTION",  new Vector2(OutputColX, 4f));
    }

    private void AddHeader(string text, Vector2 position)
    {
        if (_canvas is null) return;
        var label = new Label
        {
            Text = text,
            Position = position,
            Modulate = new Color(0xF0 / 255f, 0xC0 / 255f, 0x50 / 255f),
        };
        label.AddThemeFontSizeOverride("font_size", 14);
        label.CustomMinimumSize = new Vector2(CardWidth, 20);
        _canvas.AddChild(label);
    }

    // ============================================================== Card builders

    private static PanelContainer BuildInputCard(Product product, string sourceLabel, double monthlyNeeded, bool sourceWarn)
    {
        var card = MakeCard(product.Tier);
        var vbox = (VBoxContainer)card.GetChild(0).GetChild(0);

        var name = new Label { Text = product.Name };
        name.AddThemeFontSizeOverride("font_size", 16);
        vbox.AddChild(name);

        var src = new Label { Text = $"SOURCE: {sourceLabel}" };
        src.AddThemeFontSizeOverride("font_size", 11);
        if (sourceWarn) src.AddThemeColorOverride("font_color", WarnAmber); else src.Modulate = DimText;
        vbox.AddChild(src);

        var qty = new Label
        {
            Text = $"{monthlyNeeded.ToString("F0", Inv)} {product.Unit}/mo  ·  {TierLabel(product.Tier)}",
        };
        qty.AddThemeFontSizeOverride("font_size", 12);
        vbox.AddChild(qty);

        return card;
    }

    private static PanelContainer BuildSlotCard(MiddleSlot ms)
    {
        var card = MakeCard(ms.Tier);
        var vbox = (VBoxContainer)card.GetChild(0).GetChild(0);

        var name = new Label { Text = ms.ProductName };
        name.AddThemeFontSizeOverride("font_size", 17);
        vbox.AddChild(name);

        var line2 = new Label { Text = $"[{ms.SlotIndex}] {ms.KindLabel}" };
        line2.AddThemeFontSizeOverride("font_size", 11);
        line2.Modulate = DimText;
        vbox.AddChild(line2);

        var monthly = ms.MonthlyThroughput;
        var rateText = monthly > 0
            ? $"{monthly.ToString("F0", Inv)} units/mo  ·  {TierLabel(ms.Tier)}"
            : $"{TierLabel(ms.Tier)}";
        var rate = new Label { Text = rateText };
        rate.AddThemeFontSizeOverride("font_size", 12);
        vbox.AddChild(rate);

        return card;
    }

    private static PanelContainer BuildOutputCard(OutputDescriptor o)
    {
        var card = MakeCard(o.Tier);
        var vbox = (VBoxContainer)card.GetChild(0).GetChild(0);

        var name = new Label { Text = o.ProductName };
        name.AddThemeFontSizeOverride("font_size", 16);
        vbox.AddChild(name);

        var dest = new Label { Text = $"DEST: {o.DestinationLabel}" };
        dest.AddThemeFontSizeOverride("font_size", 11);
        dest.Modulate = DimText;
        vbox.AddChild(dest);

        var rateText = o.MonthlyThroughput > 0
            ? $"{o.MonthlyThroughput.ToString("F0", Inv)} units/mo  ·  {TierLabel(o.Tier)}"
            : $"{TierLabel(o.Tier)}";
        var rate = new Label { Text = rateText };
        rate.AddThemeFontSizeOverride("font_size", 12);
        vbox.AddChild(rate);

        return card;
    }

    /// <summary>
    /// Produces a freshly-styled <see cref="PanelContainer"/> with a margin and
    /// vbox already attached so each card builder just appends labels. The
    /// child path is fixed: <c>panel/MarginContainer/VBoxContainer</c>.
    /// </summary>
    private static PanelContainer MakeCard(ProductTier tier)
    {
        var panel = new PanelContainer();
        panel.AddThemeStyleboxOverride("panel", MakeCardStyle(tier, selected: false));
        // Stash the tier so RestyleSelection can re-apply the correct base color
        // even when the panel is currently rendered in the selected (gold) style.
        panel.SetMeta("tier", (int)tier);

        var margin = new MarginContainer();
        margin.AddThemeConstantOverride("margin_left", 12);
        margin.AddThemeConstantOverride("margin_right", 12);
        margin.AddThemeConstantOverride("margin_top", 8);
        margin.AddThemeConstantOverride("margin_bottom", 8);
        panel.AddChild(margin);

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 2);
        margin.AddChild(vbox);

        return panel;
    }

    private static StyleBoxFlat MakeCardStyle(ProductTier tier, bool selected)
    {
        var border = selected ? SelectedColor : TierColor(tier);
        var bw = selected ? 3 : 2;
        return new StyleBoxFlat
        {
            BgColor = CardFill,
            BorderColor = border,
            BorderWidthLeft = bw,
            BorderWidthRight = bw,
            BorderWidthTop = bw,
            BorderWidthBottom = bw,
            CornerRadiusTopLeft = 6,
            CornerRadiusTopRight = 6,
            CornerRadiusBottomLeft = 6,
            CornerRadiusBottomRight = 6,
            ContentMarginLeft = 4,
            ContentMarginRight = 4,
            ContentMarginTop = 2,
            ContentMarginBottom = 2,
        };
    }

    // ============================================================== Selection

    private void ClampSelection()
    {
        var col = _selectedColumn;
        var list = ColumnList(col);

        // If the chosen column is empty, fall through to the next non-empty
        // column, preferring middle (1) → inputs (0) → outputs (2).
        if (list.Count == 0)
        {
            foreach (var probe in new[] { 1, 0, 2 })
            {
                if (ColumnList(probe).Count > 0) { col = probe; break; }
            }
            list = ColumnList(col);
        }

        if (list.Count == 0)
        {
            _selectedColumn = 1;
            _selectedIndex = 0;
            SelectedKey = (1, -1);
            return;
        }

        if (_selectedIndex >= list.Count) _selectedIndex = list.Count - 1;
        if (_selectedIndex < 0) _selectedIndex = 0;
        _selectedColumn = col;

        var entry = list[_selectedIndex];
        // For col 1 (slots), the engine slot-index identifies the card; for cols
        // 0/2 the row index is what cross-half edges match against.
        SelectedKey = (col, col == 1 ? entry.Index : entry.Index);
    }

    private List<CardEntry> ColumnList(int column) => column switch
    {
        0 => _inputs,
        1 => _slots,
        2 => _outputs,
        _ => _slots,
    };

    private void MoveWithinColumn(int direction)
    {
        var list = ColumnList(_selectedColumn);
        if (list.Count == 0) return;
        var next = _selectedIndex + direction;
        if (next < 0 || next >= list.Count) return;
        _selectedIndex = next;
        OnSelectionChanged();
    }

    private void MoveAcrossColumns(int direction)
    {
        var newCol = _selectedColumn + direction;
        if (newCol < 0 || newCol > 2) return;

        var src = ColumnList(_selectedColumn);
        var dst = ColumnList(newCol);
        if (dst.Count == 0) return;

        // Pick the dst row whose Y is closest to the current selection's Y.
        if (src.Count > 0)
        {
            var currentY = src[_selectedIndex].Position.Y;
            var best = 0;
            var bestDelta = float.MaxValue;
            for (var i = 0; i < dst.Count; i++)
            {
                var d = MathF.Abs(dst[i].Position.Y - currentY);
                if (d < bestDelta) { bestDelta = d; best = i; }
            }
            _selectedIndex = best;
        }
        else
        {
            _selectedIndex = 0;
        }
        _selectedColumn = newCol;
        OnSelectionChanged();
    }

    private void OnSelectionChanged()
    {
        ClampSelection();
        RestyleSelection();
        RefreshInspector();
        _canvas?.QueueRedraw();
        ScrollSelectionIntoView();
    }

    private void OnEnterPressed()
    {
        // Read-only v1: Enter on any card returns to BuildingInspector with the
        // already-set GameState.SelectedBuilding. Future polish will deep-link
        // to the specific slot via a SelectedSlotIndex field — for now the
        // building context alone is the contract.
        if (GameState.SelectedBuilding is null) { OnBack(); return; }
        GetTree().ChangeSceneToFile("res://scenes/BuildingInspector.tscn");
    }

    private void RestyleSelection()
    {
        StyleColumn(_inputs,  _selectedColumn == 0 ? _selectedIndex : -1);
        StyleColumn(_slots,   _selectedColumn == 1 ? _selectedIndex : -1);
        StyleColumn(_outputs, _selectedColumn == 2 ? _selectedIndex : -1);
    }

    private static void StyleColumn(List<CardEntry> list, int selectedIdx)
    {
        for (var i = 0; i < list.Count; i++)
        {
            var entry = list[i];
            var tier = TierFor(entry.Card);
            entry.Card.AddThemeStyleboxOverride("panel", MakeCardStyle(tier, selected: i == selectedIdx));
        }
    }

    private void ScrollSelectionIntoView()
    {
        var scroll = GetNodeOrNull<ScrollContainer>("Panel/VBox/Body/Scroll");
        if (scroll is null) return;
        var list = ColumnList(_selectedColumn);
        if (list.Count == 0 || _selectedIndex < 0 || _selectedIndex >= list.Count) return;

        var entry = list[_selectedIndex];
        var visible = scroll.Size;
        var top = entry.Position.Y;
        var bottom = entry.Position.Y + entry.Size.Y;
        var left = entry.Position.X;
        var right = entry.Position.X + entry.Size.X;

        var vs = scroll.ScrollVertical;
        if (top < vs) scroll.ScrollVertical = (int)MathF.Max(0, top - 8);
        else if (bottom > vs + visible.Y) scroll.ScrollVertical = (int)(bottom - visible.Y + 8);

        var hs = scroll.ScrollHorizontal;
        if (left < hs) scroll.ScrollHorizontal = (int)MathF.Max(0, left - 8);
        else if (right > hs + visible.X) scroll.ScrollHorizontal = (int)(right - visible.X + 8);
    }

    // ============================================================== Inspector panel

    private void RefreshInspector()
    {
        if (_inspectorTitle is null || _inspectorBody is null) return;
        var world = GameState.World;
        if (world is null) { RenderInspectorMessage("(none)", "[i]No active world.[/i]"); return; }

        var list = ColumnList(_selectedColumn);
        if (list.Count == 0)
        {
            RenderInspectorMessage("(empty)", "[i]Nothing to inspect in this column.[/i]");
            return;
        }
        var entry = list[_selectedIndex];

        switch (_selectedColumn)
        {
            case 0: ShowInputInspector(world, entry.Product); break;
            case 1: ShowSlotInspector(world, entry.Index, entry.Product); break;
            case 2: ShowOutputInspector(world, entry.Index, entry.Product); break;
        }
    }

    private void ShowInputInspector(World world, ProductId product)
    {
        if (_inspectorTitle is null || _inspectorBody is null) return;
        var prod = world.Catalog.Product(product);
        _inspectorTitle.Text = prod.Name;

        var sb = new StringBuilder();
        sb.Append("[b]Tier:[/b] ").Append(prod.Tier).Append('\n');
        sb.Append("[b]Unit:[/b] ").Append(prod.Unit).Append('\n');
        sb.Append("[b]World price:[/b] $")
          .Append(prod.BaseWorldMarketPrice.ToString("N2", Money)).Append('\n');

        if (GameState.SelectedBuilding is not null
            && world.Buildings.TryGetValue(GameState.SelectedBuilding.Value, out var building))
        {
            sb.Append('\n').Append("[b]Source:[/b] ")
              .Append(DescribeInputSource(world, building, product, out _)).Append('\n');
            sb.Append("[b]On hand here:[/b] ")
              .Append(building.Inventory.Get(product).ToString("N0", Money))
              .Append(' ').Append(prod.Unit).Append('\n');
        }
        _inspectorBody.Text = sb.ToString();
    }

    private void ShowSlotInspector(World world, int slotIndex, ProductId product)
    {
        if (_inspectorTitle is null || _inspectorBody is null) return;
        var prod = world.Catalog.Product(product);
        _inspectorTitle.Text = $"[{slotIndex}] {prod.Name}";

        var sb = new StringBuilder();
        sb.Append("[b]Tier:[/b] ").Append(prod.Tier).Append('\n');
        sb.Append("[b]Unit:[/b] ").Append(prod.Unit).Append('\n');

        if (prod.Recipe is null)
        {
            sb.Append("[b]Recipe:[/b] none (raw material).\n");
            if (prod.Extraction is not null)
            {
                sb.Append("[b]Extraction:[/b] ")
                  .Append(prod.Extraction.SourceCategory).Append(" · yield ")
                  .Append(prod.Extraction.YieldPerSlotPerMonth.ToString("N1", Money))
                  .Append(' ').Append(prod.Unit).Append("/slot-month\n");
            }
        }
        else
        {
            sb.Append("[b]Output / cycle:[/b] ")
              .Append(prod.Recipe.OutputQuantity.ToString("N1", Money))
              .Append(' ').Append(prod.Unit).Append('\n');
            sb.Append("[b]Cycles / month:[/b] ")
              .Append(SimulationConstants.CyclesPerSlotPerMonth.ToString("N0", Money)).Append('\n');
            sb.Append("[b]Monthly throughput:[/b] ")
              .Append((prod.Recipe.OutputQuantity * SimulationConstants.CyclesPerSlotPerMonth).ToString("N0", Money))
              .Append(' ').Append(prod.Unit).Append("/mo\n");

            sb.Append("[b]Labor:[/b] ")
              .Append(prod.Recipe.LaborUnits.ToString("N1", Money))
              .Append(" units / cycle\n");

            if (prod.Recipe.Inputs.Count == 0)
            {
                sb.Append("\n[b]Inputs:[/b] none (synthesized)\n");
            }
            else
            {
                sb.Append("\n[b]Inputs / cycle:[/b]\n");
                foreach (var input in prod.Recipe.Inputs)
                {
                    var ip = world.Catalog.Products.TryGetValue(input.ProductId, out var x) ? x.Name : input.ProductId.Value;
                    sb.Append("  • ").Append(input.Quantity.ToString("N1", Money))
                      .Append(" × ").Append(ip).Append('\n');
                }
            }
        }

        sb.Append("\n[i]Press Enter to edit this slot in BuildingInspector.[/i]");
        _inspectorBody.Text = sb.ToString();
    }

    private void ShowOutputInspector(World world, int outputRow, ProductId product)
    {
        if (_inspectorTitle is null || _inspectorBody is null) return;
        var prod = world.Catalog.Product(product);
        _inspectorTitle.Text = prod.Name;

        var sb = new StringBuilder();
        sb.Append("[b]Tier:[/b] ").Append(prod.Tier).Append('\n');
        sb.Append("[b]Unit:[/b] ").Append(prod.Unit).Append('\n');
        sb.Append("[b]World price:[/b] $")
          .Append(prod.BaseWorldMarketPrice.ToString("N2", Money)).Append('\n');

        if (GameState.SelectedBuilding is not null
            && world.Buildings.TryGetValue(GameState.SelectedBuilding.Value, out var building))
        {
            sb.Append("\n[b]On hand at source:[/b] ")
              .Append(building.Inventory.Get(product).ToString("N0", Money))
              .Append(' ').Append(prod.Unit).Append('\n');
        }
        _inspectorBody.Text = sb.ToString();
    }

    // ============================================================== Inputs / Outputs / Slot helpers

    private enum SlotKind { Production, Extraction, Retail, Warehouse, Research }
    private enum OutputKind { Retail, OwnRetailer, WorldMarketExport, WarehouseStock }

    private sealed record MiddleSlot(
        int SlotIndex,
        SlotKind Kind,
        string KindLabel,
        ProductId Product,
        string ProductName,
        ProductTier Tier,
        Recipe? Recipe,
        double MonthlyThroughput);

    private sealed record OutputDescriptor(
        OutputKind Kind,
        ProductId Product,
        string ProductName,
        ProductTier Tier,
        string DestinationLabel,
        double MonthlyThroughput,
        int SlotIndex);

    private sealed record CardEntry(int Index, ProductId Product, Vector2 Position, Vector2 Size, PanelContainer Card);

    private static List<MiddleSlot> CollectMiddleSlots(BuildingInstance b, World world)
    {
        var list = new List<MiddleSlot>();
        foreach (var s in b.ProductionSlots.OrderBy(x => x.Index))
        {
            var prod = world.Catalog.Product(s.Product);
            var monthly = (prod.Recipe?.OutputQuantity ?? 0.0) * SimulationConstants.CyclesPerSlotPerMonth;
            list.Add(new MiddleSlot(s.Index, SlotKind.Production, "Production", s.Product, prod.Name, prod.Tier, prod.Recipe, monthly));
        }
        foreach (var s in b.ExtractionSlots.OrderBy(x => x.Index))
        {
            var prod = world.Catalog.Product(s.Product);
            var monthly = prod.Extraction?.YieldPerSlotPerMonth ?? 0.0;
            list.Add(new MiddleSlot(s.Index, SlotKind.Extraction, "Extraction", s.Product, prod.Name, prod.Tier, null, monthly));
        }
        foreach (var s in b.RetailSlots.OrderBy(x => x.Index))
        {
            var prod = world.Catalog.Product(s.Product);
            // Retailers display restock target as their nominal monthly throughput.
            list.Add(new MiddleSlot(s.Index, SlotKind.Retail, "Retail", s.Product, prod.Name, prod.Tier, prod.Recipe, s.RestockTarget));
        }
        foreach (var s in b.WarehouseSlots.OrderBy(x => x.Index))
        {
            var prod = world.Catalog.Product(s.Product);
            list.Add(new MiddleSlot(s.Index, SlotKind.Warehouse, "Warehouse", s.Product, prod.Name, prod.Tier, prod.Recipe, s.TargetStock));
        }
        foreach (var s in b.ResearchSlots.OrderBy(x => x.Index))
        {
            var prod = world.Catalog.Product(s.Product);
            list.Add(new MiddleSlot(s.Index, SlotKind.Research, "Research", s.Product, prod.Name, prod.Tier, prod.Recipe, 0.0));
        }
        return list.OrderBy(m => m.SlotIndex).ToList();
    }

    /// <summary>
    /// Mirrors the procurement order from <see cref="MaterialProcurement"/>:
    /// own producer/extractor (same city preferred) → own warehouse → world
    /// market. Sets <paramref name="warn"/> when the source is the world market
    /// (amber tint), since that means cash leaves on every cycle.
    /// </summary>
    private static string DescribeInputSource(World world, BuildingInstance receiver, ProductId product, out bool warn)
    {
        warn = false;

        BuildingInstance? bestProducer = null;
        BuildingInstance? bestWarehouse = null;
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != receiver.Owner) continue;
            if (b.Id == receiver.Id) continue;

            var producesIt = b.ProductionSlots.Any(s => s.Product == product)
                          || b.ExtractionSlots.Any(s => s.Product == product);
            if (producesIt)
            {
                if (bestProducer is null
                    || (bestProducer.City != receiver.City && b.City == receiver.City)
                    || (bestProducer.City == b.City && b.Id.Value < bestProducer.Id.Value))
                {
                    bestProducer = b;
                }
            }
            else if (b.WarehouseSlots.Any(s => s.Product == product))
            {
                if (bestWarehouse is null
                    || (bestWarehouse.City != receiver.City && b.City == receiver.City)
                    || (bestWarehouse.City == b.City && b.Id.Value < bestWarehouse.Id.Value))
                {
                    bestWarehouse = b;
                }
            }
        }

        if (bestProducer is not null)
        {
            var cityName = world.Catalog.Cities.TryGetValue(bestProducer.City, out var c) ? c.Name : bestProducer.City.Value;
            return $"Own Producer #B{bestProducer.Id.Value} · {cityName}";
        }
        if (bestWarehouse is not null)
        {
            var cityName = world.Catalog.Cities.TryGetValue(bestWarehouse.City, out var c) ? c.Name : bestWarehouse.City.Value;
            return $"Own Warehouse #B{bestWarehouse.Id.Value} · {cityName}";
        }
        warn = true;
        return "World Market";
    }

    // ============================================================== Helpers

    private static int TotalSlotsUsed(BuildingInstance b)
        => b.ProductionSlots.Count + b.ExtractionSlots.Count
         + b.WarehouseSlots.Count + b.RetailSlots.Count + b.ResearchSlots.Count;

    private static Color TierColor(ProductTier tier) => tier switch
    {
        ProductTier.Raw          => RawColor,
        ProductTier.Intermediate => IntermColor,
        ProductTier.Finished     => FinishedColor,
        _                        => new Color(0.5f, 0.5f, 0.5f),
    };

    private static string TierLabel(ProductTier tier) => tier switch
    {
        ProductTier.Raw          => "RAW",
        ProductTier.Intermediate => "INTERMEDIATE",
        ProductTier.Finished     => "FINISHED",
        _                        => tier.ToString().ToUpperInvariant(),
    };

    /// <summary>
    /// Maps a units-per-month figure to a stroke width in pixels. Logarithmic-ish
    /// so a 10× swing in volume only doubles the stroke. Min 1.5, max 4.5.
    /// </summary>
    private static float ThicknessFor(double monthlyUnits)
    {
        if (monthlyUnits <= 1.0) return 1.5f;
        var t = (float)Math.Log10(monthlyUnits);   // ~0–6 for typical volumes
        return Math.Clamp(1.5f + 0.5f * t, 1.5f, 4.5f);
    }

    /// <summary>
    /// Recovers a card's tier from the metadata stashed by <see cref="MakeCard"/>.
    /// We can't read it from the StyleBoxFlat border color since selected cards
    /// have a gold border that overrides the tier color.
    /// </summary>
    private static ProductTier TierFor(PanelContainer card)
    {
        if (!card.HasMeta("tier")) return ProductTier.Raw;
        return (ProductTier)(int)card.GetMeta("tier");
    }

    private void OnBack()
    {
        if (GameState.SelectedBuilding is not null)
            GetTree().ChangeSceneToFile("res://scenes/BuildingInspector.tscn");
        else
            GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
    }
}
