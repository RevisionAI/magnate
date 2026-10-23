using System.IO;
using System.Linq;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Xunit;

namespace Magnate.Engine.Tests;

public sealed class ContentLoaderTests
{
    [Fact]
    public void Loads_seed_catalog_without_errors()
    {
        var catalog = TestContent.Live;

        Assert.NotEmpty(catalog.Products);
        Assert.NotEmpty(catalog.BuildingTypes);
        Assert.NotEmpty(catalog.Cities);
    }

    [Fact]
    public void Seed_catalog_contains_mvp_products()
    {
        var catalog = TestContent.Live;

        string[] expected =
        {
            "sugarcane", "wheat", "cotton", "iron_ore", "crude_oil", "coffee_beans", "hops",
            "sugar", "flour", "cotton_fabric", "steel", "plastic", "electronic_parts", "roasted_coffee", "malt",
            "soft_drink", "bread", "t_shirt", "television", "car", "coffee_drink", "beer",
        };

        foreach (var id in expected)
        {
            Assert.True(catalog.Products.ContainsKey(new ProductId(id)), $"missing product '{id}'");
        }
    }

    [Fact]
    public void Coffee_chain_loads_with_correct_tiers_and_recipes()
    {
        var catalog = TestContent.Live;

        var beans = catalog.Products[new ProductId("coffee_beans")];
        Assert.Equal(ProductTier.Raw, beans.Tier);
        Assert.Null(beans.Recipe);
        Assert.NotNull(beans.Extraction);
        // Phase 3.15: coffee_beans moved from "farm" to "plantation".
        Assert.Equal("plantation", beans.Extraction!.SourceCategory);

        var roasted = catalog.Products[new ProductId("roasted_coffee")];
        Assert.Equal(ProductTier.Intermediate, roasted.Tier);
        Assert.NotNull(roasted.Recipe);
        Assert.Contains(roasted.Recipe!.Inputs, i => i.ProductId == new ProductId("coffee_beans"));

        var drink = catalog.Products[new ProductId("coffee_drink")];
        Assert.Equal(ProductTier.Finished, drink.Tier);
        Assert.NotNull(drink.Recipe);
        Assert.Contains(drink.Recipe!.Inputs, i => i.ProductId == new ProductId("roasted_coffee"));
        Assert.Contains(drink.Recipe!.Inputs, i => i.ProductId == new ProductId("plastic"));
        // Coffee drink demand is higher for middle/high (working-professional pattern).
        Assert.True(drink.BaseDemandPerCapita[IncomeBracket.High] >= drink.BaseDemandPerCapita[IncomeBracket.Middle]);
        Assert.True(drink.BaseDemandPerCapita[IncomeBracket.Middle] > drink.BaseDemandPerCapita[IncomeBracket.Low]);
    }

    [Trait("Ruleset", "Classic")]
    [Fact]
    public void Eastside_loads_with_affluent_demographics()
    {
        var catalog = TestContent.Classic;
        var eastside = catalog.Cities[new CityId("eastside")];

        Assert.Equal("Eastside", eastside.Name);
        Assert.Equal(200_000, eastside.Population);
        Assert.Equal(0.25, eastside.Demographics[IncomeBracket.Low], 6);
        Assert.Equal(0.40, eastside.Demographics[IncomeBracket.Middle], 6);
        Assert.Equal(0.35, eastside.Demographics[IncomeBracket.High], 6);
        Assert.Equal(1.0, eastside.Demographics.Values.Sum(), 6);
        // Distinct profile: arable, no coast / minerals / oil; higher land price than Metropolis.
        Assert.True(eastside.BaseLandPrice > catalog.Cities[new CityId("metropolis")].BaseLandPrice);
    }

    [Fact]
    public void Raws_have_no_recipe_intermediates_and_finished_do()
    {
        var catalog = TestContent.Live;

        foreach (var product in catalog.Products.Values)
        {
            switch (product.Tier)
            {
                case ProductTier.Raw:
                    Assert.Null(product.Recipe);
                    break;
                case ProductTier.Intermediate:
                case ProductTier.Finished:
                    Assert.NotNull(product.Recipe);
                    break;
            }
        }
    }

    [Fact]
    public void All_recipe_inputs_resolve_to_known_products()
    {
        var catalog = TestContent.Live;

        foreach (var product in catalog.Products.Values)
        {
            if (product.Recipe is null)
            {
                continue;
            }

            foreach (var input in product.Recipe.Inputs)
            {
                Assert.True(
                    catalog.Products.ContainsKey(input.ProductId),
                    $"recipe for '{product.Id}' references unknown input '{input.ProductId}'");
            }
        }
    }

    [Fact]
    public void City_demographics_sum_to_one()
    {
        var catalog = TestContent.Live;

        foreach (var city in catalog.Cities.Values)
        {
            var sum = city.Demographics.Values.Sum();
            Assert.InRange(sum, 0.999, 1.001);
        }
    }

    [Fact]
    public void Plantation_building_loads_with_category()
    {
        var catalog = TestContent.Live;
        var plantation = catalog.BuildingTypes[new BuildingTypeId("small_plantation")];

        Assert.Equal("plantation", plantation.Category);
        Assert.Contains(ProductTier.Raw, plantation.ProducibleTiers);
        Assert.True(plantation.GeographyRequirement?.Arable == true);
    }

    [Fact]
    public void Beer_chain_loads_with_expected_recipes()
    {
        var catalog = TestContent.Live;

        var hops = catalog.Products[new ProductId("hops")];
        Assert.Equal(ProductTier.Raw, hops.Tier);
        Assert.Null(hops.Recipe);
        Assert.NotNull(hops.Extraction);
        Assert.Equal("plantation", hops.Extraction!.SourceCategory);

        var malt = catalog.Products[new ProductId("malt")];
        Assert.Equal(ProductTier.Intermediate, malt.Tier);
        Assert.NotNull(malt.Recipe);
        Assert.Contains(malt.Recipe!.Inputs, i => i.ProductId == new ProductId("wheat"));

        var beer = catalog.Products[new ProductId("beer")];
        Assert.Equal(ProductTier.Finished, beer.Tier);
        Assert.NotNull(beer.Recipe);
        Assert.Contains(beer.Recipe!.Inputs, i => i.ProductId == new ProductId("malt"));
        Assert.Contains(beer.Recipe!.Inputs, i => i.ProductId == new ProductId("hops"));
        Assert.Contains(beer.Recipe!.Inputs, i => i.ProductId == new ProductId("plastic"));

        // Rebalanced content (econ-audit Table 4.7-B): beer sells fewer bottles per capita than
        // soft drinks and, at reference prices, is a smaller dollar market — soft drinks stay the
        // biggest beverage market.
        var softDrink = catalog.Products[new ProductId("soft_drink")];
        var beerAvg = beer.BaseDemandPerCapita.Values.Average();
        var softAvg = softDrink.BaseDemandPerCapita.Values.Average();
        Assert.True(beerAvg < softAvg, $"beer avg demand {beerAvg} must be below soft_drink {softAvg}");
        Assert.True(beerAvg * (double)beer.Demand!.ReferencePrice < softAvg * (double)softDrink.Demand!.ReferencePrice,
            "beer's dollar demand must be below soft drink's");
    }

    [Fact]
    public void Coffee_beans_extracted_from_plantation_not_farm()
    {
        var catalog = TestContent.Live;
        var beans = catalog.Products[new ProductId("coffee_beans")];
        Assert.NotNull(beans.Extraction);
        Assert.Equal("plantation", beans.Extraction!.SourceCategory);
    }

    [Fact]
    public void Recipe_cost_at_world_price_is_below_output_world_price_for_finished_goods()
    {
        // Sanity: at base world prices the input cost of producing 1 unit of a finished
        // good should be less than the world price (else nobody would ever produce it).
        var catalog = TestContent.Live;

        foreach (var product in catalog.Products.Values.Where(p => p.Tier == ProductTier.Finished))
        {
            var recipe = product.Recipe!;
            var inputCostPerUnit = recipe.Inputs.Sum(i =>
                catalog.Products[i.ProductId].BaseWorldMarketPrice * i.Quantity) / recipe.OutputQuantity;

            Assert.True(
                inputCostPerUnit < product.BaseWorldMarketPrice,
                $"product '{product.Id}': input cost {inputCostPerUnit:F2} >= sale price {product.BaseWorldMarketPrice:F2}");
        }
    }
}
