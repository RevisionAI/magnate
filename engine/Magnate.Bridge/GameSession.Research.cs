using System;
using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

// Research and patents (bridge-spec §5.7). Threshold for tech L → L+1 is
// 100 × L points; a research slot yields 100 points a month unless a rival's
// active patent blocks the product. The first company to reach max tech on a
// product gets a 24-month patent; the holder may license it for a 5% royalty.
public sealed partial class GameSession
{
    /// <summary>The player's research state for every product.</summary>
    [BridgeMethod("researchTree")]
    public ResearchTreeDto ResearchTree()
    {
        var game = Game;
        var world = game.World;
        var now = world.Clock.Now;
        var patents = world.GetActivePatents();
        var licenses = world.GetPatentLicenses();
        var slotsByProduct = world.Buildings.Values
            .Where(b => b.Owner == game.Player)
            .SelectMany(b => b.ResearchSlots)
            .GroupBy(s => s.Product)
            .ToDictionary(g => g.Key, g => g.Count());
        var feeds = new Dictionary<ProductId, List<string>>();
        foreach (var p in game.Rules.OrderedProducts)
        {
            foreach (var input in p.Recipe?.Inputs ?? Array.Empty<RecipeInput>())
            {
                if (!feeds.TryGetValue(input.ProductId, out var list)) feeds[input.ProductId] = list = new List<string>();
                list.Add(p.Id.Value);
            }
        }

        var nodes = new List<ResearchNodeDto>();
        foreach (var product in game.Rules.OrderedProducts)
        {
            var tech = world.GetTech(game.Player, product.Id);
            var progress = world.GetResearchProgress(game.Player, product.Id);
            var blocked = world.IsPatentBlocked(game.Player, product.Id);
            var slots = slotsByProduct.GetValueOrDefault(product.Id);
            var points = blocked ? 0 : EngineConstants.ResearchPointsPerSlotPerMonth * slots;
            var threshold = EngineConstants.BaseResearchThreshold * tech;
            var atMax = tech >= product.MaxTechLevel;
            int? eta = atMax || points <= 0 ? null : (int)Math.Ceiling(Math.Max(0, threshold - progress) / points);
            int? etaToMax = null;
            if (!atMax && points > 0)
            {
                double remaining = -progress;
                for (var level = tech; level < product.MaxTechLevel; level++) remaining += EngineConstants.BaseResearchThreshold * level;
                etaToMax = (int)Math.Ceiling(Math.Max(0, remaining) / points);
            }

            var patent = patents.FirstOrDefault(p => p.Product == product.Id);
            PatentRefDto? patentRef = patent is null
                ? null
                : new PatentRefDto(
                    patent.Holder.Value,
                    patent.Holder == game.Player,
                    Months.Dto(patent.ExpiresAt),
                    Math.Max(0, patent.ExpiresAt.AsMonthIndex() - now.AsMonthIndex()),
                    licenses.Any(l => l.Holder == patent.Holder && l.Product == product.Id && l.Licensee == game.Player));

            RivalTechDto? best = null;
            foreach (var company in world.Companies.Values.Where(c => c.Id != game.Player).OrderBy(c => c.Id.Value))
            {
                var t = world.GetTech(company.Id, product.Id);
                if (best is null || t > best.Tech) best = new RivalTechDto(company.Id.Value, company.Name, t);
            }

            nodes.Add(new ResearchNodeDto(
                product.Id.Value,
                product.Name,
                TierId(product.Tier),
                tech,
                product.MaxTechLevel,
                progress,
                atMax ? 0 : threshold,
                slots,
                points,
                eta,
                etaToMax,
                blocked,
                patentRef,
                best,
                product.Recipe?.Inputs.Select(i => i.ProductId.Value).ToList() ?? new List<string>(),
                feeds.TryGetValue(product.Id, out var f) ? f : new List<string>(),
                product.Tier == ProductTier.Finished));
        }
        return new ResearchTreeDto(nodes, EngineConstants.ResearchPointsPerSlotPerMonth, EngineConstants.BaseResearchThreshold);
    }

    /// <summary>Patents held by the player (with licensees and royalties) and by rivals.</summary>
    [BridgeMethod("patents")]
    public PatentsDto Patents() => BuildPatents(Game);

    /// <summary>License the player's patent to a rival (they pay a 5% royalty on sales of the product).</summary>
    [BridgeMethod("grantLicense", Mutates = true)]
    public PatentsDto GrantLicense(LicenseArgs args)
    {
        var game = Game;
        var (licensee, product) = ValidateLicense(game, args);
        MarkDirty();
        game.World.GrantPatentLicense(game.Player, licensee.Id, product.Id);
        QueueEvent(new GameEventDto(EventKinds.LicenseGranted, EventKinds.Success,
            $"Licensed your {product.Name} patent to {licensee.Name}.",
            CompanyId: licensee.Id.Value, ProductId: product.Id.Value, Priority: 1));
        return BuildPatents(game);
    }

    /// <summary>Revoke a license (idempotent).</summary>
    [BridgeMethod("revokeLicense", Mutates = true)]
    public PatentsDto RevokeLicense(LicenseArgs args)
    {
        var game = Game;
        var (licensee, product) = ValidateLicense(game, args);
        var had = game.World.GetPatentLicenses().Any(l => l.Holder == game.Player && l.Licensee == licensee.Id && l.Product == product.Id);
        MarkDirty();
        game.World.RevokePatentLicense(game.Player, licensee.Id, product.Id);
        if (had)
        {
            QueueEvent(new GameEventDto(EventKinds.LicenseRevoked, EventKinds.Info,
                $"Revoked {licensee.Name}'s {product.Name} license.",
                CompanyId: licensee.Id.Value, ProductId: product.Id.Value, Priority: 1));
        }
        return BuildPatents(game);
    }

    // ------------------------------------------------------------------ helpers

    private (Company Licensee, Product Product) ValidateLicense(ActiveGame game, LicenseArgs args)
    {
        var product = Guard.Product(Catalog, args.ProductId);
        var licensee = Guard.Company(game.World, args.LicenseeId, "licenseeId");
        if (licensee.Id == game.Player)
        {
            throw new BridgeException(BridgeErrorCodes.PatentSelfLicense, "You cannot license a patent to yourself.", "licenseeId",
                new ErrorDetailsDto(ProductId: product.Id.Value));
        }
        if (!game.World.GetActivePatents().Any(p => p.Holder == game.Player && p.Product == product.Id))
        {
            if (game.Detector.PlayerEverHeldPatent(product.Id.Value))
            {
                throw new BridgeException(BridgeErrorCodes.PatentNotActive, $"Your {product.Name} patent has expired.", "productId",
                    new ErrorDetailsDto(ProductId: product.Id.Value));
            }
            throw new BridgeException(BridgeErrorCodes.NotPatentHolder, $"You hold no patent on {product.Name}.", "productId",
                new ErrorDetailsDto(ProductId: product.Id.Value));
        }
        return (licensee, product);
    }

    private static PatentsDto BuildPatents(ActiveGame game)
    {
        var world = game.World;
        var now = world.Clock.Now.AsMonthIndex();
        var licenses = world.GetPatentLicenses();
        CompanyRefDto Ref(CompanyId id) => new(id.Value, world.Companies[id].Name, game.Color(id.Value), game.ColorIndex(id.Value));

        var mine = new List<MyPatentDto>();
        var rivals = new List<RivalPatentDto>();
        var researching = new HashSet<ProductId>(world.Buildings.Values
            .Where(b => b.Owner == game.Player).SelectMany(b => b.ResearchSlots).Select(s => s.Product));
        foreach (var patent in world.GetActivePatents())
        {
            var remaining = Math.Max(0, patent.ExpiresAt.AsMonthIndex() - now);
            if (patent.Holder == game.Player)
            {
                var licensees = licenses.Where(l => l.Holder == game.Player && l.Product == patent.Product)
                    .Select(l => l.Licensee).OrderBy(c => c.Value).ToList();
                var candidates = world.Companies.Keys.Where(c => c != game.Player && !licensees.Contains(c)).OrderBy(c => c.Value).Select(Ref).ToList();
                decimal royalties = 0m;
                for (var m = Math.Max(game.StartMonth, now - 11); m <= now; m++)
                {
                    royalties += game.Index.Product(game.Player.Value, patent.Product.Value, m)?.RoyaltyIn ?? 0m;
                }
                mine.Add(new MyPatentDto(patent.Product.Value, Months.Dto(patent.ExpiresAt), remaining,
                    licensees.Select(Ref).ToList(), candidates, royalties));
            }
            else
            {
                var licensedToMe = licenses.Any(l => l.Holder == patent.Holder && l.Product == patent.Product && l.Licensee == game.Player);
                rivals.Add(new RivalPatentDto(patent.Holder.Value, world.Companies[patent.Holder].Name, patent.Product.Value,
                    Months.Dto(patent.ExpiresAt), remaining, licensedToMe, !licensedToMe && researching.Contains(patent.Product)));
            }
        }
        return new PatentsDto(mine, rivals, EngineConstants.PatentRoyaltyRate, EngineConstants.PatentDurationMonths);
    }
}
