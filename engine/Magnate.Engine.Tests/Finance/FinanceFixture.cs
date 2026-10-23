using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Rules;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Tests.Finance;

/// <summary>Shared builders for the finance tests (Realistic rules on live content unless stated).</summary>
internal static class FinanceFixture
{
    public static readonly CityId Metropolis = new("metropolis");
    public static readonly BuildingTypeId Supermarket = new("supermarket");
    public static readonly ProductId SoftDrink = new("soft_drink");

    /// <summary>Realistic rules with only the finance area switched on (deterministic, market-independent).</summary>
    public static EconomyRules FinanceOnly(FinanceRules? finance = null)
        => EconomyRules.Classic with { Preset = "finance-test", Finance = finance ?? FinanceRules.Realistic };

    /// <summary>A world under <paramref name="rules"/> (default: <see cref="FinanceOnly"/>) on live content.</summary>
    public static World World(EconomyRules? rules = null, GameDate? start = null)
        => Worlds.On(TestContent.Live, rules ?? FinanceOnly(), start: start);

    /// <summary>A company with a supermarket; returns the company and the store.</summary>
    public static (Company Company, BuildingInstance Store) CompanyWithStore(World world, decimal cash = 0m)
    {
        var cost = world.Catalog.BuildingType(Supermarket).ConstructionCost;
        var company = world.CreateCompany("Acme", cash > 0m ? cash : cost * 4m);
        var store = world.Construct(company.Id, Supermarket, Metropolis);
        return (company, store);
    }

    /// <summary>Book a company-level P&amp;L flow (royalty income or corporate overhead) to steer taxable income exactly.</summary>
    public static void BookProfit(World world, CompanyId company, decimal amount)
    {
        if (amount >= 0m) world.RecordCashChange(company, LedgerCategory.PatentRoyaltyIncome, amount, "test income");
        else world.RecordCashChange(company, LedgerCategory.CorporateOverhead, amount, "test expense");
    }

    /// <summary>Σ of a ledger category for a company over its whole history.</summary>
    public static decimal Sum(World world, CompanyId company, LedgerCategory category)
        => world.Ledger.EntriesFor(company).Where(e => e.Category == category).Sum(e => e.Amount);
}
