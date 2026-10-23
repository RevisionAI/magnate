namespace Magnate.Engine.Simulation;

/// <summary>
/// Tunable simulation constants. These live in code (not content) until we have
/// enough playtest data to migrate them to a balance file.
/// </summary>
public static class SimulationConstants
{
    /// <summary>Recipe cycles each production slot can run per monthly tick.</summary>
    public const int CyclesPerSlotPerMonth = 200;

    /// <summary>
    /// Fraction of the product's world-market value charged as shipping cost when
    /// goods move between cities owned by the same company. 0.10 = 10%.
    /// </summary>
    public const decimal InterCityShippingFraction = 0.10m;

    /// <summary>
    /// Quality (0-100) of generic goods sourced from the world market.
    /// Below 100 by design so self-produced / higher-tech output can differentiate.
    /// </summary>
    public const double WorldMarketQuality = 50.0;

    /// <summary>Quality (0-100) of raw materials produced by own extraction buildings.</summary>
    public const double ExtractionQuality = 50.0;

    /// <summary>Starting tech level for any (company, product) pair before R&amp;D.</summary>
    public const int BaseTechLevel = 1;

    /// <summary>Starting brand awareness (0-100) for any (company, product, city) triple before advertising.</summary>
    public const double BaseBrandAwareness = 0.0;

    /// <summary>Research points produced by one research slot per monthly tick.</summary>
    public const double ResearchPointsPerSlotPerMonth = 100.0;

    /// <summary>
    /// Duration (in months) of a patent granted when a company first reaches
    /// <c>MaxTechLevel</c> on a product. While active, the patent silently blocks
    /// other companies' R&amp;amp;D progress on that same product. See Phase 3.49.
    /// </summary>
    public const int PatentDurationMonths = 24;

    /// <summary>
    /// Royalty rate (fraction of licensee's <c>ProductSale</c> +
    /// <c>ExportSale</c> revenue on the patented product) that a licensee
    /// pays the patent holder each monthly tick. 0.05 = 5%. Applied at end
    /// of tick after sales are booked. See Phase 3.54.
    /// </summary>
    public const decimal PatentRoyaltyRate = 0.05m;

    /// <summary>
    /// Base research cost per tech level jump. Threshold for level N→N+1 is
    /// <c>BaseResearchThreshold × N</c>, so later levels take proportionally longer
    /// (level 1→2: 100 pts = 1 slot-month; level 9→10: 900 pts = 9 slot-months).
    /// </summary>
    public const double BaseResearchThreshold = 100.0;

    /// <summary>Dollar cost per percentage point of brand awareness lift on TV (most efficient).</summary>
    public const decimal TvAdCostPerPoint = 4_000m;

    /// <summary>Dollar cost per percentage point of brand awareness lift via newspaper.</summary>
    public const decimal NewspaperAdCostPerPoint = 6_000m;

    /// <summary>Dollar cost per percentage point of brand awareness lift via magazine (least efficient at broad reach).</summary>
    public const decimal MagazineAdCostPerPoint = 8_000m;

    /// <summary>Dollar cost per percentage point of brand awareness lift on radio (broader reach, slightly cheaper than TV).</summary>
    public const decimal RadioAdCostPerPoint = 5_000m;

    /// <summary>Fraction of existing brand awareness lost per month when no campaign is active.</summary>
    public const double BrandDecayRate = 0.02;

    /// <summary>
    /// Effective-budget multiplier applied to an ad campaign when the owning company
    /// also owns the matching media building (TV station → TV channel) in the same city.
    /// 1.35 = 35% more reach for the same dollar spent. Applies to broadcast channels
    /// (TV, Radio). Print channels use <see cref="MediaOwnershipAdBonusPrint"/>.
    /// </summary>
    public const decimal MediaOwnershipAdBonus = 1.35m;

    /// <summary>
    /// Effective-budget multiplier applied to an ad campaign when the owning company
    /// also owns the matching print-media building (newspaper publisher → Newspaper
    /// channel, magazine publisher → Magazine channel) in the same city. 1.25 = 25%
    /// more reach. Print is slightly less efficient at converting ownership into
    /// reach than broadcast, hence the smaller multiplier.
    /// </summary>
    public const decimal MediaOwnershipAdBonusPrint = 1.25m;

    /// <summary>
    /// Base monthly probability that <em>any</em> random event fires during the
    /// monthly tick (Phase 3.65). The dice-roll picks among eligible events
    /// weighted by their <c>Weight</c> field; at most one event fires per tick
    /// to avoid news-ticker spam. Tuned for "occasional but noticeable" cadence —
    /// roughly two news beats per simulated game-year.
    /// </summary>
    public const decimal EventBaseProbabilityPerMonth = 0.20m;

    /// <summary>Lookup for per-channel cost-per-point.</summary>
    public static decimal AdCostPerPoint(AdChannel channel) => channel switch
    {
        AdChannel.TV        => TvAdCostPerPoint,
        AdChannel.Newspaper => NewspaperAdCostPerPoint,
        AdChannel.Magazine  => MagazineAdCostPerPoint,
        AdChannel.Radio     => RadioAdCostPerPoint,
        _ => NewspaperAdCostPerPoint,
    };
}
