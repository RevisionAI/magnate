# Phase 2.3 — R&D

**Goal**: give tech a way to actually diverge. Phase 2.2 plumbed Q/B/T into demand allocation but all companies ran at baseline. Phase 2.3 adds the R&D mechanic that pushes tech up for specific (company, product) pairs.

## Delivered

### Content

- New building type `rd_center` in `content/data/buildings/rd.json`: $3M construction, $50k/mo opex, 3×3 footprint, up to 4 research slots, 10-40 staff.

### Simulation — `ResearchSlot`

```csharp
class ResearchSlot {
    int Index;
    ProductId Product;       // target of this slot's research
}
```

Attached to `BuildingInstance.ResearchSlots` alongside the existing production/extraction/warehouse/retail slot lists.

### `World` — research state and progression

```csharp
int    GetTech(CompanyId, ProductId)                    // (existing; still defaults to BaseTechLevel=1)
double GetResearchProgress(CompanyId, ProductId)        // NEW — current points toward next level
void   ConfigureResearchSlot(BuildingId, slot, Product) // validates category == rd_center
internal void AddResearchPoints(CompanyId, ProductId, points)
```

`AddResearchPoints` accumulates points, consumes the threshold to auto-advance tech (level N→N+1 needs `100 × N` points), and rolls any overflow into the next level. Caps at `MaxTechLevel` with zero overflow.

### Pipeline — new `RunResearch` step

The monthly tick now has **9 steps**:

```
opex → research → extraction → produce(intermediate) → produce(finished) →
restock warehouses → restock retailers → demand allocation → auto-export surplus
```

`RunResearch` iterates every building's research slots and calls `AddResearchPoints(owner, product, 100)`. Same point flat rate per slot; R&D-center opex already covers the "cost" of research as a period expense.

### Progression curve (at one slot)

| Level jump | Points needed | Months with 1 slot |
|---|---|---|
| 1 → 2 | 100 | 1 |
| 2 → 3 | 200 | 2 |
| 3 → 4 | 300 | 3 |
| 4 → 5 | 400 | 4 |
| 5 → 6 | 500 | 5 |
| … | … | … |
| 7 → 8 (max for soft_drink) | 700 | 7 |

Reaching max tech for a product from scratch with one slot takes ~4 years. Two slots halve that. Constants tunable in `SimulationConstants`.

### Tests (8 new — total 78 passing)

Configuration / building rules:
- `ConfigureResearchSlot_rejects_non_rd_buildings` — only R&D centers
- `ConfigureResearchSlot_succeeds_on_rd_center`

Progress + level-up mechanics:
- `One_month_of_research_with_one_slot_reaches_level_two` — threshold math check
- `Progress_accumulates_between_level_ups` — partial progress toward level 3
- `Multiple_slots_advance_tech_faster` — 2 slots × 2 months = level 3 + 100 progress
- `Tech_caps_at_max_and_progress_zeros_out` — no overflow above MaxTechLevel
- `Different_companies_research_progress_independently` — isolation

Effect on demand:
- `Researched_company_eventually_wins_share_on_tech_alone` — 10 months of R&D with equal price + quality yields >30% sales lead

### Cockpit demo

Acme now builds an R&D center in Metropolis and configures a research slot for `soft_drink`. Over 12 months:

- Tech reaches level **5 / 8** (progress 200/500 toward 6)
- Acme soft_drink revenue **$47.77M → $54.82M** (+15%) despite unchanged price
- RivalCo soft_drink revenue **$49.93M → $43.23M** (-13%) — share transferred to Acme
- Net income $13.45M (vs $12.74M in Phase 2.2) — R&D opex more than paid for

Per-company summary now shows tech level + progress toward the next level.

## New invariant

19. **Tech advances monotonically via research.** `AddResearchPoints` only goes up; tech only goes up. Points consumed to level up are released from progress via threshold subtraction. Overflow carries into the next level's progress until the max is reached, after which progress is capped at zero.

## Out of scope (future)

- **Scientists**: no individual workforce with skill levels. Research rate is a flat slot rate.
- **Project budgets**: no configurable funding; you either have a slot or you don't.
- **Patents**: no exclusivity window or licensing income (Capitalism Lab extras).
- **Tech's effect on production quality**: currently tech only affects demand allocation's perceived-value score. A natural extension is making a factory's tech boost the Q of its produced output.
- **AI research**: `SimpleRetailerStrategy` is pure retailer and doesn't build R&D centers. A research-capable AI personality is Phase 2.4+.

## Files

Added:
- `content/data/buildings/rd.json`
- `engine/Magnate.Engine.Tests/ResearchTests.cs`
- `docs/plan/phase-2.3-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/SimulationConstants.cs` (2 new research constants)
- `engine/Magnate.Engine/Simulation/BuildingInstance.cs` (adds `ResearchSlot` class + `ResearchSlots` list)
- `engine/Magnate.Engine/Simulation/World.cs` (research progress state, `ConfigureResearchSlot`, `GetResearchProgress`, `AddResearchPoints`)
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs` (new `RunResearch` step)
- `tools/MagnateSim/Program.cs` (R&D center in scenario + progress display)
