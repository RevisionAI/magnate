using System.Collections.Generic;
using Magnate.Engine.Simulation;

namespace Magnate.Engine.Scenarios;

/// <summary>
/// A scenario: starting conditions, AI roster, goals. Loaded from JSON under
/// <c>content/scenarios/</c>. Applied to a fresh <see cref="World"/> by <see cref="ScenarioRunner"/>.
/// </summary>
public sealed record Scenario(
    string Id,
    string Name,
    string Description,
    GameDate StartDate,
    GameDate? EndDate,
    ScenarioPlayer Player,
    IReadOnlyList<ScenarioCompany> AiCompetitors,
    IReadOnlyList<Goal> Goals);

public sealed record ScenarioPlayer(string Name, decimal StartingCash);

/// <summary>An AI competitor entry. <see cref="Strategy"/> is a string name mapped by <see cref="ScenarioRunner"/>.</summary>
public sealed record ScenarioCompany(string Name, decimal StartingCash, string Strategy);
