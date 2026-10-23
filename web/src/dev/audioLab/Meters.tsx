// Per-bus peak / RMS meters (AnalyserNode taps in AudioEngine.readMeters), drawn on canvases at
// display rate with peak-hold ballistics.

import { useEffect, useRef } from 'react';
import { audio } from '@/audio';
import type { MeterBus } from '@/audio/core/AudioEngine';
import css from './AudioLab.module.css';

const BUSES: MeterBus[] = ['master', 'music', 'sfx', 'voice', 'ambient'];
const FLOOR_DB = -60;

const toY = (db: number, h: number) => {
  const x = Math.max(FLOOR_DB, Math.min(0, Number.isFinite(db) ? db : FLOOR_DB));
  return h - ((x - FLOOR_DB) / -FLOOR_DB) * h;
};

export interface MeterSnapshot {
  [bus: string]: { peakDb: number; rmsDb: number; holdDb: number };
}

/** Latest readings (also read by window.__audioLab.meters()). */
export const meterState: MeterSnapshot = {};

export function Meters() {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const hold: Record<string, { db: number; at: number }> = {};
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const sys = audio.system;
      if (!sys) return;
      const m = sys.engine.readMeters();
      const now = performance.now();
      BUSES.forEach((bus, i) => {
        const r = m[bus];
        const h = hold[bus] ?? { db: -Infinity, at: 0 };
        if (r.peakDb >= h.db || now - h.at > 1500) {
          h.db = r.peakDb;
          h.at = now;
        }
        hold[bus] = h;
        meterState[bus] = { peakDb: r.peakDb, rmsDb: r.rmsDb, holdDb: h.db };
        const c = refs.current[i];
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth * dpr;
        const hh = c.clientHeight * dpr;
        if (c.width !== w || c.height !== hh) {
          c.width = w;
          c.height = hh;
        }
        const g = c.getContext('2d');
        if (!g) return;
        g.clearRect(0, 0, w, hh);
        // scale lines every 12 dB
        g.strokeStyle = 'rgba(120,160,185,0.15)';
        g.lineWidth = 1;
        for (let db = -12; db > FLOOR_DB; db -= 12) {
          const y = Math.round(toY(db, hh)) + 0.5;
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
        }
        const bw = w * 0.36;
        const grad = g.createLinearGradient(0, hh, 0, 0);
        grad.addColorStop(0, '#5aa7d8');
        grad.addColorStop(0.7, '#61c28f');
        grad.addColorStop(0.88, '#e8b63a');
        grad.addColorStop(1, '#df6f6a');
        g.fillStyle = grad;
        const yr = toY(r.rmsDb, hh);
        g.fillRect(w * 0.12, yr, bw, hh - yr);
        const yp = toY(r.peakDb, hh);
        g.globalAlpha = 0.55;
        g.fillRect(w * 0.52, yp, bw, hh - yp);
        g.globalAlpha = 1;
        g.fillStyle = '#f0d38a';
        g.fillRect(w * 0.52, toY(h.db, hh) - dpr, bw, 2 * dpr);
        const label = labels.current[i];
        if (label) label.textContent = `${fmt(r.rmsDb)} / ${fmt(h.db)}`;
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={css.meters}>
      {BUSES.map((bus, i) => (
        <div className={css.meter} key={bus}>
          <canvas
            ref={(el) => {
              refs.current[i] = el;
            }}
          />
          <strong>{bus}</strong>
          <span
            className="num"
            ref={(el) => {
              labels.current[i] = el;
            }}
          >
            –
          </span>
        </div>
      ))}
    </div>
  );
}

function fmt(db: number): string {
  return Number.isFinite(db) && db > FLOOR_DB ? db.toFixed(1) : '−∞';
}
