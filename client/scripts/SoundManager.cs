using System.Collections.Generic;
using Godot;

namespace Magnate.Client;

/// <summary>
/// Central audio helper. Any scene can call <see cref="PlayMusic"/>,
/// <see cref="PlaySfx"/>, or <see cref="PlayVoice"/> — no autoload, no
/// project.godot changes. Players parent to a shared node under the
/// scene-tree root (not the current scene) so music survives scene
/// transitions. Assets live under <c>res://assets/audio/</c>:
/// <code>
/// music/&lt;name&gt;.mp3   e.g. title_theme, gameplay_loop, victory_theme
/// sfx/&lt;name&gt;.mp3     e.g. ui_click, cash_sale, goal_achieved
/// vo/&lt;name&gt;.mp3      e.g. vo_welcome, vo_tutorial_step1
/// </code>
/// Missing files are a silent no-op so the game runs with a partial or
/// absent asset set. Voice-over ducks music while speaking. Music
/// switches crossfade between two players.
/// </summary>
public static class SoundManager
{
    private const float MusicDb = -8.0f;
    private const float MusicDuckDb = -18.0f;
    private const float SfxDb = -4.0f;
    private const float VoiceDb = 0.0f;
    private const int SfxPoolSize = 8;

    private static Node? _host;
    private static AudioStreamPlayer? _musicA;
    private static AudioStreamPlayer? _musicB;
    private static AudioStreamPlayer? _activeMusic;
    private static AudioStreamPlayer? _voice;
    private static readonly List<AudioStreamPlayer> _sfxPool = new();
    private static readonly Dictionary<string, AudioStream?> _cache = new();
    private static int _sfxCursor;
    private static string? _currentTrack;
    private static ulong _lastSfxFrame;
    private static string? _lastSfxName;

    public static bool Muted { get; private set; }

    /// <summary>Starts (or crossfades to) a music track from assets/audio/music. No-op if already playing it.</summary>
    public static void PlayMusic(string name, float fadeSec = 1.2f)
    {
        if (_currentTrack == name && _activeMusic is { Playing: true }) return;
        RunWhenReady(() => PlayMusicNow(name, fadeSec));
    }

    private static void PlayMusicNow(string name, float fadeSec)
    {
        if (_currentTrack == name && _activeMusic is { Playing: true }) return;

        var stream = LoadStream($"music/{name}");
        if (stream == null) return;
        SetLooping(stream);
        _currentTrack = name;

        var incoming = _activeMusic == _musicA ? _musicB! : _musicA!;
        var outgoing = _activeMusic;
        _activeMusic = incoming;

        incoming.Stream = stream;
        incoming.VolumeDb = -60f;
        incoming.Play();
        Fade(incoming, Muted ? -80f : MusicDb, fadeSec);
        if (outgoing is { Playing: true }) FadeOutAndStop(outgoing, fadeSec);
    }

    /// <summary>Fades out and stops the current music track.</summary>
    public static void StopMusic(float fadeSec = 0.8f)
    {
        _currentTrack = null;
        if (_activeMusic is { Playing: true }) FadeOutAndStop(_activeMusic, fadeSec);
        _activeMusic = null;
    }

    /// <summary>Fire-and-forget sound effect from assets/audio/sfx. Debounces the same effect within one frame.</summary>
    public static void PlaySfx(string name)
    {
        if (Muted) return;

        // Guard: identical SFX requested twice in the same physics frame
        // (e.g. batched toast + popup) plays once.
        var frame = Godot.Engine.GetPhysicsFrames();
        if (_lastSfxName == name && _lastSfxFrame == frame) return;
        _lastSfxName = name;
        _lastSfxFrame = frame;

        RunWhenReady(() => PlaySfxNow(name));
    }

    private static void PlaySfxNow(string name)
    {
        if (Muted) return;
        var stream = LoadStream($"sfx/{name}");
        if (stream == null) return;

        var player = _sfxPool[_sfxCursor];
        _sfxCursor = (_sfxCursor + 1) % _sfxPool.Count;
        player.Stop();
        player.Stream = stream;
        player.VolumeDb = SfxDb;
        player.Play();
    }

    /// <summary>Plays a voice-over line from assets/audio/vo, ducking music until it finishes. A new line interrupts the previous one.</summary>
    public static void PlayVoice(string name)
    {
        if (Muted) return;
        RunWhenReady(() => PlayVoiceNow(name));
    }

    private static void PlayVoiceNow(string name)
    {
        if (Muted) return;
        var stream = LoadStream($"vo/{name}");
        if (stream == null) return;

        _voice!.Stop();
        _voice.Stream = stream;
        _voice.VolumeDb = VoiceDb;
        if (_activeMusic is { Playing: true }) Fade(_activeMusic, MusicDuckDb, 0.3f);
        _voice.Play();
    }

    /// <summary>Master mute for all channels. Music resumes at normal volume on unmute.</summary>
    public static void SetMuted(bool muted)
    {
        Muted = muted;
        if (_activeMusic != null && _activeMusic.Playing)
            Fade(_activeMusic, muted ? -80f : MusicDb, 0.3f);
        if (muted)
        {
            _voice?.Stop();
            foreach (var p in _sfxPool) p.Stop();
        }
    }

    /// <summary>
    /// The host node enters the tree via CallDeferred, so playback requested in the
    /// same frame (e.g. from a scene's _Ready) must also be deferred — deferred
    /// calls run FIFO, so by then the host is inside the tree.
    /// </summary>
    private static void RunWhenReady(System.Action action)
    {
        if (!EnsureHost()) return;
        if (_host!.IsInsideTree())
        {
            action();
            return;
        }
        Callable.From(() =>
        {
            if (_host is not null && GodotObject.IsInstanceValid(_host) && _host.IsInsideTree()) action();
        }).CallDeferred();
    }

    private static bool EnsureHost()
    {
        if (_host != null && GodotObject.IsInstanceValid(_host) && _host.IsInsideTree()) return true;
        if (Godot.Engine.GetMainLoop() is not SceneTree tree || tree.Root == null) return false;

        _host = new Node { Name = "SoundManagerHost" };
        _musicA = new AudioStreamPlayer { Name = "MusicA" };
        _musicB = new AudioStreamPlayer { Name = "MusicB" };
        _voice = new AudioStreamPlayer { Name = "Voice" };
        _voice.Finished += OnVoiceFinished;
        _host.AddChild(_musicA);
        _host.AddChild(_musicB);
        _host.AddChild(_voice);

        _sfxPool.Clear();
        for (int i = 0; i < SfxPoolSize; i++)
        {
            var p = new AudioStreamPlayer { Name = $"Sfx{i}" };
            _host.AddChild(p);
            _sfxPool.Add(p);
        }

        // Parent to the tree root (not CurrentScene) so audio persists
        // across scene transitions. Stop + release everything when the host
        // leaves the tree at quit — a still-playing MP3 stream destructed
        // during AudioServer teardown crashes the mono binding layer.
        _host.TreeExiting += Shutdown;
        tree.Root.CallDeferred(Node.MethodName.AddChild, _host);
        return true;
    }

    private static void Shutdown()
    {
        foreach (var p in _sfxPool) ReleasePlayer(p);
        ReleasePlayer(_musicA);
        ReleasePlayer(_musicB);
        ReleasePlayer(_voice);
        _sfxPool.Clear();
        _cache.Clear();
        _musicA = _musicB = _activeMusic = _voice = null;
        _currentTrack = null;
        _host = null;
    }

    private static void ReleasePlayer(AudioStreamPlayer? p)
    {
        if (p is null || !GodotObject.IsInstanceValid(p)) return;
        p.Stop();
        p.Stream = null;
    }

    private static void OnVoiceFinished()
    {
        if (_activeMusic is { Playing: true } && !Muted) Fade(_activeMusic, MusicDb, 0.6f);
    }

    private static AudioStream? LoadStream(string relative)
    {
        if (_cache.TryGetValue(relative, out var cached)) return cached;

        AudioStream? stream = null;
        foreach (var ext in new[] { "mp3", "ogg", "wav" })
        {
            var path = $"res://assets/audio/{relative}.{ext}";
            if (ResourceLoader.Exists(path))
            {
                stream = GD.Load<AudioStream>(path);
                break;
            }
        }
        _cache[relative] = stream;
        return stream;
    }

    private static void SetLooping(AudioStream stream)
    {
        switch (stream)
        {
            case AudioStreamMP3 mp3: mp3.Loop = true; break;
            case AudioStreamOggVorbis ogg: ogg.Loop = true; break;
            case AudioStreamWav wav: wav.LoopMode = AudioStreamWav.LoopModeEnum.Forward; break;
        }
    }

    private static void Fade(AudioStreamPlayer player, float toDb, float sec)
    {
        var tween = player.CreateTween();
        tween.TweenProperty(player, "volume_db", toDb, sec);
    }

    private static void FadeOutAndStop(AudioStreamPlayer player, float sec)
    {
        var tween = player.CreateTween();
        tween.TweenProperty(player, "volume_db", -60f, sec);
        tween.TweenCallback(Callable.From(player.Stop));
    }
}
