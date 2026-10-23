using System.Collections.Generic;

namespace Magnate.Bridge;

/// <summary>
/// Ordinal comparers for tuple keys that contain content ids. The default tuple
/// comparer orders strings with the current culture, which differs between the
/// desktop runtime (tests, tools) and the browser build (invariant globalization);
/// everything the bridge sorts for presentation or event order must sort the same
/// way everywhere, so ids compare ordinally.
/// </summary>
internal static class OrdinalComparers
{
    /// <summary>(string, string) — e.g. (cityId, productId).</summary>
    public static readonly IComparer<(string, string)> Pair = Comparer<(string, string)>.Create(static (a, b) =>
    {
        var c = string.CompareOrdinal(a.Item1, b.Item1);
        return c != 0 ? c : string.CompareOrdinal(a.Item2, b.Item2);
    });

    /// <summary>(int, string) — e.g. (buildingId, productId).</summary>
    public static readonly IComparer<(int, string)> IdThenName = Comparer<(int, string)>.Create(static (a, b) =>
    {
        var c = a.Item1.CompareTo(b.Item1);
        return c != 0 ? c : string.CompareOrdinal(a.Item2, b.Item2);
    });

    /// <summary>(int, int, string) — e.g. (fromBuildingId, toBuildingId, productId).</summary>
    public static readonly IComparer<(int, int, string)> IdIdThenName = Comparer<(int, int, string)>.Create(static (a, b) =>
    {
        var c = a.Item1.CompareTo(b.Item1);
        if (c != 0) return c;
        c = a.Item2.CompareTo(b.Item2);
        return c != 0 ? c : string.CompareOrdinal(a.Item3, b.Item3);
    });
}
