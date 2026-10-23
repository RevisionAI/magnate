using System;

namespace Magnate.Bridge;

/// <summary>
/// Marks a <see cref="GameSession"/> instance method as callable over the bridge
/// under <see cref="Name"/>. A handler takes either no parameters or exactly one
/// args record (deserialized from the request's args JSON), and returns a DTO
/// (serialized as the response <c>result</c>) or <c>void</c>.
/// </summary>
/// <remarks>
/// Handlers are discovered by reflection, so each feature area can live in its
/// own <c>GameSession.&lt;Area&gt;.cs</c> partial file without a central
/// registry — parallel feature work never collides on one switch statement.
/// </remarks>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class BridgeMethodAttribute : Attribute
{
    /// <summary>The protocol method name (camelCase), e.g. <c>newGame</c>.</summary>
    public string Name { get; }

    /// <summary>
    /// True when the handler mutates game state. The session bumps
    /// <see cref="GameSession.Revision"/> after every successful mutating call so
    /// the client can cheaply detect staleness.
    /// </summary>
    public bool Mutates { get; init; }

    /// <summary>True when the method needs an active game (World). Defaults to true.</summary>
    public bool RequiresGame { get; init; } = true;

    /// <summary>Register a handler under <paramref name="name"/>.</summary>
    public BridgeMethodAttribute(string name)
    {
        Name = name;
    }
}
