import { describe, expect, it } from 'vitest';
import { FrameGovernor, TIER_SETTINGS, classifyRenderer, governorSteps, knobsAtLevel } from './Quality';

describe('classifyRenderer', () => {
  const cases: Array<[string, string, boolean]> = [
    ['ANGLE (Intel, ANGLE Metal Renderer: Intel(R) UHD Graphics 630, Unspecified Version)', 'low', false],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', false],
    ['ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low', false],
    ['Intel(R) Iris(TM) Plus Graphics 655', 'low', false],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium', false],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'medium', false],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium', false],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', 'high', false],
    ['ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 5500M, Unspecified Version)', 'high', false],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high', false],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'low', true],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'low', true],
  ];
  it.each(cases)('%s → %s', (renderer, tier, minimal) => {
    const g = classifyRenderer(renderer);
    expect(g.tier).toBe(tier);
    expect(g.minimal).toBe(minimal);
    expect(g.renderer).toBe(renderer);
  });
});

describe('tier settings (art §3.9)', () => {
  it('LOW is the integrated-GPU pipeline: FXAA, no SSAO, night-only bloom, DPR 1, 2048 shadows', () => {
    const s = TIER_SETTINGS.low;
    expect(s).toMatchObject({ aa: 'fxaa', ao: 'none', bloom: 'night', maxDpr: 1, shadowMapSize: 2048, treeShadows: 'near' });
  });
  it('only HIGH and ULTRA use N8AO', () => {
    expect(TIER_SETTINGS.low.ao).toBe('none');
    expect(TIER_SETTINGS.medium.ao).toBe('none');
    expect(TIER_SETTINGS.high.ao).toBe('n8ao-low-half');
    expect(TIER_SETTINGS.ultra.ao).toBe('n8ao-medium-full');
  });
  it('the governor resolution floor is 0.7 on LOW/MEDIUM (D7)', () => {
    expect(TIER_SETTINGS.low.minScale).toBe(0.7);
    expect(TIER_SETTINGS.medium.minScale).toBe(0.7);
  });
});

describe('governor notches (art §5.10)', () => {
  it('walks resolution first, then features, in order', () => {
    expect(governorSteps(TIER_SETTINGS.low).map((s) => s.label)).toEqual([
      'resolution 90%', 'resolution 80%', 'resolution 70%', 'night bloom off, tree shadows off', 'shadow map 1024',
      'tree LOD1 at 600 m', 'agents ×0.5',
    ]);
  });
  it('skips resolution notches below the tier floor', () => {
    expect(governorSteps(TIER_SETTINGS.ultra).some((s) => s.label.startsWith('resolution'))).toBe(false);
    expect(governorSteps(TIER_SETTINGS.high).filter((s) => s.label.startsWith('resolution')).length).toBe(2);
  });
  it('knobs accumulate with the level', () => {
    const s = TIER_SETTINGS.low;
    expect(knobsAtLevel(s, 0)).toMatchObject({ resolutionScale: 1, bloom: true, shadowMapSize: 2048, treeLod1Distance: 900, agentDensity: 1 });
    expect(knobsAtLevel(s, 3).resolutionScale).toBeCloseTo(0.7);
    expect(knobsAtLevel(s, 4)).toMatchObject({ bloom: false, treeShadows: false });
    expect(knobsAtLevel(s, 7)).toMatchObject({ shadowMapSize: 1024, treeLod1Distance: 600, agentDensity: 0.5 });
  });
  it('a user-pinned resolution scale survives the resolution notches', () => {
    const k = knobsAtLevel(TIER_SETTINGS.low, 7, { resolutionScale: 0.85 });
    expect(k.resolutionScale).toBeCloseTo(0.85);
    expect(k.shadowMapSize).toBe(1024);
  });
  it('honours user shadow / density settings', () => {
    const k = knobsAtLevel(TIER_SETTINGS.medium, 0, { shadows: false, agentDensity: 0.4 });
    expect(k.shadows).toBe(false);
    expect(k.agentDensity).toBeCloseTo(0.4);
  });
});

/** Drive a governor with a constant frame time; returns the level changes as [timeMs, level]. */
function run(g: FrameGovernor, fromMs: number, toMs: number, frameMs: number, log: Array<[number, number]>): number {
  let t = fromMs;
  for (; t < toMs; t += frameMs) if (g.tick(t, frameMs)) log.push([t, g.level]);
  return t;
}

describe('FrameGovernor', () => {
  it('steps down after ~3 s above 18 ms, then waits out the 10 s cooldown', () => {
    const log: Array<[number, number]> = [];
    const g = new FrameGovernor(7, () => undefined);
    g.reset(0);                                    // 2 s settle
    run(g, 0, 20_000, 25, log);
    expect(log[0][1]).toBe(1);
    expect(log[0][0]).toBeGreaterThan(5000);       // settle 2 s + EMA rise + 3 s hold
    expect(log[0][0]).toBeLessThan(5400);
    expect(log[1][0] - log[0][0]).toBeGreaterThanOrEqual(10_000);   // cooldown
    expect(log[1][1]).toBe(2);
  });

  it('never moves on a steady 60 Hz display at level 0', () => {
    const log: Array<[number, number]> = [];
    const g = new FrameGovernor(7, () => undefined);
    g.reset(0);
    run(g, 0, 60_000, 1000 / 60, log);
    expect(log).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('steps up after 5 s below 12 ms (high-refresh display)', () => {
    const log: Array<[number, number]> = [];
    const g = new FrameGovernor(7, () => undefined);
    g.setLevel(3);
    g.reset(0);
    run(g, 0, 9000, 1000 / 120, log);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0][1]).toBe(2);
    expect(log[0][0]).toBeGreaterThan(7000);       // 2 s settle + EMA fall + 5 s hold
  });

  it('probes up on a vsync-bound display and backs off when the probe fails', () => {
    const log: Array<[number, number]> = [];
    const g = new FrameGovernor(7, () => undefined);
    g.setLevel(2);
    g.reset(0);
    // Steady 16.7 ms: a probe up comes after the settle + 8 s steady period.
    let t = run(g, 0, 10_500, 1000 / 60, log);
    expect(log).toEqual([[expect.any(Number), 1]]);
    const probeAt = log[0][0];
    expect(probeAt).toBeGreaterThan(9900);
    // The probe makes frames slow (33 ms): it is reverted within the 4 s window, without waiting for a cooldown.
    t = run(g, t, t + 4000, 1000 / 30, log);
    expect(log[1][1]).toBe(2);
    expect(log[1][0] - probeAt).toBeLessThan(4000);
    // Back to 16.7 ms: the next probe waits twice as long (16 s steady) after the 10 s cooldown.
    const before = log.length;
    run(g, t, t + 15_000, 1000 / 60, log);
    expect(log.length).toBe(before);
  });

  it('ignores samples during the settle period and resets after a long stall', () => {
    const log: Array<[number, number]> = [];
    const g = new FrameGovernor(7, () => undefined);
    g.reset(0);
    run(g, 0, 1900, 50, log);                      // terrible frames, but settling
    expect(g.ema).toBeCloseTo(16.7);
    run(g, 1900, 4000, 50, log);
    g.tick(9000, 5000);                            // tab was hidden for 5 s → reset, settle again
    expect(g.ema).toBeCloseTo(16.7);
    expect(log).toEqual([]);
  });
});
