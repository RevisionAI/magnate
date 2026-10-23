// World-anchored DOM labels (art §5.22): a small pool positioned every frame with Vector3.project — the hover card
// (at the cursor), the selection tag over the selected building, the placement ghost's cost tag, floating "+$X"
// popups (bus `worldPopup`) and landmark names at district/city zoom. Status badges are GPU billboards (Badges.ts).
import * as THREE from 'three';
import { ownerColor, ownerEmblem, type OwnerEmblem, STATUS, UI } from '@/theme/tokens';
import { compact, money, percent, signedMoney } from '@/util/format';
import type { BuildingModel } from './CityData';
import type { GhostState } from './interactionStore';
import styles from './Labels.module.css';

const _v = new THREE.Vector3();

/** SVG markup of an owner emblem (colour-blind redundancy, art §3.4). */
export function emblemSvg(kind: OwnerEmblem, color: string): string {
  const s = 12, c = 6, r = 5;
  const poly = (n: number, rot: number, rr = r) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i / n) * Math.PI * 2;
      return `${(c + Math.cos(a) * rr).toFixed(2)},${(c + Math.sin(a) * rr).toFixed(2)}`;
    }).join(' ');
  let shape: string;
  switch (kind) {
    case 'triangle': shape = `<polygon points="${poly(3, -Math.PI / 2, 5.6)}"/>`; break;
    case 'square': shape = `<rect x="1.8" y="1.8" width="8.4" height="8.4" rx="0.6"/>`; break;
    case 'diamond': shape = `<polygon points="${poly(4, -Math.PI / 2, 5.6)}"/>`; break;
    case 'hexagon': shape = `<polygon points="${poly(6, 0)}"/>`; break;
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? 2.4 : 5.6;
        return `${(c + Math.cos(a) * rr).toFixed(2)},${(c + Math.sin(a) * rr).toFixed(2)}`;
      }).join(' ');
      shape = `<polygon points="${pts}"/>`;
      break;
    }
    case 'cross': shape = `<path d="M4.4 1h3.2v3.4H11v3.2H7.6V11H4.4V7.6H1V4.4h3.4z"/>`; break;
    case 'ring': shape = `<circle cx="6" cy="6" r="4" fill="none" stroke="${color}" stroke-width="2"/>`; break;
    default: shape = `<circle cx="6" cy="6" r="5"/>`;
  }
  return `<svg class="${styles.emblem}" viewBox="0 0 ${s} ${s}" fill="${color}" aria-hidden="true">${shape}</svg>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const STATUS_TEXT: Record<string, string> = {
  operating: 'Operating', idle: 'Idle — nothing configured', passive: 'Passive', starved: 'Starved of inputs',
  soldOut: 'Sold out', underConstruction: 'Under construction', closed: 'Closed', forSale: 'For sale',
};

/** Hover-card HTML for a building (UX §6.5: name, owner, type, headline KPI). */
/** Hover card for a company truck (W5 traffic, picked through `pickTruck`): product and route. */
export function truckCardHtml(t: { owner: number; kind: string; product: string; from: string; to: string; mine: boolean; ownerName: string }): string {
  const color = ownerColor(t.owner);
  const what = t.kind === 'import' ? 'Import' : t.kind === 'export' ? 'Export' : 'Delivery';
  return (
    `<div class="${styles.card}${t.mine ? ` ${styles.cardMine}` : ''}">` +
    `<div class="${styles.cardHead}">${emblemSvg(ownerEmblem(t.owner), color)}<span class="${styles.cardName}">${esc(what)} truck · ${esc(t.product)}</span></div>` +
    `<div class="${styles.cardSub}"><span class="${styles.owner}" style="color:${t.mine ? UI.gold : color}">${esc(t.mine ? 'You' : t.ownerName)}</span> · ${esc(t.from)} → ${esc(t.to)}</div>` +
    `</div>`
  );
}

export function hoverCardHtml(b: BuildingModel): string {
  const color = ownerColor(b.colorIndex);
  const owner = b.isPlayer ? 'You' : b.ownerName;
  const level = b.level > 1 ? ` · Level ${b.level}` : '';
  const kpis: string[] = [];
  const ni = b.netIncome;
  const niClass = ni > 0.5 ? styles.pos : ni < -0.5 ? styles.neg : '';
  if (b.status === 'underConstruction') {
    kpis.push(`<span class="${styles.warn}">Under construction</span>`);
  } else {
    if (b.unitsSold > 0) kpis.push(`<span class="${styles.kpi}"><span class="${styles.kpiLabel}">Sold</span>${compact(b.unitsSold, 2)}</span>`);
    else if (b.revenue > 0) kpis.push(`<span class="${styles.kpi}"><span class="${styles.kpiLabel}">Revenue</span>${money(b.revenue)}</span>`);
    if (b.utilization !== null && b.unitsSold <= 0) kpis.push(`<span class="${styles.kpi}"><span class="${styles.kpiLabel}">Use</span>${percent(b.utilization, 0)}</span>`);
    if (b.isPlayer || ni !== 0) kpis.push(`<span class="${styles.kpi}"><span class="${styles.kpiLabel}">Net</span><span class="${niClass}">${signedMoney(ni)}</span></span>`);
    if (b.status !== 'operating' && STATUS_TEXT[b.status]) kpis.push(`<span class="${styles.warn}">${STATUS_TEXT[b.status]}</span>`);
  }
  const products = b.products.length ? ` · ${b.products.length} product${b.products.length > 1 ? 's' : ''}` : '';
  return (
    `<div class="${styles.card}${b.isPlayer ? ` ${styles.cardMine}` : ''}">` +
    `<div class="${styles.cardHead}">${emblemSvg(ownerEmblem(b.colorIndex), color)}<span class="${styles.cardName}">${esc(b.name)}</span></div>` +
    `<div class="${styles.cardSub}"><span class="${styles.owner}" style="color:${b.isPlayer ? UI.gold : color}">${esc(owner)}</span> · ${esc(b.typeName)}${level}${products}</div>` +
    (kpis.length ? `<div class="${styles.cardKpis}">${kpis.join('')}</div>` : '') +
    `<div class="${styles.hint}">Click to inspect · Double-click to focus · Right-click for actions</div>` +
    `</div>`
  );
}

/** Selection tag: name + last month's net income (yours, or a rival's when known). */
export function selectionTagHtml(b: BuildingModel): string {
  const ni = b.netIncome;
  const cls = ni > 0.5 ? styles.pos : ni < -0.5 ? styles.neg : '';
  const value = b.isPlayer || ni !== 0 ? `<span class="${styles.tagValue} ${cls}">${signedMoney(ni)}</span>` : '';
  return `${emblemSvg(ownerEmblem(b.colorIndex), ownerColor(b.colorIndex))}<span>${esc(b.name)}</span>${value}`;
}

const GHOST_COLORS: Record<GhostState['status'], string> = {
  pending: UI.muted, valid: STATUS.profitable, warning: STATUS.warning, blocked: STATUS.loss, own: '#9FB2BD',
};

export function ghostColor(status: GhostState['status']): string {
  return GHOST_COLORS[status];
}

const GHOST_STATUS_TEXT: Record<GhostState['status'], string> = {
  pending: 'Checking site…', valid: 'Good site', warning: 'Valid — check your cash', blocked: 'Can’t build here', own: 'Your building is here',
};

/** Ghost tag HTML: type, total cost, validity and the key hints (UX §6.6). */
export function ghostTagHtml(g: GhostState, typeName: string): string {
  const p = g.preview;
  const rows: string[] = [];
  if (p) {
    if (p.landCost !== undefined && p.landCost > 0) rows.push(`<span>Land</span><b>${money(p.landCost)}</b>`);
    rows.push(`<span>Construction</span><b>${money(p.constructionCost)}</b>`);
    rows.push(`<span>Opex</span><b>${money(p.monthlyOpex)}/mo</b>`);
    if (p.constructionMonths !== undefined) rows.push(`<span>Build time</span><b>${p.constructionMonths} mo</b>`);
    rows.push(`<span>Cash after</span><b class="${p.cashAfter < 0 ? styles.neg : ''}">${money(p.cashAfter)}</b>`);
    if (p.catchment) rows.push(`<span>Catchment</span><b>${compact(p.catchment.potentialUnitsPerMonth)}/mo · ${p.catchment.rivalsWithinRadius} rival${p.catchment.rivalsWithinRadius === 1 ? '' : 's'}</b>`);
  }
  const status = g.reason && g.status !== 'valid' ? g.reason : GHOST_STATUS_TEXT[g.status];
  return (
    `<div class="${styles.ghostHead}"><span class="${styles.ghostTitle}">${esc(typeName)}</span>` +
    (p ? `<span class="${styles.ghostCost}">${money(p.totalCost)}</span>` : '') +
    `</div>` +
    `<div class="${styles.ghostStatus}"><span class="${styles.dot}"></span>${esc(status)}</div>` +
    (rows.length ? `<div class="${styles.ghostRows}">${rows.join('')}</div>` : '') +
    `<div class="${styles.keys}"><span><kbd>Q</kbd><kbd>E</kbd>rotate</span><span><kbd>Click</kbd>place</span><span><kbd>Esc</kbd>cancel</span></div>`
  );
}

interface Popup {
  el: HTMLDivElement;
  world: THREE.Vector3;
  start: number;
  duration: number;
}

export interface LandmarkLabel {
  text: string;
  world: THREE.Vector3;
  cbd?: boolean;
}

/** Owns the DOM layer and positions every label once per frame. */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private readonly ghost: HTMLDivElement;
  private readonly landmarkEls: { el: HTMLDivElement; label: LandmarkLabel }[] = [];
  private readonly popups: Popup[] = [];
  private cardHtml = '';
  private tagHtml = '';
  private ghostHtml = '';
  private cardPos: { x: number; y: number } | null = null;
  private tagWorld: THREE.Vector3 | null = null;
  private ghostWorld: THREE.Vector3 | null = null;
  private width = 1;
  private height = 1;
  private time = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = styles.layer;
    this.root.dataset.testid = 'world-labels';
    this.card = this.anchor();
    this.card.dataset.testid = 'hover-card';
    this.tag = this.anchor();
    this.tag.dataset.testid = 'selection-tag';
    this.ghost = this.anchor();
    this.ghost.dataset.testid = 'ghost-tag';
    container.appendChild(this.root);
  }

  private anchor(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = styles.anchor;
    el.style.display = 'none';
    this.root.appendChild(el);
    return el;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Hover card at a client-space position (relative to the layer), or hidden. */
  setHoverCard(html: string | null, x = 0, y = 0): void {
    if (!html) {
      this.card.style.display = 'none';
      this.cardHtml = '';
      this.cardPos = null;
      return;
    }
    if (html !== this.cardHtml) {
      this.card.innerHTML = html;
      this.cardHtml = html;
    }
    this.card.style.display = '';
    this.cardPos = { x, y };
  }

  setSelectionTag(html: string | null, world: THREE.Vector3 | null): void {
    if (!html || !world) {
      this.tag.style.display = 'none';
      this.tagWorld = null;
      this.tagHtml = '';
      return;
    }
    if (html !== this.tagHtml) {
      this.tag.innerHTML = `<div class="${styles.tag}">${html}</div>`;
      this.tagHtml = html;
    }
    this.tag.style.display = '';
    this.tagWorld = world.clone();
  }

  setGhostTag(html: string | null, world: THREE.Vector3 | null, color = ''): void {
    if (!html || !world) {
      this.ghost.style.display = 'none';
      this.ghostWorld = null;
      this.ghostHtml = '';
      return;
    }
    if (html !== this.ghostHtml) {
      this.ghost.innerHTML = `<div class="${styles.ghost}" style="--ghost-color:${color}">${html}</div>`;
      this.ghostHtml = html;
    }
    this.ghost.style.display = '';
    this.ghostWorld = world.clone();
  }

  setLandmarks(list: readonly LandmarkLabel[]): void {
    for (const l of this.landmarkEls) l.el.remove();
    this.landmarkEls.length = 0;
    for (const label of list.slice(0, 24)) {
      const el = this.anchor();
      el.innerHTML = `<div class="${styles.landmark}${label.cbd ? ` ${styles.landmarkCbd}` : ''}">${esc(label.text)}</div>`;
      this.landmarkEls.push({ el, label });
    }
  }

  /** Floating "+$X" over a world point (UX §8): rises 46 px and fades over 1.6 s. */
  popup(world: THREE.Vector3, text: string, tone: 'gain' | 'loss' | 'gold' | 'neutral', delayMs = 0): void {
    const el = this.anchor();
    el.innerHTML = `<div class="${styles.popup} ${styles[tone]}">${esc(text)}</div>`;
    this.popups.push({ el, world: world.clone(), start: this.time + delayMs / 1000, duration: 1.6 });
    while (this.popups.length > 24) this.popups.shift()!.el.remove();
  }

  /** Position everything. `zoom01` fades the landmark names in from the district band. */
  update(camera: THREE.Camera, dt: number, zoom01: number, reducedMotion: boolean): void {
    this.time += dt;
    if (this.cardPos) {
      const w = this.card.offsetWidth || 220, h = this.card.offsetHeight || 90;
      let x = this.cardPos.x + 18, y = this.cardPos.y + 20;
      if (x + w > this.width - 8) x = this.cardPos.x - w - 14;
      if (y + h > this.height - 8) y = this.cardPos.y - h - 14;
      this.card.style.transform = `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)`;
    }
    this.place(this.tag, this.tagWorld, camera);
    this.place(this.ghost, this.ghostWorld, camera);
    const lmOpacity = Math.min(1, Math.max(0, (zoom01 - 0.3) / 0.2));
    for (const { el, label } of this.landmarkEls) {
      if (lmOpacity <= 0.01) { el.style.display = 'none'; continue; }
      el.style.opacity = lmOpacity.toFixed(2);
      this.place(el, label.world, camera);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      const t = (this.time - p.start) / p.duration;
      if (t < 0) { p.el.style.display = 'none'; continue; }
      if (t >= 1) { p.el.remove(); this.popups.splice(i, 1); continue; }
      const rise = reducedMotion ? 0 : 46 * (1 - (1 - t) * (1 - t));
      const ok = this.place(p.el, p.world, camera, -rise);
      if (ok) p.el.style.opacity = (t < 0.12 ? t / 0.12 : t > 0.7 ? (1 - t) / 0.3 : 1).toFixed(2);
    }
  }

  /** Project a world point to the layer; hides the element when behind the camera or far off screen. */
  private place(el: HTMLElement, world: THREE.Vector3 | null, camera: THREE.Camera, dy = 0): boolean {
    if (!world) return false;
    _v.copy(world).project(camera);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.3 || Math.abs(_v.y) > 1.3) {
      el.style.display = 'none';
      return false;
    }
    const x = (_v.x * 0.5 + 0.5) * this.width, y = (-_v.y * 0.5 + 0.5) * this.height + dy;
    el.style.display = '';
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    return true;
  }

  dispose(): void {
    this.root.remove();
    this.popups.length = 0;
    this.landmarkEls.length = 0;
  }
}
