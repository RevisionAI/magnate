using System;

namespace Magnate.Bridge;

/// <summary>An inclusive month range (month indices) resolved from <see cref="PeriodArgs"/>.</summary>
internal readonly record struct Period(int From, int To, string Preset)
{
    public int Months => To - From + 1;

    public PeriodDto ToDto() => new(Bridge.Months.Dto(From), Bridge.Months.Dto(To), Months, Preset);

    public bool Contains(int month) => month >= From && month <= To;
}

/// <summary>
/// Report periods (bridge-spec §4.6.2), resolved server-side so every client
/// agrees on "year to date" and nothing hard-codes a start month.
/// <list type="bullet">
///   <item><c>thisMonth</c> = [now, now] — month-to-date with the closed tick included.</item>
///   <item><c>lastMonth</c> = [now−1, now−1].</item>
///   <item><c>ytd</c> = [January of now's year, now].</item>
///   <item><c>last12</c> = [now−11, now].</item>
///   <item><c>sinceStart</c> / <c>allTime</c> = [start, now].</item>
/// </list>
/// Everything is clamped to <c>[start, now]</c>; months before now are closed and immutable.
/// </summary>
internal static class Periods
{
    public const string ThisMonth = "thisMonth";
    public const string LastMonth = "lastMonth";
    public const string Ytd = "ytd";
    public const string Last12 = "last12";
    public const string SinceStart = "sinceStart";
    public const string AllTime = "allTime";
    public const string Custom = "custom";

    /// <summary>Resolve <paramref name="args"/> (null = <paramref name="defaultPreset"/>).</summary>
    public static Period Resolve(PeriodArgs? args, int start, int now, string defaultPreset, string field = "period")
    {
        if (now < start) start = now;
        var preset = args?.Preset;
        if (args is not null && preset is null && (args.From is not null || args.To is not null))
        {
            var from = args.From is null ? start : Bridge.Months.Index(Guard.Date(args.From, field + ".from"));
            var to = args.To is null ? now : Bridge.Months.Index(Guard.Date(args.To, field + ".to"));
            from = Math.Clamp(from, start, now);
            to = Math.Clamp(to, start, now);
            if (from > to)
            {
                throw new BridgeException(BridgeErrorCodes.InvalidPeriod, "The period starts after it ends.", field);
            }
            return new Period(from, to, Custom);
        }

        preset ??= defaultPreset;
        var (f, t) = preset switch
        {
            ThisMonth => (now, now),
            LastMonth => (now - 1, now - 1),
            Ytd => (now - (now % 12), now),
            Last12 => (now - 11, now),
            SinceStart or AllTime => (start, now),
            _ => throw new BridgeException(
                BridgeErrorCodes.InvalidArgument,
                $"Unknown period preset '{preset}'.",
                field + ".preset"),
        };
        return new Period(Math.Clamp(f, start, now), Math.Clamp(t, start, now), preset);
    }
}
