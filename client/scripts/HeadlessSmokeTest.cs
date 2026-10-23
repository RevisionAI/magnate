using System.IO;
using System.Linq;
using Godot;
using Magnate.Engine.Ai;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Persistence;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Headless end-to-end smoke test. Attach to a scene via Godot's --script flag
/// or replace the main scene temporarily. Walks every major client code path
/// (catalog load, scenario apply, advance ticks, save, load, report queries)
/// using the same engine APIs the real UI calls, and emits [OK]/[FAIL] lines.
/// Exits the tree when done so --quit-after isn't needed.
/// </summary>
public partial class HeadlessSmokeTest : Node
{
    public override void _Ready()
    {
        var passed = 0;
        var failed = 0;

        void Check(string name, System.Action body)
        {
            try { body(); GD.Print($"[OK]   {name}"); passed++; }
            catch (System.Exception ex) { GD.PushError($"[FAIL] {name}: {ex.Message}"); failed++; }
        }

        // 1. Content catalog loads via the same resolver the client uses.
        ContentCatalog? catalog = null;
        Check("catalog load", () =>
        {
            var contentPath = Path.GetFullPath(
                Path.Combine(ProjectSettings.GlobalizePath("res://"), "..", "content"));
            catalog = ContentLoader.Load(contentPath);
            if (catalog.Products.Count < 10) throw new System.Exception("too few products");
        });

        // 2. Tutorial scenario loads via the same path the client uses.
        Scenario? tutorial = null;
        Check("tutorial scenario loads", () =>
        {
            var scenariosDir = Path.Combine(
                Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"), "..", "content")),
                "scenarios");
            var scenarios = ScenarioLoader.LoadAll(scenariosDir);
            if (!scenarios.TryGetValue("tutorial", out tutorial))
                throw new System.Exception("tutorial scenario missing");
            if (tutorial.Goals.Count != 5) throw new System.Exception($"expected 5 goals, got {tutorial.Goals.Count}");
        });

        // 3. ScenarioRunner creates world + player.
        World? world = null;
        CompanyId playerId = default;
        Check("scenario runner apply", () =>
        {
            (world, playerId) = ScenarioRunner.Apply(catalog!, tutorial!, seed: 42);
            if (world.Companies.Count < 2) throw new System.Exception("expected player + 1 AI");
        });

        // 4. Simulate what a player does in the tutorial.
        Check("construct supermarket (step 1)", () =>
        {
            var b = world!.Construct(playerId, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            world.ConfigureRetailSlot(b.Id, 0, new ProductId("soft_drink"), 1.80m, 500_000);
        });

        Check("advance 3 months (step 3)", () =>
        {
            for (var i = 0; i < 3; i++) world!.AdvanceMonth();
        });

        Check("start ad campaign (step 4)", () =>
        {
            world!.RegisterAdCampaign(playerId, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 50_000m);
        });

        // 5. Evaluate goals — first 4 should be achieved by now.
        Check("tutorial goals 1-4 achieved", () =>
        {
            var evals = ScenarioRunner.EvaluateGoals(world!, tutorial!, playerId);
            for (var i = 0; i < 4; i++)
            {
                if (!evals[i].Achieved)
                    throw new System.Exception($"goal {i + 1} not achieved: {evals[i].Description[..50]}…");
            }
        });

        // 6. Reports surface is callable.
        Check("reports query", () =>
        {
            var pnl = world!.GetIncomeStatement(playerId, new GameDate(2026, 2), world.Clock.Now);
            var bs = world.GetBalanceSheet(playerId);
            var profit = world.GetProductProfitability(playerId, new GameDate(2026, 2), world.Clock.Now);
            var share = world.GetMarketShare(playerId, new ProductId("soft_drink"), new CityId("metropolis"));
            if (share <= 0) throw new System.Exception($"expected positive market share, got {share}");
        });

        // 7. Save / load round-trip.
        var tempPath = Path.Combine(ProjectSettings.GlobalizePath("res://"), "smoke-test.json");
        Check("save", () => WorldSaver.Save(world!, tempPath));
        Check("load round-trip", () =>
        {
            var reloaded = WorldLoader.Load(catalog!, tempPath);
            if (reloaded.World.Companies.Count != world!.Companies.Count)
                throw new System.Exception("company count mismatch after load");
        });
        if (File.Exists(tempPath)) File.Delete(tempPath);

        // 8. Phase 3.8: live-tick helper + history tracking.
        Check("history tracking via TickIfRunning", () =>
        {
            GameState.World = world;
            GameState.PlayerId = playerId;
            GameState.History.Clear();
            GameState.RecordSnapshot();

            GameState.IsPlaying = true;
            GameState.SecondsPerMonth = 0.1f;
            GameState.TickAccumulator = 0f;
            var advanced = 0;
            for (var i = 0; i < 5; i++)
            {
                if (GameState.TickIfRunning(0.11f)) advanced++;
            }
            GameState.IsPlaying = false;

            if (advanced < 5) throw new System.Exception($"expected 5 ticks, got {advanced}");
            if (GameState.History.Count < 6)
                throw new System.Exception($"expected ≥6 history entries (1 initial + 5 ticks), got {GameState.History.Count}");

            // Phase 3.10: TopBrand + TopTech captured on every snapshot.
            // The tutorial run starts an ad campaign and has a retail slot, so brand
            // should have ramped above 0 by the last entry and tech should be ≥1.
            var last = GameState.History[^1];
            GD.Print($"       TopBrand={last.TopBrand:F2}  TopTech={last.TopTech}  Date={last.Date}");
            if (last.TopTech < SimulationConstants.BaseTechLevel)
                throw new System.Exception($"expected TopTech ≥ {SimulationConstants.BaseTechLevel}, got {last.TopTech}");
            if (last.TopBrand <= 0)
                throw new System.Exception($"expected TopBrand > 0 after ad campaign + ticks, got {last.TopBrand}");
        });

        GD.Print($"[Smoke] {passed} passed, {failed} failed");

        if (failed > 0)
            GetTree().Quit(1);
        else
            GetTree().Quit(0);
    }
}
