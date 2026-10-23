using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// Typed context attached to an error envelope (bridge-spec §5.0). Every field is
/// optional and omitted when null; the client renders the message from
/// <c>code</c> + these details rather than from the English fallback text.
/// </summary>
public sealed record ErrorDetailsDto(
    decimal? Required = null,
    decimal? Available = null,
    decimal? Shortfall = null,
    int? SlotIndex = null,
    int? Capacity = null,
    int? Level = null,
    int? MaxLevel = null,
    string? EntityKind = null,
    string? EntityId = null,
    string? ProductId = null,
    string? Reason = null,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? Min = null,
    [property: JsonConverter(typeof(Money4ConverterFactory))] decimal? Max = null,
    IReadOnlyList<string>? Missing = null,
    string? Feature = null,
    int? SchemaVersion = null,
    int? MinSchemaVersion = null,
    int? MaxSchemaVersion = null,
    string? DevMessage = null);

/// <summary>Values of <see cref="ErrorDetailsDto.EntityKind"/> (TS <c>EntityKind</c>).</summary>
public static class EntityKinds
{
    /// <summary>A scenario id.</summary>
    public const string Scenario = "scenario";
    /// <summary>A city id.</summary>
    public const string City = "city";
    /// <summary>A product id.</summary>
    public const string Product = "product";
    /// <summary>A building type id.</summary>
    public const string BuildingType = "buildingType";
    /// <summary>A building instance id.</summary>
    public const string Building = "building";
    /// <summary>A company id.</summary>
    public const string Company = "company";
    /// <summary>A goal id.</summary>
    public const string Goal = "goal";
    /// <summary>A starter plan id.</summary>
    public const string StarterPlan = "starterPlan";
    /// <summary>A save slot.</summary>
    public const string Save = "save";
    /// <summary>An AI strategy name.</summary>
    public const string Strategy = "strategy";
    /// <summary>EXT: a land parcel.</summary>
    public const string Parcel = "parcel";
    /// <summary>EXT: a loan.</summary>
    public const string Loan = "loan";
}

/// <summary>
/// Pre-validation helpers. Handlers validate every argument through these
/// <em>before</em> touching the engine, so engine exceptions (whose text is
/// culture-less in the browser build) are the exception, not the rule.
/// Every failure is a <see cref="BridgeException"/> with a stable code, a
/// facade-written English message and the offending <c>field</c>.
/// </summary>
internal static class Guard
{
    /// <summary>Upper bound accepted for any retail price (a sanity cap, not price policy).</summary>
    public const decimal MaxPrice = 1_000_000_000m;

    /// <summary>Upper bound accepted for restock / warehouse targets.</summary>
    public const double MaxQuantity = 100_000_000d;

    /// <summary>Upper bound accepted for a monthly ad budget.</summary>
    public const decimal MaxAdBudget = 100_000_000m;

    /// <summary>A required string argument (non-blank).</summary>
    public static string Required(string? value, string field)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new BridgeException(BridgeErrorCodes.BadRequest, $"'{field}' is required.", field);
        }
        return value;
    }

    /// <summary>A required object argument.</summary>
    public static T Required<T>(T? value, string field) where T : class
        => value ?? throw new BridgeException(BridgeErrorCodes.BadRequest, $"'{field}' is required.", field);

    /// <summary>
    /// A positive money amount, rounded half-even to <paramref name="decimals"/>
    /// places, in <c>(0, max]</c>.
    /// </summary>
    public static decimal PositiveMoney(decimal value, decimal max, string field, int decimals = 2)
    {
        var rounded = Math.Round(value, decimals, MidpointRounding.ToEven);
        if (rounded <= 0m || rounded > max)
        {
            throw new BridgeException(
                BridgeErrorCodes.InvalidArgument,
                $"'{field}' must be greater than 0 and at most {GameSession.Money(max)}.",
                field,
                new ErrorDetailsDto(Min: 0m, Max: max));
        }
        return rounded;
    }

    /// <summary>A non-negative money amount, rounded half-even to 2 dp, in <c>[0, max]</c>.</summary>
    public static decimal NonNegativeMoney(decimal value, decimal max, string field)
    {
        var rounded = Math.Round(value, 2, MidpointRounding.ToEven);
        if (rounded < 0m || rounded > max)
        {
            throw new BridgeException(
                BridgeErrorCodes.InvalidArgument,
                $"'{field}' must be between $0 and {GameSession.Money(max)}.",
                field,
                new ErrorDetailsDto(Min: 0m, Max: max));
        }
        return rounded;
    }

    /// <summary>A finite positive quantity in <c>(0, max]</c>.</summary>
    public static double PositiveQuantity(double value, double max, string field)
    {
        if (!double.IsFinite(value) || value <= 0 || value > max)
        {
            throw new BridgeException(
                BridgeErrorCodes.InvalidArgument,
                $"'{field}' must be greater than 0 and at most {max:N0}.",
                field,
                new ErrorDetailsDto(Min: 0m, Max: (decimal)max));
        }
        return value;
    }

    /// <summary>A month (1–12) inside a <see cref="DateDto"/>.</summary>
    public static GameDate Date(DateDto? date, string field)
    {
        if (date is null) throw new BridgeException(BridgeErrorCodes.BadRequest, $"'{field}' is required.", field);
        if (date.Month < 1 || date.Month > 12 || date.Year < 1 || date.Year > 9999)
        {
            throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"'{field}' is not a valid month.", field);
        }
        return new GameDate(date.Year, date.Month);
    }

    /// <summary>Resolve a product id or fail with <c>not_found {entityKind:'product'}</c>.</summary>
    public static Product Product(ContentCatalog catalog, string? id, string field = "productId")
    {
        var value = Required(id, field);
        if (!catalog.Products.TryGetValue(new ProductId(value), out var product))
        {
            throw NotFound(EntityKinds.Product, value, field, $"Unknown product '{value}'.");
        }
        return product;
    }

    /// <summary>Resolve a city id or fail with <c>not_found {entityKind:'city'}</c>.</summary>
    public static City City(ContentCatalog catalog, string? id, string field = "cityId")
    {
        var value = Required(id, field);
        if (!catalog.Cities.TryGetValue(new CityId(value), out var city))
        {
            throw NotFound(EntityKinds.City, value, field, $"Unknown city '{value}'.");
        }
        return city;
    }

    /// <summary>Resolve a building type id or fail with <c>not_found {entityKind:'buildingType'}</c>.</summary>
    public static BuildingType BuildingType(ContentCatalog catalog, string? id, string field = "typeId")
    {
        var value = Required(id, field);
        if (!catalog.BuildingTypes.TryGetValue(new BuildingTypeId(value), out var type))
        {
            throw NotFound(EntityKinds.BuildingType, value, field, $"Unknown building type '{value}'.");
        }
        return type;
    }

    /// <summary>Resolve a building id or fail with <c>not_found {entityKind:'building'}</c>.</summary>
    public static BuildingInstance Building(World world, int id, string field = "buildingId")
    {
        if (!world.Buildings.TryGetValue(new BuildingInstanceId(id), out var building))
        {
            throw NotFound(EntityKinds.Building, id.ToString(System.Globalization.CultureInfo.InvariantCulture), field,
                $"There is no building #{id}.");
        }
        return building;
    }

    /// <summary>Resolve a building the player owns: <c>not_found</c>, then <c>not_owner</c>.</summary>
    public static BuildingInstance OwnedBuilding(World world, CompanyId player, int id, string field = "buildingId")
    {
        var building = Building(world, id, field);
        if (building.Owner != player)
        {
            throw new BridgeException(
                BridgeErrorCodes.NotOwner,
                $"Building #{id} belongs to another company.",
                field,
                new ErrorDetailsDto(EntityKind: EntityKinds.Building, EntityId: id.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
        return building;
    }

    /// <summary>Resolve a company id or fail with <c>not_found {entityKind:'company'}</c>.</summary>
    public static Company Company(World world, int id, string field = "companyId")
    {
        if (!world.Companies.TryGetValue(new CompanyId(id), out var company))
        {
            throw NotFound(EntityKinds.Company, id.ToString(System.Globalization.CultureInfo.InvariantCulture), field,
                $"There is no company #{id}.");
        }
        return company;
    }

    /// <summary>A <c>not_found</c> error with entity context.</summary>
    public static BridgeException NotFound(string entityKind, string entityId, string? field, string message)
        => new(BridgeErrorCodes.NotFound, message, field, new ErrorDetailsDto(EntityKind: entityKind, EntityId: entityId));

    /// <summary>An <c>insufficient_funds</c> error for a cost the company cannot cover.</summary>
    public static BridgeException InsufficientFunds(decimal required, decimal available, string what)
        => new(
            BridgeErrorCodes.InsufficientFunds,
            $"Not enough cash for {what}: it costs {GameSession.Money(required)} and you have {GameSession.Money(available)}.",
            null,
            new ErrorDetailsDto(Required: required, Available: available, Shortfall: required - available));
}
