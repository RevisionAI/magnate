using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;
using Magnate.Engine.Persistence;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// Long-run regression checks of the Realistic market (econ-audit §6 R1, R8, R15) on live
/// content with every company AI-driven: the AI pricing rules cannot spiral (the old
/// "max rival × 1.3" rule ran prices to 10¹⁰ × in patent_race and tech_titan_clash), the books
/// close every month, nothing explodes, and a mid-run save/load is lossless.
/// </summary>
[Trait("Area", "Market")]
public sealed class EconomyRegressionTests
{
    public static TheoryData<string> SpiralScenarios => new() { "patent_race", "tech_titan_clash" };

    [Theory]
    [MemberData(nameof(SpiralScenarios))]
    public void Ten_years_of_ai_pricing_never_spiral_and_the_books_close_every_month(string scenarioId)
    {
        var scenario = TestContent.LiveScenarios[scenarioId];
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 42, EconomyRules.Realistic);
        world.RegisterAi(player, new AdaptiveStrategy());
        var startingCash = world.Companies.Values.ToDictionary(c => c.Id, c => c.Cash);
        var lastPrice = new Dictionary<(BuildingInstanceId, ProductId), decimal>();
        var maxRatio = 0.0;

        for (var month = 0; month < 120; month++)
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);

            var prices = new Dictionary<(BuildingInstanceId, ProductId), decimal>();
            foreach (var company in world.Companies.Values.OrderBy(c => c.Id.Value))
            {
                foreach (var line in MarketAi.OwnLines(world, company.Id))
                {
                    var product = world.Catalog.Product(line.Product);
                    var reference = MarketAi.ReferencePrice(world, line.Building.City, product);
                    var ratio = (double)(line.Price / reference);
                    maxRatio = Math.Max(maxRatio, ratio);
                    // R8: no retail price above 3 × Pref, ever.
                    Assert.True(ratio <= 3.0, $"{scenarioId} {world.Clock.Now}: {company.Name} prices {line.Product} at {ratio:F2} × Pref");

                    // ±5 %/month at most on a line that traded last month (plus a cent of rounding).
                    var key = (line.Building.Id, line.Product);
                    prices[key] = line.Price;
                    if (lastPrice.TryGetValue(key, out var before))
                    {
                        var move = Math.Abs(line.Price - before);
                        Assert.True(move <= before * 0.05m + 0.01m,
                            $"{scenarioId} {world.Clock.Now}: {company.Name} moved {line.Product} from {before} to {line.Price}");
                    }
                }
            }

            lastPrice.Clear();
            foreach (var kv in prices) lastPrice[kv.Key] = kv.Value;
        }

        // R8 growth sanity: nobody's total assets exceed 50 × its starting cash after ten years,
        // and no company finished with negative cash (no revolver yet: purchases are cash-capped).
        foreach (var company in world.Companies.Values)
        {
            var assets = world.GetBalanceSheet(company.Id).TotalAssets;
            Assert.True(assets <= 50m * Math.Max(1m, startingCash[company.Id]), $"{company.Name}: assets {assets:N0}");
            Assert.True(company.Cash >= 0m, $"{company.Name}: cash {company.Cash:N0}");
        }

        Assert.InRange(maxRatio, 0.5, 2.0);
    }

    [Fact]
    public void An_ai_run_is_deterministic_and_a_mid_run_save_load_is_lossless()
    {
        static World Start()
        {
            var scenario = TestContent.LiveScenarios["tech_titan_clash"];
            var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 7, EconomyRules.Realistic);
            world.RegisterAi(player, new AdaptiveStrategy());
            return world;
        }

        var direct = Start();
        var twin = Start();
        for (var month = 0; month < 48; month++)
        {
            direct.AdvanceMonth();
            twin.AdvanceMonth();
        }

        Assert.Equal(StateDigest.Of(direct), StateDigest.Of(twin));

        var first = Start();
        for (var month = 0; month < 24; month++) first.AdvanceMonth();
        var saved = WorldSaver.SaveToString(first);
        var resumed = WorldLoader.LoadFromString(first.Catalog, saved).World;
        Assert.Equal(saved, WorldSaver.SaveToString(resumed));
        for (var month = 24; month < 48; month++) resumed.AdvanceMonth();

        Assert.Equal(StateDigest.Of(direct), StateDigest.Of(resumed));
        Assert.Equal(WorldSaver.SaveToString(direct), WorldSaver.SaveToString(resumed));
    }
}
