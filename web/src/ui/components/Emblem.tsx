// Company emblem (art §3.4): an owner-coloured shape — circle, triangle, square,
// diamond, star, hexagon, cross, ring — so ownership never relies on colour
// alone. The player's emblem wears the gold ring (D15: "player = gold badge").

import type { OwnerEmblem } from '@/theme/tokens';
import { STATUS, UI } from '@/theme/tokens';

export interface EmblemProps {
  shape: OwnerEmblem;
  color: string;
  size?: number;
  /** Gold ring around the badge (the player's companies). */
  ring?: boolean;
  title?: string;
  className?: string;
}

function shapePath(shape: OwnerEmblem): string {
  switch (shape) {
    case 'triangle':
      return 'M12 4.2 L20 18.4 L4 18.4 Z';
    case 'square':
      return 'M5.5 5.5 H18.5 V18.5 H5.5 Z';
    case 'diamond':
      return 'M12 3.6 L20.4 12 L12 20.4 L3.6 12 Z';
    case 'star':
      return 'M12 3.4 L14.4 9.2 L20.6 9.6 L15.8 13.5 L17.4 19.6 L12 16.2 L6.6 19.6 L8.2 13.5 L3.4 9.6 L9.6 9.2 Z';
    case 'hexagon':
      return 'M12 3.6 L19.3 7.8 L19.3 16.2 L12 20.4 L4.7 16.2 L4.7 7.8 Z';
    case 'cross':
      return 'M9.4 4.5 H14.6 V9.4 H19.5 V14.6 H14.6 V19.5 H9.4 V14.6 H4.5 V9.4 H9.4 Z';
    case 'ring':
      return 'M12 4.2 A7.8 7.8 0 1 1 11.99 4.2 Z M12 8.4 A3.6 3.6 0 1 0 12.01 8.4 Z';
    case 'circle':
    default:
      return 'M12 4.6 A7.4 7.4 0 1 1 11.99 4.6 Z';
  }
}

export function Emblem({ shape, color, size = 20, ring = false, title, className }: EmblemProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {ring && <circle cx="12" cy="12" r="11" fill="none" stroke={STATUS.ring} strokeWidth="1.6" />}
      <circle cx="12" cy="12" r={ring ? 9.2 : 11} fill={UI.ink} opacity={0.55} />
      <path d={shapePath(shape)} fill={color} fillRule="evenodd" stroke="rgba(0,0,0,0.35)" strokeWidth="0.6" transform={ring ? 'translate(12 12) scale(0.8) translate(-12 -12)' : undefined} />
    </svg>
  );
}
