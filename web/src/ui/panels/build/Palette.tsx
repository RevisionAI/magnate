// Build palette: category tabs, one card per building type (cost, footprint,
// running cost, units, build time, requirements, affordability) and starter
// suggestions. Clicking a card starts placement; the ⚡ button quick-builds on
// the bridge's suggested site.

import clsx from 'clsx';
import { Hammer, Lightbulb, MapPin, Sparkles, X, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BuildMenuGroup, BuildingTypeDto } from '@/bridge/protocol';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useGameStore } from '@/state/gameStore';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, DrawerFrame, IconButton, Select, Spinner, Tooltip, type TabItem } from '@/ui/components';
import { money } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';
import { useBuildFlow } from '../_shared-a/buildFlow';
import { useCatalogIndex, usePlayerCash } from '../_shared-a/catalog';
import { constructBuilding } from '../_shared-a/commands';
import { ProductGlyph, buildingIcon } from '../_shared-a/pieces';
import { GROUPS, availability, groupTypes, maxCapacity, opensText, pitch, requirements, suggestions, type Suggestion } from './buildModel';
import styles from './Build.module.css';

export function BuildPalette() {
  const idx = useCatalogIndex();
  const types = idx.catalog?.buildingTypes ?? [];
  const cities = idx.catalog?.cities ?? [];
  const cityId = useGameStore((s) => s.activeCityId);
  const setActiveCity = useGameStore((s) => s.setActiveCity);
  const ownCount = useGameStore((s) => s.hud?.player?.buildings ?? 0);
  const cash = usePlayerCash();
  const productId = useBuildFlow((s) => s.productId);
  const setProduct = useBuildFlow((s) => s.setProduct);
  const start = useBuildFlow((s) => s.start);
  const byGroup = useMemo(() => groupTypes(types), [types]);
  const presetType = productId ? types.find((t) => t.buildMenuGroup === 'retail' && t.eligibleProductIds.includes(productId)) : undefined;
  const [group, setGroup] = useState<BuildMenuGroup>(presetType?.buildMenuGroup ?? 'retail');
  const city = cityId ? idx.cities.get(cityId) : undefined;

  const opps = useEngineQuery('marketOpportunities', ownCount < 4 ? {} : null);
  const picks = useMemo(
    () =>
      ownCount < 4
        ? suggestions({
            plans: idx.catalog?.starterPlans ?? [],
            types: idx.types,
            cities,
            cash,
            productName: idx.productName,
            cityName: idx.cityName,
            opportunity: opps.data?.enter[0] ?? null,
          })
        : [],
    [ownCount, idx, cities, cash, opps.data],
  );

  const tabs: TabItem<BuildMenuGroup>[] = GROUPS.map((g) => ({ id: g.id, label: g.label, disabled: !byGroup.has(g.id), hint: g.hint }));
  const groupHint = GROUPS.find((g) => g.id === group)?.hint;

  const runSuggestion = (s: Suggestion) => {
    if (s.cityId !== cityId) setActiveCity(s.cityId);
    setProduct(s.productId);
    start(s.typeId, s.cityId, s.productId);
  };

  return (
    <DrawerFrame
      title="Build"
      icon={<Hammer size={17} />}
      subtitle={
        <span>
          {city ? `In ${city.name}` : 'Choose a city'} · cash <span className={styles.subCash}>{money(cash)}</span>
        </span>
      }
      tabs={tabs}
      tab={group}
      onTabChange={setGroup}
      data-testid="panel-build"
    >
      <div className={styles.toolbar}>
        <span className={styles.label}>
          <MapPin size={12} /> City
        </span>
        <Select
          size="sm"
          value={cityId}
          options={cities.map((c) => ({ value: c.id, label: c.name, description: `${compact(c.population)} people${c.coastal ? ' · coast' : ''}` }))}
          onChange={setActiveCity}
          aria-label="City to build in"
        />
      </div>

      {productId && (
        <div className={styles.preset} data-testid="build-preset">
          <ProductGlyph product={idx.products.get(productId)} size="sm" />
          <span>
            Building to sell <strong>{idx.productName(productId)}</strong>
            {city ? ` in ${city.name}` : ''} — pick a store.
          </span>
          <IconButton size="sm" label="Clear" icon={<X size={13} />} onClick={() => setProduct(null)} noTooltip />
        </div>
      )}

      {picks.length > 0 && !productId && (
        <section className={styles.suggest} data-testid="build-suggestions">
          <div className={styles.suggestHead}>
            <Sparkles size={13} /> Suggested for you
          </div>
          {picks.map((s) => {
            const t = idx.types.get(s.typeId);
            const short = (t?.constructionCost ?? 0) > cash;
            return (
              <button key={s.id} type="button" className={styles.suggestRow} onClick={() => runSuggestion(s)} disabled={short} data-testid={`build-suggest-${s.typeId}`}>
                {s.productId ? <ProductGlyph product={idx.products.get(s.productId)} size="sm" /> : <Lightbulb size={14} />}
                <span className={styles.suggestBody}>
                  <span className={styles.suggestLabel}>{s.label}</span>
                  <span className={styles.suggestWhy}>
                    {s.why}
                    {s.source === 'starter' && s.cityId !== cityId ? ` · ${idx.cityName(s.cityId)}` : ''}
                  </span>
                </span>
                <span className={clsx(styles.suggestCost, short && styles.short)}>{t ? money(t.constructionCost) : ''}</span>
              </button>
            );
          })}
        </section>
      )}

      {groupHint && <p className={styles.groupHint}>{groupHint}</p>}
      <div className={styles.grid}>
        {(byGroup.get(group) ?? []).map((t) => (
          <BuildCard key={t.id} type={t} cityId={cityId} productId={productId} onPick={() => cityId && start(t.id, cityId, productId)} />
        ))}
      </div>
    </DrawerFrame>
  );
}

function BuildCard({ type, cityId, productId, onPick }: { type: BuildingTypeDto; cityId: string | null; productId: string | null; onPick: () => void }) {
  const preview = useEngineQuery('previewBuild', cityId ? { typeId: type.id, cityId } : null);
  const p = preview.data;
  const avail = availability(p, { productId: productId && type.buildMenuGroup === 'retail' ? productId : null });
  const [busy, setBusy] = useState(false);
  const Icon = buildingIcon(type);
  const reqs = requirements(type);
  const capMax = maxCapacity(type);
  const cap = p?.capacity ?? type.maxUnits;
  const total = p?.totalCost ?? type.constructionCost;
  const disabled = !cityId || !avail.ok;

  const quickBuild = async () => {
    if (!cityId || busy) return;
    setBusy(true);
    try {
      const res = await constructBuilding({ typeId: type.id, cityId }, total, `${type.name} ordered`);
      if (res.ok) {
        const built = res.result;
        useBuildFlow.getState().reset();
        const ui = useUiStore.getState();
        ui.closePanel('build');
        ui.openPanel('inspector', { buildingId: built.id, tab: built.configuredSlots === 0 && type.slotKind !== 'none' ? 'setup' : 'overview' });
        useGameStore.getState().selectBuilding(built.id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={clsx(styles.card, disabled && styles.cardDisabled)}>
      <button type="button" className={styles.cardMain} onClick={onPick} disabled={disabled} data-testid={`build-card-${type.id}`} aria-label={`Place a ${type.name}`}>
        <span className={styles.cardTop}>
          <span className={styles.icon}>
            <Icon size={15} />
          </span>
          <span className={styles.name}>{type.name}</span>
        </span>
        <span className={styles.cost}>
          {money(total)}
          {p?.landCost !== undefined && p.landCost > 0 && <span className={styles.land}> incl. land</span>}
        </span>
        <span className={styles.pitch}>{pitch(type)}</span>
        <span className={styles.meta}>
          <span>{money(p?.monthlyOpex ?? type.monthlyOperatingCost)}/mo</span>
          <span>
            {type.footprintWidth}×{type.footprintHeight} plots
          </span>
          {type.slotKind !== 'none' && (
            <span>
              {cap}
              {capMax > cap ? `→${capMax}` : ''} units
            </span>
          )}
        </span>
        <span className={styles.metaFoot}>
          <span>{opensText(p?.constructionMonths)}</span>
          {reqs.map((r) => (
            <Badge key={r} tone="info">
              {r}
            </Badge>
          ))}
        </span>
        {avail.reason && <span className={clsx(styles.reason, avail.kind === 'cash' && styles.reasonCash)}>{avail.reason}</span>}
      </button>
      {cityId && (
        <span className={styles.quick}>
          {busy ? (
            <Spinner />
          ) : (
            <Tooltip title="Quick build" content="Build now on the best available site. You can set it up right after." side="left">
              <Button size="sm" variant="ghost" round icon={<Zap size={13} />} onClick={() => void quickBuild()} disabled={disabled} aria-label={`Quick build a ${type.name}`} data-testid={`build-${type.id}`} sound="confirm" />
            </Tooltip>
          )}
        </span>
      )}
    </div>
  );
}
