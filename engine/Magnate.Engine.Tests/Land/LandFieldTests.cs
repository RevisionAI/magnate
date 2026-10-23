using System.Linq;
using Magnate.Engine.Land;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>The land-value and traffic models (caplab-brief §5.4) and their public recompute API.</summary>
public sealed class LandFieldTests
{
    [Theory]
    [MemberData(nameof(LandFixture.Cities), MemberType = typeof(LandFixture))]
    public void Recomputing_with_the_generated_land_uses_reproduces_the_generated_fields(string city)
    {
        var layout = LandFixture.Layout(city);
        var fields = CityFields.Compute(layout, layout.LandUses, CityFields.AmbientAttractors(layout));
        Assert.True(fields.Traffic.SequenceEqual(layout.TrafficValues));
        Assert.True(fields.LandValues.SequenceEqual(layout.LandValues));
        Assert.Equal(layout.MedianUrbanTraffic, fields.MedianUrbanTraffic);
    }

    [Fact]
    public void A_mall_draws_traffic_and_new_offices_raise_nearby_land_values()
    {
        var layout = LandFixture.Layout("riverside");
        var site = layout.Parcels.First(p => p.District == District.Houses);
        var x = site.Px + 0.5;
        var z = site.Pz + 0.5;
        var baseFields = CityFields.Compute(layout, layout.LandUses);
        var withMall = CityFields.Compute(layout, layout.LandUses, [new TrafficAttractor(x, z, 5, 20)]);
        Assert.True(withMall.TrafficAt(site.Px, site.Pz) > baseFields.TrafficAt(site.Px, site.Pz));
        Assert.True(withMall.TrafficAt(site.Px, site.Pz) <= 100);

        var uses = layout.LandUses.ToArray();
        var factories = (LandUse[])uses.Clone();
        for (var dz = -3; dz <= 3; dz++)
        {
            for (var dx = -3; dx <= 3; dx++)
            {
                var px = site.Px + dx;
                var pz = site.Pz + dz;
                if (!layout.InBounds(px, pz) || layout.KindAt(px, pz) != PlotKind.Parcel || (dx == 0 && dz == 0)) continue;
                uses[pz * layout.Width + px] = LandUse.Office;
                factories[pz * layout.Width + px] = LandUse.Factory;
            }
        }
        var offices = CityFields.Compute(layout, uses);
        var smoke = CityFields.Compute(layout, factories);
        Assert.True(offices.LandValueAt(site.Px, site.Pz) > baseFields.LandValueAt(site.Px, site.Pz));
        Assert.True(smoke.LandValueAt(site.Px, site.Pz) < baseFields.LandValueAt(site.Px, site.Pz));
    }

    [Fact]
    public void Model_curves_match_caplab()
    {
        Assert.Equal(3.0, LandValueModel.Centrality(0, 20), 6);
        Assert.InRange(LandValueModel.Centrality(0.45 * 20, 20), 1.25, 1.27);
        Assert.InRange(LandValueModel.Centrality(20, 20), 0.26, 0.28);
        Assert.InRange(LandValueModel.Centrality(500, 20), 0.25, 0.2501);
        Assert.Equal(1.0, TrafficModel.RoadFactor(RoadClass.Arterial));
        Assert.Equal(0.3, TrafficModel.RoadFactor(RoadClass.Local));
        Assert.True(LandValueModel.ZoneFactor(District.Cbd, LandUse.Office) > LandValueModel.ZoneFactor(District.Industrial, LandUse.Factory));
        Assert.True(LandValueModel.ZoneFactor(District.Industrial, LandUse.Factory) > LandValueModel.ZoneFactor(District.Rural, LandUse.Farm));
        Assert.True(LandValueModel.NeighbourhoodWeight(LandUse.Office) > 0 && LandValueModel.NeighbourhoodWeight(LandUse.Factory) < 0);
    }

    [Fact]
    public void Location_factor_is_clamped()
    {
        var layout = LandFixture.Layout("metropolis");
        var f = layout.Fields;
        Assert.Equal(0.3, f.LocationFactor(0));
        Assert.Equal(2.5, f.LocationFactor(100));
        Assert.All(layout.Parcels, p => Assert.InRange(layout.LocationFactorAt(p.Px, p.Pz), 0.3, 2.5));
    }
}
