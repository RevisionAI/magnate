using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Godot;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Phase 3.52 — Statistics Dashboard. Top-level, read-only analytics scene that
/// aggregates cross-scene metrics the player would otherwise have to hunt for:
///
///   1. Header strip    — scenario / date / company / cash / corporate value / current NI
///   2. Corporate value sparkline (full-width) with latest + all-time high/low
///      annotations, drawn from <see cref="GameState.History"/>.
///   3. Market share heatmap (city × product, player's portfolio) colored
///      cool → warm → hot by share.
///   4. R&amp;D leaderboard: for each product the player engages with, a bar of
///      each company's tech level; the player row is flagged with a ▶.
///   5. Brand awareness map: per product, top-5 (city, brand) pairs across all
///      companies.
///   6. Top 5 buildings by revenue (current month; ProductSale + ExportSale).
///   7. Top 5 buildings by opex (current month; OperatingCost).
///
/// Read-only: no engine/state mutation. Live-ticks via
/// <see cref="GameState.TickIfRunning"/> in <see cref="_Process"/>.
/// </summary>
public partial class StatsDashboard : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    // Heatmap palette anchors. Share=0 cool, 0.5 amber, 1.0 hot.
    private static readonly Color HeatCool  = new Color(0.20f, 0.40f, 0.70f);
    private static readonly Color HeatAmber = new Color(0.85f, 0.70f, 0.30f);
    private static readonly Color HeatHot   = new Color(0.85f, 0.30f, 0.30f);

    private RichTextLabel _header = null!;
    private Control _sparklineHost = null!;
    private GridContainer _heatmapHost = null!;
    private RichTextLabel _rdText = null!;
    private RichTextLabel _brandText = null!;
    private RichTextLabel _topRevenueText = null!;
    private RichTextLabel _topOpexText = null!;

    public override void _Ready()
    {
        ApplyChrome();

        _header         = GetNode<RichTextLabel>("Panel/Scroll/VBox/HeaderStrip");
        _sparklineHost  = GetNode<Control>("Panel/Scroll/VBox/SparklineHost");
        _heatmapHost    = GetNode<GridContainer>("Panel/Scroll/VBox/HeatmapHost");
        _rdText         = GetNode<RichTextLabel>("Panel/Scroll/VBox/RDLeaderboardText");
        _brandText      = GetNode<RichTextLabel>("Panel/Scroll/VBox/BrandText");
        _topRevenueText = GetNode<RichTextLabel>("Panel/Scroll/VBox/TopRevenueText");
        _topOpexText    = GetNode<RichTextLabel>("Panel/Scroll/VBox/TopOpexText");

        GetNode<Button>("Panel/Scroll/VBox/BackButton").Pressed += OnBack;
        RefreshAll();
    }

    public override void _Process(double delta)
    {
        if (GameState.TickIfRunning((float)delta))
        {
            RefreshAll();
        }
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");

    // ---------------------------------------------------------------- chrome

    /// <summary>
    /// Phase 3.70 — applies the game's visual chrome (operations backdrop, dark
    /// translucent shell, gold section headers, styled Back button) over the
    /// default-grey scene. Presentation-only; touches no simulation state and no
    /// code node paths. Replicated locally because <c>UiChrome</c> is shared and
    /// owned elsewhere.
    /// </summary>
    private void ApplyChrome()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.86f),
            new Color(0.02f, 0.04f, 0.055f, 0.72f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.12f), new Color(0f, 0f, 0f, 0f), borderWidth: 0));

        InstallShell(panel);

        var head = GetNode<RichTextLabel>("Panel/Scroll/VBox/HeaderStrip");
        head.AddThemeFontSizeOverride("normal_font_size", 16);
        head.AddThemeFontSizeOverride("bold_font_size", 26);
        head.AddThemeColorOverride("default_color", new Color(0.92f, 0.95f, 0.97f));

        GetNode<Label>("Panel/Scroll/VBox/HeatmapLabel")
            .AddThemeColorOverride("font_color", UiChrome.Gold);

        StyleButton(GetNode<Button>("Panel/Scroll/VBox/BackButton"));
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
            new Color(0.035f, 0.060f, 0.075f, 0.68f),
            new Color(0.50f, 0.70f, 0.78f, 0.32f),
            radius: 8, marginX: 0, marginY: 0));
        panel.AddChild(shell);
        panel.MoveChild(shell, 2);
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

    // ---------------------------------------------------------------- refresh

    private void RefreshAll()
    {
        var world = GameState.World;
        if (world is null)
        {
            _header.Text = "[b]Statistics Dashboard[/b]\nNo active game — start a scenario from the title screen.";
            ClearSparkline();
            ClearHeatmap();
            _rdText.Text = "";
            _brandText.Text = "";
            _topRevenueText.Text = "";
            _topOpexText.Text = "";
            return;
        }

        RenderHeader(world);
        RenderSparkline();
        RenderHeatmap(world);
        RenderRdLeaderboard(world);
        RenderBrandMap(world);
        RenderTopBuildingsByRevenue(world);
        RenderTopBuildingsByOpex(world);
    }

    // ---------------------------------------------------------------- header

    private void RenderHeader(World world)
    {
        var hasPlayer  = world.Companies.TryGetValue(GameState.PlayerId, out var playerCo);
        var playerName = hasPlayer ? playerCo!.Name : "(unknown)";
        var cash       = hasPlayer ? playerCo!.Cash : 0m;
        var bs         = world.GetBalanceSheet(GameState.PlayerId);
        var now        = world.Clock.Now;
        var pnl        = world.GetIncomeStatement(GameState.PlayerId, now, now);

        var sb = new StringBuilder();
        sb.Append("[b]Statistics Dashboard[/b]\n");
        sb.Append($"Scenario: [b]{GameState.ScenarioName}[/b]  ·  ");
        sb.Append($"Date: [b]{now}[/b]  ·  ");
        sb.Append($"Company: [b]{playerName}[/b]\n");
        sb.Append($"Cash: [b]{cash.ToString("C0", Money)}[/b]  ·  ");
        sb.Append($"Corporate Value: [b]{bs.TotalAssets.ToString("C0", Money)}[/b]  ·  ");
        var niColor = pnl.NetIncome >= 0 ? "green" : "red";
        sb.Append($"Net Income (this month): [color={niColor}][b]{pnl.NetIncome.ToString("C0", Money)}[/b][/color]");
        _header.Text = sb.ToString();
    }

    // ---------------------------------------------------------------- sparkline

    private void ClearSparkline()
    {
        foreach (var child in _sparklineHost.GetChildren()) child.QueueFree();
    }

    private void RenderSparkline()
    {
        ClearSparkline();

        var history = GameState.History;
        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 12);

        var title = new Label { Text = "Corporate Value" };
        title.AddThemeFontSizeOverride("font_size", 15);
        title.CustomMinimumSize = new Vector2(160, 0);

        var spark = new Sparkline
        {
            CustomMinimumSize = new Vector2(200, 60),
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            LineColor = new Color(0.65f, 0.95f, 0.65f),
        };

        var annotation = new Label { Text = "" };
        annotation.CustomMinimumSize = new Vector2(320, 0);
        annotation.HorizontalAlignment = HorizontalAlignment.Right;

        if (history.Count == 0)
        {
            annotation.Text = "(no history yet — press Play)";
        }
        else
        {
            // Phase 3.63: plot the CorporateValue column recorded each tick
            // (Cash + Inventory + Buildings + 10 × NI over trailing 12 months).
            // Pre-3.63 snapshots default to 0, so in a long-running session
            // the curve ramps up from zero until every snapshot has been
            // re-recorded — acceptable given History is in-memory only.
            var values = history.Select(h => (double)h.CorporateValue).ToList();
            spark.SetValues(values);

            var latest = values[^1];
            var hi     = values.Max();
            var lo     = values.Min();

            // Optional CV vs cash delta — highlights how much of CV is non-cash
            // (inventory, buildings, capitalised earnings).
            var latestCash = (double)history[^1].Cash;
            var delta = latest - latestCash;
            var deltaSign = delta >= 0 ? "+" : "−";
            var deltaText = Math.Abs(delta).ToString("C0", Money);

            annotation.Text =
                $"CV  latest: {latest.ToString("C0", Money)}" +
                $"  ·  high: {hi.ToString("C0", Money)}" +
                $"  ·  low: {lo.ToString("C0", Money)}" +
                $"  ·  vs cash: {deltaSign}{deltaText}" +
                $"  ({history.Count} mo)";
        }

        row.AddChild(title);
        row.AddChild(spark);
        row.AddChild(annotation);
        _sparklineHost.AddChild(row);
    }

    // ---------------------------------------------------------------- heatmap

    private void ClearHeatmap()
    {
        foreach (var child in _heatmapHost.GetChildren()) child.QueueFree();
        _heatmapHost.Columns = 1;
        _heatmapHost.AddChild(new Label { Text = "(no active game)" });
    }

    private void RenderHeatmap(World world)
    {
        foreach (var child in _heatmapHost.GetChildren()) child.QueueFree();

        // Player's portfolio = distinct products sold in any of their retail slots.
        var playerProducts = world.Buildings.Values
            .Where(b => b.Owner == GameState.PlayerId)
            .SelectMany(b => b.RetailSlots.Select(s => s.Product))
            .Distinct()
            .OrderBy(p => p.Value, StringComparer.Ordinal)
            .ToList();

        var cities = world.Catalog.Cities.Values
            .OrderBy(ci => ci.Id.Value, StringComparer.Ordinal)
            .ToList();

        if (playerProducts.Count == 0)
        {
            _heatmapHost.Columns = 1;
            _heatmapHost.AddChild(new Label
            {
                Text = "(build a retailer and stock a product to populate the market-share heatmap)"
            });
            return;
        }

        _heatmapHost.Columns = playerProducts.Count + 1;

        // Header row: corner + product names.
        _heatmapHost.AddChild(HeatmapHeaderCell(""));
        foreach (var p in playerProducts)
        {
            _heatmapHost.AddChild(HeatmapHeaderCell(world.Catalog.Products.TryGetValue(p, out var prod)
                ? prod.Name : p.Value));
        }

        foreach (var city in cities)
        {
            _heatmapHost.AddChild(HeatmapHeaderCell(city.Name));
            foreach (var product in playerProducts)
            {
                var share = world.GetMarketShare(GameState.PlayerId, product, city.Id);
                _heatmapHost.AddChild(HeatmapShareCell(share));
            }
        }
    }

    private static Control HeatmapHeaderCell(string text)
    {
        var panel = new PanelContainer();
        panel.CustomMinimumSize = new Vector2(88, 28);
        var label = new Label
        {
            Text = text,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        label.AddThemeFontSizeOverride("font_size", 12);
        panel.AddChild(label);
        return panel;
    }

    private static Control HeatmapShareCell(double share)
    {
        var clamped = Math.Clamp(share, 0.0, 1.0);
        var color = InterpolateHeat(clamped);
        var panel = new PanelContainer();
        panel.CustomMinimumSize = new Vector2(88, 28);

        // Background strip via ColorRect layered underneath the label.
        var bg = new ColorRect
        {
            Color = color,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsVertical = Control.SizeFlags.ExpandFill,
        };
        panel.AddChild(bg);

        var label = new Label
        {
            Text = clamped > 0 ? $"{clamped * 100:F0}%" : "—",
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        label.AddThemeFontSizeOverride("font_size", 12);
        // Dark text on bright cells, light text on cool cells for contrast.
        label.Modulate = clamped > 0.35 ? new Color(0.08f, 0.08f, 0.10f) : new Color(0.95f, 0.95f, 0.95f);
        panel.AddChild(label);

        return panel;
    }

    private static Color InterpolateHeat(double t)
    {
        if (t <= 0.5)
        {
            var s = (float)(t / 0.5);
            return HeatCool.Lerp(HeatAmber, s);
        }
        else
        {
            var s = (float)((t - 0.5) / 0.5);
            return HeatAmber.Lerp(HeatHot, s);
        }
    }

    // ---------------------------------------------------------------- R&D leaderboard

    private void RenderRdLeaderboard(World world)
    {
        var sb = new StringBuilder();
        sb.Append("[b]R&D Leaderboard[/b]\n\n");

        // Products the player engages with (retail, production, research).
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
            sb.Append("(no products engaged yet)\n");
            _rdText.Text = sb.ToString();
            return;
        }

        // All companies, ordinal for determinism.
        var companies = world.Companies.Values
            .OrderBy(c => c.Id.Value)
            .ToList();

        sb.Append("[code]");
        foreach (var product in playerProducts)
        {
            var prod = world.Catalog.Products.TryGetValue(product, out var p) ? p : null;
            var productLabel = prod?.Name ?? product.Value;
            var max = prod?.MaxTechLevel ?? 10;
            sb.Append($"\n[b]{productLabel}[/b]  (max tech {max})\n");

            // Build (company, tech) pairs, order by tech desc.
            var rows = companies
                .Select(c => (Company: c, Tech: world.GetTech(c.Id, product)))
                .OrderByDescending(r => r.Tech)
                .ThenBy(r => r.Company.Id.Value)
                .ToList();

            foreach (var row in rows)
            {
                var marker = row.Company.Id.Equals(GameState.PlayerId) ? "▶ " : "  ";
                var bar = TechBar(row.Tech, max, 20);
                var name = Truncate(row.Company.Name, 18);
                sb.Append($"{marker}{name,-18} {bar} {row.Tech}/{max}\n");
            }
        }
        sb.Append("[/code]");
        _rdText.Text = sb.ToString();
    }

    private static string TechBar(int level, int max, int width)
    {
        if (max <= 0) return new string('░', width);
        var filled = (int)Math.Round((double)level / max * width);
        filled = Math.Clamp(filled, 0, width);
        return "[" + new string('█', filled) + new string('░', width - filled) + "]";
    }

    // ---------------------------------------------------------------- brand awareness map

    private void RenderBrandMap(World world)
    {
        var sb = new StringBuilder();
        sb.Append("[b]Brand Awareness Map[/b] — top 5 (city, brand) per product\n\n");

        // Products the player sells retail — same portfolio as the heatmap.
        var playerProducts = world.Buildings.Values
            .Where(b => b.Owner == GameState.PlayerId)
            .SelectMany(b => b.RetailSlots.Select(s => s.Product))
            .Distinct()
            .OrderBy(p => p.Value, StringComparer.Ordinal)
            .ToList();

        if (playerProducts.Count == 0)
        {
            sb.Append("(no retail products — nothing to measure brand awareness for)");
            _brandText.Text = sb.ToString();
            return;
        }

        var cities = world.Catalog.Cities.Values
            .OrderBy(c => c.Id.Value, StringComparer.Ordinal)
            .ToList();
        var companies = world.Companies.Values
            .OrderBy(c => c.Id.Value)
            .ToList();

        sb.Append("[code]");
        foreach (var product in playerProducts)
        {
            var prodName = world.Catalog.Products.TryGetValue(product, out var p) ? p.Name : product.Value;
            sb.Append($"\n[b]{prodName}[/b]\n");

            var rows = new List<(string CompanyName, string CityName, double Brand, bool IsPlayer)>();
            foreach (var city in cities)
            {
                foreach (var co in companies)
                {
                    var b = world.GetBrandAwareness(co.Id, product, city.Id);
                    if (b <= 0) continue;
                    rows.Add((co.Name, city.Name, b, co.Id.Equals(GameState.PlayerId)));
                }
            }

            if (rows.Count == 0)
            {
                sb.Append("  (no brand awareness yet)\n");
                continue;
            }

            var top5 = rows.OrderByDescending(r => r.Brand).Take(5).ToList();
            foreach (var r in top5)
            {
                var marker = r.IsPlayer ? "▶ " : "  ";
                var name = Truncate(marker + r.CompanyName, 22);
                sb.Append($"{name,-22} {Truncate(r.CityName, 14),-14} {r.Brand,6:F1} / 100\n");
            }
        }
        sb.Append("[/code]");
        _brandText.Text = sb.ToString();
    }

    // ---------------------------------------------------------------- top 5 buildings

    private void RenderTopBuildingsByRevenue(World world)
    {
        var sb = new StringBuilder();
        sb.Append("[b]Top 5 Buildings by Revenue (current month)[/b]\n\n");

        var now = world.Clock.Now;
        var nowIdx = now.AsMonthIndex();

        var entries = world.Ledger.EntriesFor(GameState.PlayerId)
            .Where(e => e.Date.AsMonthIndex() == nowIdx
                     && (e.Category == LedgerCategory.ProductSale || e.Category == LedgerCategory.ExportSale)
                     && e.Building is not null)
            .ToList();

        var grouped = entries
            .GroupBy(e => e.Building!.Value)
            .Select(g => (BuildingId: g.Key, Revenue: g.Sum(x => x.Amount)))
            .OrderByDescending(r => r.Revenue)
            .Take(5)
            .ToList();

        if (grouped.Count == 0)
        {
            sb.Append("(no product or export sales recorded this month)\n");
            _topRevenueText.Text = sb.ToString();
            return;
        }

        sb.Append("[code]");
        sb.Append($"{"Building",-14}{"Type",-18}{"City",-14}{"Revenue",14}\n");
        sb.Append(new string('─', 60));
        sb.Append('\n');
        foreach (var row in grouped)
        {
            string typeLabel = "(gone)";
            string cityLabel = "—";
            if (world.Buildings.TryGetValue(row.BuildingId, out var inst))
            {
                typeLabel = inst.TypeId.Value;
                cityLabel = inst.City.Value;
            }
            sb.Append(
                $"{row.BuildingId.Value,-14}" +
                $"{Truncate(typeLabel, 18),-18}" +
                $"{Truncate(cityLabel, 14),-14}" +
                $"{row.Revenue.ToString("C0", Money),14}\n");
        }
        sb.Append("[/code]");
        _topRevenueText.Text = sb.ToString();
    }

    private void RenderTopBuildingsByOpex(World world)
    {
        var sb = new StringBuilder();
        sb.Append("[b]Top 5 Buildings by Opex (current month)[/b]\n\n");

        var now = world.Clock.Now;
        var nowIdx = now.AsMonthIndex();

        // OperatingCost entries are negative (outflow); compare by absolute value.
        var entries = world.Ledger.EntriesFor(GameState.PlayerId)
            .Where(e => e.Date.AsMonthIndex() == nowIdx
                     && e.Category == LedgerCategory.OperatingCost
                     && e.Building is not null)
            .ToList();

        var grouped = entries
            .GroupBy(e => e.Building!.Value)
            .Select(g => (BuildingId: g.Key, Opex: -g.Sum(x => x.Amount))) // flip to positive
            .OrderByDescending(r => r.Opex)
            .Take(5)
            .ToList();

        if (grouped.Count == 0)
        {
            sb.Append("(no operating costs recorded this month)\n");
            _topOpexText.Text = sb.ToString();
            return;
        }

        sb.Append("[code]");
        sb.Append($"{"Building",-14}{"Type",-18}{"City",-14}{"Opex",14}\n");
        sb.Append(new string('─', 60));
        sb.Append('\n');
        foreach (var row in grouped)
        {
            string typeLabel = "(gone)";
            string cityLabel = "—";
            if (world.Buildings.TryGetValue(row.BuildingId, out var inst))
            {
                typeLabel = inst.TypeId.Value;
                cityLabel = inst.City.Value;
            }
            sb.Append(
                $"{row.BuildingId.Value,-14}" +
                $"{Truncate(typeLabel, 18),-18}" +
                $"{Truncate(cityLabel, 14),-14}" +
                $"{row.Opex.ToString("C0", Money),14}\n");
        }
        sb.Append("[/code]");
        _topOpexText.Text = sb.ToString();
    }

    // ---------------------------------------------------------------- helpers

    private static string Truncate(string s, int max)
        => s.Length <= max ? s : s.Substring(0, Math.Max(0, max - 1)) + "…";
}
