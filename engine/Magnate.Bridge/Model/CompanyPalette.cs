using System.Collections.Generic;
using System.Linq;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// Owner colours (MASTER-PLAN D15, art-rendering §3.4). <c>colorIndex</c> 0 is
/// always the player (blue); rivals take indices 1..7 in ascending company-id
/// order (cycling past seven rivals), each paired with an Okabe–Ito-derived hue
/// and an emblem on the client. The hex values mirror
/// <c>web/src/theme/tokens.ts</c>; the client should prefer the index.
/// </summary>
internal static class CompanyPalette
{
    public static readonly string[] Colors =
    {
        "#2F7DE1", // 0 player
        "#E69F00", // 1
        "#CC79A7", // 2
        "#009E73", // 3
        "#D55E00", // 4
        "#56B4E9", // 5
        "#F0C419", // 6
        "#7E57C2", // 7
    };

    /// <summary>Colour index for every company in <paramref name="world"/>.</summary>
    public static Dictionary<int, int> Assign(World world, CompanyId player)
    {
        var map = new Dictionary<int, int>();
        var rival = 0;
        foreach (var id in world.Companies.Keys.Select(k => k.Value).OrderBy(v => v))
        {
            if (id == player.Value)
            {
                map[id] = 0;
                continue;
            }
            map[id] = 1 + (rival % (Colors.Length - 1));
            rival++;
        }
        return map;
    }
}
