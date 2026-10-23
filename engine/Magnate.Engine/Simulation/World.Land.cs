using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Land;

namespace Magnate.Engine.Simulation;

// City land (workstream E3b): one generated layout per city and game, the plots company
// buildings occupy, land titles (plots held without a building), parcels whose ambient
// structure was bought out, the monthly land-value / traffic fields and the layout revision.
// Everything here is inert under Classic rules (LandRules.Enabled = false) except the layout
// queries, which the bridge also serves for Classic games.
public sealed partial class World
{
    private readonly Dictionary<CityId, CityLand> _cityLand = new();
    private int? _layoutSeed;
    private bool _landRulesValidated;

    /// <summary>
    /// The seed every city layout of this game is generated from. New worlds under land rules
    /// use the world seed (so each game has its own cities); Classic worlds, saves older than the
    /// land integration and Realistic saves without a land section keep
    /// <see cref="CityLayoutGenerator.DefaultSeed"/>. Persisted in the land save section.
    /// </summary>
    public int LayoutSeed => _layoutSeed ??= Rules.Land.Enabled ? Seed : CityLayoutGenerator.DefaultSeed;

    /// <summary>The generated layout of a city for this game (cached; deterministic per city and <see cref="LayoutSeed"/>).</summary>
    /// <exception cref="KeyNotFoundException">Unknown city.</exception>
    public CityLayout GetCityLayout(CityId city) => LandOf(city).Layout;

    /// <summary>
    /// Revision of a city's layout as clients see it: 1 when generated, bumped whenever a
    /// building takes or leaves a site, land is bought or sold, or the monthly field recompute
    /// changes the land-value / traffic fields.
    /// </summary>
    public int GetLayoutRevision(CityId city) => _cityLand.TryGetValue(city, out var land) ? land.LayoutRev : 1;

    /// <summary>
    /// The city's current land-value and traffic fields: recomputed monthly from the development
    /// standing at the last month close (company buildings sited before this month, demolished
    /// ambient structures). The layout's generated fields until something is built.
    /// </summary>
    /// <exception cref="KeyNotFoundException">Unknown city.</exception>
    public CityFields GetLandFields(CityId city) => LandOf(city).FieldsAt(this, Clock.Now);

    /// <summary>The company building covering a plot of a city (null when free or outside the grid).</summary>
    public BuildingInstanceId? BuildingAtPlot(CityId city, int px, int pz)
        => _cityLand.TryGetValue(city, out var land) && land.BuildingAt(px, pz) is int id ? new BuildingInstanceId(id) : null;

    /// <summary>The company holding the land title of a plot (building owner or land holder), or null.</summary>
    public CompanyId? LandOwnerAt(CityId city, int px, int pz)
        => _cityLand.TryGetValue(city, out var land) && land.TitleOwnerAt(px, pz) is int owner ? new CompanyId(owner) : null;

    /// <summary>The build duration of a type under this world's rules, in months (0 = instant).</summary>
    public int GetConstructionMonths(BuildingTypeId type) => ConstructionSchedule.MonthsFor(Catalog.BuildingType(type), Rules.Land);

    /// <summary>The deposit/instalment schedule of a type under this world's rules.</summary>
    public ConstructionSchedule GetConstructionSchedule(BuildingTypeId type) => ConstructionSchedule.For(Catalog.BuildingType(type), Rules.Land);

    /// <summary>
    /// Validate a site for <paramref name="owner"/> and price it: zoning, frontage, coast, deposits,
    /// slope, the type's geography requirement, occupancy and land titles (plots the owner already
    /// holds cost nothing; plots another company holds are unavailable), plus the construction
    /// schedule and what is due up front. Pure; requires land rules.
    /// </summary>
    /// <exception cref="InvalidOperationException">Land rules are off.</exception>
    /// <exception cref="KeyNotFoundException">Unknown company, building type or city.</exception>
    /// <exception cref="ArgumentException">The rotation is not a multiple of 90 degrees.</exception>
    public ConstructionQuote QuoteConstruction(CompanyId owner, BuildingTypeId typeId, CityId city, PlotRef at)
    {
        RequireLandRules();
        RequireCompany(owner);
        var type = Catalog.BuildingType(typeId);
        var land = LandOf(city);
        var fields = land.FieldsAt(this, Clock.Now);
        var placement = PlacementValidator.Validate(land.Layout, land, type, at.Px, at.Pz, at.Rotation, fields, new LandContext(land, owner.Value));
        if (placement.Ok && !SatisfiesGeography(type, Catalog.City(city)))
        {
            // Defensive: the validator already checks every flag its site rule knows about.
            placement = placement with
            {
                Ok = false,
                Issues = placement.Issues.Append(new PlacementIssue(PlacementCode.NeedsDeposit, "The city does not meet the building's geography requirement")).ToList(),
            };
        }
        return Quote(owner, type, city, land, placement);
    }

    /// <summary>
    /// Up to <paramref name="count"/> valid, non-overlapping sites for <paramref name="owner"/>,
    /// best first by <paramref name="preference"/> (<see cref="AutoSiter"/>), each priced.
    /// Empty when the city cannot host the type or every eligible plot is taken.
    /// </summary>
    /// <exception cref="InvalidOperationException">Land rules are off.</exception>
    public IReadOnlyList<ConstructionQuote> FindConstructionSites(
        CompanyId owner,
        BuildingTypeId typeId,
        CityId city,
        SitePreference preference = SitePreference.Auto,
        int count = 5)
    {
        RequireLandRules();
        RequireCompany(owner);
        var type = Catalog.BuildingType(typeId);
        if (!SatisfiesGeography(type, Catalog.City(city))) return Array.Empty<ConstructionQuote>();
        var land = LandOf(city);
        var fields = land.FieldsAt(this, Clock.Now);
        var sites = AutoSiter.FindSites(land.Layout, land, type, preference, count, fields, new LandContext(land, owner.Value));
        var quotes = new List<ConstructionQuote>(sites.Count);
        foreach (var site in sites) quotes.Add(Quote(owner, type, city, land, site.Placement));
        return quotes;
    }

    /// <summary>
    /// The site the legacy <see cref="Construct(CompanyId, BuildingTypeId, CityId)"/> picks: the
    /// best site by the category's default preference that the company can pay for up front, else
    /// the cheapest affordable one. Null when no site is valid or affordable.
    /// </summary>
    public ConstructionQuote? ChooseAutoSite(CompanyId owner, BuildingTypeId typeId, CityId city)
    {
        var funds = AvailableFunds(owner);
        foreach (var quote in FindConstructionSites(owner, typeId, city, SitePreference.Auto, 12))
        {
            if (quote.UpfrontCost <= funds) return quote;
        }
        foreach (var quote in FindConstructionSites(owner, typeId, city, SitePreference.Cheapest, 6))
        {
            if (quote.UpfrontCost <= funds) return quote;
        }
        return null;
    }

    // ------------------------------------------------------------------ land market

    /// <summary>A parcel's market state: holder, building, listing and current value.</summary>
    /// <exception cref="KeyNotFoundException">Unknown city or parcel.</exception>
    public LandParcelInfo GetParcel(CityId city, int parcelId)
    {
        var land = LandOf(city);
        if (parcelId < 1 || parcelId > land.Layout.Parcels.Count) throw new KeyNotFoundException($"unknown parcel {parcelId} in {city}");
        return land.Describe(land.Layout.ParcelById(parcelId), land.FieldsAt(this, Clock.Now));
    }

    /// <summary>Every parcel of a city with its market state, by id.</summary>
    public IReadOnlyList<LandParcelInfo> GetParcels(CityId city)
    {
        var land = LandOf(city);
        var fields = land.FieldsAt(this, Clock.Now);
        var list = new List<LandParcelInfo>(land.Layout.Parcels.Count);
        foreach (var p in land.Layout.Parcels) list.Add(land.Describe(p, fields));
        return list;
    }

    /// <summary>
    /// Buy a listed parcel outright (CapLab "land plots"): every plot of a vacant urban lot or of
    /// rural land, at its current land value (<see cref="LedgerCategory.LandPurchase"/>, capitalised
    /// at cost as held land). Building on held plots later costs nothing more for them.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Land rules are off, the company may not invest (<see cref="EnsureCanInvest"/>), the parcel
    /// is not for sale, or the company cannot pay.
    /// </exception>
    /// <exception cref="KeyNotFoundException">Unknown company, city or parcel.</exception>
    public LandDeal BuyLand(CompanyId buyer, CityId city, int parcelId)
    {
        RequireLandRules();
        var company = RequireCompany(buyer);
        EnsureCanInvest(buyer);
        var info = GetParcel(city, parcelId);
        if (!info.ForSale || info.AskingPrice is not decimal price)
        {
            throw new LandMarketException(LandMarketError.NotForSale, $"parcel {parcelId} in {city} is not for sale");
        }
        if (AvailableFunds(buyer) < price)
        {
            throw new LandMarketException(LandMarketError.InsufficientFunds,
                $"company '{company.Name}' has {company.Cash:C} but parcel {parcelId} costs {price:C}", price);
        }

        var land = LandOf(city);
        var fields = land.FieldsAt(this, Clock.Now);
        var parcel = land.Layout.ParcelById(parcelId);
        var rect = parcel.Rect;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++) land.Hold(x, z, buyer.Value, fields.LandValueAt(x, z));
        }
        if (price > 0m)
        {
            RecordCashChange(buyer, LedgerCategory.LandPurchase, -price, $"buy parcel {parcelId} in {city}");
        }
        land.LayoutRev++;
        return new LandDeal(city, parcelId, buyer, price, price, 0m);
    }

    /// <summary>
    /// Sell the plots of a parcel the company holds without a building, at their current land
    /// value (<see cref="LedgerCategory.AssetSale"/>); the difference to their cost basis is a
    /// disposal gain or loss (<see cref="AccrualKind.DisposalGainLoss"/>).
    /// </summary>
    /// <exception cref="InvalidOperationException">Land rules are off or the company holds no free plot of the parcel.</exception>
    public LandDeal SellLand(CompanyId seller, CityId city, int parcelId)
    {
        RequireLandRules();
        RequireCompany(seller);
        var land = LandOf(city);
        if (parcelId < 1 || parcelId > land.Layout.Parcels.Count) throw new KeyNotFoundException($"unknown parcel {parcelId} in {city}");
        var parcel = land.Layout.ParcelById(parcelId);
        var fields = land.FieldsAt(this, Clock.Now);
        decimal proceeds = 0m, basis = 0m;
        var plots = 0;
        var rect = parcel.Rect;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                if (land.HeldOwnerAt(x, z) != seller.Value) continue;
                proceeds += fields.LandValueAt(x, z);
                basis += land.Release(x, z);
                plots++;
            }
        }
        if (plots == 0)
        {
            throw new LandMarketException(LandMarketError.NotOwned, $"company {seller} holds no free plot of parcel {parcelId} in {city}");
        }

        if (proceeds > 0m) RecordCashChange(seller, LedgerCategory.AssetSale, proceeds, $"sell parcel {parcelId} in {city}");
        var gain = proceeds - basis;
        if (gain != 0m) RecordAccrual(seller, AccrualKind.DisposalGainLoss, gain, $"land sale, parcel {parcelId} in {city}");
        land.LayoutRev++;
        return new LandDeal(city, parcelId, seller, proceeds, basis, gain);
    }

    /// <summary>Plots a company holds without a building, by city (ordinal) and plot (row-major).</summary>
    public IReadOnlyList<HeldPlot> GetLandHoldings(CompanyId company)
    {
        var list = new List<HeldPlot>();
        foreach (var (city, land) in _cityLand.OrderBy(kv => kv.Key.Value, StringComparer.Ordinal))
        {
            foreach (var (px, pz, owner, basis) in land.HeldPlots())
            {
                if (owner == company.Value) list.Add(new HeldPlot(city, px, pz, basis));
            }
        }
        return list;
    }

    /// <summary>
    /// Historical cost of the land a company holds without a building (outside E2's per-building
    /// asset register). Finance (E2) must add it to the balance sheet's Land line together with
    /// Σ <see cref="GetLandCost(BuildingInstanceId)"/>.
    /// </summary>
    public decimal GetHeldLandAtCost(CompanyId company)
    {
        decimal total = 0m;
        foreach (var land in _cityLand.Values)
        {
            foreach (var (_, _, owner, basis) in land.HeldPlots())
            {
                if (owner == company.Value) total += basis;
            }
        }
        return total;
    }

    /// <summary>Land at historical cost: under the company's buildings plus held plots.</summary>
    public decimal GetLandAtCost(CompanyId company)
    {
        var total = GetHeldLandAtCost(company);
        foreach (var b in _buildings.Values)
        {
            if (b.Owner == company) total += GetLandCost(b.Id);
        }
        return total;
    }

    /// <summary>Construction in progress across the company's buildings.</summary>
    public decimal GetConstructionInProgress(CompanyId company)
    {
        decimal total = 0m;
        foreach (var b in _buildings.Values)
        {
            if (b.Owner == company) total += GetConstructionInProgress(b.Id);
        }
        return total;
    }

    // ------------------------------------------------------------------ integration seams (E2 finance)

    // Land and construction amounts go through E2's asset-register API (CapitalizeLand,
    // AddConstructionInProgress, CompleteConstruction, WriteOffConstruction; interim shim in
    // Land/FinanceRegisterShim.cs). Funds for construction may include undrawn credit:

    /// <summary>E2: add the undrawn revolver to <paramref name="funds"/> so construction draws on credit (econ-audit §4.12).</summary>
    partial void AdjustAvailableFunds(CompanyId company, ref decimal funds);

    /// <summary>Money the company can spend now: cash, plus undrawn credit once finance (E2) provides it.</summary>
    public decimal AvailableFunds(CompanyId company)
    {
        var funds = RequireCompany(company).Cash;
        AdjustAvailableFunds(company, ref funds);
        return funds;
    }

    // ------------------------------------------------------------------ internals

    private void RequireLandRules()
    {
        if (!Rules.Land.Enabled) throw new InvalidOperationException("plots and the land market need land rules (LandRules.Enabled)");
        if (!_landRulesValidated)
        {
            Rules.Land.Validate();
            _landRulesValidated = true;
        }
    }

    internal CityLand LandOf(CityId city)
    {
        if (!_cityLand.TryGetValue(city, out var land))
        {
            var cityDef = Catalog.City(city); // throws if unknown
            land = new CityLand(CityLayoutGenerator.Generate(cityDef, LayoutSeed));
            _cityLand[city] = land;
        }
        return land;
    }

    /// <summary>Cities whose land state exists (layout generated), ordinal.</summary>
    internal IEnumerable<(CityId City, CityLand Land)> LandCities()
        => _cityLand.OrderBy(kv => kv.Key.Value, StringComparer.Ordinal).Select(kv => (kv.Key, kv.Value));

    internal void RestoreLayoutSeed(int seed) => _layoutSeed = seed;

    private ConstructionQuote Quote(CompanyId owner, BuildingType type, CityId city, CityLand land, PlacementResult placement)
    {
        var schedule = ConstructionSchedule.For(type, Rules.Land);
        decimal heldBasis = 0m;
        var rect = placement.Footprint;
        if (land.Layout.InBounds(rect.Px, rect.Pz) && rect.Right <= land.Layout.Width && rect.Bottom <= land.Layout.Height)
        {
            for (var z = rect.Pz; z < rect.Bottom; z++)
            {
                for (var x = rect.Px; x < rect.Right; x++)
                {
                    if (land.HeldOwnerAt(x, z) == owner.Value) heldBasis += land.HeldBasisAt(x, z);
                }
            }
        }
        return new ConstructionQuote(
            type.Id,
            city,
            placement,
            new PlotRef(rect.Px, rect.Pz, placement.Rotation),
            schedule,
            placement.LandCost,
            placement.RedevelopmentCost,
            heldBasis);
    }

    /// <summary>
    /// Register a building on its site: occupancy, titles (held plots of the owner are absorbed,
    /// their basis joins the building's land cost), cleared parcels, layout revision. Returns the
    /// cost basis of the held plots absorbed (the caller capitalises it with the land bought).
    /// </summary>
    private decimal Site(BuildingInstance building, CityLand land, ConstructionQuote quote)
    {
        var rect = quote.Placement.Footprint;
        decimal absorbed = 0m;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                if (land.HeldOwnerAt(x, z) == building.Owner.Value) absorbed += land.Release(x, z);
            }
        }
        land.Occupy(building, rect);
        foreach (var parcelId in quote.Placement.ParcelIds)
        {
            var parcel = land.Layout.ParcelById(parcelId);
            if (parcel.Ambient is { IsStructure: true } && !land.IsCleared(parcelId)) land.Clear(parcelId, Clock.Now);
        }
        building.Placement = quote.At;
        building.SitedAt = Clock.Now;
        land.LayoutRev++;
        return absorbed;
    }

    /// <summary>
    /// Free the site of a building that leaves the world (E2's sale, demolition or liquidation
    /// call this from their retirement path before removing the building): its plots return to
    /// the city — the land was sold with the building — and the layout revision bumps. No-op
    /// for a building without a site (Classic).
    /// </summary>
    internal void ReleaseSite(BuildingInstance building) => Unsite(building);

    /// <summary>
    /// Derecognise the land under a building whose site is given up (cancelled construction):
    /// zero its land at cost in E2's asset register and return what it was. The caller books the
    /// sale proceeds and the gain or loss.
    /// </summary>
    internal decimal ReleaseLand(BuildingInstanceId building)
    {
        var record = _finance.Assets.Find(building);
        var land = record?.Land ?? 0m;
        if (record is not null) record.Land = 0m;
        return land;
    }

    /// <summary>
    /// Move a retiring building off its site: its plots are freed and the layout revision bumps.
    /// The building keeps its last <see cref="BuildingInstance.Placement"/> as history (the
    /// monthly fields still count it until the next month close).
    /// </summary>
    private void Unsite(BuildingInstance building)
    {
        if (building.Placement is null) return;
        var land = LandOf(building.City);
        land.Vacate(building.Id.Value);
        land.LayoutRev++;
    }

    /// <summary>
    /// Rebuild every city's occupancy from the buildings' placements (after a load). Buildings
    /// whose site is not valid any more (overlaps) keep their placement but do not occupy twice.
    /// </summary>
    internal void RebuildOccupancy()
    {
        foreach (var land in _cityLand.Values) land.ClearOccupancy();
        foreach (var b in _buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Placement is not PlotRef at || b.IsRetired) continue;
            var land = LandOf(b.City);
            land.Occupy(b, at.Rect(Catalog.BuildingType(b.TypeId).Footprint), tolerateOverlap: true);
        }
    }

    /// <summary>
    /// Give every building of a land-rules world that has no site one (save migration for
    /// Realistic saves older than the land integration): auto-sited in id order, free of charge,
    /// cheapest valid site first. Buildings without any valid site stay unplaced.
    /// </summary>
    internal void MigrateUnsitedBuildings()
    {
        if (!Rules.Land.Enabled) return;
        foreach (var b in _buildings.Values.OrderBy(b => b.Id.Value))
        {
            if (b.Placement is not null || b.IsRetired) continue;
            var type = Catalog.BuildingType(b.TypeId);
            if (!SatisfiesGeography(type, Catalog.City(b.City))) continue;
            var land = LandOf(b.City);
            var sites = AutoSiter.FindSites(land.Layout, land, type, SitePreference.Auto, 1, land.Layout.Fields);
            if (sites.Count == 0) continue;
            var placement = sites[0].Placement;
            land.Occupy(b, placement.Footprint);
            b.Placement = new PlotRef(placement.Footprint.Px, placement.Footprint.Pz, placement.Rotation);
            b.SitedAt = b.BuiltAt;
        }
    }

    /// <summary>
    /// Month-close part of the land model (called by the construction step): for every city
    /// whose development changed since the previous month close, bump the layout revision so
    /// clients refetch the recomputed fields.
    /// </summary>
    internal void CloseLandMonth()
    {
        foreach (var (_, land) in LandCities())
        {
            var signature = land.DevelopmentSignature(this, Clock.Now);
            if (signature == land.TickSignature) continue;
            land.TickSignature = signature;
            land.LayoutRev++;
        }
    }
}

/// <summary>
/// One city's land state: the generated layout, which company building covers each plot,
/// titles held without a building, parcels whose ambient structure was demolished, the layout
/// revision and the cached monthly fields. Implements the occupancy and land-state views the
/// placement validator and the auto-siter read.
/// </summary>
internal sealed class CityLand : IPlotOccupancy, ILandState
{
    private readonly int[] _building;
    private readonly int[] _buildingOwner;
    private readonly int[] _heldOwner;
    private readonly decimal[] _heldBasis;
    private readonly SortedDictionary<int, GameDate> _cleared = new();
    private CityFields? _fields;
    private ulong _fieldsSignature;
    private bool _hasFields;

    public CityLand(CityLayout layout)
    {
        Layout = layout;
        var n = layout.PlotCount;
        _building = new int[n];
        _buildingOwner = new int[n];
        _heldOwner = new int[n];
        _heldBasis = new decimal[n];
    }

    public CityLayout Layout { get; }

    /// <summary>Client-visible layout revision (starts at 1, the generated layout).</summary>
    public int LayoutRev { get; set; } = 1;

    /// <summary>Development signature at the last month close (<see cref="World.CloseLandMonth"/>).</summary>
    public ulong TickSignature { get; set; }

    /// <summary>Parcels whose ambient structure was bought out, with the month it happened.</summary>
    public IReadOnlyDictionary<int, GameDate> Cleared => _cleared;

    public int? BuildingAt(int px, int pz)
    {
        if (!Layout.InBounds(px, pz)) return null;
        var id = _building[Layout.IndexOf(px, pz)];
        return id == 0 ? null : id;
    }

    public int? TitleOwnerAt(int px, int pz)
    {
        if (!Layout.InBounds(px, pz)) return null;
        var i = Layout.IndexOf(px, pz);
        if (_building[i] != 0) return _buildingOwner[i];
        return _heldOwner[i] == 0 ? null : _heldOwner[i];
    }

    public bool IsCleared(int parcelId) => _cleared.ContainsKey(parcelId);

    public int? HeldOwnerAt(int px, int pz)
    {
        var owner = _heldOwner[Layout.IndexOf(px, pz)];
        return owner == 0 ? null : owner;
    }

    public decimal HeldBasisAt(int px, int pz) => _heldBasis[Layout.IndexOf(px, pz)];

    public void Hold(int px, int pz, int owner, decimal basis)
    {
        var i = Layout.IndexOf(px, pz);
        _heldOwner[i] = owner;
        _heldBasis[i] = basis;
    }

    /// <summary>Drop a held title; returns its cost basis.</summary>
    public decimal Release(int px, int pz)
    {
        var i = Layout.IndexOf(px, pz);
        var basis = _heldBasis[i];
        _heldOwner[i] = 0;
        _heldBasis[i] = 0m;
        return basis;
    }

    /// <summary>Held plots, row-major: (px, pz, owner, basis).</summary>
    public IEnumerable<(int Px, int Pz, int Owner, decimal Basis)> HeldPlots()
    {
        var w = Layout.Width;
        for (var i = 0; i < _heldOwner.Length; i++)
        {
            if (_heldOwner[i] != 0) yield return (i % w, i / w, _heldOwner[i], _heldBasis[i]);
        }
    }

    public void Clear(int parcelId, GameDate when) => _cleared[parcelId] = when;

    public void Occupy(BuildingInstance building, PlotRect rect, bool tolerateOverlap = false)
    {
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                if (!Layout.InBounds(x, z)) continue;
                var i = Layout.IndexOf(x, z);
                if (_building[i] != 0)
                {
                    if (tolerateOverlap) continue;
                    throw new InvalidOperationException($"plot ({x},{z}) of {Layout.CityId} is occupied by building {_building[i]}");
                }
                _building[i] = building.Id.Value;
                _buildingOwner[i] = building.Owner.Value;
            }
        }
    }

    public void Vacate(int buildingId)
    {
        for (var i = 0; i < _building.Length; i++)
        {
            if (_building[i] != buildingId) continue;
            _building[i] = 0;
            _buildingOwner[i] = 0;
        }
    }

    public void ClearOccupancy()
    {
        Array.Clear(_building);
        Array.Clear(_buildingOwner);
    }

    /// <summary>A parcel's market state under the given fields.</summary>
    public LandParcelInfo Describe(Parcel parcel, CityFields fields)
    {
        decimal value = 0m;
        double traffic = 0;
        int? owner = null;
        int? building = null;
        var free = true;
        var rect = parcel.Rect;
        for (var z = rect.Pz; z < rect.Bottom; z++)
        {
            for (var x = rect.Px; x < rect.Right; x++)
            {
                value += fields.LandValueAt(x, z);
                traffic += fields.TrafficAt(x, z);
                if (BuildingAt(x, z) is int b)
                {
                    building ??= b;
                    free = false;
                }
                if (TitleOwnerAt(x, z) is int o)
                {
                    owner ??= o;
                    free = false;
                }
            }
        }
        var cleared = IsCleared(parcel.Id);
        var listed = (parcel.ForSale || (cleared && parcel.Landmark is null && parcel.District is not (District.Civic or District.Park)))
            && free;
        var vacant = parcel.Vacant || cleared || parcel.Ambient is not { IsStructure: true };
        return new LandParcelInfo(
            parcel,
            Math.Round(value / Math.Max(1, rect.Area), 0, MidpointRounding.ToEven),
            value,
            Math.Round(traffic / Math.Max(1, rect.Area), 1),
            owner is int oid ? new CompanyId(oid) : null,
            building is int bid ? new BuildingInstanceId(bid) : null,
            listed,
            listed ? value : null,
            vacant && building is null,
            cleared);
    }

    /// <summary>
    /// The land uses and traffic attractors standing at the month close of <paramref name="asOf"/>:
    /// company buildings sited before that month (not retired before it) override their plots;
    /// parcels cleared before it lose their ambient use and strip-mall attractor.
    /// </summary>
    private (ulong Signature, List<(PlotRect Rect, LandUse Use, TrafficAttractor? Attractor)> Buildings, List<int> Cleared)
        Development(World world, GameDate asOf)
    {
        var hash = new Fnv64();
        var buildings = new List<(PlotRect, LandUse, TrafficAttractor?)>();
        foreach (var b in world.Buildings.Values.Where(b => b.City == Layout.CityId).OrderBy(b => b.Id.Value))
        {
            if (b.SitedAt is not GameDate sited || sited >= asOf || b.Placement is not PlotRef site) continue;
            if (b.RetiredAt is GameDate retired && retired < asOf) continue;
            var type = world.Catalog.BuildingType(b.TypeId);
            var rect = site.Rect(type.Footprint);
            var use = LandUses.ForCategory(type.Category);
            buildings.Add((rect, use, Attractor(type, rect, use)));
            hash.Add(b.Id.Value);
            hash.Add(rect.Px);
            hash.Add(rect.Pz);
            hash.Add(rect.W);
            hash.Add(rect.H);
            hash.Add((int)use);
        }
        var cleared = new List<int>();
        foreach (var (parcelId, when) in _cleared)
        {
            if (when >= asOf) continue;
            cleared.Add(parcelId);
            hash.Add(-parcelId);
        }
        return (buildings.Count == 0 && cleared.Count == 0 ? 0UL : hash.Value, buildings, cleared);
    }

    /// <summary>The development signature at the month close of <paramref name="asOf"/> (0 = nothing developed).</summary>
    public ulong DevelopmentSignature(World world, GameDate asOf) => Development(world, asOf).Signature;

    /// <summary>The land-value and traffic fields as of the last month close (cached until development changes).</summary>
    public CityFields FieldsAt(World world, GameDate asOf)
    {
        var (signature, buildings, cleared) = Development(world, asOf);
        if (_hasFields && signature == _fieldsSignature) return _fields!;
        _fields = signature == 0UL ? Layout.Fields : ComputeFields(buildings, cleared);
        _fieldsSignature = signature;
        _hasFields = true;
        return _fields;
    }

    private CityFields ComputeFields(List<(PlotRect Rect, LandUse Use, TrafficAttractor? Attractor)> buildings, List<int> cleared)
    {
        var uses = Layout.LandUses.ToArray();
        var clearedSet = new HashSet<int>(cleared);
        foreach (var parcelId in cleared)
        {
            var rect = Layout.ParcelById(parcelId).Rect;
            for (var z = rect.Pz; z < rect.Bottom; z++)
            {
                for (var x = rect.Px; x < rect.Right; x++) uses[Layout.IndexOf(x, z)] = LandUse.Vacant;
            }
        }
        var attractors = new List<TrafficAttractor>();
        foreach (var p in Layout.Parcels)
        {
            if (p.Ambient?.Kind == AmbientKind.StripMall && !clearedSet.Contains(p.Id)) attractors.Add(CityFields.StripMallAttractor(p.Rect));
        }
        foreach (var (rect, use, attractor) in buildings)
        {
            for (var z = rect.Pz; z < rect.Bottom; z++)
            {
                for (var x = rect.Px; x < rect.Right; x++)
                {
                    if (Layout.InBounds(x, z)) uses[Layout.IndexOf(x, z)] = use;
                }
            }
            if (attractor is { } a) attractors.Add(a);
        }
        return CityFields.Compute(Layout, uses, attractors);
    }

    /// <summary>
    /// Traffic pull of a company building (caplab-brief §5.4): stores act as malls (up to +20
    /// within 5 plots for a 4×4 big box), offices, media and labs as service firms (up to +15
    /// within 3 plots).
    /// </summary>
    private static TrafficAttractor? Attractor(BuildingType type, PlotRect rect, LandUse use)
    {
        var cx = rect.Px + rect.W / 2.0;
        var cz = rect.Pz + rect.H / 2.0;
        var area = rect.Area;
        return use switch
        {
            LandUse.Retail => new TrafficAttractor(cx, cz, area >= 9 ? 5 : 3, Math.Min(20, 1.25 * area)),
            LandUse.Office => new TrafficAttractor(cx, cz, 3, Math.Min(15, 1.0 * area)),
            _ => null,
        };
    }

    /// <summary>FNV-1a over 64-bit words (development signatures).</summary>
    private struct Fnv64
    {
        private ulong _h;
        private bool _started;

        public readonly ulong Value => _started ? _h : 14695981039346656037UL;

        public void Add(long v)
        {
            if (!_started)
            {
                _h = 14695981039346656037UL;
                _started = true;
            }
            for (var i = 0; i < 8; i++)
            {
                _h ^= (byte)(v >> (8 * i));
                _h *= 1099511628211UL;
            }
        }
    }
}

/// <summary>
/// The price and validity of building a type on a site (<see cref="World.QuoteConstruction"/>).
/// </summary>
/// <param name="TypeId">Building type.</param>
/// <param name="City">City.</param>
/// <param name="Placement">The validator's verdict: issues, footprint, site summary, land and buy-out costs.</param>
/// <param name="At">The site (north-west plot of the rotated footprint, rotation).</param>
/// <param name="Schedule">Construction duration, deposit and instalments.</param>
/// <param name="LandCost">Land still to buy, at current value (plots the company holds excluded).</param>
/// <param name="RedevelopmentCost">Buy-out of ambient structures on the parcels touched.</param>
/// <param name="HeldLandBasis">Cost basis of plots the company already holds under the footprint (no cash).</param>
public sealed record ConstructionQuote(
    BuildingTypeId TypeId,
    CityId City,
    PlacementResult Placement,
    PlotRef At,
    ConstructionSchedule Schedule,
    decimal LandCost,
    decimal RedevelopmentCost,
    decimal HeldLandBasis)
{
    /// <summary>True when the site is valid.</summary>
    public bool Ok => Placement.Ok;

    /// <summary>Land plus buy-out, the cash for the site.</summary>
    public decimal SiteCost => LandCost + RedevelopmentCost;

    /// <summary>Cash due when the order is placed: the site plus the deposit (the whole construction cost when instant).</summary>
    public decimal UpfrontCost => SiteCost + Schedule.Deposit;

    /// <summary>Everything the project costs in cash: site plus construction.</summary>
    public decimal TotalCost => SiteCost + Schedule.ConstructionCost;

    /// <summary>Build duration in months (0 = instant).</summary>
    public int Months => Schedule.Months;
}

/// <summary>A parcel's market state (<see cref="World.GetParcel"/>).</summary>
/// <param name="Parcel">The generated parcel.</param>
/// <param name="LandValuePerPlot">Current mean land value per plot, whole dollars.</param>
/// <param name="LandValue">Current land value of the whole parcel, whole dollars.</param>
/// <param name="Traffic">Current mean traffic index, 0–100.</param>
/// <param name="Owner">The company holding (part of) it, or null.</param>
/// <param name="Building">A company building on it, or null.</param>
/// <param name="ForSale">Listed: a vacant lot, rural land or a cleared lot, entirely free.</param>
/// <param name="AskingPrice">Price of the whole parcel when listed.</param>
/// <param name="Vacant">No structure stands on it (ambient or company).</param>
/// <param name="Cleared">Its ambient structure was bought out and demolished.</param>
public sealed record LandParcelInfo(
    Parcel Parcel,
    decimal LandValuePerPlot,
    decimal LandValue,
    double Traffic,
    CompanyId? Owner,
    BuildingInstanceId? Building,
    bool ForSale,
    decimal? AskingPrice,
    bool Vacant,
    bool Cleared);

/// <summary>A land purchase or sale (<see cref="World.BuyLand"/>, <see cref="World.SellLand"/>).</summary>
/// <param name="City">City.</param>
/// <param name="ParcelId">Parcel.</param>
/// <param name="Company">Buyer or seller.</param>
/// <param name="Amount">Cash paid (purchase) or received (sale).</param>
/// <param name="CostBasis">Historical cost of the plots (purchase: equal to the price).</param>
/// <param name="GainOrLoss">Sale proceeds minus cost basis (0 for a purchase).</param>
public sealed record LandDeal(CityId City, int ParcelId, CompanyId Company, decimal Amount, decimal CostBasis, decimal GainOrLoss);

/// <summary>A plot a company holds without a building.</summary>
/// <param name="City">City.</param>
/// <param name="Px">Plot x.</param>
/// <param name="Pz">Plot z.</param>
/// <param name="CostBasis">Historical cost.</param>
public sealed record HeldPlot(CityId City, int Px, int Pz, decimal CostBasis);

/// <summary>Why a land-market operation was refused.</summary>
public enum LandMarketError
{
    /// <summary>The parcel is not listed (built on, held, public land or developed).</summary>
    NotForSale,

    /// <summary>The company holds no free plot of the parcel.</summary>
    NotOwned,

    /// <summary>The company cannot pay.</summary>
    InsufficientFunds,
}

/// <summary>A refused land-market operation.</summary>
public sealed class LandMarketException : InvalidOperationException
{
    /// <summary>Create the exception.</summary>
    public LandMarketException(LandMarketError error, string message, decimal? required = null)
        : base(message)
    {
        Error = error;
        Required = required;
    }

    /// <summary>The reason.</summary>
    public LandMarketError Error { get; }

    /// <summary>The amount required (insufficient funds).</summary>
    public decimal? Required { get; }
}

/// <summary>A site the placement rules reject (<see cref="World.Construct(CompanyId, BuildingTypeId, CityId, PlotRef)"/>).</summary>
public sealed class PlacementRejectedException : InvalidOperationException
{
    /// <summary>Create the exception.</summary>
    public PlacementRejectedException(ConstructionQuote quote)
        : base($"cannot build {quote.TypeId} at {quote.At} in {quote.City}: " + string.Join("; ", quote.Placement.Issues.Select(i => $"{i.CodeName} {i.Message}")))
    {
        Quote = quote;
    }

    /// <summary>The rejected quote (issues in <c>Quote.Placement.Issues</c>).</summary>
    public ConstructionQuote Quote { get; }
}
