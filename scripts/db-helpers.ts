/**
 * DB 백업/복구/검증 공용 헬퍼
 *
 * scripts/db-backup.ts, db-restore.ts, db-verify.ts 에서 공유한다.
 * better-sqlite3 + 표준 fs 만 사용 (신규 의존성 없음).
 */

import Database from 'better-sqlite3';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

/** 현재 스키마 버전 라벨 (Phase P Stage 1 진입 전 스냅샷 기준) */
export const SCHEMA_VERSION = 'phase-p-pre-stage-1';

/** 프로젝트 DB 파일 경로 — AUTODEV_DB_PATH 환경변수로 오버라이드 가능. */
export function getDbPath(): string {
  const envPath = process.env.AUTODEV_DB_PATH;
  if (envPath && envPath.length > 0) return resolve(envPath);
  return resolve(process.cwd(), '.autodev', 'autodev.db');
}

/** 백업 루트 디렉토리 (~/.autodev/backups) */
export function getBackupRoot(): string {
  return join(homedir(), '.autodev', 'backups');
}

/** 현재 시각 → YYYY-MM-DD-HHMMSS (로컬 타임존, 폴더명용). */
export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d}-${hh}${mm}${ss}`;
}

/** bytes → "12.3 MB" 같은 human-readable 형식. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  return `${value.toFixed(1)} ${units[unitIdx]}`;
}

/** sqlite_master 에서 user-defined 테이블 목록 조회 (sqlite_* 시스템 테이블 제외). */
export function listUserTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 각 테이블의 COUNT(*) 결과 → { [tableName]: count }. */
export function getTableCounts(db: Database.Database): Record<string, number> {
  const tables = listUserTables(db);
  const counts: Record<string, number> = {};
  for (const name of tables) {
    // table 이름은 sqlite_master 에서 가져왔으므로 SQL 인젝션 불가 — 안전하게 quote.
    const row = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number };
    counts[name] = row.c;
  }
  return counts;
}

/** mkdir -p 동등. */
export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/**
 * DB 파일 + WAL/SHM sidecar 를 dstDir 에 복사.
 * @returns 복사된 파일명 리스트 (예: ['autodev.db', 'autodev.db-wal'])
 */
export function copyDbFiles(srcDb: string, dstDir: string, dstName = 'autodev.db'): string[] {
  const copied: string[] = [];
  const srcWal = `${srcDb}-wal`;
  const srcShm = `${srcDb}-shm`;
  const dstDb = join(dstDir, dstName);
  copyFileSync(srcDb, dstDb);
  copied.push(dstName);
  if (existsSync(srcWal)) {
    copyFileSync(srcWal, `${dstDb}-wal`);
    copied.push(`${dstName}-wal`);
  }
  if (existsSync(srcShm)) {
    copyFileSync(srcShm, `${dstDb}-shm`);
    copied.push(`${dstName}-shm`);
  }
  return copied;
}

/** 백업 메타데이터 JSON 구조. */
export interface BackupMetadata {
  backedUpAt: string;
  dbPath: string;
  dbSizeBytes: number;
  tableCounts: Record<string, number>;
  schemaVersion: string;
}

export interface PerformBackupResult {
  dir: string;
  metadata: BackupMetadata;
  copiedFiles: string[];
}

/**
 * 백업 1회 수행. WAL checkpoint 후 파일 복사 + metadata.json 작성.
 * 폴더명은 호출자가 결정 (pre-restore-* prefix 등 요구사항 반영).
 */
export function performBackup(options: {
  dbPath: string;
  backupRoot: string;
  folderName: string;
  schemaVersion?: string;
}): PerformBackupResult {
  const { dbPath, backupRoot, folderName } = options;
  const schemaVersion = options.schemaVersion ?? SCHEMA_VERSION;

  if (!existsSync(dbPath)) {
    throw new Error(`DB 파일을 찾을 수 없습니다: ${dbPath}`);
  }

  // 1. WAL checkpoint 로 데이터 일관성 확보 + 테이블 row counts 수집
  const sqlite = new Database(dbPath);
  let tableCounts: Record<string, number>;
  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    tableCounts = getTableCounts(sqlite);
  } finally {
    sqlite.close();
  }

  // 2. 대상 디렉토리 생성 (중복 시 에러로 덮어쓰기 방지)
  const dir = join(backupRoot, folderName);
  if (existsSync(dir)) {
    throw new Error(`이미 동일 이름의 백업 폴더가 존재합니다: ${dir}`);
  }
  ensureDir(dir);

  // 3. 파일 복사 (.db + -wal + -shm if present)
  const copiedFiles = copyDbFiles(dbPath, dir);

  // 4. metadata.json 기록
  const dbSizeBytes = statSync(dbPath).size;
  const metadata: BackupMetadata = {
    backedUpAt: new Date().toISOString(),
    dbPath,
    dbSizeBytes,
    tableCounts,
    schemaVersion,
  };
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf-8');

  return { dir, metadata, copiedFiles };
}

/** 백업 루트에서 하나의 백업 폴더 정보. */
export interface BackupEntry {
  name: string;
  path: string;
  metadata: BackupMetadata | null;
  dbSizeBytes: number;
  createdAtMs: number;
}

/** 백업 루트 내 모든 timestamp 폴더를 최신순으로 나열. */
export function listBackups(backupRoot: string): BackupEntry[] {
  if (!existsSync(backupRoot)) return [];
  const entries: BackupEntry[] = [];
  const names = readdirSync(backupRoot);
  for (const name of names) {
    const dir = join(backupRoot, name);
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const metaPath = join(dir, 'metadata.json');
    let metadata: BackupMetadata | null = null;
    if (existsSync(metaPath)) {
      try {
        metadata = JSON.parse(readFileSync(metaPath, 'utf-8')) as BackupMetadata;
      } catch {
        metadata = null;
      }
    }
    const dbPath = join(dir, 'autodev.db');
    const dbSizeBytes = existsSync(dbPath) ? statSync(dbPath).size : 0;
    entries.push({
      name,
      path: dir,
      metadata,
      dbSizeBytes,
      createdAtMs: stat.mtimeMs,
    });
  }
  entries.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return entries;
}

/** 백업 폴더 안의 autodev.db / -wal / -shm 파일을 dstDb 경로로 복사. */
export function restoreDbFiles(srcDir: string, dstDb: string): string[] {
  const srcDb = join(srcDir, 'autodev.db');
  if (!existsSync(srcDb)) {
    throw new Error(`백업 폴더에 autodev.db 가 없습니다: ${srcDir}`);
  }
  // 대상의 낡은 WAL/SHM 제거 — 복원 후 일관된 상태 보장.
  for (const suffix of ['-wal', '-shm']) {
    const stale = `${dstDb}${suffix}`;
    if (existsSync(stale)) rmSync(stale);
  }
  const copied: string[] = [];
  copyFileSync(srcDb, dstDb);
  copied.push('autodev.db');
  const srcWal = join(srcDir, 'autodev.db-wal');
  const srcShm = join(srcDir, 'autodev.db-shm');
  if (existsSync(srcWal)) {
    copyFileSync(srcWal, `${dstDb}-wal`);
    copied.push('autodev.db-wal');
  }
  if (existsSync(srcShm)) {
    copyFileSync(srcShm, `${dstDb}-shm`);
    copied.push('autodev.db-shm');
  }
  return copied;
}

/** tableCounts 합계. */
export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
