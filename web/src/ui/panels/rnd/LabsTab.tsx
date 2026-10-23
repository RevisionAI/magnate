// R&D › Labs: each of your R&D centres with what every research unit works on,
// its progress and ETA; reassign a unit or put a free one to work in place.

import { FlaskConical, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BuildingDetailDto, SlotDetailDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { engineMutate } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, IconButton, Panel, Progress, Select } from '@/ui/components';
import { durationMonths } from '@/util/format';
import { ErrorBlock, FeatureGate, LoadingBlock, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';
import { useEngineQueries } from '../_shared-b/useEngineQueries';
import { openBuildLab, playerLabs } from './research';
import styles from './Rnd.module.css';

export function LabsTab() {
  const names = useNames();
  const buildings = useGameStore((s) => s.buildings);
  const labs = playerLabs(buildings, names.playerId);
  const args = useMemo(() => labs.map((b) => ({ buildingId: b.id })), [labs]);
  const q = useEngineQueries('building', args);
  if (labs.length === 0) {
    return (
      <FeatureGate
        kicker="No lab yet"
        icon={<FlaskConical size={20} />}
        title="Build an R&D centre to start researching"
        body="Each centre holds research units. Point a unit at a product and its technology level rises month by month — better products sell for more, and the first to the top level wins a patent."
      >
        <Button variant="primary" icon={<FlaskConical size={15} />} onClick={() => openBuildLab()} style={{ marginTop: 14 }}>
          Build an R&D centre
        </Button>
      </FeatureGate>
    );
  }
  if (q.error && q.data.every((d) => !d)) return <ErrorBlock error={q.error} />;
  return (
    <div className={shared.page}>
      <div className={styles.labs}>
        {labs.map((lab, i) => {
          const detail = q.data[i];
          return detail ? <LabCard key={lab.id} lab={detail} /> : <LoadingBlock key={lab.id} rows={4} />;
        })}
      </div>
      <div>
        <Button variant="ghost" icon={<FlaskConical size={14} />} onClick={() => openBuildLab()}>
          Build another R&D centre
        </Button>
      </div>
    </div>
  );
}

function LabCard({ lab }: { lab: BuildingDetailDto }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const eligible = lab.actions.eligibleProductIds;
  const options = eligible.map((id) => ({ value: id, label: names.product(id) })).sort((a, b) => a.label.localeCompare(b.label));
  const [busy, setBusy] = useState<number | null>(null);
  const assign = async (slotIndex: number, productId: string) => {
    setBusy(slotIndex);
    await engineMutate('configureSlot', { buildingId: lab.id, slotIndex, productId });
    await useGameStore.getState().refreshBuildings();
    setBusy(null);
  };
  const free = Array.from({ length: lab.capacity }, (_, i) => i).filter((i) => !lab.slots.some((s) => s.index === i));
  return (
    <Panel padding="none" variant="solid" data-testid={`lab-${lab.id}`}>
      <div className={styles.labHead}>
        <div>
          <b>{names.building(lab.id)}</b>
          <div className={`${shared.tiny} ${shared.dim}`}>
            {lab.cityName} · level {lab.level} · {fmt(lab.monthlyOpex)}/month
          </div>
        </div>
        <span className={shared.chips}>
          <Badge tone={lab.slotsUsed < lab.capacity ? 'opportunity' : 'neutral'}>
            {lab.slotsUsed}/{lab.capacity} units busy
          </Badge>
          <IconButton
            size="sm"
            label="Show in the city"
            icon={<MapPin size={13} />}
            onClick={() => {
              useUiStore.getState().closeOverlay();
              selectBuilding(lab.id);
            }}
          />
        </span>
      </div>
      {lab.slots.map((slot) => (
        <SlotRow key={slot.index} slot={slot} options={options} busy={busy === slot.index} onAssign={(p) => void assign(slot.index, p)} />
      ))}
      {free.map((index) => (
        <div key={`free-${index}`} className={styles.slot}>
          <span className={styles.slotIndex}>{index + 1}</span>
          <span className={styles.slotFree}>Free research unit</span>
          <span />
          <Select<string> size="sm" aria-label="Research product" value={null} placeholder="Research…" options={options} onChange={(p) => void assign(index, p)} />
        </div>
      ))}
    </Panel>
  );
}

function SlotRow({ slot, options, busy, onAssign }: { slot: SlotDetailDto; options: { value: string; label: string }[]; busy: boolean; onAssign: (productId: string) => void }) {
  const r = slot.research;
  return (
    <div className={styles.slot}>
      <span className={styles.slotIndex}>{slot.index + 1}</span>
      <span>
        <b>{slot.productName}</b>
        <span className={shared.cellSub}>
          {r ? `Tech ${r.tech}/${r.maxTech}` : ''}
          {r?.blocked ? ' · blocked by a rival patent' : r && r.etaMonths !== undefined ? ` · next level in ${durationMonths(r.etaMonths)}` : r && r.tech >= r.maxTech ? ' · at maximum' : ''}
        </span>
      </span>
      {r ? <Progress size="sm" value={r.threshold ? r.progress / r.threshold : 1} tone={r.blocked ? 'danger' : 'info'} /> : <span />}
      <Select<string> size="sm" aria-label="Reassign research unit" value={slot.productId} options={options} onChange={(p) => p !== slot.productId && onAssign(p)} disabled={busy} />
    </div>
  );
}
