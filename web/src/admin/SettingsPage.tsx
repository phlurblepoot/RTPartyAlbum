import { FormEvent, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from './api';
import type { MediaLimits } from '@rtpa/shared';

interface SettingsFormProps {
  initialUrl: string;
  initialLimits: MediaLimits;
}

function SettingsForm({ initialUrl, initialLimits }: SettingsFormProps) {
  const qc = useQueryClient();
  const [publicBaseUrl, setPublicBaseUrl] = useState(initialUrl);
  const [limits, setLimits] = useState<MediaLimits>(initialLimits);

  const saveMut = useMutation({
    mutationFn: (input: { publicBaseUrl: string; mediaLimits: MediaLimits }) =>
      adminApi.saveSettings(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate({ publicBaseUrl, mediaLimits: limits }); }} aria-label="Global settings">
      <div>
        <label htmlFor="publicBaseUrl">Public base URL</label>
        <input
          id="publicBaseUrl"
          value={publicBaseUrl}
          onChange={(e) => setPublicBaseUrl(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="photoMaxBytes">Photo max bytes</label>
        <input
          id="photoMaxBytes"
          type="number"
          value={limits.photoMaxBytes}
          onChange={(e) => setLimits({ ...limits, photoMaxBytes: Number(e.target.value) || 0 })}
        />
      </div>
      <div>
        <label htmlFor="videoMaxBytes">Video max bytes</label>
        <input
          id="videoMaxBytes"
          type="number"
          value={limits.videoMaxBytes}
          onChange={(e) => setLimits({ ...limits, videoMaxBytes: Number(e.target.value) || 0 })}
        />
      </div>
      <div>
        <label htmlFor="videoMaxDurationSec">Video max duration (sec)</label>
        <input
          id="videoMaxDurationSec"
          type="number"
          value={limits.videoMaxDurationSec}
          onChange={(e) => setLimits({ ...limits, videoMaxDurationSec: Number(e.target.value) || 0 })}
        />
      </div>
      {saveMut.isPending && <p>Saving…</p>}
      {saveMut.isSuccess && <p role="status">Settings saved.</p>}
      {saveMut.isError && <p role="alert">Error saving settings.</p>}
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
