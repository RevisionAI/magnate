// Marketing › Campaigns: what you spend, where, and what it buys — each
// campaign's brand against the city's leader with next month's projection —
// plus the campaign editor with live preview and 12-month forecast.

import { AlertTriangle, Megaphone, Pencil, Square, Store } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AdCampaignDto, AdChannelId } from '@/bridge/protocol';
import { fx } from '@/game/fx';
import { useGameStore } from '@/state/gameStore';
import { engineMutate, useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, LineChart, Meter, Panel, Select, Slider, Stat, Table, Tooltip } from '@/ui/components';
import { addMonths, money } from '@/util/format';
import { brandForecast, monthsToReach } from '../_shared-b/brand';
import { CompanyTag, ErrorBlock, LoadingBlock, Note, pct, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { shortMonth } from '../_shared-b/periods';
import shared from '../_shared-b/shared.module.css';
import { brandKey, CHANNEL, CHANNEL_ORDER, useBrandIndex } from './brandData';
import type { CampaignDraftSeed } from './index';
import styles from './Marketing.module.css';

export function CampaignsTab({ seed, onSeed }: { seed: CampaignDraftSeed; onSeed: (s: CampaignDraftSeed) => void }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const { data, error } = useEngineQuery('adCampaigns', {});
  const brands = useBrandIndex(names.playerId);
  const [busy, setBusy] = useState<string | null>(null);

  const stop = async (c: AdCampaignDto) => {
    setBusy(`${c.productId}|${c.cityId}|${c.channel}`);
    await engineMutate('cancelAdCampaign', { productId: c.productId, cityId: c.cityId, channel: c.channel });
    setBusy(null);
  };

  if (error && !data) return <ErrorBlock error={error} />;
  if (!data) return <LoadingBlock rows={8} chart />;
  const wasted = data.campaigns.filter((c) => !c.hasRetailPresence).reduce((s, c) => s + c.monthlyBudget, 0);

  return (
    <div className={shared.page}>
      <div className={shared.kpis}>
        <Stat tile size="sm" label="Ad spend" value={`${fmt(data.totalMonthlySpend)}/mo`} />
        <Stat tile size="sm" label="Active campaigns" value={data.campaigns.length} />
        <Stat tile size="sm" label="Brand fades" value={`${pct(data.brandDecayRate, 0)}/mo`} foot="when you stop advertising" />
        <Stat tile size="sm" label="Spent where you have no store" value={`${fmt(wasted)}/mo`} tone={wasted > 0 ? 'neg' : 'default'} foot={wasted > 0 ? 'earns nothing until a store sells it' : 'none — good'} />
      </div>
      <div className={shared.splitWide}>
        <div className={shared.stack}>
          <Panel title="Campaigns" padding="none" variant="solid" data-testid="campaigns-table">
            <Table<AdCampaignDto>
              rowKey={(c) => `${c.productId}|${c.cityId}|${c.channel}`}
              rows={data.campaigns}
              defaultSort={{ id: 'budget', dir: 'desc' }}
              onRowClick={(c) => onSeed({ productId: c.productId, cityId: c.cityId, channel: c.channel })}
              selectedKey={seed.productId && seed.cityId && seed.channel ? `${seed.productId}|${seed.cityId}|${seed.channel}` : null}
              empty={
                <span>
                  No campaigns running. Plan one below — awareness builds month by month and fades when you stop.
                </span>
              }
              columns={[
                { id: 'p', header: 'Product', sortValue: (c) => names.product(c.productId), cell: (c) => <b>{names.product(c.productId)}</b> },
                { id: 'c', header: 'City', sortValue: (c) => names.city(c.cityId), cell: (c) => names.city(c.cityId) },
                {
                  id: 'ch',
                  header: 'Channel',
                  sortValue: (c) => c.channel,
                  cell: (c) => {
                    const Icon = CHANNEL[c.channel].icon;
                    return (
                      <span className={shared.cellName}>
                        <Icon size={13} /> {CHANNEL[c.channel].label}
                        {c.mediaBonus > 1 && <Badge tone="gold">×{c.mediaBonus.toFixed(2)}</Badge>}
                      </span>
                    );
                  },
                },
                { id: 'budget', header: 'Budget / mo', numeric: true, sortValue: (c) => c.monthlyBudget, cell: (c) => fmt(c.monthlyBudget) },
                {
                  id: 'brand',
                  header: 'Brand you / leader',
                  sortValue: (c) => c.brand,
                  width: '24%',
                  cell: (c) => {
                    const cell = brands.get(brandKey(c.productId, c.cityId));
                    const leader = cell?.leader ?? null;
                    return (
                      <div className={styles.brandCell}>
                        <Meter value={c.brand} min={0} max={100} segments={20} label="Your brand" thresholds={[{ at: 0, tone: 'info' }, { at: 0.5, tone: 'success' }, { at: 0.7, tone: 'gold' }]} />
                        <span className={shared.num}>
                          <b>{Math.round(c.brand)}</b>
                          <span className={shared.dim}> / {leader ? Math.round(leader.brand) : '—'}</span>
                        </span>
                        {leader && (
                          <Tooltip content={`${names.company(leader.companyId).name} leads rivals here`}>
                            <span>
                              <CompanyTag company={names.company(leader.companyId)} size={10} you={false} className={styles.leaderTag} />
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    );
                  },
                },
                {
                  id: 'next',
                  header: 'Next month',
                  numeric: true,
                  sortValue: (c) => c.projectedBrand - c.brand,
                  cell: (c) => {
                    const d = c.projectedBrand - c.brand;
                    return <span className={d > 0.05 ? shared.pos : d < -0.05 ? shared.neg : shared.dim}>{d >= 0 ? '+' : '−'}{Math.abs(d).toFixed(1)}</span>;
                  },
                },
                {
                  id: 'store',
                  header: 'Store',
                  cell: (c) =>
                    c.hasRetailPresence ? (
                      <Badge tone="success">
                        <Store size={11} /> Selling
                      </Badge>
                    ) : (
                      <Tooltip content="You sell this product nowhere in this city — the campaign earns nothing.">
                        <Badge tone="danger">
                          <AlertTriangle size={11} /> No store
                        </Badge>
                      </Tooltip>
                    ),
                },
                {
                  id: 'act',
                  header: '',
                  align: 'right',
                  cell: (c) => (
                    <span className={shared.chips}>
                      <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={(e) => (e.stopPropagation(), onSeed({ productId: c.productId, cityId: c.cityId, channel: c.channel }))}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" icon={<Square size={11} />} loading={busy === `${c.productId}|${c.cityId}|${c.channel}`} onClick={(e) => (e.stopPropagation(), void stop(c))}>
                        Stop
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
          <BrandHistory />
        </div>
        <CampaignEditor seed={seed} campaigns={data.campaigns} decayRate={data.brandDecayRate} />
      </div>
    </div>
  );
}

function BrandHistory() {
  const names = useNames();
  const ids = names.companies.map((c) => c.id);
  const { data } = useEngineQuery('history', ids.length ? { series: ['topBrand'], companyIds: ids } : null);
  if (!data) return null;
  const labels = Array.from({ length: data.months }, (_, i) => shortMonth(addMonths(data.start, i)));
  return (
    <Panel title="Best brand awareness — you against your rivals" padding="md" variant="solid">
      <LineChart
        height={190}
        labels={labels}
        yFormat={(v) => String(Math.round(v))}
        series={data.companies
          .slice()
          .sort((a, b) => (a.companyId === names.playerId ? -1 : b.companyId === names.playerId ? 1 : 0))
          .map((c) => {
            const ref = names.company(c.companyId);
            return { id: String(c.companyId), label: ref.name + (ref.isPlayer ? ' (you)' : ''), values: c.series.topBrand ?? [], color: ref.color, area: ref.isPlayer };
          })}
      />
    </Panel>
  );
}

// ------------------------------------------------------------------ editor

interface Draft {
  productId: string;
  cityId: string;
  channel: AdChannelId;
  budget: number;
}

const BUDGET_STEPS = [10_000, 25_000, 50_000, 100_000, 200_000];

function CampaignEditor({ seed, campaigns, decayRate }: { seed: CampaignDraftSeed; campaigns: AdCampaignDto[]; decayRate: number }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const catalog = names.catalog;
  const buildings = useGameStore((s) => s.buildings);
  const { data: intel } = useEngineQuery('marketIntel', { playerOnly: true });
  const products = useMemo(() => (catalog?.products ?? []).filter((p) => p.tier === 'finished').map((p) => ({ value: p.id, label: p.name })), [catalog]);
  const cities = useMemo(() => (catalog?.cities ?? []).slice().sort((a, b) => b.population - a.population).map((c) => ({ value: c.id, label: c.name })), [catalog]);

  // Context first (UX §6.1.5): the product/city you came from, else your biggest served market.
  const fallback = useMemo(() => {
    const best = (intel?.rows ?? []).filter((r) => r.playerPresent).sort((a, b) => b.potentialDemand - a.potentialDemand)[0];
    return { productId: best?.productId ?? products[0]?.value ?? '', cityId: best?.cityId ?? cities[0]?.value ?? '' };
  }, [intel, products, cities]);
  const initial = (): Draft => {
    const productId = seed.productId ?? fallback.productId;
    const cityId = seed.cityId ?? fallback.cityId;
    const existing = campaigns.find((c) => c.productId === productId && c.cityId === cityId && (!seed.channel || c.channel === seed.channel));
    return { productId, cityId, channel: existing?.channel ?? seed.channel ?? 'tv', budget: existing?.monthlyBudget ?? 50_000 };
  };
  const [draft, setDraft] = useState<Draft>(initial);
  const [committed, setCommitted] = useState(draft.budget);
  useEffect(() => {
    const next = initial();
    setDraft(next);
    setCommitted(next.budget);
    // Reset only when the seed (or the fallback market) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, fallback.productId, fallback.cityId]);

  const existing = campaigns.find((c) => c.productId === draft.productId && c.cityId === draft.cityId && c.channel === draft.channel) ?? null;
  const args = draft.productId && draft.cityId ? { productId: draft.productId, cityId: draft.cityId, channel: draft.channel, monthlyBudget: committed } : null;
  const { data: preview, error } = useEngineQuery('previewAdCampaign', args);
  const forecast = preview ? brandForecast(preview, decayRate) : null;
  const owned = (channel: AdChannelId) => {
    const typeId = catalog?.adChannels.find((a) => a.id === channel)?.mediaBuildingTypeId;
    return typeId ? buildings.filter((b) => b.typeId === typeId && b.ownerId === names.playerId).length : 0;
  };
  const [busy, setBusy] = useState(false);

  const launch = async (budget: number) => {
    setBusy(true);
    const r = await engineMutate('setAdCampaign', { productId: draft.productId, cityId: draft.cityId, channel: draft.channel, monthlyBudget: budget });
    setBusy(false);
    if (r && budget > 0 && !existing) fx.popup({ text: `Campaign: ${names.product(draft.productId)}`, tone: 'gold', anchor: 'topbar.cash' });
  };

  const months = Array.from({ length: 13 }, (_, i) => (i === 0 ? 'Now' : `+${i}`));
  const reach50 = forecast ? monthsToReach(forecast.keep, 50) : null;

  return (
    <Panel title={existing ? 'Edit campaign' : 'Plan a campaign'} padding="md" variant="solid" accent data-testid="campaign-editor">
      <div className={shared.stackTight}>
        <div className={styles.pickers}>
          <Select<string> size="sm" full aria-label="Product" value={draft.productId || null} options={products} onChange={(productId) => setDraft({ ...draft, productId })} data-testid="campaign-product" />
          <Select<string> size="sm" full aria-label="City" value={draft.cityId || null} options={cities} onChange={(cityId) => setDraft({ ...draft, cityId })} data-testid="campaign-city" />
        </div>
        <div className={styles.channels} role="radiogroup" aria-label="Channel">
          {CHANNEL_ORDER.map((id) => {
            const def = catalog?.adChannels.find((a) => a.id === id);
            const Icon = CHANNEL[id].icon;
            const mine = owned(id);
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={draft.channel === id}
                className={`${styles.channel} ${draft.channel === id ? styles.channelOn : ''}`}
                onClick={() => setDraft({ ...draft, channel: id })}
                data-testid={`channel-${id}`}
              >
                <Icon size={16} />
                <span className={styles.channelName}>{CHANNEL[id].label}</span>
                <span className={styles.channelCost}>{def ? `${money(def.costPerPoint, 0)}/pt` : '—'}</span>
                {mine > 0 && def && <span className={styles.channelBonus}>Own: ×{def.ownershipBonus.toFixed(2)}</span>}
              </button>
            );
          })}
        </div>
        <div className={styles.budgetRow}>
          <span className={shared.toolbarLabel}>Budget</span>
          <span className={styles.budget}>{fmt(draft.budget)}<span className={shared.dim}>/month</span></span>
        </div>
        <Slider
          value={draft.budget}
          min={0}
          max={Math.max(300_000, (existing?.monthlyBudget ?? 0) * 2)}
          step={5_000}
          format={(v) => money(v, 0)}
          onChange={(budget) => setDraft({ ...draft, budget })}
          onCommit={setCommitted}
          aria-label="Monthly budget"
          data-testid="campaign-budget"
        />
        <div className={shared.chips}>
          {BUDGET_STEPS.map((b) => (
            <button key={b} type="button" className={`${shared.chip} ${draft.budget === b ? shared.chipOn : ''}`} onClick={() => (setDraft({ ...draft, budget: b }), setCommitted(b))}>
              {money(b, 0)}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorBlock error={error} />
        ) : !preview || !forecast ? (
          <LoadingBlock rows={4} chart />
        ) : (
          <>
            {!preview.hasRetailPresence && (
              <Note tone="danger">
                You sell {names.product(draft.productId)} nowhere in {names.city(draft.cityId)}: this campaign earns nothing until a store there stocks it.{' '}
                <button type="button" className={shared.link} onClick={() => useUiStore.getState().openPanel('build', { group: 'retail', cityId: draft.cityId, productId: draft.productId })}>
                  Build a store
                </button>
              </Note>
            )}
            <div className={styles.previewStats}>
              <Stat size="sm" label="Brand now" value={Math.round(preview.currentBrand)} />
              <Stat size="sm" label="Next month" value={preview.projectedBrand.toFixed(1)} tone={preview.projectedBrand > preview.currentBrand ? 'pos' : preview.projectedBrand < preview.currentBrand ? 'neg' : 'default'} />
              <Stat size="sm" label="Points bought" value={forecast.pointsPerMonth.toFixed(1)} foot={`${money(preview.costPerPoint, 0)} each${preview.mediaBonus > 1 ? ` · ×${preview.mediaBonus.toFixed(2)} own media` : ''}`} />
              <Stat size="sm" label="Saturation" value={pct(1 - preview.saturation, 0)} foot="higher brand → each point buys less" />
            </div>
            <LineChart
              height={170}
              labels={months}
              zeroBased
              yFormat={(v) => String(Math.round(v))}
              series={[
                { id: 'keep', label: committed > 0 ? `Keep ${money(committed, 0)}/mo` : 'No budget', values: forecast.keep, color: '#D7B766' },
                { id: 'stop', label: 'Stop now', values: forecast.stop, area: false, dashed: true, color: '#9FB2BD' },
              ]}
            />
            <div className={`${shared.tiny} ${shared.dim}`}>
              {reach50 !== null && reach50 > 0 ? `Reaches 50 in about ${reach50} month${reach50 === 1 ? '' : 's'}. ` : ''}Month 1 is the engine’s own projection; later months repeat its rule.
            </div>
          </>
        )}
        <div className={styles.actions}>
          {existing && (
            <Button variant="ghost" icon={<Square size={12} />} onClick={() => void launch(0)} disabled={busy}>
              Stop campaign
            </Button>
          )}
          <span className={shared.spacer} />
          <Button
            variant="primary"
            icon={<Megaphone size={15} />}
            loading={busy}
            disabled={!draft.productId || !draft.cityId || draft.budget <= 0 || (existing?.monthlyBudget === draft.budget)}
            onClick={() => void launch(draft.budget)}
            data-testid="campaign-launch"
          >
            {existing ? 'Update budget' : 'Launch campaign'}
          </Button>
        </div>
        <div className={`${shared.tiny} ${shared.dim}`}>Ad spend is charged every month at month close.</div>
      </div>
    </Panel>
  );
}
