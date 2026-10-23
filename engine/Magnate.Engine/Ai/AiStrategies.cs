using System;
using System.Collections.Generic;
using System.Globalization;
using Magnate.Engine.Domain;

namespace Magnate.Engine.Ai;

/// <summary>
/// The single registry of AI strategy names (bridge-spec E2). Scenario JSON, save files, the
/// bridge and tools all name strategies through it, so the name ↔ type mapping and every
/// strategy's persisted tunables live in one place.
/// <list type="table">
///   <item><term><c>simple</c> (alias <c>retailer</c>)</term><description><see cref="SimpleRetailerStrategy"/></description></item>
///   <item><term><c>adaptive</c></term><description><see cref="AdaptiveStrategy"/></description></item>
///   <item><term><c>verticalIntegrator</c> (alias <c>vertical</c>)</term><description><see cref="VerticalIntegrator"/></description></item>
///   <item><term><c>techLeader</c> (alias <c>tech</c>)</term><description><see cref="TechLeader"/></description></item>
/// </list>
/// Names are matched case-insensitively. Configs are flat invariant-culture string maps (the
/// save format since schema v3); missing keys fall back to the strategy's defaults.
/// </summary>
public static class AiStrategies
{
    /// <summary>Canonical name of <see cref="SimpleRetailerStrategy"/>.</summary>
    public const string Simple = "simple";

    /// <summary>Canonical name of <see cref="AdaptiveStrategy"/>.</summary>
    public const string Adaptive = "adaptive";

    /// <summary>Canonical name of <see cref="VerticalIntegrator"/>.</summary>
    public const string VerticalIntegratorName = "verticalIntegrator";

    /// <summary>Canonical name of <see cref="TechLeader"/>.</summary>
    public const string TechLeaderName = "techLeader";

    /// <summary>Canonical names, in a stable order.</summary>
    public static IReadOnlyList<string> Names { get; } = new[] { Simple, Adaptive, VerticalIntegratorName, TechLeaderName };

    /// <summary>
    /// Create a strategy by (canonical or alias) name. A null or empty
    /// <paramref name="config"/> yields the strategy's default tunables.
    /// </summary>
    /// <exception cref="ArgumentException">Unknown strategy name.</exception>
    /// <exception cref="FormatException">A config value does not parse.</exception>
    public static IAiStrategy Create(string name, IReadOnlyDictionary<string, string>? config = null)
        => TryCreate(name, config, out var strategy)
            ? strategy
            : throw new ArgumentException($"unknown AI strategy '{name}' (known: {string.Join(", ", Names)})", nameof(name));

    /// <summary>Like <see cref="Create"/> but returns false for an unknown name.</summary>
    /// <exception cref="FormatException">A config value does not parse.</exception>
    public static bool TryCreate(string name, IReadOnlyDictionary<string, string>? config, out IAiStrategy strategy)
    {
        ArgumentNullException.ThrowIfNull(name);
        IAiStrategy? created = name.Trim().ToLowerInvariant() switch
        {
            "simple" or "retailer" => BuildSimple(config),
            "adaptive" => BuildAdaptive(config),
            "verticalintegrator" or "vertical" => BuildVerticalIntegrator(config),
            "techleader" or "tech" => BuildTechLeader(config),
            _ => null,
        };

        strategy = created!;
        return created is not null;
    }

    /// <summary>Canonical name of a strategy instance.</summary>
    /// <exception cref="ArgumentException">The strategy type is not registered.</exception>
    public static string NameOf(IAiStrategy strategy)
        => TryGetName(strategy, out var name)
            ? name
            : throw new ArgumentException($"strategy type {strategy.GetType().Name} is not registered", nameof(strategy));

    /// <summary>Canonical name of a strategy instance; false when its type is not registered.</summary>
    public static bool TryGetName(IAiStrategy strategy, out string name)
    {
        ArgumentNullException.ThrowIfNull(strategy);
        string? resolved = strategy switch
        {
            SimpleRetailerStrategy => Simple,
            AdaptiveStrategy => Adaptive,
            VerticalIntegrator => VerticalIntegratorName,
            TechLeader => TechLeaderName,
            _ => null,
        };
        name = resolved ?? string.Empty;
        return resolved is not null;
    }

    /// <summary>
    /// The strategy's tunables as an invariant-culture string map (ordinal keys), or null for a
    /// strategy at its defaults that has nothing worth persisting.
    /// </summary>
    public static IReadOnlyDictionary<string, string>? ConfigOf(IAiStrategy strategy)
    {
        ArgumentNullException.ThrowIfNull(strategy);
        return strategy switch
        {
            SimpleRetailerStrategy s => IsDefault(s) ? null : new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["soloMarkup"] = Format(s.SoloMarkup),
                ["undercutFactor"] = Format(s.UndercutFactor),
                ["cushionMonths"] = Format(s.CushionMonths),
                ["retailerTypeId"] = s.RetailerTypeId.Value,
            },
            AdaptiveStrategy a => new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["adBudgetPerCity"] = Format(a.AdBudgetPerCity),
                ["cushionMonths"] = Format(a.CushionMonths),
                ["priceUndercut"] = Format(a.PriceUndercut),
                ["soloMarkup"] = Format(a.SoloMarkup),
                ["priceFloorMultiplier"] = Format(a.PriceFloorMultiplier),
                ["minCashForAdsMultiplier"] = Format(a.MinCashForAdsMultiplier),
            },
            VerticalIntegrator vi => new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["cushionMonths"] = Format(vi.CushionMonths),
                ["priceUndercut"] = Format(vi.PriceUndercut),
                ["soloMarkup"] = Format(vi.SoloMarkup),
                ["priceFloorMultiplier"] = Format(vi.PriceFloorMultiplier),
                ["adBudgetPerCity"] = Format(vi.AdBudgetPerCity),
            },
            TechLeader t => new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["rdCentersTarget"] = Format(t.RdCentersTarget),
                ["maxRetailersPerCity"] = Format(t.MaxRetailersPerCity),
                ["maxCities"] = Format(t.MaxCities),
                ["premiumMultiplier"] = Format(t.PremiumMultiplier),
                ["priceFloorMultiplier"] = Format(t.PriceFloorMultiplier),
                ["adBudgetPerCityHero"] = Format(t.AdBudgetPerCityHero),
                ["minHighBracketShare"] = Format(t.MinHighBracketShare),
            },
            _ => throw new ArgumentException($"strategy type {strategy.GetType().Name} is not registered", nameof(strategy)),
        };
    }

    // ------------------------------------------------------------------ builders

    private static SimpleRetailerStrategy BuildSimple(IReadOnlyDictionary<string, string>? config)
    {
        if (config is null || config.Count == 0) return new SimpleRetailerStrategy();
        var d = new SimpleRetailerStrategy();
        return new SimpleRetailerStrategy(
            soloMarkup: ReadDecimal(config, "soloMarkup", d.SoloMarkup),
            undercutFactor: ReadDecimal(config, "undercutFactor", d.UndercutFactor),
            cushionMonths: ReadInt(config, "cushionMonths", d.CushionMonths),
            retailerTypeId: config.TryGetValue("retailerTypeId", out var type) ? type : d.RetailerTypeId.Value);
    }

    private static AdaptiveStrategy BuildAdaptive(IReadOnlyDictionary<string, string>? config)
    {
        if (config is null || config.Count == 0) return new AdaptiveStrategy();

        // Use the default-ctor values as fallbacks for any missing keys so a
        // partial config (e.g. written by a future tool) still loads cleanly.
        var d = new AdaptiveStrategy();
        return new AdaptiveStrategy(
            adBudgetPerCity: ReadDecimal(config, "adBudgetPerCity", d.AdBudgetPerCity),
            cushionMonths: ReadInt(config, "cushionMonths", d.CushionMonths),
            priceUndercut: ReadDecimal(config, "priceUndercut", d.PriceUndercut),
            soloMarkup: ReadDecimal(config, "soloMarkup", d.SoloMarkup),
            priceFloorMultiplier: ReadDecimal(config, "priceFloorMultiplier", d.PriceFloorMultiplier),
            minCashForAdsMultiplier: ReadInt(config, "minCashForAdsMultiplier", d.MinCashForAdsMultiplier));
    }

    private static VerticalIntegrator BuildVerticalIntegrator(IReadOnlyDictionary<string, string>? config)
    {
        if (config is null || config.Count == 0) return new VerticalIntegrator();
        var d = new VerticalIntegrator();
        return new VerticalIntegrator(
            cushionMonths: ReadInt(config, "cushionMonths", d.CushionMonths),
            priceUndercut: ReadDecimal(config, "priceUndercut", d.PriceUndercut),
            soloMarkup: ReadDecimal(config, "soloMarkup", d.SoloMarkup),
            priceFloorMultiplier: ReadDecimal(config, "priceFloorMultiplier", d.PriceFloorMultiplier),
            adBudgetPerCity: ReadDecimal(config, "adBudgetPerCity", d.AdBudgetPerCity));
    }

    private static TechLeader BuildTechLeader(IReadOnlyDictionary<string, string>? config)
    {
        if (config is null || config.Count == 0) return new TechLeader();
        var d = new TechLeader();
        return new TechLeader(
            rdCentersTarget: ReadInt(config, "rdCentersTarget", d.RdCentersTarget),
            maxRetailersPerCity: ReadInt(config, "maxRetailersPerCity", d.MaxRetailersPerCity),
            maxCities: ReadInt(config, "maxCities", d.MaxCities),
            premiumMultiplier: ReadDecimal(config, "premiumMultiplier", d.PremiumMultiplier),
            priceFloorMultiplier: ReadDecimal(config, "priceFloorMultiplier", d.PriceFloorMultiplier),
            adBudgetPerCityHero: ReadDecimal(config, "adBudgetPerCityHero", d.AdBudgetPerCityHero),
            minHighBracketShare: ReadDouble(config, "minHighBracketShare", d.MinHighBracketShare));
    }

    private static bool IsDefault(SimpleRetailerStrategy s)
    {
        var d = new SimpleRetailerStrategy();
        return s.SoloMarkup == d.SoloMarkup
            && s.UndercutFactor == d.UndercutFactor
            && s.CushionMonths == d.CushionMonths
            && s.RetailerTypeId == d.RetailerTypeId;
    }

    private static string Format(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Format(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Format(double value) => value.ToString(CultureInfo.InvariantCulture);

    private static double ReadDouble(IReadOnlyDictionary<string, string> config, string key, double fallback)
        => config.TryGetValue(key, out var raw) ? double.Parse(raw, CultureInfo.InvariantCulture) : fallback;

    private static decimal ReadDecimal(IReadOnlyDictionary<string, string> config, string key, decimal fallback)
        => config.TryGetValue(key, out var raw) ? decimal.Parse(raw, CultureInfo.InvariantCulture) : fallback;

    private static int ReadInt(IReadOnlyDictionary<string, string> config, string key, int fallback)
        => config.TryGetValue(key, out var raw) ? int.Parse(raw, CultureInfo.InvariantCulture) : fallback;
}
