// Placing step: the ghost follows the cursor in the city (W6, via uiStore build
// mode). The drawer explains the controls and offers the fallbacks that work
// without a ghost: the bridge's suggested site, and — when `features.plots` is
// on — a plot list from `parcels`.

import clsx from 'clsx';
import { ArrowLeft, Crosshair, MapPin, Sparkles, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import type { ParcelDto } from '@/bridge/protocol';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useGameStore } from '@/state/gameStore';
import { Badge, Button, DrawerFrame, Kbd, Select, Skeleton } from '@/ui/components';
import { money } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';
import { useBuildFlow } from '../_shared-a/buildFlow';
import { useCatalogIndex, useFeature } from '../_shared-a/catalog';
import { KeyValues, Notice, SectionHead, buildingIcon } from '../_shared-a/pieces';
import { availability, opensText } from './buildModel';
import styles from './Build.module.css';

export function BuildPlacing() {
  const idx = useCatalogIndex();
  const typeId = useBuildFlow((s) => s.typeId);
  const cityId = useBuildFlow((s) => s.cityId);
  const productId = useBuildFlow((s) => s.productId);
  const place = useBuildFlow((s) => s.place);
  const back = useBuildFlow((s) => s.back);
  const setCity = useBuildFlow((s) => s.setCity);
  const start = useBuildFlow((s) => s.start);
  const setActiveCity = useGameStore((s) => s.setActiveCity);
  const plots = useFeature('plots');
  const type = typeId ? idx.types.get(typeId) : undefined;
  const preview = useEngineQuery('previewBuild', typeId && cityId ? { typeId, cityId } : null);
  const parcels = useEngineQuery('parcels', plots && cityId ? { cityId, filter: 'forSale' } : null);
  const Icon = buildingIcon(type);
  const p = preview.data;
  const avail = availability(p);

  const plotList = useMemo(() => rankParcels(parcels.data ?? [], type?.buildMenuGroup === 'retail', type ? { w: type.footprintWidth, h: type.footprintHeight } : null), [parcels.data, type]);

  if (!type || !cityId) return null;

  return (
    <DrawerFrame
      title={`Place a ${type.name}`}
      eyebrow="Build · step 2 of 3"
      icon={<Icon size={17} />}
      subtitle={idx.cityName(cityId)}
      data-testid="panel-build"
      footer={
        <div className={styles.footerRow}>
          <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={back} data-testid="build-back">
            Back
          </Button>
          <Button variant="primary" icon={<Wand2 size={14} />} onClick={() => place({ at: null, source: 'auto' })} disabled={!avail.ok} data-testid="build-auto-site">
            Use the suggested site
          </Button>
        </div>
      }
    >
      <div className={styles.placeHero}>
        <span className={styles.placeIcon}>
          <Crosshair size={22} />
        </span>
        <div>
          <div className={styles.placeTitle}>Click a plot in the city</div>
          <div className={styles.placeText}>
            The footprint turns <span className={styles.ok}>green</span> where you can build and <span className={styles.bad}>red</span> where you can’t, with the reason.
          </div>
          <div className={styles.keys}>
            <span>
              <Kbd small>R</Kbd> rotate
            </span>
            <span>
              <Kbd small>Click</Kbd> place
            </span>
            <span>
              <Kbd small>Esc</Kbd> cancel
            </span>
          </div>
        </div>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.label}>
          <MapPin size={12} /> City
        </span>
        <Select
          size="sm"
          value={cityId}
          options={(idx.catalog?.cities ?? []).map((c) => ({ value: c.id, label: c.name, description: `${compact(c.population)} people` }))}
          onChange={(id) => {
            // Switching the shown city ends W6's ghost (build mode off → the flow
            // resets), so re-enter placing in the new city afterwards.
            const placingType = typeId;
            setActiveCity(id);
            if (placingType) start(placingType, id);
            else setCity(id);
          }}
          aria-label="City"
        />
      </div>

      <SectionHead>At a glance</SectionHead>
      {p ? (
        <KeyValues
          rows={[
            { label: 'Construction', value: money(p.constructionCost) },
            p.landCost !== undefined && { label: 'Land', value: money(p.landCost) },
            { label: 'Running cost', value: `${money(p.monthlyOpex)}/mo` },
            { label: 'Footprint', value: `${p.footprintW}×${p.footprintH} plots` },
            { label: 'Timing', value: opensText(p.constructionMonths) },
            productId ? { label: 'Will sell', value: idx.productName(productId), tone: 'gold' } : null,
          ]}
        />
      ) : (
        <Skeleton height={90} />
      )}

      {!avail.ok && avail.reason && (
        <div className={styles.gap}>
          <Notice tone="danger">{avail.reason}.</Notice>
        </div>
      )}

      {p?.suggestedPlacement && avail.ok && (
        <div className={styles.gap}>
          <Notice tone="opportunity" icon={<Sparkles size={14} />}>
            No time to scout? <strong>Use the suggested site</strong> (plot {p.suggestedPlacement.px}, {p.suggestedPlacement.pz}){p.catchment ? ` — about ${compact(p.catchment.potentialUnitsPerMonth)} shoppers' units a month nearby` : ''}.
          </Notice>
        </div>
      )}

      {plots && (
        <section className={styles.gap}>
          <SectionHead right={plotList.length > 0 ? `${plotList.length} shown` : undefined}>Plots for sale</SectionHead>
          {parcels.error ? (
            <Notice tone="info">The plot list isn’t available in this version; click a plot in the city instead.</Notice>
          ) : plotList.length === 0 ? (
            <Skeleton height={60} />
          ) : (
            <div className={styles.plotList}>
              {plotList.map((pl) => (
                <button key={pl.id} type="button" className={styles.plotRow} onClick={() => place({ at: { px: pl.px, pz: pl.pz, rotation: 0 }, source: 'parcel', parcelId: pl.id }, typeId ?? undefined, cityId)}>
                  <Badge tone="neutral">{pl.zone}</Badge>
                  <span className={styles.plotDims}>
                    {pl.w}×{pl.h}
                  </span>
                  <span className={styles.plotStat}>traffic {Math.round(pl.traffic * 100)}</span>
                  <span className={clsx(styles.plotStat, styles.plotPrice)}>{money(pl.askingPrice ?? pl.landValuePerPlot * pl.w * pl.h)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </DrawerFrame>
  );
}

/** Plots that fit the footprint: busiest first for retail, cheapest first otherwise. */
function rankParcels(parcels: readonly ParcelDto[], retail: boolean, footprint: { w: number; h: number } | null): ParcelDto[] {
  const fits = parcels.filter((p) => p.forSale && (!footprint || ((p.w >= footprint.w && p.h >= footprint.h) || (p.w >= footprint.h && p.h >= footprint.w))));
  const sorted = [...fits].sort((a, b) => (retail ? b.traffic - a.traffic : a.landValuePerPlot - b.landValuePerPlot) || a.id - b.id);
  return sorted.slice(0, 8);
}
