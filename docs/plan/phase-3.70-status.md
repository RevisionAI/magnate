# Phase 3.70 — Reports-screen chrome pass

Applied the game's visual chrome (dark operational backdrop, gold strategic
highlights, blue information accents) to four previously default-grey sub-scenes,
and hardened their null-world empty states. Presentation-only: no simulation,
engine, or behavior changes beyond the styled empty states.

## Scope (files owned)
- `client/scripts/Reports.cs`
- `client/scripts/FinancialStatements.cs`
- `client/scripts/MarketIntel.cs`
- `client/scripts/StatsDashboard.cs`
- (scene `.tscn` files were left structurally untouched — all chrome is applied
  programmatically in `_Ready` so every `GetNode<T>("path")` still resolves.)

## Shared approach
Each scene gained a private `ApplyChrome()` called first in `_Ready()`, mirroring
the established `Main`/`CityMap` pattern:

- `UiChrome.InstallBackdrop(...)` — `operations_room.png` backdrop + dark
  translucent shade under all content.
- Root `Panel` stylebox set near-transparent (removes the default grey fill).
- `InstallShell(...)` — a dark translucent `PanelContainer` framing the content
  column (added behind content, `MouseFilter = Ignore`, so no node paths change
  and no clicks are eaten).
- Gold, enlarged header; muted sub-header.
- `StyleTabs(...)` on `TabContainer` scenes — dark tab panel, gold selected tab,
  stroke/blue unselected/hover, matching font colors.
- `StyleButton(...)` — palette styleboxes (dark normal, blue hover, gold pressed)
  so toggle/nav buttons read as "active = gold-bordered".

Helpers are replicated locally in each file rather than added to `UiChrome.cs`,
which is shared and owned by another agent this phase.

## Per-scene
- **Reports** — chrome + styled 7-tab bar; `markets.png` header accent plate;
  styled Play / Advance / Back. Null-world now writes a friendly styled message
  into every tab + Trends instead of leaving stale/blank content.
- **FinancialStatements** — chrome + styled 3-tab bar; styled period
  `OptionButton`, Play / Advance / Back. Null-world message reworded to the
  standard "start a scenario from the title screen" copy across all three tabs.
- **MarketIntel** — chrome + styled Grid/Top-3 tabs; `markets.png` header accent;
  gold detail-panel header. Dynamically-built Sort / City / Filter toggle buttons
  and the product `OptionButton` now use the palette (active filter shows gold).
  Empty-state labels restyled (muted, wrapped, larger).
- **StatsDashboard** — chrome + framing shell; gold section header + enlarged
  title; styled Back. Null-world header message reworded to standard copy.

## Formatting / QA
- Existing `C0` / `MoneyShort` / green-red conventions left intact.
- Fonts sized for 1600×900; content sits on dark translucent panels for contrast;
  existing `ScrollContainer`s preserved so long content still scrolls.

## Build
- `dotnet build client/Magnate.Client.csproj`: **0 warnings**; **my four files
  produce no diagnostics** (verified by filtering the build output).
- The full assembly does **not** link clean right now due to an unrelated
  in-progress concurrent edit in `Main.cs` (references `EmbedNewsTicker`,
  `OnMonthTicked`, `CheckGoalsAndEndStates` that don't yet exist). That file is
  owned by another agent, not this task.
- Godot boot **unverified** (sandbox cannot run the Godot binary).
