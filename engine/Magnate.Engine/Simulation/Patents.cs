using Magnate.Engine.Domain;

namespace Magnate.Engine.Simulation;

/// <summary>
/// A time-bounded exclusive R&amp;D right held by <paramref name="Holder"/> on
/// <paramref name="Product"/>. Granted automatically the first time any company
/// advances to <c>MaxTechLevel</c> on a product; expires at
/// <paramref name="ExpiresAt"/> (strict &lt; comparison — the patent is active
/// iff <c>clock.Now &lt; ExpiresAt</c>). While active, other companies' R&amp;D
/// progress on the same product is silently dropped by
/// <see cref="MonthlyTick"/>. A company may be granted at most one patent per
/// product over the entire lifetime of a world — see
/// <c>World.InternalPatentsEverGranted</c>.
/// </summary>
public sealed record Patent(CompanyId Holder, ProductId Product, GameDate ExpiresAt);

/// <summary>
/// A license granted by the patent <paramref name="Holder"/> to a specific
/// <paramref name="Licensee"/> for <paramref name="Product"/>. While the
/// license is live (the underlying patent is still active), the licensee's
/// R&amp;D on that product resumes normally and the licensee owes the holder
/// a <see cref="SimulationConstants.PatentRoyaltyRate"/> royalty on every
/// <c>ProductSale</c> and <c>ExportSale</c> of the product. Licenses are
/// one-way (holder → licensee), revocable by the holder at any time, and
/// evaporate automatically when the underlying patent expires or is pruned.
/// See Phase 3.54.
/// </summary>
public sealed record PatentLicense(CompanyId Holder, CompanyId Licensee, ProductId Product);
