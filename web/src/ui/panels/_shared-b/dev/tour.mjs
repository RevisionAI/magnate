#!/usr/bin/env node
// U3 panel tour: plays a real game in Chrome and screenshots every U3 screen
// (Reports, Finance, R&D, Marketing, Rivals, News, Advisor, Goals).
//
//   cd web && npx vite build
//   node src/ui/panels/_shared-b/dev/tour.mjs [--size 1920x1080] [--state healthy|lost] [--months 24]
//        [--scenario id --autopilot simple|adaptive|… --seed 42] [--only reports] [--mock-finance] [--probe]
//
// healthy: tech_race, seed 42, the player on the simple autopilot for --months
//          months (a populated, solvent mid-game company).
// lost:    four_archetype_melee on the adaptive autopilot, which runs out of cash
//          and is declared bankrupt by the engine (outcome modal, goals debrief).
// --mock-finance answers the E2 loan methods in the page (see installFinanceMock)
// and adds e2-* shots of the Bank / Overview / Balance sheet, incl. distress.
// --probe prints cash per month and stops (to pick scenarios).
//
// Writes PNGs to web/test-results/u3/<state>/<W>x<H>/ and errors.txt beside them.
// Exit 1 on a page error or a failed step. Not part of the app bundle or the tests.
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const state = arg('state', 'healthy');
const months = Number(arg('months', '24'));
const only = arg('only', null);
// healthy: tech_race on the simple autopilot stays solvent; lost: the adaptive autopilot goes bankrupt in the melee (~13 months).
const scenario = arg('scenario', state === 'healthy' ? 'tech_race' : 'four_archetype_melee');
const autopilot = arg('autopilot', state === 'healthy' ? 'simple' : 'adaptive');
const seed = Number(arg('seed', '42'));
const probe = process.argv.includes('--probe');
const mockFinance = process.argv.includes('--mock-finance');
const outDir = join(webRoot, 'test-results', 'u3', state, `${width}x${height}`);
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const port = 4800 + Math.floor(Math.random() * 400);
const server = await preview({ root: webRoot, logLevel: 'error', preview: { port } });
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e}`));
page.on('dialog', (d) => void d.accept().catch(() => {}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;

/**
 * --mock-finance: answers the E2 loan methods (creditProfile, loanOffers, loans,
 * takeLoan, repayLoan) in the page, with the E2 contract's shapes, so the Bank
 * screens can be reviewed before the E2 engine is merged into this build. Every
 * other call goes to the real engine. `window.__u3Distress = true` switches the
 * profile to distress.
 */
function installFinanceMock() {
  const state = { loans: [], nextId: 1 };
  const hud = () => window.__magnate?.game.getState().hud ?? null;
  const spread = (t) => (t <= 12 ? 0.0075 : t <= 36 ? 0.01 : t <= 60 ? 0.0125 : t <= 120 ? 0.015 : 0.0175);
  const rateFor = (t) => Math.round((0.04 + 0.0111 + spread(t)) * 10000) / 10000;
  const pay = (p, r, n) => {
    const m = r / 12;
    return Math.round(((p * m) / (1 - Math.pow(1 + m, -n))) * 100) / 100;
  };
  const owed = () => state.loans.reduce((s, l) => s + l.outstanding, 0);
  const profile = () => {
    const p = hud()?.player;
    const equity = p?.equity ?? 30e6;
    const distress = window.__u3Distress === true;
    const limit = Math.max(0, Math.round((equity * 0.35) / 100000) * 100000);
    const revolverDrawn = distress ? 1_850_000 : 0;
    const out = owed() + revolverDrawn;
    return {
      rating: distress ? 'CCC' : 'BBB',
      creditLimit: limit,
      outstanding: out,
      interestRate: out > 0 ? 0.0636 : 0.0661,
      debtToEquity: equity > 0 ? out / equity : undefined,
      interestCoverage: out > 0 ? (distress ? 0.8 : 6.4) : undefined,
      nextReview: { year: (p ? hud().date.year : 2027), month: 12 },
      pricingRating: distress ? 'CCC' : 'BBB',
      seasoned: true,
      termDebt: owed(),
      revolverDrawn,
      revolverLimit: Math.round(limit * 0.25),
      revolverRate: 0.0711,
      newLoanMax: distress ? 0 : Math.max(0, limit - out),
      minTermMonths: 12,
      maxTermMonths: 240,
      policyRate: 0.04,
      ebitdaTtm: 4_380_000,
      nextPayment: state.loans.reduce((s, l) => s + l.monthlyPayment, 0),
      solvency: distress ? 'distress' : 'solvent',
      taxRate: 0.25,
      lossCarryForward: distress ? 2_400_000 : 0,
      taxPaidYtd: distress ? 0 : 612_400,
      bookEquity: equity,
      companyValue: p?.corporateValue ?? equity,
      netDebtToEbitda: (out - (p?.cash ?? 0)) / 4_380_000,
      lastReview: { year: hud()?.date.year ?? 2027, month: 9 },
      ...(distress ? { cureMonthsLeft: 2 } : {}),
    };
  };
  const offers = (amount) => {
    const max = profile().newLoanMax;
    const a = Math.min(amount ?? max, max);
    if (a <= 0) return [];
    return [12, 36, 60, 120, 240].map((t) => {
      const r = rateFor(t);
      const m = pay(a, r, t);
      return { offerId: `${t}m-${Math.round(a * 100)}`, amount: a, termMonths: t, annualRate: r, monthlyPayment: m, rating: 'BBB', totalInterest: Math.round((m * t - a) * 100) / 100 };
    });
  };
  const handlers = {
    creditProfile: () => profile(),
    loanOffers: (args) => offers(args.amount),
    loans: () => state.loans,
    takeLoan: (args) => {
      const [term, cents] = String(args.offerId ?? '').split(/m-/);
      const t = Number(term) || args.termMonths || 60;
      const a = Number(cents) / 100 || args.amount || 1_000_000;
      const r = rateFor(t);
      const loan = { loanId: state.nextId++, principal: a, outstanding: a, annualRate: r, termMonths: t, monthsRemaining: t, monthlyPayment: pay(a, r, t), taken: hud()?.date ?? { year: 2027, month: 1 }, inDefault: false, missedPayments: 0 };
      state.loans.push(loan);
      return loan;
    },
    repayLoan: (args) => {
      const loan = state.loans.find((l) => l.loanId === args.loanId);
      loan.outstanding = Math.max(0, loan.outstanding - args.amount);
      return loan;
    },
  };
  window.__u3SeedLoans = () => {
    handlers.takeLoan({ offerId: '60m-250000000' });
    const l = handlers.takeLoan({ offerId: '120m-600000000' });
    l.monthsRemaining = 104;
    l.outstanding = 5_310_000;
    l.taken = { year: 2026, month: 9 };
  };
  // The E2 balance sheet: real engine numbers plus depreciation, land, construction in progress and the mock loans.
  const augmentBalanceSheet = (r) => {
    const dep = Math.round(r.buildingValue * 0.08);
    r.grossPpe = r.buildingValue;
    r.accumulatedDepreciation = dep;
    r.buildingValue -= dep;
    r.engineBuildingValue = r.buildingValue;
    r.cash -= 2_100_000;
    r.landValue = 1_200_000;
    r.cip = 900_000;
    r.totalAssets -= dep;
    r.equity -= dep;
    r.retainedEarnings -= dep;
    const debt = owed();
    r.cash += debt;
    r.totalAssets += debt;
    r.liabilities += debt;
    r.termLoans = debt;
    r.revolver = 0;
    r.liabilityLines = state.loans.map((l) => ({ kind: 'loan', label: `Term loan #${l.loanId} · ${(l.annualRate * 100).toFixed(2)}% · ${l.monthsRemaining} months left`, amount: l.outstanding }));
    for (const b of r.buildings ?? []) b.bookValue = Math.round(b.bookValue * 0.92);
    return r;
  };
  const Real = window.Worker;
  window.Worker = class extends Real {
    set onmessage(fn) {
      this.__handler = fn;
      super.onmessage = (event) => {
        const method = this.__methods?.get(event.data?.id);
        if (method === 'balanceSheet' && event.data.ok) {
          const env = JSON.parse(event.data.payload);
          if (env.ok && env.result && !this.__rival?.has(event.data.id)) {
            env.result = augmentBalanceSheet(env.result);
            fn({ data: { ...event.data, payload: JSON.stringify(env) } });
            return;
          }
        }
        fn(event);
      };
    }
    get onmessage() {
      return this.__handler;
    }
    postMessage(msg, ...rest) {
      if (msg && msg.kind === 'call') {
        (this.__methods ??= new Map()).set(msg.id, msg.method);
        if (msg.method === 'balanceSheet' && JSON.parse(msg.argsJson || '{}').companyId !== undefined) (this.__rival ??= new Set()).add(msg.id);
      }
      if (msg && msg.kind === 'call' && handlers[msg.method]) {
        let payload;
        try {
          payload = JSON.stringify({ ok: true, result: handlers[msg.method](JSON.parse(msg.argsJson || '{}')), revision: 0 });
        } catch (e) {
          payload = JSON.stringify({ ok: false, error: { code: 'invalid_argument', message: String(e) }, revision: 0 });
        }
        setTimeout(() => this.onmessage?.({ data: { id: msg.id, ok: true, payload } }), 10);
        return;
      }
      return super.postMessage(msg, ...rest);
    }
  };
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (error) {
    failed = true;
    console.log(`  ✗ ${name}: ${error}`);
    await page.screenshot({ path: join(outDir, `FAILED-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
  }
}

async function closeAll() {
  await page.evaluate(() => {
    const ui = window.__magnate.ui.getState();
    ui.closeModal?.();
    ui.closeOverlay();
    ui.closeDrawer();
  });
  await sleep(250);
}

/** Opens a panel (optionally a tab), waits for its root and for loading skeletons to settle, then shoots. */
async function shot(name, panel, params, testId, after) {
  if (only && !name.startsWith(only)) return;
  await step(name, async () => {
    await closeAll();
    await page.evaluate((id, p) => window.__magnate.ui.getState().openPanel(id, p), panel, params ?? {});
    await page.waitForSelector(`[data-testid="${testId}"]`, { visible: true, timeout: 10000 });
    await sleep(900);
    if (after) await after();
    await page.mouse.move(width / 2, height - 3);
    await sleep(900);
    await page.screenshot({ path: join(outDir, `${name}.png`) });
  });
}

async function clickTestId(id) {
  await page.waitForSelector(`[data-testid="${id}"]`, { visible: true, timeout: 8000 });
  await page.click(`[data-testid="${id}"]`);
  await sleep(500);
}

if (mockFinance) await page.evaluateOnNewDocument(installFinanceMock);

try {
  console.log(`u3 tour (${state}, ${width}×${height}) → ${outDir}`);
  await step('boot', async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="title-screen"]', { timeout: 90000 });
  });

  await step('start game', async () => {
    await page.evaluate(
      (sc, sd, ap) => window.__magnate.game.getState().startNewGame(sc, sd, { ...(ap !== 'none' ? { autopilot: ap } : {}), companyName: 'Magnate Industries' }),
      scenario,
      seed,
      autopilot,
    );
    await page.waitForSelector('[data-testid="hud"]', { timeout: 60000 });
    await page.evaluate(() => window.__magnate.tutorial?.getState().skipAll?.());
  });

  await step(`advance up to ${months} months`, async () => {
    for (let i = 0; i < months; i++) {
      const done = await page.evaluate(async () => {
        const g = window.__magnate.game;
        await g.getState().advanceMonth();
        return g.getState().hud?.outcome?.status ?? 'playing';
      });
      if (probe) {
        const p = await page.evaluate(() => {
          const h = window.__magnate.game.getState().hud;
          return { date: `${h.date.year}-${h.date.month}`, cash: Math.round(h.player?.cash ?? 0), value: Math.round(h.player?.corporateValue ?? 0) };
        });
        console.log(`    ${p.date} cash ${p.cash} value ${p.value}`);
      }
      if (done !== 'playing') {
        console.log(`    outcome after ${i + 1} months: ${done}`);
        break;
      }
    }
    await page.evaluate(() => window.__magnate.game.getState().setSpeed?.(0));
  });

  if (probe) throw new Error('probe done');
  if (state === 'lost') {
    await step('outcome modal', async () => {
      await sleep(1500);
      await page.mouse.move(width / 2, height - 3);
      await page.screenshot({ path: join(outDir, 'outcome-modal.png') });
    });
  }

  await shot('reports-pnl', 'reports', { tab: 'pnl' }, 'reports-tab-pnl');
  await shot('reports-balance', 'reports', { tab: 'balance' }, 'reports-tab-balance');
  await shot('reports-cashflow', 'reports', { tab: 'cashflow' }, 'reports-tab-cashflow');
  await shot('reports-products', 'reports', { tab: 'products' }, 'reports-tab-products');
  await shot('reports-exports', 'reports', { tab: 'exports' }, 'reports-tab-exports');
  await shot('reports-charts', 'reports', { tab: 'charts' }, 'reports-tab-charts');
  await shot('reports-history', 'reports', { tab: 'history' }, 'reports-tab-history');
  await shot('reports-ledger', 'reports', { tab: 'ledger' }, 'reports-tab-ledger');
  await shot('finance-overview', 'finance', { tab: 'overview' }, 'finance-tab-overview');
  await shot('finance-bank', 'finance', { tab: 'bank' }, 'finance-tab-bank');
  await shot('finance-equity', 'finance', { tab: 'equity' }, 'finance-tab-equity');
  await shot('finance-stocks', 'finance', { tab: 'stocks' }, 'finance-tab-stocks');
  await shot('rnd-products', 'rnd', { tab: 'products' }, 'rnd-tab-products');
  await shot('rnd-labs', 'rnd', { tab: 'labs' }, 'rnd-tab-labs');
  await shot('rnd-patents', 'rnd', { tab: 'patents' }, 'rnd-tab-patents');
  await shot('marketing-campaigns', 'marketing', { tab: 'campaigns' }, 'marketing-tab-campaigns');
  await shot('marketing-brand', 'marketing', { tab: 'brand' }, 'marketing-tab-brand');
  await shot('marketing-media', 'marketing', { tab: 'media' }, 'marketing-tab-media');
  await shot('rivals', 'rivals', {}, 'panel-rivals');
  await shot('news-front', 'news', { tab: 'front' }, 'news-tab-front');
  await shot('news-archive', 'news', { tab: 'archive' }, 'news-tab-archive');
  await shot('news-log', 'news', { tab: 'log' }, 'news-tab-log');
  await shot('advisor', 'advisor', {}, 'panel-advisor');
  await shot('goals-goals', 'goals', { tab: 'goals' }, 'goals-tab-goals');
  await shot('goals-briefing', 'goals', { tab: 'briefing' }, 'goals-tab-briefing');
  if (state === 'lost') {
    // The debrief tab exists only once the game is decided. Since the Wave 2 merge the adaptive
    // autopilot no longer goes bankrupt in the melee (finance, land and AI fixes), so the "lost"
    // premise may not hold: report it instead of failing on a missing tab.
    const decided = await page.evaluate(() => window.__magnate.game.getState().snapshot?.outcome?.status ?? 'playing');
    if (decided === 'playing') console.log('  - goals-debrief skipped: the game is still being played (no bankruptcy within the window)');
    else await shot('goals-debrief', 'goals', { tab: 'debrief' }, 'goals-tab-debrief');
  }

  // Interactive states.
  if (state === 'healthy') {
    await shot('finance-bank-amortisation', 'finance', { tab: 'bank' }, 'finance-tab-bank', async () => {
      const offer = await page.$('[data-testid^="loan-offer-"]');
      if (offer) {
        await offer.click();
        await sleep(600);
      }
    });
    await shot('reports-balance-inventory', 'reports', { tab: 'balance' }, 'reports-tab-balance', () => clickTestId('bs-inventory-toggle'));
    await shot('rivals-focus', 'rivals', { companyId: 2 }, 'panel-rivals');
  }
  if (mockFinance) {
    await page.evaluate(() => window.__u3SeedLoans());
    await shot('e2-finance-overview', 'finance', { tab: 'overview' }, 'finance-tab-overview');
    await shot('e2-finance-bank', 'finance', { tab: 'bank' }, 'finance-tab-bank', async () => {
      await page.click('[data-testid="loan-offer-120"]').catch(() => {});
      await sleep(500);
    });
    await shot('e2-finance-bank-confirm', 'finance', { tab: 'bank' }, 'finance-tab-bank', async () => {
      await clickTestId('loan-take');
      await sleep(300);
    });
    await shot('e2-reports-balance', 'reports', { tab: 'balance' }, 'reports-tab-balance');
    await page.evaluate(() => (window.__u3Distress = true));
    await shot('e2-finance-bank-distress', 'finance', { tab: 'bank' }, 'finance-tab-bank');
    await shot('e2-finance-overview-distress', 'finance', { tab: 'overview' }, 'finance-tab-overview');
  }
} finally {
  writeFileSync(join(outDir, 'errors.txt'), errors.join('\n'));
  if (errors.length) console.log(errors.slice(0, 20).join('\n'));
  await browser.close();
  await server.httpServer.close();
  const bad = failed || errors.some((e) => e.startsWith('[pageerror]'));
  console.log(bad ? 'U3 TOUR FAILED' : 'U3 TOUR OK');
  process.exit(bad ? 1 : 0);
}
