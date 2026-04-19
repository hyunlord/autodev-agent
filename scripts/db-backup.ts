/**
 * SQLite DB 전체 백업 스크립트.
 *
 * 사용법:
 *   pnpm db:backup            현재 DB 를 ~/.autodev/backups/<timestamp>/ 로 백업
 *   pnpm db:backup --help     도움말
 *
 * 동작:
 *   1. PRAGMA wal_checkpoint(TRUNCATE) — WAL 일관성 확보
 *   2. autodev.db / -wal / -shm 파일 복사
 *   3. metadata.json 작성 (row counts, db size, schema version)
 *
 * 환경변수:
 *   AUTODEV_DB_PATH  — DB 경로 오버라이드 (기본: .autodev/autodev.db)
 */

import {
  formatBytes,
  formatTimestamp,
  getBackupRoot,
  getDbPath,
  performBackup,
  sumCounts,
} from './db-helpers';
import { existsSync } from 'fs';

function printHelp(): void {
  console.log(`📦 AutoDev DB Backup

사용법:
  pnpm db:backup              현재 DB → ~/.autodev/backups/<timestamp>/
  pnpm db:backup --help       도움말

환경변수:
  AUTODEV_DB_PATH=<path>      DB 경로 오버라이드
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const dbPath = getDbPath();
  const backupRoot = getBackupRoot();

  if (!existsSync(dbPath)) {
    console.error(`❌ DB 파일을 찾을 수 없습니다: ${dbPath}`);
    console.error('   AUTODEV_DB_PATH 환경변수를 설정하거나 프로젝트 루트에서 실행해주세요.');
    process.exit(1);
  }

  const folderName = formatTimestamp();
  console.log(`📦 Backup 시작...`);
  console.log(`   DB: ${dbPath}`);
  console.log(`   대상: ${backupRoot}/${folderName}/`);

  try {
    const result = performBackup({ dbPath, backupRoot, folderName });
    const tableNames = Object.keys(result.metadata.tableCounts);
    const totalRows = sumCounts(result.metadata.tableCounts);

    console.log('');
    console.log(`✓ Backup created: ${result.dir}/`);
    console.log(`  - DB size: ${formatBytes(result.metadata.dbSizeBytes)}`);
    console.log(`  - Tables: ${tableNames.length}`);
    console.log(`  - Total rows: ${totalRows.toLocaleString()}`);
    console.log(`  - Files: ${result.copiedFiles.join(', ')}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ 백업 실패: ${msg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ 예기치 않은 오류:', err);
  process.exit(1);
});
