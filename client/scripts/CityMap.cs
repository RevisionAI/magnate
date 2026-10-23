using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Godot;
using Magnate.Engine.Domain;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// City Map overview scene (Phase 3.14, enhanced 3.42).
///
/// A live dashboard of city cards. Each card surfaces population, demographics
/// as a stacked Low/Mid/High strip, geography badges, and a building-density
/// row colored by company owner so the player can see who controls each city
/// at a glance. Click a card to drill into a side panel with the full breakdown
/// (full demographics, geography, all buildings grouped by owner, total finished-
/// product demand). A toggle bar switches between absolute population emphasis,
/// demographic mix view, and a heat-map view that shades cards by player
/// market share. Refreshes on every tick via <see cref="GameState.TickIfRunning"/>.
/// </summary>
public partial class CityMap : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    /// <summary>
    /// Stable color palette for company owners. Player is pinned to index 0
    /// (blue); AI competitors get amber, green, purple in CompanyId order.
    /// Falls back to a neutral gray for any unknown / extra companies.
    /// </summary>
    private static readonly Color[] OwnerColors =
    {
        new Color(0.30f, 0.55f, 0.90f), // player blue
        new Color(0.85f, 0.55f, 0.20f), // amber
        new Color(0.40f, 0.80f, 0.40f), // green
        new Color(0.65f, 0.40f, 0.80f), // purple
        new Color(0.85f, 0.40f, 0.40f), // red
        new Color(0.45f, 0.75f, 0.85f), // cyan
    };

    private static readonly Color UnknownOwnerColor = new(0.55f, 0.55f, 0.55f);

    /// <summary>The three view modes selectable from the toggle bar.</summary>
    private enum ViewMode { Mix, Population, HeatShare }

    private ViewMode _mode = ViewMode.Mix;

    /// <summary>City currently expanded in the side panel; null = no selection.</summary>
    private CityId? _selectedCity;

    private HBoxContainer _toggleBar = null!;
    private HBoxContainer _ownerLegend = null!;
    private RichTextLabel _detailContent = null!;
    private Label _detailHeader = null!;
    private Label _detailHint = null!;

    public override void _Ready()
    {
        ApplyVisualPolish();

        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;
        _toggleBar = GetNode<HBoxContainer>("Panel/VBox/ToggleBar");
        _ownerLegend = GetNode<HBoxContainer>("Panel/VBox/OwnerLegend");
        _detailContent = GetNode<RichTextLabel>(
            "Panel/VBox/Body/DetailPanel/DetailMargin/DetailVBox/DetailScroll/DetailContent");
        _detailHeader = GetNode<Label>(
            "Panel/VBox/Body/DetailPanel/DetailMargin/DetailVBox/DetailHeader");
        _detailHint = GetNode<Label>(
            "Panel/VBox/Body/DetailPanel/DetailMargin/DetailVBox/DetailHint");

        BuildToggleBar();
        Refresh();
    }

    private void ApplyVisualPolish()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.CityBackdrop,
            new Color(1f, 1f, 1f, 0.86f),
            new Color(0.02f, 0.04f, 0.055f, 0.70f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.20f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.Text = "Cities & Territories";
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        header.AddThemeFontSizeOverride("font_size", 30);

        var vbox = GetNode<VBoxContainer>("Panel/VBox");
        var banner = BuildCityBanner();
        vbox.AddChild(banner);
        vbox.MoveChild(banner, 2);

        var detail = GetNode<PanelContainer>("Panel/VBox/Body/DetailPanel");
        detail.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.90f),
            new Color(0.70f, 0.58f, 0.29f, 0.55f),
            radius: 6));
    }

    private static Control BuildCityBanner()
    {
        var plate = new PanelContainer { CustomMinimumSize = new Vector2(0, 124) };
        plate.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.085f, 0.74f),
            new Color(0.45f, 0.70f, 0.80f, 0.45f),
            radius: 6,
            marginX: 0,
            marginY: 0));

        var texture = UiChrome.LoadTexture(UiChrome.CityBackdrop);
        if (texture is not null)
        {
            var art = new TextureRect
            {
                Texture = texture,
                ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
                StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
                MouseFilter = Control.MouseFilterEnum.Ignore,
            };
            UiChrome.FullRect(art);
            plate.AddChild(art);
        }

        var shade = new ColorRect
        {
            Color = new Color(0f, 0f, 0f, 0.32f),
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(shade);
        plate.AddChild(shade);

        var label = new Label
        {
            Text = "Scout demand, watch rival footprints, and decide where your next store or factory belongs.",
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        label.AddThemeFontSizeOverride("font_size", 20);
        label.AddThemeColorOverride("font_color", new Color(0.94f, 0.96f, 0.92f));
        UiChrome.FullRect(label);
        plate.AddChild(label);

        return plate;
    }

    public override void _Process(double delta)
    {
        if (GameState.TickIfRunning((float)delta))
        {
            Refresh();
        }
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");

    // ------------------------------------------------------------------ toggle bar

    private void BuildToggleBar()
    {
        foreach (var child in _toggleBar.GetChildren()) child.QueueFree();
        _toggleBar.AddChild(new Label { Text = "View:" });
        _toggleBar.AddChild(MakeModeButton("Demographic mix", ViewMode.Mix));
        _toggleBar.AddChild(MakeModeButton("Population size", ViewMode.Population));
        _toggleBar.AddChild(MakeModeButton("Heat: your share", ViewMode.HeatShare));
    }

    private Button MakeModeButton(string text, ViewMode mode)
    {
        var b = new Button { Text = text, ToggleMode = true };
        b.ButtonPressed = _mode == mode;
        b.Pressed += () =>
        {
            _mode = mode;
            BuildToggleBar();
            Refresh();
        };
        return b;
    }

    // ------------------------------------------------------------------ render

    private void Refresh()
    {
        var sub = GetNode<Label>("Panel/VBox/SubLabel");
        var content = GetNode<VBoxContainer>("Panel/VBox/Body/Scroll/Content");
        foreach (var child in content.GetChildren()) child.QueueFree();

        var world = GameState.World;
        if (world is null)
        {
            sub.Text = "No active game.";
            content.AddChild(new Label
            {
                Text = "Open a game first — start a scenario or load a save from the title screen.",
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            BuildOwnerLegend(world: null);
            ClearDetail();
            return;
        }

        sub.Text =
            $"Scenario: {GameState.ScenarioName}  ·  Date: {world.Clock.Now}  ·  " +
            $"Company: {PlayerName(world)}  ·  Cash: {PlayerCash(world).ToString("C0", Money)}";

        BuildOwnerLegend(world);

        var cities = world.Catalog.Cities.Values
            .OrderBy(c => c.Id.Value, StringComparer.Ordinal)
            .ToList();

        if (cities.Count == 0)
        {
            content.AddChild(new Label { Text = "(this scenario defines no cities)" });
            ClearDetail();
            return;
        }

        var columns = cities.Count >= 3 ? 3 : Math.Max(1, cities.Count);
        var grid = new GridContainer { Columns = columns };
        grid.AddThemeConstantOverride("h_separation", 12);
        grid.AddThemeConstantOverride("v_separation", 12);
        grid.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        content.AddChild(grid);

        // Bucket buildings by city once for O(N) per-card rendering.
        var byCity = world.Buildings.Values
            .GroupBy(b => b.City)
            .ToDictionary(g => g.Key, g => g.ToList());

        // Population scaling (log-scale so a 500k metropolis doesn't dwarf a 100k town).
        var maxLogPop = cities.Count == 0
            ? 1.0
            : cities.Max(c => Math.Log10(Math.Max(c.Population, 1)));

        foreach (var city in cities)
        {
            byCity.TryGetValue(city.Id, out var buildings);
            grid.AddChild(BuildCityCard(world, city, buildings ?? new List<BuildingInstance>(), maxLogPop));
        }

        // Refresh the detail pane against the latest world state, if a city is selected.
        if (_selectedCity is { } sel)
        {
            if (world.Catalog.Cities.TryGetValue(sel, out var selected))
            {
                byCity.TryGetValue(sel, out var selBuildings);
                RenderDetail(world, selected, selBuildings ?? new List<BuildingInstance>());
            }
            else
            {
                _selectedCity = null;
                ClearDetail();
            }
        }
    }

    // ------------------------------------------------------------------ owner legend

    private void BuildOwnerLegend(World? world)
    {
        foreach (var child in _ownerLegend.GetChildren()) child.QueueFree();

        if (world is null) return;

        _ownerLegend.AddChild(new Label { Text = "Owners:" });

        // Player first, then AIs in CompanyId order.
        var ordered = OrderedCompanies(world);
        foreach (var company in ordered)
        {
            var color = ColorFor(company.Id, world);
            var swatch = new ColorRect
            {
                Color = color,
                CustomMinimumSize = new Vector2(14, 14),
            };
            _ownerLegend.AddChild(swatch);
            var label = new Label { Text = company.Name };
            label.AddThemeFontSizeOverride("font_size", 12);
            _ownerLegend.AddChild(label);
        }
    }

    private static List<Company> OrderedCompanies(World world)
    {
        var list = new List<Company>();
        if (world.Companies.TryGetValue(GameState.PlayerId, out var player))
        {
            list.Add(player);
        }
        foreach (var c in world.Companies.Values
            .Where(c => !c.Id.Equals(GameState.PlayerId))
            .OrderBy(c => c.Id.Value))
        {
            list.Add(c);
        }
        return list;
    }

    /// <summary>
    /// Resolve a company's display color. Player always gets index 0 (blue);
    /// AIs are slotted into 1..n in CompanyId order so colors stay stable across
    /// ticks and reloads.
    /// </summary>
    private static Color ColorFor(CompanyId id, World world)
    {
        if (id.Equals(GameState.PlayerId)) return OwnerColors[0];

        var aiOrder = world.Companies.Values
            .Where(c => !c.Id.Equals(GameState.PlayerId))
            .OrderBy(c => c.Id.Value)
            .Select(c => c.Id)
            .ToList();
        var idx = aiOrder.IndexOf(id);
        if (idx < 0) return UnknownOwnerColor;
        var slot = 1 + idx;
        return slot < OwnerColors.Length ? OwnerColors[slot] : UnknownOwnerColor;
    }

    // ------------------------------------------------------------------ card

    private PanelContainer BuildCityCard(
        World world,
        City city,
        List<BuildingInstance> buildings,
        double maxLogPop)
    {
        var card = new PanelContainer
        {
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsVertical = Control.SizeFlags.ExpandFill,
            CustomMinimumSize = new Vector2(280, 0),
        };
        card.TooltipText = "City market overview. Use Details to inspect demographics, buildings, and demand.";

        // Heat-map / selection styling on the card frame itself.
        var bg = ResolveCardBackground(world, city);
        if (bg is { } bgColor)
        {
            var style = new StyleBoxFlat
            {
                BgColor = bgColor,
                BorderColor = new Color(0.62f, 0.76f, 0.82f, 0.72f),
                CornerRadiusTopLeft = 4,
                CornerRadiusTopRight = 4,
                CornerRadiusBottomLeft = 4,
                CornerRadiusBottomRight = 4,
            };
            if (_selectedCity is { } sel && sel.Equals(city.Id))
            {
                style.BorderWidthTop = 2;
                style.BorderWidthBottom = 2;
                style.BorderWidthLeft = 2;
                style.BorderWidthRight = 2;
                style.BorderColor = OwnerColors[0];
            }
            card.AddThemeStyleboxOverride("panel", style);
        }
        else
        {
            card.AddThemeStyleboxOverride("panel", UiChrome.Box(
                new Color(0.05f, 0.08f, 0.10f, 0.88f),
                new Color(0.26f, 0.42f, 0.50f, 0.70f),
                radius: 6));
        }

        var margin = new MarginContainer();
        margin.AddThemeConstantOverride("margin_left", 12);
        margin.AddThemeConstantOverride("margin_right", 12);
        margin.AddThemeConstantOverride("margin_top", 12);
        margin.AddThemeConstantOverride("margin_bottom", 12);
        card.AddChild(margin);

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 8);
        margin.AddChild(vbox);

        // Title row: city name + click-to-drill button.
        var titleRow = new HBoxContainer();
        titleRow.AddThemeConstantOverride("separation", 8);
        titleRow.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;

        var name = new Label { Text = city.Name };
        name.AddThemeFontSizeOverride("font_size", 20);
        name.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        titleRow.AddChild(name);

        var openBtn = new Button { Text = "Details" };
        openBtn.CustomMinimumSize = new Vector2(86, 32);
        var capturedId = city.Id;
        openBtn.Pressed += () => OnCitySelected(capturedId);
        titleRow.AddChild(openBtn);
        vbox.AddChild(titleRow);

        // Population — sized to emphasize it in Population mode.
        var popText = $"{city.Id.Value}  ·  Pop {city.Population:N0}";
        var pop = new Label { Text = popText };
        pop.Modulate = new Color(0.8f, 0.8f, 0.9f);
        if (_mode == ViewMode.Population)
        {
            // Scale font size by log10 population, biggest city ~22pt, smallest ~12pt.
            var logP = Math.Log10(Math.Max(city.Population, 1));
            var ratio = maxLogPop > 0 ? (float)(logP / maxLogPop) : 1f;
            var size = (int)Math.Round(12 + 10 * ratio);
            pop.AddThemeFontSizeOverride("font_size", size);
        }
        vbox.AddChild(pop);

        // Geography badges.
        var badges = BuildGeographyBadges(city.Geography);
        if (badges is not null) vbox.AddChild(badges);

        // Demographic stacked strip — always visible, but emphasized in Mix mode.
        vbox.AddChild(BuildDemographicStrip(city, _mode == ViewMode.Mix ? 22 : 12));

        // Per-owner building density bar.
        vbox.AddChild(new HSeparator());
        vbox.AddChild(BuildOwnerDensityBar(world, buildings));

        return card;
    }

    /// <summary>
    /// Pick a card-frame background. In HeatShare mode we shade by the player's
    /// average market share across finished products in the city. Otherwise the
    /// frame is the engine default (transparent — return null).
    /// </summary>
    private Color? ResolveCardBackground(World world, City city)
    {
        if (_mode != ViewMode.HeatShare) return null;

        var share = AveragePlayerShare(world, city);
        // 0.0 → cool dark; 0.5 → warm; 1.0 → hot. Lerp through three stops.
        var cool = new Color(0.10f, 0.12f, 0.18f);
        var warm = new Color(0.40f, 0.30f, 0.10f);
        var hot = new Color(0.80f, 0.45f, 0.15f);
        var t = (float)Math.Clamp(share / 0.5, 0, 1);
        Color baseColor;
        if (share <= 0.5) baseColor = cool.Lerp(warm, t);
        else baseColor = warm.Lerp(hot, (float)Math.Clamp((share - 0.5) / 0.5, 0, 1));
        return baseColor;
    }

    /// <summary>
    /// Mean of the player's market share across every finished product that has
    /// at least one retailer in <paramref name="city"/>. Returns 0 if no retail.
    /// </summary>
    private static double AveragePlayerShare(World world, City city)
    {
        var products = world.Catalog.Products.Values
            .Where(p => p.Tier == ProductTier.Finished)
            .Select(p => p.Id)
            .ToList();

        var retailedHere = new HashSet<ProductId>();
        foreach (var b in world.Buildings.Values)
        {
            if (!b.City.Equals(city.Id)) continue;
            foreach (var slot in b.RetailSlots) retailedHere.Add(slot.Product);
        }

        if (retailedHere.Count == 0) return 0.0;

        double sum = 0;
        foreach (var p in products)
        {
            if (!retailedHere.Contains(p)) continue;
            sum += world.GetMarketShare(GameState.PlayerId, p, city.Id);
        }
        return sum / retailedHere.Count;
    }

    // ------------------------------------------------------------------ demographic strip

    /// <summary>
    /// Stacked horizontal bar — Low (green) / Middle (yellow) / High (purple) —
    /// proportional to <see cref="City.Demographics"/>. Tooltip shows the
    /// human-readable percentages on hover.
    /// </summary>
    private static Control BuildDemographicStrip(City city, int height)
    {
        city.Demographics.TryGetValue(IncomeBracket.Low, out var low);
        city.Demographics.TryGetValue(IncomeBracket.Middle, out var mid);
        city.Demographics.TryGetValue(IncomeBracket.High, out var high);

        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 0);
        row.CustomMinimumSize = new Vector2(0, height);
        row.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;

        AddSegment(row, low,  new Color(0.30f, 0.65f, 0.40f));
        AddSegment(row, mid,  new Color(0.85f, 0.75f, 0.30f));
        AddSegment(row, high, new Color(0.55f, 0.40f, 0.80f));

        row.TooltipText = $"Low {low * 100:F0}%  ·  Mid {mid * 100:F0}%  ·  High {high * 100:F0}%";
        return row;

        static void AddSegment(HBoxContainer parent, double share, Color color)
        {
            var rect = new ColorRect
            {
                Color = color,
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                SizeFlagsStretchRatio = (float)Math.Max(share, 0.0001),
            };
            parent.AddChild(rect);
        }
    }

    // ------------------------------------------------------------------ owner density bar

    private VBoxContainer BuildOwnerDensityBar(World world, List<BuildingInstance> buildings)
    {
        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);

        var header = new Label { Text = $"Buildings ({buildings.Count})" };
        header.AddThemeFontSizeOverride("font_size", 13);
        header.Modulate = new Color(0.8f, 0.8f, 0.8f);
        vbox.AddChild(header);

        if (buildings.Count == 0)
        {
            var empty = new Label { Text = "  (no presence)" };
            empty.Modulate = new Color(0.6f, 0.6f, 0.6f);
            vbox.AddChild(empty);
            return vbox;
        }

        // Group by owner, ordered with player first, then AIs by CompanyId.
        var byOwner = buildings
            .GroupBy(b => b.Owner)
            .ToDictionary(g => g.Key, g => g.Count());

        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 2);
        row.CustomMinimumSize = new Vector2(0, 14);
        row.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;

        foreach (var company in OrderedCompanies(world))
        {
            if (!byOwner.TryGetValue(company.Id, out var count) || count == 0) continue;
            var seg = new ColorRect
            {
                Color = ColorFor(company.Id, world),
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                SizeFlagsStretchRatio = count,
            };
            seg.TooltipText = $"{company.Name}: {count}";
            row.AddChild(seg);
        }
        vbox.AddChild(row);

        // Compact dot grid with one dot per building, colored by owner — gives
        // a visceral sense of how much was built without obscuring tiny owners.
        vbox.AddChild(BuildDotGrid(world, buildings));

        return vbox;
    }

    private static GridContainer BuildDotGrid(World world, List<BuildingInstance> buildings)
    {
        // Dots in CompanyId-then-build-order. Cap at 60 so cards don't grow tall;
        // overflow indicator if more.
        const int MaxDots = 60;
        var ordered = buildings
            .OrderBy(b => b.Owner.Equals(GameState.PlayerId) ? 0 : 1)
            .ThenBy(b => b.Owner.Value)
            .ThenBy(b => b.Id.Value)
            .ToList();

        var columns = Math.Min(15, Math.Max(1, ordered.Count));
        var grid = new GridContainer { Columns = columns };
        grid.AddThemeConstantOverride("h_separation", 2);
        grid.AddThemeConstantOverride("v_separation", 2);

        var shown = Math.Min(MaxDots, ordered.Count);
        for (var i = 0; i < shown; i++)
        {
            var b = ordered[i];
            var dot = new ColorRect
            {
                Color = ColorFor(b.Owner, world),
                CustomMinimumSize = new Vector2(8, 8),
            };
            dot.TooltipText = world.Companies.TryGetValue(b.Owner, out var c) ? c.Name : b.Owner.Value.ToString(CultureInfo.InvariantCulture);
            grid.AddChild(dot);
        }

        if (ordered.Count > MaxDots)
        {
            var more = new Label { Text = $"+{ordered.Count - MaxDots}" };
            more.AddThemeFontSizeOverride("font_size", 10);
            grid.AddChild(more);
        }

        return grid;
    }

    // ------------------------------------------------------------------ geography

    private static HBoxContainer? BuildGeographyBadges(CityGeography g)
    {
        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 6);

        var any = false;
        if (g.Arable)      { row.AddChild(MakeBadge("Arable",   new Color(0.30f, 0.65f, 0.30f))); any = true; }
        if (g.Coastal)     { row.AddChild(MakeBadge("Coastal",  new Color(0.25f, 0.65f, 0.85f))); any = true; }
        if (g.MineralRich) { row.AddChild(MakeBadge("Mineral",  new Color(0.55f, 0.35f, 0.20f))); any = true; }
        if (g.OilRich)     { row.AddChild(MakeBadge("Oil",      new Color(0.10f, 0.10f, 0.10f))); any = true; }

        if (!any)
        {
            var none = new Label { Text = "(no special geography)" };
            none.Modulate = new Color(0.7f, 0.7f, 0.7f);
            row.AddChild(none);
        }

        return row;
    }

    private static PanelContainer MakeBadge(string text, Color background)
    {
        var panel = new PanelContainer();
        var style = new StyleBoxFlat
        {
            BgColor = background,
            ContentMarginLeft = 8,
            ContentMarginRight = 8,
            ContentMarginTop = 2,
            ContentMarginBottom = 2,
            CornerRadiusTopLeft = 4,
            CornerRadiusTopRight = 4,
            CornerRadiusBottomLeft = 4,
            CornerRadiusBottomRight = 4,
        };
        panel.AddThemeStyleboxOverride("panel", style);

        var label = new Label { Text = text };
        label.AddThemeFontSizeOverride("font_size", 12);
        label.AddThemeColorOverride("font_color", new Color(1f, 1f, 1f));
        panel.AddChild(label);
        return panel;
    }

    // ------------------------------------------------------------------ detail panel

    private void OnCitySelected(CityId id)
    {
        _selectedCity = id;
        Refresh();
    }

    private void ClearDetail()
    {
        _detailHeader.Text = "City Detail";
        _detailHint.Text = "Click a city card to drill in.";
        _detailContent.Text = string.Empty;
    }

    private void RenderDetail(World world, City city, List<BuildingInstance> buildings)
    {
        _detailHeader.Text = city.Name;
        _detailHint.Text = $"id={city.Id.Value} · grid {city.Grid.Width}×{city.Grid.Height}";

        var sb = new StringBuilder();

        // Population & demographics
        sb.Append("[b]Population[/b]\n");
        sb.Append($"  Total: {city.Population:N0}\n");
        foreach (var bracket in new[] { IncomeBracket.Low, IncomeBracket.Middle, IncomeBracket.High })
        {
            city.Demographics.TryGetValue(bracket, out var share);
            var headcount = (long)(city.Population * share);
            sb.Append($"  {bracket,-7} {share * 100,5:F1}%  ({headcount:N0})\n");
        }
        sb.Append('\n');

        // Geography & land price
        sb.Append("[b]Geography[/b]\n");
        sb.Append($"  Coastal:      {YesNo(city.Geography.Coastal)}\n");
        sb.Append($"  Arable:       {YesNo(city.Geography.Arable)}\n");
        sb.Append($"  Mineral-rich: {YesNo(city.Geography.MineralRich)}\n");
        sb.Append($"  Oil-rich:     {YesNo(city.Geography.OilRich)}\n");
        sb.Append($"  Base land:    {city.BaseLandPrice.ToString("C0", Money)} / unit\n\n");

        // Buildings grouped by owner.
        sb.Append($"[b]Buildings ({buildings.Count})[/b]\n");
        if (buildings.Count == 0)
        {
            sb.Append("  (no buildings constructed here yet)\n");
        }
        else
        {
            foreach (var company in OrderedCompanies(world))
            {
                var owned = buildings.Where(b => b.Owner.Equals(company.Id)).ToList();
                if (owned.Count == 0) continue;

                var color = ColorFor(company.Id, world);
                var hex = ColorHex(color);
                sb.Append($"  [color=#{hex}]■[/color] [b]{Escape(company.Name)}[/b] — {owned.Count}\n");

                // Group its buildings by type.
                var counts = new Dictionary<string, int>(StringComparer.Ordinal);
                foreach (var b in owned)
                {
                    var type = world.Catalog.BuildingType(b.TypeId);
                    counts.TryGetValue(type.Name, out var c);
                    counts[type.Name] = c + 1;
                }
                foreach (var kv in counts.OrderByDescending(k => k.Value).ThenBy(k => k.Key, StringComparer.Ordinal))
                {
                    sb.Append($"      {kv.Value} × {Escape(kv.Key)}\n");
                }
            }
        }
        sb.Append('\n');

        // Total monthly demand (units/month) for finished products in this city.
        sb.Append("[b]Monthly Demand (finished goods)[/b]\n");
        var demands = ComputeDemandPerProduct(world, city);
        if (demands.Count == 0)
        {
            sb.Append("  (no finished products defined)\n");
        }
        else
        {
            // Show the top 8 by demand to keep the panel readable.
            foreach (var (name, units) in demands.Take(8))
            {
                sb.Append($"  {Escape(name),-22} {units,12:N0} units/mo\n");
            }
            if (demands.Count > 8)
            {
                sb.Append($"  … and {demands.Count - 8} more\n");
            }
        }

        _detailContent.Text = sb.ToString();
    }

    /// <summary>
    /// Finished-product demand per month for <paramref name="city"/>: for each
    /// finished product, weight per-capita demand by the city's income mix and
    /// multiply by population. Pure upper bound — ignores price, stockouts, etc.
    /// </summary>
    private static List<(string Name, double Units)> ComputeDemandPerProduct(World world, City city)
    {
        var results = new List<(string Name, double Units)>();
        foreach (var product in world.Catalog.Products.Values.Where(p => p.Tier == ProductTier.Finished))
        {
            var perCapita = 0.0;
            foreach (var bracket in new[] { IncomeBracket.Low, IncomeBracket.Middle, IncomeBracket.High })
            {
                product.BaseDemandPerCapita.TryGetValue(bracket, out var per);
                city.Demographics.TryGetValue(bracket, out var share);
                perCapita += per * share;
            }
            var monthly = perCapita * city.Population;
            if (monthly > 0) results.Add((product.Name, monthly));
        }
        return results.OrderByDescending(r => r.Units).ToList();
    }

    private static string YesNo(bool b) => b ? "yes" : "no";

    /// <summary>BBCode-safe escaping of bracket markers.</summary>
    private static string Escape(string s) => s.Replace("[", "[lb]").Replace("]", "[rb]");

    private static string ColorHex(Color c)
    {
        var r = (int)Math.Round(Math.Clamp(c.R, 0, 1) * 255);
        var g = (int)Math.Round(Math.Clamp(c.G, 0, 1) * 255);
        var b = (int)Math.Round(Math.Clamp(c.B, 0, 1) * 255);
        return $"{r:X2}{g:X2}{b:X2}";
    }

    // ------------------------------------------------------------------ helpers

    private static string PlayerName(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Name : "(unknown)";

    private static decimal PlayerCash(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Cash : 0m;
}
