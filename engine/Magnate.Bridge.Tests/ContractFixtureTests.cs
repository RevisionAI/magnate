using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Magnate.Engine.Domain;
using Magnate.Engine.Rules;
using Xunit;

namespace Magnate.Bridge.Tests;

/// <summary>
/// TS ↔ C# contract fixtures (bridge-spec §10.2). A seeded, scripted game calls
/// every registered method with canned args. Each (args, result) pair is written
/// to <c>web/src/bridge/__fixtures__/&lt;method&gt;.json</c> when
/// <c>MAGNATE_UPDATE_FIXTURES=1</c>; otherwise the committed fixtures are compared
/// by <b>shape</b> (JSON paths + value kinds), so a DTO change without a fixture
/// (and therefore protocol.ts) update fails here. The vitest side type-checks the
/// fixtures against <c>protocol.ts</c> and rejects unknown keys.
/// </summary>
public class ContractFixtureTests
{
    /// <summary>The scripted session and the canned call list (shared with the smoke test).</summary>
    internal static (Bridge Bridge, List<(string Method, object? Args)> Calls) Script()
    {
        // The tutorial's goals with cash for everything the script builds, at any content
        // calibration, under the rules every real game runs (plots, land market, construction
        // time), so the fixtures carry the shapes the client actually receives.
        var capex = Bridge.Cost("supermarket") + Bridge.Cost("factory_small") + Bridge.Cost("warehouse_small")
            + Bridge.Cost("rd_center") + Bridge.Cost("convenience_store");
        var bridge = Bridge.FundedScenarioOn(EconomyRules.Realistic, "tutorial", playerCash: 4 * capex, rivalCash: 2 * Bridge.Cost("supermarket"), seed: 42, ("LocalCo", "simple"));
        var store = bridge.Supermarket("soft_drink", 2.25m, 60_000);
        var factory = bridge.Build("factory_small", "metropolis", new { productId = "flour" });
        var warehouse = bridge.Build("warehouse_small", "metropolis", new { productId = "bread", targetStock = 20_000.0 });
        var lab = bridge.Build("rd_center", "metropolis", new { productId = "soft_drink" });
        bridge.Call("setAdCampaign", new { productId = "soft_drink", cityId = "metropolis", channel = "tv", monthlyBudget = 50_000 });
        bridge.Call("advance", new { months = 6 });
        // Still under construction when cancelConstruction runs (two-month build, one month advanced by then).
        var works = bridge.Build("convenience_store", "metropolis");
        var parcel = bridge.World.GetParcels(new CityId("metropolis"))
            .First(p => p.ForSale && p.AskingPrice is > 0m and < 2_000_000m).Parcel.Id;

        var calls = new List<(string, object?)>
        {
            ("ping", null),
            ("listScenarios", null),
            ("catalog", null),
            ("snapshot", null),
            ("companies", null),
            ("settings", null),
            ("updateSettings", new { lowCashThreshold = 2_000_000 }),
            ("setAutopilot", "{\"strategy\":null}"),
            ("advance", new { months = 1, viewCityId = "metropolis" }),
            ("cityView", new { cityId = "metropolis" }),
            ("worldMap", null),
            ("buildings", new { cityId = "metropolis" }),
            ("building", new { buildingId = store }),
            ("supplyFlows", new { cityId = "metropolis" }),
            ("previewBuild", new { typeId = "convenience_store", cityId = "metropolis", at = new { px = 1, pz = 1 } }),
            ("construct", new { typeId = "convenience_store", cityId = "metropolis", initialSlot = new { productId = "bread", price = 3.1, restockTarget = 5000 } }),
            ("buildStarterPlan", new { planId = "cornerStore" }),
            ("configureSlot", new { buildingId = store, slotIndex = 1, productId = "bread", price = 3.25, restockTarget = 40_000 }),
            ("setRetailPrice", new { buildingId = store, slotIndex = 0, price = 2.4 }),
            ("setRestockTarget", new { buildingId = store, slotIndex = 0, restockTarget = 70_000 }),
            ("setWarehouseTarget", new { buildingId = warehouse, slotIndex = 0, targetStock = 25_000 }),
            ("setAutoExport", new { buildingId = factory, enabled = false }),
            ("clearSlot", new { buildingId = store, slotIndex = 1 }),
            ("upgradeBuilding", new { buildingId = store }),
            ("previewDisposal", new { buildingId = lab, kind = "sale" }),
            ("demolishBuilding", new { buildingId = lab }),
            ("sellBuilding", new { buildingId = warehouse }),
            ("adCampaigns", null),
            ("previewAdCampaign", new { productId = "soft_drink", cityId = "metropolis", channel = "radio", monthlyBudget = 20_000 }),
            ("setAdCampaign", new { productId = "soft_drink", cityId = "metropolis", channel = "radio", monthlyBudget = 20_000 }),
            ("cancelAdCampaign", new { productId = "soft_drink", cityId = "metropolis", channel = "radio" }),
            ("researchTree", null),
            ("patents", null),
            ("grantLicense", new { licenseeId = 2, productId = "soft_drink" }),
            ("revokeLicense", new { licenseeId = 2, productId = "soft_drink" }),
            ("incomeStatement", new { period = new { preset = "last12" }, byMonth = true }),
            ("balanceSheet", new { drilldown = true }),
            ("cashFlow", new { period = new { preset = "sinceStart" } }),
            ("productProfitability", new { period = new { preset = "sinceStart" } }),
            ("exports", new { period = new { preset = "sinceStart" } }),
            ("ledger", new { limit = 5 }),
            ("explainNetIncome", null),
            ("marketIntel", new { cityId = "metropolis" }),
            ("marketDetail", new { cityId = "metropolis", productId = "soft_drink" }),
            ("marketOpportunities", null),
            ("suggestPrice", new { buildingId = store, slotIndex = 0 }),
            ("goals", null),
            ("advisor", null),
            ("history", new { series = new[] { "cash", "netIncome", "corporateValue" } }),
            ("monthlyReport", null),
            ("statsDashboard", null),
            ("news", null),
            ("activityFeed", new { limit = 20 }),
            ("saveGame", null),
            ("exportEngineJson", null),
            ("debugStats", null),
            ("parcels", new { cityId = "metropolis", filter = "forSale" }),
            ("buyLand", new { cityId = "metropolis", parcelId = parcel }),
            ("sellLand", new { cityId = "metropolis", parcelId = parcel }),
            ("cancelConstruction", new { buildingId = works }),
            ("creditProfile", null),
            ("loanOffers", null),
            ("loans", null),
            ("takeLoan", new { amount = 1_000_000, termMonths = 36 }),
            ("repayLoan", new { loanId = 1, amount = 100 }),
            ("stockMarket", null),
            ("holdings", null),
            ("ipo", new { shares = 1_000_000, price = 10 }),
            ("issueShares", new { shares = 1_000_000, price = 10 }),
            ("buybackShares", new { shares = 1000 }),
            ("tradeShares", new { companyId = 2, shares = 1000, side = "buy" }),
            ("setDividend", new { perShareQuarterly = 0.1 }),
            ("macro", null),
            ("loadGame", "LOAD"),
            ("newGame", new { scenarioId = "sandbox", seed = 3, companyName = "Fixture Corp", createdAtIso = "2026-10-01T00:00:00Z" }),
            ("init", "INIT"),
        };
        return (bridge, calls);
    }

    [Fact]
    public void Every_registered_method_is_scripted()
    {
        var (_, calls) = Script();
        var scripted = calls.Select(c => c.Method).ToHashSet(StringComparer.Ordinal);
        // cityLayout is covered by CityLayoutTests (its payload is far too large for a fixture).
        var missing = GameSession.MethodNames.Where(m => m != "cityLayout" && !scripted.Contains(m)).ToList();
        Assert.True(missing.Count == 0, "unscripted methods: " + string.Join(", ", missing));
    }

    [Fact]
    public void Every_method_answers_without_internal_errors()
    {
        var (bridge, calls) = Script();
        string? saved = null;
        var failures = new List<string>();
        foreach (var (method, args) in calls)
        {
            object? callArgs = args switch
            {
                "LOAD" => new { data = saved },
                "INIT" => new { contentRoot = TestContent.Root },
                _ => args,
            };
            var envelope = bridge.Envelope(method, callArgs);
            if (method == "saveGame") saved = envelope.GetProperty("result").GetProperty("data").GetString();
            if (envelope.GetProperty("ok").GetBoolean()) continue;
            var code = envelope.GetProperty("error").GetProperty("code").GetString();
            var expected = code == BridgeErrorCodes.FeatureUnavailable
                || (method is "grantLicense" or "revokeLicense" && code == BridgeErrorCodes.NotPatentHolder);
            if (!expected) failures.Add($"{method}: {envelope}");
        }
        Assert.True(failures.Count == 0, string.Join("\n", failures));
    }

    [Fact]
    public void Fixtures_match_the_protocol_shapes()
    {
        var (bridge, calls) = Script();
        var dir = FixtureDir();
        var update = Environment.GetEnvironmentVariable("MAGNATE_UPDATE_FIXTURES") == "1";
        if (update) Directory.CreateDirectory(dir);
        string? saved = null;
        var mismatches = new List<string>();
        foreach (var (method, args) in calls)
        {
            object? callArgs = args;
            if (args is "LOAD") callArgs = new { data = saved ?? throw new InvalidOperationException("saveGame must run before loadGame") };
            if (args is "INIT") callArgs = new { contentRoot = TestContent.Root };
            var envelope = bridge.Envelope(method, callArgs);
            if (method == "saveGame") saved = envelope.GetProperty("result").GetProperty("data").GetString();

            var fixture = new JsonObject
            {
                ["method"] = method,
                ["args"] = method == "loadGame"
                    ? new JsonObject { ["data"] = "<web save envelope elided>" }
                    : callArgs switch
                    {
                        null => new JsonObject(),
                        string raw => JsonNode.Parse(raw),
                        _ => JsonNode.Parse(JsonSerializer.Serialize(callArgs, Bridge.Json)),
                    },
                ["envelope"] = JsonNode.Parse(Trim(method, envelope).GetRawText()),
            };
            var path = Path.Combine(dir, method + ".json");
            if (update)
            {
                File.WriteAllText(path, fixture.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n");
                continue;
            }
            Assert.True(File.Exists(path), $"missing fixture {path}; run the tests with MAGNATE_UPDATE_FIXTURES=1");
            var expected = Shape(JsonDocument.Parse(File.ReadAllText(path)).RootElement.GetProperty("envelope"));
            var actual = Shape(fixture["envelope"]!.Deserialize<JsonElement>());
            if (!expected.SetEquals(actual))
            {
                mismatches.Add($"{method}: +[{string.Join(", ", actual.Except(expected).Take(8))}] -[{string.Join(", ", expected.Except(actual).Take(8))}]");
            }
        }
        Assert.True(mismatches.Count == 0, "fixture shape drift (regenerate with MAGNATE_UPDATE_FIXTURES=1 and update protocol.ts):\n" + string.Join("\n", mismatches));
    }

    /// <summary>
    /// The binary save exports the worker calls directly (not through <c>Call</c>): the
    /// <c>SaveMetaDto</c> of <c>LastSaveMeta</c> and the <c>InspectResultDto</c> of <c>InspectSave</c>,
    /// written to <c>__fixtures__/_binary.json</c> and type-checked against protocol.ts by vitest.
    /// </summary>
    [Fact]
    public void Binary_export_fixtures_match_the_protocol_shapes()
    {
        var (bridge, _) = Script();
        var client = "{\"version\":1,\"sidecar\":{\"version\":1},\"thumbnail\":null,\"playTimeSec\":30}";
        var bytes = bridge.Session.SaveBinary(JsonSerializer.Serialize(new { slotKind = "quicksave", label = "Fixture", createdAtIso = "2026-10-01T00:00:00Z", client }, Bridge.Json));
        Assert.NotEmpty(bytes);
        var inspect = JsonNode.Parse(TestContent.NewSession().InspectSave(bytes))!;
        Assert.True(inspect["ok"]!.GetValue<bool>());
        var fixture = new JsonObject
        {
            ["saveMeta"] = JsonNode.Parse(bridge.Session.LastSaveMetaJson!),
            ["inspect"] = inspect["result"]!.DeepClone(),
        };
        var path = Path.Combine(FixtureDir(), "_binary.json");
        if (Environment.GetEnvironmentVariable("MAGNATE_UPDATE_FIXTURES") == "1")
        {
            Directory.CreateDirectory(FixtureDir());
            File.WriteAllText(path, fixture.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n");
            return;
        }
        Assert.True(File.Exists(path), $"missing {path}; run the tests with MAGNATE_UPDATE_FIXTURES=1");
        var expected = Shape(JsonDocument.Parse(File.ReadAllText(path)).RootElement);
        var actual = Shape(fixture.Deserialize<JsonElement>());
        Assert.True(expected.SetEquals(actual),
            $"binary fixture drift: +[{string.Join(", ", actual.Except(expected))}] -[{string.Join(", ", expected.Except(actual))}]");
    }

    [Fact]
    public void Method_manifest_matches_the_registry()
    {
        var path = Path.Combine(FixtureDir(), "_methods.json");
        var manifest = Manifest();
        if (Environment.GetEnvironmentVariable("MAGNATE_UPDATE_FIXTURES") == "1")
        {
            Directory.CreateDirectory(FixtureDir());
            File.WriteAllText(path, manifest);
            return;
        }
        Assert.True(File.Exists(path), $"missing {path}; run the tests with MAGNATE_UPDATE_FIXTURES=1");
        Assert.Equal(manifest, File.ReadAllText(path));
    }

    /// <summary>Every registered method with its flags (the vitest contract test checks MUTATING_METHODS against it).</summary>
    private static string Manifest()
    {
        var rows = GameSession.MethodNames
            .Where(m => m != "cityLayout")
            .Select(m =>
            {
                var d = GameSession.Describe(m)!.Value;
                return new JsonObject { ["name"] = m, ["mutates"] = d.Mutates, ["requiresGame"] = d.RequiresGame };
            });
        return new JsonArray(rows.ToArray<JsonNode?>()).ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
    }

    /// <summary>Keep fixtures small: saves are megabytes, so their data is elided.</summary>
    private static JsonElement Trim(string method, JsonElement envelope)
    {
        if (method is not ("saveGame" or "exportEngineJson")) return envelope;
        var node = JsonNode.Parse(envelope.GetRawText())!;
        var result = node["result"]!;
        if (result["data"] is not null) result["data"] = "<web save envelope elided>";
        if (result["json"] is not null) result["json"] = "<engine save elided>";
        return JsonDocument.Parse(node.ToJsonString()).RootElement.Clone();
    }

    /// <summary>Set of "path:kind" entries; array items merge into "path[]".</summary>
    internal static HashSet<string> Shape(JsonElement element)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        void Walk(JsonElement e, string path)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    set.Add(path + ":object");
                    foreach (var p in e.EnumerateObject())
                    {
                        // Dictionary-shaped objects (keyed by ids) collapse to "*".
                        var key = IsDictionaryKey(path, p.Name) ? "*" : p.Name;
                        Walk(p.Value, path + "." + key);
                    }
                    break;
                case JsonValueKind.Array:
                    set.Add(path + ":array");
                    foreach (var item in e.EnumerateArray()) Walk(item, path + "[]");
                    break;
                case JsonValueKind.String: set.Add(path + ":string"); break;
                case JsonValueKind.Number: set.Add(path + ":number"); break;
                case JsonValueKind.True:
                case JsonValueKind.False: set.Add(path + ":boolean"); break;
                case JsonValueKind.Null: set.Add(path + ":null"); break;
            }
        }
        Walk(element, "$");
        return set;
    }

    private static bool IsDictionaryKey(string path, string name)
        => path.EndsWith(".demographics", StringComparison.Ordinal)
        || path.EndsWith(".potentialDemand", StringComparison.Ordinal)
        || path.EndsWith(".params", StringComparison.Ordinal)
        || path.EndsWith(".series", StringComparison.Ordinal)
        || path.EndsWith(".missingBefore", StringComparison.Ordinal);

    internal static string FixtureDir()
        => Path.Combine(Directory.GetParent(TestContent.Root)!.FullName, "web", "src", "bridge", "__fixtures__");
}
