using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// Shared content and generated layouts for the city-generator tests. Layouts are
/// a pure function of (city, seed), so one instance per key is shared across tests;
/// determinism tests generate their own fresh instances.
/// </summary>
internal static class LandFixture
{
    private static readonly ConcurrentDictionary<(string City, int Seed), CityLayout> Layouts = new();

    public static ContentCatalog Catalog { get; } = ContentLoader.Load(ContentRoot());

    /// <summary>Seeds every invariant is checked against (the bridge default first).</summary>
    public static readonly int[] Seeds = [1, 7, 42, 20261001];

    public static IEnumerable<string> CityIds => Catalog.Cities.Keys.Select(k => k.Value).OrderBy(k => k, StringComparer.Ordinal);

    public static IEnumerable<object[]> Cities => CityIds.Select(id => new object[] { id });

    public static IEnumerable<object[]> CitiesAndSeeds => CityIds.SelectMany(id => Seeds.Select(seed => new object[] { id, seed }));

    public static IEnumerable<object[]> BuildingTypes => Catalog.BuildingTypes.Keys.Select(k => k.Value).OrderBy(k => k, StringComparer.Ordinal)
        .Select(id => new object[] { id });

    public static City City(string id) => Catalog.City(new CityId(id));

    public static BuildingType Type(string id) => Catalog.BuildingType(new BuildingTypeId(id));

    public static CityLayout Layout(string city, int seed = CityLayoutGenerator.DefaultSeed)
        => Layouts.GetOrAdd((city, seed), key => CityLayoutGenerator.Generate(City(key.City), key.Seed));

    /// <summary>The plots of a rectangle.</summary>
    public static IEnumerable<(int X, int Z)> Plots(PlotRect r)
    {
        for (var z = r.Pz; z < r.Bottom; z++)
        {
            for (var x = r.Px; x < r.Right; x++) yield return (x, z);
        }
    }

    private static string ContentRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json"))) dir = dir.Parent;
        if (dir is null) throw new DirectoryNotFoundException("repository root (global.json) not found above " + AppContext.BaseDirectory);
        return Path.Combine(dir.FullName, "content");
    }
}
