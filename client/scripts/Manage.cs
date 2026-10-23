using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Godot;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Human gameplay controls. Four tabs:
/// <list type="bullet">
///   <item>Build — construct a new building, with inline cost preview, affordability
///         badge, and category filter.</item>
///   <item>Buildings — owned-buildings list with at-a-glance cashflow, sortable by
///         id / city / category / net cashflow.</item>
///   <item>Campaigns — start / update / cancel ad campaigns; preview estimated
///         monthly brand-point lift before committing.</item>
///   <item>Patents — Phase 3.62: view your active patents and grant/revoke licenses
///         to competitors, plus an informational view of rival patents that block
///         your R&amp;D until they expire.</item>
/// </list>
/// All tabs auto-refresh when the sim ticks (Reports.cs pattern).
/// UI is built programmatically in <see cref="_Ready"/> so the .tscn stays tiny.
/// </summary>
public partial class Manage : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    private Label? _statusLabel;

    // -------- Build-tab live state (preserved across re-renders / ticks)
    private string _buildCategoryFilter = "all";
    private int _buildSelectedTypeIndex; // index into the FILTERED type list

    // -------- Buildings-tab live state
    private enum BuildingsSortMode { ById, ByCity, ByCategory, ByCashflow }
    private BuildingsSortMode _buildingsSort = BuildingsSortMode.ById;

    // Tracks the last simulated month we rendered, so _Process re-renders only
    // when the sim has advanced.
    private int _lastRenderedMonthIndex = int.MinValue;

    public override void _Ready()
    {
        ApplyVisualPolish();

        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;
        _statusLabel = GetNode<Label>("Panel/VBox/StatusLabel");

        var sub = GetNode<Label>("Panel/VBox/SubLabel");
        var world = GameState.World;
        if (world is null)
        {
            sub.Text = "No active game.";
            return;
        }

        _lastRenderedMonthIndex = world.Clock.Now.AsMonthIndex();
        UpdateSub(world);

        BuildBuildTab(world);
        RefreshBuildingsTab(world);
        RefreshCampaignsTab(world);
        RefreshPatentsTab(world);

        WireTooltips();
    }

    private void ApplyVisualPolish()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.82f),
            new Color(0.02f, 0.04f, 0.055f, 0.72f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.18f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.Text = "Build & Operate";
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        header.AddThemeFontSizeOverride("font_size", 30);
    }

    /// <summary>
    /// Phase 3.56 — attaches hover tooltips to the ~dozen highest-value controls
    /// that explain non-obvious mechanics (cost tunables, cashflow attribution,
    /// media-bonus multipliers, brand-decay rate). Called from <see cref="_Ready"/>
    /// for stable Build-tab controls; Buildings/Campaigns refresh helpers rewire
    /// their own header tooltips because those tabs re-render every tick.
    /// </summary>
    private void WireTooltips()
    {
        var back = GetNode<Button>("Panel/VBox/BackButton");
        Tooltip.Attach(back, "[b]Back[/b] to the main menu. Simulation continues to advance in the background while you're in a sub-screen.");

        if (_buildFilterPicker is not null)
            Tooltip.Attach(_buildFilterPicker, "[b]Category filter[/b] — narrows the building list to a single role: production, retail, warehouse, extraction (farm / mine / well), media, or R&D.");

        if (_buildCityPicker is not null)
            Tooltip.Attach(_buildCityPicker, "[b]City[/b] where the building will be placed. Rent, demand, and media reach all scale with the city's population and local market conditions.");

        if (_buildTypePicker is not null)
            RefreshBuildTypeTooltip();

        if (_buildProductPicker is not null)
            Tooltip.Attach(_buildProductPicker, "[b]First slot product[/b] — configures the building's first slot in the same step as construction. Pick (skip) to configure slots later from the Inspector.");

        if (_buildPriceSpin is not null)
            Tooltip.Attach(_buildPriceSpin, "[b]Retail price[/b] per unit. Higher prices mean higher per-unit margin but lower demand — demand elasticity and local income set the sweet spot.");

        if (_buildRestockSpin is not null)
            Tooltip.Attach(_buildRestockSpin, "[b]Restock target[/b] — warehouses refill toward this quantity each month; retail slots auto-reorder to reach this on-shelf stock.");
    }

    /// <summary>
    /// Rebuilds the tooltip on the building-type picker whenever the selection
    /// changes so the cost/opex text reflects the current pick. Cheap — the
    /// framework's <see cref="Tooltip.Detach"/> is idempotent.
    /// </summary>
    private void RefreshBuildTypeTooltip()
    {
        if (_buildTypePicker is null) return;

        if (_buildTypePicker.Selected < 0 || _buildFilteredTypes.Count == 0
            || _buildTypePicker.Selected >= _buildFilteredTypes.Count)
        {
            Tooltip.Attach(_buildTypePicker,
                "[b]Building type[/b] — picks the blueprint to construct. Each row shows [category] name (construction cost · monthly opex).");
            return;
        }

        var t = _buildFilteredTypes[_buildTypePicker.Selected];
        Tooltip.Attach(_buildTypePicker,
            $"[b]{t.Name}[/b] — costs {t.ConstructionCost.ToString("C0", Money)} to construct, "
          + $"{t.MonthlyOperatingCost.ToString("C0", Money)}/mo opex starting next tick. "
          + $"Category [i]{t.Category}[/i]; {t.MaxUnits} slot{(t.MaxUnits == 1 ? "" : "s")} available.");
    }

    public override void _Process(double delta)
    {
        // Mirror Reports.cs: tick and re-render on month boundary.
        var advanced = GameState.TickIfRunning((float)delta);
        var world = GameState.World;
        if (world is null) return;

        var nowIdx = world.Clock.Now.AsMonthIndex();
        if (advanced || nowIdx != _lastRenderedMonthIndex)
        {
            _lastRenderedMonthIndex = nowIdx;
            UpdateSub(world);
            // Build form's choice state lives in widget objects we created; simply
            // re-render the dynamic, data-driven panels.
            RefreshBuildingsTab(world);
            RefreshCampaignsTab(world);
            RefreshPatentsTab(world);
            // Refresh Build tab affordability badge — cheap.
            RefreshBuildAffordability(world);
        }
    }

    // ====================================================== Build tab

    private const string BuildCategoryAll = "all";

    private static readonly (string Key, string Label)[] BuildCategoryFilters =
    {
        (BuildCategoryAll,    "All"),
        ("production",        "Production / Factory"),
        ("retail",            "Retail"),
        ("warehouse",         "Warehouse / Logistics"),
        ("extraction",        "Extraction (farm / mine / well)"),
        ("media",             "Media"),
        ("rd_center",         "R&D"),
    };

    private OptionButton? _buildFilterPicker;
    private OptionButton? _buildTypePicker;
    private OptionButton? _buildCityPicker;
    private OptionButton? _buildProductPicker;
    private SpinBox? _buildPriceSpin;
    private SpinBox? _buildRestockSpin;
    private RichTextLabel? _buildPreviewLabel;
    private Label? _buildAffordBadge;

    /// <summary>Cached filtered-type list backing _buildTypePicker; rebuilt when filter changes.</summary>
    private List<BuildingType> _buildFilteredTypes = new();
    private List<City> _buildCities = new();

    private void BuildBuildTab(World world)
    {
        var scroll = GetNode<ScrollContainer>("Panel/VBox/Tabs/Build");
        // Clear (in case _Ready is called twice on a scene reload).
        foreach (var child in scroll.GetChildren()) child.QueueFree();

        var vbox = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        vbox.AddThemeConstantOverride("separation", 8);
        scroll.AddChild(vbox);

        vbox.AddChild(new Label
        {
            Text = "Construct buildings, configure their first operating slot, then inspect performance as the market reacts.",
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        });

        vbox.AddChild(BuildStarterPlans(world));

        var grid = new GridContainer { Columns = 2 };
        grid.AddThemeConstantOverride("h_separation", 12);
        grid.AddThemeConstantOverride("v_separation", 6);
        vbox.AddChild(grid);

        // Category filter dropdown
        grid.AddChild(new Label { Text = "Category filter:" });
        _buildFilterPicker = new OptionButton();
        foreach (var f in BuildCategoryFilters) _buildFilterPicker.AddItem(f.Label);
        _buildFilterPicker.Selected = 0;
        grid.AddChild(_buildFilterPicker);

        // City dropdown
        grid.AddChild(new Label { Text = "City:" });
        _buildCityPicker = new OptionButton();
        _buildCities = world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal).ToList();
        foreach (var c in _buildCities) _buildCityPicker.AddItem(c.Name);
        grid.AddChild(_buildCityPicker);

        // Building type dropdown
        grid.AddChild(new Label { Text = "Building:" });
        _buildTypePicker = new OptionButton();
        grid.AddChild(_buildTypePicker);

        // Product dropdown
        grid.AddChild(new Label { Text = "First slot product:" });
        _buildProductPicker = new OptionButton();
        grid.AddChild(_buildProductPicker);

        // Retail-only: price + restock
        grid.AddChild(new Label { Text = "Price (retail only):" });
        _buildPriceSpin = new SpinBox { MinValue = 0.01, MaxValue = 1_000_000, Step = 0.01, Value = 1.80 };
        grid.AddChild(_buildPriceSpin);

        grid.AddChild(new Label { Text = "Restock target (retail / warehouse):" });
        _buildRestockSpin = new SpinBox { MinValue = 0, MaxValue = 100_000_000, Step = 1000, Value = 500_000 };
        grid.AddChild(_buildRestockSpin);

        // Cost-preview block: rich label + affordability badge.
        _buildPreviewLabel = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        vbox.AddChild(_buildPreviewLabel);

        _buildAffordBadge = new Label { Text = "" };
        _buildAffordBadge.AddThemeFontSizeOverride("font_size", 14);
        vbox.AddChild(_buildAffordBadge);

        // Wire up signals.
        _buildFilterPicker.ItemSelected += idx =>
        {
            _buildCategoryFilter = BuildCategoryFilters[idx].Key;
            RebuildTypePicker(world);
        };
        _buildTypePicker.ItemSelected += _ =>
        {
            RebuildProductPicker(world);
            RefreshBuildAffordability(world);
            RefreshBuildTypeTooltip();
        };

        // Initial population.
        RebuildTypePicker(world);

        var constructButton = new Button { Text = "Construct" };
        vbox.AddChild(constructButton);
        Tooltip.Attach(constructButton,
            "[b]Construct[/b] the selected building in the chosen city. Construction cost is deducted immediately; monthly opex begins next tick. The first slot is configured in the same step if a product is picked.");
        Tooltip.Attach(_buildAffordBadge,
            "[b]Affordability[/b] — compares your cash on hand to the selected type's construction cost. Red means you're short by the shown amount.");
        constructButton.Pressed += () =>
        {
            try
            {
                if (_buildFilteredTypes.Count == 0)
                {
                    SetStatus("No building type matches the current filter.", isError: true);
                    return;
                }
                if (_buildCityPicker!.Selected < 0 || _buildTypePicker!.Selected < 0)
                {
                    SetStatus("Pick a city and a building type first.", isError: true);
                    return;
                }
                var selectedCity = _buildCities[_buildCityPicker.Selected];
                var selectedType = _buildFilteredTypes[_buildTypePicker.Selected];
                OnConstruct(
                    world,
                    selectedCity.Id,
                    selectedType.Id,
                    selectedType.Category,
                    _buildProductPicker!,
                    (decimal)_buildPriceSpin!.Value,
                    _buildRestockSpin!.Value);
            }
            catch (Exception ex)
            {
                SetStatus($"Construction failed: {ex.Message}", isError: true);
            }
        };
    }

    private void RebuildTypePicker(World world)
    {
        if (_buildTypePicker is null) return;

        _buildFilteredTypes = world.Catalog.BuildingTypes.Values
            .Where(t => MatchesCategoryFilter(t, _buildCategoryFilter))
            .OrderBy(t => t.Category, StringComparer.Ordinal)
            .ThenBy(t => t.Name, StringComparer.Ordinal)
            .ToList();

        _buildTypePicker.Clear();
        foreach (var t in _buildFilteredTypes)
        {
            // Each row already shows category prefix so users can scan.
            _buildTypePicker.AddItem(
                $"[{t.Category}] {t.Name}  ({t.ConstructionCost.ToString("C0", Money)} · {t.MonthlyOperatingCost.ToString("C0", Money)}/mo)");
        }
        if (_buildFilteredTypes.Count > 0)
        {
            _buildTypePicker.Selected = 0;
        }
        RebuildProductPicker(world);
        RefreshBuildAffordability(world);
    }

    private static bool MatchesCategoryFilter(BuildingType t, string filter)
    {
        if (filter == BuildCategoryAll) return true;
        if (filter == "extraction") return IsExtractionCategory(t.Category);
        if (filter == "retail") return t.Retail || t.Category == "retail";
        if (filter == "warehouse")
            return t.Category is "warehouse" or "distribution_center" or "seaport" or "freight_yard";
        if (filter == "media")
            return t.Category is "media" or "tv_station" or "radio_station" or "newspaper_publisher" or "magazine_publisher";
        if (filter == "rd_center") return t.Category == "rd_center";
        if (filter == "production") return t.ProducibleTiers.Count > 0 && !t.Retail && !IsExtractionCategory(t.Category);
        return false;
    }

    private void RebuildProductPicker(World world)
    {
        if (_buildTypePicker is null || _buildProductPicker is null) return;

        _buildProductPicker.Clear();
        _buildProductPicker.AddItem("(skip — leave unconfigured)");

        if (_buildTypePicker.Selected < 0 || _buildFilteredTypes.Count == 0) return;
        var selectedType = _buildFilteredTypes[_buildTypePicker.Selected];

        foreach (var p in ProductsEligibleFor(world, selectedType))
        {
            _buildProductPicker.AddItem(p.Id.Value);
        }
    }

    /// <summary>Updates the cost-preview RichTextLabel + affordability badge for the
    /// currently-selected building type. Cheap; safe to call every tick.</summary>
    private void RefreshBuildAffordability(World world)
    {
        if (_buildPreviewLabel is null || _buildAffordBadge is null) return;
        if (_buildTypePicker is null || _buildTypePicker.Selected < 0
            || _buildFilteredTypes.Count == 0)
        {
            _buildPreviewLabel.Text = "[i]Select a building type for cost preview.[/i]";
            _buildAffordBadge.Text = "";
            return;
        }

        var t = _buildFilteredTypes[_buildTypePicker.Selected];
        var cash = PlayerCash(world);

        var headcount = t.TargetHeadcount is null
            ? "no staff"
            : $"{t.TargetHeadcount.Min:N0}–{t.TargetHeadcount.Max:N0} staff/slot";

        _buildPreviewLabel.Text =
            $"[b]{t.Name}[/b]  [color=gray]({t.Category})[/color]\n"
          + $"  Construction: [b]{t.ConstructionCost.ToString("C0", Money)}[/b]   "
          + $"  Monthly opex: [b]{t.MonthlyOperatingCost.ToString("C0", Money)}[/b]\n"
          + $"  Capacity: [b]{t.MaxUnits} slot{(t.MaxUnits == 1 ? "" : "s")}[/b]   "
          + $"  Workforce: {headcount}";

        if (cash >= t.ConstructionCost)
        {
            _buildAffordBadge.Text = $"  [Affordable — cash on hand {cash.ToString("C0", Money)}]";
            _buildAffordBadge.Modulate = new Color(0.55f, 1f, 0.55f);
        }
        else
        {
            var shortfall = t.ConstructionCost - cash;
            _buildAffordBadge.Text =
                $"  [Insufficient cash — short {shortfall.ToString("C0", Money)} (have {cash.ToString("C0", Money)})]";
            _buildAffordBadge.Modulate = new Color(1f, 0.55f, 0.55f);
        }
    }

    private static List<Product> ProductsEligibleFor(World world, BuildingType type)
    {
        if (IsExtractionCategory(type.Category))
        {
            return world.Catalog.Products.Values
                .Where(p => p.Tier == ProductTier.Raw
                         && p.Extraction is not null
                         && p.Extraction.SourceCategory == type.Category)
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
                .ToList();
        }
        if (type.Retail)
        {
            return world.Catalog.Products.Values
                .Where(p => p.Tier == ProductTier.Finished)
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
                .ToList();
        }
        if (type.ProducibleTiers.Count > 0)
        {
            return world.Catalog.Products.Values
                .Where(p => p.Recipe is not null && type.ProducibleTiers.Contains(p.Tier))
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
                .ToList();
        }
        if (type.Category == "rd_center")
        {
            return world.Catalog.Products.Values
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
                .ToList();
        }
        if (type.Category is "warehouse" or "distribution_center" or "seaport" or "freight_yard")
        {
            return world.Catalog.Products.Values
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
                .ToList();
        }
        return new List<Product>();
    }

    private static bool IsExtractionCategory(string category)
        => category is "farm" or "livestock_farm" or "plantation" or "mine"
            or "oil_well" or "logging_camp" or "quarry";

    private void OnConstruct(
        World world,
        CityId cityId,
        BuildingTypeId typeId,
        string typeCategory,
        OptionButton productPicker,
        decimal price,
        double restockTarget)
    {
        var building = world.Construct(GameState.PlayerId, typeId, cityId);

        // Item 0 is "(skip)"; anything else is a product id by label.
        if (productPicker.Selected > 0)
        {
            var productLabel = productPicker.GetItemText(productPicker.Selected);
            var productId = new ProductId(productLabel);

            if (IsExtractionCategory(typeCategory))
            {
                world.ConfigureExtractionSlot(building.Id, 0, productId);
            }
            else if (world.Catalog.BuildingType(typeId).Retail)
            {
                world.ConfigureRetailSlot(building.Id, 0, productId, price, restockTarget);
            }
            else if (typeCategory is "warehouse" or "distribution_center" or "seaport" or "freight_yard")
            {
                world.ConfigureWarehouseSlot(building.Id, 0, productId, restockTarget);
            }
            else if (typeCategory == "rd_center")
            {
                world.ConfigureResearchSlot(building.Id, 0, productId);
            }
            else if (world.Catalog.BuildingType(typeId).ProducibleTiers.Count > 0)
            {
                world.ConfigureProductionSlot(building.Id, 0, productId);
            }
        }

        SetStatus($"Built {world.Catalog.BuildingType(typeId).Name} in {cityId} (B{building.Id.Value}).", isError: false);
        ScorePopup.Spawn(ScreenCenter(), -world.Catalog.BuildingType(typeId).ConstructionCost);
        SoundManager.PlaySfx("build_construct");

        RefreshBuildingsTab(world);
        UpdateSub(world);
        RefreshBuildAffordability(world);
    }

    private Control BuildStarterPlans(World world)
    {
        var panel = new PanelContainer();
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.88f),
            new Color(0.70f, 0.58f, 0.29f, 0.55f),
            radius: 6,
            marginX: 12,
            marginY: 10));

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 8);
        panel.AddChild(vbox);

        vbox.AddChild(UiChrome.SectionTitle("Starter Investments"));

        var desc = new Label
        {
            Text = "Use these to quickly create a playable position. Each one builds and configures slot 1 immediately.",
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        desc.Modulate = UiChrome.Muted;
        vbox.AddChild(desc);

        var grid = new GridContainer
        {
            Columns = 4,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        grid.AddThemeConstantOverride("h_separation", 8);
        grid.AddThemeConstantOverride("v_separation", 8);
        vbox.AddChild(grid);

        AddPlanButton(grid, "Corner Store", "convenience_store", "soft_drink", 2.25m, 250_000, world);
        AddPlanButton(grid, "Bread Aisle", "supermarket", "bread", 4.25m, 350_000, world);
        AddPlanButton(grid, "Warehouse Hub", "warehouse_small", "bread", 0m, 500_000, world);
        AddPlanButton(grid, "Soft Drink Lab", "rd_center", "soft_drink", 0m, 0, world);

        return panel;
    }

    private void AddPlanButton(
        GridContainer parent,
        string label,
        string typeId,
        string productId,
        decimal price,
        double restockTarget,
        World world)
    {
        var button = new Button
        {
            Text = label,
            CustomMinimumSize = new Vector2(0, 38),
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        Tooltip.Attach(button,
            $"[b]{label}[/b] — builds {typeId} in the largest city and configures slot 1 for {productId}.");
        button.Pressed += () => BuildPreset(world, new BuildingTypeId(typeId), new ProductId(productId), price, restockTarget);
        parent.AddChild(button);
    }

    private void BuildPreset(
        World world,
        BuildingTypeId typeId,
        ProductId productId,
        decimal price,
        double restockTarget)
    {
        try
        {
            var type = world.Catalog.BuildingType(typeId);
            _ = world.Catalog.Product(productId);
            var city = world.Catalog.Cities.Values
                .OrderByDescending(c => c.Population)
                .FirstOrDefault();
            if (city is null)
            {
                SetStatus("No cities are available in this scenario.", isError: true);
                return;
            }

            var building = world.Construct(GameState.PlayerId, typeId, city.Id);
            if (type.Retail)
            {
                world.ConfigureRetailSlot(building.Id, 0, productId, price, restockTarget);
            }
            else if (type.Category is "warehouse" or "distribution_center" or "seaport" or "freight_yard")
            {
                world.ConfigureWarehouseSlot(building.Id, 0, productId, restockTarget);
            }
            else if (type.Category == "rd_center")
            {
                world.ConfigureResearchSlot(building.Id, 0, productId);
            }
            else if (IsExtractionCategory(type.Category))
            {
                world.ConfigureExtractionSlot(building.Id, 0, productId);
            }
            else if (type.ProducibleTiers.Count > 0)
            {
                world.ConfigureProductionSlot(building.Id, 0, productId);
            }

            SetStatus($"Built starter plan: {type.Name} in {city.Name} (B{building.Id.Value}).", isError: false);
            ScorePopup.Spawn(ScreenCenter(), -type.ConstructionCost);
            SoundManager.PlaySfx("build_construct");
            RefreshBuildingsTab(world);
            RefreshCampaignsTab(world);
            UpdateSub(world);
            RefreshBuildAffordability(world);
        }
        catch (Exception ex)
        {
            SetStatus($"Starter plan failed: {ex.Message}", isError: true);
        }
    }

    // ====================================================== Buildings tab

    private void RefreshBuildingsTab(World world)
    {
        var scroll = GetNode<ScrollContainer>("Panel/VBox/Tabs/Buildings");
        foreach (var child in scroll.GetChildren()) child.QueueFree();

        var vbox = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        vbox.AddThemeConstantOverride("separation", 8);
        scroll.AddChild(vbox);

        // ---- sort bar
        var sortBar = new HBoxContainer();
        sortBar.AddThemeConstantOverride("separation", 8);
        vbox.AddChild(sortBar);
        sortBar.AddChild(new Label { Text = "Sort:" });
        var sortPicker = new OptionButton();
        sortPicker.AddItem("By id");
        sortPicker.AddItem("By city");
        sortPicker.AddItem("By category");
        sortPicker.AddItem("By net cashflow");
        sortPicker.Selected = (int)_buildingsSort;
        sortPicker.ItemSelected += idx =>
        {
            _buildingsSort = (BuildingsSortMode)idx;
            RefreshBuildingsTab(world);
        };
        sortBar.AddChild(sortPicker);
        Tooltip.Attach(sortPicker,
            "[b]Sort order[/b] — id / city / category / net cashflow. Cashflow is this month's revenue minus opex, attributed via [code]LedgerEntry.Building[/code].");

        // ---- compute per-building cashflow once (current month only)
        var nowIdx = world.Clock.Now.AsMonthIndex();
        var thisMonthFlow = new Dictionary<BuildingInstanceId, decimal>();
        foreach (var entry in world.Ledger.Entries)
        {
            if (entry.Building is null) continue;
            if (entry.Date.AsMonthIndex() != nowIdx) continue;
            var bid = entry.Building.Value;
            thisMonthFlow.TryGetValue(bid, out var sum);
            thisMonthFlow[bid] = sum + entry.Amount; // signed (inflow positive)
        }

        var ownedQuery = world.Buildings.Values.Where(b => b.Owner == GameState.PlayerId);

        // Default ordering before sort: by integer id (deterministic).
        var owned = ownedQuery.OrderBy(b => b.Id.Value).ToList();

        owned = _buildingsSort switch
        {
            BuildingsSortMode.ById       => owned,
            BuildingsSortMode.ByCity     => owned.OrderBy(b => b.City.Value, StringComparer.Ordinal)
                                                  .ThenBy(b => b.Id.Value).ToList(),
            BuildingsSortMode.ByCategory => owned.OrderBy(b => world.Catalog.BuildingType(b.TypeId).Category, StringComparer.Ordinal)
                                                  .ThenBy(b => b.Id.Value).ToList(),
            BuildingsSortMode.ByCashflow => owned.OrderByDescending(b => thisMonthFlow.TryGetValue(b.Id, out var f) ? f : 0m)
                                                  .ThenBy(b => b.Id.Value).ToList(),
            _ => owned,
        };

        if (owned.Count == 0)
        {
            vbox.AddChild(new Label { Text = "You don't own any buildings yet. Use the Build tab to get started." });
            return;
        }

        // ---- summary strip
        var totalFlow = owned.Sum(b => thisMonthFlow.TryGetValue(b.Id, out var f) ? f : 0m);
        var totalOpex = owned.Sum(b => world.Catalog.BuildingType(b.TypeId).MonthlyOperatingCost);
        var summary = new Label
        {
            Text = $"  {owned.Count} building{(owned.Count == 1 ? "" : "s")}  ·  "
                 + $"current-month net cashflow {totalFlow.ToString("C0", Money)}  ·  "
                 + $"baseline opex {totalOpex.ToString("C0", Money)}/mo",
        };
        summary.Modulate = new Color(0.75f, 0.85f, 1.00f);
        vbox.AddChild(summary);

        foreach (var b in owned)
        {
            var type = world.Catalog.BuildingType(b.TypeId);
            var row = new PanelContainer();
            var rowVbox = new VBoxContainer();
            rowVbox.AddThemeConstantOverride("separation", 4);
            row.AddChild(rowVbox);

            int slotsUsed = b.ProductionSlots.Count + b.ExtractionSlots.Count
                          + b.WarehouseSlots.Count + b.RetailSlots.Count + b.ResearchSlots.Count;

            var head = new Label
            {
                Text = $"B{b.Id.Value}  ·  {type.Name}  ·  {b.City.Value}  ·  "
                     + $"slots {slotsUsed}/{type.MaxUnits}  ·  [{type.Category}]",
            };
            head.AddThemeFontSizeOverride("font_size", 16);
            rowVbox.AddChild(head);

            var slotSummary = SlotSummary(b);
            rowVbox.AddChild(new Label { Text = slotSummary, AutowrapMode = TextServer.AutowrapMode.WordSmart });

            // Cashflow row: this-month and baseline opex
            var thisFlow = thisMonthFlow.TryGetValue(b.Id, out var f) ? f : 0m;
            var cfLabel = new Label
            {
                Text = $"  This month: {thisFlow.ToString("C0", Money)}   ·   "
                     + $"Baseline opex: -{type.MonthlyOperatingCost.ToString("C0", Money)}/mo",
            };
            cfLabel.Modulate = thisFlow >= 0
                ? new Color(0.7f, 1f, 0.7f)
                : new Color(1f, 0.75f, 0.55f);
            rowVbox.AddChild(cfLabel);

            // Top-3 inventory snippet
            var inv = b.Inventory.EntriesWithCost
                .Where(e => e.Quantity > 0)
                .OrderByDescending(e => e.Quantity)
                .Take(3)
                .ToList();
            if (inv.Count > 0)
            {
                var invText = string.Join(", ", inv.Select(e => $"{e.Product.Value} ×{e.Quantity:N0}"));
                rowVbox.AddChild(new Label { Text = $"  Stock: {invText}" });
            }

            var inspectButton = new Button { Text = "Inspect" };
            var captured = b.Id;
            inspectButton.Pressed += () =>
            {
                GameState.SelectedBuilding = captured;
                GetTree().ChangeSceneToFile("res://scenes/BuildingInspector.tscn");
            };
            Tooltip.Attach(inspectButton,
                "[b]Inspect[/b] — open BuildingInspector for full slot breakdown, per-product inventory, headcount, and reconfiguration controls.");
            rowVbox.AddChild(inspectButton);

            vbox.AddChild(row);
        }
    }

    private static string SlotSummary(BuildingInstance b)
    {
        var parts = new List<string>();
        foreach (var s in b.ProductionSlots) parts.Add($"produces {s.Product.Value}");
        foreach (var s in b.ExtractionSlots) parts.Add($"extracts {s.Product.Value}");
        foreach (var s in b.WarehouseSlots)  parts.Add($"stores {s.Product.Value} (target {s.TargetStock:N0})");
        foreach (var s in b.RetailSlots)     parts.Add($"sells {s.Product.Value} @ ${s.Price:F2} (restock {s.RestockTarget:N0})");
        foreach (var s in b.ResearchSlots)   parts.Add($"researches {s.Product.Value}");
        return parts.Count == 0 ? "  (unconfigured)" : "  " + string.Join("  ·  ", parts);
    }

    // ====================================================== Campaigns tab

    private void RefreshCampaignsTab(World world)
    {
        var scroll = GetNode<ScrollContainer>("Panel/VBox/Tabs/Campaigns");
        foreach (var child in scroll.GetChildren()) child.QueueFree();

        var vbox = new VBoxContainer { SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
        vbox.AddThemeConstantOverride("separation", 8);
        scroll.AddChild(vbox);

        // ---- new campaign form
        vbox.AddChild(new Label { Text = "Start or update an ad campaign" });

        var grid = new GridContainer { Columns = 2 };
        grid.AddThemeConstantOverride("h_separation", 12);
        grid.AddThemeConstantOverride("v_separation", 6);
        vbox.AddChild(grid);

        grid.AddChild(new Label { Text = "Product:" });
        var productPicker = new OptionButton();
        var finished = world.Catalog.Products.Values
            .Where(p => p.Tier == ProductTier.Finished)
            .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
            .ToList();
        foreach (var p in finished) productPicker.AddItem(p.Id.Value);
        grid.AddChild(productPicker);

        grid.AddChild(new Label { Text = "City:" });
        var cityPicker = new OptionButton();
        var cities = world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal).ToList();
        foreach (var c in cities) cityPicker.AddItem(c.Name);
        grid.AddChild(cityPicker);

        grid.AddChild(new Label { Text = "Channel:" });
        var channelPicker = new OptionButton();
        // Order matches AdChannel enum: TV=0, Newspaper=1, Magazine=2, Radio=3.
        channelPicker.AddItem("TV");
        channelPicker.AddItem("Newspaper");
        channelPicker.AddItem("Magazine");
        channelPicker.AddItem("Radio");
        grid.AddChild(channelPicker);
        Tooltip.Attach(channelPicker,
            $"[b]Ad channel[/b] — cost-per-brand-point varies: TV {SimulationConstants.TvAdCostPerPoint.ToString("C0", Money)}, "
          + $"Radio {SimulationConstants.RadioAdCostPerPoint.ToString("C0", Money)}, "
          + $"Newspaper {SimulationConstants.NewspaperAdCostPerPoint.ToString("C0", Money)}, "
          + $"Magazine {SimulationConstants.MagazineAdCostPerPoint.ToString("C0", Money)}. "
          + "Owning a publisher of the matching channel in the same city grants a media-ownership discount.");

        grid.AddChild(new Label { Text = "Monthly budget (0 to cancel):" });
        var budgetSpin = new SpinBox { MinValue = 0, MaxValue = 10_000_000, Step = 5000, Value = 50_000 };
        grid.AddChild(budgetSpin);
        Tooltip.Attach(budgetSpin,
            "[b]Monthly budget[/b] — cash spent each tick. Brand-point lift = (budget × media-bonus ÷ cost-per-point) × saturation, where saturation = 1 − (current brand ÷ 100). Set to 0 to cancel.");

        // Estimated-reach preview line, recomputed on any control change.
        var reachLabel = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        vbox.AddChild(reachLabel);
        Tooltip.Attach(reachLabel,
            $"[b]Reach preview[/b] — projected brand-awareness after next tick. Diminishing returns apply as brand nears 100. With no active campaign, brand decays {SimulationConstants.BrandDecayRate * 100:F0}%/month.");

        void UpdateReach()
        {
            if (productPicker.Selected < 0 || cityPicker.Selected < 0 || finished.Count == 0)
            {
                reachLabel.Text = "";
                return;
            }
            var product = finished[productPicker.Selected].Id;
            var city = cities[cityPicker.Selected].Id;
            var channel = (AdChannel)channelPicker.Selected;
            var budget = (decimal)budgetSpin.Value;

            var costPerPoint = SimulationConstants.AdCostPerPoint(channel);
            var mediaBonus = world.GetMediaOwnershipBonus(GameState.PlayerId, city, channel);
            var current = world.GetBrandAwareness(GameState.PlayerId, product, city);
            var saturation = Math.Max(0.0, 1.0 - current / 100.0);
            var effectiveBudget = budget * mediaBonus;
            var pointsAtFull = costPerPoint == 0m ? 0.0 : (double)(effectiveBudget / costPerPoint);
            var lift = pointsAtFull * saturation;
            var newBrand = Math.Min(100.0, current + lift);

            var bonusNote = mediaBonus > 1.0m
                ? $"  [color=#ffd96b](media-ownership bonus ×{mediaBonus:F2})[/color]"
                : "";
            reachLabel.Text =
                $"[i]Estimated next month — [/i]"
              + $"current brand [b]{current:F1}[/b] → [b]{newBrand:F1}[/b]   "
              + $"(lift +{lift:F1}, cost/point {costPerPoint.ToString("C0", Money)})"
              + bonusNote;
        }

        productPicker.ItemSelected += _ => UpdateReach();
        cityPicker.ItemSelected += _ => UpdateReach();
        channelPicker.ItemSelected += _ => UpdateReach();
        budgetSpin.ValueChanged += _ => UpdateReach();
        UpdateReach();

        var applyButton = new Button { Text = "Apply" };
        vbox.AddChild(applyButton);
        applyButton.Pressed += () =>
        {
            try
            {
                if (finished.Count == 0)
                {
                    SetStatus("No finished products available.", isError: true);
                    return;
                }
                var product = finished[productPicker.Selected].Id;
                var city = cities[cityPicker.Selected].Id;
                var channel = (AdChannel)channelPicker.Selected;
                var budget = (decimal)budgetSpin.Value;

                world.RegisterAdCampaign(GameState.PlayerId, product, city, channel, budget);
                SetStatus(budget == 0m
                    ? $"Cancelled {channel} ads for {product} in {city}."
                    : $"Running {channel} ads for {product} in {city} at {budget.ToString("C0", Money)}/mo.",
                    isError: false);
                if (budget > 0m)
                {
                    ScorePopup.SpawnText(ScreenCenter(), $"Ad campaign: {product.Value}", UiChrome.Gold);
                    SoundManager.PlaySfx("campaign_start");
                }
                RefreshCampaignsTab(world);
                UpdateSub(world);
            }
            catch (Exception ex)
            {
                SetStatus($"Campaign update failed: {ex.Message}", isError: true);
            }
        };

        // ---- active campaigns list
        vbox.AddChild(new HSeparator());
        vbox.AddChild(new Label { Text = "Active campaigns" });

        var active = world.AdCampaigns
            .Where(c => c.Company == GameState.PlayerId)
            .OrderBy(c => c.Product.Value, StringComparer.Ordinal)
            .ThenBy(c => c.City.Value, StringComparer.Ordinal)
            .ThenBy(c => (int)c.Channel)
            .ToList();

        if (active.Count == 0)
        {
            vbox.AddChild(new Label { Text = "  (none)" });
            return;
        }

        var totalSpend = active.Sum(c => c.MonthlyBudget);
        var summary = new Label
        {
            Text = $"  {active.Count} campaign{(active.Count == 1 ? "" : "s")}  ·  "
                 + $"total spend {totalSpend.ToString("C0", Money)}/mo",
        };
        summary.Modulate = new Color(0.75f, 0.85f, 1.00f);
        vbox.AddChild(summary);

        foreach (var c in active)
        {
            var brand = world.GetBrandAwareness(c.Company, c.Product, c.City);
            var mediaBonus = world.GetMediaOwnershipBonus(c.Company, c.City, c.Channel);
            var bonusNote = mediaBonus > 1.0m ? $"  ×{mediaBonus:F2} media bonus" : "";

            var row = new HBoxContainer();
            row.AddThemeConstantOverride("separation", 8);
            row.AddChild(new Label
            {
                Text = $"{c.Product.Value}  in  {c.City.Value}  ·  {c.Channel}  ·  "
                     + $"{c.MonthlyBudget.ToString("C0", Money)}/mo  ·  Brand {brand:F1}{bonusNote}",
            });
            var cancelBtn = new Button { Text = "Cancel" };
            var captured = c;
            cancelBtn.Pressed += () =>
            {
                world.RegisterAdCampaign(captured.Company, captured.Product, captured.City, captured.Channel, 0m);
                SetStatus($"Cancelled {captured.Channel} ads for {captured.Product} in {captured.City}.", isError: false);
                RefreshCampaignsTab(world);
            };
            Tooltip.Attach(cancelBtn,
                $"[b]Cancel[/b] this campaign — stops spending immediately. Existing brand awareness then decays {SimulationConstants.BrandDecayRate * 100:F0}%/month until another campaign reactivates.");
            row.AddChild(cancelBtn);
            vbox.AddChild(row);
        }
    }

    // ====================================================== Patents tab

    /// <summary>
    /// Phase 3.62 — renders two sections:
    /// <list type="bullet">
    ///   <item>Section A: patents held by the player, each with a licensee list
    ///         (with per-row Revoke buttons) and a Grant-License form that lists
    ///         only competitors who aren't already licensees.</item>
    ///   <item>Section B: patents held by competitors, with a "licensed ✓ / not
    ///         licensed ✗" flag for the player (informational — the engine API is
    ///         one-way; only the holder can grant).</item>
    /// </list>
    /// The entire tab is torn down and rebuilt on every tick so newly-granted or
    /// newly-expired patents show up without bespoke diffing. Rows are created
    /// programmatically — no <c>Owner</c> set per project convention.
    /// </summary>
    private void RefreshPatentsTab(World world)
    {
        var scroll = GetNode<ScrollContainer>("Panel/VBox/Tabs/Patents");

        // The .tscn ships a PatentsList VBox child; preserve that root so other
        // code that looks it up by path keeps working, but clear its children.
        VBoxContainer host;
        if (scroll.GetNodeOrNull<VBoxContainer>("PatentsList") is { } existing)
        {
            host = existing;
            foreach (var child in host.GetChildren()) child.QueueFree();
        }
        else
        {
            host = new VBoxContainer
            {
                Name = "PatentsList",
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            };
            host.AddThemeConstantOverride("separation", 8);
            scroll.AddChild(host);
        }

        RenderPatentsTab(world, host);
    }

    private void RenderPatentsTab(World world, VBoxContainer host)
    {
        var playerId = GameState.PlayerId;
        var allPatents = world.GetActivePatents();
        var allLicenses = world.GetPatentLicenses();

        if (allPatents.Count == 0)
        {
            var empty = new RichTextLabel
            {
                BbcodeEnabled = true,
                FitContent = true,
                ScrollActive = false,
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                Text = "[i]No patents have been issued yet. Reach Tech Level Max on a product to earn a 24-month patent.[/i]",
            };
            host.AddChild(empty);
            return;
        }

        var nowIdx = world.Clock.Now.AsMonthIndex();

        // ---- Section A: player's patents
        var sectionA = new Label { Text = "Your Patents (You Hold)" };
        sectionA.AddThemeFontSizeOverride("font_size", 18);
        sectionA.Modulate = new Color(0.75f, 0.85f, 1.00f);
        host.AddChild(sectionA);

        var myPatents = allPatents.Where(p => p.Holder == playerId).ToList();
        if (myPatents.Count == 0)
        {
            host.AddChild(new Label
            {
                Text = "  You don't hold any active patents. Reach Tech Level Max on a product in an R&D slot to earn one.",
            });
        }
        else
        {
            foreach (var patent in myPatents)
                host.AddChild(BuildHolderPatentRow(world, patent, allLicenses, nowIdx));
        }

        host.AddChild(new HSeparator());

        // ---- Section B: competitors' patents
        var sectionB = new Label { Text = "Patents Held by Competitors" };
        sectionB.AddThemeFontSizeOverride("font_size", 18);
        sectionB.Modulate = new Color(0.75f, 0.85f, 1.00f);
        host.AddChild(sectionB);

        var rivalPatents = allPatents.Where(p => p.Holder != playerId).ToList();
        if (rivalPatents.Count == 0)
        {
            host.AddChild(new Label { Text = "  No competitors hold active patents." });
        }
        else
        {
            foreach (var patent in rivalPatents)
                host.AddChild(BuildRivalPatentRow(world, patent, allLicenses, nowIdx));
        }
    }

    private PanelContainer BuildHolderPatentRow(
        World world,
        Patent patent,
        IReadOnlyList<PatentLicense> allLicenses,
        int nowIdx)
    {
        var row = new PanelContainer();
        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);
        row.AddChild(vbox);

        var monthsLeft = patent.ExpiresAt.AsMonthIndex() - nowIdx;
        var head = new Label
        {
            Text = $"Product: {patent.Product.Value}  ·  expires {patent.ExpiresAt}  "
                 + $"({monthsLeft} month{(monthsLeft == 1 ? "" : "s")} remaining)",
        };
        head.AddThemeFontSizeOverride("font_size", 15);
        vbox.AddChild(head);
        Tooltip.Attach(head,
            "[b]Your patent[/b] — while active, rival R&D on this product is blocked. "
          + "You may grant licenses to collect a royalty on their sales, or keep exclusivity. "
          + "Patents last 24 months from Tech-Level-Max and cannot be renewed.");

        // Active licenses for this patent.
        var licensees = allLicenses
            .Where(l => l.Holder == patent.Holder && l.Product == patent.Product)
            .Select(l => l.Licensee)
            .ToList();

        if (licensees.Count == 0)
        {
            vbox.AddChild(new Label { Text = "  No active licenses." });
        }
        else
        {
            vbox.AddChild(new Label { Text = "  Licenses granted:" });
            foreach (var licensee in licensees)
            {
                var lrow = new HBoxContainer();
                lrow.AddThemeConstantOverride("separation", 8);
                lrow.AddChild(new Label { Text = $"    • {CompanyName(world, licensee)}" });

                var revokeBtn = new Button { Text = "Revoke" };
                Tooltip.Attach(revokeBtn,
                    "[b]Revoke[/b] this license — the licensee's R&D on this product is blocked again "
                  + "starting next tick, and royalty flow stops.");
                var capturedHolder = patent.Holder;
                var capturedLicensee = licensee;
                var capturedProduct = patent.Product;
                revokeBtn.Pressed += () => OnRevokePatentLicense(capturedHolder, capturedLicensee, capturedProduct);
                lrow.AddChild(revokeBtn);
                vbox.AddChild(lrow);
            }
        }

        // Grant-license form: non-player, non-already-licensed companies.
        var alreadyLicensed = new HashSet<CompanyId>(licensees);
        var candidates = world.Companies.Values
            .Where(c => c.Id != patent.Holder && !alreadyLicensed.Contains(c.Id))
            .OrderBy(c => c.Id.Value)
            .ToList();

        if (candidates.Count > 0)
        {
            var formRow = new HBoxContainer();
            formRow.AddThemeConstantOverride("separation", 8);
            formRow.AddChild(new Label { Text = "  Grant license to:" });

            var picker = new OptionButton();
            foreach (var c in candidates) picker.AddItem(c.Name);
            formRow.AddChild(picker);
            Tooltip.Attach(picker,
                "[b]Grant target[/b] — select a competitor to license this patent to. "
              + "Once granted, their R&D on this product resumes and they owe you royalties on every sale.");

            var grantBtn = new Button { Text = "Grant" };
            Tooltip.Attach(grantBtn,
                "[b]Grant[/b] the selected competitor a license under this patent. "
              + "You collect a royalty on every sale they make of the licensed product until you revoke or the patent expires.");
            var capturedHolder = patent.Holder;
            var capturedProduct = patent.Product;
            var capturedCandidates = candidates;
            grantBtn.Pressed += () =>
            {
                var sel = picker.Selected;
                if (sel < 0 || sel >= capturedCandidates.Count)
                {
                    SetStatus("Pick a licensee first.", isError: true);
                    return;
                }
                OnGrantPatentLicense(capturedHolder, capturedCandidates[sel].Id, capturedProduct);
            };
            formRow.AddChild(grantBtn);
            vbox.AddChild(formRow);
        }
        else if (licensees.Count > 0)
        {
            vbox.AddChild(new Label { Text = "  (All eligible competitors already licensed.)" });
        }

        return row;
    }

    private PanelContainer BuildRivalPatentRow(
        World world,
        Patent patent,
        IReadOnlyList<PatentLicense> allLicenses,
        int nowIdx)
    {
        var row = new PanelContainer();
        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);
        row.AddChild(vbox);

        var monthsLeft = patent.ExpiresAt.AsMonthIndex() - nowIdx;
        var head = new Label
        {
            Text = $"{CompanyName(world, patent.Holder)}  ·  {patent.Product.Value}  ·  "
                 + $"expires {patent.ExpiresAt}  ({monthsLeft} month{(monthsLeft == 1 ? "" : "s")} remaining)",
        };
        head.AddThemeFontSizeOverride("font_size", 15);
        vbox.AddChild(head);

        var playerLicensed = allLicenses.Any(l =>
            l.Holder == patent.Holder && l.Licensee == GameState.PlayerId && l.Product == patent.Product);

        var statusLine = new Label
        {
            Text = playerLicensed
                ? "  License granted ✓ — your R&D on this product proceeds; you owe royalties on sales."
                : "  Not licensed ✗ — your R&D on this product is blocked until expiry.",
        };
        statusLine.Modulate = playerLicensed
            ? new Color(0.6f, 1f, 0.6f)
            : new Color(1f, 0.75f, 0.55f);
        vbox.AddChild(statusLine);
        Tooltip.Attach(statusLine,
            playerLicensed
                ? "[b]Licensed[/b] — the holder has granted you a license. Your R&D resumes; every sale you make of this product routes a royalty to the patent holder."
                : "[b]Blocked[/b] — while you are not licensed and not the holder, your R&D progress on this product is silently dropped each tick until the patent expires. Licensing is granted one-way by the holder; you cannot request it unilaterally.");

        return row;
    }

    private void OnGrantPatentLicense(CompanyId holder, CompanyId licensee, ProductId product)
    {
        var world = GameState.World;
        if (world is null) return;
        try
        {
            world.GrantPatentLicense(holder, licensee, product);
            SetStatus(
                $"Granted license on {product.Value} to {CompanyName(world, licensee)}.",
                isError: false);
            RefreshPatentsTab(world);
        }
        catch (Exception ex)
        {
            SetStatus($"Grant failed: {ex.Message}", isError: true);
        }
    }

    private void OnRevokePatentLicense(CompanyId holder, CompanyId licensee, ProductId product)
    {
        var world = GameState.World;
        if (world is null) return;
        try
        {
            world.RevokePatentLicense(holder, licensee, product);
            SetStatus(
                $"Revoked license on {product.Value} from {CompanyName(world, licensee)}.",
                isError: false);
            RefreshPatentsTab(world);
        }
        catch (Exception ex)
        {
            SetStatus($"Revoke failed: {ex.Message}", isError: true);
        }
    }

    private static string CompanyName(World world, CompanyId id)
        => world.Companies.TryGetValue(id, out var c) ? c.Name : $"Company #{id.Value}";

    // ====================================================== shared

    private void UpdateSub(World world)
    {
        var sub = GetNode<Label>("Panel/VBox/SubLabel");
        sub.Text = $"{PlayerName(world)}  ·  Cash: {PlayerCash(world).ToString("C0", Money)}  ·  {world.Clock.Now}";
    }

    private void SetStatus(string text, bool isError)
    {
        if (_statusLabel is null) return;
        _statusLabel.Text = text;
        _statusLabel.Modulate = isError ? new Color(1, 0.5f, 0.5f) : new Color(0.7f, 1, 0.7f);
    }

    private static string PlayerName(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Name : "(unknown)";

    private static decimal PlayerCash(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Cash : 0m;

    private Vector2 ScreenCenter() => GetViewport().GetVisibleRect().Size / 2f;

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
}
