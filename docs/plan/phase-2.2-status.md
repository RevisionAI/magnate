# Phase 2.2 — Q / B / T attributes

**Goal**: put the Capitalism-Lab-signature triple — Quality, Brand, Technology — into the simulation as first-class state, and replace pure inverse-price demand allocation with a perceived-value softmax that combines them with price.

## Delivered

### `SimulationConstants` — baselines

```csharp
WorldMarketQuality  = 50.0   // 0-100 Q for generic market goods
ExtractionQuality   = 50.0   // 0-100 Q for own-extracted raws
BaseTechLevel       = 1      // 1..MaxTechLevel until R&D advances it
BaseBrandAwareness  = 0.0    // 0-100 until advertising grows it
```

### `Inventory` — now tracks quality

Weighted-average Q alongside WAC cost. Each stored entry is `(Qty, Cost, QualityMass)` where `QualityMass = Σ (Q × qty)` across blended batches. `AverageQuality = QualityMass / Qty`. Adding and taking preserves the blend proportionally — same shape as cost handling.

```csharp
record struct InventoryDraw(double Quantity, decimal Cost, double AverageQuality);
void Add(ProductId p, double qty, decimal cost, double quality);
InventoryDraw Take(ProductId p, double qty);
double AverageQuality(ProductId p);
```

### `MaterialProcurement` — quality flows with goods

- **Own-source pulls**: quality of the draw goes straight into destination inventory at the same Q.
- **Market buys**: goods enter at `WorldMarketQuality = 50`.
- **Inter-city shipping**: capitalized into cost but doesn't change quality.

### `MonthlyTick` — production rolls Q

- **Extraction**: raws enter inventory at `ExtractionQuality = 50`.
- **Production**: output Q = `Σ (inputQ × inputQty) / Σ inputQty` across consumed recipe inputs. A sugar factory fed 20 units of Q=80 sugarcane produces sugar at Q=80. A drink factory fed 4000 Q=80 sugar + 1000 Q=50 plastic produces soft_drink at Q=74.

### `World` — per-company Tech, per-(company, city) Brand

```csharp
int    GetTech(CompanyId, ProductId)                           // default 1
void   SetTech(CompanyId, ProductId, int level)                // validated against MaxTechLevel
double GetBrandAwareness(CompanyId, ProductId, CityId)         // default 0
void   SetBrandAwareness(CompanyId, ProductId, CityId, double) // 0..100
```

Phase 2.2 uses the setters for tests and cockpit demos; Phase 2.3 (R&D) advances tech naturally, Phase 2.5 (advertising) grows brand.

### Demand allocation — new formula

```
desirability = max((Q + T×10 + B) / 3, 1.0)       // 0-100 composite
weight       = desirability / price^elasticity
share        = weight / Σ weights                  // softmax
```

Where:
- Q = retailer's inventory average quality (0-100)
- T = owner's tech level × 10 (so max-tech = 100, base-tech = 10)
- B = owner's brand awareness in retailer's city (0-100)
- elasticity = product's `PriceElasticity`

With all defaults (Q=50, T=10, B=0 → desirability ≈ 20), the formula degenerates to the old inverse-price split — confirmed by regression test.

### Tests (14 new — total 70 passing)

**Quality plumbing**
- `Inventory_average_quality_is_weighted_by_quantity`
- `Inventory_take_returns_current_average_quality`
- `Market_bought_goods_carry_world_market_quality`
- `Extracted_raws_carry_extraction_quality`
- `Production_output_quality_is_weighted_average_of_inputs` ← blends 4000 sugar Q=80 + 1000 plastic Q=50 → soft_drink Q=74

**Tech + Brand storage**
- `Tech_level_defaults_to_base`
- `Tech_level_cannot_exceed_product_max`
- `Tech_level_rejects_below_one`
- `Brand_awareness_defaults_to_zero`
- `Brand_awareness_rejects_out_of_range`

**Demand allocation behavior**
- `Higher_tech_company_wins_more_share_at_equal_price`
- `Higher_brand_awareness_wins_more_share_at_equal_price_in_that_city`
- `Premium_retailer_can_still_win_when_quality_overcomes_price_gap` ← 30% price premium beaten by full brand + max tech
- `Equal_attributes_and_price_give_equal_shares` ← regression locking the default-case behavior

### Cockpit

New per-company section: **Product positioning — soft_drink** showing tech level and per-city (Q, Brand) for each retailer selling the flagship product. With defaults everywhere the values are flat (Q=50, T=1, B=0) — they'll start diverging once R&D and advertising land.

## What's plumbed, not yet grown

- **R&D**: there's no mechanism in-engine to *raise* tech yet. `SetTech` is a test/cockpit hook. Phase 2.3 adds scientists, projects, and tech progression.
- **Advertising**: similarly no in-engine path to raise brand awareness. Phase 2.5 adds TV/newspaper/magazine campaigns with reach, decay, and per-city effects.
- **Quality competition content**: all goods currently flow to Q=50 because the defaults are equal. Content or R&D needs to introduce variance. Possible early content lever: tie `ExtractionQuality` to a building attribute (a large farm yields higher-Q crops than a small farm).
- **Absorption costing of Q**: like cost, Q is purely input-driven. Factory tech level doesn't yet boost output Q (future R&D hook).

## New invariants

17. **Quality follows goods.** `Inventory` averages quality by quantity across blended batches; `Take` proportionally releases the blend's current average.
18. **Demand is allocated by perceived-value softmax**: `weight = max((Q + T×10 + B)/3, 1) / price^elasticity`. Equal-attribute cases collapse to the old inverse-price behavior.

## Files

Added:
- `engine/Magnate.Engine.Tests/QualityBrandTechTests.cs`
- `docs/plan/phase-2.2-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/SimulationConstants.cs` (4 new constants)
- `engine/Magnate.Engine/Simulation/Inventory.cs` (tracks quality; `InventoryDraw` grows to 3 fields)
- `engine/Magnate.Engine/Simulation/MaterialProcurement.cs` (quality on market buys + internal flow)
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs` (extraction Q, production Q rolling, new demand allocation formula)
- `engine/Magnate.Engine/Simulation/World.cs` (Tech + Brand maps, getters + setters)
- `tools/MagnateSim/Program.cs` (`PrintProductPositioning` — per-city Q/T/B for soft_drink)
