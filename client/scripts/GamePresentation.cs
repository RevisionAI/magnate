using Godot;
using Magnate.Engine.Scenarios;

namespace Magnate.Client;

internal sealed record StrategicFocus(
    string Title,
    string Subtitle,
    string ImagePath,
    Color Accent,
    string Pillar);

/// <summary>
/// Presentation metadata that translates scenario ids into a clear operating
/// fantasy. It deliberately stays client-side: no visual categorisation leaks
/// into simulation or content-loading contracts.
/// </summary>
internal static class GamePresentation
{
    public const string RetailArt = "res://assets/systems/retail.png";
    public const string ManufacturingArt = "res://assets/systems/manufacturing.png";
    public const string LogisticsArt = "res://assets/systems/logistics.png";
    public const string ResearchArt = "res://assets/systems/research.png";
    public const string MarketsArt = "res://assets/systems/markets.png";

    public static StrategicFocus ForScenario(Scenario? scenario)
    {
        if (scenario is null)
        {
            return new StrategicFocus(
                "Build your operating model",
                "Scout demand, deploy capital, and turn a first store into an integrated group.",
                UiChrome.CityBackdrop,
                UiChrome.Gold,
                "Corporate strategy");
        }

        var id = scenario.Id.ToLowerInvariant();

        if (id.Contains("tech") || id.Contains("patent"))
        {
            return new StrategicFocus(
                "Win through innovation",
                "Compound product technology, secure patents, and defend premium margins.",
                ResearchArt,
                new Color(0.55f, 0.66f, 1.0f),
                "R&D and patents");
        }

        if (id.Contains("export") || id.Contains("multi_city"))
        {
            return new StrategicFocus(
                "Build the network",
                "Place production where it is efficient and move goods to the markets that value them most.",
                LogisticsArt,
                new Color(0.36f, 0.78f, 0.86f),
                "Logistics and expansion");
        }

        if (id.Contains("vertical") || id.Contains("showdown"))
        {
            return new StrategicFocus(
                "Own the value chain",
                "Control inputs, conversion, inventory, and the final customer margin.",
                ManufacturingArt,
                new Color(0.94f, 0.58f, 0.28f),
                "Vertical integration");
        }

        if (id.Contains("brand") || id.Contains("monopol") || id.Contains("fashion"))
        {
            return new StrategicFocus(
                "Shape the market",
                "Pair a strong consumer offer with brand investment and disciplined pricing.",
                MarketsArt,
                new Color(0.95f, 0.74f, 0.34f),
                "Brand and market power");
        }

        if (id.Contains("coffee") || id.Contains("soft_drink") || id.Contains("tutorial"))
        {
            return new StrategicFocus(
                "Start at the shelf",
                "Learn demand, price for margin, keep inventory flowing, then integrate upstream.",
                RetailArt,
                UiChrome.Green,
                "Retail operations");
        }

        return new StrategicFocus(
            "Create a diversified group",
            "Balance growth, operating profit, brand, technology, and resilience across cities.",
            UiChrome.CityBackdrop,
            UiChrome.Gold,
            "Corporate strategy");
    }
}
