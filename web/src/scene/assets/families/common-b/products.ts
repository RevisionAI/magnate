// Product → visual family mapping for W4 assets (art bible §4.2.4 product props, §4.2.9–4.2.11 crops).
// Content product ids come from content/data/products/*.json; unknown ids fall back to neutral looks, so new
// content never breaks a factory. Pure data, no THREE.

/** Visual family of a factory, chosen by its first configured product (art §4.2.4). */
export type FactoryFamily = 'food' | 'beverage' | 'textile' | 'metal' | 'polymer' | 'electronics' | 'automotive' | 'general';

/** Families in a stable order (gallery pickers, seeded defaults). */
export const FACTORY_FAMILIES: readonly FactoryFamily[] = ['food', 'beverage', 'textile', 'metal', 'polymer', 'electronics', 'automotive'];

const FAMILY_BY_PRODUCT: Readonly<Record<string, FactoryFamily>> = {
  flour: 'food', sugar: 'food', bread: 'food', malt: 'food', roasted_coffee: 'food',
  soft_drink: 'beverage', beer: 'beverage', coffee_drink: 'beverage',
  cotton_fabric: 'textile', denim_fabric: 'textile', t_shirt: 'textile', designer_jeans: 'textile',
  steel: 'metal',
  plastic: 'polymer',
  electronic_parts: 'electronics', television: 'electronics',
  car: 'automotive',
};

/** A representative product per family (galleries and tests). */
export const FAMILY_SAMPLE_PRODUCT: Readonly<Record<FactoryFamily, string | null>> = {
  food: 'flour', beverage: 'beer', textile: 'cotton_fabric', metal: 'steel', polymer: 'plastic',
  electronics: 'television', automotive: 'car', general: null,
};

/** Factory family for the configured products. `undefined` products → a seeded family (gallery variety);
 *  an empty list → 'general' (nothing configured). */
export function factoryFamily(productIds: readonly string[] | undefined, seed: number): FactoryFamily {
  if (productIds === undefined) return FACTORY_FAMILIES[(seed >>> 3) % FACTORY_FAMILIES.length];
  for (const id of productIds) {
    const f = FAMILY_BY_PRODUCT[id];
    if (f) return f;
  }
  return 'general';
}

/** Chimney / stack emission per family (art §4.2.4 "Emission" column). */
export interface FamilyEmission { kind: 'smoke' | 'steam' | null; tone?: 'light' | 'dark'; flare?: boolean; }
export const FAMILY_EMISSION: Readonly<Record<FactoryFamily, FamilyEmission>> = {
  food: { kind: 'smoke', tone: 'light' },
  beverage: { kind: 'steam' },
  textile: { kind: 'steam' },
  metal: { kind: 'smoke', tone: 'dark' },
  polymer: { kind: 'smoke', flare: true },
  electronics: { kind: null },
  automotive: { kind: 'smoke', tone: 'light' },
  general: { kind: 'smoke' },
};

/** Truck trailer that carries a factory family's goods (art §4.3: reefer = food, tanker = liquids, hopper = bulk). */
export function trailerFor(family: FactoryFamily): 'truckReefer' | 'truckTanker' | 'truckHopper' | 'truckBox' {
  switch (family) {
    case 'food': return 'truckReefer';
    case 'beverage': return 'truckTanker';
    case 'polymer': return 'truckTanker';
    case 'metal': return 'truckHopper';
    default: return 'truckBox';
  }
}

/** Crops a farm or plantation can show. 'fallow' = nothing planted. */
export type CropKind = 'wheat' | 'sugarcane' | 'cotton' | 'coffee' | 'hops' | 'fallow';

const CROP_BY_PRODUCT: Readonly<Record<string, CropKind>> = {
  wheat: 'wheat', sugarcane: 'sugarcane', cotton: 'cotton', coffee_beans: 'coffee', hops: 'hops',
};

/** Crop for one product id (null when the product is not a crop). */
export function cropOf(productId: string): CropKind | null {
  return CROP_BY_PRODUCT[productId] ?? null;
}

/** Crops for the fields of a farm: the configured crop products in slot order; `undefined` products → a seeded
 *  default from `defaults`; no crop products configured → ['fallow']. */
export function cropsFor(productIds: readonly string[] | undefined, seed: number, defaults: readonly CropKind[]): CropKind[] {
  if (productIds === undefined) return [defaults[(seed >>> 3) % defaults.length]];
  const crops: CropKind[] = [];
  for (const id of productIds) {
    const c = cropOf(id);
    if (c && !crops.includes(c)) crops.push(c);
  }
  return crops.length ? crops : ['fallow'];
}
