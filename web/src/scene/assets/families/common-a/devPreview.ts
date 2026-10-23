// Dev-only street preview of the W3 families *with* their instanced props, sign quads (real SignAtlas wordmarks)
// and night light pools — the asset gallery renders factory geometry only. Not imported by the app. Load it on any
// dev-server page, e.g.:
//   node scripts/shoot.mjs --dev --query "?dev=assets&only=__none__" --ready "() => window.__galleryReady === true" \
//     --eval "import('/src/scene/assets/families/common-a/devPreview.ts').then((m) => m.mountFamiliesPreview({ only: 'ambient:house' }))"
// Lots are laid out in rows facing a street (+Z), several variants per factory, with one shared GeoBuilder (exactly
// how the chunk worker merges buildings, so builder-state leaks between factories would show up here).
import * as THREE from 'three';
import type { AssetParams, LotFrame, SignQuad, Stage } from '../../AssetFactory';
import { GeoBuilder, toBufferGeometry } from '../../GeoBuilder';
import type { PropInstance } from '../../Instancing';
import { FAMILIES_A } from '../../familiesA';
import { CityUniforms, makeCityMaterial, setOwnerColors } from '@/scene/materials/CityMaterial';
import { SignAtlas, makeSignMaterial } from '@/scene/materials/SignAtlas';
import { OWNER_COLORS, OWNER_EMBLEMS, WORLD } from '@/theme/tokens';
import { buildPropMeshes } from '../props/meshes';
import { PLOT_M } from './constants';
import type { PropId } from './propIds';
import { treeLook } from './vegetation';

export interface PreviewOptions {
  /** Factory id prefix filter (e.g. "ambient:", "supermarket"). */
  only?: string;
  /** Exact factory ids (overrides `only`). */
  ids?: string[];
  variants?: number;
  /** Owner colour index for company buildings (default: cycles per lot). */
  owner?: number;
  level?: 1 | 2 | 3;
  stage?: Stage;
  night?: boolean;
  season?: 0 | 1 | 2 | 3;
  lod?: 0 | 1;
  utilization?: number;
  floors?: number;
  /** Index into each factory's footprints (default 0). */
  footprint?: number;
  /** Camera azimuth in degrees (0 = looking from the street side, 90 = from +X), elevation in degrees, distance scale. */
  az?: number;
  el?: number;
  dist?: number;
  /** Frame only lot #n (close-up). */
  focus?: number;
  /** Maximum row length in metres. */
  rowWidth?: number;
  seed?: number;
}

declare global {
  interface Window {
    __previewReady?: boolean;
    __previewStats?: { id: string; variant: number; tris: number }[];
  }
}

const NAMES = ['Northwind', 'Apex Goods', 'Lumen & Co', 'Verdant', 'Ember', 'Skyline', 'Crown Mart', 'Violet Ltd'];

/** Preview wording for the non-company sign ids (the real sign layer owns the final styles; see the status doc). */
const CIVIC_NAMES: Record<string, string> = {
  hall: 'City Hall', exchange: 'Stock Exchange', bank: 'Bank', school: 'School', hospital: 'Hospital', police: 'Police',
  fire: 'Fire Station', university: 'University', stadium: 'Stadium', parking: 'P  Parking',
};
function neutralName(id: string): string {
  if (id === 'ticker') return 'NWD 42.10 +1.2%  APX 17.85 -0.4%  LUM 88.02 +0.6%';
  if (id.startsWith('civic:')) return CIVIC_NAMES[id.slice(6)] ?? id.slice(6);
  return id.replace(/^local:/, '');
}

function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Renderer, scene, lights and the city material with the day / night / season uniforms of the preview. */
function makeStage(night: boolean, season: 0 | 1 | 2 | 3, lod: 0 | 1) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000';
  document.body.appendChild(host);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(night ? '#0d1626' : '#b9d4e8');
  const hemi = new THREE.HemisphereLight(night ? '#33446a' : '#dbe9f7', night ? '#1a1510' : '#7d6b52', night ? 0.35 : 1.1);
  const sun = new THREE.DirectionalLight(night ? '#8fa7d6' : '#fff0d8', night ? 0.25 : 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);

  CityUniforms.uNight.value = night ? 1 : 0;
  CityUniforms.uSeasonTint.value.set(['#dff0c8', '#ffffff', '#f2d7a8', '#e8ecef'][season]);
  CityUniforms.uSnow.value = season === 3 ? 0.8 : 0;
  CityUniforms.uOwnerRoofMix.value = lod === 1 ? 1 : 0;
  setOwnerColors([...OWNER_COLORS]);
  const material = makeCityMaterial();
  return { host, renderer, scene, sun, material };
}

export async function mountFamiliesPreview(opts: PreviewOptions = {}): Promise<void> {
  window.__previewReady = false;
  const night = opts.night === true;
  const season = opts.season ?? 1;
  const variants = Math.max(1, opts.variants ?? 4);
  const factories = FAMILIES_A.filter((f) => (opts.ids ? opts.ids.includes(f.id) : f.id.startsWith(opts.only ?? '')));
  const { renderer, scene, sun, material } = makeStage(night, season, opts.lod ?? 0);

  // --- lay out lots in rows; each row fronts onto a street along +Z
  const b = new GeoBuilder();
  const props: Record<string, PropInstance[]> = {};
  const signs: { quad: SignQuad; owner: number }[] = [];
  const pools: { x: number; z: number; radius: number }[] = [];
  const stats: { id: string; variant: number; tris: number }[] = [];
  const lots: LotFrame[] = [];
  const rowWidth = opts.rowWidth ?? 420;
  const STREET = 24;
  let x = 0, rowZ = 0, rowDepth = 0, maxX = 0;
  const rows: { z: number; depth: number; width: number }[] = [];
  let lotIndex = 0;
  for (const f of factories) {
    const fp = f.footprints[Math.min(f.footprints.length - 1, Math.max(0, opts.footprint ?? 0))];
    const W = fp[0] * PLOT_M, D = fp[1] * PLOT_M;
    for (let v = 0; v < variants; v++) {
      if (x + W > rowWidth && x > 0) {
        rows.push({ z: rowZ, depth: rowDepth, width: x });
        rowZ += rowDepth + STREET;
        x = 0;
        rowDepth = 0;
      }
      const lot: LotFrame = { cx: x + W / 2, cz: rowZ + D / 2, widthM: W, depthM: D, facing: 'S', quarterTurns: 0 };
      const owner = opts.owner ?? lotIndex % 8;
      const p: AssetParams & { floors?: number } = {
        seed: (opts.seed ?? 1000) + v * 7919 + lotIndex * 104729, variant: v, level: opts.level ?? 1, stage: opts.stage ?? 'complete',
        progress: 1, owner, utilization: opts.utilization ?? 0.75, lod: opts.lod ?? 0, season,
      };
      if (opts.floors !== undefined) p.floors = opts.floors;
      const before = b.triangleCount;
      const out = f.build(b, lot, p);
      stats.push({ id: f.id, variant: v, tris: b.triangleCount - before });
      for (const [id, list] of Object.entries(out.props)) (props[id] ??= []).push(...list);
      for (const s of out.signs) signs.push({ quad: s, owner });
      pools.push(...out.lightPools);
      lots.push(lot);
      lotIndex++;
      x += W + 6;
      maxX = Math.max(maxX, x);
      rowDepth = Math.max(rowDepth, D);
    }
  }
  rows.push({ z: rowZ, depth: rowDepth, width: x });
  const totalW = Math.max(maxX, 60), totalD = rowZ + rowDepth + STREET;

  const geometry = toBufferGeometry(b.finish());
  const city = new THREE.Mesh(geometry, material);
  city.castShadow = city.receiveShadow = true;
  scene.add(city);
  const propMeshes = buildPropMeshes(props, material, opts.lod ?? 0);
  propMeshes.group.traverse((o) => {
    o.receiveShadow = true;
  });
  scene.add(propMeshes.group);

  // --- ground, streets and sidewalks in front of every row
  const groundMat = new THREE.MeshLambertMaterial({ color: WORLD.ground.grass });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 600, totalD + 600).rotateX(-Math.PI / 2), groundMat);
  ground.position.set(totalW / 2, -0.02, totalD / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  const asphalt = new THREE.MeshLambertMaterial({ color: WORLD.road.asphalt });
  const walk = new THREE.MeshLambertMaterial({ color: WORLD.road.sidewalk });
  const lampItems: PropInstance[] = [];
  for (const r of rows) {
    const z0 = r.z + r.depth;
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(r.width + 24, STREET).rotateX(-Math.PI / 2), walk);
    sw.position.set(r.width / 2 - 6, 0.0, z0 + STREET / 2);
    sw.receiveShadow = true;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(r.width + 24, 12).rotateX(-Math.PI / 2), asphalt);
    road.position.set(r.width / 2 - 6, 0.01, z0 + STREET / 2);
    road.receiveShadow = true;
    scene.add(sw, road);
    for (let lx = 0; lx < r.width; lx += 24) lampItems.push({ x: lx + 6, z: z0 + 2.5, rotY: 0, scale: 1 });
  }
  const lampMeshes = buildPropMeshes({ 'lamp.street': lampItems }, material, 0);
  scene.add(lampMeshes.group);

  // --- sign quads with real atlas wordmarks
  const atlas = new SignAtlas(renderer);
  const signMat = makeSignMaterial(atlas);
  signMat.emissiveIntensity = night ? 1.6 : 0;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const { quad, owner } of signs) {
    const o = Math.max(0, Math.min(7, owner));
    const neutral = quad.companyId.startsWith('local:') || quad.companyId.startsWith('civic:') || quad.companyId === 'ticker';
    const uv = neutral
      ? atlas.company({ id: quad.companyId, name: neutralName(quad.companyId), color: quad.companyId === 'ticker' ? '#23282E' : '#5E6670', emblem: 'square' })
      : atlas.company({ id: `c${o}`, name: NAMES[o], color: OWNER_COLORS[o], emblem: OWNER_EMBLEMS[o] });
    const base = positions.length / 3;
    for (const c of quad.corners) positions.push(c[0], c[1], c[2]);
    uvs.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const signGeo = new THREE.BufferGeometry();
  signGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  signGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  signGeo.setIndex(indices);
  signGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(signGeo, signMat));

  // --- night light pools (additive, art §3.13: opacity ≤ 0.14)
  if (night && pools.length) {
    const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(1.0, 0.72, 0.4), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const pl of pools) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pl.radius * 2, pl.radius * 2).rotateX(-Math.PI / 2), poolMat);
      m.position.set(pl.x, 0.12, pl.z);
      scene.add(m);
    }
  }

  // --- camera
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 1, 20000);
  let cx = totalW / 2, cz = totalD / 2 - STREET / 2, span = Math.max(totalW, totalD);
  if (opts.focus !== undefined && lots[opts.focus]) {
    const l = lots[opts.focus];
    cx = l.cx;
    cz = l.cz + 4;
    span = Math.max(l.widthM, l.depthM) * 1.25;
  }
  const az = ((opts.az ?? -25) * Math.PI) / 180, el = ((opts.el ?? 38) * Math.PI) / 180;
  const dist = span * 1.15 * (opts.dist ?? 1);
  camera.position.set(cx + Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, cz + Math.cos(az) * Math.cos(el) * dist);
  camera.lookAt(cx, 0, cz);
  sun.position.set(cx - 400, 700, cz + 250);
  sun.target.position.set(cx, 0, cz);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -Math.max(totalW, totalD);
  sc.right = sc.top = Math.max(totalW, totalD);
  sc.far = 4000;
  sc.updateProjectionMatrix();

  // --- HUD
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:10px;top:10px;z-index:10001;font:600 11px system-ui;color:#eaf1f5;background:rgba(11,17,23,.72);padding:6px 8px;border-radius:6px;max-width:520px;white-space:pre-wrap';
  const budget = (id: string) => FAMILIES_A.find((f) => f.id === id)?.triBudget[opts.lod === 1 ? 'lod1' : 'lod0'] ?? 0;
  const byId = new Map<string, number[]>();
  for (const s of stats) (byId.get(s.id) ?? byId.set(s.id, []).get(s.id)!).push(s.tris);
  hud.textContent = [...byId.entries()].map(([id, t]) => `${id}: ${t.join(' / ')} tris (≤ ${budget(id)})`).join('\n');
  document.body.appendChild(hud);

  window.__previewStats = stats;
  CityUniforms.uTime.value = 1;
  for (let i = 0; i < 3; i++) {
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
  }
  window.__previewReady = true;
}

/**
 * Every W3 prop family on a strip of ground (trees in all four seasons first), for checking the instanced props:
 *   --eval "import('/src/scene/assets/families/common-a/devPreview.ts').then((m) => m.mountPropsPreview({ night: false }))"
 */
export async function mountPropsPreview(opts: { night?: boolean; lod?: 0 | 1 } = {}): Promise<void> {
  window.__previewReady = false;
  const night = opts.night === true, lod = opts.lod ?? 0;
  const { renderer, scene, sun, material } = makeStage(night, 1, lod);
  const items: Record<string, PropInstance[]> = {};
  const add = (id: string, x: number, z: number, rotY = 0, color?: string) => (items[id] ??= []).push(color ? { x, z, rotY, scale: 1, color } : { x, z, rotY, scale: 1 });
  // trees: species × seasons (spring blossom, summer, autumn, winter bare)
  let x = 0;
  for (const species of ['deciduous', 'conifer', 'poplar', 'palm'] as const) {
    for (let season = 0; season < 4; season++) {
      for (let k = 0; k < 2; k++) {
        const look = treeLook(species, season, (k * 0.37) % 1, (k * 0.61 + season * 0.13) % 1, season === 2 ? 0.1 : season === 0 && k === 1 ? 0.05 : 0.9);
        add(look.family, x, k * 7, k * 1.3, look.color);
      }
      x += 7;
    }
    x += 4;
  }
  // street furniture and vehicles
  const rest: [PropId, number, string?][] = [
    ['lamp.street', 4], ['lamp.path', 3], ['signal.traffic', 8], ['bench', 4], ['busShelter', 7], ['billboard', 15], ['hedge', 3], ['fence', 4],
    ['car.parked', 4, '#B8322E'], ['car.parked', 4, '#3D5F8F'], ['van', 5, OWNER_COLORS[1]], ['car.police', 4], ['truck.fire', 5], ['ambulance', 5], ['paperRolls', 5],
  ];
  let rx = 0;
  for (const [id, w, color] of rest) {
    add(id, rx + w / 2, 22, 0, color);
    rx += w + 3;
  }
  const group = buildPropMeshes(items, material, lod).group;
  scene.add(group);
  const width = Math.max(x, rx);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(width + 60, 60).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: WORLD.ground.grass }));
  ground.position.set(width / 2, -0.02, 12);
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 5000);
  const fit = (width / 2 + 6) / Math.tan(((30 * window.innerWidth) / window.innerHeight / 2) * (Math.PI / 180));
  camera.position.set(width / 2, fit * 0.42, 12 + fit * 0.9);
  camera.lookAt(width / 2, 2, 12);
  sun.position.set(width / 2 - 200, 400, 200);
  sun.target.position.set(width / 2, 0, 12);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -width;
  sc.right = sc.top = width;
  sc.far = 2000;
  sc.updateProjectionMatrix();
  CityUniforms.uTime.value = 1;
  for (let i = 0; i < 3; i++) {
    renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
  }
  window.__previewReady = true;
}
