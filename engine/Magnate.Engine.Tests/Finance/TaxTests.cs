using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;
using Xunit;
using static Magnate.Engine.Tests.Finance.FinanceFixture;

namespace Magnate.Engine.Tests.Finance;

/// <summary>Corporate income tax with loss carry-forward (econ-audit §4.9, R9).</summary>
public sealed class TaxTests
{
    private static decimal TaxIn(World world, CompanyId c, int year)
        => world.Ledger.EntriesFor(c).Where(e => e.Category == LedgerCategory.IncomeTax && e.Date.Year == year).Sum(e => e.Amount);

    private static void AdvanceTo(World world, GameDate target)
    {
        while (world.Clock.Now < target)
        {
            world.AdvanceMonth();
            Invariants.AssertAll(world);
        }
    }

    [Fact]
    public void Worked_example_loss_year_then_profit_year_pays_one_million()
    {
        // §4.9: year 1 taxable −$6M → NOL $6M; year 2 +$10M → NOL use min(6, 0.8·10) = 6 → tax 25 % × 4 = $1.0M.
        var world = World();
        var c = world.CreateCompany("Taxed", 100_000_000m);
        BookProfit(world, c.Id, -6_000_000m);
        AdvanceTo(world, new GameDate(2026, 12));
        Assert.Equal(0m, TaxIn(world, c.Id, 2026));
        Assert.Equal(6_000_000m, world.GetTaxPosition(c.Id).LossCarryForward);

        BookProfit(world, c.Id, 10_000_000m); // dated December 2026, recognised in the next tax window (Jan 2027)
        AdvanceTo(world, new GameDate(2027, 12));
        Assert.Equal(-1_000_000m, TaxIn(world, c.Id, 2027));
        Assert.Equal(0m, world.GetTaxPosition(c.Id).LossCarryForward);
        var statement = world.GetIncomeStatement(c.Id, new GameDate(2027, 1), new GameDate(2027, 12));
        Assert.Equal(1_000_000m, statement.IncomeTax);
    }

    [Fact]
    public void Carry_forward_offsets_at_most_eighty_percent_of_the_year()
    {
        var world = World();
        var c = world.CreateCompany("Capped", 100_000_000m);
        BookProfit(world, c.Id, -20_000_000m);
        AdvanceTo(world, new GameDate(2026, 12));
        BookProfit(world, c.Id, 10_000_000m);
        AdvanceTo(world, new GameDate(2027, 12));
        // NOL use = 0.8 × 10M = 8M → tax 25 % × 2M = 0.5M; 12M carried on.
        Assert.Equal(-500_000m, TaxIn(world, c.Id, 2027));
        Assert.Equal(12_000_000m, world.GetTaxPosition(c.Id).LossCarryForward);
    }

    [Fact]
    public void Year_to_date_settlement_refunds_but_never_more_than_was_paid()
    {
        var world = World();
        var c = world.CreateCompany("Swing", 100_000_000m);
        BookProfit(world, c.Id, 4_000_000m);
        world.AdvanceMonth(); // Feb: pays 1.0M
        Assert.Equal(-1_000_000m, TaxIn(world, c.Id, 2026));
        Assert.Equal(1_000_000m, world.GetTaxPosition(c.Id).TaxPaidYtd);

        BookProfit(world, c.Id, -4_000_000m);
        world.AdvanceMonth(); // Mar: YTD 0 → refund 1.0M
        Assert.Equal(0m, TaxIn(world, c.Id, 2026));
        Assert.Contains(world.Ledger.EntriesFor(c.Id), e => e.Category == LedgerCategory.IncomeTax && e.Amount == 1_000_000m);

        BookProfit(world, c.Id, -10_000_000m);
        world.AdvanceMonth(); // Apr: YTD −10M → nothing left to refund
        Assert.Equal(0m, TaxIn(world, c.Id, 2026));
        Assert.Equal(0m, world.GetTaxPosition(c.Id).TaxPaidYtd);
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Every_ledger_profit_is_taxed_exactly_once_across_years()
    {
        var world = World();
        var c = world.CreateCompany("Steady", 100_000_000m);
        decimal booked = 0m;
        for (var i = 0; i < 30; i++)
        {
            var amount = (i % 7 == 3 ? -1m : 1m) * (100_000m + 1_000m * i);
            BookProfit(world, c.Id, amount);
            booked += amount;
            world.AdvanceMonth();
        }

        var history = world.GetCompanyFinance(c.Id)!.History;
        Assert.Equal(booked, history.Sum(h => h.PreTaxIncome));
        var taxes = -world.Ledger.EntriesFor(c.Id).Where(e => e.Category == LedgerCategory.IncomeTax).Sum(e => e.Amount);
        Assert.Equal(taxes, history.Sum(h => h.IncomeTax));
        Invariants.AssertAll(world);
    }

    [Fact]
    public void Zero_rate_books_no_tax_but_keeps_history()
    {
        var world = World(FinanceOnly(FinanceRules.Realistic with { IncomeTaxRate = 0m }));
        var c = world.CreateCompany("Haven", 10_000_000m);
        BookProfit(world, c.Id, 1_000_000m);
        world.AdvanceMonth();
        Assert.DoesNotContain(world.Ledger.Entries, e => e.Category == LedgerCategory.IncomeTax);
        Assert.Single(world.GetCompanyFinance(c.Id)!.History);
    }
}
