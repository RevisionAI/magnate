import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_RECIPES, CLASS_TARGETS, PEAK_LIMITED, RECIPE_TRIM_DB, SFX, sfxIdsByClass } from './catalog';
import { PROC_RECIPES, TABLE_RECIPE_IDS } from '../synth/recipes';
import { BEDS, LOOPS } from '../synth/beds';
import { BED_IDS } from '../ambience/ambienceModel';
import { constructLoopFor, emitterSpec } from '../world/emitterModel';
import { parseManifest } from '../assets/manifest';

/** The 38 PROCEDURAL ids of audio-plan §6.2 (#1–20, 22–25, 28, 29, 33–36, 42, 44, 45, 47, 48, 60, 61, 65). */
const PLAN_PROCEDURAL = [
  'ui_hover', 'ui_click', 'panel_open', 'panel_close', 'tab_switch', 'toggle_on', 'toggle_off', 'slider_tick', 'confirm',
  'error', 'speed_up', 'speed_down', 'pause', 'select_retail', 'select_industrial', 'select_agri', 'select_knowledge',
  'place_ok', 'place_invalid', 'price_tag', 'notify_opportunity', 'notify_warning', 'alert_critical', 'heartbeat_soft',
  'month_close_up', 'month_close_down', 'ticker_up', 'ticker_down', 'rating_up', 'rating_down', 'rival_alert', 'overtake',
  'milestone_small', 'stockout', 'tech_up', 'truck_reverse', 'forklift_beep', 'door_chime',
];
/** The 23 GENERATE one-shots + KEEP files of §6.2 that every routed cue relies on. */
const PLAN_OTHER = [
  'newspaper', 'news_sting', 'cash_register', 'coins_small', 'coins_large', 'stamp', 'loan_approved', 'ipo_bell', 'quarter_close',
  'tax_paid', 'price_war', 'brand_up', 'crane_winch', 'ribbon_cut', 'demolish', 'defeat_sting', 'car_horn', 'factory_hiss',
  'ship_horn', 'siren_distant', 'thunder', 'notify_info', 'build_construct', 'upgrade', 'goal_achieved', 'campaign_start', 'victory_fanfare',
];

const manifest = parseManifest(JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/audio/manifest.json', import.meta.url)), 'utf8')));

describe('procedural kit coverage (audio-plan §6.2)', () => {
  it('implements all 38 PROCEDURAL recipes of the table', () => {
    expect(PLAN_PROCEDURAL).toHaveLength(38);
    expect([...TABLE_RECIPE_IDS].sort()).toEqual([...PLAN_PROCEDURAL].sort());
  });

  it('declares a class, a length and a detune policy per the table (musical cues never detune)', () => {
    for (const [id, r] of Object.entries(PROC_RECIPES)) {
      expect(CLASS_TARGETS[r.cls], id).toBeDefined();
      expect(r.dur, id).toBeGreaterThan(0);
    }
    for (const musical of ['confirm', 'notify_opportunity', 'month_close_up', 'ticker_up', 'rating_up', 'overtake', 'milestone_small', 'door_chime'])
      expect(PROC_RECIPES[musical]?.detune, musical).toBe(0);
    expect(PROC_RECIPES.ui_click?.detune).toBe(30);
    expect(PROC_RECIPES.place_ok?.detune).toBe(50);
    expect(PROC_RECIPES.month_close_up?.cents?.({ streak: 1 })).toBe(0);
    expect(PROC_RECIPES.month_close_up?.cents?.({ streak: 4 })).toBe(300);
    expect(PROC_RECIPES.month_close_up?.cents?.({ streak: 99 })).toBe(500); // +100 c × min(5, streak − 1)
  });

  it('can play every §6.2 id today: a mastered file or a procedural stand-in', () => {
    for (const id of [...PLAN_PROCEDURAL, ...PLAN_OTHER]) {
      const spec = SFX[id];
      expect(spec, id).toBeDefined();
      expect((spec?.recipes.length ?? 0) > 0 || manifest.has(id), `${id} is silent`).toBe(true);
    }
    // the three broken legacy files are replaced by procedural sounds with the same ids
    for (const id of ['ui_click', 'notify_warning', 'defeat_sting']) expect(ALL_RECIPES[id], id).toBeDefined();
  });

  it('has a calibrated trim for every recipe, and only transients may be peak-bound', () => {
    for (const id of Object.keys(ALL_RECIPES)) {
      expect(RECIPE_TRIM_DB[id], `${id} has no calibration`).toBeTypeOf('number');
      expect(Math.abs(RECIPE_TRIM_DB[id] as number), id).toBeLessThan(30);
    }
    for (const id of PEAK_LIMITED) expect(ALL_RECIPES[id]?.dur, `${id} is peak-bound but not a transient`).toBeLessThan(0.4);
  });

  it('routes UI classes to the never-ducked UI bus and applies the §4.10 cooldowns and polyphony', () => {
    expect(SFX.ui_click).toMatchObject({ ui: true, cooldownMs: 30, maxVoices: 2 });
    expect(SFX.ui_hover?.cooldownMs).toBe(50);
    expect(SFX.slider_tick?.cooldownMs).toBe(35);
    expect(SFX.alert_critical).toMatchObject({ ui: false, cooldownMs: 3000 });
    expect(SFX.notify_warning?.cooldownMs).toBe(1500);
    expect(SFX.cash_register).toMatchObject({ cooldownMs: 250, mode: 'mix' });
    expect(SFX.coins_small?.cooldownMs).toBe(200);
    expect(SFX['stinger.triumph']?.maxVoices).toBe(1);
    expect(SFX.car_horn?.maxVoices).toBe(2);
    const byClass = sfxIdsByClass();
    expect(byClass.ui_micro).toContain('ui_click');
    expect(byClass.alert).toContain('alert_critical');
  });
});

describe('procedural beds and positional loops (audio-plan §6.3)', () => {
  it('has a bed for every ambience id at −26 LUFS and a loop for every emitter at −24 LUFS', () => {
    expect(Object.keys(BEDS).sort()).toEqual([...BED_IDS].sort());
    for (const b of Object.values(BEDS)) expect(b.lufs).toBe(-26);
    const needed = new Set<string>(['truck_engine_loop', constructLoopFor(0), constructLoopFor(1), constructLoopFor(2)]);
    for (const category of ['factory', 'mine', 'oil_well', 'farm', 'warehouse', 'seaport', 'supermarket', 'rd_center', 'media', 'tv_station'])
      needed.add(emitterSpec({ id: 1, category, x: 0, z: 0, footprintW: 1, footprintH: 1 })?.loop ?? '');
    for (const id of needed) {
      expect(LOOPS[id], id).toBeDefined();
      expect(LOOPS[id]?.lufs, id).toBe(-24);
      expect(LOOPS[id]?.channels, `${id} must be mono for the panner`).toBe(1);
    }
  });
});
