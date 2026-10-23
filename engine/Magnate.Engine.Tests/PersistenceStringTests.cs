using System.IO;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>String-based save/load used by the browser host (no filesystem).</summary>
public sealed class PersistenceStringTests
{
    private static ContentCatalog Catalog() => TestContent.Live;

    [Fact]
    public void SaveToString_then_LoadFromString_round_trips_and_advances_identically()
    {
        var catalog = Catalog();
        var world = new World(catalog, 7, new GameDate(2026, 1));
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var store = world.Construct(acme.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, new ProductId("soft_drink"), 1.9m, 50_000);
        world.AdvanceMonth();

        var json = WorldSaver.SaveToString(world, "sandbox", acme.Id);
        var loaded = WorldLoader.LoadFromString(catalog, json);

        Assert.Equal("sandbox", loaded.ScenarioId);
        Assert.Equal(acme.Id, loaded.PlayerId);
        Assert.Equal(world.Companies[acme.Id].Cash, loaded.World.Companies[acme.Id].Cash);

        // The save carries every RNG stream's state (v10), so the two worlds stay identical for
        // as long as they run — including months in which events fire.
        for (var i = 0; i < 24; i++)
        {
            world.AdvanceMonth();
            loaded.World.AdvanceMonth();
        }
        Assert.Equal(world.Companies[acme.Id].Cash, loaded.World.Companies[acme.Id].Cash);
        Assert.Equal(StateDigest.Of(world), StateDigest.Of(loaded.World));
        Assert.Equal(WorldSaver.SaveToString(world, "sandbox", acme.Id), WorldSaver.SaveToString(loaded.World, "sandbox", acme.Id));
    }

    [Fact]
    public void LoadFromString_rejects_unsupported_schema()
    {
        var ex = Assert.Throws<System.InvalidOperationException>(() =>
            WorldLoader.LoadFromString(Catalog(), "{\"schemaVersion\": 9999}"));
        Assert.Contains("unsupported", ex.Message);
    }
}
