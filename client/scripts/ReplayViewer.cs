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
/// Read-only replay viewer. Scrolls through the currently loaded
/// <see cref="GameState.World"/>'s append-only history month-by-month, aggregating
/// ledger / cogs / transfer log entries into a per-month summary. The sim is never
/// advanced and the world is never mutated. Escape or the Back button returns to
/// Main.tscn. If no save is loaded, shows an empty-state message.
///
/// Phase 3.55: adds per-month COGS + accrual Net Income (alongside the cash-basis
/// NetCash already shown), top-3 per-building NI contributors per month, a
/// cumulative accrual-NI sparkline, and defensive handling of new LedgerCategory
/// members being added in a parallel phase (e.g. Phase 3.54 patent royalties).
/// </summary>
public partial class ReplayViewer : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    private RichTextLabel? _replayText;
    private Label? _subLabel;
    private VBoxContainer? _sparkHost;

    // Reflection-resolved optional LedgerCategory values (Phase 3.54). Null if the
    // engine the client is built against doesn't have these members yet — we then
    // skip the "Royalties" roll-up silently.
    private static readonly LedgerCategory? PatentRoyaltyIncomeCategory =
        TryParseCategory("PatentRoyaltyIncome");
    private static readonly LedgerCategory? PatentRoyaltyExpenseCategory =
        TryParseCategory("PatentRoyaltyExpense");

    public override void _Ready()
    {
        _replayText = GetNode<RichTextLabel>("Panel/VBox/Scroll/ReplayText");
        _subLabel = GetNode<Label>("Panel/VBox/SubLabel");
        _sparkHost = GetNode<VBoxContainer>("Panel/VBox/SparkHost");
        GetNode<Button>("Panel/VBox/HBox/BackButton").Pressed += OnBack;

        ApplyChrome();
        Render();
    }

    public override void _Input(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.Escape })
        {
            OnBack();
        }
    }

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

        _replayText?.AddThemeStyleboxOverride("normal", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.82f),
            new Color(UiChrome.Stroke.R, UiChrome.Stroke.G, UiChrome.Stroke.B, 0.5f),
            radius: 6, marginX: 14, marginY: 12));

        var vbox = GetNode<VBoxContainer>("Panel/VBox");
        var banner = BuildAccentBanner(
            GamePresentation.MarketsArt,
            "Replay the company's month-by-month history — cash, accrual net income, and standout events.",
            UiChrome.Blue);
        vbox.AddChild(banner);
        vbox.MoveChild(banner, 2); // below HeaderLabel + SubLabel
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

    private void Render()
    {
        if (_replayText is null || _subLabel is null || _sparkHost is null) return;

        // Clear any prior sparkline children (cheap; we rebuild on each entry).
        foreach (var child in _sparkHost.GetChildren()) child.QueueFree();

        var world = GameState.World;
        if (world is null)
        {
            _subLabel.Text = "No save loaded.";
            _replayText.Text = "[i]No save loaded. Load a game from the title screen first.[/i]";
            return;
        }

        var playerId = GameState.PlayerId;
        var playerName = world.Companies.TryGetValue(playerId, out var co) ? co.Name : "(unknown)";

        // All player ledger entries (cheap; append-only, small in typical saves).
        var entries = world.Ledger.EntriesFor(playerId).ToList();

        if (entries.Count == 0)
        {
            _subLabel.Text = $"Scenario: {GameState.ScenarioName}  ·  Company: {playerName}";
            _replayText.Text = "[i]No recorded history yet. Start the sim and advance a few months first.[/i]";
            return;
        }

        // Derive window from min/max ledger dates using month index.
        var minIdx = entries.Min(e => e.Date.AsMonthIndex());
        var maxIdx = entries.Max(e => e.Date.AsMonthIndex());
        var startDate = IndexToDate(minIdx);
        var endDate = IndexToDate(maxIdx);

        _subLabel.Text =
            $"Scenario: {GameState.ScenarioName}  ·  Company: {playerName}  ·  {startDate} → {endDate}  ·  {maxIdx - minIdx + 1} month(s)";

        // Group ledger by (Year, Month) for O(entries) partitioning.
        var ledgerByMonth = entries
            .GroupBy(e => e.Date.AsMonthIndex())
            .ToDictionary(g => g.Key, g => g.ToList());

        var cogsByMonth = world.CogsLog.EntriesFor(playerId)
            .GroupBy(e => e.Date.AsMonthIndex())
            .ToDictionary(g => g.Key, g => g.ToList());

        // Build per-month summaries.
        var monthly = new List<MonthSummary>();
        decimal cumulativeCash = 0m;
        decimal cumulativeAccrualNi = 0m;
        for (var idx = minIdx; idx <= maxIdx; idx++)
        {
            ledgerByMonth.TryGetValue(idx, out var monthLedger);
            cogsByMonth.TryGetValue(idx, out var monthCogs);
            var summary = Aggregate(IndexToDate(idx), monthLedger, monthCogs, world, playerId);
            cumulativeCash += summary.NetCash;
            cumulativeAccrualNi += summary.AccrualNetIncome;
            summary = summary with
            {
                CumulativeCash = cumulativeCash,
                CumulativeAccrualNetIncome = cumulativeAccrualNi,
            };
            monthly.Add(summary);
        }

        // Sparklines: cash trajectory (cumulative net cash) AND cumulative accrual NI.
        if (monthly.Count >= 2)
        {
            var cashSpark = new Sparkline
            {
                CustomMinimumSize = new Vector2(500, 60),
                LineColor = new Color(0.55f, 0.9f, 1.0f),
            };
            cashSpark.SetValues(monthly.Select(m => (double)m.CumulativeCash).ToList());
            _sparkHost.AddChild(new Label
            {
                Text = "Cash trajectory (cumulative net from ledger)",
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            _sparkHost.AddChild(cashSpark);

            var latestNi = monthly[^1].CumulativeAccrualNetIncome;
            var niSpark = new Sparkline
            {
                CustomMinimumSize = new Vector2(500, 60),
                LineColor = latestNi >= 0m ? new Color(0.55f, 1.0f, 0.55f) : new Color(1.0f, 0.55f, 0.55f),
            };
            niSpark.SetValues(monthly.Select(m => (double)m.CumulativeAccrualNetIncome).ToList());
            _sparkHost.AddChild(new Label
            {
                Text = "Accrual NI trajectory (cumulative Revenue − COGS − Opex − Ads)",
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            _sparkHost.AddChild(niSpark);
        }

        // Render BBCode month-by-month, oldest first.
        var sb = new StringBuilder();
        foreach (var m in monthly)
        {
            AppendMonth(sb, m);
        }
        _replayText.Text = sb.ToString();
    }

    private static void AppendMonth(StringBuilder sb, MonthSummary m)
    {
        var cashSign = m.NetCash >= 0 ? "+" : "";
        sb.AppendLine($"[b]{m.Date}[/b]");
        sb.AppendLine($"  Revenue        {m.Revenue.ToString("C0", Money),14}");
        sb.AppendLine($"  Expenses       {m.Expenses.ToString("C0", Money),14}  [i](opex + advertising)[/i]");
        sb.AppendLine($"  Net cash       {cashSign}{m.NetCash.ToString("C0", Money),13}");
        sb.AppendLine($"  Goods produced {m.UnitsSold,14:N0}  [i](units leaving inventory)[/i]");
        sb.AppendLine($"  New buildings  {m.NewBuildings,14}");
        sb.AppendLine($"  Ads active     {m.AdCampaignCount,14}");

        // Phase 3.55 — accrual overlay.
        sb.AppendLine($"  COGS           {m.Cogs.ToString("C0", Money),14}  [i](cost basis that left inventory)[/i]");
        if (m.Royalties != 0m)
        {
            sb.AppendLine($"  Royalties      {m.Royalties.ToString("C0", Money),14}  [i](patent royalty income − expense)[/i]");
        }
        var niSign = m.AccrualNetIncome >= 0 ? "+" : "";
        sb.AppendLine($"  Accrual NI     {niSign}{m.AccrualNetIncome.ToString("C0", Money),13}  [i](Revenue − COGS − Opex − Ads{(m.Royalties != 0m ? " + Royalties" : "")})[/i]");

        if (m.UnattributedCogsCount > 0)
        {
            sb.AppendLine($"    [i]({m.UnattributedCogsCount} COGS entr{(m.UnattributedCogsCount == 1 ? "y" : "ies")} without a source building — pre-Phase 3.39 save)[/i]");
        }

        // Per-building NI — top 3 by abs(NI).
        if (m.TopBuildings.Count > 0)
        {
            sb.AppendLine("  Top buildings (by |NI|):");
            foreach (var b in m.TopBuildings)
            {
                var sign = b.NetIncome >= 0 ? "+" : "";
                sb.AppendLine($"    · B{b.BuildingId.Value} [{EscapeBbcode(b.TypeName)} · {EscapeBbcode(b.City.Value)}]  {sign}{b.NetIncome.ToString("C0", Money)}");
            }
        }

        if (m.Noteworthy.Count > 0)
        {
            sb.AppendLine("  Noteworthy:");
            foreach (var note in m.Noteworthy)
            {
                sb.AppendLine($"    · {EscapeBbcode(note)}");
            }
        }
        sb.AppendLine();
    }

    /// <summary>Aggregate a single month's events into a summary row.</summary>
    private static MonthSummary Aggregate(
        GameDate date,
        List<LedgerEntry>? ledger,
        List<CogsEntry>? cogs,
        World world,
        CompanyId playerId)
    {
        decimal revenue = 0m;
        decimal expenses = 0m;
        decimal opex = 0m;
        decimal ads = 0m;
        decimal royalties = 0m;
        decimal netCash = 0m;
        var newBuildings = 0;
        var adCampaignCount = 0;
        var noteworthy = new List<string>();

        // Per-building accrual NI (Revenue − COGS − Opex over entries tagged with Building).
        var perBuilding = new Dictionary<BuildingInstanceId, BuildingContribution>();

        if (ledger is not null)
        {
            foreach (var e in ledger)
            {
                netCash += e.Amount;
                switch (e.Category)
                {
                    case LedgerCategory.ProductSale:
                    case LedgerCategory.ExportSale:
                        revenue += e.Amount;
                        if (e.Building is BuildingInstanceId revB)
                        {
                            Bump(perBuilding, revB).Revenue += e.Amount;
                        }
                        break;
                    case LedgerCategory.OperatingCost:
                        opex += -e.Amount;
                        expenses += -e.Amount;
                        if (e.Building is BuildingInstanceId opB)
                        {
                            Bump(perBuilding, opB).Opex += -e.Amount;
                        }
                        break;
                    case LedgerCategory.AdvertisingCost:
                        ads += -e.Amount;
                        expenses += -e.Amount;
                        adCampaignCount++;
                        break;
                    case LedgerCategory.ConstructionCost:
                        newBuildings++;
                        break;
                }

                // Defensive check for Phase 3.54 patent-royalty categories via reflection-resolved values.
                if (PatentRoyaltyIncomeCategory.HasValue && e.Category == PatentRoyaltyIncomeCategory.Value)
                {
                    royalties += e.Amount; // positive inflow
                }
                else if (PatentRoyaltyExpenseCategory.HasValue && e.Category == PatentRoyaltyExpenseCategory.Value)
                {
                    royalties += e.Amount; // negative outflow (already signed)
                }

                // Noteworthy: any single entry whose magnitude >= $250k.
                if (Math.Abs(e.Amount) >= 250_000m)
                {
                    var label = e.Category.ToString();
                    var product = e.Product is ProductId pid ? $" [{pid.Value}]" : string.Empty;
                    noteworthy.Add($"{label}{product}: {e.Amount.ToString("C0", Money)}");
                }
            }
        }

        double unitsSold = 0.0;
        decimal totalCogs = 0m;
        var unattributedCogs = 0;
        if (cogs is not null)
        {
            foreach (var c in cogs)
            {
                unitsSold += c.Quantity;
                totalCogs += c.Cost;
                if (c.SourceBuilding is BuildingInstanceId srcB)
                {
                    Bump(perBuilding, srcB).Cogs += c.Cost;
                }
                else
                {
                    unattributedCogs++;
                }
            }
        }

        // Accrual NI overlay: Revenue − COGS − Opex − Ads (+/− Royalties if present).
        var accrualNi = revenue - totalCogs - opex - ads + royalties;

        // Top-3 buildings by |NI|, tiebreak by building id ascending (deterministic).
        var top = perBuilding
            .Select(kvp => (Id: kvp.Key, Ni: kvp.Value.Revenue - kvp.Value.Cogs - kvp.Value.Opex))
            .Where(t => t.Ni != 0m)
            .OrderByDescending(t => Math.Abs(t.Ni))
            .ThenBy(t => t.Id.Value)
            .Take(3)
            .Select(t => DescribeBuilding(world, t.Id, t.Ni))
            .ToList();

        return new MonthSummary(
            Date: date,
            Revenue: revenue,
            Expenses: expenses,
            NetCash: netCash,
            Cogs: totalCogs,
            Royalties: royalties,
            AccrualNetIncome: accrualNi,
            UnitsSold: unitsSold,
            NewBuildings: newBuildings,
            AdCampaignCount: adCampaignCount,
            UnattributedCogsCount: unattributedCogs,
            Noteworthy: noteworthy,
            TopBuildings: top,
            CumulativeCash: 0m,
            CumulativeAccrualNetIncome: 0m);
    }

    /// <summary>Resolves a building's display name / city by id; falls back gracefully
    /// if the building was deleted / doesn't exist in the current world snapshot.</summary>
    private static BuildingNi DescribeBuilding(World world, BuildingInstanceId id, decimal ni)
    {
        if (world.Buildings.TryGetValue(id, out var b))
        {
            var typeName = world.Catalog.BuildingType(b.TypeId).Name;
            return new BuildingNi(id, typeName, b.City, ni);
        }
        return new BuildingNi(id, "(unknown)", new CityId("?"), ni);
    }

    private static BuildingContribution Bump(
        Dictionary<BuildingInstanceId, BuildingContribution> map,
        BuildingInstanceId id)
    {
        if (!map.TryGetValue(id, out var contrib))
        {
            contrib = new BuildingContribution();
            map[id] = contrib;
        }
        return contrib;
    }

    private static LedgerCategory? TryParseCategory(string name)
        => Enum.TryParse<LedgerCategory>(name, ignoreCase: false, out var c) ? c : null;

    private static GameDate IndexToDate(int monthIndex)
    {
        // Inverse of GameDate.AsMonthIndex() == Year * 12 + (Month - 1).
        var year = monthIndex / 12;
        var month = (monthIndex % 12) + 1;
        return new GameDate(year, month);
    }

    /// <summary>Defend the RichTextLabel against stray '[' in product / building ids.</summary>
    private static string EscapeBbcode(string s) => s.Replace("[", "[lb]");

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");

    private sealed record MonthSummary(
        GameDate Date,
        decimal Revenue,
        decimal Expenses,
        decimal NetCash,
        decimal Cogs,
        decimal Royalties,
        decimal AccrualNetIncome,
        double UnitsSold,
        int NewBuildings,
        int AdCampaignCount,
        int UnattributedCogsCount,
        IReadOnlyList<string> Noteworthy,
        IReadOnlyList<BuildingNi> TopBuildings,
        decimal CumulativeCash,
        decimal CumulativeAccrualNetIncome);

    private sealed record BuildingNi(
        BuildingInstanceId BuildingId,
        string TypeName,
        CityId City,
        decimal NetIncome);

    /// <summary>Mutable accumulator used while aggregating a single month.</summary>
    private sealed class BuildingContribution
    {
        public decimal Revenue;
        public decimal Cogs;
        public decimal Opex;
    }
}
