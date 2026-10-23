// Settings (UX §6.18): Audio (five buses wired to audio.setVolumes via the
// settings effects), Graphics (published for the city renderer), Gameplay
// (speed, full-screen pause, auto-pause triggers, autosave, number format),
// Interface (UI scale 80–150%), Accessibility (colour vision, reduced motion,
// contrast) and Controls (key bindings with rebinding). Changes apply live and
// persist per browser.

import { Accessibility, Gamepad2, Keyboard, Monitor, Palette, Volume2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { audio } from '@/audio';
import { SPEED_LABEL } from '@/game/clock';
import { AUTO_PAUSE_TRIGGERS } from '@/state/autopause';
import { useSettingsStore, type SettingsGroup } from '@/state/settingsStore';
import { PROFIT_LOSS } from '@/theme/tokens';
import { Button, Field, KeyChord, Modal, Segmented, Select, Slider, Tabs, Toggle, type TabItem } from '@/ui/components';
import { chordFromEvent, chordsFor, conflictsFor, KEY_ACTIONS, type KeyGroup } from '@/ui/input/keymap';
import styles from './Modals.module.css';

type Section = 'audio' | 'graphics' | 'gameplay' | 'interface' | 'accessibility' | 'controls';

const SECTIONS: TabItem<Section>[] = [
  { id: 'audio', label: 'Audio', icon: <Volume2 size={15} /> },
  { id: 'graphics', label: 'Graphics', icon: <Monitor size={15} /> },
  { id: 'gameplay', label: 'Gameplay', icon: <Gamepad2 size={15} /> },
  { id: 'interface', label: 'Interface', icon: <Palette size={15} /> },
  { id: 'accessibility', label: 'Accessibility', icon: <Accessibility size={15} /> },
  { id: 'controls', label: 'Controls', icon: <Keyboard size={15} /> },
];

const GROUP_OF: Record<Section, SettingsGroup> = {
  audio: 'audio',
  graphics: 'graphics',
  gameplay: 'gameplay',
  interface: 'interface',
  accessibility: 'interface',
  controls: 'controls',
};

function PercentSlider({ value, onChange, min = 0, max = 100, step = 1, label, testId, marks }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; testId?: string; marks?: number[] }) {
  return (
    <div className={styles.sliderField}>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        format={(v) => `${Math.round(v)}%`}
        aria-label={label}
        data-testid={testId}
        marks={marks?.map((m) => ({ value: m }))}
        bubble={false}
      />
      <span className={styles.sliderValue}>{Math.round(value)}%</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h4 className={styles.groupTitle}>{title}</h4>
      {children}
    </>
  );
}

function AudioSection() {
  const a = useSettingsStore((s) => s.audio);
  const update = useSettingsStore((s) => s.update);
  const set = (patch: Partial<typeof a>) => update('audio', patch);
  return (
    <>
      <Group title="Volume">
        {(
          [
            ['master', 'Master', 'Everything at once.'],
            ['music', 'Music', 'Calm operations themes and stings.'],
            ['sfx', 'Effects', 'Interface and game sounds.'],
            ['voice', 'Voice', 'Morgan, your COO, and the news anchor.'],
            ['ambient', 'Ambience', 'Traffic, harbour and city life, mixed by camera height.'],
          ] as const
        ).map(([key, label, description]) => (
          <Field key={key} label={label} description={description}>
            <PercentSlider value={a[key]} onChange={(v) => set({ [key]: v })} label={`${label} volume`} testId={`volume-${key}`} />
          </Field>
        ))}
        <Field label="Mute" description="Ctrl/⌘ + M toggles it anywhere.">
          <Toggle checked={a.muted} onChange={(muted) => set({ muted })} aria-label="Mute all sound" data-testid="setting-mute" />
        </Field>
        <Field label="Mute when the tab is in the background">
          <Toggle checked={a.muteInBackground} onChange={(muteInBackground) => set({ muteInBackground })} aria-label="Mute in background" />
        </Field>
      </Group>
      <Group title="Voice">
        <Field label="Advisor voice" description="Important only = critical alerts, goals and tutorial lines.">
          <Segmented
            size="sm"
            value={a.advisorVoice}
            onChange={(advisorVoice) => set({ advisorVoice })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'important', label: 'Important' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Field>
        <Field label="Subtitles" description="Captions for every voice line.">
          <Toggle checked={a.subtitles} onChange={(subtitles) => set({ subtitles })} aria-label="Subtitles" />
        </Field>
        <Field label="Test">
          <Button size="sm" onClick={() => audio.ui('confirm')} sound={false}>
            Play a sound
          </Button>
        </Field>
      </Group>
    </>
  );
}

function GraphicsSection() {
  const g = useSettingsStore((s) => s.graphics);
  const update = useSettingsStore((s) => s.update);
  const set = (patch: Partial<typeof g>) => update('graphics', patch);
  return (
    <>
      <Group title="Quality">
        <Field label="Quality preset" description="Auto picks a tier for your GPU; integrated graphics run the Low pipeline.">
          <Select
            value={g.quality}
            onChange={(quality) => set({ quality })}
            options={[
              { value: 'auto', label: 'Auto', description: 'Detect from the GPU' },
              { value: 'low', label: 'Low', description: 'No ambient occlusion' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'ultra', label: 'Ultra' },
            ]}
            aria-label="Quality preset"
          />
        </Field>
        <Field label="Resolution scale" description="Render below native resolution for speed.">
          <PercentSlider value={g.resolutionScale} min={50} max={100} step={5} onChange={(resolutionScale) => set({ resolutionScale })} label="Resolution scale" marks={[50, 75, 100]} />
        </Field>
        <Field label="Shadows">
          <Toggle checked={g.shadows} onChange={(shadows) => set({ shadows })} aria-label="Shadows" />
        </Field>
        <Field label="City life density" description="Cars, trucks and shoppers.">
          <PercentSlider value={g.ambientDensity} onChange={(ambientDensity) => set({ ambientDensity })} label="City life density" step={5} />
        </Field>
        <Field label="Frame-rate cap">
          <Segmented
            size="sm"
            value={g.fpsCap}
            onChange={(fpsCap) => set({ fpsCap })}
            options={[
              { value: 0, label: 'Uncapped' },
              { value: 30, label: '30 fps' },
            ]}
          />
        </Field>
      </Group>
      <Group title="Time of day">
        <Field label="Day and night" description="A cosmetic 12-minute day, independent of game speed — or a fixed light.">
          <Segmented
            size="sm"
            value={g.dayNight}
            onChange={(dayNight) => set({ dayNight })}
            options={[
              { value: 'dynamic', label: 'Cycle' },
              { value: 'day', label: 'Day' },
              { value: 'golden', label: 'Golden hour' },
              { value: 'night', label: 'Night' },
            ]}
          />
        </Field>
      </Group>
      <p className={styles.note}>Graphics options take effect in the city view.</p>
    </>
  );
}

function GameplaySection() {
  const p = useSettingsStore((s) => s.gameplay);
  const update = useSettingsStore((s) => s.update);
  const setAutoPause = useSettingsStore((s) => s.setAutoPause);
  const set = (patch: Partial<typeof p>) => update('gameplay', patch);
  return (
    <>
      <Group title="Time">
        <Field label="Resume speed" description="The speed Space resumes to.">
          <Segmented
            size="sm"
            value={p.defaultSpeed}
            onChange={(defaultSpeed) => set({ defaultSpeed })}
            options={([1, 2, 3, 4] as const).map((s) => ({ value: s, label: SPEED_LABEL[s] }))}
          />
        </Field>
        <Field label="Pause while in full-screen screens" description="Reports, Markets, Finance and other overlays freeze the clock.">
          <Toggle checked={p.pauseInFullscreen} onChange={(pauseInFullscreen) => set({ pauseInFullscreen })} aria-label="Pause in full-screen screens" data-testid="setting-pause-fullscreen" />
        </Field>
      </Group>
      <Group title="Auto-pause when…">
        {AUTO_PAUSE_TRIGGERS.map((t) => (
          <Field key={t.id} label={t.label} description={t.description}>
            <Toggle checked={p.autoPause[t.id]} onChange={(v) => setAutoPause(t.id, v)} aria-label={t.label} />
          </Field>
        ))}
      </Group>
      <Group title="Saving">
        <Field label="Autosave" description="Every N in-game months, rotating three slots.">
          <Segmented
            size="sm"
            value={p.autosaveMonths}
            onChange={(autosaveMonths) => set({ autosaveMonths })}
            options={[
              { value: 0, label: 'Off' },
              { value: 3, label: '3 mo' },
              { value: 6, label: '6 mo' },
              { value: 12, label: '12 mo' },
            ]}
          />
        </Field>
        <Field label="Ask before leaving with unsaved progress">
          <Toggle checked={p.confirmQuit} onChange={(confirmQuit) => set({ confirmQuit })} aria-label="Confirm before quitting" />
        </Field>
      </Group>
      <Group title="Display">
        <Field label="Money format">
          <Segmented
            size="sm"
            value={p.numberFormat}
            onChange={(numberFormat) => set({ numberFormat })}
            options={[
              { value: 'short', label: '$1.23M' },
              { value: 'full', label: '$1,234,567' },
            ]}
          />
        </Field>
        <Field label="Tutorial hints" description="Coach marks and nudges when you seem stuck.">
          <Toggle checked={p.tutorialHints} onChange={(tutorialHints) => set({ tutorialHints })} aria-label="Tutorial hints" />
        </Field>
      </Group>
    </>
  );
}

function InterfaceSection() {
  const i = useSettingsStore((s) => s.interface);
  const update = useSettingsStore((s) => s.update);
  const set = (patch: Partial<typeof i>) => update('interface', patch);
  return (
    <>
      <Group title="Layout">
        <Field label="UI scale" description="Scales every panel and label; the city keeps its resolution.">
          <PercentSlider value={i.uiScale} min={80} max={150} step={5} onChange={(uiScale) => set({ uiScale })} label="UI scale" marks={[100, 125]} testId="setting-ui-scale" />
        </Field>
        <Field label="Reduce transparency" description="Solid panels instead of frosted glass (also faster on older GPUs).">
          <Toggle checked={i.reduceTransparency} onChange={(reduceTransparency) => set({ reduceTransparency })} aria-label="Reduce transparency" />
        </Field>
        <Field label="Company emblems" description="Shapes next to company colours everywhere.">
          <Toggle checked={i.emblems} onChange={(emblems) => set({ emblems })} aria-label="Company emblems" />
        </Field>
      </Group>
    </>
  );
}

function AccessibilitySection() {
  const i = useSettingsStore((s) => s.interface);
  const update = useSettingsStore((s) => s.update);
  const set = (patch: Partial<typeof i>) => update('interface', patch);
  const pl = PROFIT_LOSS[i.colourVision];
  return (
    <>
      <Group title="Colour">
        <Field label="Colour vision" description="Remaps profit and loss to blue and orange; arrows ▲▼ are always shown.">
          <Select
            value={i.colourVision}
            onChange={(colourVision) => set({ colourVision })}
            options={[
              { value: 'off', label: 'Standard' },
              { value: 'deutan', label: 'Deuteranopia' },
              { value: 'protan', label: 'Protanopia' },
              { value: 'tritan', label: 'Tritanopia' },
            ]}
            aria-label="Colour vision mode"
            data-testid="setting-cvd"
          />
        </Field>
        <Field label="Preview">
          <span className={styles.cvdPreview}>
            <span style={{ color: pl.pos }}>▲ +$412K profit</span>
            <span style={{ color: pl.neg }}>▼ −$135K loss</span>
          </span>
        </Field>
        <Field label="High-contrast HUD" description="Stronger outlines and brighter text on panels.">
          <Toggle checked={i.highContrast} onChange={(highContrast) => set({ highContrast })} aria-label="High contrast" />
        </Field>
      </Group>
      <Group title="Motion">
        <Field label="Reduced motion" description="Stops sliding panels, rising popups, confetti and the scrolling ticker.">
          <Segmented
            size="sm"
            value={i.reducedMotion}
            onChange={(reducedMotion) => set({ reducedMotion })}
            options={[
              { value: 'system', label: 'Follow system' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Field>
      </Group>
    </>
  );
}

const GROUP_ORDER: KeyGroup[] = ['Time', 'Panels', 'Game', 'City view', 'Camera', 'Buildings'];

function ControlsSection() {
  const c = useSettingsStore((s) => s.controls);
  const update = useSettingsStore((s) => s.update);
  const setBinding = useSettingsStore((s) => s.setBinding);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ action: string; text: string } | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return;
      const clashes = conflictsFor(capturing, chord, c.bindings);
      setBinding(capturing, [chord]);
      setConflict(clashes.length ? { action: capturing, text: `Also used by: ${clashes.map((a) => a.label).join(', ')}` } : null);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, c.bindings, setBinding]);

  return (
    <>
      <Group title="Mouse and camera">
        <Field label="Edge scrolling" description="Pan the camera by moving the pointer to the screen edge.">
          <Toggle checked={c.edgeScroll} onChange={(edgeScroll) => update('controls', { edgeScroll })} aria-label="Edge scrolling" />
        </Field>
        <Field label="Invert rotation">
          <Toggle checked={c.invertRotate} onChange={(invertRotate) => update('controls', { invertRotate })} aria-label="Invert rotation" />
        </Field>
        <Field label="Zoom sensitivity">
          <PercentSlider value={c.zoomSensitivity} min={50} max={200} step={10} onChange={(zoomSensitivity) => update('controls', { zoomSensitivity })} label="Zoom sensitivity" marks={[100]} />
        </Field>
      </Group>
      {GROUP_ORDER.map((group) => (
        <Group key={group} title={group}>
          {KEY_ACTIONS.filter((a) => a.group === group).map((a) => {
            const chords = chordsFor(a.id, c.bindings);
            const custom = !!c.bindings[a.id];
            const rebindable = a.handler === 'ui' && !a.fixed;
            return (
              <div key={a.id} className={styles.bindRow}>
                <span className={styles.bindLabel}>
                  {a.label}
                  {a.handler !== 'ui' && <span className={styles.bindOwner}>{a.handler === 'scene' ? 'City view' : 'Building panels'}</span>}
                </span>
                {capturing === a.id ? (
                  <span className={styles.capturing}>Press a key… (Esc cancels)</span>
                ) : (
                  <span className={styles.chords}>
                    {chords.map((ch) => (
                      <KeyChord key={ch} chord={ch} />
                    ))}
                  </span>
                )}
                <span>
                  {rebindable && (
                    <Button size="sm" variant="ghost" onClick={() => setCapturing(a.id)}>
                      Rebind
                    </Button>
                  )}
                  {custom && (
                    <Button size="sm" variant="ghost" onClick={() => setBinding(a.id, null)}>
                      Reset
                    </Button>
                  )}
                </span>
                {conflict?.action === a.id && <span className={styles.conflict}>{conflict.text}</span>}
              </div>
            );
          })}
        </Group>
      ))}
    </>
  );
}

export function SettingsModal({ onClose, initialSection = 'audio' }: { onClose: () => void; initialSection?: Section }) {
  const [section, setSection] = useState<Section>(initialSection);
  const reset = useSettingsStore((s) => s.reset);
  return (
    <Modal
      open
      title="Settings"
      size="xl"
      flush
      onClose={onClose}
      data-testid="settings-modal"
      footerStart={
        <Button variant="ghost" size="sm" onClick={() => reset(GROUP_OF[section])}>
          Reset {section === 'accessibility' ? 'interface' : section} to defaults
        </Button>
      }
      footer={
        <Button variant="primary" onClick={onClose} data-testid="settings-done">
          Done
        </Button>
      }
    >
      <div className={styles.settings}>
        <div className={styles.settingsNav}>
          <Tabs items={SECTIONS} value={section} onChange={setSection} variant="vertical" label="Settings sections" />
        </div>
        <div className={styles.settingsBody} data-testid={`settings-${section}`}>
          {section === 'audio' && <AudioSection />}
          {section === 'graphics' && <GraphicsSection />}
          {section === 'gameplay' && <GameplaySection />}
          {section === 'interface' && <InterfaceSection />}
          {section === 'accessibility' && <AccessibilitySection />}
          {section === 'controls' && <ControlsSection />}
        </div>
      </div>
    </Modal>
  );
}
