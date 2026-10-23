using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Land;

/// <summary>The placement family of a building category (which land it may stand on).</summary>
public enum SiteClass : byte
{
    /// <summary>Shops and stores (convenience store … department store, malls, dealers).</summary>
    Retail = 0,

    /// <summary>Offices, headquarters, banks and investment firms.</summary>
    Office = 1,

    /// <summary>TV, radio, newspaper and magazine publishers.</summary>
    Media = 2,

    /// <summary>R&amp;D centres, labs, software firms, training centres.</summary>
    Research = 3,

    /// <summary>Factories and plants.</summary>
    Industry = 4,

    /// <summary>Warehouses, distribution centres, freight yards.</summary>
    Logistics = 5,

    /// <summary>Seaports (on the quay of a coastal city).</summary>
    Seaport = 6,

    /// <summary>Crop farms, plantations and livestock farms.</summary>
    Farm = 7,

    /// <summary>Mines, oil wells, quarries and logging camps.</summary>
    Extraction = 8,

    /// <summary>Apartment buildings and condominiums.</summary>
    Residential = 9,

    /// <summary>Hotels.</summary>
    Hotel = 10,

    /// <summary>Colleges and campuses.</summary>
    Campus = 11,

    /// <summary>Has no city footprint (a boardroom): never placeable.</summary>
    None = 12,
}

/// <summary>A district a building may occupy, with the road frontage it needs there.</summary>
/// <param name="District">The district.</param>
/// <param name="MinFrontage">The lowest road class the footprint must front when it stands in this district.</param>
/// <param name="MaxArea">The largest footprint (in plots) allowed in this district (e.g. apartments only 2×2 among houses).</param>
public sealed record SiteZone(District District, RoadClass MinFrontage, int MaxArea = int.MaxValue);

/// <summary>
/// Where a building type may be placed (caplab-brief §5.9 validation table, with
/// the categories of <c>content/schemas/building-type.schema.json</c>). The engine
/// is the authority; the client only displays these.
/// </summary>
/// <param name="Class">Placement family.</param>
/// <param name="Zones">Allowed districts with their frontage requirement. Every footprint plot must be in one of them.</param>
/// <param name="Deposit">Resource the footprint must sit on (extraction); <see cref="DepositKind.None"/> means the footprint must avoid deposits.</param>
/// <param name="NeedsCoast">The footprint must front the sea (seaports).</param>
/// <param name="NeedsArable">The city must be arable (crop farms; also any content geography flag).</param>
/// <param name="NeedsForest">The footprint must stand in forest (logging camps).</param>
/// <param name="ZoneHint">One-line placement hint for the build menu and the ZONE message.</param>
public sealed record SiteRule(
    SiteClass Class,
    IReadOnlyList<SiteZone> Zones,
    DepositKind Deposit,
    bool NeedsCoast,
    bool NeedsArable,
    bool NeedsForest,
    string ZoneHint)
{
    /// <summary>The zone entry for a district, or null when the district is not allowed.</summary>
    public SiteZone? ZoneFor(District district)
    {
        foreach (var z in Zones)
        {
            if (z.District == district) return z;
        }
        return null;
    }
}

/// <summary>The placement rule table keyed by building category.</summary>
public static class SiteRules
{
    private static readonly SiteZone[] DowntownLocal = [new(District.Cbd, RoadClass.Local), new(District.Commercial, RoadClass.Local), new(District.Mixed, RoadClass.Local)];
    private static readonly SiteZone[] DowntownCollector = [new(District.Cbd, RoadClass.Collector), new(District.Commercial, RoadClass.Collector), new(District.Mixed, RoadClass.Collector)];
    private static readonly SiteZone[] IndustrialCollector = [new(District.Industrial, RoadClass.Collector), new(District.Port, RoadClass.Collector)];

    /// <summary>The placement family of a content building category (unknown categories are offices).</summary>
    public static SiteClass ClassOf(string category) => category switch
    {
        "convenience_store" or "supermarket" or "department_store" or "specialty_store" or "auto_dealer" or "fashion_store"
            or "restaurant" or "fast_food" or "hardware_store" or "furniture_store" or "pharmacy" or "gas_station"
            or "showroom" or "shopping_mall" => SiteClass.Retail,
        "office_tower" or "headquarters" or "subsidiary_hq" or "bank" or "investment_firm" => SiteClass.Office,
        "media" or "tv_station" or "newspaper" or "magazine" or "internet_service" => SiteClass.Media,
        "rd_center" or "pharmaceutical_lab" or "software_firm" or "training_center" => SiteClass.Research,
        "factory" or "automotive_plant" or "semiconductor_fab" or "pharmaceutical_factory" => SiteClass.Industry,
        "warehouse" or "distribution_center" or "freight_yard" => SiteClass.Logistics,
        "seaport" => SiteClass.Seaport,
        "farm" or "livestock_farm" or "plantation" => SiteClass.Farm,
        "mine" or "oil_well" or "quarry" or "logging_camp" => SiteClass.Extraction,
        "apartment" or "luxury_condo" => SiteClass.Residential,
        "hotel" => SiteClass.Hotel,
        "college" => SiteClass.Campus,
        "boardroom" => SiteClass.None,
        _ => SiteClass.Office,
    };

    /// <summary>The placement rule of a building type (category, footprint size and content geography flags).</summary>
    public static SiteRule For(BuildingType type)
    {
        ArgumentNullException.ThrowIfNull(type);
        var area = type.Footprint.Width * type.Footprint.Height;
        var geo = type.GeographyRequirement;
        var cls = type.Retail ? SiteClass.Retail : ClassOf(type.Category);
        var arable = geo?.Arable == true;
        return cls switch
        {
            // caplab §5.9: small shops (up to 2×2) also on apartment blocks that front a collector;
            // big boxes only downtown and on main streets, fronting a collector or better.
            SiteClass.Retail when area <= 4 => new SiteRule(cls,
                [.. DowntownLocal, new(District.Apartments, RoadClass.Collector)],
                DepositKind.None, false, arable, false, "Shops go on commercial land or main streets"),
            SiteClass.Retail => new SiteRule(cls, DowntownCollector, DepositKind.None, false, arable, false,
                "Big stores need commercial land on a collector or better"),
            SiteClass.Office => new SiteRule(cls, DowntownCollector, DepositKind.None, false, arable, false,
                "Offices go downtown or on main streets"),
            SiteClass.Media => new SiteRule(cls, DowntownLocal, DepositKind.None, false, arable, false,
                "Media firms go downtown or on commercial streets"),
            SiteClass.Research => new SiteRule(cls, [.. DowntownLocal, new(District.Industrial, RoadClass.Local)],
                DepositKind.None, false, arable, false, "R&D goes on commercial or industrial land"),
            SiteClass.Industry => new SiteRule(cls, IndustrialCollector, DepositKind.None, false, arable, false,
                "Factories need industrial or port land on a collector"),
            SiteClass.Logistics => new SiteRule(cls, IndustrialCollector, DepositKind.None, false, arable, false,
                "Warehouses need industrial or port land on a collector"),
            SiteClass.Seaport => new SiteRule(cls, [new(District.Port, RoadClass.Local)], DepositKind.None, true, arable, false,
                "Seaports need port land on the quay"),
            SiteClass.Farm => new SiteRule(cls, [new(District.Rural, RoadClass.Local)], DepositKind.None, false,
                arable || type.Category != "livestock_farm", false, "Farms need agricultural land in an arable city"),
            SiteClass.Extraction => ExtractionRule(type.Category, geo, arable),
            SiteClass.Residential => new SiteRule(cls,
                [new(District.Apartments, RoadClass.Local), new(District.Mixed, RoadClass.Local), new(District.Commercial, RoadClass.Local),
                    new(District.Cbd, RoadClass.Local), new(District.Houses, RoadClass.Local, MaxArea: 4)],
                DepositKind.None, false, arable, false, "Apartments go on residential or commercial land"),
            SiteClass.Hotel => new SiteRule(cls, DowntownLocal, DepositKind.None, false, arable, false,
                "Hotels go downtown or on commercial streets"),
            SiteClass.Campus => new SiteRule(cls,
                [new(District.Commercial, RoadClass.Local), new(District.Mixed, RoadClass.Local), new(District.Apartments, RoadClass.Local),
                    new(District.Houses, RoadClass.Local)],
                DepositKind.None, false, arable, false, "Colleges go on residential or commercial land"),
            _ => new SiteRule(SiteClass.None, Array.Empty<SiteZone>(), DepositKind.None, false, false, false, "Has no site in the city"),
        };
    }

    private static SiteRule ExtractionRule(string category, GeographyRequirement? geo, bool arable)
    {
        var rural = new SiteZone[] { new(District.Rural, RoadClass.Local) };
        if (category == "oil_well" || geo?.OilRich == true)
        {
            return new SiteRule(SiteClass.Extraction, rural, DepositKind.Oil, false, arable, false, "Oil wells must stand on an oil field");
        }
        if (category == "mine" || geo?.MineralRich == true)
        {
            return new SiteRule(SiteClass.Extraction, rural, DepositKind.Iron, false, arable, false, "Mines must stand on an ore deposit");
        }
        if (category == "logging_camp")
        {
            return new SiteRule(SiteClass.Extraction, rural, DepositKind.None, false, arable, true, "Logging camps must stand in forest");
        }
        return new SiteRule(SiteClass.Extraction, rural, DepositKind.None, false, arable, false, "Quarries need agricultural land");
    }
}
