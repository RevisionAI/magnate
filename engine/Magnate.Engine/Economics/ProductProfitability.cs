using Magnate.Engine.Domain;

namespace Magnate.Engine.Economics;

/// <summary>
/// Per-product P&amp;L attribution for a company over a date range.
/// <para>
/// <see cref="Cost"/> is COGS — the cost basis of goods that left inventory via
/// sale or export. <see cref="MarketingCost"/> is period marketing spend (ads)
/// that's attributable to this product. Net product margin accounts for both.
/// Internal transfers don't move cash so they don't appear here — Phase 2+
/// transfer-pricing will assign costs across the chain.
/// </para>
/// </summary>
public sealed record ProductProfitability(
    ProductId Product,
    decimal Revenue,
    decimal Cost,
    decimal MarketingCost)
{
    public decimal GrossMargin => Revenue - Cost;
    public decimal NetMargin => GrossMargin - MarketingCost;
    public decimal NetMarginPct => Revenue == 0m ? 0m : NetMargin / Revenue;
}
