// Renders the L4 modal stack from uiStore (pause, settings, save/load, outcome,
// controls, confirm). Mounted once at app level so Settings and Load also work
// from the title screen. Later entries render above earlier ones.

import { Keyboard } from 'lucide-react';
import { useUiStore, type ModalEntry } from '@/state/uiStore';
import { useSettingsStore } from '@/state/settingsStore';
import { Button, ConfirmDialog, KeyChord, Modal } from '@/ui/components';
import { chordsFor, KEY_ACTIONS, type KeyGroup } from '@/ui/input/keymap';
import { OutcomeModal } from './OutcomeModal';
import { PauseMenu } from './PauseMenu';
import { SaveLoadModal } from './SaveLoadModal';
import { SettingsModal } from './SettingsModal';
import styles from './Modals.module.css';

const GROUPS: KeyGroup[] = ['Time', 'Panels', 'Game', 'City view', 'Camera', 'Buildings'];

function ControlsSheet({ onClose }: { onClose: () => void }) {
  const bindings = useSettingsStore((s) => s.controls.bindings);
  const openModal = useUiStore((s) => s.openModal);
  return (
    <Modal
      open
      title="Controls"
      subtitle="Mouse: left-click selects, right-click opens actions, drag to pan, wheel to zoom."
      icon={<Keyboard size={18} />}
      size="xl"
      onClose={onClose}
      data-testid="controls-modal"
      footer={
        <Button
          variant="secondary"
          onClick={() => {
            onClose();
            openModal('settings', { section: 'controls' });
          }}
        >
          Rebind keys…
        </Button>
      }
    >
      <div className={styles.controls}>
        {GROUPS.map((g) => (
          <div key={g} className={styles.controlsGroup}>
            <h4 className={styles.groupTitle}>{g}</h4>
            {KEY_ACTIONS.filter((a) => a.group === g).map((a) => (
              <div key={a.id} className={styles.controlsRow}>
                <span>{a.label}</span>
                <span className={styles.chords}>
                  {chordsFor(a.id, bindings).map((c) => (
                    <KeyChord key={c} chord={c} small />
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ModalView({ entry }: { entry: ModalEntry }) {
  const closeModal = useUiStore((s) => s.closeModal);
  const resolveConfirm = useUiStore((s) => s.resolveConfirm);
  const close = () => closeModal(entry.id);
  switch (entry.id) {
    case 'pause':
      return <PauseMenu onClose={close} />;
    case 'settings':
      return <SettingsModal onClose={close} initialSection={(entry.props.section as never) ?? 'audio'} />;
    case 'saveLoad':
      return <SaveLoadModal onClose={close} initialTab={entry.props.tab === 'save' ? 'save' : 'load'} />;
    case 'outcome':
      return <OutcomeModal status={entry.props.status === 'won' ? 'won' : 'lost'} reason={(entry.props.reason as string | null) ?? null} onClose={close} />;
    case 'controls':
      return <ControlsSheet onClose={close} />;
    case 'confirm': {
      const c = entry.confirm;
      if (!c) return null;
      return (
        <ConfirmDialog
          open
          title={c.title}
          body={c.body}
          confirmLabel={c.confirmLabel}
          cancelLabel={c.cancelLabel}
          altLabel={c.altLabel}
          tone={c.tone}
          onResult={(r) => resolveConfirm(entry.key, r)}
        />
      );
    }
    case 'briefing':
      return null;
  }
}

export function ModalHost() {
  const modals = useUiStore((s) => s.modals);
  return (
    <>
      {modals.map((m) => (
        <ModalView key={m.key} entry={m} />
      ))}
    </>
  );
}
