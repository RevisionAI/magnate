using Godot;

namespace Magnate.Client;

/// <summary>
/// Standalone onboarding overlay — a 10-page tour covering the core loops a new
/// player needs to understand before they can drive Magnate productively.
/// Intentionally read-only: doesn't touch <see cref="GameState"/>. Navigation is
/// keyboard-friendly (arrow keys + Esc) and equally reachable via the
/// Back/Next/Skip/Close buttons.
///
/// On exit, the scene jumps to <c>Main.tscn</c> if a world is already live
/// (player opened the tutorial mid-game) or back to <c>TitleScreen.tscn</c>
/// otherwise (standalone boot). No keybind is assigned globally — the integrator
/// wires a "Tutorial" button on the Main HUD.
/// </summary>
public partial class Tutorial : Node
{
    // (title, body) pairs. Bodies use BBCode; the RichTextLabel renders them.
    // Each body stays ≤150 words to keep a page digestible at one glance.
    private static readonly (string Title, string Body)[] _pages =
    {
        (
            "Welcome to Magnate",
            "[b]Magnate[/b] is a business empire simulation inspired by the Capitalism lineage. " +
            "You start with seed cash and a single company, and grow it into a vertically-integrated conglomerate " +
            "across several cities.\n\n" +
            "You will [b]build[/b] retail stores, factories, R&D centers, and farms; [b]set prices[/b] and ad budgets; " +
            "[b]research[/b] better products; and [b]compete[/b] against one or more AI rivals.\n\n" +
            "Every scenario is [b]deterministic[/b] — the same seed always produces the same market. " +
            "This page is the first of ten. Use the buttons below (or [color=#FFC850]Right[/color] / " +
            "[color=#FFC850]Left[/color] arrows) to move between pages, and [color=#FFC850]Esc[/color] " +
            "to leave at any time."
        ),
        (
            "Picking a scenario",
            "From the [b]Title Screen[/b] you can either click [color=#FFC850]New Game[/color] to browse every " +
            "available scenario in [color=#FFC850]ScenarioPicker[/color], or pick one of the four showcase cards " +
            "at the bottom of the title to jump straight in.\n\n" +
            "Each scenario has a [b]difficulty rating[/b] shown as 1–5 gold stars. The heuristic weighs starting-cash " +
            "ratios, AI count and strategy, goal count and toughness, and scenario duration. A [b]1★[/b] sandbox is " +
            "forgiving; a [b]5★[/b] showdown puts a vertically-integrated AI across the table.\n\n" +
            "Beginners should start with [i]Tutorial[/i] (1★) or [i]Sandbox[/i] (free-play) before attempting a " +
            "Coffee Monopoly or Vertical Showdown run."
        ),
        (
            "The HUD",
            "The [b]Main[/b] scene is your home base. The left panel shows the current date, your player " +
            "company, the AI roster, and a rolling tip.\n\n" +
            "At the bottom are two button rows:\n" +
            "  • [b]Row 1[/b] — [color=#FFC850]Play/Pause[/color], [color=#FFC850]Advance[/color] one month, " +
            "and speeds [color=#FFC850]1×[/color] / [color=#FFC850]2×[/color] / [color=#FFC850]5×[/color].\n" +
            "  • [b]Row 2[/b] — scene launchers for [color=#FFC850]Manage[/color], " +
            "[color=#FFC850]Reports[/color], [color=#FFC850]CityMap[/color], [color=#FFC850]Research[/color], " +
            "[color=#FFC850]Save[/color], [color=#FFC850]Financials[/color], [color=#FFC850]Market Intel[/color], " +
            "and [color=#FFC850]Activity Feed[/color].\n\n" +
            "Press [color=#FFC850]?[/color] anytime to see the full keyboard cheat sheet."
        ),
        (
            "Building your first retailer",
            "Open [b]Manage[/b] (or press [color=#FFC850]M[/color]) to buy land, place buildings, and " +
            "fit them with slots.\n\n" +
            "A typical opening move:\n" +
            "  1. Pick a city with strong [b]High[/b] or [b]Middle[/b] demographics for your product.\n" +
            "  2. Buy a [b]Retail Store[/b] on a cheap lot.\n" +
            "  3. Add a [b]Retail Slot[/b] for a finished product (e.g. [i]soft drink[/i]).\n" +
            "  4. Source supply — either a [b]purchase contract[/b] from the world market, or from your own factory.\n" +
            "  5. Set a price roughly [b]1.2–1.5×[/b] wholesale cost; adjust once you see demand.\n\n" +
            "Revenue lands in your [b]cash ledger[/b] at the end of each month — the one true source of truth."
        ),
        (
            "The supply chain",
            "Once your retailer is profitable, consider going [b]vertical[/b]:\n" +
            "  • A [b]Factory[/b] consumes raw inputs via a [color=#FFC850]recipe[/color] and outputs a finished good.\n" +
            "  • A [b]Farm / Mine[/b] produces the raw tier (wheat, coffee beans, sugar, metal, etc.).\n" +
            "  • An [b]R&D Center[/b] slowly raises your [b]Tech[/b] level for a product.\n\n" +
            "Internal transfers between your own buildings are [b]cash-neutral[/b] — goods move at their COGS, " +
            "not retail price, so you can't 'print money' by shuffling inventory. The gain is eliminating the " +
            "world-market markup and capturing the entire margin yourself.\n\n" +
            "Watch your [b]utilization[/b] — a factory running half-full still pays full upkeep."
        ),
        (
            "Demand and Q/B/T",
            "Consumer demand in each city is allocated across competing offers by a [b]softmax allocator[/b] " +
            "weighing four levers:\n" +
            "  • [b]Price[/b] — cheaper wins, all else equal.\n" +
            "  • [b]Quality[/b] — a function of input tier and factory tech.\n" +
            "  • [b]Brand[/b] — built slowly by [i]ad campaigns[/i].\n" +
            "  • [b]Tech[/b] — raised by [i]R&D[/i]; improves quality ceilings and Brand growth.\n" +
            "The acronym is [color=#FFC850]Q/B/T[/color] (quality / brand / tech).\n\n" +
            "Ads grow [b]Brand[/b] per (product, city) and decay gently without upkeep. R&D grows [b]Tech[/b] " +
            "globally per product. Both are slow compounders — start early, be patient."
        ),
        (
            "Time and ticks",
            "The world ticks [b]one month per tick[/b]. Control time with:\n" +
            "  • [color=#FFC850]Space[/color] — toggle play/pause.\n" +
            "  • [color=#FFC850].[/color] (period) — advance one month while paused.\n" +
            "  • [color=#FFC850]1[/color] / [color=#FFC850]2[/color] / [color=#FFC850]3[/color] — " +
            "speeds (1.00 / 0.50 / 0.20 real-seconds per month).\n\n" +
            "A tick is deterministic: given the same save, the same month always produces the same outcome. " +
            "This makes bug reports reproducible and enables the replay viewer.\n\n" +
            "[b]Autosave[/b] fires once per in-game year to [i]user://autosaves[/i] and keeps the three newest " +
            "files. Manual saves (via [color=#FFC850]Save[/color]) have no retention cap."
        ),
        (
            "Reports and goals",
            "Five read-only scenes surface what's going on:\n" +
            "  • [color=#FFC850]R[/color] — [b]Reports[/b]: cash & net-income sparklines, KPI tiles.\n" +
            "  • [color=#FFC850]F[/color] — [b]Financial Statements[/b]: IS / BS / CF, filterable by year.\n" +
            "  • [color=#FFC850]A[/color] — [b]Activity Feed[/b]: chronological event log.\n" +
            "  • [color=#FFC850]C[/color] — [b]City Map[/b]: per-city demographics and building footprint.\n" +
            "  • [color=#FFC850]I[/color] — [b]Market Intel[/b]: competitor prices and share per product.\n\n" +
            "If the active scenario defines [b]goals[/b] (market share, top brand, export revenue, etc.), the " +
            "Reports scene shows a Goals tab tracking each against its threshold."
        ),
        (
            "Beating the AI",
            "You will face one or more of four AI archetypes:\n" +
            "  • [b]Simple[/b] — a novice retailer. Fixed markup, no ads, no R&D. Good sparring partner.\n" +
            "  • [b]Adaptive[/b] — a balanced four-lever player. Adjusts price to undercut you, invests " +
            "in ads and R&D, opens stores where demand is hot.\n" +
            "  • [b]VerticalIntegrator[/b] — a cost-focused rival. Builds farms → factories → retail on one " +
            "chain. Squeezes your margin when you buy raws from the world market.\n" +
            "  • [b]TechLeader[/b] — a single-hero premium player. Picks the highest-price finished good, pours " +
            "R&D and brand into it, sells at 1.3× the competition.\n\n" +
            "Counter-strategy depends on the mix — you can't out-cost a VI, but you can out-brand a Simple."
        ),
        (
            "Tips and wrap-up",
            "A few parting notes:\n" +
            "  • Press [color=#FFC850]?[/color] anywhere in Main to pull up the full keybind list.\n" +
            "  • [color=#FFC850]Esc[/color] always backs out — closes modals, returns to the title from Main.\n" +
            "  • Saves live under [i]user://saves[/i]; autosaves under [i]user://autosaves[/i].\n" +
            "  • The simulation is pure C#; every number you see comes from the ledger, not a display hack.\n\n" +
            "That's the tour. Click [color=#FFC850]Close[/color] or press [color=#FFC850]Esc[/color] to start " +
            "playing. You can re-open this tutorial at any time from the Main HUD.\n\n" +
            "[i]Good luck, magnate.[/i]"
        ),
    };

    private int _currentPage;
    private Label? _header;
    private Label? _counter;
    private RichTextLabel? _body;
    private Button? _backButton;
    private Button? _nextButton;
    private Button? _skipButton;
    private Button? _closeButton;

    public override void _Ready()
    {
        _header = GetNode<Label>("Panel/VBox/HeaderLabel");
        _counter = GetNode<Label>("Panel/VBox/PageCounterLabel");
        _body = GetNode<RichTextLabel>("Panel/VBox/ScrollContainer/BodyText");

        _backButton = GetNode<Button>("Panel/VBox/HBox/BackButton");
        _nextButton = GetNode<Button>("Panel/VBox/HBox/NextButton");
        _skipButton = GetNode<Button>("Panel/VBox/HBox/SkipButton");
        _closeButton = GetNode<Button>("Panel/VBox/HBox/CloseButton");

        _backButton.Pressed += OnBack;
        _nextButton.Pressed += OnNext;
        _skipButton.Pressed += OnExit;
        _closeButton.Pressed += OnExit;

        Render();
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is not InputEventKey key || !key.Pressed || key.Echo) return;

        switch (key.Keycode)
        {
            case Key.Right:
            case Key.Down:
                OnNext();
                GetViewport().SetInputAsHandled();
                break;
            case Key.Left:
            case Key.Up:
                OnBack();
                GetViewport().SetInputAsHandled();
                break;
            case Key.Escape:
                OnExit();
                GetViewport().SetInputAsHandled();
                break;
        }
    }

    private void OnNext()
    {
        // Last-page Next exits (same as Close/Skip) — a natural end to the tour.
        if (_currentPage >= _pages.Length - 1)
        {
            OnExit();
            return;
        }
        _currentPage++;
        Render();
    }

    private void OnBack()
    {
        if (_currentPage <= 0) return;
        _currentPage--;
        Render();
    }

    /// <summary>
    /// Leave the tutorial. If a world is live (tutorial opened mid-game via the
    /// Main HUD button), return to Main. Otherwise the player booted into the
    /// tutorial standalone — return to the title screen.
    /// </summary>
    private void OnExit()
    {
        var target = GameState.World is not null
            ? "res://scenes/Main.tscn"
            : "res://scenes/TitleScreen.tscn";
        GetTree().ChangeSceneToFile(target);
    }

    private void Render()
    {
        var (title, body) = _pages[_currentPage];
        if (_header is not null) _header.Text = title;
        if (_body is not null) _body.Text = body;
        if (_counter is not null) _counter.Text = $"{_currentPage + 1} / {_pages.Length}";

        // Dim Back on page 1; relabel Next to "Finish" on the final page so the
        // user knows they're about to leave.
        if (_backButton is not null) _backButton.Disabled = _currentPage == 0;
        if (_nextButton is not null)
        {
            _nextButton.Text = _currentPage == _pages.Length - 1 ? "Finish" : "Next";
        }
    }
}
