import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AudioEventRouter,
  newsLine,
  newsTier,
  routingKeys,
  rulesFor,
  selectionGroup,
  type AudioAction,
  type RoutedEvent,
  type RouterContext,
} from './AudioEventRouter';
import { ALL_RECIPES, SFX } from '../sfx/catalog';
import { parseManifest } from '../assets/manifest';
import { voLineDef } from '../voice/voiceLines';
import { MUSIC_STATES } from '../music/musicRules';
import table from '../data/audio-events.json';
import newsMap from '../data/news-map.json';

/** bridge-spec §7.1 GameEventKind (routing keys use the same names: MASTER-PLAN §4.9). */
const BRIDGE_KINDS = [
  'monthClosed', 'firstSale', 'recordMonth', 'buildingSales', 'exportSales', 'netIncomeFlip', 'lossStreak',
  'cashLow', 'lowRunway', 'cashNegative', 'bankruptcyWarning', 'goalAchieved', 'goalLost', 'scenarioWon', 'scenarioLost',
  'news', 'priceEffectEnded', 'buildingConstructed', 'buildingUpgraded', 'slotConfigured', 'slotCleared', 'priceChanged',
  'techLevelUp', 'patentGranted', 'patentExpired', 'patentBlocked', 'licenseGranted', 'licenseRevoked',
  'revenueMilestone', 'rivalEnteredMarket', 'rivalUndercut', 'shareRankFirst', 'shareMilestone',
  'campaignStarted', 'campaignChanged', 'campaignCancelled', 'brandMilestone', 'brandFading', 'belowCostPrice', 'autosaved',
  'stockout', 'overstock', 'inputShortage',
  'constructionStarted', 'constructionCompleted', 'buildingDemolished', 'landPurchased',
  'loanTaken', 'loanPaymentMissed', 'creditRatingChanged', 'dividendPaid', 'ipoCompleted', 'takeoverBid', 'macroShift',
  'insolvency',
];
/** game/events.ts bus topics the router handles directly (tick/gameEvent carry bridge kinds). */
const BUS_KEYS = ['bus.gameStarted', 'bus.speedChanged', 'bus.buildingPlaced', 'bus.buildingSelected', 'bus.ui', 'bus.panelChanged'];
const KNOWN_IF_KEYS = new Set([
  'isPlayer', 'severity', 'newsTier', 'anchor', 'reason', 'sign', 'dir', 'monthsLte', 'monthsEq', 'thresholdIn', 'speed', 'category', 'cue', 'fast',
  'held', 'atMax', 'group', 'drawer', 'overlay', 'buildingsEq', 'buildingsGte', 'monthsGte', 'runwayLt',
]);
/** Values the line templates can take (router: ${group}, ${milestone}, ${pct}). */
const TEMPLATE_VALUES: Record<string, string[]> = {
  group: ['retail', 'factory', 'farm', 'mine_well', 'warehouse', 'rd', 'media', 'seaport', 'other'],
  milestone: ['1m', '10m', '100m', '1b'],
  pct: ['10', '25', '50', '75'],
};
function expandTemplate(t: string): string[] {
  const m = /\$\{(\w+)\}/.exec(t);
  if (!m) return [t];
  return (TEMPLATE_VALUES[m[1] as string] ?? []).flatMap((v) => expandTemplate(t.replace(m[0], v)));
}

const manifest = parseManifest(JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/audio/manifest.json', import.meta.url)), 'utf8')));

function makeRouter(opts: { speed?: number; month?: number; ctx?: Partial<RouterContext> } = {}) {
  const clock = { t: 1_000_000, month: opts.month ?? 0, speed: opts.speed ?? 1 };
  const ctx: Partial<RouterContext> = { ...(opts.ctx ?? {}) };
  const categories: Record<string, string> = { supermarket: 'supermarket', factory_small: 'factory', small_farm: 'farm', oil_well: 'oil_well' };
  const router = new AudioEventRouter({
    now: () => clock.t,
    gameMonth: () => clock.month,
    speed: () => clock.speed,
    context: () => ctx,
    buildingCategory: (typeId) => categories[typeId],
  });
  return { router, clock, ctx };
}
const sfx = (a: AudioAction[]) => a.filter((x) => x.type === 'sfx').map((x) => (x as { id: string }).id);
const vo = (a: AudioAction[]) => a.filter((x) => x.type === 'vo').map((x) => (x as { lines: string[] }).lines);
const music = (a: AudioAction[]) => a.filter((x) => x.type === 'music').map((x) => ({ ...x, type: undefined }));

describe('routing table coverage (data/audio-events.json)', () => {
  it('has a rule for every bridge-spec §7.1 event kind and every bus topic', () => {
    const keys = new Set(routingKeys());
    expect(BRIDGE_KINDS.filter((k) => !keys.has(k))).toEqual([]);
    expect(BUS_KEYS.filter((k) => !keys.has(k))).toEqual([]);
  });

  it('only uses known condition keys (an unknown key would never match)', () => {
    for (const key of routingKeys())
      for (const rule of rulesFor(key)) for (const k of Object.keys(rule.if ?? {})) expect(KNOWN_IF_KEYS.has(k), `${key}: if.${k}`).toBe(true);
  });

  it('references only playable SFX, existing VO lines, stingers and music states', () => {
    const events = (table as unknown as { events: Record<string, Record<string, unknown>[]> }).events;
    for (const [key, rules] of Object.entries(events)) {
      for (const rule of rules) {
        const refs = rule.sfx === undefined ? [] : Array.isArray(rule.sfx) ? rule.sfx : [rule.sfx];
        for (const r of refs) {
          const id = typeof r === 'string' ? r : (r as { id: string }).id;
          const spec = SFX[id];
          expect(spec, `${key}: sfx ${id}`).toBeDefined();
          const playable = (spec?.recipes.length ?? 0) > 0 || manifest.has(id);
          expect(playable, `${key}: sfx ${id} has neither a recipe nor a mastered file`).toBe(true);
        }
        const v = rule.vo as string | { line: string | string[]; chain?: string[] } | undefined;
        if (v) {
          const lines = typeof v === 'string' ? [v] : (v.chain ?? (Array.isArray(v.line) ? v.line : [v.line]));
          for (const l of lines) {
            if (l === 'news.$news' || l === '$hint') continue;
            const expanded = expandTemplate(l);
            // a template must name at least one real line; a plain id must be a line
            expect(expanded.some((x) => voLineDef(x)), `${key}: vo ${l}`).toBe(true);
          }
        }
        const m = rule.music as Record<string, unknown> | undefined;
        if (m?.stinger) expect(ALL_RECIPES[m.stinger as string], `${key}: stinger ${String(m.stinger)}`).toBeDefined();
        if (m?.state) expect(MUSIC_STATES).toContain(m.state);
        if (rule.alias) expect(routingKeys()).toContain(rule.alias);
      }
    }
  });

  it('maps every content news event (content/data/events/seed.json) to its anchor treatment', () => {
    const seed = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../content/data/events/seed.json', import.meta.url)), 'utf8')) as {
      id: string;
      severity: string;
      effects: { type: string; multiplier?: number }[];
    }[];
    const map = (newsMap as unknown as { events: Record<string, { severity: string; line: string | null }> }).events;
    for (const ev of seed) {
      const entry = map[ev.id];
      expect(entry, ev.id).toBeDefined();
      expect(entry?.severity).toBe(ev.severity.toLowerCase());
      const fx = ev.effects[0];
      const want =
        ev.severity === 'Info' || fx?.type === 'brand_shift'
          ? null
          : fx?.type === 'price_multiplier'
            ? (fx.multiplier ?? 1) > 1
              ? 'news.commodity_spike'
              : 'news.commodity_drop'
            : ev.id === 'tech_breakthrough'
              ? 'news.tech_breakthrough'
              : null;
      expect(entry?.line, ev.id).toBe(want);
    }
  });
});

describe('month close', () => {
  it('rises a semitone per consecutive profitable month (streak param) and resets on a loss', () => {
    const { router } = makeRouter();
    const close = (amount: number) => router.route('monthClosed', { kind: 'monthClosed', amount }, { fromClose: true });
    expect(sfx(close(10))).toEqual(['month_close_up']);
    const a2 = close(10);
    expect((a2[0] as { params?: { streak?: number } }).params?.streak).toBe(2);
    expect(sfx(close(-5))).toEqual(['month_close_down']);
    expect(router.profitStreak).toBe(0);
    expect(music(close(0))).toEqual([{ op: 'evaluate', type: undefined }]);
  });

  it('sounds only every other close at 8×', () => {
    const { router } = makeRouter({ speed: 8 });
    const sounded = Array.from({ length: 6 }, () => sfx(router.route('monthClosed', { amount: 1 }))).filter((s) => s.length).length;
    expect(sounded).toBe(3);
  });
});

describe('client bus topics', () => {
  it('speed changes: pause, resume, faster, slower', () => {
    const { router } = makeRouter();
    const speed = (s: number) => router.route('bus.speedChanged', { speed: s });
    expect(sfx(speed(1))).toEqual(['speed_up']); // from 0: resumed
    expect(sfx(speed(4))).toEqual(['speed_up']);
    expect(sfx(speed(2))).toEqual(['speed_down']);
    const paused = speed(0);
    expect(sfx(paused)).toEqual(['pause']);
    expect(music(paused)).toEqual([{ op: 'tone', value: 'paused', type: undefined }]);
    expect(music(speed(2))).toEqual([{ op: 'tone', value: 'normal', type: undefined }]);
  });

  it('building selection sounds by category', () => {
    const { router } = makeRouter();
    const sel = (category: string) => sfx(router.route('bus.buildingSelected', { buildingId: 1, category }));
    expect(sel('supermarket')).toEqual(['select_retail']);
    expect(sel('factory')).toEqual(['select_industrial']);
    expect(sel('seaport')).toEqual(['select_industrial']);
    expect(sel('plantation')).toEqual(['select_agri']);
    expect(sel('rd_center')).toEqual(['select_knowledge']);
    expect(sel('media')).toEqual(['select_knowledge']);
    expect(sel('headquarters')).toEqual(['ui_click']);
    expect(selectionGroup(undefined)).toBe('any');
  });

  it('ui cues from the bus', () => {
    const { router } = makeRouter();
    expect(sfx(router.route('bus.ui', { cue: 'open' }))).toEqual(['panel_open']);
    expect(sfx(router.route('bus.ui', { cue: 'error' }))).toEqual(['error']);
  });

  it('placement plays the construction sound at the site and feeds music intensity; the engine echo is deduped', () => {
    const { router, clock } = makeRouter();
    const placed = router.route('bus.buildingPlaced', { buildingId: 7, typeId: 'supermarket', cityId: 'metropolis' });
    expect(placed[0]).toMatchObject({ type: 'sfx', id: 'build_construct', atBuilding: 7 });
    expect(music(placed)).toEqual([{ op: 'intensity', value: 'build', type: undefined }]);
    expect(sfx(router.route('buildingConstructed', { buildingId: 7, isPlayer: true }))).toEqual([]);
    clock.t += 5000;
    expect(sfx(router.route('buildingConstructed', { buildingId: 8, isPlayer: true }))).toEqual(['build_construct']);
    expect(sfx(router.route('buildingConstructed', { buildingId: 9, isPlayer: false }))).toEqual(['notify_info']);
  });
});

describe('economy, alerts and outcomes', () => {
  it('first sale once per game: register + coins, advisor line', () => {
    const { router } = makeRouter();
    const first = router.route('firstSale', { buildingId: 3, amount: 120 }, { fromClose: true });
    expect(sfx(first)).toEqual(['cash_register', 'coins_small']);
    expect(first.find((a) => a.type === 'sfx' && a.id === 'coins_small')).toMatchObject({ delay: 0.25 });
    expect(vo(first)).toEqual([['adv.sales.first']]);
    expect(first.find((a) => a.type === 'vo')).toMatchObject({ fromClose: true, rank: 2 });
    expect(router.route('firstSale', { buildingId: 4 })).toEqual([]); // once per game, whichever store
    router.resetGame();
    expect(sfx(router.route('firstSale', { buildingId: 3 }))).toEqual(['cash_register', 'coins_small']);
  });

  it('cash crises escalate the music and raise P0 lines', () => {
    const { router } = makeRouter();
    const neg = router.route('cashNegative', { amount: -1 });
    expect(sfx(neg)).toEqual(['alert_critical']);
    expect(vo(neg)).toEqual([['adv.cash.negative']]);
    expect(music(neg)).toEqual([{ op: 'tension', type: undefined }]);
    expect(sfx(router.route('lowRunway', { months: 2 }))).toEqual(['heartbeat_soft']);
    expect(vo(router.route('bankruptcyWarning', { months: 1 }))).toEqual([['adv.bankruptcy.final']]);
    expect(vo(router.route('bankruptcyWarning', { months: 3 }))).toEqual([['adv.bankruptcy.warning']]);
    const far = router.route('bankruptcyWarning', { months: 5 });
    expect(sfx(far)).toEqual(['notify_warning']);
    expect(vo(far)).toEqual([]);
  });

  it('E2 insolvency: default warns, cured recovers, the player bankruptcy is left to scenarioLost', () => {
    const { router } = makeRouter();
    const opened = router.route('insolvency', { isPlayer: true, reason: 'default' });
    expect(sfx(opened)).toEqual(['alert_critical']);
    expect(vo(opened)).toEqual([['adv.bankruptcy.warning']]);
    expect(vo(router.route('insolvency', { isPlayer: true, reason: 'cured' }))).toEqual([['adv.cash.recovered']]);
    expect(router.route('insolvency', { isPlayer: true, reason: 'bankrupt' })).toEqual([]);
    expect(sfx(router.route('insolvency', { isPlayer: false, reason: 'bankrupt' }))).toEqual(['news_sting']);
    expect(router.route('insolvency', { isPlayer: false, reason: 'default' })).toEqual([]);
  });

  it('victory and defeat hand over to the music director and queue the ending line', () => {
    const { router } = makeRouter();
    const won = router.route('scenarioWon', {});
    expect(music(won)).toEqual([{ op: 'state', value: 'victory', type: undefined }]);
    expect(won.find((a) => a.type === 'vo')).toMatchObject({ lines: ['adv.end.victory'], scenarioEnd: true, delay: 1.6, rank: 0 });
    expect(vo(router.route('scenarioLost', { reason: 'bankruptcy' }))).toEqual([['adv.end.defeat_bankrupt']]);
    expect(vo(router.route('scenarioLost', { reason: 'deadline' }))).toEqual([['adv.end.defeat_timeup']]);
    expect(music(router.route('scenarioLost', { reason: 'deadline' }))).toEqual([{ op: 'state', value: 'defeat', type: undefined }]);
  });

  it('goals and records add a triumph stinger', () => {
    const { router } = makeRouter();
    expect(music(router.route('goalAchieved', { goalId: 'g1' }))).toEqual([{ op: 'stinger', value: 'stinger.triumph', type: undefined }]);
    expect(sfx(router.route('recordMonth', { amount: 2e6 }))).toEqual(['coins_large']);
  });

  it('credit ratings and share prices by direction', () => {
    const { router } = makeRouter();
    expect(sfx(router.route('creditRatingChanged', { oldValue: 5, newValue: 6 }))).toEqual(['rating_up']);
    const down = router.route('creditRatingChanged', { oldValue: 6, newValue: 4 });
    expect(sfx(down)).toEqual(['rating_down']);
    expect(music(down)).toEqual([{ op: 'warning', type: undefined }]);
    expect(sfx(router.route('sharePriceMove', { amount: -0.25 }))).toEqual(['ticker_down']);
  });

  it('share milestones pick the matching line (fractions or percent)', () => {
    const { router } = makeRouter();
    expect(vo(router.route('shareMilestone', { threshold: 0.25 }))).toEqual([['adv.market.share_25']]);
    expect(vo(router.route('shareMilestone', { threshold: 50 }))).toEqual([['adv.market.share_50']]);
    expect(sfx(router.route('shareMilestone', { threshold: 0.75 }))).toEqual(['milestone_small']);
  });

  it('rival-only variants of player events stay quiet or warn', () => {
    const { router } = makeRouter();
    expect(router.route('techLevelUp', { isPlayer: false })).toEqual([]);
    expect(sfx(router.route('patentGranted', { isPlayer: false }))).toEqual(['notify_warning']);
    expect(sfx(router.route('patentGranted', { isPlayer: true }))).toEqual(['stamp', 'confirm']);
  });

  it('enforces game-month VO cooldowns from the line registry (first N free) but keeps the SFX', () => {
    const { router, clock } = makeRouter();
    const lines = () => vo(router.route('constructionStarted', { isPlayer: true, buildingId: clock.month + 100 }));
    expect(lines()).toEqual([['adv.build.started']]); // "first 2 per game, then ≤ 1 per 12 game-months"
    clock.month = 1;
    expect(lines()).toEqual([['adv.build.started']]);
    clock.month = 6;
    clock.t += 10_000;
    expect(lines()).toEqual([]);
    expect(sfx(router.route('constructionStarted', { isPlayer: true, buildingId: 999 }))).toEqual(['build_construct']);
    expect(router.lastNotes.some((n) => n.includes('cooldown 12'))).toBe(true);
    clock.month = 13;
    expect(lines()).toEqual([['adv.build.started']]);
  });

  it('"first 3, then every 5th": construction completed', () => {
    const { router, clock } = makeRouter();
    const spoke: number[] = [];
    for (let i = 1; i <= 13; i++) {
      clock.month = i * 20; // no cooldown on this line: only the counting rule applies
      if (vo(router.route('constructionCompleted', { isPlayer: true, buildingId: i })).length) spoke.push(i);
    }
    expect(spoke).toEqual([1, 2, 3, 5, 10]);
  });
});

describe('news and the anchor', () => {
  const headline = (id: string) => (newsMap as unknown as { events: Record<string, { headline: string }> }).events[id]?.headline;

  it('reads the content severity the bridge puts in `reason` for headlines it does not know', () => {
    expect(newsTier({ severity: 'info', reason: 'notable', message: 'Some new headline' })).toBe('notable');
    expect(newsTier({ severity: 'warning', reason: 'major', message: 'Some new headline' })).toBe('major');
    expect(newsTier({ severity: 'info', reason: 'info', message: 'Some new headline' })).toBe('info');
  });

  it('takes the tier from the content event (the bridge folds Notable into info)', () => {
    expect(newsTier({ severity: 'info', message: headline('cocoa_blight') })).toBe('notable');
    expect(newsTier({ severity: 'warning', message: 'Unknown headline' })).toBe('major');
    expect(newsTier({ severity: 'info', message: 'Unknown headline' })).toBe('info');
    expect(newsLine({ typeId: 'oil_glut' })).toBe('news.commodity_drop');
  });

  it('Major news: newspaper slap; the first anchor line of a session is prefixed by news.intro; ≤ 1 per 90 s', () => {
    const { router, clock } = makeRouter();
    const major = router.route('news', { severity: 'warning', message: headline('oil_glut') });
    expect(sfx(major)).toEqual(['newspaper']);
    expect(vo(major)).toEqual([['news.intro', 'news.commodity_drop', 'vo_news_major']]); // anchor → advisor "Big news…"
    expect(major.find((a) => a.type === 'vo')).toMatchObject({ priority: 1 }); // Major commodity news is P1
    clock.t += 30_000;
    const again = router.route('news', { severity: 'warning', message: headline('tariff_announcement') });
    expect(sfx(again)).toEqual(['newspaper']);
    expect(vo(again)).toEqual([]); // anchor gap
    clock.t += 90_000;
    // vo_news_major is in its 12 game-month cooldown: left out of the chain, the anchor still reads
    expect(vo(router.route('news', { severity: 'warning', message: headline('tariff_announcement') }))).toEqual([['news.commodity_spike']]);
  });

  it('Notable news with an anchor line gets the sting; brand shifts and Info headlines only notify', () => {
    const { router, clock } = makeRouter();
    const notable = router.route('news', { severity: 'info', message: headline('wheat_drought') });
    expect(sfx(notable)).toEqual(['news_sting']);
    expect(vo(notable)).toEqual([['news.commodity_spike']]);
    clock.t += 100_000;
    const brand = router.route('news', { severity: 'info', message: headline('soft_drink_health_scare') });
    expect(sfx(brand)).toEqual(['notify_info']);
    expect(vo(brand)).toEqual([]);
    expect(sfx(router.route('news', { severity: 'info', message: headline('trade_summit_optimism') }))).toEqual(['notify_info']);
  });

  it('at 4×/8× only Major news is voiced', () => {
    const { router } = makeRouter({ speed: 4 });
    const notable = router.route('news', { message: headline('cocoa_blight') });
    expect(sfx(notable)).toEqual(['news_sting']);
    expect(vo(notable)).toEqual([]);
  });

  it('macro shifts chain the anchor into the advisor and set the climate (climateChanged is an alias)', () => {
    const { router, clock } = makeRouter();
    const rec = router.route('macroShift', { reason: 'recession' });
    expect(sfx(rec)).toEqual(['newspaper']);
    expect(vo(rec)).toEqual([['news.recession', 'adv.macro.recession']]);
    expect(music(rec)).toEqual([{ op: 'climate', value: 'recession', type: undefined }]);
    clock.t += 100_000;
    const boom = router.route('climateChanged', { reason: 'boom' });
    expect(music(boom)).toEqual([
      { op: 'climate', value: 'boom', type: undefined },
      { op: 'stinger', value: 'stinger.boom', type: undefined },
    ]);
  });
});

/** Every RoutedEvent the bridge can send survives the router without throwing. */
describe('robustness', () => {
  it('routes every kind with an empty payload', () => {
    const { router } = makeRouter();
    for (const key of [...BRIDGE_KINDS, ...BUS_KEYS]) expect(() => router.route(key, {} as RoutedEvent)).not.toThrow();
    expect(router.route('noSuchKind', {})).toEqual([]);
  });
});
