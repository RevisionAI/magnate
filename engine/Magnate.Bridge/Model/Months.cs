using System;
using System.Globalization;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// Month-index arithmetic. The bridge works in month indices
/// (<c>year*12 + month − 1</c>, <see cref="GameDate.AsMonthIndex"/>) so ranges are
/// plain integer loops.
/// </summary>
internal static class Months
{
    public static int Index(GameDate date) => date.AsMonthIndex();

    public static GameDate Date(int monthIndex)
    {
        // Floor division so the mapping stays correct for any integer.
        var year = monthIndex >= 0 ? monthIndex / 12 : (monthIndex - 11) / 12;
        return new GameDate(year, monthIndex - year * 12 + 1);
    }

    public static DateDto Dto(int monthIndex)
    {
        var d = Date(monthIndex);
        return new DateDto(d.Year, d.Month);
    }

    public static DateDto Dto(GameDate date) => new(date.Year, date.Month);

    public static int Index(DateDto date) => date.Year * 12 + (date.Month - 1);

    /// <summary>"Mar 2027" — invariant culture (the browser build has no culture data).</summary>
    public static string Label(int monthIndex)
    {
        var d = Date(monthIndex);
        return CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(d.Month) + " " + d.Year.ToString(CultureInfo.InvariantCulture);
    }
}

/// <summary>Invariant-culture text helpers for facade-authored English fallback messages.</summary>
internal static class Text
{
    /// <summary>"$1,234" / "-$1,234" with no culture dependence.</summary>
    public static string Money(decimal amount) => GameSession.Money(amount);

    /// <summary>"12.5%" for a ratio.</summary>
    public static string Percent(double ratio) => (ratio * 100).ToString("0.#", CultureInfo.InvariantCulture) + "%";

    /// <summary>Thousands-separated integer text.</summary>
    public static string Count(double value) => value.ToString("N0", CultureInfo.InvariantCulture);

    /// <summary>Invariant integer text.</summary>
    public static string Int(long value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>Invariant decimal text (for advisor params; the client formats).</summary>
    public static string Dec(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    /// <summary>Invariant double text (shortest round-trip).</summary>
    public static string Num(double value) => value.ToString("R", CultureInfo.InvariantCulture);
}
