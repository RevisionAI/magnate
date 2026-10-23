// CityMaterial — one Lambert material family for all opaque city geometry (chunks, trees, vehicles, props,
// outskirts). Reference implementation from docs/overhaul/research/art-rendering.md Appendix A.2, owned by W1;
// features beyond the reference are additive (marked "W1+") and documented in docs/overhaul/status/w1-render.md.
//
// Vertex format (4-byte aligned attributes, see assets/GeoBuilder.ts) — DO NOT CHANGE, asset factories rely on it:
//   position f32x3 | normal i8x4 (normalized) | color u8x4 (normalized; rgb = sRGB, a = instance-tint weight)
//   fuv f32x2 (facade metres: u along wall, v = height above ground)
//   facade u8x4 (style, seed, floorHeight dm | wallHeight dm for INDUSTRIAL, bay dm)
//   extra u8x4 (emissive 0..255, flags bitfield, owner index 0..7 | 255 = none, reserved)
// Missing optional attributes read as WebGL's default (0, 0, 0, 1): no facade, no emission, no flags.
import * as THREE from 'three';

export const FLAG_OWNER_ROOF = 1;   // up-facing faces of company buildings (tinted with owner colour at distance)
export const FLAG_VEGETATION = 2;   // leaves / crops / lawns (seasonal tint + desaturation)
export const FLAG_PAVED = 4;        // asphalt / sidewalks (rain wetness, partial "ploughed" snow)
export const FLAG_SNOWABLE = 8;     // receives snow when facing up

/** Overlay ramp modes for `uOverlayMode` (art §5.14). */
export const OVERLAY_SEQUENTIAL = 0;   // 5-stop sequential ramp (verified)
export const OVERLAY_DIVERGING = 1;    // red #DF6F6A → neutral #E8E4DC → green #61C28F (profit)
export const OVERLAY_CATEGORICAL = 2;  // value × 255 = colorIndex into uOwnerColors (Owners); 255 = neutral
export const OVERLAY_BINNED = 3;       // sequential ramp quantised into 5 bins (CapLab land value)

export const CityUniforms = {
  uNight: { value: 0 },                                   // 0 day .. 1 night (window/lamp emission)
  uLitFrac: { value: 0.42 },                              // share of windows lit at night
  uWinWarm: { value: new THREE.Color(1.0, 0.72, 0.38) },  // linear HDR base colours (x uEmiBoost)
  uWinCool: { value: new THREE.Color(0.75, 0.85, 1.0) },
  uEmiBoost: { value: 2.4 },                              // > 1 so lit windows cross the bloom threshold (1.0)
  uSkyRefl: { value: new THREE.Color(0.45, 0.62, 0.8) },  // sky colour reflected by glass (set by DayNight)
  uGlass: { value: new THREE.Color('#46607A') },
  uGlass2: { value: new THREE.Color('#6F8FA6') },
  uOwnerColors: { value: Array.from({ length: 8 }, () => new THREE.Color()) },
  uOwnerRoofMix: { value: 0 },                            // smoothstep(900, 1600, cameraDistance)
  uSeasonTint: { value: new THREE.Color(1, 1, 1) },       // multiplies vegetation
  uSnow: { value: 0 },                                    // 0..1 snow cover on up-facing surfaces
  uWet: { value: 0 },                                     // 0..1 rain wetness on paved surfaces
  uOverlay: { value: 0 },                                 // 0..1 "clay mode" for data overlays
  uOverlayTex: { value: null as THREE.Texture | null },   // R8, one texel per plot, row 0 = north (pz = 0)
  uCitySize: { value: new THREE.Vector2(1600, 1600) },    // metres (the city is centred on the origin)
  uTime: { value: 0 },
  // ---- W1+ (additive) ----
  uShopLit: { value: 2.2 },                               // shopfront lit multiplier: ×2.2 open, 0.3 after 22:00
  uVegDesat: { value: 0 },                                // 0..1 vegetation desaturation (dormant winter grass)
  uDesaturate: { value: 0 },                              // 0..1 whole-city desaturation; written by Environment every frame
                                                          // (overcast + env.cityDesaturation for insolvency, art §5.21)
  uOverlayMode: { value: OVERLAY_SEQUENTIAL },            // ramp for clay mode (OVERLAY_*)
  uNeutralOwner: { value: new THREE.Color('#8FA3B5') },   // categorical overlay colour for "no owner" (civic)
};

const VERT_DECL = /* glsl */ `
attribute vec2 fuv;
attribute vec4 facade;
attribute vec4 extra;
varying vec2 vFuv;
varying vec4 vFacade;
varying vec4 vExtra;
varying vec3 vMWorld;
vec3 m_srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
`;

// replaces #include <color_vertex>
const VERT_COLOR = /* glsl */ `
float m_tintW = 1.0;
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  vColor = vec4(1.0);                                      // r186: vColor is always vec4; alpha stays 1
#endif
#if defined( USE_COLOR_ALPHA )
  vColor.rgb *= m_srgb2lin(color.rgb); m_tintW = color.a;   // alpha = instance-tint weight, NOT opacity
#elif defined( USE_COLOR )
  vColor.rgb *= m_srgb2lin(color.rgb);                      // RGB-only colour attribute: tint weight 1
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, m_tintW);
#endif
vFuv = fuv; vFacade = facade; vExtra = extra;
{
  vec4 mwp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mwp = instanceMatrix * mwp;
  #endif
  vMWorld = (modelMatrix * mwp).xyz;
}
`;

const FRAG_DECL = /* glsl */ `
uniform float uNight, uLitFrac, uEmiBoost, uOwnerRoofMix, uSnow, uWet, uOverlay, uTime, uShopLit, uVegDesat, uDesaturate;
uniform int uOverlayMode;
uniform vec3 uWinWarm, uWinCool, uSkyRefl, uGlass, uGlass2, uSeasonTint, uNeutralOwner;
uniform vec3 uOwnerColors[8];
uniform sampler2D uOverlayTex;
uniform vec2 uCitySize;
varying vec2 vFuv;
varying vec4 vFacade;
varying vec4 vExtra;
varying vec3 vMWorld;
float m_win; float m_lit; vec3 m_winCol; float m_style; int m_flags;
float m_h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float m_rect(vec2 f, vec4 r, vec2 aa) { vec2 a = smoothstep(r.xy - aa, r.xy + aa, f) * (1.0 - smoothstep(r.zw - aa, r.zw + aa, f)); return a.x * a.y; }
vec3 m_ramp(float t) {
  vec3 c0 = vec3(0.10, 0.16, 0.42), c1 = vec3(0.07, 0.45, 0.55), c2 = vec3(0.28, 0.70, 0.38), c3 = vec3(0.98, 0.82, 0.25), c4 = vec3(0.95, 0.38, 0.16);
  t = clamp(t, 0.0, 1.0) * 4.0;
  return t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : t < 3.0 ? mix(c2, c3, t - 2.0) : mix(c3, c4, t - 3.0);
}
vec3 m_overlayColor(float v) {
  if (uOverlayMode == 1) {          // diverging: loss red -> neutral -> profit green (linear values)
    vec3 red = vec3(0.737, 0.159, 0.144), mid = vec3(0.807, 0.776, 0.716), green = vec3(0.117, 0.539, 0.275);
    return v < 0.5 ? mix(red, mid, v * 2.0) : mix(mid, green, v * 2.0 - 1.0);
  }
  if (uOverlayMode == 2) {          // categorical owners: v * 255 = colorIndex (255 = neutral)
    float idx = floor(v * 255.0 + 0.5);
    return idx < 7.5 ? uOwnerColors[int(idx)] : uNeutralOwner;
  }
  if (uOverlayMode == 3) return m_ramp((floor(clamp(v, 0.0, 0.999) * 5.0) + 0.5) / 5.0);   // 5 bins
  return m_ramp(v);
}
`;

// replaces #include <color_fragment>  (runs before lighting; diffuseColor is still editable)
const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
m_win = 0.0; m_lit = 0.0; m_winCol = uWinWarm;
m_style = floor(vFacade.x + 0.5);
m_flags = int(vExtra.y + 0.5);
if (m_style > 4.5 && m_style < 5.5) {
  // INDUSTRIAL: continuous clerestory band at 70-88% of the wall height (facade.z = wall height, dm)
  float hh = vFacade.z * 0.1;
  float bay = max(vFacade.w, 10.0) * 0.1;
  float fx = vFuv.x / bay; float ax = fwidth(fx); float fxf = fract(fx);
  float mx = smoothstep(0.06 - ax, 0.06 + ax, fxf) * (1.0 - smoothstep(0.94 - ax, 0.94 + ax, fxf));
  float ay = fwidth(vFuv.y);
  float band = smoothstep(hh * 0.70 - ay, hh * 0.70 + ay, vFuv.y) * (1.0 - smoothstep(hh * 0.88 - ay, hh * 0.88 + ay, vFuv.y));
  // W1+: bays light in groups (65 % of bays at 0.85, the rest at 0.2) so night shifts read as windows, not neon.
  float bayLit = step(m_h12(vec2(floor(fx), vFacade.y)), 0.65);
  m_win = mx * band; m_winCol = uWinCool; m_lit = m_win * mix(0.2, 0.85, bayLit) * 0.75;
  diffuseColor.rgb = mix(diffuseColor.rgb, uGlass2, m_win);
} else if (m_style > 0.5) {
  float seed = vFacade.y;
  vec2 cellSize = vec2(max(vFacade.w, 10.0), max(vFacade.z, 10.0)) * 0.1;   // bay, floor height (m)
  vec2 fu = vFuv;
  vec4 r = vec4(0.30, 0.32, 0.70, 0.78);                                      // 1 HOUSE
  float litMul = 1.0;
  if (m_style > 1.5 && m_style < 2.5) r = vec4(0.16, 0.28, 0.84, 0.82);       // 2 APARTMENT
  else if (m_style > 2.5 && m_style < 3.5) { r = vec4(0.04, 0.05, 0.96, 0.95); m_winCol = uWinCool * 0.55; litMul = 0.7; } // 3 CURTAIN WALL
  else if (m_style > 3.5 && m_style < 4.5) {                                  // 4 SHOP: glazed ground floor
    if (fu.y < 4.2) { cellSize = vec2(4.5, 4.2); r = vec4(0.04, 0.06, 0.96, 0.80); litMul = uShopLit; }
    else { fu.y -= 4.2; r = vec4(0.20, 0.28, 0.80, 0.80); }
  }
  else if (m_style > 5.5) { r = vec4(0.03, 0.34, 0.97, 0.88); m_winCol = uWinCool * 0.7; litMul = 0.8; } // 6 OFFICE ribbon
  vec2 cell = fu / cellSize;
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  vec2 aa = fwidth(cell);
  float mask = m_rect(f, r, aa);
  float area = (r.z - r.x) * (r.w - r.y);
  float far = smoothstep(0.35, 0.8, max(aa.x, aa.y));       // cell < ~1.5 px: fade to average (no moire)
  mask = mix(mask, area, far);
  bool office = (m_style > 2.5 && m_style < 3.5) || m_style > 5.5;
  vec2 litId = office ? vec2(floor(id.x / 3.0), id.y) : id;  // offices light up in 3-bay clusters per floor
  float h = m_h12(litId + seed * 7.13);
  m_win = mask;
  m_lit = mix(step(h, uLitFrac * litMul) * mask, 0.5 * min(1.0, uLitFrac * litMul) * area, far);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uGlass, uGlass2, m_h12(id.yx + seed)), m_win);
}
// wall-base contact AO: darken the bottom 3.5 m of every facade (replaces SSAO on LOW/MED)
if (m_style > 0.5) diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 3.5, vFuv.y));
// vegetation seasonal tint (+ W1+ dormant-season desaturation towards a warm grey)
if ((m_flags & 2) != 0) {
  float vl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, vl * vec3(1.06, 1.0, 0.86), uVegDesat) * uSeasonTint;
}
// owner roof tint at distance (ownership must read at city zoom)
float m_owner = floor(vExtra.z + 0.5);
if ((m_flags & 1) != 0 && m_owner < 7.5) {
  vec3 oc = uOwnerColors[int(m_owner)];
  diffuseColor.rgb = mix(diffuseColor.rgb, oc, uOwnerRoofMix * 0.85);
}
// rain: darker paved surfaces
if ((m_flags & 4) != 0) diffuseColor.rgb *= mix(1.0, 0.72, uWet);
// data overlay "clay mode": desaturate, then tint by the value under this fragment (city centred on the origin)
if (uOverlay > 0.001) {
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 clay = vec3(lum * 0.35 + 0.45);
  float v = texture2D(uOverlayTex, vMWorld.xz / uCitySize + 0.5).r;
  float wallW = m_style > 0.5 ? 0.45 : 1.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(clay, m_overlayColor(v), 0.78 * wallW), uOverlay);
}
// W1+: whole-city desaturation (insolvency); a plain luminance mix, independent of the overlay ramp
if (uDesaturate > 0.001) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), uDesaturate);
`;

// replaces #include <emissivemap_fragment>  (normal is available here; lighting has not run yet)
const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 3.0);
  // snow on up-facing faces (view-space normal -> world via transpose(viewMatrix)); W1+: paved surfaces take
  // 0.35 x uSnow so roads read as ploughed (art §3.14)
  vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float snowW = (m_flags & 8) != 0 ? ((m_flags & 4) != 0 ? 0.35 : 1.0) : 0.0;
  if (snowW > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), snowW * uSnow * smoothstep(0.65, 0.9, nW.y));
  totalEmissiveRadiance += m_win * (0.08 + 0.35 * fres) * uSkyRefl * (1.0 - uNight) * (1.0 - uOverlay);   // fake sky reflection on glass
  totalEmissiveRadiance += m_lit * m_winCol * uNight * uEmiBoost * (1.0 - 0.85 * uOverlay);             // lit windows
  totalEmissiveRadiance += (vExtra.x / 255.0) * diffuseColor.rgb * uNight * uEmiBoost * 1.6;               // lamps, signs
  if ((m_flags & 4) != 0) totalEmissiveRadiance += uWet * fres * uSkyRefl * 0.25;                          // wet sheen
}
`;

export function makeCityMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = 'CityMaterial';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CityUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <color_vertex>', VERT_COLOR);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  mat.customProgramCacheKey = () => 'magnate-city-v2';
  return mat;
}

export function setOwnerColors(hexes: readonly string[]): void {
  hexes.slice(0, 8).forEach((h, i) => CityUniforms.uOwnerColors.value[i].set(h)); // Color.set converts sRGB -> linear
}
