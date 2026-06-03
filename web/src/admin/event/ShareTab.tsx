import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../api';
import type { EventDetail } from '@rtpa/shared';

export function ShareTab({ event }: { event: EventDetail }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const { data: settings } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => adminApi.getSettings(),
  });
  const baseUrl = settings?.publicBaseUrl ?? window.location.origin;
  const uploadLink = `${baseUrl}/e/${event.code}`;

  const invalidateEvent = () =>
    qc.invalidateQueries({ queryKey: ['admin', 'event', event.id] });

  const uploadStateMut = useMutation({
    mutationFn: (enabled: boolean) => adminApi.setUploadState(event.id, enabled),
    onSuccess: () => { setShareError(null); void invalidateEvent(); },
    onError: (err: unknown) => {
      setShareError(err instanceof Error ? err.message : 'Failed to update upload state.');
    },
  });
  const endMut = useMutation({
    mutationFn: () => adminApi.endEvent(event.id),
    onSuccess: () => { setShareError(null); void invalidateEvent(); },
    onError: (err: unknown) => {
      setShareError(err instanceof Error ? err.message : 'Failed to end event.');
    },
  });

  async function copyLink() {
    await navigator.clipboard?.writeText(uploadLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div data-testid="share-tab" className="share-tab">
      <h2>Share &amp; QR</h2>
      <img src={adminApi.qrUrl(event.id)} alt={`QR code for ${event.name}`} />
      <button type="button" onClick={() => window.print()}>Print</button>
      <p className="upload-link">{uploadLink}</p>
      <button type="button" onClick={() => void copyLink()}>{copied ? 'Copied!' : 'Copy link'}</button>
      <a href={adminApi.exportUrl(event.id)} download>Download album (zip)</a>
      {shareError && <p role="alert">{shareError}</p>}

      <div className="upload-toggle">
        {event.uploadEnabled ? (
          <button type="button" onClick={() => uploadStateMut.mutate(false)} disabled={uploadStateMut.isPending}>
            Pause uploads
          </button>
        ) : (
          <button type="button" onClick={() => uploadStateMut.mutate(true)} disabled={uploadStateMut.isPending}>
            Resume uploads
          </button>
        )}
      </div>

      <button
        type="button"
        className="danger"
        disabled={event.status === 'ended' || endMut.isPending}
        onClick={() => { if (window.confirm('End this event? Uploads will be closed.')) endMut.mutate(); }}
      >
        End event
      </button>
    </div>
  );
}
