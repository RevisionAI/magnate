using System;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;
using Xunit;
using static Magnate.Engine.Tests.Market.MarketTestKit;

namespace Magnate.Engine.Tests.Market;

/// <summary>
/// The Realistic demand model (econ-audit §4.1–4.2, Appendix A) against the calibration's own
/// numbers (§5.2) and the regression checks R2–R4 (§6). Pure: every input is built from live
/// content; no tick runs.
/// </summary>
[Trait("Area", "Market")]
public sealed class DemandModelTests
{
    private static readonly DemandCurveCache Curves = new();

    private static DemandOutcome Evaluate(DemandMarket market, params DemandOffer[] offers)
        => DemandModel.Evaluate(market, offers, Curves);

    // ------------------------------------------------------------------ normal distribution

    [Theory]
    [InlineData(0.0, 0.5)]
    [InlineData(1.0, 0.8413447460685429)]
    [InlineData(-1.0, 0.15865525393145707)]
    [InlineData(1.6448536269514722, 0.95)]
    [InlineData(3.0, 0.9986501019683699)]
    public void Phi_matches_the_standard_normal_cdf(double z, double expected)
        => Assert.Equal(expected, Normal.Cdf(z), 6);

    [Fact]
    public void Upper_tail_keeps_relative_precision_far_out()
    {
        // 1 − Φ(6) = 9.87e-10: the complementary form must not cancel to 0.
        var tail = Normal.UpperTail(6.0);
        Assert.InRange(tail, 9.0e-10, 1.05e-9);
        Assert.Equal(1.0, Normal.UpperTail(-40), 12);
        Assert.Equal(0.0, Normal.LogSurvival(1e300, 0.5), 12);
    }

    [Theory]
    [InlineData(0.8, 0.45)]
    [InlineData(1.12, 0.45)]   // low bracket of soft drink: ε × 1.4
    [InlineData(0.21, 0.35)]   // high bracket of bread: ε × 0.6
    [InlineData(1.82, 0.6)]    // low bracket of designer jeans
    public void Reference_z_solves_the_elasticity_equation(double elasticity, double sigma)
    {
        var z = Normal.ReferenceZ(elasticity, sigma);
        Assert.InRange(z, -8.0, 4.0);
        var implied = Normal.Pdf(z) / (sigma * Normal.UpperTail(z));
        Assert.Equal(elasticity, implied, 9);
    }

    // ------------------------------------------------------------------ reference point

    [Fact]
    public void Incumbents_alone_at_the_reference_price_sell_exactly_the_reference_demand()
    {
        var world = Realistic();
        foreach (var product in world.Catalog.Products.Values.Where(p => p.Demand is not null))
        {
            var market = MarketOf(world, Metropolis, product.Id);
            var outcome = Evaluate(market);
            Assert.Equal(outcome.ReferenceDemand, outcome.TotalDemand, 6);
            Assert.Equal(outcome.ReferenceDemand, outcome.IncumbentSold, 6);
            Assert.Equal(0, outcome.Lost);
        }
    }

    [Fact]
    public void Metropolis_soft_drink_market_matches_the_content_table()
    {
        // Table 4.7-B: 500k × (0.45·24 + 0.40·26 + 0.15·22) = 12.25M bottles ≈ $21.4M at Pref.
        var world = Realistic();
        var outcome = Evaluate(MarketOf(world, Metropolis, SoftDrink));
        Assert.Equal(12_250_000, outcome.ReferenceDemand, 3);
        Assert.Equal(21_437_500, outcome.ReferenceDemand * 1.75, 1);
    }

    [Theory]
    [InlineData("soft_drink", 63.5, 31.8, 12.4)]
    [InlineData("bread", 28.8, 14.2, 5.4)]
    [InlineData("television", 7.2, 3.8, 1.7)]
    [InlineData("car", 75.0, 40.5, 19.4)]
    public void Incumbent_masses_match_the_calibration(string product, double metropolis, double riverside, double hilltown)
    {
        // econ §5.2 "incumbent masses at game start (normal difficulty)", equivalent reference-store slots.
        var world = Realistic();
        var id = new ProductId(product);
        Assert.Equal(metropolis, world.GetIncumbentMass(Metropolis, id), 1);
        Assert.Equal(riverside, world.GetIncumbentMass(Riverside, id), 1);
        Assert.Equal(hilltown, world.GetIncumbentMass(Hilltown, id), 1);
    }

    [Fact]
    public void Incumbent_strength_scales_the_local_competition_and_zero_removes_it()
    {
        var normal = Realistic().GetIncumbentMass(Metropolis, SoftDrink);
        Assert.Equal(normal * 0.6, Realistic(m => m with { IncumbentStrength = 0.6 }).GetIncumbentMass(Metropolis, SoftDrink), 9);
        Assert.Equal(normal * 1.4, Realistic(m => m with { IncumbentStrength = 1.4 }).GetIncumbentMass(Metropolis, SoftDrink), 9);
        Assert.Equal(0, Realistic(m => m with { IncumbentStrength = 0 }).GetIncumbentMass(Metropolis, SoftDrink));
    }

    // ------------------------------------------------------------------ Appendix A reference values

    [Fact]
    public void Soft_drink_monopoly_at_one_and_a_half_times_reference_matches_appendix_a()
    {
        // Appendix A: "6,919,749 for soft_drink at 1.5× with no incumbents".
        var world = Realistic();
        var outcome = Evaluate(MarketOf(world, Metropolis, SoftDrink, incumbents: false), Uncapped(1.5 * 1.75));
        Assert.InRange(outcome.Sold[0], 6_919_749 * 0.999, 6_919_749 * 1.001);
    }

    [Theory]
    [InlineData(45, 50, 30, 0.015, 0.006)]
    [InlineData(60, 50, 30, 0.032, 0.012)]
    [InlineData(80, 50, 30, 0.080, 0.031)]
    [InlineData(80, 70, 60, 0.148, 0.059)]
    [InlineData(100, 90, 100, 0.503, 0.278)]
    public void Brand_quality_and_tech_lift_share_as_calibrated(double brand, double quality, double tech, double shareAtRef, double shareAt120)
    {
        // econ §5.2 brand/quality/tech table: one uncapped supermarket soft-drink line against the
        // Metropolis incumbents.
        var market = MarketOf(Realistic(), Metropolis, SoftDrink);
        var atRef = Evaluate(market, Uncapped(1.75, brand, quality, tech));
        var at120 = Evaluate(market, Uncapped(1.2 * 1.75, brand, quality, tech));
        Assert.Equal(shareAtRef, atRef.Sold[0] / atRef.TotalSold, 3);
        Assert.Equal(shareAt120, at120.Sold[0] / at120.TotalSold, 3);
    }

    [Fact]
    public void Brand_eighty_row_sells_the_appendix_a_volume()
    {
        // Appendix A: "returns 1,002,498 units for the brand-80 row".
        var outcome = Evaluate(MarketOf(Realistic(), Metropolis, SoftDrink), Uncapped(1.75, brand: 80));
        Assert.InRange(outcome.Sold[0], 1_002_498 * 0.999, 1_002_498 * 1.001);
    }

    // ------------------------------------------------------------------ T4 / R2 monopoly bound

    public static TheoryData<string, double[]> MonopolyUnits => new()
    {
        // econ §5.2 T4 units at 0.8 / 1 / 1.25 / 1.5 / 2 / 3 / 5 × Pref (Metropolis, no incumbents).
        { "soft_drink", new[] { 14.3e6, 12.3e6, 9.5e6, 6.9e6, 3.4e6, 0.75e6, 44e3 } },
        { "bread", new[] { 3.20e6, 3.04e6, 2.62e6, 2.07e6, 1.04e6, 175e3, 3.8e3 } },
        { "t_shirt", new[] { 802e3, 670e3, 515e3, 388e3, 214e3, 66e3, 8.3e3 } },
        { "designer_jeans", new[] { 37e3, 30e3, 23e3, 17e3, 9.4e3, 3.1e3, 446 } },
        { "television", new[] { 7.3e3, 5.6e3, 3.9e3, 2.7e3, 1.3e3, 338, 34 } },
        { "car", new[] { 2357.0, 1928, 1428, 1025, 510, 127, 10 } },
    };

    private static readonly double[] Grid = { 0.8, 1.0, 1.25, 1.5, 2.0, 3.0, 5.0 };

    [Theory]
    [MemberData(nameof(MonopolyUnits))]
    public void Monopoly_units_follow_the_calibration_grid(string product, double[] expected)
    {
        var id = new ProductId(product);
        var market = MarketOf(Realistic(), Metropolis, id, incumbents: false);
        var pref = (double)Profile(id).ReferencePrice;
        for (var i = 0; i < Grid.Length; i++)
        {
            var units = Evaluate(market, Uncapped(Grid[i] * pref)).Sold[0];
            // The calibration table is printed to 2–3 significant figures.
            var tolerance = Math.Max(0.02 * expected[i], 1.0);
            Assert.True(Math.Abs(units - expected[i]) <= tolerance, $"{product} at {Grid[i]}× Pref: {units:N0} units, calibration {expected[i]:N0}");
        }
    }

    [Theory]
    [InlineData("soft_drink")]
    [InlineData("bread")]
    [InlineData("beer")]
    [InlineData("coffee_drink")]
    [InlineData("t_shirt")]
    [InlineData("designer_jeans")]
    [InlineData("television")]
    [InlineData("car")]
    public void Monopolist_has_an_interior_optimum_and_nothing_left_at_twenty_times(string product)
    {
        // R2 / T4: one store, no incumbents, unlimited capacity. Optimum in [1.1, 1.8] × Pref
        // (calibration 1.25–1.5×); gross profit at 20× < 1 % of the optimum.
        var id = new ProductId(product);
        var market = MarketOf(Realistic(), Metropolis, id, incumbents: false);
        var pref = (double)Profile(id).ReferencePrice;
        var cost = ImportCost(id);
        double Profit(double multiple) => Evaluate(market, Uncapped(multiple * pref)).Sold[0] * (multiple * pref - cost);

        var grid = Enumerable.Range(0, 151).Select(i => 0.5 + i * 0.01).ToList();   // 0.50 … 2.00 × Pref
        var best = grid.OrderByDescending(Profit).First();
        Assert.InRange(best, 1.1, 1.8);
        Assert.True(Profit(best) > 0);
        Assert.True(Profit(20) < 0.01 * Profit(best), $"{product}: profit at 20× {Profit(20):N0} vs optimum {Profit(best):N0}");
        Assert.True(Evaluate(market, Uncapped(20 * pref)).Sold[0] * 20 * pref < 0.01 * Evaluate(market, Uncapped(pref)).Sold[0] * pref,
            "revenue at 20× Pref is (almost) nothing");
    }

    // ------------------------------------------------------------------ R3 downward-sloping total

    [Theory]
    [InlineData("soft_drink")]
    [InlineData("bread")]
    [InlineData("t_shirt")]
    [InlineData("television")]
    [InlineData("car")]
    public void Raising_every_price_strictly_lowers_total_units(string product)
    {
        // R3: multiply every offer's price — the incumbents' included — by k ∈ {0.8, 1, 1.25, 1.5, 2}
        // with willingness to pay held fixed (a price-level change would move it too). Checked
        // with and without the local competition.
        var id = new ProductId(product);
        var world = Realistic();
        var pref = (double)Profile(id).ReferencePrice;
        foreach (var incumbents in new[] { false, true })
        {
            var market = MarketOf(world, Metropolis, id, incumbents);
            double previous = double.PositiveInfinity;
            foreach (var k in new[] { 0.8, 1.0, 1.25, 1.5, 2.0 })
            {
                var scaled = market with { IncumbentPriceFactor = k };
                var outcome = Evaluate(scaled, Uncapped(k * 0.95 * pref, brand: 60), Uncapped(k * 1.1 * pref, quality: 70), Uncapped(k * pref, attractiveness: 2));
                Assert.True(outcome.TotalSold < previous, $"{product} (incumbents {incumbents}): total units must fall at k = {k}");
                previous = outcome.TotalSold;
            }
        }
    }

    [Fact]
    public void A_price_level_change_moves_willingness_to_pay_with_it()
    {
        // CPI / city price index: every price and the reference point scale together.
        var market = MarketOf(Realistic(), Metropolis, SoftDrink);
        var at1 = Evaluate(market, Uncapped(1.9, brand: 60));
        var at2 = Evaluate(market with { PriceLevel = 2 }, Uncapped(3.8, brand: 60));
        Assert.Equal(at1.TotalSold, at2.TotalSold, 3);
        Assert.Equal(at1.Sold[0], at2.Sold[0], 3);
    }

    [Fact]
    public void One_firms_higher_price_never_raises_its_own_units()
    {
        var market = MarketOf(Realistic(), Metropolis, SoftDrink);
        double previous = double.PositiveInfinity;
        for (var p = 1.0; p <= 6.0; p += 0.05)
        {
            var units = Evaluate(market, Uncapped(p, brand: 60)).Sold[0];
            Assert.True(units <= previous + 1e-9);
            previous = units;
        }
    }

    // ------------------------------------------------------------------ R4 incumbent floor

    [Fact]
    public void A_dominant_overpricing_brand_cannot_take_the_whole_market()
    {
        // R4: incumbents at the 25 % floor; one player whose attractiveness equals the incumbents'
        // base mass, pricing at 2 × Pref with brand 100: share < 70 % (calibration 57.7 %).
        var market = MarketOf(Realistic(), Metropolis, SoftDrink);
        var baseMass = market.IncumbentMass;
        var floored = market with { IncumbentMass = 0.25 * baseMass };
        var outcome = Evaluate(floored, Uncapped(2 * 1.75, brand: 100, attractiveness: baseMass));
        var share = outcome.Sold[0] / outcome.TotalSold;
        Assert.InRange(share, 0.50, 0.70);
        Assert.Equal(0.577, share, 2);
    }

    // ------------------------------------------------------------------ choice set, capacity, spill

    [Fact]
    public void Empty_shelves_are_not_in_the_choice_set()
    {
        var market = MarketOf(Realistic(), Hilltown, Bread);
        var alone = Evaluate(market, Uncapped(3.2));
        var withEmpty = Evaluate(market, Uncapped(3.2), new DemandOffer(2.0, 50, 0, 30, 5, 0));
        Assert.Equal(alone.Sold[0], withEmpty.Sold[0], 9);
        Assert.Equal(0, withEmpty.Sold[1]);
        Assert.Equal(0, withEmpty.Demand[1]);
    }

    [Fact]
    public void Capacity_caps_sales_and_spills_sixty_percent_of_the_excess_once()
    {
        var market = MarketOf(Realistic(), Hilltown, Bread);
        var free = Evaluate(market, Uncapped(2.6, attractiveness: 4), Uncapped(3.2));
        var cap = free.Demand[0] / 2;
        var capped = Evaluate(market, Uncapped(2.6, attractiveness: 4) with { Sellable = cap }, Uncapped(3.2));

        Assert.Equal(cap, capped.Sold[0], 9);
        var unserved = free.Demand[0] - cap;
        // The spill goes to the other line and the incumbents in proportion to their demand.
        var absorbed = capped.Sold[1] - capped.Demand[1] + (capped.IncumbentSold - capped.IncumbentDemand);
        Assert.Equal(0.6 * unserved, absorbed, 6);
        Assert.Equal(0.4 * unserved, capped.Lost, 6);
        Assert.Equal(capped.Demand[1] / (capped.Demand[1] + capped.IncumbentDemand),
            (capped.Sold[1] - capped.Demand[1]) / absorbed, 9);
    }

    [Fact]
    public void Spill_never_exceeds_a_lines_spare_stock()
    {
        var market = MarketOf(Realistic(), Hilltown, Bread);
        var outcome = Evaluate(market,
            Uncapped(2.4, attractiveness: 6) with { Sellable = 1000 },
            Uncapped(3.2) with { Sellable = 50 });
        Assert.Equal(1000, outcome.Sold[0], 9);
        Assert.Equal(50, outcome.Sold[1], 9);
        Assert.True(outcome.Lost > 0);
    }

    [Fact]
    public void Evaluation_is_bit_identical_for_identical_inputs()
    {
        var market = MarketOf(Realistic(), Metropolis, TShirt);
        var offers = new[] { Uncapped(14.5, 40), Uncapped(16.0, 70, 60), Uncapped(13.0) with { Sellable = 20_000 } };
        var a = DemandModel.Evaluate(market, offers, new DemandCurveCache());
        var b = DemandModel.Evaluate(market, offers, new DemandCurveCache());
        Assert.Equal(a.Sold, b.Sold);
        Assert.Equal(a.IncumbentSold, b.IncumbentSold);
        Assert.Equal(BitConverter.DoubleToInt64Bits(a.TotalDemand), BitConverter.DoubleToInt64Bits(b.TotalDemand));
    }

    [Fact]
    public void Model_shares_and_the_incumbents_split_the_category_demand()
    {
        var market = MarketOf(Realistic(), Metropolis, SoftDrink);
        var outcome = Evaluate(market, Uncapped(1.6, 50), Uncapped(1.9, 70), Uncapped(1.75) with { Sellable = 1 });
        Assert.Equal(outcome.TotalDemand, outcome.Demand.Sum() + outcome.IncumbentDemand, 6);
        Assert.Equal(1.0, outcome.Share.Sum() + outcome.IncumbentDemand / outcome.TotalDemand, 9);
        Assert.Equal(new[] { IncomeBracket.Low, IncomeBracket.Middle, IncomeBracket.High }, outcome.Brackets.Select(b => b.Bracket));
    }
}
