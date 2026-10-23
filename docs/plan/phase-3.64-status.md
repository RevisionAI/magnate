# Phase 3.64 — Visual Slot Editor (read-only v1)

**Goal.** Deliver Magnate's signature node-graph view: a single building's
inputs flowing left → production slots in the middle → distribution outputs on
the right, with cubic-bezier arrows connecting them. Read-only: clicks /
Enter on a slot card return to BuildingInspector for edit; no drag-drop wiring.

## Scene structure (`client/scenes/SlotEditor.tscn`)

```
SlotEditor (Node, script SlotEditor.cs)
└── Panel
    └── VBox
        ├── Header (HBox)
        │   ├── BackButton ("← Back")
        │   └── TitleLabel  ("Building · City")
        ├── SubLabel        ("OWNER · LEVEL N · X/Y SLOTS USED · date")
        ├── Body (HSplitContainer)
        │   ├── Scroll (ScrollContainer)
        │   │   └── Canvas (Control → swapped to SlotCanvas in _Ready, the
        │   │              same trick ResearchTree uses to attach a custom
        │   │              _Draw subclass while keeping the .tscn path stable)
        │   └── Inspector (PanelContainer, ~280px)
        │       └── InspectorMargin → InspectorVBox
        │           ├── InspectorTitle (Label)
        │           └── InspectorBody  (RichTextLabel, BBCode)
        └── HintLabel       ("←/→ column · ↑/↓ row · Enter edit · Esc back")
```

## Arrow rendering

`SlotCanvas._Draw` mirrors `ResearchTree.ResearchCanvas._Draw` exactly:
20-step polyline of a cubic Bezier with horizontal tangents (`dx = max(40,
|to.x − from.x| × 0.5)`), plus a 9px / 5px arrowhead. SlotEditor builds an
`EdgeInfo` list each Refresh — half 0 = input→slot, half 1 = slot→output —
each carrying `(From, To, Thickness, Half, LeftIndex, SlotIndex,
RightIndex)`. Thickness scales `1.5 + 0.5·log10(units/mo)` clamped to
[1.5, 4.5]. An edge is highlighted gold (`#F0C050`, +1px) when the selected
card sits at one of its endpoints.

## Layout & data sources

Three fixed columns at x = 80 / 480 / 880, cards 280×100, vgap 16. Inputs are
distinct `Recipe.Inputs` ProductIds across every middle-column slot, ordered
by `ProductId.Value` (ordinal). Source labels mirror `MaterialProcurement`
order: own producer/extractor (same city preferred) → own warehouse → world
market (amber tint). Outputs: each retail slot → in-store sales card; each
production/extraction slot → own-retailer card if found, plus a world-market
export card when `building.AutoExport` and tier ≠ Finished. Throughput uses
`Recipe.OutputQuantity × CyclesPerSlotPerMonth` (production), `Extraction.
YieldPerSlotPerMonth` (extraction), or `RestockTarget` / `TargetStock`
(retail / warehouse).

## Keyboard nav

`_selectedColumn ∈ {0,1,2}` × `_selectedIndex` within the column.
- ←/→: move column, picking the row whose Y is closest to current.
- ↑/↓: move within column, clamped.
- Enter / KpEnter: `ChangeSceneToFile("res://scenes/BuildingInspector.tscn")`
  (carries `GameState.SelectedBuilding`).
- Esc / Back: BuildingInspector if a building is selected, else Main.

Selected card gets a 3px gold border (the tier color is stashed via
`SetMeta("tier", ...)` so re-styling round-trips correctly).

## Visual description (matches mockup)

Dark navy canvas with three column headers in gold caps. Tier-bordered cards
(green/amber/blue) flow left to right; arrows curve cleanly in the gaps,
thickening with throughput. The inspector pane on the right shows recipe
details for the highlighted card: tier, unit, world price, recipe inputs/
output qty, cycles/month, monthly throughput, and "Press Enter to edit this
slot in BuildingInspector". Empty states render placeholder text (no slots,
no building, missing world).

## Integrator wiring (NOT done by this agent)

Pick one path:
1. **BuildingInspector hookup** — add a `Button { Text = "Visual Editor" }`
   in `BuildingInspector.cs` near BackButton; on press,
   `GetTree().ChangeSceneToFile("res://scenes/SlotEditor.tscn")`. Player's
   already-selected building carries through `GameState.SelectedBuilding`.
2. **Main HUD** — add a "Slot Editor (V)" button + `Key.V` handler that
   guards on `GameState.SelectedBuilding is not null` then changes scene.

## Verification

- `dotnet build engine/Magnate.Engine` — clean (0/0).
- `dotnet test engine/Magnate.Engine.Tests --no-build` — **219/219 passing**.
- Full-solution `dotnet build` reports 3 errors in sibling parallel agents'
  `Notifications.cs` / `ScorePopup.cs` (`Engine.GetMainLoop` namespace clash
  with `Magnate.Engine`); my two files surface zero diagnostics. Headless
  Godot boot intentionally skipped per phase brief.
