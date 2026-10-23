using System;
using System.Collections.Generic;
using System.Linq;

namespace Magnate.Engine.Content;

public sealed class ContentLoadException : Exception
{
    public IReadOnlyList<string> Errors { get; }

    public ContentLoadException(IReadOnlyList<string> errors)
        : base(FormatMessage(errors))
    {
        Errors = errors;
    }

    private static string FormatMessage(IReadOnlyList<string> errors)
    {
        var header = $"Content load failed with {errors.Count} error(s):";
        var body = string.Join(Environment.NewLine, errors.Select(e => "  - " + e));
        return header + Environment.NewLine + body;
    }
}
