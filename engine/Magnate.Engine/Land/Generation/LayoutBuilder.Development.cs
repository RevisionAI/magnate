using System;
using System.Collections.Generic;

namespace Magnate.Engine.Land.Generation;

// Stage 5 — development and freezing: ambient buildings and land covers per
// lot, vacancy and listings, the traffic and land-value fields, storeys from
// land-value percentiles, then the immutable CityLayout.
internal sealed partial class LayoutBuilder
{
    private void AssignDevelopment()
    {
        var rng = Rng("development");
        foreach (var lot in Lots)
        {
            if (lot.Ambient is not null) continue; // presets (plazas)
            lot.Ambient = ChooseAmbient(lot, rng);
        }

        foreach (var lot in Lots)
        {
            var listed = lot.District switch
            {
                District.Park or District.Civic => false,
                District.Rural => true,
                _ => lot.Ambient is null,
            };
            if (lot.Landmark is not null || lot.Civic != CivicKind.None) listed = false;
            lot.ForSale = listed;
        }
    }

    private AmbientBuilding? ChooseAmbient(LotDraft lot, LayoutRandom rng)
    {
        var variant = rng.Next(8);
        var area = lot.Rect.Area;
        var longSide = Math.Max(lot.Rect.W, lot.Rect.H);
        var shortSide = Math.Min(lot.Rect.W, lot.Rect.H);

        if (lot.Reservation is { } res)
        {
            return res.Use switch
            {
                ReservationUse.Deposit => new AmbientBuilding(AmbientKind.Deposit, 0, variant, Deposit: DepositDrafts[res.DepositIndex].Resource),
                ReservationUse.Park => new AmbientBuilding(shortSide == 1 ? AmbientKind.Plaza : AmbientKind.Park, 0, variant),
                ReservationUse.Port => new AmbientBuilding(AmbientKind.Civic, 0, variant, CivicKind.Port),
                ReservationUse.Industry => null, // a serviced industrial estate, listed for sale (never a buy-out)
                ReservationUse.Retail => rng.Weighted([0.5, 0.25, 0.25]) switch
                {
                    0 => null, // a vacant big-box site, listed for sale
                    1 => new AmbientBuilding(AmbientKind.Parking, 0, variant),
                    _ => new AmbientBuilding(AmbientKind.StripMall, 0, variant),
                },
                _ => new AmbientBuilding(AmbientKind.Civic, 0, variant, res.Civic),
            };
        }
        if (lot.Civic != CivicKind.None) return new AmbientBuilding(AmbientKind.Civic, 0, variant, lot.Civic);

        AmbientKind? Pick(params (AmbientKind? Kind, double Weight)[] options)
        {
            Span<double> weights = stackalloc double[options.Length];
            for (var k = 0; k < options.Length; k++) weights[k] = options[k].Weight;
            return options[rng.Weighted(weights)].Kind;
        }

        AmbientKind? kind;
        switch (lot.District)
        {
            case District.Cbd:
                // Downtown is built up even on small lots: towers on the big ones, mid-rise
                // blocks (and the odd narrow office) on the rest; single-storey shops are rare.
                kind = area >= 4
                    ? Pick((AmbientKind.Office, 0.74), (null, 0.18), (AmbientKind.Plaza, 0.03), (AmbientKind.Parking, 0.05))
                    : area >= 2
                        ? Pick((AmbientKind.Office, 0.3), (AmbientKind.Midrise, 0.32), (AmbientKind.Shop, 0.1), (null, 0.23), (AmbientKind.Plaza, 0.05))
                        : Pick((AmbientKind.Midrise, 0.45), (AmbientKind.Shop, 0.2), (null, 0.3), (AmbientKind.Plaza, 0.05));
                break;
            case District.Commercial:
                kind = area >= 4
                    ? Pick((AmbientKind.Midrise, 0.42), (AmbientKind.Office, 0.08), (AmbientKind.StripMall, longSide >= 3 && shortSide <= 2 ? 0.1 : 0),
                        (AmbientKind.Parking, 0.06), (null, 0.34))
                    : Pick((AmbientKind.Shop, 0.5), (AmbientKind.Midrise, area >= 2 ? 0.18 : 0), (AmbientKind.Parking, 0.04), (null, 0.28));
                break;
            case District.Mixed:
                kind = Pick((AmbientKind.Shop, 0.46), (AmbientKind.Midrise, area >= 2 ? 0.16 : 0),
                    (AmbientKind.StripMall, longSide >= 3 ? 0.1 : 0), (AmbientKind.Parking, 0.03), (null, 0.3));
                break;
            case District.Apartments:
                kind = area >= 4
                    ? Pick((AmbientKind.Apartment, 0.68), (AmbientKind.Midrise, 0.04), (AmbientKind.Park, 0.04), (null, 0.24))
                    : Pick((AmbientKind.Rowhouse, 0.45), (AmbientKind.House, 0.25), (null, 0.3));
                break;
            case District.Houses:
                if (area >= 4) kind = Pick((AmbientKind.Villa, 0.55), (AmbientKind.Park, 0.15), (null, 0.3));
                else
                {
                    var villa = P.VillaShare * (area >= 2 ? 1.6 : 1.0) * (Slope[Idx(lot.Rect.Px, lot.Rect.Pz)] >= 1 ? 1.4 : 1.0);
                    var row = P.RowhouseShare * (area >= 2 ? 0.5 : 1.0);
                    var house = Math.Max(0.1, 1 - villa - row);
                    kind = Pick((AmbientKind.House, house * 0.88), (AmbientKind.Rowhouse, row * 0.88), (AmbientKind.Villa, villa * 0.88),
                        (AmbientKind.Park, 0.02), (null, 0.1));
                }
                break;
            case District.Industrial:
                kind = Pick((AmbientKind.Factory, 0.27), (AmbientKind.Warehouse, 0.23),
                    (AmbientKind.TankFarm, City.Geography.OilRich ? 0.12 : 0), (AmbientKind.Parking, 0.03), (null, 0.45));
                break;
            case District.Port:
                kind = Pick((AmbientKind.Warehouse, 0.22), (null, 0.78));
                break;
            case District.Rural:
                kind = RuralCover(lot, rng);
                break;
            case District.Park:
                kind = shortSide == 1 ? AmbientKind.Plaza : AmbientKind.Park;
                break;
            default:
                kind = null;
                break;
        }
        return kind is { } k ? new AmbientBuilding(k, 0, variant) : null;
    }

    private AmbientKind RuralCover(LotDraft lot, LayoutRandom rng)
    {
        int forest = 0, slope = 0;
        for (var z = lot.Rect.Pz; z < lot.Rect.Bottom; z++)
        {
            for (var x = lot.Rect.Px; x < lot.Rect.Right; x++)
            {
                var i = Idx(x, z);
                if (Forest[i]) forest++;
                slope += Slope[i];
            }
        }
        if (forest * 2 >= lot.Rect.Area) return AmbientKind.Forest;

        var hilly = slope >= lot.Rect.Area; // average slope class ≥ 1
        var arable = City.Geography.Arable;
        Span<double> w =
        [
            arable ? P.FieldWeight * (hilly ? 0.5 : 1.0) : 0,
            P.PastureWeight,
            arable ? P.OrchardWeight * (hilly ? 2.2 : 1.0) : 0,
            arable ? P.VineyardWeight * (hilly ? 2.5 : 0.6) : 0,
            arable ? 0 : P.ScrubWeight,
        ];
        return rng.Weighted(w) switch
        {
            0 => AmbientKind.Field,
            1 => AmbientKind.Pasture,
            2 => AmbientKind.Orchard,
            3 => AmbientKind.Vineyard,
            _ => AmbientKind.Scrub,
        };
    }

    // ------------------------------------------------------------------ freeze

    private CityLayout Freeze()
    {
        // Parcel ids in row-major order of the NW corner (corners are unique: lots never overlap).
        var order = new int[Lots.Count];
        for (var k = 0; k < order.Length; k++) order[k] = k;
        Array.Sort(order, (a, b) => (Lots[a].Rect.Pz * W + Lots[a].Rect.Px).CompareTo(Lots[b].Rect.Pz * W + Lots[b].Rect.Px));
        var parcelIdOfLot = new int[Lots.Count];
        for (var k = 0; k < order.Length; k++) parcelIdOfLot[order[k]] = k + 1;

        var kind = new PlotKind[N];
        var district = new District[N];
        var parcelId = new int[N];
        var uses = new LandUse[N];
        for (var i = 0; i < N; i++)
        {
            if (IsRoad(i))
            {
                kind[i] = PlotKind.Road;
            }
            else if (!IsLand(i))
            {
                kind[i] = PlotKind.Water;
            }
            else if (Beach[i])
            {
                kind[i] = PlotKind.Beach;
            }
            else if (LotOf[i] > 0)
            {
                kind[i] = PlotKind.Parcel;
                var lot = Lots[LotOf[i] - 1];
                district[i] = lot.District;
                parcelId[i] = parcelIdOfLot[LotOf[i] - 1];
                uses[i] = lot.Ambient is { } a ? LandUses.ForAmbient(a.Kind) : LandUse.Vacant;
            }
            else
            {
                kind[i] = PlotKind.Open;
                district[i] = Dist[i];
                uses[i] = LandUse.Vacant;
            }
        }

        // Deposits whose reservation could not be given road access were dropped:
        // renumber the survivors 1..n in draft order.
        var depositId = new int[DepositDrafts.Count];
        var deposits = new List<Deposit>();
        for (var k = 0; k < DepositDrafts.Count; k++)
        {
            if (_droppedDeposits.Contains(k)) continue;
            var d = DepositDrafts[k];
            depositId[k] = deposits.Count + 1;
            deposits.Add(new Deposit(deposits.Count + 1, d.Resource, d.Rect, d.Quality, d.Reserve, d.Offshore));
        }
        var depositIds = new int[N];
        var depositQuality = new int[N];
        var depositResource = new DepositKind[N];
        for (var i = 0; i < N; i++)
        {
            if (DepositOf[i] == 0) continue;
            var draft = DepositOf[i] - 1;
            if (depositId[draft] == 0) continue;
            depositIds[i] = depositId[draft];
            var d = DepositDrafts[draft];
            if (d.Offshore) continue;
            depositQuality[i] = d.Quality;
            depositResource[i] = d.Resource;
        }

        var geometry = new FieldGeometry
        {
            Width = W,
            Height = H,
            Road = Road,
            Water = Water,
            District = district,
            Kind = kind,
            Slope = Slope,
            DepositQuality = depositQuality,
            DepositResource = depositResource,
            CbdX = CbdX,
            CbdZ = CbdZ,
            UrbanRadius = Ru,
            BaseLandPrice = City.BaseLandPrice,
            HillViews = P.Terrain == TerrainStyle.Plateau,
        };

        // Strip malls pull customers (caplab §5.4 mallBoost), in parcel order so a
        // recompute from the frozen layout sums the boosts identically.
        var attractors = new List<TrafficAttractor>();
        foreach (var k in order)
        {
            var lot = Lots[k];
            if (lot.Ambient?.Kind == AmbientKind.StripMall)
            {
                attractors.Add(CityFields.StripMallAttractor(lot.Rect));
            }
        }
        var traffic = TrafficModel.Compute(geometry, uses, attractors);
        var landValue = LandValueModel.Compute(geometry, uses, traffic);
        AssignFloors(landValue);

        var parcels = new Parcel[Lots.Count];
        var landmarks = new List<Landmark>();
        for (var k = 0; k < order.Length; k++)
        {
            var lot = Lots[order[k]];
            var id = k + 1;
            decimal sum = 0;
            var trafficSum = 0.0;
            for (var z = lot.Rect.Pz; z < lot.Rect.Bottom; z++)
            {
                for (var x = lot.Rect.Px; x < lot.Rect.Right; x++)
                {
                    var i = Idx(x, z);
                    sum += landValue[i];
                    trafficSum += traffic[i];
                }
            }
            var area = lot.Rect.Area;
            var vacant = lot.Ambient is null || !lot.Ambient.IsStructure;
            var parcel = new Parcel(
                id,
                lot.Rect,
                lot.District,
                sum,
                Math.Round(sum / area, 0, MidpointRounding.ToEven),
                Math.Round(trafficSum / area, 1),
                lot.ForSale,
                vacant,
                lot.Ambient,
                ParcelFacing(lot.Rect, lot.District),
                ParcelFrontage(lot.Rect),
                lot.DepositIndex >= 0 ? depositId[lot.DepositIndex] : 0,
                lot.Landmark);
            parcels[k] = parcel;
            if (lot.Landmark is { } lm) landmarks.Add(new Landmark(lm, id, lot.Rect));
        }
        landmarks.Sort((a, b) => a.Kind != b.Kind ? a.Kind.CompareTo(b.Kind) : a.ParcelId.CompareTo(b.ParcelId));

        var fields = new CityFields(W, H, landValue, traffic, CityFields.MedianUrban(kind, district, traffic));

        var roads = BuildRoadList();
        var water = BuildWaterRects(kind, district);

        return new CityLayout(
            City,
            Seed,
            P.Key,
            P.Terrain,
            P.Climate,
            CbdX,
            CbdZ,
            Ru,
            kind,
            (RoadClass[])Road.Clone(),
            district,
            (WaterKind[])Water.Clone(),
            parcelId,
            depositIds,
            (byte[])Slope.Clone(),
            Corners,
            uses,
            fields,
            roads,
            parcels,
            water,
            landmarks,
            deposits);
    }

    private void AssignFloors(decimal[] landValue)
    {
        var rng = Rng("floors");
        var meanValue = new double[Lots.Count];
        for (var k = 0; k < Lots.Count; k++)
        {
            var r = Lots[k].Rect;
            decimal sum = 0;
            for (var z = r.Pz; z < r.Bottom; z++)
            {
                for (var x = r.Px; x < r.Right; x++) sum += landValue[Idx(x, z)];
            }
            meanValue[k] = (double)sum / r.Area;
        }

        // Height rises with the land-value percentile within each tall archetype (caplab §5.3).
        var percentile = new double[Lots.Count];
        foreach (var kind in new[] { AmbientKind.Office, AmbientKind.Apartment, AmbientKind.Midrise })
        {
            var members = new List<int>();
            for (var k = 0; k < Lots.Count; k++)
            {
                if (Lots[k].Ambient?.Kind == kind) members.Add(k);
            }
            members.Sort((a, b) => meanValue[a] != meanValue[b] ? meanValue[a].CompareTo(meanValue[b]) : a.CompareTo(b));
            for (var rank = 0; rank < members.Count; rank++)
            {
                percentile[members[rank]] = members.Count == 1 ? 1.0 : rank / (double)(members.Count - 1);
            }
        }

        for (var k = 0; k < Lots.Count; k++)
        {
            var lot = Lots[k];
            if (lot.Ambient is not { } a) continue;
            var pct = percentile[k];
            var jitter = rng.Range(-1.0, 1.0);
            int floors = a.Kind switch
            {
                AmbientKind.Office => Interp(P.OfficeFloorsMin, P.OfficeFloorsMax, Math.Pow(pct, 1.4), jitter, lot.Rect.Area < 6 ? 0.75 : 1.0),
                AmbientKind.Apartment => Interp(P.ApartmentFloorsMin, P.ApartmentFloorsMax, pct, jitter, 1.0),
                AmbientKind.Midrise => Interp(3, P.MidriseFloorsMax, pct, jitter, 1.0),
                AmbientKind.House => rng.Chance(0.6) ? 2 : 1,
                AmbientKind.Rowhouse => rng.Chance(0.6) ? 2 : 3,
                AmbientKind.Villa => 2,
                AmbientKind.Shop => rng.Chance(0.7) ? 1 : 2,
                AmbientKind.StripMall or AmbientKind.Factory or AmbientKind.Warehouse or AmbientKind.TankFarm => 1,
                AmbientKind.Civic => CivicFloors(a.Civic, lot.Landmark, rng),
                _ => 0,
            };
            lot.Ambient = a with { Floors = floors };
        }
    }

    private static int Interp(int min, int max, double t, double jitter, double cap)
    {
        var range = Math.Max(0, max - min);
        var v = min + range * t * cap + jitter * 0.08 * range;
        return Math.Clamp((int)Math.Round(v), min, Math.Max(min, (int)Math.Round(min + range * cap)));
    }

    private int CivicFloors(CivicKind civic, LandmarkKind? landmark, LayoutRandom rng) => civic switch
    {
        CivicKind.Bank when landmark == LandmarkKind.InvestmentBank => Math.Max(8, P.OfficeFloorsMax / 3 + rng.Range(0, 4)),
        CivicKind.Hall or CivicKind.Exchange or CivicKind.Bank => 3,
        CivicKind.School => rng.Range(2, 3),
        CivicKind.Hospital => Math.Min(9, Math.Max(4, P.ApartmentFloorsMax - 3)),
        CivicKind.University => 4,
        CivicKind.Stadium or CivicKind.Port => 1,
        _ => 2,
    };

    private Facing ParcelFacing(PlotRect rect, District district)
    {
        // Sides in art §3.2 order: S = 0, E = 1, N = 2, W = 3.
        Span<int> score = stackalloc int[4];
        Span<int> sea = stackalloc int[4];
        for (var x = rect.Px; x < rect.Right; x++)
        {
            Side(x, rect.Bottom, 0, ref score, ref sea);
            Side(x, rect.Pz - 1, 2, ref score, ref sea);
        }
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            Side(rect.Right, z, 1, ref score, ref sea);
            Side(rect.Px - 1, z, 3, ref score, ref sea);
        }

        var best = 0;
        if (district == District.Port)
        {
            for (var s = 1; s < 4; s++)
            {
                if (sea[s] > sea[best]) best = s;
            }
            if (sea[best] > 0) return (Facing)best;
        }
        best = 0;
        for (var s = 1; s < 4; s++)
        {
            if (score[s] > score[best]) best = s;
        }
        return (Facing)best;

        void Side(int x, int z, int side, ref Span<int> scores, ref Span<int> seas)
        {
            if (!In(x, z)) return;
            var i = Idx(x, z);
            scores[side] = Math.Max(scores[side], FacingScore(Road[i]));
            if (Water[i] == WaterKind.Sea && Road[i] == RoadClass.None) seas[side]++;
        }
    }

    private RoadClass ParcelFrontage(PlotRect rect)
    {
        var best = RoadClass.None;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (!In(nx, nz) || rect.Contains(nx, nz)) continue;
                    var c = Road[Idx(nx, nz)];
                    if (c > best) best = c;
                }
            }
        }
        return best;
    }

    private List<Road> BuildRoadList()
    {
        MergeSpans();
        var roads = new List<Road>(Spans.Count);
        var id = 1;
        var ordered = new List<RoadSpan>(Spans);
        ordered.Sort((a, b) =>
        {
            var c = a.Vertical.CompareTo(b.Vertical);
            if (c != 0) return c;
            c = a.Fixed.CompareTo(b.Fixed);
            if (c != 0) return c;
            c = a.From.CompareTo(b.From);
            return c != 0 ? c : b.Class.CompareTo(a.Class);
        });
        foreach (var s in ordered)
        {
            var bridge = false;
            for (var t = s.From; t <= s.To && !bridge; t++) bridge = Water[SpanIndex(s.Vertical, s.Fixed, t)] != WaterKind.None;
            var lanes = s.Class switch
            {
                RoadClass.Highway => P.HighwayLanes,
                RoadClass.Arterial => 4,
                _ => 2,
            };
            roads.Add(new Road(id++, s.Class, lanes, new PlotPoint(s.X(s.From), s.Z(s.From)), new PlotPoint(s.X(s.To), s.Z(s.To)), bridge));
        }
        return roads;
    }

    /// <summary>
    /// Water as rectangles grouped by (kind, shore). A water plot's shore is
    /// <c>quay</c> beside port, industrial, downtown or promenade land, <c>beach</c>
    /// beside sand, otherwise none (open water or a natural bank).
    /// </summary>
    private List<WaterRect> BuildWaterRects(PlotKind[] kind, District[] district)
    {
        var shore = new ShoreKind[N];
        for (var i = 0; i < N; i++)
        {
            if (kind[i] != PlotKind.Water) continue;
            var x = i % W;
            var z = i / W;
            var s = ShoreKind.None;
            for (var k = 0; k < 4; k++)
            {
                var nx = x + Dx[k];
                var nz = z + Dz[k];
                if (!In(nx, nz)) continue;
                var j = Idx(nx, nz);
                if (kind[j] == PlotKind.Beach && s == ShoreKind.None) s = ShoreKind.Beach;
                var hard = kind[j] == PlotKind.Road
                    || (kind[j] == PlotKind.Parcel && district[j] is District.Port or District.Industrial or District.Cbd or District.Commercial or District.Park);
                if (hard && kind[j] != PlotKind.Water) s = ShoreKind.Quay;
            }
            shore[i] = s;
        }

        // Row-by-row run merging: a run extends the rectangle above it when it has
        // exactly the same span, kind and shore; otherwise it starts a new one.
        var result = new List<WaterRect>();
        var aboveEnd = new int[W];
        var aboveIndex = new int[W];
        var hereEnd = new int[W];
        var hereIndex = new int[W];
        Array.Fill(aboveEnd, -1);
        for (var z = 0; z < H; z++)
        {
            Array.Fill(hereEnd, -1);
            var x = 0;
            while (x < W)
            {
                var i = Idx(x, z);
                if (kind[i] != PlotKind.Water)
                {
                    x++;
                    continue;
                }
                var k = Water[i];
                var s = shore[i];
                var x1 = x;
                while (x1 + 1 < W && kind[Idx(x1 + 1, z)] == PlotKind.Water && Water[Idx(x1 + 1, z)] == k && shore[Idx(x1 + 1, z)] == s) x1++;

                var index = -1;
                if (aboveEnd[x] == x1)
                {
                    var r = result[aboveIndex[x]];
                    if (r.Kind == k && r.Shore == s)
                    {
                        index = aboveIndex[x];
                        result[index] = r with { Rect = new PlotRect(r.Rect.Px, r.Rect.Pz, r.Rect.W, r.Rect.H + 1) };
                    }
                }
                if (index < 0)
                {
                    result.Add(new WaterRect(new PlotRect(x, z, x1 - x + 1, 1), k, s));
                    index = result.Count - 1;
                }
                hereEnd[x] = x1;
                hereIndex[x] = index;
                x = x1 + 1;
            }
            (aboveEnd, hereEnd) = (hereEnd, aboveEnd);
            (aboveIndex, hereIndex) = (hereIndex, aboveIndex);
        }
        return result;
    }
}
