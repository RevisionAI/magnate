using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Godot;
using Magnate.Engine.Persistence;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Lists save files under <see cref="OS.GetUserDataDir"/> in a left pane and renders a
/// rich metadata preview of the selected save on the right (Phase 3.37). The preview
/// is a cheap JSON-only peek — no World is hydrated until the user clicks Load. On load,
/// hydrates a World via <see cref="WorldLoader"/>, stashes it in <see cref="GameState"/>,
/// and transitions to the Main scene.
/// </summary>
public partial class SaveBrowser : Node
{
    private VBoxContainer _saveList = null!;
    private RichTextLabel _preview = null!;
    private Button _loadButton = null!;
    private Button? _selectedRow;
    private string? _selectedPath;

    public override void _Ready()
    {
        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;

        var hint = GetNode<Label>("Panel/VBox/HintLabel");
        hint.Text = $"Saves directory: {OS.GetUserDataDir()}";

        _saveList = GetNode<VBoxContainer>("Panel/VBox/Split/LeftPane/Scroll/SaveList");
        _preview  = GetNode<RichTextLabel>("Panel/VBox/Split/RightPane/PreviewScroll/Preview");
        _loadButton = GetNode<Button>("Panel/VBox/Split/RightPane/LoadButton");
        _loadButton.Pressed += OnLoadPressed;

        BuildSaveList();
    }

    private void BuildSaveList()
    {
        foreach (var child in _saveList.GetChildren()) child.QueueFree();

        var savesDir = OS.GetUserDataDir();
        if (!Directory.Exists(savesDir))
        {
            Directory.CreateDirectory(savesDir);
        }

        var files = Directory.EnumerateFiles(savesDir, "*.json")
            .Select(path => new FileInfo(path))
            .OrderByDescending(fi => fi.LastWriteTime)
            .ToList();

        if (files.Count == 0)
        {
            _saveList.AddChild(new Label
            {
                Text = "No saves found. Start a new game and use the Save button in-game.",
                AutowrapMode = TextServer.AutowrapMode.WordSmart,
            });
            _preview.Text = "[i]No saves to preview.[/i]";
            _loadButton.Disabled = true;
            return;
        }

        foreach (var file in files)
        {
            _saveList.AddChild(BuildRow(file));
        }
    }

    private Control BuildRow(FileInfo file)
    {
        var button = new Button
        {
            Text = $"{file.Name}\n{file.LastWriteTime:yyyy-MM-dd HH:mm}  ·  {file.Length / 1024} KB",
            ToggleMode = true,
            Alignment = HorizontalAlignment.Left,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        button.AddThemeConstantOverride("icon_max_width", 0);
        button.Pressed += () => OnRowSelected(button, file.FullName);
        return button;
    }

    private void OnRowSelected(Button row, string path)
    {
        if (_selectedRow is not null && _selectedRow != row)
        {
            _selectedRow.ButtonPressed = false;
        }
        _selectedRow = row;
        row.ButtonPressed = true;
        _selectedPath = path;
        _loadButton.Disabled = false;
        _preview.Text = BuildPreview(path);
    }

    private void OnLoadPressed()
    {
        if (_selectedPath is null) return;
        LoadSave(_selectedPath);
    }

    // --- Preview rendering -------------------------------------------------

    private string BuildPreview(string path)
    {
        try
        {
            var meta = SavePreview.Parse(path);
            if (meta is null)
            {
                return "[i]Preview unavailable (empty or unreadable file).[/i]";
            }
            if (meta.SchemaVersion < WorldSaver.MinSupportedSchemaVersion ||
                meta.SchemaVersion > WorldSaver.SchemaVersion)
            {
                return $"[i]Preview unavailable (file version {meta.SchemaVersion} not supported).[/i]";
            }
            return RenderPreview(meta);
        }
        catch (Exception ex)
        {
            GD.PushWarning($"[SaveBrowser] preview failed for {path}: {ex.Message}");
            return "[i]Preview unavailable (parse error).[/i]";
        }
    }

    private string RenderPreview(SavePreviewData meta)
    {
        var sb = new StringBuilder();

        // Scenario + file timestamps
        var scenarioName = ResolveScenarioName(meta.ScenarioId);
        sb.Append("[b]Scenario:[/b] ");
        if (meta.ScenarioId is null)
        {
            sb.AppendLine("(sandbox / no scenario recorded)");
        }
        else if (scenarioName is not null && scenarioName != meta.ScenarioId)
        {
            sb.AppendLine($"{scenarioName} [i]({meta.ScenarioId})[/i]");
        }
        else
        {
            sb.AppendLine(meta.ScenarioId);
        }

        sb.AppendLine($"[b]Saved:[/b] {meta.FileTimestamp:yyyy-MM-dd HH:mm}");
        sb.AppendLine($"[b]In-game date:[/b] {meta.Clock.Year:D4}-{meta.Clock.Month:D2}");
        sb.AppendLine($"[b]Schema version:[/b] {meta.SchemaVersion}");
        sb.AppendLine();

        // Player company
        var player = ResolvePlayerCompany(meta);
        if (player is not null)
        {
            var delta = player.Cash - player.StartingCapital;
            var deltaSign = delta >= 0m ? "+" : string.Empty;
            sb.AppendLine($"[b]Player company:[/b] {player.Name}");
            sb.AppendLine($"  Cash: ${player.Cash:N0}");
            sb.AppendLine($"  Starting cash: ${player.StartingCapital:N0}");
            sb.AppendLine($"  Delta: {deltaSign}${delta:N0}");
        }
        else
        {
            sb.AppendLine("[b]Player company:[/b] [i]unknown[/i]");
        }

        // Elapsed months (vs scenario start if resolvable, else vs clock fallback)
        var elapsed = ComputeElapsedMonths(meta);
        if (elapsed is not null)
        {
            sb.AppendLine($"[b]Elapsed:[/b] {elapsed} months");
        }
        sb.AppendLine();

        // Buildings
        var playerId = player?.Id;
        var buildings = playerId is null
            ? meta.Buildings
            : meta.Buildings.Where(b => b.OwnerId == playerId.Value).ToList();
        sb.AppendLine($"[b]Player buildings:[/b] {buildings.Count}");
        var byCategory = buildings
            .GroupBy(b => ResolveBuildingCategory(b.TypeId))
            .OrderByDescending(g => g.Count())
            .ToList();
        foreach (var group in byCategory)
        {
            sb.AppendLine($"  {group.Key}: {group.Count()}");
        }
        sb.AppendLine();

        // Top 3 products by cumulative revenue (ProductSale + ExportSale)
        if (playerId is not null)
        {
            var topProducts = meta.Ledger
                .Where(e => e.CompanyId == playerId.Value &&
                            (string.Equals(e.Category, "ProductSale", StringComparison.Ordinal) ||
                             string.Equals(e.Category, "ExportSale",  StringComparison.Ordinal)) &&
                            e.ProductId is not null)
                .GroupBy(e => e.ProductId!)
                .Select(g => new { Product = g.Key, Revenue = g.Sum(e => e.Amount) })
                .OrderByDescending(x => x.Revenue)
                .Take(3)
                .ToList();

            sb.AppendLine("[b]Top products (cumulative revenue):[/b]");
            if (topProducts.Count == 0)
            {
                sb.AppendLine("  [i]no sales yet[/i]");
            }
            else
            {
                foreach (var tp in topProducts)
                {
                    var pname = ResolveProductName(tp.Product);
                    sb.AppendLine($"  {pname}: ${tp.Revenue:N0}");
                }
            }
        }

        // Goal progress — only meaningful if the scenario is loaded in GameState
        // and it matches this save's scenario id.
        var activeScenario = GameState.ActiveScenario;
        if (activeScenario is not null && meta.ScenarioId is not null &&
            string.Equals(activeScenario.Id, meta.ScenarioId, StringComparison.Ordinal))
        {
            sb.AppendLine();
            sb.AppendLine($"[b]Goals:[/b] 0 / {activeScenario.Goals.Count} evaluated " +
                          "[i](load to evaluate against live world)[/i]");
        }

        return sb.ToString().TrimEnd();
    }

    private string ResolveBuildingCategory(string typeId)
    {
        var catalog = GameState.Catalog;
        if (catalog is null) return typeId;
        try
        {
            var bt = catalog.BuildingType(new Magnate.Engine.Domain.BuildingTypeId(typeId));
            return bt.Category;
        }
        catch
        {
            return typeId;
        }
    }

    private string ResolveProductName(string productId)
    {
        var catalog = GameState.Catalog;
        if (catalog is null) return productId;
        try
        {
            var p = catalog.Product(new Magnate.Engine.Domain.ProductId(productId));
            return p.Name;
        }
        catch
        {
            return productId;
        }
    }

    private static string? ResolveScenarioName(string? scenarioId)
    {
        if (scenarioId is null) return null;
        try
        {
            var dir = Path.Combine(TitleScreen.ResolveContentPath(), "scenarios");
            var scenarios = ScenarioLoader.LoadAll(dir);
            return scenarios.TryGetValue(scenarioId, out var s) ? s.Name : null;
        }
        catch
        {
            return null;
        }
    }

    private static SavePreviewCompany? ResolvePlayerCompany(SavePreviewData meta)
    {
        if (meta.Companies.Count == 0) return null;
        if (meta.PlayerId is int pid)
        {
            var match = meta.Companies.FirstOrDefault(c => c.Id == pid);
            if (match is not null) return match;
        }
        // Pre-v2 saves or missing playerId: fall back to lowest-id company (the
        // same heuristic WorldLoader load flow uses).
        return meta.Companies.OrderBy(c => c.Id).First();
    }

    private static int? ComputeElapsedMonths(SavePreviewData meta)
    {
        if (meta.ScenarioId is null) return null;
        try
        {
            var dir = Path.Combine(TitleScreen.ResolveContentPath(), "scenarios");
            var scenarios = ScenarioLoader.LoadAll(dir);
            if (!scenarios.TryGetValue(meta.ScenarioId, out var s)) return null;
            var elapsed = meta.Clock.AsMonthIndex() - s.StartDate.AsMonthIndex();
            return Math.Max(0, elapsed);
        }
        catch
        {
            return null;
        }
    }

    // --- Load flow (unchanged) --------------------------------------------

    private void LoadSave(string path)
    {
        if (GameState.Catalog is null)
        {
            GD.PushError("[SaveBrowser] catalog missing");
            return;
        }

        try
        {
            var result = WorldLoader.Load(GameState.Catalog, path);
            var world = result.World;
            GameState.World = world;

            // v2 saves carry the player company id. v1 saves (and anything that
            // was saved without passing a player) fall back to the "first
            // company by id" heuristic we used before Phase 3.9.
            GameState.PlayerId = result.PlayerId
                ?? world.Companies.Keys.OrderBy(id => id.Value).First();

            // v2 saves also carry the scenarioId. Resolve it to the scenario
            // object so the Goals tab in Reports can render. Best-effort —
            // missing scenario files are logged but not fatal.
            GameState.ActiveScenario = null;
            GameState.ScenarioName = Path.GetFileNameWithoutExtension(path);
            if (result.ScenarioId is not null)
            {
                try
                {
                    var scenariosDir = Path.Combine(TitleScreen.ResolveContentPath(), "scenarios");
                    var scenarios = ScenarioLoader.LoadAll(scenariosDir);
                    if (scenarios.TryGetValue(result.ScenarioId, out var scenario))
                    {
                        GameState.ActiveScenario = scenario;
                        GameState.ScenarioName = scenario.Name;
                    }
                    else
                    {
                        GD.PushWarning($"[SaveBrowser] scenario '{result.ScenarioId}' not found in {scenariosDir}");
                    }
                }
                catch (Exception ex)
                {
                    GD.PushWarning($"[SaveBrowser] failed to resolve scenario '{result.ScenarioId}': {ex.Message}");
                }
            }

            GameState.History.Clear();
            GameState.RecordSnapshot();
            GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
        }
        catch (Exception ex)
        {
            GD.PushError($"[SaveBrowser] load failed: {ex.Message}");
        }
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/TitleScreen.tscn");
}

// ---------------------------------------------------------------------------
// Lightweight client-side JSON peek into a save file. Deliberately duplicates
// a tiny subset of the engine's DTO shape (by field name only) rather than
// referencing the engine's internal WorldSaveFile record — keeps the
// engine/client boundary clean per Phase 3.37 guidance.
// ---------------------------------------------------------------------------

internal sealed record SavePreviewCompany(int Id, string Name, decimal Cash, decimal StartingCapital);
internal sealed record SavePreviewBuilding(string TypeId, int OwnerId);
internal sealed record SavePreviewLedgerEntry(int CompanyId, string Category, decimal Amount, string? ProductId);

internal sealed record SavePreviewData(
    int SchemaVersion,
    GameDate Clock,
    string? ScenarioId,
    int? PlayerId,
    DateTime FileTimestamp,
    IReadOnlyList<SavePreviewCompany> Companies,
    IReadOnlyList<SavePreviewBuilding> Buildings,
    IReadOnlyList<SavePreviewLedgerEntry> Ledger);

internal static class SavePreview
{
    public static SavePreviewData? Parse(string path)
    {
        var fi = new FileInfo(path);
        if (!fi.Exists) return null;

        using var stream = File.OpenRead(path);
        using var doc = JsonDocument.Parse(stream);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object) return null;

        // WorldSaver writes camelCase — but accept both for robustness.
        var schema = GetInt(root, "schemaVersion", "SchemaVersion") ?? 0;

        var clock = new GameDate(2026, 1);
        if (TryGetProp(root, out var clockEl, "clock", "Clock") && clockEl.ValueKind == JsonValueKind.Object)
        {
            var y = GetInt(clockEl, "year",  "Year")  ?? 2026;
            var m = GetInt(clockEl, "month", "Month") ?? 1;
            clock = new GameDate(y, m);
        }

        string? scenarioId = null;
        if (TryGetProp(root, out var sid, "scenarioId", "ScenarioId") && sid.ValueKind == JsonValueKind.String)
        {
            scenarioId = sid.GetString();
        }

        int? playerId = GetInt(root, "playerId", "PlayerId");

        // Ledger entries in saves carry StartingCapital as a positive inflow for
        // the founding company — we use that to recover the starting cash.
        var startingCapital = new Dictionary<int, decimal>();
        var ledgerEntries = new List<SavePreviewLedgerEntry>();
        if (TryGetProp(root, out var ledger, "ledger", "Ledger") && ledger.ValueKind == JsonValueKind.Array)
        {
            foreach (var e in ledger.EnumerateArray())
            {
                var cid = GetInt(e, "companyId", "CompanyId") ?? 0;
                var cat = GetString(e, "category", "Category") ?? string.Empty;
                var amtStr = GetString(e, "amount", "Amount") ?? "0";
                var amt = decimal.TryParse(amtStr, NumberStyles.Any, CultureInfo.InvariantCulture, out var a) ? a : 0m;
                var prod = GetString(e, "productId", "ProductId");
                ledgerEntries.Add(new SavePreviewLedgerEntry(cid, cat, amt, prod));

                if (string.Equals(cat, "StartingCapital", StringComparison.Ordinal) && !startingCapital.ContainsKey(cid))
                {
                    startingCapital[cid] = amt;
                }
            }
        }

        var companies = new List<SavePreviewCompany>();
        if (TryGetProp(root, out var comps, "companies", "Companies") && comps.ValueKind == JsonValueKind.Array)
        {
            foreach (var c in comps.EnumerateArray())
            {
                var id = GetInt(c, "id", "Id") ?? 0;
                var name = GetString(c, "name", "Name") ?? $"Company {id}";
                var cashStr = GetString(c, "cash", "Cash") ?? "0";
                var cash = decimal.TryParse(cashStr, NumberStyles.Any, CultureInfo.InvariantCulture, out var cv) ? cv : 0m;
                var start = startingCapital.TryGetValue(id, out var s) ? s : 0m;
                companies.Add(new SavePreviewCompany(id, name, cash, start));
            }
        }

        var buildings = new List<SavePreviewBuilding>();
        if (TryGetProp(root, out var bs, "buildings", "Buildings") && bs.ValueKind == JsonValueKind.Array)
        {
            foreach (var b in bs.EnumerateArray())
            {
                var typeId = GetString(b, "typeId", "TypeId") ?? "unknown";
                var ownerId = GetInt(b, "ownerId", "OwnerId") ?? 0;
                buildings.Add(new SavePreviewBuilding(typeId, ownerId));
            }
        }

        return new SavePreviewData(
            SchemaVersion: schema,
            Clock: clock,
            ScenarioId: scenarioId,
            PlayerId: playerId,
            FileTimestamp: fi.LastWriteTime,
            Companies: companies,
            Buildings: buildings,
            Ledger: ledgerEntries);
    }

    private static bool TryGetProp(JsonElement el, out JsonElement result, params string[] names)
    {
        foreach (var n in names)
        {
            if (el.TryGetProperty(n, out result)) return true;
        }
        result = default;
        return false;
    }

    private static int? GetInt(JsonElement el, params string[] names)
    {
        if (!TryGetProp(el, out var p, names)) return null;
        return p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var v) ? v : null;
    }

    private static string? GetString(JsonElement el, params string[] names)
    {
        if (!TryGetProp(el, out var p, names)) return null;
        return p.ValueKind == JsonValueKind.String ? p.GetString() : null;
    }
}
