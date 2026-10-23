# Phase 2.5 — Advertising & brand awareness

**Goal**: close the Q/B/T triad. Phase 2.2 plumbed brand awareness into demand allocation but nothing ever grew it. Phase 2.5 adds ad campaigns that build brand with diminishing returns, and natural decay when the company stops advertising.

## Delivered

### `AdChannel` + `AdCampaign`

```csharp
enum AdChannel { TV, Newspaper, Magazine }

class AdCampaign {
    CompanyId Company;
    ProductId Product;
    CityId    City;
    AdChannel Channel;
    decimal   MonthlyBudget;
}
```

Campaigns are unique per `(Company, Product, City, Channel)` tuple — a company can stack multiple channels in the same market.

### Cost and dynamics

Cost per brand-point (the dollar amount needed to lift brand awareness by 1 percentage point, ignoring saturation):

| Channel | Cost / point |
|---|---|
| TV | $4,000 |
| Newspaper | $6,000 |
| Magazine | $8,000 |

**Brand lift formula** per month:
```
lift          = (budget / costPerPoint) × (1 - brand/100)     // saturation
newBrand      = min(100, brand + lift)
```

**Decay** for any `(company, product, city)` without an active campaign this tick:
```
newBrand = brand × (1 - BrandDecayRate)   // 2% per month
```

Brands below 0.1 are pruned from the map to keep iteration lean.

### `World` API

```csharp
AdCampaign RegisterAdCampaign(company, product, city, channel, monthlyBudget)
bool       CancelAdCampaign(...)
AdCampaign? GetAdCampaign(...)
IEnumerable<AdCampaign> AdCampaigns { get; }

internal void ApplyMonthlyAdvertising();   // called by MonthlyTick
```

Registering with `monthlyBudget = 0` removes the campaign (idiomatic cancel).

### Pipeline — step 3

```
opex → research → advertising → extraction → production(intermediates) →
production(finished) → restock warehouses → restock retailers →
demand allocation → auto-export surplus
```

Advertising runs **before** demand allocation so brand lifts apply the same month they're paid for.

### Ledger + reports

- **New `LedgerCategory.AdvertisingCost`** — cash outflow, period expense (opex in `IncomeStatement`, NOT capitalized to inventory).
- **`ProductProfitability` gains `MarketingCost`** and the derived `NetMargin = Revenue − Cost − MarketingCost`. `GrossMargin = Revenue − Cost` preserved. The per-product P&L table in the cockpit now has a Marketing column.

### Tests (10 new — total 88 passing)

Registration / state:
- `RegisterAdCampaign_rejects_negative_budget`
- `Zero_budget_removes_the_campaign`

Monthly mechanics:
- `Active_campaign_charges_budget_each_month`
- `Active_campaign_raises_brand_awareness` ← exact saturation math: $100k TV on Q=0 gives 25; next month lands on 43.75
- `Brand_awareness_saturates_at_100_no_matter_how_much_spending` ← even $10M/mo never exceeds 100
- `Brand_awareness_decays_when_no_campaign_active` ← 50 → 49 after one month
- `TV_is_more_cost_efficient_than_magazine_per_dollar`

Reporting:
- `Ad_spend_reports_as_marketing_cost_on_product_profitability`
- `Equity_still_equals_starting_plus_net_income_with_ads_running` ← books-close invariant preserved

Demand effect:
- `Advertising_company_wins_more_share_at_equal_price` ← $200k/mo × 6mo on TV yields >30% sales lead

### Cockpit demo

Acme now stacks **R&D + TV advertising** on soft_drink. After 12 months:

| | Phase 2.3 (R&D only) | Phase 2.5 (R&D + $100k TV/mo) |
|---|---|---|
| Acme Metropolis brand | 0 | **96.8** |
| Acme Riverside brand  | 0 | **0** (ads are per-city) |
| Acme soft_drink revenue | $54.82M | **$62.21M** |
| RivalCo soft_drink revenue | $43.23M | **$36.22M** |
| Ad spend (12mo) | — | $1.2M |
| Acme NetIncome | $13.45M | $13.59M |
| Books close (Equity = SC + NI) | ✓ | ✓ |

The $1.2M ad spend returns ~$7M in extra soft_drink revenue — net income only edges up because the incremental gross profit has to cover the ad cost, but the share shift is decisive (Acme's soft_drink desirability goes from `(50+50+0)/3 = 33` to `(50+50+97)/3 = 66`, while RivalCo stays at `(50+10+0)/3 = 20`).

## New invariants

20. **Brand awareness is bounded [0, 100] always.** Lift saturation prevents exceeding 100; decay rounds small values to 0 to avoid dust.
21. **Ad spend is a period cost, never capitalized.** `AdvertisingCost` entries appear in `IncomeStatement.OperatingExpenses` and `ProductProfitability.MarketingCost`, never in COGS or inventory cost basis.

## Out of scope (future)

- **Media buildings** (TV station, newspaper, magazine) as operating businesses you can own, run, and sell ad slots from. Ads currently go "on the open market" — analogous to retailers buying stock from the world market before Phase 1.3.
- **Demographic targeting** — Phase 2.5 MVP doesn't differentiate channels by income bracket. Magazine should ideally give disproportionate lift on luxury products for high-income buyers.
- **Multi-month campaign planning** (reach/frequency curves).
- **Brand awareness's effect on pricing power** — currently brand only lifts demand share, not willingness-to-pay; a premium-brand effect would let a company charge more with less share erosion.
- **Ad-campaign AI** — `SimpleRetailerStrategy` doesn't buy ads. An advertising AI personality is Phase 2.4+.

## Files

Added:
- `engine/Magnate.Engine/Simulation/AdCampaign.cs` (enum + class)
- `engine/Magnate.Engine.Tests/AdvertisingTests.cs`
- `docs/plan/phase-2.5-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/SimulationConstants.cs` (ad costs per channel + decay + channel-lookup)
- `engine/Magnate.Engine/Economics/Ledger.cs` (new `AdvertisingCost` category)
- `engine/Magnate.Engine/Economics/ProductProfitability.cs` (adds `MarketingCost`, `GrossMargin`, `NetMargin`)
- `engine/Magnate.Engine/Simulation/World.cs` (campaign storage + APIs + `ApplyMonthlyAdvertising`; profitability includes marketing; income statement counts advertising as opex)
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs` (calls `ApplyMonthlyAdvertising` after research)
- `tools/MagnateSim/Program.cs` (TV campaign in scenario + Marketing column in P&L table)
