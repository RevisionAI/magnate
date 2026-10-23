using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Magnate.Engine.Domain;
using Magnate.Engine.Finance;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Scenarios;

/// <summary>Loads scenario JSON files from disk into <see cref="Scenario"/> objects.</summary>
public static class ScenarioLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = false,
    };

    /// <summary>Load a single scenario file by path.</summary>
    public static Scenario Load(string scenarioPath)
    {
        ArgumentNullException.ThrowIfNull(scenarioPath);
        if (!File.Exists(scenarioPath))
        {
            throw new FileNotFoundException("scenario not found", scenarioPath);
        }

        using var stream = File.OpenRead(scenarioPath);
        var dto = JsonSerializer.Deserialize<ScenarioDto>(stream, JsonOptions)
            ?? throw new InvalidOperationException($"{scenarioPath}: deserialized to null");

        return ToScenario(dto, scenarioPath);
    }

    /// <summary>Load all scenarios under a directory (non-recursive).</summary>
    public static IReadOnlyDictionary<string, Scenario> LoadAll(string directory)
    {
        var map = new Dictionary<string, Scenario>();
        if (!Directory.Exists(directory)) return map;

        foreach (var file in Directory.EnumerateFiles(directory, "*.json"))
        {
            var scenario = Load(file);
            if (map.ContainsKey(scenario.Id))
            {
                throw new InvalidOperationException($"duplicate scenario id '{scenario.Id}' in {file}");
            }
            map[scenario.Id] = scenario;
        }

        return map;
    }

    // ---------------------------------------------------------------- mapping

    private static Scenario ToScenario(ScenarioDto dto, string path)
    {
        if (string.IsNullOrWhiteSpace(dto.Id)) throw new InvalidOperationException($"{path}: scenario missing id");
        if (dto.Player is null) throw new InvalidOperationException($"{path}: scenario missing player");
        if (dto.StartDate is null) throw new InvalidOperationException($"{path}: scenario missing startDate");

        var startDate = new GameDate(dto.StartDate.Year, dto.StartDate.Month);

        var goals = new List<Goal>();
        if (dto.Goals is not null)
        {
            foreach (var g in dto.Goals) goals.Add(ToGoal(g, path, startDate));
        }

        var ais = new List<ScenarioCompany>();
        if (dto.AiCompetitors is not null)
        {
            foreach (var ai in dto.AiCompetitors)
            {
                ais.Add(new ScenarioCompany(ai.Name, ai.StartingCash, ai.Strategy ?? "adaptive"));
            }
        }

        return new Scenario(
            dto.Id,
            dto.Name ?? dto.Id,
            dto.Description ?? string.Empty,
            startDate,
            dto.EndDate is null ? null : new GameDate(dto.EndDate.Year, dto.EndDate.Month),
            new ScenarioPlayer(dto.Player.Name, dto.Player.StartingCash),
            ais,
            goals);
    }

    private static Goal ToGoal(GoalDto dto, string path, GameDate scenarioStart)
    {
        var goal = ToGoalCore(dto, path, scenarioStart);
        var mode = dto.Mode?.Trim().ToLowerInvariant() switch
        {
            null or "" or "reachonce" or "reach_once" => GoalMode.ReachOnce,
            "holdatdeadline" or "hold_at_deadline" => GoalMode.HoldAtDeadline,
            _ => throw new InvalidOperationException($"{path}: unknown goal mode '{dto.Mode}' (expected reachOnce or holdAtDeadline)"),
        };
        return goal with { Id = string.IsNullOrWhiteSpace(dto.Id) ? null : dto.Id.Trim(), Mode = mode };
    }

    private static Goal ToGoalCore(GoalDto dto, string path, GameDate scenarioStart)
    {
        var description = dto.Description ?? string.Empty;
        return dto.Type?.ToLowerInvariant() switch
        {
            "corporatevalue" or "corporate_value" or "companyvalue" or "company_value" =>
                new CorporateValueGoal(description, dto.Threshold ?? 0m),
            "totalassets" or "total_assets" =>
                new TotalAssetsGoal(description, dto.Threshold ?? throw new InvalidOperationException($"{path}: totalAssets goal missing threshold")),
            "networth" or "net_worth" =>
                new NetWorthGoal(description, dto.Threshold ?? throw new InvalidOperationException($"{path}: netWorth goal missing threshold")),
            "creditrating" or "credit_rating" =>
                new CreditRatingGoal(
                    description,
                    CreditRatings.TryParse(dto.Rating, out var rating)
                        ? rating
                        : throw new InvalidOperationException($"{path}: creditRating goal needs a rating such as \"A\" (was '{dto.Rating}')")),
            "loantaken" or "loan_taken" =>
                new LoanTakenGoal(description, dto.Count ?? 1),
            "marketshare" or "market_share" =>
                new MarketShareGoal(
                    description,
                    new ProductId(dto.Product ?? throw new InvalidOperationException($"{path}: marketShare goal missing product")),
                    new CityId(dto.City ?? throw new InvalidOperationException($"{path}: marketShare goal missing city")),
                    (double)(dto.Threshold ?? 0m)),
            "ownsbuilding" or "owns_building" =>
                new OwnsBuildingOfCategoryGoal(
                    description,
                    dto.Category ?? throw new InvalidOperationException($"{path}: ownsBuilding goal missing category"),
                    dto.Count ?? 1),
            "productretailed" or "product_retailed" =>
                new ProductRetailedGoal(
                    description,
                    new ProductId(dto.Product ?? throw new InvalidOperationException($"{path}: productRetailed goal missing product"))),
            "adcampaignactive" or "ad_campaign_active" =>
                new AdCampaignActiveGoal(
                    description,
                    new ProductId(dto.Product ?? throw new InvalidOperationException($"{path}: adCampaignActive goal missing product"))),
            "elapsedmonths" or "elapsed_months" =>
                new ElapsedMonthsGoal(
                    description,
                    scenarioStart,
                    dto.Months ?? throw new InvalidOperationException($"{path}: elapsedMonths goal missing months")),
            "netincome" or "net_income" =>
                new NetIncomeSinceStartGoal(
                    description,
                    scenarioStart,
                    dto.Amount ?? throw new InvalidOperationException($"{path}: netIncome goal missing amount")),
            "topbrand" or "top_brand" =>
                new TopBrandGoal(
                    description,
                    new ProductId(dto.Product ?? throw new InvalidOperationException($"{path}: topBrand goal missing product")),
                    new CityId(dto.City ?? throw new InvalidOperationException($"{path}: topBrand goal missing city")),
                    (double)(dto.Threshold ?? throw new InvalidOperationException($"{path}: topBrand goal missing threshold"))),
            "exportrevenue" or "export_revenue" =>
                new ExportRevenueGoal(
                    description,
                    scenarioStart,
                    dto.Amount ?? throw new InvalidOperationException($"{path}: exportRevenue goal missing amount")),
            "consecutiveprofitable" or "consecutive_profitable" =>
                new ConsecutiveProfitableMonthsGoal(
                    description,
                    dto.Months ?? throw new InvalidOperationException($"{path}: consecutiveProfitable goal missing months")),
            _ => throw new InvalidOperationException($"{path}: unknown goal type '{dto.Type}'"),
        };
    }

    // ---------------------------------------------------------------- DTOs

    private sealed record ScenarioDto(
        string Id,
        string? Name,
        string? Description,
        GameDateDto? StartDate,
        GameDateDto? EndDate,
        ScenarioPlayerDto? Player,
        IReadOnlyList<ScenarioCompanyDto>? AiCompetitors,
        IReadOnlyList<GoalDto>? Goals);

    private sealed record GameDateDto(int Year, int Month);

    private sealed record ScenarioPlayerDto(string Name, decimal StartingCash);

    private sealed record ScenarioCompanyDto(string Name, decimal StartingCash, string? Strategy);

    private sealed record GoalDto(
        string? Id,
        string? Mode,
        string? Rating,
        string? Type,
        string? Description,
        decimal? Threshold,
        string? Product,
        string? City,
        string? Category,
        int? Count,
        int? Months,
        decimal? Amount);
}
