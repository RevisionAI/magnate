using Magnate.Engine.Content;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests.TestSupport;

/// <summary>
/// World factories for tests. Pick the one that matches what the test asserts:
/// <list type="bullet">
///   <item><see cref="Classic"/> — pins today's numbers: Classic rules on the frozen Classic content.</item>
///   <item><see cref="Live"/> — ruleset/content-agnostic mechanics and invariants on live content
///         (Classic rules, the default of <c>new World(...)</c>).</item>
///   <item><see cref="Realistic"/> — the gameplay ruleset on live content.</item>
/// </list>
/// </summary>
public static class Worlds
{
    /// <summary>Default start month of every test world.</summary>
    public static readonly GameDate DefaultStart = new(2026, 1);

    /// <summary>Classic rules on the frozen Classic content fixture.</summary>
    public static World Classic(int seed = 42, GameDate? start = null)
        => new(TestContent.Classic, seed, start ?? DefaultStart, EconomyRules.Classic);

    /// <summary>Default (Classic) rules on the live content tree.</summary>
    public static World Live(int seed = 42, GameDate? start = null)
        => new(TestContent.Live, seed, start ?? DefaultStart);

    /// <summary>Realistic rules on the live content tree.</summary>
    public static World Realistic(int seed = 42, GameDate? start = null)
        => new(TestContent.Live, seed, start ?? DefaultStart, EconomyRules.Realistic);

    /// <summary>A world on an explicit catalog and ruleset.</summary>
    public static World On(ContentCatalog catalog, EconomyRules rules, int seed = 42, GameDate? start = null)
        => new(catalog, seed, start ?? DefaultStart, rules);

    /// <summary>Apply a scenario on the frozen Classic content under Classic rules.</summary>
    public static (World World, CompanyId PlayerId) ApplyClassicScenario(Scenario scenario, int seed)
        => ScenarioRunner.Apply(TestContent.Classic, scenario, seed, EconomyRules.Classic);
}

/// <summary>
/// xUnit member data for ruleset-agnostic <c>[Theory]</c> tests (test-map §7.4 step 2):
/// <c>[MemberData(nameof(Rulesets.All), MemberType = typeof(Rulesets))]</c> runs the test once
/// per preset with a matching catalog (Classic rules → frozen Classic content, Realistic rules →
/// live content).
/// </summary>
public static class Rulesets
{
    /// <summary>One row per preset: <c>(string name)</c>; resolve with <see cref="World"/>.</summary>
    public static TheoryData<string> All => new() { EconomyRules.ClassicPreset, EconomyRules.RealisticPreset };

    /// <summary>The rules for a preset row.</summary>
    public static EconomyRules Rules(string preset) => EconomyRules.FromPreset(preset);

    /// <summary>The catalog that goes with a preset row.</summary>
    public static ContentCatalog Catalog(string preset)
        => preset == EconomyRules.ClassicPreset ? TestContent.Classic : TestContent.Live;

    /// <summary>A fresh world for a preset row.</summary>
    public static World World(string preset, int seed = 42, GameDate? start = null)
        => new(Catalog(preset), seed, start ?? Worlds.DefaultStart, Rules(preset));
}
