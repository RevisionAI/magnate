using System;
using System.Collections.Generic;
using System.IO;
using Magnate.Engine.Tests.TestSupport;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>
/// Classic golden masters (test-map §7.4 step 0, econ-audit §6 R15 spirit). Each run in
/// <see cref="GoldenScenarios"/> executes under Classic rules on the frozen Classic content and
/// must reproduce, bit for bit, the state captured from the pre-overhaul engine
/// (baseline commit 338082f, 2026-10-01): every company's cash to the last decimal digit, the
/// full ledger / COGS / transfer logs (hashed), inventories, tech, brand, research, patents and
/// the news sequence.
/// <para>
/// Two independent oracles guard each run: the committed digest text under
/// <c>Fixtures/golden/classic/&lt;name&gt;.txt</c> (gives a line-precise diff on failure) and the
/// literals below (so a fixture cannot be silently regenerated). Re-approval is a deliberate,
/// reviewed act: run with <c>MAGNATE_UPDATE_GOLDEN=1</c> to rewrite the text files, then update
/// the literals and explain the change in the commit message.
/// </para>
/// <para>
/// Digests are per-runtime (D18): they were captured with .NET 8 CoreCLR on macOS x64. Another
/// OS/CPU may legitimately differ in the last bits of <c>Math.Pow</c>.
/// </para>
/// </summary>
public sealed class GoldenMasterTests
{
    private const string UpdateVariable = "MAGNATE_UPDATE_GOLDEN";

    private sealed record Expectation(string Sha256, int LedgerCount, string[] Cash, string News);

    /// <summary>Approved literals. See the class remarks before touching these.</summary>
    private static readonly IReadOnlyDictionary<string, Expectation> Expected = new Dictionary<string, Expectation>(StringComparer.Ordinal)
    {
        ["cockpit_24"] = new(
            Sha256: "d661f925091bb828e20dd4f0d4dde111549920e3e28831537bd95b33f13c5101",
            LedgerCount: 1308,
            Cash: new[] { "51334430.26069907220", "178758800.1618223353800" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought"),
        ["soft_drink_war_auto_24"] = new(
            Sha256: "609ecacf9f797965e710b76276c27117ad583174be6dfcb96c2b1ca61d9c3a63",
            LedgerCount: 2496,
            Cash: new[] { "1093864.827751118725", "1517334.3935511038840000", "1969634.3300506331675000" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought"),
        ["soft_drink_war_auto_60"] = new(
            Sha256: "05077669d38c1b69f26482223190cf6006ae68d15918a560ef35df394d9fe0d8",
            LedgerCount: 12265,
            Cash: new[] { "815413.3854791918140000", "71160911.172196916736660000", "42698624.6328690674938000" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought 2028-03:cocoa_blight 2028-07:tariff_announcement 2028-11:cocoa_blight 2028-12:viral_ad_spot 2029-02:cotton_harvest_bumper 2029-06:cocoa_blight 2029-09:soft_drink_health_scare 2030-01:oil_glut 2030-03:trade_summit_optimism 2030-04:soft_drink_health_scare 2030-05:viral_ad_spot 2030-09:viral_ad_spot 2030-10:cocoa_blight 2030-11:trade_summit_optimism 2030-12:wheat_drought"),
        ["vertical_showdown_auto_48"] = new(
            Sha256: "d27ce1391f18bf4fc72b50d4836a1d41b8aa860afdad0c8166d1eeb4b18c83a9",
            LedgerCount: 7821,
            Cash: new[] { "50561106.1592802148153680000", "64863512.929255370084560000" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought 2028-03:cocoa_blight 2028-07:tariff_announcement 2028-11:cocoa_blight 2028-12:viral_ad_spot 2029-02:cotton_harvest_bumper 2029-06:cocoa_blight 2029-09:soft_drink_health_scare 2030-01:oil_glut"),
        ["four_archetype_melee_auto_60"] = new(
            Sha256: "befe9a7b2be8b9397bf5d7d05a6545280d07af52d6b0db1d10115066cd674311",
            LedgerCount: 17668,
            Cash: new[] { "1168379.8907409839655000", "1370459934.1185618918285969579", "26111447726.810915253892209056", "18704852406.304693299068635275", "73082411543.347296159944257578" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought 2028-03:cocoa_blight 2028-07:tariff_announcement 2028-11:cocoa_blight 2028-12:viral_ad_spot 2029-02:cotton_harvest_bumper 2029-06:cocoa_blight 2029-09:soft_drink_health_scare 2030-01:oil_glut 2030-03:trade_summit_optimism 2030-04:soft_drink_health_scare 2030-05:viral_ad_spot 2030-09:viral_ad_spot 2030-10:cocoa_blight 2030-11:trade_summit_optimism 2030-12:wheat_drought"),
        ["patents_licensing_48"] = new(
            Sha256: "209e3e39076c376d8cd1ed2918c5a2f7a86157859668c07a4fd03f2977ea8302",
            LedgerCount: 4225,
            Cash: new[] { "69810000.0000", "48934000.0000", "666473587.8640630827350" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought 2028-03:cocoa_blight 2028-07:tariff_announcement 2028-11:cocoa_blight 2028-12:viral_ad_spot 2029-02:cotton_harvest_bumper 2029-06:cocoa_blight 2029-09:soft_drink_health_scare 2030-01:oil_glut"),
        ["events_ads_media_36"] = new(
            Sha256: "b4834fe0c5f2810e0a85c069643428a45df311c9a8d0c6fc31a5065a3f2d6348",
            LedgerCount: 3522,
            Cash: new[] { "101316402.0176123165", "90422383.718099103600", "124458000.00", "272710645.06258702409300" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought 2028-03:cocoa_blight 2028-07:tariff_announcement 2028-11:cocoa_blight 2028-12:viral_ad_spot"),
        // Re-approved once (E0 step 7, upgrade capex capitalised — econ F8 / bridge E5 / test-map D2):
        // only ChainCo's balance line changed (buildings 4,650,000 → 7,020,000 = the four upgrades
        // 720k + 900k + 600k + 150k; assets and equity likewise). Cash, ledger, COGS, transfers,
        // inventories and news are bit-identical to the pre-overhaul capture (ae063628…).
        ["upgrades_warehouse_chain_24"] = new(
            Sha256: "196ba1f6e9d59a7ceddd9ead5fd1ac48fe02bfa9592b4d5d69b563e6f6c996e6",
            LedgerCount: 1337,
            Cash: new[] { "82141200.000", "149928403.6244640808800" },
            News: "2026-03:consumer_electronics_craze 2026-05:cotton_harvest_bumper 2026-08:viral_ad_spot 2027-04:viral_ad_spot 2027-07:cocoa_blight 2027-11:trade_summit_optimism 2027-12:wheat_drought"),
    };

    public static TheoryData<string> Names()
    {
        var data = new TheoryData<string>();
        foreach (var s in GoldenScenarios.All) data.Add(s.Name);
        return data;
    }

    [Trait("Ruleset", "Classic")]
    [Theory]
    [MemberData(nameof(Names))]
    public void Classic_golden_master_is_unchanged(string name)
    {
        var result = GoldenScenarios.Get(name).Run();
        var path = Path.Combine(TestContent.GoldenDir, "classic", name + ".txt");

        if (Environment.GetEnvironmentVariable(UpdateVariable) == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, result.Text);
            return;
        }

        Assert.True(File.Exists(path), $"missing golden fixture {path} (run with {UpdateVariable}=1 to create it)");
        var approved = File.ReadAllText(path);
        var diff = StateDigest.FirstDifference(approved, result.Text);
        Assert.True(diff is null, $"golden master '{name}' diverged from {path} at {diff}");

        Assert.True(Expected.TryGetValue(name, out var expected), $"no approved literals for golden master '{name}'");
        Assert.Equal(expected!.Sha256, StateDigest.Sha256(result.Text));
        Assert.Equal(expected.LedgerCount, result.World.Ledger.Entries.Count);
        Assert.Equal(expected.Cash, result.FinalCash);
        Assert.Equal(expected.News, result.NewsSequence);
    }
}
