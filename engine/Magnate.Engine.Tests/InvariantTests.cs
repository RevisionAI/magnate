using Magnate.Engine.Tests.TestSupport;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>
/// Runs every golden scenario with <see cref="Invariants.AssertAll"/> after every tick:
/// cash == Σ ledger, books close, no NaN, ranges, attribution, licences, news order.
/// </summary>
public sealed class InvariantTests
{
    public static TheoryData<string> Names()
    {
        var data = new TheoryData<string>();
        foreach (var s in GoldenScenarios.All) data.Add(s.Name);
        return data;
    }

    [Theory]
    [MemberData(nameof(Names))]
    public void Invariants_hold_after_every_tick(string name)
    {
        var scenario = GoldenScenarios.Get(name);
        var world = scenario.Create();
        Invariants.AssertAll(world);
        for (var m = 0; m < scenario.Months; m++)
        {
            scenario.BeforeMonth(world, m);
            world.AdvanceMonth();
            Invariants.AssertAll(world);
        }
    }
}
