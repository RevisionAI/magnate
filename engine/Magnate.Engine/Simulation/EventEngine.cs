using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Simulation;

/// <summary>
/// Phase 3.65 — random and conditional event dispatcher. Each monthly tick
/// <see cref="MonthlyTick"/> calls <see cref="RollAndApply"/>, which:
/// <list type="number">
///   <item>Filters the catalog to events whose <see cref="EventTrigger"/>
///         predicate currently passes.</item>
///   <item>Rolls one global dice; if &lt;= <c>EventBaseProbabilityPerMonth</c>
///         picks one event (weighted by <c>Weight</c>) and applies all of its
///         effects.</item>
///   <item>Records a <see cref="NewsEntry"/> on <see cref="World.NewsLog"/>.</item>
/// </list>
/// At most one event fires per tick (designer rule — keeps the news ticker
/// readable and per-tick state perturbations bounded).
///
/// Determinism: dice are sourced from <see cref="World.Rng"/>; event lists are
/// always iterated ordinal-sorted by <see cref="EventDefinition.Id"/> so the
/// weighted-pick math is reproducible across save/load and across machines.
/// </summary>
public static class EventEngine
{
    /// <summary>
    /// Roll dice and (possibly) apply one event from <paramref name="events"/>.
    /// Returns the fired event for tracing/testing, or <c>null</c> if no event
    /// fired this tick (either the global probability didn't pass or no event
    /// was eligible).
    /// </summary>
    public static EventDefinition? RollAndApply(
        World world,
        IReadOnlyList<EventDefinition> events,
        IRandomSource rng)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(rng);

        if (events.Count == 0) return null;

        // ALWAYS roll the gate die so determinism doesn't depend on whether the
        // catalog happens to be non-empty when we're called multiple times.
        var gate = rng.NextDouble();
        if ((decimal)gate >= SimulationConstants.EventBaseProbabilityPerMonth)
        {
            return null;
        }

        // Filter to eligible events, sorted by id for deterministic weighted pick.
        var eligible = events
            .Where(e => IsEligible(e.Trigger, world))
            .OrderBy(e => e.Id, StringComparer.Ordinal)
            .ToList();

        if (eligible.Count == 0) return null;

        var totalWeight = 0;
        foreach (var e in eligible) totalWeight += e.Weight;
        if (totalWeight <= 0) return null;

        // Use a single uniform pick across the cumulative weight bucket.
        var pick = rng.NextDouble() * totalWeight;
        var running = 0.0;
        EventDefinition? chosen = null;
        foreach (var e in eligible)
        {
            running += e.Weight;
            if (pick < running)
            {
                chosen = e;
                break;
            }
        }
        chosen ??= eligible[^1];

        ApplyEffects(world, chosen);
        world.RecordNewsEntry(new NewsEntry(
            world.Clock.Now,
            chosen.Id,
            chosen.Name,
            chosen.Severity));
        return chosen;
    }

    private static bool IsEligible(EventTrigger trigger, World world) => trigger switch
    {
        RandomTrigger => true,
        // Future trigger types: pattern-match here. Default to ineligible so
        // an unrecognised trigger never silently fires.
        _ => false,
    };

    private static void ApplyEffects(World world, EventDefinition definition)
    {
        foreach (var effect in definition.Effects)
        {
            switch (effect)
            {
                case WorldMarketPriceMultiplierEffect price:
                    world.SetActivePriceEffect(new ActivePriceEffect(
                        price.ProductId,
                        price.Multiplier,
                        price.DurationMonths));
                    break;

                case BrandShiftEffect brand:
                    world.ApplyBrandShift(
                        new ProductId(brand.ProductId),
                        new CityId(brand.CityId),
                        brand.Delta);
                    break;

                case HeadlineEffect:
                    // No mechanical state change — the news log entry is recorded
                    // by the caller after all effects have run.
                    break;

                default:
                    throw new InvalidOperationException(
                        $"unknown event effect type {effect.GetType().Name}");
            }
        }
    }
}
