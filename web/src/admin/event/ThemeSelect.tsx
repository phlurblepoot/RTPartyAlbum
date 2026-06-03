import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../api';
import { ThemeSwatch } from '../ThemeSwatch';
import type { EventDetail } from '@rtpa/shared';

export function ThemeSelect({ event }: { event: EventDetail }) {
  const qc = useQueryClient();
  const { data: themes } = useQuery({ queryKey: ['admin', 'themes'], queryFn: () => adminApi.listThemes() });
  const mut = useMutation({
    mutationFn: (themeId: string) => adminApi.setEventTheme(event.id, themeId),
    onSuccess: (updated) => {
      qc.setQueryData(['admin', 'event', event.id], updated);
    },
  });
  const selected = (themes ?? []).find((t) => t.id === event.themeId);
  return (
    <div className="theme-select">
      <label>
        Event theme
        <select
          aria-label="event theme"
          value={event.themeId}
          disabled={mut.isPending}
          onChange={(e) => mut.mutate(e.target.value)}
        >
          {(themes ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isPreset ? ' (preset)' : ''}
            </option>
          ))}
        </select>
        {mut.isError && <span role="alert">Failed to set theme</span>}
      </label>
      {selected && (
        <div className="selected-theme-preview">
          <ThemeSwatch tokens={selected.tokens} />
        </div>
      )}
    </div>
  );
}
