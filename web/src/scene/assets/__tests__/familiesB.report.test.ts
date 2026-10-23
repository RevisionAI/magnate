// Art-review aid (no assertions): prints a triangle / output report for every W4 factory when W4_REPORT=1, and the
// vertices that cross the lot boundary (with their lot-frame position and colour) when W4_REPORT=bounds.
//   W4_REPORT=1 npx vitest run src/scene/assets/__tests__/familiesB.report.test.ts
import { describe, it } from 'vitest';
import type { AssetParams, Stage } from '../AssetFactory';
import { lotFrame } from '../AssetFactory';
import { FAMILIES_B } from '../familiesB';
import { GeoBuilder } from '../GeoBuilder';
import { rgbHex } from '../palette';

const mode = process.env.W4_REPORT;
const STAGES: readonly Stage[] = ['complete', 'closed', 'foundation', 'structure', 'finishing'];

describe.runIf(mode === '1')('W4 report', () => {
  it('prints budgets and outputs', () => {
    const rows: string[] = [];
    for (const f of FAMILIES_B) {
      for (const stage of STAGES) {
        for (const level of [1, 2, 3] as const) {
          for (const lod of [0, 1] as const) {
            const b = new GeoBuilder();
            const [fw, fh] = f.footprints[0];
            const p: AssetParams = { seed: 1234, variant: 0, level, stage, progress: 0.5, owner: 2, utilization: 0.8, lod, season: 1 };
            const t0 = performance.now();
            const out = f.build(b, { cx: 0, cz: 0, widthM: fw * 24, depthM: fh * 24, facing: 'S', quarterTurns: 0 }, p);
            const ms = performance.now() - t0;
            const props = Object.entries(out.props).map(([k, v]) => `${k}:${v.length}`).join(',');
            rows.push(`${f.id.padEnd(17)} ${stage.padEnd(10)} L${level} lod${lod} tris ${String(b.triangleCount).padStart(5)}/${lod ? f.triBudget.lod1 : f.triBudget.lod0} parts ${out.animated.length} em ${out.emitters.length} signs ${out.signs.length} props ${props} ${ms.toFixed(1)}ms`);
          }
        }
      }
    }
    console.log(rows.join('\n'));
  });
});

describe.runIf(mode === 'bounds')('W4 lot-boundary report', () => {
  it('prints vertices outside the lot (facing S, lot centred on the origin)', () => {
    const rows: string[] = [];
    for (const f of FAMILIES_B) {
      for (const stage of STAGES) {
        for (const progress of stage === 'complete' || stage === 'closed' ? [1] : [0.05, 0.13, 0.24, 0.3, 0.55, 0.84, 0.86, 0.96, 0.99]) {
          for (const variant of [0, 1, 2, 3]) {
            for (const [level, lod] of [[1, 0], [2, 0], [3, 0], [1, 1], [3, 1]] as const) {
              const [fw, fh] = f.footprints[0];
              const lot = lotFrame(0, 0, fw, fh, 'S');
              const b = new GeoBuilder();
              f.build(b, lot, { seed: 1234, variant, level, stage, progress, owner: 2, utilization: 0.8, lod, season: 1, heightHint: 20 });
              const a = b.finish();
              const hw = lot.widthM / 2, hd = lot.depthM / 2;
              const seen = new Set<string>();
              for (let i = 0; i < a.vertexCount; i++) {
                const x = a.position[i * 3], y = a.position[i * 3 + 1], z = a.position[i * 3 + 2];
                const over = Math.max(Math.abs(x) - hw, -z - hd, z - hd - (f.id === 'seaport' ? 50 : 0));
                if (over <= 0.06) continue;
                const col = rgbHex([a.color[i * 4], a.color[i * 4 + 1], a.color[i * 4 + 2]]);
                const key = `${col}@${x.toFixed(0)},${z.toFixed(0)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (seen.size > 6) break;
                rows.push(`${f.id} ${stage}@${progress} v${variant} L${level} lod${lod}: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) over ${over.toFixed(2)} m colour ${col}`);
              }
            }
          }
        }
      }
    }
    console.log(rows.length ? rows.join('\n') : 'no vertices outside their lots');
  });
});

describe.runIf(mode === 'bench')('W4 build-time benchmark', () => {
  it('prints the median build time per factory (warm JIT, LOD0 and LOD1, complete L3 and structure)', () => {
    const rows: string[] = [];
    for (const f of FAMILIES_B) {
      for (const [stage, level, lod] of [['complete', 3, 0], ['complete', 3, 1], ['structure', 1, 0]] as const) {
        const [fw, fh] = f.footprints[0];
        const lot = lotFrame(0, 0, fw, fh, 'S');
        const times: number[] = [];
        for (let i = 0; i < 60; i++) {
          const b = new GeoBuilder();
          const t0 = performance.now();
          f.build(b, lot, { seed: 1234 + i, variant: i & 3, level, stage, progress: 0.55, owner: 2, utilization: 0.8, lod, season: 1, month: 7 });
          b.finish();
          times.push(performance.now() - t0);
        }
        times.sort((a, c) => a - c);
        rows.push(`${f.id.padEnd(17)} ${stage.padEnd(9)} L${level} lod${lod}: median ${times[30].toFixed(2)} ms, p90 ${times[54].toFixed(2)} ms`);
      }
    }
    console.log(rows.join('\n'));
  });
});
