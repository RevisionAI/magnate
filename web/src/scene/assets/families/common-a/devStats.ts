// Dev tool: triangle / prop / sign counts for every W3 factory against its budget.
//   cd web && npx vite-node src/scene/assets/families/common-a/devStats.ts [idPrefix]
// Not imported by the app.
import type { AssetParams, LotFrame } from '../../AssetFactory';
import { GeoBuilder } from '../../GeoBuilder';
import { FAMILIES_A, PROP_FAMILIES, PROP_IDS } from '../../familiesA';
import { PLOT_M } from './constants';

const prefix = typeof process !== 'undefined' ? process.argv[2] ?? '' : '';
const rows: string[] = [];
const pad = (s: string | number, n: number) => String(s).padEnd(n);
rows.push(`${pad('factory', 26)}${pad('fp', 6)}${pad('LOD0 min-max / budget', 24)}${pad('LOD1 max / budget', 20)}${pad('props', 8)}${pad('signs', 6)}pools`);
for (const f of FAMILIES_A) {
  if (!f.id.startsWith(prefix)) continue;
  for (const [fw, fh] of f.footprints) {
    let min0 = Infinity, max0 = 0, max1 = 0, props = 0, signs = 0, pools = 0;
    for (let v = 0; v < 8; v++) {
      for (const level of [1, 2, 3] as const) {
        const lot: LotFrame = { cx: 0, cz: 0, widthM: fw * PLOT_M, depthM: fh * PLOT_M, facing: 'S', quarterTurns: 0 };
        for (const lod of [0, 1] as const) {
          const p: AssetParams = { seed: 1000 + v * 7919, variant: v, level, stage: 'complete', progress: 1, owner: v % 8, utilization: 0.7, lod, season: 1 };
          const b = new GeoBuilder();
          const out = f.build(b, lot, p);
          if (lod === 0) {
            min0 = Math.min(min0, b.triangleCount);
            max0 = Math.max(max0, b.triangleCount);
            props = Math.max(props, Object.values(out.props).reduce((n, l) => n + l.length, 0));
            signs = Math.max(signs, out.signs.length);
            pools = Math.max(pools, out.lightPools.length);
          } else max1 = Math.max(max1, b.triangleCount);
        }
      }
    }
    rows.push(`${pad(f.id, 26)}${pad(`${fw}x${fh}`, 6)}${pad(`${min0}-${max0} / ${f.triBudget.lod0}`, 24)}${pad(`${max1} / ${f.triBudget.lod1}`, 20)}${pad(props, 8)}${pad(signs, 6)}${pools}`);
  }
}
if (!prefix || prefix.startsWith('prop')) {
  for (const id of PROP_IDS) {
    const fam = PROP_FAMILIES[id];
    const b0 = new GeoBuilder(), b1 = new GeoBuilder();
    fam.build(b0, 0);
    fam.build(b1, 1);
    rows.push(`${pad('prop:' + id, 26)}${pad('-', 6)}${pad(`${b0.triangleCount} / ${fam.triBudget.lod0}`, 24)}${pad(`${b1.triangleCount} / ${fam.triBudget.lod1}`, 20)}`);
  }
}
console.log(rows.join('\n'));
