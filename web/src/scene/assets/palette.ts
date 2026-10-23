// 3D palette: the world colours of web/src/theme/tokens.ts (the single source of truth, MASTER-PLAN §4.8) as sRGB
// byte triples for GeoBuilder, plus the per-asset colours that the art bible specifies for a single asset only
// (docs/overhaul/research/art-rendering.md §4). Vertex colours are stored as sRGB bytes and decoded to linear in
// CityMaterial, so these values reproduce the hex codes exactly. Owned by W4; W3 may import it freely.
import { NEUTRAL_OWNER, OWNER_COLORS, STATUS, WORLD } from '../../theme/tokens';
import type { RGB } from './GeoBuilder';

/** "#RRGGBB" or "#RGB" → sRGB byte triple. Throws on malformed input (palettes are static, so fail loudly). */
export function hexRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad colour: ${hex}`);
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Byte triple → "#RRGGBB" (for instance colours and debugging). */
export function rgbHex(c: RGB): string {
  return '#' + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Multiply a colour by k (clamped); k < 1 darkens. Used for baked contact aprons and subtle face variation. */
export function shade(c: RGB, k: number): RGB {
  return [clampByte(c[0] * k), clampByte(c[1] * k), clampByte(c[2] * k)];
}

/** Linear mix between two colours in sRGB byte space (t = 0 → a, 1 → b). */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t));
  return [clampByte(a[0] + (b[0] - a[0]) * u), clampByte(a[1] + (b[1] - a[1]) * u), clampByte(a[2] + (b[2] - a[2]) * u)];
}

function clampByte(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x)));
}

/** sRGB byte (0..255) → linear 0..1 (the curve CityMaterial's m_srgb2lin decodes vertex colours with). */
export function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Linear 0..1 → sRGB byte. */
export function linearToSrgb(v: number): number {
  const x = Math.max(0, Math.min(1, v));
  return clampByte((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255);
}

/** Instance colour ("#RRGGBB") that turns faces of vertex colour `base` (written with tint weight 255) into `target`:
 *  CityMaterial multiplies the linear vertex colour by the instance colour, and three decodes the hex from sRGB, so the
 *  multiplier is computed in linear space. Channels where target > base clamp at 1 (target unreachable). */
export function tintHex(base: RGB, target: RGB): string {
  const m = (i: number) => linearToSrgb(Math.min(1, srgbToLinear(target[i]) / Math.max(1e-4, srgbToLinear(base[i]))));
  return rgbHex([m(0), m(1), m(2)]);
}

function group<T extends Record<string, string>>(g: T): { readonly [K in keyof T]: RGB } {
  const out = {} as { [K in keyof T]: RGB };
  for (const k of Object.keys(g) as (keyof T)[]) out[k] = hexRgb(g[k]);
  return out;
}

/** WORLD (tokens.ts) with every hex leaf converted to an RGB byte triple; same structure and key names. */
export const WORLD_RGB = {
  ground: group(WORLD.ground),
  road: group(WORLD.road),
  wall: group(WORLD.wall),
  roof: group(WORLD.roof),
  industry: group(WORLD.industry),
  vegetation: group(WORLD.vegetation),
  crops: group(WORLD.crops),
  water: group(WORLD.water),
  vehicles: {
    /** Body colour distribution: [colour, share]; shares sum to 1. */
    bodies: WORLD.vehicles.bodies.map(([hex, share]) => [hexRgb(hex), share] as const) as ReadonlyArray<readonly [RGB, number]>,
    taxi: hexRgb(WORLD.vehicles.taxi),
    bus: hexRgb(WORLD.vehicles.bus),
    trailer: hexRgb(WORLD.vehicles.trailer),
  },
} as const;

/** Owner (company) colours by colorIndex as RGB bytes; index 0 is always the player (D15). */
export const OWNER_RGB: readonly RGB[] = OWNER_COLORS.map(hexRgb);

/** Neutral owner colour (civic buildings, local competitors, unowned). */
export const NEUTRAL_RGB: RGB = hexRgb(NEUTRAL_OWNER);

/** Gold "yours" ring / status colours as bytes. */
export const STATUS_RGB = group(STATUS);

/** Colour for an owner index 0..7; 255 (none) or anything out of range → neutral blue-grey. */
export function ownerRgb(owner: number): RGB {
  return owner >= 0 && owner < OWNER_RGB.length && Number.isInteger(owner) ? OWNER_RGB[owner] : NEUTRAL_RGB;
}

/** Owner colour as "#RRGGBB" (instance colours for owner-livery props such as truck cabs). */
export function ownerHex(owner: number): string {
  return owner >= 0 && owner < OWNER_COLORS.length && Number.isInteger(owner) ? OWNER_COLORS[owner] : NEUTRAL_OWNER;
}

/** Colours the art bible specifies for individual assets (§4.1–§4.3). Kept here, not in tokens.ts, because no UI uses
 *  them; every value cites the bible entry that defines it. */
export const ASSET_HEX = {
  barnRed: '#A8483A', // §4.2.9 red barn walls
  ore: '#8E5A45', // §4.2.12 ore stockpile
  spoil1: '#7A6A5A', // §4.2.12 spoil heaps
  spoil2: '#8B7B69',
  haulTruck: '#E0B43A', // §4.2.12 haul trucks, §4.3 construction vehicles
  pumpjackIron: '#3F4A55', // §4.2.13 crank arms, counterweights
  valveRed: '#B8322E', // §4.2.13 wellhead valves
  derrick: '#D9A441', // §4.2.13 drilling derrick; §4.1 scaffold bars
  scaffoldGrey: '#8E8C87', // §4.1 scaffold lattice second colour
  hull: '#3A4A5C', // §4.2.8 feeder ship hull
  antifouling: '#9A3A2E', // §4.2.8 waterline band
  closedGrey: '#9A9A9A', // §4.1 closed sign
  boarded: '#8A6A4A', // §4.1 boarded glazing
  weeds: '#C4BE82', // §4.1 weed patches (dryGrass)
  siteCabin: '#E4E4DE', // §4.1 site cabins
  patio: '#D8C7A0', // §4.2.11 coffee drying patio
  beans: '#6B4A2E', // §4.2.11 drying beans
  tractor: '#4F7A43', // §4.2.9 tractor body
  tractorWheel: '#B8322E', // §4.2.9 red wheels
  contact: '#2B2E33', // §3.10 vehicle contact shadow
  dockShelter: '#2A2C30', // §4.2.6 black dock shelters
  rail: '#4A4E55', // crane rails, conveyor belts
  cherry: '#B8323A', // §3.3 coffee cherries
  craneWhite: '#ECEBE6', // §4.2.8 boom white
  pond: '#3F86A8', // §3.3 water mid (farm ponds; CityMaterial has no water shader)
  pondEdge: '#C9B98A', // muddy sand rim
  flame: '#FF9B3A', // §4.3 flare billboard
  floodHead: '#EAF2FF', // §4.2.8 cool-white floods
  lampHead: '#FFF1C4', // §4.3 street-light head
  workLight: '#FFE6A8',
  oastCowl: '#F2F0EA', // §4.2.11 white cowl
  glassRoof: '#6F8FA6', // §4.2.2 glass roofs (glass2)
} as const;

/** ASSET_HEX as RGB bytes. */
export const ASSET_RGB = group(ASSET_HEX);

/** 40 ft container colours (§4.2.8). Deterministic pick by index. */
export const CONTAINER_HEX = ['#B3483A', '#2F6F9F', '#C99A3A', '#4F8A5B', '#8C8F94', '#6C4F8C', '#D96C3B', '#E4E4DE'] as const;
export const CONTAINER_RGB: readonly RGB[] = CONTAINER_HEX.map(hexRgb);

/** Pick a vehicle body colour by the §3.3 distribution from a uniform 0..1 value (deterministic). */
export function vehicleBodyHex(u: number): string {
  let acc = 0;
  for (const [hex, share] of WORLD.vehicles.bodies) {
    acc += share;
    if (u < acc) return hex;
  }
  return WORLD.vehicles.bodies[0][0];
}
