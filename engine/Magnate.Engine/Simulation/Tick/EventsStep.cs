namespace Magnate.Engine.Simulation.Tick;

/// <summary>
/// Step 19 (econ-audit §4.16), always last: random events (Phase 3.65). First every active
/// world-price overlay ticks down (expired ones are removed), then the events catalog is rolled
/// with the world's <c>events</c> RNG stream. Running after sales means "news arrives, the market
/// reacts next month": a fired price multiplier shapes the next tick's procurement and exports.
/// </summary>
internal static class EventsStep
{
    public static void Run(TickContext ctx)
    {
        var world = ctx.World;
        world.TickActivePriceEffects();
        EventEngine.RollAndApply(world, world.Catalog.Events, world.Rng);
    }
}
