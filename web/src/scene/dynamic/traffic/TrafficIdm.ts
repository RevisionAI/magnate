// Reference implementation from docs/overhaul/research/art-rendering.md Appendix A (dynamic/traffic/TrafficIdm.ts).
// Verified to type-check against three 0.186 / postprocessing 6.39.5 / camera-controls 3.1.2.
// Intelligent Driver Model (Treiber 2000) for ambient + company vehicles on the road graph.
export interface IdmParams { v0: number; T: number; s0: number; a: number; b: number; delta: number; length: number; }
export const CAR: IdmParams = { v0: 13.9, T: 1.5, s0: 2.0, a: 1.5, b: 2.0, delta: 4, length: 4.5 };      // 50 km/h local
export const TRUCK: IdmParams = { v0: 13.9, T: 1.8, s0: 2.5, a: 1.0, b: 2.0, delta: 4, length: 8.6 };
export const BUS: IdmParams = { v0: 12.5, T: 1.8, s0: 2.5, a: 1.0, b: 2.0, delta: 4, length: 12.4 };
/** acceleration for speed v (m/s), gap s to the leader's rear bumper (m), closing speed dv = v - vLeader. */
export function idmAccel(p: IdmParams, v: number, s: number, dv: number, vLimit = p.v0): number {
  const v0 = Math.min(p.v0, vLimit);
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const r = v / v0;
  // delta is 4 for every built-in class: r⁴ by two multiplies instead of Math.pow (this runs ~5× per vehicle per step)
  const free = p.delta === 4 ? (r * r) * (r * r) : Math.pow(r, p.delta);
  const q = sStar / Math.max(s, 0.1);
  return p.a * (1 - free - q * q);
}
/** A red light / stop line is modelled as a standing leader (v = 0) at the stop line. */
export function stepVehicle(p: IdmParams, v: number, gap: number, vLeader: number, dt: number): { v: number; ds: number } {
  const acc = Math.max(-9, idmAccel(p, v, gap, v - vLeader));
  const nv = Math.max(0, v + acc * dt);
  return { v: nv, ds: Math.max(0, (v + nv) * 0.5 * dt) };
}
