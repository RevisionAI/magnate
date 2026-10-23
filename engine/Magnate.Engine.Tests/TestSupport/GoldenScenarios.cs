using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Magnate.Engine.Ai;
using Magnate.Engine.Domain;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Tests.TestSupport;

/// <summary>
/// The scripted runs behind the Classic golden masters (test-map §7.4 step 0). Every run uses
/// the frozen Classic content fixture and Classic rules, so neither content rebalancing nor
/// Realistic features can move them. A run's output is a monthly cash trail followed by the full
/// <see cref="StateDigest"/> of the final world.
/// </summary>
public static class GoldenScenarios
{
    private static readonly CityId Metropolis = new("metropolis");
    private static readonly CityId Riverside = new("riverside");
    private static readonly CityId Eastside = new("eastside");

    private static readonly ProductId SoftDrink = new("soft_drink");
    private static readonly ProductId Bread = new("bread");
    private static readonly ProductId Television = new("television");
    private static readonly ProductId Car = new("car");

    /// <summary>All golden runs, in a stable order.</summary>
    public static IReadOnlyList<GoldenScenario> All { get; } = new[]
    {
        new GoldenScenario("cockpit_24", 24, Cockpit),
        new GoldenScenario("soft_drink_war_auto_24", 24, () => AutoPlayerScenario("soft_drink_war", 42)),
        new GoldenScenario("soft_drink_war_auto_60", 60, () => AutoPlayerScenario("soft_drink_war", 42)),
        new GoldenScenario("vertical_showdown_auto_48", 48, () => AutoPlayerScenario("vertical_showdown", 42)),
        new GoldenScenario("four_archetype_melee_auto_60", 60, () => AutoPlayerScenario("four_archetype_melee", 42)),
        new GoldenScenario("patents_licensing_48", 48, PatentsLicensing, PatentsLicensingScript),
        new GoldenScenario("events_ads_media_36", 36, EventsAdsMedia, EventsAdsMediaScript),
        new GoldenScenario("upgrades_warehouse_chain_24", 24, UpgradesWarehouseChain, UpgradesWarehouseChainScript),
    };

    /// <summary>Look up a run by name.</summary>
    public static GoldenScenario Get(string name)
        => All.FirstOrDefault(s => s.Name == name) ?? throw new ArgumentException($"unknown golden scenario '{name}'", nameof(name));

    // ------------------------------------------------------------------ world factories

    private static World NewClassicWorld(int seed) => Worlds.Classic(seed);

    /// <summary>
    /// A content scenario applied under Classic rules with the player company handed to
    /// <see cref="AdaptiveStrategy"/> (MagnateSim's <c>--auto-player</c>).
    /// </summary>
    private static World AutoPlayerScenario(string scenarioId, int seed)
    {
        var scenario = TestContent.ClassicScenarios[scenarioId];
        var (world, player) = Worlds.ApplyClassicScenario(scenario, seed);
        world.RegisterAi(player, new AdaptiveStrategy());
        return world;
    }

    /// <summary>MagnateSim's default cockpit script (tools/MagnateSim/Program.cs), seed 42.</summary>
    private static World Cockpit()
    {
        var world = NewClassicWorld(42);
        var acme = world.CreateCompany("Acme Corp", 40_000_000m);

        var farm = world.Construct(acme.Id, new BuildingTypeId("small_farm"), Metropolis);
        world.ConfigureExtractionSlot(farm.Id, 0, new ProductId("sugarcane"));
        var sugarPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), Metropolis);
        world.ConfigureProductionSlot(sugarPlant.Id, 0, new ProductId("sugar"));
        var drinkPlant = world.Construct(acme.Id, new BuildingTypeId("factory_small"), Metropolis);
        world.ConfigureProductionSlot(drinkPlant.Id, 0, SoftDrink);
        var metStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), Metropolis);
        world.ConfigureRetailSlot(metStore.Id, 0, SoftDrink, price: 1.80m, restockTarget: 3_000_000);
        var rivStore = world.Construct(acme.Id, new BuildingTypeId("supermarket"), Riverside);
        world.ConfigureRetailSlot(rivStore.Id, 0, SoftDrink, price: 1.80m, restockTarget: 1_500_000);
        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), Metropolis);
        world.ConfigureResearchSlot(rd.Id, 0, SoftDrink);
        world.RegisterAdCampaign(acme.Id, SoftDrink, Metropolis, AdChannel.TV, monthlyBudget: 100_000m);

        var rival = world.CreateCompany("RivalCo", 30_000_000m);
        world.RegisterAi(rival.Id, new AdaptiveStrategy());
        return world;
    }

    /// <summary>
    /// Patent race with licensing: an inventor reaches max soft-drink tech (patent at month 7),
    /// licenses a rival at month 10, revokes at 20, re-grants at 22; the patent expires at 31.
    /// </summary>
    private static World PatentsLicensing()
    {
        var world = NewClassicWorld(42);

        var inventa = world.CreateCompany("Inventa", 60_000_000m);
        var lab = world.Construct(inventa.Id, new BuildingTypeId("rd_center"), Metropolis);
        for (var i = 0; i < 4; i++) world.ConfigureResearchSlot(lab.Id, i, SoftDrink);
        var plant = world.Construct(inventa.Id, new BuildingTypeId("factory_small"), Metropolis);
        world.ConfigureProductionSlot(plant.Id, 0, SoftDrink);
        var store = world.Construct(inventa.Id, new BuildingTypeId("supermarket"), Metropolis);
        world.ConfigureRetailSlot(store.Id, 0, SoftDrink, price: 1.90m, restockTarget: 400_000);
        world.RegisterAdCampaign(inventa.Id, SoftDrink, Metropolis, AdChannel.TV, 60_000m);

        var copyco = world.CreateCompany("Copyco", 40_000_000m);
        var copyLab = world.Construct(copyco.Id, new BuildingTypeId("rd_center"), Riverside);
        world.ConfigureResearchSlot(copyLab.Id, 0, SoftDrink);
        world.ConfigureResearchSlot(copyLab.Id, 1, SoftDrink);
        var copyPlant = world.Construct(copyco.Id, new BuildingTypeId("factory_small"), Metropolis);
        world.ConfigureProductionSlot(copyPlant.Id, 0, SoftDrink);
        var copyStore = world.Construct(copyco.Id, new BuildingTypeId("supermarket"), Metropolis);
        world.ConfigureRetailSlot(copyStore.Id, 0, SoftDrink, price: 1.70m, restockTarget: 600_000);

        var mega = world.CreateCompany("MegaMart", 20_000_000m);
        world.RegisterAi(mega.Id, new SimpleRetailerStrategy());
        return world;
    }

    private static void PatentsLicensingScript(World world, int month)
    {
        var inventa = new CompanyId(1);
        var copyco = new CompanyId(2);
        switch (month)
        {
            case 10:
            case 22:
                world.GrantPatentLicense(inventa, copyco, SoftDrink);
                break;
            case 20:
                world.RevokePatentLicense(inventa, copyco, SoftDrink);
                break;
        }
    }

    /// <summary>
    /// Every random-event effect type under seed 42 (brand shifts on soft drink and television,
    /// price multipliers on wheat, coffee beans, cotton and steel) plus all four ad channels with
    /// and without media-ownership bonuses, campaign cancellation and brand decay.
    /// </summary>
    private static World EventsAdsMedia()
    {
        var world = NewClassicWorld(42);

        var brandCo = world.CreateCompany("BrandCo", 80_000_000m);
        world.Construct(brandCo.Id, new BuildingTypeId("tv_station"), Metropolis);
        world.Construct(brandCo.Id, new BuildingTypeId("newspaper_publisher"), Eastside);
        var drinkPlant = world.Construct(brandCo.Id, new BuildingTypeId("factory_small"), Metropolis);
        world.ConfigureProductionSlot(drinkPlant.Id, 0, SoftDrink);
        var metStore = world.Construct(brandCo.Id, new BuildingTypeId("supermarket"), Metropolis);
        world.ConfigureRetailSlot(metStore.Id, 0, SoftDrink, 1.85m, 1_200_000);
        world.ConfigureRetailSlot(metStore.Id, 1, Bread, 2.90m, 500_000);
        var eastStore = world.Construct(brandCo.Id, new BuildingTypeId("supermarket"), Eastside);
        world.ConfigureRetailSlot(eastStore.Id, 0, SoftDrink, 1.95m, 300_000);
        world.RegisterAdCampaign(brandCo.Id, SoftDrink, Metropolis, AdChannel.TV, 120_000m);
        world.RegisterAdCampaign(brandCo.Id, SoftDrink, Eastside, AdChannel.Newspaper, 40_000m);
        world.RegisterAdCampaign(brandCo.Id, SoftDrink, Metropolis, AdChannel.Radio, 30_000m);
        world.RegisterAdCampaign(brandCo.Id, Bread, Metropolis, AdChannel.Magazine, 25_000m);

        var screenCo = world.CreateCompany("ScreenCo", 60_000_000m);
        var dept = world.Construct(screenCo.Id, new BuildingTypeId("department_store"), Metropolis);
        world.ConfigureRetailSlot(dept.Id, 0, Television, 520m, 3_000);
        world.ConfigureRetailSlot(dept.Id, 1, Car, 21_000m, 300);
        world.RegisterAdCampaign(screenCo.Id, Television, Metropolis, AdChannel.TV, 50_000m);

        var mill = world.CreateCompany("Mill & Brew", 50_000_000m);
        var works = world.Construct(mill.Id, new BuildingTypeId("factory_small"), Riverside);
        world.ConfigureProductionSlot(works.Id, 0, new ProductId("flour"));
        world.ConfigureProductionSlot(works.Id, 1, Bread);
        world.ConfigureProductionSlot(works.Id, 2, new ProductId("roasted_coffee"));
        world.ConfigureProductionSlot(works.Id, 3, new ProductId("coffee_drink"));
        world.ConfigureProductionSlot(works.Id, 4, new ProductId("cotton_fabric"));
        world.ConfigureProductionSlot(works.Id, 5, new ProductId("t_shirt"));
        var millStore = world.Construct(mill.Id, new BuildingTypeId("supermarket"), Riverside);
        world.ConfigureRetailSlot(millStore.Id, 0, Bread, 2.80m, 200_000);
        world.ConfigureRetailSlot(millStore.Id, 1, new ProductId("coffee_drink"), 4.60m, 150_000);
        world.ConfigureRetailSlot(millStore.Id, 2, new ProductId("t_shirt"), 17.50m, 20_000);

        var rival = world.CreateCompany("RivalCo", 30_000_000m);
        world.RegisterAi(rival.Id, new AdaptiveStrategy());
        return world;
    }

    private static void EventsAdsMediaScript(World world, int month)
    {
        var brandCo = new CompanyId(1);
        var screenCo = new CompanyId(2);
        switch (month)
        {
            case 12:
                world.CancelAdCampaign(brandCo, SoftDrink, Metropolis, AdChannel.Radio);
                break;
            case 18:
                world.RegisterAdCampaign(brandCo, SoftDrink, Metropolis, AdChannel.TV, 0m);
                world.CancelAdCampaign(brandCo, SoftDrink, Eastside, AdChannel.Newspaper);
                world.CancelAdCampaign(brandCo, Bread, Metropolis, AdChannel.Magazine);
                break;
            case 24:
                var dept = world.Buildings.Values.First(b => b.Owner == screenCo && b.RetailSlots.Count > 0);
                dept.RetailSlots.First(s => s.Product == Television).Price = 480m;
                break;
        }
    }

    /// <summary>
    /// A vertical soft-drink chain with building upgrades (retail, factory, farm), slots added on
    /// upgraded capacity, an inter-city warehouse feeding a satellite store, and auto-export
    /// switched off mid-run.
    /// </summary>
    private static World UpgradesWarehouseChain()
    {
        var world = NewClassicWorld(42);

        var chain = world.CreateCompany("ChainCo", 60_000_000m);
        var farm = world.Construct(chain.Id, new BuildingTypeId("small_farm"), Metropolis);
        for (var i = 0; i < 3; i++) world.ConfigureExtractionSlot(farm.Id, i, new ProductId("sugarcane"));
        var plant = world.Construct(chain.Id, new BuildingTypeId("factory_small"), Metropolis);
        world.ConfigureProductionSlot(plant.Id, 0, new ProductId("sugar"));
        world.ConfigureProductionSlot(plant.Id, 1, SoftDrink);
        var metStore = world.Construct(chain.Id, new BuildingTypeId("supermarket"), Metropolis);
        world.ConfigureRetailSlot(metStore.Id, 0, SoftDrink, 1.80m, 900_000);
        var depot = world.Construct(chain.Id, new BuildingTypeId("warehouse_small"), Riverside);
        world.ConfigureWarehouseSlot(depot.Id, 0, SoftDrink, 400_000);
        var rivStore = world.Construct(chain.Id, new BuildingTypeId("supermarket"), Riverside);
        world.ConfigureRetailSlot(rivStore.Id, 0, SoftDrink, 1.90m, 350_000);

        var mega = world.CreateCompany("MegaMart", 20_000_000m);
        world.RegisterAi(mega.Id, new SimpleRetailerStrategy());
        return world;
    }

    private static void UpgradesWarehouseChainScript(World world, int month)
    {
        var farm = new BuildingInstanceId(1);
        var plant = new BuildingInstanceId(2);
        var metStore = new BuildingInstanceId(3);
        switch (month)
        {
            case 3:
                world.UpgradeBuilding(metStore);
                world.ConfigureRetailSlot(metStore, 6, Bread, 2.95m, 400_000);
                break;
            case 6:
                world.UpgradeBuilding(plant);
                world.ConfigureProductionSlot(plant, 7, new ProductId("plastic"));
                world.ConfigureProductionSlot(plant, 6, new ProductId("sugar"));
                break;
            case 9:
                world.UpgradeBuilding(metStore);
                break;
            case 12:
                world.UpgradeBuilding(farm);
                world.ConfigureExtractionSlot(farm, 3, new ProductId("sugarcane"));
                break;
            case 15:
                world.Buildings[plant].AutoExport = false;
                break;
        }
    }
}

/// <summary>One golden-master run: a world factory, an optional per-month script and a length.</summary>
public sealed class GoldenScenario
{
    private readonly Func<World> _create;
    private readonly Action<World, int>? _beforeMonth;

    /// <summary>Create a run definition.</summary>
    public GoldenScenario(string name, int months, Func<World> create, Action<World, int>? beforeMonth = null)
    {
        Name = name;
        Months = months;
        _create = create;
        _beforeMonth = beforeMonth;
    }

    /// <summary>Stable run id (also the fixture file name).</summary>
    public string Name { get; }

    /// <summary>Number of monthly ticks.</summary>
    public int Months { get; }

    /// <summary>Build the month-0 world.</summary>
    public World Create() => _create();

    /// <summary>Apply the scripted player actions that precede tick <paramref name="month"/> (0-based).</summary>
    public void BeforeMonth(World world, int month) => _beforeMonth?.Invoke(world, month);

    /// <summary>Advance <paramref name="world"/> from tick <paramref name="fromMonth"/> (0-based) to <see cref="Months"/>.</summary>
    public void Advance(World world, int fromMonth, int toMonthExclusive, StringBuilder? trail = null)
    {
        for (var m = fromMonth; m < toMonthExclusive; m++)
        {
            BeforeMonth(world, m);
            world.AdvanceMonth();
            if (trail is not null) AppendTrail(trail, world);
        }
    }

    /// <summary>Execute the whole run and render trail + final digest.</summary>
    public GoldenResult Run()
    {
        var world = Create();
        var trail = new StringBuilder();
        Advance(world, 0, Months, trail);
        return new GoldenResult(world, trail.ToString() + StateDigest.Of(world));
    }

    private static void AppendTrail(StringBuilder trail, World world)
    {
        trail.Append("month ").Append(world.Clock.Now);
        foreach (var c in world.Companies.Values.OrderBy(c => c.Id.Value))
        {
            trail.Append(' ').Append(c.Id.Value).Append('=').Append(c.Cash.ToString(CultureInfo.InvariantCulture));
        }
        trail.Append(" news=").Append(world.NewsLog.Count).Append('\n');
    }
}

/// <summary>Result of a golden run.</summary>
public sealed record GoldenResult(World World, string Text)
{
    /// <summary>Final cash per company id, exact decimal text.</summary>
    public IReadOnlyList<string> FinalCash => World.Companies.Values
        .OrderBy(c => c.Id.Value)
        .Select(c => c.Cash.ToString(CultureInfo.InvariantCulture))
        .ToList();

    /// <summary>Space-separated news event ids in firing order.</summary>
    public string NewsSequence => string.Join(" ", World.NewsLog.Select(n => $"{n.Date}:{n.EventId}"));
}
