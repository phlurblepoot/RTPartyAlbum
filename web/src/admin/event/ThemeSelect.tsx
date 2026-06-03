import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../api';
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
  return (
    <label>
      Event theme
      <select
        aria-label="event theme"
        value={event.themeId}
        onChange={(e) => mut.mutate(e.target.value)}
      >
        {(themes ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.isPreset ? ' (preset)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
