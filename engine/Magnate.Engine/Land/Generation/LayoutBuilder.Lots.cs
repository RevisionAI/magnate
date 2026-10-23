using System;
using System.Collections.Generic;

namespace Magnate.Engine.Land.Generation;

// Stage 4 — lots: reservations become parcels, civic sites are picked inside
// blocks (city hall by the main crossing, banks, schools, police, fire,
// churches), then every block is subdivided by walking its road frontage and
// growing lots inward ("frontage-greedy"), so every parcel touches a road.
internal sealed partial class LayoutBuilder
{
    /// <summary>
    /// A civic site to find. Downtown sites (<paramref name="NearCbd"/>) aim for
    /// <paramref name="CbdOffset"/> plots from the CBD centre (so the hall frames the
    /// core instead of eating it); others aim for a ρ band and keep apart by
    /// <paramref name="Spread"/>·R_u.
    /// </summary>
    private sealed record CivicRequest(
        LandmarkKind? Landmark,
        CivicKind Civic,
        AmbientKind Ambient,
        (int W, int H)[] Sizes,
        District[] Districts,
        RoadClass MinFrontage,
        double RhoTarget,
        bool NearCbd,
        double Spread,
        double CbdOffset = 0);

    private RoadClass[] _frontage = Array.Empty<RoadClass>();

    private void BuildLots()
    {
        var rng = Rng("lots");

        // The road network is final now: cache each plot's best adjacent road class.
        _frontage = new RoadClass[N];
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var best = RoadClass.None;
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (In(nx, nz) && Road[nz * W + nx] > best) best = Road[nz * W + nx];
                }
                _frontage[z * W + x] = best;
            }
        }

        foreach (var r in Reservations)
        {
            var lot = new LotDraft(r.Rect, Dist[Idx(r.Rect.Px, r.Rect.Pz)])
            {
                Reservation = r,
                Landmark = r.Landmark,
                Civic = r.Civic,
                DepositIndex = r.DepositIndex,
            };
            AddLot(lot);
        }

        PlaceCivicLots(rng);
        SubdivideBlocks(rng);
        AbsorbLeftovers(strictDistrict: true);
        AbsorbLeftovers(strictDistrict: false);
        FillRemainder();
    }

    private void AddLot(LotDraft lot)
    {
        Lots.Add(lot);
        var id = Lots.Count;
        for (var z = lot.Rect.Pz; z < lot.Rect.Bottom; z++)
        {
            for (var x = lot.Rect.Px; x < lot.Rect.Right; x++) LotOf[Idx(x, z)] = id;
        }
    }

    private bool Open(int i) => IsFree(i) && LotOf[i] == 0;

    /// <summary>Every plot open, in an allowed district and gentle enough, with at least one plot fronting a road of <paramref name="minFrontage"/>.</summary>
    private bool CivicSiteOk(int x0, int z0, int w, int h, Span<bool> districtOk, int slopeLimit, RoadClass minFrontage)
    {
        var front = false;
        for (var z = z0; z < z0 + h; z++)
        {
            var row = z * W;
            for (var x = x0; x < x0 + w; x++)
            {
                var i = row + x;
                if (!Open(i) || !districtOk[(int)Dist[i]] || Slope[i] > slopeLimit) return false;
                if (!front)
                {
                    var f = _frontage[i];
                    front = f != RoadClass.None && f >= minFrontage;
                }
            }
        }
        return front;
    }

    // ------------------------------------------------------------------ civic sites

    private void PlaceCivicLots(LayoutRandom rng)
    {
        var pop = City.Population;
        var bigHall = pop >= 400_000;
        District[] downtown = [District.Cbd, District.Commercial];
        District[] residential = [District.Apartments, District.Houses, District.Mixed];
        var cbdRadius = _cbdRho * Ru;
        var requests = new List<CivicRequest>
        {
            new(LandmarkKind.CityHall, CivicKind.Hall, AmbientKind.Civic, bigHall ? [(4, 4), (4, 3), (3, 4)] : [(3, 3), (3, 2), (2, 3)],
                downtown, RoadClass.Collector, 0, true, 0, 0.9 * cbdRadius),
        };
        if (P.StockExchange)
        {
            requests.Add(new(LandmarkKind.StockExchange, CivicKind.Exchange, AmbientKind.Civic, [(3, 3), (3, 2), (2, 3)], downtown, RoadClass.Collector, 0, true, 0, 0.6 * cbdRadius));
        }
        requests.Add(new(LandmarkKind.Bank, CivicKind.Bank, AmbientKind.Civic, [(2, 2), (2, 1), (1, 2)], downtown, RoadClass.Local, 0, true, 0, cbdRadius));
        if (P.InvestmentBank)
        {
            requests.Add(new(LandmarkKind.InvestmentBank, CivicKind.Bank, AmbientKind.Civic, [(2, 2), (2, 1), (1, 2)], downtown, RoadClass.Local, 0, true, 0, 0.7 * cbdRadius));
        }
        requests.Add(new(null, CivicKind.None, AmbientKind.Plaza, [(2, 2), (3, 2), (2, 3), (2, 1)], downtown, RoadClass.Local, 0, true, 0, cbdRadius));

        for (var k = 0; k < P.Churches; k++)
        {
            // The first church of a hill town stands on the square beside the hall.
            var onSquare = k == 0 && P.Terrain == TerrainStyle.Plateau;
            requests.Add(new(null, CivicKind.Church, AmbientKind.Civic, [(2, 2), (2, 1), (1, 2)],
                onSquare ? downtown : residential, RoadClass.Local, onSquare ? 0 : 0.55, onSquare, 0.5));
        }

        var schools = Math.Max(1, (int)Math.Round(pop / 70_000.0));
        for (var k = 0; k < schools; k++)
        {
            requests.Add(new(null, CivicKind.School, AmbientKind.Civic, [(3, 3), (3, 2), (2, 3), (2, 2)], residential, RoadClass.Local, 0.55, false, 0.45));
        }
        var stations = Math.Max(1, (int)Math.Round(pop / 200_000.0));
        for (var k = 0; k < stations; k++)
        {
            requests.Add(new(null, CivicKind.Police, AmbientKind.Civic, [(2, 2), (2, 1), (1, 2), (1, 1)],
                [District.Apartments, District.Houses, District.Mixed, District.Commercial], RoadClass.Local, 0.45, false, 0.5));
            requests.Add(new(null, CivicKind.Fire, AmbientKind.Civic, [(2, 2), (2, 1), (1, 2), (1, 1)],
                [District.Apartments, District.Houses, District.Mixed, District.Commercial], RoadClass.Local, 0.5, false, 0.5));
        }

        foreach (var request in requests) PlaceCivic(request, rng);
    }

    private PlotOrder? _byRho;
    private PlotOrder? _byCbdDistance;

    private void PlaceCivic(CivicRequest request, LayoutRandom rng)
    {
        Span<bool> districtOk = stackalloc bool[16];
        foreach (var d in request.Districts) districtOk[(int)d] = true;
        var same = new List<(double X, double Z)>();
        foreach (var lot in Lots)
        {
            if (lot.Civic == request.Civic) same.Add((lot.Rect.Px + lot.Rect.W / 2.0, lot.Rect.Pz + lot.Rect.H / 2.0));
        }

        // Walk the plots outward from the target (a ρ, or a distance from the CBD
        // centre); a plot is the centre of the candidate site. The score is the
        // centre's distance from the target plus size, jitter and spread penalties,
        // which only add — so the walk stops once its distance alone cannot win.
        PlotOrder order;
        double scale;
        if (request.NearCbd)
        {
            if (_byCbdDistance is null)
            {
                var keys = new double[N];
                for (var i = 0; i < N; i++) keys[i] = CbdDistance(i % W, i / W);
                _byCbdDistance = new PlotOrder(keys);
            }
            order = _byCbdDistance;
            order.Start(request.CbdOffset);
            scale = 1;
        }
        else
        {
            _byRho ??= new PlotOrder(Rho);
            order = _byRho;
            order.Start(request.RhoTarget);
            scale = Ru;
        }
        var reach = 0.8 * Ru + 3;

        PlotRect? best = null;
        var bestScore = double.MaxValue;
        var largest = request.Sizes[0].W * request.Sizes[0].H;
        var minGap = request.Spread * Ru;
        while (order.Next(out var centre, out var gap))
        {
            var baseScore = gap * scale;
            if (baseScore >= bestScore) break;
            var px = centre % W;
            var pz = centre / W;
            if (request.NearCbd && CbdDistance(px, pz) > reach) continue;
            foreach (var (sw, sh) in request.Sizes)
            {
                var score = baseScore + (largest - sw * sh) * 0.6; // prefer the first (largest) size
                var x = px - sw / 2;
                var z = pz - sh / 2;
                if (score >= bestScore || x < 0 || z < 0 || x + sw > W || z + sh > H) continue;
                var slopeLimit = sw <= 2 && sh <= 2 ? 2 : 1;
                if (!CivicSiteOk(x, z, sw, sh, districtOk, slopeLimit, request.MinFrontage)) continue;
                score += rng.NextDouble() * 0.5;
                var cx = x + sw / 2.0;
                var cz = z + sh / 2.0;
                foreach (var (ox, oz) in same)
                {
                    var od = Distance(cx, cz, ox, oz);
                    if (od < minGap) score += 4 * (minGap - od);
                }
                if (score < bestScore)
                {
                    bestScore = score;
                    best = new PlotRect(x, z, sw, sh);
                }
            }
        }
        if (best is not { } chosen) return;

        var lotDraft = new LotDraft(chosen, request.Civic == CivicKind.None ? District.Park : District.Civic)
        {
            Landmark = request.Landmark,
            Civic = request.Civic,
        };
        if (request.Ambient == AmbientKind.Plaza)
        {
            lotDraft.District = District.Park;
            lotDraft.Ambient = new AmbientBuilding(AmbientKind.Plaza, 0, rng.Next(8));
        }
        AddLot(lotDraft);
        for (var z = chosen.Pz; z < chosen.Bottom; z++)
        {
            for (var x = chosen.Px; x < chosen.Right; x++) Dist[Idx(x, z)] = lotDraft.District;
        }
    }

    // ------------------------------------------------------------------ frontage-greedy subdivision

    private void SubdivideBlocks(LayoutRandom rng)
    {
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                if (!Open(i)) continue;
                var side = BestRoadSide(x, z);
                if (side < 0) continue;
                PlaceFrontageLot(x, z, side, rng);
            }
        }
    }

    /// <summary>
    /// Index into Dx/Dz of the neighbour road with the highest class (ties: S, E, N, W), or −1.
    /// Highways count below streets because lots take access from streets.
    /// </summary>
    private int BestRoadSide(int x, int z)
    {
        var best = -1;
        var bestScore = 0;
        for (var k = 0; k < 4; k++)
        {
            var nx = x + Dx[k];
            var nz = z + Dz[k];
            if (!In(nx, nz)) continue;
            var score = FacingScore(Road[Idx(nx, nz)]);
            if (score > bestScore)
            {
                bestScore = score;
                best = k;
            }
        }
        return best;
    }

    /// <summary>art §5.3 facing weights: arterial 3, street 2, highway 1.</summary>
    private static int FacingScore(RoadClass c) => c switch
    {
        RoadClass.Arterial => 3,
        RoadClass.Collector or RoadClass.Local => 2,
        RoadClass.Highway => 1,
        _ => 0,
    };

    private void PlaceFrontageLot(int x, int z, int side, LayoutRandom rng)
    {
        var district = Dist[Idx(x, z)];
        // Inward = away from the road; along = perpendicular (+x for N/S roads, +z for E/W roads).
        var ix = -Dx[side];
        var iz = -Dz[side];
        var ax = Dz[side] != 0 ? 1 : 0;
        var az = Dz[side] != 0 ? 0 : 1;

        var (wPref, dPref) = LotSize(district, rng);

        var run = 0;
        int cx = x, cz = z;
        while (run < 12 && In(cx, cz) && Open(Idx(cx, cz)) && Dist[Idx(cx, cz)] == district)
        {
            run++;
            cx += ix;
            cz += iz;
        }
        var farRoad = In(cx, cz) && IsRoad(Idx(cx, cz));
        var maxDepth = MaxDepth(district);
        int allowed;
        if (farRoad && run <= maxDepth) allowed = run;
        else if (farRoad) allowed = Math.Min(maxDepth, (run + 1) / 2);
        else allowed = Math.Min(run, maxDepth);
        var depthUse = Math.Max(1, Math.Min(dPref, allowed));

        for (var w = wPref; w >= 1; w--)
        {
            for (var d = depthUse; d >= 1; d--)
            {
                foreach (var dir in new[] { 1, -1 })
                {
                    if (TryLot(x, z, ax * dir, az * dir, ix, iz, w, d, district, out var rect))
                    {
                        AddLot(new LotDraft(rect, district));
                        return;
                    }
                }
            }
        }
    }

    private bool TryLot(int x, int z, int ax, int az, int ix, int iz, int w, int d, District district, out PlotRect rect)
    {
        int minX = int.MaxValue, minZ = int.MaxValue, maxX = int.MinValue, maxZ = int.MinValue;
        for (var a = 0; a < w; a++)
        {
            for (var b = 0; b < d; b++)
            {
                var px = x + ax * a + ix * b;
                var pz = z + az * a + iz * b;
                if (!In(px, pz)) goto fail;
                var i = Idx(px, pz);
                if (!Open(i) || Dist[i] != district) goto fail;
                minX = Math.Min(minX, px);
                minZ = Math.Min(minZ, pz);
                maxX = Math.Max(maxX, px);
                maxZ = Math.Max(maxZ, pz);
            }
        }
        rect = new PlotRect(minX, minZ, maxX - minX + 1, maxZ - minZ + 1);
        return true;

    fail:
        rect = default;
        return false;
    }

    /// <summary>Preferred lot (width along the street, depth into the block) by district.</summary>
    private (int W, int D) LotSize(District d, LayoutRandom rng) => d switch
    {
        District.Cbd => (2 + rng.Weighted([0.3, 0.45, 0.25]), rng.Range(3, 4)),
        District.Commercial => (1 + rng.Weighted([0.3, 0.45, 0.25]), rng.Range(2, 3)),
        District.Mixed => (1 + rng.Weighted([0.45, 0.4, 0.15]), 1 + rng.Weighted([0.4, 0.6])),
        District.Apartments => (rng.Range(2, 3), rng.Range(2, 3)),
        District.Houses => (rng.Chance(P.VillaShare * 0.5) ? 2 : 1, rng.Chance(0.25 + P.VillaShare * 0.3) ? 2 : 1),
        District.Industrial => (rng.Range(3, 6), rng.Range(3, 6)),
        District.Port => (rng.Range(5, 7), 4),
        District.Rural => (rng.Range(3, 7), rng.Range(4, 7)),
        _ => (rng.Range(1, 3), rng.Range(1, 3)),
    };

    // ------------------------------------------------------------------ leftovers

    /// <summary>Grows existing lots by whole rows or columns to swallow unassigned cells (lots stay rectangular).</summary>
    private void AbsorbLeftovers(bool strictDistrict)
    {
        for (var pass = 0; pass < 6; pass++)
        {
            var changed = false;
            for (var i = 0; i < N; i++)
            {
                if (!Open(i)) continue;
                var x = i % W;
                var z = i / W;
                for (var k = 0; k < 4 && Open(i); k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (!In(nx, nz)) continue;
                    var lotId = LotOf[Idx(nx, nz)];
                    if (lotId == 0) continue;
                    var lot = Lots[lotId - 1];
                    if (lot.Reservation is not null || lot.Civic != CivicKind.None || lot.District is District.Park) continue;
                    if (TryGrow(lot, lotId, -Dx[k], -Dz[k], strictDistrict)) changed = true;
                }
            }
            if (!changed) return;
        }
    }

    /// <summary>Extends <paramref name="lot"/> by one row/column in direction (dx, dz) if the whole strip is open.</summary>
    private bool TryGrow(LotDraft lot, int lotId, int dx, int dz, bool strictDistrict)
    {
        var r = lot.Rect;
        PlotRect grown;
        if (dx == 1) grown = new PlotRect(r.Px, r.Pz, r.W + 1, r.H);
        else if (dx == -1) grown = new PlotRect(r.Px - 1, r.Pz, r.W + 1, r.H);
        else if (dz == 1) grown = new PlotRect(r.Px, r.Pz, r.W, r.H + 1);
        else grown = new PlotRect(r.Px, r.Pz - 1, r.W, r.H + 1);
        if (grown.Px < 0 || grown.Pz < 0 || grown.Right > W || grown.Bottom > H) return false;
        if (Math.Max(grown.W, grown.H) > (lot.District == District.Rural ? 12 : 9)) return false;

        for (var z = grown.Pz; z < grown.Bottom; z++)
        {
            for (var x = grown.Px; x < grown.Right; x++)
            {
                if (r.Contains(x, z)) continue;
                var i = Idx(x, z);
                if (!Open(i)) return false;
                if (strictDistrict && Dist[i] != lot.District) return false;
                if (!strictDistrict && !IsUrban(Dist[i]) && Dist[i] != District.Rural) return false;
            }
        }
        lot.Rect = grown;
        for (var z = grown.Pz; z < grown.Bottom; z++)
        {
            for (var x = grown.Px; x < grown.Right; x++)
            {
                var i = Idx(x, z);
                LotOf[i] = lotId;
                Dist[i] = lot.District;
            }
        }
        return true;
    }

    /// <summary>Turns remaining open cells into rectangular lots when they touch a road; the rest stays open land.</summary>
    private void FillRemainder()
    {
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                if (!Open(i)) continue;
                var district = Dist[i];
                var w = 1;
                while (x + w < W && Open(Idx(x + w, z)) && Dist[Idx(x + w, z)] == district && w < 6) w++;
                var h = 1;
                while (z + h < H && h < 6)
                {
                    var rowOk = true;
                    for (var a = 0; a < w && rowOk; a++)
                    {
                        var j = Idx(x + a, z + h);
                        rowOk = Open(j) && Dist[j] == district;
                    }
                    if (!rowOk) break;
                    h++;
                }
                var rect = new PlotRect(x, z, w, h);
                if (RectTouchesRoad(rect))
                {
                    AddLot(new LotDraft(rect, district));
                }
                else
                {
                    // Landlocked courtyard: leave as open land (no parcel).
                    for (var b = 0; b < h; b++)
                    {
                        for (var a = 0; a < w; a++) LotOf[Idx(x + a, z + b)] = -1;
                    }
                }
            }
        }
        for (var i = 0; i < N; i++)
        {
            if (LotOf[i] == -1) LotOf[i] = 0;
        }
    }

    private bool RectTouchesRoad(PlotRect rect)
    {
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (In(nx, nz) && IsRoad(Idx(nx, nz))) return true;
                }
            }
        }
        return false;
    }
}
