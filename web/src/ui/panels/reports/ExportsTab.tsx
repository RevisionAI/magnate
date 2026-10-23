// Exports (bridge-spec §5.8 `exports`): revenue and exact units shipped to the
// world market by product and by building, with the average realised price.

import { useState } from 'react';
import type { ExportBuildingRowDto, ExportProductRowDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Ship } from 'lucide-react';
import { BarChart, Button, EmptyState, Panel, Stat, Table } from '@/ui/components';
import { compact, money, price } from '@/util/format';
import { ErrorBlock, LoadingBlock, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { PresetPicker, type Preset } from '../_shared-b/PeriodPicker';
import shared from '../_shared-b/shared.module.css';

export function ExportsTab() {
  const [preset, setPreset] = useState<Preset>('last12');
  const names = useNames();
  const fmt = useMoneyFormat();
  const { data, error } = useEngineQuery('exports', { period: { preset } });
  const selectBuilding = useGameStore((s) => s.selectBuilding);
  const open = (id: number) => {
    useUiStore.getState().closeOverlay();
    selectBuilding(id);
  };
  return (
    <div className={shared.page}>
      <div className={shared.toolbar}>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      {error && !data ? (
        <ErrorBlock error={error} />
      ) : !data ? (
        <LoadingBlock rows={8} />
      ) : data.byProduct.length === 0 ? (
        <Panel padding="lg" variant="solid" data-testid="exports-empty">
          <EmptyState
            icon={<Ship size={22} />}
            title="No exports in this period"
            body="Farms, mines and factories with auto-export switched on sell their surplus output to the world market — at the export price, which sits below the world price. Turn it on in a production building’s inspector."
            action={
              <Button size="sm" variant="secondary" onClick={() => useUiStore.getState().openPanel('build', { group: 'production' })}>
                Production buildings
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className={shared.kpis}>
            <Stat tile size="sm" label="Export revenue" value={fmt(data.totalRevenue)} />
            <Stat tile size="sm" label="Units shipped" value={compact(data.totalUnits)} />
            <Stat tile size="sm" label="Products" value={data.byProduct.length} />
            <Stat tile size="sm" label="Exporting sites" value={data.byBuilding.length} />
          </div>
          <div className={shared.split}>
            <div className={shared.stack}>
              <Panel title="By product" padding="none" variant="solid">
                <Table<ExportProductRowDto>
                  rowKey={(r) => r.productId}
                  rows={data.byProduct}
                  defaultSort={{ id: 'rev', dir: 'desc' }}
                  columns={[
                    { id: 'p', header: 'Product', sortValue: (r) => names.product(r.productId), cell: (r) => names.product(r.productId) },
                    { id: 'units', header: 'Units', numeric: true, sortValue: (r) => r.units, cell: (r) => compact(r.units) },
                    { id: 'avg', header: 'Avg price', numeric: true, sortValue: (r) => r.avgPrice ?? null, cell: (r) => (r.avgPrice !== undefined ? price(r.avgPrice) : '—') },
                    { id: 'rev', header: 'Revenue', numeric: true, sortValue: (r) => r.revenue, cell: (r) => <b>{fmt(r.revenue)}</b> },
                  ]}
                />
              </Panel>
              <Panel title="By building" padding="none" variant="solid">
                <Table<ExportBuildingRowDto>
                  rowKey={(r) => r.buildingId}
                  rows={data.byBuilding}
                  defaultSort={{ id: 'rev', dir: 'desc' }}
                  onRowClick={(r) => open(r.buildingId)}
                  columns={[
                    { id: 'b', header: 'Building', sortValue: (r) => names.building(r.buildingId), cell: (r) => names.building(r.buildingId) },
                    { id: 'c', header: 'City', sortValue: (r) => names.city(r.cityId), cell: (r) => names.city(r.cityId) },
                    { id: 'units', header: 'Units', numeric: true, sortValue: (r) => r.units, cell: (r) => compact(r.units) },
                    { id: 'rev', header: 'Revenue', numeric: true, sortValue: (r) => r.revenue, cell: (r) => <b>{fmt(r.revenue)}</b> },
                  ]}
                />
              </Panel>
            </div>
            <Panel title="Export revenue by product" padding="md" variant="solid">
              <BarChart height={220} yFormat={(v) => money(v, 1)} data={data.byProduct.map((r) => ({ label: names.product(r.productId), value: r.revenue }))} />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
