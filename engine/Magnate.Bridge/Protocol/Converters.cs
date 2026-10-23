using System;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Magnate.Bridge;

/// <summary>
/// Global <see cref="decimal"/> converter (bridge-spec §4.4). Money leaves the
/// bridge as a JSON number rounded half-even to 2 dp — the engine carries up to
/// 28 digits (<c>74973577156.360723454334219791</c>) which bloats payloads and
/// makes UI equality checks flaky. Totals are rounded from exact sums.
/// Reading accepts a JSON number (parsed exactly from the token text, so
/// <c>1.8</c> → <c>1.8m</c>) or a numeric string.
/// </summary>
public sealed class MoneyConverter : JsonConverter<decimal>
{
    /// <inheritdoc />
    public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => MoneyJson.Read(ref reader);

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options)
        => writer.WriteNumberValue(MoneyJson.Round(value, 2));
}

/// <summary>
/// Unit prices and unit costs keep 4 dp (an intermediate's unit cost is often a
/// fraction of a cent). Applied per property with
/// <c>[property: JsonConverter(typeof(Money4ConverterFactory))]</c> on
/// <see cref="decimal"/> or <see cref="Nullable{Decimal}"/> members.
/// </summary>
public sealed class Money4ConverterFactory : JsonConverterFactory
{
    /// <inheritdoc />
    public override bool CanConvert(Type typeToConvert)
        => typeToConvert == typeof(decimal) || typeToConvert == typeof(decimal?);

    /// <inheritdoc />
    public override JsonConverter? CreateConverter(Type typeToConvert, JsonSerializerOptions options)
        => typeToConvert == typeof(decimal) ? new Money4Converter() : new NullableMoney4Converter();

    private sealed class Money4Converter : JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            => MoneyJson.Read(ref reader);

        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options)
            => writer.WriteNumberValue(MoneyJson.Round(value, 4));
    }

    private sealed class NullableMoney4Converter : JsonConverter<decimal?>
    {
        public override decimal? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            => reader.TokenType == JsonTokenType.Null ? null : MoneyJson.Read(ref reader);

        public override void Write(Utf8JsonWriter writer, decimal? value, JsonSerializerOptions options)
        {
            if (value is decimal v) writer.WriteNumberValue(MoneyJson.Round(v, 4));
            else writer.WriteNullValue();
        }
    }
}

/// <summary>
/// Global <see cref="double"/> converter: quantities, shares, quality and brand
/// travel as the shortest round-trip number, and <b>non-finite values become
/// <c>null</c></b>. System.Text.Json throws on NaN by default, which would turn a
/// harmless divide-by-zero into an <c>internal</c> error (bridge-spec §4.4).
/// </summary>
public sealed class FiniteDoubleConverter : JsonConverter<double>
{
    /// <inheritdoc />
    public override double Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var text = reader.GetString();
            if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)) return parsed;
            throw new JsonException($"'{text}' is not a number");
        }
        return reader.GetDouble();
    }

    /// <inheritdoc />
    public override void Write(Utf8JsonWriter writer, double value, JsonSerializerOptions options)
    {
        if (double.IsFinite(value)) writer.WriteNumberValue(value);
        else writer.WriteNullValue();
    }
}

internal static class MoneyJson
{
    /// <summary>Exactly one, at the maximum scale: dividing by it keeps the value and drops trailing zeros.</summary>
    private const decimal One = 1.0000000000000000000000000000m;

    /// <summary>
    /// Round half-even to <paramref name="decimals"/> places and drop trailing zeros, so
    /// <c>8870000.00m</c> is written as <c>8870000</c> and <c>1234.50m</c> as <c>1234.5</c>
    /// (decimals keep their scale, and the JSON writer prints it).
    /// </summary>
    /// <remarks>
    /// Hot path of every response (a ten-year <c>history</c> writes ≈ 6,600 amounts): a value
    /// whose scale is already within <paramref name="decimals"/> and whose last digit is not
    /// zero is returned untouched, skipping both the rounding and the (slow) decimal division.
    /// </remarks>
    public static decimal Round(decimal value, int decimals)
    {
        Span<int> bits = stackalloc int[4];
        decimal.GetBits(value, bits);
        var scale = (bits[3] >> 16) & 0xFF;
        if (scale == 0) return value;
        if (scale > decimals)
        {
            value = Math.Round(value, decimals, MidpointRounding.ToEven);
            decimal.GetBits(value, bits);
            if (((bits[3] >> 16) & 0xFF) == 0) return value;
        }
        // The 96-bit mantissa mod 10 (2^32 ≡ 2^64 ≡ 6 mod 10): a non-zero last digit means no trailing zeros.
        var lastDigit = ((uint)bits[2] % 10 * 6 + (uint)bits[1] % 10 * 6 + (uint)bits[0] % 10) % 10;
        return lastDigit != 0 ? value : value / One;
    }

    public static decimal Read(ref Utf8JsonReader reader)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            var text = reader.GetString();
            if (decimal.TryParse(text, NumberStyles.Number | NumberStyles.AllowExponent, CultureInfo.InvariantCulture, out var parsed))
            {
                return parsed;
            }
            throw new JsonException($"'{text}' is not a number");
        }
        if (reader.TokenType != JsonTokenType.Number) throw new JsonException("expected a number");
        if (reader.TryGetDecimal(out var value)) return value;
        // Exponent forms beyond decimal's range (or 1e400) are not money.
        throw new JsonException("number is out of range for a money amount");
    }
}
