import type { EventDetail } from '@rtpa/shared';

export function AlbumTab({ event }: { event: EventDetail }) {
  return <div data-testid="album-tab">{event.name} – Album</div>;
}
