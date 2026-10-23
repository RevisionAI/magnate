using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>Named, serialisable RNG streams (econ-audit §4.19, bridge-spec E4, test-map §7.2 item 7).</summary>
public sealed class RngTests
{
    public static TheoryData<int> Seeds => new()
    {
        0, 1, -1, 7, 11, 13, 17, 21, 42, 99, 12345, 161803398, -161803398, int.MaxValue, int.MinValue, int.MinValue + 1,
    };

    [Theory]
    [MemberData(nameof(Seeds))]
    public void Legacy_stream_matches_System_Random_draw_for_draw(int seed)
    {
        var reference = new Random(seed);
        var legacy = new LegacyRandom(seed);
        for (var i = 0; i < 10_000; i++)
        {
            if (i % 3 == 2)
            {
                var max = 1 + (i % 97) * 1_000;
                Assert.Equal(reference.Next(max), legacy.NextInt(max));
            }
            else
            {
                Assert.Equal(reference.NextDouble(), legacy.NextDouble());
            }
        }
    }

    [Fact]
    public void Deterministic_random_keeps_the_System_Random_sequence()
    {
        var reference = new Random(42);
        var compat = new DeterministicRandom(42);
        for (var i = 0; i < 1_000; i++) Assert.Equal(reference.NextDouble(), compat.NextDouble());
    }

    [Fact]
    public void Legacy_state_round_trips_mid_sequence()
    {
        var original = new LegacyRandom(42);
        for (var i = 0; i < 777; i++) original.NextDouble();

        var copy = new LegacyRandom(-5);
        copy.ImportState(original.ExportState());
        for (var i = 0; i < 2_000; i++) Assert.Equal(original.NextDouble(), copy.NextDouble());
        Assert.Equal(original.ExportState(), copy.ExportState());
    }

    [Fact]
    public void Xoshiro256StarStar_matches_the_reference_vector()
    {
        // Reference outputs for state {1, 2, 3, 4} (rand_xoshiro / the C reference implementation).
        var rng = new Xoshiro256StarStar(1, 2, 3, 4, "test");
        var expected = new ulong[]
        {
            11520, 0, 1509978240, 1215971899390074240, 1216172134540287360,
            607988272756665600, 16172922978634559625, 8476171486693032832,
            10595114339597558777, 2904607092377533576,
        };
        Assert.Equal(expected, expected.Select(_ => rng.NextUInt64()).ToArray());
    }

    [Fact]
    public void SplitMix64_and_Fnv1a_match_published_vectors()
    {
        ulong state = 0;
        Assert.Equal(0xE220A8397B1DCDAFUL, SplitMix64.Next(ref state));
        Assert.Equal(0x6E789E6AA1B965F4UL, SplitMix64.Next(ref state));

        Assert.Equal(0xCBF29CE484222325UL, Fnv1a64.Hash(""));
        Assert.Equal(0xAF63DC4C8601EC8CUL, Fnv1a64.Hash("a"));
        Assert.Equal(0x85944171F73967E8UL, Fnv1a64.Hash("foobar"));
    }

    [Fact]
    public void Xoshiro_state_round_trips_and_rejects_garbage()
    {
        var rng = new Xoshiro256StarStar(123UL, "macro");
        for (var i = 0; i < 100; i++) rng.NextDouble();
        var copy = new Xoshiro256StarStar(9UL, "macro");
        copy.ImportState(rng.ExportState());
        for (var i = 0; i < 1_000; i++) Assert.Equal(rng.NextUInt64(), copy.NextUInt64());

        Assert.Throws<FormatException>(() => copy.ImportState(new[] { "0", "0", "0", "0" }));
        Assert.Throws<FormatException>(() => copy.ImportState(new[] { "zz", "1", "2", "3" }));
        Assert.Throws<FormatException>(() => copy.ImportState(new[] { "1" }));
    }

    [Fact]
    public void Xoshiro_doubles_and_ints_stay_in_range()
    {
        var rng = new Xoshiro256StarStar(42UL, "market");
        for (var i = 0; i < 10_000; i++)
        {
            var d = rng.NextDouble();
            Assert.InRange(d, 0.0, 0.9999999999999999);
            Assert.InRange(rng.NextInt(10), 0, 9);
        }
        Assert.Equal(0, rng.NextInt(0));
    }

    [Fact]
    public void Streams_are_deterministic_per_seed_and_name_and_independent()
    {
        var a = new RngStreams(42);
        var b = new RngStreams(42);
        var macroA = Draw(a.Get(RngStreams.MacroStream), 50);
        var macroB = Draw(b.Get(RngStreams.MacroStream), 50);
        Assert.Equal(macroA, macroB);
        Assert.NotEqual(macroA, Draw(new RngStreams(43).Get(RngStreams.MacroStream), 50));
        Assert.NotEqual(macroA, Draw(new RngStreams(42).Get(RngStreams.MarketStream), 50));
        Assert.Equal(RngStreams.SeedFor(42, "macro"), (ulong)42 ^ Fnv1a64.Hash("macro"));

        // Drawing from a new stream never shifts the events stream.
        var plain = new RngStreams(42);
        var busy = new RngStreams(42);
        Draw(busy.Get(RngStreams.CommoditiesStream), 1_000);
        Assert.Equal(Draw(plain.Events, 200), Draw(busy.Events, 200));
        Assert.Equal(Draw(new Random(42), 200), Draw(new RngStreams(42).Events, 200));
    }

    [Fact]
    public void Restore_validates_the_algorithm()
    {
        var streams = new RngStreams(1);
        Assert.Throws<FormatException>(() => streams.Restore(RngStreams.EventsStream, Xoshiro256StarStar.AlgorithmId, new[] { "1", "2", "3", "4" }));
        Assert.Throws<FormatException>(() => streams.Restore(RngStreams.MacroStream, LegacyRandom.AlgorithmId, new string[58]));
    }

    [Fact]
    public void World_exposes_its_seed_and_events_stream()
    {
        var world = Worlds.Live(seed: 1234);
        Assert.Equal(1234, world.Seed);
        Assert.Same(world.RngStreams.Events, world.Rng);
        Assert.Equal(LegacyRandom.AlgorithmId, world.RngStreams.Events.Algorithm);
    }

    private static List<double> Draw(IRandomSource rng, int n)
    {
        var list = new List<double>(n);
        for (var i = 0; i < n; i++) list.Add(rng.NextDouble());
        return list;
    }

    private static List<double> Draw(Random rng, int n)
    {
        var list = new List<double>(n);
        for (var i = 0; i < n; i++) list.Add(rng.NextDouble());
        return list;
    }
}
