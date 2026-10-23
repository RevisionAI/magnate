// Marketing › Media: the four ad channels — cost per awareness point, the
// bonus for owning a station or publisher of that kind, and which you own.

import { Hammer } from 'lucide-react';
import type { AdChannelDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, Panel, Table } from '@/ui/components';
import { money } from '@/util/format';
import { LoadingBlock, Note, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';
import { CHANNEL } from './brandData';

export function MediaTab() {
  const names = useNames();
  const fmt = useMoneyFormat();
  const buildings = useGameStore((s) => s.buildings);
  const channels = names.catalog?.adChannels ?? [];
  if (!names.catalog) return <LoadingBlock rows={4} />;
  const ownedOf = (c: AdChannelDto) => buildings.filter((b) => b.typeId === c.mediaBuildingTypeId && b.ownerId === names.playerId);
  return (
    <div className={shared.page}>
      <Note>
        Owning a station or publisher makes every campaign on that channel stretch further: the same budget buys more awareness points, in every city.
      </Note>
      <Panel title="Channels" padding="none" variant="solid" data-testid="media-table">
        <Table<AdChannelDto>
          rowKey={(c) => c.id}
          rows={channels}
          columns={[
            {
              id: 'ch',
              header: 'Channel',
              cell: (c) => {
                const Icon = CHANNEL[c.id].icon;
                return (
                  <span className={shared.cellName}>
                    <Icon size={15} />
                    <span>
                      <b>{CHANNEL[c.id].label}</b>
                      <span className={shared.cellSub}>{CHANNEL[c.id].blurb}</span>
                    </span>
                  </span>
                );
              },
            },
            { id: 'cpp', header: 'Cost per point', numeric: true, cell: (c) => money(c.costPerPoint, 0) },
            { id: 'per50', header: '$50K buys', numeric: true, hint: 'Awareness points before saturation', cell: (c) => `${(50_000 / c.costPerPoint).toFixed(1)} pts` },
            { id: 'bonus', header: 'Owner bonus', numeric: true, cell: (c) => (c.ownershipBonus > 1 ? `×${c.ownershipBonus.toFixed(2)}` : '—') },
            { id: 'type', header: 'Media business', cell: (c) => (c.mediaBuildingTypeId ? names.buildingType(c.mediaBuildingTypeId) : '—') },
            {
              id: 'owned',
              header: 'You own',
              cell: (c) => {
                const owned = ownedOf(c);
                return owned.length ? <Badge tone="gold">{owned.length} · bonus active</Badge> : <span className={shared.dim}>None</span>;
              },
            },
            {
              id: 'cost',
              header: 'Build cost',
              numeric: true,
              cell: (c) => {
                const t = names.catalog?.buildingTypes.find((b) => b.id === c.mediaBuildingTypeId);
                return t ? fmt(t.constructionCost) : '—';
              },
            },
            {
              id: 'go',
              header: '',
              align: 'right',
              cell: (c) =>
                c.mediaBuildingTypeId ? (
                  <Button size="sm" variant="ghost" icon={<Hammer size={12} />} onClick={() => useUiStore.getState().openPanel('build', { typeId: c.mediaBuildingTypeId, group: 'media' })}>
                    Build
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>
    </div>
  );
}
