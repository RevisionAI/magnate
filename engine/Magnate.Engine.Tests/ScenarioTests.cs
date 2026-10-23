using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class ScenarioTests
{
    private static string ScenariosDir() => TestContent.LiveScenariosDir;

    private static ContentCatalog Catalog() => TestContent.Live;

    // ---------------------------------------------------------- Loading

    [Fact]
    public void All_seed_scenarios_load()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        Assert.Contains("sandbox", scenarios.Keys);
        Assert.Contains("soft_drink_war", scenarios.Keys);
        Assert.Contains("first_hundred_million", scenarios.Keys);
    }

    [Fact]
    public void Sandbox_has_no_goals()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        Assert.Empty(scenarios["sandbox"].Goals);
    }

    [Fact]
    public void Soft_drink_war_has_market_share_and_value_goals()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        var scenario = scenarios["soft_drink_war"];
        Assert.Equal(2, scenario.Goals.Count);
        Assert.Contains(scenario.Goals, g => g is MarketShareGoal);
        Assert.Contains(scenario.Goals, g => g is CorporateValueGoal);
    }

    // ---------------------------------------------------------- Runner setup

    [Fact]
    public void Runner_creates_player_and_ai_competitors()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        var (world, playerId) = ScenarioRunner.Apply(Catalog(), scenarios["soft_drink_war"], seed: 42);

        Assert.Equal(3, world.Companies.Count); // 1 player + 2 AIs
        var player = world.Companies[playerId];
        Assert.Equal("Acme Beverages", player.Name);
        Assert.Contains(world.Companies.Values, c => c.Name == "RivalCo");
        Assert.Contains(world.Companies.Values, c => c.Name == "MegaMart");
    }

    [Fact]
    public void Runner_sets_world_clock_to_scenario_start()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        var (world, _) = ScenarioRunner.Apply(Catalog(), scenarios["soft_drink_war"], seed: 1);
        Assert.Equal(new GameDate(2026, 1), world.Clock.Now);
    }

    // ---------------------------------------------------------- GetMarketShare

    [Fact]
    public void Market_share_is_zero_in_city_with_no_retailers()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 10_000_000m);
        Assert.Equal(0, world.GetMarketShare(acme.Id, new ProductId("soft_drink"), new CityId("metropolis")));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Market_share_is_one_when_only_retailer()
    {
        var world = Worlds.Classic();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        Assert.Equal(1.0, world.GetMarketShare(acme.Id, new ProductId("soft_drink"), new CityId("metropolis")));
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Market_share_reflects_softmax_weights_not_just_retailer_count()
    {
        var world = Worlds.Classic();
        var acme = world.CreateCompany("Acme", 20_000_000m);
        var rival = world.CreateCompany("Rival", 20_000_000m);

        var a = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(a.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);
        var b = world.Construct(rival.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(b.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 100_000);

        // Grant Acme a tech + brand edge via setters (Phase 2.2 surface).
        world.SetTech(acme.Id, new ProductId("soft_drink"),
            world.Catalog.Product(new ProductId("soft_drink")).MaxTechLevel);
        world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), 90);

        var acmeShare = world.GetMarketShare(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"));
        var rivalShare = world.GetMarketShare(rival.Id, new ProductId("soft_drink"), new CityId("metropolis"));

        Assert.True(acmeShare > rivalShare);
        Assert.InRange(acmeShare + rivalShare, 0.999, 1.001);
    }

    // ---------------------------------------------------------- Goal evaluation

    [Fact]
    public void Corporate_value_goal_achieved_when_assets_cross_threshold()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 5_000_000m);

        var goal = new CorporateValueGoal("Reach $1M", 1_000_000m);
        Assert.True(goal.Evaluate(world, acme.Id).Achieved);

        var big = new CorporateValueGoal("Reach $10M", 10_000_000m);
        Assert.False(big.Evaluate(world, acme.Id).Achieved);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Market_share_goal_achieved_at_monopoly()
    {
        var world = Worlds.Classic();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("bread"), price: 3.00m, restockTarget: 500_000);

        var goal = new MarketShareGoal("50% bread Metropolis", new ProductId("bread"), new CityId("metropolis"), 0.5);
        Assert.True(goal.Evaluate(world, acme.Id).Achieved);
    }

    [Fact]
    public void Goal_progress_reports_ratio_before_achievement()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 5_000_000m);

        var goal = new CorporateValueGoal("Reach $10M", 10_000_000m);
        var eval = goal.Evaluate(world, acme.Id);

        Assert.False(eval.Achieved);
        Assert.InRange(eval.Progress, 0.49, 0.51); // $5M / $10M
    }

    // ---------------------------------------------------------- End-to-end

    [Fact]
    public void Scenario_run_advances_goals_over_time()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        var (world, playerId) = ScenarioRunner.Apply(Catalog(), scenarios["soft_drink_war"], seed: 7);

        // Build a presence for the player so market-share goal can move.
        var store = world.Construct(playerId, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.70m, restockTarget: 3_000_000);

        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        var evals = ScenarioRunner.EvaluateGoals(world, scenarios["soft_drink_war"], playerId);
        Assert.Equal(2, evals.Count);
        // Player's goal status is non-empty text.
        Assert.All(evals, e => Assert.False(string.IsNullOrWhiteSpace(e.Detail)));
    }

    // ============================================================ Phase 3.6 goals

    [Fact]
    public void Tutorial_scenario_loads_with_eight_goals()
    {
        // E2 retune (UX §7): store, stock, profit, advertise, brand, loan, second line, value.
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        Assert.Contains("tutorial", scenarios.Keys);
        Assert.Equal(8, scenarios["tutorial"].Goals.Count);
    }

    [Fact]
    public void OwnsBuildingOfCategoryGoal_tracks_count()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 20_000_000m);

        var goal = new OwnsBuildingOfCategoryGoal("Build 2 supermarkets", "supermarket", 2);
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);
        Assert.InRange(goal.Evaluate(world, acme.Id).Progress, 0.49, 0.51);

        world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("riverside"));
        Assert.True(goal.Evaluate(world, acme.Id).Achieved);
    }

    [Fact]
    public void ProductRetailedGoal_triggers_when_any_retail_slot_added()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 10_000_000m);

        var goal = new ProductRetailedGoal("Sell soft drinks", new ProductId("soft_drink"));
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 500_000);
        Assert.True(goal.Evaluate(world, acme.Id).Achieved);
    }

    [Fact]
    public void AdCampaignActiveGoal_triggers_only_for_non_zero_budget()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 5_000_000m);

        var goal = new AdCampaignActiveGoal("Run soft_drink ads", new ProductId("soft_drink"));
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        // Zero budget removes campaign — shouldn't count.
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 0m);
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 25_000m);
        Assert.True(goal.Evaluate(world, acme.Id).Achieved);
    }

    [Fact]
    public void ElapsedMonthsGoal_counts_ticks_from_scenario_start()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 5_000_000m);

        var goal = new ElapsedMonthsGoal("3 months", new GameDate(2026, 1), 3);
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        world.AdvanceMonth();
        world.AdvanceMonth();
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        world.AdvanceMonth();
        Assert.True(goal.Evaluate(world, acme.Id).Achieved);
    }

    // ============================================================ Phase 3.11 scenarios

    [Fact]
    public void Multi_city_mogul_loads_with_three_share_goals_and_value_capstone()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        Assert.Contains("multi_city_mogul", scenarios.Keys);
        var scenario = scenarios["multi_city_mogul"];

        Assert.Equal(4, scenario.Goals.Count);
        var shareGoals = scenario.Goals.OfType<MarketShareGoal>().ToList();
        Assert.Equal(3, shareGoals.Count);
        Assert.All(shareGoals, g => Assert.Equal("bread", g.Product.Value));

        var cities = shareGoals.Select(g => g.City.Value).ToHashSet();
        Assert.Contains("metropolis", cities);
        Assert.Contains("riverside", cities);
        Assert.Contains("portbay", cities);

        Assert.Single(scenario.Goals.OfType<CorporateValueGoal>());
        Assert.Equal(2, scenario.AiCompetitors.Count);
    }

    [Fact]
    public void Tech_race_loads_with_research_and_retail_goals()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        Assert.Contains("tech_race", scenarios.Keys);
        var scenario = scenarios["tech_race"];

        Assert.Equal(6, scenario.Goals.Count);

        var rdGoal = Assert.Single(scenario.Goals.OfType<OwnsBuildingOfCategoryGoal>());
        Assert.Equal("rd_center", rdGoal.Category);
        Assert.Equal(2, rdGoal.Count);

        var retailed = scenario.Goals.OfType<ProductRetailedGoal>().ToList();
        Assert.Equal(2, retailed.Count);
        var retailedProducts = retailed.Select(g => g.Product.Value).ToHashSet();
        Assert.Contains("television", retailedProducts);
        Assert.Contains("car", retailedProducts);

        var adGoal = Assert.Single(scenario.Goals.OfType<AdCampaignActiveGoal>());
        Assert.Equal("television", adGoal.Product.Value);

        var shareGoal = Assert.Single(scenario.Goals.OfType<MarketShareGoal>());
        Assert.Equal("television", shareGoal.Product.Value);
        Assert.Equal("metropolis", shareGoal.City.Value);

        Assert.Single(scenario.Goals.OfType<CorporateValueGoal>());
        Assert.Single(scenario.AiCompetitors);
    }

    [Fact]
    public void Phase_3_11_scenarios_use_valid_products_and_cities()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        var catalog = Catalog();
        foreach (var id in new[] { "multi_city_mogul", "tech_race" })
        {
            var scenario = scenarios[id];
            foreach (var goal in scenario.Goals)
            {
                switch (goal)
                {
                    case MarketShareGoal ms:
                        Assert.True(catalog.Products.ContainsKey(ms.Product));
                        Assert.True(catalog.Cities.ContainsKey(ms.City));
                        break;
                    case ProductRetailedGoal pr:
                        Assert.True(catalog.Products.ContainsKey(pr.Product));
                        break;
                    case AdCampaignActiveGoal ac:
                        Assert.True(catalog.Products.ContainsKey(ac.Product));
                        break;
                }
            }
        }
    }

    [Fact]
    public void Phase_3_11_scenarios_runner_applies_cleanly()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());

        var (mogulWorld, mogulPlayer) = ScenarioRunner.Apply(Catalog(), scenarios["multi_city_mogul"], seed: 11);
        Assert.Equal(3, mogulWorld.Companies.Count); // player + 2 AIs
        Assert.Equal("Your Corp", mogulWorld.Companies[mogulPlayer].Name);

        var (techWorld, techPlayer) = ScenarioRunner.Apply(Catalog(), scenarios["tech_race"], seed: 11);
        Assert.Equal(2, techWorld.Companies.Count); // player + 1 AI
        Assert.Equal("NovaTech", techWorld.Companies[techPlayer].Name);
    }

    // ============================================================ Phase 3.13 goals

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void NetIncomeSinceStartGoal_tracks_cumulative()
    {
        // A vertically-integrated soft-drink pipeline that sells at a single retailer.
        // After several months the player should post positive net income — use a
        // threshold small enough that six months of operation crosses it.
        var world = Worlds.Classic();
        var acme = world.CreateCompany("Acme", 20_000_000m);

        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));
        factory.AutoExport = false;

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 500_000);

        var goal = new NetIncomeSinceStartGoal("Earn $100k net", new GameDate(2026, 1), 100_000m);

        // At t=0 no months have elapsed; goal can't be achieved against a positive target.
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        for (var i = 0; i < 12; i++) world.AdvanceMonth();

        var eval = goal.Evaluate(world, acme.Id);
        Assert.InRange(eval.Progress, 0.0, 1.0);
        // Twelve months of a tidy soft_drink operation should clear $100k net comfortably.
        Assert.True(eval.Achieved, $"expected NetIncome goal achieved, got detail: {eval.Detail}");
    }

    [Fact]
    public void TopBrandGoal_triggers_at_threshold()
    {
        var world = new World(Catalog(), 42, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 5_000_000m);

        var goal = new TopBrandGoal("70 brand", new ProductId("soft_drink"), new CityId("metropolis"), 70.0);
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), 50);
        var mid = goal.Evaluate(world, acme.Id);
        Assert.False(mid.Achieved);
        Assert.InRange(mid.Progress, 0.70, 0.72); // 50 / 70

        world.SetBrandAwareness(acme.Id, new ProductId("soft_drink"), new CityId("metropolis"), 72);
        Assert.True(goal.Evaluate(world, acme.Id).Achieved);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void ExportRevenueGoal_tracks_cumulative()
    {
        // A standalone farm with AutoExport on will ship its sugarcane each tick at
        // world-market price, accumulating ExportSale ledger entries.
        var world = Worlds.Classic();
        var acme = world.CreateCompany("Acme", 15_000_000m);

        var farm = world.Construct(acme.Id, new BuildingTypeId("large_farm"), new CityId("metropolis"));
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        Assert.True(farm.AutoExport);

        var goal = new ExportRevenueGoal("Export $50k", new GameDate(2026, 1), 50_000m);
        Assert.False(goal.Evaluate(world, acme.Id).Achieved);

        for (var i = 0; i < 24; i++) world.AdvanceMonth();

        var eval = goal.Evaluate(world, acme.Id);
        Assert.True(eval.Achieved, $"expected ExportRevenue goal achieved, got detail: {eval.Detail}");
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void ConsecutiveProfitableMonthsGoal_counts_streak()
    {
        var world = Worlds.Classic();
        var acme = world.CreateCompany("Acme", 20_000_000m);

        var factory = world.Construct(acme.Id, new BuildingTypeId("factory_small"), new CityId("metropolis"));
        world.ConfigureProductionSlot(factory.Id, 0, new ProductId("soft_drink"));
        factory.AutoExport = false;

        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), price: 1.80m, restockTarget: 500_000);

        var goal = new ConsecutiveProfitableMonthsGoal("6 profitable months", 6);

        // Month 0: no activity yet, streak = 0.
        Assert.Equal(0.0, goal.Evaluate(world, acme.Id).Progress);

        // Run long enough for the pipeline to settle and post positive net income each month.
        for (var i = 0; i < 10; i++) world.AdvanceMonth();

        var eval = goal.Evaluate(world, acme.Id);
        Assert.True(eval.Achieved, $"expected 6-month streak achieved, got detail: {eval.Detail}");
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Monopolist_scenario_loads_with_expected_goal_types()
    {
        var scenarios = TestContent.ClassicScenarios;
        Assert.Contains("monopolist", scenarios.Keys);
        var scenario = scenarios["monopolist"];

        Assert.Equal(4, scenario.Goals.Count);

        var brand = Assert.Single(scenario.Goals.OfType<TopBrandGoal>());
        Assert.Equal("soft_drink", brand.Product.Value);
        Assert.Equal("metropolis", brand.City.Value);
        Assert.Equal(70.0, brand.Threshold);

        var export = Assert.Single(scenario.Goals.OfType<ExportRevenueGoal>());
        Assert.Equal(8_000_000m, export.Amount);
        Assert.Equal(scenario.StartDate, export.StartDate);

        var streak = Assert.Single(scenario.Goals.OfType<ConsecutiveProfitableMonthsGoal>());
        Assert.Equal(24, streak.Months);

        Assert.Single(scenario.Goals.OfType<CorporateValueGoal>());
        Assert.Single(scenario.AiCompetitors);
    }

    [Fact]
    public void Monopolist_scenario_runner_applies_cleanly()
    {
        var scenarios = ScenarioLoader.LoadAll(ScenariosDir());
        var (world, playerId) = ScenarioRunner.Apply(Catalog(), scenarios["monopolist"], seed: 13);

        Assert.Equal(2, world.Companies.Count); // player + 1 AI
        Assert.Equal("Your Corp", world.Companies[playerId].Name);
        Assert.Contains(world.Companies.Values, c => c.Name == "FizzCorp");

        // Goals must evaluate without throwing on a fresh world.
        var evals = ScenarioRunner.EvaluateGoals(world, scenarios["monopolist"], playerId);
        Assert.Equal(4, evals.Count);
    }

    // ============================================================ Phase 3.18 scenarios

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Export_tycoon_scenario_loads_with_single_export_revenue_goal()
    {
        var scenarios = TestContent.ClassicScenarios;
        Assert.Contains("export_tycoon", scenarios.Keys);
        var scenario = scenarios["export_tycoon"];

        Assert.Single(scenario.Goals);
        var export = Assert.IsType<ExportRevenueGoal>(scenario.Goals[0]);
        Assert.Equal(5_000_000m, export.Amount);
        Assert.Equal(scenario.StartDate, export.StartDate);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Brand_monopolist_scenario_loads_with_three_top_brand_goals()
    {
        var scenarios = TestContent.ClassicScenarios;
        Assert.Contains("brand_monopolist", scenarios.Keys);
        var scenario = scenarios["brand_monopolist"];

        Assert.Equal(3, scenario.Goals.Count);
        var brandGoals = scenario.Goals.OfType<TopBrandGoal>().ToList();
        Assert.Equal(3, brandGoals.Count);
        Assert.All(brandGoals, g => Assert.Equal("soft_drink", g.Product.Value));
        Assert.All(brandGoals, g => Assert.Equal(70.0, g.Threshold));

        var cities = brandGoals.Select(g => g.City.Value).ToHashSet();
        Assert.Equal(3, cities.Count);
    }
}
