# Magnate — Handover Brief

**Last updated:** 2026-07-17, end of Sprint 15 (demo-polish sprint, phases 3.69–3.73). Use this file to pick up exactly where the previous agent left off.

**Sprint 15 (2026-07-17) delta — read this first:**
- 3.69: Notifications/ScorePopup/NewsTicker wired into REAL gameplay (goal toasts, NI-flip toasts, low-cash warning, headlines; popups on construct/campaign/goals). NewsTicker embedded in Main HUD bottom strip. NEW WinLoseScreen modal (win = all goals; lose = 6 months negative cash or scenario deadline passed), fires once via `GameState.WinLoseShown`. Hotkey hints on HUD buttons. project.godot now launches borderless fullscreen.
- 3.70/3.71: all previously-grey scenes (Reports, FinancialStatements, MarketIntel, StatsDashboard, ActivityFeed, ResearchTree, ReplayViewer, BuildingInspector, SlotEditor) styled to the UiChrome language, code-only. Friendly null-world empty states throughout.
- 3.72: NEW GuidedTutorial overlay (auto-attaches in Main when scenario id == "tutorial"): 5-step auto-advancing checklist w/ step ids build-store/stock-shelf/let-time-pass/run-campaign/grow-value, `StepChanged(stepId)` signal. Old Tutorial scene kept as reference handbook.
- 3.73: NEW SoundManager (music crossfade / SFX pool / VO with music ducking, missing-file = silent no-op) + call sites across TitleScreen/Main/Manage/GuidedTutorial/WinLoseScreen. All 24 audio assets (3 music / 11 SFX / 10 VO, ElevenLabs, voice "Hope") generated into `client/assets/audio/` and boot-verified.
- Known gaps: no client UI for building upgrades (engine 3.59 feature — `upgrade.mp3` SFX waiting); no mute/volume settings UI; ElevenLabs MCP not attached to the project session (config exists in `~/.claude.json` home scope + desktop app config).

---

## 1. What Magnate is

A modern clone of **Capitalism Lab** (business-simulation game). Greenfield project, ~30-month scope, being built phase-by-phase.

- **Name:** Magnate
- **Stack:** Godot 4.3 mono client (C#) + pure-C# engine library (`Magnate.Engine`)
- **Root:** `/Users/eddyh/Documents/2026/Games/Capitalism`
- **User:** Edward (edward@revisionai.co), senior engineer — terse, picks from numbered options, confirms via "1"/"2"/"go"/"parallel sprint", etc.

## 2. Directory layout

```
/Users/eddyh/Documents/2026/Games/Capitalism/
├── engine/
│   ├── Magnate.Engine/              # pure-C# simulation library (zero Godot deps — ADR-0001)
│   │   ├── Ai/                      # AdaptiveStrategy, SimpleRetailerStrategy, VerticalIntegrator, IAiStrategy, Actions
│   │   ├── Content/                 # ContentLoader
│   │   ├── Domain/                  # Building, Company, AdChannel, GameDate, IDs
│   │   ├── Economics/               # Ledger, AdvertisingEngine, IncomeStatement, BalanceSheet
│   │   ├── Persistence/             # WorldSaver (schema v3), WorldLoader, ListSaves
│   │   ├── Scenarios/               # Goal, ScenarioLoader, ScenarioRunner
│   │   └── Simulation/              # World, SimulationConstants, monthly tick
│   └── Magnate.Engine.Tests/        # xUnit tests (161 passing)
├── client/                          # Godot 4.3 project
│   ├── project.godot                # main_scene = TitleScreen.tscn
│   ├── scripts/                     # Main.cs, GameState.cs, Reports.cs, CityMap.cs, ResearchTree.cs, SaveMenu.cs, TitleScreen.cs, ScenarioPicker.cs, SaveBrowser.cs, FinancialStatements.cs, MarketIntel.cs, ActivityFeed.cs, BuildingInspector.cs, Manage.cs, Sparkline.cs
│   └── scenes/                      # matching .tscn files + SmokeTest.tscn
├── content/
│   ├── data/
│   │   ├── buildings/               # production.json, retail.json, media.json, rd.json
│   │   ├── products/                # raws.json, intermediates.json, finished.json
│   │   └── cities/                  # 5 cities (one JSON each): metropolis, eastside, riverside, portbay, hilltown
│   ├── scenarios/                   # 12 scenarios (sandbox, tutorial, soft_drink_war, first_hundred_million, multi_city_mogul, tech_race, monopolist, export_tycoon, brand_monopolist, vertical_showdown, three_way_melee, coffee_monopoly)
│   └── schemas/                     # JSON schemas for validator
├── tools/
│   ├── ContentValidator/            # validates content/ directory
│   └── MagnateSim/                  # CLI runner
└── docs/
    └── plan/                        # phase-*-status.md — one per phase, reverse-chronological history
```

## 3. Local toolchain

.NET 8 and Godot are **not** installed via Homebrew (system tried, required sudo/disabled formulas). They live in user-local paths:

- **.NET 8 SDK:** `$HOME/.dotnet/` (installed via Microsoft's dotnet-install.sh)
- **Godot 4.3 stable mono:** `$HOME/Applications/Godot_mono.app/Contents/MacOS/Godot`

**Environment exports needed in every shell:**
```bash
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"
export GODOT="$HOME/Applications/Godot_mono.app/Contents/MacOS/Godot"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
```

**CRITICAL — Godot needs DOTNET_ROOT set** or it throws `find_hostfxr` error. The `$PATH` alone is not enough.

## 4. Current regression baseline (end of Sprint 14)

| Check | Result |
|---|---|
| Solution build | 0 errors / 0 warnings |
| Engine tests | **229/229 passing** |
| Content validator | 24 products / 18 building types / 5 cities / 16 scenarios / **10 events** |
| Godot smoke test (SmokeTest.tscn) | **11/11 OK** |
| Scenes that boot clean | Main, TitleScreen, Reports, CityMap, ResearchTree, SaveMenu, FinancialStatements, MarketIntel, ActivityFeed, BuildingInspector, HelpOverlay, ReplayViewer, Tutorial, StatsDashboard, TooltipDemo, **SlotEditor, NotificationsDemo, NewsTicker, ScorePopupDemo** |
| Save schema | **v9** (backward-compat to v1) |
| AI archetypes | 4 (Simple, Adaptive, VerticalIntegrator, TechLeader) |
| Patent system | 24-month exclusivity + licensing with 5% royalties |
| Building upgrades | Level 1→2→3 ladder on 5 types |
| Tooltip adoption | Manage, Reports, FinancialStatements, BuildingInspector |
| **Events / news engine** | **10 seed events** (commodity shocks, IPOs, viral ads, headlines); NewsLog persisted; price-multiplier overlay on world market |
| **Game-feel frameworks** | Notifications, NewsTicker, ScorePopup — all NEW with demo scenes |

Run the full regression:
```bash
export PATH="$HOME/.dotnet:$PATH" && export DOTNET_ROOT="$HOME/.dotnet" && export GODOT="$HOME/Applications/Godot_mono.app/Contents/MacOS/Godot"
dotnet build /Users/eddyh/Documents/2026/Games/Capitalism 2>&1 | tail -8
dotnet test /Users/eddyh/Documents/2026/Games/Capitalism/engine/Magnate.Engine.Tests --no-build --logger "console;verbosity=minimal" 2>&1 | tail -5
dotnet run --project /Users/eddyh/Documents/2026/Games/Capitalism/tools/ContentValidator --no-build 2>&1 | tail -5
"$GODOT" --headless --path /Users/eddyh/Documents/2026/Games/Capitalism/client res://scenes/SmokeTest.tscn 2>&1 | tail -15
"$GODOT" --headless --path /Users/eddyh/Documents/2026/Games/Capitalism/client res://scenes/Main.tscn --quit-after 15 2>&1 | tail -5
```

**Godot headless invocation gotcha:** run with `run_in_background` or a manual polling loop — piping to `tail -N` via `&&` causes the pipe to buffer and the shell doesn't flush until Godot exits. Previous agent got caught waiting 3+ minutes. Either redirect stdout to a file and poll `ps -p PID`, or run it unpiped.

## 5. Key engine invariants (do not break)

1. **Zero Godot deps in `Magnate.Engine`** (ADR-0001) — the engine project references nothing from Godot. Client depends on engine, never reverse.
2. **Cash = ledger sum.** Every cash movement goes through `world.Ledger`. Company cash must always equal cumulative ledger entries for that company.
3. **Deterministic iteration.** Everywhere you iterate `world.Buildings.Values`, `world.Companies`, etc., add `OrderBy(x => x.Id.Value, StringComparer.Ordinal)` for reproducibility across runs.
4. **Books close.** `Equity = StartingCapital + cumulative NetIncome`. Tested in PersistenceTests and others.
5. **Save schema backward-compatible.** Loader accepts schema v1, v2, v3. Bumping schema version is fine; removing a field is not.
6. **Ad channel serialization is by name**, not ordinal — enum members can be appended safely.

## 6. Simulation tick order (10 steps)

Each monthly tick: opex → research → advertising → extraction → production(intermediate) → production(finished) → restock warehouses → restock retailers → demand allocation → auto-export surplus.

Q/B/T (Quality, Brand, Technology) attributes → perceived-value softmax: `weight = max((Q + T×10 + B)/3, 1) / price^elasticity`.

WAC (weighted-average cost) accrual accounting throughout; `Inventory` tracks (qty, cost, qualityMass).

## 7. How we work — the parallel sprint pattern

User says **"parallel sprint"** → I dispatch 3–5 agents simultaneously, each on a non-overlapping phase. Completed 6 sprints so far (3.9 through 3.28). The pattern:

1. **Pick 3-5 phases** with clean file ownership (zero file conflicts between agents).
2. **Each agent prompt** includes:
   - Phase goal + deliverables (specific files, specific tests)
   - **Investigate-first** instructions (APIs to look up, patterns to match)
   - **STRICT file ownership list** (what they own, what they must NOT touch)
   - Verification commands the agent runs before reporting back
   - Report-back word limit (usually 200-250 words)
   - Path to a status doc they write (`docs/plan/phase-X.YY-status.md`)
3. **Dispatch all in a single message** using `run_in_background: true` on each Agent call.
4. **Wait for completions** — notifications arrive asynchronously.
5. **Integrate centrally** — rebuild, rerun tests, run Godot smoke + scene boots, wire up any cross-agent Main.cs integration (previous agents were told not to touch Main.cs for new client scenes; central wiring adds buttons + keyboard shortcuts at end).
6. **Report back** to user with integration matrix + what landed + where Magnate stands + numbered choices for next.

**File-ownership discipline is the critical invariant** — if two agents modify the same file concurrently, you get merge conflicts. Document the grid in each agent's prompt explicitly.

**Godot sandbox gotcha for agents:** Spawned agents often can't execute the Godot binary (sandbox denies it). Expect them to report "headless boot unverified". Integration-time boot testing is the main agent's job.

## 8. Phase history (condensed)

- **1.x** — schema, engine types, content model, ContentLoader, CLI (MagnateSim)
- **2.x** — AI strategies, Q/T/B, R&D, advertising, save/load, more scenarios
- **3.1–3.8** — Godot client, Main/Reports/Manage, playback live-tick + sparklines
- **3.9** — Save schema v2 (scenarioId, playerId)
- **3.10** — Trends tab (5 sparklines: Cash, Revenue, NI, Brand, Tech)
- **3.11** — 2 scenarios (first_hundred_million, tech_race)
- **3.12** — Eastside city + coffee_beans/roasted_coffee/coffee_drink chain
- **3.13** — 4 new goal types (NetIncomeSinceStart, TopBrand, ExportRevenue, ConsecutiveProfitableMonths)
- **3.14** — CityMap scene
- **3.15** — Plantation buildings + hops/malt/beer chain (coffee switched to plantation source)
- **3.16** — Save schema v3: AI strategy config persisted (6 AdaptiveStrategy tunables round-trip)
- **3.17** — Playback controls (1×/2×/5× buttons, keyboard shortcuts Space/./1/2/3/M/R/C/Esc)
- **3.18** — 2 scenarios (export_tycoon, brand_monopolist)
- **3.19** — Autosave every 12 months (keep last 3) + full Save/Load menu UI
- **3.20** — Title screen polish (larger font, gold underline, pulse+tween animation)
- **3.21** — Media buildings (tv_station, radio_station) — 1.35× ad-reach bonus for station owners
- **3.22** — Research Tree UI (tech levels + R&D progress per product, grouped by tier)
- **3.23** — VerticalIntegrator AI (second archetype: retailer → factory → extractor chain)
- **3.24** — Financial Statements UI (Income / Balance / Cash Flow tabs, period selector)
- **3.25** — AdChannel.Radio enum + radio_station bonus activation
- **3.26** — Market Intelligence screen (city × product grid with competitor data)
- **3.27** — BuildingInspector enhancement (slot details, workforce, tier-split inventory)
- **3.28** — Activity Feed (event stream from ledger/building/goal/tech deltas)
- **3.29** — Per-building P&amp;L ledger attribution: `LedgerEntry` gains `BuildingInstanceId? Building`; save schema v3 → v4 (backward-compat load); BuildingInspector renders real cash-flow breakdown. 8 RecordCashChange call sites threaded; 9 new engine tests.
- **3.30** — Keyboard help overlay scene (`?` toggle, HUD button "Help (?)") listing Playback / Scenes / Navigation keybinds.
- **3.31** — Exports tab in Reports (7th tab) — 12-month rolling view by product + defensive per-building attribution once ExportSale entries carry BuildingId (need: `MonthlyTick.AutoExportSurplus` to pass building.Id — Phase 3.29 threaded ledger but not this specific path; small follow-up).
- **3.32** — Balance Sheet drill-down: per-building construction value, per-building inventory with WAC, equity reconciliation ("the books close") in FinancialStatements.
- **3.33** — Three new scenarios: `vertical_showdown` (vs VerticalIntegrator opponent), `three_way_melee` (3 AI competitors), `coffee_monopoly` (full coffee chain). `VerticalIntegrator` wired into ScenarioRunner + WorldSaver/Loader strategy discriminators (`"verticalIntegrator"`).
- **3.34** — Newspaper + magazine ad channels: new `newspaper_publisher` and `magazine_publisher` building types (1.25× reach bonus, distinct `SimulationConstants.MediaOwnershipAdBonusPrint` vs broadcast's 1.35×). +5 tests.
- **3.35** — Replay viewer scene: month-by-month timeline of ledger/cogs/transfer history. `P` keybind + HUD button wired into Main.
- **3.36** — Research tree upgraded from list to directed node-graph: three tier columns (Raw/Intermediate/Finished), cubic-bezier edges, keyboard navigation (←/→ tiers, ↑/↓ within tier, Enter toggles sidebar), tier-colored node styling + progress bars.
- **3.37** — SaveBrowser rich preview: HSplitContainer layout, right-pane shows scenario/clock/company/buildings-by-category/top-3-products-by-revenue/goal-count without loading the save. Graceful fallbacks for corrupt or wrong-version files.
- **3.38** — Scenario picker difficulty rating (⭐–⭐⭐⭐⭐⭐) computed heuristically from cash disadvantage + goal count + AI count + duration + strategy toughness + hard-goal mix. OptionButton filter (All / Easy / Normal / Hard). Sandbox pinned at top regardless.
- **3.39** — Engine cleanup: AutoExportSurplus already passed BuildingId (was already done in Sprint 8); VerticalIntegrator's 5 tunables now round-trip through save/load via the AdaptiveStrategy config-dict pattern; `CogsEntry.SourceBuilding` added (schema v4 → v5, backward-compat). Per-building accrual P&L is now data-ready for a future BuildingInspector rewrite.
- **3.40** — Manage scene polish: Build tab gains cost-preview + affordability badge + category filter; Buildings tab gains slot-usage / category / per-building cashflow + sort dropdown; Campaigns tab gains reach preview + media-bonus annotations; live-tick auto-refresh.
- **3.41** — MarketIntel deep dive: per-(city, product) leaderboard panel (replays softmax client-side), Top-3 tab (markets to enter / defend), 12-month share sparkline, product/filter chips, live-tick refresh.
- **3.42** — CityMap upgrade: owner-colored building density bars + dot grid, demographic stacked strip per city card, click-to-drill detail panel with full demographics + buildings-by-owner + top-8 demand, heat map mode (player share by city), 3-mode toggle (Density / Mix / Heat).
- **3.43** — ActivityFeed: 9 filter chips (Sales/Opex/Construction/Ads/R&D/Goals/Transfers/Milestones/Month), severity color-coding (green/red on dollar amounts; gold milestones, cyan R&D), search box with case-insensitive substring match, per-month grouping with section headers, live-tick incremental scanning.
- **3.44** — Per-bracket reservation prices: products can declare `reservationPrice` per IncomeBracket; `AllocateDemandAndSell` allocates per-bracket (Low/Middle/High), excluding retailers above each bracket's ceiling. Opted in soft_drink, beer, coffee_drink, television, car (the rest stay null = no constraint, backward-compat). +6 tests.
- **3.45** — BuildingInspector accrual P&L: replaces cash-flow placeholder with three-window accrual view (This month / Last 12 months / Since open), reuses `Sparkline` for monthly net-income trend. Uses Phase 3.39's CogsEntry.SourceBuilding.
- **3.46** — TitleScreen scenario showcase: 4 highlight scenarios (tutorial / coffee_monopoly / vertical_showdown / sandbox) shown as cards with star ratings + 1-line descriptions + Quick-pick "Play" buttons that route directly into Main with the scenario applied. Phase 3.20 polish preserved.
- **3.47** — SaveMenu enhancements: rename + delete (with confirm), autosave indicator (`[A]` badge + tinted background), sort dropdown (Modified / Name / Size / Schema), Ctrl/⌘+S quicksave keybind.
- **3.48** — TechLeader AI archetype: heavy R&D + premium pricing + flat-budget brand investment. Hero product = highest-price Finished good (`car` in canonical catalog). Wired into all 4 switch sites; round-trips through save/load. +6 tests.
- **3.49** — Patent system: reaching MaxTechLevel grants 24-month patent (`SimulationConstants.PatentDurationMonths`); competitor R&D points silently dropped while active. At-most-one-patent-per-(company,product) ever via persisted `_patentsEverGranted`. Schema v5 → v6. +7 tests.
- **3.50** — Three new scenarios: `tech_titan_clash` (vs TechLeader, premium electronics), `four_archetype_melee` (4-AI mix, all archetypes), `patent_race` (tech sprint, no patent system dependency).
- **3.51** — Onboarding Tutorial scene: 10-page walkthrough (Welcome → Picking scenarios → HUD → First retailer → Supply chain → Q/B/T demand → Time/ticks → Reports → AIs → Tips). Next/Back/Skip/Close + arrow-key nav. Wired into Main HBox2.
- **3.52** — StatsDashboard scene: cross-cutting analytics — header strip + cash sparkline + market-share heatmap + R&D leaderboard + brand top-5 + top-5 buildings by revenue/opex. Wired with `X` keybind.
- **3.53** — Tooltip framework: `Tooltip.Attach(control, bbcode)` static helper with hover-delay + viewport-clamped popup. Standalone TooltipDemo scene verifies it. Existing scenes unchanged; future polish phases adopt.
- **3.54** — Patent licensing: holder can `GrantPatentLicense(licensee, product)`/`RevokePatentLicense(...)`; licensee's R&D resumes and they pay 5% royalty (`SimulationConstants.PatentRoyaltyRate`) on retail+export sales. New `LedgerCategory.PatentRoyaltyIncome`/`PatentRoyaltyExpense`. Schema v6→v7. License auto-removed when patent expires. +12 tests.
- **3.55** — ReplayViewer enrichment: per-month accrual NI (Revenue − COGS − Opex − Ads), per-building top-3 by abs(NI) using `CogsEntry.SourceBuilding`, defensive Phase-3.54 royalty detection via `Enum.TryParse`, cumulative-NI sparkline.
- **3.56** — Tooltip adoption in Manage scene: 14-15 tooltips wired across Build / Buildings / Campaigns tabs (cost preview, affordability, channel cost-per-point, brand-decay annotation). First real-world adoption of the Phase 3.53 framework.
- **3.57** — `ScenarioDifficulty` shared helper extracted from TitleScreen + ScenarioPicker duplicates. NEW `client/scripts/ScenarioDifficulty.cs` exposes `Compute(Scenario)`, `FormatStars(rating)`, `FormatStarsBbcode(rating)`, `Bucket(rating)`. Net −39 lines. Ratings unchanged for all 16 scenarios.
- **3.58** — Fashion product chain: `cotton` (raw, already existed; reused) → `denim_fabric` (NEW intermediate) → `designer_jeans` (NEW finished, premium with reservation prices Low=$0/Middle=$150/High=∞). Plus new scenario `fashion_empire`. 22 → **24 products**, 15 → **16 scenarios**. Caused 1 brittle test failure (now fixed) — `AdaptiveAiTests.AdaptiveStrategy_builds_research_center_once_retail_is_saturated` had hard-coded the 7-finished/35-market assumption; now derives the time budget from `world.Catalog.Products.Values.Count(...) × Cities.Count + 15` so future content additions don't break it.
- **3.59** — Building upgrades/leveling: `BuildingType.Levels` ladder + `World.UpgradeBuilding(...)` + `GetCapacity(building)` / `GetMonthlyOpex(building)` helpers + new `LedgerCategory.UpgradeCost`. 5 types opted in (supermarket / factory_small / factory_large / large_farm / oil_well) with L1=current, L2=+50% capacity at 0.85× opex, L3=2× capacity at 0.70× opex. Schema v7→v8 backward-compat. +8 tests (`BuildingUpgradeTests.cs`).
- **3.60** — Tooltip adoption in Reports + FinancialStatements: 17 tooltips total (10 in Reports — 7 Godot built-in `SetTabTooltip` + 3 custom on Back/Play/Advance; 7 in FinancialStatements — 4 custom + 3 tab tooltips).
- **3.61** — Tooltip adoption in BuildingInspector: 17 tooltips covering inventory grid, AutoExport toggle, P&L window header, each P&L row (Revenue / COGS / Gross Profit / Opex / Advertising / Net Income), sparkline header, slot-config controls, AddSlot button.
- **3.62** — Patent licensing UI in Manage: 4th tab "Patents" listing player's active patents with sub-list of licenses + Grant/Revoke buttons; Section B lists competitors' patents with player's license status. Live-tick refresh.
- **3.63** — `GameState.HistorySnapshot.CorporateValue` added. `RecordSnapshot` computes CV via `GetBalanceSheet.Cash + InventoryValue + BuildingValue + 10 × NI(last 12 months)`. StatsDashboard "Corporate Value sparkline" now actually plots CV (was plotting cash).
- **3.64** — **Slot-and-arrow visual editor** (signature mechanic): NEW SlotEditor scene. Three columns (Inputs / Manufacturing / Distribution) with cubic-bezier arrows showing material flow. Tier-colored card borders (raw=green / intermediate=amber / finished=blue). Keyboard nav (←/→ tiers, ↑/↓ within), inspector side panel. Read-only v1; clicking a slot returns to BuildingInspector. Wired via "Visual Editor" button in BuildingInspector. Mockup at `docs/design/phase-3.64-slot-editor-mockup.png` (Stitch-generated reference).
- **3.65** — Events / news engine: `EventDefinition` (RandomTrigger + WorldMarketPriceMultiplier / BrandShift / Headline effects), `EventEngine` rolls dice deterministically per tick, fires at most one event per month. 10 seed events shipped. `World.NewsLog` persisted; `World.GetEffectiveWorldPrice` overlays multipliers on `Product.BaseWorldMarketPrice` without mutating catalog. Schema v8→v9. +10 tests.
- **3.66** — Notification toast framework: `Notifications.Show(text, severity, duration)` static helper with CanvasLayer-parented stack of fade-in/hold/fade-out toasts (Info/Success/Warning/Error). Demo scene NotificationsDemo verifies. Existing scenes unchanged; future polish phases adopt.
- **3.67** — News ticker scene: scrolling RIGHT-TO-LEFT banner reading `World.NewsLog` via reflection (defensive vs Phase 3.65 timing). Severity-color BBCode (Info dim grey, Notable white, Major gold). Standalone scene; integrator can later embed in Main HUD strip.
- **3.68** — Score popup overlay: `ScorePopup.Spawn(position, amount, color?)` floating "+$X" labels that rise + fade-out over 1.2s. Green for positive, red for negative, gold for milestones. Demo scene ScorePopupDemo. Future polish phases trigger on sales / goal-achieved events.

Each phase has a status doc at `docs/plan/phase-X.YY-status.md`.

## 9. Current client scene graph

```
TitleScreen.tscn (main_scene)
  ├── ScenarioPicker.tscn → Main.tscn
  └── SaveBrowser.tscn → Main.tscn
Main.tscn
  ├── Manage.tscn (M)
  ├── Reports.tscn (R)
  ├── CityMap.tscn (C)
  ├── ResearchTree.tscn (T)
  ├── SaveMenu.tscn (S)
  ├── FinancialStatements.tscn (F)
  ├── MarketIntel.tscn (I)
  ├── ActivityFeed.tscn (A)
  ├── ReplayViewer.tscn (P)
  ├── StatsDashboard.tscn (X)
  ├── Tutorial.tscn (button only)
  ├── HelpOverlay.tscn (?)
  ├── BuildingInspector.tscn (navigated via SelectedBuilding from Manage/CityMap)
  └── TitleScreen.tscn (Esc — back to title)
```

Playback keys: Space toggle, `.` advance-one-month, 1/2/3 speed, Esc back-to-title. `?` opens HelpOverlay. `P` opens ReplayViewer. `X` opens StatsDashboard. Tutorial via the HUD button (no keybind reserved).

## 10. Key gotchas / known issues

- **xUnit analyzer** disallows `Assert.Empty(collection.Where(pred))` → use `Assert.DoesNotContain(collection, predicate)` per xUnit2029.
- **XML doc comment `P&L`** parses as XML entity — escape as `P&amp;L`.
- **`yield return` in catch block** (CS1631) — hoist the exception message to a variable, yield outside the catch.
- **AdvertisingCost ledger invariant** — when extending ad math (e.g. media bonus), boost reach via a derived `effectiveBudget` passed to pointsAtFull; do NOT change the ledger entry amount.
- **Radio is inert without AdChannel.Radio** — Phase 3.21 shipped radio_station as a building type before the enum member existed; Phase 3.25 closed the loop.
- **BuildingInspector per-building P&L is a placeholder** — ledger entries don't yet have BuildingId attribution. Phase 3.29 (future) would add that.
- **Bash `timeout`** command is not installed on macOS — polling loop pattern instead.
- **Godot scene files** — if script access `GetNode<Button>("Hud/VBox/HBox2/FooButton")`, the button must exist in the `.tscn` file at that exact path.

## 11. User's collaboration style (from memory)

- Terse replies — single words ("1", "go", "parallel sprint") pick from my numbered options.
- Wants parallel work ("agent teams to work in parallel … don't compromise on quality").
- Picks from the menu I offer at end of each response; doesn't usually free-form new requests.
- Doesn't ask for summaries unless confused — diff is enough.
- Memory files live at `/Users/eddyh/.claude/projects/-Users-eddyh-Documents-2026-Games-Capitalism/memory/`.

## 12. Immediately-pending state

**Just finished:** Sprint 14 — **the game-feel pivot**. Phases 3.64–3.68 integrated and verified. 229 tests green, smoke test 11/11, 19 scenes boot clean, save schema v9, 16 scenarios, 24 products, 10 events, patent system + licensing + UI, building upgrades, tooltip adoption in 4 scenes, slot-and-arrow visual editor + events engine + notification/ticker/score-popup frameworks all live.

**Sprint-14 known small follow-ups:**
- Notifications, NewsTicker, ScorePopup are frameworks with demo scenes only — adoption (firing toasts on goal achieved, popups on sales, ticker embedded in Main HUD) is the polish phase.
- AI strategies don't react to events (e.g., a TechLeader hearing news of "tech_breakthrough" should accelerate R&D budget).
- SlotEditor is read-only — drag-and-drop interactivity is a future phase.
- News ticker is a standalone scene; integrator should embed into Main.tscn HUD strip in a future polish phase.

**Sprint 14 hiccups (resolved during integration):**
1. Phases 3.66 + 3.68 had `Engine.GetMainLoop()` calls that resolved to `Magnate.Engine` namespace instead of `Godot.Engine` (3 errors). Fixed by qualifying with `Godot.Engine.GetMainLoop()`.
2. SlotEditor wired to BuildingInspector via "Visual Editor" button (added during integration).

**Sprint 7 known small follow-ups (low-effort, good candidates for a quick cleanup sprint):**
- `MonthlyTick.AutoExportSurplus` should pass `building.Id` to `RecordCashChange` so `ExportSale` entries carry `BuildingId` — Phase 3.29 threaded most sites but missed this path. Phase 3.31's Exports tab will automatically populate the per-building breakdown when this lands.
- `BuildingInspector` per-building P&L is cash-flow style (not accrual) because `CogsEntry` doesn't yet carry a source `BuildingInstanceId`. Adding `BuildingInstanceId? SourceBuilding` to CogsEntry + threading it in `MonthlyTick` would unlock true accrual per-building P&L.
- `VerticalIntegrator` tunables (CushionMonths, PriceUndercut, SoloMarkup, PriceFloorMultiplier, AdBudgetPerCity) don't round-trip through save/load yet — parameterless ctor only. Mirror the AdaptiveStrategy config-dict pattern to close this.

**Reasonable next moves (pick at user's preference):**
1. Another 5-way parallel sprint on the backlog (see below)
2. Phase 4.1 — Stock market / IPO (sequential, large, the first DLC-equivalent vertical)
3. Small cleanup sprint resolving the three Sprint-7 follow-ups above (engine-only, tight scope)
4. Tutorial expansion with pop-up tips walking players through the new screens

**Backlog candidates for future parallel sprints:**
- Newspaper/magazine ad channels (enum exists; no media buildings yet for these channels)
- Labor market mechanics (wages → headcount → productivity)
- Per-product demand curves with price sensitivity per income bracket
- Credit rating + bond issuance (finance DLC preview)
- Company logo/color customization
- Polish pass: tooltips, number formatting consistency, no-active-game guards
- Replay / playback of saved game history
- Research-tree visualizer (node graph instead of the current list)
- Patent system (tech + R&D interlock)
- Localization scaffolding (string table, en-US baseline)

## 13. Files you should skim before starting

Quick orientation reads (in priority order):
1. This file (HANDOVER.md).
2. `docs/plan/phase-3.68-status.md` (most recent phase doc); Sprint 14 status docs are 3.64–3.68; Sprint 13 = 3.59–3.63; Sprint 12 = 3.54–3.58; Sprint 11 = 3.49–3.53; Sprint 10 = 3.44–3.48; Sprint 9 = 3.39–3.43; Sprint 8 = 3.34–3.38; Sprint 7 = 3.29–3.33.
3. `engine/Magnate.Engine/Simulation/World.cs` (central engine type).
4. `engine/Magnate.Engine/Ai/AdaptiveStrategy.cs` (AI patterns).
5. `client/scripts/Main.cs` (client entry + routing).
6. `client/scripts/GameState.cs` (shared client state).
7. `.claude/projects/.../memory/MEMORY.md` (user's persistent preferences).

Don't try to read every phase status doc — they exist for archaeology, not orientation.

---

**End of handover. Good luck.**
