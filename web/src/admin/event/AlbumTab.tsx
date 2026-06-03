import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../api';
import { getSocket } from '../../lib/socket';
import type { EventDetail, PhotoAdmin, Photo } from '@rtpa/shared';

function mergePhotoFromSocket(prev: PhotoAdmin[], p: Photo): PhotoAdmin[] {
  const existing = prev.find((x) => x.id === p.id);
  if (existing) {
    // The server re-broadcasts photo:added on UNHIDE, so a re-broadcast of an
    // already-known photo means un-hide it (isHidden:false).
    return prev.map((x) => (x.id === p.id ? { ...x, ...p, isHidden: false } : x));
  }
  const admin: PhotoAdmin = { ...p, deviceId: '', userAgent: '', ipAddress: '' };
  return [admin, ...prev];
}

export function AlbumTab({ event }: { event: EventDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'event', event.id, 'photos'],
    queryFn: () => adminApi.listPhotos(event.id),
    // Socket is the source of truth for live updates; never background-refetch and
    // re-seed local state (it would clobber socket-driven mutations).
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [photos, setPhotos] = useState<PhotoAdmin[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  useEffect(() => {
    if (data) setPhotos(data);
  }, [data]);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('join', event.code);
    const onAdded = (p: Photo) => setPhotos((prev) => mergePhotoFromSocket(prev, p));
    const onHidden = (payload: { id: string }) =>
      setPhotos((prev) => prev.map((x) => (x.id === payload.id ? { ...x, isHidden: true } : x)));
    const onDeleted = (payload: { id: string }) =>
      setPhotos((prev) => prev.filter((x) => x.id !== payload.id));
    const onUpdated = (p: Photo) =>
      setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
    socket.on('photo:added', onAdded);
    socket.on('photo:hidden', onHidden);
    socket.on('photo:deleted', onDeleted);
    socket.on('photo:updated', onUpdated);
    return () => {
      socket.off('photo:added', onAdded);
      socket.off('photo:hidden', onHidden);
      socket.off('photo:deleted', onDeleted);
      socket.off('photo:updated', onUpdated);
    };
  }, [event.code]);

  const visible = useMemo(
    () => photos.filter((p) => (showHidden ? true : !p.isHidden)),
    [photos, showHidden],
  );
  const favoriteCount = useMemo(() => photos.filter((p) => p.isPriority).length, [photos]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function hide(id: string, hidden: boolean) {
    await adminApi.hidePhoto(id, hidden);
    setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, isHidden: hidden } : x)));
  }
  async function remove(id: string) {
    await adminApi.deletePhoto(id);
    setPhotos((prev) => prev.filter((x) => x.id !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }
  async function togglePriority(id: string, priority: boolean) {
    // Optimistic: flip locally, then persist. Revert on failure.
    setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, isPriority: priority } : x)));
    try {
      await adminApi.setPhotoPriority(id, priority);
    } catch {
      setPhotos((prev) => prev.map((x) => (x.id === id ? { ...x, isPriority: !priority } : x)));
    }
  }

  async function bulkHide() {
    const ids = [...selected];
    for (const id of ids) await hide(id, true);
    setSelected(new Set());
  }
  async function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} photos?`)) return;
    const ids = [...selected];
    for (const id of ids) await remove(id);
    setSelected(new Set());
  }

  if (isLoading) return <p data-testid="album-tab">Loading…</p>;

  return (
    <div className="album-tab" data-testid="album-tab">
      <div className="album-toolbar">
        <span className="album-toolbar__count">
          {visible.length} photo{visible.length === 1 ? '' : 's'}
          {favoriteCount > 0 && <> · {favoriteCount} ★ favorite{favoriteCount === 1 ? '' : 's'}</>}
        </span>
        <span className="album-toolbar__spacer" />
        <label className="album-toolbar__toggle">
          <input
            type="checkbox"
            aria-label="Show hidden"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Show hidden
        </label>
        {selected.size > 0 && (
          <span className="album-toolbar__selected">{selected.size} selected</span>
        )}
        <button type="button" disabled={selected.size === 0} onClick={() => void bulkHide()}>
          Hide selected
        </button>
        <button type="button" disabled={selected.size === 0} onClick={() => void bulkDelete()}>
          Delete selected
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="album-empty" data-testid="album-empty">No photos yet.</p>
      ) : (
        <ul className="photo-grid">
          {visible.map((p) => (
            <li
              key={p.id}
              data-testid="photo-tile"
              data-photo-id={p.id}
              className={`photo-card${p.isHidden ? ' hidden' : ''}${p.isPriority ? ' priority' : ''}${
                selected.has(p.id) ? ' selected' : ''
              }`}
            >
              <div data-testid={`photo-tile-${p.id}`} className="photo-card__inner">
                <div className="photo-card__media">
                  <img src={p.thumbUrl} alt={p.uploaderName} loading="lazy" />
                  <input
                    type="checkbox"
                    className="photo-card__select"
                    aria-label={`select ${p.uploaderName}`}
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                  />
                  <button
                    type="button"
                    className="photo-card__fav"
                    aria-label={`${p.isPriority ? 'Unfavorite' : 'Favorite'} ${p.uploaderName}`}
                    aria-pressed={p.isPriority}
                    title={p.isPriority ? 'Favorite — shown more often' : 'Mark as favorite'}
                    onClick={() => void togglePriority(p.id, !p.isPriority)}
                  >
                    {p.isPriority ? '★' : '☆'}
                  </button>
                  {p.isHidden && <span className="hidden-badge">Hidden</span>}
                </div>

                <div className="photo-card__meta">
                  <span className="uploader">{p.uploaderName}</span>
                  <time>{new Date(p.createdAt).toLocaleTimeString()}</time>
                </div>

                <div className="photo-card__actions">
                  {p.isHidden ? (
                    <button type="button" onClick={() => void hide(p.id, false)}>
                      Unhide
                    </button>
                  ) : (
                    <button type="button" onClick={() => void hide(p.id, true)}>
                      Hide
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Delete this photo?')) void remove(p.id);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="photo-card__info-btn"
                    aria-label={`Photo info for ${p.uploaderName}`}
                    aria-expanded={openInfo === p.id}
                    onClick={() => setOpenInfo(openInfo === p.id ? null : p.id)}
                  >
                    Info
                  </button>
                </div>

                {openInfo === p.id && (
                  <div className="popover" role="group" aria-label={`Photo info for ${p.uploaderName}`}>
                    <p>device: {p.deviceId}</p>
                    <p>ua: {p.userAgent}</p>
                    <p>ip: {p.ipAddress}</p>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
