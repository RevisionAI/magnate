using Magnate.Engine.Simulation;

namespace Magnate.Engine.Persistence.Sections;

/// <summary>
/// Schema-v10 save section for the macro area (regime, growth, output gap, inflation, policy rate,
/// CPI, wage level, city population/income mix/land index, commodity x_p). Serialised as the
/// nullable <c>macro</c> property of the save file; <c>null</c> (omitted) when the area has nothing
/// to persist — always the case for Classic worlds and for saves older than v10.
/// <para>
/// <b>Owner: E5 macro, Wave 3.</b> Add the area's state as init-only properties (JSON-serialisable
/// with System.Text.Json defaults; decimals as strings like the rest of the save when exact
/// precision matters), fill them in <see cref="Capture"/> and apply them in <see cref="Restore"/>.
/// Every new property must be optional so older v10 saves keep loading.
/// </para>
/// </summary>
internal sealed record MacroSaveSection
{
    /// <summary>
    /// Snapshot the area's state, or return <c>null</c> when there is nothing to persist (the
    /// section is then omitted from the save).
    /// </summary>
    internal static MacroSaveSection? Capture(World world)
    {
        _ = world;
        // TODO(E5 macro): capture the area's state when world.Rules enables it.
        return null;
    }

    /// <summary>
    /// Apply a persisted section to a freshly rebuilt world. Called after every core collection
    /// (companies, buildings, logs, RNG) has been restored; <paramref name="section"/> is null
    /// for saves that did not write it.
    /// </summary>
    internal static void Restore(World world, MacroSaveSection? section)
    {
        _ = world;
        if (section is null) return;
        // TODO(E5 macro): restore the area's state.
    }
}
