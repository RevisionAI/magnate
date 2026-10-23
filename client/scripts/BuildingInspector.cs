using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Godot;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Deep view of a single building. Shows the full inventory (split by tier),
/// retail / production / research / warehouse slot detail, workforce summary,
/// a per-building accrual P&amp;L (Phase 3.45 — Revenue − COGS − Opex over three
/// time windows, plus a 12-month net-income sparkline), editable controls
/// (retail price / restock, warehouse target), AutoExport toggle, and an
/// add-slot affordance when capacity remains. Re-renders live as the sim ticks.
/// </summary>
public partial class BuildingInspector : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    /// <summary>The first month the sim ever advances into. Matches FinancialStatements.</summary>
    private static readonly GameDate SimStart = new(2026, 2);

    private Label? _statusLabel;
    private VBoxContainer? _content;
    private BuildingInstanceId _buildingId;

    /// <summary>Month index of the last simulated month reflected in the UI; used
    /// to re-render only when the sim has advanced.</summary>
    private int _lastRenderedMonthIndex = int.MinValue;

    public override void _Ready()
    {
        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;
        GetNode<Button>("Panel/VBox/VisualEditorButton").Pressed += () =>
            GetTree().ChangeSceneToFile("res://scenes/SlotEditor.tscn");
        _statusLabel = GetNode<Label>("Panel/VBox/StatusLabel");
        _content = GetNode<VBoxContainer>("Panel/VBox/Scroll/Content");

        ApplyChrome();
        WireTooltips();

        if (GameState.World is null || GameState.SelectedBuilding is null)
        {
            SetStatus("No building selected.", isError: true);
            GetNode<Label>("Panel/VBox/HeaderLabel").Text = "Building (none selected)";
            GetNode<Label>("Panel/VBox/SubLabel").Text = "Return to Manage and pick a building.";
            return;
        }

        _buildingId = GameState.SelectedBuilding.Value;
        Render();
    }

    /// <summary>
    /// Attach tooltips to stable header / scene-level controls in the .tscn.
    /// Re-rendered content (slots, P&amp;L, inventory) is tooltipped inline in
    /// the per-render builders below, since <see cref="Render"/> queue-frees
    /// and rebuilds the Content tree on every tick.
    /// </summary>
    private void WireTooltips()
    {
        Tooltip.Attach(GetNode<Button>("Panel/VBox/BackButton"),
            "[b]Back[/b] to the manage screen. Simulation keeps advancing in the background.");
        Tooltip.Attach(GetNode<Label>("Panel/VBox/SubLabel"),
            "[b]Capacity badge[/b] — X of Y slots used. Slot count is fixed by building type; "
            + "buildings can't exceed capacity without upgrades. Also shows city, monthly opex, and current sim date.");
    }

    public override void _Process(double delta)
    {
        if (GameState.TickIfRunning((float)delta))
        {
            // Sim advanced — refresh everything.
            Render();
            return;
        }

        // Even when sim isn't ticking (paused), keep the month counter in sync
        // in case some other scene advanced time.
        if (GameState.World is not null
            && GameState.World.Clock.Now.AsMonthIndex() != _lastRenderedMonthIndex
            && GameState.SelectedBuilding is not null)
        {
            Render();
        }
    }

    private void ApplyChrome()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.80f),
            new Color(0.02f, 0.04f, 0.055f, 0.80f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.20f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        header.AddThemeFontSizeOverride("font_size", 30);

        GetNode<Label>("Panel/VBox/SubLabel").AddThemeColorOverride("font_color", UiChrome.Muted);

        // Readable plate behind the dense scrolling content.
        GetNode<ScrollContainer>("Panel/VBox/Scroll").AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.86f),
            new Color(UiChrome.Stroke.R, UiChrome.Stroke.G, UiChrome.Stroke.B, 0.5f),
            radius: 6, marginX: 14, marginY: 12));
    }

    private void Render()
    {
        if (_content is null) return;
        if (GameState.World is null || GameState.SelectedBuilding is null) return;

        foreach (var child in _content.GetChildren()) child.QueueFree();

        var world = GameState.World!;
        _buildingId = GameState.SelectedBuilding.Value;
        _lastRenderedMonthIndex = world.Clock.Now.AsMonthIndex();

        if (!world.Buildings.TryGetValue(_buildingId, out var building))
        {
            SetStatus($"Building {_buildingId} no longer exists.", isError: true);
            return;
        }

        var type = world.Catalog.BuildingType(building.TypeId);

        GetNode<Label>("Panel/VBox/HeaderLabel").Text = $"B{building.Id.Value}  ·  {type.Name}";
        GetNode<Label>("Panel/VBox/SubLabel").Text =
            $"{building.City.Value}  ·  slots used: {TotalSlotsUsed(building)} / {type.MaxUnits}"
            + $"  ·  opex: {type.MonthlyOperatingCost.ToString("C0", Money)}/mo"
            + $"  ·  {world.Clock.Now}";

        RenderWorkforceSection(_content, building, type);
        RenderPnlSection(_content, building, world);
        RenderInventorySection(_content, building, world);
        RenderSettingsSection(_content, building);
        RenderSlotsSection(_content, building, type, world);
    }

    // ================================================== Workforce

    private void RenderWorkforceSection(VBoxContainer parent, BuildingInstance b, BuildingType type)
    {
        parent.AddChild(SectionHeader("Workforce"));

        var slotsUsed = TotalSlotsUsed(b);

        if (type.TargetHeadcount is null)
        {
            parent.AddChild(new Label
            {
                Text = "  This building type has no headcount requirement.",
            });
            return;
        }

        var perSlotMin = type.TargetHeadcount.Min;
        var perSlotMax = type.TargetHeadcount.Max;

        var grid = new GridContainer { Columns = 2 };
        grid.AddThemeConstantOverride("h_separation", 16);
        grid.AddThemeConstantOverride("v_separation", 2);
        parent.AddChild(grid);

        grid.AddChild(new Label { Text = "Target headcount (per slot):" });
        grid.AddChild(new Label { Text = $"{perSlotMin:N0}–{perSlotMax:N0}" });

        grid.AddChild(new Label { Text = "Slots configured:" });
        grid.AddChild(new Label { Text = slotsUsed.ToString("N0") });

        grid.AddChild(new Label { Text = "Estimated staffing demand:" });
        grid.AddChild(new Label
        {
            Text = slotsUsed == 0
                ? "—"
                : $"{slotsUsed * perSlotMin:N0}–{slotsUsed * perSlotMax:N0}",
        });

        parent.AddChild(new Label
        {
            Text = "  (Actual headcount tracking awaits engine support.)",
            Modulate = new Color(0.7f, 0.7f, 0.7f),
        });
    }

    // ================================================== P&L (per-building accrual)

    /// <summary>One column of the accrual income statement for a (from..to) range.</summary>
    private readonly record struct PnlWindow(
        GameDate From,
        GameDate To,
        decimal Revenue,
        decimal Cogs,
        decimal Opex,
        int LedgerEntryCount,
        int CogsEntryCount)
    {
        public decimal GrossProfit => Revenue - Cogs;
        public decimal NetIncome   => Revenue - Cogs - Opex;
    }

    /// <summary>
    /// Per-building accrual Income Statement for Phase 3.45:
    ///   Revenue (ProductSale + ExportSale, attributed by LedgerEntry.Building)
    ///   − COGS  (CogsEntry.Cost, attributed by SourceBuilding)
    ///   − Opex  (OperatingCost, attributed by Building)
    ///   = Net Income
    /// Advertising is intentionally excluded — campaigns are (company, product, city)-scoped,
    /// not per-building, so AdvertisingCost ledger entries always have Building == null.
    /// Three side-by-side windows: This month / Last 12 months / Since open.
    /// </summary>
    private void RenderPnlSection(VBoxContainer parent, BuildingInstance b, World world)
    {
        parent.AddChild(SectionHeader("Income Statement (accrual, per building)",
            "[b]Per-building P&L[/b] — three columns: This month, Last 12 months, Since open. "
            + "Buildings that produce intermediates often show low revenue + high opex: internal transfers "
            + "don't book revenue here, the value surfaces downstream when retailers ship."));

        var now = world.Clock.Now;
        var openSince = OpenSinceDate(world, b.Id);
        var monthsOpen = openSince is null
            ? 0
            : Math.Max(1, now.AsMonthIndex() - openSince.Value.AsMonthIndex() + 1);

        // Period summary line
        var summary = openSince is null
            ? $"  Building #B{b.Id.Value} · open date unknown — using sim start as fallback"
            : $"  Building #B{b.Id.Value} · open since {openSince.Value} ({monthsOpen} month{(monthsOpen == 1 ? "" : "s")})";
        parent.AddChild(new Label
        {
            Text = summary,
            Modulate = new Color(0.85f, 0.9f, 1.0f),
        });

        // Windows — clamp each one to the building's open date so cumulative makes sense.
        var openOrSimStart = openSince ?? SimStart;
        var thisMonth   = ComputeWindow(world, b.Id, now, now);
        var last12Start = ClampToStart(WalkBackMonths(now, 11), openOrSimStart);
        var last12      = ComputeWindow(world, b.Id, last12Start, now);
        var sinceStart  = ComputeWindow(world, b.Id, openOrSimStart, now);

        // ----- 4-column grid (label, this-month, last-12, since-start) -----
        var grid = new GridContainer { Columns = 4 };
        grid.AddThemeConstantOverride("h_separation", 24);
        grid.AddThemeConstantOverride("v_separation", 3);
        parent.AddChild(grid);

        // header row
        grid.AddChild(BoldLabel(""));
        grid.AddChild(BoldLabel($"This month\n({now})"));
        grid.AddChild(BoldLabel($"Last 12 months\n({last12.From} → {last12.To})"));
        grid.AddChild(BoldLabel($"Since open\n({sinceStart.From} → {sinceStart.To})"));

        AddPnlRow(grid, "Revenue",            thisMonth.Revenue,    last12.Revenue,    sinceStart.Revenue,
                  tooltipBBCode: "[b]Revenue[/b] — sum of [code]ProductSale[/code] + [code]ExportSale[/code] ledger entries "
                                 + "attributed to this building. Internal transfers to your own retailers are not revenue here.");
        AddPnlRow(grid, "Cost of Goods Sold", thisMonth.Cogs,       last12.Cogs,       sinceStart.Cogs,
                  tooltipBBCode: "[b]COGS[/b] — sum of [code]CogsEntry.Cost[/code] where SourceBuilding = this. "
                                 + "Matched against revenue when units leave inventory. Excludes ad spend (campaigns are company-level).");
        AddPnlSeparator(grid);
        AddPnlRow(grid, "Gross Profit",       thisMonth.GrossProfit, last12.GrossProfit, sinceStart.GrossProfit, bold: true,
                  tooltipBBCode: "[b]Gross Profit[/b] = Revenue − COGS. The margin your production + pricing earns before fixed opex.");
        AddPnlRow(grid, "Operating Expenses", thisMonth.Opex,        last12.Opex,        sinceStart.Opex,
                  tooltipBBCode: "[b]Operating Expenses[/b] — this building's [code]MonthlyOperatingCost[/code] × months in the window. "
                                 + "Rent, utilities, maintenance. Paid whether or not the building is productive.");
        AddPnlRow(grid, "Advertising",        null,                  null,               null,
                  hint: "(company-level)",
                  tooltipBBCode: "[b]Advertising[/b] is intentionally blank here. Ad campaigns are scoped (company, product, city) "
                                 + "and never attributed to a single building — see Financial Statements for company-wide ad spend.");
        AddPnlSeparator(grid);
        AddPnlRow(grid, "Net Income",         thisMonth.NetIncome,   last12.NetIncome,   sinceStart.NetIncome,
                  bold: true, signColored: true,
                  tooltipBBCode: "[b]Net Income[/b] = Revenue − COGS − Opex. This is the accrual view; compare to the "
                                 + "cash-flow view in the company ledger. Green = profit, red = loss.");

        // ----- Notes -----
        var notes = new Label
        {
            Text =
                $"  ({thisMonth.LedgerEntryCount + thisMonth.CogsEntryCount:N0} entries this month · "
                + $"{sinceStart.LedgerEntryCount + sinceStart.CogsEntryCount:N0} since open)\n"
                + "  Internal transfers between this company's buildings don't book revenue —\n"
                + "  factories show low revenue / high opex; their value surfaces downstream when retailers ship goods.\n"
                + "  Ad spend is intentionally excluded (campaigns are (company, product, city)-scoped, not per-building) —\n"
                + "  see Financial Statements for company-wide ad spend.\n"
                + "  Older entries (saves pre-Phase 3.39) may not be attributed and won't appear in COGS.",
            Modulate = new Color(0.7f, 0.7f, 0.7f),
        };
        parent.AddChild(notes);

        // ----- Sparkline: monthly net income over the last 12 months -----
        var sparkSeries = BuildMonthlyNetIncomeSeries(world, b.Id, last12.From, now);
        if (sparkSeries.Count >= 2)
        {
            parent.AddChild(new Label
            {
                Text = "  Monthly net income — last 12 months",
                Modulate = new Color(0.85f, 0.9f, 1.0f),
            });

            var spark = new Sparkline
            {
                CustomMinimumSize = new Vector2(500, 60),
                LineColor = sparkSeries[^1] >= 0 ? new Color(0.55f, 1.0f, 0.55f) : new Color(1.0f, 0.55f, 0.55f),
            };
            spark.SetValues(sparkSeries);
            Tooltip.Attach(spark,
                "[b]Net income per month[/b] over the last 12 months. "
                + "Line color reflects the latest month — green = profit, red = loss. "
                + "Any month with no activity plots as zero.");
            parent.AddChild(spark);

            parent.AddChild(new Label
            {
                Text =
                    $"    latest {ToMoneyShort((decimal)sparkSeries[^1])}  ·  "
                    + $"min {ToMoneyShort((decimal)sparkSeries.Min())}  ·  "
                    + $"max {ToMoneyShort((decimal)sparkSeries.Max())}",
                Modulate = new Color(0.7f, 0.7f, 0.7f),
            });
        }
        else
        {
            parent.AddChild(new Label
            {
                Text = "  (sparkline needs at least 2 months of data)",
                Modulate = new Color(0.6f, 0.6f, 0.6f),
            });
        }
    }

    /// <summary>
    /// Sums revenue, COGS, and opex for a single building across [from..to] (inclusive).
    /// Walks <c>world.Ledger.EntriesFor(building.Owner)</c> and <c>world.CogsLog</c>,
    /// filtering by Building / SourceBuilding. CogsEntry.Cost is the total cost basis
    /// of the units that left inventory in that recognition (not per-unit), so we sum
    /// it directly.
    /// </summary>
    private static PnlWindow ComputeWindow(World world, BuildingInstanceId buildingId, GameDate from, GameDate to)
    {
        if (!world.Buildings.TryGetValue(buildingId, out var b))
            return new PnlWindow(from, to, 0m, 0m, 0m, 0, 0);

        decimal revenue = 0m;
        decimal opex = 0m;
        var ledgerCount = 0;

        foreach (var e in world.Ledger.EntriesFor(b.Owner))
        {
            if (e.Building != buildingId) continue;
            if (e.Date < from || e.Date > to) continue;

            switch (e.Category)
            {
                case LedgerCategory.ProductSale:
                case LedgerCategory.ExportSale:
                    revenue += e.Amount;
                    ledgerCount++;
                    break;
                case LedgerCategory.OperatingCost:
                    opex += -e.Amount;
                    ledgerCount++;
                    break;
            }
        }

        decimal cogs = 0m;
        var cogsCount = 0;
        foreach (var c in world.CogsLog.Entries)
        {
            if (c.Company != b.Owner) continue;
            if (c.SourceBuilding != buildingId) continue;
            if (c.Date < from || c.Date > to) continue;
            cogs += c.Cost;
            cogsCount++;
        }

        return new PnlWindow(from, to, revenue, cogs, opex, ledgerCount, cogsCount);
    }

    /// <summary>
    /// Builds a per-month net-income series for [from..to] (inclusive). Any month
    /// with no activity reports zero. Used to drive the 12-month sparkline.
    /// </summary>
    private static List<double> BuildMonthlyNetIncomeSeries(World world, BuildingInstanceId buildingId, GameDate from, GameDate to)
    {
        var series = new List<double>();
        var cursor = from;
        // Defensive: from must be <= to.
        if (from > to) return series;

        while (cursor <= to)
        {
            var w = ComputeWindow(world, buildingId, cursor, cursor);
            series.Add((double)w.NetIncome);
            if (cursor == to) break;
            cursor = cursor.AddMonth();
        }
        return series;
    }

    /// <summary>
    /// First ConstructionCost ledger entry attributed to this building, by date.
    /// Returns null for buildings that pre-date Phase 3.29 attribution. We fall
    /// back to SimStart in that case.
    /// </summary>
    private static GameDate? OpenSinceDate(World world, BuildingInstanceId buildingId)
    {
        GameDate? earliest = null;
        foreach (var e in world.Ledger.Entries)
        {
            if (e.Category != LedgerCategory.ConstructionCost) continue;
            if (e.Building != buildingId) continue;
            if (earliest is null || e.Date < earliest.Value) earliest = e.Date;
        }
        return earliest;
    }

    private static GameDate WalkBackMonths(GameDate d, int months)
    {
        var cur = d;
        for (var i = 0; i < months; i++)
        {
            cur = cur.Month == 1 ? new GameDate(cur.Year - 1, 12) : new GameDate(cur.Year, cur.Month - 1);
        }
        return cur;
    }

    private static GameDate ClampToStart(GameDate candidate, GameDate floor)
        => candidate < floor ? floor : candidate;

    private static void AddPnlRow(
        GridContainer grid,
        string label,
        decimal? thisMonth,
        decimal? last12,
        decimal? sinceStart,
        bool bold = false,
        bool signColored = false,
        string? hint = null,
        string? tooltipBBCode = null)
    {
        var labelNode = new Label { Text = "  " + label + (hint is null ? "" : "  " + hint) };
        if (bold) labelNode.AddThemeFontSizeOverride("font_size", 15);
        if (tooltipBBCode is not null) Tooltip.Attach(labelNode, tooltipBBCode);
        grid.AddChild(labelNode);

        AddAmountCell(grid, thisMonth,  bold, signColored);
        AddAmountCell(grid, last12,     bold, signColored);
        AddAmountCell(grid, sinceStart, bold, signColored);
    }

    private static void AddAmountCell(GridContainer grid, decimal? amount, bool bold, bool signColored)
    {
        var cell = new Label
        {
            Text = amount is null ? "—" : amount.Value.ToString("C0", Money),
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        if (bold) cell.AddThemeFontSizeOverride("font_size", 15);
        if (signColored && amount is not null)
        {
            cell.Modulate = amount.Value >= 0 ? new Color(0.6f, 1f, 0.6f) : new Color(1f, 0.6f, 0.6f);
        }
        grid.AddChild(cell);
    }

    private static void AddPnlSeparator(GridContainer grid)
    {
        for (var i = 0; i < 4; i++)
        {
            grid.AddChild(new Label
            {
                Text = i == 0 ? "  " : "  ─────────────",
                HorizontalAlignment = HorizontalAlignment.Right,
                Modulate = new Color(0.5f, 0.5f, 0.5f),
            });
        }
    }

    /// <summary>Compact dollar formatting for sparkline annotations ($12.3K / $1.2M).</summary>
    private static string ToMoneyShort(decimal v)
    {
        var abs = Math.Abs(v);
        var sign = v < 0 ? "-" : "";
        if (abs >= 1_000_000m) return $"{sign}${abs / 1_000_000m:F1}M";
        if (abs >= 1_000m)     return $"{sign}${abs / 1_000m:F1}K";
        return v.ToString("C0", Money);
    }

    // ================================================== Inventory

    private void RenderInventorySection(VBoxContainer parent, BuildingInstance b, World world)
    {
        parent.AddChild(SectionHeader("Inventory",
            "[b]Goods on hand[/b] at this building, split by tier (Finished / Intermediate / Raw). "
            + "[b]WAC Cost[/b] is weighted-average cost basis of the stack. "
            + "[b]Avg Q[/b] is the blended quality of all units on hand (0-100)."));

        var entries = b.Inventory.EntriesWithCost
            .Where(e => e.Quantity > 0)
            .OrderByDescending(e => e.Cost)
            .ToList();

        if (entries.Count == 0)
        {
            parent.AddChild(new Label { Text = "  (empty)" });
            return;
        }

        // Split by tier for quick scanning.
        var byTier = new Dictionary<ProductTier, List<(ProductId Product, double Quantity, decimal Cost, double AverageQuality)>>
        {
            [ProductTier.Raw] = new(),
            [ProductTier.Intermediate] = new(),
            [ProductTier.Finished] = new(),
        };
        foreach (var e in entries)
        {
            var tier = world.Catalog.Product(e.Product).Tier;
            byTier[tier].Add(e);
        }

        // Summary strip.
        var summary = new HBoxContainer();
        summary.AddThemeConstantOverride("separation", 24);
        parent.AddChild(summary);
        foreach (var tier in new[] { ProductTier.Finished, ProductTier.Intermediate, ProductTier.Raw })
        {
            var list = byTier[tier];
            double qty = list.Sum(e => e.Quantity);
            decimal cost = list.Sum(e => e.Cost);
            summary.AddChild(new Label
            {
                Text = $"{tier}: {qty:N0} units · {cost.ToString("C0", Money)}",
                Modulate = TierColor(tier),
            });
        }

        var grid = new GridContainer { Columns = 5 };
        grid.AddThemeConstantOverride("h_separation", 16);
        grid.AddThemeConstantOverride("v_separation", 4);
        parent.AddChild(grid);

        grid.AddChild(BoldLabel("Product"));
        grid.AddChild(BoldLabel("Tier"));
        grid.AddChild(BoldLabel("Qty"));
        grid.AddChild(BoldLabel("WAC Cost"));
        grid.AddChild(BoldLabel("Avg Q"));

        foreach (var tier in new[] { ProductTier.Finished, ProductTier.Intermediate, ProductTier.Raw })
        {
            foreach (var e in byTier[tier])
            {
                grid.AddChild(new Label { Text = e.Product.Value });
                grid.AddChild(new Label { Text = tier.ToString(), Modulate = TierColor(tier) });
                grid.AddChild(new Label { Text = e.Quantity.ToString("N0"), HorizontalAlignment = HorizontalAlignment.Right });
                grid.AddChild(new Label { Text = e.Cost.ToString("C0", Money), HorizontalAlignment = HorizontalAlignment.Right });
                grid.AddChild(new Label { Text = e.AverageQuality.ToString("F1"), HorizontalAlignment = HorizontalAlignment.Right });
            }
        }
    }

    private static Color TierColor(ProductTier tier) => tier switch
    {
        ProductTier.Raw          => new Color(0.85f, 0.70f, 0.50f),
        ProductTier.Intermediate => new Color(0.75f, 0.85f, 1.00f),
        ProductTier.Finished     => new Color(0.70f, 1.00f, 0.75f),
        _                        => new Color(1, 1, 1),
    };

    // ================================================== Settings

    private void RenderSettingsSection(VBoxContainer parent, BuildingInstance b)
    {
        parent.AddChild(SectionHeader("Settings"));

        var autoExport = new CheckBox { Text = "Auto-export surplus to world market each month", ButtonPressed = b.AutoExport };
        autoExport.Toggled += pressed =>
        {
            b.AutoExport = pressed;
            SetStatus($"Auto-export: {(pressed ? "on" : "off")}", isError: false);
        };
        Tooltip.Attach(autoExport,
            "[b]Auto-export[/b] — when ON, surplus production (after retail restock) auto-ships to the world market "
            + "at base price minus 10% inter-city shipping. Only cash-positive when BaseWorldMarketPrice exceeds your unit COGS — "
            + "otherwise you're booking losses each month.");
        parent.AddChild(autoExport);
    }

    // ================================================== Slots

    private void RenderSlotsSection(VBoxContainer parent, BuildingInstance b, BuildingType type, World world)
    {
        parent.AddChild(SectionHeader("Slots",
            "[b]Slots[/b] — each slot assigns the building to extract, produce, retail, warehouse, or research one product. "
            + "Capacity (slot count) is fixed by building type. "
            + "Retail: set price + restock target. Warehouse: set target stock. Production / extraction / research: pick the product."));

        foreach (var s in b.ProductionSlots.OrderBy(s => s.Index))
            parent.AddChild(ProductionSlotRow(s, b, world));

        foreach (var s in b.ExtractionSlots.OrderBy(s => s.Index))
            parent.AddChild(ExtractionSlotRow(s, b, world));

        foreach (var s in b.ResearchSlots.OrderBy(s => s.Index))
            parent.AddChild(ResearchSlotRow(s, b, world));

        foreach (var s in b.WarehouseSlots.OrderBy(s => s.Index))
            parent.AddChild(EditableWarehouseSlotRow(s, b));

        foreach (var s in b.RetailSlots.OrderBy(s => s.Index))
            parent.AddChild(EditableRetailSlotRow(s, b));

        // Add-slot affordance
        if (TotalSlotsUsed(b) < type.MaxUnits)
        {
            parent.AddChild(new HSeparator());
            parent.AddChild(BuildAddSlotForm(b, type, world));
        }
    }

    private Control ProductionSlotRow(ProductionSlot s, BuildingInstance b, World world)
    {
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 2);

        var head = new HBoxContainer();
        head.AddThemeConstantOverride("separation", 12);
        head.AddChild(new Label { Text = $"[{s.Index}] Production", CustomMinimumSize = new Vector2(180, 0) });
        head.AddChild(new Label { Text = s.Product.Value, CustomMinimumSize = new Vector2(120, 0) });

        var product = world.Catalog.Product(s.Product);
        var recipe = product.Recipe;
        double capacity = recipe is null ? 0.0 : recipe.OutputQuantity * SimulationConstants.CyclesPerSlotPerMonth;
        head.AddChild(new Label { Text = $"capacity: {capacity:N0}/mo" });
        box.AddChild(head);

        // Input deficit line: compare on-hand vs needed for one month at full rate.
        if (recipe is { Inputs: { Count: > 0 } inputs })
        {
            var deficits = new List<string>();
            foreach (var input in inputs)
            {
                var needed = input.Quantity * SimulationConstants.CyclesPerSlotPerMonth;
                var onHand = b.Inventory.Get(input.ProductId);
                if (onHand < needed)
                {
                    deficits.Add($"{input.ProductId.Value}: {onHand:N0}/{needed:N0}");
                }
            }
            if (deficits.Count > 0)
            {
                box.AddChild(new Label
                {
                    Text = "    input deficits: " + string.Join(", ", deficits),
                    Modulate = new Color(1f, 0.7f, 0.5f),
                });
            }
            else
            {
                box.AddChild(new Label
                {
                    Text = "    inputs on hand for a full month's run",
                    Modulate = new Color(0.6f, 0.9f, 0.6f),
                });
            }
        }

        return box;
    }

    private Control ExtractionSlotRow(ExtractionSlot s, BuildingInstance b, World world)
    {
        var product = world.Catalog.Product(s.Product);
        var yieldPerMonth = product.Extraction?.YieldPerSlotPerMonth ?? 0.0;

        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 12);
        row.AddChild(new Label { Text = $"[{s.Index}] Extraction", CustomMinimumSize = new Vector2(180, 0) });
        row.AddChild(new Label { Text = s.Product.Value, CustomMinimumSize = new Vector2(120, 0) });
        row.AddChild(new Label { Text = $"yield: {yieldPerMonth:N0}/mo" });
        row.AddChild(new Label { Text = $"on hand: {b.Inventory.Get(s.Product):N0}" });
        return row;
    }

    private Control ResearchSlotRow(ResearchSlot s, BuildingInstance b, World world)
    {
        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 12);
        row.AddChild(new Label { Text = $"[{s.Index}] Research", CustomMinimumSize = new Vector2(180, 0) });
        row.AddChild(new Label { Text = s.Product.Value, CustomMinimumSize = new Vector2(120, 0) });

        var currentTech = world.GetTech(b.Owner, s.Product);
        var progress = world.GetResearchProgress(b.Owner, s.Product);
        row.AddChild(new Label { Text = $"tech L{currentTech}" });
        row.AddChild(new Label { Text = $"progress: {progress:N0} pts" });
        row.AddChild(new Label { Text = $"+{SimulationConstants.ResearchPointsPerSlotPerMonth:N0}/mo" });
        return row;
    }

    private Control EditableRetailSlotRow(RetailSlot s, BuildingInstance b)
    {
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 2);

        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 8);

        row.AddChild(new Label { Text = $"[{s.Index}] Retail", CustomMinimumSize = new Vector2(180, 0) });
        row.AddChild(new Label { Text = s.Product.Value, CustomMinimumSize = new Vector2(120, 0) });

        row.AddChild(new Label { Text = "Price:" });
        var priceSpin = new SpinBox
        {
            MinValue = 0.01, MaxValue = 1_000_000, Step = 0.01,
            Value = (double)s.Price,
            CustomMinimumSize = new Vector2(100, 0),
        };
        Tooltip.Attach(priceSpin,
            "[b]Retail price[/b] per unit. Higher price = higher per-unit margin but lower demand. "
            + "Elasticity and local household income set the sweet spot; watch Net Income above.");
        row.AddChild(priceSpin);

        row.AddChild(new Label { Text = "Restock:" });
        var restockSpin = new SpinBox
        {
            MinValue = 0, MaxValue = 100_000_000, Step = 1000,
            Value = s.RestockTarget,
            CustomMinimumSize = new Vector2(140, 0),
        };
        Tooltip.Attach(restockSpin,
            "[b]Restock target[/b] — max units this retail slot will pull onto the shelf each tick, "
            + "sourced first from your supply chain, then the world market if configured.");
        row.AddChild(restockSpin);

        var apply = new Button { Text = "Apply" };
        apply.Pressed += () =>
        {
            try
            {
                var newPrice = (decimal)priceSpin.Value;
                if (newPrice <= 0m) throw new ArgumentException("price must be positive");
                s.Price = newPrice;
                s.RestockTarget = restockSpin.Value;
                SetStatus($"Retail slot {s.Index}: {s.Product.Value} @ {s.Price.ToString("C2", Money)}, restock {s.RestockTarget:N0}", isError: false);
            }
            catch (Exception ex)
            {
                SetStatus($"Update failed: {ex.Message}", isError: true);
            }
        };
        row.AddChild(apply);
        box.AddChild(row);

        // Detail strip: current on-hand inventory for this product at this building.
        var onHand = b.Inventory.Get(s.Product);
        box.AddChild(new Label
        {
            Text = $"    on shelf: {onHand:N0} / target {s.RestockTarget:N0}"
                 + "    (last-month units sold needs engine support)",
            Modulate = new Color(0.75f, 0.85f, 1.00f),
        });

        return box;
    }

    private Control EditableWarehouseSlotRow(WarehouseSlot s, BuildingInstance b)
    {
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 2);

        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 8);

        row.AddChild(new Label { Text = $"[{s.Index}] Warehouse", CustomMinimumSize = new Vector2(180, 0) });
        row.AddChild(new Label { Text = s.Product.Value, CustomMinimumSize = new Vector2(120, 0) });

        row.AddChild(new Label { Text = "Target stock:" });
        var targetSpin = new SpinBox
        {
            MinValue = 0, MaxValue = 100_000_000, Step = 1000,
            Value = s.TargetStock,
            CustomMinimumSize = new Vector2(140, 0),
        };
        Tooltip.Attach(targetSpin,
            "[b]Target stock[/b] — the warehouse will pull from your supply chain (and the world market, "
            + "if the product supports it) up to this quantity each tick. Set higher to buffer against demand spikes.");
        row.AddChild(targetSpin);

        var apply = new Button { Text = "Apply" };
        apply.Pressed += () =>
        {
            s.TargetStock = targetSpin.Value;
            SetStatus($"Warehouse slot {s.Index}: {s.Product.Value} target {s.TargetStock:N0}", isError: false);
        };
        row.AddChild(apply);
        box.AddChild(row);

        var onHand = b.Inventory.Get(s.Product);
        box.AddChild(new Label
        {
            Text = $"    on hand: {onHand:N0} / target {s.TargetStock:N0}",
            Modulate = new Color(0.75f, 0.85f, 1.00f),
        });

        return box;
    }

    // ================================================== Add slot form

    private Control BuildAddSlotForm(BuildingInstance b, BuildingType type, World world)
    {
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 6);

        box.AddChild(new Label
        {
            Text = $"Add a slot  ({type.MaxUnits - TotalSlotsUsed(b)} of {type.MaxUnits} slots remaining)",
            Modulate = new Color(0.8f, 0.9f, 1f),
        });

        var candidates = ProductsEligibleFor(world, type);
        if (candidates.Count == 0)
        {
            box.AddChild(new Label { Text = "  (no products are compatible with this building type)" });
            return box;
        }

        var grid = new GridContainer { Columns = 2 };
        grid.AddThemeConstantOverride("h_separation", 12);
        grid.AddThemeConstantOverride("v_separation", 6);
        box.AddChild(grid);

        grid.AddChild(new Label { Text = "Product:" });
        var productPicker = new OptionButton();
        foreach (var p in candidates) productPicker.AddItem(p.Id.Value);
        grid.AddChild(productPicker);

        // Retail-only
        var priceLabel = new Label { Text = "Price (retail only):" };
        var priceSpin = new SpinBox { MinValue = 0.01, MaxValue = 1_000_000, Step = 0.01, Value = 1.80 };
        grid.AddChild(priceLabel);
        grid.AddChild(priceSpin);

        var restockLabel = new Label { Text = "Restock target (retail / warehouse):" };
        var restockSpin = new SpinBox { MinValue = 0, MaxValue = 100_000_000, Step = 1000, Value = 500_000 };
        grid.AddChild(restockLabel);
        grid.AddChild(restockSpin);

        var addButton = new Button { Text = "Add slot" };
        Tooltip.Attach(addButton,
            "[b]Add slot[/b] — configure one free slot of this building to handle the selected product. "
            + "The slot kind (extract / produce / retail / warehouse / research) is determined by building type. "
            + "Price and restock inputs apply only to retail / warehouse slots.");
        box.AddChild(addButton);

        addButton.Pressed += () =>
        {
            try
            {
                var product = candidates[productPicker.Selected].Id;
                var nextIndex = NextFreeSlotIndex(b, type.MaxUnits);
                if (nextIndex < 0) { SetStatus("No free slot indices.", isError: true); return; }

                if (IsExtractionCategory(type.Category))
                {
                    world.ConfigureExtractionSlot(b.Id, nextIndex, product);
                }
                else if (type.Retail)
                {
                    world.ConfigureRetailSlot(b.Id, nextIndex, product, (decimal)priceSpin.Value, restockSpin.Value);
                }
                else if (type.Category is "warehouse" or "distribution_center" or "seaport" or "freight_yard")
                {
                    world.ConfigureWarehouseSlot(b.Id, nextIndex, product, restockSpin.Value);
                }
                else if (type.Category == "rd_center")
                {
                    world.ConfigureResearchSlot(b.Id, nextIndex, product);
                }
                else if (type.ProducibleTiers.Count > 0)
                {
                    world.ConfigureProductionSlot(b.Id, nextIndex, product);
                }
                else
                {
                    SetStatus("Building type doesn't accept slots of any known kind.", isError: true);
                    return;
                }

                SetStatus($"Added slot {nextIndex}: {product.Value}", isError: false);
                Render(); // refresh the whole inspector
            }
            catch (Exception ex)
            {
                SetStatus($"Add slot failed: {ex.Message}", isError: true);
            }
        };

        return box;
    }

    // ================================================== Helpers

    private static int TotalSlotsUsed(BuildingInstance b)
        => b.ProductionSlots.Count + b.ExtractionSlots.Count
         + b.WarehouseSlots.Count + b.RetailSlots.Count + b.ResearchSlots.Count;

    private static int NextFreeSlotIndex(BuildingInstance b, int maxUnits)
    {
        var used = new HashSet<int>();
        foreach (var s in b.ProductionSlots) used.Add(s.Index);
        foreach (var s in b.ExtractionSlots) used.Add(s.Index);
        foreach (var s in b.WarehouseSlots) used.Add(s.Index);
        foreach (var s in b.RetailSlots) used.Add(s.Index);
        foreach (var s in b.ResearchSlots) used.Add(s.Index);

        for (var i = 0; i < maxUnits; i++)
        {
            if (!used.Contains(i)) return i;
        }
        return -1;
    }

    private static bool IsExtractionCategory(string category)
        => category is "farm" or "livestock_farm" or "plantation" or "mine"
            or "oil_well" or "logging_camp" or "quarry";

    private static List<Product> ProductsEligibleFor(World world, BuildingType type)
    {
        if (IsExtractionCategory(type.Category))
        {
            return world.Catalog.Products.Values
                .Where(p => p.Tier == ProductTier.Raw
                         && p.Extraction is not null
                         && p.Extraction.SourceCategory == type.Category)
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal).ToList();
        }
        if (type.Retail)
        {
            return world.Catalog.Products.Values
                .Where(p => p.Tier == ProductTier.Finished)
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal).ToList();
        }
        if (type.ProducibleTiers.Count > 0)
        {
            return world.Catalog.Products.Values
                .Where(p => p.Recipe is not null && type.ProducibleTiers.Contains(p.Tier))
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal).ToList();
        }
        if (type.Category == "rd_center")
        {
            return world.Catalog.Products.Values
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal).ToList();
        }
        if (type.Category is "warehouse" or "distribution_center" or "seaport" or "freight_yard")
        {
            return world.Catalog.Products.Values
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal).ToList();
        }
        return new List<Product>();
    }

    private static Label BoldLabel(string text)
    {
        var l = new Label { Text = text };
        l.AddThemeFontSizeOverride("font_size", 14);
        return l;
    }

    private static Label SectionHeader(string text, string? tooltipBBCode = null)
    {
        var l = new Label { Text = text };
        l.AddThemeFontSizeOverride("font_size", 18);
        l.AddThemeColorOverride("font_color", UiChrome.Gold);
        if (tooltipBBCode is not null) Tooltip.Attach(l, tooltipBBCode);
        return l;
    }

    private void SetStatus(string text, bool isError)
    {
        if (_statusLabel is null) return;
        _statusLabel.Text = text;
        _statusLabel.Modulate = isError ? new Color(1, 0.5f, 0.5f) : new Color(0.7f, 1, 0.7f);
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Manage.tscn");
}
