using System;
using Xunit;

namespace Magnate.Engine.Tests.TestSupport;

/// <summary>
/// A <see cref="FactAttribute"/> that runs only when <c>MAGNATE_PERF=1</c> (the engine twin of the
/// bridge tests' attribute): wall-clock budgets are meaningless on a shared, loaded machine, so they
/// stay out of the default gate. Mark the test <c>[Trait("Category", "perf")]</c> as well and run
/// them on a quiet machine with <c>MAGNATE_PERF=1 dotnet test --filter Category=perf</c>.
/// </summary>
public sealed class PerfFactAttribute : FactAttribute
{
    /// <summary>Skip unless <c>MAGNATE_PERF=1</c>.</summary>
    public PerfFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("MAGNATE_PERF") != "1")
        {
            Skip = "performance budget; set MAGNATE_PERF=1 to run";
        }
    }
}
