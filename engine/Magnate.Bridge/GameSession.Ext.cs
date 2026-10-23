using System.Collections.Generic;

namespace Magnate.Bridge;

// Extension points (bridge-spec §8): every method an upcoming engine feature needs
// is registered from day one and answers `feature_unavailable {feature}` while its
// flag in InitResult.features is off, so the web client can build (and hide) the UI
// against a stable contract. When the engine lands a feature, the bridge implements
// the method here, flips the flag in GameSession.Features, and adds its events —
// no protocol version bump.
//
// `cityLayout` (§8.1) is deliberately absent: the city-generator workstream registers
// it in GameSession.CityLayout.cs (a second registration would fail handler discovery).
public sealed partial class GameSession
{
    /// <summary>Feature flag names (TS <c>FeatureName</c>).</summary>
    internal static class FeatureNames
    {
        public const string Plots = "plots";
        public const string LandMarket = "landMarket";
        public const string ConstructionTime = "constructionTime";
        public const string Demolish = "demolish";
        public const string Loans = "loans";
        public const string StockMarket = "stockMarket";
        public const string Macro = "macro";
    }

    private static BridgeException Unavailable(string feature)
        => new(BridgeErrorCodes.FeatureUnavailable, "This feature is not available yet.", null, new ErrorDetailsDto(Feature: feature));

    // §8.1–8.3 (plots, land market, construction time) are implemented: parcels, buyLand and
    // sellLand in GameSession.CityLayout.cs, cancelConstruction in GameSession.Buildings.cs.

    // demolishBuilding / sellBuilding (E16) and the §8.4 loan methods are real: GameSession.Loans.cs (E2).

    // ------------------------------------------------------------------ §8.5 stock market

    /// <summary>EXT (stockMarket): quotes for every company.</summary>
    [BridgeMethod("stockMarket")]
    public IReadOnlyList<StockQuoteDto> StockMarket() => throw Unavailable(FeatureNames.StockMarket);

    /// <summary>EXT (stockMarket): shareholders of a company.</summary>
    [BridgeMethod("holdings")]
    public IReadOnlyList<HolderDto> Holdings(HoldingsArgs args) => throw Unavailable(FeatureNames.StockMarket);

    /// <summary>EXT (stockMarket): float the player's company.</summary>
    [BridgeMethod("ipo", Mutates = true)]
    public StockQuoteDto Ipo(IpoArgs args) => throw Unavailable(FeatureNames.StockMarket);

    /// <summary>EXT (stockMarket): issue new shares.</summary>
    [BridgeMethod("issueShares", Mutates = true)]
    public StockQuoteDto IssueShares(IpoArgs args) => throw Unavailable(FeatureNames.StockMarket);

    /// <summary>EXT (stockMarket): buy back shares.</summary>
    [BridgeMethod("buybackShares", Mutates = true)]
    public StockQuoteDto BuybackShares(BuybackArgs args) => throw Unavailable(FeatureNames.StockMarket);

    /// <summary>EXT (stockMarket): trade another company's shares.</summary>
    [BridgeMethod("tradeShares", Mutates = true)]
    public IReadOnlyList<HolderDto> TradeShares(TradeSharesArgs args) => throw Unavailable(FeatureNames.StockMarket);

    /// <summary>EXT (stockMarket): set the quarterly dividend.</summary>
    [BridgeMethod("setDividend", Mutates = true)]
    public StockQuoteDto SetDividend(DividendArgs args) => throw Unavailable(FeatureNames.StockMarket);

    // ------------------------------------------------------------------ §8.6 macro economy

    /// <summary>EXT (macro): the macro economy.</summary>
    [BridgeMethod("macro")]
    public MacroDto Macro() => throw Unavailable(FeatureNames.Macro);
}
