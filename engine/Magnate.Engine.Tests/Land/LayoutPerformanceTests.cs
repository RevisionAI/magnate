using Magnate.Engine.Domain;
using Magnate.Engine.Land;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System;
using Xunit;

namespace Magnate.Engine.Tests.Land;

/// <summary>
/// Wall-clock budgets. They run in a collection that never overlaps other tests, so the heavy
/// multi-year simulations elsewhere in the suite cannot starve them of CPU.
/// </summary>
[Collection(SerialTimingCollection.Name)]
[Trait("Category", "perf")]
public sealed class LayoutPerformanceTests
{
    // Perf category (Wave 2 merge): it flaked under load in four team reports, so it runs only with
    // MAGNATE_PERF=1 on a quiet machine, like the bridge's perf budgets.
    [PerfFact]
    public void Metropolis_generates_within_the_desktop_budget()
    {
        // Budget: < 50 ms for an optimised (Release) engine on desktop; the WASM build
        // gets ~300 ms. The solution gate runs Debug builds, whose JIT output is
        // unoptimised and several times slower, so there the test guards against
        // algorithmic regressions with a 500 ms ceiling instead. Best of five after a
        // warm-up, so a busy test machine does not fail on scheduling noise.
        var city = LandFixture.City("metropolis");
        _ = CityLayoutGenerator.Generate(city, 77);
        var best = double.MaxValue;
        for (var k = 0; k < 5; k++)
        {
            var sw = Stopwatch.StartNew();
            _ = CityLayoutGenerator.Generate(city, 77 + k);
            best = Math.Min(best, sw.Elapsed.TotalMilliseconds);
        }
        var optimised = typeof(CityLayoutGenerator).Assembly.GetCustomAttribute<DebuggableAttribute>()?.IsJITOptimizerDisabled != true;
        var budget = optimised ? 50.0 : 500.0;
        Assert.True(best < budget, $"Metropolis generation took {best:F1} ms (budget {budget} ms, optimised={optimised})");
    }
}

/// <summary>Tests that measure time: run alone, after the parallel tests.</summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class SerialTimingCollection
{
    /// <summary>Collection name.</summary>
    public const string Name = "serial-timing";
}
