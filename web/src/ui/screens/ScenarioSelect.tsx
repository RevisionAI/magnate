// New Game — scenario browser + briefing (UX §6.2, §6.16). Cards show the
// authored (or estimated) difficulty, deadline, starting cash, rivals and goal
// count; the briefing pane spells out how you win and how you lose, suggests an
// opening, and holds the new-game options (company name, difficulty, seed, and
// the spectator "autopilot" under Advanced). Enter starts, Esc goes back.

import clsx from 'clsx';
import { ArrowLeft, Dices, Play, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '@/state/gameStore';
import { bucketOf, scenarioTitle, sortScenarioCards, toScenarioCard, type AiArchetype, type DifficultyBucket, type Pillar, type ScenarioCard } from '@/state/scenarios';
import { useUiStore } from '@/state/uiStore';
import { ownerColor, ownerEmblem } from '@/theme/tokens';
import { Badge, Button, EmptyState, Emblem, Field, IconButton, Segmented, Select, TextInput, Tooltip } from '@/ui/components';
import { isTypingTarget } from '@/ui/input/keymap';
import { uiSound } from '@/ui/sound';
import { durationMonths, money, monthYear, realTimeEstimate } from '@/util/format';
import { randomSeed } from '@/util/random';
import { ScenarioArt } from './ScenarioArt';
import { SkylineBackdrop } from './SkylineBackdrop';
import styles from './Screens.module.css';

type Kind = 'all' | 'campaign' | 'scenarios' | 'sandbox';
type DifficultyFilter = 'any' | DifficultyBucket;

const PILLAR_TONE: Record<Pillar, 'gold' | 'info' | 'success' | 'warning' | 'danger' | 'opportunity' | 'neutral'> = {
  Tutorial: 'gold',
  Sandbox: 'neutral',
  Retail: 'warning',
  Brand: 'danger',
  Integration: 'success',
  Technology: 'info',
  Exports: 'opportunity',
  Growth: 'gold',
};

const AUTOPILOTS: { value: AiArchetype | 'off'; label: string; description?: string }[] = [
  { value: 'off', label: 'Off — I run the company' },
  { value: 'adaptive', label: 'Adaptive', description: 'Prices against rivals and advertises' },
  { value: 'simple', label: 'Discount retailer', description: 'Opens stores where demand is biggest' },
  { value: 'verticalIntegrator', label: 'Vertical integrator', description: 'Builds its own supply chain' },
  { value: 'techLeader', label: 'Tech leader', description: 'Researches a premium product' },
];

export function Stars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className={styles.stars} role="img" aria-label={`Difficulty ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} fill={i <= value ? 'currentColor' : 'none'} className={i <= value ? undefined : styles.starOff} />
      ))}
    </span>
  );
}

function matchesKind(card: ScenarioCard, kind: Kind): boolean {
  switch (kind) {
    case 'campaign':
      return card.isTutorial;
    case 'sandbox':
      return card.isSandbox;
    case 'scenarios':
      return !card.isTutorial && !card.isSandbox;
    default:
      return true;
  }
}

function deadlineText(card: ScenarioCard): string {
  return card.durationMonths !== null ? `${card.durationMonths} mo` : 'No deadline';
}

function ScenarioCardView({ card, selected, onSelect, onStart }: { card: ScenarioCard; selected: boolean; onSelect: () => void; onStart: () => void }) {
  const rivals = card.rivals.length === 0 ? 'No rivals' : `vs ${card.rivals.map((r) => r.name).join(', ')}`;
  return (
    <button
      type="button"
      className={clsx(styles.card, selected && styles.cardSelected)}
      aria-pressed={selected}
      onClick={() => {
        if (!selected) uiSound('click');
        onSelect();
      }}
      onDoubleClick={onStart}
      onPointerEnter={() => uiSound('hover')}
      data-testid={`scenario-${card.id}`}
    >
      <span className={styles.cardArt}>
        <ScenarioArt id={card.id} pillar={card.pillar} />
        <span className={styles.cardPillar}>
          <Badge tone={PILLAR_TONE[card.pillar]} variant="solid">
            {card.pillar}
          </Badge>
        </span>
        <span className={styles.cardStars}>
          <Stars value={card.difficulty} />
        </span>
      </span>
      <span className={styles.cardBody}>
        <span className={styles.cardName}>{scenarioTitle(card)}</span>
        <span className={styles.cardMeta}>
          <span>{deadlineText(card)}</span>
          <span>start {money(card.startingCash, 1)}</span>
          <span>
            {card.goals.length} goal{card.goals.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className={styles.cardMeta}>{rivals}</span>
        <span className={styles.cardDesc}>{card.description}</span>
      </span>
    </button>
  );
}

interface Options {
  companyName: string;
  seedText: string;
  difficulty: DifficultyBucket;
  autopilot: AiArchetype | 'off';
}

function Briefing({ card, options, setOptions, onStart, starting, error, difficultySupported, graceMonths }: {
  card: ScenarioCard;
  options: Options;
  setOptions: (patch: Partial<Options>) => void;
  onStart: () => void;
  starting: boolean;
  error: string | null;
  difficultySupported: boolean;
  graceMonths: number;
}) {
  const [advanced, setAdvanced] = useState(false);
  const seedValid = options.seedText.trim() === '' || /^\d{1,10}$/.test(options.seedText.trim());
  return (
    <aside className={styles.briefing} aria-label={`Briefing: ${card.name}`} data-testid="briefing">
      <div className={styles.briefingArt}>
        <ScenarioArt id={card.id} pillar={card.pillar} />
        <div className={styles.briefingHead}>
          <div className={styles.briefingKicker}>
            <Badge tone={PILLAR_TONE[card.pillar]} variant="solid">
              {card.pillar}
            </Badge>
            <Stars value={card.difficulty} size={13} />
            <span>{card.bucket === 'easy' ? 'Easy' : card.bucket === 'normal' ? 'Normal' : 'Hard'}</span>
          </div>
          <div className={styles.briefingName}>{scenarioTitle(card)}</div>
        </div>
      </div>
      <div className={styles.briefingScroll}>
        <p className={styles.briefingDesc}>{card.description || card.briefing}</p>
        <div className={styles.facts}>
          <span className={styles.factLabel}>Start</span>
          <span className={styles.factValue}>
            {money(card.startingCash)} cash · {monthYear(card.startDate)}
            <small>You run {card.playerName || 'your company'}.</small>
          </span>

          <span className={styles.factLabel}>Deadline</span>
          <span className={styles.factValue}>
            {card.endDate && card.durationMonths !== null ? (
              <>
                {monthYear(card.endDate)} · {durationMonths(card.durationMonths)}
                <small>{card.realSecondsAt1x !== null ? `${realTimeEstimate(card.realSecondsAt1x)} at 1× without pauses` : ''}</small>
              </>
            ) : (
              <>
                None
                <small>Play as long as you like.</small>
              </>
            )}
          </span>

          <span className={styles.factLabel}>Rivals</span>
          <span className={styles.factValue}>
            {card.rivals.length === 0 ? (
              <>
                None
                <small>An open market — local shops still compete for customers.</small>
              </>
            ) : (
              card.rivals.map((r, i) => (
                <span key={r.name} className={styles.rival}>
                  <Emblem shape={ownerEmblem(i + 1)} color={ownerColor(i + 1)} size={18} />
                  <span>
                    <b>{r.name}</b> · {r.label} · {money(r.startingCash, 1)}
                    <small>{r.blurb}</small>
                  </span>
                </span>
              ))
            )}
          </span>

          <span className={styles.factLabel}>To win</span>
          <span className={styles.factValue}>
            {card.goals.length === 0 ? (
              <>
                No victory conditions
                <small>Free play: build whatever you like.</small>
              </>
            ) : (
              card.goals.map((g) => (
                <span key={g.id} className={styles.goalItem}>
                  <span>{g.label}</span>
                  <Tooltip
                    title={g.rule === 'holdAtDeadline' ? 'Hold at deadline' : 'Reach once'}
                    content={g.rule === 'holdAtDeadline' ? 'Must still be true when the deadline arrives.' : 'Counts as soon as it is reached, even if it slips later.'}
                  >
                    <Badge tone={g.rule === 'holdAtDeadline' ? 'warning' : 'success'}>{g.rule === 'holdAtDeadline' ? 'Hold' : 'Reach once'}</Badge>
                  </Tooltip>
                </span>
              ))
            )}
          </span>

          <span className={styles.factLabel}>You lose</span>
          <span className={styles.factValue}>
            Cash below $0 at {graceMonths} consecutive month-ends
            {card.endDate ? ' · or the deadline passes with goals unmet' : ''}
          </span>

          <span className={styles.factLabel}>Opening</span>
          <span className={styles.factValue}>{card.opening}</span>
        </div>

        <div className={styles.options}>
          <div className={styles.optionsTitle}>Your company</div>
          <Field label="Company name" htmlFor="ng-company">
            <TextInput
              id="ng-company"
              size="sm"
              value={options.companyName}
              placeholder={card.playerName || 'Your company'}
              maxLength={40}
              onChange={(e) => setOptions({ companyName: e.target.value })}
              data-testid="company-name"
            />
          </Field>
          <Field
            label="Difficulty"
            description={
              difficultySupported
                ? 'Strength of the local shops you compete with (0.6× · 1.0× · 1.4×).'
                : 'Local competitor strength arrives with the realistic market model; the scenario’s rating applies.'
            }
          >
            <Segmented
              size="sm"
              value={difficultySupported ? options.difficulty : card.bucket}
              onChange={(difficulty) => setOptions({ difficulty })}
              label="Difficulty"
              options={[
                { value: 'easy', label: 'Easy', disabled: !difficultySupported },
                { value: 'normal', label: 'Normal', disabled: !difficultySupported },
                { value: 'hard', label: 'Hard', disabled: !difficultySupported },
              ]}
            />
          </Field>
          <Field label="World seed" description="Leave empty for a fresh world; share a seed to replay the same one.">
            <div className={styles.seedRow}>
              <TextInput
                size="sm"
                inputMode="numeric"
                value={options.seedText}
                placeholder="Random"
                aria-invalid={!seedValid}
                onChange={(e) => setOptions({ seedText: e.target.value.replace(/[^\d]/g, '').slice(0, 10) })}
                aria-label="World seed"
                data-testid="seed"
              />
              <IconButton size="sm" variant="secondary" label="Roll a seed" icon={<Dices size={15} />} onClick={() => setOptions({ seedText: String(randomSeed()) })} />
            </div>
          </Field>
          <button type="button" className={styles.advancedToggle} aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
            {advanced ? 'Hide advanced options' : 'Advanced options'}
          </button>
          {advanced && (
            <Field label="Autopilot (watch mode)" description="An AI strategy runs your company while you watch.">
              <Select
                size="sm"
                value={options.autopilot}
                options={AUTOPILOTS}
                onChange={(autopilot) => setOptions({ autopilot })}
                aria-label="Autopilot strategy"
              />
            </Field>
          )}
        </div>
      </div>
      <div className={styles.briefingFooter}>
        {error ? <span className={styles.error}>{error}</span> : <span className={styles.footHint}>Enter starts · double-click a card</span>}
        <Button variant="primary" size="lg" icon={<Play size={16} fill="currentColor" />} loading={starting} disabled={!seedValid} onClick={onStart} sound="confirm" data-testid="start-game">
          Start
        </Button>
      </div>
    </aside>
  );
}

export function ScenarioSelect() {
  const scenarios = useGameStore((s) => s.scenarios);
  const catalog = useGameStore((s) => s.catalog);
  const init = useGameStore((s) => s.init);
  const startNewGame = useGameStore((s) => s.startNewGame);
  const goTo = useGameStore((s) => s.goTo);
  const lastError = useGameStore((s) => s.lastError);
  const phase = useGameStore((s) => s.phase);
  const [kind, setKind] = useState<Kind>('all');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('any');
  const [pillar, setPillar] = useState<Pillar | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [options, setOptionsState] = useState<Options>({ companyName: '', seedText: '', difficulty: 'normal', autopilot: 'off' });
  const setOptions = (patch: Partial<Options>) => setOptionsState((o) => ({ ...o, ...patch }));

  const cards = useMemo(() => sortScenarioCards(scenarios.map((s) => toScenarioCard(s, catalog))), [scenarios, catalog]);
  const pillars = useMemo(() => [...new Set(cards.map((c) => c.pillar))], [cards]);
  const visible = cards.filter((c) => matchesKind(c, kind) && (difficulty === 'any' || c.bucket === difficulty) && (pillar === 'all' || c.pillar === pillar));
  const selected = cards.find((c) => c.id === selectedId) ?? visible[0] ?? cards[0] ?? null;
  const features = (init as { features?: { demandModel?: boolean } } | null)?.features;
  const difficultySupported = features?.demandModel === true;
  const graceMonths = (catalog as { constants?: { bankruptcyGraceMonths?: number } } | null)?.constants?.bankruptcyGraceMonths ?? 6;
  const starting = phase === 'starting';

  // The scenario's own rating is the default difficulty.
  const selectedDifficulty = selected?.difficulty ?? 3;
  useEffect(() => {
    setOptionsState((o) => ({ ...o, difficulty: bucketOf(selectedDifficulty) }));
  }, [selected?.id, selectedDifficulty]);

  const start = (card: ScenarioCard | null = selected) => {
    if (!card || starting) return;
    const seed = options.seedText.trim() ? Number(options.seedText.trim()) : undefined;
    void startNewGame(card.id, seed && seed > 0 ? seed : undefined, {
      companyName: options.companyName.trim() || undefined,
      difficulty: difficultySupported ? options.difficulty : undefined,
      autopilot: options.autopilot === 'off' ? null : options.autopilot,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useUiStore.getState().modals.length > 0) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        uiSound('close');
        goTo('title');
      } else if (e.key === 'Enter' && !isTypingTarget(e.target) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`${styles.screen} ${styles.newGame}`} data-testid="scenario-select">
      <div className={styles.newGameBackdrop}>
        <SkylineBackdrop animated={false} />
      </div>
      <div className={styles.newGameShade} />
      <header className={styles.newGameHeader}>
        <Button variant="ghost" icon={<ArrowLeft size={16} />} kbd="Escape" onClick={() => goTo('title')} sound="close" data-testid="back-to-title">
          Back
        </Button>
        <h1 className={styles.newGameTitle}>New Game</h1>
      </header>
      <div className={styles.filters}>
        <Segmented
          value={kind}
          onChange={setKind}
          label="Game type"
          options={[
            { value: 'all', label: 'All' },
            { value: 'campaign', label: 'Tutorial' },
            { value: 'scenarios', label: 'Scenarios' },
            { value: 'sandbox', label: 'Sandbox' },
          ]}
        />
        <Segmented
          value={difficulty}
          onChange={setDifficulty}
          label="Difficulty"
          options={[
            { value: 'any', label: 'Any difficulty' },
            { value: 'easy', label: 'Easy' },
            { value: 'normal', label: 'Normal' },
            { value: 'hard', label: 'Hard' },
          ]}
        />
        <Select
          value={pillar}
          onChange={setPillar}
          aria-label="Focus"
          options={[{ value: 'all' as const, label: 'Every focus' }, ...pillars.map((p) => ({ value: p, label: p }))]}
        />
        <span className={styles.count}>
          {visible.length} of {cards.length}
        </span>
      </div>
      <div className={styles.newGameBody}>
        <div className={styles.cards} aria-label="Scenarios">
          {visible.length === 0 ? (
            <EmptyState title="Nothing matches these filters" body="Try another difficulty or focus." action={<Button size="sm" onClick={() => { setKind('all'); setDifficulty('any'); setPillar('all'); }}>Clear filters</Button>} />
          ) : (
            visible.map((card) => (
              <ScenarioCardView
                key={card.id}
                card={card}
                selected={selected?.id === card.id}
                onSelect={() => setSelectedId(card.id)}
                onStart={() => {
                  setSelectedId(card.id);
                  start(card);
                }}
              />
            ))
          )}
        </div>
        {selected ? (
          <Briefing
            card={selected}
            options={options}
            setOptions={setOptions}
            onStart={() => start()}
            starting={starting}
            error={lastError}
            difficultySupported={difficultySupported}
            graceMonths={graceMonths}
          />
        ) : (
          <EmptyState title="No scenarios" body="The engine did not report any scenarios." />
        )}
      </div>
    </div>
  );
}
