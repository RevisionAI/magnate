// Autoplay unlock and page lifecycle (audio-plan §4.5).
//
// * Any pointer/key gesture resumes the context. iOS/WebKit additionally needs a buffer to *start*
//   inside the gesture handler, hence the 1-sample silent buffer.
// * The listeners re-arm whenever the context leaves 'running' without us asking (Safari reports
//   'interrupted' during calls/Siri), so the next gesture recovers it.
// * With "mute in background" on, a hidden tab suspends the context and a visible one resumes it.

import type { AudioSettings } from '../settings';

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

export interface LifecycleHandle {
  /** Re-apply settings that affect lifecycle (iOS silent switch). */
  refresh(): void;
  dispose(): void;
}

export function installLifecycle(
  ctx: AudioContext,
  onRunning: () => void,
  settings: () => AudioSettings,
): LifecycleHandle {
  let armed = false;
  let suspendedByUs = false;
  let disposed = false;

  const kick = () => {
    if (disposed) return;
    try {
      const s = new AudioBufferSourceNode(ctx, { buffer: ctx.createBuffer(1, 1, ctx.sampleRate) });
      s.connect(ctx.destination);
      s.start();
    } catch {
      // closed context: nothing to unlock
    }
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') {
          disarm();
          onRunning();
        }
      })
      .catch(() => undefined);
  };
  const arm = () => {
    if (armed || disposed) return;
    for (const g of GESTURES) window.addEventListener(g, kick, { capture: true, passive: true });
    armed = true;
  };
  const disarm = () => {
    if (!armed) return;
    for (const g of GESTURES) window.removeEventListener(g, kick, { capture: true });
    armed = false;
  };

  const onState = () => {
    if (disposed) return;
    const st = ctx.state as string; // Safari also reports 'interrupted'
    if (st === 'running') {
      disarm();
      onRunning();
    } else if (st !== 'closed' && !suspendedByUs && !document.hidden) {
      arm();
    }
  };
  const onVisibility = () => {
    if (disposed || !settings().muteInBackground) return;
    if (document.hidden) {
      if (ctx.state === 'running') {
        suspendedByUs = true;
        void ctx.suspend().catch(() => undefined);
      }
    } else if (suspendedByUs) {
      suspendedByUs = false;
      void ctx
        .resume()
        .then(() => {
          if (ctx.state !== 'running') arm();
        })
        .catch(() => arm());
    }
  };
  const applySession = () => {
    const nav = navigator as Navigator & { audioSession?: { type: string } }; // Safari 16.4+
    if (nav.audioSession) {
      try {
        nav.audioSession.type = settings().iosIgnoreSilentSwitch ? 'playback' : 'auto';
      } catch {
        // read-only in some builds
      }
    }
  };

  ctx.addEventListener('statechange', onState);
  document.addEventListener('visibilitychange', onVisibility);
  applySession();
  if (ctx.state === 'running') onRunning();
  else {
    arm();
    // We are usually created inside a gesture (audio.init on the first click): try right away.
    void ctx.resume().catch(() => undefined);
  }

  return {
    refresh: applySession,
    dispose() {
      disposed = true;
      disarm();
      ctx.removeEventListener('statechange', onState);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
