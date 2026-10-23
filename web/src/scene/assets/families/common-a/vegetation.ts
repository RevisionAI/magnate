// Tree species → prop family + instance colour, by season (art §3.3 tints, §3.14 seasons).
// Tree crowns are authored white with instance-tint weight 255, so the instance colour *is* the leaf colour;
// every tree instance must therefore carry a colour from here (W2 / Seasons.ts can call `treeLook` too).
import { WORLD } from '@/theme/tokens';
import { HEX, mulHex } from './palette';

export type TreeSpecies = 'deciduous' | 'conifer' | 'poplar' | 'palm';
export type TreeFamilyId = 'tree.deciduous' | 'tree.conifer' | 'tree.poplar' | 'tree.palm' | 'tree.bare';

const LEAVES = [WORLD.vegetation.leaf1, WORLD.vegetation.leaf2, WORLD.vegetation.leaf3] as const;

/**
 * Family and colour for one tree. `r1..r3` are three uniform [0,1) draws (always consumed, so the caller's
 * random stream advances identically in every season and positions never shift when the season changes).
 * Seasons: 0 spring (8% blossom), 1 summer, 2 autumn (40% autumn colours), 3 winter (deciduous → bare).
 */
export function treeLook(species: TreeSpecies, season: number, r1: number, r2: number, r3: number): { family: TreeFamilyId; color: string } {
  const tint = HEX.treeTints[Math.floor(r1 * HEX.treeTints.length) % HEX.treeTints.length];
  if (species === 'conifer') return { family: 'tree.conifer', color: mulHex(WORLD.vegetation.conifer, tint) };
  const leaf = LEAVES[Math.floor(r2 * LEAVES.length) % LEAVES.length];
  if (species === 'palm') return { family: 'tree.palm', color: mulHex(leaf, tint) };
  const family: TreeFamilyId = species === 'poplar' ? 'tree.poplar' : 'tree.deciduous';
  if (season === 0) return { family, color: r3 < 0.08 ? HEX.blossom : mulHex(leaf, tint) };
  if (season === 2) {
    if (r3 < 0.4) return { family, color: mulHex(r3 < 0.2 ? WORLD.vegetation.autumn1 : WORLD.vegetation.autumn2, tint) };
    return { family, color: mulHex(leaf, tint) };
  }
  if (season === 3) return { family: 'tree.bare', color: mulHex(HEX.bare, tint) };
  return { family, color: mulHex(leaf, tint) };
}
