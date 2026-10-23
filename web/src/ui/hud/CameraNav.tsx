// Camera navigation cluster (sits on the minimap): a compass dial, a tilt slider and a pan / rotate / zoom pad. On the
// map itself, drag pans and Option+drag / right-drag orbits (horizontal = turn, vertical = tilt) — see CameraRig.
//
//   • Compass — shows the heading; drag it round to spin the view through 360°; click it to face north.
//   • Tilt — drag up for a top-down view, down towards the horizon (arrow keys when focused).
//   • Arrows — hold to pan (same speed and easing as WASD).
//   • ↺ / ↻ — tap to rotate 45° (like Q/E), hold to orbit continuously.
//   • N — face north · − / + — zoom.
//
// Drives the camera through the interaction scene API; the heading is read per frame and written straight to the DOM.

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';
import { useInteractionStore } from '@/scene/interaction/interactionStore';
import { IconButton, Tooltip } from '@/ui/components';
import styles from './CameraNav.module.css';

/** A press shorter than this on ↺ / ↻ is a 45° step; longer starts a continuous orbit. */
const HOLD_MS = 250;
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

const api = () => useInteractionStore.getState().scene;

interface Nudge {
  panX: number;
  panY: number;
  orbit: number;
}

/** Press-and-hold behaviour shared by the pad buttons; releases on pointer up / cancel / lost capture / blur. */
function useHold() {
  const active = useRef<{ pointerId: number; timer: number; held: boolean } | null>(null);

  const stop = () => {
    const a = active.current;
    if (!a) return;
    window.clearTimeout(a.timer);
    active.current = null;
    api()?.nudgeCamera(0, 0, 0);
  };

  useEffect(() => {
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('blur', stop);
      stop();
    };
  }, []);

  /** Props for a hold button. `tap` runs on a short press (and on keyboard activation); `nudge` while held. */
  return (nudge: Nudge, tap?: () => void, delayMs = 0) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      stop();
      e.currentTarget.setPointerCapture(e.pointerId);
      const start = () => {
        if (!active.current) return;
        active.current.held = true;
        api()?.nudgeCamera(nudge.panX, nudge.panY, nudge.orbit);
      };
      active.current = { pointerId: e.pointerId, timer: 0, held: false };
      if (delayMs > 0) active.current.timer = window.setTimeout(start, delayMs);
      else start();
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      const a = active.current;
      if (!a || a.pointerId !== e.pointerId) return;
      if (!a.held) tap?.();
      stop();
    },
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      // Pointer presses are handled above; this is keyboard activation (Enter / Space).
      if (e.detail !== 0) return;
      if (tap) tap();
      else {
        api()?.nudgeCamera(nudge.panX, nudge.panY, nudge.orbit);
        window.setTimeout(() => api()?.nudgeCamera(0, 0, 0), 220);
      }
    },
  });
}

function Compass() {
  const dialRef = useRef<SVGGElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ pointerId: number; cx: number; cy: number; angle: number; moved: number } | null>(null);

  // Heading → DOM every frame (no React renders while the camera turns).
  useEffect(() => {
    let raf = 0;
    let last = NaN;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const h = api()?.headingDeg();
      if (h === undefined || Math.abs(h - last) < 0.05) return;
      last = h;
      dialRef.current?.setAttribute('transform', `rotate(${(-h).toFixed(2)} 50 50)`);
      if (readoutRef.current) readoutRef.current.textContent = `${POINTS[Math.round(h / 45) % 8]} ${Math.round(h) % 360}°`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const angleOf = (e: { clientX: number; clientY: number }, cx: number, cy: number) =>
    (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, cx, cy, angle: angleOf(e, cx, cy), moved: 0 };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const a = angleOf(e, d.cx, d.cy);
    // Screen angles grow clockwise; the dial turns with the pointer, so the view turns the other way.
    const delta = ((a - d.angle + 540) % 360) - 180;
    d.angle = a;
    d.moved += Math.abs(delta);
    api()?.orbitCamera(delta);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.moved < 3) api()?.faceNorth();
  };

  return (
    <Tooltip title="Compass" content="Drag the dial round to turn the view a full 360°. Click to face north." side="top">
      <button
        type="button"
        className={styles.compass}
        aria-label="Compass: drag to rotate the view, click to face north"
        data-testid="camera-compass"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onClick={(e) => {
          if (e.detail === 0) api()?.faceNorth();
        }}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className={styles.rim} cx="50" cy="50" r="46" />
          <g ref={dialRef}>
            {Array.from({ length: 24 }, (_, i) => (
              <line key={i} className={i % 6 === 0 ? styles.tickMajor : styles.tick} x1="50" y1="6" x2="50" y2={i % 6 === 0 ? 14 : 10} transform={`rotate(${i * 15} 50 50)`} />
            ))}
            <path className={styles.needleNorth} d="M50 34 L55 50 L45 50 Z" />
            <path className={styles.needleSouth} d="M50 66 L55 50 L45 50 Z" />
            <text className={clsx(styles.cardinal, styles.north)} x="50" y="24">N</text>
            <text className={styles.cardinal} x="76" y="50" transform="rotate(90 76 50)">E</text>
            <text className={styles.cardinal} x="50" y="76" transform="rotate(180 50 76)">S</text>
            <text className={styles.cardinal} x="24" y="50" transform="rotate(-90 24 50)">W</text>
          </g>
          <circle className={styles.hub} cx="50" cy="50" r="4" />
        </svg>
        <span ref={readoutRef} className={styles.readout} data-testid="camera-heading">N 0°</span>
      </button>
    </Tooltip>
  );
}

/** Tilt rail inset from the slider's ends (px), matching `.tiltRail` in the stylesheet. */
const INSET = 6;

function TiltSlider() {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const dragId = useRef<number | null>(null);

  const range = () => api()?.elevationRangeDeg() ?? [12, 87];

  // Elevation → thumb position every frame (0 % = top = almost top-down).
  useEffect(() => {
    let raf = 0;
    let last = NaN;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = api()?.elevationDeg();
      if (el === undefined || Math.abs(el - last) < 0.05) return;
      last = el;
      const [lo, hi] = range();
      const t = Math.min(1, Math.max(0, (hi - el) / (hi - lo)));
      if (thumbRef.current) thumbRef.current.style.top = `calc(${INSET}px + ${t.toFixed(4)} * (100% - ${2 * INSET}px))`;
      trackRef.current?.setAttribute('aria-valuenow', String(Math.round(el)));
      trackRef.current?.setAttribute('aria-valuetext', `${Math.round(el)}° above the ground`);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const tiltToPointer = (clientY: number, animate: boolean) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return;
    const [lo, hi] = range();
    const t = Math.min(1, Math.max(0, (clientY - r.top - INSET) / (r.height - 2 * INSET)));
    api()?.tiltCamera(hi - t * (hi - lo), animate);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = api()?.elevationDeg();
    if (el === undefined) return;
    const [lo, hi] = range();
    const to =
      e.key === 'ArrowUp' || e.key === 'ArrowRight' ? el + 5
      : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? el - 5
      : e.key === 'PageUp' ? el + 15
      : e.key === 'PageDown' ? el - 15
      : e.key === 'Home' ? hi
      : e.key === 'End' ? lo
      : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();   // arrows would also pan the camera
    api()?.tiltCamera(to, true);
  };

  return (
    <Tooltip title="Tilt" content="Drag up for a top-down view, down to look towards the horizon." side="top">
      <div
        ref={trackRef}
        className={styles.tilt}
        role="slider"
        tabIndex={0}
        aria-label="Camera tilt"
        aria-orientation="vertical"
        aria-valuemin={12}
        aria-valuemax={87}
        data-testid="camera-tilt"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragId.current = e.pointerId;
          tiltToPointer(e.clientY, true);
        }}
        onPointerMove={(e) => {
          if (dragId.current === e.pointerId) tiltToPointer(e.clientY, false);
        }}
        onPointerUp={() => (dragId.current = null)}
        onPointerCancel={() => (dragId.current = null)}
      >
        <span className={styles.tiltTop} aria-hidden="true" />
        <span className={styles.tiltRail} aria-hidden="true" />
        <span ref={thumbRef} className={styles.tiltThumb} aria-hidden="true" />
        <span className={styles.tiltBottom} aria-hidden="true" />
      </div>
    </Tooltip>
  );
}

function Pad({ children }: { children: ReactNode }) {
  return (
    <div className={styles.pad} role="group" aria-label="Pan, rotate and zoom">
      {children}
    </div>
  );
}

export function CameraNav() {
  const ready = useInteractionStore((s) => s.scene !== null);
  const hold = useHold();
  if (!ready) return null;
  const s = { size: 'sm' as const, tooltipSide: 'top' as const, sound: false as const };
  return (
    <section className={styles.nav} aria-label="Camera" data-testid="camera-nav">
      <Compass />
      <TiltSlider />
      <Pad>
        <IconButton {...s} label="Rotate left" description="Tap for 45°, hold to keep turning." kbd="Q" icon={<RotateCcw size={14} />} data-testid="camera-rotate-left" {...hold({ panX: 0, panY: 0, orbit: 1 }, () => api()?.rotateCamera(1), HOLD_MS)} />
        <IconButton {...s} label="Pan forward" description="Hold to keep moving." kbd="W" icon={<ChevronUp size={16} />} data-testid="camera-pan-up" {...hold({ panX: 0, panY: 1, orbit: 0 })} />
        <IconButton {...s} label="Rotate right" description="Tap for 45°, hold to keep turning." kbd="E" icon={<RotateCw size={14} />} data-testid="camera-rotate-right" {...hold({ panX: 0, panY: 0, orbit: -1 }, () => api()?.rotateCamera(-1), HOLD_MS)} />
        <IconButton {...s} label="Pan left" description="Hold to keep moving." kbd="A" icon={<ChevronLeft size={16} />} data-testid="camera-pan-left" {...hold({ panX: -1, panY: 0, orbit: 0 })} />
        <IconButton {...s} label="Face north" className={styles.northBtn} icon={<span className={styles.northGlyph}>N</span>} data-testid="camera-north" onClick={() => api()?.faceNorth()} />
        <IconButton {...s} label="Pan right" description="Hold to keep moving." kbd="D" icon={<ChevronRight size={16} />} data-testid="camera-pan-right" {...hold({ panX: 1, panY: 0, orbit: 0 })} />
        <IconButton {...s} label="Zoom out" kbd="Minus" icon={<Minus size={14} />} data-testid="camera-zoom-out" onClick={() => api()?.zoomCamera(1.25)} />
        <IconButton {...s} label="Pan back" description="Hold to keep moving." kbd="S" icon={<ChevronDown size={16} />} data-testid="camera-pan-down" {...hold({ panX: 0, panY: -1, orbit: 0 })} />
        <IconButton {...s} label="Zoom in" kbd="Equal" icon={<Plus size={14} />} data-testid="camera-zoom-in" onClick={() => api()?.zoomCamera(0.8)} />
      </Pad>
    </section>
  );
}
