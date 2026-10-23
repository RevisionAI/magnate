using System;
using System.Buffers;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Magnate.Engine.Content;
using Magnate.Engine.Persistence;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Bridge;

/// <summary>
/// The single stateful facade the web client talks to. Owns the content
/// catalog, the scenario library and (once a game starts) the <see cref="World"/>
/// plus the facade's indexes and trackers. Every interaction is
/// <see cref="Dispatch"/>(method, argsJson) → responseJson, so the same session can
/// sit behind the browser-wasm host, a test, or a CLI.
/// </summary>
/// <remarks>
/// <para>Envelope (bridge-spec §5.0):
/// <c>{"ok":true,"result":…,"revision":n,"hud":{…},"events":[…]}</c> or
/// <c>{"ok":false,"error":{"code","message","field","details"},"revision":n}</c>.
/// <c>hud</c> (a <see cref="SnapshotDto"/>) and <c>events</c> ride on every successful
/// mutating call except <c>advance</c>, whose result already embeds both.</para>
/// <para>Feature areas add handlers in their own <c>GameSession.*.cs</c> partial
/// files using <see cref="BridgeMethodAttribute"/>; discovery is by reflection, so
/// parallel work never collides on a central switch.</para>
/// </remarks>
public sealed partial class GameSession
{
    private static readonly Dictionary<string, HandlerInfo> Handlers = DiscoverHandlers();

    /// <summary>Methods that replace the session's game and therefore work while it is faulted.</summary>
    private static readonly HashSet<string> SessionResetMethods = new(StringComparer.Ordinal) { "init", "newGame", "loadGame" };

    private ContentCatalog? _catalog;
    private Dictionary<string, Scenario> _scenarios = new(StringComparer.Ordinal);
    private SlotRules? _slotRules;
    private string _contentHash = string.Empty;

    // The active game. _world/_playerId/_scenario mirror _game for code written against the skeleton.
    private ActiveGame? _game;
    private World? _world;
    private CompanyId _playerId;
    private Scenario? _scenario;

    // Per-dispatch scratch: events queued by the handler, and whether engine state changed.
    private readonly List<GameEventDto> _pendingEvents = new();
    private bool _dirty;

    /// <summary>
    /// Monotonic counter bumped once by every successful mutating call (an
    /// <c>advance</c> of any length counts as one). Returned in every envelope so
    /// the client can tell whether cached query results are stale.
    /// </summary>
    public long Revision { get; private set; }

    /// <summary>The loaded content catalog (after <c>init</c>).</summary>
    public ContentCatalog Catalog => _catalog ?? throw new BridgeException(BridgeErrorCodes.NotInitialized, "The engine has not been initialised.");

    /// <summary>The active world (after <c>newGame</c> / <c>loadGame</c>).</summary>
    public World World => _world ?? throw new BridgeException(BridgeErrorCodes.NoGame, "There is no game in progress.");

    /// <summary>The human player's company id in the active world.</summary>
    public CompanyId PlayerId
    {
        get
        {
            _ = World;
            return _playerId;
        }
    }

    /// <summary>The scenario being played, when the game was started from (or saved with) one.</summary>
    public Scenario? ActiveScenario => _scenario;

    /// <summary>All loaded scenarios keyed by id.</summary>
    public IReadOnlyDictionary<string, Scenario> Scenarios => _scenarios;

    /// <summary>SHA-256 over the content files (path + bytes, sorted by path), computed at <c>init</c>.</summary>
    public string ContentHash => _contentHash;

    /// <summary>True after a tick threw; mutating calls fail with <c>tick_failed</c> until load / new game.</summary>
    public bool Faulted => _game?.Faulted ?? false;

    /// <summary>Names of every registered protocol method (sorted), for diagnostics and tests.</summary>
    public static IReadOnlyList<string> MethodNames => Handlers.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();

    /// <summary>The declared args and result type of a method (contract tests, fixtures).</summary>
    public static (Type? Args, Type Result, bool Mutates, bool RequiresGame)? Describe(string method)
        => Handlers.TryGetValue(method, out var h)
            ? (h.ArgsType, h.Method.ReturnType, h.Attribute.Mutates, h.Attribute.RequiresGame)
            : null;

    internal ActiveGame Game => _game ?? throw new BridgeException(BridgeErrorCodes.NoGame, "There is no game in progress.");

    internal SlotRules Rules => _slotRules ?? throw new BridgeException(BridgeErrorCodes.NotInitialized, "The engine has not been initialised.");

    /// <summary>
    /// Execute one protocol call. Never throws: failures come back as an error
    /// envelope so the JS side has a single code path.
    /// </summary>
    public string Dispatch(string method, string? argsJson)
    {
        if (string.IsNullOrWhiteSpace(method) || !Handlers.TryGetValue(method, out var handler))
        {
            return ErrorEnvelope(new BridgeException(BridgeErrorCodes.UnknownMethod, $"Unknown method '{method}'."));
        }
        var attribute = handler.Attribute;
        return Execute(method, attribute.Mutates, attribute.RequiresGame, handler.Method.ReturnType, argsJson,
            () => Invoke(handler, BindArguments(handler, method, argsJson)));
    }

    /// <summary>
    /// The call pipeline shared by <see cref="Dispatch"/> and the binary save entry
    /// points: preconditions, revision bump (rolled back when a failing call left
    /// state untouched), post-mutation bookkeeping and the envelope.
    /// </summary>
    private string Execute(string method, bool mutates, bool requiresGame, Type resultType, string? argsJson, Func<object?> body)
    {
        var started = Stopwatch.GetTimestamp();
        _pendingEvents.Clear();
        _dirty = false;
        var bumped = false;
        try
        {
            if (requiresGame && _game is null)
            {
                throw new BridgeException(BridgeErrorCodes.NoGame, $"'{method}' needs a game in progress.");
            }
            if (mutates && _game is { Faulted: true } && !SessionResetMethods.Contains(method))
            {
                throw new BridgeException(BridgeErrorCodes.TickFailed,
                    "The simulation stopped after an internal error. Load a save or start a new game.");
            }

            // Bump before running so snapshots built inside the handler carry the new revision.
            if (mutates)
            {
                Revision++;
                bumped = true;
            }

            var result = body();

            if (!mutates) return OkEnvelope(resultType, result, null, null);

            var (hud, events) = AfterMutation(method, argsJson, publishHud: method != "advance");
            if (_game is { } game) game.LastBridgeMs = ElapsedMs(started) - (method == "advance" ? game.LastTickMs : 0);
            return OkEnvelope(resultType, result, hud, events);
        }
        catch (Exception ex)
        {
            if (bumped)
            {
                if (_dirty && _game is not null)
                {
                    // State changed before the failure (e.g. a tick threw half-way): keep the bump and the indexes honest.
                    _game.Index.CatchUp();
                    _game.Placement.EnsureAll(_game.World);
                }
                else
                {
                    Revision--;
                }
            }
            return ErrorEnvelope(ex);
        }
    }

    // ------------------------------------------------------------------ pipeline

    private static object?[] BindArguments(HandlerInfo handler, string method, string? argsJson)
    {
        if (handler.ArgsType is null) return Array.Empty<object?>();
        var json = string.IsNullOrWhiteSpace(argsJson) || argsJson.Trim() == "null" ? "{}" : argsJson;
        object? args;
        try
        {
            args = JsonSerializer.Deserialize(json, handler.ArgsType, BridgeJson.Options);
        }
        catch (JsonException ex)
        {
            throw new BridgeException(
                BridgeErrorCodes.BadRequest,
                $"The arguments for '{method}' are malformed.",
                FieldFromPath(ex.Path),
                new ErrorDetailsDto(DevMessage: ex.Message));
        }
        catch (NotSupportedException ex)
        {
            throw new BridgeException(
                BridgeErrorCodes.BadRequest,
                $"The arguments for '{method}' are malformed.",
                null,
                new ErrorDetailsDto(DevMessage: ex.Message));
        }
        if (args is null) throw new BridgeException(BridgeErrorCodes.BadRequest, $"'{method}' needs arguments.");
        return new[] { args };
    }

    private object? Invoke(HandlerInfo handler, object?[] parameters)
    {
        try
        {
            return handler.Method.Invoke(this, parameters);
        }
        catch (TargetInvocationException tie) when (tie.InnerException is not null)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(tie.InnerException).Throw();
            throw; // unreachable
        }
    }

    /// <summary>
    /// After a successful mutating call: fold new ledger entries, site new
    /// buildings, re-evaluate goals (a command can latch a goal or win the game),
    /// stamp and persist the queued events, build the HUD, and journal the call.
    /// </summary>
    private (SnapshotDto? Hud, IReadOnlyList<GameEventDto>? Events) AfterMutation(string method, string? argsJson, bool publishHud)
    {
        if (_game is not { } game) return (null, null);
        if (method != "advance")
        {
            CatchUpIndex(game);
            game.Placement.EnsureAll(game.World);
            if (!SessionResetMethods.Contains(method))
            {
                _pendingEvents.AddRange(game.Goals.Refresh(game.World, game.Index, game.Player, game.StartMonth, silent: false));
                if (game.Goals.CheckWin(game.Now) is { } win) _pendingEvents.Add(win);
                game.Record(Revision, method, argsJson ?? "{}");
            }
        }
        var events = PublishPending(game);
        return (publishHud ? BuildSnapshot() : null, events);
    }

    /// <summary>Stamp queued events with seq + month and persist the feed-worthy ones.</summary>
    private List<GameEventDto> PublishPending(ActiveGame game)
    {
        var month = Months.Dto(game.Now);
        var events = new List<GameEventDto>(_pendingEvents.Count);
        foreach (var e in _pendingEvents) events.Add(game.Feed.Publish(e, month));
        _pendingEvents.Clear();
        return events;
    }

    /// <summary>Queue an event produced by the current command (published after it succeeds).</summary>
    internal void QueueEvent(GameEventDto e) => _pendingEvents.Add(e);

    /// <summary>Mark that engine state has changed in this call (keeps the revision bump on failure).</summary>
    internal void MarkDirty() => _dirty = true;

    private static void CatchUpIndex(ActiveGame game)
    {
        var started = Stopwatch.GetTimestamp();
        game.Index.CatchUp();
        game.IndexCatchUpMs = ElapsedMs(started);
    }

    internal static double ElapsedMs(long startedTimestamp)
        => (Stopwatch.GetTimestamp() - startedTimestamp) * 1000.0 / Stopwatch.Frequency;

    // ------------------------------------------------------------------ envelopes

    private string OkEnvelope(Type declared, object? result, SnapshotDto? hud, IReadOnlyList<GameEventDto>? events)
    {
        var buffer = new ArrayBufferWriter<byte>(512);
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteBoolean("ok", true);
            writer.WritePropertyName("result");
            if (result is null)
            {
                writer.WriteNullValue();
            }
            else
            {
                var type = declared == typeof(object) || declared == typeof(void) ? result.GetType() : declared;
                JsonSerializer.Serialize(writer, result, type, BridgeJson.Options);
            }
            writer.WriteNumber("revision", Revision);
            if (hud is not null)
            {
                writer.WritePropertyName("hud");
                JsonSerializer.Serialize(writer, hud, BridgeJson.Options);
            }
            if (events is { Count: > 0 })
            {
                writer.WritePropertyName("events");
                JsonSerializer.Serialize(writer, events, BridgeJson.Options);
            }
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private string ErrorEnvelope(Exception ex)
    {
        var body = ToErrorBody(ex);
        return JsonSerializer.Serialize(new ErrorEnvelopeDto(false, body, Revision), BridgeJson.Options);
    }

    /// <summary>
    /// Map an exception to a protocol error. The message is always facade-written
    /// English; engine text (culture-less in the browser, resource keys from the
    /// BCL) only travels in <c>details.devMessage</c>.
    /// </summary>
    internal static ErrorBody ToErrorBody(Exception ex) => ex switch
    {
        BridgeException b => new ErrorBody(b.Code, b.Message, b.Field, b.Details),
        KeyNotFoundException => new ErrorBody(BridgeErrorCodes.NotFound,
            "Something this command refers to does not exist.", null, new ErrorDetailsDto(DevMessage: ex.Message)),
        ArgumentException a => new ErrorBody(BridgeErrorCodes.InvalidArgument,
            "The simulation rejected an argument.", a.ParamName is { Length: > 0 } p ? ToCamel(p) : null, new ErrorDetailsDto(DevMessage: ex.Message)),
        InvalidOperationException => new ErrorBody(BridgeErrorCodes.InvalidOperation,
            "The simulation refused this command in the current state.", null, new ErrorDetailsDto(DevMessage: ex.Message)),
        _ => new ErrorBody(BridgeErrorCodes.Internal,
            "Something went wrong inside the engine.", null, new ErrorDetailsDto(DevMessage: $"{ex.GetType().Name}: {ex.Message}")),
    };

    private static string? FieldFromPath(string? path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        var trimmed = path.StartsWith("$.", StringComparison.Ordinal) ? path[2..] : path.TrimStart('$');
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static string ToCamel(string name) => name.Length == 0 ? name : char.ToLowerInvariant(name[0]) + name[1..];

    // ------------------------------------------------------------------ lifecycle

    /// <summary>
    /// Load content and scenarios from disk. In the browser the wasm host first
    /// extracts its embedded content into the in-memory filesystem and passes
    /// that root here. Resets any game in progress.
    /// </summary>
    [BridgeMethod("init", Mutates = true, RequiresGame = false)]
    public InitResult Init(InitArgs args)
    {
        var root = Guard.Required(args.ContentRoot, "contentRoot");
        if (!Directory.Exists(root))
        {
            throw new BridgeException(BridgeErrorCodes.NotFound, "The content folder does not exist.", "contentRoot",
                new ErrorDetailsDto(EntityId: root));
        }

        var catalog = ContentLoader.Load(root);
        var scenarioDir = string.IsNullOrWhiteSpace(args.ScenarioDir) ? Path.Combine(root, "scenarios") : args.ScenarioDir!;
        var scenarios = Directory.Exists(scenarioDir)
            ? new Dictionary<string, Scenario>(ScenarioLoader.LoadAll(scenarioDir), StringComparer.Ordinal)
            : new Dictionary<string, Scenario>(StringComparer.Ordinal);

        _catalog = catalog;
        _scenarios = scenarios;
        _slotRules = new SlotRules(catalog);
        _contentHash = ComputeContentHash(root, scenarioDir);
        _catalogDto = null;
        DetachGame();

        return new InitResult(
            EngineVersion: typeof(World).Assembly.GetName().Version?.ToString() ?? "0",
            ProtocolVersion: ProtocolVersion,
            Products: catalog.Products.Count,
            BuildingTypes: catalog.BuildingTypes.Count,
            Cities: catalog.Cities.Count,
            Scenarios: scenarios.Count,
            Methods: MethodNames,
            Features: Features,
            ContentHash: _contentHash,
            SaveFormatVersion: WebSave.FormatVersion,
            EngineSchemaVersion: WorldSaver.SchemaVersion);
    }

    /// <summary>Bumped whenever a breaking change is made to the protocol shapes (additive changes do not bump).</summary>
    public const int ProtocolVersion = 1;

    /// <summary>
    /// Engine feature switches (bridge-spec §8). Each flips when its engine feature lands
    /// and the bridge implements its methods. <c>loans</c> and <c>demolish</c> (E2 finance)
    /// need the game's rules to enable them too: under Classic rules those methods still
    /// answer <c>feature_unavailable</c>. Plots, the land market and construction time (E3b)
    /// apply to games under engine land rules (every new game); a Classic world (pre-v10 save)
    /// answers their methods with <c>feature_unavailable</c>.
    /// </summary>
    public static FeatureFlagsDto Features { get; } = new(
        Plots: true, LandMarket: true, ConstructionTime: true, Demolish: true, Loans: true, DemandModel: true);

    /// <summary>Round-trip check used by the client at boot and by tests.</summary>
    [BridgeMethod("ping", RequiresGame = false)]
    public PingResult Ping() => new("pong", Revision, _game is not null);

    /// <summary>Install a world directly (tests and tools). Starts fresh facade state for it.</summary>
    internal void Attach(World world, CompanyId playerId, Scenario? scenario)
    {
        var start = scenario?.StartDate.AsMonthIndex() ?? world.Clock.Now.AsMonthIndex();
        var game = new ActiveGame(world, playerId, scenario, start, seed: 0, gameId: NewGameId(0, scenario?.Id, null, start), Rules);
        InstallGame(game, freshStart: true);
        Revision++;
    }

    private void InstallGame(ActiveGame game, bool freshStart)
    {
        _game = game;
        _world = game.World;
        _playerId = game.Player;
        _scenario = game.Scenario;
        CatchUpIndex(game);
        game.Placement.EnsureAll(game.World);
        if (freshStart)
        {
            game.History.Append(game.World, Financials.Compute(game.World, game.Index, game.Now, game.StartMonth), game.Now);
        }
        game.Goals.Refresh(game.World, game.Index, game.Player, game.StartMonth, silent: true);
        game.CaptureOnHand();
    }

    private void DetachGame()
    {
        _game = null;
        _world = null;
        _scenario = null;
        _playerId = default;
    }

    internal static string NewGameId(int seed, string? scenarioId, string? createdAtIso, int startMonth)
        => Sha256.HexOf(string.Join("|",
            "magnate",
            seed.ToString(CultureInfo.InvariantCulture),
            scenarioId ?? "",
            createdAtIso ?? "",
            startMonth.ToString(CultureInfo.InvariantCulture)))[..32];

    private static string ComputeContentHash(string root, string scenarioDir)
    {
        var files = new List<(string Rel, string Path)>();
        var data = Path.Combine(root, "data");
        if (Directory.Exists(data))
        {
            foreach (var file in Directory.EnumerateFiles(data, "*.json", SearchOption.AllDirectories))
            {
                files.Add(("data/" + Path.GetRelativePath(data, file).Replace('\\', '/'), file));
            }
        }
        if (Directory.Exists(scenarioDir))
        {
            foreach (var file in Directory.EnumerateFiles(scenarioDir, "*.json"))
            {
                files.Add(("scenarios/" + Path.GetFileName(file), file));
            }
        }
        files.Sort((a, b) => string.CompareOrdinal(a.Rel, b.Rel));
        var sha = new Sha256();
        foreach (var (rel, path) in files)
        {
            sha.Append(rel);
            sha.Append("\n");
            sha.Append(File.ReadAllBytes(path));
            sha.Append("\n");
        }
        return Sha256.Hex(sha.Finish());
    }

    // ------------------------------------------------------------------ reflection registry

    private sealed record HandlerInfo(MethodInfo Method, BridgeMethodAttribute Attribute, Type? ArgsType);

    private static Dictionary<string, HandlerInfo> DiscoverHandlers()
    {
        var map = new Dictionary<string, HandlerInfo>(StringComparer.Ordinal);
        foreach (var method in typeof(GameSession).GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
        {
            var attr = method.GetCustomAttribute<BridgeMethodAttribute>();
            if (attr is null) continue;

            var ps = method.GetParameters();
            if (ps.Length > 1)
            {
                throw new InvalidOperationException($"bridge handler {method.Name} must take 0 or 1 parameters");
            }
            if (map.ContainsKey(attr.Name))
            {
                throw new InvalidOperationException($"duplicate bridge method '{attr.Name}'");
            }
            map[attr.Name] = new HandlerInfo(method, attr, ps.Length == 1 ? ps[0].ParameterType : null);
        }
        return map;
    }

    /// <summary>Culture-independent money text (the browser runtime uses invariant globalization).</summary>
    internal static string Money(decimal amount)
    {
        var abs = Math.Abs(Math.Round(amount, 0, MidpointRounding.AwayFromZero)).ToString("N0", CultureInfo.InvariantCulture);
        return amount < 0 && abs != "0" ? $"-${abs}" : $"${abs}";
    }
}

/// <summary>Error envelope: <c>{"ok":false,"error":{…},"revision":n}</c>.</summary>
public sealed record ErrorEnvelopeDto(bool Ok, ErrorBody Error, long Revision);

/// <summary>An error: stable <c>code</c>, English <c>message</c>, optional offending <c>field</c> and typed <c>details</c>.</summary>
public sealed record ErrorBody(string Code, string Message, string? Field = null, ErrorDetailsDto? Details = null);
