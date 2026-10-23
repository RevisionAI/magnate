using System;
using Magnate.Engine.Rules;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;
using Xunit;

namespace Magnate.Engine.Tests;

/// <summary>EconomyRules presets, world wiring and the scenario runner's default (master plan D3).</summary>
public sealed class EconomyRulesTests
{
    [Fact]
    public void Classic_preset_disables_every_area()
    {
        var rules = EconomyRules.Classic;
        Assert.Equal(EconomyRules.ClassicPreset, rules.Preset);
        Assert.Equal(1m, rules.EconomyScale);
        Assert.False(rules.Market.Enabled);
        Assert.False(rules.Finance.Enabled);
        Assert.False(rules.Land.Enabled);
        Assert.False(rules.Macro.Enabled);
        Assert.True(rules.IsClassic);
    }

    [Fact]
    public void Realistic_preset_enables_every_area()
    {
        var rules = EconomyRules.Realistic;
        Assert.Equal(EconomyRules.RealisticPreset, rules.Preset);
        Assert.True(rules.Market.Enabled);
        Assert.True(rules.Finance.Enabled);
        Assert.True(rules.Land.Enabled);
        Assert.True(rules.Macro.Enabled);
        Assert.False(rules.IsClassic);
    }

    [Fact]
    public void Rules_have_value_semantics()
    {
        var custom = EconomyRules.Classic with { Market = new MarketRules { Enabled = true }, Preset = "custom" };
        Assert.Equal(custom, EconomyRules.Classic with { Market = new MarketRules { Enabled = true }, Preset = "custom" });
        Assert.NotEqual(EconomyRules.Classic, custom);
        Assert.False(custom.IsClassic);
    }

    [Theory]
    [InlineData("classic")]
    [InlineData("Classic")]
    [InlineData(" realistic ")]
    public void FromPreset_resolves_names_case_insensitively(string name)
    {
        var rules = EconomyRules.FromPreset(name);
        Assert.Equal(name.Trim().ToLowerInvariant(), rules.Preset);
    }

    [Fact]
    public void FromPreset_rejects_unknown_names()
        => Assert.Throws<ArgumentException>(() => EconomyRules.FromPreset("arcade"));

    [Fact]
    public void World_rejects_non_positive_economy_scale()
    {
        var bad = EconomyRules.Classic with { EconomyScale = 0m };
        Assert.Throws<ArgumentException>(() => new World(TestContent.Live, 42, Worlds.DefaultStart, bad));
    }

    [Fact]
    public void World_rejects_null_rules()
        => Assert.Throws<ArgumentNullException>(() => new World(TestContent.Live, 42, Worlds.DefaultStart, null!));

    [Fact]
    public void Three_argument_world_constructor_defaults_to_classic()
    {
        var world = new World(TestContent.Live, 42, Worlds.DefaultStart);
        Assert.Same(EconomyRules.Classic, world.Rules);
    }

    [Fact]
    public void World_keeps_the_rules_it_was_given()
    {
        var world = Worlds.Realistic();
        Assert.Same(EconomyRules.Realistic, world.Rules);
    }

    [Fact]
    public void Scenario_runner_defaults_to_realistic_rules()
    {
        var (world, _) = ScenarioRunner.Apply(TestContent.Live, TestContent.LiveScenarios["sandbox"], seed: 42);
        Assert.Same(EconomyRules.Realistic, world.Rules);
    }

    [Fact]
    public void Scenario_runner_honours_explicit_classic_rules()
    {
        var (world, _) = ScenarioRunner.Apply(TestContent.Classic, TestContent.ClassicScenarios["sandbox"], 42, EconomyRules.Classic);
        Assert.Same(EconomyRules.Classic, world.Rules);
    }
}
