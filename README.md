# Magnate

A modern business-simulation game inspired by *Capitalism Lab* (Enlight Software). Build factories, run supply chains, advertise, IPO, acquire rivals, operate a bank, and dominate cities across the map.

**Status**: playable prototype / presentation vertical slice.

## Stack

- **Engine**: Godot 4 with C# (.NET 8)
- **Simulation core**: pure C# library (`engine/Magnate.Engine`), no Godot dependency — portable and unit-testable.
- **Content**: JSON files in `content/`, validated by `tools/ContentValidator`. Saves use SQLite.
- **Renderer**: Godot 4 2D isometric (`client/`).

## Repository layout

```
engine/            Pure-C# simulation core + tests
  Magnate.Engine/        Domain model, tick scheduler, recipe solver, demand model, accounting
  Magnate.Engine.Tests/  Invariant / property tests
content/           Data-driven game content
  schemas/         JSON Schemas
  data/            Products, buildings, cities, scenarios, AI personalities
client/            Godot 4 project (renderer + UI)
tools/             CLI tools
  ContentValidator/  Validate content JSON against schemas
docs/              Design docs
  research/        Capitalism series reference dossier
  plan/            Build plan, phase milestones
  architecture/    ADRs and design notes
```

## What is playable

- 16 goal-driven and sandbox scenarios with four AI strategy archetypes.
- Multi-city retail demand, pricing, inventory, production recipes, extraction, warehouses, exports, advertising, R&D, patents, and events.
- Construction and facility configuration, upgrades, per-building inspection, and starter investments for new players.
- Ledger-backed income statements, balance sheets, product profitability, trends, market intelligence, and save/load.
- Original generated visual assets across the title, command center, city map, scenario browser, and mechanics field guide.

The prototype does not yet include the full Capitalism Lab feature surface. Stock markets, debt, takeovers, banking, real estate, labor markets, and subsidiaries remain future milestones.

## Run the game

The project expects a Godot 4 .NET build and .NET 8. On the current development machine they are installed under user-local paths:

```bash
export PATH="$HOME/.dotnet:$PATH"
export DOTNET_ROOT="$HOME/.dotnet"
export GODOT="$HOME/Applications/Godot_mono.app/Contents/MacOS/Godot"

dotnet build client/Magnate.Client.csproj
"$GODOT" --path client
```

Start with **Tutorial - Your First Company** for the clearest first-session flow. See `docs/design/gameplay-and-modernisation.md` for the implemented mechanics, visual asset system, presentation journey, and next product milestones.

## License

TBD.
