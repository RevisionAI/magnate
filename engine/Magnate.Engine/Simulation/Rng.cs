using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Magnate.Engine.Simulation;

/// <summary>
/// Deterministic source of randomness. Abstracted so the simulation remains seedable
/// and property-testable independent of the underlying algorithm.
/// </summary>
public interface IRandomSource
{
    /// <summary>Uniform double in [0, 1).</summary>
    double NextDouble();

    /// <summary>Uniform int in [0, maxExclusive).</summary>
    int NextInt(int maxExclusive);
}

/// <summary>
/// A named random stream whose complete state can be exported and restored, so a save/load
/// round trip continues the exact same sequence (econ-audit §4.19, bridge-spec E4, master plan
/// D18). Every consumer of randomness owns one stream; adding a consumer never shifts another
/// stream.
/// </summary>
public abstract class RandomStream : IRandomSource
{
    /// <summary>Create a stream with a registry name.</summary>
    protected RandomStream(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        Name = name;
    }

    /// <summary>Registry name (<c>events</c>, <c>macro</c>, …).</summary>
    public string Name { get; }

    /// <summary>Algorithm id persisted next to the state (<c>legacy-net</c> or <c>xoshiro256**</c>).</summary>
    public abstract string Algorithm { get; }

    /// <inheritdoc/>
    public abstract double NextDouble();

    /// <inheritdoc/>
    public abstract int NextInt(int maxExclusive);

    /// <summary>The complete generator state as invariant-culture strings (JSON-safe).</summary>
    public abstract IReadOnlyList<string> ExportState();

    /// <summary>Restore a state produced by <see cref="ExportState"/> on a stream of the same algorithm.</summary>
    /// <exception cref="FormatException">The state is malformed.</exception>
    public abstract void ImportState(IReadOnlyList<string> state);
}

/// <summary>
/// A serialisable, bit-exact reimplementation of .NET's seeded <see cref="System.Random"/>
/// (the <c>Net5CompatSeedImpl</c> / <c>CompatPrng</c> subtractive generator after Knuth, used by
/// <c>new Random(seed)</c> on .NET Core 3.0 through .NET 8). <c>NextDouble()</c> and
/// <c>NextInt(n)</c> consume one sample each, exactly like <c>Random.NextDouble()</c> and
/// <c>Random.Next(n)</c>, so the Classic <c>events</c> stream reproduces the pre-overhaul event
/// schedule draw for draw (pinned by the Classic golden masters and by a 10,000-draw comparison
/// test against <see cref="System.Random"/>). State: 56 ints plus two indices.
/// </summary>
public sealed class LegacyRandom : RandomStream
{
    /// <summary>Persisted algorithm id.</summary>
    public const string AlgorithmId = "legacy-net";

    private const int MBig = int.MaxValue;
    private const int MSeed = 161803398;

    private readonly int[] _seedArray = new int[56];
    private int _inext;
    private int _inextp;

    /// <summary>Seed exactly like <c>new System.Random(seed)</c>.</summary>
    public LegacyRandom(int seed, string name = RngStreams.EventsStream)
        : base(name)
    {
        unchecked
        {
            var subtraction = seed == int.MinValue ? int.MaxValue : Math.Abs(seed);
            var mj = MSeed - subtraction;
            _seedArray[55] = mj;
            var mk = 1;

            var ii = 0;
            for (var i = 1; i < 55; i++)
            {
                // The range [1..55] is special (Knuth): position 0 is never used.
                if ((ii += 21) >= 55) ii -= 55;
                _seedArray[ii] = mk;
                mk = mj - mk;
                if (mk < 0) mk += MBig;
                mj = _seedArray[ii];
            }

            for (var k = 1; k < 5; k++)
            {
                for (var i = 1; i < 56; i++)
                {
                    var n = i + 30;
                    if (n >= 55) n -= 55;
                    _seedArray[i] -= _seedArray[1 + n];
                    if (_seedArray[i] < 0) _seedArray[i] += MBig;
                }
            }
        }

        _inext = 0;
        _inextp = 21;
    }

    /// <inheritdoc/>
    public override string Algorithm => AlgorithmId;

    /// <inheritdoc/>
    public override double NextDouble() => Sample();

    /// <summary>Same as <c>Random.Next(maxExclusive)</c>: <c>(int)(Sample() × maxExclusive)</c>.</summary>
    public override int NextInt(int maxExclusive)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(maxExclusive);
        return (int)(Sample() * maxExclusive);
    }

    private double Sample() => InternalSample() * (1.0 / MBig);

    private int InternalSample()
    {
        unchecked
        {
            var locINext = _inext;
            if (++locINext >= 56) locINext = 1;

            var locINextp = _inextp;
            if (++locINextp >= 56) locINextp = 1;

            var retVal = _seedArray[locINext] - _seedArray[locINextp];
            if (retVal == MBig) retVal--;
            if (retVal < 0) retVal += MBig;

            _seedArray[locINext] = retVal;
            _inext = locINext;
            _inextp = locINextp;
            return retVal;
        }
    }

    /// <summary>State: <c>[inext, inextp, seedArray[0..55]]</c> as decimal strings.</summary>
    public override IReadOnlyList<string> ExportState()
    {
        var state = new string[58];
        state[0] = _inext.ToString(CultureInfo.InvariantCulture);
        state[1] = _inextp.ToString(CultureInfo.InvariantCulture);
        for (var i = 0; i < 56; i++) state[i + 2] = _seedArray[i].ToString(CultureInfo.InvariantCulture);
        return state;
    }

    /// <inheritdoc/>
    public override void ImportState(IReadOnlyList<string> state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (state.Count != 58) throw new FormatException($"legacy-net RNG state needs 58 values, got {state.Count}");

        var inext = ParseInt(state[0]);
        var inextp = ParseInt(state[1]);
        if (inext is < 0 or > 55 || inextp is < 1 or > 55)
        {
            throw new FormatException($"legacy-net RNG indices out of range ({inext}, {inextp})");
        }

        var values = new int[56];
        for (var i = 0; i < 56; i++) values[i] = ParseInt(state[i + 2]);

        values.CopyTo(_seedArray, 0);
        _inext = inext;
        _inextp = inextp;
    }

    private static int ParseInt(string text)
        => int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v)
            ? v
            : throw new FormatException($"malformed legacy-net RNG state value '{text}'");
}

/// <summary>
/// xoshiro256** 1.0 (Blackman &amp; Vigna), 256-bit state, for every new random consumer
/// (macro, commodities, market). Seeded through SplitMix64 so any 64-bit seed gives a
/// well-mixed, never-all-zero state.
/// </summary>
public sealed class Xoshiro256StarStar : RandomStream
{
    /// <summary>Persisted algorithm id.</summary>
    public const string AlgorithmId = "xoshiro256**";

    private ulong _s0, _s1, _s2, _s3;

    /// <summary>Seed from a 64-bit value expanded with SplitMix64 (the reference seeding procedure).</summary>
    public Xoshiro256StarStar(ulong seed, string name)
        : base(name)
    {
        var sm = seed;
        _s0 = SplitMix64.Next(ref sm);
        _s1 = SplitMix64.Next(ref sm);
        _s2 = SplitMix64.Next(ref sm);
        _s3 = SplitMix64.Next(ref sm);
        if ((_s0 | _s1 | _s2 | _s3) == 0) _s0 = 1; // unreachable for SplitMix64 output, kept as a guard
    }

    /// <summary>Create a stream from an explicit raw state (tests, reference vectors).</summary>
    public Xoshiro256StarStar(ulong s0, ulong s1, ulong s2, ulong s3, string name)
        : base(name)
    {
        if ((s0 | s1 | s2 | s3) == 0) throw new ArgumentException("xoshiro256** state must not be all zero");
        _s0 = s0;
        _s1 = s1;
        _s2 = s2;
        _s3 = s3;
    }

    /// <inheritdoc/>
    public override string Algorithm => AlgorithmId;

    /// <summary>Next raw 64-bit output.</summary>
    public ulong NextUInt64()
    {
        unchecked
        {
            var result = RotateLeft(_s1 * 5, 7) * 9;
            var t = _s1 << 17;

            _s2 ^= _s0;
            _s3 ^= _s1;
            _s1 ^= _s2;
            _s0 ^= _s3;

            _s2 ^= t;
            _s3 = RotateLeft(_s3, 45);
            return result;
        }
    }

    /// <summary>Uniform double in [0, 1) from the top 53 bits.</summary>
    public override double NextDouble() => (NextUInt64() >> 11) * (1.0 / (1UL << 53));

    /// <summary>Uniform int in [0, maxExclusive) by 32-bit multiply-shift (Lemire).</summary>
    public override int NextInt(int maxExclusive)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(maxExclusive);
        return (int)(((NextUInt64() >> 32) * (ulong)maxExclusive) >> 32);
    }

    /// <summary>State: the four 64-bit words as 16-digit lower-case hex strings.</summary>
    public override IReadOnlyList<string> ExportState()
        => new[] { Hex(_s0), Hex(_s1), Hex(_s2), Hex(_s3) };

    /// <inheritdoc/>
    public override void ImportState(IReadOnlyList<string> state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (state.Count != 4) throw new FormatException($"xoshiro256** state needs 4 words, got {state.Count}");
        var words = new ulong[4];
        for (var i = 0; i < 4; i++)
        {
            if (!ulong.TryParse(state[i], NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out words[i]))
            {
                throw new FormatException($"malformed xoshiro256** state word '{state[i]}'");
            }
        }

        if ((words[0] | words[1] | words[2] | words[3]) == 0) throw new FormatException("xoshiro256** state must not be all zero");
        (_s0, _s1, _s2, _s3) = (words[0], words[1], words[2], words[3]);
    }

    private static ulong RotateLeft(ulong x, int k) => (x << k) | (x >> (64 - k));

    private static string Hex(ulong v) => v.ToString("x16", CultureInfo.InvariantCulture);
}

/// <summary>SplitMix64 (Steele, Lea &amp; Flood) — used to expand seeds.</summary>
public static class SplitMix64
{
    /// <summary>Advance <paramref name="state"/> and return the next output.</summary>
    public static ulong Next(ref ulong state)
    {
        unchecked
        {
            var z = state += 0x9E3779B97F4A7C15UL;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 31);
        }
    }
}

/// <summary>64-bit FNV-1a over UTF-8 — used to derive per-stream seeds from stream names.</summary>
public static class Fnv1a64
{
    /// <summary>Hash <paramref name="text"/>'s UTF-8 bytes.</summary>
    public static ulong Hash(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        unchecked
        {
            var hash = 0xCBF29CE484222325UL;
            foreach (var b in Encoding.UTF8.GetBytes(text))
            {
                hash ^= b;
                hash *= 0x100000001B3UL;
            }

            return hash;
        }
    }
}

/// <summary>
/// The world's named random streams (econ-audit §4.19). <see cref="Events"/> is the legacy
/// .NET-compatible stream seeded with the world seed (so Classic event schedules are unchanged);
/// every other stream is xoshiro256** seeded with
/// <c>SplitMix64(worldSeed ⊕ FNV1a(streamName))</c> and created on first use. The world seed
/// and the state of every created stream are persisted (schema v10), so a save/load continues
/// every sequence exactly.
/// </summary>
public sealed class RngStreams
{
    /// <summary>Random events (Phase 3.65). Legacy algorithm, seeded with the world seed.</summary>
    public const string EventsStream = "events";

    /// <summary>Business cycle (§4.13).</summary>
    public const string MacroStream = "macro";

    /// <summary>Commodity price cycles (§4.13).</summary>
    public const string CommoditiesStream = "commodities";

    /// <summary>Market noise: sentiment, demand shocks (§4.1, §4.11).</summary>
    public const string MarketStream = "market";

    private readonly SortedDictionary<string, RandomStream> _streams = new(StringComparer.Ordinal);

    /// <summary>Create the registry for a world seed; the events stream exists immediately.</summary>
    public RngStreams(int worldSeed)
    {
        WorldSeed = worldSeed;
        Events = new LegacyRandom(worldSeed, EventsStream);
        _streams[EventsStream] = Events;
    }

    /// <summary>The world seed every stream derives from.</summary>
    public int WorldSeed { get; }

    /// <summary>The events stream (also exposed as <see cref="World.Rng"/>).</summary>
    public RandomStream Events { get; }

    /// <summary>Every stream created so far, ordinal by name.</summary>
    public IEnumerable<RandomStream> Created => _streams.Values;

    /// <summary>Get (creating on first use) the stream called <paramref name="name"/>.</summary>
    public RandomStream Get(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        if (_streams.TryGetValue(name, out var existing)) return existing;
        var stream = new Xoshiro256StarStar(SeedFor(WorldSeed, name), name);
        _streams[name] = stream;
        return stream;
    }

    /// <summary>The 64-bit seed of a non-legacy stream: <c>worldSeed ⊕ FNV1a(name)</c>.</summary>
    public static ulong SeedFor(int worldSeed, string name)
        => unchecked((ulong)(uint)worldSeed) ^ Fnv1a64.Hash(name);

    /// <summary>
    /// Restore a persisted stream state. The stream is created if it does not exist yet, and the
    /// algorithm must match the one the registry would create for that name.
    /// </summary>
    /// <exception cref="FormatException">Unknown algorithm or malformed state.</exception>
    public void Restore(string name, string algorithm, IReadOnlyList<string> state)
    {
        var stream = Get(name);
        if (!string.Equals(stream.Algorithm, algorithm, StringComparison.Ordinal))
        {
            throw new FormatException($"RNG stream '{name}' uses {stream.Algorithm}, the save says {algorithm}");
        }

        stream.ImportState(state);
    }
}

/// <summary>
/// The pre-overhaul public seeded generator, kept for source compatibility. Now backed by the
/// serialisable <see cref="LegacyRandom"/> (same sequence as <c>new System.Random(seed)</c>).
/// </summary>
public sealed class DeterministicRandom : IRandomSource
{
    private readonly LegacyRandom _random;

    /// <summary>Same sequence as <c>new System.Random(seed)</c>.</summary>
    public DeterministicRandom(int seed)
    {
        _random = new LegacyRandom(seed, "deterministic");
    }

    /// <inheritdoc/>
    public double NextDouble() => _random.NextDouble();

    /// <inheritdoc/>
    public int NextInt(int maxExclusive) => _random.NextInt(maxExclusive);
}
