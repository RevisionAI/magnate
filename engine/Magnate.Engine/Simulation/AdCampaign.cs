using Magnate.Engine.Domain;

namespace Magnate.Engine.Simulation;

/// <summary>Advertising channel. Phase 2.5 MVP — same mechanic, differing cost efficiency.</summary>
public enum AdChannel
{
    /// <summary>Highest reach, most efficient per brand-point.</summary>
    TV,
    /// <summary>Medium reach, medium cost.</summary>
    Newspaper,
    /// <summary>Niche reach, lowest cost-efficiency (Phase 2+ will give it demographic targeting bonuses).</summary>
    Magazine,
    /// <summary>Broad reach at lower cost than TV; matches radio_station media ownership.</summary>
    Radio,
}

/// <summary>
/// An advertising campaign: per (company, product, city, channel), with a monthly
/// budget. Each monthly tick the budget is charged to the company and converted
/// into a brand-awareness lift in that city — subject to saturation (diminishing
/// returns as brand approaches 100).
/// </summary>
public sealed class AdCampaign
{
    public CompanyId Company { get; }
    public ProductId Product { get; }
    public CityId City { get; }
    public AdChannel Channel { get; }
    public decimal MonthlyBudget { get; set; }

    internal AdCampaign(CompanyId company, ProductId product, CityId city, AdChannel channel, decimal monthlyBudget)
    {
        Company = company;
        Product = product;
        City = city;
        Channel = channel;
        MonthlyBudget = monthlyBudget;
    }
}
