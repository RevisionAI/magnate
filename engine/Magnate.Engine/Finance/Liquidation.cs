using System;
using System.Linq;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>
/// Bankruptcy liquidation (econ-audit §4.14 step 4): every building is sold at fire-sale value,
/// the proceeds repay the revolver and then the term loans pro rata, lenders absorb any
/// shortfall (an overdraft left after every sale becomes revolver debt they will never
/// collect), and the residual is distributed to the shareholders. The company keeps its history
/// and ledger but no longer operates: its AI is unregistered, its campaigns cancelled, and every
/// later tick skips it.
/// </summary>
internal static class Liquidation
{
    public static void Run(World world, Company company, CompanyFinance f, GameDate now, string reason)
    {
        var id = company.Id;

        foreach (var buildingId in company.OwnedBuildings.OrderBy(b => b.Value).ToList())
        {
            if (!world.Buildings.TryGetValue(buildingId, out var building)) continue;
            world.DisposeCore(building, DisposalKind.Liquidation, LedgerCategory.LiquidationProceeds);
        }

        foreach (var campaign in world.AdCampaigns.Where(c => c.Company == id).ToList())
        {
            world.CancelAdCampaign(id, campaign.Product, campaign.City, campaign.Channel);
        }

        // Creditors: the revolver first, then the term loans pro rata.
        var available = Math.Max(0m, company.Cash);
        if (f.RevolverDrawn > 0m && available > 0m)
        {
            var pay = Math.Min(available, f.RevolverDrawn);
            world.RecordCashChange(id, LedgerCategory.RevolverRepay, -pay, "liquidation: revolver repaid");
            f.RevolverDrawn -= pay;
            available -= pay;
        }

        var termDebt = f.TermDebt;
        if (termDebt > 0m && available > 0m)
        {
            var pool = Math.Min(available, termDebt);
            var loans = f.Loans.OrderBy(l => l.Id).ToList();
            var paid = 0m;
            for (var i = 0; i < loans.Count; i++)
            {
                var loan = loans[i];
                var share = i == loans.Count - 1
                    ? pool - paid
                    : Math.Min(loan.Outstanding, FinanceMath.Cents(pool * loan.Outstanding / termDebt));
                share = Math.Min(share, loan.Outstanding);
                if (share <= 0m) continue;
                world.RecordCashChange(id, LedgerCategory.LoanRepayment, -share, $"liquidation: term loan #{loan.Id}");
                loan.Outstanding -= share;
                paid += share;
            }

            f.Loans.RemoveAll(l => l.Outstanding <= 0m);
        }

        if (company.Cash < 0m)
        {
            // Lenders absorb the shortfall: the unpaid overdraft stays on the books as revolver debt.
            var deficit = -company.Cash;
            world.RecordCashChange(id, LedgerCategory.RevolverDraw, deficit, "liquidation: overdraft converted to unpaid bank debt");
            f.RevolverDrawn += deficit;
        }
        else if (company.Cash > 0m && f.TotalDebt <= 0m)
        {
            world.RecordCashChange(id, LedgerCategory.DividendPaid, -company.Cash, "liquidation: residual distributed to shareholders");
        }

        f.State = SolvencyState.Bankrupt;
        f.BankruptAt = now.AsMonthIndex();
        f.BankruptcyReason = reason;
        f.Rating = CreditRating.D;
        world.UnregisterAi(id);
        world.AddFinanceEvent(id, FinanceEventKind.Bankruptcy, $"{company.Name} is bankrupt: {reason}. Its assets were liquidated.", f.TotalDebt);
        world.PublishFinanceNews("finance_bankruptcy", $"{company.Name} files for bankruptcy; its stores and plants are sold off", EventSeverity.Major);
    }
}
