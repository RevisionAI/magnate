using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// The only place the bridge reads <see cref="SimulationConstants"/>. The engine
/// workstream is moving these values into per-world <c>EconomyRules</c> and may
/// mark the static class <c>[Obsolete]</c>; funnelling every read through here
/// keeps the bridge building (warnings are errors) and gives one place to switch
/// to <c>world.Rules</c> when it lands. Values are <c>static readonly</c> (not
/// <c>const</c>) so they compile whether the engine exposes constants or properties.
/// </summary>
internal static class EngineConstants
{
#pragma warning disable CS0618 // SimulationConstants may become an [Obsolete] facade over EconomyRules.Classic.
    public static readonly int CyclesPerSlotPerMonth = SimulationConstants.CyclesPerSlotPerMonth;
    public static readonly decimal InterCityShippingFraction = SimulationConstants.InterCityShippingFraction;
    public static readonly double WorldMarketQuality = SimulationConstants.WorldMarketQuality;
    public static readonly double ExtractionQuality = SimulationConstants.ExtractionQuality;
    public static readonly int BaseTechLevel = SimulationConstants.BaseTechLevel;
    public static readonly double ResearchPointsPerSlotPerMonth = SimulationConstants.ResearchPointsPerSlotPerMonth;
    public static readonly double BaseResearchThreshold = SimulationConstants.BaseResearchThreshold;
    public static readonly int PatentDurationMonths = SimulationConstants.PatentDurationMonths;
    public static readonly decimal PatentRoyaltyRate = SimulationConstants.PatentRoyaltyRate;
    public static readonly double BrandDecayRate = SimulationConstants.BrandDecayRate;
    public static readonly decimal EventBaseProbabilityPerMonth = SimulationConstants.EventBaseProbabilityPerMonth;
    public static readonly decimal MediaOwnershipAdBonus = SimulationConstants.MediaOwnershipAdBonus;
    public static readonly decimal MediaOwnershipAdBonusPrint = SimulationConstants.MediaOwnershipAdBonusPrint;

    public static decimal AdCostPerPoint(AdChannel channel) => SimulationConstants.AdCostPerPoint(channel);
#pragma warning restore CS0618
}
