// Small presentational pieces shared by the U2 panels: product and building
// icons, owner chips, the "applies at month close" chip, Q/B/T bars and a
// labelled key/value list. Styling lives in pieces.module.css.

import clsx from 'clsx';
import {
  Anvil,
  Beer,
  Box,
  Building2,
  Car,
  Coffee,
  Cpu,
  Croissant,
  CupSoda,
  Factory,
  FlaskConical,
  Fuel,
  Gem,
  Layers,
  Package,
  Pickaxe,
  Radio,
  Ship,
  Shirt,
  Store,
  Timer,
  Tractor,
  Tv,
  Warehouse,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { BuildingStatus, BuildingTypeDto, ProductDto } from '@/bridge/protocol';
import { clock, useGameStore } from '@/state/gameStore';
import { ownerColor, ownerEmblem } from '@/theme/tokens';
import { Badge, Emblem, Tooltip, type Tone } from '@/ui/components';
import { useInterval } from '@/ui/hooks';
import styles from './pieces.module.css';

const PRODUCT_ICONS: Record<string, LucideIcon> = {
  soft_drink: CupSoda,
  beer: Beer,
  coffee_drink: Coffee,
  bread: Croissant,
  car: Car,
  television: Tv,
  t_shirt: Shirt,
  designer_jeans: Shirt,
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  beverage: CupSoda,
  food: Croissant,
  automotive: Car,
  apparel: Shirt,
  electronics: Cpu,
  crop: Wheat,
  petroleum: Fuel,
  mineral: Gem,
  textile: Layers,
  food_ingredient: Package,
  polymer: Box,
  metal: Anvil,
};

export function productIcon(product: Pick<ProductDto, 'id' | 'category'> | undefined): LucideIcon {
  if (!product) return Package;
  return PRODUCT_ICONS[product.id] ?? CATEGORY_ICONS[product.category] ?? Package;
}

const TIER_CLASS: Record<string, string | undefined> = { raw: styles.tierRaw, intermediate: styles.tierMid, finished: styles.tierFinished };

/** Product icon in a tier-tinted tile (raw = earth, intermediate = steel, finished = gold). */
export function ProductGlyph({ product, size = 'md', className }: { product: ProductDto | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const Icon = productIcon(product);
  const px = size === 'sm' ? 12 : size === 'lg' ? 18 : 14;
  return (
    <span className={clsx(styles.glyph, styles[`glyph-${size}`], product && TIER_CLASS[product.tier], className)} aria-hidden>
      <Icon size={px} strokeWidth={2} />
    </span>
  );
}

export function buildingIcon(type: Pick<BuildingTypeDto, 'buildMenuGroup' | 'category'> | undefined): LucideIcon {
  switch (type?.category) {
    case 'farm':
    case 'plantation':
      return Tractor;
    case 'mine':
    case 'oil_well':
      return Pickaxe;
    case 'seaport':
      return Ship;
    default:
      break;
  }
  switch (type?.buildMenuGroup) {
    case 'retail':
      return Store;
    case 'production':
      return Factory;
    case 'extraction':
      return Pickaxe;
    case 'logistics':
      return Warehouse;
    case 'research':
      return FlaskConical;
    case 'media':
      return Radio;
    default:
      return Building2;
  }
}

/** Company emblem + name in its owner colour (player gets the gold ring). */
export function OwnerChip({ companyId, name, isPlayer, compact = false }: { companyId: number; name: string; isPlayer?: boolean; compact?: boolean }) {
  const company = useGameStore((s) => s.hud?.companies.find((c) => c.id === companyId));
  const index = company?.colorIndex ?? (isPlayer ? 0 : 1 + (Math.abs(companyId) % 7));
  return (
    <span className={clsx(styles.owner, compact && styles.ownerCompact)}>
      <Emblem shape={company?.emblem ?? ownerEmblem(index)} color={company?.color ?? ownerColor(index)} size={compact ? 12 : 14} ring={isPlayer ?? company?.isPlayer} />
      <span className={clsx(styles.ownerName, (isPlayer ?? company?.isPlayer) && styles.ownerYou)}>{(isPlayer ?? company?.isPlayer) ? 'You' : name}</span>
    </span>
  );
}

/** Visual days until the month closes, refreshed twice a second. */
export function useDaysUntilClose(): number {
  const [days, setDays] = useState(() => clock.daysUntilClose);
  useInterval(() => setDays(clock.daysUntilClose), 500);
  return days;
}

/** "Applies at month close (in 9 days)" — player commands take effect at the next close (D5). */
export function PendingChip({ label = 'Applies at month close', className }: { label?: string; className?: string }) {
  const days = useDaysUntilClose();
  return (
    <span className={clsx(styles.pending, className)}>
      <Timer size={12} />
      {label}
      <span className={styles.pendingDays}>{days <= 0 ? 'now' : `in ${days} day${days === 1 ? '' : 's'}`}</span>
    </span>
  );
}

export const STATUS_META: Record<BuildingStatus, { label: string; tone: Tone; hint: string }> = {
  operating: { label: 'Operating', tone: 'success', hint: 'Open and trading.' },
  idle: { label: 'Idle', tone: 'warning', hint: 'No units configured: it costs money and earns nothing.' },
  passive: { label: 'Passive', tone: 'info', hint: 'Media: no units, boosts your ads on its channel.' },
  starved: { label: 'Starved', tone: 'warning', hint: 'Short of inputs: units are running below capacity.' },
  soldOut: { label: 'Sold out', tone: 'warning', hint: 'Shelves ran empty: you are losing sales.' },
  underConstruction: { label: 'Under construction', tone: 'info', hint: 'Opens when construction completes.' },
  closed: { label: 'Closed', tone: 'neutral', hint: 'Not trading.' },
  forSale: { label: 'For sale', tone: 'neutral', hint: 'Listed for sale.' },
};

export function StatusBadge({ status }: { status: BuildingStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'neutral' as Tone, hint: '' };
  return (
    <Tooltip content={meta.hint} side="bottom">
      <Badge tone={meta.tone} dot>
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

/** Quality / Brand / Tech as three mini bars (0–100; tech scaled to its max). */
export function QbtBars({ quality, brand, tech, techMax = 10 }: { quality: number; brand: number; tech: number; techMax?: number }) {
  const bar = (label: string, value: number, max: number, cls: string, text: string) => (
    <span className={styles.qbt} title={`${label}: ${text}`}>
      <span className={styles.qbtLabel}>{label[0]}</span>
      <span className={styles.qbtTrack}>
        <span className={clsx(styles.qbtFill, cls)} style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      </span>
    </span>
  );
  return (
    <span className={styles.qbtRow}>
      {bar('Quality', quality, 100, styles.qbtQ, quality.toFixed(0))}
      {bar('Brand', brand, 100, styles.qbtB, brand.toFixed(0))}
      {bar('Tech', tech, Math.max(1, techMax), styles.qbtT, `${tech}/${techMax}`)}
    </span>
  );
}

/** Label / value rows (confirm card, finance). */
export function KeyValues({ rows, className }: { rows: readonly ({ label: ReactNode; value: ReactNode; tone?: 'pos' | 'neg' | 'muted' | 'gold'; strong?: boolean } | null | false)[]; className?: string }) {
  return (
    <dl className={clsx(styles.kv, className)}>
      {rows.filter(Boolean).map((r, i) => {
        const row = r as { label: ReactNode; value: ReactNode; tone?: 'pos' | 'neg' | 'muted' | 'gold'; strong?: boolean };
        return (
          <div key={i} className={clsx(styles.kvRow, row.strong && styles.kvStrong)}>
            <dt>{row.label}</dt>
            <dd className={row.tone ? styles[`kv-${row.tone}`] : undefined}>{row.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Inline notice row (warnings inside panels; the alerts policy keeps toasts for engine events). */
export function Notice({ tone = 'info', icon, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'opportunity'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={clsx(styles.notice, styles[`notice-${tone}`])} role={tone === 'danger' ? 'alert' : undefined}>
      {icon && <span className={styles.noticeIcon}>{icon}</span>}
      <span className={styles.noticeText}>{children}</span>
      {action && <span className={styles.noticeAction}>{action}</span>}
    </div>
  );
}

/** Uppercase section label with an optional right-hand slot. */
export function SectionHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className={styles.sectionHead}>
      <span>{children}</span>
      {right && <span className={styles.sectionRight}>{right}</span>}
    </div>
  );
}
