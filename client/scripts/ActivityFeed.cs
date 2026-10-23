using System;
using System.Collections.Generic;
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
/// Streaming activity feed. Derives events from observable state each tick by
/// comparing World against a cached snapshot — no engine hooks. Phase 3.43
/// extends the original feed with:
///   • Filter chips (CheckBoxes) — toggle event categories on/off.
///   • Severity color-coding — dollar amounts colored by magnitude/sign.
///   • Search box — case-insensitive substring match against event text.
///   • Per-month section headers — events grouped under "═══ YYYY-MM — Net $… ═══".
///   • Live-tick refresh — _Process drives the shared sim clock and re-renders.
/// Event sources (in addition to the Phase 3.28 baseline):
///   • Per-ledger entry: Sales / Opex / Construction / Ads / Transfers / Restock.
///   • Internal goods transfers (TransferLog).
///   • Goal achievement, R&amp;D level-up, revenue milestones, month rollover.
/// </summary>
public partial class ActivityFeed : Control
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Cumulative-revenue thresholds that fire a milestone event.</summary>
    private static readonly decimal[] RevenueMilestones =
        { 1_000_000m, 5_000_000m, 25_000_000m, 100_000_000m };

    private const int MaxEntries = 500;

    /// <summary>Filterable categories. Each entry in the feed carries one.</summary>
    private enum FeedCategory
    {
        Sales,
        Opex,
        Construction,
        Ads,
        Research,
        Goals,
        Transfers,
        Milestones,
        MonthClose,
    }

    private static readonly FeedCategory[] AllCategories =
        (FeedCategory[])Enum.GetValues(typeof(FeedCategory));

    private sealed record FeedEntry(
        GameDate Date,
        FeedCategory Category,
        string Text,
        decimal? Amount,
        Color BaseColor);

    // Severity thresholds (per spec).
    private const decimal SmallThreshold = 10_000m;
    private const decimal MediumThreshold = 100_000m;

    // Color palette.
    private static readonly Color ColorPositiveSmall  = new(0.55f, 0.90f, 0.55f);
    private static readonly Color ColorPositiveLarge  = new(0.20f, 0.78f, 0.30f);   // #33C84D-ish
    private static readonly Color ColorNegativeSmall  = new(1.00f, 0.75f, 0.55f);
    private static readonly Color ColorNegativeLarge  = new(0.95f, 0.30f, 0.30f);
    private static readonly Color ColorNeutral        = new(0.78f, 0.78f, 0.78f);
    private static readonly Color ColorMilestone      = new(1.00f, 0.84f, 0.20f);   // gold
    private static readonly Color ColorTech           = new(0.40f, 0.85f, 1.00f);   // cyan
    private static readonly Color ColorMonthHeader    = new(0.85f, 0.85f, 0.55f);

    // Scene refs.
    private RichTextLabel? _feedText;
    private Label? _subLabel;
    private HBoxContainer? _filterRow;
    private LineEdit? _searchEdit;

    // Filter chip state.
    private readonly Dictionary<FeedCategory, CheckBox> _filterButtons = new();
    private readonly HashSet<FeedCategory> _activeCategories = new(AllCategories);
    private string _searchText = string.Empty;

    // Snapshot state (cached on the node; compared each tick).
    private readonly List<FeedEntry> _entries = new();
    private HashSet<int> _knownBuildingIds = new();
    private HashSet<string> _achievedGoals = new();
    private Dictionary<string, int> _lastTech = new();
    private GameDate? _lastDate;
    private decimal _cumulativeRevenue;
    private int _revenueMilestoneIndex;
    private int _lastLedgerCount;
    private int _lastTransferCount;
    private bool _snapshotInitialized;

    public override void _Ready()
    {
        _feedText = GetNode<RichTextLabel>("Panel/VBox/Scroll/FeedText");
        _subLabel = GetNode<Label>("Panel/VBox/SubLabel");
        _filterRow = GetNode<HBoxContainer>("Panel/VBox/FilterRow");
        _searchEdit = GetNode<LineEdit>("Panel/VBox/SearchRow/SearchEdit");
        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;
        GetNode<Button>("Panel/VBox/SearchRow/ClearSearch").Pressed += OnClearSearch;

        ApplyChrome();
        BuildFilterChips();
        _searchEdit.TextChanged += OnSearchChanged;

        InitializeSnapshot();
        Render();
    }

    public override void _Process(double delta)
    {
        // Allow the shared clock to advance while this scene is up.
        GameState.TickIfRunning((float)delta);

        var world = GameState.World;
        if (world is null)
        {
            if (_snapshotInitialized) ResetSnapshot();
            Render();
            return;
        }

        if (!_snapshotInitialized)
        {
            InitializeSnapshot();
            Render();
            return;
        }

        if (DetectEvents(world)) Render();
    }

    // ------------------------------------------------------- chrome

    private void ApplyChrome()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.82f),
            new Color(0.02f, 0.04f, 0.055f, 0.78f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.20f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        header.AddThemeFontSizeOverride("font_size", 30);

        _subLabel?.AddThemeColorOverride("font_color", UiChrome.Muted);

        // Readable plate behind the streaming feed so BBCode stays crisp over art.
        _feedText?.AddThemeStyleboxOverride("normal", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.82f),
            new Color(UiChrome.Stroke.R, UiChrome.Stroke.G, UiChrome.Stroke.B, 0.5f),
            radius: 6, marginX: 14, marginY: 12));

        var vbox = GetNode<VBoxContainer>("Panel/VBox");
        var banner = BuildAccentBanner(
            UiChrome.OperationsBackdrop,
            "Every sale, build, milestone, and month-close as the simulation runs.",
            UiChrome.Blue);
        vbox.AddChild(banner);
        vbox.MoveChild(banner, 2); // sits below HeaderLabel + SubLabel
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

    // ------------------------------------------------------- chip / search UI

    private void BuildFilterChips()
    {
        if (_filterRow is null) return;
        foreach (var cat in AllCategories)
        {
            var cb = new CheckBox
            {
                Text = CategoryLabel(cat),
                ButtonPressed = true,
                Flat = true,
            };
            // Capture loop var.
            var captured = cat;
            cb.Toggled += (bool pressed) => OnFilterToggled(captured, pressed);
            _filterRow.AddChild(cb);
            _filterButtons[cat] = cb;
        }
    }

    private void OnFilterToggled(FeedCategory cat, bool pressed)
    {
        if (pressed) _activeCategories.Add(cat);
        else _activeCategories.Remove(cat);
        Render();
    }

    private void OnSearchChanged(string newText)
    {
        _searchText = newText ?? string.Empty;
        Render();
    }

    private void OnClearSearch()
    {
        if (_searchEdit is null) return;
        _searchEdit.Text = string.Empty;
        _searchText = string.Empty;
        Render();
    }

    private static string CategoryLabel(FeedCategory cat) => cat switch
    {
        FeedCategory.Sales        => "Sales",
        FeedCategory.Opex         => "Opex",
        FeedCategory.Construction => "Construction",
        FeedCategory.Ads          => "Ads",
        FeedCategory.Research     => "R&D",
        FeedCategory.Goals        => "Goals",
        FeedCategory.Transfers    => "Transfers",
        FeedCategory.Milestones   => "Milestones",
        FeedCategory.MonthClose   => "Month",
        _ => cat.ToString(),
    };

    // -------------------------------------------------------- snapshot

    private void InitializeSnapshot()
    {
        _entries.Clear();
        _knownBuildingIds = new HashSet<int>();
        _achievedGoals = new HashSet<string>();
        _lastTech = new Dictionary<string, int>();
        _lastDate = null;
        _cumulativeRevenue = 0m;
        _revenueMilestoneIndex = 0;
        _lastLedgerCount = 0;
        _lastTransferCount = 0;
        _snapshotInitialized = false;

        var world = GameState.World;
        if (world is null) return;

        // Seed known buildings (player only — competitor buildings would be noisy).
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner == GameState.PlayerId)
            {
                _knownBuildingIds.Add(b.Id.Value);
            }
        }

        // Seed cumulative revenue and the next milestone to check.
        _cumulativeRevenue = ComputeCumulativeRevenue(world);
        while (_revenueMilestoneIndex < RevenueMilestones.Length &&
               _cumulativeRevenue >= RevenueMilestones[_revenueMilestoneIndex])
        {
            _revenueMilestoneIndex++;
        }

        // Seed tech levels across every product the player currently touches.
        foreach (var prod in EnumeratePlayerProducts(world))
        {
            _lastTech[prod.Value] = world.GetTech(GameState.PlayerId, prod);
        }

        // Seed already-achieved goals so we don't fire one event per existing goal on first open.
        var scenario = GameState.ActiveScenario;
        if (scenario is not null)
        {
            foreach (var eval in ScenarioRunner.EvaluateGoals(world, scenario, GameState.PlayerId))
            {
                if (eval.Achieved) _achievedGoals.Add(eval.Description);
            }
        }

        // Seed log positions — only entries appended *after* this point become events.
        _lastLedgerCount = world.Ledger.Entries.Count;
        _lastTransferCount = world.TransferLog.Entries.Count;

        _lastDate = world.Clock.Now;
        _snapshotInitialized = true;
    }

    private void ResetSnapshot()
    {
        _entries.Clear();
        _knownBuildingIds.Clear();
        _achievedGoals.Clear();
        _lastTech.Clear();
        _lastDate = null;
        _cumulativeRevenue = 0m;
        _revenueMilestoneIndex = 0;
        _lastLedgerCount = 0;
        _lastTransferCount = 0;
        _snapshotInitialized = false;
    }

    // -------------------------------------------------------- detection

    /// <summary>Compare world to cached snapshot; append any new events. Returns true if anything changed.</summary>
    private bool DetectEvents(World world)
    {
        var changed = false;
        var now = world.Clock.Now;
        var playerId = GameState.PlayerId;

        // --- 1. New buildings (player only).
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != playerId) continue;
            if (_knownBuildingIds.Contains(b.Id.Value)) continue;
            _knownBuildingIds.Add(b.Id.Value);
            var typeName = world.Catalog.BuildingType(b.TypeId).Name;
            AddEntry(new FeedEntry(
                now,
                FeedCategory.Construction,
                $"Building constructed: {typeName} in {b.City.Value}",
                Amount: null,
                BaseColor: ColorMilestone));
            changed = true;
        }

        // --- 2. Per-ledger-entry events (sales, opex, ads, construction cost, restock).
        var ledger = world.Ledger.Entries;
        for (var i = _lastLedgerCount; i < ledger.Count; i++)
        {
            var e = ledger[i];
            if (e.Company != playerId) continue;
            var (cat, baseColor, text) = ClassifyLedger(e, world);
            if (cat is null) continue;
            AddEntry(new FeedEntry(e.Date, cat.Value, text, e.Amount, baseColor));
            changed = true;
        }
        _lastLedgerCount = ledger.Count;

        // --- 3. Internal transfers.
        var transfers = world.TransferLog.Entries;
        for (var i = _lastTransferCount; i < transfers.Count; i++)
        {
            var t = transfers[i];
            if (t.Company != playerId) continue;
            AddEntry(new FeedEntry(
                t.Date,
                FeedCategory.Transfers,
                $"Transfer: {t.Quantity:N0} × {t.Product.Value} (#{t.From.Value} → #{t.To.Value})",
                Amount: null,
                BaseColor: ColorNeutral));
            changed = true;
        }
        _lastTransferCount = transfers.Count;

        // --- 4. Month rollover.
        if (_lastDate is { } prev && now != prev && now > prev)
        {
            var pnl = world.GetIncomeStatement(playerId, now, now);
            var color = pnl.NetIncome >= 0 ? ColorPositiveSmall : ColorNegativeSmall;
            AddEntry(new FeedEntry(
                now,
                FeedCategory.MonthClose,
                "Month closed: net income",
                pnl.NetIncome,
                color));
            changed = true;
        }
        _lastDate = now;

        // --- 5. Revenue milestones.
        var cumulative = ComputeCumulativeRevenue(world);
        _cumulativeRevenue = cumulative;
        while (_revenueMilestoneIndex < RevenueMilestones.Length &&
               cumulative >= RevenueMilestones[_revenueMilestoneIndex])
        {
            var threshold = RevenueMilestones[_revenueMilestoneIndex];
            AddEntry(new FeedEntry(
                now,
                FeedCategory.Milestones,
                $"Revenue milestone: crossed {threshold.ToString("C0", Money)} cumulative",
                Amount: null,
                BaseColor: ColorMilestone));
            _revenueMilestoneIndex++;
            changed = true;
        }

        // --- 6. R&D tech-level increases.
        foreach (var prod in EnumeratePlayerProducts(world))
        {
            var tech = world.GetTech(playerId, prod);
            if (!_lastTech.TryGetValue(prod.Value, out var prior))
            {
                _lastTech[prod.Value] = tech;
                continue;
            }
            if (tech > prior)
            {
                AddEntry(new FeedEntry(
                    now,
                    FeedCategory.Research,
                    $"R&D complete: {prod.Value} tech level {tech}",
                    Amount: null,
                    BaseColor: ColorTech));
                _lastTech[prod.Value] = tech;
                changed = true;
            }
        }

        // --- 7. Goal achievements.
        var scenario = GameState.ActiveScenario;
        if (scenario is not null)
        {
            foreach (var eval in ScenarioRunner.EvaluateGoals(world, scenario, playerId))
            {
                if (!eval.Achieved) continue;
                if (_achievedGoals.Contains(eval.Description)) continue;
                _achievedGoals.Add(eval.Description);
                AddEntry(new FeedEntry(
                    now,
                    FeedCategory.Goals,
                    $"Goal achieved: {eval.Description}",
                    Amount: null,
                    BaseColor: ColorMilestone));
                changed = true;
            }
        }

        return changed;
    }

    /// <summary>Map a ledger entry to a feed category + base color + display text.</summary>
    private static (FeedCategory? Category, Color BaseColor, string Text) ClassifyLedger(LedgerEntry e, World world)
    {
        switch (e.Category)
        {
            case LedgerCategory.ProductSale:
            case LedgerCategory.ExportSale:
            {
                var label = e.Category == LedgerCategory.ExportSale ? "Export sale" : "Sale";
                var prod = e.Product is ProductId p ? $" {p.Value}" : string.Empty;
                return (FeedCategory.Sales, ColorPositiveSmall, $"{label}{prod}");
            }
            case LedgerCategory.OperatingCost:
                return (FeedCategory.Opex, ColorNeutral, "Operating cost");
            case LedgerCategory.AdvertisingCost:
            {
                var prod = e.Product is ProductId p ? $" {p.Value}" : string.Empty;
                return (FeedCategory.Ads, ColorNeutral, $"Ad spend{prod}");
            }
            case LedgerCategory.ConstructionCost:
                return (FeedCategory.Construction, ColorNegativeSmall, "Construction cost");
            case LedgerCategory.InputPurchase:
            {
                var prod = e.Product is ProductId p ? $" {p.Value}" : string.Empty;
                return (FeedCategory.Opex, ColorNegativeSmall, $"Input purchase{prod}");
            }
            case LedgerCategory.RetailRestock:
            {
                var prod = e.Product is ProductId p ? $" {p.Value}" : string.Empty;
                return (FeedCategory.Opex, ColorNegativeSmall, $"Retail restock{prod}");
            }
            case LedgerCategory.ShippingCost:
                return (FeedCategory.Opex, ColorNegativeSmall, "Shipping cost");
            case LedgerCategory.StartingCapital:
                // Skip — fires once at game start, not an "event".
                return (null, ColorNeutral, string.Empty);
            default:
                return (null, ColorNeutral, string.Empty);
        }
    }

    private void AddEntry(FeedEntry entry)
    {
        _entries.Insert(0, entry);
        if (_entries.Count > MaxEntries)
        {
            _entries.RemoveRange(MaxEntries, _entries.Count - MaxEntries);
        }
    }

    // -------------------------------------------------------- helpers

    private static decimal ComputeCumulativeRevenue(World world)
    {
        decimal total = 0m;
        foreach (var entry in world.Ledger.EntriesFor(GameState.PlayerId))
        {
            if (entry.Category == LedgerCategory.ProductSale ||
                entry.Category == LedgerCategory.ExportSale)
            {
                total += entry.Amount;
            }
        }
        return total;
    }

    private static IEnumerable<ProductId> EnumeratePlayerProducts(World world)
    {
        var seen = new HashSet<string>();
        foreach (var b in world.Buildings.Values)
        {
            if (b.Owner != GameState.PlayerId) continue;
            foreach (var s in b.RetailSlots)
            {
                if (seen.Add(s.Product.Value)) yield return s.Product;
            }
            foreach (var s in b.ProductionSlots)
            {
                if (seen.Add(s.Product.Value)) yield return s.Product;
            }
            foreach (var s in b.ResearchSlots)
            {
                if (seen.Add(s.Product.Value)) yield return s.Product;
            }
        }
    }

    /// <summary>
    /// Pick the dollar-amount color from sign + magnitude. Outflows that are
    /// "expected" opex stay neutral grey regardless of size.
    /// </summary>
    private static Color SeverityColor(FeedCategory cat, decimal amount)
    {
        var mag = Math.Abs(amount);
        if (cat == FeedCategory.Opex || cat == FeedCategory.Ads || cat == FeedCategory.Transfers)
        {
            return ColorNeutral;
        }
        if (amount >= 0)
        {
            return mag > MediumThreshold ? ColorPositiveLarge
                 : mag > SmallThreshold  ? ColorPositiveSmall
                                         : ColorNeutral;
        }
        return mag > MediumThreshold ? ColorNegativeLarge
             : mag > SmallThreshold  ? ColorNegativeSmall
                                     : ColorNeutral;
    }

    // -------------------------------------------------------- rendering

    private void Render()
    {
        if (_feedText is null || _subLabel is null) return;

        var world = GameState.World;
        if (world is null)
        {
            _subLabel.Text = "No active game.";
            _feedText.Text = "[i]No active game — start a scenario from the title screen to watch the feed.[/i]";
            return;
        }

        // Filtering pipeline: category chips → search substring.
        var search = _searchText.Trim();
        bool MatchesSearch(FeedEntry e) =>
            search.Length == 0 ||
            e.Text.Contains(search, StringComparison.OrdinalIgnoreCase) ||
            (e.Amount is decimal a && a.ToString("C0", Money).Contains(search, StringComparison.OrdinalIgnoreCase));

        var visible = _entries
            .Where(e => _activeCategories.Contains(e.Category))
            .Where(MatchesSearch)
            .ToList();

        _subLabel.Text = string.Format(
            CultureInfo.InvariantCulture,
            "Scenario: {0}  ·  Date: {1}  ·  {2} of {3} event(s){4}",
            GameState.ScenarioName,
            world.Clock.Now,
            visible.Count,
            _entries.Count,
            search.Length > 0 ? "  ·  filter: \"" + search + "\"" : string.Empty);

        if (visible.Count == 0)
        {
            _feedText.Text = _entries.Count == 0
                ? "[i](no events yet — press Play or Advance to run the simulation)[/i]"
                : "[i](no events match the active filters)[/i]";
            return;
        }

        // Group by (Year, Month) preserving newest-first order.
        var groups = new List<(GameDate Month, List<FeedEntry> Entries)>();
        var byMonth = new Dictionary<int, int>(); // monthIndex -> position in groups
        foreach (var entry in visible)
        {
            var idx = entry.Date.AsMonthIndex();
            if (!byMonth.TryGetValue(idx, out var pos))
            {
                pos = groups.Count;
                byMonth[idx] = pos;
                groups.Add((entry.Date, new List<FeedEntry>()));
            }
            groups[pos].Entries.Add(entry);
        }

        // Compute per-month net cash for the header (across all visible entries with $).
        var sb = new StringBuilder();
        foreach (var (month, monthEntries) in groups)
        {
            decimal monthNet = 0m;
            foreach (var e in monthEntries)
            {
                if (e.Amount is decimal a) monthNet += a;
            }
            sb.Append("[color=");
            sb.Append(ColorHex(ColorMonthHeader));
            sb.Append("][b]═════ ");
            sb.Append(month.Year.ToString("D4", CultureInfo.InvariantCulture));
            sb.Append('-');
            sb.Append(month.Month.ToString("D2", CultureInfo.InvariantCulture));
            sb.Append(" — Net ");
            sb.Append(FormatSignedMoney(monthNet));
            sb.Append(" ═════[/b][/color]");
            sb.AppendLine();

            foreach (var e in monthEntries)
            {
                AppendEntry(sb, e);
            }
            sb.AppendLine();
        }
        _feedText.Text = sb.ToString();
    }

    private static void AppendEntry(StringBuilder sb, FeedEntry e)
    {
        sb.Append("  ");
        sb.Append("[color=");
        sb.Append(ColorHex(e.BaseColor));
        sb.Append(']');
        sb.Append(EscapeBbcode(e.Text));
        sb.Append("[/color]");

        if (e.Amount is decimal amt)
        {
            sb.Append("  ");
            var c = SeverityColor(e.Category, amt);
            sb.Append("[color=");
            sb.Append(ColorHex(c));
            sb.Append("][b]");
            sb.Append(FormatSignedMoney(amt));
            sb.Append("[/b][/color]");
        }
        sb.AppendLine();
    }

    private static string FormatSignedMoney(decimal amount)
    {
        var sign = amount >= 0 ? "+" : string.Empty;
        return sign + amount.ToString("C0", Money);
    }

    private static string ColorHex(Color c)
    {
        var r = (int)Math.Round(c.R * 255);
        var g = (int)Math.Round(c.G * 255);
        var b = (int)Math.Round(c.B * 255);
        return $"#{r:X2}{g:X2}{b:X2}";
    }

    /// <summary>Defend the RichTextLabel against incidental '[' in building / product names.</summary>
    private static string EscapeBbcode(string s) => s.Replace("[", "[lb]");

    // -------------------------------------------------------- nav

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
}
