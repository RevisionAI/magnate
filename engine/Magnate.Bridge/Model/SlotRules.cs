using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>Slot kinds (TS <c>SlotKind</c>).</summary>
internal static class SlotKinds
{
    public const string Production = "production";
    public const string Extraction = "extraction";
    public const string Retail = "retail";
    public const string Warehouse = "warehouse";
    public const string Research = "research";
    public const string None = "none";
}

/// <summary>A configured slot of any kind, flattened.</summary>
internal readonly record struct SlotRef(int Index, string Kind, ProductId Product);

/// <summary>
/// The single source for "what can this building do" (bridge-spec §4.6.4): the
/// slot kind of a building type, the products eligible for it, and the
/// validation order shared by <c>configureSlot</c> and <c>construct.initialSlot</c>.
/// Built once per catalog.
/// </summary>
internal sealed class SlotRules
{
    /// <summary>Categories the engine accepts warehouse slots on (World.ConfigureWarehouseSlot).</summary>
    public static readonly HashSet<string> WarehouseCategories =
        new(StringComparer.Ordinal) { "warehouse", "distribution_center", "seaport", "freight_yard" };

    private readonly ContentCatalog _catalog;
    private readonly Dictionary<BuildingTypeId, string> _kinds = new();
    private readonly Dictionary<BuildingTypeId, IReadOnlyList<string>> _eligible = new();

    /// <summary>Products in catalog presentation order (tier, then id).</summary>
    public IReadOnlyList<Product> OrderedProducts { get; }

    public SlotRules(ContentCatalog catalog)
    {
        _catalog = catalog;
        OrderedProducts = catalog.Products.Values
            .OrderBy(p => p.Tier)
            .ThenBy(p => p.Id.Value, StringComparer.Ordinal)
            .ToList();

        var extractionCategories = new HashSet<string>(
            catalog.Products.Values.Where(p => p.Tier == ProductTier.Raw && p.Extraction is not null)
                .Select(p => p.Extraction!.SourceCategory),
            StringComparer.Ordinal);

        foreach (var type in catalog.BuildingTypes.Values)
        {
            var kind = extractionCategories.Contains(type.Category) ? SlotKinds.Extraction
                : type.Retail ? SlotKinds.Retail
                : WarehouseCategories.Contains(type.Category) ? SlotKinds.Warehouse
                : type.Category == "rd_center" ? SlotKinds.Research
                : type.ProducibleTiers.Any(t => t is ProductTier.Intermediate or ProductTier.Finished) ? SlotKinds.Production
                : SlotKinds.None;
            _kinds[type.Id] = kind;
            _eligible[type.Id] = OrderedProducts
                .Where(p => IneligibilityReason(type, kind, p) is null && kind != SlotKinds.None)
                .Select(p => p.Id.Value)
                .ToList();
        }
    }

    public string KindOf(BuildingTypeId type) => _kinds.TryGetValue(type, out var k) ? k : SlotKinds.None;

    public string KindOf(BuildingInstance building) => KindOf(building.TypeId);

    public IReadOnlyList<string> Eligible(BuildingTypeId type)
        => _eligible.TryGetValue(type, out var list) ? list : Array.Empty<string>();

    /// <summary>
    /// Why <paramref name="product"/> may not go in a slot of <paramref name="type"/>
    /// (null = allowed). Retail is stricter than the engine (finished goods only, E7).
    /// </summary>
    public static string? IneligibilityReason(BuildingType type, string kind, Product product) => kind switch
    {
        SlotKinds.Retail => product.Tier == ProductTier.Finished ? null : "notFinished",
        SlotKinds.Extraction => product.Tier != ProductTier.Raw ? "notRaw"
            : product.Extraction is null ? "noExtraction"
            : !string.Equals(product.Extraction.SourceCategory, type.Category, StringComparison.Ordinal) ? "wrongSourceCategory"
            : null,
        SlotKinds.Production => product.Recipe is null ? "noRecipe"
            : !type.ProducibleTiers.Contains(product.Tier) ? "tierNotProducible"
            : null,
        SlotKinds.Warehouse or SlotKinds.Research => null,
        _ => "slotKindUnsupported",
    };

    /// <summary>Every configured slot of a building, ordered by index.</summary>
    public static List<SlotRef> Slots(BuildingInstance b)
    {
        var list = new List<SlotRef>(
            b.ProductionSlots.Count + b.ExtractionSlots.Count + b.RetailSlots.Count + b.WarehouseSlots.Count + b.ResearchSlots.Count);
        foreach (var s in b.ProductionSlots) list.Add(new SlotRef(s.Index, SlotKinds.Production, s.Product));
        foreach (var s in b.ExtractionSlots) list.Add(new SlotRef(s.Index, SlotKinds.Extraction, s.Product));
        foreach (var s in b.RetailSlots) list.Add(new SlotRef(s.Index, SlotKinds.Retail, s.Product));
        foreach (var s in b.WarehouseSlots) list.Add(new SlotRef(s.Index, SlotKinds.Warehouse, s.Product));
        foreach (var s in b.ResearchSlots) list.Add(new SlotRef(s.Index, SlotKinds.Research, s.Product));
        list.Sort((x, y) => x.Index != y.Index ? x.Index.CompareTo(y.Index) : string.CompareOrdinal(x.Kind, y.Kind));
        return list;
    }

    /// <summary>Number of configured slots.</summary>
    public static int ConfiguredCount(BuildingInstance b)
        => b.ProductionSlots.Count + b.ExtractionSlots.Count + b.RetailSlots.Count + b.WarehouseSlots.Count + b.ResearchSlots.Count;

    /// <summary>Distinct slot products in slot-index order (signage).</summary>
    public static List<string> Products(BuildingInstance b)
    {
        var result = new List<string>();
        foreach (var slot in Slots(b))
        {
            if (!result.Contains(slot.Product.Value)) result.Add(slot.Product.Value);
        }
        return result;
    }

    /// <summary>Lowest unconfigured index below capacity, or −1 when full.</summary>
    public static int NextFreeIndex(BuildingInstance b, int capacity)
    {
        var used = new HashSet<int>(Slots(b).Select(s => s.Index));
        for (var i = 0; i < capacity; i++)
        {
            if (!used.Contains(i)) return i;
        }
        return -1;
    }

    /// <summary>The product configured at <paramref name="index"/> (any kind), if any.</summary>
    public static SlotRef? At(BuildingInstance b, int index)
    {
        foreach (var s in Slots(b))
        {
            if (s.Index == index) return s;
        }
        return null;
    }

    /// <summary>Level-1 capacity of a type (what a freshly built building offers).</summary>
    public static int InitialCapacity(BuildingType type)
        => type.Levels is { Count: > 0 } levels ? levels[0].Capacity : type.MaxUnits;

    /// <summary>Building status for visuals and lists (E10/EXT statuses are reserved).</summary>
    public static string Status(string kind, BuildingInstance b)
        => kind == SlotKinds.None ? "passive" : ConfiguredCount(b) == 0 ? "idle" : "operating";

    /// <summary>The catalog this instance was built for.</summary>
    public ContentCatalog Catalog => _catalog;
}
