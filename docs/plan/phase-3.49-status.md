# Phase 3.49 — Patent system

## Summary

When a company first advances to `MaxTechLevel` on a product, it is granted a
24-month patent. While active, the patent silently drops the R&D progress that
any *other* company would otherwise accrue on that product in the same tick.
After expiry, competitors' research resumes normally. At most one patent per
`(company, product)` pair is ever granted across the lifetime of a world.

## Grant mechanics

- Grant happens inside `World.AddResearchPoints`, at the transition where
  `techBefore < MaxTech && tech >= MaxTech`. This handles multi-level jumps
  in a single injection.
- `_patentsEverGranted: HashSet<(CompanyId, ProductId)>` gates the grant so
  an expired patent never revives if the holder re-advances to max.
- `ExpiresAt = Clock.Now + 24 months` (via an internal `GameDate.AddMonth`
  loop since `GameDate` has no `AddMonths`). Active iff `Clock.Now < ExpiresAt`
  (strict). Prune predicate is `ExpiresAt <= Clock.Now`.

## Block + expire

`MonthlyTick.RunResearch` now starts with `world.PruneExpiredPatents()`, then
each `(owner, product)` pair is checked via `world.IsPatentBlocked(...)` before
calling `AddResearchPoints`. Holder is never blocked by their own patent.

## Schema v5 → v6

`WorldSaveFile` gained two nullable trailing fields: `Patents` and
`PatentsEverGranted`. `WorldSaver.Snapshot` always writes them (empty lists
when none); `WorldLoader.Rebuild` treats null as empty, so v1-v5 saves load
cleanly. New DTOs `PatentDto(Holder, Product, ExpiresYear, ExpiresMonth)` and
`PatentEverGrantedDto(Holder, Product)`. `MinSupportedSchemaVersion` stays 1.

## Test delta

191 → 198 (+6 in `PatentTests`, +1 v5-missing-patents in `PersistenceTests`).
`dotnet build` clean; `dotnet test` 198/198; `ContentValidator` OK.

## Gotchas hit

- First pass pre-seeded tech with `SetTech(max-1)` then ticked once — only
  yields `100` R&D points but threshold is `100×(max-1)`. Rewrote tests to
  inject the full `Σ100×N` directly via `AddResearchPoints` (accessible through
  `InternalsVisibleTo`), keeping the grant-tick deterministic.
- Patent iteration in `GetActivePatents` and save DTO lists ordered by holder
  then product ordinal to preserve engine invariant #3 (determinism).
