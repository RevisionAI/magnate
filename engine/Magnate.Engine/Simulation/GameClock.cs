using System;

namespace Magnate.Engine.Simulation;

/// <summary>In-game date at month precision. Year is 1-based, month is 1..12.</summary>
public readonly record struct GameDate(int Year, int Month) : IComparable<GameDate>
{
    public GameDate AddMonth()
        => Month == 12 ? new GameDate(Year + 1, 1) : new GameDate(Year, Month + 1);

    public int AsMonthIndex() => Year * 12 + (Month - 1);

    public int CompareTo(GameDate other) => AsMonthIndex().CompareTo(other.AsMonthIndex());

    public static bool operator <(GameDate a, GameDate b)  => a.CompareTo(b) <  0;
    public static bool operator >(GameDate a, GameDate b)  => a.CompareTo(b) >  0;
    public static bool operator <=(GameDate a, GameDate b) => a.CompareTo(b) <= 0;
    public static bool operator >=(GameDate a, GameDate b) => a.CompareTo(b) >= 0;

    public override string ToString() => $"{Year:D4}-{Month:D2}";
}

public sealed class GameClock
{
    public GameDate Now { get; internal set; }

    public GameClock(GameDate start)
    {
        Now = start;
    }

    public GameDate AdvanceMonth()
    {
        Now = Now.AddMonth();
        return Now;
    }
}
