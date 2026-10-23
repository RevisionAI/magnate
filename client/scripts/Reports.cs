using System;
using System.Globalization;
using System.Linq;
using System.Text;
using Godot;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Five-tab reports view. Pulls from the live <see cref="World"/> in
/// <see cref="GameState"/> and dumps formatted text into each tab's RichTextLabel.
/// Read-only; closing the scene returns to Main with the sim unaffected.
/// </summary>
public partial class Reports : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    private Button? _playButton;

    public override void _Ready()
    {
        ApplyChrome();

        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;
        _playButton = GetNode<Button>("Panel/VBox/PlaybackBar/PlayButton");
        _playButton.Pressed += OnTogglePlay;
        GetNode<Button>("Panel/VBox/PlaybackBar/AdvanceButton").Pressed += OnAdvanceOne;

        SyncPlayButtonText();
        WireTooltips();
        RefreshAll();
    }

    /// <summary>
    /// Phase 3.60 — attaches hover tooltips to the stable controls in this
    /// read-only reports view. Tab-label tooltips use Godot's built-in
    /// <see cref="TabContainer.SetTabTooltip"/> because <c>TabContainer</c>
    /// doesn't expose per-tab <see cref="Control"/> anchors suitable for the
    /// custom framework; the playback-bar and back buttons use the shared
    /// <see cref="Tooltip"/> helper for visual consistency with other scenes.
    /// Called once from <see cref="_Ready"/> — the reports content re-renders
    /// every tick but these header controls are stable and never queue_freed.
    /// </summary>
    private void WireTooltips()
    {
        Tooltip.Attach(GetNode<Button>("Panel/VBox/BackButton"),
            "[b]Back[/b] to the main menu. Simulation continues to advance in the background while you're in a sub-screen.");

        if (_playButton is not null)
            Tooltip.Attach(_playButton,
                "[b]Play / Pause[/b] — toggles auto-advance. Each real-time second advances one in-game month while playing.");

        Tooltip.Attach(GetNode<Button>("Panel/VBox/PlaybackBar/AdvanceButton"),
            "[b]Advance 1 Month[/b] — steps the simulation forward exactly one month and records a snapshot for the Trends tab.");

        // Tab tooltips: Godot's built-in per-tab tooltip API. Order follows the
        // scene tree: Income Statement (0), Balance Sheet (1), Per-Product P&L (2),
        // Exports (3), R&D and Ads (4), Goals (5), Trends (6).
        var tabs = GetNode<TabContainer>("Panel/VBox/Tabs");
        tabs.SetTabTooltip(0,
            "Current-month + year-to-date accrual P&L: Revenue − COGS − OpEx = Net Income.");
        tabs.SetTabTooltip(1,
            "Assets (Cash + Inventory at WAC + Buildings at cost) = Equity. No liabilities yet.");
        tabs.SetTabTooltip(2,
            "Per-product profitability: Revenue, COGS, marketing cost, and net margin by product, YTD.");
        tabs.SetTabTooltip(3,
            "World-market exports over the last 12 months, broken down by product and by exporting building.");
        tabs.SetTabTooltip(4,
            "Tech progress per product (current / max, progress to next level) and active ad campaigns with brand awareness.");
        tabs.SetTabTooltip(5,
            "Scenario victory conditions with progress bars; only populated for scenario runs, not save-file loads.");
        tabs.SetTabTooltip(6,
            "Sparklines of Cash, Monthly Revenue, Net Income, Top Brand, and Top Tech — one data point per recorded snapshot.");
    }

    // -------------------------------------------------------- chrome

    /// <summary>
    /// Phase 3.70 — applies the game's visual chrome (operations backdrop, dark
    /// translucent shell, gold header, styled tabs/buttons) over the default-grey
    /// scene. Presentation-only; touches no simulation state and no code node
    /// paths. Mirrors the pattern used by <c>Main</c>/<c>CityMap</c>. Replicated
    /// locally because <c>UiChrome</c> is shared and owned elsewhere.
    /// </summary>
    private void ApplyChrome()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.88f),
            new Color(0.02f, 0.04f, 0.055f, 0.68f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.12f), new Color(0f, 0f, 0f, 0f), borderWidth: 0));

        InstallShell(panel);

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        header.AddThemeFontSizeOverride("font_size", 30);
        GetNode<Label>("Panel/VBox/SubLabel").AddThemeColorOverride("font_color", UiChrome.Muted);

        var vbox = GetNode<VBoxContainer>("Panel/VBox");
        if (vbox.GetNodeOrNull("HeaderAccent") is null)
        {
            var accent = BuildAccentPlate(GamePresentation.MarketsArt,
                "Financial reports, per-product P&L, exports, and campaign performance at a glance.");
            vbox.AddChild(accent);
            vbox.MoveChild(accent, 2);
        }

        StyleTabs(GetNode<TabContainer>("Panel/VBox/Tabs"));
        StyleButton(GetNode<Button>("Panel/VBox/PlaybackBar/PlayButton"));
        StyleButton(GetNode<Button>("Panel/VBox/PlaybackBar/AdvanceButton"));
        StyleButton(GetNode<Button>("Panel/VBox/BackButton"));
    }

    private static void InstallShell(Panel panel)
    {
        if (panel.GetNodeOrNull<PanelContainer>("ContentShell") is not null) return;
        var shell = new PanelContainer
        {
            Name = "ContentShell",
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(shell);
        shell.OffsetLeft = 14f;
        shell.OffsetTop = 14f;
        shell.OffsetRight = -14f;
        shell.OffsetBottom = -14f;
        shell.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.035f, 0.060f, 0.075f, 0.62f),
            new Color(0.50f, 0.70f, 0.78f, 0.32f),
            radius: 8, marginX: 0, marginY: 0));
        panel.AddChild(shell);
        panel.MoveChild(shell, 2);
    }

    private static void StyleTabs(TabContainer tabs)
    {
        tabs.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.09f, 0.78f),
            new Color(0.30f, 0.46f, 0.54f, 0.5f), radius: 6));
        tabs.AddThemeStyleboxOverride("tabbar_background", UiChrome.Box(
            new Color(0f, 0f, 0f, 0f), new Color(0f, 0f, 0f, 0f), borderWidth: 0, radius: 0));
        tabs.AddThemeStyleboxOverride("tab_selected", UiChrome.Box(
            new Color(0.11f, 0.17f, 0.21f, 0.96f), UiChrome.Gold, radius: 5, marginY: 8));
        tabs.AddThemeStyleboxOverride("tab_unselected", UiChrome.Box(
            new Color(0.05f, 0.08f, 0.10f, 0.66f), UiChrome.Stroke, radius: 5, marginY: 8));
        tabs.AddThemeStyleboxOverride("tab_hovered", UiChrome.Box(
            new Color(0.08f, 0.13f, 0.16f, 0.90f), UiChrome.Blue, radius: 5, marginY: 8));
        tabs.AddThemeColorOverride("font_selected_color", UiChrome.Gold);
        tabs.AddThemeColorOverride("font_unselected_color", UiChrome.Muted);
        tabs.AddThemeColorOverride("font_hovered_color", new Color(0.92f, 0.96f, 0.98f));
    }

    private static void StyleButton(Button button)
    {
        button.AddThemeStyleboxOverride("normal", UiChrome.Box(
            new Color(0.06f, 0.10f, 0.13f, 0.92f), new Color(0.32f, 0.50f, 0.58f, 0.7f), radius: 5));
        button.AddThemeStyleboxOverride("hover", UiChrome.Box(
            new Color(0.09f, 0.14f, 0.18f, 0.95f), UiChrome.Blue, radius: 5));
        button.AddThemeStyleboxOverride("pressed", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.09f, 0.95f), UiChrome.Gold, radius: 5));
        button.AddThemeColorOverride("font_color", new Color(0.90f, 0.94f, 0.96f));
        button.AddThemeColorOverride("font_hover_color", UiChrome.Gold);
    }

    private static Control BuildAccentPlate(string texturePath, string caption)
    {
        var plate = new PanelContainer { Name = "HeaderAccent", CustomMinimumSize = new Vector2(0, 58) };
        plate.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.085f, 0.74f),
            new Color(0.45f, 0.70f, 0.80f, 0.4f), radius: 6, marginX: 0, marginY: 0));

        var texture = UiChrome.LoadTexture(texturePath);
        if (texture is not null)
        {
            var art = new TextureRect
            {
                Texture = texture,
                ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
                StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
                MouseFilter = Control.MouseFilterEnum.Ignore,
                Modulate = new Color(1f, 1f, 1f, 0.5f),
            };
            UiChrome.FullRect(art);
            plate.AddChild(art);
        }

        var shade = new ColorRect
        {
            Color = new Color(0.02f, 0.04f, 0.055f, 0.45f),
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(shade);
        plate.AddChild(shade);

        var label = new Label
        {
            Text = caption,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        label.AddThemeFontSizeOverride("font_size", 14);
        label.AddThemeColorOverride("font_color", new Color(0.90f, 0.94f, 0.92f));
        UiChrome.FullRect(label);
        plate.AddChild(label);
        return plate;
    }

    public override void _Process(double delta)
    {
        if (GameState.TickIfRunning((float)delta))
        {
            RefreshAll();
        }
    }

    private void RefreshAll()
    {
        var sub = GetNode<Label>("Panel/VBox/SubLabel");
        var world = GameState.World;
        if (world is null)
        {
            sub.Text = "No active game — start a scenario from the title screen.";
            var empty = "[i]No active game — start a scenario from the title screen to populate reports.[/i]";
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Income Statement/IncomeText").Text = empty;
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Balance Sheet/BalanceText").Text = empty;
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Per-Product P&L/ProductText").Text = empty;
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Exports/ExportsText").Text = empty;
            GetNode<RichTextLabel>("Panel/VBox/Tabs/R&D and Ads/RdAdsText").Text = empty;
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Goals/GoalsText").Text = empty;
            var trends = GetNode<VBoxContainer>("Panel/VBox/Tabs/Trends/TrendsContent");
            foreach (var child in trends.GetChildren()) child.QueueFree();
            trends.AddChild(new Label
            {
                Text = "No active game — start a scenario from the title screen.",
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            return;
        }

        sub.Text = $"Scenario: {GameState.ScenarioName}  ·  Date: {world.Clock.Now}  ·  Company: {PlayerName(world)}";

        RenderIncomeStatement(world);
        RenderBalanceSheet(world);
        RenderProductPnL(world);
        RenderExports(world);
        RenderRdAndAds(world);
        RenderGoals(world);
        RenderTrends();
    }

    private void SyncPlayButtonText()
    {
        if (_playButton is not null)
        {
            _playButton.Text = GameState.IsPlaying ? "Pause" : "Play";
        }
    }

    private void OnTogglePlay()
    {
        GameState.IsPlaying = !GameState.IsPlaying;
        SyncPlayButtonText();
    }

    private void OnAdvanceOne()
    {
        if (GameState.World is null) return;
        GameState.World.AdvanceMonth();
        GameState.RecordSnapshot();
        RefreshAll();
    }

    // -------------------------------------------------------- Income statement

    private void RenderIncomeStatement(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/Income Statement/IncomeText");

        var startOfSim = new GameDate(2026, 2); // first tick advances from 2026-01 → 2026-02
        var now = world.Clock.Now;
        var currentMonth = world.GetIncomeStatement(GameState.PlayerId, now, now);
        var yearToDate = world.GetIncomeStatement(GameState.PlayerId, startOfSim, now);

        var sb = new StringBuilder();
        sb.AppendLine("[b]Income Statement (accrual basis)[/b]");
        sb.AppendLine();
        sb.AppendLine($"[b]Current month — {now}[/b]");
        AppendIncomeRows(sb, currentMonth);
        sb.AppendLine();
        sb.AppendLine($"[b]Year to date — {startOfSim} → {now}[/b]");
        AppendIncomeRows(sb, yearToDate);
        sb.AppendLine();
        sb.AppendLine("[i]Revenue sources: product sales + world-market exports[/i]");
        sb.AppendLine("[i]COGS = cost basis of goods that left inventory this period (WAC)[/i]");
        sb.AppendLine("[i]OpEx = building running costs + advertising (period costs, never capitalized)[/i]");

        rtl.Text = sb.ToString();
    }

    private static void AppendIncomeRows(StringBuilder sb, IncomeStatement s)
    {
        sb.AppendLine($"  Revenue              {s.Revenue.ToString("C0", Money),20}");
        sb.AppendLine($"  Cost of Goods Sold   {s.CostOfGoodsSold.ToString("C0", Money),20}");
        sb.AppendLine($"  Gross Profit         {s.GrossProfit.ToString("C0", Money),20}");
        sb.AppendLine($"  Operating Expenses   {s.OperatingExpenses.ToString("C0", Money),20}");
        sb.AppendLine($"  [b]Net Income           {s.NetIncome.ToString("C0", Money),20}[/b]");
    }

    // -------------------------------------------------------- Balance sheet

    private void RenderBalanceSheet(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/Balance Sheet/BalanceText");
        var bs = world.GetBalanceSheet(GameState.PlayerId);

        var sb = new StringBuilder();
        sb.AppendLine($"[b]Balance Sheet — as of {bs.AsOf}[/b]");
        sb.AppendLine();
        sb.AppendLine("[b]Assets[/b]");
        sb.AppendLine($"  Cash                 {bs.Cash.ToString("C0", Money),20}");
        sb.AppendLine($"  Inventory (at WAC)   {bs.InventoryValue.ToString("C0", Money),20}");
        sb.AppendLine($"  Buildings (at cost)  {bs.BuildingValue.ToString("C0", Money),20}");
        sb.AppendLine($"  [b]Total Assets         {bs.TotalAssets.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine("[b]Liabilities[/b]");
        sb.AppendLine($"  (none yet)           {bs.Liabilities.ToString("C0", Money),20}");
        sb.AppendLine();
        sb.AppendLine("[b]Equity[/b]");
        sb.AppendLine($"  [b]Total Equity         {bs.Equity.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine("[i]Equity = Total Assets − Liabilities. With no debt, equity equals starting capital plus cumulative net income since day one — the books close.[/i]");

        rtl.Text = sb.ToString();
    }

    // -------------------------------------------------------- Per-product

    private void RenderProductPnL(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/Per-Product P&L/ProductText");
        var startOfSim = new GameDate(2026, 2);
        var now = world.Clock.Now;
        var report = world.GetProductProfitability(GameState.PlayerId, startOfSim, now);

        var sb = new StringBuilder();
        sb.AppendLine($"[b]Per-product P&L — {startOfSim} → {now}[/b]");
        sb.AppendLine();

        if (report.Count == 0)
        {
            sb.AppendLine("(no product activity yet)");
            rtl.Text = sb.ToString();
            return;
        }

        sb.AppendLine($"  {"Product",-20} {"Revenue",14} {"COGS",14} {"Marketing",12} {"Net",14} {"%",7}");
        sb.AppendLine(new string('─', 82));

        var rows = report.Values.OrderByDescending(p => p.NetMargin).ToList();
        foreach (var p in rows)
        {
            var pct = p.NetMarginPct == 0m ? "—" : $"{(double)p.NetMarginPct * 100:F1}%";
            sb.AppendLine(
                $"  {p.Product.Value,-20} " +
                $"{p.Revenue.ToString("C0", Money),14} " +
                $"{p.Cost.ToString("C0", Money),14} " +
                $"{p.MarketingCost.ToString("C0", Money),12} " +
                $"{p.NetMargin.ToString("C0", Money),14} " +
                $"{pct,7}");
        }

        rtl.Text = sb.ToString();
    }

    // -------------------------------------------------------- Exports

    private void RenderExports(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/Exports/ExportsText");
        var sb = new StringBuilder();

        // Window: last 12 months, inclusive of current.
        var now = world.Clock.Now;
        var windowStartIdx = now.AsMonthIndex() - 11;

        var exportEntries = world.Ledger.EntriesFor(GameState.PlayerId)
            .Where(e => e.Category == LedgerCategory.ExportSale
                        && e.Date.AsMonthIndex() >= windowStartIdx
                        && e.Date.AsMonthIndex() <= now.AsMonthIndex())
            .ToList();

        sb.AppendLine("[b]Exports — last 12 months[/b]");
        sb.AppendLine();

        if (exportEntries.Count == 0)
        {
            sb.AppendLine("  (no world-market exports in the last 12 months)");
            sb.AppendLine();
            sb.AppendLine("[i]Factories and farms with AutoExport enabled ship surplus inventory to the world market each month at each product's BaseWorldMarketPrice.[/i]");
            rtl.Text = sb.ToString();
            return;
        }

        // Headline totals. Units are reconstructed from revenue / base price.
        decimal totalRevenue = 0m;
        double totalUnits = 0.0;
        foreach (var e in exportEntries)
        {
            totalRevenue += e.Amount;
            if (e.Product is ProductId pid)
            {
                var basePrice = (decimal)world.Catalog.Product(pid).BaseWorldMarketPrice;
                if (basePrice > 0m)
                {
                    totalUnits += (double)(e.Amount / basePrice);
                }
            }
        }

        sb.AppendLine($"  [b]Total export revenue[/b]  {totalRevenue.ToString("C0", Money),20}");
        sb.AppendLine($"  [b]Units shipped[/b]         {totalUnits,20:N1}");
        sb.AppendLine();

        // --- By product
        sb.AppendLine("[b]By product[/b]");
        sb.AppendLine();
        sb.AppendLine($"  {"Product",-20} {"Revenue",14} {"Units",12} {"Avg Price",12}");
        sb.AppendLine(new string('─', 62));

        var byProduct = exportEntries
            .Where(e => e.Product is not null)
            .GroupBy(e => e.Product!.Value)
            .Select(g =>
            {
                var revenue = g.Sum(x => x.Amount);
                var basePrice = (decimal)world.Catalog.Product(g.Key).BaseWorldMarketPrice;
                var units = basePrice > 0m ? (double)(revenue / basePrice) : 0.0;
                var avg = units > 0.0 ? revenue / (decimal)units : 0m;
                return (Product: g.Key, Revenue: revenue, Units: units, AvgPrice: avg);
            })
            .OrderByDescending(r => r.Revenue)
            .ToList();

        foreach (var row in byProduct)
        {
            sb.AppendLine(
                $"  {row.Product.Value,-20} " +
                $"{row.Revenue.ToString("C0", Money),14} " +
                $"{row.Units,12:N1} " +
                $"{row.AvgPrice.ToString("C2", Money),12}");
        }

        sb.AppendLine();

        // --- By building (exporter). Defensive: Phase 3.29 may/may not have
        // populated LedgerEntry.Building. If the property is missing at runtime
        // (reflection-safe) OR no entry has a non-null Building, fall back
        // gracefully and tell the user.
        var buildingProp = typeof(LedgerEntry).GetProperty("Building");
        var hasAnyBuildingAttr = false;
        if (buildingProp is not null)
        {
            foreach (var e in exportEntries)
            {
                if (buildingProp.GetValue(e) is not null)
                {
                    hasAnyBuildingAttr = true;
                    break;
                }
            }
        }

        sb.AppendLine("[b]By exporter (building)[/b]");
        sb.AppendLine();

        if (!hasAnyBuildingAttr)
        {
            sb.AppendLine("  [i]per-building attribution pending Phase 3.29 — export sales don't yet carry a building id; showing by-product totals above.[/i]");
        }
        else
        {
            sb.AppendLine($"  {"Building",-12} {"Type",-18} {"City",-14} {"Revenue",14}");
            sb.AppendLine(new string('─', 62));

            var byBuilding = exportEntries
                .Select(e => (Entry: e, Building: buildingProp!.GetValue(e) as BuildingInstanceId?))
                .Where(x => x.Building is not null)
                .GroupBy(x => x.Building!.Value)
                .Select(g =>
                {
                    var revenue = g.Sum(x => x.Entry.Amount);
                    string typeLabel = "(gone)";
                    string cityLabel = "—";
                    if (world.Buildings.TryGetValue(g.Key, out var inst))
                    {
                        typeLabel = inst.TypeId.Value;
                        cityLabel = inst.City.Value;
                    }
                    return (BuildingId: g.Key, TypeLabel: typeLabel, CityLabel: cityLabel, Revenue: revenue);
                })
                .OrderByDescending(r => r.Revenue)
                .ToList();

            foreach (var row in byBuilding)
            {
                sb.AppendLine(
                    $"  {row.BuildingId.Value,-12} " +
                    $"{Truncate(row.TypeLabel, 18),-18} " +
                    $"{Truncate(row.CityLabel, 14),-14} " +
                    $"{row.Revenue.ToString("C0", Money),14}");
            }
        }

        sb.AppendLine();
        sb.AppendLine("[i]Exports ship at BaseWorldMarketPrice; unit counts are reconstructed from revenue. Only buildings with AutoExport enabled contribute.[/i]");

        rtl.Text = sb.ToString();
    }

    private static string Truncate(string s, int max)
        => s.Length <= max ? s : s.Substring(0, max);

    // -------------------------------------------------------- R&D and Ads

    private void RenderRdAndAds(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/R&D and Ads/RdAdsText");
        var sb = new StringBuilder();

        sb.AppendLine("[b]Research & Development[/b]");
        sb.AppendLine();

        // Tech levels for products the player has ever researched or engaged with.
        var playerProducts = world.Buildings.Values
            .Where(b => b.Owner == GameState.PlayerId)
            .SelectMany(b => b.RetailSlots.Select(s => s.Product)
                .Concat(b.ProductionSlots.Select(s => s.Product))
                .Concat(b.ResearchSlots.Select(s => s.Product)))
            .Distinct()
            .OrderBy(p => p.Value, StringComparer.Ordinal)
            .ToList();

        if (playerProducts.Count == 0)
        {
            sb.AppendLine("  (no products being researched, sold, or produced)");
        }
        else
        {
            sb.AppendLine($"  {"Product",-20} {"Tech",8} {"Progress to next",18}");
            sb.AppendLine(new string('─', 50));
            foreach (var p in playerProducts)
            {
                var tech = world.GetTech(GameState.PlayerId, p);
                var max = world.Catalog.Product(p).MaxTechLevel;
                var progress = world.GetResearchProgress(GameState.PlayerId, p);
                var threshold = tech < max ? SimulationConstants.BaseResearchThreshold * tech : 0;
                var progressText = tech >= max
                    ? "(max)"
                    : $"{progress,5:F0} / {threshold:F0}";
                sb.AppendLine($"  {p.Value,-20} {tech + "/" + max,8} {progressText,18}");
            }
        }

        sb.AppendLine();
        sb.AppendLine("[b]Active Ad Campaigns[/b]");
        sb.AppendLine();

        var campaigns = world.AdCampaigns
            .Where(c => c.Company == GameState.PlayerId)
            .OrderBy(c => c.Product.Value, StringComparer.Ordinal)
            .ThenBy(c => c.City.Value, StringComparer.Ordinal)
            .ToList();

        if (campaigns.Count == 0)
        {
            sb.AppendLine("  (no ad campaigns running)");
        }
        else
        {
            sb.AppendLine($"  {"Product",-16} {"City",-14} {"Channel",-10} {"Budget",12} {"Brand (0-100)",14}");
            sb.AppendLine(new string('─', 70));
            foreach (var c in campaigns)
            {
                var brand = world.GetBrandAwareness(c.Company, c.Product, c.City);
                sb.AppendLine(
                    $"  {c.Product.Value,-16} {c.City.Value,-14} {c.Channel,-10} " +
                    $"{c.MonthlyBudget.ToString("C0", Money),12} {brand,14:F1}");
            }
        }

        rtl.Text = sb.ToString();
    }

    // -------------------------------------------------------- Goals

    private void RenderGoals(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/Goals/GoalsText");
        var sb = new StringBuilder();

        var scenario = GameState.ActiveScenario;
        if (scenario is null || scenario.Goals.Count == 0)
        {
            sb.AppendLine("[b]Goals[/b]");
            sb.AppendLine();
            sb.AppendLine(scenario is null
                ? "  (no active scenario — goals aren't tracked for save-file loads)"
                : "  (this scenario has no victory conditions — sandbox mode)");
            rtl.Text = sb.ToString();
            return;
        }

        sb.AppendLine($"[b]Goals — {scenario.Name}[/b]");
        sb.AppendLine();
        sb.AppendLine($"  [i]{scenario.Description}[/i]");
        sb.AppendLine();

        var evals = ScenarioRunner.EvaluateGoals(world, scenario, GameState.PlayerId);
        var anyIncomplete = false;
        foreach (var e in evals)
        {
            var mark = e.Achieved ? "[color=green][ ✓ ][/color]" : "[color=yellow][   ][/color]";
            var bar = ProgressBar(e.Progress, 30);
            sb.AppendLine($"  {mark} {e.Description}");
            sb.AppendLine($"       {bar}  {e.Detail}");
            sb.AppendLine();
            if (!e.Achieved) anyIncomplete = true;
        }

        sb.AppendLine(anyIncomplete
            ? "[i]Keep playing — some goals aren't met yet.[/i]"
            : "[color=green][b]All goals achieved — scenario won.[/b][/color]");

        rtl.Text = sb.ToString();
    }

    // -------------------------------------------------------- Trends (sparklines)

    private void RenderTrends()
    {
        var container = GetNode<VBoxContainer>("Panel/VBox/Tabs/Trends/TrendsContent");
        foreach (var child in container.GetChildren()) child.QueueFree();

        var history = GameState.History;
        if (history.Count == 0)
        {
            container.AddChild(new Label { Text = "No history yet. Press Play or Advance to collect data." });
            return;
        }

        var first = history[0];
        var last = history[^1];

        container.AddChild(new Label
        {
            Text = $"{history.Count} month(s) captured: {first.Date} → {last.Date}",
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        container.AddChild(BuildTrendRow(
            "Cash",
            history.Select(h => (double)h.Cash).ToList(),
            last.Cash.ToString("C0", Money),
            new Color(0.55f, 0.9f, 1.0f)));

        container.AddChild(BuildTrendRow(
            "Monthly Revenue",
            history.Select(h => (double)h.MonthlyRevenue).ToList(),
            last.MonthlyRevenue.ToString("C0", Money),
            new Color(0.7f, 1.0f, 0.6f)));

        container.AddChild(BuildTrendRow(
            "Monthly Net Income",
            history.Select(h => (double)h.MonthlyNetIncome).ToList(),
            last.MonthlyNetIncome.ToString("C0", Money),
            new Color(1.0f, 0.8f, 0.55f)));

        container.AddChild(BuildTrendRow(
            "Top Brand Awareness (0–100)",
            history.Select(h => h.TopBrand).ToList(),
            last.TopBrand.ToString("F1", Money),
            new Color(0.85f, 0.55f, 1.0f)));

        container.AddChild(BuildTrendRow(
            "Top Tech Level",
            history.Select(h => (double)h.TopTech).ToList(),
            last.TopTech.ToString(Money),
            new Color(1.0f, 0.95f, 0.35f)));
    }

    private static Control BuildTrendRow(string title, IReadOnlyList<double> values, string currentLabel, Color color)
    {
        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);

        var titleLabel = new Label { Text = title };
        titleLabel.AddThemeFontSizeOverride("font_size", 16);
        vbox.AddChild(titleLabel);

        var spark = new Sparkline
        {
            CustomMinimumSize = new Vector2(500, 80),
            LineColor = color,
        };
        spark.SetValues(values);
        vbox.AddChild(spark);

        var detail = new Label
        {
            Text = values.Count > 1
                ? $"Latest: {currentLabel}  ·  min {values.Min():N0}  ·  max {values.Max():N0}"
                : $"Latest: {currentLabel}  (need at least 2 data points to draw a line)",
        };
        vbox.AddChild(detail);

        return vbox;
    }

    // -------------------------------------------------------- helpers

    private static string ProgressBar(double progress, int width)
    {
        var clamped = Math.Max(0.0, Math.Min(1.0, progress));
        var filled = (int)Math.Round(clamped * width);
        return "[" + new string('█', filled) + new string('░', width - filled) + "]";
    }

    private static string PlayerName(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Name : "(unknown)";

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
}
