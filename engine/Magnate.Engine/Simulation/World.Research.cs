using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Simulation;

// Tech levels, research progress, patents and patent licences.
public sealed partial class World
{
    /// <summary>Company's current tech level for a product. Defaults to <see cref="SimulationConstants.BaseTechLevel"/> until R&amp;D raises it.</summary>
    public int GetTech(CompanyId company, ProductId product)
        => _tech.TryGetValue((company, product), out var t) ? t : SimulationConstants.BaseTechLevel;

    /// <summary>
    /// Set the company's tech level for a product (1..MaxTechLevel). Phase 2.2 uses
    /// this primarily for tests and cockpit setup; Phase 2.3 R&amp;D will advance it.
    /// </summary>
    public void SetTech(CompanyId company, ProductId product, int level)
    {
        RequireCompany(company);
        var maxTech = Catalog.Product(product).MaxTechLevel;
        if (level < 1) throw new ArgumentOutOfRangeException(nameof(level), "tech level must be >= 1");
        if (level > maxTech) throw new ArgumentOutOfRangeException(nameof(level), $"exceeds MaxTechLevel {maxTech}");
        _tech[(company, product)] = level;
    }

    /// <summary>Current research progress (points) toward the next tech level for a (company, product).</summary>
    public double GetResearchProgress(CompanyId company, ProductId product)
        => _researchProgress.TryGetValue((company, product), out var p) ? p : 0.0;

    /// <summary>
    /// Add research points toward a company's tech level for a product. If the
    /// cumulative progress exceeds the level-up threshold, advance the tech level
    /// (up to <c>MaxTechLevel</c>) and roll any overflow into the next level. Once
    /// max tech is reached, progress caps at zero.
    /// </summary>
    internal void AddResearchPoints(CompanyId company, ProductId product, double points)
    {
        if (points <= 0) return;
        RequireCompany(company);

        _researchProgress.TryGetValue((company, product), out var current);
        current += points;

        var maxTech = Catalog.Product(product).MaxTechLevel;
        var techBefore = GetTech(company, product);
        var tech = techBefore;

        while (tech < maxTech)
        {
            var threshold = SimulationConstants.BaseResearchThreshold * tech;
            if (current < threshold) break;
            current -= threshold;
            tech++;
        }

        if (tech >= maxTech) current = 0; // cap at max — no overflow above MaxTechLevel
        _researchProgress[(company, product)] = current;
        _tech[(company, product)] = tech;

        // Phase 3.49: if this injection took the company from below MaxTechLevel
        // to MaxTechLevel for the first time ever, grant them a patent.
        if (techBefore < maxTech && tech >= maxTech)
        {
            var key = (company, product);
            if (!_patentsEverGranted.Contains(key))
            {
                _patentsEverGranted.Add(key);
                var expiresAt = AddMonths(Clock.Now, SimulationConstants.PatentDurationMonths);
                _patents[key] = new Patent(company, product, expiresAt);
            }
        }
    }

    /// <summary>Advance a <see cref="GameDate"/> by a non-negative whole number of months.</summary>
    private static GameDate AddMonths(GameDate date, int months)
    {
        var result = date;
        for (var i = 0; i < months; i++) result = result.AddMonth();
        return result;
    }

    /// <summary>
    /// All patents currently active at <c>Clock.Now</c>, ordered deterministically
    /// by holder ascending then product ordinal. A patent is active iff
    /// <c>Clock.Now &lt; patent.ExpiresAt</c> (strict). Patents whose expiry has
    /// been reached are filtered out of the returned list but are not removed
    /// from internal state — <see cref="MonthlyTick"/> prunes them at the start
    /// of each research step.
    /// </summary>
    public IReadOnlyList<Patent> GetActivePatents()
    {
        var now = Clock.Now;
        return _patents.Values
            .Where(p => now < p.ExpiresAt)
            .OrderBy(p => p.Holder.Value)
            .ThenBy(p => p.Product.Value, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// Returns true if <paramref name="requester"/> should be blocked from making
    /// R&amp;amp;D progress on <paramref name="product"/> because another company
    /// holds an active patent on it. A company is never blocked by its own patent,
    /// and is not blocked if the patent holder has granted it a license (Phase 3.54).
    /// </summary>
    public bool IsPatentBlocked(CompanyId requester, ProductId product)
    {
        var now = Clock.Now;
        foreach (var p in _patents.Values)
        {
            if (p.Product != product) continue;
            if (p.Holder == requester) continue;
            if (now >= p.ExpiresAt) continue;
            // Phase 3.54: a licensed competitor isn't blocked.
            if (_patentLicenses.TryGetValue((p.Holder, product), out var licensees)
                && licensees.Contains(requester))
            {
                continue;
            }
            return true;
        }
        return false;
    }

    /// <summary>
    /// Grant <paramref name="licensee"/> a license under <paramref name="holder"/>'s
    /// active patent on <paramref name="product"/>. Idempotent. Throws if no active
    /// patent exists for (<paramref name="holder"/>, <paramref name="product"/>) or
    /// if <paramref name="licensee"/> is the holder itself. See Phase 3.54.
    /// </summary>
    public void GrantPatentLicense(CompanyId holder, CompanyId licensee, ProductId product)
    {
        RequireCompany(holder);
        RequireCompany(licensee);
        if (holder == licensee)
        {
            throw new InvalidOperationException("a patent holder cannot license themselves");
        }

        var key = (holder, product);
        if (!_patents.TryGetValue(key, out var patent))
        {
            throw new InvalidOperationException(
                $"company {holder} does not hold an active patent on {product}");
        }
        if (Clock.Now >= patent.ExpiresAt)
        {
            throw new InvalidOperationException(
                $"patent on {product} held by {holder} has expired");
        }

        if (!_patentLicenses.TryGetValue(key, out var licensees))
        {
            licensees = new HashSet<CompanyId>();
            _patentLicenses[key] = licensees;
        }
        licensees.Add(licensee);
    }

    /// <summary>
    /// Revoke a previously-granted license. Idempotent — a no-op if no such
    /// license exists. See Phase 3.54.
    /// </summary>
    public void RevokePatentLicense(CompanyId holder, CompanyId licensee, ProductId product)
    {
        var key = (holder, product);
        if (!_patentLicenses.TryGetValue(key, out var licensees)) return;
        licensees.Remove(licensee);
        if (licensees.Count == 0) _patentLicenses.Remove(key);
    }

    /// <summary>
    /// All currently-live patent licenses, ordered deterministically
    /// (holder ascending, product ordinal, licensee ascending). A license
    /// is only meaningful while the underlying patent is live — licenses
    /// whose patent has expired or been pruned are removed automatically.
    /// See Phase 3.54.
    /// </summary>
    public IReadOnlyList<PatentLicense> GetPatentLicenses()
    {
        var result = new List<PatentLicense>();
        foreach (var kvp in _patentLicenses
                     .OrderBy(kv => kv.Key.Holder.Value)
                     .ThenBy(kv => kv.Key.Product.Value, StringComparer.Ordinal))
        {
            foreach (var licensee in kvp.Value.OrderBy(l => l.Value))
            {
                result.Add(new PatentLicense(kvp.Key.Holder, licensee, kvp.Key.Product));
            }
        }
        return result;
    }

    /// <summary>
    /// Remove any patents whose expiry has been reached (<c>ExpiresAt &lt;= Clock.Now</c>).
    /// Called from <see cref="MonthlyTick"/> at the start of the research step so
    /// the blocking predicate only sees live patents. The ever-granted record is
    /// intentionally NOT cleared — it enforces the at-most-one-per-(company,
    /// product) rule across the world's entire lifetime. Phase 3.54: licenses
    /// on the (holder, product) tuple are cascaded-removed when the patent goes.
    /// </summary>
    internal void PruneExpiredPatents()
    {
        var now = Clock.Now;
        var expired = _patents
            .Where(kvp => kvp.Value.ExpiresAt <= now)
            .Select(kvp => kvp.Key)
            .ToList();
        foreach (var key in expired)
        {
            _patents.Remove(key);
            _patentLicenses.Remove(key);
        }
    }
}
