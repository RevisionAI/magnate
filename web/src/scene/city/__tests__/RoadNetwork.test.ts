import { describe, expect, it } from 'vitest';
import { decodeLayout } from '../layout/decode';
import { isRoadKind, R_ARTERIAL, R_LOCAL } from '../layout/types';
import { MASK_E, MASK_N, MASK_S, MASK_W, RoadNetwork, cornerRadius, laneOffsets, tileTypeOf } from '../RoadNetwork';
import { loadLayout } from './fixtures';

describe('tile masks (art §5.3)', () => {
  it('classifies every mask', () => {
    expect(tileTypeOf(0)).toBe('isolated');
    expect(tileTypeOf(MASK_N)).toBe('deadEnd');
    expect(tileTypeOf(MASK_N | MASK_S)).toBe('straight');
    expect(tileTypeOf(MASK_E | MASK_W)).toBe('straight');
    expect(tileTypeOf(MASK_N | MASK_E)).toBe('corner');
    expect(tileTypeOf(MASK_S | MASK_W)).toBe('corner');
    expect(tileTypeOf(MASK_N | MASK_E | MASK_S)).toBe('tee');
    expect(tileTypeOf(15)).toBe('cross');
  });

  it('lanes and radii follow the cross-sections (art §5.16)', () => {
    expect(laneOffsets(R_LOCAL)).toEqual([1.75]);
    expect(laneOffsets(R_ARTERIAL)).toEqual([2.625, 5.875]);
    expect(cornerRadius(R_LOCAL)).toBe(6);
    expect(cornerRadius(R_ARTERIAL)).toBe(9);
  });
});

for (const city of ['portbay', 'hilltown'] as const) {
  describe(`RoadNetwork on ${city}`, () => {
    const grid = decodeLayout(loadLayout(city));
    const net = new RoadNetwork(grid);
    const W = grid.gridW, H = grid.gridH;
    const isRoad = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && isRoadKind(grid.kind[z * W + x]);

    it('masks match the 4-neighbourhood of every road plot', () => {
      let roads = 0;
      for (let pz = 0; pz < H; pz++) for (let px = 0; px < W; px++) {
        if (!isRoad(px, pz)) { expect(net.tile(px, pz)).toBeNull(); continue; }
        roads++;
        const t = net.tile(px, pz)!;
        const m = (isRoad(px, pz - 1) ? MASK_N : 0) | (isRoad(px + 1, pz) ? MASK_E : 0) | (isRoad(px, pz + 1) ? MASK_S : 0) | (isRoad(px - 1, pz) ? MASK_W : 0);
        expect(t.mask).toBe(m);
        expect(t.type).toBe(tileTypeOf(m));
      }
      expect(net.tiles.length).toBe(roads);
    });

    it('nodes sit on every non-straight tile; edges are straight runs between nodes covering every road plot', () => {
      for (const t of net.tiles) if (t.type !== 'straight') expect(t.node).toBeGreaterThanOrEqual(0);
      for (const e of net.edges) {
        const a = net.nodes[e.a], b = net.nodes[e.b];
        expect(a.px === b.px || a.pz === b.pz).toBe(true);
        expect(e.plots.length).toBe(Math.abs(a.px - b.px) + Math.abs(a.pz - b.pz) + 1);
        expect(e.length).toBeCloseTo(24 * (e.plots.length - 1), 6);
        expect(a.edges).toContain(e.id);
        expect(b.edges).toContain(e.id);
        for (const i of e.plots.slice(1, -1)) expect(net.tiles[net.tileAt[i]].node).toBe(-1);
      }
      for (const t of net.tiles) if (t.type !== 'isolated') expect(t.edge).toBeGreaterThanOrEqual(0);
    });

    it('the graph is connected (E3a guarantees one network) and highways leave the map', () => {
      const seen = new Set<number>([0]);
      const stack = [0];
      while (stack.length) {
        const n = net.nodes[stack.pop()!];
        for (const eid of n.edges) {
          const o = net.other(net.edges[eid], n.id);
          if (!seen.has(o)) { seen.add(o); stack.push(o); }
        }
      }
      expect(seen.size).toBe(net.nodes.length);
      expect(net.nodes.some((n) => n.exit !== null)).toBe(true);
    });

    it('lane points keep right-hand traffic and sit on the road surface', () => {
      const e = net.edges.find((x) => x.axis === 'x' && x.length > 48)!;
      const a = net.nodes[e.a], b = net.nodes[e.b];
      const east = b.x > a.x;
      const p = net.lanePoint(e, true, 0, 0.5);
      // Travelling east, the right-hand side is south (+Z).
      expect(Math.sign(p.z - a.z)).toBe(east ? 1 : -1);
      expect(Math.abs(p.z - a.z)).toBeCloseTo(e.laneOffsets[0], 6);
      const q = net.lanePoint(e, false, 0, 0.5);
      expect(Math.sign(q.z - a.z)).toBe(east ? -1 : 1);
      expect(p.y).toBeCloseTo(net.heightAt(p.x, p.z), 6);
      expect(Math.abs(Math.sin(p.yaw))).toBeCloseTo(1, 6);
    });
  });
}
