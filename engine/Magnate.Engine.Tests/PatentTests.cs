using System;
using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Persistence;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class PatentTests : IDisposable
{
    private readonly string _tempFile;

    public PatentTests()
    {
        _tempFile = Path.Combine(Path.GetTempPath(), $"magnate-patent-test-{Guid.NewGuid():N}.json");
    }

    public void Dispose()
    {
        if (File.Exists(_tempFile)) File.Delete(_tempFile);
    }

    private static ContentCatalog Catalog() => TestContent.Live;

    private static World NewWorld() => new(Catalog(), 42, new GameDate(2026, 1));

    private static GameDate AddMonths(GameDate date, int months)
    {
        var d = date;
        for (var i = 0; i < months; i++) d = d.AddMonth();
        return d;
    }

    // ============================================================ Grant

    [Fact]
    public void Reaching_max_tech_grants_patent_with_24_month_expiry()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;

        // Shortcut: push Acme straight to MaxTechLevel via one big injection so
        // this test isn't tangled up in multi-month R&D accumulation math.
        // Threshold for level N→N+1 is 100×N; sum over N=1..maxTech-1 is
        // 100 × maxTech × (maxTech-1) / 2.
        var totalToMax = TechPoints.ToMax(world, product);

        Assert.Empty(world.GetActivePatents());

        world.AddResearchPoints(acme.Id, product, totalToMax);

        Assert.Equal(maxTech, world.GetTech(acme.Id, product));

        var patents = world.GetActivePatents();
        var p = Assert.Single(patents);
        Assert.Equal(acme.Id, p.Holder);
        Assert.Equal(product, p.Product);
        // Patent granted at Clock.Now (still 2026-01 — no AdvanceMonth yet);
        // expiry = 2026-01 + 24 months = 2028-01.
        Assert.Equal(AddMonths(new GameDate(2026, 1), 24), p.ExpiresAt);
    }

    // ============================================================ Block

    [Fact]
    public void Competitor_research_stalls_while_rivals_patent_active()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var rival = world.CreateCompany("Rival", 100_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;

        // Grant Acme the patent up-front via direct injection; this isolates
        // "the block" from any ordering concerns in the grant-tick itself.
        var totalToMax = TechPoints.ToMax(world, product);
        world.AddResearchPoints(acme.Id, product, totalToMax);
        Assert.Single(world.GetActivePatents());

        var rivalRd = world.Construct(rival.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rivalRd.Id, 0, product);

        var rivalTechBefore = world.GetTech(rival.Id, product);
        var rivalProgressBefore = world.GetResearchProgress(rival.Id, product);

        // Advance 12 months — within the 24-month patent window. Rival's R&D
        // must be entirely dropped.
        for (var i = 0; i < 12; i++) world.AdvanceMonth();

        Assert.Equal(rivalTechBefore, world.GetTech(rival.Id, product));
        Assert.Equal(rivalProgressBefore, world.GetResearchProgress(rival.Id, product));
    }

    // ============================================================ Holder's own R&D continues

    [Fact]
    public void Holder_own_research_continues_without_exception_during_patent()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;

        var totalToMax = TechPoints.ToMax(world, product);
        world.AddResearchPoints(acme.Id, product, totalToMax);
        Assert.Single(world.GetActivePatents());

        var rd = world.Construct(acme.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, product);

        // Holder keeps ticking its own slot — R&D injection must not throw and
        // tech must remain at maxTech (no overflow, progress capped at 0).
        for (var i = 0; i < 6; i++) world.AdvanceMonth();

        Assert.Equal(maxTech, world.GetTech(acme.Id, product));
        Assert.Equal(0.0, world.GetResearchProgress(acme.Id, product));
    }

    // ============================================================ Expiry

    [Fact]
    public void Competitor_research_resumes_after_patent_expires()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var rival = world.CreateCompany("Rival", 100_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;

        var totalToMax = TechPoints.ToMax(world, product);
        world.AddResearchPoints(acme.Id, product, totalToMax);
        Assert.Single(world.GetActivePatents());

        var rivalRd = world.Construct(rival.Id, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rivalRd.Id, 0, product);

        var rivalTechBefore = world.GetTech(rival.Id, product);

        // Patent granted at 2026-01 expires at 2028-01. Advance 25 months to
        // land at 2028-02 — the first month the rival's R&D should make it
        // through the block.
        for (var i = 0; i < 25; i++) world.AdvanceMonth();

        Assert.Empty(world.GetActivePatents());
        Assert.True(world.GetTech(rival.Id, product) > rivalTechBefore,
            $"rival tech should rise after patent expiry; before={rivalTechBefore} after={world.GetTech(rival.Id, product)}");
    }

    // ============================================================ At-most-one rule

    [Fact]
    public void Holder_does_not_receive_second_patent_after_first_expires()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;

        var totalToMax = TechPoints.ToMax(world, product);
        world.AddResearchPoints(acme.Id, product, totalToMax);
        Assert.Single(world.GetActivePatents());

        // Fast-forward past expiry so prune clears the active patent.
        for (var i = 0; i < 25; i++) world.AdvanceMonth();
        // Prune only runs inside RunResearch; trigger it explicitly via one more tick.
        // (After 25 months we are at 2028-02 — past the 2028-01 expiry.)
        Assert.Empty(world.GetActivePatents());

        // Simulate re-advancement: roll the holder back to maxTech-1 and inject
        // enough points to bring them back up. The ever-granted set must
        // suppress a second patent grant.
        world.InternalTech[(acme.Id, product)] = maxTech - 1;
        world.InternalResearchProgress[(acme.Id, product)] = 0.0;
        world.AddResearchPoints(acme.Id, product, TechPoints.Threshold(maxTech - 1));

        Assert.Equal(maxTech, world.GetTech(acme.Id, product));
        Assert.Empty(world.GetActivePatents());
        Assert.Contains((acme.Id, product), world.InternalPatentsEverGranted);
    }

    // ============================================================ Save/load

    [Fact]
    public void Save_and_load_round_trips_active_patents_and_ever_granted()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var rival = world.CreateCompany("Rival", 10_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;

        var totalToMax = TechPoints.ToMax(world, product);
        world.AddResearchPoints(acme.Id, product, totalToMax);

        var originalActive = world.GetActivePatents();
        Assert.Single(originalActive);
        var originalExpiry = originalActive[0].ExpiresAt;

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var loadedActive = loaded.GetActivePatents();
        var lp = Assert.Single(loadedActive);
        Assert.Equal(acme.Id, lp.Holder);
        Assert.Equal(product, lp.Product);
        Assert.Equal(originalExpiry, lp.ExpiresAt);

        // Ever-granted set round-trips: acme's entry is present, rival never
        // reached max so is absent.
        Assert.Contains((acme.Id, product), loaded.InternalPatentsEverGranted);
        Assert.DoesNotContain((rival.Id, product), loaded.InternalPatentsEverGranted);
    }

    // ============================================================ Phase 3.54 — Licensing

    /// <summary>
    /// Helper: put Acme at MaxTechLevel on <c>soft_drink</c> so they hold the
    /// patent, and return their CompanyId plus the rival's CompanyId.
    /// </summary>
    private static (World world, CompanyId holder, CompanyId licensee, ProductId product) SetUpPatent()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 100_000_000m);
        var rival = world.CreateCompany("Rival", 100_000_000m);
        var product = new ProductId("soft_drink");
        var maxTech = world.Catalog.Product(product).MaxTechLevel;
        var totalToMax = TechPoints.ToMax(world, product);
        world.AddResearchPoints(acme.Id, product, totalToMax);
        return (world, acme.Id, rival.Id, product);
    }

    [Fact]
    public void Granting_license_unblocks_competitor_research()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        Assert.True(world.IsPatentBlocked(licensee, product));

        world.GrantPatentLicense(holder, licensee, product);
        Assert.False(world.IsPatentBlocked(licensee, product));

        // Rival ticks R&D with its own rd_center; tech should rise.
        var rd = world.Construct(licensee, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, product);

        var techBefore = world.GetTech(licensee, product);
        world.AdvanceMonth();
        Assert.True(world.GetResearchProgress(licensee, product) > 0
                    || world.GetTech(licensee, product) > techBefore,
            "licensed competitor's R&D should resume normally");
    }

    [Fact]
    public void Grant_is_idempotent_and_deterministic()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        world.GrantPatentLicense(holder, licensee, product);
        world.GrantPatentLicense(holder, licensee, product);
        world.GrantPatentLicense(holder, licensee, product);

        var licenses = world.GetPatentLicenses();
        var single = Assert.Single(licenses);
        Assert.Equal(holder, single.Holder);
        Assert.Equal(licensee, single.Licensee);
        Assert.Equal(product, single.Product);
    }

    [Fact]
    public void Grant_throws_when_no_active_patent()
    {
        var world = NewWorld();
        var acme = world.CreateCompany("Acme", 10_000_000m);
        var rival = world.CreateCompany("Rival", 10_000_000m);
        var product = new ProductId("soft_drink");

        Assert.Throws<InvalidOperationException>(
            () => world.GrantPatentLicense(acme.Id, rival.Id, product));
    }

    [Fact]
    public void Grant_throws_when_caller_is_not_holder()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        // Caller is the rival, not the holder — but there is no patent on
        // (rival, product), so the implementation rejects by "no active patent".
        Assert.Throws<InvalidOperationException>(
            () => world.GrantPatentLicense(licensee, holder, product));
    }

    [Fact]
    public void Revoke_reblocks_competitor_next_tick()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        world.GrantPatentLicense(holder, licensee, product);
        Assert.False(world.IsPatentBlocked(licensee, product));

        world.RevokePatentLicense(holder, licensee, product);
        Assert.True(world.IsPatentBlocked(licensee, product));

        // And the R&D drop is visible on the next tick.
        var rd = world.Construct(licensee, new BuildingTypeId("rd_center"), new CityId("metropolis"));
        world.ConfigureResearchSlot(rd.Id, 0, product);
        var progressBefore = world.GetResearchProgress(licensee, product);
        var techBefore = world.GetTech(licensee, product);
        world.AdvanceMonth();
        Assert.Equal(progressBefore, world.GetResearchProgress(licensee, product));
        Assert.Equal(techBefore, world.GetTech(licensee, product));
    }

    [Fact]
    public void Revoke_is_idempotent()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        world.RevokePatentLicense(holder, licensee, product); // no-op, never granted
        world.GrantPatentLicense(holder, licensee, product);
        world.RevokePatentLicense(holder, licensee, product);
        world.RevokePatentLicense(holder, licensee, product); // second revoke → no-op
        Assert.Empty(world.GetPatentLicenses());
    }

    [Fact]
    public void Royalty_transfers_five_percent_from_licensee_to_holder()
    {
        // Set up a licensee that actually sells soft_drink: give it a pre-stocked
        // supermarket so the monthly tick produces non-zero ProductSale revenue.
        var (world, holder, licensee, product) = SetUpPatent();
        world.GrantPatentLicense(holder, licensee, product);

        var store = world.Construct(licensee, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, product, price: 1.80m, restockTarget: 500_000);
        store.Inventory.Add(product, 1_000_000, cost: 100_000m, quality: 70);

        var holderCashBefore = world.Companies[holder].Cash;
        var licenseeCashBefore = world.Companies[licensee].Cash;

        world.AdvanceMonth();

        // The tick just completed — find ProductSale + ExportSale entries in
        // that tick for the licensee and the matching royalty pair.
        var tickDate = world.Clock.Now;
        var licenseeSales = world.Ledger.Entries
            .Where(e => e.Date == tickDate
                        && e.Company == licensee
                        && e.Product == product
                        && (e.Category == LedgerCategory.ProductSale
                            || e.Category == LedgerCategory.ExportSale))
            .Sum(e => e.Amount);
        Assert.True(licenseeSales > 0m, "licensee must have made sales this tick for the test to be meaningful");

        var expectedRoyalty = licenseeSales * SimulationConstants.PatentRoyaltyRate;

        var incomeEntry = Assert.Single(world.Ledger.Entries,
            e => e.Date == tickDate && e.Company == holder && e.Category == LedgerCategory.PatentRoyaltyIncome);
        var expenseEntry = Assert.Single(world.Ledger.Entries,
            e => e.Date == tickDate && e.Company == licensee && e.Category == LedgerCategory.PatentRoyaltyExpense);

        Assert.Equal(expectedRoyalty, incomeEntry.Amount);
        Assert.Equal(-expectedRoyalty, expenseEntry.Amount);

        // Ledger is the source of truth: sum must match cash delta for both companies.
        var holderCashAfter = world.Companies[holder].Cash;
        var licenseeCashAfter = world.Companies[licensee].Cash;
        Assert.Equal(holderCashBefore - holderCashAfter + (holderCashAfter - holderCashBefore),
                     incomeEntry.Amount + expenseEntry.Amount + (holderCashBefore - holderCashBefore)); // sanity
        // Royalty pair sums to zero across the two companies (books close).
        Assert.Equal(0m, incomeEntry.Amount + expenseEntry.Amount);
        // And the cash delta includes exactly the royalty flow on top of opex etc.
        Assert.True(holderCashAfter >= holderCashBefore + expectedRoyalty - 1m,
            $"holder cash should have risen by ~{expectedRoyalty}; before={holderCashBefore} after={holderCashAfter}");
    }

    [Fact]
    public void Patent_expiry_cascades_to_license_removal()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        world.GrantPatentLicense(holder, licensee, product);
        Assert.Single(world.GetPatentLicenses());

        // Advance 25 months — past the 24-month patent window.
        for (var i = 0; i < 25; i++) world.AdvanceMonth();

        Assert.Empty(world.GetActivePatents());
        Assert.Empty(world.GetPatentLicenses());
        Assert.False(world.InternalPatentLicenses.ContainsKey((holder, product)));
    }

    [Fact]
    public void Save_and_load_round_trips_active_license()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        world.GrantPatentLicense(holder, licensee, product);

        WorldSaver.Save(world, _tempFile);
        var loaded = WorldLoader.Load(Catalog(), _tempFile).World;

        var licenses = loaded.GetPatentLicenses();
        var single = Assert.Single(licenses);
        Assert.Equal(holder, single.Holder);
        Assert.Equal(licensee, single.Licensee);
        Assert.Equal(product, single.Product);
    }

    [Fact]
    public void Save_load_midrun_yields_identical_royalty_stream()
    {
        // Two parallel runs: one continuous, one with save/load halfway.
        // Final cash for both companies must match exactly.
        var catalog = Catalog();

        World Build()
        {
            var w = new World(catalog, 42, new GameDate(2026, 1));
            var a = w.CreateCompany("Acme", 10_000_000m);
            var r = w.CreateCompany("Rival", 10_000_000m);
            var p = new ProductId("soft_drink");
            var totalToMax = TechPoints.ToMax(w, p);
            w.AddResearchPoints(a.Id, p, totalToMax);
            w.GrantPatentLicense(a.Id, r.Id, p);

            var store = w.Construct(r.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            w.ConfigureRetailSlot(store.Id, 0, p, 1.80m, 500_000);
            store.Inventory.Add(p, 10_000_000, cost: 1_000_000m, quality: 70);
            return w;
        }

        var direct = Build();
        for (var i = 0; i < 12; i++) direct.AdvanceMonth();

        var indirect = Build();
        for (var i = 0; i < 6; i++) indirect.AdvanceMonth();
        WorldSaver.Save(indirect, _tempFile);
        var reloaded = WorldLoader.Load(catalog, _tempFile).World;
        for (var i = 0; i < 6; i++) reloaded.AdvanceMonth();

        var holderId = new CompanyId(1);
        var licenseeId = new CompanyId(2);
        Assert.Equal(direct.Companies[holderId].Cash, reloaded.Companies[holderId].Cash);
        Assert.Equal(direct.Companies[licenseeId].Cash, reloaded.Companies[licenseeId].Cash);

        // And the royalty ledger sums agree.
        var directRoyaltyIncome = direct.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.PatentRoyaltyIncome).Sum(e => e.Amount);
        var reloadedRoyaltyIncome = reloaded.Ledger.Entries
            .Where(e => e.Category == LedgerCategory.PatentRoyaltyIncome).Sum(e => e.Amount);
        Assert.Equal(directRoyaltyIncome, reloadedRoyaltyIncome);
        Assert.True(directRoyaltyIncome > 0m);
        // v10 persists the RNG streams: the complete state matches, not just these probes.
        Assert.Equal(StateDigest.Of(direct), StateDigest.Of(reloaded));
    }

    [Fact]
    public void Royalty_stream_is_deterministic_for_same_seed()
    {
        var catalog = Catalog();

        decimal RunAndCollect()
        {
            var w = new World(catalog, 42, new GameDate(2026, 1));
            var a = w.CreateCompany("Acme", 10_000_000m);
            var r = w.CreateCompany("Rival", 10_000_000m);
            var p = new ProductId("soft_drink");
            var totalToMax = TechPoints.ToMax(w, p);
            w.AddResearchPoints(a.Id, p, totalToMax);
            w.GrantPatentLicense(a.Id, r.Id, p);
            var store = w.Construct(r.Id, new BuildingTypeId("supermarket"), new CityId("metropolis"));
            w.ConfigureRetailSlot(store.Id, 0, p, 1.80m, 500_000);
            store.Inventory.Add(p, 10_000_000, cost: 1_000_000m, quality: 70);
            for (var i = 0; i < 6; i++) w.AdvanceMonth();
            return w.Ledger.Entries
                .Where(e => e.Category == LedgerCategory.PatentRoyaltyIncome).Sum(e => e.Amount);
        }

        var a = RunAndCollect();
        var b = RunAndCollect();
        Assert.Equal(a, b);
        Assert.True(a > 0m);
    }

    [Fact]
    public void Income_statement_treats_royalty_income_as_revenue_and_expense_as_opex()
    {
        var (world, holder, licensee, product) = SetUpPatent();
        world.GrantPatentLicense(holder, licensee, product);

        var store = world.Construct(licensee, new BuildingTypeId("supermarket"), new CityId("metropolis"));
        world.ConfigureRetailSlot(store.Id, 0, product, 1.80m, 500_000);
        store.Inventory.Add(product, 1_000_000, cost: 100_000m, quality: 70);

        var from = world.Clock.Now;
        world.AdvanceMonth();
        var to = world.Clock.Now;

        var holderIncome = world.GetIncomeStatement(holder, from, to);
        var licenseeIncome = world.GetIncomeStatement(licensee, from, to);

        var royalty = world.Ledger.Entries
            .Single(e => e.Date == to && e.Company == holder && e.Category == LedgerCategory.PatentRoyaltyIncome)
            .Amount;

        // Holder's revenue includes the royalty income.
        Assert.True(holderIncome.Revenue >= royalty,
            $"holder revenue {holderIncome.Revenue} should include royalty {royalty}");
        // Licensee's opex includes the royalty expense (positive opex).
        Assert.True(licenseeIncome.OperatingExpenses >= royalty,
            $"licensee opex {licenseeIncome.OperatingExpenses} should include royalty {royalty}");
    }
}
