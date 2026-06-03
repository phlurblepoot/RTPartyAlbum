import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../api';
import { getSocket } from '../../lib/socket';
import type { EventDetail, PhotoAdmin, Photo } from '@rtpa/shared';

function mergePhotoFromSocket(prev: PhotoAdmin[], p: Photo): PhotoAdmin[] {
  const existing = prev.find((x) => x.id === p.id);
  if (existing) {
    return prev.map((x) => (x.id === p.id ? { ...x, ...p, isHidden: false } : x));
  }
  const admin: PhotoAdmin = { ...p, deviceId: '', userAgent: '', ipAddress: '' };
  return [admin, ...prev];
}

export function AlbumTab({ event }: { event: EventDetail }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'event', event.id, 'photos'],
    queryFn: () => adminApi.listPhotos(event.id),
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
    socket.on('photo:added', onAdded);
    socket.on('photo:hidden', onHidden);
    socket.on('photo:deleted', onDeleted);
    return () => {
      socket.off('photo:added', onAdded);
      socket.off('photo:hidden', onHidden);
      socket.off('photo:deleted', onDeleted);
    };
  }, [event.code]);

  const visible = useMemo(
    () => photos.filter((p) => (showHidden ? true : !p.isHidden)),
    [photos, showHidden],
  );

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
        <label>
          <input
            type="checkbox"
            aria-label="Show hidden"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Show hidden
        </label>
        <button type="button" disabled={selected.size === 0} onClick={() => void bulkHide()}>
          Hide selected
        </button>
        <button type="button" disabled={selected.size === 0} onClick={() => void bulkDelete()}>
          Delete selected
        </button>
      </div>
      <ul className="photo-grid">
        {visible.map((p) => (
          <li
            key={p.id}
            data-testid="photo-tile"
            data-photo-id={p.id}
            className={p.isHidden ? 'tile hidden' : 'tile'}
          >
            <div data-testid={`photo-tile-${p.id}`}>
              <input
                type="checkbox"
                aria-label={`select ${p.uploaderName}`}
                checked={selected.has(p.id)}
                onChange={() => toggleSelect(p.id)}
              />
              <img src={p.thumbUrl} alt={p.uploaderName} />
              <span className="uploader">{p.uploaderName}</span>
              <time>{new Date(p.createdAt).toLocaleTimeString()}</time>
              {p.isHidden && <span className="hidden-badge">Hidden</span>}
              <button
                type="button"
                onClick={() => setOpenInfo(openInfo === p.id ? null : p.id)}
              >
                Info
              </button>
              {openInfo === p.id && (
                <div className="popover" role="dialog">
                  <p>device: {p.deviceId}</p>
                  <p>ua: {p.userAgent}</p>
                  <p>ip: {p.ipAddress}</p>
                </div>
              )}
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
