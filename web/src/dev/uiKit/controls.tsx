// UiKit — buttons, key caps, form controls, the banded price slider and tabs.

import { Building2, ChartLine, Download, Hammer, Play, Plus, Save, Settings, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Field, IconButton, Kbd, KeyChord, Segmented, Select, Slider, Tabs, TextInput, Toggle, type TabItem } from '@/ui/components';
import { price } from '@/util/format';
import styles from './UiKit.module.css';
import { Group } from './shared';

export function Buttons() {
  const [pressed, setPressed] = useState(true);
  return (
    <>
      <Group title="Variants">
        <div className={styles.row}>
          <Button variant="primary" icon={<Play size={15} fill="currentColor" />} kbd="Space">
            Resume
          </Button>
          <Button variant="secondary" icon={<Save size={15} />} kbd="Mod+S">
            Save game
          </Button>
          <Button variant="ghost" icon={<Settings size={15} />}>
            Settings
          </Button>
          <Button variant="danger" icon={<Trash2 size={15} />}>
            Demolish
          </Button>
          <Button variant="secondary" pressed={pressed} onClick={() => setPressed((p) => !p)}>
            Toggle (pressed)
          </Button>
          <Button variant="secondary" badge={<Badge count={3} variant="solid" tone="danger" />}>
            With badge
          </Button>
        </div>
      </Group>
      <Group title="Sizes">
        <div className={styles.row}>
          <Button size="sm" variant="primary">
            Small
          </Button>
          <Button size="md" variant="primary">
            Medium
          </Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
          <Button size="xl" variant="primary" icon={<Play size={18} fill="currentColor" />}>
            Start game
          </Button>
          <Button size="sm" variant="secondary" iconRight={<Plus size={13} />}>
            Add unit
          </Button>
        </div>
      </Group>
      <Group title="States">
        <div className={styles.row}>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button variant="secondary" loading>
            Loading
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button variant="danger" disabled>
            Disabled
          </Button>
        </div>
      </Group>
      <Group title="Icon buttons (label → aria-label + tooltip)">
        <div className={styles.row}>
          <IconButton label="Close" kbd="Escape" icon={<X size={16} />} />
          <IconButton label="Build" kbd="B" icon={<Hammer size={17} />} variant="secondary" />
          <IconButton label="Reports" kbd="R" icon={<ChartLine size={17} />} variant="secondary" />
          <IconButton label="Company" kbd="M" icon={<Building2 size={17} />} />
          <IconButton label="Export save" icon={<Download size={16} />} size="sm" />
          <IconButton label="Round" icon={<Play size={14} fill="currentColor" />} variant="primary" round />
        </div>
      </Group>
      <Group title="Key caps">
        <div className={styles.row}>
          <Kbd>B</Kbd>
          <Kbd>Space</Kbd>
          <KeyChord chord="Mod+S" />
          <KeyChord chord="Shift+Period" />
          <KeyChord chord="Mod+Shift+S" small />
          <Kbd small>Esc</Kbd>
        </div>
      </Group>
    </>
  );
}

const CITIES = [
  { value: 'metropolis', label: 'Metropolis', description: '512K people · coastal' },
  { value: 'hilltown', label: 'Hilltown', description: '88K people · arable' },
  { value: 'portbay', label: 'Portbay', description: '210K people · port' },
  { value: 'riverside', label: 'Riverside', description: '140K people · river', disabled: true },
];

type DemoTab = 'pnl' | 'balance' | 'cashflow' | 'products' | 'history';
const TABS: TabItem<DemoTab>[] = [
  { id: 'pnl', label: 'P&L' },
  { id: 'balance', label: 'Balance sheet' },
  { id: 'cashflow', label: 'Cash flow', badge: '!' },
  { id: 'products', label: 'Products' },
  { id: 'history', label: 'History', disabled: true, hint: 'Arrives in Wave 2' },
];

export function Inputs() {
  const [city, setCity] = useState<string>('metropolis');
  const [on, setOn] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [name, setName] = useState('Acme Beverages');
  const [priceValue, setPrice] = useState(2.25);
  const [committed, setCommitted] = useState(2.25);
  const [volume, setVolume] = useState(60);
  const [scale, setScale] = useState(100);
  const [tab, setTab] = useState<DemoTab>('pnl');
  return (
    <>
      <div className={styles.grid2}>
        <Group title="Select">
          <div className={styles.row}>
            <Select value={city} options={CITIES} onChange={setCity} aria-label="City" />
            <Select value={null} options={CITIES} onChange={setCity} placeholder="Choose a city…" size="sm" aria-label="City (empty)" />
            <Select value={city} options={CITIES} onChange={setCity} disabled aria-label="City (disabled)" />
          </div>
        </Group>
        <Group title="Toggle · Segmented">
          <div className={styles.row}>
            <Toggle checked={on} onChange={setOn} label="Pause in full-screen screens" />
            <Toggle checked={!on} onChange={(v) => setOn(!v)} size="sm" label="Small" />
            <Toggle checked={false} onChange={() => {}} disabled label="Disabled" />
          </div>
          <div className={styles.row} style={{ marginTop: 12 }}>
            <Segmented
              value={speed}
              onChange={setSpeed}
              label="Speed"
              options={[
                { value: 1, label: '1×' },
                { value: 2, label: '2×' },
                { value: 4, label: '4×' },
                { value: 8, label: '8×' },
              ]}
            />
            <Segmented
              size="sm"
              value="important"
              onChange={() => {}}
              options={[
                { value: 'all', label: 'All' },
                { value: 'important', label: 'Important' },
                { value: 'off', label: 'Off', disabled: true },
              ]}
            />
          </div>
        </Group>
      </div>
      <Group title="Field rows (settings) · text input">
        <div className={styles.card} style={{ maxWidth: 640 }}>
          <Field label="Company name" description="Shown on signs, trucks and the stock ticker." htmlFor="kit-name">
            <TextInput id="kit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Small input">
            <TextInput size="sm" placeholder="Random" />
          </Field>
          <Field label="Disabled input">
            <TextInput size="sm" value="Read only" disabled readOnly />
          </Field>
        </div>
      </Group>
      <Group title="Banded price slider (UX §6.7.3: unit cost, world price, rival min, ◆ suggested, bracket ceiling)">
        <div className={styles.card} style={{ maxWidth: 760 }}>
          <Slider
            value={priceValue}
            min={0.8}
            max={8}
            step={0.01}
            scale="log"
            format={price}
            onChange={setPrice}
            onCommit={setCommitted}
            showScale
            aria-label="Soft drink price"
            bands={[
              { from: 0.8, to: 1.52, tone: 'danger', label: 'Below cost' },
              { from: 2.05, to: 2.6, tone: 'success', label: 'Suggested' },
              { from: 4.99, to: 8, tone: 'warning', label: 'Above middle ceiling' },
            ]}
            marks={[
              { value: 1.52, label: 'Unit cost', detail: '$1.52', tone: 'danger' },
              { value: 1.9, label: 'Rival min', detail: '$1.90', tone: 'info' },
              { value: 2.3, label: 'Suggested', detail: '$2.30', tone: 'gold', shape: 'diamond' },
              { value: 3.1, label: 'World', detail: '$3.10', tone: 'neutral' },
              { value: 4.99, label: 'Ceiling', detail: '$4.99', tone: 'warning' },
            ]}
          />
          <div className={styles.caption}>
            Value {price(priceValue)} · committed {price(committed)} (applies at month close)
          </div>
        </div>
      </Group>
      <div className={styles.grid2}>
        <Group title="Volume slider">
          <div className={styles.card}>
            <Slider value={volume} min={0} max={100} onChange={setVolume} format={(v) => `${Math.round(v)}%`} aria-label="Music volume" marks={[{ value: 60 }]} />
          </div>
        </Group>
        <Group title="UI scale (80–150%) · disabled">
          <div className={styles.card}>
            <Slider value={scale} min={80} max={150} step={5} onChange={setScale} format={(v) => `${v}%`} aria-label="UI scale" marks={[{ value: 100, label: '100%' }, { value: 125, label: '125%' }]} />
            <div style={{ height: 18 }} />
            <Slider value={40} min={0} max={100} onChange={() => {}} disabled aria-label="Disabled slider" />
          </div>
        </Group>
      </div>
      <Group title="Tabs — underline · pills · small · vertical">
        <div className={styles.card}>
          <Tabs items={TABS} value={tab} onChange={setTab} />
          <div style={{ height: 14 }} />
          <Tabs items={TABS} value={tab} onChange={setTab} variant="pills" />
          <div style={{ height: 14 }} />
          <Tabs items={TABS} value={tab} onChange={setTab} size="sm" />
          <div style={{ height: 14 }} />
          <div style={{ width: 220 }}>
            <Tabs items={TABS} value={tab} onChange={setTab} variant="vertical" />
          </div>
        </div>
      </Group>
    </>
  );
}
