using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Ai;

/// <summary>One discrete move an AI strategy can ask the engine to execute.</summary>
public abstract record AiAction
{
    /// <summary>Apply this action to the world on behalf of <paramref name="actor"/>.</summary>
    public abstract void Execute(World world, CompanyId actor);
}

/// <summary>Construct a retail building and configure its first slot to sell a product.</summary>
public sealed record BuildRetailerAction(
    BuildingTypeId Type,
    CityId City,
    ProductId Product,
    decimal Price,
    double RestockTarget) : AiAction
{
    public override void Execute(World world, CompanyId actor)
    {
        var building = world.Construct(actor, Type, City);
        world.ConfigureRetailSlot(building.Id, 0, Product, Price, RestockTarget);
    }
}

/// <summary>
/// Change the price on an existing retail slot. Silently skips if the building
/// doesn't exist, isn't owned by the actor, or the slot isn't there.
/// </summary>
public sealed record AdjustRetailPriceAction(
    BuildingInstanceId Retailer,
    int SlotIndex,
    decimal NewPrice) : AiAction
{
    public override void Execute(World world, CompanyId actor)
    {
        if (!world.Buildings.TryGetValue(Retailer, out var building)) return;
        if (building.Owner != actor) return;
        var slot = building.RetailSlots.FirstOrDefault(s => s.Index == SlotIndex);
        if (slot is null) return;
        if (NewPrice <= 0m) return;
        slot.Price = NewPrice;
    }
}

/// <summary>
/// Construct an R&amp;D center in the given city and configure its first research
/// slot to target the configured product.
/// </summary>
public sealed record BuildResearchCenterAction(
    CityId City,
    ProductId InitialResearch) : AiAction
{
    public override void Execute(World world, CompanyId actor)
    {
        var rd = world.Construct(actor, new BuildingTypeId("rd_center"), City);
        world.ConfigureResearchSlot(rd.Id, 0, InitialResearch);
    }
}

/// <summary>
/// Register or update an ad campaign. A zero budget cancels the campaign (matches
/// <see cref="World.RegisterAdCampaign"/> semantics).
/// </summary>
public sealed record SetAdCampaignAction(
    ProductId Product,
    CityId City,
    AdChannel Channel,
    decimal MonthlyBudget) : AiAction
{
    public override void Execute(World world, CompanyId actor)
    {
        world.RegisterAdCampaign(actor, Product, City, Channel, MonthlyBudget);
    }
}

/// <summary>
/// Set the price of every retail slot of <paramref name="Retailer"/> that sells
/// <paramref name="Product"/> (a store line, econ-audit §4.1: all slots of a product share one
/// price). Silently skips a building the actor does not own.
/// </summary>
public sealed record SetLinePriceAction(
    BuildingInstanceId Retailer,
    ProductId Product,
    decimal NewPrice) : AiAction
{
    /// <inheritdoc/>
    public override void Execute(World world, CompanyId actor)
    {
        if (!world.Buildings.TryGetValue(Retailer, out var building) || building.Owner != actor) return;
        if (NewPrice <= 0m) return;
        foreach (var slot in building.RetailSlots.Where(s => s.Product == Product).OrderBy(s => s.Index).ToList())
        {
            world.SetRetailPrice(Retailer, slot.Index, NewPrice);
        }
    }
}

/// <summary>
/// Set the restock target of a store line: <paramref name="Target"/> units split evenly across
/// the building's slots for <paramref name="Product"/>. Silently skips a building the actor does
/// not own or a non-positive target.
/// </summary>
public sealed record SetLineRestockAction(
    BuildingInstanceId Retailer,
    ProductId Product,
    double Target) : AiAction
{
    /// <inheritdoc/>
    public override void Execute(World world, CompanyId actor)
    {
        if (!world.Buildings.TryGetValue(Retailer, out var building) || building.Owner != actor) return;
        if (!(Target > 0) || !double.IsFinite(Target)) return;
        var slots = building.RetailSlots.Where(s => s.Product == Product).OrderBy(s => s.Index).ToList();
        if (slots.Count == 0) return;
        var perSlot = Target / slots.Count;
        foreach (var slot in slots) world.SetRestockTarget(Retailer, slot.Index, perSlot);
    }
}

/// <summary>Switch auto-export of one of the actor's buildings on or off.</summary>
public sealed record SetAutoExportAction(BuildingInstanceId Building, bool AutoExport) : AiAction
{
    /// <inheritdoc/>
    public override void Execute(World world, CompanyId actor)
    {
        if (!world.Buildings.TryGetValue(Building, out var building) || building.Owner != actor) return;
        world.SetAutoExport(Building, AutoExport);
    }
}

/// <summary>
/// Construct a retail building of <paramref name="Type"/> and configure its first slot, with the
/// market defaults of the current rules applied (Realistic: auto-export off, a store format that
/// sells the product).
/// </summary>
public sealed record BuildStoreAction(
    BuildingTypeId Type,
    CityId City,
    ProductId Product,
    decimal Price,
    double RestockTarget) : AiAction
{
    /// <inheritdoc/>
    public override void Execute(World world, CompanyId actor)
    {
        var building = world.Construct(actor, Type, City);
        world.ApplyMarketDefaults(building);
        world.ValidateRetailProduct(building, Product);
        world.ConfigureRetailSlot(building.Id, 0, Product, Price, RestockTarget);
    }
}

/// <summary>
/// Construct a factory or extractor, apply the current rules' market defaults (Realistic:
/// auto-export off until the strategy decides) and configure its first slot.
/// </summary>
public sealed record BuildPlantAction(
    BuildingTypeId Type,
    CityId City,
    ProductId Product,
    bool IsExtraction) : AiAction
{
    /// <inheritdoc/>
    public override void Execute(World world, CompanyId actor)
    {
        var building = world.Construct(actor, Type, City);
        world.ApplyMarketDefaults(building);
        if (IsExtraction) world.ConfigureExtractionSlot(building.Id, 0, Product);
        else world.ConfigureProductionSlot(building.Id, 0, Product);
    }
}
