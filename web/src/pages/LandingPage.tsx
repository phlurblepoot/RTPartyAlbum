import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getActiveEvent } from '../api/client';

/**
 * Public landing page at `/`. Always links to the admin console. The upload and
 * canvas pages are per-event (`/e/:code` and `/e/:code/display`), so we resolve
 * the currently-active event and link straight to it; when none is active we
 * show guidance instead of dead links.
 */
export default function LandingPage() {
  const { data: active, isLoading, isError } = useQuery({
    queryKey: ['public', 'active-event'],
    queryFn: () => getActiveEvent(),
  });

  return (
    <main className="landing-page" data-testid="landing-page">
      <h1>RT Party Album</h1>

      <nav className="landing-links">
        <Link to="/admin" className="landing-link">Admin console</Link>
      </nav>

      <section className="landing-active" aria-label="Active event">
        {isLoading && <p>Loading…</p>}
        {isError && <p role="alert">Couldn’t check for an active event.</p>}

        {!isLoading && !isError && (
          active ? (
            <div data-testid="active-event">
              <p>
                Active event: <strong>{active.name}</strong>{' '}
                <span className="event-code">({active.code})</span>
              </p>
              <ul className="landing-links">
                <li>
                  <Link to={`/e/${active.code}`} data-testid="upload-link">Upload photos</Link>
                </li>
                <li>
                  <Link to={`/e/${active.code}/display`} data-testid="canvas-link">Canvas / TV display</Link>
                </li>
              </ul>
            </div>
          ) : (
            <p data-testid="no-active-event">
              No active event yet — create one in the <Link to="/admin">admin console</Link>.
            </p>
          )
        )}
      </section>
    </main>
  );
}
