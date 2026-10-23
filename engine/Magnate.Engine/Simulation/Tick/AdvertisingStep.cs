namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 6 (econ-audit §4.16): advertising.
/// <para>
/// Classic (<see cref="World.ApplyMonthlyAdvertising"/>): charge every active campaign, lift brand
/// awareness with saturation at a flat cost per point, decay only brands without a campaign.
/// </para>
/// <para>
/// Realistic (<see cref="Rules.MarketRules.Enabled"/>, §4.20, fixes F10): cost per point scales
/// with city population (<c>ChannelK · Pop/1000</c>) and decay applies to every
/// (company, product, city) every month, campaign or not
/// (<see cref="World.ApplyMonthlyAdvertisingRealistic"/>).
/// </para>
/// </summary>
internal static class AdvertisingStep
{
    public static void Run(TickContext ctx)
    {
        if (ctx.Rules.Market.Enabled)
        {
            ctx.World.ApplyMonthlyAdvertisingRealistic();
            return;
        }

        ctx.World.ApplyMonthlyAdvertising();
    }
}
