// Scenario briefing (UX §6.16): the story, start position, deadline in game
// and real time, rivals in plain words, what wins and what loses, and a
// suggested opening — from the scenario list the shell already loaded.

import { useMemo } from 'react';
import { useGameStore } from '@/state/gameStore';
import { toScenarioCard } from '@/state/scenarios';
import { Badge, SectionTitle } from '@/ui/components';
import { durationMonths, money, monthYear, realTimeEstimate } from '@/util/format';
import { LoadingBlock } from '../_shared-b/components';
import styles from './Goals.module.css';

export function Briefing() {
  const scenarioId = useGameStore((s) => s.hud?.scenario?.id ?? null);
  const scenarios = useGameStore((s) => s.scenarios);
  const catalog = useGameStore((s) => s.catalog);
  const grace = useGameStore((s) => s.hud?.insolvency.graceMonths ?? 6);
  const card = useMemo(() => {
    const dto = scenarios.find((s) => s.id === scenarioId);
    return dto ? toScenarioCard(dto, catalog) : null;
  }, [scenarios, scenarioId, catalog]);
  if (!card) return <LoadingBlock rows={6} />;
  return (
    <div className={styles.wrap} data-testid="briefing">
      <div className={styles.brief}>
        <div className={styles.briefKicker}>
          {card.pillar} · {'★'.repeat(card.difficulty)}
          {'☆'.repeat(5 - card.difficulty)}
        </div>
        <h3 className={styles.briefTitle}>{card.name}</h3>
        <p className={styles.briefText}>{card.briefing ?? card.description}</p>
      </div>
      <dl className={styles.facts}>
        <dt>Start</dt>
        <dd>
          {money(card.startingCash, 0)} cash · {monthYear(card.startDate)}
        </dd>
        <dt>Deadline</dt>
        <dd>
          {card.endDate ? `${monthYear(card.endDate)} · ${durationMonths(card.durationMonths ?? 0)}${card.realSecondsAt1x ? ` · ${realTimeEstimate(card.realSecondsAt1x)} at 1×` : ''}` : 'None — play as long as you like'}
        </dd>
      </dl>
      {card.rivals.length > 0 && (
        <>
          <SectionTitle>Rivals</SectionTitle>
          {card.rivals.map((r) => (
            <div key={r.name} className={styles.rival}>
              <div>
                <b>{r.name}</b> <Badge>{r.label}</Badge> <span className={styles.of}>{money(r.startingCash, 0)}</span>
              </div>
              <div className={styles.desc}>{r.blurb}</div>
            </div>
          ))}
        </>
      )}
      <SectionTitle>To win</SectionTitle>
      <ul className={styles.list}>
        {card.goals.map((g) => (
          <li key={g.id}>
            {g.label} <Badge tone={g.rule === 'holdAtDeadline' ? 'info' : 'neutral'}>{g.rule === 'holdAtDeadline' ? 'hold at deadline' : 'reach once'}</Badge>
          </li>
        ))}
      </ul>
      <SectionTitle>You lose if</SectionTitle>
      <ul className={styles.list}>
        <li>cash is below $0 at {grace} month-ends in a row</li>
        {card.endDate && <li>the deadline passes with a goal still open</li>}
      </ul>
      <SectionTitle>Suggested opening</SectionTitle>
      <p className={styles.desc}>{card.opening}</p>
    </div>
  );
}
