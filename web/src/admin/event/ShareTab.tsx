import type { EventDetail } from '@rtpa/shared';

export function ShareTab({ event }: { event: EventDetail }) {
  return <div data-testid="share-tab">{event.name} – QR & Share</div>;
}
