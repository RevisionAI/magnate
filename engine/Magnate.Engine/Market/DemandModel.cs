using System;
using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Market;

/// <summary>
/// One store line competing in a (city, product) market: a building's merged retail slots for
/// the product (econ-audit §4.1 "per-offer attributes").
/// </summary>
/// <param name="Price">P: the shelf price.</param>
/// <param name="Quality">Q: weighted-average quality of the stock (0–100).</param>
/// <param name="Brand">B: the owner's brand awareness in the city (the import-brand floor is applied by the model).</param>
/// <param name="Tech">T: technology score 0–100 (100 × max(own tech, world tech) / max tech).</param>
/// <param name="Attractiveness">A: location × draw × √slots × level bonus.</param>
/// <param name="Sellable">min(stock, capacity) in units; an offer with nothing to sell is not in the choice set.</param>
public readonly record struct DemandOffer(
    double Price,
    double Quality,
    double Brand,
    double Tech,
    double Attractiveness,
    double Sellable);

/// <summary>The market-level inputs of one demand evaluation.</summary>
/// <param name="Profile">The product's demand parameters.</param>
/// <param name="Population">City population.</param>
/// <param name="MixLow">Low-income share of the population.</param>
/// <param name="MixMiddle">Middle-income share.</param>
/// <param name="MixHigh">High-income share.</param>
/// <param name="PriceLevel">City price index × CPI: scales the reference price and the incumbents' price.</param>
/// <param name="WorldTech">The world technology score (0–100) the incumbents and laggards sell at.</param>
/// <param name="IncumbentMass">A₀: attractiveness of the local competition (0 = no incumbents).</param>
/// <param name="SpillFraction">Share of unserved demand re-offered once.</param>
public sealed record DemandMarket(
    ProductDemandProfile Profile,
    double Population,
    double MixLow,
    double MixMiddle,
    double MixHigh,
    double PriceLevel,
    double WorldTech,
    double IncumbentMass,
    double SpillFraction)
{
    /// <summary>Population share of a bracket.</summary>
    public double Mix(IncomeBracket bracket) => bracket switch
    {
        IncomeBracket.Low => MixLow,
        IncomeBracket.Middle => MixMiddle,
        _ => MixHigh,
    };

    /// <summary>
    /// Incumbents' price relative to the reference point (1 = they sell at <c>Pref · PriceLevel</c>,
    /// the game's P0 rule). Unlike <see cref="PriceLevel"/> it does not move willingness to pay:
    /// the hook for P1 incumbent pricing and for the R3 "all prices × k" regression check.
    /// </summary>
    public double IncumbentPriceFactor { get; init; } = 1.0;

    /// <summary>Incumbents' shelf price: <c>Pref · PriceLevel · IncumbentPriceFactor</c>.</summary>
    public double IncumbentPrice => IncumbentPriceFactor == 1.0
        ? (double)Profile.ReferencePrice * PriceLevel
        : (double)Profile.ReferencePrice * PriceLevel * IncumbentPriceFactor;
}

/// <summary>One income bracket's result.</summary>
/// <param name="Bracket">The bracket.</param>
/// <param name="Population">People in the bracket.</param>
/// <param name="PerCapita">q: units per capita per month at the reference point.</param>
/// <param name="ReferenceDemand">D_ref: units when only incumbents trade at the reference price.</param>
/// <param name="Demand">D_b: category demand at the offered prices and values.</param>
/// <param name="EffectivePrice">P̃eff: the share-weighted quality-adjusted market price.</param>
/// <param name="MedianWtp">R_b: median willingness to pay for an average-value unit.</param>
public readonly record struct BracketOutcome(
    IncomeBracket Bracket,
    double Population,
    double PerCapita,
    double ReferenceDemand,
    double Demand,
    double EffectivePrice,
    double MedianWtp);

/// <summary>The result of one demand evaluation (all quantities in units per month).</summary>
public sealed class DemandOutcome
{
    internal DemandOutcome(int offers)
    {
        Demand = new double[offers];
        Sold = new double[offers];
        Share = new double[offers];
    }

    /// <summary>d_j: demand allocated to each offer before capacity and spill.</summary>
    public double[] Demand { get; }

    /// <summary>x_j: units each offer sells, including spill.</summary>
    public double[] Sold { get; }

    /// <summary>Each offer's share of category demand (Σ over brackets of D_b·s_jb ÷ Σ D_b).</summary>
    public double[] Share { get; }

    /// <summary>Units the local competition sells, including spill.</summary>
    public double IncumbentSold { get; internal set; }

    /// <summary>Incumbent demand before spill.</summary>
    public double IncumbentDemand { get; internal set; }

    /// <summary>Σ D_ref: market size at the reference point.</summary>
    public double ReferenceDemand { get; internal set; }

    /// <summary>Σ D_b: category demand at the offered prices.</summary>
    public double TotalDemand { get; internal set; }

    /// <summary>Demand that found no stock and was lost after the spill pass.</summary>
    public double Lost { get; internal set; }

    /// <summary>Per-bracket detail, Low → High (brackets with no demand included).</summary>
    public IReadOnlyList<BracketOutcome> Brackets { get; internal set; } = Array.Empty<BracketOutcome>();

    /// <summary>Total units sold by offers and incumbents.</summary>
    public double TotalSold
    {
        get
        {
            var total = IncumbentSold;
            foreach (var x in Sold) total += x;
            return total;
        }
    }
}

/// <summary>
/// The Realistic consumer-demand model (econ-audit §4.1–4.2), a 1:1 port of the calibration
/// model's <c>allocate</c> (Appendix A): a lognormal willingness-to-pay category demand per
/// income bracket, split between offers by a CES/logit choice on quality-adjusted price, with
/// the permanent incumbent local competition as offer 0, then one spill pass of unserved demand.
/// Pure: the caller supplies every input; the same inputs give bit-identical outputs.
/// </summary>
public static class DemandModel
{
    /// <summary>Brackets in evaluation order (never reorder: floating-point sums depend on it).</summary>
    public static readonly IncomeBracket[] Brackets = { IncomeBracket.Low, IncomeBracket.Middle, IncomeBracket.High };

    /// <summary>Category-elasticity multiplier per bracket (low income is more price-sensitive).</summary>
    public static double ElasticityMultiplier(IncomeBracket b) => b switch { IncomeBracket.Low => 1.40, IncomeBracket.Middle => 1.00, _ => 0.60 };

    /// <summary>Offer-substitution multiplier per bracket.</summary>
    public static double OfferElasticityMultiplier(IncomeBracket b) => b switch { IncomeBracket.Low => 1.25, IncomeBracket.Middle => 1.00, _ => 0.75 };

    /// <summary>Brand-weight multiplier per bracket.</summary>
    public static double BrandWeightMultiplier(IncomeBracket b) => b switch { IncomeBracket.Low => 0.85, IncomeBracket.Middle => 1.00, _ => 1.25 };

    /// <summary>Quality-weight multiplier per bracket.</summary>
    public static double QualityWeightMultiplier(IncomeBracket b) => b switch { IncomeBracket.Low => 0.90, IncomeBracket.Middle => 1.00, _ => 1.20 };

    /// <summary>Perceived value S ∈ [0, 100] of (Q, B, T) for a bracket.</summary>
    public static double Score(ProductDemandProfile p, IncomeBracket bracket, double quality, double brand, double tech)
    {
        var wq = p.WeightQuality * QualityWeightMultiplier(bracket);
        var wb = p.WeightBrand * BrandWeightMultiplier(bracket);
        var wt = p.WeightTech;
        return (wq * quality + wb * brand + wt * tech) / (wq + wb + wt);
    }

    /// <summary>Value multiplier <c>M = exp(κ·(S − 50)/50)</c>.</summary>
    public static double ValueMultiplier(ProductDemandProfile p, double score) => Math.Exp(p.ValueSpread * (score - 50) / 50);

    /// <summary>
    /// Evaluate the market. <paramref name="offers"/> keeps the caller's order (buildings by id);
    /// <paramref name="curves"/> caches the reference-point z per (ε, σ).
    /// </summary>
    public static DemandOutcome Evaluate(DemandMarket market, IReadOnlyList<DemandOffer> offers, DemandCurveCache curves)
    {
        ArgumentNullException.ThrowIfNull(market);
        ArgumentNullException.ThrowIfNull(offers);
        ArgumentNullException.ThrowIfNull(curves);

        var p = market.Profile;
        var n = offers.Count;
        var outcome = new DemandOutcome(n);
        var demand = outcome.Demand;
        double incumbent = 0, referenceTotal = 0, demandTotal = 0;
        var brackets = new BracketOutcome[Brackets.Length];

        var pref = (double)p.ReferencePrice * market.PriceLevel;
        var p0 = market.IncumbentPrice;
        var sigma = p.WtpSigma;

        // Scratch: candidate attractiveness and quality-adjusted price, incumbent first.
        var candA = new double[n + 1];
        var candPt = new double[n + 1];
        var candIndex = new int[n + 1];

        for (var bi = 0; bi < Brackets.Length; bi++)
        {
            var bracket = Brackets[bi];
            var population = market.Population * market.Mix(bracket);
            var perCapita = p.PerCapita(bracket);
            var dref = population * perCapita;
            if (!(dref > 0))
            {
                brackets[bi] = new BracketOutcome(bracket, population, perCapita, 0, 0, 0, 0);
                continue;
            }

            var eps = p.CategoryElasticity * ElasticityMultiplier(bracket);
            var theta = p.OfferElasticity * OfferElasticityMultiplier(bracket);
            var m0 = ValueMultiplier(p, Score(p, bracket, p.IncumbentQuality, p.IncumbentBrand, market.WorldTech));
            var ptRef = pref / m0;
            var r = ptRef * Math.Exp(-curves.ReferenceZ(eps, sigma) * sigma);

            var count = 0;
            candIndex[count] = -1;
            candA[count] = market.IncumbentMass;
            candPt[count] = p0 / m0;
            count++;
            for (var i = 0; i < n; i++)
            {
                var o = offers[i];
                if (!(o.Sellable > 0) || !(o.Price > 0)) continue;   // empty shelves are not in the choice set
                var s = Score(p, bracket, o.Quality, Math.Max(o.Brand, p.ImportBrand), o.Tech);
                candIndex[count] = i;
                candA[count] = o.Attractiveness;
                candPt[count] = o.Price / ValueMultiplier(p, s);
                count++;
            }

            var weights = new double[count];
            double wSum = 0;
            for (var k = 0; k < count; k++)
            {
                weights[k] = candA[k] > 0 ? candA[k] * Math.Pow(candPt[k], -theta) : 0;
                wSum += weights[k];
            }

            if (!(wSum > 0))
            {
                brackets[bi] = new BracketOutcome(bracket, population, perCapita, dref, 0, 0, r);
                referenceTotal += dref;
                continue;
            }

            double ptEff = 0;
            for (var k = 0; k < count; k++) ptEff += weights[k] / wSum * candPt[k];

            var d = dref * Normal.LogSurvival(ptEff / r, sigma) / Normal.LogSurvival(ptRef / r, sigma);
            for (var k = 0; k < count; k++)
            {
                var units = d * (weights[k] / wSum);
                if (candIndex[k] < 0) incumbent += units;
                else demand[candIndex[k]] += units;
            }

            brackets[bi] = new BracketOutcome(bracket, population, perCapita, dref, d, ptEff, r);
            referenceTotal += dref;
            demandTotal += d;
        }

        outcome.Brackets = brackets;
        outcome.ReferenceDemand = referenceTotal;
        outcome.TotalDemand = demandTotal;
        outcome.IncumbentDemand = incumbent;
        for (var i = 0; i < n; i++) outcome.Share[i] = demandTotal > 0 ? demand[i] / demandTotal : 0;

        // Sales, capacity and one spill pass (Appendix A, generalised).
        var sold = outcome.Sold;
        double unserved = 0;
        for (var i = 0; i < n; i++)
        {
            sold[i] = Math.Min(demand[i], Math.Max(0, offers[i].Sellable));
            unserved += demand[i] - sold[i];
        }

        var lost = unserved;
        if (unserved > 0 && market.SpillFraction > 0)
        {
            var pool = market.SpillFraction * unserved;
            var mass = new double[n];
            double total = incumbent;
            for (var i = 0; i < n; i++)
            {
                var resid = offers[i].Sellable - sold[i];
                mass[i] = resid > 0 ? demand[i] : 0;
                total += mass[i];
            }

            if (total > 0)
            {
                double absorbed = 0;
                for (var i = 0; i < n; i++)
                {
                    if (!(mass[i] > 0)) continue;
                    var add = Math.Min(offers[i].Sellable - sold[i], pool * mass[i] / total);
                    sold[i] += add;
                    absorbed += add;
                }

                var toIncumbent = pool * incumbent / total;
                incumbent += toIncumbent;
                absorbed += toIncumbent;
                lost = unserved - absorbed;
            }
        }

        outcome.IncumbentSold = incumbent;
        outcome.Lost = Math.Max(0, lost);
        return outcome;
    }
}

/// <summary>
/// Cache of the reference-point z per (ε, σ) (Appendix A <c>zref</c>, precomputed once per
/// product and bracket). One instance per world: never static, so parallel worlds never share
/// mutable state.
/// </summary>
public sealed class DemandCurveCache
{
    private readonly Dictionary<(double Elasticity, double Sigma), double> _z = new();

    /// <summary>z solving <c>φ(z)/(σ(1−Φ(z))) = ε</c>.</summary>
    public double ReferenceZ(double elasticity, double sigma)
    {
        if (!_z.TryGetValue((elasticity, sigma), out var z))
        {
            z = Normal.ReferenceZ(elasticity, sigma);
            _z[(elasticity, sigma)] = z;
        }

        return z;
    }
}
