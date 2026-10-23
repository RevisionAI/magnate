using System.Globalization;

namespace Magnate.Bridge;

// Developer surface (bridge-spec §5.13). Release builds register no debug commands
// besides `debugStats`; cheats (debugSetCash, …) would live behind #if MAGNATE_DEV.
public sealed partial class GameSession
{
    /// <summary>Engine and bridge counters for the dev overlay and perf checks.</summary>
    [BridgeMethod("debugStats", RequiresGame = false)]
    public DebugStatsDto DebugStats()
    {
        var game = _game;
        var world = game?.World;
        return new DebugStatsDto(
            LedgerEntries: world?.Ledger.Entries.Count ?? 0,
            CogsEntries: world?.CogsLog.Entries.Count ?? 0,
            TransferEntries: world?.TransferLog.Entries.Count ?? 0,
            Buildings: world?.Buildings.Count ?? 0,
            Companies: world?.Companies.Count ?? 0,
            LastTickMs: game?.LastTickMs ?? 0,
            LastBridgeMs: game?.LastBridgeMs ?? 0,
            IndexCatchUpMs: game?.IndexCatchUpMs ?? 0,
            Revision: Revision,
            Faulted: game?.Faulted ?? false,
            ProtocolVersion: ProtocolVersion.ToString(CultureInfo.InvariantCulture),
            LastAdvancePhasesMs: game?.LastAdvancePhasesMs,
            LastSavePhasesMs: LastSavePhasesMs,
            LastLoadPhasesMs: LastLoadPhasesMs);
    }
}
