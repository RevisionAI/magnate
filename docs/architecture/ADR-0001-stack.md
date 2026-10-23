# ADR-0001 — Tech stack

**Date**: 2026-04-24
**Status**: Accepted

## Decision

- **Renderer + client**: Godot 4 with C# (.NET 8), desktop 2D isometric.
- **Simulation core**: pure C# class library (`Magnate.Engine`) with **no Godot dependency**. Referenced by the Godot client.
- **Content**: JSON + JSON Schema, validated by a standalone CLI (`Magnate.ContentValidator`).
- **Saves**: SQLite via Microsoft.Data.Sqlite.

## Context

Evaluated three paths:
- **A. Desktop game engine (Unity / Godot)** — best fit for modding ecosystem, asset pipeline, and desktop performance.
- **B. Web (React/TS + Rust/WASM)** — distribution-friendly but poor fit for long saves, many entities, and desktop-first audience.
- **C. Native (Rust + Bevy, or C++)** — best perf, worst iteration speed.

Within A, chose Godot over Unity:
- Open-source, no runtime licensing risk.
- Lighter editor, faster iteration for a sim-heavy 2D game.
- C# support is first-class since Godot 4.
- The 2D toolkit and UI (Control nodes) are mature and suited to our dense panels.

## Consequences

- **Positive**: fast iteration, cheap distribution, tight C# type system for a finance/accounting-heavy codebase, open source stack keeps options open for Linux/Mac.
- **Negative**: Godot's asset ecosystem is smaller than Unity's — we build more ourselves.
- **Mitigation for renderer lock-in**: the simulation core has zero Godot imports. If the renderer ever needs to change (e.g. to Unity or a custom native client), the core ports unchanged.

## Invariants this decision implies

1. `engine/Magnate.Engine/*.cs` MUST NOT reference `Godot.*`.
2. Anything that touches UI, rendering, input, or node tree lives in `client/`.
3. All game content is data (JSON), not code — so modders can override without recompiling.
