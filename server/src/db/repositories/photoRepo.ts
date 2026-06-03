import { nanoid } from 'nanoid';
import { basename } from 'node:path';
import type { Photo, PhotoAdmin, MediaType } from '@rtpa/shared';
import type { Db } from '../connection.js';

export interface PhotoCreateInput {
  eventId: string;
  uploaderName: string;
  filePath: string;
  displayPath: string;
  thumbPath: string;
  mediaType: MediaType;
  width: number;
  height: number;
  durationMs: number | null;
  deviceId: string;
  userAgent: string;
  ipAddress: string;
}

export interface PhotoRepo {
  create(input: PhotoCreateInput): PhotoAdmin;
  listForEventAdmin(eventId: string): PhotoAdmin[];
  listForEventPublic(eventId: string): Photo[];
  getById(id: string): PhotoAdmin | undefined;
  setHidden(id: string, hidden: boolean): void;
  remove(id: string): void;
  countForEvent(eventId: string): number;
}

interface PhotoRow {
  id: string;
  event_id: string;
  uploader_name: string;
  file_path: string;
  display_path: string;
  thumb_path: string;
  media_type: string;
  width: number;
  height: number;
  duration_ms: number | null;
  created_at: string;
  is_hidden: number;
  device_id: string;
  user_agent: string;
  ip_address: string;
}

function displayUrlOf(displayPath: string): string {
  return `/media/display/${basename(displayPath)}`;
}

function thumbUrlOf(thumbPath: string): string {
  return `/media/thumb/${basename(thumbPath)}`;
}

function rowToPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    eventId: row.event_id,
    uploaderName: row.uploader_name,
    mediaType: row.media_type as MediaType,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    isHidden: row.is_hidden === 1,
    displayUrl: displayUrlOf(row.display_path),
    thumbUrl: thumbUrlOf(row.thumb_path),
  };
}

function rowToPhotoAdmin(row: PhotoRow): PhotoAdmin {
  return {
    ...rowToPhoto(row),
    deviceId: row.device_id,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
  };
}

const COLS = `id, event_id, uploader_name, file_path, display_path, thumb_path,
  media_type, width, height, duration_ms, created_at, is_hidden,
  device_id, user_agent, ip_address`;

export function makePhotoRepo(db: Db): PhotoRepo {
  const insert = db.prepare(
    `INSERT INTO photos (${COLS})
     VALUES (@id, @event_id, @uploader_name, @file_path, @display_path, @thumb_path,
             @media_type, @width, @height, @duration_ms, @created_at, 0,
             @device_id, @user_agent, @ip_address)`,
  );
  const selById = db.prepare(`SELECT ${COLS} FROM photos WHERE id = ?`);
  const selAdmin = db.prepare(`SELECT ${COLS} FROM photos WHERE event_id = ? ORDER BY created_at DESC, id DESC`);
  const selPublic = db.prepare(
    `SELECT ${COLS} FROM photos WHERE event_id = ? AND is_hidden = 0 ORDER BY created_at DESC, id DESC`,
  );
  const setHiddenStmt = db.prepare(`UPDATE photos SET is_hidden = ? WHERE id = ?`);
  const del = db.prepare(`DELETE FROM photos WHERE id = ?`);
  const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM photos WHERE event_id = ?`);

  function create(input: PhotoCreateInput): PhotoAdmin {
    const id = nanoid();
    const createdAt = new Date().toISOString();
    insert.run({
      id,
      event_id: input.eventId,
      uploader_name: input.uploaderName,
      file_path: input.filePath,
      display_path: input.displayPath,
      thumb_path: input.thumbPath,
      media_type: input.mediaType,
      width: input.width,
      height: input.height,
      duration_ms: input.durationMs,
      created_at: createdAt,
      device_id: input.deviceId,
      user_agent: input.userAgent,
      ip_address: input.ipAddress,
    });
    return getById(id)!;
  }

  function getById(id: string): PhotoAdmin | undefined {
    const row = selById.get(id) as PhotoRow | undefined;
    return row ? rowToPhotoAdmin(row) : undefined;
  }

  function listForEventAdmin(eventId: string): PhotoAdmin[] {
    return (selAdmin.all(eventId) as PhotoRow[]).map(rowToPhotoAdmin);
  }

  function listForEventPublic(eventId: string): Photo[] {
    return (selPublic.all(eventId) as PhotoRow[]).map(rowToPhoto);
  }

  function setHidden(id: string, hidden: boolean): void {
    setHiddenStmt.run(hidden ? 1 : 0, id);
  }

  function remove(id: string): void {
    del.run(id);
  }

  function countForEvent(eventId: string): number {
    const row = countStmt.get(eventId) as { n: number };
    return row.n;
  }

  return { create, listForEventAdmin, listForEventPublic, getById, setHidden, remove, countForEvent };
}
