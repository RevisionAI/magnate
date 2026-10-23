namespace Magnate.Engine.Rules;

/// <summary>
/// Macro-economy realism: the regime-switching business cycle, inflation, the Taylor-rule
/// policy rate, population and income drift, commodity price cycles and the land index
/// (econ-audit §4.13). Random draws come from the persisted <c>macro</c> and
/// <c>commodities</c> RNG streams (§4.19).
/// <para>
/// <b>Owner (E5 equity + macro, Wave 3) adds fields here.</b> Every new field must default to
/// its <em>neutral</em> value — the value that reproduces Classic behaviour exactly (frozen
/// macro state, constant prices) — and <see cref="EconomyRules.Realistic"/> sets the gameplay
/// value. Saves persist the full record, so a field missing from an older save deserialises to
/// that neutral default.
/// </para>
/// </summary>
public sealed record MacroRules
{
    /// <summary>
    /// Master switch for the macro model. When <c>false</c> the macro and world-price tick steps
    /// are no-ops and every price, wage and population stays at its content value (Classic).
    /// </summary>
    public bool Enabled { get; init; }
}
