using System.Collections.Generic;

namespace Magnate.Bridge;

// Common protocol types (bridge-spec §5.1). Mirrored 1:1 in web/src/bridge/protocol.ts.

/// <summary>A calendar month (<c>month</c> is 1–12).</summary>
public sealed record DateDto(int Year, int Month);

/// <summary>
/// A report period: a <c>preset</c> (<c>thisMonth</c>, <c>lastMonth</c>, <c>ytd</c>,
/// <c>last12</c>, <c>sinceStart</c>, <c>allTime</c>) or explicit <c>from</c>/<c>to</c>
/// months. Resolved server-side and clamped to <c>[start, now]</c>.
/// </summary>
public sealed record PeriodArgs(string? Preset = null, DateDto? From = null, DateDto? To = null);

/// <summary>A resolved period: inclusive month range plus the preset it came from (or <c>custom</c>).</summary>
public sealed record PeriodDto(DateDto From, DateDto To, int Months, string Preset);

/// <summary>A dense monthly series starting at <see cref="Start"/>; <c>null</c> marks a missing month.</summary>
public sealed record SeriesDto(DateDto Start, IReadOnlyList<double?> Values);

/// <summary>A company reference with its display colour (<c>colorIndex</c> 0 is always the player).</summary>
public sealed record CompanyRefDto(int CompanyId, string Name, string Color, int ColorIndex);

/// <summary>A (product, quantity) pair.</summary>
public sealed record ProductQtyDto(string ProductId, double Quantity);

/// <summary>An (id, count) pair.</summary>
public sealed record IdCountDto(string Id, int Count);

/// <summary>
/// Where a building stands on its city's plot grid: plot (0,0) is the NW corner,
/// <c>rotation</c> is 0/90/180/270, <c>source</c> is <c>auto</c> (facade auto-siting),
/// <c>bridge</c> (player-chosen, validated by the facade) or <c>engine</c> (engine plots, EXT).
/// </summary>
public sealed record PlacementDto(int Px, int Pz, int Rotation, string Source);

/// <summary>A requested plot (top-left corner of the rotated footprint) and rotation.</summary>
public sealed record PlotRefDto(int Px, int Pz, int Rotation = 0);
