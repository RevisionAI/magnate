# Magnate.Client

The Godot 4 client for Magnate. Hosts the UI, reads state from `Magnate.Engine`, and drives the simulation clock.

**Status**: playable Godot vertical slice. The client now covers scenario selection, a live command center, management, city and market views, reports, facility inspection, R&D, campaigns, patents, events, save/load, tutorial, and help.

## Prerequisites

- **.NET 8 SDK** (already installed for the engine)
- **Godot 4.3 (.NET build)** — download from <https://godotengine.org/download> (pick the "Godot Engine - .NET" row), or:
  ```bash
  brew install --cask godot-mono
  ```

## Open + run

1. Launch Godot.
2. Choose "Import" and point at `client/project.godot`.
3. First open triggers a C# build. If Godot reports errors, run a plain `dotnet build client` from the repo root first — the SDK restore message is more legible on the CLI.
4. Press F5 (Run Project) or click the ▶ button.

The first screen offers quick scenarios and a full scenario browser. In-game, the command center shows cash, monthly net income, assets, building count, current goals, competitor position, and a live executive priority derived from the active company.

Click **Advance 1 Month** to tick once, or **Play** to auto-tick. Open **Build & Operate** to launch a configured Starter Investment, then use Market Intel, facility inspection, and financial reports to tune the business.

## File layout

```
client/
  project.godot          Godot project config
  Magnate.Client.csproj  C# project; references ../engine/Magnate.Engine
  assets/ui/             Title, command-center, and city artwork
  assets/systems/        Retail, manufacturing, logistics, R&D, and markets artwork
  scenes/                Godot scenes for every client surface
  scripts/               UI controllers, shared chrome, tutorials, and visual presentation metadata
  .godot/                Godot's generated cache (git-ignored)
```

## Why `ProjectSettings.GlobalizePath` for content?

At dev time the Godot project sits at `repo/client/` and content at `repo/content/`. `Main.cs`'s `ResolveContentPath` walks `res:// → ../content`. When we ship, content will be bundled into the exported game — that's a later phase concern.
