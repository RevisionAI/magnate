using Godot;

namespace Magnate.Client;

/// <summary>
/// Read-only modal overlay that lists every keyboard shortcut in Magnate,
/// grouped by category (Playback / Scenes / Navigation / Help). Opened from
/// Main via the HelpButton or the <c>?</c> key. Closing returns to
/// <c>Main.tscn</c>. Pure presentation — does not read or write the
/// simulation; the integrator may choose to pause playback when opening.
/// </summary>
public partial class HelpOverlay : Node
{
    public override void _Ready()
    {
        ApplyVisualPolish();
        BuildMechanicsGuide();
        GetNode<Button>("Panel/VBox/Footer/BackButton").Pressed += OnBack;
    }

    private void ApplyVisualPolish()
    {
        var panel = GetNode<Panel>("Panel");
        UiChrome.InstallBackdrop(
            panel,
            UiChrome.OperationsBackdrop,
            new Color(1f, 1f, 1f, 0.78f),
            new Color(0.015f, 0.03f, 0.045f, 0.82f));
        panel.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.02f, 0.04f, 0.055f, 0.14f),
            new Color(0f, 0f, 0f, 0f),
            borderWidth: 0));

        var header = GetNode<Label>("Panel/VBox/HeaderLabel");
        header.Text = "Executive Field Guide";
        header.AddThemeFontSizeOverride("font_size", 30);
        header.AddThemeColorOverride("font_color", UiChrome.Gold);
        GetNode<Label>("Panel/VBox/SubLabel").Text =
            "The operating logic behind demand, supply chains, technology, brand, and finance";
    }

    private void BuildMechanicsGuide()
    {
        var content = GetNode<VBoxContainer>("Panel/VBox/Scroll/Content");
        var insertAt = 0;

        var intro = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            Text = "[font_size=20][b]How value is created[/b][/font_size]\n"
                 + "Magnate is a monthly-tick business simulation. Capital becomes facilities and inventory; "
                 + "facilities create product availability; price, quality, brand, and technology convert that availability into demand; "
                 + "the ledger reveals whether the operating model created durable profit.",
        };
        content.AddChild(intro);
        content.MoveChild(intro, insertAt++);

        AddMechanicCard(content, ref insertAt,
            "Retail and demand",
            GamePresentation.RetailArt,
            "Demand exists per [b]product × city × income bracket[/b]. Retail slots compete for it using price, quality, brand, and technology. "
          + "Restock targets control availability; price controls margin and demand. A cheap product can still lose if it is unknown, low quality, or out of stock.",
            UiChrome.Green);

        AddMechanicCard(content, ref insertAt,
            "Manufacturing and cost",
            GamePresentation.ManufacturingArt,
            "Factories consume recipe inputs and create intermediate or finished goods. Procurement prefers your own supply before the world market. "
          + "Inventory uses weighted-average cost, so the margin is only real when goods leave inventory. Internal transfers are cash-neutral: integration wins by lowering cost, not by creating fake revenue.",
            new Color(0.94f, 0.58f, 0.28f));

        AddMechanicCard(content, ref insertAt,
            "Logistics and inventory",
            GamePresentation.LogisticsArt,
            "Warehouses maintain target stock and smooth uneven production. Seaports and export settings turn surplus into world-market sales. "
          + "The strategic trade-off is resilience versus trapped cash: more inventory protects service levels, but every unsold unit ties up capital.",
            new Color(0.36f, 0.78f, 0.86f));

        AddMechanicCard(content, ref insertAt,
            "Research and patents",
            GamePresentation.ResearchArt,
            "R&D slots accumulate progress for one product at a time. Technology raises competitive appeal and compounds slowly, making early research valuable. "
          + "Reaching a product's maximum technology can grant a time-limited patent; licenses exchange exclusivity for royalty income.",
            new Color(0.55f, 0.66f, 1.0f));

        AddMechanicCard(content, ref insertAt,
            "Brand, competition, and capital",
            GamePresentation.MarketsArt,
            "Brand awareness is local to a [b]product and city[/b]. Advertising adds awareness with diminishing returns; awareness decays when spending stops. "
          + "Market Intel shows who is winning each city-product contest. Financial statements then separate revenue, COGS, operating expense, assets, and equity so growth cannot hide weak economics.",
            UiChrome.Gold);

        var shortcutHeader = UiChrome.SectionTitle("Controls and reference");
        content.AddChild(shortcutHeader);
        content.MoveChild(shortcutHeader, insertAt);
    }

    private static void AddMechanicCard(
        VBoxContainer parent,
        ref int insertAt,
        string title,
        string artPath,
        string body,
        Color accent)
    {
        var card = new PanelContainer { CustomMinimumSize = new Vector2(0, 158) };
        card.AddThemeStyleboxOverride("panel", UiChrome.Box(
            new Color(0.045f, 0.075f, 0.095f, 0.94f),
            new Color(accent.R, accent.G, accent.B, 0.58f),
            radius: 6,
            marginX: 10,
            marginY: 10));
        parent.AddChild(card);
        parent.MoveChild(card, insertAt++);

        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 16);
        card.AddChild(row);

        var art = new TextureRect
        {
            Texture = UiChrome.LoadTexture(artPath),
            CustomMinimumSize = new Vector2(270, 138),
            ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
            StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        row.AddChild(art);

        var text = new RichTextLabel
        {
            BbcodeEnabled = true,
            FitContent = true,
            ScrollActive = false,
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            Text = $"[font_size=20][color=#{accent.ToHtml(false)}][b]{title}[/b][/color][/font_size]\n{body}",
        };
        row.AddChild(text);
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is not InputEventKey key || !key.Pressed || key.Echo) return;

        // Esc closes the overlay. `?` also toggles closed so the same key
        // that opens it can close it. In Godot 4, typing Shift+Slash (US
        // layout) produces a Key.QuoteLeft? No — the physical key for `?`
        // on US layouts is Shift+Slash, which Godot reports as Key.Question
        // when shift-folded. Handle both Key.Question and raw Key.Slash
        // (with Shift) to be robust across keyboard layouts.
        var code = key.Keycode;
        var isQuestion = code == Key.Question
                      || (code == Key.Slash && key.ShiftPressed);

        if (code == Key.Escape || isQuestion)
        {
            OnBack();
            GetViewport().SetInputAsHandled();
        }
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
}
