// Animated title/boot backdrop: a procedurally generated city skyline at dusk
// (three parallax layers drifting slowly, lit windows that flicker, aviation
// beacons), a setting sun, drifting clouds, stars fading in as the 80-second
// dusk ⇄ night cycle turns, and the city reflected in the harbour. Pure SVG/CSS,
// seeded so it looks the same every launch. Respects reduced motion.
// (A real 3D flyover of the city replaces it in Wave 3.)

import clsx from 'clsx';
import { memo, type ReactElement } from 'react';
import { mulberry32 } from '@/util/random';
import styles from './SkylineBackdrop.module.css';

const W = 1600;

interface LayerSpec {
  seed: number;
  height: number;
  fill: string;
  minW: number;
  maxW: number;
  heightScale: number;
  windows: 'full' | 'sparse' | 'none';
  rim: boolean;
  beacons: number;
}

const SPECS: Record<'far' | 'mid' | 'near', LayerSpec> = {
  far: { seed: 11, height: 300, fill: '#33435c', minW: 18, maxW: 46, heightScale: 0.95, windows: 'none', rim: false, beacons: 0 },
  mid: { seed: 23, height: 360, fill: '#18253a', minW: 24, maxW: 64, heightScale: 0.88, windows: 'sparse', rim: true, beacons: 2 },
  near: { seed: 37, height: 440, fill: '#0a111b', minW: 34, maxW: 96, heightScale: 0.8, windows: 'full', rim: true, beacons: 3 },
};

const SUN_X = W * 0.63;

function profile(x: number): number {
  const t = x / W;
  const downtown = Math.exp(-((t - 0.6) ** 2) / (2 * 0.11 ** 2));
  const midtown = 0.55 * Math.exp(-((t - 0.18) ** 2) / (2 * 0.08 ** 2));
  return 0.22 + 0.78 * Math.max(downtown, midtown);
}

function buildLayer(spec: LayerSpec, key: string): ReactElement {
  const rand = mulberry32(spec.seed);
  const r = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const H = spec.height;
  const bodies: ReactElement[] = [];
  const details: ReactElement[] = [];
  const windows: ReactElement[] = [];
  const tops: { x: number; y: number; h: number }[] = [];
  let x = 4;
  let i = 0;
  while (x < W - spec.minW - 4) {
    const w = Math.min(r(spec.minW, spec.maxW), W - 4 - x);
    if (w < spec.minW * 0.6) break;
    const h = Math.max(24, H * spec.heightScale * profile(x + w / 2) * r(0.55, 1.05));
    const top = H - h;
    bodies.push(<rect key={`b${i}`} x={x} y={top} width={w} height={h} />);
    let roof = top;
    // Setback tier.
    if (h > H * 0.35 && rand() < 0.45) {
      const tw = w * r(0.5, 0.75);
      const th = h * r(0.12, 0.22);
      bodies.push(<rect key={`t${i}`} x={x + (w - tw) / 2} y={top - th} width={tw} height={th} />);
      roof = top - th;
      if (rand() < 0.5) {
        const sw = tw * 0.55;
        const sh = th * 0.6;
        bodies.push(<rect key={`s${i}`} x={x + (w - sw) / 2} y={roof - sh} width={sw} height={sh} />);
        roof -= sh;
      }
    } else if (rand() < 0.3) {
      // Rooftop plant room / water tank.
      const bw = w * r(0.2, 0.35);
      bodies.push(<rect key={`p${i}`} x={x + w * r(0.1, 0.55)} y={top - 8} width={bw} height={8} />);
    }
    // Spire.
    if (h > H * 0.55 && rand() < 0.35) {
      const sh = r(16, 42);
      bodies.push(<rect key={`sp${i}`} x={x + w / 2 - 1} y={roof - sh} width={2} height={sh} />);
      roof -= sh;
    }
    tops.push({ x: x + w / 2, y: roof, h });
    // Sun-side rim light.
    if (spec.rim) {
      const lit = x + w < SUN_X;
      details.push(
        <rect key={`r${i}`} x={lit ? x + w - 1.5 : x} y={top} width={1.5} height={h} fill="#f3c47e" opacity={0.18 + 0.25 * profile(x)} />,
      );
    }
    // Windows.
    if (spec.windows !== 'none') {
      const cw = spec.windows === 'full' ? 7 : 6;
      const rh = spec.windows === 'full' ? 9 : 8;
      const ww = spec.windows === 'full' ? 3 : 1.6;
      const wh = spec.windows === 'full' ? 4 : 2.2;
      const p = spec.windows === 'full' ? 0.3 : 0.16;
      for (let wy = top + 8; wy < H - 10; wy += rh) {
        for (let wx = x + 5; wx < x + w - 6; wx += cw) {
          if (rand() > p) continue;
          const warm = rand() < 0.78;
          const flicker = spec.windows === 'full' && rand() < 0.05;
          windows.push(
            <rect
              key={`w${windows.length}`}
              x={wx}
              y={wy}
              width={ww}
              height={wh}
              fill={warm ? '#f7cf86' : '#bcd8f5'}
              opacity={r(0.45, 0.95)}
              className={flicker ? styles.window : undefined}
              style={flicker ? { animationDelay: `${-r(0, 9).toFixed(2)}s` } : undefined}
            />,
          );
        }
      }
    }
    x += w + r(0, 5);
    i++;
  }
  // Aviation beacons on the tallest towers.
  const beacons = [...tops]
    .sort((a, b) => a.y - b.y)
    .slice(0, spec.beacons)
    .map((t, j) => <circle key={`bc${j}`} cx={t.x} cy={t.y - 2} r={2.1} fill="#ff4b3e" className={styles.beacon} style={{ animationDelay: `${j * 0.45}s` }} />);
  return (
    <svg key={key} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax meet" aria-hidden>
      <g fill={spec.fill}>{bodies}</g>
      <g>{details}</g>
      <g>{windows}</g>
      <g>{beacons}</g>
    </svg>
  );
}

function Stars() {
  const rand = mulberry32(5);
  const stars = Array.from({ length: 90 }, (_, i) => ({
    x: rand() * 100,
    y: rand() * 100,
    r: rand() < 0.1 ? 1.4 : 0.8,
    d: rand() * 3.2,
    o: 0.4 + rand() * 0.6,
    i,
  }));
  return (
    <svg className={styles.stars} aria-hidden>
      {stars.map((s) => (
        <circle key={s.i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#fff" opacity={s.o} className={styles.star} style={{ animationDelay: `${-s.d}s` }} />
      ))}
    </svg>
  );
}

const CLOUDS = [
  { top: '18%', w: '38vw', h: '7vh', dur: 210, delay: -40 },
  { top: '29%', w: '26vw', h: '5vh', dur: 160, delay: -120 },
  { top: '11%', w: '22vw', h: '4vh', dur: 260, delay: -10 },
  { top: '37%', w: '30vw', h: '4.5vh', dur: 190, delay: -150 },
];

type Layers = Record<'far' | 'mid' | 'near' | 'reflection', ReactElement[]>;
let layerCache: Layers | null = null;

/** The layers are seeded (identical on every mount) and costly to create (thousands of windows), so they are built
 *  once and shared by the boot, title and game-loading screens — the loading screen must paint on the click's frame. */
function skylineLayers(): Layers {
  return (layerCache ??= {
    far: [buildLayer(SPECS.far, 'a'), buildLayer(SPECS.far, 'b')],
    mid: [buildLayer(SPECS.mid, 'a'), buildLayer(SPECS.mid, 'b')],
    near: [buildLayer(SPECS.near, 'a'), buildLayer(SPECS.near, 'b')],
    reflection: [buildLayer(SPECS.near, 'ra'), buildLayer(SPECS.near, 'rb')],
  });
}

export const SkylineBackdrop = memo(function SkylineBackdrop({ animated = true, className }: { animated?: boolean; className?: string }) {
  const layers = skylineLayers();
  return (
    <div className={clsx(styles.root, !animated && styles.static, className)} aria-hidden>
      <div className={styles.sky} />
      <div className={styles.skyNight} />
      <Stars />
      <div className={styles.sun} />
      {CLOUDS.map((c, i) => (
        <div key={i} className={styles.cloud} style={{ top: c.top, width: c.w, height: c.h, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />
      ))}
      <div className={clsx(styles.layer, styles.far)}>{layers.far}</div>
      <div className={clsx(styles.layer, styles.mid)}>{layers.mid}</div>
      <div className={clsx(styles.layer, styles.near)}>{layers.near}</div>
      <div className={styles.water}>
        <div className={styles.reflection}>{layers.reflection}</div>
        <div className={styles.ripples} />
        <div className={styles.shoreGlow} />
      </div>
      <div className={styles.vignette} />
      <div className={styles.grain} />
    </div>
  );
});
