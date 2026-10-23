// Save / Load (UX §6.19): slots with thumbnail and metadata (scenario, company,
// in-game date, value, real time, play time), quicksave and autosave badges,
// rename/delete with confirmation, export/import, storage usage. Backed by the
// SaveStore interface (IndexedDB on the main thread in Wave 1).

import clsx from 'clsx';
import { Building2, Download, FolderOpen, Pencil, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '@/state/gameStore';
import { slotTitle, type SaveSlotMeta } from '@/state/savegame';
import { useSavesStore } from '@/state/savesStore';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, EmptyState, IconButton, Modal, Progress, Tabs, TextInput, type TabItem } from '@/ui/components';
import { bytes, money, monthYear, playTime, timeAgo } from '@/util/format';
import { confirmLeaveGame } from './PauseMenu';
import styles from './Modals.module.css';

type Tab = 'save' | 'load';

/** One save slot row (also rendered by the UiKit page). */
export function SlotRow({
  slot,
  mode,
  onPrimary,
  busy,
}: {
  slot: SaveSlotMeta;
  mode: Tab;
  onPrimary: (slot: SaveSlotMeta) => void;
  busy: boolean;
}) {
  const rename = useSavesStore((s) => s.rename);
  const remove = useSavesStore((s) => s.remove);
  const exportSlot = useSavesStore((s) => s.exportSlot);
  const confirm = useUiStore((s) => s.confirm);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(slot.label ?? '');

  const commitRename = () => {
    setEditing(false);
    if (label.trim() !== (slot.label ?? '')) void rename(slot.slotId, label);
  };

  const askDelete = async () => {
    const answer = await confirm({
      title: 'Delete this save?',
      body: `${slotTitle(slot)} · ${monthYear(slot.date)}. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (answer === 'confirm') void remove(slot.slotId);
  };

  return (
    <div className={styles.slot} data-testid={`slot-${slot.slotId}`}>
      <div className={styles.thumb}>
        {slot.thumbnail ? (
          <img src={slot.thumbnail} alt="" />
        ) : (
          <span className={styles.thumbFallback}>
            <Building2 size={22} />
          </span>
        )}
      </div>
      <div className={styles.slotInfo}>
        <div className={styles.slotTitle}>
          {editing ? (
            <TextInput
              size="sm"
              className={styles.renameInput}
              value={label}
              autoFocus
              placeholder={slotTitle({ ...slot, label: null })}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                  setLabel(slot.label ?? '');
                }
              }}
            />
          ) : (
            <span>{slotTitle(slot)}</span>
          )}
          {slot.slotKind === 'autosave' && <Badge tone="info">Auto</Badge>}
          {slot.slotKind === 'quicksave' && <Badge tone="gold">Quick</Badge>}
          {slot.outcomeStatus === 'won' && <Badge tone="success">Won</Badge>}
          {slot.outcomeStatus === 'lost' && <Badge tone="danger">Lost</Badge>}
        </div>
        <div className={styles.slotMeta}>
          <span>{slot.scenarioName ?? 'Free play'}</span>
          <span>{monthYear(slot.date)}</span>
          {/* A legacy (engine-only) import has no meta until it is loaded (formatVersion 0): its value is unknown, not $0. */}
          <span>Value {slot.formatVersion === 0 ? '—' : money(slot.corporateValue)}</span>
          <span>Cash {money(slot.cash)}</span>
          {slot.goalsTotal > 0 && (
            <span>
              Goals {slot.goalsAchieved}/{slot.goalsTotal}
            </span>
          )}
        </div>
        <div className={styles.slotMeta}>
          <span>Saved {timeAgo(slot.updatedAt)}</span>
          {slot.playTimeSec > 0 && <span>Played {playTime(slot.playTimeSec)}</span>}
          <span>{bytes(slot.rawBytes)}</span>
        </div>
      </div>
      <div className={styles.slotActions}>
        <IconButton size="sm" label="Rename" icon={<Pencil size={14} />} onClick={() => setEditing(true)} />
        <IconButton size="sm" label="Export to a file" icon={<Download size={14} />} onClick={() => void exportSlot(slot.slotId)} />
        <IconButton size="sm" label="Delete" icon={<Trash2 size={14} />} onClick={() => void askDelete()} data-testid={`slot-delete-${slot.slotId}`} />
        <Button
          size="sm"
          variant={mode === 'load' ? 'primary' : 'secondary'}
          disabled={busy}
          onClick={() => onPrimary(slot)}
          data-testid={`slot-${mode}-${slot.slotId}`}
        >
          {mode === 'load' ? 'Load' : 'Overwrite'}
        </Button>
      </div>
    </div>
  );
}

export function SaveLoadModal({ onClose, initialTab = 'load' }: { onClose: () => void; initialTab?: Tab }) {
  const inGame = useGameStore((s) => s.phase === 'playing' && s.hud !== null);
  const [tab, setTab] = useState<Tab>(inGame ? initialTab : 'load');
  const slots = useSavesStore((s) => s.slots);
  const loaded = useSavesStore((s) => s.loaded);
  const error = useSavesStore((s) => s.error);
  const estimate = useSavesStore((s) => s.estimate);
  const backend = useSavesStore((s) => s.backend);
  const refresh = useSavesStore((s) => s.refresh);
  const importFile = useSavesStore((s) => s.importFile);
  const saving = useGameStore((s) => s.saving);
  const canSave = useGameStore((s) => s.canSave);
  const saveNew = useGameStore((s) => s.saveNew);
  const saveToSlot = useGameStore((s) => s.saveToSlot);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const gameId = useGameStore((s) => s.gameId);
  const companyName = useGameStore((s) => s.hud?.player?.name ?? '');
  const date = useGameStore((s) => s.hud?.date);
  const confirm = useUiStore((s) => s.confirm);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tabs: TabItem<Tab>[] = [
    { id: 'save', label: 'Save', icon: <Save size={14} />, disabled: !inGame, hint: inGame ? undefined : 'Start or load a game first' },
    { id: 'load', label: 'Load', icon: <FolderOpen size={14} />, badge: slots.length ? <Badge count={slots.length} /> : undefined },
  ];
  const visible = useMemo(() => (tab === 'save' ? slots.filter((s) => s.slotKind !== 'autosave') : slots), [slots, tab]);

  const onPrimary = async (slot: SaveSlotMeta) => {
    if (tab === 'load') {
      if (inGame && !(await confirmLeaveGame('load'))) return;
      const ok = await loadSlot(slot.slotId);
      if (ok) useUiStore.getState().reset();
      return;
    }
    const sameGame = slot.gameId === gameId;
    const answer = await confirm({
      title: 'Overwrite this save?',
      body: sameGame ? `${slotTitle(slot)} will be replaced with the current game.` : `${slotTitle(slot)} belongs to another game. It will be replaced with this one.`,
      confirmLabel: 'Overwrite',
      tone: sameGame ? 'default' : 'danger',
    });
    if (answer === 'confirm') await saveToSlot(slot.slotId, { slotKind: slot.slotKind === 'quicksave' ? 'quicksave' : 'manual', label: slot.label });
  };

  const usage = estimate && Number.isFinite(estimate.quota) && estimate.quota > 0 ? estimate.usage / estimate.quota : null;

  return (
    <Modal
      open
      title={tab === 'save' ? 'Save game' : 'Load game'}
      icon={tab === 'save' ? <Save size={18} /> : <FolderOpen size={18} />}
      size="lg"
      flush
      onClose={onClose}
      data-testid="saveload-modal"
      footerStart={
        <div className={styles.storage}>
          <span>{backend === 'memory' ? 'Saves last until you close the tab (browser storage unavailable)' : estimate ? `${bytes(estimate.usage)} used` : 'Browser storage'}</span>
          {usage !== null && <Progress value={usage} size="sm" tone={usage > 0.8 ? 'warning' : 'info'} />}
        </div>
      }
      footer={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.magnate,application/json"
            className={styles.hiddenInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className={styles.saveTabs}>
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>
      {tab === 'save' && (
        <div className={styles.saveTop}>
          <TextInput
            placeholder={`${companyName}${date ? ` · ${monthYear(date)}` : ''}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void saveNew(name || null).then(() => setName(''));
              }
            }}
            aria-label="Save name"
            data-testid="save-name"
          />
          <Button
            variant="primary"
            icon={<Save size={15} />}
            loading={saving}
            disabled={!canSave}
            onClick={() => void saveNew(name || null).then(() => setName(''))}
            data-testid="save-new"
          >
            Save new
          </Button>
        </div>
      )}
      {!canSave && <div className={styles.error}>This build of the engine cannot save or load games yet. Saving arrives with the next engine update.</div>}
      {error && <div className={styles.error}>{error}</div>}
      <div className={clsx(styles.slotList)} data-testid="slot-list">
        {loaded && visible.length === 0 && (
          <EmptyState
            compact
            icon={<FolderOpen size={20} />}
            title={tab === 'save' ? 'No saves yet' : 'Nothing to load yet'}
            body={tab === 'save' ? 'Name your save above, or press Ctrl/⌘ + S in game to quicksave.' : 'Saved games and autosaves appear here.'}
          />
        )}
        {visible.map((slot) => (
          <SlotRow key={slot.slotId} slot={slot} mode={tab} onPrimary={(s) => void onPrimary(s)} busy={saving} />
        ))}
      </div>
    </Modal>
  );
}
