import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../api';
import { AlbumTab } from './AlbumTab';
import { DisplayTab } from './DisplayTab';
import { ShareTab } from './ShareTab';

type TabKey = 'album' | 'display' | 'share';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'album', label: 'Album' },
  { key: 'display', label: 'Display' },
  { key: 'share', label: 'QR & Share' },
];

export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const [tab, setTab] = useState<TabKey>('album');
  const { data: event, isLoading } = useQuery({
    queryKey: ['admin', 'event', eventId],
    queryFn: () => adminApi.getEvent(eventId),
    enabled: !!eventId,
  });

  if (isLoading) return <p>Loading…</p>;
  if (!event) return <p data-testid="event-not-found">Event not found.</p>;

  return (
    <section data-testid="event-detail-page">
      <header className="page-head">
        <Link to="/admin/events">← Events</Link>
        <h1>{event.name}</h1>
        <span data-testid="event-status">{event.status}</span>
      </header>
      <div role="tablist" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            aria-controls="event-tabpanel"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="event-tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'album' && <AlbumTab event={event} />}
        {tab === 'display' && <DisplayTab event={event} />}
        {tab === 'share' && <ShareTab event={event} />}
      </div>
    </section>
  );
}
