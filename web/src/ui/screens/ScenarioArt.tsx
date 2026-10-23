// Procedural scenario art for the New Game cards and the briefing header: a dusk
// sky in the pillar's palette, a seeded skyline and a pillar motif (storefronts,
// billboards, farm-to-factory, glass towers, a harbour, a rising chart…). Pure
// SVG, deterministic per scenario id, so the browser looks the same every visit.

import { memo, type ReactElement } from 'react';
import type { Pillar } from '@/state/scenarios';
import { useStableId } from '@/ui/hooks';
import { hashString, mulberry32 } from '@/util/random';

interface Palette {
  top: string;
  bottom: string;
  sun: string;
  accent: string;
  far: string;
}

const PALETTES: Record<Pillar, Palette> = {
  Tutorial: { top: '#17304f', bottom: '#e6a46a', sun: '#ffe2a8', accent: '#f6d28b', far: '#3a4a63' },
  Sandbox: { top: '#183a37', bottom: '#b9c98c', sun: '#f4f7d8', accent: '#e8f0c8', far: '#3d5a4c' },
  Retail: { top: '#251f4b', bottom: '#e0805f', sun: '#ffd9a8', accent: '#ffcf8f', far: '#4a3b5e' },
  Brand: { top: '#2e1740', bottom: '#d65f8e', sun: '#ffd0e4', accent: '#ffc4dd', far: '#55305a' },
  Integration: { top: '#1b3528', bottom: '#cfa44c', sun: '#fff0b8', accent: '#f0dc8a', far: '#41523a' },
  Technology: { top: '#0b1b38', bottom: '#3f9fd4', sun: '#c8f1ff', accent: '#9fe7ff', far: '#22446a' },
  Exports: { top: '#0f2c45', bottom: '#63aeae', sun: '#e2fbfa', accent: '#cfeff0', far: '#2b5560' },
  Growth: { top: '#18261d', bottom: '#d7b766', sun: '#fff3c8', accent: '#fff0c0', far: '#3f4a33' },
};

const W = 320;
const H = 120;
const GROUND = 104;
const INK = '#0a121b';

type Rand = () => number;

function skyline(rand: Rand, fill: string, opacity: number, minH: number, maxH: number): ReactElement {
  const rects: ReactElement[] = [];
  let x = -4;
  let i = 0;
  while (x < W) {
    const w = 8 + rand() * 18;
    const h = minH + rand() * (maxH - minH);
    rects.push(<rect key={i++} x={x} y={GROUND - h} width={w} height={h} />);
    x += w + rand() * 3;
  }
  return (
    <g fill={fill} opacity={opacity}>
      {rects}
    </g>
  );
}

function windows(rand: Rand, x: number, y: number, w: number, h: number, color: string, density = 0.45): ReactElement[] {
  const out: ReactElement[] = [];
  for (let wy = y + 4; wy < y + h - 4; wy += 5) {
    for (let wx = x + 3; wx < x + w - 3; wx += 4) {
      if (rand() < density) out.push(<rect key={`${wx}-${wy}`} x={wx} y={wy} width={1.6} height={2.2} fill={color} opacity={0.55 + rand() * 0.4} />);
    }
  }
  return out;
}

function motif(pillar: Pillar, rand: Rand, p: Palette): ReactElement {
  switch (pillar) {
    case 'Tutorial':
    case 'Retail': {
      const shops: ReactElement[] = [];
      let x = pillar === 'Tutorial' ? 150 : 40;
      const count = pillar === 'Tutorial' ? 2 : 6;
      for (let i = 0; i < count; i++) {
        const w = 30 + rand() * 16;
        const h = 18 + rand() * 14;
        const y = GROUND - h;
        shops.push(
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} fill={INK} />
            <rect x={x - 2} y={y + 4} width={w + 4} height={5} fill={i % 2 ? p.accent : '#e9eef2'} opacity={0.9} />
            {Array.from({ length: Math.floor((w + 4) / 6) }, (_, k) => (
              <rect key={k} x={x - 2 + k * 6} y={y + 4} width={3} height={5} fill={i % 2 ? '#c8613f' : p.accent} opacity={0.85} />
            ))}
            <rect x={x + 4} y={y + 11} width={w - 8} height={h - 13} fill={p.accent} opacity={0.32} />
            <rect x={x + w / 2 - 3} y={GROUND - 8} width={6} height={8} fill={p.accent} opacity={0.7} />
          </g>,
        );
        x += w + 6 + rand() * 6;
      }
      if (pillar === 'Tutorial') {
        // A few houses and trees around the first store.
        for (let i = 0; i < 4; i++) {
          const hx = 40 + i * 26 + rand() * 6;
          shops.push(
            <g key={`h${i}`} fill={INK}>
              <rect x={hx} y={GROUND - 12} width={16} height={12} />
              <path d={`M${hx - 2} ${GROUND - 12} L${hx + 8} ${GROUND - 20} L${hx + 18} ${GROUND - 12} Z`} />
              <rect x={hx + 6} y={GROUND - 9} width={3} height={3} fill={p.accent} opacity={0.8} />
            </g>,
          );
        }
        for (let i = 0; i < 5; i++) shops.push(<circle key={`t${i}`} cx={238 + i * 15 + rand() * 4} cy={GROUND - 7} r={6 + rand() * 3} fill="#1a2b22" />);
      }
      return <g>{shops}</g>;
    }
    case 'Brand': {
      const towers: ReactElement[] = [];
      for (let i = 0; i < 5; i++) {
        const x = 30 + i * 58 + rand() * 10;
        const w = 22 + rand() * 12;
        const h = 40 + rand() * 40;
        towers.push(
          <g key={i}>
            <rect x={x} y={GROUND - h} width={w} height={h} fill={INK} />
            {windows(rand, x, GROUND - h, w, h, p.accent, 0.3)}
          </g>,
        );
      }
      return (
        <g>
          <path d="M130 104 L92 0 L112 0 Z" fill={p.accent} opacity={0.12} />
          <path d="M190 104 L238 0 L256 0 Z" fill={p.accent} opacity={0.1} />
          {towers}
          <rect x={120} y={36} width={86} height={34} rx={2} fill={INK} />
          <rect x={123} y={39} width={80} height={28} rx={1.5} fill={p.accent} opacity={0.9} />
          <circle cx={140} cy={53} r={8} fill={INK} opacity={0.85} />
          <rect x={153} y={47} width={42} height={4} fill={INK} opacity={0.75} />
          <rect x={153} y={55} width={30} height={3} fill={INK} opacity={0.55} />
          <rect x={160} y={70} width={2.5} height={34} fill={INK} />
        </g>
      );
    }
    case 'Integration': {
      const field: ReactElement[] = [];
      for (let i = 0; i < 9; i++) field.push(<path key={i} d={`M${-10 + i * 12} ${GROUND} L${30 + i * 8} ${GROUND - 14} L${34 + i * 8} ${GROUND - 14} L${-4 + i * 12} ${GROUND}`} fill={i % 2 ? '#8f7a35' : '#6d8a3a'} opacity={0.75} />);
      return (
        <g>
          {field}
          <g fill={INK}>
            <path d="M120 104 V74 L136 64 V74 L152 64 V74 L168 64 V74 L184 64 V104 Z" />
            <rect x={190} y={52} width={7} height={52} />
            <rect x={202} y={58} width={6} height={46} />
          </g>
          <circle cx={194} cy={44} r={6} fill="#d9d4c8" opacity={0.35} />
          <circle cx={200} cy={36} r={8} fill="#d9d4c8" opacity={0.25} />
          <circle cx={209} cy={28} r={10} fill="#d9d4c8" opacity={0.16} />
          {windows(rand, 122, 76, 60, 26, p.accent, 0.35)}
          <g>
            <rect x={240} y={84} width={50} height={20} fill={INK} />
            <rect x={238} y={86} width={54} height={5} fill={p.accent} opacity={0.85} />
            <rect x={246} y={93} width={38} height={9} fill={p.accent} opacity={0.3} />
          </g>
          <path d="M60 99 C 110 92, 150 96, 238 95" stroke={p.accent} strokeWidth={1.2} strokeDasharray="3 3" fill="none" opacity={0.7} />
        </g>
      );
    }
    case 'Technology': {
      const towers: ReactElement[] = [];
      let x = 60;
      for (let i = 0; i < 4; i++) {
        const w = 24 + rand() * 12;
        const h = 50 + rand() * 40;
        towers.push(
          <g key={i}>
            <rect x={x} y={GROUND - h} width={w} height={h} fill="#0b1830" />
            {windows(rand, x, GROUND - h, w, h, p.accent, 0.55)}
          </g>,
        );
        x += w + 18 + rand() * 20;
      }
      return (
        <g>
          <ellipse cx={170} cy={44} rx={96} ry={18} fill="none" stroke={p.accent} strokeWidth={0.8} opacity={0.35} />
          <ellipse cx={170} cy={44} rx={70} ry={11} fill="none" stroke={p.accent} strokeWidth={0.6} opacity={0.25} />
          {towers}
          <rect x={250} y={30} width={2} height={74} fill="#0b1830" />
          <path d="M251 30 L243 104 M251 30 L259 104" stroke="#0b1830" strokeWidth={1.4} />
          <circle cx={251} cy={29} r={2.2} fill="#ff5b4d" />
        </g>
      );
    }
    case 'Exports': {
      const containers = ['#d55e00', '#2f7de1', '#e69f00', '#009e73', '#cc79a7'];
      return (
        <g>
          <rect x={0} y={92} width={W} height={28} fill="#0d2738" opacity={0.85} />
          <path d={`M60 96 L250 96 L240 108 L70 108 Z`} fill={INK} />
          {Array.from({ length: 16 }, (_, i) => (
            <rect key={i} x={82 + (i % 8) * 18} y={84 - Math.floor(i / 8) * 8} width={16} height={7} fill={containers[(i * 3 + Math.floor(rand() * 5)) % 5]} opacity={0.9} />
          ))}
          <rect x={232} y={78} width={10} height={18} fill={INK} />
          <g stroke={INK} strokeWidth={2.4} fill="none">
            <path d="M270 92 V30 H310 M276 92 V30 M270 40 L300 30" />
            <path d="M20 92 V40 H52 M26 92 V40" />
          </g>
          <path d="M0 112 Q 40 108 80 112 T 160 112 T 240 112 T 320 112" stroke={p.accent} strokeWidth={0.8} fill="none" opacity={0.4} />
        </g>
      );
    }
    case 'Sandbox': {
      const lines: ReactElement[] = [];
      for (let i = -6; i <= 6; i++) lines.push(<path key={i} d={`M${160 + i * 10} ${GROUND - 14} L${160 + i * 46} ${H}`} stroke={p.accent} strokeWidth={0.6} opacity={0.35} />);
      for (let j = 0; j < 4; j++) lines.push(<path key={`h${j}`} d={`M0 ${GROUND - 10 + j * 6 + j * j} L${W} ${GROUND - 10 + j * 6 + j * j}`} stroke={p.accent} strokeWidth={0.6} opacity={0.3} />);
      return (
        <g>
          <path d={`M0 ${GROUND - 10} C 80 ${GROUND - 30}, 140 ${GROUND - 4}, 220 ${GROUND - 20} S 300 ${GROUND - 14}, 320 ${GROUND - 22} V ${H} H 0 Z`} fill="#20372d" />
          {lines}
          <g stroke={INK} strokeWidth={2} fill="none">
            <path d="M210 98 V38 M210 40 H262 M218 40 L210 48 M254 40 V58" />
          </g>
          <rect x={250} y={58} width={8} height={6} fill={p.accent} opacity={0.85} />
        </g>
      );
    }
    case 'Growth':
    default: {
      const bars: ReactElement[] = [];
      for (let i = 0; i < 8; i++) {
        const h = 16 + i * 9 + rand() * 6;
        const x = 70 + i * 24;
        bars.push(
          <g key={i}>
            <rect x={x} y={GROUND - h} width={18} height={h} fill={INK} />
            {windows(rand, x, GROUND - h, 18, h, p.accent, 0.35)}
          </g>,
        );
      }
      return (
        <g>
          {bars}
          <path d="M60 92 L104 80 L140 84 L176 64 L214 58 L248 36 L280 22" stroke={p.accent} strokeWidth={2} fill="none" strokeLinejoin="round" />
          <circle cx={280} cy={22} r={3.2} fill={p.accent} />
        </g>
      );
    }
  }
}

export const ScenarioArt = memo(function ScenarioArt({ id, pillar, className }: { id: string; pillar: Pillar; className?: string }) {
  const gid = useStableId('art');
  const p = PALETTES[pillar] ?? PALETTES.Growth;
  const rand = mulberry32(hashString(id));
  const sunX = 190 + rand() * 80;
  const sunY = 40 + rand() * 18;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${gid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.top} />
          <stop offset="100%" stopColor={p.bottom} />
        </linearGradient>
        <radialGradient id={`${gid}-sun`}>
          <stop offset="0%" stopColor={p.sun} stopOpacity={0.95} />
          <stop offset="35%" stopColor={p.sun} stopOpacity={0.45} />
          <stop offset="100%" stopColor={p.sun} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${gid}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="45%" stopColor="#080d13" stopOpacity={0} />
          <stop offset="100%" stopColor="#080d13" stopOpacity={0.78} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${gid}-sky)`} />
      <circle cx={sunX} cy={sunY} r={44} fill={`url(#${gid}-sun)`} />
      <circle cx={sunX} cy={sunY} r={9} fill={p.sun} opacity={0.95} />
      {skyline(rand, p.far, 0.55, 14, 46)}
      {motif(pillar, rand, p)}
      <rect x={0} y={GROUND} width={W} height={H - GROUND} fill={INK} />
      <rect width={W} height={H} fill={`url(#${gid}-fade)`} />
    </svg>
  );
});
