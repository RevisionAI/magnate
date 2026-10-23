using System.Collections.Generic;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Simulation;

/// <summary>
/// Newsworthiness of a fired event. Used purely for UI sorting / styling — has
/// no mechanical effect on the simulation. Phase 3.65.
/// </summary>
public enum EventSeverity
{
    Info,
    Notable,
    Major,
}

/// <summary>
/// Predicate over the world that decides whether an event is eligible to fire
/// this tick. Modeled as a sealed record hierarchy (discriminated union) so the
/// JSON loader and <see cref="EventEngine"/> can pattern-match concrete types
/// extensively. Phase 3.65 ships with <see cref="RandomTrigger"/> only;
/// future phases will add conditional triggers (tech &gt; N, supply &lt; T, ...).
/// </summary>
public abstract record EventTrigger;

/// <summary>
/// Fires with a base monthly probability of
/// <see cref="SimulationConstants.EventBaseProbabilityPerMonth"/> scaled by
/// the event's <c>Weight</c>. Stateless — eligibility is independent of world.
/// </summary>
public sealed record RandomTrigger : EventTrigger;

/// <summary>
/// One mechanical (or non-mechanical) consequence of an event firing. Multiple
/// effects may be attached to a single <see cref="EventDefinition"/>. Sealed-record
/// hierarchy: pattern-matched in <see cref="EventEngine"/>, JSON-loaded by
/// <see cref="Content.ContentLoader"/>.
/// </summary>
public abstract record EventEffect;

/// <summary>
/// Multiplies a product's effective world-market price by
/// <paramref name="Multiplier"/> for <paramref name="DurationMonths"/> ticks.
/// Surfaces through <see cref="World.GetEffectiveWorldPrice"/> which is read by
/// <c>MaterialProcurement</c> (purchases / shipping cost) and
/// <c>MonthlyTick.AutoExportSurplus</c> (export revenue). The static
/// <c>Product.BaseWorldMarketPrice</c> catalog value is never mutated — this is
/// a pure runtime overlay.
/// </summary>
public sealed record WorldMarketPriceMultiplierEffect(
    string ProductId,
    decimal Multiplier,
    int DurationMonths) : EventEffect;

/// <summary>
/// Bumps brand awareness for every company on (<paramref name="ProductId"/>,
/// <paramref name="CityId"/>) by <paramref name="Delta"/> percentage points,
/// clamped to the [0, 100] range invariant. Useful for "viral ad",
/// "celebrity endorsement", and similar flavor events.
/// </summary>
public sealed record BrandShiftEffect(
    string ProductId,
    string CityId,
    int Delta) : EventEffect;

/// <summary>
/// Pure news flavor — appends to <see cref="World.NewsLog"/> with no other
/// world-state mutation. Most event definitions will combine this with a
/// mechanical effect; a "headline-only" event is also valid (no mechanical
/// effect, just atmosphere).
/// </summary>
public sealed record HeadlineEffect : EventEffect;

/// <summary>
/// Static event definition loaded from <c>content/data/events/*.json</c>.
/// Identity = <see cref="Id"/>; <see cref="Weight"/> is a positive integer
/// (higher = more likely to fire). The <see cref="Description"/> is the
/// long-form flavor text shown in the news ticker; the headline that goes
/// into <see cref="NewsEntry"/> is taken from <see cref="Name"/> by default.
/// </summary>
public sealed record EventDefinition(
    string Id,
    string Name,
    string Description,
    EventTrigger Trigger,
    IReadOnlyList<EventEffect> Effects,
    int Weight,
    EventSeverity Severity);

/// <summary>
/// One record in the world's news log — produced by <see cref="EventEngine"/>
/// when an event fires. Persisted across save/load (schema v9+).
/// </summary>
public sealed record NewsEntry(
    GameDate Date,
    string EventId,
    string Headline,
    EventSeverity Severity);

/// <summary>
/// In-flight world-market price multiplier created by a fired
/// <see cref="WorldMarketPriceMultiplierEffect"/>. Decremented at the end of
/// each tick; removed when <see cref="RemainingMonths"/> hits zero. Multiple
/// active effects on the same product are not stacked — the single-slot model
/// (one active multiplier per product) is sufficient for Phase 3.65 and keeps
/// determinism simple.
/// </summary>
public sealed record ActivePriceEffect(
    string ProductId,
    decimal Multiplier,
    int RemainingMonths);
