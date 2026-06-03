import type { EventDetail } from '@rtpa/shared';

export function DisplayTab({ event }: { event: EventDetail }) {
  return <div data-testid="display-tab">{event.name} – Display</div>;
}
