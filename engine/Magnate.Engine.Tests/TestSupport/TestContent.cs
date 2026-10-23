using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Magnate.Engine.Content;
using Magnate.Engine.Scenarios;

namespace Magnate.Engine.Tests.TestSupport;

/// <summary>
/// Single source of truth for where test content lives, with cached catalogs.
/// <para>
/// Two content trees are available:
/// <list type="bullet">
///   <item><b>Live</b> — <c>content/</c> at the repository root. Wave 2 rebalances this freely;
///         only ruleset/content-agnostic tests (invariants, mechanics, structural content checks)
///         may read it.</item>
///   <item><b>Classic</b> — <c>engine/Magnate.Engine.Tests/Fixtures/classic-content/</c>, a
///         byte-for-byte frozen copy of <c>content/data</c> + <c>content/scenarios</c> taken at the
///         start of the overhaul (2026-10-01). Every test that pins today's numbers (test-map §4
///         modes CLASSIC, CLASSIC+TWIN and SNAPSHOT) and every golden master reads this tree, so
///         content rebalancing can never move them. Never edit these files.</item>
/// </list>
/// </para>
/// <para>
/// Resolution order for the repository root: the <c>MagnateRepoRoot</c> assembly metadata that
/// MSBuild stamps into this test assembly, then a walk up from the working directory to the
/// first directory holding both <c>global.json</c> and <c>content/data</c>. The live content root
/// can be overridden with the <c>MAGNATE_CONTENT_ROOT</c> environment variable.
/// </para>
/// <para>
/// <see cref="ContentCatalog"/> and <see cref="Scenario"/> are immutable, so the lazily loaded
/// instances are safely shared by test classes that xUnit runs in parallel.
/// </para>
/// </summary>
public static class TestContent
{
    /// <summary>Environment variable that overrides the live content root (a directory holding <c>data/</c>).</summary>
    public const string ContentRootVariable = "MAGNATE_CONTENT_ROOT";

    private static readonly Lazy<string> RepoRootLazy = new(ResolveRepoRoot);
    private static readonly Lazy<ContentCatalog> LiveLazy = new(() => ContentLoader.Load(LiveRoot));
    private static readonly Lazy<ContentCatalog> ClassicLazy = new(() => ContentLoader.Load(ClassicRoot));
    private static readonly Lazy<IReadOnlyDictionary<string, Scenario>> LiveScenariosLazy =
        new(() => ScenarioLoader.LoadAll(LiveScenariosDir));
    private static readonly Lazy<IReadOnlyDictionary<string, Scenario>> ClassicScenariosLazy =
        new(() => ScenarioLoader.LoadAll(ClassicScenariosDir));

    /// <summary>Absolute path of the repository root (the directory holding <c>global.json</c>).</summary>
    public static string RepoRoot => RepoRootLazy.Value;

    /// <summary>Live content root (<c>content/</c>, or <see cref="ContentRootVariable"/> when set).</summary>
    public static string LiveRoot
    {
        get
        {
            var overridden = Environment.GetEnvironmentVariable(ContentRootVariable);
            return string.IsNullOrWhiteSpace(overridden) ? Path.Combine(RepoRoot, "content") : overridden;
        }
    }

    /// <summary>Frozen Classic content root (holds <c>data/</c> and <c>scenarios/</c>).</summary>
    public static string ClassicRoot =>
        Path.Combine(RepoRoot, "engine", "Magnate.Engine.Tests", "Fixtures", "classic-content");

    /// <summary>Directory of the live scenario JSON files.</summary>
    public static string LiveScenariosDir => Path.Combine(LiveRoot, "scenarios");

    /// <summary>Directory of the frozen Classic scenario JSON files.</summary>
    public static string ClassicScenariosDir => Path.Combine(ClassicRoot, "scenarios");

    /// <summary>Golden-master fixture directory (<c>Fixtures/golden</c>).</summary>
    public static string GoldenDir =>
        Path.Combine(RepoRoot, "engine", "Magnate.Engine.Tests", "Fixtures", "golden");

    /// <summary>Cached catalog of the live content tree.</summary>
    public static ContentCatalog Live => LiveLazy.Value;

    /// <summary>Cached catalog of the frozen Classic content tree.</summary>
    public static ContentCatalog Classic => ClassicLazy.Value;

    /// <summary>Cached live scenarios keyed by id.</summary>
    public static IReadOnlyDictionary<string, Scenario> LiveScenarios => LiveScenariosLazy.Value;

    /// <summary>Cached frozen Classic scenarios keyed by id.</summary>
    public static IReadOnlyDictionary<string, Scenario> ClassicScenarios => ClassicScenariosLazy.Value;

    private static string ResolveRepoRoot()
    {
        var stamped = typeof(TestContent).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "MagnateRepoRoot")?.Value;
        if (!string.IsNullOrEmpty(stamped) && LooksLikeRepoRoot(stamped))
        {
            return Path.GetFullPath(stamped);
        }

        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null && !LooksLikeRepoRoot(dir.FullName))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new InvalidOperationException(
            "could not locate the Magnate repository root (global.json + content/data) from "
            + Directory.GetCurrentDirectory());
    }

    private static bool LooksLikeRepoRoot(string path)
        => File.Exists(Path.Combine(path, "global.json"))
           && Directory.Exists(Path.Combine(path, "content", "data"));
}
