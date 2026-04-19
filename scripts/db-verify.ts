/**
 * SQLite DB 무결성 검증 스크립트.
 *
 * 사용법:
 *   pnpm db:verify            현재 DB 의 테이블/row count/FK 무결성 검증
 *   pnpm db:verify --help     도움말
 *
 * 검증 항목:
 *   1. 모든 테이블 존재 여부 (sqlite_master)
 *   2. 각 테이블 COUNT(*)
 *   3. PRAGMA foreign_key_check — FK 위반 여부
 *   4. PRAGMA integrity_check — 전체 DB 무결성
 *
 * 환경변수:
 *   AUTODEV_DB_PATH — DB 경로 오버라이드
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { getDbPath, getTableCounts, sumCounts } from './db-helpers';

function printHelp(): void {
  console.log(`🔍 AutoDev DB Verify

사용법:
  pnpm db:verify              현재 DB 검증
  pnpm db:verify --help       도움말
`);
}

interface ForeignKeyViolation {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

interface VerifyResult {
  tables: string[];
  counts: Record<string, number>;
  fkViolations: ForeignKeyViolation[];
  integrityOk: boolean;
  integrityMessage: string;
}

/** DB 검증 실행 — 예외 없이 결과 객체 반환. */
function verifyDb(dbPath: string): VerifyResult {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const counts = getTableCounts(sqlite);
    const tables = Object.keys(counts);

    const fkRows = sqlite.prepare('PRAGMA foreign_key_check').all() as Array<{
      table: string;
      rowid: number;
      parent: string;
      fkid: number;
    }>;

    const integrityRows = sqlite.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string;
    }>;
    const integrityMessage = integrityRows.map((r) => r.integrity_check).join('; ');
    const integrityOk = integrityRows.length === 1 && integrityRows[0].integrity_check === 'ok';

    return { tables, counts, fkViolations: fkRows, integrityOk, integrityMessage };
  } finally {
    sqlite.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    console.error(`❌ DB 파일을 찾을 수 없습니다: ${dbPath}`);
    process.exit(1);
  }

  console.log(`🔍 DB Verify: ${dbPath}`);
  console.log('');

  let result: VerifyResult;
  try {
    result = verifyDb(dbPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ 검증 실패: ${msg}`);
    process.exit(1);
  }

  // 테이블 존재
  if (result.tables.length === 0) {
    console.error('❌ 테이블이 전혀 존재하지 않습니다.');
    process.exit(1);
  }
  console.log(`✓ All ${result.tables.length} tables exist`);

  // row counts
  console.log('✓ Row counts:');
  const longest = Math.max(...result.tables.map((t) => t.length));
  for (const name of result.tables) {
    const padded = name.padEnd(longest);
    console.log(`  - ${padded}  ${result.counts[name].toLocaleString()}`);
  }
  console.log(`  Total: ${sumCounts(result.counts).toLocaleString()} rows`);

  // FK check
  let hasFailure = false;
  if (result.fkViolations.length > 0) {
    console.error(`❌ Foreign key violations: ${result.fkViolations.length}건`);
    for (const v of result.fkViolations.slice(0, 10)) {
      console.error(`   - table=${v.table} rowid=${v.rowid} parent=${v.parent} fkid=${v.fkid}`);
    }
    if (result.fkViolations.length > 10) {
      console.error(`   ... (+${result.fkViolations.length - 10} more)`);
    }
    hasFailure = true;
  } else {
    console.log('✓ No foreign key violations');
  }

  // Integrity
  if (!result.integrityOk) {
    console.error(`❌ Integrity check failed: ${result.integrityMessage}`);
    hasFailure = true;
  } else {
    console.log('✓ DB integrity: OK');
  }

  if (hasFailure) {
    console.error('');
    console.error('❌ DB 검증 실패');
    process.exit(1);
  }

  console.log('');
  console.log('✓ DB 검증 통과');
}

main().catch((err) => {
  console.error('❌ 예기치 않은 오류:', err);
  process.exit(1);
});
