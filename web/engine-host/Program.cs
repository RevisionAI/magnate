using System;
using System.IO;
using System.Runtime.InteropServices.JavaScript;
using Magnate.Bridge;

// Entry point is required for an Exe; the JS side drives everything through
// MagnateInterop's exports and never calls runMain.
Console.WriteLine("Magnate engine host loaded");

/// <summary>
/// JavaScript-facing surface of the engine. Deliberately small: boot once, then
/// every interaction is <c>Call(method, argsJson)</c> → response envelope JSON
/// (see <see cref="GameSession.Dispatch"/>). Saves travel as bytes so a
/// multi-megabyte game never crosses the boundary as a string (bridge-spec §6.3).
/// No export ever throws: failures come back as error envelopes.
/// </summary>
public static partial class MagnateInterop
{
    private const string ContentRoot = "/magnate/content";
    private const string NotBooted = "{\"ok\":false,\"error\":{\"code\":\"not_initialized\",\"message\":\"Boot() has not run\"},\"revision\":0}";
    private static GameSession? _session;

    /// <summary>
    /// Extract embedded content into the in-memory filesystem and run the
    /// bridge's <c>init</c>. Returns the <c>init</c> response envelope.
    /// </summary>
    [JSExport]
    public static string Boot()
    {
        try
        {
            ExtractEmbeddedContent();
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":{\"code\":\"internal\",\"message\":\"Could not unpack the game content.\",\"details\":{\"devMessage\":"
                + System.Text.Json.JsonSerializer.Serialize(ex.GetType().Name + ": " + ex.Message) + "}},\"revision\":0}";
        }
        _session = new GameSession();
        return _session.Dispatch("init", "{\"contentRoot\":\"" + ContentRoot + "\"}");
    }

    /// <summary>Invoke a bridge method. Always returns an envelope, never throws.</summary>
    [JSExport]
    public static string Call(string method, string argsJson)
        => _session is null ? NotBooted : _session.Dispatch(method, argsJson);

    /// <summary>
    /// gzip(web save envelope) for <c>SaveArgs</c> JSON; arrives in JS as a
    /// <c>Uint8Array</c>. Returns an empty array on failure — read <see cref="LastError"/>.
    /// </summary>
    [JSExport]
    [return: JSMarshalAs<JSType.Array<JSType.Number>>]
    public static byte[] SaveBinary(string argsJson)
        => _session is null ? Array.Empty<byte>() : _session.SaveBinary(argsJson);

    /// <summary>The metadata envelope (<c>SaveMetaDto</c>) of the save <see cref="SaveBinary"/> would write.</summary>
    [JSExport]
    public static string SaveMeta(string argsJson)
        => _session is null ? NotBooted : _session.SaveMeta(argsJson);

    /// <summary>Load gzip or plain save bytes; returns the <c>loadGame</c> envelope (a <c>SnapshotDto</c>).</summary>
    [JSExport]
    public static string LoadBinary([JSMarshalAs<JSType.Array<JSType.Number>>] byte[] data, string argsJson)
        => _session is null ? NotBooted : _session.LoadBinary(data, argsJson);

    /// <summary>Read a save's metadata and loadability without loading it (<c>InspectResultDto</c> envelope).</summary>
    [JSExport]
    public static string InspectSave([JSMarshalAs<JSType.Array<JSType.Number>>] byte[] data)
        => _session is null ? NotBooted : _session.InspectSave(data);

    /// <summary>The error envelope of the last failed <see cref="SaveBinary"/>, or <c>"null"</c>.</summary>
    [JSExport]
    public static string LastError() => _session?.LastErrorJson ?? "null";

    /// <summary>
    /// The <c>SaveMetaDto</c> JSON (raw + compressed sizes) of the last successful <see cref="SaveBinary"/>,
    /// or <c>"null"</c>: the worker's slot listing, without serializing the game a second time.
    /// </summary>
    [JSExport]
    public static string LastSaveMeta() => _session?.LastSaveMetaJson ?? "null";

    private static void ExtractEmbeddedContent()
    {
        var assembly = typeof(MagnateInterop).Assembly;
        foreach (var name in assembly.GetManifestResourceNames())
        {
            if (!name.StartsWith("content/", StringComparison.Ordinal)) continue;
            var relative = name.Substring("content/".Length).Replace('\\', '/');
            var target = Path.Combine(ContentRoot, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using var input = assembly.GetManifestResourceStream(name)!;
            using var output = File.Create(target);
            input.CopyTo(output);
        }
    }
}
