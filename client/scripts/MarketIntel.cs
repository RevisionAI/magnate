using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Godot;
using Magnate.Engine.Domain;
using Magnate.Engine.Economics;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// Market Intelligence screen. Phase 3.41 deepens the Phase 3.26 grid into a
/// drill-downable competitive cockpit:
///   • Grid tab: sortable / filterable city × product list (left) plus a
///     leaderboard panel (right) that fans out the selected market into a
///     per-retailer ranking with prices, Q/T/B and softmax-derived demand
///     share / unit estimates. A 12-month player-share sparkline sits above
///     the leaderboard, computed client-side from the cash ledger.
///   • Top 3 tab: best markets to enter (high demand, low competition) and
///     player markets being chased by competitors.
///
/// All numbers replay the engine's softmax client-side (no engine surface
/// extension) so this remains read-only. Live ticks via
/// <see cref="GameState.TickIfRunning"/> mirror the Reports.cs cadence.
/// </summary>
public partial class MarketIntel : Node
{
    private static readonly CultureInfo Money = CultureInfo.GetCultureInfo("en-US");

    private enum SortMode { ShareDesc, PriceAsc, CityAlpha }

    [Flags]
    private enum FilterFlags
    {
        None = 0,
        /// <summary>Only show rows where the player has at least one slot.</summary>
        PlayerOnly = 1,
        /// <summary>Hide rows where the player isn't selling but a competitor is.</summary>
        CompetitorsOnly = 2,
        /// <summary>Hide rows where total monthly demand is < $1k.</summary>
        SignificantOnly = 4,
    }

    private SortMode _sort = SortMode.ShareDesc;
    private FilterFlags _filters = FilterFlags.None;

    /// <summary>Null means "All cities"; otherwise the only city shown.</summary>
    private CityId? _cityFilter;

    /// <summary>Null means "All products"; otherwise the only product shown.</summary>
    private ProductId? _productFilter;

    /// <summary>Currently selected (city, product) row for the leaderboard panel.</summary>
    private (CityId City, ProductId Product)? _selection;

    private HBoxContainer _sortBar = null!;
    private HBoxContainer _cityBar = null!;
    private HBoxContainer _filterBar = null!;
    private VBoxContainer _content = null!;
    private RichTextLabel _detailRich = null!;
    private Label _detailHeader = null!;
    private Sparkline _sparkline = null!;
    private VBoxContainer _topContent = null!;

    public override void _Ready()
    {
        ApplyChrome();

        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;
        _sortBar = GetNode<HBoxContainer>("Panel/VBox/Tabs/Grid/Controls/SortBar");
        _cityBar = GetNode<HBoxContainer>("Panel/VBox/Tabs/Grid/Controls/CityBar");
        _filterBar = GetNode<HBoxContainer>("Panel/VBox/Tabs/Grid/Controls/FilterBar");
        _content = GetNode<VBoxContainer>("Panel/VBox/Tabs/Grid/Body/Scroll/Content");
        _detailRich = GetNode<RichTextLabel>("Panel/VBox/Tabs/Grid/Body/DetailPanel/DetailScroll/DetailRich");
        _detailHeader = GetNode<Label>("Panel/VBox/Tabs/Grid/Body/DetailPanel/DetailHeader");
        _sparkline = GetNode<Sparkline>("Panel/VBox/Tabs/Grid/Body/DetailPanel/SparkHost/Sparkline");
        _topContent = GetNode<VBoxContainer>("Panel/VBox/Tabs/Top 3/TopScroll/TopContent");

        BuildSortBar();
        BuildCityBar();
        BuildFilterBar();
        Refresh();
    }

    public override void _Process(double delta)
    {
        if (GameState.TickIfRunning((float)delta))
        {
            Refresh();
        }
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");

    // ------------------------------------------------------------------ chrome

    /// <summary>
    /// Phase 3.70 — applies the game's visual chrome (operations backdrop, dark
    /// translucent shell, gold header, styled tabs/buttons, markets accent) over
    /// the default-grey scene. Presentation-only; touches no simulation state and
    /// no code node paths. Replicated locally because <c>UiChrome</c> is shared
    /// and owned elsewhere.
    /// </summary>
    private void ApplyChrome()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.88f),
            new Color(0.02f, 0.04f, 0.055f, 0.68f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.12f), new Color(0f, 0f, 0f, 0f), borderWidth: 0));

        InstallShell(panel);

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        header.AddThemeFontSizeOverride("font_size", 30);
        GetNode<Label>("Panel/VBox/SubLabel").AddThemeColorOverride("font_color", UiChrome.Muted);
        GetNode<Label>("Panel/VBox/Tabs/Grid/Body/DetailPanel/DetailHeader")
            .AddThemeColorOverride("font_color", UiChrome.Gold);

        var vbox = GetNode<VBoxContainer>("Panel/VBox");
        if (vbox.GetNodeOrNull("HeaderAccent") is null)
        {
            var accent = BuildAccentPlate(GamePresentation.MarketsArt,
                "Read the competitive board: city × product share, per-retailer leaderboards, and where to enter or defend.");
            vbox.AddChild(accent);
            vbox.MoveChild(accent, 2);
        }

        StyleTabs(GetNode<TabContainer>("Panel/VBox/Tabs"));
        StyleButton(GetNode<Button>("Panel/VBox/BackButton"));
    }

    private static void InstallShell(Panel panel)
    {
        if (panel.GetNodeOrNull<PanelContainer>("ContentShell") is not null) return;
        var shell = new PanelContainer
        {
            Name = "ContentShell",
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(shell);
        shell.OffsetLeft = 14f;
        shell.OffsetTop = 14f;
        shell.OffsetRight = -14f;
        shell.OffsetBottom = -14f;
        shell.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.035f, 0.060f, 0.075f, 0.62f),
            new Color(0.50f, 0.70f, 0.78f, 0.32f),
            radius: 8, marginX: 0, marginY: 0));
        panel.AddChild(shell);
        panel.MoveChild(shell, 2);
    }

    private static void StyleTabs(TabContainer tabs)
    {
        tabs.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.09f, 0.78f),
            new Color(0.30f, 0.46f, 0.54f, 0.5f), radius: 6));
        tabs.AddThemeStyleboxOverride("tabbar_background", UiChrome.Box(
            new Color(0f, 0f, 0f, 0f), new Color(0f, 0f, 0f, 0f), borderWidth: 0, radius: 0));
        tabs.AddThemeStyleboxOverride("tab_selected", UiChrome.Box(
            new Color(0.11f, 0.17f, 0.21f, 0.96f), UiChrome.Gold, radius: 5, marginY: 8));
        tabs.AddThemeStyleboxOverride("tab_unselected", UiChrome.Box(
            new Color(0.05f, 0.08f, 0.10f, 0.66f), UiChrome.Stroke, radius: 5, marginY: 8));
        tabs.AddThemeStyleboxOverride("tab_hovered", UiChrome.Box(
            new Color(0.08f, 0.13f, 0.16f, 0.90f), UiChrome.Blue, radius: 5, marginY: 8));
        tabs.AddThemeColorOverride("font_selected_color", UiChrome.Gold);
        tabs.AddThemeColorOverride("font_unselected_color", UiChrome.Muted);
        tabs.AddThemeColorOverride("font_hovered_color", new Color(0.92f, 0.96f, 0.98f));
    }

    private static void StyleButton(Button button)
    {
        button.AddThemeStyleboxOverride("normal", UiChrome.Box(
            new Color(0.06f, 0.10f, 0.13f, 0.92f), new Color(0.32f, 0.50f, 0.58f, 0.7f), radius: 5));
        button.AddThemeStyleboxOverride("hover", UiChrome.Box(
            new Color(0.09f, 0.14f, 0.18f, 0.95f), UiChrome.Blue, radius: 5));
        button.AddThemeStyleboxOverride("pressed", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.09f, 0.95f), UiChrome.Gold, radius: 5));
        button.AddThemeColorOverride("font_color", new Color(0.90f, 0.94f, 0.96f));
        button.AddThemeColorOverride("font_hover_color", UiChrome.Gold);
    }

    private static Control BuildAccentPlate(string texturePath, string caption)
    {
        var plate = new PanelContainer { Name = "HeaderAccent", CustomMinimumSize = new Vector2(0, 58) };
        plate.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.04f, 0.07f, 0.085f, 0.74f),
            new Color(0.45f, 0.70f, 0.80f, 0.4f), radius: 6, marginX: 0, marginY: 0));

        var texture = UiChrome.LoadTexture(texturePath);
        if (texture is not null)
        {
            var art = new TextureRect
            {
                Texture = texture,
                ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
                StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
                MouseFilter = Control.MouseFilterEnum.Ignore,
                Modulate = new Color(1f, 1f, 1f, 0.5f),
            };
            UiChrome.FullRect(art);
            plate.AddChild(art);
        }

        var shade = new ColorRect
        {
            Color = new Color(0.02f, 0.04f, 0.055f, 0.45f),
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        UiChrome.FullRect(shade);
        plate.AddChild(shade);

        var label = new Label
        {
            Text = caption,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        label.AddThemeFontSizeOverride("font_size", 14);
        label.AddThemeColorOverride("font_color", new Color(0.90f, 0.94f, 0.92f));
        UiChrome.FullRect(label);
        plate.AddChild(label);
        return plate;
    }

    // ------------------------------------------------------------------ toolbars

    private void BuildSortBar()
    {
        foreach (var child in _sortBar.GetChildren()) child.QueueFree();

        _sortBar.AddChild(new Label { Text = "Sort:" });
        _sortBar.AddChild(MakeSortButton("Share desc", SortMode.ShareDesc));
        _sortBar.AddChild(MakeSortButton("Price asc", SortMode.PriceAsc));
        _sortBar.AddChild(MakeSortButton("City A→Z", SortMode.CityAlpha));
    }

    private Button MakeSortButton(string text, SortMode mode)
    {
        var b = new Button { Text = text, ToggleMode = true };
        b.ButtonPressed = _sort == mode;
        b.Pressed += () =>
        {
            _sort = mode;
            BuildSortBar();
            Refresh();
        };
        StyleButton(b);
        return b;
    }

    private void BuildCityBar()
    {
        foreach (var child in _cityBar.GetChildren()) child.QueueFree();

        _cityBar.AddChild(new Label { Text = "City:" });

        var allBtn = new Button { Text = "All", ToggleMode = true };
        allBtn.ButtonPressed = _cityFilter is null;
        allBtn.Pressed += () =>
        {
            _cityFilter = null;
            BuildCityBar();
            Refresh();
        };
        StyleButton(allBtn);
        _cityBar.AddChild(allBtn);

        var world = GameState.World;
        if (world is null) return;

        foreach (var city in world.Catalog.Cities.Values.OrderBy(c => c.Id.Value, StringComparer.Ordinal))
        {
            var capturedId = city.Id;
            var b = new Button { Text = city.Name, ToggleMode = true };
            b.ButtonPressed = _cityFilter is not null && _cityFilter.Value.Equals(capturedId);
            b.Pressed += () =>
            {
                _cityFilter = capturedId;
                BuildCityBar();
                Refresh();
            };
            StyleButton(b);
            _cityBar.AddChild(b);
        }
    }

    private void BuildFilterBar()
    {
        foreach (var child in _filterBar.GetChildren()) child.QueueFree();

        _filterBar.AddChild(new Label { Text = "Filter:" });

        _filterBar.AddChild(MakeFlagButton("My markets", FilterFlags.PlayerOnly));
        _filterBar.AddChild(MakeFlagButton("Has competitor", FilterFlags.CompetitorsOnly));
        _filterBar.AddChild(MakeFlagButton("Significant only", FilterFlags.SignificantOnly));

        // Product filter as an OptionButton — there can be a lot of finished goods.
        var productPick = new OptionButton();
        StyleButton(productPick);
        productPick.AddItem("All products", -1);
        productPick.Selected = 0;
        var world = GameState.World;
        var orderedProducts = new List<Product>();
        if (world is not null)
        {
            orderedProducts = world.Catalog.Products.Values
                .Where(p => p.Tier == ProductTier.Finished)
                .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
                .ToList();
            for (var i = 0; i < orderedProducts.Count; i++)
            {
                productPick.AddItem(orderedProducts[i].Name, i);
                if (_productFilter is not null && _productFilter.Value.Equals(orderedProducts[i].Id))
                {
                    productPick.Selected = i + 1;
                }
            }
        }
        productPick.ItemSelected += (long index) =>
        {
            if (index <= 0)
            {
                _productFilter = null;
            }
            else if (index - 1 < orderedProducts.Count)
            {
                _productFilter = orderedProducts[(int)index - 1].Id;
            }
            Refresh();
        };
        _filterBar.AddChild(productPick);
    }

    private Button MakeFlagButton(string text, FilterFlags flag)
    {
        var b = new Button { Text = text, ToggleMode = true };
        b.ButtonPressed = (_filters & flag) != 0;
        b.Pressed += () =>
        {
            if ((_filters & flag) != 0) _filters &= ~flag;
            else _filters |= flag;
            BuildFilterBar();
            Refresh();
        };
        StyleButton(b);
        return b;
    }

    // ------------------------------------------------------------------ render

    private void Refresh()
    {
        var sub = GetNode<Label>("Panel/VBox/SubLabel");
        foreach (var child in _content.GetChildren()) child.QueueFree();
        foreach (var child in _topContent.GetChildren()) child.QueueFree();

        var world = GameState.World;
        if (world is null)
        {
            sub.Text = "No active game — start a scenario from the title screen.";
            var empty = new Label
            {
                Text = "No active game — start a scenario from the title screen to see market intelligence.",
                HorizontalAlignment = HorizontalAlignment.Center,
                AutowrapMode = TextServer.AutowrapMode.WordSmart,
            };
            empty.AddThemeFontSizeOverride("font_size", 16);
            empty.AddThemeColorOverride("font_color", UiChrome.Muted);
            _content.AddChild(empty);
            var emptyTop = new Label
            {
                Text = "No active game.",
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            emptyTop.AddThemeColorOverride("font_color", UiChrome.Muted);
            _topContent.AddChild(emptyTop);
            ClearDetailPanel();
            return;
        }

        sub.Text =
            $"Scenario: {GameState.ScenarioName}  ·  Date: {world.Clock.Now}  ·  " +
            $"Company: {PlayerName(world)}";

        var rows = BuildRows(world);
        rows = ApplyFilters(rows);
        rows = SortRows(rows);

        // Validate the current selection still exists; clear if not.
        if (_selection is not null
            && !rows.Any(r => r.City.Equals(_selection.Value.City) && r.Product.Equals(_selection.Value.Product)))
        {
            _selection = null;
        }

        if (rows.Count == 0)
        {
            _content.AddChild(new Label
            {
                Text = "No markets match the current filters. "
                     + "Try clearing filters or constructing supermarkets to see market intel.",
                HorizontalAlignment = HorizontalAlignment.Center,
                AutowrapMode = TextServer.AutowrapMode.WordSmart,
            });
        }
        else
        {
            _content.AddChild(BuildHeaderRow());
            _content.AddChild(new HSeparator());

            foreach (var row in rows)
            {
                var captured = row;
                var rowControl = BuildRow(row, isSelected: _selection is not null
                    && _selection.Value.City.Equals(row.City)
                    && _selection.Value.Product.Equals(row.Product));
                rowControl.Pressed += () =>
                {
                    _selection = (captured.City, captured.Product);
                    Refresh();
                };
                _content.AddChild(rowControl);
            }
        }

        RefreshDetailPanel(world);
        RefreshTopMarkets(world);
    }

    // ------------------------------------------------------------------ rows

    /// <summary>One (city, product) row of the intel grid.</summary>
    private sealed record IntelRow(
        CityId City,
        string CityName,
        ProductId Product,
        string ProductName,
        decimal? PlayerPrice,
        double PlayerShare,
        bool PlayerPresent,
        decimal? CheapestCompetitorPrice,
        string? TopCompetitorName,
        double TopCompetitorShare,
        int CompetitorCount,
        double TotalDemandUnits);

    private List<IntelRow> BuildRows(World world)
    {
        var results = new List<IntelRow>();

        var finishedProducts = world.Catalog.Products.Values
            .Where(p => p.Tier == ProductTier.Finished)
            .Where(p => _productFilter is null || _productFilter.Value.Equals(p.Id))
            .OrderBy(p => p.Id.Value, StringComparer.Ordinal)
            .ToList();

        var cities = world.Catalog.Cities.Values
            .Where(c => _cityFilter is null || c.Id.Equals(_cityFilter.Value))
            .OrderBy(c => c.Id.Value, StringComparer.Ordinal)
            .ToList();

        foreach (var city in cities)
        {
            var retailers = world.Buildings.Values
                .Where(b => b.City.Equals(city.Id) && b.RetailSlots.Count > 0)
                .OrderBy(b => b.Id.Value)
                .ToList();

            foreach (var product in finishedProducts)
            {
                var slots = retailers
                    .SelectMany(b => b.RetailSlots
                        .Where(s => s.Product.Equals(product.Id))
                        .Select(s => (Owner: b.Owner, Price: s.Price)))
                    .ToList();

                if (slots.Count == 0) continue;

                var playerSlots = slots.Where(s => s.Owner.Equals(GameState.PlayerId)).ToList();
                decimal? playerPrice = playerSlots.Count > 0
                    ? playerSlots.Min(s => s.Price)
                    : null;
                var playerShare = world.GetMarketShare(GameState.PlayerId, product.Id, city.Id);

                var competitorSlots = slots.Where(s => !s.Owner.Equals(GameState.PlayerId)).ToList();
                decimal? cheapestComp = competitorSlots.Count > 0
                    ? competitorSlots.Min(s => s.Price)
                    : null;

                string? topCompName = null;
                var topCompShare = 0.0;
                var distinctCompetitors = competitorSlots.Select(s => s.Owner).Distinct().ToList();
                foreach (var compId in distinctCompetitors)
                {
                    var share = world.GetMarketShare(compId, product.Id, city.Id);
                    if (share > topCompShare)
                    {
                        topCompShare = share;
                        topCompName = world.Companies.TryGetValue(compId, out var c)
                            ? c.Name : compId.Value.ToString(CultureInfo.InvariantCulture);
                    }
                }

                results.Add(new IntelRow(
                    City: city.Id,
                    CityName: city.Name,
                    Product: product.Id,
                    ProductName: product.Name,
                    PlayerPrice: playerPrice,
                    PlayerShare: playerShare,
                    PlayerPresent: playerSlots.Count > 0,
                    CheapestCompetitorPrice: cheapestComp,
                    TopCompetitorName: topCompName,
                    TopCompetitorShare: topCompShare,
                    CompetitorCount: distinctCompetitors.Count,
                    TotalDemandUnits: ComputeCityDemand(city, product)));
            }
        }

        return results;
    }

    private List<IntelRow> ApplyFilters(List<IntelRow> rows)
    {
        IEnumerable<IntelRow> q = rows;
        if ((_filters & FilterFlags.PlayerOnly) != 0)
        {
            q = q.Where(r => r.PlayerPresent);
        }
        if ((_filters & FilterFlags.CompetitorsOnly) != 0)
        {
            q = q.Where(r => r.CompetitorCount > 0);
        }
        if ((_filters & FilterFlags.SignificantOnly) != 0)
        {
            q = q.Where(r => r.TotalDemandUnits > 1000.0);
        }
        return q.ToList();
    }

    private List<IntelRow> SortRows(List<IntelRow> rows) => _sort switch
    {
        SortMode.ShareDesc => rows
            .OrderByDescending(r => r.PlayerPresent)
            .ThenByDescending(r => r.PlayerShare)
            .ThenBy(r => r.CityName, StringComparer.Ordinal)
            .ThenBy(r => r.ProductName, StringComparer.Ordinal)
            .ToList(),

        SortMode.PriceAsc => rows
            .OrderBy(r => r.CheapestCompetitorPrice is null)
            .ThenBy(r => r.CheapestCompetitorPrice ?? decimal.MaxValue)
            .ThenBy(r => r.CityName, StringComparer.Ordinal)
            .ThenBy(r => r.ProductName, StringComparer.Ordinal)
            .ToList(),

        SortMode.CityAlpha => rows
            .OrderBy(r => r.CityName, StringComparer.Ordinal)
            .ThenBy(r => r.ProductName, StringComparer.Ordinal)
            .ToList(),

        _ => rows,
    };

    // ------------------------------------------------------------------ row UI

    private static readonly (string Text, int Stretch)[] Columns = new[]
    {
        ("City",        2),
        ("Product",     3),
        ("You $",       2),
        ("You %",       2),
        ("Cheap Comp $",2),
        ("Top Comp",    3),
        ("Top Comp %",  2),
    };

    private static HBoxContainer BuildHeaderRow()
    {
        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 8);

        // Pad for the row-button itself which is rendered as one cell on the left.
        var spacer = new Label
        {
            Text = "",
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            CustomMinimumSize = new Vector2(0, 0),
        };
        // No spacer — rows use a Button that contains its own HBox; we just let the
        // header HBox use the same column layout so they align visually.
        foreach (var (text, stretch) in Columns)
        {
            var l = new Label
            {
                Text = text,
                SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
                SizeFlagsStretchRatio = stretch,
            };
            l.AddThemeFontSizeOverride("font_size", 13);
            l.Modulate = new Color(0.8f, 0.8f, 0.8f);
            row.AddChild(l);
        }
        return row;
    }

    /// <summary>
    /// Build a clickable row. Wrapped in a <see cref="Button"/> with a child
    /// HBox so the whole strip becomes a hit target for selection.
    /// </summary>
    private static Button BuildRow(IntelRow r, bool isSelected)
    {
        var btn = new Button
        {
            ToggleMode = true,
            ButtonPressed = isSelected,
            Flat = !isSelected,
            Alignment = HorizontalAlignment.Left,
            ClipText = false,
        };
        btn.AddThemeConstantOverride("h_separation", 0);

        // Compose the row text into a single label-style string. Buttons in Godot
        // render their child HBox poorly without explicit theme work, so we keep
        // the row a single multi-cell label by formatting columns as a single
        // string with explicit padding.
        var sb = new StringBuilder();
        sb.Append(Pad(r.CityName, 12));
        sb.Append(Pad(r.ProductName, 16));
        sb.Append(Pad(r.PlayerPrice is null ? "—" : r.PlayerPrice.Value.ToString("C2", Money), 10));
        sb.Append(Pad(r.PlayerPresent ? $"{r.PlayerShare * 100:F1}%" : "—", 8));
        sb.Append(Pad(r.CheapestCompetitorPrice is null ? "—" : r.CheapestCompetitorPrice.Value.ToString("C2", Money), 12));
        sb.Append(Pad(r.TopCompetitorName ?? "—", 16));
        sb.Append(Pad(r.TopCompetitorName is null ? "—" : $"{r.TopCompetitorShare * 100:F1}%", 8));
        btn.Text = sb.ToString();

        if (!r.PlayerPresent) btn.Modulate = new Color(0.8f, 0.8f, 0.8f);

        return btn;
    }

    private static string Pad(string s, int width)
    {
        if (s.Length >= width) return s.Substring(0, width - 1) + " ";
        return s + new string(' ', width - s.Length);
    }

    // ------------------------------------------------------------------ leaderboard panel

    private void ClearDetailPanel()
    {
        _detailHeader.Text = "Select a row to inspect a market";
        _detailRich.Text = "";
        _sparkline.SetValues(Array.Empty<double>());
    }

    private void RefreshDetailPanel(World world)
    {
        if (_selection is null)
        {
            ClearDetailPanel();
            return;
        }

        var (cityId, productId) = _selection.Value;
        if (!world.Catalog.Cities.TryGetValue(cityId, out var city)
            || !world.Catalog.Products.TryGetValue(productId, out var product))
        {
            ClearDetailPanel();
            return;
        }

        _detailHeader.Text = $"{city.Name} · {product.Name}";

        // Per-retailer leaderboard via softmax replay.
        var entries = ComputeLeaderboard(world, city, product);
        var totalDemandUnits = ComputeCityDemand(city, product);
        var sb = new StringBuilder();

        sb.Append("[code]");
        sb.AppendFormat(
            "{0,-22}{1,-9}{2,5}{3,5}{4,5}{5,8}{6,12}{7,10}\n",
            "Company", "Price", "Q", "T", "B", "Weight", "Share", "Units/mo");
        sb.Append(new string('─', 76));
        sb.Append('\n');

        if (entries.Count == 0)
        {
            sb.Append("(no retailers)\n");
        }
        else
        {
            foreach (var e in entries)
            {
                var marker = e.IsPlayer ? "▶ " : "  ";
                var name = Truncate(marker + e.OwnerName, 22);
                sb.AppendFormat(
                    "{0,-22}{1,-9}{2,5:F0}{3,5}{4,5:F0}{5,8:F2}{6,12}{7,10}\n",
                    name,
                    e.Price.ToString("C2", Money),
                    e.Quality,
                    e.Tech,
                    e.Brand,
                    e.Weight,
                    $"{e.Share * 100:F1}%",
                    (totalDemandUnits * e.Share).ToString("N0", Money));
            }
        }

        sb.Append("[/code]\n\n");
        sb.Append("[i]Weight = max((Q + T·10 + B)/3, 1) / price^elasticity[/i]\n");
        sb.AppendFormat(
            "[i]Total city demand for {0}: {1} units/mo (elasticity {2:F2}).[/i]\n",
            product.Name,
            totalDemandUnits.ToString("N0", Money),
            product.PriceElasticity);

        _detailRich.Text = sb.ToString();

        // Player share sparkline — last 12 months from the cash ledger.
        _sparkline.SetValues(BuildShareHistory(world, cityId, productId, 12));
    }

    private sealed record LeaderboardEntry(
        string OwnerName,
        bool IsPlayer,
        decimal Price,
        double Quality,
        int Tech,
        double Brand,
        double Weight,
        double Share);

    private static List<LeaderboardEntry> ComputeLeaderboard(World world, City city, Product product)
    {
        var elasticity = product.PriceElasticity > 0 ? product.PriceElasticity : 1.0;

        // One leaderboard row per (retailer, slot) pair selling this product in this city.
        var rawEntries = new List<(BuildingInstance Building, RetailSlot Slot, double Weight, double Q, int T, double B)>();
        var retailers = world.Buildings.Values
            .Where(b => b.City.Equals(city.Id) && b.RetailSlots.Count > 0)
            .OrderBy(b => b.Id.Value);

        foreach (var b in retailers)
        {
            foreach (var slot in b.RetailSlots.Where(s => s.Product.Equals(product.Id)))
            {
                var q = b.Inventory.AverageQuality(product.Id);
                var t = world.GetTech(b.Owner, product.Id);
                var br = world.GetBrandAwareness(b.Owner, product.Id, b.City);
                var desirability = Math.Max((q + t * 10.0 + br) / 3.0, 1.0);
                var weight = desirability / Math.Pow((double)slot.Price, elasticity);
                rawEntries.Add((b, slot, weight, q, t, br));
            }
        }

        var totalWeight = rawEntries.Sum(e => e.Weight);
        if (totalWeight <= 0) return new List<LeaderboardEntry>();

        var entries = rawEntries
            .Select(e => new LeaderboardEntry(
                OwnerName: world.Companies.TryGetValue(e.Building.Owner, out var c)
                    ? c.Name : e.Building.Owner.Value.ToString(CultureInfo.InvariantCulture),
                IsPlayer: e.Building.Owner.Equals(GameState.PlayerId),
                Price: e.Slot.Price,
                Quality: e.Q,
                Tech: e.T,
                Brand: e.B,
                Weight: e.Weight,
                Share: e.Weight / totalWeight))
            .OrderByDescending(e => e.Share)
            .ToList();

        return entries;
    }

    /// <summary>
    /// Reconstruct the player's monthly market share from the cash ledger:
    /// player revenue from this (city, product) divided by an estimate of total
    /// monthly market revenue (using the current city demand × current avg
    /// price as the denominator). Approximate but cheap and informative.
    /// </summary>
    private static List<double> BuildShareHistory(World world, CityId cityId, ProductId productId, int months)
    {
        // Identify player buildings in this city — used to filter ProductSale rows.
        var playerBuildings = world.Buildings.Values
            .Where(b => b.Owner.Equals(GameState.PlayerId) && b.City.Equals(cityId))
            .Select(b => b.Id)
            .ToHashSet();

        if (!world.Catalog.Cities.TryGetValue(cityId, out var city)
            || !world.Catalog.Products.TryGetValue(productId, out var product))
        {
            return new List<double>();
        }

        // Estimate current total market revenue per month.
        var totalDemandUnits = ComputeCityDemand(city, product);

        // Average current retail price across all retailers in this city for this product.
        decimal avgPrice = 0m;
        var slotCount = 0;
        foreach (var b in world.Buildings.Values.Where(b => b.City.Equals(cityId)))
        {
            foreach (var slot in b.RetailSlots.Where(s => s.Product.Equals(productId)))
            {
                avgPrice += slot.Price;
                slotCount++;
            }
        }
        if (slotCount > 0) avgPrice /= slotCount;
        var monthlyMarketRevenue = (decimal)totalDemandUnits * avgPrice;

        if (monthlyMarketRevenue <= 0m) return new List<double>();

        // Walk back `months` months from world.Clock.Now and compute player revenue per month.
        var now = world.Clock.Now;
        var monthsList = new List<GameDate>();
        var d = now;
        for (var i = 0; i < months; i++)
        {
            monthsList.Add(d);
            // Step backwards by one month.
            d = d.Month == 1 ? new GameDate(d.Year - 1, 12) : new GameDate(d.Year, d.Month - 1);
        }
        monthsList.Reverse();

        var revenueByMonth = new Dictionary<GameDate, decimal>();
        foreach (var m in monthsList) revenueByMonth[m] = 0m;

        foreach (var entry in world.Ledger.EntriesFor(GameState.PlayerId))
        {
            if (entry.Category != LedgerCategory.ProductSale) continue;
            if (entry.Product is null || !entry.Product.Value.Equals(productId)) continue;
            if (entry.Building is null || !playerBuildings.Contains(entry.Building.Value)) continue;
            if (revenueByMonth.ContainsKey(entry.Date))
            {
                revenueByMonth[entry.Date] += entry.Amount;
            }
        }

        var result = new List<double>(monthsList.Count);
        foreach (var m in monthsList)
        {
            var share = (double)(revenueByMonth[m] / monthlyMarketRevenue);
            if (share < 0) share = 0;
            if (share > 1) share = 1;
            result.Add(share);
        }
        return result;
    }

    // ------------------------------------------------------------------ Top 3 tab

    private void RefreshTopMarkets(World world)
    {
        var allRows = BuildAllRowsForTopMarkets(world);

        // Top markets to enter: high demand, low player share, low competition score.
        // Heuristic: opportunityScore = totalDemandUnits / (1 + competitorCount) when player not present.
        var entryCandidates = allRows
            .Where(r => !r.PlayerPresent)
            .Select(r => (Row: r, Score: r.TotalDemandUnits / (1.0 + r.CompetitorCount)))
            .OrderByDescending(x => x.Score)
            .Take(3)
            .ToList();

        // Top markets to defend: player is present AND a competitor share is climbing toward us.
        // Heuristic: defendScore = competitor's top share - player share, weighted by demand.
        var defendCandidates = allRows
            .Where(r => r.PlayerPresent && r.CompetitorCount > 0)
            .Select(r => (Row: r, Score: (r.TopCompetitorShare - r.PlayerShare) * r.TotalDemandUnits))
            .OrderByDescending(x => x.Score)
            .Take(3)
            .ToList();

        _topContent.AddChild(BuildTopHeader("Top markets to enter"));
        if (entryCandidates.Count == 0)
        {
            _topContent.AddChild(new Label { Text = "  (no obvious entry opportunities — every market already has you in it)" });
        }
        else
        {
            foreach (var (row, score) in entryCandidates)
            {
                _topContent.AddChild(BuildTopEntryRow(
                    $"{row.CityName} · {row.ProductName}",
                    $"demand {row.TotalDemandUnits:N0} units/mo  ·  competitors {row.CompetitorCount}  ·  cheapest {(row.CheapestCompetitorPrice?.ToString("C2", Money) ?? "—")}",
                    $"opportunity {score:N0}"));
            }
        }

        _topContent.AddChild(new HSeparator());
        _topContent.AddChild(BuildTopHeader("Top markets to defend"));
        if (defendCandidates.Count == 0)
        {
            _topContent.AddChild(new Label { Text = "  (no contested markets — your positions look secure)" });
        }
        else
        {
            foreach (var (row, score) in defendCandidates)
            {
                var hint = score > 0
                    ? $"competitor {row.TopCompetitorName} leads by {(row.TopCompetitorShare - row.PlayerShare) * 100:F1} pp"
                    : $"you lead {row.TopCompetitorName} by {(row.PlayerShare - row.TopCompetitorShare) * 100:F1} pp";
                _topContent.AddChild(BuildTopEntryRow(
                    $"{row.CityName} · {row.ProductName}",
                    $"you {row.PlayerShare * 100:F1}%  ·  top comp {row.TopCompetitorShare * 100:F1}%  ·  {hint}",
                    $"pressure {score:N0}"));
            }
        }
    }

    /// <summary>Same as BuildRows but ignores filters — top-3 spans the entire game.</summary>
    private List<IntelRow> BuildAllRowsForTopMarkets(World world)
    {
        var savedCity = _cityFilter;
        var savedProd = _productFilter;
        _cityFilter = null;
        _productFilter = null;
        try { return BuildRows(world); }
        finally { _cityFilter = savedCity; _productFilter = savedProd; }
    }

    private static Label BuildTopHeader(string text)
    {
        var l = new Label { Text = text };
        l.AddThemeFontSizeOverride("font_size", 18);
        l.Modulate = new Color(0.85f, 0.95f, 1.0f);
        return l;
    }

    private static Control BuildTopEntryRow(string title, string detail, string scoreText)
    {
        var box = new HBoxContainer();
        box.AddThemeConstantOverride("separation", 12);

        var titleL = new Label
        {
            Text = title,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsStretchRatio = 3,
        };
        titleL.AddThemeFontSizeOverride("font_size", 14);

        var detailL = new Label
        {
            Text = detail,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsStretchRatio = 5,
        };
        detailL.Modulate = new Color(0.78f, 0.78f, 0.78f);

        var scoreL = new Label
        {
            Text = scoreText,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            SizeFlagsStretchRatio = 2,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        scoreL.Modulate = new Color(1.0f, 0.95f, 0.45f);

        box.AddChild(titleL);
        box.AddChild(detailL);
        box.AddChild(scoreL);
        return box;
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>
    /// Replicate <c>MonthlyTick.ComputeCityDemand</c> client-side (the engine's
    /// version is private). Stays read-only; matches the canonical formula.
    /// </summary>
    private static double ComputeCityDemand(City city, Product product)
    {
        if (product.Tier != ProductTier.Finished) return 0;
        double total = 0;
        foreach (var bracket in new[] { IncomeBracket.Low, IncomeBracket.Middle, IncomeBracket.High })
        {
            var share = city.Demographics.TryGetValue(bracket, out var s) ? s : 0;
            var perCapita = product.BaseDemandPerCapita.TryGetValue(bracket, out var d) ? d : 0;
            total += city.Population * share * perCapita;
        }
        return total;
    }

    private static string Truncate(string s, int max)
        => s.Length <= max ? s : s.Substring(0, Math.Max(0, max - 1)) + "…";

    private static string PlayerName(World world)
        => world.Companies.TryGetValue(GameState.PlayerId, out var c) ? c.Name : "(unknown)";
}
