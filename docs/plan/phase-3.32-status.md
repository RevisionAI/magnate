# Phase 3.32 — Balance-sheet drill-down

Expanded `RenderBalanceSheet(World)` in `client/scripts/FinancialStatements.cs` so
the Balance Sheet tab proves its own totals. The Balance-Sheet tab remains "as of
now" and is unaffected by the period selector. No engine sources were modified;
`FinancialStatements.tscn` already had `bbcode_enabled=true` + `fit_content=true`.

## Three new sub-sections

1. **Buildings at construction value** — iterates every player-owned building
   (`Owner == PlayerId`, ordered by `b.Id.Value`), emits one `B{id} · {type.Name}
   · {city} · $cost` row, and sums. Sum is cross-checked against
   `snapshot.BuildingValue`; any drift is surfaced inline.
2. **Inventory by building** — for each owned building, enumerates
   `Inventory.EntriesWithCost` where `Quantity > 0`, rendering
   `product × qty @ WAC avg = total`. Sum is reconciled to
   `snapshot.InventoryValue`.
3. **Equity reconciliation** — `StartingCapital + ΣNetIncome(SimStart..Now) =
   Equity`. StartingCapital is summed from `Ledger.EntriesFor` entries where
   `Category == LedgerCategory.StartingCapital`. Cumulative net income comes
   authoritatively from `world.GetIncomeStatement(playerId, SimStart, Clock.Now)`,
   which already excludes balance-sheet movements (InputPurchase, RetailRestock,
   ShippingCost, ConstructionCost). Any non-zero drift is shown in brackets;
   when zero, prints "The books close".

## Sample BBCode output (abridged)

```
[b]Buildings at construction value[/b]
  · B1 · Soft Drink Factory · Springfield · $450,000.00
  · B2 · Convenience Store · Springfield · $120,000.00
  ─────────────────────────────────────────
  [b]Sum                              $570,000[/b]

[b]Inventory by building[/b]
  [b]B1[/b] · Soft Drink Factory · Springfield
    · soft_drink × 812 @ $0.42 avg = $341.04
  ─────────────────────────────────────────
  [b]Sum                                  $341[/b]

[b]Equity reconciliation[/b]
  Starting capital              $1,000,000.00
  + Cumulative net income          $42,318.50
  ─────────────────────────────────────────
  Expected equity               $1,042,318.50
  Reported equity               $1,042,318.50
  [b]Difference                        $0.00[/b]
  [i]The books close: StartingCapital + ΣNetIncome = Equity.[/i]
```

## Verification

- `dotnet build`: succeeded, 0 warnings / 0 errors.
- `dotnet test engine/Magnate.Engine.Tests`: **161/161 passed**.
- Godot headless skipped per sprint guidance.
