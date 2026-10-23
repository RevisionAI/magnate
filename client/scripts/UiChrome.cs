using System;
using System.Globalization;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Small shared visual helpers for the Godot client. Kept code-only so the
/// existing scenes can be upgraded without a large theme-resource migration.
/// </summary>
internal static class UiChrome
{
    public const string TitleBackdrop = "res://assets/ui/title_empire.png";
    public const string OperationsBackdrop = "res://assets/ui/operations_room.png";
    public const string CityBackdrop = "res://assets/ui/city_economy.png";

    public static readonly Color Ink = FromHex("0b1117");
    public static readonly Color Panel = FromHex("101a22");
    public static readonly Color PanelAlt = FromHex("15222c");
    public static readonly Color Stroke = FromHex("375263");
    public static readonly Color Gold = FromHex("d7b766");
    public static readonly Color Blue = FromHex("5aa7d8");
    public static readonly Color Green = FromHex("61c28f");
    public static readonly Color Red = FromHex("df6f6a");
    public static readonly Color Muted = FromHex("9fb2bd");

    public static void InstallBackdrop(Control root, string texturePath, Color modulate, Color overlay)
    {
        if (root.GetNodeOrNull<TextureRect>("ArtBackdrop") is not null) return;

        var texture = LoadTexture(texturePath);
        if (texture is null)
        {
            GD.PushWarning($"[UiChrome] missing backdrop: {texturePath}");
            return;
        }

        var art = new TextureRect
        {
            Name = "ArtBackdrop",
            Texture = texture,
            ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize,
            StretchMode = TextureRect.StretchModeEnum.KeepAspectCovered,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            Modulate = modulate,
        };
        FullRect(art);
        root.AddChild(art);
        root.MoveChild(art, 0);

        var shade = new ColorRect
        {
            Name = "ArtShade",
            Color = overlay,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        FullRect(shade);
        root.AddChild(shade);
        root.MoveChild(shade, 1);
    }

    public static Texture2D? LoadTexture(string texturePath)
    {
        var image = Image.LoadFromFile(texturePath);
        if (image is null || image.IsEmpty())
        {
            image = Image.LoadFromFile(ProjectSettings.GlobalizePath(texturePath));
        }
        if (image is null || image.IsEmpty()) return null;
        return ImageTexture.CreateFromImage(image);
    }

    public static void FullRect(Control control)
    {
        control.AnchorLeft = 0f;
        control.AnchorTop = 0f;
        control.AnchorRight = 1f;
        control.AnchorBottom = 1f;
        control.OffsetLeft = 0f;
        control.OffsetTop = 0f;
        control.OffsetRight = 0f;
        control.OffsetBottom = 0f;
        control.GrowHorizontal = Control.GrowDirection.Both;
        control.GrowVertical = Control.GrowDirection.Both;
    }

    public static StyleBoxFlat Box(
        Color? bg = null,
        Color? border = null,
        int borderWidth = 1,
        int radius = 6,
        int marginX = 12,
        int marginY = 10)
    {
        var box = new StyleBoxFlat
        {
            BgColor = bg ?? new Color(Panel.R, Panel.G, Panel.B, 0.88f),
            BorderColor = border ?? new Color(Stroke.R, Stroke.G, Stroke.B, 0.72f),
            ContentMarginLeft = marginX,
            ContentMarginRight = marginX,
            ContentMarginTop = marginY,
            ContentMarginBottom = marginY,
            CornerRadiusTopLeft = radius,
            CornerRadiusTopRight = radius,
            CornerRadiusBottomLeft = radius,
            CornerRadiusBottomRight = radius,
        };
        box.BorderWidthLeft = borderWidth;
        box.BorderWidthRight = borderWidth;
        box.BorderWidthTop = borderWidth;
        box.BorderWidthBottom = borderWidth;
        return box;
    }

    public static PanelContainer StatCard(string title, string value, Color accent, string? detail = null)
    {
        var card = new PanelContainer
        {
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
            CustomMinimumSize = new Vector2(190, 92),
        };
        card.AddThemeStyleboxOverride("panel", Box(
            new Color(0.06f, 0.10f, 0.13f, 0.88f),
            new Color(accent.R, accent.G, accent.B, 0.58f),
            marginX: 14,
            marginY: 10));

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);
        card.AddChild(vbox);

        var t = new Label { Text = title };
        t.Modulate = Muted;
        t.AddThemeFontSizeOverride("font_size", 12);
        vbox.AddChild(t);

        var val = new Label
        {
            Text = value,
            ClipText = true,
        };
        val.AddThemeFontSizeOverride("font_size", 24);
        val.AddThemeColorOverride("font_color", accent);
        vbox.AddChild(val);

        if (!string.IsNullOrWhiteSpace(detail))
        {
            var d = new Label
            {
                Text = detail,
                ClipText = true,
            };
            d.Modulate = new Color(0.78f, 0.86f, 0.90f, 0.82f);
            d.AddThemeFontSizeOverride("font_size", 12);
            vbox.AddChild(d);
        }

        return card;
    }

    public static Button NavButton(string text, string tooltip)
    {
        var button = new Button
        {
            Text = text,
            CustomMinimumSize = new Vector2(150, 38),
            SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
        };
        Tooltip.Attach(button, tooltip);
        return button;
    }

    public static Label SectionTitle(string text)
    {
        var label = new Label { Text = text };
        label.AddThemeFontSizeOverride("font_size", 18);
        label.AddThemeColorOverride("font_color", Gold);
        return label;
    }

    public static string MoneyShort(decimal value)
    {
        var abs = Math.Abs(value);
        var sign = value < 0 ? "-" : "";
        if (abs >= 1_000_000_000m) return $"{sign}${abs / 1_000_000_000m:0.0}B";
        if (abs >= 1_000_000m) return $"{sign}${abs / 1_000_000m:0.0}M";
        if (abs >= 1_000m) return $"{sign}${abs / 1_000m:0.0}K";
        return value.ToString("C0", CultureInfo.GetCultureInfo("en-US"));
    }

    public static Color FromHex(string hex, float alpha = 1f)
    {
        hex = hex.TrimStart('#');
        var r = Convert.ToInt32(hex[..2], 16) / 255f;
        var g = Convert.ToInt32(hex.Substring(2, 2), 16) / 255f;
        var b = Convert.ToInt32(hex.Substring(4, 2), 16) / 255f;
        return new Color(r, g, b, alpha);
    }
}
