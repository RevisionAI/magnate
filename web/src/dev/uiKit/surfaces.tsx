// UiKit — feedback and surfaces: toasts, tooltips, empty states, skeletons,
// game-feel FX, panels, the drawer and overlay frames, modals, the confirm
// dialog and the context menu; plus the game-specific pieces (emblems, the
// advisor, difficulty stars, scenario art).

import { Building, Copy, Eye, Hammer, Megaphone, PackageOpen, Tag, Target, Trash2, TrendingUp } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { fx } from '@/game/fx';
import { useUiStore } from '@/state/uiStore';
import type { Pillar } from '@/state/scenarios';
import { OWNER_COLORS, OWNER_EMBLEMS } from '@/theme/tokens';
import {
  Badge,
  Button,
  ConfirmDialog,
  Divider,
  DrawerFrame,
  Emblem,
  EmptyState,
  Field,
  Grid,
  Modal,
  Money,
  OverlayFrame,
  Panel,
  Progress,
  SectionTitle,
  Skeleton,
  Spinner,
  Stat,
  ToastCard,
  Toggle,
  Tooltip,
  type TabItem,
} from '@/ui/components';
import { AdvisorPortrait } from '@/ui/hud/AdvisorDock';
import { SlotRow } from '@/ui/modals/SaveLoadModal';
import type { SaveSlotMeta } from '@/state/savegame';
import { ScenarioArt } from '@/ui/screens/ScenarioArt';
import { Stars } from '@/ui/screens/ScenarioSelect';
import styles from './UiKit.module.css';
import { Group } from './shared';

export function Feedback() {
  return (
    <>
      <Group title="Toasts (alerts policy UX §6.21: critical sticky · warning 7 s · opportunity 6 s · success 5 s)">
        <div className={styles.row} style={{ alignItems: 'flex-start' }}>
          <div className={styles.toastStack}>
            <ToastCard
              severity="critical"
              title="Insolvency countdown"
              body="Cash is −$1.2M. Insolvent in 5 months unless cash recovers."
              actions={[
                { kind: 'open', label: 'Finance', panel: 'finance' },
                { kind: 'ack', label: 'Acknowledge' },
              ]}
              durationMs={null}
            />
            <ToastCard severity="warning" title="Stock-out" body="Harbor Supermarket lost 260K units of Soft Drink." actions={[{ kind: 'locate', label: 'Locate' }, { kind: 'open', label: 'Fix', panel: 'inspector' }]} durationMs={7000} onDismiss={() => {}} />
            <ToastCard severity="warning" title="7 things need attention" body="Stock-out · Rival undercut your price · Selling below cost" count={7} durationMs={7000} onDismiss={() => {}} />
          </div>
          <div className={styles.toastStack}>
            <ToastCard severity="opportunity" title="Record month" body="Net income +$2.9M — your best month yet." actions={[{ kind: 'open', label: 'Why?', panel: 'reports' }]} durationMs={6000} onDismiss={() => {}} />
            <ToastCard severity="success" title="Goal achieved" body="Company value ≥ $20M." actions={[{ kind: 'open', label: 'Goals', panel: 'goals' }]} durationMs={5000} onDismiss={() => {}} />
            <ToastCard severity="info" title="Game saved" body="Acme Beverages · Mar 2028" durationMs={4000} onDismiss={() => {}} />
          </div>
        </div>
      </Group>
      <Group title="Rich tooltips (400 ms hover delay, keyboard focus, Esc closes; shown open here)">
        <div className={styles.tooltipStage}>
          <Tooltip open title="Cash on hand" content="Runway: 14.2 months at the recent burn rate. Click for the cash-flow report." shortcut="R" side="top" wide>
            <Button variant="secondary">Cash</Button>
          </Tooltip>
          <Tooltip open title="Speed 4×" content="3 s per month" shortcut="3" side="top">
            <Button variant="secondary">4×</Button>
          </Tooltip>
          <Tooltip open title="Reach once" content="Counts as soon as it is reached, even if it slips later." side="top">
            <Badge tone="success">Reach once</Badge>
          </Tooltip>
        </div>
      </Group>
      <div className={styles.grid3}>
        <Group title="Empty state">
          <div className={styles.card}>
            <EmptyState icon={<PackageOpen size={20} />} title="No product lines yet" body="Choose what this store sells to start trading." action={<Button size="sm" variant="primary">Add a product</Button>} />
          </div>
        </Group>
        <Group title="Skeleton · spinner">
          <div className={styles.card}>
            <Skeleton height={14} width="70%" />
            <div style={{ height: 8 }} />
            <Skeleton height={10} />
            <div style={{ height: 8 }} />
            <Skeleton height={10} width="85%" />
            <div style={{ height: 8 }} />
            <Skeleton height={56} radius={8} />
            <div style={{ height: 14 }} />
            <Spinner />
          </div>
        </Group>
        <Group title="Game feel — popups and confetti (UX §8)">
          <div className={styles.card}>
            <div className={styles.row}>
              <Button size="sm" variant="primary" data-ui-id="kit.popup" onClick={(e) => burst(e, '+$412K', 'gain')}>
                +$ popup
              </Button>
              <Button size="sm" variant="danger" onClick={(e) => burst(e, '−$135K', 'loss')}>
                −$ popup
              </Button>
              <Button size="sm" variant="secondary" onClick={(e) => burst(e, 'RECORD MONTH', 'gold')}>
                Milestone
              </Button>
              <Button size="sm" variant="secondary" onClick={() => fx.confetti({ intensity: 1.2 })}>
                Confetti
              </Button>
            </div>
            <div className={styles.caption}>World-anchored popups over buildings are rendered by the city view from the same bus topic.</div>
          </div>
        </Group>
      </div>
    </>
  );
}

function burst(e: MouseEvent, text: string, tone: 'gain' | 'loss' | 'gold') {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  fx.popup({ text, tone, x: r.left + r.width / 2, y: r.top });
}

type DrawerTab = 'overview' | 'layout' | 'finance';
const DRAWER_TABS: TabItem<DrawerTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'layout', label: 'Layout' },
  { id: 'finance', label: 'Finance' },
];
type OverlayTab = 'pnl' | 'balance' | 'cashflow';
const OVERLAY_TABS: TabItem<OverlayTab>[] = [
  { id: 'pnl', label: 'P&L' },
  { id: 'balance', label: 'Balance sheet' },
  { id: 'cashflow', label: 'Cash flow' },
];

export function Surfaces() {
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('overview');
  const [overlayTab, setOverlayTab] = useState<OverlayTab>('pnl');
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [lastChoice, setLastChoice] = useState<string | null>(null);
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const menu = (e: MouseEvent) => {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: 'Harbor Supermarket',
      subtitle: 'Yours · Metropolis · Level 2',
      items: [
        { id: 'inspect', label: 'Inspect', icon: Eye, shortcut: 'Enter' },
        { id: 'price', label: 'Set price…', icon: Tag },
        { id: 'ads', label: 'Advertise here', icon: Megaphone },
        { id: 'upgrade', label: 'Upgrade', icon: TrendingUp, shortcut: 'U', hint: '$1.4M · payback 9 mo' },
        { id: 'copy', label: 'Copy layout', icon: Copy, disabled: true, hint: 'Arrives with layout templates' },
        { kind: 'separator', id: 'sep' },
        { id: 'demolish', label: 'Demolish', icon: Trash2, danger: true, shortcut: 'Delete' },
      ],
    });
  };

  return (
    <>
      <div className={styles.grid3}>
        <Panel title="Glass panel" icon={<Target size={14} />} actions={<Badge tone="gold">3</Badge>}>
          <SectionTitle>Section title</SectionTitle>
          <p className={styles.caption}>The base surface of every HUD element: frosted glass, a crisp 1 px stroke and an inner highlight.</p>
          <Divider />
          <Progress value={0.64} label="Goal" valueLabel />
        </Panel>
        <Panel title="Accent panel" accent variant="solid">
          <Grid cols={2} gap={2}>
            <Stat size="sm" label="Revenue" value={<Money value={2_310_000} />} />
            <Stat size="sm" label="Net" value={<Money value={412_000} signed colored />} />
          </Grid>
        </Panel>
        <Panel title="Inset panel" variant="inset">
          <Field label="Auto-pause on goals">
            <Toggle checked onChange={() => {}} aria-label="Auto-pause on goals" />
          </Field>
        </Panel>
      </div>
      <div style={{ height: 20 }} />
      <div className={styles.grid2}>
        <Group title="Drawer frame (L2 right inspector)">
          <div className={styles.frameBox}>
            <DrawerFrame
              title="Harbor Supermarket"
              eyebrow="Your building"
              subtitle="Metropolis · Level 2"
              icon={<Emblem shape="circle" color={OWNER_COLORS[0]} size={22} ring />}
              tabs={DRAWER_TABS}
              tab={drawerTab}
              onTabChange={setDrawerTab}
              onClose={() => {}}
              footer={
                <>
                  <Button size="sm" variant="ghost">
                    Advertise
                  </Button>
                  <Button size="sm" variant="primary" icon={<TrendingUp size={13} />}>
                    Upgrade · $1.4M
                  </Button>
                </>
              }
            >
              <Grid cols={2} gap={2}>
                <Stat tile size="sm" label="Sold / mo" value="1.30M" />
                <Stat tile size="sm" label="Net / mo" value={<Money value={412_000} signed colored />} />
              </Grid>
              <div style={{ height: 12 }} />
              <Progress value={0.83} label="Units in use" valueLabel="5 / 6" />
            </DrawerFrame>
          </div>
        </Group>
        <Group title="Overlay frame (L3 full screen with header tabs)">
          <div className={styles.overlayBox}>
            <OverlayFrame title="Reports" subtitle="Acme Beverages · last 12 months" icon={<Building size={17} />} tabs={OVERLAY_TABS} tab={overlayTab} onTabChange={setOverlayTab} onClose={() => {}}>
              <EmptyState compact icon={<Hammer size={18} />} title="Reports arrive in Wave 2" body="Income statement, balance sheet, cash flow, products, buildings and history." />
            </OverlayFrame>
          </div>
        </Group>
      </div>
      <Group title="Save slots (Save / Load: thumbnail, metadata, quick and auto badges, rename · export · delete)">
        <SaveSlots />
      </Group>
      <Group title="Modal · confirm · context menu">
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setModal(true)} data-testid="kit-open-modal">
            Open modal
          </Button>
          <Button variant="danger" onClick={() => setConfirm(true)} data-testid="kit-open-confirm">
            Quit to title…
          </Button>
          <Button variant="secondary" onContextMenu={menu} onClick={menu}>
            Context menu (click or right-click)
          </Button>
          {lastChoice && <span className={styles.caption}>Last choice: {lastChoice}</span>}
        </div>
      </Group>
      <Modal open={modal} title="Settings" subtitle="Changes apply immediately and are saved in this browser." onClose={() => setModal(false)} size="md" footer={<Button variant="primary" onClick={() => setModal(false)}>Done</Button>}>
        <Field label="Subtitles" description="Captions for every voice line.">
          <Toggle checked onChange={() => {}} aria-label="Subtitles" />
        </Field>
        <Field label="Reduce transparency">
          <Toggle checked={false} onChange={() => {}} aria-label="Reduce transparency" />
        </Field>
      </Modal>
      <ConfirmDialog
        open={confirm}
        tone="danger"
        title="Save before quitting?"
        body="Your last save was 7 months ago."
        confirmLabel="Save first"
        altLabel="Quit without saving"
        onResult={(r) => {
          setConfirm(false);
          setLastChoice(r);
        }}
      />
    </>
  );
}

const THUMB = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fc4e0"/><stop offset="1" stop-color="#d9e4cf"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><rect y="118" width="320" height="62" fill="#8fae79"/><g fill="#c9c4b8"><rect x="40" y="70" width="34" height="60"/><rect x="82" y="50" width="28" height="80"/><rect x="150" y="84" width="60" height="46"/><rect x="226" y="62" width="30" height="68"/></g><rect x="150" y="84" width="60" height="6" fill="#2f7de1"/><rect x="0" y="128" width="320" height="6" fill="#5a5f67"/></svg>',
)}`;

const SLOT_BASE: SaveSlotMeta = {
  slotId: 'm-demo',
  slotKind: 'manual',
  label: 'Before the price war',
  gameId: 'g-demo',
  scenarioId: 'soft_drink_war',
  scenarioName: 'Soft Drink War',
  companyName: 'Acme Beverages',
  date: { year: 2028, month: 3 },
  elapsedMonths: 26,
  cash: 13_940_000,
  corporateValue: 41_200_000,
  goalsAchieved: 1,
  goalsTotal: 2,
  outcomeStatus: 'playing',
  createdAtIso: '2026-10-01T08:00:00.000Z',
  updatedAt: Date.now() - 2 * 3600_000,
  playTimeSec: 4980,
  rawBytes: 1_640_000,
  compressedBytes: 210_000,
  formatVersion: 1,
  engineSchemaVersion: 9,
  contentHash: null,
  thumbnail: THUMB,
};

const SLOTS: SaveSlotMeta[] = [
  SLOT_BASE,
  { ...SLOT_BASE, slotId: 'quick-demo', slotKind: 'quicksave', label: null, updatedAt: Date.now() - 6 * 60_000, date: { year: 2028, month: 9 }, corporateValue: 52_800_000 },
  { ...SLOT_BASE, slotId: 'auto-1', slotKind: 'autosave', label: null, updatedAt: Date.now() - 26 * 3600_000, thumbnail: null, date: { year: 2027, month: 12 } },
  { ...SLOT_BASE, slotId: 'm-won', label: null, outcomeStatus: 'won', goalsAchieved: 2, scenarioName: 'Coffee Monopoly', companyName: 'Bean There', updatedAt: Date.now() - 9 * 86400_000 },
];

export function SaveSlots() {
  return (
    <div className={styles.card}>
      {SLOTS.map((slot) => (
        <SlotRow key={slot.slotId} slot={slot} mode="load" onPrimary={() => {}} busy={false} />
      ))}
    </div>
  );
}

const PILLARS: Pillar[] = ['Tutorial', 'Sandbox', 'Retail', 'Brand', 'Integration', 'Technology', 'Exports', 'Growth'];

export function GamePieces() {
  return (
    <>
      <div className={styles.grid2}>
        <Group title="Company emblems (with the player’s gold ring)">
          <div className={styles.row}>
            {OWNER_EMBLEMS.map((shape, i) => (
              <Emblem key={shape} shape={shape} color={OWNER_COLORS[i]!} size={36} ring={i === 0} title={shape} />
            ))}
          </div>
        </Group>
        <Group title="Advisor portrait · difficulty stars">
          <div className={styles.row}>
            <AdvisorPortrait size={72} />
            <AdvisorPortrait size={48} />
            <Stars value={1} />
            <Stars value={3} size={14} />
            <Stars value={5} size={16} />
          </div>
        </Group>
      </div>
      <Group title="Scenario art (procedural, per pillar)">
        <div className={styles.artGrid}>
          {PILLARS.map((p) => (
            <div key={p} className={styles.art}>
              <ScenarioArt id={`kit-${p}`} pillar={p} />
              <span className={styles.artLabel}>{p}</span>
            </div>
          ))}
        </div>
      </Group>
    </>
  );
}
