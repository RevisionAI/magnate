using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Persistence.Sections;

/// <summary>
/// Schema-v10 save section for the land area (E3b): the game's layout seed, per city the layout
/// revision, the development signature of the last month close, demolished ambient parcels and
/// plots held without a building, and per building its site, land cost, construction in progress,
/// construction schedule and retirement. Serialised as the nullable <c>land</c> property of the
/// save file; omitted for worlds without land rules (Classic), so their saves are unchanged.
/// <para>
/// Layouts and land-value / traffic fields are not stored: both are pure functions of the
/// persisted state (layout seed; development sited before the current month), so a load rebuilds
/// them bit for bit. Decimals are invariant-culture strings, like the rest of the save.
/// </para>
/// </summary>
internal sealed record LandSaveSection
{
    /// <summary>The seed every city layout of the game is generated from.</summary>
    public int? LayoutSeed { get; init; }

    /// <summary>Cities whose land state exists, ordinal by id.</summary>
    public IReadOnlyList<CityLandSaveDto>? Cities { get; init; }

    /// <summary>Buildings with land state (site, land, construction, retirement), by id.</summary>
    public IReadOnlyList<BuildingLandSaveDto>? Buildings { get; init; }

    /// <summary>Snapshot the area's state; null for worlds without land rules (the section is then omitted).</summary>
    internal static LandSaveSection? Capture(World world)
    {
        if (!world.Rules.Land.Enabled) return null;

        var cities = new List<CityLandSaveDto>();
        foreach (var (city, land) in world.LandCities())
        {
            var cleared = land.Cleared.Select(kv => new ClearedParcelDto(kv.Key, kv.Value.Year, kv.Value.Month)).ToList();
            var held = land.HeldPlots().Select(h => new HeldPlotDto(h.Px, h.Pz, h.Owner, D(h.Basis))).ToList();
            cities.Add(new CityLandSaveDto(
                city.Value,
                land.LayoutRev,
                land.TickSignature,
                cleared.Count == 0 ? null : cleared,
                held.Count == 0 ? null : held));
        }

        var buildings = new List<BuildingLandSaveDto>();
        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Placement is null && b.Construction is null)
            {
                continue;
            }
            ConstructionSaveDto? construction = null;
            if (b.Construction is { } c)
            {
                construction = new ConstructionSaveDto(
                    c.OrderedAt.Year, c.OrderedAt.Month, c.StartedAt.Year, c.StartedAt.Month, c.CompletesAt.Year, c.CompletesAt.Month,
                    c.AwaitingSite ? true : null, c.MonthsTotal, c.MonthsRemaining, D(c.CostPaid), D(c.CostRemaining),
                    D(c.Deposit), D(c.Instalment), D(c.FinalInstalment), c.PausedMonths);
            }
            buildings.Add(new BuildingLandSaveDto(
                b.Id.Value,
                b.Placement?.Px,
                b.Placement?.Pz,
                b.Placement?.Rotation,
                b.SitedAt?.Year,
                b.SitedAt?.Month,
                // Land and CIP live in the finance section's asset register since the E2 x E3b
                // integration; retired buildings in its retired registry. These fields are read
                // only to migrate saves written before it.
                null,
                null,
                null,
                null,
                construction));
        }

        return new LandSaveSection
        {
            LayoutSeed = world.LayoutSeed,
            Cities = cities,
            Buildings = buildings,
        };
    }

    /// <summary>
    /// Apply a persisted section to a freshly rebuilt world (called after companies, buildings,
    /// logs and RNG are restored). A land-rules world saved before the land integration has no
    /// section: it keeps layout seed 1 and its buildings are sited free of charge (migration).
    /// </summary>
    internal static void Restore(World world, LandSaveSection? section)
    {
        if (section is null)
        {
            if (!world.Rules.Land.Enabled) return;
            world.RestoreLayoutSeed(CityLayoutGenerator.DefaultSeed);
            world.MigrateUnsitedBuildings();
            return;
        }

        world.RestoreLayoutSeed(section.LayoutSeed ?? CityLayoutGenerator.DefaultSeed);

        var retired = new List<(BuildingInstance Building, GameDate At)>();
        foreach (var dto in section.Buildings ?? (IReadOnlyList<BuildingLandSaveDto>)System.Array.Empty<BuildingLandSaveDto>())
        {
            if (!world.InternalBuildings.TryGetValue(new BuildingInstanceId(dto.Id), out var b)) continue;
            if (dto.Px is int px && dto.Pz is int pz) b.Placement = new PlotRef(px, pz, dto.Rotation ?? 0);
            b.SitedAt = Date(dto.SitedYear, dto.SitedMonth);
            // Saves written before the E2 x E3b integration carried land and CIP here (interim
            // shim) and kept cancelled buildings in the world: move both to the finance register.
            if (M(dto.LandCost) is var landCost and > 0m) world.CapitalizeLand(b.Id, landCost);
            if (M(dto.Cip) is var cip and > 0m) world.AddConstructionInProgress(b.Id, cip);
            if (Date(dto.RetiredYear, dto.RetiredMonth) is GameDate retiredAt) retired.Add((b, retiredAt));
            if (dto.Construction is { } c)
            {
                b.Construction = new ConstructionState(
                    new GameDate(c.OrderYear, c.OrderMonth),
                    new GameDate(c.StartYear, c.StartMonth),
                    new GameDate(c.CompletesYear, c.CompletesMonth),
                    c.AwaitingSite == true,
                    c.MonthsTotal,
                    c.MonthsRemaining,
                    M(c.CostPaid),
                    M(c.CostRemaining),
                    M(c.Deposit),
                    M(c.Instalment),
                    M(c.FinalInstalment),
                    c.PausedMonths);
            }
        }

        foreach (var dto in section.Cities ?? (IReadOnlyList<CityLandSaveDto>)System.Array.Empty<CityLandSaveDto>())
        {
            var id = new CityId(dto.CityId);
            if (!world.Catalog.Cities.ContainsKey(id)) continue;
            var land = world.LandOf(id);
            land.LayoutRev = dto.LayoutRev;
            land.TickSignature = dto.TickSignature;
            foreach (var c in dto.Cleared ?? (IReadOnlyList<ClearedParcelDto>)System.Array.Empty<ClearedParcelDto>())
            {
                land.Clear(c.ParcelId, new GameDate(c.Year, c.Month));
            }
            foreach (var h in dto.Held ?? (IReadOnlyList<HeldPlotDto>)System.Array.Empty<HeldPlotDto>())
            {
                if (land.Layout.InBounds(h.Px, h.Pz)) land.Hold(h.Px, h.Pz, h.Owner, M(h.Basis));
            }
        }

        foreach (var (b, at) in retired) world.RetireLoaded(b, at);
        world.RebuildOccupancy();
    }

    private static string D(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    private static decimal M(string? value) => value is null ? 0m : decimal.Parse(value, NumberStyles.Number, CultureInfo.InvariantCulture);

    private static GameDate? Date(int? year, int? month) => year is int y && month is int m ? new GameDate(y, m) : null;
}

/// <summary>One city's land state.</summary>
internal sealed record CityLandSaveDto(
    string CityId,
    int LayoutRev,
    ulong TickSignature,
    IReadOnlyList<ClearedParcelDto>? Cleared,
    IReadOnlyList<HeldPlotDto>? Held);

/// <summary>A parcel whose ambient structure was bought out, with the month.</summary>
internal sealed record ClearedParcelDto(int ParcelId, int Year, int Month);

/// <summary>A plot held without a building: owner company and cost basis.</summary>
internal sealed record HeldPlotDto(int Px, int Pz, int Owner, string Basis);

/// <summary>A building's land state.</summary>
internal sealed record BuildingLandSaveDto(
    int Id,
    int? Px,
    int? Pz,
    int? Rotation,
    int? SitedYear,
    int? SitedMonth,
    string? LandCost,
    string? Cip,
    int? RetiredYear,
    int? RetiredMonth,
    ConstructionSaveDto? Construction);

/// <summary>A construction schedule in progress.</summary>
internal sealed record ConstructionSaveDto(
    int OrderYear,
    int OrderMonth,
    int StartYear,
    int StartMonth,
    int CompletesYear,
    int CompletesMonth,
    bool? AwaitingSite,
    int MonthsTotal,
    int MonthsRemaining,
    string CostPaid,
    string CostRemaining,
    string Deposit,
    string Instalment,
    string FinalInstalment,
    int PausedMonths);
