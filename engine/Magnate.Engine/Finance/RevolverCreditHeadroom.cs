using Magnate.Engine.Market;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Finance;

/// <summary>
/// The finance area's answer to the market model's <see cref="ICreditHeadroom"/> seam
/// (econ-audit §4.4, §4.10): world-market purchases may use the undrawn revolver, which the
/// Finance step then draws when cash goes negative. Stateless; the world installs it by default
/// whenever its finance rules run a revolver.
/// </summary>
public sealed class RevolverCreditHeadroom : ICreditHeadroom
{
    /// <summary>The shared stateless instance.</summary>
    public static RevolverCreditHeadroom Instance { get; } = new();

    private RevolverCreditHeadroom()
    {
    }

    /// <inheritdoc/>
    public decimal UndrawnCredit(World world, CompanyId company) => world.UndrawnRevolverCredit(company);
}
