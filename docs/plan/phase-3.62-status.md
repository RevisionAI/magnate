# Phase 3.62 — Patent licensing UI (Manage → Patents tab)

## Scope

Expose the Phase 3.49/3.54 patent + licensing engine APIs to the human
player through a new fourth tab in the existing Manage scene. Players can
now grant and revoke licenses without editing scenarios or saves; rival
patents are surfaced as read-only informational rows.

## Tab layout

Two sections rendered into a single ScrollContainer/VBox host
(`Panel/VBox/Tabs/Patents/PatentsList`). The tab is torn down and rebuilt
on every tick via `RefreshPatentsTab(World)` (called from `_Ready` and
from the month-boundary branch of `_Process`, matching the Reports.cs
live-tick pattern used elsewhere in Manage).

- **Section A — "Your Patents (You Hold)"**: one `PanelContainer` per
  active patent held by `GameState.PlayerId`. Each row shows product id,
  `ExpiresAt`, and months-remaining (`ExpiresAt.AsMonthIndex() − now`),
  a licensee sub-list where each entry has a `Revoke` button, and a
  `Grant License` form (`OptionButton` of eligible competitors + Grant
  button). Candidates are `world.Companies.Values` minus the holder and
  any already-licensed company; the form is omitted when none remain.
- **Section B — "Patents Held by Competitors"**: one panel per rival
  patent with holder company name, product, expiry, months left, and a
  coloured status line — green "License granted ✓" if the player appears
  in `GetPatentLicenses()` for that (holder, product), otherwise amber
  "Not licensed ✗". A hover tooltip explains that the relationship is
  one-way (only the holder grants) and that R&D is blocked until expiry.

Empty-world fallback: a single BBCode `[i]…[/i]` line pointing at the
Tech-Level-Max requirement.

## Grant/Revoke flow

Both `OnGrantPatentLicense` and `OnRevokePatentLicense` wrap the World
API in try/catch. On success they call `SetStatus(..., isError:false)`
with the licensee's display name and refresh the tab. On
`InvalidOperationException` (no active patent, expired, wrong holder,
self-license) the message is surfaced in the existing status label in
red via `SetStatus(..., isError:true)` — no crash, no stack bubbling to
Godot.

## Tooltips

Wired on every dynamic control per the Phase 3.56 pattern (attach-at-
render, since rows are recreated each tick): patent header label,
Revoke buttons, Grant `OptionButton` and button, and the rival status
line. The existing `WireTooltips()` static-control hookup is untouched.

## Integration notes

Scene-side: added a `Patents` ScrollContainer under the existing
`TabContainer` with a pre-seeded `PatentsList` VBox child. The TabContainer
auto-discovers the new child tab by Godot 4 convention. No Owner set on
runtime-created nodes per project style.

## Verification

Pre-existing engine build error in `Magnate.Engine/Domain/BuildingType.cs`
(XML doc on a positional record parameter — CS1587) blocks
`dotnet build` repo-wide; outside this phase's file ownership. Manage.cs
only calls the documented public World APIs (`GetActivePatents`,
`GetPatentLicenses`, `GrantPatentLicense`, `RevokePatentLicense`,
`Companies`), so the UI compiles as soon as that unrelated engine issue
is resolved.
