using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Tests.TestSupport;

/// <summary>
/// Canonical, human-diffable text rendering of a <see cref="World"/>'s complete simulation
/// state, plus its SHA-256. Used by golden masters, determinism and save/load equivalence tests.
/// <para>
/// <b>Format contract (v1).</b> Every line is ordinal-sorted by id (companies, buildings,
/// products, cities) except where the order itself is state (ledger/COGS/transfer logs, the news
/// log, slot lists and inventory are emitted in engine order or hashed in engine order). Decimals
/// are printed with <c>ToString(InvariantCulture)</c> <em>without</em> normalisation, so a change
/// of scale (<c>1.50</c> vs <c>1.5</c>) is a digest change — Classic must be bit-for-bit, not
/// merely numerically, identical. Doubles use the round-trip <c>"R"</c> format.
/// </para>
/// <para>
/// The v1 text was frozen by the Classic golden masters on 2026-10-01. Never re-order or rename
/// existing lines. New engine state may only add lines that are absent for a Classic world
/// (e.g. emit an accrual-journal section only when the journal is non-empty), otherwise every
/// golden master needs re-approval.
/// </para>
/// </summary>
public static class StateDigest
{
    /// <summary>First line of every v1 digest.</summary>
    public const string Header = "magnate-state-digest v1";

    /// <summary>Canonical text of the world's state.</summary>
    public static string Of(World world)
    {
        ArgumentNullException.ThrowIfNull(world);
        var sb = new StringBuilder();
        sb.Append(Header).Append('\n');
        AppendCore(sb, world);
        return sb.ToString();
    }

    /// <summary>Lower-case hex SHA-256 of <see cref="Of"/>.</summary>
    public static string HashOf(World world) => Sha256(Of(world));

    /// <summary>Lower-case hex SHA-256 of a UTF-8 string.</summary>
    public static string Sha256(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

    // ------------------------------------------------------------------ formatting helpers

    /// <summary>Exact decimal text (scale preserved).</summary>
    public static string D(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>Round-trip double text.</summary>
    public static string R(double value) => value.ToString("R", CultureInfo.InvariantCulture);

    private static string Q(string? text) => text is null ? "-" : "\"" + text.Replace("\"", "\\\"") + "\"";

    // ------------------------------------------------------------------ sections

    private static void AppendCore(StringBuilder sb, World world)
    {
        var now = world.Clock.Now;
        sb.Append("clock ").Append(now).Append('\n');
        sb.Append("next company=").Append(world.InternalNextCompanyId)
          .Append(" building=").Append(world.InternalNextBuildingId).Append('\n');

        foreach (var c in world.Companies.Values.OrderBy(c => c.Id.Value))
        {
            sb.Append("company ").Append(c.Id.Value).Append(' ').Append(Q(c.Name))
              .Append(" cash=").Append(D(c.Cash))
              .Append(" owned=").Append(string.Join(",", c.OwnedBuildings.Select(b => b.Value)))
              .Append('\n');
        }

        foreach (var b in world.Buildings.Values.OrderBy(b => b.Id.Value))
        {
            AppendBuilding(sb, b);
        }

        foreach (var kv in world.InternalTech
                     .OrderBy(k => k.Key.Company.Value)
                     .ThenBy(k => k.Key.Product.Value, StringComparer.Ordinal))
        {
            sb.Append("tech ").Append(kv.Key.Company.Value).Append(' ').Append(kv.Key.Product.Value)
              .Append(' ').Append(kv.Value).Append('\n');
        }

        foreach (var kv in world.InternalBrandAwareness
                     .OrderBy(k => k.Key.Company.Value)
                     .ThenBy(k => k.Key.Product.Value, StringComparer.Ordinal)
                     .ThenBy(k => k.Key.City.Value, StringComparer.Ordinal))
        {
            sb.Append("brand ").Append(kv.Key.Company.Value).Append(' ').Append(kv.Key.Product.Value)
              .Append(' ').Append(kv.Key.City.Value).Append(' ').Append(R(kv.Value)).Append('\n');
        }

        foreach (var kv in world.InternalResearchProgress
                     .OrderBy(k => k.Key.Company.Value)
                     .ThenBy(k => k.Key.Product.Value, StringComparer.Ordinal))
        {
            sb.Append("research ").Append(kv.Key.Company.Value).Append(' ').Append(kv.Key.Product.Value)
              .Append(' ').Append(R(kv.Value)).Append('\n');
        }

        foreach (var ad in world.InternalAdCampaigns.Values
                     .OrderBy(a => a.Company.Value)
                     .ThenBy(a => a.Product.Value, StringComparer.Ordinal)
                     .ThenBy(a => a.City.Value, StringComparer.Ordinal)
                     .ThenBy(a => (int)a.Channel))
        {
            sb.Append("ad ").Append(ad.Company.Value).Append(' ').Append(ad.Product.Value)
              .Append(' ').Append(ad.City.Value).Append(' ').Append(ad.Channel)
              .Append(' ').Append(D(ad.MonthlyBudget)).Append('\n');
        }

        foreach (var p in world.InternalPatents.Values
                     .OrderBy(p => p.Holder.Value)
                     .ThenBy(p => p.Product.Value, StringComparer.Ordinal))
        {
            sb.Append("patent ").Append(p.Holder.Value).Append(' ').Append(p.Product.Value)
              .Append(' ').Append(p.ExpiresAt).Append('\n');
        }

        foreach (var k in world.InternalPatentsEverGranted
                     .OrderBy(k => k.Holder.Value)
                     .ThenBy(k => k.Product.Value, StringComparer.Ordinal))
        {
            sb.Append("patent-ever ").Append(k.Holder.Value).Append(' ').Append(k.Product.Value).Append('\n');
        }

        foreach (var kv in world.InternalPatentLicenses
                     .OrderBy(k => k.Key.Holder.Value)
                     .ThenBy(k => k.Key.Product.Value, StringComparer.Ordinal))
        {
            foreach (var licensee in kv.Value.OrderBy(l => l.Value))
            {
                sb.Append("license ").Append(kv.Key.Holder.Value).Append(' ').Append(licensee.Value)
                  .Append(' ').Append(kv.Key.Product.Value).Append('\n');
            }
        }

        foreach (var kv in world.InternalActivePriceEffects.OrderBy(k => k.Key.Value, StringComparer.Ordinal))
        {
            sb.Append("price-effect ").Append(kv.Value.ProductId).Append(' ').Append(D(kv.Value.Multiplier))
              .Append(' ').Append(kv.Value.RemainingMonths).Append('\n');
        }

        foreach (var kv in world.InternalAiStrategies.OrderBy(k => k.Key.Value))
        {
            sb.Append("ai ").Append(kv.Key.Value).Append(' ').Append(kv.Value.GetType().Name).Append('\n');
        }

        foreach (var n in world.NewsLog)
        {
            sb.Append("news ").Append(n.Date).Append(' ').Append(n.EventId).Append(' ').Append(n.Severity).Append('\n');
        }

        AppendLedger(sb, world);
        AppendCogs(sb, world);
        AppendTransfers(sb, world);
        AppendStatements(sb, world);
    }

    private static void AppendBuilding(StringBuilder sb, BuildingInstance b)
    {
        sb.Append("building ").Append(b.Id.Value).Append(' ').Append(b.TypeId.Value)
          .Append(" owner=").Append(b.Owner.Value)
          .Append(" city=").Append(b.City.Value)
          .Append(" level=").Append(b.Level)
          .Append(" autoExport=").Append(b.AutoExport)
          .Append('\n');

        // Slot lists are emitted in list order: the tick iterates some of them in list order,
        // so the order is part of the state.
        foreach (var s in b.ExtractionSlots)
            sb.Append("  slot extraction ").Append(s.Index).Append(' ').Append(s.Product.Value).Append('\n');
        foreach (var s in b.ProductionSlots)
            sb.Append("  slot production ").Append(s.Index).Append(' ').Append(s.Product.Value).Append('\n');
        foreach (var s in b.WarehouseSlots)
            sb.Append("  slot warehouse ").Append(s.Index).Append(' ').Append(s.Product.Value)
              .Append(" target=").Append(R(s.TargetStock)).Append('\n');
        foreach (var s in b.RetailSlots)
            sb.Append("  slot retail ").Append(s.Index).Append(' ').Append(s.Product.Value)
              .Append(" price=").Append(D(s.Price)).Append(" restock=").Append(R(s.RestockTarget)).Append('\n');
        foreach (var s in b.ResearchSlots)
            sb.Append("  slot research ").Append(s.Index).Append(' ').Append(s.Product.Value).Append('\n');

        // Inventory lines are ordinal-sorted; fully empty entries (a product that was drawn to
        // zero) are behaviourally inert and skipped.
        foreach (var e in b.Inventory.EntriesWithCost
                     .Where(e => e.Quantity != 0 || e.Cost != 0m)
                     .OrderBy(e => e.Product.Value, StringComparer.Ordinal))
        {
            sb.Append("  inv ").Append(e.Product.Value)
              .Append(" qty=").Append(R(e.Quantity))
              .Append(" cost=").Append(D(e.Cost))
              .Append(" q=").Append(R(e.AverageQuality))
              .Append('\n');
        }
    }

    private static void AppendLedger(StringBuilder sb, World world)
    {
        var entries = world.Ledger.Entries;
        var lines = new StringBuilder();
        var sums = new Dictionary<(int Company, string Category), (int Count, decimal Sum)>();
        foreach (var e in entries)
        {
            lines.Append(e.Date).Append('|').Append(e.Company.Value).Append('|').Append(e.Category)
                 .Append('|').Append(D(e.Amount)).Append('|').Append(e.Memo)
                 .Append('|').Append(e.Product?.Value).Append('|').Append(e.Building?.Value).Append('\n');
            var key = (e.Company.Value, e.Category.ToString());
            sums.TryGetValue(key, out var acc);
            sums[key] = (acc.Count + 1, acc.Sum + e.Amount);
        }

        sb.Append("ledger count=").Append(entries.Count).Append(" sha256=").Append(Sha256(lines.ToString())).Append('\n');
        foreach (var (key, acc) in sums.OrderBy(k => k.Key.Company).ThenBy(k => k.Key.Category, StringComparer.Ordinal))
        {
            sb.Append("ledger-sum ").Append(key.Company).Append(' ').Append(key.Category)
              .Append(" n=").Append(acc.Count).Append(" sum=").Append(D(acc.Sum)).Append('\n');
        }
    }

    private static void AppendCogs(StringBuilder sb, World world)
    {
        var entries = world.CogsLog.Entries;
        var lines = new StringBuilder();
        var sums = new Dictionary<int, (int Count, double Qty, decimal Cost)>();
        foreach (var e in entries)
        {
            lines.Append(e.Date).Append('|').Append(e.Company.Value).Append('|').Append(e.Product.Value)
                 .Append('|').Append(R(e.Quantity)).Append('|').Append(D(e.Cost))
                 .Append('|').Append(e.SourceBuilding?.Value).Append('\n');
            sums.TryGetValue(e.Company.Value, out var acc);
            sums[e.Company.Value] = (acc.Count + 1, acc.Qty + e.Quantity, acc.Cost + e.Cost);
        }

        sb.Append("cogs count=").Append(entries.Count).Append(" sha256=").Append(Sha256(lines.ToString())).Append('\n');
        foreach (var (company, acc) in sums.OrderBy(k => k.Key))
        {
            sb.Append("cogs-sum ").Append(company).Append(" n=").Append(acc.Count)
              .Append(" qty=").Append(R(acc.Qty)).Append(" cost=").Append(D(acc.Cost)).Append('\n');
        }
    }

    private static void AppendTransfers(StringBuilder sb, World world)
    {
        var entries = world.TransferLog.Entries;
        var lines = new StringBuilder();
        var sums = new Dictionary<int, (int Count, double Qty)>();
        foreach (var e in entries)
        {
            lines.Append(e.Date).Append('|').Append(e.Company.Value).Append('|').Append(e.From.Value)
                 .Append('|').Append(e.To.Value).Append('|').Append(e.Product.Value)
                 .Append('|').Append(R(e.Quantity)).Append('\n');
            sums.TryGetValue(e.Company.Value, out var acc);
            sums[e.Company.Value] = (acc.Count + 1, acc.Qty + e.Quantity);
        }

        sb.Append("transfers count=").Append(entries.Count).Append(" sha256=").Append(Sha256(lines.ToString())).Append('\n');
        foreach (var (company, acc) in sums.OrderBy(k => k.Key))
        {
            sb.Append("transfer-sum ").Append(company).Append(" n=").Append(acc.Count)
              .Append(" qty=").Append(R(acc.Qty)).Append('\n');
        }
    }

    private static void AppendStatements(StringBuilder sb, World world)
    {
        // Whole-history statements: the range starts before any possible game date.
        var from = new GameDate(1, 1);
        foreach (var c in world.Companies.Values.OrderBy(c => c.Id.Value))
        {
            var inc = world.GetIncomeStatement(c.Id, from, world.Clock.Now);
            sb.Append("income ").Append(c.Id.Value)
              .Append(" revenue=").Append(D(inc.Revenue))
              .Append(" cogs=").Append(D(inc.CostOfGoodsSold))
              .Append(" opex=").Append(D(inc.OperatingExpenses))
              .Append(" gross=").Append(D(inc.GrossProfit))
              .Append(" net=").Append(D(inc.NetIncome))
              .Append('\n');

            var bs = world.GetBalanceSheet(c.Id);
            sb.Append("balance ").Append(c.Id.Value)
              .Append(" cash=").Append(D(bs.Cash))
              .Append(" inventory=").Append(D(bs.InventoryValue))
              .Append(" buildings=").Append(D(bs.BuildingValue))
              .Append(" liabilities=").Append(D(bs.Liabilities))
              .Append(" assets=").Append(D(bs.TotalAssets))
              .Append(" equity=").Append(D(bs.Equity))
              .Append('\n');
        }
    }

    /// <summary>
    /// Index of the first differing line of two digests plus both lines, for assertion messages.
    /// Returns null when the texts are equal.
    /// </summary>
    public static string? FirstDifference(string expected, string actual)
    {
        if (string.Equals(expected, actual, StringComparison.Ordinal)) return null;
        var e = expected.Split('\n');
        var a = actual.Split('\n');
        var n = Math.Max(e.Length, a.Length);
        for (var i = 0; i < n; i++)
        {
            var el = i < e.Length ? e[i] : "<missing>";
            var al = i < a.Length ? a[i] : "<missing>";
            if (!string.Equals(el, al, StringComparison.Ordinal))
            {
                return $"line {i + 1}:\n  expected: {el}\n  actual:   {al}";
            }
        }

        return "texts differ only in line endings";
    }
}
