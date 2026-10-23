// A3 voice routing: the VO line registry against the mastered manifest, every line reachable from the
// routing table, and the event → line rules added for the full voice-over batch (templated first-
// building and milestone lines, onboarding moments, tutorial steps, chains with partial cooldowns).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AudioEventRouter, buildingGroup, milestoneSuffix, rulesFor, routingKeys, type AudioAction, type RouterContext } from './AudioEventRouter';
import { parseManifest } from '../assets/manifest';
import { canonicalLineId, resolveVoiceLine, VO_LINES, voLineDef } from '../voice/voiceLines';
import table from '../data/audio-events.json';
import newsMap from '../data/news-map.json';

const manifestJson = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/audio/manifest.json', import.meta.url)), 'utf8'));
const manifest = parseManifest(manifestJson);
const voSource = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../assets-src/vo/manifest.json', import.meta.url)), 'utf8')) as {
  lines: { id: string; role: string; text: string; file: string | null; legacyAlias?: string; aliases?: string[] }[];
  legacyMap: Record<string, string>;
  aliasMap: Record<string, string>;
};

function makeRouter(ctx: Partial<RouterContext> = {}, speed = 1) {
  const clock = { t: 1_000_000, month: 0, speed };
  const categories: Record<string, string> = {
    supermarket: 'supermarket',
    convenience_store: 'convenience_store',
    factory_small: 'factory',
    small_farm: 'farm',
    oil_well: 'oil_well',
    rd_center: 'rd_center',
  };
  const router = new AudioEventRouter({
    now: () => clock.t,
    gameMonth: () => clock.month,
    speed: () => clock.speed,
    context: () => ctx,
    buildingCategory: (typeId) => categories[typeId],
  });
  return { router, clock, ctx };
}
const vo = (a: AudioAction[]) => a.filter((x) => x.type === 'vo').map((x) => (x as { lines: string[] }).lines);
const sfx = (a: AudioAction[]) => a.filter((x) => x.type === 'sfx').map((x) => (x as { id: string }).id);
const music = (a: AudioAction[]) => a.filter((x) => x.type === 'music').map((x) => (x as { op: string }).op);

describe('VO registry ↔ mastered manifest', () => {
  it('has one registry line per script line, with the same subtitle text and role', () => {
    expect(VO_LINES.map((l) => l.id).sort()).toEqual(voSource.lines.map((l) => l.id).sort());
    for (const src of voSource.lines) {
      const def = voLineDef(src.id)!;
      expect(def.text, src.id).toBe(src.text);
      expect(def.voice, src.id).toBe(src.role);
      expect(!!def.held, src.id).toBe(src.file === null);
    }
  });

  it('resolves every voiced line to its mastered take; held lines stay subtitle-only', () => {
    for (const def of VO_LINES) {
      const line = resolveVoiceLine(def.id, manifest)!;
      if (def.held) {
        expect(line.take, def.id).toBeUndefined();
        expect(manifestJson.vo.held.map((h: { line: string }) => h.line)).toContain(def.id);
      } else {
        expect(line.take, def.id).toBe(`vo.${def.id}`);
        expect(line.text, def.id).toBe(def.text);
        expect(line.durationSec ?? 0, def.id).toBeGreaterThan(1);
      }
    }
    expect(manifestJson.vo.lines).toBe(106);
  });

  it('resolves legacy Godot names and superseded UX ids to the new lines', () => {
    expect(canonicalLineId('vo_welcome')).toBe('adv.onboard.welcome');
    expect(canonicalLineId('vo_first_sale')).toBe('adv.sales.first');
    expect(canonicalLineId('vo_tutorial_step3')).toBe('adv.legacy.tutorial_step3');
    expect(canonicalLineId('vo.adv.cash.negative')).toBe('adv.cash.negative');
    expect(canonicalLineId('nope')).toBeUndefined();
    for (const [legacy, file] of Object.entries(voSource.legacyMap)) {
      expect(canonicalLineId(legacy), legacy).toBe(file.replace(/^.*\//, '').replace(/\.wav$/, ''));
      expect(manifestJson.vo.legacyMap[legacy]).toBe(`vo.${canonicalLineId(legacy)}`);
    }
    for (const [alias, id] of Object.entries(voSource.aliasMap)) expect(canonicalLineId(alias), alias).toBe(id);
  });

  it('reaches every routable line from an event rule, the tutorial map, the news map or the hint rule', () => {
    const referenced = new Set<string>(['news.intro']); // prefixed by the router
    const expand = (t: string): string[] => {
      const m = /\$\{(\w+)\}/.exec(t);
      if (!m) return [t];
      const values: Record<string, string[]> = {
        group: ['retail', 'factory', 'farm', 'mine_well', 'warehouse', 'rd', 'media', 'seaport'],
        milestone: ['1m', '10m', '100m', '1b'],
        pct: ['10', '25', '50', '75'],
      };
      return (values[m[1] as string] ?? []).flatMap((v) => expand(t.replace(m[0], v)));
    };
    for (const key of routingKeys())
      for (const rule of rulesFor(key)) {
        const v = rule.vo as string | { line: string | string[]; chain?: string[] } | undefined;
        if (!v) continue;
        const names = typeof v === 'string' ? [v] : [...(v.chain ?? []), ...(Array.isArray(v.line) ? v.line : [v.line])];
        for (const n of names.flatMap(expand)) {
          const id = canonicalLineId(n);
          if (id) referenced.add(id);
        }
      }
    for (const [k, n] of Object.entries((table as { tutorial: Record<string, string> }).tutorial)) if (!k.startsWith('$')) referenced.add(canonicalLineId(n)!);
    for (const e of Object.values((newsMap as { events: Record<string, { line: string | null }> }).events)) if (e.line) referenced.add(e.line);
    for (const l of VO_LINES) if (l.id.startsWith('adv.hint.')) referenced.add(l.id); // playerIdle → $hint
    const unreachable = VO_LINES.filter((l) => !l.legacyOnly && !referenced.has(l.id)).map((l) => l.id);
    expect(unreachable).toEqual([]);
  });
});

describe('event → line rules (A3)', () => {
  it('first building of a group speaks its templated line once, then the generic build line', () => {
    const { router, clock } = makeRouter({ runway: null });
    const build = (typeId: string, id: number) => vo(router.route('buildingConstructed', { isPlayer: true, typeId, buildingId: id }));
    expect(build('supermarket', 1)).toEqual([['vo_building_first_retail']]);
    expect(build('convenience_store', 2)).toEqual([['adv.build.started']]); // same group: generic line
    clock.month = 1;
    expect(build('small_farm', 3)).toEqual([['vo_building_first_farm']]);
    expect(build('oil_well', 4)).toEqual([['vo_building_first_mine_well']]);
    expect(build('rd_center', 5)).toEqual([['vo_building_first_rd']]);
    expect(build('factory_small', 6)).toEqual([['adv.build.factory_complete']]); // vo_building_first_factory is its alias
    expect(build('supermarket', 7)).toEqual([['adv.build.started']]); // 2nd free play of the generic line
    expect(build('supermarket', 8)).toEqual([]); // then ≤ 1 per 12 game-months
    expect(sfx(router.route('buildingConstructed', { isPlayer: false, typeId: 'supermarket' }))).toEqual(['notify_info']);
  });

  it('a build that leaves less than 4 months of runway gets the cautious line', () => {
    const { router } = makeRouter({ runway: 2.5 });
    expect(vo(router.route('buildingConstructed', { isPlayer: true, typeId: 'supermarket', buildingId: 1 }))).toEqual([['vo_building_first_retail']]);
    expect(vo(router.route('buildingConstructed', { isPlayer: true, typeId: 'supermarket', buildingId: 2 }))).toEqual([['adv.build.started_tight']]);
  });

  it('construction started never says "the factory is finished"', () => {
    const { router } = makeRouter();
    expect(vo(router.route('constructionStarted', { isPlayer: true, typeId: 'factory_small', buildingId: 1 }))).toEqual([['adv.build.started']]);
    expect(vo(router.route('constructionCompleted', { isPlayer: true, typeId: 'factory_small', buildingId: 1 }))).toEqual([['adv.build.factory_complete']]);
    expect(vo(router.route('constructionCompleted', { isPlayer: true, typeId: 'factory_small', buildingId: 2 }))).toEqual([['adv.build.complete']]);
  });

  it('revenue milestones, brand milestones, goals, upgrades, below-cost and missed payments', () => {
    const { router } = makeRouter();
    expect(vo(router.route('revenueMilestone', { threshold: 1_000_000 }))).toEqual([['vo_milestone_1m']]);
    expect(vo(router.route('revenueMilestone', { threshold: 10_000_000 }))).toEqual([['vo_milestone_10m']]);
    expect(vo(router.route('revenueMilestone', { threshold: 1_000_000_000 }))).toEqual([['vo_milestone_1b']]);
    expect(vo(router.route('brandMilestone', { threshold: 30 }))).toEqual([['vo_brand_milestone']]);
    expect(vo(router.route('brandMilestone', { threshold: 50 }))).toEqual([]);
    expect(sfx(router.route('brandMilestone', { threshold: 50 }))).toEqual(['brand_up']);
    expect(vo(router.route('brandMilestone', { threshold: 70 }))).toEqual([['vo_brand_household']]);
    expect(vo(router.route('goalAchieved', { goalId: 'g1' }))).toEqual([['vo_goal_generic']]);
    expect(vo(router.route('goalAchieved', { goalId: 'g2' }))).toEqual([['vo_goal_generic']]);
    expect(vo(router.route('buildingUpgraded', { isPlayer: true, buildingId: 1 }))).toEqual([['vo_upgrade_first']]);
    expect(vo(router.route('buildingUpgraded', { isPlayer: true, buildingId: 2 }))).toEqual([]);
    expect(vo(router.route('belowCostPrice', { buildingId: 1 }))).toEqual([['vo_below_cost']]);
    expect(vo(router.route('loanPaymentMissed', {}))).toEqual([['vo_loan_missed']]);
  });

  it('cash negative and the bankruptcy warning in one close: the bankruptcy line ranks first', () => {
    const { router } = makeRouter();
    const rank = (kind: string, payload: Record<string, unknown>) =>
      router.route(kind, payload).filter((x) => x.type === 'vo').map((x) => (x as { rank: number }).rank)[0];
    const negative = rank('cashNegative', {});
    const warning = rank('bankruptcyWarning', { months: 2 });
    expect(warning).toBeLessThan(negative);
  });

  it('tech level up: the product maximum gets its own line once', () => {
    const { router, clock } = makeRouter();
    expect(vo(router.route('techLevelUp', { isPlayer: true, level: 2, maxLevel: 10 }))).toEqual([['adv.rnd.breakthrough']]);
    clock.month = 5;
    expect(vo(router.route('techLevelUp', { isPlayer: true, level: 10, maxLevel: 10 }))).toEqual([['vo_tech_max']]);
    clock.month = 10;
    expect(vo(router.route('techLevelUp', { isPlayer: true, level: 10, maxLevel: 10 }))).toEqual([['adv.rnd.breakthrough']]);
  });

  it('onboarding moments from panels (Build with no building, inspector on the first store, Reports after a close)', () => {
    const { router, ctx } = makeRouter({ buildings: 0, monthsElapsed: 0 });
    const panel = (drawer: string | null, overlay: string | null = null) => router.route('bus.panelChanged', { drawer, overlay });
    const first = panel('build');
    expect(vo(first)).toEqual([['adv.onboard.first_plot']]);
    expect(first.find((a) => a.type === 'vo')).toMatchObject({ tutorial: true });
    expect(vo(panel('build'))).toEqual([]); // once per game
    expect(vo(panel(null, 'reports'))).toEqual([]); // no month closed yet
    ctx.buildings = 1;
    expect(vo(panel('inspector'))).toEqual([['adv.onboard.set_price']]);
    ctx.monthsElapsed = 1;
    const books = panel(null, 'reports');
    expect(vo(books)).toEqual([['adv.onboard.read_books']]);
    expect(books.find((a) => a.type === 'vo')).toMatchObject({ tutorial: undefined }); // P2 outside the tutorial scenario
    expect(sfx(panel('markets'))).toEqual([]); // panel sounds come from audio.ui
    expect(vo(router.route('client.pausedAfterBuild', {}))).toEqual([['adv.onboard.press_play']]);
  });

  it('onboarding P2 lines count as tutorial lines in the tutorial scenario only', () => {
    const { router } = makeRouter({ buildings: 1, monthsElapsed: 2, tutorialScenario: true });
    expect(router.route('bus.panelChanged', { drawer: null, overlay: 'reports' }).find((a) => a.type === 'vo')).toMatchObject({ tutorial: true });
    expect(router.route('campaignStarted', {}).find((a) => a.type === 'vo')).toMatchObject({ lines: ['adv.onboard.first_ad'], tutorial: true });
  });

  it('deadline lines at 12 and 3 months left', () => {
    const { router } = makeRouter();
    expect(vo(router.route('client.deadline', { months: 12 }))).toEqual([['vo_deadline_12']]);
    const three = router.route('client.deadline', { months: 3 });
    expect(vo(three)).toEqual([['vo_deadline_3']]);
    expect(music(three)).toEqual(['warning']);
    expect(router.route('client.deadline', { months: 6 })).toEqual([]);
  });

  it('a menu holding time makes no transport sound', () => {
    const { router } = makeRouter();
    router.route('bus.speedChanged', { speed: 2 });
    const held = router.route('bus.speedChanged', { speed: 0, held: true });
    expect(sfx(held)).toEqual([]);
    expect(music(held)).toEqual(['tone']);
    expect(sfx(router.route('bus.speedChanged', { speed: 2, held: true }))).toEqual([]);
    expect(sfx(router.route('bus.speedChanged', { speed: 0 }))).toEqual(['pause']);
  });

  it('UI cues: the shell’s extended cues sound; unknown cues are no-ops', () => {
    const { router } = makeRouter();
    const cue = (c: string) => sfx(router.route('bus.ui', { cue: c }));
    expect(cue('tab')).toEqual(['tab_switch']);
    expect(cue('toggleOn')).toEqual(['toggle_on']);
    expect(cue('toggleOff')).toEqual(['toggle_off']);
    expect(cue('placeInvalid')).toEqual(['place_invalid']);
    expect(cue('somethingNew')).toEqual([]);
  });

  it('tutorial steps map to lines; a step’s own vo (any old name) wins', () => {
    const { router } = makeRouter();
    expect(router.tutorialLine('build')).toBe('adv.onboard.first_plot');
    expect(router.tutorialLine('read-store')).toBe('vo_t1_readstore');
    expect(router.tutorialLine('anything', 'vo_t1_price')).toBe('adv.onboard.set_price');
    expect(router.tutorialLine('unknown-step')).toBeNull();
    const a = router.routeTutorial('flyover');
    expect(a).toEqual([{ type: 'vo', lines: ['vo_t1_city'], rank: 0, fromClose: false, tutorial: true }]);
    for (const [step, line] of Object.entries((table as { tutorial: Record<string, string> }).tutorial))
      if (!step.startsWith('$')) expect(canonicalLineId(line), step).toBeDefined();
  });

  it('helpers: building groups and milestone suffixes', () => {
    expect(buildingGroup('department_store')).toBe('retail');
    expect(buildingGroup('plantation')).toBe('farm');
    expect(buildingGroup('mine')).toBe('mine_well');
    expect(buildingGroup('media')).toBe('media');
    expect(buildingGroup(undefined, 'seaport')).toBe('seaport');
    expect(buildingGroup(undefined, 'rd_center')).toBe('rd');
    expect(buildingGroup('bank')).toBe('other');
    expect(milestoneSuffix(1e6)).toBe('1m');
    expect(milestoneSuffix(1e8)).toBe('100m');
    expect(milestoneSuffix(1e9)).toBe('1b');
    expect(milestoneSuffix(undefined)).toBeNull();
  });

  it('explains its decisions (trace notes)', () => {
    const { router } = makeRouter();
    router.route('goalAchieved', {});
    expect(router.lastNotes[0]).toMatch(/^rule #0/);
    router.route('nonsenseKind', {});
    expect(router.lastNotes).toEqual(['no rules for this key']);
  });
});
