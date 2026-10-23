# Phase 3.23 — VerticalIntegrator AI strategy

Status: **green**. 159 tests passing (+7 since Phase 3.22 baseline of 152; 5 new VerticalIntegrator tests plus increments from parallel sprints).

## What shipped

- `engine/Magnate.Engine/Ai/VerticalIntegrator.cs` — second AI archetype that owns its entire supply chain. Builds retailer → factory → raw extractor in sequence, reusing the undercut-with-wholesale-floor pricing from AdaptiveStrategy (snippets copied, not inherited — keeps the file self-contained and tunable).
- Two new `AiAction` variants live alongside the strategy:
  - `BuildProducerAction` — constructs a factory or extractor and configures slot 0 in one shot (factory when `IsExtraction=false`, extractor otherwise).
  - `ConfigureRetailSlotAction` — adds a retail slot to an existing building without rebuilding, so step 4 (fill adjacent slots) is cheap.
- `engine/Magnate.Engine.Tests/VerticalIntegratorTests.cs` — 5 tests: builds-retailer-first, builds-factory-after-retailer, full-chain-eventually (24 months, $100M), contested-markets-only advertising, and seeded determinism.

## Expansion algorithm (one action per month)

1. No retailer yet → build supermarket in the biggest unserved finished-goods market (same opportunity scan as AdaptiveStrategy).
2. Retailer exists → pick the "flagship" (retailed product × city with largest demographic demand). If no factory produces that finished product, build one in the flagship city (`factory_small` until cash > $15M, then `factory_large`).
3. Factory exists → walk the recipe one level: raw inputs get an extractor (mapping: `farm→small_farm`, `plantation→small_plantation`, `mine→iron_mine`, `oil_well→oil_well`), intermediates get their own factory, and we recurse once so a plastic-needing chain gets plastic factory → oil well. Geography is respected — if the flagship city can't host the extractor we fall back to the first geography-matching city in ordinal order.
4. Full chain satisfied → fill adjacent retail slots on an existing supermarket (up to MaxUnits=6), else expand to the next biggest unserved market and repeat.

## Pricing + ads

Pricing uses the same undercut / wholesale floor math as Adaptive. Ads are deliberately dumber per the brief: a single flat-budget TV campaign per contested (city, product) where we retail, no cash-cushion gate (VI is already capital-heavy by design).

## Friction / adaptations

- **No pre-existing action for non-retail construction.** The existing `AiAction.cs` only had `BuildRetailerAction`, `AdjustRetailPriceAction`, `BuildResearchCenterAction`, and `SetAdCampaignAction`. Rather than modify that file (ambiguous with the "don't touch" list), I colocated the two new records with the strategy. They live in the `Magnate.Engine.Ai` namespace and extend the same `AiAction` base record, so dispatch works transparently.
- **Sourcing is automatic.** `MaterialProcurement.PullFromOwnSources` pulls from any same-owner building with a matching production/extraction slot, so no explicit `ConfigureSourcing` call is needed — just building the producer in the same owner is enough for the retailer to consume in-house output.
- **xUnit analyzer** forced `Assert.DoesNotContain(...)` over `Assert.Empty(...Where(...))`. Cosmetic.
- **XML-doc paramref** on a record forces an existing parameter; I scrubbed the inherited "by `actor`" phrasing from `ConfigureRetailSlotAction` (records have no `actor` arg — that's the execution context).

## Verification

```
dotnet build  → 0 errors, 0 warnings
dotnet test --filter "FullyQualifiedName~VerticalIntegrator" → 5 passed
dotnet test (full) → 159 passed, 0 failed
```
