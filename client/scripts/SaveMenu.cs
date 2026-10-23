using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Godot;
using Magnate.Engine.Persistence;
using Magnate.Engine.Scenarios;
using Magnate.Engine.Simulation;

namespace Magnate.Client;

/// <summary>
/// In-game save/load hub opened from Main. Lists all saves under
/// <see cref="OS.GetUserDataDir"/> (plus the autosaves subdir), and lets the
/// player save the active world, load a save, rename, or delete a file.
/// Unlike <see cref="SaveBrowser"/> (reachable only from the title screen),
/// SaveMenu returns to <c>Main.tscn</c> on back — it's an in-session menu.
/// Phase 3.47 added rename, confirm-on-delete, sort options, autosave badge,
/// and Ctrl+S quick-save.
/// </summary>
public partial class SaveMenu : Node
{
    private enum SortMode
    {
        ModifiedDesc,
        NameAsc,
        SizeDesc,
        SchemaDesc,
    }

    private VBoxContainer? _list;
    private Label? _statusLabel;
    private LineEdit? _filenameEdit;
    private OptionButton? _sortDropdown;

    private SortMode _sortMode = SortMode.ModifiedDesc;

    public override void _Ready()
    {
        _list         = GetNode<VBoxContainer>("Panel/VBox/Scroll/SaveList");
        _statusLabel  = GetNode<Label>("Panel/VBox/StatusLabel");
        _filenameEdit = GetNode<LineEdit>("Panel/VBox/SaveRow/FilenameEdit");
        _sortDropdown = GetNodeOrNull<OptionButton>("Panel/VBox/SortRow/SortDropdown");

        GetNode<Label>("Panel/VBox/HintLabel").Text =
            $"Saves directory: {OS.GetUserDataDir()}";

        GetNode<Button>("Panel/VBox/SaveRow/SaveNowButton").Pressed += OnSaveNow;
        GetNode<Button>("Panel/VBox/BackButton").Pressed += OnBack;

        if (_sortDropdown is not null)
        {
            _sortDropdown.Clear();
            _sortDropdown.AddItem("Sort: Modified (newest first)", (int)SortMode.ModifiedDesc);
            _sortDropdown.AddItem("Sort: Name (A → Z)",            (int)SortMode.NameAsc);
            _sortDropdown.AddItem("Sort: Size (largest first)",    (int)SortMode.SizeDesc);
            _sortDropdown.AddItem("Sort: Schema version",          (int)SortMode.SchemaDesc);
            _sortDropdown.Selected = 0;
            _sortDropdown.ItemSelected += OnSortChanged;
        }

        // Suggest a sensible default filename based on the current scenario+date.
        _filenameEdit.Text = SuggestFilename();

        RefreshList();
    }

    private string SuggestFilename()
    {
        var safe = string.Join("_", GameState.ScenarioName.Split(Path.GetInvalidFileNameChars()));
        var date = GameState.World is { } w ? w.Clock.Now.ToString() : DateTime.Now.ToString("yyyyMM");
        return $"{safe}-{date}";
    }

    private void OnSortChanged(long index)
    {
        _sortMode = (SortMode)(int)index;
        RefreshList();
    }

    // ---------------------------------------------------------- save list

    private void RefreshList()
    {
        if (_list is null) return;
        foreach (var child in _list.GetChildren()) child.QueueFree();

        var rootDir = OS.GetUserDataDir();
        Directory.CreateDirectory(rootDir);
        var autosaveDir = Path.Combine(rootDir, "autosaves");

        var manualRaw = WorldSaver.ListSaves(rootDir);
        var autosRaw  = WorldSaver.ListSaves(autosaveDir);

        var manual = SortSaves(manualRaw);
        var autos  = SortSaves(autosRaw);

        if (manual.Count == 0 && autos.Count == 0)
        {
            _list.AddChild(new Label { Text = "No saves yet. Use 'Save Now' below to create one." });
            return;
        }

        if (manual.Count > 0)
        {
            _list.AddChild(SectionHeader("Manual saves"));
            foreach (var info in manual) _list.AddChild(BuildRow(info, isAutosave: false));
        }
        if (autos.Count > 0)
        {
            _list.AddChild(SectionHeader("Autosaves"));
            foreach (var info in autos) _list.AddChild(BuildRow(info, isAutosave: true));
        }
    }

    private List<SaveFileInfo> SortSaves(IReadOnlyList<SaveFileInfo> source)
    {
        return _sortMode switch
        {
            SortMode.NameAsc      => source.OrderBy(s => s.FileName, StringComparer.OrdinalIgnoreCase).ToList(),
            SortMode.SizeDesc     => source.OrderByDescending(s => s.FileSize).ToList(),
            SortMode.SchemaDesc   => source.OrderByDescending(s => s.SchemaVersion)
                                           .ThenByDescending(s => s.Timestamp).ToList(),
            _                     => source.OrderByDescending(s => s.Timestamp).ToList(),
        };
    }

    private static Label SectionHeader(string text)
    {
        var l = new Label { Text = text };
        l.AddThemeFontSizeOverride("font_size", 18);
        return l;
    }

    private static bool IsAutosaveName(string name) =>
        name.StartsWith("autosave_", StringComparison.OrdinalIgnoreCase);

    private Control BuildRow(SaveFileInfo info, bool isAutosave)
    {
        var panel = new PanelContainer();
        if (isAutosave)
        {
            // Subtle tint so autosaves stand out at a glance.
            var sb = new StyleBoxFlat
            {
                BgColor = new Color(0.18f, 0.22f, 0.28f, 1f),
                ContentMarginLeft = 8, ContentMarginRight = 8,
                ContentMarginTop = 6, ContentMarginBottom = 6,
            };
            panel.AddThemeStyleboxOverride("panel", sb);
        }

        var vbox = new VBoxContainer();
        vbox.AddThemeConstantOverride("separation", 4);
        panel.AddChild(vbox);

        // Header row: badge + name
        var headerBox = new HBoxContainer();
        headerBox.AddThemeConstantOverride("separation", 6);
        if (isAutosave)
        {
            var badge = new RichTextLabel
            {
                BbcodeEnabled = true,
                FitContent = true,
                ScrollActive = false,
                CustomMinimumSize = new Vector2(36, 0),
            };
            badge.Text = "[bgcolor=#3a6ea5][color=white][b] A [/b][/color][/bgcolor]";
            headerBox.AddChild(badge);
        }
        var nameLabel = new Label { Text = info.FileName };
        nameLabel.AddThemeFontSizeOverride("font_size", 16);
        headerBox.AddChild(nameLabel);
        vbox.AddChild(headerBox);

        var scenario = info.ScenarioId ?? "(no scenario)";
        var meta = $"{info.GameDate}  ·  {scenario}  ·  {info.Timestamp:yyyy-MM-dd HH:mm}  ·  {info.FileSize / 1024} KB  ·  schema v{info.SchemaVersion}";
        vbox.AddChild(new Label { Text = meta });

        var buttons = new HBoxContainer();
        buttons.AddThemeConstantOverride("separation", 8);

        var loadBtn = new Button { Text = "Load" };
        loadBtn.Pressed += () => OnLoad(info.FullPath);
        buttons.AddChild(loadBtn);

        var renameBtn = new Button { Text = "Rename" };
        renameBtn.Pressed += () => OnRequestRename(info.FullPath);
        buttons.AddChild(renameBtn);

        var delBtn = new Button { Text = "Delete" };
        delBtn.Pressed += () => OnRequestDelete(info.FullPath);
        buttons.AddChild(delBtn);

        vbox.AddChild(buttons);
        return panel;
    }

    // ---------------------------------------------------------- actions

    private void OnSaveNow()
    {
        if (GameState.World is null || _filenameEdit is null) { SetStatus("No active game."); return; }

        try
        {
            var raw = _filenameEdit.Text.Trim();
            if (string.IsNullOrEmpty(raw)) raw = SuggestFilename();
            var safe = string.Join("_", raw.Split(Path.GetInvalidFileNameChars()));
            if (!safe.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) safe += ".json";

            var dir = OS.GetUserDataDir();
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, safe);

            WorldSaver.Save(GameState.World, path, GameState.ActiveScenario?.Id, GameState.PlayerId);
            SetStatus($"Saved: {safe}");
            RefreshList();
        }
        catch (Exception ex)
        {
            SetStatus($"Save failed: {ex.Message}");
            GD.PushError($"[SaveMenu] save failed: {ex.Message}");
        }
    }

    private void OnLoad(string path)
    {
        if (GameState.Catalog is null) { SetStatus("Catalog missing."); return; }

        try
        {
            var result = WorldLoader.Load(GameState.Catalog, path);
            GameState.World = result.World;
            GameState.PlayerId = result.PlayerId
                ?? result.World.Companies.Keys.OrderBy(id => id.Value).First();

            GameState.ActiveScenario = null;
            GameState.ScenarioName = Path.GetFileNameWithoutExtension(path);
            if (result.ScenarioId is not null)
            {
                try
                {
                    var scenariosDir = Path.Combine(TitleScreen.ResolveContentPath(), "scenarios");
                    var scenarios = ScenarioLoader.LoadAll(scenariosDir);
                    if (scenarios.TryGetValue(result.ScenarioId, out var scenario))
                    {
                        GameState.ActiveScenario = scenario;
                        GameState.ScenarioName = scenario.Name;
                    }
                }
                catch (Exception ex)
                {
                    GD.PushWarning($"[SaveMenu] failed to resolve scenario '{result.ScenarioId}': {ex.Message}");
                }
            }

            GameState.History.Clear();
            GameState.RecordSnapshot();
            GameState.IsPlaying = false;
            GameState.AutosaveMonthsRemaining = GameState.AutosaveIntervalMonths;

            GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
        }
        catch (Exception ex)
        {
            SetStatus($"Load failed: {ex.Message}");
            GD.PushError($"[SaveMenu] load failed: {ex.Message}");
        }
    }

    // ----- delete (with confirm) -----

    private void OnRequestDelete(string path)
    {
        var dialog = new ConfirmationDialog
        {
            Title = "Delete save?",
            DialogText = $"Permanently delete\n{Path.GetFileName(path)}?\nThis cannot be undone.",
            OkButtonText = "Delete",
        };
        AddChild(dialog);
        dialog.Confirmed += () => OnDeleteConfirmed(path);
        dialog.Canceled  += dialog.QueueFree;
        dialog.CloseRequested += dialog.QueueFree;
        dialog.PopupCentered();
    }

    private void OnDeleteConfirmed(string path)
    {
        try
        {
            File.Delete(path);
            SetStatus($"Deleted: {Path.GetFileName(path)}");
            RefreshList();
        }
        catch (Exception ex)
        {
            SetStatus($"Delete failed: {ex.Message}");
            GD.PushError($"[SaveMenu] delete failed: {ex.Message}");
        }
    }

    // ----- rename (with modal LineEdit) -----

    private void OnRequestRename(string path)
    {
        var current = Path.GetFileName(path);
        var dir = Path.GetDirectoryName(path) ?? OS.GetUserDataDir();

        var dialog = new AcceptDialog
        {
            Title = "Rename save",
            OkButtonText = "Rename",
        };

        var vbox = new VBoxContainer();
        vbox.AddChild(new Label { Text = $"New filename for:\n{current}" });

        var edit = new LineEdit
        {
            Text = current,
            CustomMinimumSize = new Vector2(360, 0),
        };
        vbox.AddChild(edit);

        var errorLabel = new Label { Text = "" };
        errorLabel.AddThemeColorOverride("font_color", new Color(0.95f, 0.5f, 0.5f));
        vbox.AddChild(errorLabel);

        dialog.AddChild(vbox);
        dialog.RegisterTextEnter(edit);

        // Add a Cancel button so the user can bail without renaming.
        dialog.AddCancelButton("Cancel");

        AddChild(dialog);
        dialog.Confirmed += () =>
        {
            var newName = edit.Text.Trim();
            if (!TryValidateRename(newName, dir, out var error))
            {
                errorLabel.Text = error;
                // re-show the dialog: AcceptDialog auto-closes on Confirmed,
                // so re-popup it for the user to correct input.
                CallDeferred(nameof(ReopenDialog), dialog);
                return;
            }

            try
            {
                var newPath = Path.Combine(dir, newName);
                File.Move(path, newPath);
                SetStatus($"Renamed: {current} → {newName}");
                dialog.QueueFree();
                RefreshList();
            }
            catch (Exception ex)
            {
                errorLabel.Text = $"Rename failed: {ex.Message}";
                GD.PushError($"[SaveMenu] rename failed: {ex.Message}");
                CallDeferred(nameof(ReopenDialog), dialog);
            }
        };
        dialog.Canceled += dialog.QueueFree;
        dialog.CloseRequested += dialog.QueueFree;
        dialog.PopupCentered();
        edit.GrabFocus();
        edit.SelectAll();
    }

    private void ReopenDialog(AcceptDialog dialog)
    {
        if (IsInstanceValid(dialog)) dialog.PopupCentered();
    }

    private static bool TryValidateRename(string newName, string dir, out string error)
    {
        error = "";
        if (string.IsNullOrWhiteSpace(newName))
        {
            error = "Name cannot be empty.";
            return false;
        }
        if (newName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        {
            error = "Name contains invalid characters.";
            return false;
        }
        if (newName.Contains('/') || newName.Contains('\\'))
        {
            error = "Name cannot contain path separators.";
            return false;
        }
        if (!newName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            error = "Name must end with .json";
            return false;
        }
        var target = Path.Combine(dir, newName);
        if (File.Exists(target))
        {
            error = "A save with that name already exists.";
            return false;
        }
        return true;
    }

    // ----- quick-save (Ctrl+S) -----

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is not InputEventKey key) return;
        if (!key.Pressed || key.Echo) return;
        if (!key.CtrlPressed && !key.MetaPressed) return;
        if (key.Keycode != Key.S) return;

        QuickSave();
        GetViewport().SetInputAsHandled();
    }

    private void QuickSave()
    {
        if (GameState.World is null) { SetStatus("No active game."); return; }

        try
        {
            var dir = OS.GetUserDataDir();
            Directory.CreateDirectory(dir);

            // Reuse most-recent non-autosave if present, otherwise quicksave.json.
            var manual = WorldSaver.ListSaves(dir)
                .Where(s => !IsAutosaveName(s.FileName))
                .OrderByDescending(s => s.Timestamp)
                .FirstOrDefault();
            var path = manual?.FullPath ?? Path.Combine(dir, "quicksave.json");

            WorldSaver.Save(GameState.World, path, GameState.ActiveScenario?.Id, GameState.PlayerId);
            SetStatus($"Quick-saved: {Path.GetFileName(path)}");
            RefreshList();
        }
        catch (Exception ex)
        {
            SetStatus($"Quick-save failed: {ex.Message}");
            GD.PushError($"[SaveMenu] quick-save failed: {ex.Message}");
        }
    }

    private void SetStatus(string text)
    {
        if (_statusLabel is not null) _statusLabel.Text = text;
    }

    private void OnBack() => GetTree().ChangeSceneToFile("res://scenes/Main.tscn");
}
