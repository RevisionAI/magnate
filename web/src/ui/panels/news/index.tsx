// News & Events overlay (N) — UX §6.14. A newspaper front page (Fraunces):
// the lead story with what it means for your business, the other headlines,
// your business briefs and rival moves, and the markets box of active price
// effects; the archive with filters; and the business event log with the
// nine activity filters, search and Locate.

import { useState } from 'react';
import { OverlayFrame, type TabItem } from '@/ui/components';
import type { PanelProps } from '../registry';
import { ArchiveTab } from './ArchiveTab';
import { BusinessLogTab } from './BusinessLogTab';
import { FrontPage } from './FrontPage';

type NewsTab = 'front' | 'archive' | 'log';

const TABS: TabItem<NewsTab>[] = [
  { id: 'front', label: 'Front page' },
  { id: 'archive', label: 'Archive' },
  { id: 'log', label: 'Business log' },
];

const ALIASES: Record<string, NewsTab> = { news: 'front', headlines: 'front', events: 'log' };

export default function NewsPanel({ params }: PanelProps) {
  const raw = typeof params.tab === 'string' ? params.tab : 'front';
  const [tab, setTab] = useState<NewsTab>(TABS.some((t) => t.id === raw) ? (raw as NewsTab) : (ALIASES[raw] ?? 'front'));
  return (
    <OverlayFrame tabs={TABS} tab={tab} onTabChange={setTab} subtitle="What happened, and what it means for you" data-testid="panel-news">
      <div data-testid={`news-tab-${tab}`}>
        {tab === 'front' && <FrontPage onArchive={() => setTab('archive')} onLog={() => setTab('log')} />}
        {tab === 'archive' && <ArchiveTab />}
        {tab === 'log' && <BusinessLogTab />}
      </div>
    </OverlayFrame>
  );
}
