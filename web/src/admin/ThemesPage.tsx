import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './api';
import { ThemeEditor } from './ThemeEditor';
import type { Theme } from '@rtpa/shared';

export function ThemesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Theme | null>(null);
  const { data: themes } = useQuery({ queryKey: ['admin', 'themes'], queryFn: () => adminApi.listThemes() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'themes'] });

  const dupMut = useMutation({
    mutationFn: (t: Theme) => adminApi.createTheme(`${t.name} (copy)`, t.tokens),
    onSuccess: (created) => {
      void invalidate();
      setEditing(created);
    },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => adminApi.deleteTheme(id),
    onSuccess: () => {
      void invalidate();
      setEditing(null);
    },
  });

  return (
    <section className="themes-page" data-testid="themes-page">
      <h1>Themes</h1>
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
