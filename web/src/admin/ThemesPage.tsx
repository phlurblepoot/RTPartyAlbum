import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, ApiError } from './api';
import { ThemeEditor } from './ThemeEditor';
import type { Theme } from '@rtpa/shared';

export function ThemesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Theme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: themes, isLoading, isError } = useQuery({ queryKey: ['admin', 'themes'], queryFn: () => adminApi.listThemes() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'themes'] });
  const toError = (err: unknown) =>
    setError(err instanceof ApiError ? `Failed (${err.status})` : 'Action failed');

  const dupMut = useMutation({
    mutationFn: (t: Theme) => adminApi.createTheme(`${t.name} (copy)`, t.tokens),
    onSuccess: (created) => {
      setError(null);
      void invalidate();
      setEditing(created);
    },
    onError: toError,
  });
  const delMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteTheme(id),
    onSuccess: () => {
      setError(null);
      void invalidate();
      setEditing(null);
    },
    onError: toError,
  });

  return (
    <section className="themes-page" data-testid="themes-page">
      <h1>Themes</h1>
      {error && <p role="alert">{error}</p>}
      {isLoading && <p>Loading…</p>}
      {isError && <p role="alert">Failed to load themes.</p>}
      <ul className="theme-list">
        {(themes ?? []).map((t) => (
          <li key={t.id} data-testid={`theme-row-${t.id}`}>
            <button type="button" data-action="edit" onClick={() => setEditing(t)}>{t.name}</button>
            {t.isPreset && <span className="badge">preset</span>}
            <button type="button" data-action="duplicate" onClick={() => dupMut.mutate(t)}>Duplicate</button>
            <button
              type="button"
              data-action="delete"
              disabled={t.isPreset}
              onClick={() => {
                if (window.confirm(`Delete theme "${t.name}"?`)) delMut.mutate(t.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <ThemeEditor
          theme={editing}
          onSaved={(saved) => {
            void invalidate();
            setEditing(saved);
          }}
        />
      )}
    </section>
  );
}
