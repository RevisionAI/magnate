using System;
using System.Buffers;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using Magnate.Engine.Content;

namespace Magnate.Bridge;

/// <summary>
/// The bridge's persisted state for one game (bridge-spec §6.3 "bridge"): history,
/// goal latches and outcome, event latches, the activity feed, placements,
/// settings and the command journal — everything the engine save does not hold.
/// </summary>
public sealed record BridgeSidecarDto(
    string GameId,
    int Seed,
    DateDto StartDate,
    string? ScenarioId,
    CustomGameDto? Custom,
    string? CreatedAtIso,
    string? Autopilot,
    IReadOnlyDictionary<string, string>? AiStrategies,
    HistoryStateDto? History,
    GoalStateDto? Goals,
    DetectorStateDto? Events,
    FeedStateDto? Feed,
    IReadOnlyDictionary<string, PlacementDto>? Placement,
    SettingsDto? Settings,
    IReadOnlyList<JournalEntryDto>? Journal,
    int MonthsSinceAutosave);

/// <summary>
/// What the bridge must know about an engine save before rebuilding the world,
/// gathered in one streaming pass (no document tree over a multi-megabyte file).
/// </summary>
internal sealed class EngineFacts
{
    public int SchemaVersion;
    public string? ScenarioId;
    public int? PlayerId;
    public DateDto? Clock;

    /// <summary>Company id → (name, cash as the invariant-culture string the engine writes).</summary>
    public readonly Dictionary<int, (string Name, string Cash)> Companies = new();

    /// <summary>Every (holder, product) that was ever granted a patent (<c>patentsEverGranted[]</c>, v6+).</summary>
    public readonly List<(int Holder, string Product)> PatentsEverGranted = new();

    /// <summary>Content ids the save references that the catalog lacks: <c>product:foo</c>, <c>city:bar</c>, <c>buildingType:baz</c>.</summary>
    public readonly SortedSet<string> Missing = new(StringComparer.Ordinal);
}

/// <summary>
/// A parsed save: the engine JSON (a slice of the decompressed bytes, handed to
/// <c>WorldLoader.Load(catalog, span)</c> without a string copy) plus the optional sidecar,
/// metadata and client document.
/// </summary>
internal sealed record ParsedSave(
    ReadOnlyMemory<byte> Engine,
    EngineFacts Facts,
    BridgeSidecarDto? Sidecar,
    SaveMetaDto? Meta,
    string? ContentHash,
    bool Legacy,
    string? Client = null);

/// <summary>
/// Web save format v1 (bridge-spec §6.3):
/// <code>
/// { "format": "magnate.websave", "formatVersion": 1, "contentHash": "…", "engineLast": true,
///   "meta": SaveMetaDto, "bridge": BridgeSidecarDto, "client"?: {…}, "engine": WorldSaveFile }
/// </code>
/// written as UTF-8 JSON and, for the binary path, gzip-compressed inside .NET.
/// Loading also accepts a legacy engine save (any Godot-era schema v1–v9, detected by a
/// root <c>schemaVersion</c>); the bridge then rebuilds its state from the ledger.
/// </summary>
/// <remarks>
/// Saves are large (≈ 10 MB of JSON after ten years), and both directions avoid building a
/// document tree or a string over the engine part: the engine's compact UTF-8
/// (<c>WorldSaver.SaveToUtf8</c>) is embedded verbatim on save, and on load one forward
/// <see cref="Utf8JsonReader"/> pass finds the sections, reads the sidecar and checks every
/// content id the engine part references; the engine slice then goes straight to
/// <c>WorldLoader.Load(catalog, ReadOnlySpan&lt;byte&gt;)</c>. <c>"client"</c> is the client's opaque
/// presentation state (<see cref="SaveArgs.Client"/>), validated as JSON on write.
/// <para>
/// Trusted fast path (<see cref="LoadArgs.TrustContent"/>, the worker's own slots): a save written
/// by this bridge against the installed content (same <c>contentHash</c>) cannot reference missing
/// ids, so the content scan is skipped. (The engine loader does not check ids itself, so bytes from
/// outside — imports, hand-edited files — always take the scan.) When the writer also put the
/// engine last (<c>"engineLast": true</c>, every save since Wave 2) the engine part is not
/// tokenized here at all: its slice runs to the envelope's closing brace, and the engine's own
/// loader is the one parse over it (a malformed slice fails there as <c>save_corrupt</c>). Member
/// order is otherwise free; saves with the engine in the middle (Wave 1) take the scan.
/// </para>
/// </remarks>
internal static class WebSave
{
    public const string Format = "magnate.websave";
    public const int FormatVersion = 1;

    private static readonly JsonReaderOptions ReaderOptions = new() { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip };

    /// <summary>Assemble the envelope around the engine's own UTF-8 JSON (embedded as is).</summary>
    /// <exception cref="BridgeException"><c>invalid_argument</c> (field <c>client</c>) when the client document is not JSON.</exception>
    public static byte[] Write(ReadOnlySpan<byte> engineUtf8, SaveMetaDto meta, BridgeSidecarDto sidecar, string contentHash, string? clientJson = null)
    {
        var buffer = new ArrayBufferWriter<byte>(engineUtf8.Length + 64 * 1024 + (clientJson?.Length ?? 0));
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("format", Format);
            writer.WriteNumber("formatVersion", FormatVersion);
            writer.WriteString("contentHash", contentHash);
            writer.WriteBoolean("engineLast", true);
            writer.WritePropertyName("meta");
            JsonSerializer.Serialize(writer, meta, BridgeJson.Options);
            writer.WritePropertyName("bridge");
            JsonSerializer.Serialize(writer, sidecar, BridgeJson.Options);
            if (!string.IsNullOrWhiteSpace(clientJson))
            {
                writer.WritePropertyName("client");
                try
                {
                    writer.WriteRawValue(clientJson, skipInputValidation: false);
                }
                catch (Exception ex) when (ex is JsonException or ArgumentException)
                {
                    throw new BridgeException(BridgeErrorCodes.InvalidArgument, "The client save data is not valid JSON.", "client",
                        new ErrorDetailsDto(DevMessage: ex.Message));
                }
            }
            // Last, so a trusted load can slice it without tokenizing ~10 MB (see remarks).
            writer.WritePropertyName("engine");
            // The engine produced this JSON a moment ago: validating it again would cost a full parse.
            writer.WriteRawValue(engineUtf8, skipInputValidation: true);
            writer.WriteEndObject();
        }
        return buffer.WrittenSpan.ToArray();
    }

    /// <summary>gzip (fastest level: about 160 ms for a 10-year save in WASM).</summary>
    public static byte[] Compress(byte[] raw)
    {
        using var output = new MemoryStream(raw.Length / 6 + 64);
        using (var gzip = new GZipStream(output, CompressionLevel.Fastest, leaveOpen: true))
        {
            gzip.Write(raw, 0, raw.Length);
        }
        return output.ToArray();
    }

    public static bool IsGzip(ReadOnlySpan<byte> data) => data.Length >= 2 && data[0] == 0x1F && data[1] == 0x8B;

    public static byte[] Decompress(byte[] data)
    {
        try
        {
            using var input = new MemoryStream(data);
            using var gzip = new GZipStream(input, CompressionMode.Decompress);
            using var output = new MemoryStream(data.Length * 6);
            gzip.CopyTo(output);
            return output.ToArray();
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException)
        {
            throw Corrupt("The save is not a valid compressed file.", ex);
        }
    }

    /// <summary>
    /// Parse a save (web envelope or legacy engine JSON), check its versions and
    /// collect the engine facts, including content ids missing from <paramref name="catalog"/>.
    /// When the caller trusts the bytes' origin it passes <paramref name="installedContentHash"/>, and an
    /// envelope with that <c>contentHash</c> skips the content scan (see the class remarks).
    /// </summary>
    public static ParsedSave Parse(ReadOnlyMemory<byte> utf8, ContentCatalog catalog, string? installedContentHash = null)
    {
        try
        {
            var span = utf8.Span;
            var reader = new Utf8JsonReader(span, ReaderOptions);
            if (!reader.Read()) throw Corrupt("The save is empty.", null);
            if (reader.TokenType != JsonTokenType.StartObject) throw Corrupt("The save is not a JSON object.", null);

            string? format = null;
            string? contentHash = null;
            var formatVersion = 0;
            var hasSchemaVersion = false;
            var engineLast = false;
            SaveMetaDto? meta = null;
            BridgeSidecarDto? sidecar = null;
            string? client = null;
            (int Start, int End)? engine = null;
            EngineFacts? engineFacts = null;
            while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("format"u8))
                {
                    reader.Read();
                    format = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
                }
                else if (reader.ValueTextEquals("formatVersion"u8))
                {
                    reader.Read();
                    formatVersion = reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var v) ? v : 0;
                }
                else if (reader.ValueTextEquals("contentHash"u8))
                {
                    reader.Read();
                    contentHash = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
                }
                else if (reader.ValueTextEquals("engineLast"u8))
                {
                    reader.Read();
                    engineLast = reader.TokenType == JsonTokenType.True;
                }
                else if (reader.ValueTextEquals("meta"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.StartObject) meta = JsonSerializer.Deserialize<SaveMetaDto>(ref reader, BridgeJson.Options);
                    else reader.Skip();
                }
                else if (reader.ValueTextEquals("bridge"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.StartObject) sidecar = JsonSerializer.Deserialize<BridgeSidecarDto>(ref reader, BridgeJson.Options);
                    else reader.Skip();
                }
                else if (reader.ValueTextEquals("client"u8))
                {
                    reader.Read();
                    if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray)
                    {
                        var start = (int)reader.TokenStartIndex;
                        reader.Skip();
                        client = Encoding.UTF8.GetString(span[start..(int)reader.BytesConsumed]);
                    }
                    else if (reader.TokenType == JsonTokenType.String)
                    {
                        client = reader.GetString();
                    }
                }
                else if (reader.ValueTextEquals("engine"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.StartObject)
                    {
                        var start = (int)reader.TokenStartIndex;
                        var trusted = format == Format && contentHash is { Length: > 0 } && contentHash == installedContentHash;
                        if (trusted && engineLast)
                        {
                            // The engine object closes just before the envelope does: slice, don't read.
                            var end = EngineEndBeforeRootClose(span, start);
                            engine = (start, end);
                            engineFacts = HeadFacts(span[start..end]);
                            break;
                        }
                        if (trusted)
                        {
                            reader.Skip();
                            engine = (start, (int)reader.BytesConsumed);
                            engineFacts = HeadFacts(span[start..engine.Value.End]);
                        }
                        else
                        {
                            // Scan in this pass (no Skip + second pass over ~10 MB at year 10).
                            engineFacts = ScanEngine(ref reader, catalog);
                            engine = (start, (int)reader.BytesConsumed);
                        }
                    }
                    else
                    {
                        reader.Skip();
                    }
                }
                else
                {
                    hasSchemaVersion |= reader.ValueTextEquals("schemaVersion"u8);
                    reader.Skip();
                }
            }

            if (format == Format)
            {
                if (formatVersion < 1 || formatVersion > FormatVersion)
                {
                    throw new BridgeException(BridgeErrorCodes.SaveVersionUnsupported,
                        "This save was written by a newer version of Magnate.", null,
                        new ErrorDetailsDto(SchemaVersion: formatVersion, MinSchemaVersion: 1, MaxSchemaVersion: FormatVersion, Reason: "formatVersion"));
                }
                if (engine is not { } range || engineFacts is not { } facts) throw Corrupt("The save has no game data.", null);
                var engineBytes = utf8[range.Start..range.End];
                CheckEngineVersion(facts.SchemaVersion);
                return new ParsedSave(engineBytes, facts, sidecar, meta, contentHash, Legacy: false, client);
            }
            if (hasSchemaVersion)
            {
                var facts = ScanEngine(span, catalog);
                CheckEngineVersion(facts.SchemaVersion);
                return new ParsedSave(utf8, facts, null, null, null, Legacy: true);
            }
            throw Corrupt("This file is not a Magnate save.", null);
        }
        catch (JsonException ex)
        {
            throw Corrupt("The save is not valid JSON.", ex);
        }
    }

    /// <summary>
    /// End (exclusive) of an envelope's last member that starts at <paramref name="start"/>: the
    /// object's closing brace is the last one before the envelope's own.
    /// </summary>
    private static int EngineEndBeforeRootClose(ReadOnlySpan<byte> utf8, int start)
    {
        var i = utf8.Length - 1;
        while (i > start && IsJsonWhitespace(utf8[i])) i--;
        if (i <= start || utf8[i] != (byte)'}') throw Corrupt("The save is truncated.", null);
        i--;
        while (i > start && IsJsonWhitespace(utf8[i])) i--;
        if (i <= start || utf8[i] != (byte)'}') throw Corrupt("The save is truncated.", null);
        return i + 1;
    }

    private static bool IsJsonWhitespace(byte b) => b is (byte)' ' or (byte)'\n' or (byte)'\r' or (byte)'\t';

    /// <summary>
    /// The facts a trusted load needs from the engine part: only its schema version, which
    /// <c>WorldSaver</c> writes as the first member (read without walking the rest).
    /// </summary>
    private static EngineFacts HeadFacts(ReadOnlySpan<byte> engineJson)
    {
        var reader = new Utf8JsonReader(engineJson, ReaderOptions);
        if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) throw Corrupt("The save's game data is not a JSON object.", null);
        var facts = new EngineFacts();
        while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
        {
            if (reader.ValueTextEquals("schemaVersion"u8))
            {
                facts.SchemaVersion = ReadInt(ref reader) ?? 0;
                return facts;
            }
            reader.Read();
            reader.Skip();
        }
        return facts;
    }

    private static void CheckEngineVersion(int schema)
    {
        var min = Magnate.Engine.Persistence.WorldSaver.MinSupportedSchemaVersion;
        var max = Magnate.Engine.Persistence.WorldSaver.SchemaVersion;
        if (schema < min || schema > max)
        {
            throw new BridgeException(BridgeErrorCodes.SaveVersionUnsupported,
                schema > max ? "This save was written by a newer version of Magnate." : "This save is too old to load.",
                null,
                new ErrorDetailsDto(SchemaVersion: schema, MinSchemaVersion: min, MaxSchemaVersion: max));
        }
    }

    // ------------------------------------------------------------------ the engine scan

    /// <summary>Top-level engine sections the scan reads (everything else is only checked for content ids).</summary>
    private enum Section
    {
        Other,
        Clock,
        Companies,
        PatentsEverGranted,
    }

    /// <summary>
    /// One forward pass over the engine JSON (camelCase, as <c>WorldSaver</c> writes it):
    /// the schema version, scenario and player, clock, company names and cash, patents ever granted, and every <c>productId</c>/<c>product</c>,
    /// <c>cityId</c> and <c>typeId</c> value checked against the catalog. Content ids are
    /// compared as UTF-8 bytes, so the common case allocates nothing.
    /// </summary>
    internal static EngineFacts ScanEngine(ReadOnlySpan<byte> json, ContentCatalog catalog)
    {
        var reader = new Utf8JsonReader(json, ReaderOptions);
        if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) throw Corrupt("The save's game data is not a JSON object.", null);
        return ScanEngine(ref reader, catalog);
    }

    /// <summary>
    /// The scan over the engine object whose <c>StartObject</c> the reader is on (the root of a
    /// legacy save, or the envelope's <c>engine</c> member); leaves the reader on its <c>EndObject</c>.
    /// Depths below are relative to that object.
    /// </summary>
    private static EngineFacts ScanEngine(ref Utf8JsonReader reader, ContentCatalog catalog)
    {
        var facts = new EngineFacts();
        var products = new Utf8IdSet(catalog.Products.Keys.Select(k => k.Value));
        var cities = new Utf8IdSet(catalog.Cities.Keys.Select(k => k.Value));
        var types = new Utf8IdSet(catalog.BuildingTypes.Keys.Select(k => k.Value));
        var baseDepth = reader.CurrentDepth;

        var section = Section.Other;
        // Fields of the item (or clock object) being read.
        int? id = null, holder = null, year = null, month = null;
        string? name = null, cash = null, product = null;

        while (reader.Read())
        {
            var depth = reader.CurrentDepth - baseDepth;
            if (depth == 0 && reader.TokenType == JsonTokenType.EndObject) break;
            switch (reader.TokenType)
            {
                case JsonTokenType.PropertyName when depth == 1:
                    section = Section.Other;
                    if (reader.ValueTextEquals("schemaVersion"u8))
                    {
                        reader.Read();
                        facts.SchemaVersion = reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var sv) ? sv : 0;
                    }
                    else if (reader.ValueTextEquals("scenarioId"u8))
                    {
                        reader.Read();
                        facts.ScenarioId = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
                    }
                    else if (reader.ValueTextEquals("playerId"u8))
                    {
                        reader.Read();
                        facts.PlayerId = reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var pid) ? pid : null;
                    }
                    else if (reader.ValueTextEquals("clock"u8)) section = Section.Clock;
                    else if (reader.ValueTextEquals("companies"u8)) section = Section.Companies;
                    else if (reader.ValueTextEquals("patentsEverGranted"u8)) section = Section.PatentsEverGranted;
                    break;

                case JsonTokenType.PropertyName:
                {
                    // Content references anywhere in the file.
                    var reference = ReferenceOf(ref reader);
                    if (reference == Reference.Product)
                    {
                        reader.Read();
                        if (reader.TokenType == JsonTokenType.String)
                        {
                            Check(ref reader, products, "product:", facts);
                            if (section == Section.PatentsEverGranted && depth == 3) product = reader.GetString();
                        }
                        break;
                    }
                    if (reference == Reference.City)
                    {
                        reader.Read();
                        if (reader.TokenType == JsonTokenType.String) Check(ref reader, cities, "city:", facts);
                        break;
                    }
                    if (reference == Reference.BuildingType)
                    {
                        reader.Read();
                        if (reader.TokenType == JsonTokenType.String) Check(ref reader, types, "buildingType:", facts);
                        break;
                    }
                    // Fields of the small sections the bridge reads.
                    if (section == Section.Clock && depth == 2)
                    {
                        if (reader.ValueTextEquals("year"u8)) year = ReadInt(ref reader);
                        else if (reader.ValueTextEquals("month"u8)) month = ReadInt(ref reader);
                    }
                    else if (depth == 3 && section == Section.Companies)
                    {
                        if (reader.ValueTextEquals("id"u8)) id = ReadInt(ref reader);
                        else if (reader.ValueTextEquals("name"u8)) name = ReadString(ref reader);
                        else if (reader.ValueTextEquals("cash"u8)) cash = ReadString(ref reader);
                    }
                    else if (depth == 3 && section == Section.PatentsEverGranted && reader.ValueTextEquals("holder"u8))
                    {
                        holder = ReadInt(ref reader);
                    }
                    break;
                }

                case JsonTokenType.StartObject when depth == 2 || (depth == 1 && section == Section.Clock):
                    id = holder = year = month = null;
                    name = cash = product = null;
                    break;

                case JsonTokenType.EndObject when depth == 1 && section == Section.Clock:
                    if (year is int y && month is int m) facts.Clock = new DateDto(y, m);
                    break;

                case JsonTokenType.EndObject when depth == 2:
                    switch (section)
                    {
                        case Section.Companies when id is int companyId:
                            facts.Companies[companyId] = (name ?? "", cash ?? "0");
                            break;
                        case Section.PatentsEverGranted when holder is int h && product is { } p:
                            facts.PatentsEverGranted.Add((h, p));
                            break;
                    }
                    break;
            }
        }
        return facts;
    }

    private enum Reference
    {
        None,
        Product,
        City,
        BuildingType,
    }

    /// <summary>
    /// Which content id the current property name holds (<c>productId</c>/<c>product</c>,
    /// <c>cityId</c>, <c>typeId</c>). Dispatches on the name's length first: almost every
    /// property of a save is something else, and this runs for each of them.
    /// </summary>
    private static Reference ReferenceOf(ref Utf8JsonReader reader)
    {
        if (reader.ValueIsEscaped || reader.HasValueSequence)
        {
            if (reader.ValueTextEquals("productId"u8) || reader.ValueTextEquals("product"u8)) return Reference.Product;
            if (reader.ValueTextEquals("cityId"u8)) return Reference.City;
            return reader.ValueTextEquals("typeId"u8) ? Reference.BuildingType : Reference.None;
        }
        var name = reader.ValueSpan;
        return name.Length switch
        {
            9 when name.SequenceEqual("productId"u8) => Reference.Product,
            7 when name.SequenceEqual("product"u8) => Reference.Product,
            6 when name.SequenceEqual("cityId"u8) => Reference.City,
            6 when name.SequenceEqual("typeId"u8) => Reference.BuildingType,
            _ => Reference.None,
        };
    }

    /// <summary>Record the current string token as missing unless it is one of <paramref name="known"/>.</summary>
    private static void Check(ref Utf8JsonReader reader, Utf8IdSet known, string kind, EngineFacts facts)
    {
        if (reader.ValueIsEscaped || reader.HasValueSequence)
        {
            var text = reader.GetString() ?? "";
            if (!known.Contains(Encoding.UTF8.GetBytes(text))) facts.Missing.Add(kind + text);
            return;
        }
        if (!known.Contains(reader.ValueSpan)) facts.Missing.Add(kind + reader.GetString());
    }

    /// <summary>
    /// Content ids as UTF-8 bytes, looked up by an FNV-1a hash of the token so a 10-year save's
    /// ~100k references cost one hash and one compare each (no string allocation).
    /// </summary>
    private sealed class Utf8IdSet
    {
        private readonly Dictionary<ulong, List<byte[]>> _byHash = new();

        public Utf8IdSet(IEnumerable<string> ids)
        {
            foreach (var id in ids)
            {
                var bytes = Encoding.UTF8.GetBytes(id);
                var hash = Hash(bytes);
                if (!_byHash.TryGetValue(hash, out var bucket)) _byHash[hash] = bucket = new List<byte[]>(1);
                bucket.Add(bytes);
            }
        }

        public bool Contains(ReadOnlySpan<byte> value)
        {
            if (!_byHash.TryGetValue(Hash(value), out var bucket)) return false;
            foreach (var candidate in bucket)
            {
                if (value.SequenceEqual(candidate)) return true;
            }
            return false;
        }

        private static ulong Hash(ReadOnlySpan<byte> value)
        {
            var hash = 14695981039346656037UL;
            foreach (var b in value)
            {
                hash = (hash ^ b) * 1099511628211UL;
            }
            return hash;
        }
    }

    private static int? ReadInt(ref Utf8JsonReader reader)
    {
        reader.Read();
        return reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var v) ? v : null;
    }

    private static string? ReadString(ref Utf8JsonReader reader)
    {
        reader.Read();
        return reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
    }

    public static BridgeException Corrupt(string message, Exception? inner)
        => new(BridgeErrorCodes.SaveCorrupt, message, null,
            inner is null ? null : new ErrorDetailsDto(DevMessage: $"{inner.GetType().Name}: {inner.Message}"));
}
