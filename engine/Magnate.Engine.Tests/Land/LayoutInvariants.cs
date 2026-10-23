using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Land;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// Structural invariants every generated layout must satisfy, whatever the city
/// or seed. Shared by the per-city theories and the modded-city tests.
/// </summary>
internal static class LayoutInvariants
{
    private static readonly (int Dx, int Dz)[] Neighbours = [(0, 1), (1, 0), (0, -1), (-1, 0)];

    public static void AssertAll(CityLayout layout)
    {
        RoadsFormOneNetwork(layout);
        NoTwoByTwoRoadSquares(layout);
        ParcelsTileTheirPlots(layout);
        EveryParcelTouchesARoad(layout);
        RoadListMatchesTheGrid(layout);
        BridgesRunBankToBankInOneClass(layout);
        WaterRectsCoverTheWater(layout);
        FieldsAreInRange(layout);
    }

    /// <summary>All road plots are 4-connected to each other.</summary>
    public static void RoadsFormOneNetwork(CityLayout l)
    {
        var roads = Enumerable.Range(0, l.PlotCount).Where(i => l.RoadClasses[i] != RoadClass.None).ToList();
        Assert.NotEmpty(roads);
        var seen = new bool[l.PlotCount];
        var queue = new Queue<int>();
        queue.Enqueue(roads[0]);
        seen[roads[0]] = true;
        var reached = 0;
        while (queue.Count > 0)
        {
            var c = queue.Dequeue();
            reached++;
            foreach (var (dx, dz) in Neighbours)
            {
                var x = c % l.Width + dx;
                var z = c / l.Width + dz;
                if (!l.InBounds(x, z)) continue;
                var n = z * l.Width + x;
                if (seen[n] || l.RoadClasses[n] == RoadClass.None) continue;
                seen[n] = true;
                queue.Enqueue(n);
            }
        }
        Assert.True(reached == roads.Count, $"{l.CityId}/{l.Seed}: {roads.Count - reached} of {roads.Count} road plots are cut off from the network");
    }

    /// <summary>A 1-plot street grid never has a 2×2 square of road plots (that is two parallel roads side by side).</summary>
    public static void NoTwoByTwoRoadSquares(CityLayout l)
    {
        for (var z = 0; z + 1 < l.Height; z++)
        {
            for (var x = 0; x + 1 < l.Width; x++)
            {
                var all = l.RoadAt(x, z) != RoadClass.None && l.RoadAt(x + 1, z) != RoadClass.None
                    && l.RoadAt(x, z + 1) != RoadClass.None && l.RoadAt(x + 1, z + 1) != RoadClass.None;
                Assert.False(all, $"{l.CityId}/{l.Seed}: 2×2 road square at ({x},{z})");
            }
        }
    }

    /// <summary>Parcel rectangles and the per-plot parcel ids describe exactly the same partition.</summary>
    public static void ParcelsTileTheirPlots(CityLayout l)
    {
        var covered = new int[l.PlotCount];
        foreach (var p in l.Parcels)
        {
            Assert.True(p.W >= 1 && p.H >= 1 && p.Px >= 0 && p.Pz >= 0 && p.Rect.Right <= l.Width && p.Rect.Bottom <= l.Height, $"parcel {p.Id} {p.Rect}");
            decimal sum = 0;
            foreach (var (x, z) in LandFixture.Plots(p.Rect))
            {
                var i = z * l.Width + x;
                Assert.True(covered[i] == 0, $"{l.CityId}/{l.Seed}: parcels {covered[i]} and {p.Id} overlap at ({x},{z})");
                covered[i] = p.Id;
                Assert.Equal(PlotKind.Parcel, l.Kinds[i]);
                Assert.Equal(p.Id, l.ParcelIds[i]);
                Assert.Equal(p.District, l.Districts[i]);
                sum += l.LandValues[i];
            }
            Assert.Equal(sum, p.LandValue);
            Assert.Equal(p.ForSale ? p.LandValue : null, p.AskingPrice);
            if (p.Landmark is not null || p.District is District.Civic or District.Park) Assert.False(p.ForSale, $"public parcel {p.Id} is for sale");
            if (p.Ambient is { IsStructure: true }) Assert.False(p.Vacant);
        }
        for (var i = 0; i < l.PlotCount; i++)
        {
            Assert.Equal(l.Kinds[i] == PlotKind.Parcel, covered[i] != 0);
        }
    }

    /// <summary>Every parcel has at least one road plot 4-adjacent to it from outside.</summary>
    public static void EveryParcelTouchesARoad(CityLayout l)
    {
        foreach (var p in l.Parcels)
        {
            var touches = false;
            foreach (var (x, z) in LandFixture.Plots(p.Rect))
            {
                foreach (var (dx, dz) in Neighbours)
                {
                    var nx = x + dx;
                    var nz = z + dz;
                    if (l.InBounds(nx, nz) && !p.Rect.Contains(nx, nz) && l.RoadAt(nx, nz) != RoadClass.None) touches = true;
                }
            }
            Assert.True(touches, $"{l.CityId}/{l.Seed}: parcel {p.Id} {p.Rect} ({p.District}) has no road frontage");
            Assert.NotEqual(RoadClass.None, p.Frontage);
        }
    }

    /// <summary>The road segments and the per-plot road classes agree.</summary>
    public static void RoadListMatchesTheGrid(CityLayout l)
    {
        var best = new RoadClass[l.PlotCount];
        var ids = new HashSet<int>();
        foreach (var r in l.Roads)
        {
            Assert.True(ids.Add(r.Id));
            Assert.True(r.Start.Px == r.End.Px || r.Start.Pz == r.End.Pz, $"road {r.Id} is not axis-aligned");
            Assert.InRange(r.Lanes, 2, 6);
            foreach (var p in r.Path())
            {
                var i = p.Pz * l.Width + p.Px;
                Assert.True(l.RoadClasses[i] >= r.Class, $"road {r.Id} passes ({p.Px},{p.Pz}) which is not a {r.Class} road");
                if (r.Class > best[i]) best[i] = r.Class;
            }
            var wet = r.Path().Any(p => l.WaterAt(p.Px, p.Pz) != WaterKind.None);
            Assert.Equal(wet, r.Bridge);
        }
        for (var i = 0; i < l.PlotCount; i++)
        {
            Assert.Equal(l.RoadClasses[i], best[i]);
            Assert.Equal(l.RoadClasses[i] != RoadClass.None, l.Kinds[i] == PlotKind.Road);
        }
    }

    /// <summary>
    /// Every bridge is one segment of one class from shore to shore: both ends stand
    /// on land and every wet plot carries exactly the bridge's class (no avenue that
    /// turns into a local street half-way across).
    /// </summary>
    public static void BridgesRunBankToBankInOneClass(CityLayout l)
    {
        foreach (var r in l.Roads.Where(r => r.Bridge))
        {
            var path = r.Path().ToList();
            Assert.True(l.WaterAt(path[0].Px, path[0].Pz) == WaterKind.None && l.WaterAt(path[^1].Px, path[^1].Pz) == WaterKind.None,
                $"bridge {r.Id} ends on the water");
            foreach (var p in path.Where(p => l.WaterAt(p.Px, p.Pz) != WaterKind.None))
            {
                Assert.True(l.RoadAt(p.Px, p.Pz) == r.Class, $"bridge {r.Id} ({r.Class}) changes class at ({p.Px},{p.Pz})");
                Assert.DoesNotContain(l.Roads, o => o.Id != r.Id && o.Path().Contains(p));
            }
        }
    }

    /// <summary>Water rectangles cover the open-water plots exactly once.</summary>
    public static void WaterRectsCoverTheWater(CityLayout l)
    {
        var covered = new bool[l.PlotCount];
        foreach (var w in l.Water)
        {
            foreach (var (x, z) in LandFixture.Plots(w.Rect))
            {
                var i = z * l.Width + x;
                Assert.False(covered[i], $"water rects overlap at ({x},{z})");
                covered[i] = true;
                Assert.Equal(PlotKind.Water, l.Kinds[i]);
                Assert.Equal(w.Kind, l.WaterKinds[i]);
            }
        }
        for (var i = 0; i < l.PlotCount; i++) Assert.Equal(l.Kinds[i] == PlotKind.Water, covered[i]);
    }

    /// <summary>Traffic is 0–100, land values are positive on land and zero on roads, water and beaches.</summary>
    public static void FieldsAreInRange(CityLayout l)
    {
        for (var i = 0; i < l.PlotCount; i++)
        {
            Assert.InRange(l.TrafficValues[i], 0, 100);
            if (l.Kinds[i] is PlotKind.Parcel or PlotKind.Open) Assert.True(l.LandValues[i] > 0, $"plot {i} has no land value");
            else Assert.Equal(0m, l.LandValues[i]);
        }
        Assert.True(l.MedianUrbanTraffic > 0);
    }
}
