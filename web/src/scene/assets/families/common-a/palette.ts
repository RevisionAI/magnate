// Colours for the W3 asset families as GeoBuilder RGB byte triples (sRGB).
//
// Every colour that exists in the shared theme (`web/src/theme/tokens.ts`, art bible §3.3) is taken from there.
// The few extra colours below are the art-bible values that the theme does not carry (yet); each cites its section.
// Owner colours are never used here except through `ownerRgb()` (company paint slots only, art §3.4).
import { NEUTRAL_OWNER, OWNER_COLORS, WORLD } from '@/theme/tokens';
import type { RGB } from '../../GeoBuilder';
import { rgb } from '../../shapes';

type RgbOf<T> = { readonly [K in keyof T]: RGB };
function conv<T extends Record<string, string>>(section: T): RgbOf<T> {
  const out: Record<string, RGB> = {};
  for (const key of Object.keys(section)) out[key] = rgb(section[key]);
  return out as RgbOf<T>;
}

/** The world palette (art §3.3) as RGB bytes. */
export const P = {
  ground: conv(WORLD.ground),
  road: conv(WORLD.road),
  wall: conv(WORLD.wall),
  roof: conv(WORLD.roof),
  ind: conv(WORLD.industry),
  veg: conv(WORLD.vegetation),
  water: conv(WORLD.water),
} as const;

/** Art-bible colours that are not theme tokens (hex, sRGB). */
export const HEX = {
  /** §4.3 local-competitor awnings: muted, never an owner colour. */
  awnings: ['#B0735F', '#4F7F82', '#C9A45B', '#7C9563', '#8C74A0', '#5E7FA8'],
  /** §3.16 / §4.1 closed: sign swapped to grey. */
  signGrey: '#9A9A9A',
  /** §4.3 street-light pole and LED head. */
  lampPole: '#5D646C',
  lampHead: '#FFF1C4',
  /** §4.3 traffic-light poles, billboard frames. */
  signalPole: '#3E444B',
  /** §4.3 school sports field and running track; stadium pitch (+ a mown-stripe shade). */
  sportsField: '#7FAE5A',
  runningTrack: '#C6734E',
  pitch: '#5E9E4A',
  pitchStripe: '#6AA853',
  /** §4.2.14 broadcast towers: red / white bands. Also the hospital cross. */
  mastRed: '#D8453A',
  mastWhite: '#E8E4DC',
  /** §3.13 aviation obstruction light. */
  aviation: '#FF4A3A',
  /** §3.10 baked contact quad under vehicles. */
  contact: '#2B2E33',
  /** §4.3 vehicle cabin glass. */
  cabinGlass: '#39424C',
  /** §3.14 spring blossom and bare winter canopy (tree instance colours). */
  blossom: '#F2C6D0',
  bare: '#8A7F70',
  /** §3.3 tree instance tints (multiply vegetation by about ±12%). */
  treeTints: ['#FFFFFF', '#E8F2D8', '#F4F7E6', '#DDEBCB', '#FFF2D0'],
  /** Doors and timber (muted; not in the bible's tables). */
  doors: ['#5A4636', '#3E5A4E', '#7A3E36', '#2F3E52', '#6B6F73'],
  timber: '#8B6B4E',
  bronze: '#7A5C3E',
  /** Civic service colours (police blue band and light bar, fire-station doors). */
  policeBlue: '#2F5D9E',
  policeLight: '#3D7BFF',
  fireRed: '#B5413A',
  /** Play equipment (muted primaries) and parasols for ambient terraces. */
  play: ['#C9A45B', '#5E7FA8', '#B0735F', '#7C9563'],
  /** Traffic-signal aspects (red = aviation red, amber = safety yellow token, green below). */
  signalGreen: '#47C97A',
  /** LED ticker / screens (dark housing). */
  screenDark: '#23282E',
  /** Warm interior light colour for emissive glazing bits (lobbies, rose windows, clock faces). */
  warmLight: '#FFD9A0',
  /** Cool white of hospital corridors and stair cores that stay lit all night (art §4.3 hospital "always 0.6"). */
  coolLight: '#E6F0FF',
} as const;

/** Same pre-converted to RGB bytes. */
export const X = {
  signGrey: rgb(HEX.signGrey),
  lampPole: rgb(HEX.lampPole),
  lampHead: rgb(HEX.lampHead),
  signalPole: rgb(HEX.signalPole),
  sportsField: rgb(HEX.sportsField),
  runningTrack: rgb(HEX.runningTrack),
  pitch: rgb(HEX.pitch),
  pitchStripe: rgb(HEX.pitchStripe),
  mastRed: rgb(HEX.mastRed),
  mastWhite: rgb(HEX.mastWhite),
  aviation: rgb(HEX.aviation),
  contact: rgb(HEX.contact),
  cabinGlass: rgb(HEX.cabinGlass),
  timber: rgb(HEX.timber),
  bronze: rgb(HEX.bronze),
  policeBlue: rgb(HEX.policeBlue),
  policeLight: rgb(HEX.policeLight),
  fireRed: rgb(HEX.fireRed),
  screenDark: rgb(HEX.screenDark),
  signalGreen: rgb(HEX.signalGreen),
  warmLight: rgb(HEX.warmLight),
  coolLight: rgb(HEX.coolLight),
  /** City flag and civic accents: the muted civic blue (CapLab draws government buildings blue, caplab §5.6). */
  cityFlag: rgb(HEX.policeBlue),
  /** §4.3 hospital red cross (the mast red). */
  cross: rgb(HEX.mastRed),
  /** §3.16 boarded-up shopfront plywood `#8A6A4A` (identical to the furrow token, so it is taken from there). */
  boarded: rgb(WORLD.crops.furrow),
  /** §4.2.1 waste bins `#4F6B4A` (identical to the green vehicle body token). */
  bins: rgb(WORLD.vehicles.bodies[6][0]),
  white: [255, 255, 255] as RGB,
  awnings: HEX.awnings.map(rgb),
  doors: HEX.doors.map(rgb),
  play: HEX.play.map(rgb),
} as const;

/** Residential wall palette (art §4.3 "RES"). */
export const RES_WALLS: readonly RGB[] = [
  P.wall.warmWhite, P.wall.cream, P.wall.sandWall, P.wall.peach, P.wall.terracotta, P.wall.sage,
  P.wall.powderBlue, P.wall.lilacGrey, P.wall.greige, P.wall.brick, P.wall.stone,
];
/** Apartment wall palette (art §4.3 "APT"). */
export const APT_WALLS: readonly RGB[] = [
  P.wall.warmWhite, P.wall.cream, P.wall.sandWall, P.wall.peach, P.wall.greige, P.wall.aptExtra1,
  P.wall.aptExtra2, P.wall.stone, P.wall.brick, P.wall.concrete, P.wall.lilacGrey,
];
/** Office / commercial cladding. */
export const OFFICE_WALLS: readonly RGB[] = [P.wall.aluminium, P.wall.steelBlue, P.wall.limestone, P.wall.concrete, P.wall.greige];
/** Pitched house roofs. */
export const HOUSE_ROOFS: readonly RGB[] = [P.roof.shingle, P.roof.tile, P.roof.slate];
/** Flat-roof variety (art §1.6 finding 5: grey roofs dominate mid zoom, so vary them). */
export const FLAT_ROOFS: readonly RGB[] = [P.roof.flat, P.roof.membrane, P.roof.gravel, P.roof.tar];

/** Owner paint colour (company buildings only): colorIndex 0..7, anything else is the neutral civic grey. */
export function ownerHex(owner: number): string {
  return owner >= 0 && owner < OWNER_COLORS.length ? OWNER_COLORS[owner] : NEUTRAL_OWNER;
}

/** Linear blend of two RGB byte triples (t = 0 → a, 1 → b). */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** Multiply a colour by a scalar (shade), clamped to bytes. */
export function shade(c: RGB, k: number): RGB {
  return [Math.min(255, Math.round(c[0] * k)), Math.min(255, Math.round(c[1] * k)), Math.min(255, Math.round(c[2] * k))];
}

/** RGB bytes → "#RRGGBB" (for PropInstance colours). */
export function hexOf(c: RGB): string {
  return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1).toUpperCase();
}

/** Multiply two hex colours channel-wise in sRGB bytes (tree tint × leaf colour). */
export function mulHex(a: string, b: string): string {
  const x = rgb(a), y = rgb(b);
  return hexOf([Math.round((x[0] * y[0]) / 255), Math.round((x[1] * y[1]) / 255), Math.round((x[2] * y[2]) / 255)]);
}
