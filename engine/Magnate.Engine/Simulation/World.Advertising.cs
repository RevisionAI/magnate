using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;

namespace Magnate.Engine.Simulation;

// Advertising campaigns, media-ownership bonuses and brand awareness.
public sealed partial class World
{
    /// <summary>All currently registered ad campaigns (may include zero-budget entries for history).</summary>
    public IEnumerable<AdCampaign> AdCampaigns => _adCampaigns.Values;

    /// <summary>
    /// Register or update an advertising campaign. Passing a budget of 0 removes
    /// the campaign entirely (equivalent to <see cref="CancelAdCampaign"/>).
    /// Each monthly tick the budget is charged and converted to a brand lift in
    /// the target city, subject to saturation.
    /// </summary>
    public AdCampaign RegisterAdCampaign(
        CompanyId company,
        ProductId product,
        CityId city,
        AdChannel channel,
        decimal monthlyBudget)
    {
        RequireCompany(company);
        _ = Catalog.Product(product);
        _ = Catalog.City(city);
        if (monthlyBudget < 0m) throw new ArgumentException("monthlyBudget must be non-negative", nameof(monthlyBudget));

        var key = (company, product, city, channel);
        if (monthlyBudget == 0m)
        {
            _adCampaigns.Remove(key);
            return new AdCampaign(company, product, city, channel, 0m);
        }

        var campaign = new AdCampaign(company, product, city, channel, monthlyBudget);
        _adCampaigns[key] = campaign;
        return campaign;
    }

    /// <summary>Remove a campaign. Returns false when none was registered.</summary>
    public bool CancelAdCampaign(CompanyId company, ProductId product, CityId city, AdChannel channel)
        => _adCampaigns.Remove((company, product, city, channel));

    /// <summary>The registered campaign for (company, product, city, channel), or null.</summary>
    public AdCampaign? GetAdCampaign(CompanyId company, ProductId product, CityId city, AdChannel channel)
        => _adCampaigns.TryGetValue((company, product, city, channel), out var c) ? c : null;

    /// <summary>
    /// Apply one monthly tick of advertising: charge every active campaign, lift
    /// the target (company, product, city)'s brand awareness with diminishing
    /// returns as it approaches 100, then decay brand awareness on any triple
    /// with no active campaign.
    /// </summary>
    internal void ApplyMonthlyAdvertising()
    {
        var activeTriples = new HashSet<(CompanyId, ProductId, CityId)>();

        var campaigns = _adCampaigns.Values
            .Where(c => c.MonthlyBudget > 0m)
            .OrderBy(c => c.Company.Value)
            .ThenBy(c => c.Product.Value, StringComparer.Ordinal)
            .ThenBy(c => c.City.Value, StringComparer.Ordinal)
            .ThenBy(c => (int)c.Channel)
            .ToList();

        foreach (var campaign in campaigns)
        {
            activeTriples.Add((campaign.Company, campaign.Product, campaign.City));

            // AdvertisingCost is (company, product, city)-scoped, not per-building — leave building null.
            RecordCashChange(
                campaign.Company,
                LedgerCategory.AdvertisingCost,
                -campaign.MonthlyBudget,
                $"ad {campaign.Channel.ToString().ToLowerInvariant()} {campaign.Product} in {campaign.City}",
                campaign.Product);

            var costPerPoint = SimulationConstants.AdCostPerPoint(campaign.Channel);
            var current = GetBrandAwareness(campaign.Company, campaign.Product, campaign.City);
            var mediaBonus = GetMediaOwnershipBonus(campaign.Company, campaign.City, campaign.Channel);
            var effectiveBudget = campaign.MonthlyBudget * mediaBonus;
            var pointsAtFull = (double)(effectiveBudget / costPerPoint);
            var saturation = 1.0 - current / 100.0;
            if (saturation < 0) saturation = 0;
            var lift = pointsAtFull * saturation;
            var newBrand = Math.Min(100.0, current + lift);
            _brandAwareness[(campaign.Company, campaign.Product, campaign.City)] = newBrand;
        }

        // Decay brands that didn't have an active campaign this month.
        var keysToDecay = _brandAwareness.Keys
            .Where(k => !activeTriples.Contains((k.Company, k.Product, k.City)))
            .ToList();

        foreach (var key in keysToDecay)
        {
            var decayed = _brandAwareness[key] * (1.0 - SimulationConstants.BrandDecayRate);
            if (decayed < 0.1)
            {
                _brandAwareness.Remove(key);
            }
            else
            {
                _brandAwareness[key] = decayed;
            }
        }
    }

    /// <summary>
    /// Realistic cost of one awareness point in <paramref name="city"/> on
    /// <paramref name="channel"/> (econ-audit §4.20): <c>ChannelK · Pop/1000</c>. Metropolis TV:
    /// $12,500 per point. Under Classic rules the flat per-channel constant.
    /// </summary>
    public decimal GetAdCostPerPoint(CityId city, AdChannel channel)
    {
        if (!Rules.Market.Enabled) return SimulationConstants.AdCostPerPoint(channel);
        var rules = Rules.Market;
        var k = channel switch
        {
            AdChannel.TV => rules.AdCostPerThousandTv,
            AdChannel.Radio => rules.AdCostPerThousandRadio,
            AdChannel.Newspaper => rules.AdCostPerThousandNewspaper,
            AdChannel.Magazine => rules.AdCostPerThousandMagazine,
            _ => rules.AdCostPerThousandNewspaper,
        };
        return k * Catalog.City(city).Population / 1000m;
    }

    /// <summary>
    /// Monthly spend that holds awareness at <paramref name="awareness"/> on one channel
    /// (econ-audit §4.20): <c>d·B*/(1 − B*/100) · CostPerPoint ÷ media bonus</c>. Realistic rules.
    /// </summary>
    public decimal GetSustainBudget(CompanyId company, CityId city, AdChannel channel, double awareness)
    {
        var target = Math.Clamp(awareness, 0, 99.0);
        var points = Rules.Market.BrandDecayRate * target / (1 - target / 100.0);
        var bonus = GetMediaOwnershipBonus(company, city, channel);
        return (decimal)points * GetAdCostPerPoint(city, channel) / bonus;
    }

    /// <summary>
    /// One Realistic month of advertising (econ-audit §4.20, fixes F10): charge every active
    /// campaign, then for every (company, product, city) with awareness or a campaign:
    /// <c>B' = B·(1 − d) + Σ_campaigns (spend·mediaBonus / CostPerPoint)·(1 − B/100)</c>, clamped
    /// to [0, 100]. Decay applies every month, campaign or not; awareness below 0.1 without a
    /// campaign is dropped.
    /// </summary>
    internal void ApplyMonthlyAdvertisingRealistic()
    {
        var campaigns = _adCampaigns.Values
            .Where(c => c.MonthlyBudget > 0m)
            .OrderBy(c => c.Company.Value)
            .ThenBy(c => c.Product.Value, StringComparer.Ordinal)
            .ThenBy(c => c.City.Value, StringComparer.Ordinal)
            .ThenBy(c => (int)c.Channel)
            .ToList();

        var lift = new Dictionary<(CompanyId, ProductId, CityId), double>();
        foreach (var campaign in campaigns)
        {
            RecordCashChange(
                campaign.Company,
                LedgerCategory.AdvertisingCost,
                -campaign.MonthlyBudget,
                $"ad {campaign.Channel.ToString().ToLowerInvariant()} {campaign.Product} in {campaign.City}",
                campaign.Product);

            var bonus = GetMediaOwnershipBonus(campaign.Company, campaign.City, campaign.Channel);
            var points = (double)(campaign.MonthlyBudget * bonus / GetAdCostPerPoint(campaign.City, campaign.Channel));
            var key = (campaign.Company, campaign.Product, campaign.City);
            lift[key] = lift.TryGetValue(key, out var v) ? v + points : points;
        }

        var keys = _brandAwareness.Keys.Concat(lift.Keys).Distinct()
            .OrderBy(k => k.Item1.Value)
            .ThenBy(k => k.Item2.Value, StringComparer.Ordinal)
            .ThenBy(k => k.Item3.Value, StringComparer.Ordinal)
            .ToList();
        var decay = Rules.Market.BrandDecayRate;
        foreach (var key in keys)
        {
            var current = _brandAwareness.TryGetValue(key, out var b) ? b : SimulationConstants.BaseBrandAwareness;
            var hasCampaign = lift.TryGetValue(key, out var points);
            var saturation = Math.Max(0, 1.0 - current / 100.0);
            var next = Math.Clamp(current * (1.0 - decay) + points * saturation, 0, 100);
            if (!hasCampaign && next < 0.1) _brandAwareness.Remove(key);
            else _brandAwareness[key] = next;
        }
    }

    /// <summary>
    /// Brand awareness of (company, product, city) after the next month's advertising step: what
    /// the next tick's sales will see (Realistic rules: decay, then the active campaigns' lift,
    /// exactly as <see cref="ApplyMonthlyAdvertisingRealistic"/> computes it). Under Classic rules
    /// the current awareness. Read-only.
    /// </summary>
    public double GetProjectedBrandAwareness(CompanyId company, ProductId product, CityId city)
    {
        var key = (company, product, city);
        var known = _brandAwareness.TryGetValue(key, out var current);
        if (!Rules.Market.Enabled) return known ? current : SimulationConstants.BaseBrandAwareness;

        // Same campaign order and summation as the tick, so the projection is bit-identical.
        double points = 0;
        var hasCampaign = false;
        foreach (var channel in Enum.GetValues<AdChannel>().OrderBy(c => (int)c))
        {
            if (!_adCampaigns.TryGetValue((company, product, city, channel), out var campaign) || campaign.MonthlyBudget <= 0m) continue;
            var bonus = GetMediaOwnershipBonus(company, city, channel);
            points += (double)(campaign.MonthlyBudget * bonus / GetAdCostPerPoint(city, channel));
            hasCampaign = true;
        }

        if (!known && !hasCampaign) return SimulationConstants.BaseBrandAwareness;
        if (!known) current = SimulationConstants.BaseBrandAwareness;
        var saturation = Math.Max(0, 1.0 - current / 100.0);
        var next = Math.Clamp(current * (1.0 - Rules.Market.BrandDecayRate) + points * saturation, 0, 100);
        return !hasCampaign && next < 0.1 ? SimulationConstants.BaseBrandAwareness : next;
    }

    /// <summary>
    /// Return the media-ownership advertising multiplier for a given company's ad
    /// campaign on <paramref name="channel"/> in <paramref name="city"/>. If the
    /// company owns a matching media building in the same city, their effective ad
    /// budget is multiplied by the channel-appropriate bonus; otherwise the multiplier
    /// is 1.0. Broadcast channels (TV station → TV, radio station → Radio) use
    /// <see cref="SimulationConstants.MediaOwnershipAdBonus"/>. Print channels
    /// (newspaper_publisher → Newspaper, magazine_publisher → Magazine) use
    /// <see cref="SimulationConstants.MediaOwnershipAdBonusPrint"/>.
    /// </summary>
    public decimal GetMediaOwnershipBonus(CompanyId company, CityId city, AdChannel channel)
    {
        string? requiredBuildingType;
        decimal bonus;
        switch (channel)
        {
            case AdChannel.TV:
                requiredBuildingType = "tv_station";
                bonus = SimulationConstants.MediaOwnershipAdBonus;
                break;
            case AdChannel.Radio:
                requiredBuildingType = "radio_station";
                bonus = SimulationConstants.MediaOwnershipAdBonus;
                break;
            case AdChannel.Newspaper:
                requiredBuildingType = "newspaper_publisher";
                bonus = SimulationConstants.MediaOwnershipAdBonusPrint;
                break;
            case AdChannel.Magazine:
                requiredBuildingType = "magazine_publisher";
                bonus = SimulationConstants.MediaOwnershipAdBonusPrint;
                break;
            default:
                return 1.0m;
        }

        foreach (var b in _buildings.Values)
        {
            if (b.Owner != company || b.City != city) continue;
            if (b.TypeId.Value == requiredBuildingType)
            {
                return bonus;
            }
        }
        return 1.0m;
    }

    /// <summary>Brand awareness (0-100) for the given (company, product, city). Defaults to 0.</summary>
    public double GetBrandAwareness(CompanyId company, ProductId product, CityId city)
        => _brandAwareness.TryGetValue((company, product, city), out var b) ? b : SimulationConstants.BaseBrandAwareness;

    /// <summary>
    /// Set brand awareness (0-100). Phase 2.2 uses this for tests and demo scenarios;
    /// Phase 2.5 advertising will grow and decay it naturally.
    /// </summary>
    public void SetBrandAwareness(CompanyId company, ProductId product, CityId city, double value)
    {
        RequireCompany(company);
        _ = Catalog.Product(product);
        _ = Catalog.City(city);
        if (value < 0 || value > 100) throw new ArgumentOutOfRangeException(nameof(value), "brand awareness must be in [0, 100]");
        _brandAwareness[(company, product, city)] = value;
    }
}
