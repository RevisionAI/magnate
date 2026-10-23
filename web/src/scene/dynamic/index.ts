// Scene modules for the living city (traffic, pedestrians, supply trucks, particles, animated parts, construction
// sites, ships, weather particles, world FX). Owned by workstream W5; see docs/overhaul/status/w5-life.md.
//
// The hub (LivingCity) comes first: it resolves the city source and the economy feed that every other module reads.
import type * as THREE from 'three';
import type { SceneModule } from '../SceneContext';
import { AnimatedPartsModule } from './AnimatedParts';
import { ConstructionSitesModule } from './ConstructionSites';
import { LivingCity, type LivingCityOptions } from './LivingCity';
import { ParticlesModule } from './ParticlesModule';
import { PedestriansModule } from './Pedestrians';
import { ShipsModule } from './Ships';
import { TrafficModule } from './traffic/TrafficModule';
import { WeatherFxModule } from './WeatherFx';
import { WorldFxModule } from './WorldFx';

export type { LivingCityOptions } from './LivingCity';
export { registerCitySource } from './source/registry';
export type { CitySource, DynamicBuilding, DynamicLayout } from './source/types';

export interface DynamicModules {
  hub: LivingCity;
  traffic: TrafficModule;
  pedestrians: PedestriansModule;
  particles: ParticlesModule;
  parts: AnimatedPartsModule;
  ships: ShipsModule;
  sites: ConstructionSitesModule;
  weather: WeatherFxModule;
  fx: WorldFxModule;
  modules: SceneModule[];
}

/** Build the living-city modules with access to each (scene lab, diagnostics, `window.__livingCity`). */
export function createLivingCity(options: LivingCityOptions = {}): DynamicModules {
  const hub = new LivingCity(options);
  const traffic = new TrafficModule(hub);
  const pedestrians = new PedestriansModule(hub);
  const particles = new ParticlesModule(hub);
  const parts = new AnimatedPartsModule(hub);
  const ships = new ShipsModule(hub);
  const sites = new ConstructionSitesModule(hub, traffic);
  const weather = new WeatherFxModule(hub);
  const fx = new WorldFxModule(hub);
  const modules: SceneModule[] = [hub, traffic, pedestrians, sites, parts, ships, particles, weather, fx];
  const out: DynamicModules = { hub, traffic, pedestrians, particles, parts, ships, sites, weather, fx, modules };
  if (typeof window !== 'undefined') (window as unknown as { __livingCity?: DynamicModules }).__livingCity = out;
  latest = out;
  return out;
}

let latest: DynamicModules | null = null;

/** A company truck under a ray (W6 hover / click): its flow tag `"<kind>:<productId>:<from>><to>"`, owner colour index. */
export interface TruckPick {
  tag: string;
  owner: number;
  kind: string;
  productId: string;
  from: number | null;
  to: number | null;
  position: { x: number; y: number; z: number };
}

/**
 * The company truck nearest `ray` within `radius` metres in the most recently built living city
 * (W5 `traffic.pickTruck`, for W6's picking), or null.
 */
export function pickTruck(ray: THREE.Ray, radius = 6): TruckPick | null {
  const v = latest?.traffic.pickTruck(ray, radius);
  if (!v) return null;
  const tag = v.spec.tag ?? '';
  const [kind = '', productId = '', route = ''] = tag.split(':');
  const [from, to] = route.split('>').map((s) => (s && s !== 'x' && Number.isFinite(Number(s)) ? Number(s) : null));
  return { tag, owner: v.spec.owner, kind, productId, from: from ?? null, to: to ?? null, position: { x: v.cur.x, y: v.cur.y, z: v.cur.z } };
}

export function createDynamicModules(options: LivingCityOptions = {}): SceneModule[] {
  return createLivingCity(options).modules;
}
