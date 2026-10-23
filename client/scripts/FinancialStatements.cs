using System;
using System.Globalization;
using System.Linq;
using System.Text;
using Godot;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Detailed financial-statements view: Income Statement (with period selector),
/// Balance Sheet, and a derived Cash Flow statement (operating / investing /
/// financing splits from the append-only ledger). Read-only — closing returns
/// to Main. Matches <see cref="Reports"/>'s programmatic style and safely
/// handles the "no active game" case for standalone scene boots.
/// </summary>
public partial class FinancialStatements : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    /// <summary>The first month the sim ever advances into. Matches <see cref="Reports"/>.</summary>
    private static readonly GameDate SimStart = new(2026, 2);

    private enum Period
    {
        LastMonth,
        LastYear,
        SinceStart,
    }

    private Button? _playButton;
    private OptionButton? _periodOption;
    private Period _period = Period.LastMonth;

    public override void _Ready()
    {
        ApplyChrome();

        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;
        _playButton = GetNode<Button>("Panel/VBox/PlaybackBar/PlayButton");
        _playButton.Pressed += OnTogglePlay;
        GetNode<Button>("Panel/VBox/PlaybackBar/AdvanceButton").Pressed += OnAdvanceOne;

        _periodOption = GetNode<OptionButton>("Panel/VBox/PeriodBar/PeriodOption");
        _periodOption.AddItem("Last month", (int)Period.LastMonth);
        _periodOption.AddItem("Last 12 months", (int)Period.LastYear);
        _periodOption.AddItem("Since start", (int)Period.SinceStart);
        _periodOption.Selected = (int)_period;
        _periodOption.ItemSelected += OnPeriodChanged;

        SyncPlayButtonText();
        WireTooltips();
        RefreshAll();
    }

    /// <summary>
    /// Phase 3.60 — attaches hover tooltips to the stable controls: back button,
    /// playback bar, and the period selector (the one non-obvious control in
    /// this view). Tab labels use Godot's built-in per-tab tooltip API
    /// (<see cref="TabContainer.SetTabTooltip"/>) because <c>TabContainer</c>
    /// doesn't expose per-tab <see cref="Control"/> anchors for the custom
    /// framework. Called once from <see cref="_Ready"/>; content RichTextLabels
    /// re-render every tick but these header controls are stable.
    /// </summary>
    private void WireTooltips()
    {
        Tooltip.Attach(GetNode<Button>("Panel/VBox/BackButton"),
            "[b]Back[/b] to the main menu. Simulation continues to advance in the background while you're in a sub-screen.");

        if (_playButton is not null)
            Tooltip.Attach(_playButton,
                "[b]Play / Pause[/b] — toggles auto-advance. Each real-time second advances one in-game month while playing.");

        Tooltip.Attach(GetNode<Button>("Panel/VBox/PlaybackBar/AdvanceButton"),
            "[b]Advance 1 Month[/b] — steps the simulation forward exactly one month and records a snapshot.");

        if (_periodOption is not null)
            Tooltip.Attach(_periodOption,
                "[b]Period[/b] — Last month, Last 12 months, or Since start. Affects the Income Statement and Cash Flow tabs only; the Balance Sheet is always 'as of now' and ignores this selection.");

        // Tab tooltips via Godot's built-in per-tab API. Scene order:
        // Income Statement (0), Balance Sheet (1), Cash Flow (2).
        var tabs = GetNode<TabContainer>("Panel/VBox/Tabs");
        tabs.SetTabTooltip(0,
            "Accrual P&L for the selected period: Revenue − COGS − OpEx = Net Income, plus gross and net margins.");
        tabs.SetTabTooltip(1,
            "Assets (Cash + Inventory at WAC + Buildings at cost) = Equity, with drilldowns. The books close: Equity = StartingCapital + ΣNetIncome.");
        tabs.SetTabTooltip(2,
            "Operating / Investing / Financing cash flows derived from the append-only ledger, for the selected period.");
    }

    // -------------------------------------------------------- chrome

    /// <summary>
    /// Phase 3.70 — applies the game's visual chrome (operations backdrop, dark
    /// translucent shell, gold header, styled tabs/buttons) over the default-grey
    /// scene. Presentation-only; touches no simulation state and no code node
    /// paths. Replicated locally because <c>UiChrome</c> is shared and owned
    /// elsewhere.
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
        GetNode<Label>("Panel/VBox/PeriodBar/PeriodLabel").AddThemeColorOverride("font_color", UiChrome.Muted);

        StyleTabs(GetNode<TabContainer>("Panel/VBox/Tabs"));
        StyleButton(GetNode<OptionButton>("Panel/VBox/PeriodBar/PeriodOption"));
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
            var empty = "[i]No active game — start a scenario from the title screen to populate financial statements.[/i]";
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Income Statement/IncomeText").Text = empty;
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Balance Sheet/BalanceText").Text = empty;
            GetNode<RichTextLabel>("Panel/VBox/Tabs/Cash Flow/CashFlowText").Text = empty;
            return;
        }

        sub.Text = $"Scenario: {GameState.ScenarioName}  ·  Date: {world.Clock.Now}  ·  Company: {PlayerName(world)}";

        RenderIncomeStatement(world);
        RenderBalanceSheet(world);
        RenderCashFlow(world);
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

    private void OnPeriodChanged(long index)
    {
        _period = (Period)(int)index;
        if (GameState.World is not null)
        {
            RenderIncomeStatement(GameState.World);
            RenderCashFlow(GameState.World);
        }
    }

    // -------------------------------------------------------- Period resolution

    /// <summary>
    /// Resolves the current user-selected period to a (from, toInclusive) range
    /// clamped to the sim start date. "Last month" is just the current month;
    /// "Last 12 months" walks back 11 months (inclusive of the current one);
    /// "Since start" spans <see cref="SimStart"/> through today.
    /// </summary>
    private (GameDate From, GameDate To, string Label) ResolvePeriod(World world)
    {
        var now = world.Clock.Now;
        switch (_period)
        {
            case Period.LastMonth:
                return (now, now, $"Last month — {now}");
            case Period.LastYear:
            {
                var from = now;
                for (var i = 0; i < 11; i++)
                {
                    var prev = PreviousMonth(from);
                    if (prev < SimStart) break;
                    from = prev;
                }
                return (from, now, $"Last 12 months — {from} → {now}");
            }
            case Period.SinceStart:
            default:
                return (SimStart, now, $"Since start — {SimStart} → {now}");
        }
    }

    private static GameDate PreviousMonth(GameDate d)
        => d.Month == 1 ? new GameDate(d.Year - 1, 12) : new GameDate(d.Year, d.Month - 1);

    // -------------------------------------------------------- Income statement

    private void RenderIncomeStatement(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/Income Statement/IncomeText");
        var (from, to, label) = ResolvePeriod(world);
        var stmt = world.GetIncomeStatement(GameState.PlayerId, from, to);

        var sb = new StringBuilder();
        sb.AppendLine("[b]Income Statement (accrual basis)[/b]");
        sb.AppendLine();
        sb.AppendLine($"[b]{label}[/b]");
        sb.AppendLine();
        sb.AppendLine($"  Revenue                {stmt.Revenue.ToString("C0", Money),20}");
        sb.AppendLine($"  Cost of Goods Sold     {stmt.CostOfGoodsSold.ToString("C0", Money),20}");
        sb.AppendLine($"  ─────────────────────────────────────────");
        sb.AppendLine($"  Gross Profit           {stmt.GrossProfit.ToString("C0", Money),20}");
        sb.AppendLine($"  Operating Expenses     {stmt.OperatingExpenses.ToString("C0", Money),20}");
        sb.AppendLine($"  ─────────────────────────────────────────");
        sb.AppendLine($"  [b]Net Income             {stmt.NetIncome.ToString("C0", Money),20}[/b]");
        sb.AppendLine();

        var margin = stmt.Revenue == 0m ? "—" : $"{(double)(stmt.NetIncome / stmt.Revenue) * 100:F1}%";
        var grossMargin = stmt.Revenue == 0m ? "—" : $"{(double)(stmt.GrossProfit / stmt.Revenue) * 100:F1}%";
        sb.AppendLine($"  Gross margin           {grossMargin,20}");
        sb.AppendLine($"  Net margin             {margin,20}");
        sb.AppendLine();
        sb.AppendLine("[i]Revenue sources: product sales + world-market exports[/i]");
        sb.AppendLine("[i]COGS = cost basis of goods that left inventory this period (WAC)[/i]");
        sb.AppendLine("[i]OpEx = building running costs + advertising (period costs)[/i]");

        rtl.Text = sb.ToString();
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
        sb.AppendLine($"  Cash                   {bs.Cash.ToString("C0", Money),20}");
        sb.AppendLine($"  Inventory (at WAC)     {bs.InventoryValue.ToString("C0", Money),20}");
        sb.AppendLine($"  Buildings (at cost)    {bs.BuildingValue.ToString("C0", Money),20}");
        sb.AppendLine($"  ─────────────────────────────────────────");
        sb.AppendLine($"  [b]Total Assets           {bs.TotalAssets.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine("[b]Liabilities[/b]");
        sb.AppendLine($"  (none yet)             {bs.Liabilities.ToString("C0", Money),20}");
        sb.AppendLine($"  ─────────────────────────────────────────");
        sb.AppendLine($"  [b]Total Liabilities      {bs.Liabilities.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine("[b]Equity[/b]");
        sb.AppendLine($"  [b]Total Equity           {bs.Equity.ToString("C0", Money),20}[/b]");
        sb.AppendLine();

        // Composition breakdown
        if (bs.TotalAssets > 0m)
        {
            sb.AppendLine("[b]Asset composition[/b]");
            sb.AppendLine($"  Cash              {(double)(bs.Cash / bs.TotalAssets) * 100,6:F1}%");
            sb.AppendLine($"  Inventory         {(double)(bs.InventoryValue / bs.TotalAssets) * 100,6:F1}%");
            sb.AppendLine($"  Buildings         {(double)(bs.BuildingValue / bs.TotalAssets) * 100,6:F1}%");
            sb.AppendLine();
        }

        // -------- Drill-down: buildings at construction value --------
        var ownedBuildings = world.Buildings.Values
            .Where(b => b.Owner == GameState.PlayerId)
            .OrderBy(b => b.Id.Value)
            .ToList();

        sb.AppendLine("[b]Buildings at construction value[/b]");
        if (ownedBuildings.Count == 0)
        {
            sb.AppendLine("  [i](no buildings owned)[/i]");
        }
        else
        {
            decimal buildingSum = 0m;
            foreach (var b in ownedBuildings)
            {
                var type = world.Catalog.BuildingType(b.TypeId);
                buildingSum += type.ConstructionCost;
                sb.AppendLine(
                    $"  · B{b.Id.Value} · {type.Name} · {b.City.Value} · " +
                    $"{type.ConstructionCost.ToString("C2", Money)}");
            }
            sb.AppendLine($"  ─────────────────────────────────────────");
            sb.AppendLine($"  [b]Sum                    {buildingSum.ToString("C0", Money),20}[/b]");
            if (buildingSum != bs.BuildingValue)
            {
                var diff = bs.BuildingValue - buildingSum;
                sb.AppendLine($"  [i](snapshot diff {diff.ToString("C2", Money)})[/i]");
            }
        }
        sb.AppendLine();

        // -------- Drill-down: inventory by building --------
        sb.AppendLine("[b]Inventory by building[/b]");
        decimal invSum = 0m;
        var anyInventory = false;
        foreach (var b in ownedBuildings)
        {
            var rows = b.Inventory.EntriesWithCost
                .Where(e => e.Quantity > 0 && e.Cost > 0m)
                .OrderBy(e => e.Product.Value, StringComparer.Ordinal)
                .ToList();
            if (rows.Count == 0) continue;
            anyInventory = true;

            var type = world.Catalog.BuildingType(b.TypeId);
            sb.AppendLine($"  [b]B{b.Id.Value}[/b] · {type.Name} · {b.City.Value}");
            foreach (var r in rows)
            {
                var wac = r.Quantity > 0 ? r.Cost / (decimal)r.Quantity : 0m;
                invSum += r.Cost;
                sb.AppendLine(
                    $"    · {r.Product.Value} × {r.Quantity:F0} @ " +
                    $"{wac.ToString("C2", Money)} avg = {r.Cost.ToString("C2", Money)}");
            }
        }
        if (!anyInventory)
        {
            sb.AppendLine("  [i](no inventory on hand)[/i]");
        }
        else
        {
            sb.AppendLine($"  ─────────────────────────────────────────");
            sb.AppendLine($"  [b]Sum                    {invSum.ToString("C0", Money),20}[/b]");
            if (invSum != bs.InventoryValue)
            {
                var diff = bs.InventoryValue - invSum;
                sb.AppendLine($"  [i](snapshot diff {diff.ToString("C2", Money)})[/i]");
            }
        }
        sb.AppendLine();

        // -------- Equity reconciliation --------
        // StartingCapital is recorded as ledger entries (LedgerCategory.StartingCapital).
        // Cumulative NetIncome uses GetIncomeStatement over [SimStart..Now] — authoritative:
        // it sums revenues (ProductSale+ExportSale), subtracts OpEx (OperatingCost+AdvertisingCost),
        // and subtracts COGS from the CogsLog. Balance-sheet movements (InputPurchase,
        // RetailRestock, ShippingCost, ConstructionCost) are intentionally excluded from P&L.
        decimal startingCapital = 0m;
        foreach (var entry in world.Ledger.EntriesFor(GameState.PlayerId))
        {
            if (entry.Category == LedgerCategory.StartingCapital)
            {
                startingCapital += entry.Amount;
            }
        }
        var cumulative = world.GetIncomeStatement(GameState.PlayerId, SimStart, world.Clock.Now);
        var reconciled = startingCapital + cumulative.NetIncome;
        var drift = bs.Equity - reconciled;

        sb.AppendLine("[b]Equity reconciliation[/b]");
        sb.AppendLine($"  Starting capital       {startingCapital.ToString("C2", Money),20}");
        sb.AppendLine($"  + Cumulative net income{cumulative.NetIncome.ToString("C2", Money),20}");
        sb.AppendLine($"  ─────────────────────────────────────────");
        sb.AppendLine($"  Expected equity        {reconciled.ToString("C2", Money),20}");
        sb.AppendLine($"  Reported equity        {bs.Equity.ToString("C2", Money),20}");
        sb.AppendLine($"  [b]Difference             {drift.ToString("C2", Money),20}[/b]");
        if (drift == 0m)
        {
            sb.AppendLine("  [i]The books close: StartingCapital + ΣNetIncome = Equity.[/i]");
        }
        else
        {
            sb.AppendLine("  [i](non-zero drift — books do not close; investigate ledger categorization)[/i]");
        }
        sb.AppendLine();

        sb.AppendLine("[i]Equity = Total Assets − Liabilities. With no debt, equity equals starting capital plus cumulative net income since day one.[/i]");

        rtl.Text = sb.ToString();
    }

    // -------------------------------------------------------- Cash flow (derived)

    /// <summary>
    /// Cash-flow statement derived from the append-only ledger. Categories are
    /// mapped onto the standard operating / investing / financing buckets:
    ///   Operating  — ProductSale, ExportSale, OperatingCost, AdvertisingCost,
    ///                InputPurchase, RetailRestock, ShippingCost
    ///   Investing  — ConstructionCost
    ///   Financing  — StartingCapital
    /// (No loans / dividends yet, so financing is just the initial equity injection.)
    /// </summary>
    private void RenderCashFlow(World world)
    {
        var rtl = GetNode<RichTextLabel>("Panel/VBox/Tabs/Cash Flow/CashFlowText");
        var (from, to, label) = ResolvePeriod(world);

        decimal operating = 0m;
        decimal investing = 0m;
        decimal financing = 0m;

        // Break operating down a bit for readability.
        decimal opInflows = 0m;
        decimal opOutflows = 0m;

        foreach (var entry in world.Ledger.EntriesInRange(GameState.PlayerId, from, to))
        {
            switch (entry.Category)
            {
                case LedgerCategory.ProductSale:
                case LedgerCategory.ExportSale:
                    operating += entry.Amount;
                    opInflows += entry.Amount;
                    break;
                case LedgerCategory.OperatingCost:
                case LedgerCategory.AdvertisingCost:
                case LedgerCategory.InputPurchase:
                case LedgerCategory.RetailRestock:
                case LedgerCategory.ShippingCost:
                    operating += entry.Amount;
                    opOutflows += -entry.Amount;
                    break;
                case LedgerCategory.ConstructionCost:
                    investing += entry.Amount;
                    break;
                case LedgerCategory.StartingCapital:
                    financing += entry.Amount;
                    break;
            }
        }

        var netChange = operating + investing + financing;

        var sb = new StringBuilder();
        sb.AppendLine("[b]Cash Flow Statement (derived from ledger)[/b]");
        sb.AppendLine();
        sb.AppendLine($"[b]{label}[/b]");
        sb.AppendLine();
        sb.AppendLine("[b]Operating activities[/b]");
        sb.AppendLine($"  Cash from sales        {opInflows.ToString("C0", Money),20}");
        sb.AppendLine($"  Cash paid on ops       {(-opOutflows).ToString("C0", Money),20}");
        sb.AppendLine($"  ─────────────────────────────────────────");
        sb.AppendLine($"  [b]Net operating          {operating.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine("[b]Investing activities[/b]");
        sb.AppendLine($"  Construction           {investing.ToString("C0", Money),20}");
        sb.AppendLine($"  [b]Net investing          {investing.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine("[b]Financing activities[/b]");
        sb.AppendLine($"  Equity injections      {financing.ToString("C0", Money),20}");
        sb.AppendLine($"  [b]Net financing          {financing.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine($"  [b]Net change in cash     {netChange.ToString("C0", Money),20}[/b]");
        sb.AppendLine();
        sb.AppendLine("[i]Derived from the append-only ledger. Operating covers trading cash (sales, opex, procurement, freight).[/i]");
        sb.AppendLine("[i]Investing is capex on new buildings. Financing is just starting-capital until loans/dividends land.[/i]");

        rtl.Text = sb.ToString();
    }

    // -------------------------------------------------------- helpers

    private static string PlayerName(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Name : "(unknown)";

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
}
