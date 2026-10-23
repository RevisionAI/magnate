using System;

namespace Magnate.Bridge;

/// <summary>
/// A failure the client should present to the player (or handle in code) rather
/// than treat as a crash. <see cref="Code"/> is a stable machine-readable token
/// (snake_case) the TypeScript side can switch on; <see cref="Field"/> names the
/// offending argument and <see cref="Details"/> carries typed context so the
/// client can write its own words (bridge-spec §4.7).
/// </summary>
/// <remarks>
/// The two-argument form <c>new BridgeException(code, message)</c> is kept
/// source-compatible with the skeleton (other partials use it).
/// </remarks>
public sealed class BridgeException : Exception
{
    /// <summary>Stable error code, e.g. <c>no_game</c>, <c>unknown_method</c>, <c>insufficient_funds</c>.</summary>
    public string Code { get; }

    /// <summary>The offending argument path (<c>"price"</c>, <c>"at.px"</c>), when one argument is to blame.</summary>
    public string? Field { get; }

    /// <summary>Typed context for the client (amounts, ids, reasons). Null when the code says it all.</summary>
    public ErrorDetailsDto? Details { get; }

    /// <summary>Create an error with a stable code, a facade-written English message and optional context.</summary>
    public BridgeException(string code, string message, string? field = null, ErrorDetailsDto? details = null)
        : base(message)
    {
        Code = code;
        Field = field;
        Details = details;
    }
}

/// <summary>Standard error codes shared with the TypeScript client (<c>web/src/bridge/protocol.ts</c>).</summary>
public static class BridgeErrorCodes
{
    /// <summary>The method name is not registered.</summary>
    public const string UnknownMethod = "unknown_method";
    /// <summary>Arguments were missing or malformed.</summary>
    public const string BadRequest = "bad_request";
    /// <summary>A game-dependent method was called before <c>newGame</c> / <c>loadGame</c>.</summary>
    public const string NoGame = "no_game";
    /// <summary><c>init</c> has not completed.</summary>
    public const string NotInitialized = "not_initialized";
    /// <summary>An entity id (building, company, product, city, scenario) does not exist.</summary>
    public const string NotFound = "not_found";
    /// <summary>The engine rejected an argument value.</summary>
    public const string InvalidArgument = "invalid_argument";
    /// <summary>The engine rejected the operation in the current state.</summary>
    public const string InvalidOperation = "invalid_operation";
    /// <summary>Unexpected failure — a bug.</summary>
    public const string Internal = "internal";

    /// <summary>The player cannot afford the command (details: required, available, shortfall).</summary>
    public const string InsufficientFunds = "insufficient_funds";
    /// <summary>A player command targets a building or patent the player does not own.</summary>
    public const string NotOwner = "not_owner";
    /// <summary>The slot index is outside <c>[0, capacity)</c>.</summary>
    public const string SlotOutOfRange = "slot_out_of_range";
    /// <summary>The building type has no configurable slot (media stations).</summary>
    public const string SlotKindUnsupported = "slot_kind_unsupported";
    /// <summary>A slot command addressed an unconfigured index, or a slot of another kind.</summary>
    public const string SlotEmpty = "slot_empty";
    /// <summary>The product is not eligible for the slot (details: productId, reason).</summary>
    public const string ProductNotAllowed = "product_not_allowed";
    /// <summary>The city does not meet the building type's geography requirement.</summary>
    public const string GeographyMismatch = "geography_mismatch";
    /// <summary>The building type has no upgrade ladder.</summary>
    public const string NotUpgradeable = "not_upgradeable";
    /// <summary>The building is already at its top level.</summary>
    public const string MaxLevel = "max_level";
    /// <summary>The patent exists but is no longer active.</summary>
    public const string PatentNotActive = "patent_not_active";
    /// <summary>A company tried to license its own patent to itself.</summary>
    public const string PatentSelfLicense = "patent_self_license";
    /// <summary>The player holds no active patent on the product.</summary>
    public const string NotPatentHolder = "not_patent_holder";
    /// <summary>A period's start is after its end.</summary>
    public const string InvalidPeriod = "invalid_period";
    /// <summary>The save is not gzip/JSON or misses required fields.</summary>
    public const string SaveCorrupt = "save_corrupt";
    /// <summary>The save's engine schema or web format version is out of range.</summary>
    public const string SaveVersionUnsupported = "save_version_unsupported";
    /// <summary>The save references content ids missing from the loaded catalog.</summary>
    public const string SaveContentMismatch = "save_content_mismatch";
    /// <summary><c>World.AdvanceMonth</c> threw; the session is faulted until load/new game.</summary>
    public const string TickFailed = "tick_failed";
    /// <summary>An extension method or argument was used while its feature flag is off.</summary>
    public const string FeatureUnavailable = "feature_unavailable";
    /// <summary>The requested plot is already taken (by a building or a road).</summary>
    public const string PlotOccupied = "plot_occupied";
    /// <summary>The requested plot (with the footprint) leaves the city grid.</summary>
    public const string PlotOutOfBounds = "plot_out_of_bounds";

    // Reserved for extension features (bridge-spec §8); raised once their flags turn on.
    /// <summary>EXT (plots): the parcel's zone forbids the building type.</summary>
    public const string ZoningForbidden = "zoning_forbidden";
    /// <summary>EXT (landMarket): the player does not own the parcel.</summary>
    public const string ParcelNotOwned = "parcel_not_owned";
    /// <summary>EXT (landMarket): the parcel is not for sale.</summary>
    public const string ParcelNotForSale = "parcel_not_for_sale";
    /// <summary>EXT (constructionTime): the building is still under construction.</summary>
    public const string UnderConstruction = "under_construction";
    /// <summary>EXT (loans): the loan would exceed the credit limit.</summary>
    public const string CreditLimitExceeded = "credit_limit_exceeded";
    /// <summary>EXT (loans): unknown loan id.</summary>
    public const string LoanNotFound = "loan_not_found";
    /// <summary>EXT (stockMarket): the company is not listed.</summary>
    public const string NotListed = "not_listed";
    /// <summary>EXT (stockMarket): the company is already listed.</summary>
    public const string AlreadyListed = "already_listed";
    /// <summary>EXT (stockMarket): not enough shares for the trade.</summary>
    public const string InsufficientShares = "insufficient_shares";
    /// <summary>EXT (stockMarket): the takeover is blocked.</summary>
    public const string TakeoverBlocked = "takeover_blocked";
}
