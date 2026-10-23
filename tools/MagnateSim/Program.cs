using System;
using System.Globalization;
using System.IO;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Sim;

/// <summary>
/// A headless cockpit for exercising the Magnate simulation without a client.
/// Runs a scripted scenario and prints a monthly P&amp;L table.
/// Usage: <c>magnate-sim [months] [--seed N] [--rules classic|realistic] [--content PATH]</c>
/// </summary>
internal static class Program
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    private static int Main(string[] args)
    {
        var months = 24;
        var seed = 42;
        string? contentPath = null;
        string? scenarioId = null;
        string? savePath = null;
        string? loadPath = null;
        var autoPlayer = false;
        var rules = EconomyRules.Realistic;

        for (var i = 0; i < args.Length; i++)
        {
            var a = args[i];
            switch (a)
            {
                case "--seed" when i + 1 < args.Length:
                    seed = int.Parse(args[++i], CultureInfo.InvariantCulture);
                    break;
                case "--content" when i + 1 < args.Length:
                    contentPath = args[++i];
                    break;
                case "--scenario" when i + 1 < args.Length:
                    scenarioId = args[++i];
                    break;
                case "--save" when i + 1 < args.Length:
                    savePath = args[++i];
                    break;
                case "--load" when i + 1 < args.Length:
                    loadPath = args[++i];
                    break;
                case "--auto-player":
                    autoPlayer = true;
                    break;
                case "--rules" when i + 1 < args.Length:
                    try
                    {
                        rules = EconomyRules.FromPreset(args[++i]);
                    }
                    catch (ArgumentException ex)
                    {
                        Console.Error.WriteLine(ex.Message);
                        return 2;
                    }
                    break;
                case "-h" or "--help":
                    PrintHelp();
                    return 0;
                default:
                    if (int.TryParse(a, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMonths))
                    {
                        months = parsedMonths;
                    }
                    else
                    {
                        Console.Error.WriteLine($"unknown arg: {a}");
                        PrintHelp();
                        return 2;
                    }
                    break;
            }
        }

        contentPath ??= DefaultContentRoot();

        Console.WriteLine($"Loading content from {contentPath}");
        var catalog = ContentLoader.Load(contentPath);
        Console.WriteLine($"Catalog: {catalog.Products.Count} products, {catalog.BuildingTypes.Count} building types, {catalog.Cities.Count} cities.");
        if (loadPath is null) Console.WriteLine($"Rules  : {rules.Preset}");
        Console.WriteLine();

        if (loadPath is not null)
        {
            return RunFromSave(catalog, loadPath, months, savePath);
        }

        if (scenarioId is not null)
        {
            return RunScenario(catalog, contentPath, scenarioId, months, seed, rules, autoPlayer, savePath);
        }

        var world = new World(catalog, seed, new GameDate(2026, 1), rules);

        // --------------------------------------------------------------- scenario
        var acme = world.CreateCompany("Acme Corp", 40_000_000m);

        // Vertically integrated soft-drink chain in Metropolis…
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));

        var sugarPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(sugarPlant.Id, 0, new ProductId("sugar"));

        var drinkPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(drinkPlant.Id, 0, new ProductId("soft_drink"));

        var metStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(metStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 3_000_000);

        // …plus a satellite supermarket in Riverside that will pull soft_drink from
        // the Metropolis chain (inter-city — a ShippingCost line item appears in the P&L).
        var rivStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("riverside"));
        world.ConfigureRetailSlot(rivStore.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 1_500_000);

        // R&D center steadily advancing soft_drink tech. By month ~10 Acme's tech should
        // be well above RivalCo's default, widening the demand-allocation edge.
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, new ProductId("soft_drink"));

        // TV advertising — $100k/mo on soft_drink in Metropolis. Brand awareness climbs
        // toward ~95 over a year with diminishing returns.
        world.RegisterAdCampaign(
            acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV,
            monthlyBudget: 100_000m);

        // AI competitor — RivalCo with the adaptive strategy. It'll build retail,
        // reprice against Acme's stores, run TV ads in contested markets, and build
        // an R&D center once retail is saturated.
        var rival = world.CreateCompany("RivalCo", 30_000_000m);
        world.RegisterAi(rival.Id, new AdaptiveStrategy());

        Console.WriteLine("Scenario:");
        Console.WriteLine("  Acme Corp ($40M) — vertically integrated chain + R&D + satellite store");
        Console.WriteLine("    Metropolis: small farm (sugarcane) → small factory (sugar) → small factory (soft_drink) → supermarket @ $1.80");
        Console.WriteLine("    Riverside : satellite supermarket @ $1.80 (pulls soft_drink from Metropolis — pays inter-city shipping)");
        Console.WriteLine("    R&D       : one research slot advancing soft_drink tech level");
        Console.WriteLine("    TV ads    : $100k/mo for soft_drink in Metropolis (brand builds with saturation)");
        Console.WriteLine($"    construction cost: {(40_000_000m - acme.Cash).ToString("C0", Money)}; cash after build: {acme.Cash.ToString("C0", Money)}");
        Console.WriteLine($"  RivalCo  ($30M) — AI with the adaptive strategy: reprices to undercut, advertises in contested markets, invests in R&D once retail is saturated");
        Console.WriteLine();

        // --------------------------------------------------------------- tick loop
        PrintHeader();

        for (var m = 0; m < months; m++)
        {
            world.AdvanceMonth();
            var date = world.Clock.Now;
            var acmePnl = world.GetIncomeStatement(acme.Id, date, date);
            var rivalPnl = world.GetIncomeStatement(rival.Id, date, date);
            PrintRow(date, acmePnl, rivalPnl, acme.Cash, rival.Cash);
        }

        // --------------------------------------------------------------- summary
        var firstMonth = new GameDate(2026, 2);
        Console.WriteLine();
        Console.WriteLine("────────── Final standings ──────────");
        PrintCompanySummary(world, acme, firstMonth);
        Console.WriteLine();
        PrintCompanySummary(world, rival, firstMonth);
        Console.WriteLine();
        Console.WriteLine("────────── Inventory snapshot ──────────");
        foreach (var building in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            var type = world.Catalog.BuildingType(building.TypeId);
            Console.WriteLine($"{building.Id} ({type.Name}, {building.City}):");
            var entries = building.Inventory.Entries.Where(e => e.Value > 0).OrderBy(e => e.Key.Value).ToList();
            if (entries.Count == 0)
            {
                Console.WriteLine("    (empty)");
                continue;
            }
            foreach (var entry in entries)
            {
                Console.WriteLine($"    {entry.Key,-20} {entry.Value,14:N0}");
            }
        }

        if (savePath is not null)
        {
            WorldSaver.Save(world, savePath);
            Console.WriteLine();
            Console.WriteLine($"Saved world to {savePath}");
        }

        return 0;
    }

    private static void PrintHeader()
    {
        Console.WriteLine($"{"Date",-8} | {"Acme Net",13} | {"Acme Cash",15} | {"RivalCo Net",13} | {"RivalCo Cash",15}");
        Console.WriteLine(new string('─', 79));
    }

    private static void PrintRow(GameDate date, IncomeStatement acmePnl, IncomeStatement rivalPnl, decimal acmeCash, decimal rivalCash)
    {
        Console.WriteLine(
            $"{date,-8} | {acmePnl.NetIncome.ToString("C0", Money),13} | {acmeCash.ToString("C0", Money),15} | " +
            $"{rivalPnl.NetIncome.ToString("C0", Money),13} | {rivalCash.ToString("C0", Money),15}");
    }

    private static void PrintCompanySummary(World world, Company company, GameDate firstMonth)
    {
        var totals = world.GetIncomeStatement(company.Id, firstMonth, world.Clock.Now);
        var buildingCount = world.Buildings.Values.Count(b => b.Owner == company.Id);
        var bs = world.GetBalanceSheet(company.Id);
        var transfers = world.TransferLog.EntriesFor(company.Id).Count();

        Console.WriteLine($"## {company.Name}");
        Console.WriteLine($"   Period            : {firstMonth} → {world.Clock.Now}");
        Console.WriteLine($"   Buildings         : {buildingCount}");
        Console.WriteLine($"   Internal transfers: {transfers}");
        Console.WriteLine();
        PrintProductPositioning(world, company);
        Console.WriteLine($"   Income statement (accrual)");
        Console.WriteLine($"     Revenue           : {totals.Revenue.ToString("C0", Money),20}");
        Console.WriteLine($"     Cost of Goods Sold: {totals.CostOfGoodsSold.ToString("C0", Money),20}");
        Console.WriteLine($"     Gross Profit      : {totals.GrossProfit.ToString("C0", Money),20}");
        Console.WriteLine($"     Operating Expenses: {totals.OperatingExpenses.ToString("C0", Money),20}");
        Console.WriteLine($"     Net Income        : {totals.NetIncome.ToString("C0", Money),20}");
        Console.WriteLine();
        Console.WriteLine($"   Balance sheet (as of {bs.AsOf})");
        Console.WriteLine($"     Cash              : {bs.Cash.ToString("C0", Money),20}");
        Console.WriteLine($"     Inventory @ market: {bs.InventoryValue.ToString("C0", Money),20}");
        Console.WriteLine($"     Buildings @ cost  : {bs.BuildingValue.ToString("C0", Money),20}");
        Console.WriteLine($"     Total assets      : {bs.TotalAssets.ToString("C0", Money),20}");
        Console.WriteLine($"     Liabilities       : {bs.Liabilities.ToString("C0", Money),20}");
        Console.WriteLine($"     Equity            : {bs.Equity.ToString("C0", Money),20}");
        Console.WriteLine();

        var profit = world.GetProductProfitability(company.Id, firstMonth, world.Clock.Now)
            .Values.OrderByDescending(p => p.NetMargin).ToList();
        if (profit.Count > 0)
        {
            Console.WriteLine("   Per-product P&L");
            Console.WriteLine($"     {"Product",-18} {"Revenue",14} {"COGS",14} {"Marketing",13} {"Net",14} {"%",6}");
            foreach (var p in profit)
            {
                var pct = p.NetMarginPct == 0m ? "—" : $"{(double)p.NetMarginPct * 100:F1}%";
                Console.WriteLine(
                    $"     {p.Product.Value,-18} {p.Revenue.ToString("C0", Money),14} {p.Cost.ToString("C0", Money),14} " +
                    $"{p.MarketingCost.ToString("C0", Money),13} {p.NetMargin.ToString("C0", Money),14} {pct,6}");
            }
        }
    }

    private static void PrintHelp()
    {
        Console.WriteLine("magnate-sim — headless simulation cockpit");
        Console.WriteLine();
        Console.WriteLine("Usage: magnate-sim [months] [--scenario id] [--seed N] [--rules classic|realistic] [--content PATH]");
        Console.WriteLine();
        Console.WriteLine("Args:");
        Console.WriteLine("  months          number of months to simulate (default 24)");
        Console.WriteLine("  --scenario id   load and run a scenario from content/scenarios/");
        Console.WriteLine("                  available: sandbox, soft_drink_war, first_hundred_million");
        Console.WriteLine("  --auto-player   (scenario mode) control the player company with AdaptiveStrategy");
        Console.WriteLine("  --save PATH     write the final world state to PATH (JSON) after simulation");
        Console.WriteLine("  --load PATH     resume a previously saved world from PATH");
        Console.WriteLine("  --seed N        RNG seed (default 42)");
        Console.WriteLine("  --rules R       economy ruleset: realistic (default) or classic (the pre-overhaul engine)");
        Console.WriteLine("  --content P     content root (default: auto-detected)");
    }

    private static int RunFromSave(ContentCatalog catalog, string loadPath, int months, string? savePath)
    {
        Console.WriteLine($"Loading saved world from {loadPath}");
        var loadResult = WorldLoader.Load(catalog, loadPath);
        var world = loadResult.World;
        if (loadResult.ScenarioId is not null)
        {
            Console.WriteLine($"  scenario  : {loadResult.ScenarioId}");
        }
        if (loadResult.PlayerId is not null)
        {
            Console.WriteLine($"  player    : company #{loadResult.PlayerId.Value.Value}");
        }
        Console.WriteLine($"Loaded at {world.Clock.Now} — {world.Companies.Count} companies, {world.Buildings.Count} buildings, rules {world.Rules.Preset}.");
        Console.WriteLine();

        if (months > 0)
        {
            Console.WriteLine($"Advancing {months} additional months…");
            for (var m = 0; m < months; m++) world.AdvanceMonth();
            Console.WriteLine($"Now at {world.Clock.Now}.");
            Console.WriteLine();
        }

        foreach (var company in world.Companies.Values.OrderBy(c => c.Id.Value))
        {
            PrintCompanySummary(world, company, new GameDate(world.Clock.Now.Year, Math.Max(1, world.Clock.Now.Month - Math.Min(12, months))));
            Console.WriteLine();
        }

        if (savePath is not null)
        {
            WorldSaver.Save(world, savePath);
            Console.WriteLine($"Saved world to {savePath}");
        }

        return 0;
    }

    private static int RunScenario(ContentCatalog catalog, string contentPath, string scenarioId, int months, int seed, EconomyRules rules, bool autoPlayer, string? savePath)
    {
        var scenariosDir = Path.Combine(contentPath, "scenarios");
        var scenarios = ScenarioLoader.LoadAll(scenariosDir);
        if (!scenarios.TryGetValue(scenarioId, out var scenario))
        {
            Console.Error.WriteLine($"unknown scenario: {scenarioId}");
            Console.Error.WriteLine($"available: {string.Join(", ", scenarios.Keys)}");
            return 2;
        }

        Console.WriteLine($"Scenario: {scenario.Name}");
        Console.WriteLine($"  {scenario.Description}");
        Console.WriteLine();
        Console.WriteLine($"Player : {scenario.Player.Name} (${scenario.Player.StartingCash.ToString("N0", Money)})");
        foreach (var ai in scenario.AiCompetitors)
        {
            Console.WriteLine($"AI     : {ai.Name} (${ai.StartingCash.ToString("N0", Money)}, strategy={ai.Strategy})");
        }
        Console.WriteLine();

        var (world, playerId) = ScenarioRunner.Apply(catalog, scenario, seed, rules);

        if (autoPlayer)
        {
            world.RegisterAi(playerId, new AdaptiveStrategy());
            Console.WriteLine("(--auto-player: the player company is controlled by AdaptiveStrategy for this demo run)");
            Console.WriteLine();
        }

        // Cap months by scenario's endDate if present.
        var effectiveMonths = months;
        if (scenario.EndDate is not null)
        {
            var maxMonths = scenario.EndDate.Value.AsMonthIndex() - scenario.StartDate.AsMonthIndex();
            if (maxMonths < effectiveMonths) effectiveMonths = maxMonths;
        }

        Console.WriteLine($"Running for {effectiveMonths} months (seed {seed})...");
        Console.WriteLine();

        for (var m = 0; m < effectiveMonths; m++)
        {
            world.AdvanceMonth();
        }

        var player = world.Companies[playerId];
        var firstMonth = scenario.StartDate.AddMonth();
        PrintCompanySummary(world, player, firstMonth);

        if (scenario.Goals.Count > 0)
        {
            Console.WriteLine();
            Console.WriteLine("────────── Goal status ──────────");
            var evals = ScenarioRunner.EvaluateGoals(world, scenario, playerId);
            foreach (var e in evals)
            {
                var mark = e.Achieved ? "[✓]" : "[ ]";
                var bar = ProgressBar(e.Progress, width: 20);
                Console.WriteLine($"  {mark} {e.Description}");
                Console.WriteLine($"      {bar}  {e.Detail}");
            }
            var won = evals.All(e => e.Achieved);
            Console.WriteLine();
            Console.WriteLine(won ? "SCENARIO WON" : "Scenario objectives not yet met.");
        }

        if (savePath is not null)
        {
            WorldSaver.Save(world, savePath);
            Console.WriteLine();
            Console.WriteLine($"Saved world to {savePath}");
        }

        return 0;
    }

    private static string ProgressBar(double progress, int width)
    {
        var clamped = Math.Max(0.0, Math.Min(1.0, progress));
        var filled = (int)Math.Round(clamped * width);
        return "[" + new string('█', filled) + new string('░', width - filled) + "]";
    }

    private static void PrintProductPositioning(World world, Company company)
    {
        // Find the company's retail presence for soft_drink (the cockpit flagship product).
        var softDrink = new ProductId("soft_drink");
        var stores = world.Buildings.Values
            .Where(b => b.Owner == company.Id && b.RetailSlots.Any(s => s.Product == softDrink))
            .ToList();
        if (stores.Count == 0) return;

        Console.WriteLine("   Product positioning — soft_drink");
        var currentTech = world.GetTech(company.Id, softDrink);
        var maxTech = world.Catalog.Product(softDrink).MaxTechLevel;
        var progress = world.GetResearchProgress(company.Id, softDrink);
        var thresholdForNext = currentTech < maxTech
            ? $" (progress {progress,5:F0} / {SimulationConstants.BaseResearchThreshold * currentTech:F0} toward level {currentTech + 1})"
            : " (max)";
        Console.WriteLine($"     Tech level        : {currentTech} / {maxTech}{thresholdForNext}");
        foreach (var store in stores)
        {
            var q = store.Inventory.AverageQuality(softDrink);
            var brand = world.GetBrandAwareness(company.Id, softDrink, store.City);
            Console.WriteLine($"     {store.City,-12} @ {store.RetailSlots.First(s => s.Product == softDrink).Price.ToString("C2", Money),8}  Q {q,5:F1}  Brand {brand,5:F1}");
        }
        Console.WriteLine();
    }

    private static string DefaultContentRoot()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
        {
            dir = dir.Parent;
        }

        return dir is null
            ? Path.Combine(Directory.GetCurrentDirectory(), "content")
            : Path.Combine(dir.FullName, "content");
    }
}
