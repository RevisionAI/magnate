using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Persistence;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>
/// Ruleset-agnostic safety net for Wave 2 (test-map §7.4–7.5): the accounting invariants,
/// determinism and lossless save/load must hold under <em>every</em> preset. Realistic runs on
/// the live content, so content rebalancing and every newly enabled mechanic are exercised here
/// automatically.
/// </summary>
public sealed class RulesetInvariantTests
{
    public static TheoryData<string> Presets => Rulesets.All;

    /// <summary>All 16 scenarios apply and run 24 months with the player on autopilot, invariants green every tick.</summary>
    public static TheoryData<string, string> ScenarioMatrix()
    {
        var data = new TheoryData<string, string>();
        foreach (var preset in new[] { EconomyRules.ClassicPreset, EconomyRules.RealisticPreset })
        {
            var scenarios = preset == EconomyRules.ClassicPreset ? TestContent.ClassicScenarios : TestContent.LiveScenarios;
            foreach (var id in scenarios.Keys.OrderBy(k => k, System.StringComparer.Ordinal))
            {
                data.Add(preset, id);
            }
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(ScenarioMatrix))]
    public void Every_scenario_runs_24_months_with_invariants_green(string preset, string scenarioId)
    {
        var scenarios = preset == EconomyRules.ClassicPreset ? TestContent.ClassicScenarios : TestContent.LiveScenarios;
        var (world, player) = ScenarioRunner.Apply(Rulesets.Catalog(preset), scenarios[scenarioId], seed: 42, Rulesets.Rules(preset));
        world.RegisterAi(player, new AdaptiveStrategy());

        for (var month = 0; month < 24; month++)
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);
        }

        Assert.All(ScenarioRunner.EvaluateGoals(world, scenarios[scenarioId], player), g => Assert.InRange(g.Progress, 0.0, 1.0));
    }

    [Theory]
    [MemberData(nameof(Presets))]
    public void Scripted_chain_with_upgrades_ads_and_research_keeps_the_books(string preset)
    {
        var world = BuildScript(preset);
        for (var month = 0; month < 18; month++)
        {
            if (month == 4) world.UpgradeBuilding(new BuildingInstanceId(4));
            world.AdvanceMonth();
            Invariants.AssertAll(world);
        }
    }

    [Theory]
    [MemberData(nameof(Presets))]
    public void Same_seed_and_script_give_the_same_state(string preset)
    {
        var a = BuildScript(preset);
        var b = BuildScript(preset);
        for (var month = 0; month < 18; month++)
        {
            a.AdvanceMonth();
            b.AdvanceMonth();
        }

        Assert.Equal(StateDigest.Of(a), StateDigest.Of(b));
    }

    [Theory]
    [MemberData(nameof(Presets))]
    public void Save_load_mid_run_is_lossless(string preset)
    {
        var direct = BuildScript(preset);
        for (var month = 0; month < 24; month++) direct.AdvanceMonth();

        var first = BuildScript(preset);
        for (var month = 0; month < 12; month++) first.AdvanceMonth();
        var resumed = WorldLoader.LoadFromString(first.Catalog, WorldSaver.SaveToString(first)).World;
        Assert.Equal(first.Rules, resumed.Rules);
        for (var month = 12; month < 24; month++) resumed.AdvanceMonth();

        Assert.Equal(StateDigest.Of(direct), StateDigest.Of(resumed));
    }

    /// <summary>A vertical soft-drink chain, a satellite store, R&amp;D, TV ads and two AI rivals.</summary>
    private static World BuildScript(string preset)
    {
        var world = Rulesets.World(preset, seed: 42);
        var metropolis = new CityId("metropolis");
        var acme = world.CreateCompany("Acme", 400_000_000m);
        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), metropolis);
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        var sugar = world.Construct(acme.Id, new BuildingTypeId("factory_small"), metropolis);
        world.ConfigureProductionSlot(sugar.Id, 0, new ProductId("sugar"));
        var drinks = world.Construct(acme.Id, new BuildingTypeId("factory_small"), metropolis);
        world.ConfigureProductionSlot(drinks.Id, 0, new ProductId("soft_drink"));
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), metropolis);
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.80m, 1_500_000);
        var riverside = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("riverside"));
        world.ConfigureRetailSlot(riverside.Id, 0, new ProductId("soft_drink"), 1.85m, 600_000);
        var lab = world.Construct(acme.Id, new BuildingTypeId("rd_center"), metropolis);
        world.ConfigureResearchSlot(lab.Id, 0, new ProductId("soft_drink"));
        world.RegisterAdCampaign(acme.Id, new ProductId("soft_drink"), metropolis, AdChannel.TV, 80_000m);

        var rival = world.CreateCompany("RivalCo", 300_000_000m);
        world.RegisterAi(rival.Id, new AdaptiveStrategy());
        var chain = world.CreateCompany("ChainLink", 300_000_000m);
        world.RegisterAi(chain.Id, new VerticalIntegrator());
        return world;
    }
}
