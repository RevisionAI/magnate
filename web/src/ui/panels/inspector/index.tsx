// Building inspector drawer (UX §6.7): Overview · Layout · Setup · Finance.
// Opens on selection (Hud keeps `selectedBuildingId` and this drawer in sync) or
// by deep link: `openPanel('inspector', { buildingId, tab, slotIndex })`.
// Everything comes from the bridge's `building` query; mutations go through
// `_shared-a/commands` and apply at the next month close.

import { Building, LocateFixed, Megaphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { bus } from '@/game/events';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { DrawerFrame, Emblem, EmptyState, IconButton, Skeleton, Stack, type TabItem } from '@/ui/components';
import { useCatalogIndex } from '../_shared-a/catalog';
import { StatusBadge, buildingIcon } from '../_shared-a/pieces';
import type { PanelProps } from '../registry';
import { FinanceTab } from './FinanceTab';
import type { InspectorTab } from './inspectorModel';
import { LayoutTab } from './LayoutTab';
import { OverviewTab } from './OverviewTab';
import { SetupTab } from './SetupTab';
import styles from './Inspector.module.css';

const ALL_TABS: TabItem<InspectorTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'layout', label: 'Layout' },
  { id: 'setup', label: 'Setup' },
  { id: 'finance', label: 'Finance' },
];

const isTab = (v: unknown): v is InspectorTab => v === 'overview' || v === 'layout' || v === 'setup' || v === 'finance';

export default function InspectorPanel({ params }: PanelProps) {
  const selected = useGameStore((s) => s.selectedBuildingId);
  const buildingId = typeof params.buildingId === 'number' ? params.buildingId : selected;
  const summary = useGameStore((s) => s.buildings.find((b) => b.id === buildingId));
  const owner = useGameStore((s) => s.hud?.companies.find((c) => c.id === summary?.ownerId));
  const idx = useCatalogIndex();
  const query = useEngineQuery('building', buildingId !== null && buildingId !== undefined ? { buildingId } : null);
  const detail = query.data && query.data.id === buildingId ? query.data : undefined;
  const [tab, setTab] = useState<InspectorTab>(isTab(params.tab) ? params.tab : 'overview');
  const [focusSlot, setFocusSlot] = useState<number | null>(typeof params.slotIndex === 'number' ? params.slotIndex : null);

  // A deep link to a different tab/slot while the drawer is open.
  useEffect(() => {
    if (isTab(params.tab)) setTab(params.tab);
    if (typeof params.slotIndex === 'number') setFocusSlot(params.slotIndex);
  }, [params.tab, params.slotIndex, params.buildingId]);

  const tabs = detail && !detail.isPlayer ? ALL_TABS.filter((t) => t.id !== 'setup') : ALL_TABS;
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const go = (next: InspectorTab, slotIndex?: number) => {
    setFocusSlot(slotIndex ?? null);
    setTab(next);
  };

  if (buildingId === null || buildingId === undefined) {
    return (
      <DrawerFrame title="Building" icon={<Building size={17} />} data-testid="panel-inspector">
        <EmptyState compact icon={<Building size={18} />} title="Nothing selected" body="Click a building in the city, or pick one in the Company overview (M)." />
      </DrawerFrame>
    );
  }

  const type = idx.types.get(detail?.typeId ?? summary?.typeId ?? '');
  const Icon = buildingIcon(type);
  const title = summary?.name ?? detail?.typeName ?? type?.name ?? 'Building';
  const isPlayer = detail?.isPlayer ?? owner?.isPlayer ?? false;
  const productId = detail?.slots[0]?.productId ?? summary?.products[0] ?? null;
  const cityId = detail?.cityId ?? summary?.cityId ?? null;

  return (
    <DrawerFrame
      title={title}
      eyebrow={isPlayer ? 'Your building' : owner ? `Owned by ${owner.name}` : detail ? `Owned by ${detail.ownerName}` : 'Building'}
      subtitle={
        <span className={styles.subtitle}>
          {detail?.cityName ?? (cityId ? idx.cityName(cityId) : '')} · Level {detail?.level ?? summary?.level ?? 1}
          {detail && detail.maxLevel > 1 ? ` of ${detail.maxLevel}` : ''}
          {summary && <StatusBadge status={summary.status} />}
        </span>
      }
      icon={owner ? <Emblem shape={owner.emblem} color={owner.color} size={22} ring={owner.isPlayer} /> : <Icon size={17} />}
      tabs={tabs}
      tab={activeTab}
      onTabChange={(t) => go(t)}
      actions={
        <>
          {isPlayer && productId && cityId && (
            <IconButton size="sm" label="Advertise here" icon={<Megaphone size={15} />} onClick={() => useUiStore.getState().openPanel('marketing', { productId, cityId })} tooltipSide="bottom" data-testid="inspector-advertise" />
          )}
          <IconButton size="sm" label="Locate in the city" icon={<LocateFixed size={15} />} onClick={() => bus.emit('locate', { buildingId })} tooltipSide="bottom" data-testid="inspector-locate" />
        </>
      }
      data-testid="panel-inspector"
    >
      {!detail ? (
        query.error ? (
          <EmptyState compact icon={<Building size={18} />} title="This building is gone" body="It may have been sold or demolished." />
        ) : (
          <Stack gap={3}>
            <Skeleton height={64} />
            <Skeleton height={120} />
            <Skeleton height={90} />
          </Stack>
        )
      ) : activeTab === 'overview' ? (
        <OverviewTab detail={detail} go={go} />
      ) : activeTab === 'layout' ? (
        <LayoutTab detail={detail} go={go} />
      ) : activeTab === 'setup' ? (
        <SetupTab key={detail.id} detail={detail} focusSlot={focusSlot} onFocusSlot={setFocusSlot} />
      ) : (
        <FinanceTab detail={detail} />
      )}
    </DrawerFrame>
  );
}
