using System;
using System.IO;

namespace Magnate.Bridge.Tests;

/// <summary>Locates the repository's content/ directory from the test binary.</summary>
internal static class TestContent
{
    public static string Root { get; } = Find();

    private static string Find()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "content");
            if (Directory.Exists(Path.Combine(candidate, "data")) && Directory.Exists(Path.Combine(candidate, "scenarios")))
            {
                return candidate;
            }
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("could not locate content/ above " + AppContext.BaseDirectory);
    }

    private static readonly Lazy<Magnate.Engine.Content.ContentCatalog> LoadedCatalog = new(() => NewSession().Catalog);

    /// <summary>
    /// The installed content as the engine loaded it. Tests derive prices and quantities from it
    /// (e.g. <see cref="Bridge.Cost"/>) instead of hard-coding today's numbers, which content
    /// calibration changes (2026-USD rebase, E1).
    /// </summary>
    public static Magnate.Engine.Content.ContentCatalog Catalog => LoadedCatalog.Value;

    /// <summary>A session that has completed <c>init</c>.</summary>
    public static GameSession NewSession()
    {
        var session = new GameSession();
        var response = session.Dispatch("init", $"{{\"contentRoot\":{System.Text.Json.JsonSerializer.Serialize(Root)}}}");
        if (!response.Contains("\"ok\":true", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("init failed: " + response);
        }
        return session;
    }
}
