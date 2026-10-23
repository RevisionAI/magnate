// Win / lose debrief frame (UX §6.16, L4). Shows the result, months taken,
// final value, rank, the goals and the value/cash history; the full debrief
// (charts vs rivals, achievements, "what would have helped") is U3's in Wave 2.
//
// Victory: [Continue in sandbox] [Main menu]. Defeat: [Load autosave] [Retry] [Main menu].

import { Check, Crown, FolderOpen, Home, Minus, RotateCcw, Skull, Trophy } from 'lucide-react';
import { useGameStore } from '@/state/gameStore';
import { useSavesStore } from '@/state/savesStore';
import { useUiStore } from '@/state/uiStore';
import { Button, LineChart, Modal, SectionTitle, Stat } from '@/ui/components';
import { money, monthName, monthYear } from '@/util/format';
import styles from './Modals.module.css';

const REASONS: Record<string, string> = {
  allGoals: 'Every goal met.',
  bankruptcy: 'Cash stayed below zero for too many month-ends.',
  deadline: 'The deadline passed before every goal was met.',
};

export function OutcomeModal({ status, reason, onClose }: { status: 'won' | 'lost'; reason?: string | null; onClose: () => void }) {
  const hud = useGameStore((s) => s.hud);
  const history = useGameStore((s) => s.history);
  const startNewGame = useGameStore((s) => s.startNewGame);
  const quitToTitle = useGameStore((s) => s.quitToTitle);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const scenarioId = useGameStore((s) => s.hud?.scenario?.id);
  const slots = useSavesStore((s) => s.slots);
  const openModal = useUiStore((s) => s.openModal);
  const won = status === 'won';

  const companies = hud?.companies ?? [];
  const rank = hud?.player ? [...companies].sort((a, b) => b.value - a.value).findIndex((c) => c.isPlayer) + 1 : 0;
  const months = history.length > 0 ? history[history.length - 1]!.monthIndex - history[0]!.monthIndex : (hud?.elapsedMonths ?? 0);
  const latestAuto = slots.filter((s) => s.slotKind === 'autosave' && s.gameId === useGameStore.getState().gameId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const labels = history.map((r) => `${monthName(r.date.month)} ${String(r.date.year).slice(2)}`);

  return (
    <Modal
      open
      size="xl"
      flush
      dismissible={false}
      title={won ? 'Victory' : 'Defeat'}
      icon={won ? <Trophy size={18} /> : <Skull size={18} />}
      tone={won ? 'default' : 'danger'}
      data-testid="outcome-modal"
      footerStart={
        <Button variant="ghost" icon={<Home size={15} />} onClick={quitToTitle} data-testid="outcome-menu">
          Main menu
        </Button>
      }
      footer={
        won ? (
          <Button variant="primary" onClick={onClose} data-autofocus data-testid="outcome-continue">
            Continue in sandbox
          </Button>
        ) : (
          <>
            {latestAuto && (
              <Button icon={<FolderOpen size={15} />} onClick={() => void loadSlot(latestAuto.slotId)}>
                Load autosave ({monthYear(latestAuto.date)})
              </Button>
            )}
            {!latestAuto && (
              <Button icon={<FolderOpen size={15} />} onClick={() => openModal('saveLoad', { tab: 'load' })}>
                Load a save
              </Button>
            )}
            <Button variant="primary" icon={<RotateCcw size={15} />} onClick={() => scenarioId && void startNewGame(scenarioId)} disabled={!scenarioId} data-autofocus>
              Retry scenario
            </Button>
          </>
        )
      }
    >
      <div className={won ? undefined : styles.lost}>
        <div className={styles.outcomeHero}>
          <div className={styles.outcomeKicker}>{hud?.scenario?.name ?? 'Free play'}</div>
          <div className={styles.outcomeTitle}>{won ? 'You built an empire' : 'The company has fallen'}</div>
          <div className={styles.outcomeSub}>
            {reason ? REASONS[reason] ?? reason : won ? 'Every goal met.' : 'The scenario is over.'} {hud ? `${monthYear(hud.date)}.` : ''}
          </div>
        </div>
        <div className={styles.outcomeStats}>
          <Stat tile label="Company value" value={money(hud?.player?.value ?? 0)} tone={won ? 'gold' : 'default'} />
          <Stat tile label="Months" value={months} />
          <Stat tile label="Rank" value={rank ? `#${rank} of ${companies.length}` : '—'} icon={rank === 1 ? <Crown size={12} /> : undefined} />
        </div>
        <div className={styles.outcomeBody}>
          <div className={styles.outcome}>
            <div>
              <SectionTitle>Company value & cash</SectionTitle>
              <LineChart
                height={180}
                labels={labels}
                yFormat={(v) => money(v, 1)}
                series={[
                  { id: 'value', label: 'Company value', values: history.map((r) => r.value) },
                  { id: 'cash', label: 'Cash', values: history.map((r) => r.cash), area: false },
                ]}
              />
            </div>
            <div>
              <SectionTitle>Goals</SectionTitle>
              {(hud?.scenario?.goals ?? []).map((g) => (
                <div key={g.id} className={styles.goalLine}>
                  {g.latched ? <Check size={14} className={styles.goalOk} /> : <Minus size={14} className={styles.goalNo} />}
                  <span>
                    {g.label}
                    {g.achievedAt ? ` · ${monthYear(g.achievedAt)}` : ''}
                  </span>
                </div>
              ))}
              {(hud?.scenario?.goals ?? []).length === 0 && <div className={styles.goalLine}>No scenario goals.</div>}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
