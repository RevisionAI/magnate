using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace Magnate.Bridge;

/// <summary>
/// Shared JSON conventions for the bridge protocol (bridge-spec §4.4).
/// Everything crossing the bridge is camelCase; nulls are omitted to keep
/// payloads small; money (<see cref="decimal"/>) is a JSON number rounded
/// half-even to 2 dp (4 dp for unit prices, per property); non-finite doubles
/// become <c>null</c>.
/// </summary>
/// <remarks>
/// Type metadata comes from the source-generated <see cref="BridgeJsonContext"/>
/// first (trim-safe, no first-use reflection cost in the WASM interpreter) and
/// falls back to the reflection resolver for any type the context does not list,
/// so a forgotten <c>[JsonSerializable]</c> degrades to "slower", never to
/// "broken". <c>BridgeJsonContextTests</c> keeps the list complete.
/// </remarks>
public static class BridgeJson
{
    /// <summary>Options used for every request and response.</summary>
    public static readonly JsonSerializerOptions Options = Create();

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
            TypeInfoResolver = JsonTypeInfoResolver.Combine(BridgeJsonContext.Default, new DefaultJsonTypeInfoResolver()),
        };
        options.Converters.Add(new MoneyConverter());
        options.Converters.Add(new FiniteDoubleConverter());
        options.MakeReadOnly();
        return options;
    }
}
