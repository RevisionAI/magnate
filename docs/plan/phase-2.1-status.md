# Phase 2.1 — COGS via weighted-average cost (accrual accounting)

**Goal**: close the per-product P&L gap. Inputs should follow goods through the supply chain; sales should recognize cost basis at point of sale; the books should close (Equity = StartingCapital + cumulative NetIncome).

## Delivered

### `Inventory` rewrite — quantity + cost

```csharp
class Inventory {
    void Add(ProductId, double quantity, decimal cost);
    InventoryDraw Take(ProductId, double quantity);   // returns (Quantity, Cost)
    double Get(ProductId);
    decimal CostOf(ProductId);
    decimal TotalValue();
}

readonly record struct InventoryDraw(double Quantity, decimal Cost);
```

Cost is removed proportionally on `Take`: `costRemoved = (qty / total) × totalCost`. When taking everything, the full cost basis is released exactly (avoids floating-point dust).

### `CogsLog` — accrual side log

```csharp
record CogsEntry(GameDate, CompanyId, ProductId, double Quantity, decimal Cost);

class CogsLog {
    void Record(CogsEntry);
    IEnumerable<CogsEntry> EntriesFor(CompanyId);
    IEnumerable<CogsEntry> EntriesInRange(CompanyId, GameDate, GameDate);
}
```

`World.RecordCogs(...)` is called by `MonthlyTick` whenever goods leave inventory via sale or export. **No cash impact** — the corresponding cash already moved when the goods were originally acquired.

### `MonthlyTick` updates

| Step | Cost behavior |
|---|---|
| Extraction | Adds raws to inventory at **zero cost** (variable costing — opex stays a period cost) |
| Production | Sums cost of consumed inputs → adds output to inventory at that cost |
| Retail restock | Same as before but cost flows from upstream / world price |
| Demand allocation | Records `CogsEntry(qty, cost)` from the inventory draw |
| Auto-export surplus | Same — records COGS for exported goods |

### `MaterialProcurement` updates

Single-pass procurement now **flows cost basis** with goods on internal pulls. For inter-city pulls, the shipping charge is **capitalized into the destination's cost basis** rather than treated as a period expense — it surfaces as part of COGS when the goods are eventually sold.

### Reports rewritten

**`IncomeStatement`** got a third number:
```
Revenue       (ProductSale + ExportSale)
− COGS        (sum of CogsLog entries in range)
= Gross Profit
− OpEx        (OperatingCost only — InputPurchase / RetailRestock / ShippingCost are NOT here anymore)
= Net Income
```

`InputPurchase` / `RetailRestock` / `ShippingCost` / `ConstructionCost` / `StartingCapital` are now correctly classified as balance-sheet movements (cash → asset) rather than P&L hits.

`Ledger.IncomeStatement(...)` removed; replaced by `World.GetIncomeStatement(...)` which can also reach `CogsLog`.

**`BalanceSheet`** inventory is now valued at WAC instead of world-price proxy. The `InventoryValue` now reflects what the company actually paid.

**`ProductProfitability`**: revenue from sales ledger, cost from `CogsLog`. Products that are inputs-only (consumed but never sold) don't appear in the report — their cost is rolled into the finished product they fed.

### New invariant — the books close

15. **`Equity = StartingCapital + cumulative NetIncome`** (with no liabilities). Locked by `Equity_equals_starting_capital_plus_cumulative_net_income` test which runs a 6-month chain scenario and asserts the equation holds within $1 (decimal arithmetic tolerance).

### Tests (6 new — total 56 passing)

- `Self_produced_inventory_carries_only_input_cost_not_market_price` ← validates WAC vs market price
- `Production_rolls_input_cost_into_output_inventory` ← input cost flows into output WAC
- `Cogs_is_recorded_when_goods_are_sold`
- `Income_statement_separates_revenue_cogs_and_opex`
- `Equity_equals_starting_capital_plus_cumulative_net_income` ← the books-close invariant
- `Inter_city_shipping_capitalizes_into_inventory_not_opex`

Plus the existing `Market_bought_inventory_carries_cost_basis_at_world_price` (renamed from the old "valued at world market price" test) clarifies the new WAC semantics.

### Cockpit dramatically clearer

12-month run on the unchanged scenario reveals:

| | Phase 1.6 (cash) | Phase 2.1 (accrual) |
|---|---|---|
| Acme NetIncome | $9.28M | **$12.74M** |
| Acme OpEx | $40.99M | **$0.89M** |
| Acme soft_drink margin | 16.1% | **23.3%** |
| plastic in P&L | -$36k (false loss) | **gone** (rolled into soft_drink) |
| Equity = StartingCap + NI | off by $2.6M | **exact** |

The accrual numbers are higher because some restock cost is now correctly shown as inventory on the balance sheet rather than as an immediate expense. Over time, as inventory cycles, total cumulative NI converges with cash flow.

## Out of scope (Phase 2.2+)

- **Absorption costing** — opex isn't allocated to inventory. Per-unit cost reflects only direct material inputs. For mature games this is fine (variable costing is a real industry approach); we may revisit when adding a labor/wages system.
- **Cash flow statement breakdown** (Operating / Investing / Financing) — we have a cash ledger, but not the statement structure.
- **Inventory write-downs / aging** — slow-moving stock isn't depreciated.
- **Building depreciation** — still at construction cost forever.

## Files

Added:
- `engine/Magnate.Engine/Economics/CogsLog.cs`
- `docs/plan/phase-2.1-status.md`

Modified:
- `engine/Magnate.Engine/Simulation/Inventory.cs` (full rewrite — tracks cost)
- `engine/Magnate.Engine/Economics/IncomeStatement.cs` (adds CostOfGoodsSold + GrossProfit)
- `engine/Magnate.Engine/Economics/Ledger.cs` (removes IncomeStatement method)
- `engine/Magnate.Engine/Simulation/World.cs` (CogsLog, RecordCogs, GetIncomeStatement, balance sheet uses WAC, profitability uses CogsLog)
- `engine/Magnate.Engine/Simulation/MaterialProcurement.cs` (cost flows with goods, shipping capitalized)
- `engine/Magnate.Engine/Simulation/MonthlyTick.cs` (extraction zero cost, production rolls cost, sales/exports record COGS)
- `engine/Magnate.Engine.Tests/SimulationTests.cs` (uses world.GetIncomeStatement)
- `engine/Magnate.Engine.Tests/ReportingTests.cs` (new WAC + COGS + equity tests)
- `tools/MagnateSim/Program.cs` (uses GetIncomeStatement; prints COGS + Gross Profit lines)
