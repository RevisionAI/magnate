using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>
/// Save/load is lossless (test-map D1 / econ-audit F11 / bridge-spec E4, econ-audit §6 R15):
/// running N months uninterrupted and running N/2 months, saving, loading and running the rest
/// produce the same complete state — every company's cash to the last digit, every log, every
/// inventory, the news sequence and every RNG stream's position.
/// </summary>
public sealed class SaveLoadDeterminismTests
{
    private const int Months = 60;
    private const int SplitAt = 30;

    public static TheoryData<string> Scenarios()
    {
        var data = new TheoryData<string>();
        foreach (var s in GoldenScenarios.All)
        {
            // The same script length twice would add nothing.
            if (s.Name == "soft_drink_war_auto_24") continue;
            data.Add(s.Name);
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void Save_load_mid_run_via_string_continues_identically(string name)
    {
        var scenario = GoldenScenarios.Get(name);
        var direct = RunDirect(scenario);

        var first = scenario.Create();
        scenario.Advance(first, 0, SplitAt);
        var json = WorldSaver.SaveToString(first, scenarioId: name, playerId: new CompanyId(1));
        var loaded = WorldLoader.LoadFromString(first.Catalog, json);
        Assert.Equal(name, loaded.ScenarioId);
        var resumed = loaded.World;
        Assert.Equal(StateDigest.Of(first), StateDigest.Of(resumed));
        scenario.Advance(resumed, SplitAt, Months);

        AssertSameState(direct, resumed);
    }

    [Theory]
    [InlineData("events_ads_media_36")]
    [InlineData("four_archetype_melee_auto_60")]
    public void Save_load_mid_run_via_file_continues_identically(string name)
    {
        var scenario = GoldenScenarios.Get(name);
        var direct = RunDirect(scenario);

        var path = Path.Combine(Path.GetTempPath(), $"magnate-saveload-{Guid.NewGuid():N}.json");
        try
        {
            var first = scenario.Create();
            scenario.Advance(first, 0, SplitAt);
            WorldSaver.Save(first, path);
            var resumed = WorldLoader.Load(first.Catalog, path).World;
            scenario.Advance(resumed, SplitAt, Months);

            AssertSameState(direct, resumed);
        }
        finally
        {
            if (File.Exists(path)) File.Delete(path);
        }
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void Saving_a_loaded_world_reproduces_the_save_byte_for_byte(string name)
    {
        var scenario = GoldenScenarios.Get(name);
        var world = scenario.Create();
        scenario.Advance(world, 0, Math.Min(scenario.Months, 18));

        var json = WorldSaver.SaveToString(world);
        var again = WorldSaver.SaveToString(WorldLoader.LoadFromString(world.Catalog, json).World);
        Assert.Equal(json, again);
    }

    [Fact]
    public void Save_records_the_world_seed_rules_and_rng_streams()
    {
        var world = Worlds.Realistic(seed: 4242);
        world.RngStreams.Get(RngStreams.MacroStream).NextDouble();
        world.AdvanceMonth();

        var loaded = WorldLoader.LoadFromString(world.Catalog, WorldSaver.SaveToString(world)).World;
        Assert.Equal(4242, loaded.Seed);
        Assert.Equal(world.Rules, loaded.Rules);
        Assert.Equal(
            world.RngStreams.Created.Select(s => (s.Name, s.Algorithm, string.Join(",", s.ExportState()))),
            loaded.RngStreams.Created.Select(s => (s.Name, s.Algorithm, string.Join(",", s.ExportState()))));
        Assert.Equal(world.RngStreams.Get(RngStreams.MacroStream).NextDouble(), loaded.RngStreams.Get(RngStreams.MacroStream).NextDouble());
        Assert.Equal(world.Rng.NextDouble(), loaded.Rng.NextDouble());
    }

    private static World RunDirect(GoldenScenario scenario)
    {
        var world = scenario.Create();
        scenario.Advance(world, 0, Months);
        return world;
    }

    private static void AssertSameState(World direct, World resumed)
    {
        var expected = StateDigest.Of(direct);
        var actual = StateDigest.Of(resumed);
        var diff = StateDigest.FirstDifference(expected, actual);
        Assert.True(diff is null, $"save/load changed the simulation: {diff}");

        Assert.Equal(direct.Seed, resumed.Seed);
        Assert.Equal(
            direct.RngStreams.Created.Select(s => (s.Name, string.Join(",", s.ExportState()))),
            resumed.RngStreams.Created.Select(s => (s.Name, string.Join(",", s.ExportState()))));
        Assert.Equal(WorldSaver.SaveToString(direct), WorldSaver.SaveToString(resumed));
    }
}
