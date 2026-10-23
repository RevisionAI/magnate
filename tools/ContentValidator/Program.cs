using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Json.Schema;
using Magnate.Engine.Content;
using Magnate.Engine.Domain;
using Magnate.Engine.Market;

namespace Magnate.ContentValidator;

internal static class Program
{
    private static int Main(string[] args)
    {
        var contentRoot = args.Length > 0
            ? args[0]
            : DefaultContentRoot();

        Console.WriteLine($"Validating content at {contentRoot}");
        Console.WriteLine();

        var schemaErrors = ValidateAgainstJsonSchemas(contentRoot).ToList();
        foreach (var error in schemaErrors)
        {
            Console.Error.WriteLine("[schema] " + error);
        }

        List<string> semanticErrors = new();
        try
        {
            var catalog = ContentLoader.Load(contentRoot);
            Console.WriteLine($"Loaded {catalog.Products.Count} products, {catalog.BuildingTypes.Count} building types, {catalog.Cities.Count} cities.");
            semanticErrors.AddRange(ValidateMarketCoverage(catalog));
        }
        catch (ContentLoadException ex)
        {
            semanticErrors.AddRange(ex.Errors);
        }

        foreach (var error in semanticErrors)
        {
            Console.Error.WriteLine("[semantic] " + error);
        }

        var total = schemaErrors.Count + semanticErrors.Count;
        Console.WriteLine();
        if (total == 0)
        {
            Console.WriteLine("OK — no errors.");
            return 0;
        }

        Console.Error.WriteLine($"FAILED with {total} error(s).");
        return 1;
    }

    /// <summary>
    /// Market cross-checks the loader cannot make per item (econ-audit §4.1–4.3): every consumer
    /// good must be sellable in at least one store format, and its reference store (which sizes
    /// the incumbent local competition) must be a retail format that draws its category.
    /// </summary>
    private static IEnumerable<string> ValidateMarketCoverage(ContentCatalog catalog)
    {
        var stores = catalog.BuildingTypes.Values.Where(t => t.Retail).OrderBy(t => t.Id.Value, StringComparer.Ordinal).ToList();
        foreach (var product in catalog.Products.Values.OrderBy(p => p.Id.Value, StringComparer.Ordinal))
        {
            if (product.Demand is not { } demand) continue;
            if (!stores.Any(t => RetailMarket.Draw(t, product) > 0))
            {
                yield return $"product '{product.Id}': no retail building type draws its retail category '{demand.RetailCategory}', so it can never be sold";
            }

            if (!catalog.BuildingTypes.TryGetValue(demand.ReferenceStore, out var reference) || !reference.Retail)
            {
                yield return $"product '{product.Id}': referenceStore '{demand.ReferenceStore}' is not a retail building type";
            }
            else if (RetailMarket.Draw(reference, product) <= 0)
            {
                yield return $"product '{product.Id}': referenceStore '{demand.ReferenceStore}' does not draw retail category '{demand.RetailCategory}'";
            }
        }
    }

    private static string DefaultContentRoot()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "global.json")))
        {
            dir = dir.Parent;
        }

        return dir is null
            ? Path.Combine(Directory.GetCurrentDirectory(), "content")
            : Path.Combine(dir.FullName, "content");
    }

    private static IEnumerable<string> ValidateAgainstJsonSchemas(string contentRoot)
    {
        var schemasDir = Path.Combine(contentRoot, "schemas");
        if (!Directory.Exists(schemasDir))
        {
            yield return $"schemas directory missing: {schemasDir}";
            yield break;
        }

        var schemas = new Dictionary<string, JsonSchema>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.EnumerateFiles(schemasDir, "*.schema.json"))
        {
            var name = Path.GetFileNameWithoutExtension(file);            // e.g. "product.schema"
            var key = name.Replace(".schema", string.Empty, StringComparison.Ordinal);
            schemas[key] = JsonSchema.FromFile(file);
        }

        foreach (var error in ValidateDir(contentRoot, "products",  schemas.GetValueOrDefault("product"),       expectArray: true))  yield return error;
        foreach (var error in ValidateDir(contentRoot, "buildings", schemas.GetValueOrDefault("building-type"), expectArray: true))  yield return error;
        foreach (var error in ValidateDir(contentRoot, "cities",    schemas.GetValueOrDefault("city"),          expectArray: false)) yield return error;
    }

    private static IEnumerable<string> ValidateDir(string contentRoot, string subdir, JsonSchema? schema, bool expectArray)
    {
        if (schema is null)
        {
            yield return $"no schema registered for {subdir}";
            yield break;
        }

        var dir = Path.Combine(contentRoot, "data", subdir);
        if (!Directory.Exists(dir))
        {
            yield break;
        }

        var options = new EvaluationOptions { OutputFormat = OutputFormat.List };

        foreach (var file in Directory.EnumerateFiles(dir, "*.json"))
        {
            JsonNode? root = null;
            string? parseError = null;
            try
            {
                using var stream = File.OpenRead(file);
                root = JsonNode.Parse(stream);
            }
            catch (Exception ex)
            {
                parseError = ex.Message;
            }

            if (parseError is not null)
            {
                yield return $"{file}: parse error — {parseError}";
                continue;
            }

            if (root is null)
            {
                yield return $"{file}: file is empty";
                continue;
            }

            if (expectArray)
            {
                if (root is not JsonArray array)
                {
                    yield return $"{file}: expected top-level JSON array";
                    continue;
                }

                for (var i = 0; i < array.Count; i++)
                {
                    var element = array[i];
                    if (element is null)
                    {
                        yield return $"{file}[{i}]: null element";
                        continue;
                    }

                    var result = schema.Evaluate(element, options);
                    if (!result.IsValid)
                    {
                        foreach (var line in FormatResult(result, $"{file}[{i}]"))
                        {
                            yield return line;
                        }
                    }
                }
            }
            else
            {
                var result = schema.Evaluate(root, options);
                if (!result.IsValid)
                {
                    foreach (var line in FormatResult(result, file))
                    {
                        yield return line;
                    }
                }
            }
        }
    }

    private static IEnumerable<string> FormatResult(EvaluationResults result, string origin)
    {
        var details = result.Details?.Where(d => d.HasErrors) ?? Enumerable.Empty<EvaluationResults>();
        foreach (var detail in details)
        {
            if (detail.Errors is null)
            {
                continue;
            }

            foreach (var (key, message) in detail.Errors)
            {
                yield return $"{origin} @ {detail.InstanceLocation}: {key} — {message}";
            }
        }

        if (result.Errors is not null)
        {
            foreach (var (key, message) in result.Errors)
            {
                yield return $"{origin} @ {result.InstanceLocation}: {key} — {message}";
            }
        }
    }
}
