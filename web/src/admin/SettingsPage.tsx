import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from './api';
import type { MediaLimits } from '@rtpa/shared';
import type { SettingsDto } from './api';

const MB = 1024 * 1024;

interface SettingsFormProps {
  initialUrl: string;
  initialLimits: MediaLimits;
}

function SettingsForm({ initialUrl, initialLimits }: SettingsFormProps) {
  const qc = useQueryClient();
  const [publicBaseUrl, setPublicBaseUrl] = useState(initialUrl);
  // Store display values in MB for the two byte fields
  const [photoMaxMb, setPhotoMaxMb] = useState(
    isNaN(initialLimits.photoMaxBytes) ? 0 : Math.round(initialLimits.photoMaxBytes / MB * 100) / 100,
  );
  const [videoMaxMb, setVideoMaxMb] = useState(
    isNaN(initialLimits.videoMaxBytes) ? 0 : Math.round(initialLimits.videoMaxBytes / MB * 100) / 100,
  );
  const [videoMaxDurationSec, setVideoMaxDurationSec] = useState(initialLimits.videoMaxDurationSec);

  const saveMut = useMutation({
    mutationFn: (input: { publicBaseUrl: string; mediaLimits: MediaLimits }) =>
      adminApi.saveSettings(input),
    onSuccess: (returned: SettingsDto) => {
      qc.setQueryData(['admin', 'settings'], returned);
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const limits: MediaLimits = {
      photoMaxBytes: Math.round((isNaN(photoMaxMb) ? 0 : photoMaxMb) * MB),
      videoMaxBytes: Math.round((isNaN(videoMaxMb) ? 0 : videoMaxMb) * MB),
      videoMaxDurationSec: isNaN(videoMaxDurationSec) ? 0 : videoMaxDurationSec,
    };
    saveMut.mutate({ publicBaseUrl, mediaLimits: limits });
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Global settings">
      <div>
        <label htmlFor="publicBaseUrl">Public base URL</label>
        <input
          id="publicBaseUrl"
          value={publicBaseUrl}
          onChange={(e) => setPublicBaseUrl(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="photoMaxMb">Photo max (MB)</label>
        <input
          id="photoMaxMb"
          type="number"
          value={photoMaxMb}
          onChange={(e) => setPhotoMaxMb(Number(e.target.value))}
        />
      </div>
      <div>
        <label htmlFor="videoMaxMb">Video max (MB)</label>
        <input
          id="videoMaxMb"
          type="number"
          value={videoMaxMb}
          onChange={(e) => setVideoMaxMb(Number(e.target.value))}
        />
      </div>
      <div>
        <label htmlFor="videoMaxDurationSec">Video max duration (sec)</label>
        <input
          id="videoMaxDurationSec"
          type="number"
          value={videoMaxDurationSec}
          onChange={(e) => setVideoMaxDurationSec(Number(e.target.value) || 0)}
        />
      </div>
      {saveMut.isPending && <p>Saving…</p>}
      {saveMut.isSuccess && <p role="status">Settings saved.</p>}
      {saveMut.isError && (
        <p role="alert">{(saveMut.error as ApiError)?.message ?? 'Error saving settings.'}</p>
      )}
      <button type="submit" disabled={saveMut.isPending}>Save settings</button>
    </form>
  );
}

export function SettingsPage() {
  const { data } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => adminApi.getSettings() });

  // password form
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null); setPwOk(false);
    if (next !== confirm) { setPwError('Passwords do not match.'); return; }
    try {
      await adminApi.changePassword(current, next);
      setPwOk(true); setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPwError('Current password is incorrect.');
      else setPwError('Could not change password.');
    }
  }

  return (
    <section className="settings-page" data-testid="settings-page">
      <h1>Settings</h1>

      {data && (
        <SettingsForm
          initialUrl={data.publicBaseUrl}
          initialLimits={data.mediaLimits}
        />
      )}

      <form onSubmit={onChangePassword} aria-label="Change password">
        <h2>Change password</h2>
        <div>
          <label htmlFor="currentPassword">Current password</label>
          <input
            id="currentPassword"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirmNewPassword">Confirm new password</label>
          <input
            id="confirmNewPassword"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {pwError && <p role="alert">{pwError}</p>}
        {pwOk && <p role="status">Password changed.</p>}
        <button type="submit">Change password</button>
      </form>
    </section>
  );
}
