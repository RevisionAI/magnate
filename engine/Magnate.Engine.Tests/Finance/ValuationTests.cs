using Magnate.Engine.Finance;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Finance.FinanceFixture;

namespace Magnate.Engine.Tests.Finance;

/// <summary>The single company-value definition (master plan D10, econ-audit §4.11/§4.18).</summary>
public sealed class ValuationTests
{
    [Fact]
    public void Classic_company_value_is_total_assets()
    {
        var world = Worlds.Live();
        var c = world.CreateCompany("Old", world.Catalog.BuildingType(Supermarket).ConstructionCost * 1.5m);
        world.Construct(c.Id, Supermarket, Metropolis);
        var v = world.GetValuation(c.Id);
        Assert.Equal(ValuationMethod.TotalAssets, v.Method);
        Assert.Equal(world.GetBalanceSheet(c.Id).TotalAssets, v.Value);
    }

    [Fact]
    public void A_fresh_company_is_worth_its_book_equity()
    {
        var world = World();
        var c = world.CreateCompany("New", 45_000_000m);
        var v = world.GetValuation(c.Id);
        Assert.Equal(ValuationMethod.Fundamental, v.Method);
        Assert.Equal(45_000_000m, v.Value);
        Assert.Equal(1.0, v.PriceToBook);
        Assert.Equal(45_000_000m, v.NetCash);
        Assert.Equal(0m, v.OperatingAssets);
    }

    [Fact]
    public void Idle_cash_is_valued_at_face_value()
    {
        var world = World();
        var c = world.CreateCompany("Idle", 30_000_000m);
        for (var i = 0; i < 24; i++) world.AdvanceMonth();
        Assert.Equal(30_000_000m, world.GetCorporateValue(c.Id));
    }

    [Fact]
    public void Building_a_first_store_does_not_mark_the_company_down()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        world.AdvanceMonth();
        var v = world.GetValuation(c.Id);
        var equity = world.GetBalanceSheet(c.Id).Equity;
        Assert.InRange(v.Value, equity * 0.9m, equity * 1.01m);
    }

    [Fact]
    public void Steady_profits_lift_value_above_book()
    {
        var world = World();
        var (c, store) = CompanyWithStore(world);
        for (var i = 0; i < 24; i++)
        {
            BookProfit(world, c.Id, store.CapitalizedCost * 0.05m); // ~ 60 %/yr pre-tax on the store before its opex
            world.AdvanceMonth();
        }

        var v = world.GetValuation(c.Id);
        Assert.True(v.OperatingMultiple > 1.5, $"multiple {v.OperatingMultiple}");
        Assert.True(v.Value > world.GetBalanceSheet(c.Id).Equity);
        Assert.InRange(v.CostOfCapital, 0.08, 0.12);
        Assert.InRange(v.ReturnOnCapital, 0.15, 0.6);
    }

    [Fact]
    public void Losses_on_operating_assets_value_below_book_but_not_below_net_cash()
    {
        var world = World();
        var (c, _) = CompanyWithStore(world);
        for (var i = 0; i < 24; i++)
        {
            BookProfit(world, c.Id, -50_000m);
            world.AdvanceMonth();
        }

        var v = world.GetValuation(c.Id);
        var bs = world.GetBalanceSheet(c.Id);
        Assert.True(v.Value < bs.Equity);
        Assert.True(v.Value >= bs.Cash - bs.Liabilities);
        Assert.Equal(0.25, v.OperatingMultiple, 6);
    }

    [Fact]
    public void Corporate_value_goal_reads_the_engine_value()
    {
        var world = World();
        var c = world.CreateCompany("Goal", 10_000_000m);
        var goal = new CorporateValueGoal("Reach $10M", 10_000_000m);
        Assert.True(goal.Evaluate(world, c.Id).Achieved);
        Assert.False(new CorporateValueGoal("Reach $11M", 11_000_000m).Evaluate(world, c.Id).Achieved);
        Assert.Equal(world.GetCorporateValue(c.Id), world.GetValuation(c.Id).Value);
        Assert.True(new TotalAssetsGoal("assets", 10_000_000m).Evaluate(world, c.Id).Achieved);
        Assert.True(new NetWorthGoal("worth", 10_000_000m).Evaluate(world, c.Id).Achieved);
    }

    [Fact]
    public void Rates_feed_the_cost_of_equity()
    {
        var low = World(FinanceOnly(FinanceRules.Realistic with { PolicyRate = 0.01m }));
        var high = World(FinanceOnly(FinanceRules.Realistic with { PolicyRate = 0.08m }));
        var a = low.CreateCompany("A", 10_000_000m);
        var b = high.CreateCompany("B", 10_000_000m);
        Assert.True(high.GetValuation(b.Id).CostOfCapital > low.GetValuation(a.Id).CostOfCapital);
    }
}
