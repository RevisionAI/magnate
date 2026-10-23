using System;
using System.Linq;
using Magnate.Engine.Economics;

namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 12 (econ-audit §4.16): patent royalties (Phase 3.54). For each active patent with
/// licensees, each licensee pays <see cref="SimulationConstants.PatentRoyaltyRate"/> of its
/// <c>ProductSale</c> + <c>ExportSale</c> revenue on the patented product booked this month,
/// as mirrored <see cref="LedgerCategory.PatentRoyaltyExpense"/> /
/// <see cref="LedgerCategory.PatentRoyaltyIncome"/> entries. Determinism: patents in
/// (holder, product) order, licensees in ascending id order.
/// </summary>
internal static class RoyaltiesStep
{
    public static void Run(TickContext ctx)
    {
        var world = ctx.World;
        var now = ctx.Now;

        // Iterate only over active patents, in deterministic order.
        var activePatents = world.InternalPatents.Values
            .Where(p => now < p.ExpiresAt)
            .OrderBy(p => p.Holder.Value)
            .ThenBy(p => p.Product.Value, StringComparer.Ordinal)
            .ToList();

        foreach (var patent in activePatents)
        {
            if (!world.InternalPatentLicenses.TryGetValue((patent.Holder, patent.Product), out var licensees))
            {
                continue;
            }
            if (licensees.Count == 0) continue;

            foreach (var licensee in licensees.OrderBy(l => l.Value))
            {
                // This month's entries of the licensee, in ledger order (the same entries, in the
                // same order, as a full scan filtered on date and company).
                decimal licenseeRevenue = 0m;
                foreach (var entry in world.Ledger.EntriesInRange(licensee, now, now))
                {
                    if (entry.Product is null || entry.Product.Value != patent.Product) continue;
                    if (entry.Category != LedgerCategory.ProductSale
                        && entry.Category != LedgerCategory.ExportSale) continue;
                    licenseeRevenue += entry.Amount;
                }

                if (licenseeRevenue <= 0m) continue;

                var royalty = licenseeRevenue * SimulationConstants.PatentRoyaltyRate;
                if (royalty <= 0m) continue;

                var memo = $"patent royalty {patent.Product} → {patent.Holder}";
                world.RecordCashChange(
                    licensee,
                    LedgerCategory.PatentRoyaltyExpense,
                    -royalty,
                    memo,
                    patent.Product);
                world.RecordCashChange(
                    patent.Holder,
                    LedgerCategory.PatentRoyaltyIncome,
                    royalty,
                    $"patent royalty {patent.Product} ← {licensee}",
                    patent.Product);
            }
        }
    }
}
