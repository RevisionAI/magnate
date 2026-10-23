using System;
using System.Collections.Generic;

namespace Magnate.Engine.Land.Generation;

// Stage 3 — land use: the caplab §5.3 ring model with the industrial wedge,
// port quays and arterial strips; reservations for the central park, campus,
// stadium, hospitals and public harbour; resource deposits; beaches; forest.
internal sealed partial class LayoutBuilder
{
    private readonly List<int> _droppedDeposits = new();
    private double _industryBearing;
    private double _cbdRho;
    private double _commercialRho;
    private double _apartmentRho;
    private ulong _wedgeNoise;

    // ------------------------------------------------------------------ districts

    private void AssignDistricts()
    {
        _industryBearing = IndustryBearing();
        _wedgeNoise = NoiseSeed("wedge");

        // Small towns still need a downtown to play in: the CBD keeps a radius of at
        // least ~3 plots (plus the channel when a river runs through it) and the
        // main-street ring at least 2.5 plots more.
        var riverExtra = _riverStart is null ? 0 : _riverWidth / 2.0 + 1;
        _cbdRho = Math.Max(P.CbdRho, (3.2 + riverExtra) / Ru);
        _commercialRho = Math.Max(P.CommercialRho, _cbdRho + 2.6 / Ru);
        _apartmentRho = Math.Max(P.ApartmentRho, _commercialRho + 1.5 / Ru);

        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                if (Reserve[i] != 0) continue; // the promenade keeps its park district
                if (!IsLand(i))
                {
                    Dist[i] = District.None;
                    continue;
                }
                var d = BaseDistrict(x, z);
                if (Quay[i]) d = District.Port;
                Dist[i] = d;
            }
        }

        // Main-street strips: one lot deep along stretches of the avenues through the
        // residential rings (gated by noise so they come and go), and ribbon
        // development along the highways just past the urban edge.
        var arterialDist = LandDistance(i => Road[i] >= RoadClass.Arterial, 3);
        var highwayDist = LandDistance(i => Road[i] == RoadClass.Highway, 3);
        var stripSeed = NoiseSeed("strips");
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                if (!IsLand(i) || IsRoad(i) || Reserve[i] != 0) continue;
                var r = Rho[i];
                if (Dist[i] is District.Apartments or District.Houses && r <= 0.85 && arterialDist[i] == 1
                    && Noise.Fbm(stripSeed, x, z, 7.0, 2) > 0.42 + 0.25 * r)
                {
                    Dist[i] = District.Mixed;
                }
                else if (Dist[i] == District.Rural && r <= 1.25 && highwayDist[i] <= 2)
                {
                    Dist[i] = highwayDist[i] == 1 && r <= 1.12 ? District.Mixed : District.Houses;
                }
            }
        }
    }

    /// <summary>The ring district of a dry plot from ρ, the industrial wedge and the river mills.</summary>
    private District BaseDistrict(int x, int z)
    {
        var r = Rho[Idx(x, z)];
        District d;
        if (r <= _cbdRho) d = District.Cbd;
        else if (r <= _commercialRho) d = District.Commercial;
        else if (InWedge(x, z, r)) d = District.Industrial;
        else if (r <= _apartmentRho) d = District.Apartments;
        else if (r <= 1.0) d = District.Houses;
        else d = District.Rural;

        if (P.RiverIndustry && _riverStart is not null && r >= 0.3 && r <= 1.08
            && d is District.Apartments or District.Houses or District.Rural
            && Downstream(x, z) && RiverDistance(x + 0.5, z + 0.5) <= _riverWidth / 2.0 + 6.5)
        {
            d = District.Industrial;
        }
        return d;
    }

    private double IndustryBearing()
    {
        if (P.IndustryBearingDeg is { } b) return b;
        if (_portRanges.Count > 0 && _coastDepth is not null)
        {
            var (t0, t1) = _portRanges[0];
            var tm = (t0 + t1) / 2;
            var (x, z) = FromCoast(tm, _coastDepth[tm]);
            return Bearing(x + 0.5, z + 0.5);
        }
        if (_riverStart is not null) return P.River == RiverCourse.NorthSouth ? 90 : 0;
        return 180;
    }

    private bool InWedge(int x, int z, double rho)
    {
        if (rho < P.IndustryRhoMin || rho > P.IndustryRhoMax) return false;
        var half = P.IndustryHalfWidthDeg + 7 * Noise.Signed(_wedgeNoise, x, z, 6.0, 2);
        return AngleDiff(Bearing(x + 0.5, z + 0.5), _industryBearing) <= half;
    }

    private bool Downstream(int x, int z) => P.River == RiverCourse.NorthSouth
        ? z + 0.5 > CbdZ + 0.15 * Rz
        : x + 0.5 > CbdX + 0.15 * Rx;

    /// <summary>BFS distance over dry land from the plots matching <paramref name="source"/> (sources at 0; capped).</summary>
    private int[] LandDistance(Func<int, bool> source, int cap)
    {
        var dist = new int[N];
        Array.Fill(dist, int.MaxValue);
        var queue = new int[N];
        int head = 0, tail = 0;
        for (var i = 0; i < N; i++)
        {
            if (!source(i)) continue;
            dist[i] = 0;
            queue[tail++] = i;
        }
        while (head < tail)
        {
            var c = queue[head++];
            if (dist[c] >= cap) continue;
            var x = c % W;
            var z = c / W;
            for (var k = 0; k < 4; k++)
            {
                var nx = x + Dx[k];
                var nz = z + Dz[k];
                if (!In(nx, nz)) continue;
                var n = nz * W + nx;
                if (dist[n] != int.MaxValue || !IsLand(n)) continue;
                dist[n] = dist[c] + 1;
                queue[tail++] = n;
            }
        }
        return dist;
    }

    // ------------------------------------------------------------------ reservations

    private Reservation AddReservation(PlotRect rect, ReservationUse use, LandmarkKind? landmark, CivicKind civic, District district, int depositIndex = -1)
    {
        var r = new Reservation
        {
            Id = Reservations.Count == 0 ? 1 : Reservations[^1].Id + 1,
            Rect = rect,
            Use = use,
            Landmark = landmark,
            Civic = civic,
            DepositIndex = depositIndex,
        };
        Reservations.Add(r);
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                var i = Idx(x, z);
                Reserve[i] = r.Id;
                Dist[i] = district;
            }
        }
        return r;
    }

    private void PlaceReservations()
    {
        var rng = Rng("reservations");
        var urban = 0;
        for (var i = 0; i < N; i++)
        {
            if (IsUrban(Dist[i])) urban++;
        }
        var pop = City.Population;

        // Central park next to the CBD (caplab §5.2: 2–4% of urban plots).
        var parkArea = Math.Clamp(P.ParkShare * urban, 12, 160);
        var parkSizes = new List<(int W, int H)>();
        for (var w = 3; w <= 16; w++)
        {
            for (var h = 3; h <= 16; h++)
            {
                var area = w * h;
                if (Math.Abs(area - parkArea) <= 0.35 * parkArea && Math.Max(w, h) <= 1.9 * Math.Min(w, h)) parkSizes.Add((w, h));
            }
        }
        ReserveAtCorners(parkSizes, Math.Max(0.38, _commercialRho + 0.06), 0.22, 0.7, 3, ParkFriendly, ReservationUse.Park, LandmarkKind.CentralPark, CivicKind.None, District.Park, rng, parkArea);

        if (pop >= 200_000)
        {
            ReserveAtCorners([(5, 5), (6, 5), (5, 6)], 0.45, 0.25, 0.75, 1, CampusFriendly, ReservationUse.Civic, LandmarkKind.University, CivicKind.University, District.Civic, rng);
        }
        if (pop >= 150_000)
        {
            ReserveAtCorners([(5, 5)], 0.72, 0.45, 1.0, 1, CampusFriendly, ReservationUse.Civic, LandmarkKind.Stadium, CivicKind.Stadium, District.Civic, rng);
        }
        var hospitals = Math.Max(1, (int)Math.Round(pop / 250_000.0));
        for (var k = 0; k < hospitals; k++)
        {
            ReserveAtCorners([(3, 3)], 0.42, 0.2, 0.8, 1, CampusFriendly, ReservationUse.Civic, LandmarkKind.Hospital, CivicKind.Hospital, District.Civic, rng);
        }

        // Industrial estates in the wedge: plots big enough for the largest factory
        // (5×5) in every city, however small its industry — one per ~150k people, so
        // several companies (player and AI) can each build a large plant.
        var estates = Math.Clamp((int)Math.Round(pop / 150_000.0, MidpointRounding.AwayFromZero), 1, 3);
        for (var k = 0; k < estates; k++) ReserveIndustrialEstate(rng);

        // Shopping centres at avenue crossings in the residential rings (caplab §5.3
        // "malls at arterial crossings"): the big-box sites of the city (a
        // department store is 4×4), spread out so every quarter has one.
        // One per ~70k people (2–7): every competitor needs somewhere to put a supermarket.
        var centres = P.ShoppingCentres ?? Math.Clamp((int)Math.Round(pop / 70_000.0, MidpointRounding.AwayFromZero), 2, 7);
        for (var k = 0; k < centres; k++)
        {
            ReserveAtCorners([(5, 5), (6, 5), (5, 6), (5, 4), (4, 5)], 0.62, _commercialRho, 0.95, 1, CentreFriendly,
                ReservationUse.Retail, null, CivicKind.None, District.Commercial, rng, spread: 0.7);
        }

        ReservePublicPort();
    }

    private static bool ParkFriendly(District d) => d is District.Cbd or District.Commercial or District.Mixed or District.Apartments or District.Houses;

    private static bool CampusFriendly(District d) => d is District.Commercial or District.Mixed or District.Apartments or District.Houses;

    private static bool CentreFriendly(District d) => d is District.Mixed or District.Apartments or District.Houses;

    /// <summary>
    /// Sets aside one large industrial plot on a trunk road inside (or at the edge
    /// of) the industrial wedge, preferring land already zoned industrial.
    /// </summary>
    private void ReserveIndustrialEstate(LayoutRandom rng)
    {
        PlotRect? best = null;
        var bestScore = double.MaxValue;
        var others = new List<(double X, double Z)>();
        foreach (var r in Reservations)
        {
            if (r.Use == ReservationUse.Industry) others.Add((r.Rect.Px + r.Rect.W / 2.0, r.Rect.Pz + r.Rect.H / 2.0));
        }

        // The centre plot must lie in (or just beside) the wedge: cheap filters first.
        var inWedge = new bool[N];
        for (var i = 0; i < N; i++)
        {
            var rho = Rho[i];
            inWedge[i] = rho >= 0.4 && rho <= 1.35 && AngleDiff(Bearing(i % W + 0.5, i / W + 0.5), _industryBearing) <= P.IndustryHalfWidthDeg + 12;
        }
        foreach (var (w, h) in new[] { (6, 6), (6, 5), (5, 6), (5, 5) })
        {
            var sizePenalty = (36 - w * h) * 0.05;
            for (var z = 0; z + h <= H; z++)
            {
                for (var x = 0; x + w <= W; x++)
                {
                    var centre = (z + h / 2) * W + x + w / 2;
                    if (!inWedge[centre]) continue;
                    var lower = Math.Abs(Rho[centre] - 0.85) + sizePenalty;
                    if (lower >= bestScore) continue;
                    var industrial = EstateCells(x, z, w, h);
                    if (industrial < 0) continue;
                    var score = lower + (1 - industrial / (double)(w * h)) * 4 + rng.NextDouble() * 0.2;
                    var cx = x + w / 2.0;
                    var cz = z + h / 2.0;
                    foreach (var (ox, oz) in others)
                    {
                        var od = Distance(cx, cz, ox, oz);
                        if (od < 0.5 * Ru) score += 3 * (0.5 * Ru - od) / Ru;
                    }
                    if (score < bestScore)
                    {
                        bestScore = score;
                        best = new PlotRect(x, z, w, h);
                    }
                }
            }
        }
        if (best is { } chosen) AddReservation(chosen, ReservationUse.Industry, null, CivicKind.None, District.Industrial);
    }

    /// <summary>Industrial plots in a candidate estate, or −1 when a plot is unusable or no plot fronts a collector.</summary>
    private int EstateCells(int x0, int z0, int w, int h)
    {
        var industrial = 0;
        var front = false;
        for (var z = z0; z < z0 + h; z++)
        {
            for (var x = x0; x < x0 + w; x++)
            {
                var i = z * W + x;
                if (!IsFree(i) || Slope[i] > 1 || Dist[i] is not (District.Industrial or District.Houses or District.Apartments or District.Rural or District.Mixed)) return -1;
                if (Dist[i] == District.Industrial) industrial++;
                front = front || HasFrontage(i, RoadClass.Collector);
            }
        }
        return front ? industrial : -1;
    }

    /// <summary>
    /// Places one reservation of one of <paramref name="sizes"/> anchored at a
    /// corner of a block's bounding box (so it fronts two avenues), choosing the
    /// candidate whose centre is nearest the target ρ, spread away from
    /// reservations of the same kind.
    /// </summary>
    private void ReserveAtCorners(
        IReadOnlyList<(int W, int H)> sizes,
        double rhoTarget,
        double rhoMin,
        double rhoMax,
        int maxSlope,
        Func<District, bool> districtOk,
        ReservationUse use,
        LandmarkKind? landmark,
        CivicKind civic,
        District district,
        LayoutRandom rng,
        double targetArea = 0,
        double spread = 0.6)
    {
        var badFlags = new bool[N];
        var goodFlags = new bool[N];
        for (var i = 0; i < N; i++)
        {
            badFlags[i] = !IsFree(i) || Slope[i] > maxSlope;
            goodFlags[i] = districtOk(Dist[i]);
        }
        var bad = Sat(badFlags);
        var good = Sat(goodFlags);
        PlotRect? best = null;
        var bestScore = double.MaxValue;
        foreach (var block in Blocks)
        {
            var b = block.Bounds;
            foreach (var (w, h) in sizes)
            {
                if (w > b.W || h > b.H) continue;
                for (var corner = 0; corner < 4; corner++)
                {
                    var px = corner % 2 == 0 ? b.Px : b.Right - w;
                    var pz = corner < 2 ? b.Pz : b.Bottom - h;
                    var rect = new PlotRect(px, pz, w, h);
                    if (SatCount(bad, rect) != 0 || SatCount(good, rect) < 0.8 * rect.Area) continue;
                    var cx = rect.Px + rect.W / 2.0;
                    var cz = rect.Pz + rect.H / 2.0;
                    var rho = Rho[Idx(Math.Min(W - 1, (int)cx), Math.Min(H - 1, (int)cz))];
                    if (rho < rhoMin || rho > rhoMax) continue;
                    var score = Math.Abs(rho - rhoTarget) * 4 + rng.NextDouble() * 0.12;
                    if (targetArea > 0) score += Math.Abs(rect.Area - targetArea) / targetArea;
                    foreach (var other in Reservations)
                    {
                        if (other.Landmark != landmark || other.Use != use) continue;
                        var od = Distance(cx, cz, other.Rect.Px + other.Rect.W / 2.0, other.Rect.Pz + other.Rect.H / 2.0);
                        if (od < spread * Ru) score += 3 * (spread * Ru - od) / Ru;
                    }
                    if (score < bestScore)
                    {
                        bestScore = score;
                        best = rect;
                    }
                }
            }
        }
        if (best is { } chosen) AddReservation(chosen, use, landmark, civic, district);
    }

    /// <summary>The public harbour terminal: a quayside rectangle in the first port window, nearest the CBD.</summary>
    private void ReservePublicPort()
    {
        if (_portRanges.Count == 0) return;
        var (w, h) = CoastAlongX ? (6, QuayDepth) : (QuayDepth, 6);
        var badFlags = new bool[N];
        for (var i = 0; i < N; i++) badFlags[i] = Dist[i] != District.Port || !IsFree(i);
        var bad = Sat(badFlags);
        PlotRect? best = null;
        var bestScore = double.MaxValue;
        for (var z = 0; z + h <= H; z++)
        {
            for (var x = 0; x + w <= W; x++)
            {
                var rect = new PlotRect(x, z, w, h);
                if (SatCount(bad, rect) != 0 || QuayCells(rect) < Math.Max(w, h) - 1) continue;
                var score = Distance(x + w / 2.0, z + h / 2.0, CbdX, CbdZ);
                if (score < bestScore)
                {
                    bestScore = score;
                    best = rect;
                }
            }
        }
        if (best is { } rectChosen) AddReservation(rectChosen, ReservationUse.Port, LandmarkKind.Port, CivicKind.Port, District.Port);
    }

    /// <summary>Number of plots along the rectangle's edge that touch the sea from outside.</summary>
    private int QuayCells(PlotRect rect)
    {
        var count = 0;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                for (var k = 0; k < 4; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    if (In(nx, nz) && !rect.Contains(nx, nz) && Water[Idx(nx, nz)] == WaterKind.Sea) count++;
                }
            }
        }
        return count;
    }

    // ------------------------------------------------------------------ deposits

    private void PlaceDeposits()
    {
        var rng = Rng("deposits");
        foreach (var plan in P.Deposits)
        {
            // Deposits exist exactly where the geography flags say.
            var allowed = plan.Resource switch
            {
                DepositKind.Iron => City.Geography.MineralRich,
                DepositKind.Oil => City.Geography.OilRich,
                _ => false,
            };
            if (!allowed) continue;

            for (var k = 0; k < Math.Clamp(plan.Count, 1, 6); k++)
            {
                var w = plan.Resource == DepositKind.Iron ? rng.Range(5, 6) : rng.Range(4, 5);
                var h = plan.Resource == DepositKind.Iron ? rng.Range(4, 6) : rng.Range(4, 5);
                PlaceDeposit(plan, w, h, rng);
            }
            for (var k = 0; k < plan.OffshoreCount && _coastDepth is not null; k++) PlaceOffshore(plan.Resource, rng);
        }
    }

    private void PlaceDeposit(DepositPlan plan, int w, int h, LayoutRandom rng)
    {
        var badFlags = new bool[N];
        for (var i = 0; i < N; i++) badFlags[i] = Dist[i] != District.Rural || !IsFree(i) || Slope[i] > 1;
        var bad = Sat(badFlags);
        PlotRect? best = null;
        var bestScore = double.MaxValue;
        for (var z = 1; z + h < H; z++)
        {
            for (var x = 1; x + w < W; x++)
            {
                var rect = new PlotRect(x, z, w, h);
                // Keep the mines and wells in the countryside, not hard against the urban edge.
                if (Rho[Idx(x + w / 2, z + h / 2)] < 1.12 || SatCount(bad, rect) != 0) continue;
                var cx = x + w / 2.0;
                var cz = z + h / 2.0;
                var score = AngleDiff(Bearing(cx, cz), plan.BearingDeg) / 60.0 + rng.NextDouble() * 0.6;
                foreach (var other in DepositDrafts)
                {
                    var od = Distance(cx, cz, other.Rect.Px + other.Rect.W / 2.0, other.Rect.Pz + other.Rect.H / 2.0);
                    if (od < 9) score += (9 - od) * 0.8;
                }
                if (score < bestScore)
                {
                    bestScore = score;
                    best = rect;
                }
            }
        }
        if (best is not { } chosen) return;

        var quality = rng.Range(35, 85);
        var reserve = plan.Resource == DepositKind.Oil
            ? Math.Round(rng.Range(4.0, 15.0) * (0.6 + quality / 100.0), 1) * 1_000_000
            : Math.Round(rng.Range(3.0, 12.0) * (0.6 + quality / 100.0), 1) * 1_000_000;
        DepositDrafts.Add(new DepositDraft { Resource = plan.Resource, Rect = chosen, Quality = quality, Reserve = reserve, Offshore = false });
        var index = DepositDrafts.Count - 1;
        AddReservation(chosen, ReservationUse.Deposit, null, CivicKind.None, District.Rural, index);
        for (var z = chosen.Pz; z < chosen.Bottom; z++)
        {
            for (var x = chosen.Px; x < chosen.Right; x++) DepositOf[Idx(x, z)] = index + 1;
        }
    }

    private void PlaceOffshore(DepositKind resource, LayoutRandom rng)
    {
        var landDist = SeaDistanceFromLand();
        PlotRect? best = null;
        var bestScore = double.MaxValue;
        for (var z = 0; z + 2 <= H; z++)
        {
            for (var x = 0; x + 2 <= W; x++)
            {
                var ok = true;
                for (var dz = 0; dz < 2 && ok; dz++)
                {
                    for (var dx = 0; dx < 2 && ok; dx++)
                    {
                        var i = Idx(x + dx, z + dz);
                        if (Water[i] != WaterKind.Sea || landDist[i] < 3 || DepositOf[i] != 0) ok = false;
                    }
                }
                if (!ok) continue;
                var score = rng.NextDouble() + (InPortWindow(x, z, 3) ? 5 : 0);
                foreach (var other in DepositDrafts)
                {
                    if (!other.Offshore) continue;
                    var od = Distance(x, z, other.Rect.Px, other.Rect.Pz);
                    if (od < 12) score += 12 - od;
                }
                if (score < bestScore)
                {
                    bestScore = score;
                    best = new PlotRect(x, z, 2, 2);
                }
            }
        }
        if (best is not { } chosen) return;
        var quality = rng.Range(45, 85);
        DepositDrafts.Add(new DepositDraft
        {
            Resource = resource,
            Rect = chosen,
            Quality = quality,
            Reserve = Math.Round(rng.Range(8.0, 25.0), 1) * 1_000_000,
            Offshore = true,
        });
        var id = DepositDrafts.Count;
        for (var z = chosen.Pz; z < chosen.Bottom; z++)
        {
            for (var x = chosen.Px; x < chosen.Right; x++) DepositOf[Idx(x, z)] = id;
        }
    }

    /// <summary>For sea plots: BFS distance (over water) from the nearest land plot.</summary>
    private int[] SeaDistanceFromLand()
    {
        var dist = new int[N];
        Array.Fill(dist, int.MaxValue);
        var queue = new int[N];
        int head = 0, tail = 0;
        for (var i = 0; i < N; i++)
        {
            if (Water[i] != WaterKind.None) continue;
            dist[i] = 0;
            queue[tail++] = i;
        }
        while (head < tail)
        {
            var c = queue[head++];
            var x = c % W;
            var z = c / W;
            for (var k = 0; k < 4; k++)
            {
                var nx = x + Dx[k];
                var nz = z + Dz[k];
                if (!In(nx, nz)) continue;
                var n = nz * W + nx;
                if (dist[n] != int.MaxValue) continue;
                dist[n] = dist[c] + 1;
                queue[tail++] = n;
            }
        }
        return dist;
    }

    // ------------------------------------------------------------------ beaches and forest

    private void MarkBeaches()
    {
        if (_coastDepth is null || !P.Beaches) return;
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                if (!IsFree(i) || Dist[i] is not (District.Houses or District.Apartments or District.Rural or District.Mixed)) continue;
                if (InPortWindow(x, z, 2) || InCbdWaterfront(x, z)) continue;
                var nearSea = false;
                for (var k = 0; k < 4 && !nearSea; k++)
                {
                    var nx = x + Dx[k];
                    var nz = z + Dz[k];
                    nearSea = In(nx, nz) && Water[Idx(nx, nz)] == WaterKind.Sea;
                }
                if (!nearSea) continue;
                Beach[i] = true;
                Dist[i] = District.None;
            }
        }
    }

    private void MarkForest()
    {
        var seed = NoiseSeed("forest");
        var noise = new double[N];
        var values = new List<double>(N);
        for (var z = 0; z < H; z++)
        {
            for (var x = 0; x < W; x++)
            {
                var i = Idx(x, z);
                if (Dist[i] != District.Rural || !IsFree(i)) continue;
                noise[i] = Noise.Fbm(seed, x, z, 6.0, 3) + (Rho[i] > 1.3 ? 0.05 : 0);
                values.Add(noise[i]);
            }
        }
        if (values.Count == 0) return;
        values.Sort();
        var threshold = values[Math.Clamp((int)((1 - P.ForestShare) * values.Count), 0, values.Count - 1)];
        for (var i = 0; i < N; i++)
        {
            if (Dist[i] != District.Rural || !IsFree(i)) continue;
            Forest[i] = noise[i] >= threshold || Slope[i] >= 3;
        }
    }
}
