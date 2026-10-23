using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Advertising (bridge-spec §5.6). Projections replay the engine's monthly step
// (World.ApplyMonthlyAdvertising) exactly: every active campaign on a (product, city)
// is applied in channel order to the running brand — effective = budget × media bonus,
// lift = effective / cost-per-point × (1 − brand/100), brand = min(100, brand + lift) —
// and a (product, city) with no campaign decays by the monthly rate (dropping to 0 below
// 0.1). Random brand-shift news, rolled at the end of the tick, is not predictable.
public sealed partial class GameSession
{
    /// <summary>The player's campaigns with brand trajectory and retail presence.</summary>
    [BridgeMethod("adCampaigns")]
    public AdCampaignsDto AdCampaigns()
    {
        var game = Game;
        var campaigns = game.World.AdCampaigns
            .Where(c => c.Company == game.Player && c.MonthlyBudget > 0m)
            .OrderBy(c => c.Product.Value, StringComparer.Ordinal)
            .ThenBy(c => c.City.Value, StringComparer.Ordinal)
            .ThenBy(c => (int)c.Channel)
            .Select(c => CampaignDto(game, c.Product, c.City, c.Channel, c.MonthlyBudget))
            .ToList();
        return new AdCampaignsDto(campaigns, campaigns.Sum(c => c.MonthlyBudget), BrandDecayRate(game.World));
    }

    /// <summary>What a campaign at <c>monthlyBudget</c> would do to the brand next month.</summary>
    [BridgeMethod("previewAdCampaign")]
    public AdPreviewDto PreviewAdCampaign(AdCampaignArgs args)
    {
        var game = Game;
        var (product, city, channel) = CampaignKey(args.ProductId, args.CityId, args.Channel);
        var budget = Guard.NonNegativeMoney(args.MonthlyBudget, Guard.MaxAdBudget, "monthlyBudget");
        var brand = game.World.GetBrandAwareness(game.Player, product.Id, city.Id);
        var bonus = game.World.GetMediaOwnershipBonus(game.Player, city.Id, channel);
        var costPerPoint = game.World.GetAdCostPerPoint(city.Id, channel); // E1 v2: ChannelK × Pop/1000 under Realistic
        var effective = budget * bonus;
        // This campaign on its own at today's brand (the spec's preview figures) …
        var saturation = Math.Max(0, 1 - brand / 100.0);
        var lift = budget > 0m ? (double)(effective / costPerPoint) * saturation : 0;
        // … and next month's brand with every campaign on the (product, city), this one at the previewed budget.
        var budgets = ChannelBudgets(game, product.Id, city.Id);
        budgets[channel] = budget;
        var projected = ProjectBrand(game.World, game.Player, product.Id, city.Id, budgets);
        var existing = game.World.GetAdCampaign(game.Player, product.Id, city.Id, channel)?.MonthlyBudget ?? 0m;
        return new AdPreviewDto(brand, projected, lift, costPerPoint, bonus, effective, saturation, existing,
            HasRetailPresence(game, product.Id, city.Id));
    }

    /// <summary>Start, change or (budget 0) stop a campaign. Ads only work on finished products.</summary>
    [BridgeMethod("setAdCampaign", Mutates = true)]
    public AdCampaignDto SetAdCampaign(AdCampaignArgs args)
    {
        var game = Game;
        var (product, city, channel) = CampaignKey(args.ProductId, args.CityId, args.Channel);
        var budget = Guard.NonNegativeMoney(args.MonthlyBudget, Guard.MaxAdBudget, "monthlyBudget");
        var existing = game.World.GetAdCampaign(game.Player, product.Id, city.Id, channel);
        var oldBudget = existing?.MonthlyBudget ?? 0m;

        MarkDirty();
        game.World.RegisterAdCampaign(game.Player, product.Id, city.Id, channel, budget);

        var channelId = Advisor.ChannelId(channel);
        if (budget > 0m && oldBudget <= 0m)
        {
            QueueEvent(new GameEventDto(EventKinds.CampaignStarted, EventKinds.Info,
                $"Started a {ChannelName(channel)} campaign for {product.Name} in {city.Name}.",
                Amount: budget, ProductId: product.Id.Value, CityId: city.Id.Value, Reason: channelId, Priority: 1));
        }
        else if (budget > 0m && budget != oldBudget)
        {
            QueueEvent(new GameEventDto(EventKinds.CampaignChanged, EventKinds.Info,
                $"{ChannelName(channel)} budget for {product.Name} in {city.Name} is now {Money(budget)} a month.",
                Amount: budget, OldValue: oldBudget, NewValue: budget, ProductId: product.Id.Value, CityId: city.Id.Value,
                Reason: channelId, Priority: 1));
        }
        else if (budget == 0m && oldBudget > 0m)
        {
            QueueEvent(CancelledEvent(product, city, channel, oldBudget));
        }
        return CampaignDto(game, product.Id, city.Id, channel, budget);
    }

    /// <summary>Stop a campaign (no-op when there is none).</summary>
    [BridgeMethod("cancelAdCampaign", Mutates = true)]
    public CancelResultDto CancelAdCampaign(AdKeyArgs args)
    {
        var game = Game;
        var (product, city, channel) = CampaignKey(args.ProductId, args.CityId, args.Channel, requireFinished: false);
        var existing = game.World.GetAdCampaign(game.Player, product.Id, city.Id, channel);
        if (existing is null) return new CancelResultDto(false);
        MarkDirty();
        var cancelled = game.World.CancelAdCampaign(game.Player, product.Id, city.Id, channel);
        if (cancelled) QueueEvent(CancelledEvent(product, city, channel, existing.MonthlyBudget));
        return new CancelResultDto(cancelled);
    }

    // ------------------------------------------------------------------ helpers

    private (Product Product, City City, AdChannel Channel) CampaignKey(string? productId, string? cityId, string? channelId, bool requireFinished = true)
    {
        var product = Guard.Product(Catalog, productId);
        var city = Guard.City(Catalog, cityId);
        var channel = ParseChannel(channelId);
        if (requireFinished && product.Tier != ProductTier.Finished)
        {
            throw new BridgeException(BridgeErrorCodes.ProductNotAllowed,
                $"Advertising only reaches shoppers; {product.Name} is not sold to consumers.", "productId",
                new ErrorDetailsDto(ProductId: product.Id.Value, Reason: "notFinished"));
        }
        return (product, city, channel);
    }

    internal static AdChannel ParseChannel(string? channelId)
    {
        var value = Guard.Required(channelId, "channel");
        if (!Enum.TryParse<AdChannel>(value, ignoreCase: true, out var channel) || !Enum.IsDefined(channel))
        {
            throw new BridgeException(BridgeErrorCodes.InvalidArgument, $"Unknown advertising channel '{value}'.", "channel");
        }
        return channel;
    }

    private AdCampaignDto CampaignDto(ActiveGame game, ProductId product, CityId city, AdChannel channel, decimal budget)
    {
        var world = game.World;
        var brand = world.GetBrandAwareness(game.Player, product, city);
        var bonus = world.GetMediaOwnershipBonus(game.Player, city, channel);
        var projected = ProjectBrand(world, game.Player, product, city, ChannelBudgets(game, product, city));
        return new AdCampaignDto(product.Value, city.Value, Advisor.ChannelId(channel), budget, brand, bonus, projected,
            HasRetailPresence(game, product, city));
    }

    /// <summary>The player's active budget per channel on one (product, city).</summary>
    private static Dictionary<AdChannel, decimal> ChannelBudgets(ActiveGame game, ProductId product, CityId city)
    {
        var budgets = new Dictionary<AdChannel, decimal>();
        foreach (var c in game.World.AdCampaigns)
        {
            if (c.Company == game.Player && c.Product == product && c.City == city && c.MonthlyBudget > 0m) budgets[c.Channel] = c.MonthlyBudget;
        }
        return budgets;
    }

    /// <summary>The monthly brand decay the engine applies under the game's rules.</summary>
    private static double BrandDecayRate(World world)
        => world.Rules.Market.Enabled ? world.Rules.Market.BrandDecayRate : EngineConstants.BrandDecayRate;

    /// <summary>
    /// The brand the engine's next advertising step will leave on (company, product, city)
    /// when <paramref name="budgets"/> run. Realistic rules (E1, econ-audit §4.20):
    /// <c>B·(1−d) + Σ points·(1−B/100)</c> with points at the city's cost per point — exactly
    /// <see cref="World.GetProjectedBrandAwareness"/>'s formula for arbitrary budgets. Classic:
    /// campaigns apply in channel order on the running brand; with none, the brand decays (and is
    /// dropped below 0.1).
    /// </summary>
    internal static double ProjectBrand(World world, CompanyId company, ProductId product, CityId city, IReadOnlyDictionary<AdChannel, decimal> budgets)
    {
        var brand = world.GetBrandAwareness(company, product, city);
        if (world.Rules.Market.Enabled)
        {
            double points = 0;
            var any = false;
            foreach (var (channel, budget) in budgets.OrderBy(kv => (int)kv.Key))
            {
                if (budget <= 0m) continue;
                any = true;
                points += (double)(budget * world.GetMediaOwnershipBonus(company, city, channel) / world.GetAdCostPerPoint(city, channel));
            }

            var saturation = Math.Max(0, 1.0 - brand / 100.0);
            var next = Math.Clamp(brand * (1.0 - world.Rules.Market.BrandDecayRate) + points * saturation, 0, 100);
            return !any && next < 0.1 ? 0 : next;
        }

        var active = false;
        foreach (var (channel, budget) in budgets.OrderBy(kv => (int)kv.Key))
        {
            if (budget <= 0m) continue;
            active = true;
            var points = (double)(budget * world.GetMediaOwnershipBonus(company, city, channel) / EngineConstants.AdCostPerPoint(channel));
            var saturation = Math.Max(0, 1 - brand / 100.0);
            brand = Math.Min(100.0, brand + points * saturation);
        }
        if (active) return brand;
        var decayed = brand * (1 - EngineConstants.BrandDecayRate);
        return decayed < 0.1 ? 0 : decayed;
    }

    private static bool HasRetailPresence(ActiveGame game, ProductId product, CityId city)
        => game.World.Buildings.Values.Any(b => b.Owner == game.Player && b.City == city && b.RetailSlots.Any(s => s.Product == product));

    private static GameEventDto CancelledEvent(Product product, City city, AdChannel channel, decimal oldBudget)
        => new(EventKinds.CampaignCancelled, EventKinds.Info,
            $"Stopped the {ChannelName(channel)} campaign for {product.Name} in {city.Name}.",
            Amount: 0m, OldValue: oldBudget, ProductId: product.Id.Value, CityId: city.Id.Value, Reason: Advisor.ChannelId(channel), Priority: 1);

    private static string ChannelName(AdChannel channel) => channel switch
    {
        AdChannel.TV => "TV",
        AdChannel.Newspaper => "newspaper",
        AdChannel.Magazine => "magazine",
        _ => "radio",
    };
}
