import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './api';
import type { EventSummary } from '@rtpa/shared';

function StatusBadge({ status }: { status: EventSummary['status'] }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function EventsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: events, isLoading, isError } = useQuery({
    queryKey: ['admin', 'events'],
    queryFn: () => adminApi.listEvents(),
  });

  const createMut = useMutation({
    mutationFn: (name: string) => adminApi.createEvent(name),
    onSuccess: (detail) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'events'] });
      navigate(`/admin/events/${detail.id}`);
    },
  });

  function onCreate() {
    const name = window.prompt('Event name?');
    if (name && name.trim()) createMut.mutate(name.trim());
  }

  return (
    <section data-testid="events-page">
      <header className="page-head">
        <h1>Events</h1>
        <button type="button" onClick={onCreate} disabled={createMut.isPending}>
          Create event
        </button>
      </header>
      {isLoading && <p>Loading…</p>}
      {isError && <p>Failed to load events.</p>}
      {!isLoading && !isError && events?.length === 0 && (
        <p data-testid="empty-state">No events yet.</p>
      )}
      <ul className="event-list">
        {(events ?? []).map((ev) => (
          <li key={ev.id}>
            <Link to={`/admin/events/${ev.id}`}>{ev.name}</Link>
            <StatusBadge status={ev.status} />
            <span className="photo-count">{ev.photoCount} photos</span>
            <span className="created-at">{new Date(ev.createdAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
