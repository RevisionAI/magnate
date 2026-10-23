// Game-feel layers (UX §8): floating "+$X" popups and a confetti burst, driven by
// the bus (`fx.popup`, `fx.confetti`). Both respect reduced motion: popups still
// appear (they carry information) but without the rise; confetti is skipped.

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { bus, type PopupRequest } from '@/game/events';
import { OWNER_COLORS, UI } from '@/theme/tokens';
import styles from './FxLayers.module.css';

interface LivePopup extends PopupRequest {
  id: number;
  left: number;
  top: number;
}

let popupId = 1;
const MAX_POPUPS = 12;

function anchorPoint(request: PopupRequest): { left: number; top: number } {
  if (typeof request.x === 'number' && typeof request.y === 'number') return { left: request.x, top: request.y };
  if (request.anchor) {
    const el = document.querySelector<HTMLElement>(`[data-ui-id="${CSS.escape(request.anchor)}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      return { left: r.left + r.width * 0.55, top: r.bottom + 14 };
    }
  }
  return { left: window.innerWidth / 2, top: window.innerHeight * 0.4 };
}

/** Screen-space floating labels. Mount once in the HUD. */
export function PopupLayer() {
  const [popups, setPopups] = useState<LivePopup[]>([]);

  useEffect(() => {
    const timers = new Set<number>();
    const off = bus.on('popup', (request) => {
      const spawn = () => {
        const id = popupId++;
        setPopups((list) => [...list.slice(-(MAX_POPUPS - 1)), { ...request, id, ...anchorPoint(request) }]);
        const t = window.setTimeout(() => {
          timers.delete(t);
          setPopups((list) => list.filter((p) => p.id !== id));
        }, 1700);
        timers.add(t);
      };
      if (request.delayMs && request.delayMs > 0) {
        const t = window.setTimeout(() => {
          timers.delete(t);
          spawn();
        }, request.delayMs);
        timers.add(t);
      } else spawn();
    });
    return () => {
      off();
      for (const t of timers) window.clearTimeout(t);
    };
  }, []);

  return (
    <div className={styles.popups} aria-hidden>
      {popups.map((p) => (
        <span key={p.id} className={clsx(styles.popup, styles[p.tone])} style={{ left: p.left, top: p.top }}>
          {p.text}
        </span>
      ))}
    </div>
  );
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  life: number;
}

const COLORS = [UI.gold, UI.goldBright, '#ffffff', OWNER_COLORS[0], '#8cc4ff', UI.green];

/** Canvas confetti burst. Mount once in the HUD (and on the outcome screen). */
export function ConfettiLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let particles: Particle[] = [];
    let raf = 0;
    let last = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      particles = particles.filter((p) => p.life > 0 && p.y < canvas.clientHeight + 40);
      for (const p of particles) {
        p.vy += 520 * dt;
        p.vx *= 1 - 1.4 * dt;
        p.vy *= 1 - 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= dt;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life * 1.5);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 2));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = particles.length > 0 ? requestAnimationFrame(frame) : 0;
      if (!raf) {
        last = 0;
        ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      }
    };

    const off = bus.on('confetti', ({ x, y, intensity = 1 }) => {
      if (document.documentElement.dataset.reducedMotion === 'true') return;
      resize();
      const ox = x ?? canvas.clientWidth / 2;
      const oy = y ?? canvas.clientHeight * 0.22;
      const count = Math.round(140 * Math.min(2, Math.max(0.3, intensity)));
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
        const speed = 380 + Math.random() * 520;
        particles.push({
          x: ox + (Math.random() - 0.5) * 40,
          y: oy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 14,
          w: 6 + Math.random() * 6,
          h: 3 + Math.random() * 4,
          color: COLORS[i % COLORS.length]!,
          life: 2.2 + Math.random() * 1.6,
        });
      }
      if (!raf) raf = requestAnimationFrame(frame);
    });

    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.confetti} aria-hidden />;
}
