import { nanoid } from 'nanoid';
import type { EventSummary, EventDetail, EventStatus, MotionConfig } from '@rtpa/shared';
import type { Db } from '../connection.js';

export interface EventRepo {
  list(): EventSummary[];
  getById(id: string): EventDetail | undefined;
  getByCode(code: string): EventDetail | undefined;
  /** The single currently-active event (is_active = 1), or undefined if none. */
  getActive(): EventDetail | undefined;
  create(input: { name: string; code: string; themeId: string; motionConfig: MotionConfig }): EventDetail;
  activate(id: string): void;
  setUploadEnabled(id: string, enabled: boolean): void;
  end(id: string): void;
  setMotionConfig(id: string, motionConfig: MotionConfig): void;
  setTheme(id: string, themeId: string): void;
  codeExists(code: string): boolean;
}

interface EventRow {
  id: string;
  code: string;
  name: string;
  created_at: string;
  is_active: number;
  upload_enabled: number;
  status: string;
  theme_id: string;
  motion_config: string;
  photo_count: number;
}

const SELECT_DETAIL = `
  SELECT e.id, e.code, e.name, e.created_at, e.is_active, e.upload_enabled,
         e.status, e.theme_id, e.motion_config,
         (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS photo_count
  FROM events e`;

function rowToSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    createdAt: row.created_at,
    isActive: row.is_active === 1,
    uploadEnabled: row.upload_enabled === 1,
    status: row.status as EventStatus,
    themeId: row.theme_id,
    photoCount: row.photo_count,
  };
}

function rowToDetail(row: EventRow): EventDetail {
  return {
    ...rowToSummary(row),
    motionConfig: JSON.parse(row.motion_config) as MotionConfig,
  };
}

export function makeEventRepo(db: Db): EventRepo {
  const selById = db.prepare(`${SELECT_DETAIL} WHERE e.id = ?`);
  const selByCode = db.prepare(`${SELECT_DETAIL} WHERE e.code = ?`);
  const selActive = db.prepare(`${SELECT_DETAIL} WHERE e.is_active = 1 LIMIT 1`);
  // rowid DESC is a monotonic insertion-order tiebreaker so same-millisecond
  // created_at values still sort newest-first deterministically.
  const selAll = db.prepare(`${SELECT_DETAIL} ORDER BY e.created_at DESC, e.rowid DESC`);
  const insert = db.prepare(
    `INSERT INTO events (id, code, name, created_at, is_active, upload_enabled, status, theme_id, motion_config)
     VALUES (?, ?, ?, ?, 0, 1, 'active', ?, ?)`,
  );
  const pauseOthers = db.prepare(`UPDATE events SET is_active = 0, status = 'paused' WHERE id != ?`);
  const activateOne = db.prepare(`UPDATE events SET is_active = 1, status = 'active' WHERE id = ?`);
  const setUpload = db.prepare(`UPDATE events SET upload_enabled = ? WHERE id = ?`);
  const endStmt = db.prepare(`UPDATE events SET status = 'ended', is_active = 0, upload_enabled = 0 WHERE id = ?`);
  const setMotion = db.prepare(`UPDATE events SET motion_config = ? WHERE id = ?`);
  const setThemeStmt = db.prepare(`UPDATE events SET theme_id = ? WHERE id = ?`);
  const existsStmt = db.prepare(`SELECT 1 FROM events WHERE code = ? LIMIT 1`);

  function getById(id: string): EventDetail | undefined {
    const row = selById.get(id) as EventRow | undefined;
    return row ? rowToDetail(row) : undefined;
  }

  function getByCode(code: string): EventDetail | undefined {
    const row = selByCode.get(code) as EventRow | undefined;
    return row ? rowToDetail(row) : undefined;
  }

  function getActive(): EventDetail | undefined {
    const row = selActive.get() as EventRow | undefined;
    return row ? rowToDetail(row) : undefined;
  }

  function list(): EventSummary[] {
    return (selAll.all() as EventRow[]).map(rowToSummary);
  }

  function create(input: { name: string; code: string; themeId: string; motionConfig: MotionConfig }): EventDetail {
    const id = nanoid();
    const createdAt = new Date().toISOString();
    insert.run(id, input.code, input.name, createdAt, input.themeId, JSON.stringify(input.motionConfig));
    return getById(id)!;
  }

  function activate(id: string): void {
    const tx = db.transaction(() => {
      pauseOthers.run(id);
      activateOne.run(id);
    });
    tx();
  }

  function setUploadEnabled(id: string, enabled: boolean): void {
    setUpload.run(enabled ? 1 : 0, id);
  }

  function end(id: string): void {
    endStmt.run(id);
  }

  function setMotionConfig(id: string, motionConfig: MotionConfig): void {
    setMotion.run(JSON.stringify(motionConfig), id);
  }

  function setTheme(id: string, themeId: string): void {
    setThemeStmt.run(themeId, id);
  }

  function codeExists(code: string): boolean {
    return existsStmt.get(code) !== undefined;
  }

  return {
    list, getById, getByCode, getActive, create, activate,
    setUploadEnabled, end, setMotionConfig, setTheme, codeExists,
  };
}
