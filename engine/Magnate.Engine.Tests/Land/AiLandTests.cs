using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Xunit;
using Xunit.Abstractions;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// The AI keeps expanding under Realistic land rules through the legacy auto-siting
/// <c>Construct(owner, type, city)</c>: orders are sited on valid plots (or wait for one), nothing
/// throws, sites never overlap, and the books stay closed.
/// </summary>
public sealed class AiLandTests
{
    private readonly ITestOutputHelper _output;

    public AiLandTests(ITestOutputHelper output)
    {
        _output = output;
    }

    public static TheoryData<string> Scenarios()
    {
        var data = new TheoryData<string>();
        foreach (var id in TestContent.LiveScenarios.Keys.OrderBy(k => k, System.StringComparer.Ordinal)) data.Add(id);
        return data;
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void Ai_keeps_building_on_valid_sites_for_four_years(string scenarioId)
    {
        var scenario = TestContent.LiveScenarios[scenarioId];
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 42, EconomyRules.Realistic);
        world.RegisterAi(player, new AdaptiveStrategy());

        for (var month = 1; month <= 48; month++)
        {
            world.AdvanceMonth();
            if (month % 12 == 0) Invariants.AssertAll(world);
        }
        LandWorlds.AssertSitesConsistent(world);

        var all = world.Buildings.Values.ToList();
        var sited = all.Count(b => b.Placement is not null);
        var awaiting = all.Count(b => b.Construction is { AwaitingSite: true });
        var building = all.Count(b => b.Construction is { AwaitingSite: false });
        var operating = all.Count(b => b.IsOperational);
        _output.WriteLine($"{scenarioId}: {all.Count} buildings, {sited} sited, {operating} operating, {building} under construction, {awaiting} awaiting a site");

        Assert.True(sited > 0, "the AI built nothing on a site in four years");
        Assert.True(operating > 0, "no building completed in four years");
        Assert.All(all.Where(b => b.Placement is not null), b => Assert.NotNull(b.SitedAt));
    }

    [Fact]
    public void At_hard_difficulty_the_ai_still_builds_on_good_sites()
    {
        // Integration (E1 x E3b x B2): newGame maps hard difficulty to incumbents x1.4. Valued at an
        // average site no store pays, so every AI sat idle for the whole game; the expansion test
        // now values lines at the location factor of the site the company would actually get.
        var scenario = TestContent.LiveScenarios["four_archetype_melee"];
        var rules = EconomyRules.Realistic with { Market = EconomyRules.Realistic.Market with { IncumbentStrength = 1.4 } };
        var (world, player) = ScenarioRunner.Apply(TestContent.Live, scenario, seed: 42, rules);
        world.RegisterAi(player, new AdaptiveStrategy());
        for (var month = 1; month <= 12; month++) world.AdvanceMonth();
        Invariants.AssertAll(world);
        Assert.All(world.Companies.Values, c => Assert.True(c.OwnedBuildings.Count > 0, $"{c.Name} built nothing in a year"));
    }
}
