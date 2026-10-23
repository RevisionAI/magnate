// Simple company-building stand-ins used by the interim PlaceholderCity when no AssetFactory (W3/W4) is registered
// for a building type yet. Lot frame (+Z = street front), CityMaterial vertex format, owner accents on the paint
// slots of art §3.4 (fascia band, roof tint flag on the main roof only) and an emissive owner sign for the night.
import type { GeoBuilder, FacadeParams, RGB } from '../../assets/GeoBuilder';
import { boxAt, cylinder, sawtoothRoof } from '../../assets/shapes';
import { FLAG_PAVED, FLAG_SNOWABLE, FLAG_VEGETATION } from '../../materials/CityMaterial';
import { mulberry32 } from '../../env/rng';

const hex = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const C = {
  wall: hex('#EFE8DA'), wall2: hex('#CFC8BC'), concrete: hex('#B9B6AE'), roof: hex('#D3D0C8'), roofDark: hex('#A39E94'),
  parking: hex('#6C7077'), marking: hex('#F4F1E6'), glass: hex('#6F8FA6'), industrial: hex('#9FA7AE'), dock: hex('#5A6068'),
  tank: hex('#E4E4DE'), chimney: hex('#8E4E3C'), soil: hex('#9C7A56'), crop: hex('#A9B85A'), barn: hex('#B0654F'),
  steel: hex('#9AA6B1'), water: hex('#3F86A8'),
};

/**
 * Build a stand-in for `category` in the lot frame. `lw`/`ld` are the lot extents (m) after rotation, `owner` the
 * colour index 0..7 and `ownerRgb` its sRGB bytes. The caller sets `b.place(...)` and `b.owner`.
 */
export function buildCompanyFallback(b: GeoBuilder, category: string, lw: number, ld: number, level: number, ownerRgb: RGB, seed: number): void {
  const rnd = mulberry32(seed);
  const fac = (style: number, floorDm: number, bayDm: number): FacadeParams => [style, Math.floor(rnd() * 256), floorDm, bayDm];
  b.tint = 0;
  const lift = 1 + 0.15 * (level - 1);
  // Paved lot.
  b.flags = FLAG_PAVED | FLAG_SNOWABLE;
  b.quad([-lw / 2, 0.01, ld / 2], [lw / 2, 0.01, ld / 2], [lw / 2, 0.01, -ld / 2], [-lw / 2, 0.01, -ld / 2], [0, 1, 0], C.parking);

  const mainBox = (x0: number, z0: number, x1: number, z1: number, h: number, wall: RGB, facade: FacadeParams, roof = C.roof) => {
    b.flags = 0;
    b.box(x0, 0, z0, x1, h, z1, wall, roof, facade, false);
    b.flags = FLAG_SNOWABLE;
    b.ownerRoof = true;                          // main roof only: tinted to the owner colour at city zoom
    b.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], roof);
    b.ownerRoof = false;
  };
  const fascia = (x0: number, x1: number, z: number, y: number, h = 1.2) => {
    b.flags = 0;
    // Owner-coloured sign band on the front; emissive so it glows in the owner colour at night.
    b.quad([x0, y, z], [x1, y, z], [x1, y + h, z], [x0, y + h, z], [0, 0, 1], ownerRgb, null, null, 170);
  };

  switch (category) {
    case 'convenience_store':
    case 'supermarket':
    case 'department_store': {
      const big = category !== 'convenience_store';
      const depth = category === 'department_store' ? ld - 8 : big ? ld * 0.5 : ld - 9;
      const x0 = -lw / 2 + 2, x1 = lw / 2 - 2, z0 = -ld / 2 + 2, z1 = z0 + depth;
      const h = (category === 'department_store' ? 4.5 + 3 * 4.2 : big ? 8 : 4.6) * lift;
      mainBox(x0, z0, x1, z1, h, C.wall, fac(4, 42, 45));
      fascia(x0 + 2, x1 - 2, z1 + 0.05, h - 1.6);
      // Car park: two rows of bays (5.2 m pitch so the lines stay readable instead of aliasing at district zoom).
      b.flags = FLAG_PAVED;
      if (ld / 2 - 4 > z1 + 8) {
        for (const zr of [z1 + 6, ld / 2 - 9]) {
          for (let x = x0 + 4; x < x1 - 4; x += 5.2) b.quad([x, 0.02, zr + 5], [x + 0.18, 0.02, zr + 5], [x + 0.18, 0.02, zr], [x, 0.02, zr], [0, 1, 0], C.marking);
        }
      }
      break;
    }
    case 'factory': {
      const x0 = -lw / 2 + 5, x1 = lw / 2 - 5, z0 = -ld / 2 + 5, z1 = ld / 2 - 12;
      const h = 12 * lift;
      b.flags = 0;
      b.box(x0, 0, z0, x1, h, z1, C.industrial, C.roofDark, fac(5, Math.min(255, Math.round(h * 10)), 50), false);
      b.flags = FLAG_SNOWABLE;
      b.ownerRoof = true;
      sawtoothRoof(b, x0, z0, x1, z1, h, 3.5, Math.max(2, Math.round((z1 - z0) / 9)), C.roofDark, C.glass);
      b.ownerRoof = false;
      fascia(x0 + 3, x0 + Math.min(30, x1 - x0 - 6), z1 + 0.05, h - 2.2, 1.6);
      b.flags = 0;
      cylinder(b, x1 - 4, z0 + 4, 1.4, h, h + 22, 8, C.chimney);
      b.flags = FLAG_SNOWABLE;
      cylinder(b, x1 - 6, z1 + 6, 4, 0, 9, 10, C.tank);
      break;
    }
    case 'warehouse': {
      const x0 = -lw / 2 + 3, x1 = lw / 2 - 3, z0 = -ld / 2 + 3, z1 = ld / 2 - 9;
      const h = 9 * lift;
      mainBox(x0, z0, x1, z1, h, C.steel, fac(5, Math.round(h * 10), 60), C.industrial);
      fascia(x0 + 2, x0 + Math.min(24, x1 - x0 - 4), z1 + 0.05, h - 2, 1.4);
      b.flags = 0;
      for (let x = x0 + 4; x < x1 - 4; x += 6) boxAt(b, x, z1 + 0.06, 3.4, 0.1, 0, 4, C.dock);
      break;
    }
    case 'farm':
    case 'plantation': {
      b.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
      const rows = Math.max(4, Math.round(ld / 6));
      for (let k = 0; k < rows; k++) {
        const z0 = -ld / 2 + 2 + k * ((ld - 16) / rows), z1 = z0 + (ld - 16) / rows - 1.2;
        b.quad([-lw / 2 + 2, 0.03, z1], [lw / 2 - 14, 0.03, z1], [lw / 2 - 14, 0.03, z0], [-lw / 2 + 2, 0.03, z0], [0, 1, 0], k % 2 ? C.crop : C.soil);
      }
      mainBox(lw / 2 - 12, -ld / 2 + 4, lw / 2 - 2, -ld / 2 + 18, 6.5, C.barn, fac(0, 0, 0), C.roofDark);
      b.flags = FLAG_SNOWABLE;
      cylinder(b, lw / 2 - 7, -ld / 2 + 24, 2.6, 0, 11, 10, C.tank);
      fascia(lw / 2 - 11, lw / 2 - 3, -ld / 2 + 18.05, 4.5, 1);
      break;
    }
    case 'mine': {
      b.flags = FLAG_SNOWABLE;
      b.quad([-lw / 2 + 6, 0.03, ld / 2 - 6], [lw / 2 - 6, 0.03, ld / 2 - 6], [lw / 2 - 6, 0.03, -ld / 2 + 6], [-lw / 2 + 6, 0.03, -ld / 2 + 6], [0, 1, 0], C.soil);
      b.flags = 0;
      boxAt(b, -6, -4, 1.2, 1.2, 0, 26, C.steel);
      boxAt(b, 6, -4, 1.2, 1.2, 0, 26, C.steel);
      boxAt(b, 0, -4, 13.2, 1.6, 24, 2, ownerRgb);
      mainBox(-lw / 2 + 6, ld / 2 - 22, -lw / 2 + 26, ld / 2 - 8, 8, C.concrete, fac(5, 80, 50));
      break;
    }
    case 'oil_well': {
      b.flags = 0;
      boxAt(b, 0, 0, 3, 3, 0, 1.2, C.concrete);
      boxAt(b, 0, 0, 1, 1, 1.2, 5, C.steel);
      boxAt(b, 0, 0, 10, 1.2, 6.2, 1.2, ownerRgb);
      mainBox(lw / 2 - 12, -ld / 2 + 3, lw / 2 - 3, -ld / 2 + 10, 3.2, C.concrete, fac(0, 0, 0));
      break;
    }
    case 'seaport': {
      const x0 = -lw / 2 + 4, x1 = lw / 2 - 4, z0 = -ld / 2 + 4, z1 = z0 + ld * 0.35;
      mainBox(x0, z0, x1, z1, 10, C.steel, fac(5, 100, 60), C.industrial);
      fascia(x0 + 4, x0 + 30, z1 + 0.05, 7.5, 1.6);
      b.flags = 0;
      for (const x of [-lw / 4, lw / 4]) { boxAt(b, x, ld / 2 - 8, 2, 2, 0, 30, ownerRgb); boxAt(b, x, ld / 2 - 14, 2, 26, 30, 2, ownerRgb); }
      break;
    }
    default: {
      // media, rd_center and anything new: an office pavilion.
      const x0 = -lw / 2 + 4, x1 = lw / 2 - 4, z0 = -ld / 2 + 4, z1 = ld / 2 - 8;
      const h = (category === 'rd_center' ? 14 : 18) * lift;
      mainBox(x0, z0, x1, z1, h, C.wall2, fac(6, 37, 30));
      fascia(x0 + 3, x1 - 3, z1 + 0.05, h - 1.8);
      if (category === 'media') {
        b.flags = 0;
        boxAt(b, x0 + 6, z0 + 6, 1, 1, h, 24, C.steel);
      }
    }
  }
}
