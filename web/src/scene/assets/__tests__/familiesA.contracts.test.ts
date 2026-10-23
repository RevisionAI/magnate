// W3 families: cross-workstream contracts and landmark identity (art §4.3 "civic landmarks unmistakable").
//  * every ambient kind W3 owns (bridge AmbientDto.kind + the art §5.3 extensions) has a factory;
//  * sign quads only use the documented companyId vocabulary the sign layer must support;
//  * the landmark cues (dome / spire height, the red cross, the ticker, stadium floods) survive in both LODs;
//  * service-vehicle props keep fixed liveries and lit light bars.
import { describe, expect, it } from 'vitest';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../AssetFactory';
import { GeoBuilder, type BuiltArrays } from '../GeoBuilder';
import { FAMILIES_A, PROP_FAMILIES } from '../familiesA';
import { X } from '../families/common-a/palette';
import { PLOT_SIZE } from '../../units';

const byId = new Map(FAMILIES_A.map((f) => [f.id, f] as const));

function build(f: AssetFactory, over: Partial<AssetParams> = {}, fp = f.footprints[0], extra: Record<string, unknown> = {}): { a: BuiltArrays; out: AssetOutput } {
  const lot: LotFrame = { cx: 0, cz: 0, widthM: fp[0] * PLOT_SIZE, depthM: fp[1] * PLOT_SIZE, facing: 'S', quarterTurns: 0 };
  const p = { seed: 4242, variant: 0, level: 1, stage: 'complete', progress: 1, owner: 3, utilization: 0.7, lod: 0, season: 1, ...over, ...extra } as AssetParams;
  const b = new GeoBuilder();
  const out = f.build(b, lot, p);
  return { a: b.finish(), out };
}

function maxY(a: BuiltArrays): number {
  let m = 0;
  for (let i = 1; i < a.position.length; i += 3) m = Math.max(m, a.position[i]);
  return m;
}

/** Whether any vertex has the given colour (and, optionally, a non-zero emissive byte). */
function hasColour(a: BuiltArrays, rgb: readonly number[], emissive = false): boolean {
  for (let v = 0; v < a.vertexCount; v++) {
    if (a.color[v * 4] === rgb[0] && a.color[v * 4 + 1] === rgb[1] && a.color[v * 4 + 2] === rgb[2] && (!emissive || a.extra[v * 4] > 0)) return true;
  }
  return false;
}

describe('W3 contracts', () => {
  it('covers every ambient kind W3 owns (AmbientDto.kind + art §5.3 extensions)', () => {
    const kinds = [
      'house', 'rowhouse', 'villa', 'apartment', 'midrise', 'shop', 'strip_mall', 'office', 'park', 'plaza', 'parking',
      'civic:hall', 'civic:exchange', 'civic:bank', 'civic:school', 'civic:hospital', 'civic:police', 'civic:fire',
      'civic:university', 'civic:stadium', 'civic:church',
    ];
    for (const k of kinds) expect(byId.has(`ambient:${k}`), `ambient:${k}`).toBe(true);
    for (const id of ['convenience_store', 'supermarket', 'department_store', 'tv_station', 'radio_station', 'newspaper_publisher', 'magazine_publisher', 'rd_center', 'headquarters']) {
      expect(byId.has(id), id).toBe(true);
    }
  });

  it('only emits sign ids from the documented vocabulary', () => {
    const allowed = /^(|local:[a-z]+|civic:[a-z]+|ticker|co-7)$/;
    const seen = new Set<string>();
    for (const f of FAMILIES_A) {
      for (const fp of f.footprints) {
        for (let v = 0; v < 6; v++) {
          const company = !f.id.startsWith('ambient:');
          const { out } = build(f, { variant: v, seed: 100 + v }, fp, company ? { companyId: 'co-7' } : {});
          for (const s of out.signs) {
            seen.add(s.companyId);
            expect(s.companyId, `${f.id}: ${s.companyId}`).toMatch(allowed);
            if (company) expect(s.companyId === 'co-7' || s.companyId.startsWith('local:'), `${f.id} sign ${s.companyId}`).toBe(true);
          }
        }
      }
    }
    expect(seen.has('ticker')).toBe(true);
    for (const k of ['hall', 'exchange', 'bank', 'school', 'hospital', 'police', 'fire', 'university', 'stadium', 'parking']) expect(seen.has(`civic:${k}`), `civic:${k}`).toBe(true);
  });
});

describe('W3 civic landmarks read at every zoom', () => {
  const both = [0, 1] as const;

  it('city hall: a dome or clock-tower spire above 28 m in both LODs, two forms', () => {
    const f = byId.get('ambient:civic:hall')!;
    for (const lod of both) for (const variant of [0, 1]) expect(maxY(build(f, { lod, variant }).a), `lod${lod} v${variant}`).toBeGreaterThan(28);
  });

  it('church: a spire above 25 m in both LODs on every footprint', () => {
    const f = byId.get('ambient:civic:church')!;
    for (const fp of f.footprints) for (const lod of both) for (const variant of [0, 1]) expect(maxY(build(f, { lod, variant }, fp).a)).toBeGreaterThan(25);
  });

  it('hospital: an emissive red cross (LOD0) that is still drawn in the city band', () => {
    const f = byId.get('ambient:civic:hospital')!;
    expect(hasColour(build(f).a, X.cross, true)).toBe(true);
    expect(hasColour(build(f, { lod: 1 }).a, X.cross)).toBe(true);
  });

  it('stock exchange: an LED ticker sign and its emissive housing', () => {
    const f = byId.get('ambient:civic:exchange')!;
    const { a, out } = build(f);
    expect(out.signs.some((s) => s.companyId === 'ticker')).toBe(true);
    expect(hasColour(a, X.screenDark, true)).toBe(true);
  });

  it('stadium: four floodlight banks lighting the pitch at night', () => {
    const f = byId.get('ambient:civic:stadium')!;
    for (const variant of [0, 1]) {
      const { a, out } = build(f, { variant });
      expect(out.lightPools.filter((l) => l.radius >= 20).length).toBe(4);
      expect(hasColour(a, X.lampHead, true)).toBe(true);
    }
  });
});

describe('W3 service-vehicle props', () => {
  it.each([['car.police'], ['truck.fire'], ['ambulance']] as const)('%s has a fixed livery and a lit light bar', (id) => {
    const fam = PROP_FAMILIES[id];
    expect(fam.needsColor).toBe(false);
    const b = new GeoBuilder();
    fam.build(b, 0);
    const a = b.finish();
    let emissive = 0;
    for (let v = 0; v < a.vertexCount; v++) {
      expect(a.color[v * 4 + 3]).toBe(0); // tint weight 0: never recoloured by instance colours
      if (a.extra[v * 4] > 0) emissive++;
    }
    expect(emissive).toBeGreaterThan(0);
  });
});
