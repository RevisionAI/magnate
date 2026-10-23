// Asset gallery (route: ?dev=assets) — the art review surface for every AssetFactory (art bible §5.24): factories ×
// variants × levels × construction stages × owners × months × utilization, day or night, LOD0 or LOD1, with the
// instanced props, animated parts, particle emitters, sign atlas and light pools that the city renderer will draw.
// Owned by W4; W3 uses it read-only. Every control is mirrored in the URL so scripts/shoot.mjs can reproduce a view:
//   only=<tokens>         comma-separated filters: id substring or family (factory, farm, seaport, industrial…)
//   variants=<1..4>       variants per factory (default 3)
//   owner=<0..7|255>      owner colour index (default: cycles per build)
//   level=<1|2|3>         building level (default 1)
//   stage=<stage>         foundation|structure|finishing|complete|closed (default complete)
//   progress=<0..1>       overall construction progress (default: middle of the stage, 1 when complete)
//   month=<1..12>         game month (crops, seasons); season=<0..3> picks Apr/Jul/Oct/Jan when month is absent
//   util=<0..1>           utilization (emitter rates, animated parts, trucks, parked cars; default 0.8)
//   product=<id>          product for every build (default: a sample per variant covering every family / crop)
//   night=1               night lighting (lit windows, emissive, bloom, light pools)
//   lod=1                 build LOD1 instead of LOD0
//   cam=far               start zoomed out (district / city band)
//   turntable=1           orbit the camera slowly
//   ui=0 | table=0 | labels=0 | post=0   hide the panels / budget table / labels; render without the composer
// window.__galleryReady becomes true once a build has rendered (for scripts/shoot.mjs --ready);
// window.__galleryRows holds the budget table rows.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { allFactories, familyOf, propFamilyFor } from '@/scene/assets/registry';
import { GeoBuilder, toBufferGeometry } from '@/scene/assets/GeoBuilder';
import {
  seasonOfMonth, stageForProgress, STAGE_RANGES,
  type AnimatedPart, type AssetFactory, type AssetParams, type Emitter, type LightPool, type LotFrame, type SignQuad, type Stage,
} from '@/scene/assets/AssetFactory';
import { buildPartitionedFamily, type PropInstance } from '@/scene/assets/Instancing';
import { PART_SPECS, partPose, type PartPose } from '@/scene/assets/familiesB';
import { FACTORY_FAMILIES, FAMILY_SAMPLE_PRODUCT } from '@/scene/assets/families/common-b/products';
import { CityUniforms, makeCityMaterial, setOwnerColors } from '@/scene/materials/CityMaterial';
import { SignAtlas, buildSignGeometry, makeSignMaterial, type CompanyStyle } from '@/scene/materials/SignAtlas';
import { FONTS, NEUTRAL_OWNER, OWNER_COLORS, OWNER_EMBLEMS, UI, WORLD } from '@/theme/tokens';
import { PLOT_SIZE } from '@/scene/units';

// ---- options -------------------------------------------------------------------------------------------------------

interface Opts {
  only: string;
  variants: number;
  owner: number | null; // null = cycle
  level: 1 | 2 | 3;
  stage: Stage;
  progress: number;
  month: number;
  util: number;
  product: string;
  night: boolean;
  lod: 0 | 1;
  cam: 'near' | 'far';
  turntable: boolean;
  ui: boolean;
  table: boolean;
  labels: boolean;
  post: boolean;
}

const STAGES: readonly Stage[] = ['foundation', 'structure', 'finishing', 'complete', 'closed'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const PRODUCT_CHOICES = ['', ...FACTORY_FAMILIES.map((f) => FAMILY_SAMPLE_PRODUCT[f] ?? ''), 'wheat', 'sugarcane', 'cotton', 'coffee_beans', 'hops', 'iron_ore', 'crude_oil'].filter((v, i, a) => a.indexOf(v) === i);

function num(q: URLSearchParams, key: string, fallback: number): number {
  const v = q.get(key);
  if (v === null || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readOpts(q: URLSearchParams): Opts {
  const stageParam = q.get('stage') as Stage | null;
  const stage: Stage = stageParam && STAGES.includes(stageParam) ? stageParam : 'complete';
  const mid = stage === 'complete' || stage === 'closed' ? 1 : (STAGE_RANGES[stage][0] + STAGE_RANGES[stage][1]) / 2;
  const season = num(q, 'season', 1) & 3;
  const ownerRaw = q.get('owner');
  const level = Math.round(num(q, 'level', 1));
  return {
    only: q.get('only') ?? '',
    variants: Math.min(4, Math.max(1, Math.round(num(q, 'variants', 3)))),
    owner: ownerRaw === null || ownerRaw === '' ? null : Math.round(num(q, 'owner', 0)),
    level: (level === 2 || level === 3 ? level : 1) as 1 | 2 | 3,
    stage,
    progress: Math.min(1, Math.max(0, num(q, 'progress', mid))),
    month: Math.min(12, Math.max(1, Math.round(num(q, 'month', [4, 7, 10, 1][season])))),
    util: Math.min(1, Math.max(0, num(q, 'util', 0.8))),
    product: q.get('product') ?? '',
    night: q.get('night') === '1',
    lod: q.get('lod') === '1' ? 1 : 0,
    cam: q.get('cam') === 'far' ? 'far' : 'near',
    turntable: q.get('turntable') === '1',
    ui: q.get('ui') !== '0',
    table: q.get('table') !== '0',
    labels: q.get('labels') !== '0',
    post: q.get('post') !== '0',
  };
}

function writeOpts(o: Opts): string {
  const q = new URLSearchParams();
  q.set('dev', 'assets');
  if (o.only) q.set('only', o.only);
  if (o.variants !== 3) q.set('variants', String(o.variants));
  if (o.owner !== null) q.set('owner', String(o.owner));
  if (o.level !== 1) q.set('level', String(o.level));
  if (o.stage !== 'complete') q.set('stage', o.stage);
  if (o.stage !== 'complete' && o.stage !== 'closed') q.set('progress', o.progress.toFixed(2));
  if (o.month !== 7) q.set('month', String(o.month));
  if (o.util !== 0.8) q.set('util', o.util.toFixed(2));
  if (o.product) q.set('product', o.product);
  if (o.night) q.set('night', '1');
  if (o.lod) q.set('lod', '1');
  if (o.cam === 'far') q.set('cam', 'far');
  if (o.turntable) q.set('turntable', '1');
  if (!o.ui) q.set('ui', '0');
  if (!o.table) q.set('table', '0');
  if (!o.labels) q.set('labels', '0');
  if (!o.post) q.set('post', '0');
  return '?' + q.toString();
}

function matches(f: AssetFactory, only: string): boolean {
  const tokens = only.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const fam = familyOf(f).toLowerCase();
  return tokens.some((t) => f.id.toLowerCase().includes(t) || fam === t);
}

// ---- rows ----------------------------------------------------------------------------------------------------------

interface Row {
  id: string;
  family: string;
  variant: number;
  product: string;
  lod0: number;
  lod1: number;
  budget0: number;
  budget1: number;
  props: number;
  parts: number;
  emitters: number;
  signs: number;
  pools: number;
  ms: number;
  error?: string;
}

declare global {
  interface Window {
    __galleryReady?: boolean;
    __galleryRows?: Row[];
  }
}

// ---- particle preview (CPU version of the art §5.19 GPU formula) -----------------------------------------------------

interface PuffKind { life: number; rise: number; s0: number; s1: number; c0: string; c1: string; alpha: number; additive?: boolean; }
const PUFF: Record<Emitter['kind'], PuffKind> = {
  smoke: { life: 12, rise: 1.8, s0: 4, s1: 18, c0: '#8A8C90', c1: '#D9DADC', alpha: 0.78 },
  steam: { life: 6, rise: 2.6, s0: 3, s1: 11, c0: '#F4F5F6', c1: '#FFFFFF', alpha: 0.7 },
  dust: { life: 3, rise: 0.7, s0: 2.5, s1: 8, c0: '#A89886', c1: '#C9BBA8', alpha: 0.55 },
  flare: { life: 0.7, rise: 0.4, s0: 2.6, s1: 3.6, c0: '#FFB060', c1: '#FF7A2A', alpha: 0.95, additive: true },
};
const TONE: Record<'light' | 'dark', [string, string]> = { light: ['#A9ABAF', '#E6E7E8'], dark: ['#4E5055', '#97999C'] };
const WIND = new THREE.Vector3(0.9, 0, 0.35);
const MAX_PUFFS_PER_EMITTER = 18;

class Puffs {
  readonly group = new THREE.Group();
  private readonly layers: { mesh: THREE.Points; pos: Float32Array; size: Float32Array; alpha: Float32Array; col: Float32Array; emitters: Emitter[] }[] = [];
  private readonly mats: THREE.ShaderMaterial[] = [];

  constructor(emitters: readonly Emitter[], scale: { value: number }) {
    for (const additive of [false, true]) {
      const list = emitters.filter((e) => !!PUFF[e.kind].additive === additive);
      if (!list.length) continue;
      const n = list.length * MAX_PUFFS_PER_EMITTER;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), col = new Float32Array(n * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uScale: scale },
        vertexShader: /* glsl */ `
          attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale;
          varying float vAlpha; varying vec3 vColor;
          void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * uScale / max(1.0, -mv.z); vAlpha = aAlpha; vColor = aColor; }`,
        fragmentShader: /* glsl */ `
          varying float vAlpha; varying vec3 vColor;
          void main() { vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
            float a = smoothstep(1.0, 0.45, r) * vAlpha; if (a < 0.01) discard;
            gl_FragColor = vec4(vColor, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Points(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.mats.push(mat);
      this.layers.push({ mesh, pos, size, alpha, col, emitters: list });
    }
  }

  update(t: number, night: number): void {
    const c0 = new THREE.Color(), c1 = new THREE.Color(), c = new THREE.Color();
    for (const L of this.layers) {
      let i = 0;
      for (let e = 0; e < L.emitters.length; e++) {
        const em = L.emitters[e];
        const k = PUFF[em.kind];
        const [h0, h1] = em.tone ? TONE[em.tone] : [k.c0, k.c1];
        c0.set(h0); c1.set(h1);
        const active = Math.min(MAX_PUFFS_PER_EMITTER, Math.round(em.rate * k.life));
        const scale = em.size ?? 1;
        for (let p = 0; p < MAX_PUFFS_PER_EMITTER; p++, i++) {
          if (p >= active) { L.alpha[i] = 0; continue; }
          const phase = p / Math.max(1, active) + e * 0.137;
          const age = (((t / k.life + phase) % 1) + 1) % 1;
          const tl = age * k.life;
          const jx = Math.sin((p + 1) * 12.9898 + e) * 0.6, jz = Math.cos((p + 1) * 78.233 + e) * 0.6;
          L.pos[i * 3] = em.x + WIND.x * tl * (em.kind === 'flare' ? 0.2 : 1) + jx * age * 3;
          L.pos[i * 3 + 1] = em.y + k.rise * tl;
          L.pos[i * 3 + 2] = em.z + WIND.z * tl * (em.kind === 'flare' ? 0.2 : 1) + jz * age * 3;
          L.size[i] = (k.s0 + (k.s1 - k.s0) * age) * scale * (em.kind === 'flare' ? 0.8 + 0.25 * Math.sin(t * 23 + p) : 1);
          L.alpha[i] = k.alpha * Math.sin(Math.PI * Math.min(1, 1.3 * age)) * (1 - age) * 1.6;
          c.copy(c0).lerp(c1, age);
          const dayK = k.additive ? 1 : 1 - 0.75 * night;
          L.col[i * 3] = c.r * dayK; L.col[i * 3 + 1] = c.g * dayK; L.col[i * 3 + 2] = c.b * dayK;
        }
      }
      const g = L.mesh.geometry;
      for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    for (const L of this.layers) L.mesh.geometry.dispose();
    for (const m of this.mats) m.dispose();
  }
}

// ---- animated parts preview ----------------------------------------------------------------------------------------

class PartsView {
  readonly group = new THREE.Group();
  private readonly sets: { mesh: THREE.InstancedMesh; parts: AnimatedPart[] }[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly pose: PartPose = { axis: 'y', angle: 0, offset: 0 };

  constructor(parts: readonly AnimatedPart[], material: THREE.Material) {
    const byKey = new Map<string, AnimatedPart[]>();
    for (const p of parts) {
      const key = `${p.kind}|${p.extent ?? ''}`;
      const list = byKey.get(key) ?? [];
      list.push(p);
      byKey.set(key, list);
    }
    const color = new THREE.Color();
    for (const [key, list] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const spec = PART_SPECS[list[0].kind];
      const gb = new GeoBuilder();
      spec.build(gb, list[0].extent ?? spec.defaultExtent);
      const geo = toBufferGeometry(gb.finish());
      this.geos.push(geo);
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = spec.castShadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = key;
      list.forEach((p, i) => mesh.setColorAt(i, color.set(p.owner >= 0 && p.owner < 8 ? OWNER_COLORS[p.owner] : NEUTRAL_OWNER)));
      this.group.add(mesh);
      this.sets.push({ mesh, parts: list });
    }
    this.update(0);
  }

  update(t: number): void {
    const m = new THREE.Matrix4(), r = new THREE.Matrix4(), tr = new THREE.Matrix4(), s = new THREE.Matrix4();
    for (const { mesh, parts } of this.sets) {
      parts.forEach((p, i) => {
        partPose(p, t, this.pose);
        m.makeTranslation(p.x, p.y, p.z).multiply(r.makeRotationY(p.rotY));
        if (this.pose.angle !== 0) {
          if (this.pose.axis === 'x') r.makeRotationX(this.pose.angle);
          else if (this.pose.axis === 'y') r.makeRotationY(this.pose.angle);
          else r.makeRotationZ(this.pose.angle);
          m.multiply(r);
        }
        if (this.pose.offset !== 0) {
          const o = this.pose.offset;
          m.multiply(tr.makeTranslation(this.pose.axis === 'x' ? o : 0, this.pose.axis === 'y' ? o : 0, this.pose.axis === 'z' ? o : 0));
        }
        if (p.scale !== undefined && p.scale !== 1) m.multiply(s.makeScale(p.scale, p.scale, p.scale));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  get triangles(): number {
    return this.sets.reduce((acc, { mesh }) => acc + ((mesh.geometry.index?.count ?? 0) / 3) * mesh.count, 0);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
  }
}

// ---- light pools -------------------------------------------------------------------------------------------------

function radialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- the scene ------------------------------------------------------------------------------------------------------

const COMPANY_NAMES = ['Magnate Co', 'Orion Foods', 'Helix Works', 'Verda Group', 'Ember Steel', 'Skyline Ltd', 'Crown Brands', 'Nova Labs'];

/** Products shown per variant when the Product picker is on "(sample per variant)": every factory family, crop and
 *  port customs letter appears across the variants. undefined = let the factory pick a seeded default. */
function sampleProducts(id: string, v: number): string[] | undefined {
  const fam = (i: number) => [FAMILY_SAMPLE_PRODUCT[FACTORY_FAMILIES[i % FACTORY_FAMILIES.length]] ?? 'flour'];
  switch (id) {
    case 'factory_small': return fam(v);
    case 'factory_large': return fam(v + 4);
    case 'small_farm': return [['wheat'], ['sugarcane'], ['cotton'], ['wheat', 'cotton']][v % 4];
    case 'large_farm': return [['wheat', 'cotton', 'sugarcane'], ['wheat'], ['cotton', 'wheat'], ['sugarcane']][v % 4];
    case 'small_plantation': return [['coffee_beans'], ['hops'], ['coffee_beans'], ['hops']][v % 4];
    case 'iron_mine': return ['iron_ore'];
    case 'oil_well': return ['crude_oil'];
    case 'seaport': return [['car', 'television'], ['steel', 'crude_oil']][v % 2];
    default: return undefined;
  }
}

/** Target types previewed by the generic 'construction' factory, one per variant (footprints from content). */
const CONSTRUCTION_TARGETS: readonly { id: string; footprint: readonly [number, number]; height: number }[] = [
  { id: 'department_store', footprint: [4, 4], height: 21.3 },
  { id: 'supermarket', footprint: [3, 3], height: 8 },
  { id: 'tv_station', footprint: [3, 3], height: 14 },
  { id: 'convenience_store', footprint: [1, 1], height: 4.6 },
];

function companyStyle(companyId: string): CompanyStyle {
  const m = /^owner:(\d+)$/.exec(companyId);
  const i = m ? Number(m[1]) : 255;
  if (i >= 0 && i < 8) return { id: companyId, name: COMPANY_NAMES[i], color: OWNER_COLORS[i], emblem: OWNER_EMBLEMS[i] };
  return { id: companyId, name: 'Local Co', color: NEUTRAL_OWNER, emblem: 'circle' };
}

class GalleryScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly composer: EffectComposer | null;
  private readonly bloom: BloomEffect | null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 1, 9000);
  private readonly controls: MapControls;
  private readonly sun = new THREE.DirectionalLight();
  private readonly hemi = new THREE.HemisphereLight();
  private readonly material = makeCityMaterial();
  private readonly atlas: SignAtlas;
  private readonly signMaterial: THREE.MeshLambertMaterial;
  private readonly poolTexture = radialTexture();
  private readonly poolGeometry = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  private readonly poolMaterials: Record<'warm' | 'cool', THREE.MeshBasicMaterial>;
  private readonly waterMaterial = new THREE.MeshStandardMaterial({ color: WORLD.water.mid, roughness: 0.25, metalness: 0 });
  private readonly groundMaterial = new THREE.MeshLambertMaterial({ color: WORLD.ground.grass });
  private readonly pointScale = { value: 800 };
  private content = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private puffs: Puffs | null = null;
  private parts: PartsView | null = null;
  private night = 0;
  private turntable = false;
  private readonly timer = new THREE.Timer();
  private frames = 0;
  private readyPending = false;
  private resizeObserver: ResizeObserver;

  constructor(private readonly host: HTMLElement, post: boolean) {
    const r = new THREE.WebGLRenderer({ antialias: !post, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = post ? THREE.NoToneMapping : THREE.NeutralToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    host.appendChild(r.domElement);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    host.appendChild(this.labelRenderer.domElement);

    if (post) {
      this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType });
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.85, radius: 0.72, levels: 6 });
      this.composer.addPass(new EffectPass(this.camera, this.bloom, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })));
      this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
    } else {
      this.composer = null;
      this.bloom = null;
    }

    this.controls = new MapControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.content);
    setOwnerColors([...OWNER_COLORS]);
    this.atlas = new SignAtlas(r);
    this.signMaterial = makeSignMaterial(this.atlas);
    this.poolMaterials = {
      warm: new THREE.MeshBasicMaterial({ map: this.poolTexture, color: new THREE.Color(1.0, 0.72, 0.4), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
      cool: new THREE.MeshBasicMaterial({ map: this.poolTexture, color: new THREE.Color(0.75, 0.85, 1.0), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    this.timer.connect(document);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    r.setAnimationLoop((t) => this.frame(t));
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyViewOffset();
    this.pointScale.value = (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  /** Width (px) hidden by the options panel on the left; the view is shifted so content centres in the free area. */
  private uiInset = 0;

  private applyViewOffset(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    if (this.uiInset > 0) this.camera.setViewOffset(w, h, -this.uiInset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /** (Re)build every matching factory with the options; returns the budget table rows. */
  rebuild(o: Opts, keepCamera: boolean): Row[] {
    this.clear();
    this.setNight(o.night);
    this.turntable = o.turntable;
    CityUniforms.uSeasonTint.value.set(['#F0FBE8', '#FFFFFF', '#FFF0D6', '#ECEFF2'][seasonOfMonth(o.month)]);
    CityUniforms.uSnow.value = 0;

    const factories = allFactories().filter((f) => matches(f, o.only));
    this.uiInset = o.ui ? 350 : 0;
    this.applyViewOffset();
    const bounds = new THREE.Box3();
    const rows: Row[] = [];
    const props = new Map<string, PropInstance[]>();
    const parts: AnimatedPart[] = [];
    const emitters: Emitter[] = [];
    const signs: SignQuad[] = [];
    const pools: LightPool[] = [];
    const gap = 36;
    // row width for a roughly 16:9 layout: with several variants each factory gets its own row(s); with one variant
    // per factory the builds flow into rows
    let area = 0;
    for (const f of factories) {
      const [fw, fh] = f.footprints[0] ?? [1, 1];
      area += (fw * PLOT_SIZE + gap) * (fh * PLOT_SIZE + (f.id === 'seaport' ? 72 : 0) + gap) * o.variants;
    }
    const maxRowWidth = Math.max(640, Math.sqrt(area * 1.9));
    let cursorX = 0, rowZ = 0, rowDepth = 0, usedWidth = 0;

    for (const factory of factories) {
      const water = factory.id === 'seaport' ? 72 : 0;
      // keep a factory's variants together: start a new row when they do not all fit in the rest of this one
      const groupW = o.variants * ((factory.footprints[0]?.[0] ?? 1) * PLOT_SIZE + gap);
      if (cursorX > 0 && o.variants > 1 && cursorX + groupW - gap > maxRowWidth) {
        cursorX = 0;
        rowZ += rowDepth + gap;
        rowDepth = 0;
      }
      for (let v = 0; v < o.variants; v++) {
        // the generic construction factory previews a different (W3) target type per variant: sites for ANY type
        const target = factory.id === 'construction' ? CONSTRUCTION_TARGETS[v % CONSTRUCTION_TARGETS.length] : null;
        const [fw, fh] = target ? target.footprint : factory.footprints[0] ?? [1, 1];
        const widthM = fw * PLOT_SIZE, depthM = fh * PLOT_SIZE;
        if (cursorX + widthM > maxRowWidth && cursorX > 0) {
          cursorX = 0;
          rowZ += rowDepth + gap;
          rowDepth = 0;
        }
        const lot: LotFrame = { cx: cursorX + widthM / 2, cz: rowZ + depthM / 2, widthM, depthM, facing: 'S', quarterTurns: 0 };
        const owner = o.owner !== null ? o.owner : rows.length % 8;
        const params: AssetParams = {
          seed: 1000 + v * 7919 + rows.length * 31, variant: v, level: o.level, stage: o.stage, progress: o.progress, owner,
          utilization: o.util, lod: o.lod, season: seasonOfMonth(o.month), month: o.month, companyId: `owner:${owner}`,
        };
        const products = o.product ? [o.product] : sampleProducts(factory.id, v);
        if (products) params.productIds = products;
        if (target) { params.targetTypeId = target.id; params.heightHint = target.height; }
        const row: Row = { id: target ? `construction→${target.id}` : factory.id, family: familyOf(factory), variant: v, product: products?.join('+') ?? '', lod0: 0, lod1: 0, budget0: factory.triBudget.lod0, budget1: factory.triBudget.lod1, props: 0, parts: 0, emitters: 0, signs: 0, pools: 0, ms: 0 };
        try {
          const b = new GeoBuilder();
          b.owner = owner;
          const t0 = performance.now();
          const out = factory.build(b, lot, params);
          row.ms = performance.now() - t0;
          const arrays = b.finish();
          const geometry = toBufferGeometry(arrays);
          this.disposables.push(geometry);
          const mesh = new THREE.Mesh(geometry, this.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.content.add(mesh);
          const other = new GeoBuilder();
          factory.build(other, lot, { ...params, lod: o.lod === 1 ? 0 : 1 });
          row.lod0 = o.lod === 1 ? other.triangleCount : arrays.triangleCount;
          row.lod1 = o.lod === 1 ? arrays.triangleCount : other.triangleCount;
          const pb = out.pickBox;
          bounds.expandByPoint(new THREE.Vector3(pb[0], 0, pb[2])).expandByPoint(new THREE.Vector3(pb[3], pb[4], pb[5]));
          bounds.expandByPoint(new THREE.Vector3(lot.cx - widthM / 2, 0, lot.cz - depthM / 2)).expandByPoint(new THREE.Vector3(lot.cx + widthM / 2, 0, lot.cz + depthM / 2 + water * 0.5));
          for (const [id, list] of Object.entries(out.props)) {
            props.set(id, [...(props.get(id) ?? []), ...list]);
            row.props += list.length;
          }
          parts.push(...out.animated);
          emitters.push(...out.emitters);
          signs.push(...out.signs);
          pools.push(...out.lightPools);
          row.parts = out.animated.length;
          row.emitters = out.emitters.length;
          row.signs = out.signs.length;
          row.pools = out.lightPools.length;
        } catch (error) {
          row.error = String(error);
          console.error(`[gallery] ${factory.id} v${v} failed`, error);
        }
        rows.push(row);
        if (water) {
          const wGeo = new THREE.PlaneGeometry(widthM + gap, water + 2).rotateX(-Math.PI / 2);
          this.disposables.push(wGeo);
          const w = new THREE.Mesh(wGeo, this.waterMaterial);
          w.position.set(lot.cx, -0.03, lot.cz + depthM / 2 + water / 2 - 1);
          w.receiveShadow = true;
          this.content.add(w);
        }
        if (o.labels) {
          const tag = document.createElement('div');
          tag.textContent = target ? `construction → ${target.id}` : `${factory.id} · v${v}`;
          tag.style.cssText = `font: 600 11px ${FONTS.ui}; color:#fff; background:rgba(11,17,23,.72); padding:2px 6px; border-radius:4px; white-space:nowrap`;
          const label = new CSS2DObject(tag);
          label.position.set(lot.cx, 2, lot.cz + depthM / 2 + water + 7);
          this.content.add(label);
        }
        usedWidth = Math.max(usedWidth, cursorX + widthM);
        cursorX += widthM + gap;
        rowDepth = Math.max(rowDepth, depthM + water + 12);
      }
    }

    this.addProps(props);
    this.parts = new PartsView(parts, this.material);
    this.content.add(this.parts.group);
    this.puffs = new Puffs(emitters, this.pointScale);
    this.content.add(this.puffs.group);
    this.addSigns(signs);
    this.addPools(pools);

    // ground under everything
    const spanX = Math.max(usedWidth, 80), spanZ = Math.max(rowZ + rowDepth - 12, 80);
    const groundGeo = new THREE.PlaneGeometry(spanX + 9000, spanZ + 9000).rotateX(-Math.PI / 2);
    this.disposables.push(groundGeo);
    const ground = new THREE.Mesh(groundGeo, this.groundMaterial);
    ground.position.set(spanX / 2, -0.06, spanZ / 2);
    ground.receiveShadow = true;
    this.content.add(ground);

    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(80, 10, 80));
    // tall parts (cranes, chimneys) count for three quarters: framing their full height wastes the view on sky
    bounds.max.y = Math.max(8, bounds.max.y * 0.75);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center.clone().setY(0);
    if (!keepCamera) {
      // fit the bounding sphere into the free part of the view (right of the options panel)
      const far = o.cam === 'far';
      const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
      const vfov = THREE.MathUtils.degToRad(this.camera.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (Math.max(200, w - this.uiInset) / h));
      // far = the city band (art §3.15, 1,100–3,100 m): at least 1,700 m so the owner-roof tint is fully on
      const fit = sphere.radius / Math.sin(Math.min(vfov, hfov) / 2);
      const dist = far ? Math.max(fit * 1.15, 1700) : fit * 0.86;
      const elev = THREE.MathUtils.degToRad(far ? 55 : 40), azim = THREE.MathUtils.degToRad(-24);
      this.camera.position.set(center.x + dist * Math.cos(elev) * Math.sin(azim), dist * Math.sin(elev), center.z + dist * Math.cos(elev) * Math.cos(azim));
      this.camera.far = Math.max(9000, dist * 4);
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(center);
      this.controls.update();
      // art §3.7 fog distances follow the camera distance d: near = 1.3·d + 600, far = 3.2·d + 4500
      if (this.scene.fog instanceof THREE.Fog) { this.scene.fog.near = 1.3 * dist + 600; this.scene.fog.far = 3.2 * dist + 4500; }
    }
    this.sun.position.set(center.x - 420, 760, center.z + 330);
    this.sun.target.position.copy(center);
    const sc = this.sun.shadow.camera;
    const half = Math.max(spanX, spanZ) * 0.75 + 60;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 10; sc.far = 3000;
    sc.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
    this.frames = 0;
    this.readyPending = true;
    window.__galleryRows = rows;
    return rows;
  }

  private addProps(props: Map<string, PropInstance[]>): void {
    const fallback = new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0);
    this.disposables.push(fallback);
    for (const [id, items] of [...props.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const fam = propFamilyFor(id);
      let geometry: THREE.BufferGeometry = fallback;
      if (fam) {
        const gb = new GeoBuilder();
        fam.build(gb);
        geometry = toBufferGeometry(gb.finish());
        this.disposables.push(geometry);
      } else {
        console.warn(`[gallery] no prop family registered for '${id}' (drawn as grey boxes)`);
      }
      const group = buildPartitionedFamily(geometry, this.material, items, fam?.castShadow ?? false);
      this.content.add(group);
    }
  }

  private addSigns(signs: readonly SignQuad[]): void {
    if (!signs.length) return;
    const geo = buildSignGeometry(signs, (s) => this.atlas.uvFor(s, companyStyle(s.companyId)));
    this.disposables.push(geo);
    const mesh = new THREE.Mesh(geo, this.signMaterial);
    mesh.receiveShadow = true;
    this.content.add(mesh);
  }

  private addPools(pools: readonly LightPool[]): void {
    for (const tone of ['warm', 'cool'] as const) {
      const list = pools.filter((p) => (p.tone ?? 'warm') === tone);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(this.poolGeometry, this.poolMaterials[tone], list.length);
      const m = new THREE.Matrix4();
      list.forEach((p, i) => mesh.setMatrixAt(i, m.makeScale(p.radius, 1, p.radius).setPosition(p.x, 0.12, p.z)));
      mesh.renderOrder = 5;
      mesh.visible = this.night > 0;
      mesh.name = 'pools';
      this.content.add(mesh);
    }
  }

  setNight(on: boolean): void {
    this.night = on ? 1 : 0;
    CityUniforms.uNight.value = this.night;
    CityUniforms.uLitFrac.value = 0.42;
    // 13:00 and 22:30 keys of the art bible §3.6
    this.sun.color.set(on ? '#9FB4FF' : '#FFF6E8');
    this.sun.intensity = on ? 0.45 : 2.9;
    this.hemi.color.set(on ? '#3A4E7A' : '#C2DBF2');
    this.hemi.groundColor.set(on ? '#14161C' : '#86845F');
    this.hemi.intensity = on ? 0.62 : 1.15;
    this.scene.background = new THREE.Color(on ? '#0C1530' : '#CFE0EE');
    const fog = this.scene.fog instanceof THREE.Fog ? this.scene.fog : null;
    this.scene.fog = new THREE.Fog(on ? '#262E4A' : '#D4E4EF', fog?.near ?? 1800, fog?.far ?? 6500);
    CityUniforms.uSkyRefl.value.set(on ? '#1A2540' : '#9DBEDC');
    this.signMaterial.emissiveIntensity = on ? 1.6 : 0;
    if (this.bloom) this.bloom.blendMode.opacity.value = on ? 1 : 0.35;
    this.content.traverse((o) => { if (o.name === 'pools') o.visible = on; });
  }

  /** Optional DOM element for the camera status line (updated at 4 Hz, never through React state). */
  status: HTMLElement | null = null;
  private statusAt = 0;

  private frame(tMs: number): void {
    this.timer.update(tMs);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = tMs / 1000;
    CityUniforms.uTime.value = t;
    if (this.turntable) {
      const off = this.camera.position.clone().sub(this.controls.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.12);
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.controls.update();
    // owner-roof tint at city zoom: 0.85 × smoothstep(900, 1600, camera distance) (art §3.4); the city renderer owns
    // this uniform in the game, the gallery drives it so roofs can be reviewed at every band
    const d = this.camera.position.distanceTo(this.controls.target);
    // dynamic near plane of the game camera (art D8: clamp(0.2·d, 1, 200)) — keeps 1–2 cm ground decals from
    // z-fighting at district and city distances
    const near = Math.min(200, Math.max(1, 0.2 * d));
    if (Math.abs(near - this.camera.near) > 0.05 * this.camera.near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    const k = Math.min(1, Math.max(0, (d - 900) / 700));
    CityUniforms.uOwnerRoofMix.value = 0.85 * k * k * (3 - 2 * k);
    if (this.status && tMs - this.statusAt > 250) {
      this.statusAt = tMs;
      const band = d < 300 ? 'street' : d < 1100 ? 'district' : 'city';
      this.status.textContent = `camera ${Math.round(d)} m · ${band} band · roof tint ${CityUniforms.uOwnerRoofMix.value.toFixed(2)}`;
    }
    this.parts?.update(t);
    this.puffs?.update(t, this.night);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    if (this.readyPending && ++this.frames >= 3) {
      this.readyPending = false;
      window.__galleryReady = true;
    }
  }

  private clear(): void {
    window.__galleryReady = false;
    this.scene.remove(this.content);
    this.content.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
    this.content = new THREE.Group();
    this.scene.add(this.content);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.puffs?.dispose();
    this.parts?.dispose();
    this.puffs = null;
    this.parts = null;
  }

  get triangles(): number { return this.parts?.triangles ?? 0; }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.clear();
    this.controls.dispose();
    this.composer?.dispose();
    this.material.dispose();
    this.signMaterial.dispose();
    this.atlas.texture.dispose();
    this.poolTexture.dispose();
    this.poolGeometry.dispose();
    this.poolMaterials.warm.dispose();
    this.poolMaterials.cool.dispose();
    this.waterMaterial.dispose();
    this.groundMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
    window.__galleryReady = false;
  }
}

// ---- React shell ------------------------------------------------------------------------------------------------------

const panel: CSSProperties = {
  position: 'absolute', padding: '10px 12px', borderRadius: 10, font: `12px ${FONTS.ui}`, color: UI.text,
  background: 'rgba(11,17,23,.84)', border: `1px solid ${UI.strokeSoft}`, boxShadow: '0 8px 24px rgba(0,0,0,.25)',
};

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        font: `600 11px ${FONTS.ui}`, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', marginRight: 4, marginBottom: 4,
        color: on ? UI.ink : UI.text2, background: on ? UI.gold : 'rgba(255,255,255,.06)', border: `1px solid ${on ? UI.gold : UI.strokeSoft}`,
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <span style={{ color: UI.muted }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function AssetGallery() {
  const hostRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GalleryScene | null>(null);
  const [opts, setOpts] = useState<Opts>(() => readOpts(new URLSearchParams(window.location.search)));
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const firstBuild = useRef(true);
  const lastCam = useRef<Opts['cam']>(opts.cam);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    void SignAtlas.loadFonts().then(() => {
      if (disposed) return;
      sceneRef.current = new GalleryScene(host, opts.post);
      sceneRef.current.status = statusRef.current;
      setReady(true);
    });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // the renderer is created once; option changes go through rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const keep = !firstBuild.current && lastCam.current === opts.cam;
    firstBuild.current = false;
    lastCam.current = opts.cam;
    setRows(scene.rebuild(opts, keep));
    window.history.replaceState(null, '', writeOpts(opts));
  }, [opts, ready]);

  const set = (patch: Partial<Opts>) => setOpts((o) => ({ ...o, ...patch }));
  const families = [...new Set(allFactories().map(familyOf))].sort();
  const over = rows.filter((r) => (r.budget0 > 0 && r.lod0 > r.budget0) || (r.budget1 > 0 && r.lod1 > r.budget1));
  const failed = rows.filter((r) => r.error);
  const building = opts.stage === 'closed' ? 1 : opts.stage === 'complete' ? 1 : opts.progress;

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0d1626' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {opts.ui && (
        <div style={{ ...panel, top: 10, left: 10, width: 330, maxHeight: 'calc(100% - 20px)', overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <b style={{ font: `600 14px ${FONTS.display}` }}>Asset gallery</b>
            <span style={{ color: UI.muted }}>{rows.length} builds</span>
          </div>
          {over.length > 0 && <div style={{ color: UI.amber, marginTop: 4 }}>Over budget: {over.map((r) => `${r.id} v${r.variant}`).join(', ')}</div>}
          {failed.length > 0 && <div style={{ color: UI.red, marginTop: 4 }}>Failed: {failed.map((r) => r.id).join(', ')}</div>}
          <Field label="Family">
            <Chip on={!opts.only} onClick={() => set({ only: '' })}>all</Chip>
            {families.map((f) => <Chip key={f} on={opts.only === f} onClick={() => set({ only: f })}>{f}</Chip>)}
          </Field>
          <Field label="Asset">
            <select value={allFactories().some((f) => f.id === opts.only) ? opts.only : ''} onChange={(e) => set({ only: e.target.value })} style={{ width: '100%' }}>
              <option value="">(family filter)</option>
              {allFactories().map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}
            </select>
          </Field>
          <Field label="Variants">{[1, 2, 3, 4].map((n) => <Chip key={n} on={opts.variants === n} onClick={() => set({ variants: n })}>{n}</Chip>)}</Field>
          <Field label="Owner">
            {OWNER_COLORS.map((c, i) => (
              <button key={c} type="button" title={`owner ${i}`} onClick={() => set({ owner: i })} style={{ width: 18, height: 18, borderRadius: 9, marginRight: 4, cursor: 'pointer', background: c, border: opts.owner === i ? `2px solid ${UI.gold}` : '2px solid transparent' }} />
            ))}
            <Chip on={opts.owner === null} onClick={() => set({ owner: null })}>cycle</Chip>
            <Chip on={opts.owner === 255} onClick={() => set({ owner: 255 })}>none</Chip>
          </Field>
          <Field label="Level">{([1, 2, 3] as const).map((n) => <Chip key={n} on={opts.level === n} onClick={() => set({ level: n })}>L{n}</Chip>)}</Field>
          <Field label="Build">
            <input type="range" min={0} max={1} step={0.01} value={building} style={{ width: '100%' }}
              onChange={(e) => { const p = Number(e.target.value); set({ progress: p, stage: stageForProgress(p) }); }} />
            <div style={{ color: UI.muted }}>
              {opts.stage} {opts.stage !== 'complete' && opts.stage !== 'closed' ? `· p ${opts.progress.toFixed(2)}` : ''}
              <label style={{ marginLeft: 10 }}><input type="checkbox" checked={opts.stage === 'closed'} onChange={(e) => set({ stage: e.target.checked ? 'closed' : 'complete', progress: 1 })} /> closed</label>
            </div>
          </Field>
          <Field label="Month">
            <input type="range" min={1} max={12} step={1} value={opts.month} style={{ width: '100%' }} onChange={(e) => set({ month: Number(e.target.value) })} />
            <div style={{ color: UI.muted }}>{MONTHS[opts.month - 1]} · {SEASONS[seasonOfMonth(opts.month)]}</div>
          </Field>
          <Field label="Utilization">
            <input type="range" min={0} max={1} step={0.05} value={opts.util} style={{ width: '100%' }} onChange={(e) => set({ util: Number(e.target.value) })} />
            <div style={{ color: UI.muted }}>{Math.round(opts.util * 100)} %</div>
          </Field>
          <Field label="Product">
            <select value={opts.product} onChange={(e) => set({ product: e.target.value })} style={{ width: '100%' }}>
              {PRODUCT_CHOICES.map((p) => <option key={p} value={p}>{p || '(sample per variant)'}</option>)}
            </select>
          </Field>
          <div ref={statusRef} style={{ color: UI.muted, marginTop: 8, font: `11px ${FONTS.mono}` }} />
          <Field label="View">
            <Chip on={opts.night} onClick={() => set({ night: !opts.night })}>{opts.night ? 'night' : 'day'}</Chip>
            <Chip on={opts.lod === 1} onClick={() => set({ lod: opts.lod === 1 ? 0 : 1 })}>LOD{opts.lod}</Chip>
            <Chip on={opts.cam === 'far'} onClick={() => set({ cam: opts.cam === 'far' ? 'near' : 'far' })}>far</Chip>
            <Chip on={opts.turntable} onClick={() => set({ turntable: !opts.turntable })}>turntable</Chip>
            <Chip on={opts.labels} onClick={() => set({ labels: !opts.labels })}>labels</Chip>
            <Chip on={opts.table} onClick={() => set({ table: !opts.table })}>table</Chip>
          </Field>
        </div>
      )}
      {opts.ui && opts.table && rows.length > 0 && (
        <div style={{ ...panel, top: 10, right: 10, maxHeight: 'calc(100% - 20px)', overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', font: `11px ${FONTS.mono}` }}>
            <thead>
              <tr style={{ color: UI.muted, textAlign: 'right' }}>
                <th style={{ textAlign: 'left', paddingRight: 8 }}>asset</th><th>v</th><th style={{ textAlign: 'left', paddingLeft: 8 }}>product</th><th style={{ paddingLeft: 8 }}>LOD0</th><th style={{ paddingLeft: 8 }}>LOD1</th>
                <th style={{ paddingLeft: 8 }}>props</th><th style={{ paddingLeft: 6 }}>parts</th><th style={{ paddingLeft: 6 }}>emit</th><th style={{ paddingLeft: 6 }}>signs</th><th style={{ paddingLeft: 6 }}>ms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bad0 = r.budget0 > 0 && r.lod0 > r.budget0, bad1 = r.budget1 > 0 && r.lod1 > r.budget1;
                return (
                  <tr key={i} style={{ textAlign: 'right', color: r.error ? UI.red : UI.text2 }}>
                    <td style={{ textAlign: 'left', paddingRight: 8, color: UI.text }}>{r.id}</td>
                    <td>{r.variant}</td>
                    <td style={{ textAlign: 'left', paddingLeft: 8, color: UI.muted }}>{r.product}</td>
                    <td style={{ paddingLeft: 8, color: bad0 ? UI.red : undefined }}>{r.lod0}/{r.budget0}</td>
                    <td style={{ paddingLeft: 8, color: bad1 ? UI.red : undefined }}>{r.lod1}/{r.budget1}</td>
                    <td style={{ paddingLeft: 8 }}>{r.props}</td><td>{r.parts}</td><td>{r.emitters}</td><td>{r.signs}</td><td>{r.ms.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
