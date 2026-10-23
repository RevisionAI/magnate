// Accumulates one chunk's output: two GeoBuilders (LOD0 near mesh, LOD1 far mesh), instanced props, sign quads, light
// pools, lamp heads, emitters, animated parts and pick boxes. Geometry is written at y = 0 (the factories' frame) and
// lifted afterwards per vertex range: terrain-following ground and roads are "warped" by a height function, lots on
// flat terraces are "offset" by a constant (factories cannot take a y origin: they place the builder themselves).
import type { AnimatedPart, AssetOutput, Emitter, SignQuad } from '../../assets/AssetFactory';
import { GeoBuilder, type BuiltArrays } from '../../assets/GeoBuilder';
import type { ChunkAnimatedPart, ChunkEmitter, PickEntry } from '../chunkProtocol';
import { PROP_STRIDE } from '../chunkProtocol';

type HeightFn = (x: number, z: number) => number;

interface PostRange { v0: number; v1: number; dy: number; fn: HeightFn | null }

export class ChunkWriter {
  readonly b0 = new GeoBuilder();
  readonly b1 = new GeoBuilder();
  private readonly post0: PostRange[] = [];
  private readonly post1: PostRange[] = [];
  private readonly props = new Map<string, number[]>();
  private readonly pools: number[] = [];
  private readonly lampHeads: number[] = [];
  readonly signs: SignQuad[] = [];
  readonly emitters: ChunkEmitter[] = [];
  readonly animated: ChunkAnimatedPart[] = [];
  readonly picks: PickEntry[] = [];
  monthly = false;

  /** Write geometry into both LODs (`draw` is called once per LOD), lifted by `fn(x, z) + dy` per vertex. */
  both(draw: (b: GeoBuilder, lod: 0 | 1) => void, fn: HeightFn | null, dy = 0): void {
    this.into(0, draw, fn, dy);
    this.into(1, draw, fn, dy);
  }

  /** Write geometry into one LOD only. */
  into(lod: 0 | 1, draw: (b: GeoBuilder, lod: 0 | 1) => void, fn: HeightFn | null, dy = 0): void {
    const b = lod === 0 ? this.b0 : this.b1;
    const v0 = b.vertexCount;
    const state = b.saveState();
    draw(b, lod);
    b.restoreState(state);
    const v1 = b.vertexCount;
    if (v1 > v0 && (fn || dy !== 0)) (lod === 0 ? this.post0 : this.post1).push({ v0, v1, dy, fn });
  }

  /** Instanced prop at world (x, y, z). `color` is an sRGB hex string or 0xRRGGBB. */
  prop(id: string, x: number, y: number, z: number, rotY: number, scale = 1, color?: string | number): void {
    let list = this.props.get(id);
    if (!list) { list = []; this.props.set(id, list); }
    list.push(x, y, z, rotY, scale, colorInt(color));
  }

  pool(x: number, y: number, z: number, radius: number, tone: 'warm' | 'cool' = 'warm'): void {
    this.pools.push(x, y, z, radius, tone === 'cool' ? 1 : 0);
  }

  lampHead(x: number, y: number, z: number): void {
    this.lampHeads.push(x, y, z);
  }

  /** Collect a factory's LOD0 outputs (props, signs, pools, emitters, parts), lifted by `dy`. */
  collect(out: AssetOutput, dy: number, buildingId: number | null, owner: number, pick: PickEntry | null): void {
    for (const id of Object.keys(out.props).sort()) {
      for (const p of out.props[id]) this.prop(id, p.x, (p.y ?? 0) + dy, p.z, p.rotY, p.scale, p.color as string | number | undefined);
    }
    for (const s of out.signs) {
      const sign: SignQuad = { companyId: s.companyId, corners: s.corners.map(([x, y, z]) => [x, y + dy, z] as [number, number, number]) };
      if (s.style !== undefined) sign.style = s.style;
      if (s.text !== undefined) sign.text = s.text;
      this.signs.push(sign);
    }
    for (const lp of out.lightPools) this.pool(lp.x, dy, lp.z, lp.radius, lp.tone ?? 'warm');
    for (const e of out.emitters) this.emitters.push({ ...(e as Emitter), y: e.y + dy, buildingId, owner });
    for (const a of out.animated) this.animated.push({ ...(a as AnimatedPart), y: a.y + dy, buildingId });
    if (pick) {
      const bx = out.pickBox;
      pick.box = [bx[0], bx[1] + dy, bx[2], bx[3], bx[4] + dy, bx[5]];
      this.picks.push(pick);
    }
  }

  /** Finish both LODs and apply the height post-pass. */
  finish(): { lod0: BuiltArrays; lod1: BuiltArrays; props: Record<string, Float32Array>; pools: Float32Array; lampHeads: Float32Array } {
    const lod0 = this.b0.finish(), lod1 = this.b1.finish();
    applyPost(lod0, this.post0);
    applyPost(lod1, this.post1);
    const props: Record<string, Float32Array> = {};
    for (const id of [...this.props.keys()].sort()) props[id] = Float32Array.from(this.props.get(id)!);
    return { lod0, lod1, props, pools: Float32Array.from(this.pools), lampHeads: Float32Array.from(this.lampHeads) };
  }
}

function applyPost(a: BuiltArrays, ranges: readonly PostRange[]): void {
  const P = a.position;
  let warped: Uint8Array | null = null;
  for (const r of ranges) {
    for (let v = r.v0; v < r.v1; v++) {
      const o = v * 3;
      P[o + 1] += r.dy + (r.fn ? r.fn(P[o], P[o + 2]) : 0);
    }
    if (r.fn) {
      warped ??= new Uint8Array(a.vertexCount);
      warped.fill(1, r.v0, r.v1);
    }
  }
  if (warped) relight(a, warped);
}

/**
 * Terrain-following geometry was authored flat (normal +Y): give its upward faces the normal of the warped surface,
 * so Hilltown flanks, Riverside valley walls, beaches and bridge arches shade with the sun. Vertices are per face in
 * GeoBuilder output, so accumulating over a face's triangles yields flat (faceted) shading as in the art bible.
 * Vertical faces (curbs, skirts) keep their authored normals.
 */
function relight(a: BuiltArrays, warped: Uint8Array): void {
  const P = a.position, N = a.normal, I = a.index;
  const acc = new Float32Array(a.vertexCount * 3);
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
    if (!warped[i0] && !warped[i1] && !warped[i2]) continue;
    const ax = P[i1 * 3] - P[i0 * 3], ay = P[i1 * 3 + 1] - P[i0 * 3 + 1], az = P[i1 * 3 + 2] - P[i0 * 3 + 2];
    const bx = P[i2 * 3] - P[i0 * 3], by = P[i2 * 3 + 1] - P[i0 * 3 + 1], bz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (const v of [i0, i1, i2]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; }
  }
  for (let v = 0; v < a.vertexCount; v++) {
    // Only upward faces that were authored flat (Int8 normals: 127 = 1.0).
    if (!warped[v] || N[v * 4 + 1] < 110) continue;
    const x = acc[v * 3], y = acc[v * 3 + 1], z = acc[v * 3 + 2];
    const len = Math.hypot(x, y, z);
    if (len < 1e-9 || y <= 0) continue;
    N[v * 4] = Math.round((x / len) * 127);
    N[v * 4 + 1] = Math.round((y / len) * 127);
    N[v * 4 + 2] = Math.round((z / len) * 127);
  }
}

function colorInt(color: string | number | undefined): number {
  if (color === undefined || color === null) return -1;
  if (typeof color === 'number') return color & 0xffffff;
  const h = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(h)) return parseInt(h, 16);
  if (/^[0-9a-fA-F]{3}$/.test(h)) return parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
  return -1;
}

export { PROP_STRIDE };
