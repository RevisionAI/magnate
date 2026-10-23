// R&D › Patents: patents you hold (licensees, candidates, royalties) and rival
// patents (who blocks your research, until when). Grant and revoke licences in
// place (bridge-spec §5.7; royalty = rate × the licensee's sales of the product).

import { Lock, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { MyPatentDto, RivalPatentDto } from '@/bridge/protocol';
import { engineMutate, useEngineQuery } from '@/state/useEngineQuery';
import { Badge, Button, Panel, Progress, Select, Table } from '@/ui/components';
import { durationMonths, monthYear } from '@/util/format';
import { CompanyTag, ErrorBlock, LoadingBlock, Note, pct, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';
import styles from './Rnd.module.css';

export function PatentsTab() {
  const names = useNames();
  const fmt = useMoneyFormat();
  const { data, error } = useEngineQuery('patents', {});
  const [pick, setPick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (error && !data) return <ErrorBlock error={error} />;
  if (!data) return <LoadingBlock rows={8} />;

  const license = async (productId: string, licenseeId: number, grant: boolean) => {
    setBusy(`${productId}:${licenseeId}`);
    await engineMutate(grant ? 'grantLicense' : 'revokeLicense', { productId, licenseeId });
    setBusy(null);
  };

  return (
    <div className={shared.page}>
      <Note tone="gold" icon={<ShieldCheck size={14} color="var(--c-gold)" />}>
        Reaching a product’s top tech level grants a patent for {durationMonths(data.durationMonths)}. Licensees pay you {pct(data.royaltyRate, 0)} of their sales of that product every month.
      </Note>
      <Panel title={`Your patents (${data.mine.length})`} padding="none" variant="solid" data-testid="my-patents">
        <Table<MyPatentDto>
          rowKey={(p) => p.productId}
          rows={data.mine}
          empty="No patents yet — be first to the top tech level of a product."
          columns={[
            { id: 'p', header: 'Product', cell: (p) => <b>{names.product(p.productId)}</b> },
            {
              id: 'exp',
              header: 'Protected until',
              width: '20%',
              cell: (p) => (
                <Progress
                  size="sm"
                  tone="gold"
                  value={data.durationMonths ? p.monthsRemaining / data.durationMonths : 0}
                  label={
                    <span className={shared.tiny}>
                      {monthYear(p.expiresAt)} · {durationMonths(p.monthsRemaining)} left
                    </span>
                  }
                />
              ),
            },
            {
              id: 'lic',
              header: 'Licensed to',
              cell: (p) => (
                <span className={styles.licensees}>
                  {p.licensees.length === 0 && <span className={shared.dim}>Nobody</span>}
                  {p.licensees.map((c) => (
                    <span key={c.companyId} className={shared.chip}>
                      <CompanyTag company={names.company(c.companyId)} size={11} you={false} />
                      <button type="button" className={shared.link} aria-label={`Revoke ${c.name}'s licence`} onClick={() => void license(p.productId, c.companyId, false)} disabled={busy !== null}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </span>
              ),
            },
            {
              id: 'grant',
              header: 'Grant a licence',
              cell: (p) =>
                p.candidates.length === 0 ? (
                  <span className={shared.dim}>Every rival is licensed</span>
                ) : (
                  <span className={styles.grant}>
                    <Select<number>
                      size="sm"
                      aria-label="Licensee"
                      value={pick[p.productId] ?? p.candidates[0]!.companyId}
                      options={p.candidates.map((c) => ({ value: c.companyId, label: c.name }))}
                      onChange={(id) => setPick({ ...pick, [p.productId]: id })}
                    />
                    <Button size="sm" variant="secondary" loading={busy?.startsWith(`${p.productId}:`) ?? false} onClick={() => void license(p.productId, pick[p.productId] ?? p.candidates[0]!.companyId, true)} data-testid={`grant-${p.productId}`}>
                      Grant
                    </Button>
                  </span>
                ),
            },
            { id: 'roy', header: 'Royalties, 12 mo', numeric: true, cell: (p) => <b className={p.royaltiesLast12 > 0 ? shared.pos : undefined}>{fmt(p.royaltiesLast12)}</b> },
          ]}
        />
      </Panel>
      <Panel title={`Rival patents (${data.rivals.length})`} padding="none" variant="solid">
        <Table<RivalPatentDto>
          rowKey={(p) => `${p.holderId}:${p.productId}`}
          rows={data.rivals}
          defaultSort={{ id: 'block', dir: 'desc' }}
          empty="No rival holds a patent."
          columns={[
            { id: 'p', header: 'Product', sortValue: (p) => names.product(p.productId), cell: (p) => <b>{names.product(p.productId)}</b> },
            { id: 'h', header: 'Holder', sortValue: (p) => p.holderName, cell: (p) => <CompanyTag company={names.company(p.holderId)} size={12} /> },
            { id: 'exp', header: 'Until', sortValue: (p) => p.monthsRemaining, cell: (p) => `${monthYear(p.expiresAt)} · ${durationMonths(p.monthsRemaining)}` },
            {
              id: 'block',
              header: 'Effect on you',
              sortValue: (p) => (p.blocksMyResearch ? 1 : 0),
              cell: (p) =>
                p.licensedToMe ? (
                  <Badge tone="info">Licensed to you</Badge>
                ) : p.blocksMyResearch ? (
                  <Badge tone="danger">
                    <Lock size={11} /> Blocks your research
                  </Badge>
                ) : (
                  <span className={shared.dim}>You don’t research this</span>
                ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
