using System;
using System.Collections.Generic;
using System.Numerics;

namespace Magnate.Engine.Land.Generation;

/// <summary>
/// Deterministic xoshiro256** generator seeded through SplitMix64. The city
/// generator uses its own PRNG (not <see cref="System.Random"/>) so a layout can
/// never change because of a runtime update, and so every generation stage can
/// draw from an independent stream (<see cref="LayoutSeeds.Stream"/>).
/// </summary>
internal sealed class LayoutRandom
{
    private ulong _s0;
    private ulong _s1;
    private ulong _s2;
    private ulong _s3;

    public LayoutRandom(ulong seed)
    {
        var sm = seed;
        _s0 = LayoutSeeds.SplitMix(ref sm);
        _s1 = LayoutSeeds.SplitMix(ref sm);
        _s2 = LayoutSeeds.SplitMix(ref sm);
        _s3 = LayoutSeeds.SplitMix(ref sm);
    }

    public ulong NextU64()
    {
        var result = BitOperations.RotateLeft(_s1 * 5, 7) * 9;
        var t = _s1 << 17;
        _s2 ^= _s0;
        _s3 ^= _s1;
        _s1 ^= _s2;
        _s0 ^= _s3;
        _s2 ^= t;
        _s3 = BitOperations.RotateLeft(_s3, 45);
        return result;
    }

    /// <summary>Uniform in [0, 1).</summary>
    public double NextDouble() => (NextU64() >> 11) * (1.0 / 9007199254740992.0);

    /// <summary>Uniform integer in [0, maxExclusive); 0 when maxExclusive ≤ 1.</summary>
    public int Next(int maxExclusive) => maxExclusive <= 1 ? 0 : (int)(NextDouble() * maxExclusive);

    /// <summary>Uniform integer in [min, maxInclusive].</summary>
    public int Range(int min, int maxInclusive) => maxInclusive <= min ? min : min + Next(maxInclusive - min + 1);

    /// <summary>Uniform double in [min, max).</summary>
    public double Range(double min, double max) => min + (max - min) * NextDouble();

    /// <summary>True with probability <paramref name="p"/>.</summary>
    public bool Chance(double p) => NextDouble() < p;

    /// <summary>A uniformly chosen element.</summary>
    public T Pick<T>(IReadOnlyList<T> items) => items[Next(items.Count)];

    /// <summary>Index drawn with probability proportional to the (non-negative) weights.</summary>
    public int Weighted(ReadOnlySpan<double> weights)
    {
        var total = 0.0;
        foreach (var w in weights) total += Math.Max(0, w);
        if (total <= 0) return 0;
        var r = NextDouble() * total;
        for (var i = 0; i < weights.Length; i++)
        {
            r -= Math.Max(0, weights[i]);
            if (r < 0) return i;
        }
        return weights.Length - 1;
    }
}

/// <summary>Seed derivation and stable string hashing for the generator.</summary>
internal static class LayoutSeeds
{
    public static ulong SplitMix(ref ulong x)
    {
        x += 0x9E3779B97F4A7C15UL;
        var z = x;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }

    /// <summary>Process-independent 64-bit FNV-1a of a string (never use <c>string.GetHashCode</c>: it is randomised per process).</summary>
    public static ulong Fnv1a(string s)
    {
        var h = 14695981039346656037UL;
        foreach (var c in s)
        {
            h ^= c;
            h *= 1099511628211UL;
        }
        return h;
    }

    /// <summary>Mix two 64-bit values into one well-distributed value.</summary>
    public static ulong Mix(ulong a, ulong b)
    {
        var x = a ^ (b * 0x9E3779B97F4A7C15UL) ^ (a << 7) ^ (b >> 3);
        return SplitMix(ref x);
    }

    /// <summary>The root seed of a city's layout.</summary>
    public static ulong Root(int seed, string cityId) => Mix((ulong)(uint)seed ^ 0xC17A_0000_0000_0000UL, Fnv1a(cityId));

    /// <summary>An independent stream for one generation stage.</summary>
    public static ulong Stream(ulong root, string stage) => Mix(root, Fnv1a(stage));
}

/// <summary>Hash-based value noise (deterministic, allocation-free).</summary>
internal static class Noise
{
    private static double Lattice(ulong seed, int x, int y)
    {
        var h = seed ^ ((ulong)(uint)x * 0x9E3779B97F4A7C15UL) ^ ((ulong)(uint)y * 0xC2B2AE3D27D4EB4FUL);
        h = LayoutSeeds.SplitMix(ref h);
        return (h >> 11) * (1.0 / 9007199254740992.0);
    }

    private static double Smooth(double t) => t * t * (3 - 2 * t);

    /// <summary>Smooth value noise in [0, 1) with unit lattice spacing.</summary>
    public static double Value(ulong seed, double x, double y)
    {
        var x0 = (int)Math.Floor(x);
        var y0 = (int)Math.Floor(y);
        var fx = Smooth(x - x0);
        var fy = Smooth(y - y0);
        var a = Lattice(seed, x0, y0);
        var b = Lattice(seed, x0 + 1, y0);
        var c = Lattice(seed, x0, y0 + 1);
        var d = Lattice(seed, x0 + 1, y0 + 1);
        var top = a + (b - a) * fx;
        var bottom = c + (d - c) * fx;
        return top + (bottom - top) * fy;
    }

    /// <summary>Fractal (fBm) value noise in [0, 1); <paramref name="scale"/> is the base wavelength in plots.</summary>
    public static double Fbm(ulong seed, double x, double y, double scale, int octaves = 3)
    {
        var sum = 0.0;
        var norm = 0.0;
        var amp = 1.0;
        var freq = 1.0 / scale;
        for (var o = 0; o < octaves; o++)
        {
            sum += amp * Value(seed + (ulong)o * 0x51ED27UL, x * freq, y * freq);
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        return sum / norm;
    }

    /// <summary>Signed fBm in [−1, 1).</summary>
    public static double Signed(ulong seed, double x, double y, double scale, int octaves = 3)
        => 2.0 * Fbm(seed, x, y, scale, octaves) - 1.0;

    /// <summary>Smooth 1-D noise in [−1, 1) along a line (wavelength in plots).</summary>
    public static double Line(ulong seed, double t, double scale, int octaves = 2)
        => Signed(seed, t, 7.31, scale, octaves);
}

/// <summary>
/// Smooth periodic noise in [−1, 1] over an angle: a sum of a few low harmonics
/// with seeded phases. Used for the organic, lobed urban edge.
/// </summary>
internal sealed class PeriodicNoise
{
    private static readonly int[] Harmonics = [2, 3, 5, 7];
    private static readonly double[] Weights = [1.0, 0.75, 0.5, 0.3];
    private readonly double[] _phases = new double[4];

    public PeriodicNoise(ulong seed)
    {
        var rng = new LayoutRandom(seed);
        for (var k = 0; k < _phases.Length; k++) _phases[k] = rng.NextDouble() * Math.PI * 2;
    }

    public double Sample(double angle)
    {
        var sum = 0.0;
        var norm = 0.0;
        for (var k = 0; k < Harmonics.Length; k++)
        {
            sum += Weights[k] * Math.Sin(Harmonics[k] * angle + _phases[k]);
            norm += Weights[k];
        }
        return sum / norm;
    }
}
