/**
 * SQLite DB 백업 복원 스크립트.
 *
 * 사용법:
 *   pnpm db:restore <timestamp>     특정 백업 복원 (예: 2026-04-19-142301)
 *   pnpm db:restore --latest        가장 최근 백업 복원
 *   pnpm db:restore --list          백업 목록 조회
 *   pnpm db:restore -y <timestamp>  확인 프롬프트 생략
 *   pnpm db:restore --help          도움말
 *
 * 안전장치:
 *   - 복원 직전 현재 DB 를 pre-restore-<timestamp>/ 로 자동 백업
 *   - 복원 후 metadata.json 의 row count 와 실제 row count 를 비교 → 불일치 경고
 *   - 복원 실패 시 기존 DB 는 손상되지 않음 (원본은 자동 백업에 남아있음)
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import * as readline from 'readline/promises';
import {
  formatBytes,
  formatTimestamp,
  getBackupRoot,
  getDbPath,
  getTableCounts,
  listBackups,
  performBackup,
  restoreDbFiles,
  sumCounts,
  type BackupEntry,
} from './db-helpers';

function printHelp(): void {
  console.log(`♻️  AutoDev DB Restore

사용법:
  pnpm db:restore <timestamp>       특정 백업 복원 (예: 2026-04-19-142301)
  pnpm db:restore --latest          가장 최근 백업 복원
  pnpm db:restore --list            백업 목록 조회
  pnpm db:restore -y <timestamp>    확인 프롬프트 생략 (또는 --yes)
  pnpm db:restore --help            도움말

환경변수:
  AUTODEV_DB_PATH                   DB 경로 오버라이드
`);
}

/** 백업 목록 출력. */
function printList(entries: BackupEntry[]): void {
  if (entries.length === 0) {
    console.log('(백업 없음)');
    return;
  }
  console.log(`Available backups (${entries.length}):`);
  for (const e of entries) {
    const size = formatBytes(e.dbSizeBytes);
    const tableCount = e.metadata ? Object.keys(e.metadata.tableCounts).length : 0;
    const totalRows = e.metadata ? sumCounts(e.metadata.tableCounts) : 0;
    const meta = e.metadata
      ? `${tableCount} tables, ${totalRows.toLocaleString()} rows`
      : 'metadata.json 없음';
    console.log(`  ${e.name}  (${size}, ${meta})`);
  }
}

/** TTY 환경에서 Y/n 프롬프트. non-TTY 이면 자동 거부 (안전 기본값). */
async function confirm(message: string, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.error('❌ 비-TTY 환경입니다. 확인 프롬프트를 스킵하려면 -y 플래그를 사용하세요.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${message} (Y/n): `)).trim();
    if (answer === '') return true;
    return /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
}

/** 복원 후 row count 검증. */
function verifyAfterRestore(
  dbPath: string,
  expected: Record<string, number>,
): { matched: number; total: number; mismatches: string[] } {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const actual = getTableCounts(sqlite);
    const expectedNames = Object.keys(expected);
    const mismatches: string[] = [];
    let matched = 0;
    for (const name of expectedNames) {
      const exp = expected[name];
      const act = actual[name];
      if (act === undefined) {
        mismatches.push(`  - ${name}: 테이블 없음 (expected ${exp})`);
      } else if (act !== exp) {
        mismatches.push(`  - ${name}: ${act} (expected ${exp})`);
      } else {
        matched += 1;
      }
    }
    // 추가로 생긴 테이블 체크
    for (const name of Object.keys(actual)) {
      if (!(name in expected)) {
        mismatches.push(`  - ${name}: 예상치 못한 테이블 (actual ${actual[name]})`);
      }
    }
    return { matched, total: expectedNames.length, mismatches };
  } finally {
    sqlite.close();
  }
}

interface ParsedArgs {
  help: boolean;
  list: boolean;
  latest: boolean;
  assumeYes: boolean;
  target: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    help: false,
    list: false,
    latest: false,
    assumeYes: false,
    target: null,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--list') result.list = true;
    else if (arg === '--latest') result.latest = true;
    else if (arg === '--yes' || arg === '-y') result.assumeYes = true;
    else if (arg.startsWith('-')) {
      throw new Error(`알 수 없는 옵션: ${arg}`);
    } else {
      result.target = arg;
    }
  }
  return result;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ ${msg}`);
    printHelp();
    process.exit(1);
  }

  if (args.help) {
    printHelp();
    return;
  }

  const dbPath = getDbPath();
  const backupRoot = getBackupRoot();
  const entries = listBackups(backupRoot);

  // --list 모드
  if (args.list) {
    printList(entries);
    return;
  }

  // 복원 대상 결정
  let target: BackupEntry | null = null;
  if (args.latest) {
    if (entries.length === 0) {
      console.error('❌ 복원할 백업이 없습니다.');
      process.exit(1);
    }
    target = entries[0];
  } else if (args.target) {
    target = entries.find((e) => e.name === args.target) ?? null;
    if (!target) {
      console.error(`❌ 백업을 찾을 수 없습니다: ${args.target}`);
      console.error('   사용 가능한 백업 목록:');
      printList(entries);
      process.exit(1);
    }
  } else {
    console.error('❌ 복원할 백업을 지정해주세요. --latest / --list / <timestamp> 중 하나.');
    printHelp();
    process.exit(1);
  }

  // 현재 DB 존재 여부
  const currentDbExists = existsSync(dbPath);

  console.log(`♻️  복원 준비`);
  console.log(`   Source:  ${target.path}`);
  console.log(`   Target:  ${dbPath}`);
  if (target.metadata) {
    const totalRows = sumCounts(target.metadata.tableCounts);
    const tableCount = Object.keys(target.metadata.tableCounts).length;
    console.log(
      `   Backup:  ${formatBytes(target.metadata.dbSizeBytes)}, ${tableCount} tables, ${totalRows.toLocaleString()} rows`,
    );
    console.log(`   backedUpAt: ${target.metadata.backedUpAt}`);
  }

  // 현재 DB 자동 백업
  let preRestorePath: string | null = null;
  if (currentDbExists) {
    const preName = `pre-restore-${formatTimestamp()}`;
    console.log('');
    console.log(`🛡  Current DB 를 자동 백업합니다 → ${backupRoot}/${preName}/`);
    const ok = await confirm('? Continue', args.assumeYes);
    if (!ok) {
      console.log('취소됨.');
      return;
    }
    try {
      const pre = performBackup({ dbPath, backupRoot, folderName: preName });
      preRestorePath = pre.dir;
      console.log(`✓ Current DB backed up: ${pre.dir}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ 자동 백업 실패: ${msg}`);
      console.error('   안전을 위해 복원을 중단합니다.');
      process.exit(1);
    }
  } else {
    console.log('');
    console.log('⚠ 현재 DB 파일이 없습니다 — 자동 백업 생략, 바로 복원 진행.');
    const ok = await confirm('? Continue', args.assumeYes);
    if (!ok) {
      console.log('취소됨.');
      return;
    }
  }

  // 복원 실행
  try {
    const copied = restoreDbFiles(target.path, dbPath);
    console.log(`✓ Restored from ${target.name}  (files: ${copied.join(', ')})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ 복원 실패: ${msg}`);
    if (preRestorePath) {
      console.error(`   기존 DB 는 다음 백업에서 복구 가능합니다: ${preRestorePath}`);
    }
    process.exit(1);
  }

  // 복원 후 검증
  if (target.metadata) {
    const check = verifyAfterRestore(dbPath, target.metadata.tableCounts);
    if (check.mismatches.length === 0) {
      console.log(`✓ Verification: ${check.matched}/${check.total} tables match row counts`);
    } else {
      console.log(`⚠ Verification: ${check.matched}/${check.total} tables match row counts`);
      console.log('  불일치:');
      for (const line of check.mismatches) console.log(line);
      console.log('  (복원은 완료되었습니다. 메타데이터와 실제 DB 간 불일치가 의심되면 확인 필요.)');
    }
  } else {
    console.log('⚠ metadata.json 이 없어 row count 검증을 건너뜁니다.');
  }

  // 마무리
  if (preRestorePath) {
    console.log('');
    console.log(`ℹ 이전 상태로 되돌리려면: pnpm db:restore ${preRestorePath.split('/').pop()}`);
  }
}

main().catch((err) => {
  console.error('❌ 예기치 않은 오류:', err);
  process.exit(1);
});
