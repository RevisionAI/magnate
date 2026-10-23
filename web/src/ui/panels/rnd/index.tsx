// R&D overlay (T) — UX §6.11, caplab §2.8. Your technology per product against
// the best rival, research progress and ETAs (bridge-spec §5.7 formulas), the
// labs and what each research unit works on (reassign in place), and patents:
// who blocks whom, until when, and licences you can grant or revoke.

import { useState } from 'react';
import { OverlayFrame, type TabItem } from '@/ui/components';
import type { PanelProps } from '../registry';
import { LabsTab } from './LabsTab';
import { PatentsTab } from './PatentsTab';
import { TechTab } from './TechTab';

type RndTab = 'products' | 'labs' | 'patents';

const TABS: TabItem<RndTab>[] = [
  { id: 'products', label: 'Technology' },
  { id: 'labs', label: 'Labs' },
  { id: 'patents', label: 'Patents' },
];

export default function RndPanel({ params }: PanelProps) {
  const initial = typeof params.tab === 'string' && TABS.some((t) => t.id === params.tab) ? (params.tab as RndTab) : 'products';
  const [tab, setTab] = useState<RndTab>(initial);
  return (
    <OverlayFrame tabs={TABS} tab={tab} onTabChange={setTab} subtitle="Better products win markets" data-testid="panel-rnd">
      <div data-testid={`rnd-tab-${tab}`}>
        {tab === 'products' && <TechTab focusProductId={typeof params.productId === 'string' ? params.productId : null} go={setTab} />}
        {tab === 'labs' && <LabsTab />}
        {tab === 'patents' && <PatentsTab />}
      </div>
    </OverlayFrame>
  );
}
