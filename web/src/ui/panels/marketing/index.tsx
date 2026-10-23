// Marketing overlay (K) — UX §6.12, caplab §2.9. Campaigns by product, city and
// channel with their brand against the leader; a campaign editor pre-filled
// from context with a live reach preview, cost and a 12-month brand forecast
// (keep running vs stop now); the brand map; and media ownership.

import { useState } from 'react';
import type { AdChannelId } from '@/bridge/protocol';
import { OverlayFrame, type TabItem } from '@/ui/components';
import type { PanelProps } from '../registry';
import { BrandMapTab } from './BrandMapTab';
import { CampaignsTab } from './CampaignsTab';
import { MediaTab } from './MediaTab';

type MarketingTab = 'campaigns' | 'brand' | 'media';

const TABS: TabItem<MarketingTab>[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'brand', label: 'Brand map' },
  { id: 'media', label: 'Media' },
];

export interface CampaignDraftSeed {
  productId?: string;
  cityId?: string;
  channel?: AdChannelId;
}

export default function MarketingPanel({ params }: PanelProps) {
  const initial = typeof params.tab === 'string' && TABS.some((t) => t.id === params.tab) ? (params.tab as MarketingTab) : 'campaigns';
  const [tab, setTab] = useState<MarketingTab>(initial);
  const [seed, setSeed] = useState<CampaignDraftSeed>({
    productId: typeof params.productId === 'string' ? params.productId : undefined,
    cityId: typeof params.cityId === 'string' ? params.cityId : undefined,
    channel: typeof params.channel === 'string' ? (params.channel as AdChannelId) : undefined,
  });
  const plan = (next: CampaignDraftSeed) => {
    setSeed({ ...next });
    setTab('campaigns');
  };
  return (
    <OverlayFrame tabs={TABS} tab={tab} onTabChange={setTab} subtitle="Awareness builds month by month" data-testid="panel-marketing">
      <div data-testid={`marketing-tab-${tab}`}>
        {tab === 'campaigns' && <CampaignsTab seed={seed} onSeed={setSeed} />}
        {tab === 'brand' && <BrandMapTab onPlan={plan} />}
        {tab === 'media' && <MediaTab />}
      </div>
    </OverlayFrame>
  );
}
