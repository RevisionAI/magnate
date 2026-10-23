using System.Linq;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>The monthly pipeline is the econ-audit §4.16 order (the Classic golden masters pin its effects).</summary>
public sealed class TickPipelineTests
{
    [Fact]
    public void Pipeline_runs_the_econ_audit_step_order()
    {
        var expected = new[]
        {
            "Macro", "WorldPrices", "Construction", "Payroll", "Research", "Advertising", "Extraction",
            "Production", "Restock", "Demand", "Export", "Royalties", "Finance", "Depreciation", "Tax",
            "QuarterEnd", "Solvency", "Incumbents", "Events",
        };
        Assert.Equal(expected, MonthlyTick.Pipeline.Select(s => s.Name).ToArray());
    }

    [Fact]
    public void Tick_advances_the_clock_before_any_step_books_entries()
    {
        var world = Worlds.Live();
        var acme = world.CreateCompany("Acme", 50_000_000m);
        world.Construct(acme.Id, new Domain.BuildingTypeId("supermarket"), new Domain.CityId("metropolis"));
        world.AdvanceMonth();

        var opex = world.Ledger.Entries.Single(e => e.Category == Economics.LedgerCategory.OperatingCost);
        Assert.Equal(new GameDate(2026, 2), opex.Date);
    }
}
