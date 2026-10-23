using System;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Market;

/// <summary>
/// World-market prices under Realistic rules (econ-audit §4.4, P0: CPI = 1, no import impact):
/// <code>
/// ImportPrice = W · ImportMult
/// ExportPrice = W · ExportMult · (1 + V/Depth)^(−x)      V = all companies' export volume this tick
/// </code>
/// W is the effective world price (base × active event overlay).
/// </summary>
public static class WorldTrade
{
    /// <summary>Landed import price per unit.</summary>
    public static decimal ImportPrice(World world, Product product)
    {
        var w = world.GetEffectiveWorldPrice(product.Id);
        var mult = product.Trade.ImportMultiplier;
        return mult == 1m ? w : w * mult;
    }

    /// <summary>
    /// The export price factor <c>(1 + V/Depth)^(−x)</c> ∈ (0, 1]; 1 at zero volume or infinite depth.
    /// </summary>
    public static double DepthFactor(double volume, double depth, double exponent)
    {
        if (!(depth > 0) || !(volume > 0) || exponent == 0) return 1.0;
        return Math.Pow(1.0 + volume / depth, -exponent);
    }

    /// <summary>
    /// Unit export price when the world exports <paramref name="totalVolume"/> units of the
    /// product this month. 0 for non-exportable goods.
    /// </summary>
    public static decimal ExportPrice(World world, Product product, double totalVolume)
    {
        if (!product.Trade.Exportable) return 0m;
        var w = world.GetEffectiveWorldPrice(product.Id) * product.Trade.ExportMultiplier;
        var factor = DepthFactor(totalVolume, product.Trade.WorldMarketDepth, world.Rules.Market.ExportDepthExponent);
        return factor == 1.0 ? w : w * (decimal)factor;
    }

    /// <summary>
    /// Marginal export revenue per unit at volume V: <c>d(V·P(V))/dV = W·m·(1+V/D)^(−x)·(1 − x·V/(D+V))</c>.
    /// Below the full unit cost, exporting more destroys value.
    /// </summary>
    public static decimal MarginalExportRevenue(World world, Product product, double totalVolume)
    {
        if (!product.Trade.Exportable) return 0m;
        var depth = product.Trade.WorldMarketDepth;
        var x = world.Rules.Market.ExportDepthExponent;
        var price = ExportPrice(world, product, totalVolume);
        if (!(depth > 0)) return price;
        var elasticity = 1.0 - x * totalVolume / (depth + totalVolume);
        return price * (decimal)elasticity;
    }
}
