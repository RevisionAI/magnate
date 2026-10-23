// Road network derived from the city layout (art §5.3 tile masks, §5.15 cross-sections, §5.16 road graph). Built once
// per (city, layoutRev) on the main thread and in the chunk worker; pure and deterministic.
//
// - Tiles: every road or bridge plot gets a 4-bit neighbour mask (N=1, E=2, S=4, W=8), a tile type (isolated, dead
//   end, straight, corner, T, cross), a class (the highest road class through the plot) and its cross-section.
// - Graph (W5 traffic consumes it): nodes at plots that are not straight runs (dead ends, corners, T, cross) and at
//   plots touching the map edge (highway exits); edges follow straight runs between nodes. Lanes are offset from the
//   centreline per art §5.16 (right-hand traffic): streets ±1.75 m; arterials ±2.625/±5.875 m around a 2 m median;
//   highways 2 or 3 lanes per direction of 3.5 m around a 2 m median.
//
// Coordinates: world metres, city centred on the origin, +X east, +Z south (units.ts). Heights follow the terrain
// (terrainHeightAt) so vehicles can ride Hilltown/Riverside slopes.
import { PLOT_SIZE } from '../units';
import { terrainHeightAt } from './layout/decode';
import { R_ARTERIAL, R_HIGHWAY, R_NONE, isRoadKind, type CityGrid } from './layout/types';

export const MASK_N = 1;
export const MASK_E = 2;
export const MASK_S = 4;
export const MASK_W = 8;

export type TileType = 'isolated' | 'deadEnd' | 'straight' | 'corner' | 'tee' | 'cross';

/** Half width (m) of the carriageway by class (art §3.2 cross-sections, 24 m right of way). */
export function carriageHalfWidth(cls: number, lanes = 2): number {
  if (cls === R_HIGHWAY) return lanes >= 6 ? 11.5 : 8;
  if (cls === R_ARTERIAL) return 7.5;
  return 6;
}

/** Signed lateral offsets (m) of the lane centres, right of the travel direction positive, for ONE direction. */
export function laneOffsets(cls: number, lanes = 2): number[] {
  if (cls === R_HIGHWAY) return lanes >= 6 ? [2.75, 6.25, 9.75] : [2.75, 6.25];
  if (cls === R_ARTERIAL) return [2.625, 5.875];
  return [1.75];
}

/** Turn radius at intersections (m): right turns 6 m on streets, 9 m when an arterial is involved (art §5.16). */
export function cornerRadius(cls: number): number {
  return cls >= R_ARTERIAL ? 9 : 6;
}

export function tileTypeOf(mask: number): TileType {
  const bits = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (bits === 0) return 'isolated';
  if (bits === 1) return 'deadEnd';
  if (bits === 3) return 'tee';
  if (bits === 4) return 'cross';
  return mask === (MASK_N | MASK_S) || mask === (MASK_E | MASK_W) ? 'straight' : 'corner';
}

export interface RoadNode {
  id: number;
  px: number;
  pz: number;
  /** World centre of the plot (y = ground height). */
  x: number;
  y: number;
  z: number;
  mask: number;
  type: TileType;
  /** Highest class meeting here. */
  cls: number;
  /** Signalised (an arterial or highway is involved and 3+ arms); otherwise all-way stop when 3+ arms. */
  signal: boolean;
  /** The plot touches the map edge with a road continuing outwards (a highway exit or an edge road). */
  exit: 'N' | 'E' | 'S' | 'W' | null;
  /** Ids of the edges ending at this node. */
  edges: number[];
}

export interface RoadEdge {
  id: number;
  /** Node ids at both ends (a → b is the authoring direction). */
  a: number;
  b: number;
  /** Plot indices from a to b inclusive. */
  plots: number[];
  /** Axis of the run. */
  axis: 'x' | 'z';
  cls: number;
  /** Total lanes (both directions). */
  lanes: number;
  /** Centre-to-centre length (m). */
  length: number;
  /** Lane centre offsets for one direction (right of travel, m). */
  laneOffsets: number[];
  /** Carriageway half width (m). */
  halfWidth: number;
  /** True when any plot of the run is a bridge. */
  bridge: boolean;
}

export interface RoadTile {
  i: number;
  px: number;
  pz: number;
  mask: number;
  type: TileType;
  cls: number;
  lanes: number;
  bridge: boolean;
  /** Node id when the tile is a node, else −1. */
  node: number;
  /** Edge id when the tile is inside a straight run (also set on nodes' first edge), else −1. */
  edge: number;
}

export interface LanePoint { x: number; y: number; z: number; /** Heading (rad, three.js rotation.y of +Z forward). */ yaw: number }

/** Road network of one city layout. */
export class RoadNetwork {
  readonly gridW: number;
  readonly gridH: number;
  /** Mask per plot (0 for non-road plots). */
  readonly mask: Uint8Array;
  readonly tiles: RoadTile[] = [];
  /** Tile index per plot, −1 for non-road plots. */
  readonly tileAt: Int32Array;
  readonly nodes: RoadNode[] = [];
  readonly edges: RoadEdge[] = [];

  constructor(private readonly grid: CityGrid) {
    const W = grid.gridW, H = grid.gridH;
    this.gridW = W;
    this.gridH = H;
    this.mask = new Uint8Array(W * H);
    this.tileAt = new Int32Array(W * H).fill(-1);
    const isRoad = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H && isRoadKind(grid.kind[z * W + x]);
    for (let pz = 0; pz < H; pz++) {
      for (let px = 0; px < W; px++) {
        const i = pz * W + px;
        if (!isRoadKind(grid.kind[i])) continue;
        const m = (isRoad(px, pz - 1) ? MASK_N : 0) | (isRoad(px + 1, pz) ? MASK_E : 0) | (isRoad(px, pz + 1) ? MASK_S : 0) | (isRoad(px - 1, pz) ? MASK_W : 0);
        this.mask[i] = m;
        this.tileAt[i] = this.tiles.length;
        this.tiles.push({
          i, px, pz, mask: m, type: tileTypeOf(m), cls: grid.road[i] || 1, lanes: grid.lanes[i] || 2, bridge: grid.bridge[i] === 1, node: -1, edge: -1,
        });
      }
    }
    this.buildGraph();
  }

  /** Road class at a plot (R_NONE off-road or out of range). */
  classAt(px: number, pz: number): number {
    if (px < 0 || pz < 0 || px >= this.gridW || pz >= this.gridH) return R_NONE;
    const t = this.tileAt[pz * this.gridW + px];
    return t < 0 ? R_NONE : this.tiles[t].cls;
  }

  tile(px: number, pz: number): RoadTile | null {
    if (px < 0 || pz < 0 || px >= this.gridW || pz >= this.gridH) return null;
    const t = this.tileAt[pz * this.gridW + px];
    return t < 0 ? null : this.tiles[t];
  }

  /** World centre of a plot. */
  plotCenter(px: number, pz: number): { x: number; z: number } {
    return { x: (px + 0.5 - this.gridW / 2) * PLOT_SIZE, z: (pz + 0.5 - this.gridH / 2) * PLOT_SIZE };
  }

  /** Ground height (m) of the road surface at a world point (terrain-following; bridges add their deck). */
  heightAt(x: number, z: number): number {
    return terrainHeightAt(this.grid, x, z);
  }

  /** Edge exit node on the side of `node` not equal to `from` (null at dead ends). */
  other(edge: RoadEdge, node: number): number {
    return edge.a === node ? edge.b : edge.a;
  }

  /**
   * Point on a lane: `t` in [0, 1] from a to b when `forward`, from b to a otherwise; `lane` indexes laneOffsets
   * (0 = innermost). Right-hand traffic: the lane sits right of the travel direction.
   */
  lanePoint(edge: RoadEdge, forward: boolean, lane: number, t: number, out: LanePoint = { x: 0, y: 0, z: 0, yaw: 0 }): LanePoint {
    const na = this.nodes[edge.a], nb = this.nodes[edge.b];
    const from = forward ? na : nb, to = forward ? nb : na;
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // Right of travel in a +X east / +Z south frame: rotate the direction by −90° about +Y → (−uz, ux)… sign check:
    // travelling east (+X), right is south (+Z): (ux, uz) = (1, 0) → right = (0, 1) = (−uz, ux).
    const off = edge.laneOffsets[Math.min(edge.laneOffsets.length - 1, Math.max(0, lane))];
    out.x = from.x + dx * t - uz * off;
    out.z = from.z + dz * t + ux * off;
    out.y = this.heightAt(out.x, out.z);
    out.yaw = Math.atan2(ux, uz);
    return out;
  }

  private buildGraph(): void {
    const W = this.gridW, H = this.gridH;
    const isNodeTile = (t: RoadTile) => t.type !== 'straight' || t.px === 0 || t.pz === 0 || t.px === W - 1 || t.pz === H - 1;
    for (const t of this.tiles) {
      if (!isNodeTile(t)) continue;
      const c = this.plotCenter(t.px, t.pz);
      let exit: RoadNode['exit'] = null;
      if (t.pz === 0 && (t.mask & MASK_S)) exit = 'N';
      else if (t.pz === H - 1 && (t.mask & MASK_N)) exit = 'S';
      else if (t.px === 0 && (t.mask & MASK_E)) exit = 'W';
      else if (t.px === W - 1 && (t.mask & MASK_W)) exit = 'E';
      let cls = t.cls;
      const arms = [[0, -1, MASK_N], [1, 0, MASK_E], [0, 1, MASK_S], [-1, 0, MASK_W]] as const;
      for (const [dx, dz, bit] of arms) if (t.mask & bit) cls = Math.max(cls, this.classAt(t.px + dx, t.pz + dz));
      const armCount = (t.mask & 1) + ((t.mask >> 1) & 1) + ((t.mask >> 2) & 1) + ((t.mask >> 3) & 1);
      t.node = this.nodes.length;
      this.nodes.push({
        id: t.node, px: t.px, pz: t.pz, x: c.x, y: this.heightAt(c.x, c.z), z: c.z, mask: t.mask, type: t.type, cls,
        signal: armCount >= 3 && cls >= R_ARTERIAL, exit, edges: [],
      });
    }
    // Walk east and south from every node to find runs (each edge found exactly once).
    for (const node of this.nodes) {
      for (const [dx, dz, bit, axis] of [[1, 0, MASK_E, 'x'], [0, 1, MASK_S, 'z']] as const) {
        if (!(node.mask & bit)) continue;
        const plots = [node.pz * W + node.px];
        let x = node.px + dx, z = node.pz + dz;
        let cls = 0, lanes = 0, bridge = false;
        for (;;) {
          const t = this.tile(x, z);
          if (!t) break;
          plots.push(t.i);
          cls = Math.max(cls, t.cls);
          lanes = Math.max(lanes, t.lanes);
          bridge = bridge || t.bridge;
          if (t.node >= 0) {
            const edgeId = this.edges.length;
            const endCls = cls || t.cls;
            const a = this.nodes[node.id], b = this.nodes[t.node];
            this.edges.push({
              id: edgeId, a: node.id, b: t.node, plots, axis, cls: endCls, lanes: lanes || 2,
              length: Math.hypot(b.x - a.x, b.z - a.z), laneOffsets: laneOffsets(endCls, lanes), halfWidth: carriageHalfWidth(endCls, lanes), bridge,
            });
            a.edges.push(edgeId);
            if (b.id !== a.id) b.edges.push(edgeId);
            for (const pi of plots) {
              const tt = this.tiles[this.tileAt[pi]];
              if (tt.edge < 0) tt.edge = edgeId;
            }
            break;
          }
          x += dx; z += dz;
        }
      }
    }
  }
}
