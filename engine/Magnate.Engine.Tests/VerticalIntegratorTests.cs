using System.IO;
using System.Linq;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class VerticalIntegratorTests
{
    private static World NewWorld(int seed = 42) => Worlds.Live(seed);

    /// <summary>Classic rules on the frozen Classic content: for tests that pin today's numbers.</summary>
    private static World ClassicWorld(int seed = 42) => Worlds.Classic(seed);

    [Fact]
    public void VerticalIntegrator_builds_retailer_first()
    {
        var world = NewWorld();
        var ai = world.CreateCompany("VI", 30_000_000m);
        world.RegisterAi(ai.Id, new VerticalIntegrator());

        world.AdvanceMonth();

        var retailers = world.Buildings.Values
            .Where(b => b.Owner == ai.Id && b.RetailSlots.Count > 0)
            .ToList();
        Assert.Single(retailers);
        Assert.DoesNotContain(world.Buildings.Values, b => b.Owner == ai.Id && b.ProductionSlots.Count > 0);
    }

    [Fact]
    public void VerticalIntegrator_builds_factory_after_retailer()
    {
        // Month 1 → retailer. Month 2 → factory for the flagship product.
        var world = NewWorld();
        var ai = world.CreateCompany("VI", 300_000_000m);
        world.RegisterAi(ai.Id, new VerticalIntegrator());

        for (var i = 0; i < 2; i++) world.AdvanceMonth();

        var factories = world.Buildings.Values
            .Where(b => b.Owner == ai.Id && b.ProductionSlots.Count > 0)
            .ToList();
        Assert.NotEmpty(factories);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void VerticalIntegrator_builds_full_chain_eventually()
    {
        var world = ClassicWorld();
        var ai = world.CreateCompany("VI", 100_000_000m);
        world.RegisterAi(ai.Id, new VerticalIntegrator());

        for (var i = 0; i < 24; i++) world.AdvanceMonth();

        var owned = world.Buildings.Values.Where(b => b.Owner == ai.Id).ToList();
        Assert.Contains(owned, b => b.RetailSlots.Count > 0);
        Assert.Contains(owned, b => b.ProductionSlots.Count > 0);
        Assert.Contains(owned, b => b.ExtractionSlots.Count > 0);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void VerticalIntegrator_advertises_contested_markets_only()
    {
        // Seed an external competitor in the AI's likely flagship market (bread/metropolis).
        var world = ClassicWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var acmeStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(acmeStore.Id, 0, new ProductId("bread"), price: 3.00m, restockTarget: 500_000);

        var ai = world.CreateCompany("VI", 40_000_000m);
        world.RegisterAi(ai.Id, new VerticalIntegrator(adBudgetPerCity: 40_000m));

        // Month 1: VI builds retailer in bread-metropolis (now contested with Acme).
        // Month 2: contested market → TV campaign registered.
        world.AdvanceMonth();
        world.AdvanceMonth();

        var campaign = world.GetAdCampaign(ai.Id, new ProductId("bread"), new CityId("metropolis"), AdChannel.TV);
        Assert.NotNull(campaign);
        Assert.Equal(40_000m, campaign!.MonthlyBudget);
    }

    [Fact]
    public void VerticalIntegrator_is_deterministic()
    {
        var a = RunVi(seed: 21);
        var b = RunVi(seed: 21);
        Assert.Equal(a, b);
    }

    private static (decimal cash, int buildings) RunVi(int seed)
    {
        var catalog = TestContent.Live;
        var world = new World(catalog, seed, new GameDate(2026, 1));
        var ai = world.CreateCompany("VI", 40_000_000m);
        world.RegisterAi(ai.Id, new VerticalIntegrator());
        for (var i = 0; i < 10; i++) world.AdvanceMonth();
        return (ai.Cash, world.Buildings.Values.Count(b => b.Owner == ai.Id));
    }
}
