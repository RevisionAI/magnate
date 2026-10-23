# Magnate overhaul — UX & Playability research (web client)

**Author:** ux-playability (senior game UX designer + playtester) · **Date:** 2026-09-30 · **Status:** research input for the web-client build (Vite + React + TS + Three.js + zustand, engine in WASM behind Magnate.Bridge)

**Scope:** (1) parity inventory of the Godot client + scenario/tutorial content, (2) a critical first-time-player assessment backed by a scripted engine playtest, (3) the web client's UX information architecture: screens, HUD, build flow, building inspector, reports, finance, markets, R&D, marketing, rivals, news, advisor/voice, tutorial, settings, save/load, win/lose; a "first 15 minutes" flow, and a list of game-feel moments.

---

## 0. TL;DR (decision-relevant)

1. **The tutorial as written takes 58 in-game months and teaches the wrong lessons.** If you follow it literally (supermarket, soft_drink @ $1.80, restock 500,000, TV $50K/mo), you sell exactly 500,000 bottles and book $900K revenue every month from month 1 to month 58. The restock target is the binding constraint, not demand (Metropolis demand is 2.63M/mo). **Advertising changes nothing except cost:** net income drops from $135K to $85K/mo, and skipping ads would reach the $20M value goal at month 38 instead of 58. Hilltown takes 98 months. (See §3.1.)
2. **Every non-soft-drink product is a trap at the Build-tab defaults** ($1.80 price, 500,000 restock, the same for every product). A supermarket selling cars at the defaults loses **$8.99 billion in month 1** and shows the Bankruptcy screen at month 6. TV, jeans and t-shirts go bankrupt by month 6–9; beer at month 30. Nothing warns the player. The "net income turned negative" toast only fires on a +→− flip, so a player who loses money from day one never sees it. (§3.2)
3. **Price doesn't move total demand.** Category demand is fixed at population × per-capita × reservation-price gates (MonthlyTick.cs:368-396); price only splits that fixed pie between sellers. The best soft-drink price is just under a reservation ceiling ($7.99 or $49.99). A $49.99 soft drink in uncontested Hilltown earns **$19.4M/mo from a $1.2M store** and wins the tutorial in month 3. This one issue decides whether the game can follow real business principles at all. (§3.3–3.4)
4. **Goals can be satisfied without doing the thing they describe.** A $0.01 price with a 1-unit restock "achieves" a 55% market-share goal with 0% real sales. Six identical slots in one store triple your share and income for free. Brand Monopolist is won in month 10 with **zero buildings** (ads only). An ad in a city where you have no store satisfies tutorial step 4. (§3.4)
5. **Two scenarios can't be won:** `four_archetype_melee` needs 84 months but ends at month 83. `tech_titan_clash` needs 60 but ends at 59. (§3.5)
6. **AI pricing runs away** (TechLeader.cs:170 uses total inventory cost `CostOf()` as a per-unit floor; lines 180 and 327 price at 1.3× the most expensive competitor). Cars reach $10.9M at month 6 and $3.0B at month 60. Rivals end up with $70B–$6.9T cash on the HUD. Even the "simple sparring partner" LocalCo grows from $10M to $914M while the tutorial player reaches $20M. (§3.5)
7. **Feedback loops are broken or missing:**
   - Units sold and lost sales are never shown. BuildingInspector.cs:771 says "(last-month units sold needs engine support)".
   - The displayed market share is a softmax that *drops when you sell out*: 13.9% shown vs 27.2% real.
   - "Corporate value" means two different numbers: the goal uses TotalAssets; the end screen adds 10× NI.
   - The HUD "Buildings" metric counts every company's buildings: 25 shown vs 1 owned.
   - Upgrades break the books (equity drift −$720K).
8. **Onboarding structure is fragile:**
   - Tutorial guidance disappears on the screen where you act, because the overlay lives only in Main.
   - The step voice-over replays every time you return to the HUD.
   - The Campaigns tab defaults to beer/Eastside.
   - The 10-page handbook describes land, purchase contracts and quality mechanics that don't exist.
   - Esc on the HUD throws away the unsaved game without asking.
9. **Web client IA (§6):** the city is the interface.
   - Persistent HUD: cash, company value, date and day-clock, speed, alerts, advisor, goals.
   - Left navigation rail with ten hotkeyed destinations. Inspector drawers on the right. Full-screen overlays for Reports, Finance and Markets.
   - A four-step build flow: palette → ghost on plots with live cost and catchment → confirm with runway → construction progress.
   - A CapLab-style three-column Layout tab (Inputs → Processing grid → Sales, with arrows). Price is set with a banded slider and stock as "months of cover" instead of raw units.
   - **Pacing:** keep the monthly engine tick. 1× = 12 s/month with a 30-day visual clock, plus 2×/4×/8×, step-one-month, and auto-pause rules.
10. **First 15 minutes (§7):** a scripted chapter with first revenue at 3:15 real time, the rival's arrival at 4:10, a visible ad-driven sales recovery by 6:50, a bank loan and expansion at 8:00–10:15, and victory at 14:30 (about 34 in-game months, $6M → $10M value).
    - It needs these engine changes first: price-elastic demand, lost-sales tracking, a realised-share metric, construction time and land, and loans.
    - The game-feel catalogue (§8) ties 38 economic events to visual, audio, voice and camera responses with thresholds and rate limits. The VO list (§9) has 35 new advisor lines.

---

## 1. Method and evidence

| Evidence | What | Where |
|---|---|---|
| Code read | All 35 client scripts (14,691 lines) and 25 scenes (2,041 lines). The engine's World, MonthlyTick, Goal, ScenarioRunner, MaterialProcurement, Inventory and AI files. All 16 scenario JSONs and the product, building, city and event content. | `client/scripts/*.cs`, `client/scenes/*.tscn`, `engine/Magnate.Engine/**`, `content/**` |
| Scripted playtest harness | A net8.0 console app compiled against a **read-only copy** of the engine source, because a ProjectReference would write obj/bin into the project tree. It plays scenarios as naive, literal-tutorial, careful and exploit players, and also with the built-in AdaptiveStrategy as pilot. Seed 42, as the client uses. | `/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/ux-playability/harness/Program.cs`. Run: `dotnet bin/Release/net8.0/ux-harness.dll <demand\|tutorial-literal\|tutorial-noads\|naive\|careful\|exploits\|scenarios-ai\|accounting\|spiral\|scenario-table\|misc>` |
| Reference | CapLab and Cap2 conventions (3×3 firm unit grid, land/traffic overlays, speed dial, news-locate, supply/demand lines) from the Cap2 manual and CapLab beginner guides fetched by the caplab-brief agent, plus `docs/research/capitalism-reference.md`. | `scratchpad/caplab-brief/Cap2_manual.txt` (lines 395-430, 690-760), `site/beginners-guide-gameplay-basics.txt` |
| Audio inventory | `ffprobe` durations and VO transcripts (from the audio-plan agent's transcription). | `client/assets/audio/**`, `scratchpad/audio-plan/vo_transcripts.json` |

**Caveat:** the harness drives the engine API exactly as the Godot client does: Construct → ConfigureRetailSlot → RegisterAdCampaign → AdvanceMonth. It doesn't simulate the Godot scene-tree timing, so real-time claims are computed from `GameState.SecondsPerMonth`.

---

## 2. Parity inventory of the Godot client (the checklist for the web client)

### 2.1 Scene graph and time behaviour

```
TitleScreen (main_scene; music title_theme; VO vo_welcome once per app run)
 ├─ New Game  → ScenarioPicker ─────────────┐
 ├─ Showcase cards (tutorial, coffee_monopoly, vertical_showdown, sandbox) "Play" ─┤→ Main (seed 42 always)
 ├─ Load Game → SaveBrowser ────────────────┘
 └─ Quit
Main (HUD / "Command Center"; music gameplay_loop; NewsTicker embedded; GuidedTutorial overlay if scenario=tutorial)
 ├─ Manage "Build & Operate" (M; PAUSES on entry) → BuildingInspector → SlotEditor ("Visual Editor")
 ├─ Reports (R) · FinancialStatements (F) · MarketIntel (I) · CityMap (C) · ResearchTree (T)
 ├─ ActivityFeed (A) · ReplayViewer (P) · StatsDashboard (X) · HelpOverlay (?) · Tutorial handbook (button only)
 ├─ SaveMenu (S; pauses) · Save (quick button, no key)
 ├─ WinLoseScreen (modal CanvasLayer inside Main)
 └─ Back to Title (Esc) — discards the world (TitleScreen._Ready → GameState.Clear()), no confirm, no save
Dev/demo scenes: NotificationsDemo, ScorePopupDemo, TooltipDemo, NewsTicker (standalone), SmokeTest
```

**Time runs** (`GameState.TickIfRunning` is called) in: Main, Manage, BuildingInspector, SlotEditor, Reports, FinancialStatements, MarketIntel, CityMap, ResearchTree, StatsDashboard, ActivityFeed.

**Time is frozen** (the play flag stays on, but nothing calls a tick) in: HelpOverlay, the Tutorial handbook, ReplayViewer and SaveMenu. Opening Manage or SaveMenu from Main also sets `IsPlaying=false` (Main.cs:575, 595).

Toasts, the month-tick sound and win/lose detection run **only in Main** (`Main.OnMonthTicked`, `CheckGoalsAndEndStates`). Months can pass in Reports with no warnings, and the loss screen appears only when the player returns to Main.

### 2.2 Screen-by-screen feature inventory

| # | Screen (file) | Features / interactions | Data shown | Defects found (evidence) | Web destination |
|---|---|---|---|---|---|
| 1 | **TitleScreen** (`TitleScreen.cs`, 298 l.) | New Game, Load Game, Quit. Four showcase cards with difficulty stars and a one-line description; "Play" starts at seed 42. Slide-in tween and title alpha pulse. `ui_click` SFX on the main buttons. | Title art `title_empire.png` | No Continue, no Settings. Quick-pick ignores the spectator checkbox. Seed is always 42, so every run is identical. | Title / Main menu (§6.2) |
| 2 | **ScenarioPicker** (`ScenarioPicker.cs`) | Difficulty filter (All/Easy/Normal/Hard). Rows show art, stars, name, pillar, description, "N goals · N AI · subtitle", Start. Checkbox "Let AI drive my company (spectator)" registers AdaptiveStrategy for the player. Sandbox is pinned at top. | Scenario JSON | **Deadline, goals list and starting cash not shown.** Stars are heuristic (§2.5: 2★ Tech Titan Clash is unwinnable). | New Game → Scenario browser + Briefing |
| 3 | **SaveBrowser** | List of saves plus a preview pane: scenario, clock, company, buildings by category, top-3 products by revenue, goal count. Load. | WorldLoader | Doesn't reset `GameState` win/lose, toast or goal flags (only History is cleared). | Load screen (shared with in-game Save/Load) |
| 4 | **Main HUD** (`Main.cs`, 996 l.) | Play/Pause, Advance 1 Month, speeds 1×/2×/5× (1.0/0.5/0.2 s per month, Main.cs:109-111), 14 command buttons in a 3-column grid. Metrics: Cash, This Month (NI), Assets (TotalAssets), Buildings. Rival line (first AI only), executive "Priority" brief (Main.cs:669-719), current-goal tip with progress bar, scenario art plate, embedded news ticker. Toasts: NI sign flip, one-shot low cash (<$1M), up to 2 headlines per tick (Main.cs:809-867). Goal toasts + "Goal achieved!" popup + SFX; win/lose modal (Main.cs:874-924). | Ledger, BS, goals, news | "Buildings" = `_world.Buildings.Count`, which counts all companies (Main.cs:646; harness: 25 shown vs 1 owned at month 24). Rival shows only the first AI. Tip says "Step {completed+1}", which is wrong when goals complete out of order (Main.cs:751). Esc discards the game. The `month_tick` SFX plays every second at 1× (Main.cs:815). No date/deadline countdown. Low-cash toast fires once per game. | HUD (§6.3) |
| 5 | **Manage / "Build & Operate"** (`Manage.cs`, 1,281 l.) | **Build tab:** Starter Investments (4 presets in the most populous city: Corner Store, Bread Aisle, Warehouse Hub, Soft Drink Lab; Manage.cs:541-544). Category filter (7). City dropdown (alphabetical; Eastside first). Building dropdown ("[category] Name (cost · opex/mo)"). First-slot product (ids; "(skip)" default). Price SpinBox default **1.80**. Restock SpinBox default **500,000** (Manage.cs:245,249). Cost preview + affordability badge. Construct → −$ popup + `build_construct` SFX. **Buildings tab:** sort (id/city/category/cash flow), per-building cash-basis "This month", slot summary, top-3 stock, Inspect. **Campaigns tab:** product (ids; default **beer**), city (default **Eastside**), channel (TV/Newspaper/Magazine/Radio), budget (default $50K, step $5K), next-month brand preview, Apply, active list with Cancel. **Patents tab:** own patents with licensee list, Grant/Revoke; rival patents with licence status. | Catalog, ledger | Defaults are dangerous for every product except soft_drink (§3.2). The Buildings tab uses `MaxUnits`, not the upgraded capacity (Manage.cs:718, 694). Its cash-basis "This month" shows stores negative in restock months. The Back tooltip claims time keeps running, but Manage paused it. **No upgrade, demolish, sell, rename or bulk-price controls.** | Build mode (§6.6), Portfolio, Marketing (§6.12), R&D/Patents (§6.11) |
| 6 | **BuildingInspector** (`BuildingInspector.cs`, 999 l.) | Workforce (informational only). Per-building accrual P&L in three windows (this month / 12 m / since open) with a 12-month NI sparkline. Inventory by tier (qty, WAC, avg Q). Auto-export checkbox. Slots: production (capacity, input deficits), extraction (yield, on hand), research (tech, progress, +100/mo), warehouse (target stock editable), retail (price + restock editable, Apply). Add-slot form (defaults 1.80 / 500,000). "Visual Editor" button. | Ledger, CogsLog, inventory | **No units sold or lost sales** (line 771). The auto-export tooltip says "base price minus 10% shipping", which is false (lines 594-597). Add-slot uses `MaxUnits`, not level capacity (line 626). Back always goes to Manage. No remove/replace slot, no upgrade button (engine `World.UpgradeBuilding` exists; `upgrade.mp3` unused). | Building Inspector drawer (§6.7) |
| 7 | **SlotEditor** (`SlotEditor.cs`, 1,035 l. + `SlotCanvas.cs`) | Read-only three-column flow (Inputs / Manufacturing / Distribution) with bezier arrows and tier-coloured cards. Keyboard navigation (←/→ columns, ↑/↓ cards); Enter returns to the inspector; side inspector panel. | Recipe, inventory | **Keyboard only, no mouse picking.** Read-only. | Inspector → Layout tab (§6.7.2) |
| 8 | **Reports** (`Reports.cs`, 741 l.) | Seven tabs: Income Statement (current month + "Year to date", which is really since 2026-02, hard-coded at Reports.cs:288), Balance Sheet, Per-Product P&L, Exports (12 m by product/building), R&D and Ads, Goals (text progress bars), Trends (5 sparklines: Cash, Revenue, NI, Top Brand, Top Tech). Play/Advance bar. Tab tooltips. | Ledger, CogsLog, History | Monospace text dumps, no charts beyond sparklines. Overlaps FinancialStatements and StatsDashboard. History isn't saved, so Trends reset on load. | Reports overlay (§6.9) |
| 9 | **FinancialStatements** (543 l.) | Period (last month / 12 m / since start). IS with margins. BS with composition, building-at-cost list, inventory by building, equity reconciliation ("books close"). Cash flow (operating/investing/financing). Play/Advance. | Ledger | Cash flow ignores `UpgradeCost` and patent royalties (FinancialStatements.cs:483-505), so net change ≠ Δcash. Reconciliation shows drift after an upgrade (§3.4 X9). | Reports overlay |
| 10 | **MarketIntel** (1,002 l.) | Grid tab: sort (share / price / city), city filter chips, product picker, filters (mine only, contested, significant). Leaderboard per (city, product) replaying the softmax (price, Q/T/B, share, units estimate); 12-month player share sparkline. Top-3 tab: markets to enter and to defend. | Retail slots, softmax replay | **Unserved markets never appear** in the grid (row skipped when there are no sellers). Share is theoretical and has the sell-out artefact (§3.4). | Markets overlay (§6.8) |
| 11 | **CityMap "Cities & Territories"** (796 l.) | City cards (not a map). Population, demographic strip, geography badges, owner-coloured density bars and dots. Modes Mix / Population / Heat (player share). Detail panel: demographics, geography, base land price (unused by the engine), buildings by owner, top-8 demand. | Catalog, buildings | No spatial map. Buildings can't be clicked into the inspector. Land price is shown but meaningless. | 3D City view + City switcher + overlays (§6.5) |
| 12 | **ResearchTree** (742 l.) | Node graph of all products in three tier columns with edges. Keyboard nav; sidebar with tier, world price, tech x/max, progress, slot-months to next level, recipe. | Tech, recipes | Keyboard only. Read-only: you can't start research here (you need an R&D building + slot). | R&D overlay (§6.11) |
| 13 | **StatsDashboard** (X) | Header strip, CV sparkline (10×NI formula), city×product share heatmap, R&D leaderboard, brand top-5, top-5 buildings by revenue and opex. | History, softmax | Duplicates other screens. | Folded into Company overview + Reports → Charts |
| 14 | **ActivityFeed** (A) | Nine filter chips (Sales/Opex/Construction/Ads/R&D/Goals/Transfers/Milestones/Month), search box, per-month grouping, severity colours, revenue milestones at $1M/$5M/$25M/$100M, max 500 entries. | Ledger deltas | — | News & Events + Ledger explorer |
| 15 | **ReplayViewer** (P) | Month-by-month text summary: cash, accrual NI, COGS, top-3 buildings by \|NI\|, cumulative NI sparkline. | Ledger/CogsLog | Esc handled in `_Input` (global). | Reports → History tab |
| 16 | **HelpOverlay "Executive Field Guide"** (?) | Five mechanic cards with art, then a keyboard list (from .tscn). | Static | The key list omits P, X and Ctrl/⌘+S. | Help/Encyclopedia + Controls sheet |
| 17 | **Tutorial handbook** (button) | Ten pages: Back/Next/Skip/Close, arrow keys, Esc. | Static | **Describes non-existent systems:** "buy land… cheap lot" (Tutorial.cs:61-65), "purchase contract" (67), quality "a function of input tier and factory tech" (87; quality is always 50), tech "improves… Brand growth" (89), an outdated HUD layout (48-50), "user://saves" (134; saves go to the user-data root). | Encyclopedia (rewritten from engine truth) |
| 18 | **GuidedTutorial overlay** (`GuidedTutorial.cs`) | Five-step auto-advancing checklist bound to tutorial goals by index (ids build-store, stock-shelf, let-time-pass, run-campaign, grow-value). Collapse button, "Step complete" banner, per-step VO. | Goals | **Only attached to Main**, so it's invisible in Manage, where steps 1, 2 and 4 happen. A new instance on each Main load means the current step's VO **replays on every return to the HUD**. Goals aren't sticky (cancelling the ad unchecks step 4). | Tutorial system (§6.17) |
| 19 | **SaveMenu** (S) | Filename + Save Now, sort (modified/name/size/schema), rows with autosave [A] badge, Load, Rename, Delete (confirm). Ctrl/⌘+S quick-save **only inside this screen**. | ListSaves | Quick-save **overwrites the most recent manual save**, whatever game it belongs to (SaveMenu.cs:433-438). Load doesn't reset win/lose, goal or toast flags. | Save/Load (§6.19) |
| 20 | **WinLoseScreen** | Win: "Victory", scenario, months, final cash, "Corporate value" (10×NI formula), goal list, Continue / Back to title. Lose: Bankruptcy (6 consecutive months cash<0) or Time's Up (date ≥ end), "Keep playing (sandbox)". Music, SFX, VO. | History | The CV shown ≠ the goal's CV (§3.4 X10). No debrief charts. | Win/Lose debrief (§6.16) |
| 21 | **NewsTicker** (embedded) | Scrolls right-to-left at 30 px/s; severity colours (Info grey, Notable white, Major gold). | NewsLog | No click-to-locate. | Bottom ticker + News feed |
| 22 | Frameworks | `Notifications` (top-right toasts; Info/Success/Warning/Error; 4 s default; layer 110). `ScorePopup` (rising "+$X" 1.2 s; layer 105; always spawned at **screen centre**). `Tooltip` (hover delay, BBCode). `Sparkline`. `UiChrome` palette (Ink #0b1117, Panel #101a22, Stroke #375263, Gold #d7b766, Blue #5aa7d8, Green #61c28f, Red #df6f6a, Muted #9fb2bd). `SoundManager` (music crossfade 1.2 s at −8 dB, voice ducks music to −18 dB, 8-voice SFX pool, `SetMuted` exists but has **no UI**). | — | — | Design system tokens + audio engine |

### 2.3 Keybindings (current, complete)

| Key | Context | Action | Source |
|---|---|---|---|
| Space | Main | Play/Pause | Main.cs:425 |
| `.` | Main, paused only | Advance one month | Main.cs:428-432 |
| 1 / 2 / 3 | Main | Speed 1× / 2× / "5×" (1.0 / 0.5 / 0.2 s per month) | Main.cs:434-442 |
| M R C T S F I A P X | Main | Manage, Reports, City Map, Research, Save/Load, Financials, Market Intel, Activity, Replay, Stats | Main.cs:443-472 |
| ? or / | Main | Help (Help closes with Esc or Shift+/) | Main.cs:473-476, HelpOverlay.cs:153-161 |
| Esc | Main | **Back to title (discards game)** | Main.cs:477 |
| Esc | Help, Tutorial, Replay, SlotEditor, ResearchTree, demo scenes | Back | respective files |
| ←/→/↑/↓, Enter | ResearchTree, SlotEditor | Navigate nodes/cards, toggle sidebar / open inspector | ResearchTree.cs:121-144, SlotEditor.cs:134-157 |
| ←/→ (also ↑/↓) | Tutorial handbook | Previous/next page | Tutorial.cs:174-190 |
| Ctrl/⌘+S | SaveMenu only | Quick-save | SaveMenu.cs:418-424 |

Missing: camera controls (there is no map), a build hotkey, speed ±, quick-load, any rebinding, and a mouse path in the two graph screens.

### 2.4 Game-feel, audio and voice inventory (current)

| Channel | Assets (duration) | Triggers today |
|---|---|---|
| Music | `title_theme` 90.0 s, `gameplay_loop` 120.0 s (loops for the whole session), `victory_theme` 30.0 s | Title; Main; win |
| SFX | `ui_click` 0.52, `build_construct` 1.52, `cash_sale` 1.04, `goal_achieved` 1.52, `notify_info` 0.52, `notify_warning` 1.04, `month_tick` 0.52, `campaign_start` 1.04, `upgrade` 1.04 (**unused**), `defeat` 2.04, `victory_fanfare` 2.51 | Title buttons, construct, NI back to positive, goal, headline, warnings, month (1× only), campaign, lose, win |
| VO (ElevenLabs, voice "Hope") | `vo_welcome` 4.1, `vo_tutorial_step1..5` 4.4–6.2, `vo_tutorial_complete` 3.2 (transcribed as "…you are a **magnet**", so check the pronunciation of "magnate"), `vo_victory` 3.2, `vo_defeat_bankrupt` 6.0, `vo_defeat_timeup` 4.1 | Title (once per run), tutorial step change, win/lose |
| Toasts | NI sign flip (not on day-one losses), cash < $1M (once per game), headlines (≤2 per tick), goal achieved | Main only |
| Popups | −construction cost, "Ad campaign: product", "Goal achieved!", "You win!" | Screen centre, not world-anchored |

Only 10 VO lines exist, all tutorial or end-of-game. No line reacts to economic events (rivals, stock-outs, news, cash).

### 2.5 Scenario and tutorial content inventory (16 scenarios)

Stars use the client heuristic (`ScenarioDifficulty.Compute`). "AI-pilot" = the built-in AdaptiveStrategy playing the player's company to the deadline (harness `scenarios-ai`): the month each goal was first met (x = never) and the win month.

| id | ★ | Start cash | Rivals | Horizon | Goals | AI-pilot result | Content issues |
|---|---|---|---|---|---|---|---|
| tutorial | 1 | $15M | LocalCo simple $10M | none | own supermarket; retail soft_drink; 3 months; soft_drink ad; TA ≥ $20M | win m6 | See §3.1; goal 5 text says "corporate value (cash + inventory + buildings)", but the end screen uses another CV |
| brand_monopolist | 1 | $20M | none | 71 m | brand soft_drink ≥ 70 in 3 cities | x (the AI never advertises uncontested markets) | **Won at m10 with zero buildings** (ads only) |
| export_tycoon | 1 | $8M | none | 59 m | exports ≥ $5M | x | Won at **m8** with 1 small farm + 1 steel factory buying world ore (world-price arbitrage) |
| sandbox | 1 | $30M | RivalCo adaptive $25M | none | — | — | — |
| first_hundred_million | 2 | $15M | BigCo adaptive $50M | 59 m | TA ≥ $100M | x (TA $39.6M) | Trivial with the monopoly-price exploit |
| tech_titan_clash | 2 | $25M | Zenith techLeader $50M | 59 m | car share Eastside 30%; TV share Metro 25%; TA ≥ $50M; **survive 60 m** | x | **Unwinnable** (60 > 59). The TechLeader price spiral drives cars to $3.0B |
| fashion_empire | 3 | $28M | Couture adaptive, ValueThreads simple | 59 m | 2 farms, 2 factories, retail jeans, jeans share 30%, cumNI $12M | x | Description contradicts the data ("only High will reach for $120…Middle balk over $150": $120 < $150, so Middle does buy; Low reservation is $0) |
| patent_race | 3 | $20M | Vanguard techLeader $40M | 47 m | retail TV, retail car, car share Eastside 20%, TA $35M, survive 42 m | **win m42** (endCash $130.9B via price spiral) | — |
| soft_drink_war | 3 | $30M | RivalCo adaptive, MegaMart simple | 59 m | soft_drink share Metro ≥ 55%; TA ≥ $60M | x | Share goal exploitable ($0.01 / 1 unit) |
| monopolist | 4 | $25M | FizzCorp adaptive $40M | 71 m | brand ≥ 70; exports ≥ $8M; 24 profitable months; TA $50M | x | — |
| tech_race | 4 | $30M | ApexLabs adaptive $60M | 59 m | 2 R&D, retail TV + car, TV ads, TV share 35%, TA $40M | x | — |
| vertical_showdown | 4 | $20M | ChainLink VI $45M | 59 m | 1 factory, **1 farm**, retail TV, TV share 30%, TA $35M, survive 48 m | x | The farm is unrelated to the TV chain (TV = electronic_parts + plastic + steel; farms make crops) |
| coffee_monopoly | 5 | $22M | BrewHaus adaptive $25M | 47 m | 2 plantations, 2 factories, retail coffee, share 35%/30%, exports $4M, cumNI $10M | x | — |
| four_archetype_melee | 5 | $30M | four AIs, $30M each | 83 m | brand soft_drink ≥ 70, brand car ≥ 70, 18 profitable months, TA $40M, **survive 84 m** | x | **Unwinnable** (84 > 83). Rivals reach $70.9B with an idle player |
| multi_city_mogul | 5 | $25M | GoliathMart adaptive, PennyGrocer simple | 83 m | bread share 40% in 3 cities; TA $40M | x | — |
| three_way_melee | 5 | $25M | three adaptives | 83 m | brand ≥ 75; share 40%; 12 profitable months; TA $55M | x | — |

Other content notes:
- The `cocoa_blight` event multiplies **coffee_beans** prices.
- Every scenario starts in 2026-01, but Reports/FinancialStatements hard-code `SimStart = 2026-02`.
- Of the building content, `footprint`, `targetHeadcount`, `geographyRequirement`, `laborUnits`, `grid` and `baseLandPrice` are loaded but **not used by the simulation**. `World.Construct` (World.cs:95-113) only checks cash, and the harness built an oil well in non-oil Metropolis and a seaport in landlocked Hilltown.

---

## 3. Scripted playtest results (engine, seed 42)

### 3.0 Market sizes a player never sees

Monthly demand in units (population × bracket share × per-capita; price only gates via reservation prices). Restock is always bought at world price.

| city | beer | bread | car | coffee_drink | designer_jeans | soft_drink | t_shirt | television |
|---|---|---|---|---|---|---|---|---|
| metropolis (500k) | 1,312,500 | 3,575,000 | 1,425 | 1,825,000 | 385 | **2,625,000** | 220,000 | 2,200 |
| riverside (250k) | 656,250 | 1,737,500 | 825 | 1,050,000 | 240 | 1,312,500 | 117,500 | 1,238 |
| eastside (200k) | 505,000 | 1,310,000 | 850 | 1,010,000 | 274 | 1,010,000 | 104,000 | 1,200 |
| portbay (150k) | 397,500 | 1,095,000 | 375 | 495,000 | 93 | 795,000 | 63,000 | 600 |
| hilltown (100k) | 250,000 | 640,000 | 460 | 540,000 | 152 | 500,000 | 54,000 | 640 |
| world price | $3.00 | $2.50 | $18,000 | $4.00 | $120 | $1.50 | $15 | $400 |

The UI never shows these numbers where the player makes stocking decisions. The restock default of 500,000 is 19% of Metropolis soft-drink demand and **351× Metropolis car demand**.

### 3.1 Tutorial played exactly as written (`tutorial-literal`)

Actions: supermarket + soft_drink @ $1.80, restock 500,000 at month 0 (steps 1–2); play (step 3); TV $50K/mo in the store's city from month 3 (step 4); run until all 5 goals hold at once.

| Store city | G1 own | G2 retail | G3 3 mo | G4 ad | **G5 TA ≥ $20M = WIN** | Real time at 1× (1 s/mo) | Notes |
|---|---|---|---|---|---|---|---|
| Eastside (the Build tab's default city) | m1 | m1 | m3 | m4 | **m58** | 58 s | 500,000 sold every month |
| Metropolis (Starter-Investment city) | m1 | m1 | m3 | m4 | **m58** | 58 s | Shown share 14%→64%, real share 27%→40%, revenue flat $900K |
| Riverside / Portbay | m1 | m1 | m3 | m4 | m58 | 58 s | — |
| Hilltown | m1 | m1 | m3 | m4 | **m98** | 98 s | Demand 500k × 72% share caps sales |
| Metropolis, **ads skipped** | m1 | m1 | m3 | never | TA reached at **m38** (can't win without the ad) | — | Ads are pure cost in this setup |

Month-by-month trace, Metropolis (abridged):

| month | cash | NI/mo | revenue | units | share real/shown | brand | goals | executive brief shown |
|---|---|---|---|---|---|---|---|---|
| 1 | $13.94M | $135.0K | $900.0K | 500,000 | 100%/100% | 0 | 2/5 | "turn availability into preference" |
| 2 | $14.07M | $135.0K | $900.0K | 500,000 | 27%/14% | 0 | 2/5 | same (LocalCo entered at $1.71) |
| 4 | $14.29M | $85.0K | $900.0K | 500,000 | 29%/27% | 12 | 4/5 | "protect the next margin cycle (add R&D)" |
| 12 | $14.97M | $85.0K | $900.0K | 500,000 | 38%/58% | 75 | 4/5 | same |
| 58 | $18.88M | $85.0K | $900.0K | 500,000 | 40%/64% | 100 | **5/5** | same, for 54 months |

At month 58 the HUD rival line reads "LocalCo · $914M cash" (40 buildings). The "simple sparring partner" grew 91× while the player grew 33%, because the AI sizes restock to demand × 1.2 (SimpleRetailerStrategy.cs:83-84) and fills every city × product market.

**Verdict:** the tutorial "works" mechanically (every step can be completed with the UI), but:

- (a) it takes ~5 in-game years of flat numbers;
- (b) its central causal claim ("brand awareness … increases your market share — competitors without ads will lose customers") is false in the player's P&L, because sales are capped by restock;
- (c) the one lever that matters (the restock target / stock policy) is never explained;
- (d) the advisor pushes an irrelevant $3M R&D centre for 54 straight months.

### 3.2 Naive player (`naive`)

| Script | Outcome |
|---|---|
| N1: clicks **Construct** with all Build-tab defaults | Builds a **Convenience Store in Eastside with no product** (the first type in category order, the first city alphabetically, product "(skip)"). After 24 months: −$96K opex, goal 1 (supermarket) still unmet, brief "activate 1 idle building". |
| N2: supermarket, leaves product "(skip)", presses Play 12 months | Loses $180K; goal 2 never met; the guided overlay says "In the store's Inspect view…", but it isn't visible in Manage. |
| N3: supermarket with the wrong product at default $1.80 / 500,000 | Bankruptcy screen at: **car m6 (−$8.99B cash in month 1)**, television m6 (−$186M in m1), designer_jeans m6 (−$46M in m1), t_shirt m9, coffee_drink m18, beer m30, bread m43. "Cash is low" (<$1M) is the only warning; the NI toast never fires (no +→− flip). |
| N4: presses all four Starter Investments (Metropolis) | Best naive outcome: +$725K/mo from month 1, **G5 at m7**, but G4 (ad) is never met, so no win. Bread Aisle ($4.25, restock 350k) makes most of the money. Soft Drink Lab takes soft_drink to tech 8 by m36. The brief says "turn availability into preference" for 36 months. |

### 3.3 Careful player (`careful`)

Price sweep for one Metropolis supermarket, soft_drink, restock = whole-city demand (2.63M), TV $50K from m3. LocalCo enters at m2 at 0.95× the player's price.

| price | NI m1 | NI m12 | units m12 | real share | tutorial win month | cash m24 |
|---|---|---|---|---|---|---|
| $1.60 | $247.5K | $116.1K | 1,811,394 | 69.0% | 42 | $15.58M |
| $1.80 | $772.5K | $474.2K | 1,797,359 | 68.5% | 12 | $24.02M |
| $2.50 | $2.61M | $1.73M | 1,797,359 | 68.5% | 4 | $53.76M |
| $5.00 | $9.17M | $6.23M | 1,797,359 | 68.5% | 4 | $159.98M |
| **$8.00** | $17.05M | $11.62M | 1,797,359 | 68.5% | 4 | $287.43M |
| $8.01 | $9.75M | $6.62M | 1,027,062 | 39.5% | 4 | $168.11M |
| $30.00 | $42.74M | $29.21M | 1,027,062 | 68.5% | 4 | $701.97M |
| **$50.00** | $72.74M | **$49.75M** | 1,027,062 | 68.5% | 4 | **$1.19B** |
| $50.01 | $14.54M | $9.90M | 205,412 | 13.7% | 4 | $244.32M |

Units are identical from $1.80 to $8.00. Only the reservation cliffs ($8 Low, $50 Middle) cut volume. With restock sized to demand the tutorial finishes at m15 ($1.80) or m4 ($3.00).

### 3.4 Exploits and broken measurements (`exploits`, `misc`)

| # | Finding | Evidence | Root cause |
|---|---|---|---|
| X1 | Monopoly pricing: Hilltown supermarket, soft_drink @ $49.99 → **$19.38M NI/month**, tutorial won m3 | harness | Fixed category demand; weight = D/P^ε never reaches 0; reservation gates only (MonthlyTick.cs:349-396) |
| X2 | **Slot stacking:** 1 / 3 / 6 identical soft_drink slots in one store → share 25.4% / 50.6% / 67.2%, NI $185K / $383K / $514K (soft_drink_war) | harness | Each (building, slot) is a separate softmax entry (MonthlyTick.cs:312-324) |
| X3 | **Share goal without sales:** price $0.01, restock 1 → the goal reads "72.3% / 55.0%" achieved; real share 0.00% | harness | `MarketShareGoal` uses `World.GetMarketShare` (theoretical weights; Goal.cs:54) |
| X4 | **Sell-out penalty on displayed share:** 13.9% shown vs 27.2% realised | harness | `GetMarketShare` reads `Inventory.AverageQuality` after the tick; an empty shelf means Q=0 (World.cs:966) |
| X5 | Geography unenforced (oil well in Metropolis, seaport in Hilltown) | harness | `World.Construct` checks only cash (World.cs:95-113) |
| X6 | Brand Monopolist won with **0 buildings** at m10 | harness | `TopBrandGoal` measures awareness only |
| X7 | Tutorial step 4 met by an ad in a city with no store | harness | `AdCampaignActiveGoal` ignores the city |
| X8 | Campaigns tab defaults (product **beer**, city **Eastside**): pressing Apply with defaults doesn't meet step 4 | Manage.cs:797-827 | Alphabetical defaults |
| X9 | Upgrade breaks the books: equity drift **−$720K**; TA drops by the upgrade cost | harness `accounting` | `UpgradeCost` isn't capitalised (World.cs:927-931 counts ConstructionCost only) |
| X10 | Two "corporate values": goal = TotalAssets $14.55M; end-screen CV = TA + 10×NI(12m) = $17.27M | harness | Goal.cs:32 vs GameState.cs:212 |

### 3.5 Rival economics and runaway prices (`spiral`)

- **four_archetype_melee, player idle:** Zenith Labs (TechLeader) prices cars at $23.4K in one Hilltown store and **$10.93M** in another by m6, and ends at **$70.9B cash** by m60.
  - Cause: `ownCogs = ownStore.Inventory.CostOf(product)` (TechLeader.cs:170) is the *total* cost of every car on hand, used as a per-unit floor (×1.1).
- **tech_titan_clash, player = Adaptive:** a 1.30× max-competitor premium (TechLeader.cs:180) against a 0.95× undercut (AdaptiveStrategy) compounds to 1.235× per month. Eastside car price hits **$3.00B** at m60, and the richest rival holds $6.9T.
- **Tutorial:** LocalCo, the simple AI, reaches $914M–$1.98B by m58–98.
- **Unwinnable by construction:** four_archetype_melee (`elapsedMonths` 84 vs horizon 83), tech_titan_clash (60 vs 59). The loss check is `now ≥ endDate` (Main.cs:919).

**UX consequence:** rival cash is the most visible competitor number on the HUD. When it reads $6,875B, realism and goal scale (e.g. "$40M value") collapse.

### 3.6 Pacing numbers

- The Godot client runs 1 month per 1.0 / 0.5 / 0.2 s (Main.cs:109-111), and there is no slower speed.
- A 60-month scenario lasts 60 s at 1× and 12 s at "5×". The literal tutorial is 58 s of identical months.
- Construction is instant and effects land at the next tick, so there's nothing to watch between decisions. Every screen is a full scene change, so the player spends real time navigating, not watching the business.

---

## 4. Critical playability assessment (first-time player)

Severity: **S1** blocks fun or trust; **S2** major friction; **S3** polish. Each item has evidence and the web-client fix.

### 4.1 Onboarding and goal clarity

| Sev | Problem | Evidence | Web-client fix |
|---|---|---|---|
| S1 | The tutorial's causal story is false in the numbers (ads don't raise sales, the restock cap binds) and it takes 58 flat months | §3.1 | New tutorial (§7) built on engine changes (§5 P0). Every step must *move a number the player can see* (units sold, lost sales, profit). |
| S1 | Guidance isn't visible where the player acts (overlay only in Main); the VO replays on every HUD return | GuidedTutorial.TryAttach in Main._Ready; new instance per load | The tutorial is an app-level layer (React portal) that persists across panels. Step state lives in the zustand store; VO fires once per step id. |
| S1 | The handbook describes non-existent systems | Tutorial.cs:48-50, 61-67, 75-80, 87-89, 110-115, 134 | Encyclopedia generated from engine constants/content (single source of truth); no hand-written mechanics prose without a test. |
| S2 | Scenario choice hides the deadline, goal list and starting cash; stars mis-rate (2★ unwinnable) | ScenarioPicker.cs:176-186 | Briefing card with goals, deadline, rivals (archetype + cash), start cash, recommended strategy, and an **authored** difficulty field. |
| S2 | Defaults lead to wrong outcomes (Build: Convenience Store/Eastside/skip; Campaigns: beer/Eastside) | §3.2, X8 | Context-first defaults: build from a clicked plot; campaigns start from a store or product context; no alphabetical first-item defaults. |
| S2 | Goals aren't sticky, and "Step N of M" is miscounted when goals complete out of order | Main.cs:751; Goal.cs:96-106 | Tutorial goals are **milestones** (latched when first met). Scenario win conditions are "hold at deadline" or "achieve once"; each goal says which. |
| S3 | Two "Tutorial" entries (overlay vs 10-page handbook) | Main HUD button → Tutorial.tscn | One Tutorial menu: replay chapters, open the Encyclopedia. |

### 4.2 Feedback loops

| Sev | Problem | Evidence | Fix |
|---|---|---|---|
| S1 | Units sold, demand and lost sales are invisible, so the player can't tell "sold out" from "unpopular" | BuildingInspector.cs:771 | Engine records per-slot `demand`, `sold`, `lostSales`, `endStock` each month (§5 P0). Show them on the store, the inspector and the month-close card. |
| S1 | Displayed market share is theoretical and penalises selling out; share goals are exploitable | X3, X4 | The share shown and used by goals = realised unit share over the last month (or a 3-month average). The theoretical share appears only as a "forecast". |
| S1 | Rival numbers explode (AI price spiral) | §3.5 | Fix TechLeader.cs:170 (per-unit cost = `CostOf/Get`) and cap the premium against the category reference price. UI: show rivals' company value, not raw cash. |
| S2 | Loss-from-day-one isn't flagged (the NI toast needs a flip); the low-cash toast fires once per game at a fixed $1M | Main.cs:821-849 | Runway-based warnings (§6.21): amber at runway < 3 months, red < 1 month, insolvency countdown when cash < 0. A per-building "losing money" badge. |
| S2 | Executive brief is a static ladder ("add R&D" forever) | Main.cs:669-719 | Advisor priorities ranked by **estimated $ impact**, each with a one-click fix (§6.15). |
| S2 | "Corporate value" means two things; the HUD "Buildings" count includes rivals | X10; Main.cs:646 | One value metric everywhere with a breakdown tooltip; "Your buildings: N". |
| S3 | Popups spawn at screen centre, not at the building | Manage.cs:500, 613 | World-anchored popups over the 3D building (§8). |

### 4.3 Tedium and navigation cost

Click counts in the Godot client versus the web target:

| Task | Godot interactions | Web target |
|---|---|---|
| Build a configured store | M → Build → city ▾ → type ▾ (18 rows) → product ▾ → price → restock → Construct = **8** | B → card → plot → Confirm = **4** (product and price preset on the confirm card) |
| Change a store price | M → Buildings → scroll → Inspect → scroll → price → Apply → Back → Back = **9** | Click the store in the city → drag the price slider (auto-apply at month close) = **2** |
| Start a campaign | M → Campaigns → product ▾ → city ▾ → channel ▾ → budget → Apply = **7** | Store inspector → "Advertise" → budget → Start = **4** (product and city from context) |
| Learn why profit fell | No causal view | Month-close card → "Why?" → variance waterfall = **2** |

Other tedium:
- Every screen is a scene change that resets scroll and selection.
- The BuildingInspector's Back always goes to Manage.
- There are no bulk actions (price across stores), no layout templates (CapLab's Layout Library), and no delegation. The build plan (§4.2 of the build plan) already calls for templates and delegate mode.

### 4.4 Missing controls (engine supports, or near-trivial)

- **S1:** Upgrade building (the engine's `World.UpgradeBuilding` exists and `upgrade.mp3` is waiting).
- **S2:** Demolish/sell a building; remove or reassign a slot; rename.
- **S2:** Per-product export toggle (the engine has only a per-building `AutoExport`).
- **S2:** Supplier preference (own vs world); pause-on-event settings; audio sliders and mute (`SoundManager.SetMuted` exists).
- **S2:** Windowed mode and UI scale (the Godot build is borderless fullscreen 1600×900 only); speed slower than 1 s/month; quick-save/quick-load hotkeys in-game; confirm before leaving to the title.
- **S3:** Key rebinding; mouse picking in ResearchTree and SlotEditor.

### 4.5 Confusing inputs

| Input | Problem | Replacement |
|---|---|---|
| "Restock target (retail / warehouse)" = 500,000 | Raw units with no demand, sales, cost or cash context; the same default for cars and colas | **Stock policy: months of cover** (Lean 0.5 / Balanced 1.0 / Deep 1.5 / Custom). Shows units, $ tied up, last month's sold and lost sales. |
| Price SpinBox, default $1.80 for every product | No cost, world, rival or ceiling reference | **Banded price slider** with markers: unit cost, world price, rival min/median, suggested, bracket ceilings (§6.7.3). |
| Product ids (`soft_drink`, `designer_jeans`) in dropdowns; city ids in lists | Engine ids leak into the UI | Display names + icons everywhere; ids only in the debug console. |
| "First slot product", "(skip — leave unconfigured)", "slots" | Jargon | "What will this store sell?" + "Decide later". Slots are called **Units** (CapLab term). |
| Campaign budget → "brand points" | No link to sales | Forecast curve of brand over 12 months, plus estimated extra units and $ gross profit (§6.12). |
| Auto-export checkbox (default ON everywhere; the tooltip is wrong) | Hidden cash sink or source | Per-output destination chooser (Own stores → Warehouse → Export at $X/unit), with a margin warning. |

### 4.6 Information density

The Main HUD has 14 equal-weight command buttons plus 5 playback buttons, 4 metric cards, a scenario art plate, a brief, a goal tip and debug text ("N buildings, N ledger entries").

Five analytics screens overlap heavily:

| Content | Where it appears today |
|---|---|
| Income statement | Reports tab 1, FinancialStatements tab 1, StatsDashboard header, ReplayViewer |
| Balance sheet | Reports tab 2, FinancialStatements tab 2 |
| Trends | Reports tab 7, StatsDashboard |
| Events | ActivityFeed, ReplayViewer, NewsTicker |

Most reports are monospace BBCode text rather than charts.

**Fix:**
- Three tiers:
  - **HUD** — five numbers and alerts;
  - **drawers** — context, 1–2 decisions;
  - **overlays** — analysis.
- Put each fact in exactly one home, with links to it from elsewhere.
- Charts first, tables second.

### 4.7 Pacing

At 1 s/month, time is either too fast to watch or too slow to matter. Nothing happens between ticks (no map), and there is no slower speed.

**Fix (§6.4):**
- 12 s/month at 1× with a 30-day visual clock.
- Month close is a celebrated beat.
- Construction takes time.
- Auto-pause rules.
- "Skip to next event".

### 4.8 Win/lose clarity

The rules are hidden: every goal must hold simultaneously (Main.cs:903); bankruptcy = 6 consecutive month-ends with cash < 0 (GameState.cs:186, Main.cs:910); deadline = `now ≥ endDate`. None of this is displayed before it triggers, and there's no deadline countdown on the HUD.

After a loss, "Keep playing (sandbox)" continues with −$9B cash and no consequence. Win and loss also only trigger in Main.

**Fix:**
- A Goals panel with deadline countdown, each goal's rule ("hold at deadline" or "reach once"), and an insolvency countdown badge.
- A debrief screen with charts.
- A defined post-loss state: the company is liquidated; the player can "Restart", "Load autosave", or continue as an observer.

---

## 5. What the UI needs from the engine and bridge (UX-driven requirements)

These belong to other workstreams (economics, city/land, finance, bridge). They're listed because the UX in §6–§8 depends on them. **P0** = the tutorial and core loop are not credible without it.

| P | Requirement | Why (UX) | Suggested shape |
|---|---|---|---|
| P0 | **Price-elastic category demand with an outside option** | Price must trade volume for margin; this removes the $49.99 cola | Add a no-purchase weight to each bracket's softmax: `w0 = D_ref / P_ref^ε`, with P_ref = world price × 1.3 and D_ref = the desirability of a baseline offer. Units = bracketDemand × Σw_i / (w0 + Σw_i). Keep the reservation gates. |
| P0 | **Per-slot monthly sales record** `{demand, sold, lostSales, endStock, revenue, cogs}` | Stock-outs, store badges, month-close card, forecasts | Record in `AllocateDemandAndSell` (MonthlyTick.cs:398-416): `lost = demandForRetailer[i] − draw.Quantity`. Persist the last 24 months. |
| P0 | **Realised share** metric for UI and goals; theoretical share only as a forecast | Honest share; kills X3 and X4 | share = sold_company / Σ sold over the last month (or a 3-month average) |
| P0 | **One slot per product per building** in the demand allocator (or aggregate the weights per building × product) | Kills X2 | Merge same-product slots before the softmax. |
| P0 | Fix the TechLeader floor (TechLeader.cs:170) and cap AI premiums to a sane band (e.g. ≤ 2× category reference price) | Rival numbers the player can believe | `unitCost = CostOf/Get` |
| P0 | Unified **Company Value** definition; capitalise `UpgradeCost` into building value | One number, books close | See Open Questions |
| P1 | Land plots, footprint placement, land price, zoning, geography enforcement, **construction time** | Build flow §6.6 | Commands `previewBuild(type, city, plot, rotation)` → cost/catchment/validity; `construct(...)` → building in state `UnderConstruction {monthsLeft}`. |
| P1 | Loans (offers by credit rating, interest in P&L), depreciation, taxes, insolvency rules | Finance §6.10, lose-state clarity | Commands `requestLoanOffers`, `takeLoan`, `repay`; query `creditRating`. |
| P1 | Ad effect on *sales*: brand must move units measurably in the new demand model | Tutorial step "Advertise" | A falls out of the P0 demand model once the restock cap is fixed. |
| P1 | Stock policy in months of cover (the engine computes the target from the trailing forecast) | Replaces raw restock units | `RetailSlot.CoverMonths`; target = forecast × cover |
| P1 | Price suggestion query | Banded slider | `suggestPrice(building, slot)` → `{unitCost, worldPrice, rivalMin, rivalMedian, ceilings[], suggested, expectedUnitsAt[5 price points]}` |
| P1 | Explain query: month-over-month profit variance by driver (volume, price, cost, opex, ads, new buildings) | "Why?" waterfall | `explainNetIncome(from, to)` |
| P1 | Event stream from the tick (typed domain events) | Juice (§8), alerts, VO | Tick result includes `events[]`: `BuildingCompleted`, `StockOut`, `RivalEnteredMarket`, `PriceUndercut`, `TechLevelUp`, `PatentGranted`, `GoalMet`, `CashRunwayLow`, `NewsFired`… |
| P2 | Supplier choice per input, per-product export destinations, templates/delegation | Layout tab controls | — |
| P2 | Scenario schema: `difficulty`, `goal.mode` (`reachOnce`/`holdAtDeadline`), `tutorialScript` | Briefing and win clarity | — |

The **bridge** should expose one coarse HUD snapshot per tick (≤ 2 KB JSON), plus on-demand detail queries per panel. Keep panel queries off the per-frame path; the UI caches by `tickIndex`.

**Alignment with the in-progress `engine/Magnate.Bridge`** (read on 2026-09-30; another workstream owns it):

- **Methods that exist:** `init`, `ping`, `listScenarios`, `newGame`, `snapshot`, `advance` (→ `TickResultDto{Events, Snapshot}`), `catalog`, `buildings`, `construct`, `saveGame`, `loadGame`.
- **What already fits:**
  - `CompanySummaryDto` carries a per-company `BuildingCount` (fixes the HUD count bug) and `Color` (ownership tint).
  - `GameEventDto(Kind, Severity, Message, Amount, BuildingId, CityId, ProductId)` is the right carrier for §8.
- **Event kinds today:** `monthClosed`, `news`, `goalAchieved`, `cashNegative`.
- **Event kinds §8 still needs** (camelCase, same DTO): `constructionStarted`, `buildingCompleted`, `upgradeCompleted`, `demolished`, `firstSale`, `recordMonth`, `revenueMilestone`, `stockOut`, `overstock`, `belowCost`, `rivalEnteredMarket`, `priceUndercut`, `shareRankChanged`, `shareMilestone`, `campaignStarted`, `brandMilestone`, `techLevelUp`, `patentGranted`, `patentBlocked`, `loanApproved`, `loanPaymentMissed`, `creditRatingChanged`, `ipoCompleted`, `dividendPaid`, `runwayLow`, `scenarioWon`, `scenarioLost`.
- **`goalAchieved` is computed from live goals before and after each month**, so a non-latched goal (ad campaign, share, brand) that drops and recovers fires twice. Latch goals (§6.16) or dedupe in the client.
- **Queries the panels need next:**
  - `buildingDetail(id)` — lines with `sold`/`demand`/`lost`/`cover`, P&L windows, inventory;
  - `marketMatrix(metric)` and `marketDetail(city, product)`;
  - `reports(kind, from, to, granularity)`, `explainNetIncome(from, to)`, `suggestPrice(building, line)`, `previewBuild(type, city, plot, rotation)`;
  - `rivals()`, `news(sinceIndex)`, `advisorPriorities()`.
- **Commands the panels need next:** `configureLine`, `setPrice`, `setStockPolicy`, `removeLine`, `startCampaign`/`stopCampaign`, `upgrade`, `demolish`, `grantLicense`/`revokeLicense`, `takeLoan`/`repayLoan`, `setAutoExport(building, product)`.

---

## 6. Web client UX information architecture

### 6.1 Principles

1. **The city is the interface.** The 3D city is always on screen. Most actions start from something the player points at: a plot, a store, a rival, a news marker.
2. **Three tiers of depth.**
   - HUD: five live numbers and alerts.
   - Drawer: one object, one to two decisions.
   - Overlay: analysis.
   - Modal: commitment (IPO, quit, win/lose).
   - Every fact has one home; other places link to it.
3. **Every number explains itself.** Hover shows the formula and breakdown; click drills down. There's no number without a source (the ledger is truth).
4. **Honest time.**
   - The books close monthly, and the month close is a *beat* (sound, roll-up, popups).
   - Between closes the city lives visually, driven by last month's actuals.
   - Decisions made mid-month show "applies at month close".
5. **Context-first defaults.**
   - A build started from a plot pre-fills the city.
   - A campaign started from a store pre-fills the product and city.
   - Nothing defaults to the alphabetically first item.
6. **The advisor quantifies.** Priorities are ranked by estimated $/month impact and each carries a one-click fix. No static nagging.
7. **Keyboard and mouse parity, accessible by default.**
   - Every action is reachable by mouse, keyboard and controller-free touch (tablet later).
   - Colour-blind-safe palettes, text scaling, reduced motion, subtitles.
8. **The UI never blocks on the engine.**
   - The engine runs in a Web Worker.
   - Commands are optimistic, with rollback on a bridge error.
   - The HUD reads a ≤ 2 KB snapshot per tick.

### 6.2 Screen map and navigation model

**Layers:**

| Layer | Contents |
|---|---|
| L0 | Three.js world |
| L1 | HUD |
| L2 | Right drawer (420–480 px, one at a time, with a back stack) |
| L3 | Full-screen overlay (city dimmed and blurred behind) |
| L4 | Modal |

**Time rule:**
- L1 and L2 never pause.
- L3 pauses if *Settings → Gameplay → "Pause while in full-screen screens"* is on. This is ON by default and ON in the tutorial.
- L4 always pauses.
- Auto-pause triggers are listed in §6.4.

| Screen | Layer | Hotkey | Purpose | Replaces (Godot) |
|---|---|---|---|---|
| Title / Main menu | full | — | Continue (latest save), New Game, Load, Settings, Encyclopedia, Credits | TitleScreen |
| New Game — Scenario browser | full | — | Cards: tutorial campaign, scenarios, sandbox/custom; filters by pillar and difficulty | ScenarioPicker, showcase cards |
| Custom game (sandbox) setup | full | — | Cities, rivals (count/archetype/cash), start capital, difficulty, seed, starting year, options (auto-link, internal sales only) | new |
| Scenario briefing | L4 | via Goals (G) › Briefing | Goals with rules, deadline, rivals, start cash, "how you win / how you lose", suggested opening | new |
| **City view** | L0+L1 | Home | Main play space | Main HUD, CityMap |
| **Build mode** | L1 + L2 | B | Palette → ghost → confirm → construction | Manage › Build |
| **Building inspector** | L2 | click / Enter | Overview, Layout (unit grid), Finance, Upgrades & Staff | BuildingInspector, SlotEditor |
| Company (portfolio) | L3 | M | Company KPIs, all buildings table (sort, filter, bulk price/stock, upgrade), HQ | Manage › Buildings, StatsDashboard |
| Markets | L3 | I | City × product matrix (incl. **unserved**), market detail, supply/demand, offers | MarketIntel, CityMap detail |
| Reports | L3 | R | P&L, Balance sheet, Cash flow, Products, Buildings, Cities, Charts, History, Ledger explorer | Reports, FinancialStatements, ReplayViewer, StatsDashboard, ActivityFeed (ledger) |
| Finance | L3 | F | Overview, Bank (loans), Equity (IPO, dividends, buyback), Stock market | new (build-plan Phase 2.4/5) |
| R&D | L3 | T | Tech per product vs rivals, projects/slots, ETA, patents and licensing | ResearchTree, Manage › Patents |
| Marketing | L3 | K | Campaigns, brand map, media ownership, forecast | Manage › Campaigns |
| Rivals | L3 | V | Rival profiles, contested markets, move timeline, stock | new |
| News & Events | L3 | N | News with Locate; business event log with filters/search | NewsTicker, ActivityFeed |
| Goals | L2 (compact) / L3 | G | Goal list, deadline, rules, progress history | Reports › Goals, tip panel |
| Advisor | L2 | H | Ranked priorities with fixes; tutorial checklist when active | Executive brief, GuidedTutorial |
| Alerts | L2 | J | Alert history with Locate/Fix | toasts |
| Encyclopedia / Controls | L4 | F1, ? | Mechanics generated from engine constants, glossary, key map | HelpOverlay, Tutorial handbook |
| Pause menu | L4 | Esc (when nothing to close) | Resume, Save, Load, Settings, Encyclopedia, Quit to title (confirm if unsaved) | new |
| Save / Load | L4 | Ctrl/⌘+S (quick), Ctrl/⌘+O (menu) | Slots with thumbnails | SaveMenu, SaveBrowser |
| Settings | L4 | — | Audio, gameplay, graphics, accessibility, controls | new |
| Win / Lose debrief | L4 | — | Result, stats, charts, next steps | WinLoseScreen |

**Title → New Game → Briefing wireframes:**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  MAGNATE                              (3D skyline slowly orbiting behind)        │
│  Build brands, factories, stores and market power                                │
│  [ Continue · Soft Drink War · Mar 2028 · value $41.2M ]                         │
│  [ New Game ]  [ Load ]  [ Settings ]  [ Encyclopedia ]  [ Quit ]                │
└──────────────────────────────────────────────────────────────────────────────────┘
NEW GAME ─ [Tutorial campaign] [Scenarios] [Sandbox / Custom]     Pillar ▾  Difficulty ▾
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ [art] SOFT DRINK WAR │ │ [art] COFFEE MONOPOLY│ │ [art] VERTICAL SHOW… │
│ ★★★☆☆ Retail ops     │ │ ★★★★★ Integration    │ │ ★★★★☆ Integration    │
│ 59 mo · start $30M   │ │ 47 mo · start $22M   │ │ 59 mo · start $20M   │
│ vs RivalCo, MegaMart │ │ vs BrewHaus          │ │ vs ChainLink         │
│ 2 goals · share 55%… │ │ 7 goals · 2 farms…   │ │ 6 goals · factory…   │
│ [Briefing ▸]         │ │ [Briefing ▸]         │ │ [Briefing ▸]         │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘

┌ SOFT DRINK WAR ───────────────────────────────────────────────── Difficulty ★★★☆☆ ┐
│ [art]  Capture the Metropolis soft-drink market while growing your company.        │
│ START     $30M cash · Jan 2026      DEADLINE  Dec 2030 (59 months · ≈ 12 min at 1×)│
│ RIVALS    RivalCo (Adaptive, $25M): undercuts the cheapest price by 5%, advertises │
│           MegaMart (Discount retailer, $20M): opens wherever demand is biggest     │
│ TO WIN    ◉ Soft-drink share in Metropolis ≥ 55%        [hold at deadline]         │
│           ◉ Company value ≥ $60M                         [reach once]              │
│ YOU LOSE  cash below $0 at 6 consecutive month-ends · deadline passes              │
│ OPENING   Take a busy downtown plot early; rivals open from month 2.               │
│                                                   [Back]      [Start ▸]            │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 HUD (reference 1920×1080, minimum 1280×720, UI scale 80–150%)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│[■] ACME BEVERAGES ▾ │ CASH $13.94M  +$135K ▲ │ VALUE $15.14M ▲0.9% │ FEB 2026 ▰▰▰▰▰▰▰▱▱▱ d21 │ ❚❚  ▶ ▶▶ ▶▶▶ ▶▶▶▶ ⏭ │ (!)3 │ [Advisor]│ ≡ │
├────┬──────────────────────────────────────────────────────────────────────────────────────┬────────────────┤
│ B  │                                                                                      │ GOALS 2/5    ⌄ │
│Buil│                                                                                      │ ✓ Open a store │
│ M  │                                                                                      │ ▶ First profit │
│Comp│                                                                                      │   ▓▓▓▓▓▓░░ 71% │
│ I  │                                                                                      │ ○ Beat LocalCo │
│Mkts│                       3D CITY — METROPOLIS                                           │ No deadline    │
│ R  │                                                                                      ├────────────────┤
│Rpts│      (hover: outline + mini card; selection: gold outline; world-anchored +$ popups)  │ TOASTS (max 3) │
│ F  │                                                                                      │ ⚠ Stock-out:   │
│Fin │                                                                                      │  Harbor Super. │
│ T  │                                                                                      │  lost 260K u.  │
│Tech│                                                                                      │  [Fix] [Locate]│
│ K  │                                                                                      │                │
│Mktg│                                                                                      │                │
│ V  │                                                                                      │                │
│Rivl│                                                                                      │                │
│ N  │          ┌─ JAN 2026 CLOSED · Revenue $2.31M · Net +$412K · Cash $14.35M  [Why?] ─┐  │                │
│News│          └────────────────────────────────────────────────────────────────────────┘  │                │
├────┴───────────┬──────────────────────────────────────────────────────────────────────────┴────────────────┤
│  MINIMAP       │ Overlay: [None][Land $][Traffic][Demand ▾][Brand ▾][Profit][Owners][Links]  City: Metro ▾ │
│  (grid, owner  │ NEWS ▸ OPEC oversupply: crude −30% for 9 months [Locate]  ·  LocalCo opened a supermarket │
│   dots, view)  │         in Harbor at $1.71 [Locate]  ·                                                   │
└────────────────┴───────────────────────────────────────────────────────────────────────────────────────────┘
```

When a building is selected, the right drawer (§6.7) replaces the toast column area; toasts shift left of the drawer.

| Element | Content | Update | Interaction | Tooltip / formula |
|---|---|---|---|---|
| Company chip | Name, colour swatch | on rename | click → Company (M) | Rank among companies by value |
| **Cash** | Current cash; Δ = last month's net cash flow (▲ green / ▼ red) | Month close (roll-up 600 ms ease-out) | click → Reports › Cash flow | In / out by category last month; **runway** = cash ÷ avg monthly net outflow over the last 3 months (∞ if positive) |
| **Value** | Unified Company Value (§12 Q1); Δ% vs last month. After IPO a third chip, "SHARE $x.xx ▲". | Month close | click → Reports › Balance sheet | Breakdown of the chosen formula; equity reconciliation ✓ |
| Date + day clock | Month/year, 30-segment bar, day number | Every visual day | click → Goals (deadline) | "Books close in N days"; scenario deadline and months left |
| Speed | ❚❚, 1×, 2×, 4×, 8×, ⏭ skip-to-event | — | Space, 1–4, `.`, Shift+. (⏭) | Seconds per month for each speed |
| Alerts (!)n | Unread alerts count, colour of the highest severity | On alert | J / click → Alerts drawer | — |
| Advisor | Portrait; pulses on a new top priority | Month close | H / click → Advisor drawer | Top priority one-liner |
| Menu ≡ | Pause menu | — | Esc | — |
| Left rail | 10 destinations, icon + letter; badges (e.g. Markets "!" when a rival enters your market) | — | Hotkeys | — |
| Goals tracker | Top 3 goals, progress, deadline countdown; collapsible | Month close + on command | G | Rule: "reach once" / "hold at deadline"; current vs target |
| Month-close chip | Revenue, Net, Cash for the closed month | Month close; auto-hides after 6 s unless hovered | [Why?] → variance waterfall | — |
| Minimap | Top-down grid, owner-coloured footprints, camera frustum, seaport/HQ markers | Every 250 ms | Click = jump; drag = pan | — |
| Overlay bar | Map overlays (§6.5) | — | O cycles; Shift+1..8 direct | Legend appears bottom-right when active |
| News ticker | Latest events, severity colour | On event | Click → Locate + open News | — |

### 6.4 Time and pacing

| Speed | Seconds per month | Seconds per visual day | 5-year scenario, uninterrupted |
|---|---|---|---|
| Pause | — | — | — |
| **1× (default)** | **12 s** | 0.40 s | 12 min |
| 2× | 6 s | 0.20 s | 6 min |
| 4× | 3 s | 0.10 s | 3 min |
| 8× | 1.5 s | 0.05 s | 1.5 min |
| ⏭ Skip to next event | engine max (≈ 0.1–0.3 s/month, depending on the WASM tick) | — | stops at the next auto-pause trigger or after 12 months |

- **Engine granularity stays monthly.** The day clock is presentation: it drives construction progress bars (days remaining), ambient traffic and shopper animation (scaled by last month's actuals), and delivery trucks along supply links.
- **Month close sequence** (≈ 1.4 s, never skipped; at 4×/8× the popups aggregate to the top 3):
  1. Day bar fills.
  2. Worker `advanceMonth()`.
  3. Tick result arrives with a typed `events[]`.
  4. Cash/Value roll-up (600 ms).
  5. World popups over the top 5 buildings by |monthly NI| (1.6 s, staggered 80 ms).
  6. Month-close chip.
  7. Alerts, advisor and VO (priority-queued; at most one VO per close).
- **Mid-month commands** (price, stock policy, campaign budget, slot changes) are stored as *pending* and show "⏱ applies at month close (in 9 days)". Construction starts immediately; the countdown runs in months. This mirrors the engine: every effect lands at the next `AdvanceMonth`.
- **Step one month** (`.`) while paused runs the close sequence once.

**Auto-pause triggers** (Settings › Gameplay; each can be toggled):

| Trigger | Default | Also |
|---|---|---|
| Goal achieved / scenario won or lost | ON | VO + fanfare |
| Cash runway < 1 month, or cash < 0 | ON | Critical alert, insolvency countdown |
| Rival enters a market you serve (first time per city × product) | ON | Camera offer "Show me" |
| Building completed and still unconfigured | ON | Opens inspector in Setup mode |
| Major news event | ON | Newspaper sting |
| Any building completed | OFF | Toast only |
| Every month close ("review mode") | OFF | For deliberate players |
| Loan offer / covenant warning | ON | Finance drawer |

### 6.5 City view

- **Camera:**
  - Orbit camera over the active city.
  - Zoom bands: City (whole grid) → District → Street, clamped. Tilt 35°–65°. Rotation in 45° steps with Q/E, free with middle-drag. Pan with WASD/arrows or right-drag; pan limits = city bounds + 10%.
  - Double-click a building = focus (0.6 s ease). Home = frame your HQ or first building. `[`/`]` = previous/next city. Tab = cycle your buildings in this city.
- **Picking:**
  - Hover shows an outline plus a mini card (name, owner, type, headline KPI: "Sold 1.30M · +$0.95M").
  - Click opens the inspector; right-click opens a context menu (Inspect, Set price, Advertise here, Upgrade, Demolish, Show supply links).
  - Rival buildings open a read-only rival-store inspector (price, estimated Q/B/T, estimated sales).
- **Ownership colours:** player = gold accent; rivals from a colour-blind-safe set (Okabe–Ito: #E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7); civic and residential neutral.
- **Overlays** (CapLab parity: Land values, Traffic, Profit/Loss, Links, plus Magnate-specific ones):

| Overlay | Encodes | Needs engine |
|---|---|---|
| Land $ | Plot price heat (5 bins) | Land model (P1) |
| Traffic | Customer footfall per plot | City/land model (P1) |
| Demand ▾ (product) | Unmet demand per district for the chosen product | Demand by district (P1), or city-level fallback |
| Brand ▾ (product) | Your awareness share per city (tint) and per store halo | Existing brand data |
| Profit | Your buildings green→red by last-month NI | Per-building P&L (exists) |
| Owners | Footprints by company colour | Exists |
| Links | Animated arcs for internal transfers (width ∝ units) | TransferLog (exists) |
| Construction | Sites with months remaining | Construction time (P1) |

- **Ambient life** (presentation only):
  - Vehicle density ∝ city population^0.5.
  - Shoppers at a store ∝ last month's units sold (log-scaled, capped at 40 agents).
  - Trucks along supply links ∝ transfers.
  - No day/night flicker at 0.4 s/day; use a slow per-month seasonal light tint.
  - Reduced-motion mode freezes agents.

### 6.6 Build mode (placement flow)

States: **Palette → Placing (ghost) → Confirm → Constructing → Completed (Setup)**. Esc steps back one state.

```
BUILD ─ Retail | Factories | Farms & Extraction | Logistics | R&D | Media | Real estate (later) | HQ
┌───────────────────────┬───────────────────────┬───────────────────────┬───────────────────────┐
│ [icon] Convenience St.│ [icon] Supermarket    │ [icon] Department St. │                       │
│ 1×1 · $0.20M + land   │ 3×3 · $1.20M + land   │ 4×4 · $4.00M + land   │                       │
│ $4K/mo · 3 units      │ $15K/mo · 6 units(→12)│ $40K/mo · 9 units     │                       │
│ Build 1 mo            │ Build 2 mo            │ Build 4 mo            │                       │
│ "Small, cheap, local" │ "Food & drink volume" │ "Apparel, electronics"│                       │
└───────────────────────┴───────────────────────┴───────────────────────┴───────────────────────┘
 Disabled cards say why ("Needs coastal city", "Cash short $0.8M — [Finance…]").
```

Construction times are suggestions for the city/econ agents: convenience store 1, supermarket 2, department store 4, warehouse 2 (large 3), small farm 2, plantation 3, mine/oil well 4, small factory 3, large factory 6, R&D centre 4, radio 3, newspaper/magazine 4, TV station 6, seaport 9 months.

Placing (ghost follows the cursor and snaps to plot cells):

```
                    ┌──────────────────────────────────────────┐
     ░░░░░░░░       │ SUPERMARKET · Harbor District            │
     ░ GHOST░  ◀─── │ Land 9 plots × $42K ........... $378K    │
     ░ 3×3  ░       │ Construction .................. $1.20M   │
     ░░░░░░░░       │ Total $1.58M · Cash after $12.36M        │
   (green = valid)  │ Opex $15K/mo · Build 2 months            │
                    │ Catchment 61K people · Soft drink demand │
                    │   ≈ 320K/mo here · 1 rival within 6 plots│
                    │ Q/E rotate · Click place · Esc cancel    │
                    └──────────────────────────────────────────┘
```

- The overlay auto-switches by type: retail → Traffic + Demand (chosen or top product); factory → Land $ + Links (distance to suppliers/seaport); farm/extraction → geography zones.
- Validity tints on each footprint cell:
  - **Green:** valid and affordable.
  - **Amber:** valid, but cash is short or runway after < 3 months ("Finance with a loan" appears).
  - **Red:** blocked, with the reason in the tooltip: zoning, occupied, geography, out of bounds.
  - **Grey:** occupied by own building ("Replace?", later).
- Numbers are computed by a bridge `previewBuild(type, city, anchorPlot, rotation)`, throttled to at most 1 query per 100 ms while moving (the client caches by plot).

Confirm (right drawer):

```
┌ CONFIRM · Supermarket · Harbor District, Metropolis ───────────────┐
│ Land $378K + Construction $1.20M = $1.58M   (paid: 30% now, 70% on  │
│ completion — per econ spec)                                         │
│ Opens: Apr 2026 (2 months)          Opex from opening: $15K/mo      │
│ Cash after: $12.36M · Runway: >24 months                             │
│ ─ What will it sell? (you can change later) ────────────────────── │
│ [✓] Soft Drink  unmet 1.3M/mo · margin/unit ~$0.60 · rival $1.71    │
│ [ ] Bread       unmet 3.6M/mo · margin/unit ~$0.75 · no rival       │
│ [ ] Coffee      unmet 1.8M/mo · margin/unit ~$1.10 · no rival       │
│ Price: suggested band per product (edit in inspector)               │
│ Stock: (●) Balanced 1 month   ( ) Lean   ( ) Deep                   │
│ [ ] Finance with bank loan (offer: $1.5M, 7.2%, 36 mo)              │
│ [Construct  ⏎]   [Back]            Shift+Click to place another     │
└─────────────────────────────────────────────────────────────────────┘
```

- **Constructing:** scaffold and crane model, progress ring above the site ("2 mo → 1 mo"), cost shown as paid/remaining. Optional "Rush (+25% cost, −40% time)" if the econ spec adopts it. Cancel refunds per econ spec (UI must show the refund before confirming).
- **Completed:**
  - Ribbon sparkle, SFX and toast.
  - If a product was preset, the first shipment truck arrives on day 1 and shoppers appear by day 5.
  - If unconfigured, auto-pause and open the inspector in Setup mode.

### 6.7 Building inspector (right drawer; 4 tabs)

**6.7.1 Overview** (retail example):

```
┌ SUPERMARKET · Harbor District, Metropolis        Lv1 ▸ Lv2 [Upgrade $720K · payback 7 mo] ┐
│ ● Open since Mar 2026 · Units 2/6 · Opex $15.0K/mo · Staff 15–40 (est.)                    │
│ LAST MONTH  Revenue $2.31M · Gross $0.68M · Net $0.66M       ▁▂▃▅▆▇▇ 12-mo net            │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ PRODUCT LINES            price    Q  B  T   sold / demand          stock     net/mo         │
│ ■ Soft Drink            $2.25    50 42  1   1.30M / 1.30M   ✓      1.0 mo   +$0.95M  [Edit]│
│ ■ Bread                 $3.10    50  0  1   0.35M / 0.61M  ⚠ lost 0.26M  0 mo  +$0.21M [Fix]│
│ + Add product line (4 free units)                                                          │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ [Advertise here]  [Set all prices…]  [Copy layout to…]  [Rename]  [Demolish…]              │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Upgrade payback = upgradeCost ÷ (opex saving + extra units × average line gross margin); shown only if the engine exposes both.

**6.7.2 Layout** (the CapLab 3×3 unit grid). It re-expresses engine slots as CapLab units; no engine change is needed for v1.

```
 INPUTS  (purchase units)        PROCESSING  (unit grid · Lv2 = 3×3)        OUTPUT  (sales / shipping units)
 ┌───────────────────────┐      ┌──────────┬──────────┬──────────┐      ┌────────────────────────────┐
 │ Sugar 20/cycle        │━━━━━▶│ SOFT     │ SOFT     │ BREAD    │━━━━━▶│ → Own stores   1.10M/mo    │
 │ Own: Cane Mill #4  Q50│      │ DRINK    │ DRINK    │ 200/cyc  │      │ → Warehouse #2 0.20M/mo    │
 ├───────────────────────┤      │ 200 cyc  │ 188 cyc  │ 80 cyc   │      │ → Export @ $1.50  ⚠ −4% m. │
 │ Plastic 5/cycle       │━━━━━▶│ ▮▮▮▮▮100%│ ▮▮▮▮▯ 94%│ ▮▮▯▯▯ 40%│      └────────────────────────────┘
 │ World mkt $3.00 +frt  │      ├──────────┼──────────┼──────────┤
 ├───────────────────────┤      │    +     │    +     │    +     │      Arrow width ∝ monthly units.
 │ Flour 50/cycle  ⚠ 40% │╍╍╍╍╍▶│  empty   │  empty   │  empty   │      ━ own supply   ━ world market
 │ World mkt $1.50       │      ├──────────┼──────────┼──────────┤      ╍ starved (<90% of need)
 └───────────────────────┘      │  locked  │  locked  │  locked  │      ⚠ export below unit cost
                                │  Lv3     │  Lv3     │  Lv3     │
                                └──────────┴──────────┴──────────┘
```

- Grid size follows `GetCapacity` (e.g. factory_small 6 → 9 → 12; supermarket 6 → 9 → 12). Rendered as 3 columns × ⌈capacity/3⌉ rows; locked cells show the level that unlocks them.
- For **retail**, each unit card is a product line: INPUTS = the source of that product (own chain / world), OUTPUT = the shelf (price, sold/demand, stock cover).
- For **farms/extraction**: no INPUTS column; OUTPUT = destinations.
- For **R&D**: units are research projects (product, tech x→x+1, ETA).
- For **warehouses**: stored products with cover and the stores they supply.
- Mouse-first: click a unit to edit; drag a product from a palette onto an empty cell to add it; Delete clears a unit (confirm if stock > 0). Keyboard: arrows move between cells, Enter edits (SlotEditor parity).

**6.7.3 Retail line editor** (popover from a unit or line):

```
┌ Soft Drink · Harbor Supermarket ──────────────────────────────────────────────────┐
│ PRICE                                                                   $2.25     │
│ unit cost $1.52 ▏ world $1.50 ▏ rival min $1.71 ▏ ◆ suggested $2.40 ▏ Low ceiling $8.00 │
│ ├───────●──────────────────────────◆───────────────────────────────────────┤ ··· │
│ At $2.25: expected 1.24M units/mo · gross $0.91M/mo · share ≈ 47% (forecast)      │
│ STOCK POLICY   ( ) Lean 0.5 mo   (●) Balanced 1.0 mo   ( ) Deep 1.5 mo   ( ) Custom│
│                = 1.30M units on shelf · $1.98M tied up · last month: 0 lost       │
│ SOURCE         Own chain first → World market ($1.50 + freight)   [Change…]      │
│ ⏱ Applies at month close (in 9 days)          [Apply]  [Revert]  [Apply to all…] │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **Slider range:** [max(0.5 × unit cost, $0.01), max(3 × world price, 1.1 × highest finite reservation ceiling)].
- **Step:** max($0.01, round-to-cent(1% of world price)).
- **Markers:** unit cost (WAC incl. freight), world price, rival min and median (same city), suggested (bridge `suggestPrice`), reservation ceilings per bracket ("above $8.00 low-income shoppers stop buying").
- **Warnings:** red if price < unit cost ("selling at a loss of $X/unit"); amber if above a ceiling ("excludes N% of demand").
- **Stock policy:** units = round(forecast monthly demand for this line × cover months). Forecast = last month's (sold + lost), or the bridge forecast in the first month. Raw units stay under "Custom" for experts. Default for a new line = Balanced.

**6.7.4 Factory line editor** (production unit):
- Recipe (inputs × qty → output) and cycles/month (200/unit today).
- Utilization = cyclesActual ÷ 200.
- Unit cost vs world price ("make vs buy: saves $0.18/unit").
- Input sources per input (own building or world; later rival suppliers with price/Q).
- Output destination priority (own stores → warehouse → export); per-product export toggle with a margin warning.

**6.7.5 Finance tab:**
- Per-building accrual P&L: this month / last 12 months / since open, as in Godot, now as a chart.
- Units sold and lost chart, inventory table (qty, WAC, Q), capex history (construction, upgrades, land).

**6.7.6 Upgrades & Staff tab:**
- Level ladder from content (`levels[]`: capacity, opex, upgrade cost), with payback.
- Workforce: target headcount range (content) and actual staff once the labour model exists; until then, label it "estimate".

### 6.8 Markets overlay (I)

```
┌ MARKETS ─ Show: [Unmet demand ▾]  Cities: All ▾  Tier: Finished ▾  [Only mine] [Contested]  ─────────── ✕ ┐
│              Metropolis  Riverside  Eastside  Portbay  Hilltown  │ SOFT DRINK · METROPOLIS                   │
│ Soft drink    ███ 1.3M   ██ 0.7M    ██ 0.6M   █ 0.4M   █ 0.3M   │ Demand 2.63M/mo  Low 1.13M Mid 1.20M High 0.30M│
│ Bread         ████ 3.6M  ███ 1.7M   ██ 1.3M   ██ 1.1M  █ 0.6M   │ Ceilings: Low $8 · Mid $50 · High none    │
│ Coffee        ███ 1.8M   ██ 1.1M    ██ 1.0M   █ 0.5M   █ 0.5M   │ SUPPLY vs DEMAND  ▬▬▬▬▬▬▬▬ supply 1.8M    │
│ Beer          ██ 1.3M    █ 0.7M     █ 0.5M    ▏0.4M    ▏0.3M    │                   ▬▬▬▬▬▬▬▬▬▬ demand 2.6M │
│ Car           ▏1.4K      ▏0.8K      ▏0.9K     ▏0.4K    ▏0.5K    │ OFFERS  price   Q   B   T   share  sold    │
│ Television    ▏2.2K      ▏1.2K      ▏1.2K     ▏0.6K    ▏0.6K    │ You     $2.25  50  42   1   47%  1.24M    │
│ …                                                              │ LocalCo $1.71  50   0   1   53%  1.39M    │
│ Cell: size = value; colour = your share (0% grey → 100% gold);   │ Trend (12 mo): share ▁▂▃▅▅▆                │
│ unserved markets included                                      │ [Open store here] [Advertise] [Research] │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Metric selector:** Demand, Unmet demand (= demand − Σ sold), Your share (realised), Avg price, Rivals (#), Margin potential (= unmet × (avg price − world cost)).
- **Detail pane:** CapLab-style supply/demand lines, the bracket split with reservation ceilings, the offers table with Q/B/T bars and realised sales, and action buttons that deep-link into Build mode (retail preset, overlay on) or Marketing (product and city pre-filled).

### 6.9 Reports overlay (R)

```
┌ REPORTS ─ [P&L] [Balance sheet] [Cash flow] [Products] [Buildings] [Cities] [Charts] [History] [Ledger]  ─ ✕ ┐
│ Period: (●) Month ( ) Quarter ( ) Year   Range: Jan 2026 – Jun 2026   [Compare prev. period] [Export CSV]   │
│ ┌ Revenue / Net income ─────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇  bars = revenue · line = net income                                               │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                       Jan      Feb      Mar      Apr      May      Jun     │ Why did Jun change? ─────────── │
│ Revenue             2.31M    2.30M    2.45M    2.80M    2.84M    2.95M     │ Volume      +$0.08M ▇           │
│  Product sales      2.31M    2.30M    2.45M    2.60M    2.62M    2.70M     │ Price        +$0.02M ▏          │
│  Exports                –        –        –    0.20M    0.22M    0.25M     │ COGS/unit   −$0.01M ▏           │
│ COGS               −1.62M   −1.61M   −1.72M   −1.95M   −1.97M   −2.03M     │ Advertising −$0.05M ▎           │
│ Gross profit        0.69M    0.69M    0.73M    0.85M    0.87M    0.92M     │ New building −$0.02M ▏          │
│ Operating costs    −0.08M   −0.08M   −0.13M   −0.13M   −0.13M   −0.15M     │ = Net       +$0.02M             │
│ Advertising        −0.05M   −0.05M   −0.05M   −0.05M   −0.05M   −0.10M     │                                 │
│ (Interest, Depr., Tax when finance lands)                                 │ Books close ✓ (equity = paid-in │
│ NET INCOME          0.56M    0.56M    0.55M    0.67M    0.69M    0.67M     │ + retained earnings)            │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **P&L lines** follow the engine categories. The variance waterfall comes from bridge `explainNetIncome`.
- **Balance sheet:** assets (cash, inventory at WAC, buildings net of depreciation, land), liabilities (loans), equity (paid-in, retained earnings), plus the "Books close ✓" check.
- **Cash flow:** operating / investing (construction, **upgrades**, land) / financing (capital, loans, dividends). The Godot client omits upgrades and royalties; this one must reconcile to Δcash.
- **Products:** units, revenue, COGS, gross margin %, ads, contribution, plus a trend sparkline. Row click → Markets.
- **Buildings:** per-building P&L. Row click → "Show on map".
- **Cities:** revenue, profit and share by city.
- **Charts:** value, cash, revenue, NI, share, brand and tech, **vs rivals**, selectable. History is persisted in saves (Godot keeps it in memory only).
- **History:** month-by-month summary with notable events (ReplayViewer parity).
- **Ledger explorer:** a virtualised table with filters (category, building, product, month), search, CSV export. This covers the ActivityFeed and Replay parity.

### 6.10 Finance overlay (F)

```
┌ FINANCE ─ [Overview] [Bank] [Equity] [Stock market] ──────────────────────────────────────────────────── ✕ ┐
│ Cash $12.4M · Debt $5.0M · Equity $19.1M · Debt/Equity 0.26 · Credit rating A− ▲ · Runway >24 mo          │
│ Interest coverage (EBIT/interest) 11.2× · Next payment $152K on Jul 1                                      │
│ ── BANK ─────────────────────────────────────────────────────────────────────────────────────────────────── │
│ Offers (based on rating A−)   Amount [$1M ━━━●━━━━ $15M] $5.0M   Term (●)12 ( )36 ( )60 mo   Rate 7.2%     │
│ Monthly payment $155K · Total interest $0.58M · Effect on runway: +8 months     [Take loan]               │
│ Outstanding: Loan #1 $5.0M @7.2% · 34 mo left · [Repay early (fee 1%)]                                     │
│ ── EQUITY ──────────────────────────────────────────────────────────────────────────────────────────────── │
│ IPO: locked — needs 12 months of profit and value ≥ $50M (progress ▓▓▓░░ 62%)  [What is an IPO?]          │
│ Dividends: — (after IPO) · Buyback: — · Issue shares: —                                                   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**IPO wizard** (L4 modal, four steps):
1. Shares offered (% float).
2. Price range from bookbuilding ("demand at price").
3. Fees.
4. Summary of cash raised, founder stake and share price chart start.

Ends with the bell-ring moment (§8). The **Stock market** tab lists tickers (price, change, market cap, P/E) and your holdings, with buy/sell order entry and takeover progress to 50%.

All rules (IPO thresholds, rates by rating) belong to the finance spec. The UX requirement is that each rule is visible *before* the player needs it, as a locked card with progress.

### 6.11 R&D overlay (T)

- Table of products grouped by tier. Columns:
  - your tech x/max, best rival tech, research slots assigned, progress bar;
  - ETA = (100 × tech − progress) ÷ (100 × slots) months (BaseResearchThreshold × level; 100 pts per slot-month, SimulationConstants.cs:34, 56);
  - patent status (own, rival: blocked until date, licensed).
- **Actions:**
  - "Research this" picks an R&D building with free units, or offers to build one (→ Build mode, R&D preset).
  - Reassign units; grant or revoke licences.
  - Estimated royalty income = 5% × licensee revenue on the product last month.
- **Graph view** (ResearchTree parity) with mouse picking and keyboard navigation.

```
┌ R&D ─ [Products] [Graph] [Patents] ───────────────────────────────────────────── ✕ ┐
│ Product        You    Best rival      Units  Progress          ETA    Patent        │
│ Soft drink     4/8    5 (LocalCo)     2      ▓▓▓▓▓░░░ 260/400  1 mo   —             │
│ Television     2/12   6 (Zenith Labs) 0      —                 —      Zenith until  │
│                                                                       Mar 2029 [lock]│
│ Car            1/12   9 (Zenith Labs) 0      —                 —      —             │
│ [Research this ▸]  → assigns a free unit in R&D Centre #3, or offers to build one   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.12 Marketing overlay (K)

- **Campaign table:** product, city, channel, budget/mo, brand (you vs top rival), trend, estimated incremental gross profit/mo, [Edit] [Stop].
- **New campaign:** product and city pre-filled from context; channel cards show cost per point (TV $4K, Radio $5K, Newspaper $6K, Magazine $8K; SimulationConstants.cs:59-68) and the media-ownership bonus (×1.35 broadcast, ×1.25 print).
- **Forecast chart:** 12-month brand curve from the engine formula B′ = min(100, B + (budget × bonus ÷ costPerPoint) × (1 − B/100)), decaying 2%/mo when stopped. Plus the sales impact once the demand model links brand to units (§5 P0).
- **Warning:** "No store sells this product in this city: this campaign earns nothing" (fixes X7).
- **Brand map:** a city × product grid of your awareness vs the leader's.

```
┌ MARKETING ─ [Campaigns] [Brand map] [Media] ──────────────────────────────────── ✕ ┐
│ Product     City        Channel  Budget/mo  Brand you / leader     Trend  Est. gross │
│ Soft drink  Metropolis  TV       $50K       48 / 48 (you)          ▂▄▆█   +$0.21M/mo │
│ Bread       Metropolis  Radio    $20K       12 / 31 (LocalCo)      ▁▂▃▃   +$0.04M/mo │
│ + New campaign (product and city from your selection)                               │
│ ┌ Forecast · Soft drink · Metropolis · TV $50K/mo ─────────────────────────────┐    │
│ │ 100┤                          ..............  keep running                 │    │
│ │  50┤            ..........                                                  │    │
│ │   0┼──......─────────────────────────────────  stop now: −2%/month decay    │    │
│ │     now  +3   +6   +9   +12 months                                         │    │
│ └────────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.13 Rivals overlay (V)

- One card per rival:
  - archetype label (Discount retailer / Adaptive / Vertical integrator / Tech leader), in plain words ("Undercuts the cheapest price by 5%");
  - value, cash, buildings, cities, products;
  - contested markets with you (their share vs yours);
  - moves timeline: "Mar: opened Supermarket in Harbor (soft drink $1.71)", "Apr: cut price to $1.62";
  - stock price when listed.
- Click a move → Locate in city.
- Threat level = Σ over contested markets of their share × your gross profit at risk.

```
┌ RIVALS ───────────────────────────────────────────────────────────────────────── ✕ ┐
│ ┌ LocalCo · Discount retailer ────────────┐ ┌ Zenith Labs · Tech leader ───────────┐│
│ │ Value $38M · 14 stores · 3 cities        │ │ Value $120M · listed ZNTH $41.20 ▲   ││
│ │ "Opens where demand is biggest; prices   │ │ "Pours R&D into one premium product; ││
│ │  5% under the cheapest seller."          │ │  prices 30% above rivals."           ││
│ │ Contested: Soft drink/Metropolis         │ │ Contested: Car/Eastside              ││
│ │  them 53% · you 47%   Threat ▓▓▓░░       │ │  them 70% · you 12%  Threat ▓▓▓▓░    ││
│ │ Jun 26: opened Harbor Supermarket $1.71  │ │ Mar 29: patent on Car (24 months)    ││
│ │ [Locate] [Markets]                       │ │ [Locate] [R&D]                       ││
│ └──────────────────────────────────────────┘ └──────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.14 News and events (N)

- News feed with severity, effect summary translated to *your* business ("Crude −30% for 9 months → your plastic input cost −$41K/mo"), Locate, and a filter by category.
- The business event log (the ActivityFeed's 9 categories) comes from typed tick events.
- The ticker shows the 5 newest; click opens the item.

### 6.15 Advisor (H) — priorities with $ impact

The advisor is a persona (e.g. "Morgan, your COO"; one voice) with a portrait in the HUD. At each month close the engine/bridge evaluates rules, estimates $/month impact, and shows the top 3. Each has **one fix action** and "Dismiss for 3 months".

| Rule | Trigger | Impact estimate ($/mo) | One-click fix |
|---|---|---|---|
| Stock-out | lostSales > 5% of demand on a line | lost × (price − unitCost) | Stock policy → Balanced (or Deep if repeated) |
| Overstock | cover > 3 months | stock$ × 1%/mo cost of capital | Stock policy → Lean |
| Selling below cost | price < unitCost | sold × (unitCost − price) | Set price = suggested |
| Idle building | 0 configured units for ≥ 1 month | opex | Open Setup |
| Losing building | NI < 0 for 3 consecutive months | −avg NI | Open Finance tab (reprice / demolish) |
| Rival undercut | rival price < yours × 0.9 in a served market and your share fell ≥ 5 pts | Δshare × demand × margin | Match (rival −1%) / Advertise |
| Low runway | runway < 3 months | — (critical) | Open Bank offers |
| Unserved opportunity | top unmet market by margin potential ≥ 2× your best line | potential gross/mo × 0.3 | Build store here (Build mode, preset) |
| Wasted ads | campaign where you have no store | budget | Stop campaign |
| Upgrade payback < 12 months | from the §6.7.1 formula | saving/mo | Upgrade |
| Patent leverage | own patent with no licensees and rivals blocked | est. royalties | Open R&D › Licensing |
| Tech gap | rival tech ≥ yours + 2 in a contested product | share at risk × margin | Research this |

This replaces Main.cs:669-719. The ladder text becomes the fallback when no rule fires ("Everything's running. Next: scale your best market →").

### 6.16 Goals, briefing, win and lose

- **Briefing** (at start and via G): scenario art, story paragraph, goals as cards, rivals, start cash, deadline ("Dec 2030 · 59 months · ≈ 12 min at 1×"), "How you lose" (insolvency rule, deadline), and "Suggested opening".
- **Goal cards:**
  - description in plain words, plus product/city names (not ids);
  - rule chip: **Reach once** (latched ✓) or **Hold at deadline** (live);
  - current vs target (e.g. "Share 47% / 55%", realised, last month);
  - progress bar, "How to" link to the encyclopedia.
- **Insolvency countdown:** when cash < 0, the HUD shows "INSOLVENT IN 5 MONTHS" in red next to cash, where N = 6 − consecutive negative month-ends (current rule; the finance spec may change it).
- **Deadline:** at ≤ 12 months left, the HUD date turns amber; at ≤ 3 months, red with "3 months left".
- **Win debrief** (L4):
  - Headline, months taken, final value, rank vs rivals.
  - Four charts: value, revenue, net income, share.
  - Achievements (fastest store, first patent…).
  - Buttons: [Continue in sandbox] [Next scenario] [Main menu].
- **Lose debrief:** the cause with the moment it became unavoidable ("Cash fell below zero in Jun 2027 after the Bread line lost $210K/mo for 8 months"), what would have helped (from advisor history), and [Load autosave from N months ago] [Retry] [Main menu].
- "Keep playing" after insolvency is spectator-only; the company is frozen.

```
┌ VICTORY · Soft Drink War ───────────────────────────────────────────────────────────┐
│ Completed in 41 months (Jun 2029) · Company value $63.2M · Rank #1 of 3             │
│ [Value vs rivals]   [Revenue & net income]   [Share: soft drink/Metro]   [Brand]    │
│ ✓ Share ≥ 55%: 58% at the deadline check    ✓ Company value ≥ $60M: reached Apr 29  │
│ Highlights: record month +$2.9M (Mar 29) · overtook RivalCo (Nov 27) · 0 stock-outs │
│ [Continue in sandbox]            [Next scenario ▸]            [Main menu]           │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.17 Tutorial system

- **Script format** (JSON per chapter; state in zustand; survives panel changes and save/load). Each step has:
  - `id`, `title`, `body` (≤ 40 words), `vo` (line id), `why` (≤ 20 words);
  - `highlight`: UI selector or world entity (building type, plot, rival store);
  - `camera` (optional preset);
  - `allow`: whitelist of UI actions, other buttons dimmed but not hidden;
  - `complete`: a predicate on bridge state, **latched**;
  - `hintAfterSec` (default 45 s real time without progress → hint bubble + nudge VO);
  - `skippable: true`.
- **Presentation:** coach-mark spotlight (dims everything except the target) + advisor bubble + collapsible checklist in the Advisor drawer. VO plays **once per step id per save**.
- **Tutorial campaign** (aligns with build-plan §4.3's six missions):
  1. First store and first profit (§7).
  2. First factory (vertical integration: make vs buy).
  3. Advertising and brand war.
  4. R&D and patents.
  5. Finance: loans, credit, first IPO.
  6. Takeover (after the stock market lands).

### 6.18 Settings and accessibility

| Group | Setting | Default |
|---|---|---|
| Audio | Master / Music / SFX / Voice / Ambient volume (0–100); mute toggle Ctrl/⌘+M (plain M is Company) | 80 / 60 / 80 / 100 / 50 |
| Audio | Advisor voice frequency: All / Important only / Off; Subtitles | Important only; ON |
| Gameplay | Default speed; pause in full-screen screens; auto-pause triggers (§6.4); autosave interval (months) and slots; tutorial hints | 1×; ON; per table; 6 months, 5 slots; ON |
| Gameplay | Number format (short $1.2M / full), currency symbol | short |
| Graphics | Quality preset (Low/Med/High/Ultra), shadows, ambient agents density, antialiasing, resolution scale 50–100%, FPS cap | Auto (GPU tier) |
| Accessibility | UI scale 80–150%, font size, colour-blind palette (off / deutan / protan / tritan: remaps profit/loss to blue/orange + icons), reduced motion, high-contrast HUD, screen-reader labels for HUD numbers (`aria-live="polite"` on the month-close summary only) | off / 100% / reduced motion follows OS |
| Controls | Rebind all hotkeys; camera edge-scroll on/off; invert rotate; zoom sensitivity | edge-scroll off |

### 6.19 Save / Load

- **Slots:**
  - Autosave every 6 in-game months plus on scenario milestones (goal met), keep 5 rotating.
  - Quick-save: Ctrl/⌘+S writes the **game's own quick slot**; it never overwrites another save (fixes SaveMenu.cs:433-438). Quick-load is Ctrl/⌘+L with confirmation.
  - Named saves.
- **Metadata:** city thumbnail (canvas snapshot, 320×180 WebP), scenario, in-game date, company value, real play time, schema version.
- **Storage:** IndexedDB (browser quota; show usage). "Export save (.json)" / "Import save".
- Backward compatible with engine save schema v9+.
- Loading resets all presentation state (toasts, goal latches from the save, win/lose flag), fixing the Godot flag leak.
- Quit to title prompts "Save before quitting? (last save 7 months ago)" if unsaved.

### 6.20 Keyboard and mouse map (web)

WASD is taken by the camera, so Godot's A (Activity) and S (Save) move. Legacy letters that still make sense are kept.

| Key | Action | Godot equivalent |
|---|---|---|
| Space | Pause / resume | Space |
| 1 / 2 / 3 / 4 | 1× / 2× / 4× / 8× | 1/2/3 (1×/2×/5×) |
| `.` | Step one month (paused) | `.` |
| Shift+`.` | Skip to next event | — |
| W A S D / arrows | Pan camera | — |
| Q / E | Rotate camera 45°; **in Build mode:** rotate footprint | — |
| Mouse wheel, + / − | Zoom | — |
| Right-drag / middle-drag | Pan / orbit | — |
| Home · Tab · `[` `]` | Frame HQ · cycle own buildings · prev/next city | — |
| B | Build palette | (Manage › Build) |
| M | Company (portfolio) | M (Manage) |
| I | Markets | I |
| R | Reports | R (+F Financials, P Replay, X Stats) |
| F | Finance (bank, equity, stock) | F was Financial statements; now under R |
| T | R&D | T |
| K | Marketing | (Manage › Campaigns) |
| V | Rivals | — |
| N | News & events | A (Activity) |
| C | City overview / switcher | C (City Map) |
| G | Goals / briefing | — |
| H / click portrait | Advisor drawer ("Help me") | — (executive brief was passive) |
| J | Alerts drawer | — |
| O · Shift+1..8 | Cycle overlays · specific overlay | — |
| Enter · Esc | Confirm · back one level (cancel placement → close drawer → close overlay → pause menu) | Esc = back to title (**removed**) |
| U · Delete | Upgrade selected · demolish selected (confirm) | — |
| Ctrl/⌘+S · Ctrl/⌘+L · Ctrl/⌘+O | Quick-save · quick-load · Save/Load menu | S (menu), Ctrl+S (inside menu) |
| F1 · ? | Encyclopedia · controls sheet | ? |
| Ctrl/⌘+Z | Undo last *pending* (not yet month-closed) command | — |

**Notes:**
- Q/E are camera rotation, so the advisor uses H and the portrait click is the primary path.
- Browser shortcuts (Ctrl/⌘+S/L/O) must call `preventDefault()` while the canvas or app has focus.
- Letter hotkeys are ignored while a text field has focus.
- The rebinding UI (§6.18) exposes every row.

**Mouse:** left click select, double-click focus, right-click context menu, drag on minimap to pan, hover for tooltips (400 ms delay; `Tooltip.cs` parity), Shift+click place multiple in Build mode.

### 6.21 Alerts and notifications policy

| Severity | Examples | Toast | Sound | VO | Auto-pause | Persist in Alerts |
|---|---|---|---|---|---|---|
| Critical | Insolvency countdown, cash < 0, scenario lost, loan default | Sticky until acknowledged | `alert_critical` | yes (once per condition) | yes | yes |
| Warning | Stock-out, selling below cost, runway < 3 mo, rival undercut, starved factory | 7 s | `notify_warning` | important only | per §6.4 | yes |
| Opportunity | Unserved market, upgrade payback < 12 mo, patent granted, record month | 6 s | `notify_opportunity` | occasional | no | yes |
| Success | Goal met, construction done, tech level up, loan repaid | 5 s | contextual | on goals | goal: yes | yes |
| Info | News (minor), campaign started | ticker only | `notify_info` | no | no | news log |

**Rate limits:**
- At most 3 toasts on screen; newer ones queue.
- Dedupe by `(kind, buildingId|market)` within 3 months.
- At 4×/8×, Warning and below are batched into one "7 things need attention" toast per close.
- At most one VO per month close, by priority: Critical > goal > rival > opportunity.

---

## 7. The first 15 minutes (Tutorial chapter 1: "Your First Company")

**Design constraints**
- Every step must move a number the player can see.
- No step may be satisfiable by an irrelevant action (fixes X6 and X7).
- Goals are latched milestones.
- The guidance persists across all panels.
- VO plays once per step.
- The real-time budget is about 15:00, with about 35% of it paused for reading and decisions.

**Proposed chapter content** (needs the §5 P0/P1 engine items):

| Setting | Value |
|---|---|
| City | Metropolis only (other cities locked in chapter 1) |
| Starting cash | **$6M**, so capital is scarce, inventory visibly ties up cash, and a loan is meaningful |
| Rival | LocalCo ("discount retailer"). Enters soft drinks in Metropolis in **June 2026** at 5% under the player's price, scripted via a tutorial hook or an AI entry delay. |
| Deadline | None |

**Goals** (all *reach once*):
1. Open your first store.
2. Earn a profitable month.
3. Hold ≥ 45% soft-drink share in Metropolis for 2 consecutive months after LocalCo arrives.
4. Brand awareness ≥ 30 in Metropolis *with a store selling the product*.
5. Open a second product line or store after taking a bank loan.
6. Company value ≥ $10M.

**Tuning target** for the econ team:
- A player following the suggestions reaches G6 at in-game month 24–36.
- A passive player (no ads, no expansion) reaches it at month 48 or later.
- An exploit-free design means nobody reaches it before month 12.

| Real time | In-game | Beat | Player does | Game shows | VO | Completes when |
|---|---|---|---|---|---|---|
| 0:00–0:40 | — | Welcome | Title → Tutorial card → **Briefing** | Six goal cards, rival card, "$6M start, no deadline" | `vo_welcome`, `vo_t1_intro` | Start |
| 0:40–1:00 | Jan 2026 (paused) | Flyover | Watch (Esc skips) | 8 s camera path from skyline to Harbor district; soft-drink **Demand overlay** pulses the hottest districts | `vo_t1_city` | Flyover ends |
| 1:00–2:00 | Jan (paused) | **Build** | B → Retail → Supermarket → click a glowing plot → Confirm | Only Retail enabled. Ghost + cost card ($378K land + $1.20M build); recommended plots = traffic ≥ 70th percentile; confirm pre-selects Soft Drink | `vo_t1_build` | Construction started |
| 2:00–2:20 | Jan→Mar (2×, 12 s) | Watch it rise | Play, then 2× (coach mark on the speed control) | Scaffold → floors → crane; progress ring "2 mo → 1 mo"; delivery trucks queue | `vo_t1_speed` | Building completed (auto-pause) |
| 2:20–3:00 | Mar (paused) | **Price and stock** | Inspector Setup: drag the price into the suggested band; stock policy **Balanced** | Slider markers (cost, world, suggested, $8 ceiling); "expected 1.2M units, gross $0.9M/mo"; "$1.9M tied up in stock" | `vo_t1_price` | Line configured |
| 3:00–3:15 | Mar→Apr (1×, 12 s) | **First month** | Play | Shoppers walk in, trucks unload; day clock; **month close**: cash roll-up, "+$" over the store, chip "Revenue $2.8M · Net +$0.7M" | `vo_first_sale` | NI > 0 → **G1 ✓ G2 ✓** (gold banner, auto-pause) |
| 3:15–3:45 | Apr (paused) | Read your store | Hover the product line | "Sold 1.28M / demand 1.30M ✓ · lost 0"; tooltip explains lost sales | `vo_t1_readstore` | Acknowledge |
| 3:45–4:10 | Apr→Jun (1×, 24 s) | Business as usual | Play | Two quiet month closes; ambient city | — | Scripted rival event, 1 Jun |
| 4:10–4:40 | Jun (auto-pause) | **Rival arrives** | "Show me" | Camera pans to LocalCo opening across the street (red beacon); price tag $X × 0.95; Markets rail badge "!" | `vo_rival_enters` | Acknowledge |
| 4:40–5:00 | Jun→Jul (12 s) | Feel the hit | Play | Close: sold 1.28M → 0.82M; share 38%; red ▼ chip; shoppers split between the two stores | `vo_t1_sharedrop` | Month close |
| 5:00–6:00 | Jul (paused) | **Respond** | The advisor offers three priced options: Match price (−$0.09) · Advertise TV $50K/mo · Hold. Choose **Advertise** → Marketing drawer pre-filled → Start | Forecast: brand 0 → 12 → 23 → 33 in 3 months; "≈ +0.25M units/mo by Oct" | `vo_t1_advertise` | Campaign active **in a city where you sell** |
| 6:00–6:50 | Jul→Nov (1×, 48 s) | Brand builds | Play | Billboards and bus stops switch to your logo; brand bar climbs; units recover to ~1.1M | `vo_brand_milestone` (at 30) | **G4 ✓**; **G3 ✓** after 2 closes ≥ 45% |
| 6:50–8:00 | Nov (Reports auto-open, paused) | **Read the books** | Browse the P&L; click **Why?** | Waterfall (Volume +, Advertising −); Balance sheet highlights "Inventory $1.9M: cash you can't spend" | `vo_t1_books` | Close Reports |
| 8:00–9:15 | Dec (paused) | **Borrow to grow** | Advisor: "Bread: 3.6M/mo demand, no rival, ≈ +$0.5M/mo. Cash $2.9M is too thin." → Finance › Bank → $3M, 36 mo | Offer card: 8.0%, $94K/mo; runway before/after; interest will appear in the P&L | `vo_t1_loan` | Loan taken |
| 9:15–10:15 | Dec (paused) | **Expand** | Either add a Bread line in the store's free unit (Layout tab, drag Bread into a cell), or build a 2nd supermarket | Layout grid: new unit, arrow from "World market" to shelf; stock Balanced | `vo_t1_expand` | **G5 ✓** |
| 10:15–13:30 | Jan→Dec 2027 (4×, 36 s + two pauses) | Grow | Play at 4× (coach mark) | Aggregated closes. **One news event** (sugar +20% for 6 months) translated as "your soft-drink cost +$0.06/unit". **One advisor fix** (Bread stock-out → Balanced→Deep, one click). | `vo_news_major`, `vo_stockout` | — |
| 13:30–14:30 | 2028 (8×, ≈ 15 s) | Finish line | Play 8× | Value counter and G6 ring fill; LocalCo reprices once | `vo_t1_almost` | Value ≥ $10M → **G6 ✓** |
| 14:30–15:00 | — | **Victory** | Debrief | Fanfare, HQ fireworks, camera orbit (6 s); charts (value, revenue, share); "Chapter 2: Make it yourself" | `vo_victory_t1` | Next chapter / Sandbox |

**Fail-safes**
- **No progress for 45 s** real time on a step: the hint bubble and a nudge VO play once, then the target pulses every 10 s.
- **Player deviates** (e.g. builds a factory): the step stays open and the advisor says "That's fine — the store is still the goal for this chapter."
- **Out of cash** before the loan step: the loan step is pulled forward.
- **Skip tutorial** always works and drops the player into the same city in sandbox mode with the same goals shown as optional.

---

## 8. Game-feel catalogue (economic event → juice)

Conventions:
- Popups are world-anchored over the building (billboard sprite, rise 60 px, 1.6 s, ease-out). Positive values use the player colour, negative red, milestones gold.
- Money is formatted short ($1.2M).
- At 4×/8× only the top 3 per close are shown.
- SFX ids ending in `*` are new; the rest exist in `client/assets/audio/sfx`.

| # | Event (tick event / command) | Condition | World visual | UI | SFX | VO (id, limit) | Camera / pause |
|---|---|---|---|---|---|---|---|
| 1 | Construction started | `construct` ok | Scaffold spawns with a dust puff; plot flattens | "−$1.58M" popup at site | `build_construct` | `vo_building_first_<cat>` once per category | — |
| 2 | Construction progress | each visual day | Floors rise (Y-scale lerp), crane swings | Progress ring | `construct_loop*` spatial, only within district zoom | — | — |
| 3 | Construction completed | `BuildingCompleted` | Scaffold drops, ribbon and sparkle, lights on | Success toast | `ribbon_cut*` | first 3 per game | Nudge if off-screen (setting); auto-pause if unconfigured |
| 4 | First sale ever | first close with ProductSale > 0 | Coin burst over the store | Big "+$X" | `cash_sale` | `vo_first_sale` once | — |
| 5 | Month closed, profit | NI > 0 | Top-5 building popups | Cash roll-up 600 ms; chip | `month_close_up*` (pitch +1 semitone per consecutive profitable month, max +5) | — | — |
| 6 | Month closed, loss | NI < 0 | Red popups | Cash chip amber flash ×2 | `month_close_down*` | advisor line if 2+ in a row | — |
| 7 | Record month | NI > previous max × 1.10 and ≥ $100K | Confetti at HQ | "RECORD MONTH" ribbon under the cash chip | `record*` | `vo_record_month` ≤ 1 per 12 months | — |
| 8 | Revenue milestone | cumulative $1M / $10M / $100M / $1B | Gold beam at HQ | Banner | `goal_achieved` | `vo_milestone_<n>` once each | — |
| 9 | Stock-out | line lost > 5% of demand | Empty-shelf icon; some shoppers turn back | Warning toast [Fix] [Locate] | `stockout*` | `vo_stockout` first time, then batched | — |
| 10 | Overstock | cover > 3 months | Pallets stacked outside | Warning (batched) | `notify_warning` | — | — |
| 11 | Below-cost price | price < unit cost | Red price-tag icon | Warning [Fix] | `notify_warning` | `vo_below_cost` once | — |
| 12 | Price change applied | at close | Price-tag flip at the store | — | `price_tag*` | — | — |
| 13 | Ambient shoppers | last month's units | Agents ∝ log(units), ≤ 40 per store | — | crowd murmur* (zoom-scaled) | — | — |
| 14 | Deliveries | transfers + restock | Trucks along roads (warehouse/factory/port → store) | Links overlay arcs | engine rumble* (spatial) | — | — |
| 15 | Rival enters your market | `RivalEnteredMarket` | Red beacon; rival logo pops | Rail badge "!"; warning toast | `rival_alert*` | `vo_rival_enters` once per rival × city | Auto-pause + "Show me" pan |
| 16 | Rival undercuts you | `PriceUndercut` (≥ 5% below) | Crossed-swords icon on the market | Warning | `price_war*` | `vo_price_war` first time | — |
| 17 | You take #1 share | rank change to 1 | Crown over your store | Success | `overtake*` | `vo_overtake` ≤ 1 per 6 months | — |
| 18 | Share milestone | 25 / 50 / 75% realised | Ring in company colour | Success | `milestone_small*` | — | — |
| 19 | Campaign launched | `startCampaign` | Billboards, bus stops and rooftop signs switch to your logo (count ∝ budget, ≤ 12) | "Ad campaign: Soft Drink" popup | `campaign_start` | `vo_campaign_first` once | — |
| 20 | Brand milestone | 30 / 50 / 70 in a city | Giant downtown billboard with your logo | Success | `brand_up*` | `vo_brand_household` at 70 | — |
| 21 | Brand fading | brand < 30 after a stop | Billboards revert to civic ads | Info | — | — | — |
| 22 | Tech level up | `TechLevelUp` | Lab pulses; beam | "Tech 3 → 4" badge on the product icon | `tech_up*` | first time and at max | — |
| 23 | Patent granted | `PatentGranted` | "PATENTED" stamp on the product | Success | `stamp*` | `vo_patent` | — |
| 24 | Blocked by a rival patent | first blocked month | Lock icon on the R&D unit | Warning | `notify_warning` | `vo_patent_blocked` once | — |
| 25 | Major news (commodity) | `NewsFired` Major | Newspaper spin-in; affected factories show ▲/▼ cost | Toast with effect translation | `newspaper*` | `vo_news_major` | Auto-pause (default) |
| 26 | Minor news | Info/Notable | City tint pulse (brand shift) | Ticker | `notify_info` | — | — |
| 27 | Loan approved | `takeLoan` | Bank pulses; "+$3.0M" at HQ | Success | `loan_approved*` | `vo_loan_approved` | — |
| 28 | Loan payment missed | finance event | Red pulse at bank | Critical | `alert_critical*` | `vo_loan_missed` | Auto-pause |
| 29 | Credit rating change | quarterly | Rating badge flips (A− → A) | Success/Warning | `rating_up*` / `rating_down*` | on down only | — |
| 30 | IPO completed | IPO wizard done | Exchange bell animation; ticker tape across the HUD; confetti | SHARE chip appears | `ipo_bell*` + music swell | `vo_ipo` | — |
| 31 | Dividend paid | finance event | Coins flow from HQ | Info | `coins*` | — | — |
| 32 | Low runway | runway < 3 months | — | Cash chip amber pulse (1 Hz for 3 s) | `heartbeat_soft*` | `vo_low_runway` once per episode | — |
| 33 | Negative cash / insolvency | cash < 0 at close | City desaturates 20% | "INSOLVENT IN N MONTHS" badge | `alert_critical*` | `vo_cash_negative` | Auto-pause |
| 34 | Goal achieved | latched | Fireworks at HQ | Goal card check animation; gold banner | `goal_achieved` | goal-specific or `vo_goal_generic` | Auto-pause (default ON) |
| 35 | Upgrade completed | `UpgradeBuilding` ok | Building grows; new signage | Success | `upgrade` (exists, unused today) | first time | — |
| 36 | Demolished | command | Collapse into a dust cloud | "Refund $X" popup | `demolish*` | — | — |
| 37 | Scenario won | all goals | Camera orbit of your buildings (6 s); confetti | Debrief modal | `victory_fanfare` + `victory_theme` | `vo_victory` | Pause |
| 38 | Scenario lost | insolvency / deadline | City lights dim | Debrief modal | `defeat` | `vo_defeat_*` | Pause |

**Music direction** (for the audio workstream):
- At least 3 calm "operations" loops of ≥ 3 min, rotated (today one 2-minute loop plays for hours).
- An **intensity layer** crossfades in when any warning-or-worse condition is active (contested market with a share drop, runway < 3 months); a **triumph sting** plays on goal and record events.
- A city ambience bed (traffic, harbour, birds) is mixed by camera height.
- VO ducks music by 10 dB (as SoundManager does today: −8 → −18 dB).
- Remove the per-month `month_tick` metronome. The month close sound replaces it.

---

## 9. Voice-over line list (advisor persona; ≤ 20 words each)

The existing 10 lines are kept. Note that `vo_tutorial_complete` is transcribed as "…you are a **magnet**", so re-record it with the pronunciation of "magnate" fixed. New lines:

| id | Trigger | Line |
|---|---|---|
| vo_t1_intro | Briefing | "Six million dollars and one city. Let's turn it into a company worth ten." |
| vo_t1_city | Flyover | "Metropolis: half a million people. The glowing districts are where thirsty customers live." |
| vo_t1_build | Build step | "Pick a busy plot. Land costs more downtown, but traffic is what fills a shop." |
| vo_t1_speed | Construction | "Construction takes time. Speed things up while the crane works." |
| vo_t1_price | Setup | "Price inside the green band. Too cheap wastes margin; too high sends shoppers away." |
| vo_first_sale | First profitable close | "Doors open, tills ringing. That's our first profitable month." |
| vo_t1_readstore | Read store | "Sold against demand: if those numbers ever split, we ran out of stock." |
| vo_rival_enters | Rival enters | "Trouble. LocalCo just opened across the street, and they're cheaper." |
| vo_t1_sharedrop | Share drop | "We lost a third of our customers. We can cut price, advertise, or wait." |
| vo_t1_advertise | Advertise step | "Advertising builds awareness month by month. Stop paying and it slowly fades." |
| vo_brand_milestone | Brand ≥ 30 | "People are starting to recognise our name." |
| vo_t1_books | Reports | "Revenue is vanity. Look at net income, and at the cash stuck on our shelves." |
| vo_t1_loan | Loan step | "Borrowing is fine if the new business earns more than the interest." |
| vo_t1_expand | Expand | "Same store, new line. More products share the same rent." |
| vo_t1_almost | G6 ≥ 90% | "Almost there. Keep the shelves full and the brand warm." |
| vo_victory_t1 | Chapter done | "Ten million. You've built a real company. Next, we make our own products." |
| vo_record_month | Record month | "Best month we've ever had." |
| vo_stockout | Stock-out | "We ran out of stock and turned customers away. Raise the stock level." |
| vo_below_cost | Below cost | "We're selling below cost. Every sale loses money." |
| vo_price_war | Undercut | "They've undercut us. Match them, outspend them on brand, or pick another market." |
| vo_overtake | #1 share | "We're now the market leader here." |
| vo_campaign_first | First campaign | "Campaign's live. Watch the billboards." |
| vo_brand_household | Brand 70 | "We're a household name in this city." |
| vo_tech_up | First tech level | "The lab delivered. Our product just got better than theirs." |
| vo_patent | Patent | "Patent granted. For two years, nobody can out-research us on this." |
| vo_patent_blocked | Blocked | "A rival's patent is blocking our research. License it, or work on something else." |
| vo_news_major | Major news | "Big news. Check how it hits our costs." |
| vo_loan_approved | Loan | "The bank said yes. Put it to work." |
| vo_loan_missed | Missed payment | "We missed a loan payment. The bank is not amused." |
| vo_ipo | IPO | "We're public! The market now votes on us every day." |
| vo_low_runway | Runway < 3 months | "At this burn rate we're out of cash in under three months." |
| vo_cash_negative | Cash < 0 | "We're overdrawn. Six months like this and it's over." |
| vo_goal_generic | Goal | "Objective complete." |
| vo_deadline_12 | 12 months left | "One year left on the clock." |
| vo_deadline_3 | 3 months left | "Three months to go. Make them count." |

Templated lines are also referenced in §8: `vo_building_first_<category>` (retail, factory, farm, mine/well, warehouse, R&D, media, seaport), `vo_milestone_<1m|10m|100m|1b>`, `vo_upgrade_first`, `vo_tech_max`, and the existing `vo_defeat_*`.

Subtitles are always available. The voice frequency setting (§6.18) filters to Critical, goals and tutorial when set to "Important only".

---

## 10. Parity checklist (old → new) and acceptance tests

| Godot feature | Web location | Acceptance test |
|---|---|---|
| Title: New/Load/Quit + showcase + welcome VO | Title (+ Continue, Settings) | Continue loads the newest save in ≤ 3 s; welcome VO once per session |
| ScenarioPicker (filter, stars, spectator) | New Game browser + Briefing | Every card shows deadline, goals, rivals, start cash; authored difficulty; spectator toggle kept under "Advanced" |
| SaveBrowser preview | Load screen | Preview without loading the world; corrupt file shows an error card, not a crash |
| HUD metrics (cash, NI, assets, buildings, rival, brief, goal tip) | HUD + Goals tracker + Advisor | "Buildings" counts own only; rival shown via the Rivals rail; one Value metric |
| Play/Pause, Advance 1 month, 3 speeds | Speed control (4 speeds + skip + step) | Space and 1–4 work in any panel; `.` steps exactly one month |
| NewsTicker | Bottom ticker + News (N) | Clicking an item locates it on the map |
| Toasts (NI flip, low cash, headlines, goals) | Alerts policy §6.21 | Day-one losses warned; runway warnings; ≤ 3 on screen |
| Win/Lose modal | Debrief | Shows the same Value number as the goals; loss explains the cause |
| Manage › Build (+ Starter Investments) | Build mode + Confirm presets ("Quick start" = recommended plots with presets) | Build in ≤ 4 interactions; no default can bankrupt in month 1 |
| Manage › Buildings | Company (M) table + inspector | Sort and filter; level-aware capacity; bulk price/stock |
| Manage › Campaigns | Marketing (K) + inspector "Advertise" | Pre-filled product and city; warns on no-store campaigns |
| Manage › Patents | R&D (T) › Patents | Grant/revoke; royalty estimate |
| BuildingInspector (P&L windows, inventory, auto-export, slots, add slot, workforce) | Inspector tabs | Units sold and lost visible; upgrade button; add/remove unit |
| SlotEditor | Inspector › Layout | Mouse and keyboard; arrows reflect volumes and starvation |
| Reports (7 tabs) + FinancialStatements (3 tabs) + StatsDashboard + ReplayViewer | Reports (R) tabs | Cash flow reconciles to Δcash including upgrades and royalties; history persisted in saves |
| MarketIntel (grid, leaderboard, sparkline, Top 3) | Markets (I) | Unserved markets shown; realised share; deep links to Build and Marketing |
| CityMap (cards, modes, detail) | 3D city + overlays + city switcher | Owners / Profit / Brand / Demand overlays; click building → inspector |
| ResearchTree | R&D (T) | Mouse picking; ETA; start research from here |
| ActivityFeed (9 filters, search) | News & Events + Ledger explorer | Same 9 filters + search; virtualised to 10k rows |
| HelpOverlay + Tutorial handbook | Encyclopedia (F1) + Controls (?) | Mechanics text generated from constants; no statement contradicted by a test |
| GuidedTutorial overlay + VO | Tutorial system §6.17 | Persists across panels; VO once per step; latched goals |
| SaveMenu (save, rename, delete, sort, autosave badge, Ctrl+S) | Save/Load modal | Quick-save never overwrites another game; load resets presentation flags |
| SoundManager (music crossfade, SFX pool, VO ducking, mute API) | Web Audio engine + Settings | Five volume sliders + mute; ducking −10 dB |
| Tooltip / Notifications / ScorePopup frameworks | Design-system components | Popups world-anchored; tooltip delay 400 ms |
| **Dropped:** demo scenes; debug "N ledger entries" label; Esc-to-title; duplicate IS/BS screens; alphabetical defaults | — | — |

---

## 11. Regression tests to add to the engine suite (from this playtest)

Turn the harness experiments into xUnit tests, so the economics fixes are measurable and don't regress:

1. `Tutorial_FollowingSuggestions_WinsBetweenMonth(24, 36)` and `Tutorial_Passive_NotBeforeMonth(48)`, once §5 P0 lands.
2. `Advertising_IncreasesUnitsSold` — same store, with vs without $50K TV, ≥ +10% units by month 6 against a rival.
3. `Price_IsElastic` — at elasticity 0.7, price 1.2× → 5× world price cuts units ≥ 50% (the current engine: 0%).
4. `NoMonopolyWindfall` — an uncontested store priced at 30× world sells < 5% of demand.
5. `DuplicateSlots_DoNotIncreaseShare` (X2).
6. `MarketShareGoal_UsesRealisedSales` (X3) and `DisplayedShare_NotPenalisedBySellOut` (X4).
7. `Upgrade_KeepsBooksClosed` (X9).
8. `Construct_EnforcesGeography` (X5).
9. `AiPrices_StayWithinBand` — all archetype mixes over 120 months keep retail prices within [0.5, 3] × world price (catches TechLeader.cs:170).
10. Content validator rule: `ElapsedMonthsGoal.Months ≤ horizon` for scenarios with an end date (catches four_archetype_melee and tech_titan_clash).
11. Content validator rule: `TopBrandGoal` and `AdCampaignActiveGoal` scenarios must also require a matching retail presence (or the goal types gain a `requiresPresence` flag).

---

## 12. Open questions (need the lead or the user)

1. **Company Value definition.** Options:
   - (a) Book equity = assets − liabilities, with capitalised upgrades, depreciation and land.
   - (b) CapLab-style CV = cash + assets + 10 × trailing-12-month net profit (the client's current `ComputeCorporateValue`).

   Pick one name and one formula for the HUD, goals and debrief. The recommendation is (a) for goals and the HUD, with market cap shown separately after an IPO.
2. **Default pacing.** 12 s per month at 1× is the recommendation (5-year scenario ≈ 12 min uninterrupted). The Godot client used 1 s. Confirm the target session length per scenario (the recommendation is 45–90 min including pauses).
3. **Mid-month commands:** apply at month close (honest, no engine change) vs sub-month ticks (big engine change). The recommendation is month close, with a visible "applies in N days" badge.
4. **Tutorial economics:** start cash $6M with a loan lesson and a $10M goal (proposed) vs keeping the current $15M → $20M.
5. **Rival visibility:** show rivals' cash on the HUD (Godot) or only company value and share (proposed)?
6. **Goal semantics per scenario:** "reach once" vs "hold at deadline". Needs a schema field. Should current scenarios default to "reach once" for share and brand goals?
7. **Advisor persona and cast:** one advisor voice (the existing ElevenLabs "Hope"), or advisor + banker + news anchor?
8. **Spectator mode** ("Let AI drive") won only 2 of the 15 goal scenarios in the playtest (tutorial m6, patent_race m42). Keep it as a sandbox-only observer mode?
9. **Target hardware and browsers** (for ambient agent counts and the default graphics preset): minimum GPU tier and resolution. Is tablet or touch in scope for v1?
10. **Unwinnable scenarios:** fix the content now (horizon +1 or goal −1) in the engine track, or leave it to the scenario rework?

---

## Appendix A — Reproducing the playtest

```bash
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" DOTNET_CLI_TELEMETRY_OPTOUT=1
H=/private/tmp/claude-501/-Users-eddyh-Documents-2026-Games-Capitalism/a9c26f48-ae08-453d-890d-9f203a38e65c/scratchpad/ux-playability/harness
# engine-src/ is a copy of engine/Magnate.Engine (bin/obj excluded) so the project tree is never written.
cd "$H" && dotnet build -c Release && dotnet bin/Release/net8.0/ux-harness.dll all
```

The core loop, for porting into xUnit:

```csharp
var scenario = scenarios["tutorial"];
var (world, player) = ScenarioRunner.Apply(catalog, scenario, seed: 42);
var b = world.Construct(player, new BuildingTypeId("supermarket"), new CityId("metropolis"));
world.ConfigureRetailSlot(b.Id, 0, new ProductId("soft_drink"), 1.80m, 500_000);   // tutorial steps 1–2
for (var m = 1; m <= 360; m++) {
    if (m == 4) world.RegisterAdCampaign(player, new ProductId("soft_drink"), new CityId("metropolis"), AdChannel.TV, 50_000m); // step 4
    world.AdvanceMonth();
    if (ScenarioRunner.EvaluateGoals(world, scenario, player).All(g => g.Achieved)) { /* win month = m (58 today) */ break; }
}
```

## Appendix B — File/line index of defects cited

| Defect | Location |
|---|---|
| Build defaults $1.80 / 500,000 | `client/scripts/Manage.cs:245,249`; `BuildingInspector.cs:852,857` |
| Alphabetical defaults (city, type, product, campaigns) | `Manage.cs:229, 324-328, 364-372, 797-827` |
| HUD buildings counts all companies | `Main.cs:646` |
| Rival = first AI only | `Main.cs:636, 987-995` |
| Step counter | `Main.cs:751` |
| NI-flip-only toast; one-shot low cash | `Main.cs:821-849` |
| Win requires simultaneous goals; bankruptcy and deadline rules | `Main.cs:903-923`; `GameState.cs:186-187` |
| End-screen CV formula | `Main.cs:935`; `GameState.cs:200-213` |
| Esc discards the game | `Main.cs:477-478` + `TitleScreen.cs:52` (`GameState.Clear()`) |
| Month-tick metronome | `Main.cs:815` |
| No units sold | `BuildingInspector.cs:771` |
| Wrong auto-export tooltip | `BuildingInspector.cs:594-597` |
| MaxUnits vs level capacity | `Manage.cs:694,718`; `BuildingInspector.cs:626,829` |
| Quick-save overwrites latest manual save | `SaveMenu.cs:433-438` |
| Cash flow omits upgrades and royalties | `FinancialStatements.cs:483-505` |
| Handbook inaccuracies | `Tutorial.cs:48-50, 61-67, 75-80, 87-89, 110-115, 134` |
| Guided overlay only in Main; VO replay | `Main.cs:144`; `GuidedTutorial.cs:98-106, 171-180` |
| Fixed category demand; per-slot softmax entries | `engine/Magnate.Engine/Simulation/MonthlyTick.cs:308-418` (esp. 314, 349-360, 368-396) |
| Share from post-tick inventory quality | `World.cs:949-978` (966) |
| Construct ignores geography and land | `World.cs:95-113` |
| Building value ignores upgrades | `World.cs:927-931` |
| Goal metrics | `Scenarios/Goal.cs:32, 54, 86, 100` |
| TechLeader per-unit floor uses total cost; 1.3× max premium | `Ai/TechLeader.cs:170-181, 327` |
| Simple AI restock sizing | `Ai/SimpleRetailerStrategy.cs:83-84` |
| Unwinnable scenarios | `content/scenarios/four_archetype_melee.json` (84 m vs 2032-12), `tech_titan_clash.json` (60 m vs 2030-12) |
