import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, openMemoryDb } from '../connection.js';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'rtpa-conn-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

describe('openDb', () => {
  it('opens a file db with WAL journaling and foreign keys ON', () => {
    const dir = makeTmp();
    const db = openDb(join(dir, 'test.db'));
    const journal = db.pragma('journal_mode', { simple: true });
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(String(journal).toLowerCase()).toBe('wal');
    expect(Number(fk)).toBe(1);
    db.close();
  });

  it('can create and read a table (sanity)', () => {
    const dir = makeTmp();
    const db = openDb(join(dir, 'test.db'));
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
    const row = db.prepare('SELECT v FROM t WHERE id = 1').get() as { v: string };
    expect(row.v).toBe('hello');
    db.close();
  });
});

describe('openMemoryDb', () => {
  it('opens an in-memory db with foreign keys ON', () => {
    const db = openMemoryDb();
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(Number(fk)).toBe(1);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO t (id) VALUES (1)').run();
    const count = db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });
});
