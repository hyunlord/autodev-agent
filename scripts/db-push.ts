/**
 * db:push 래퍼 — drizzle-kit 0.30.6 SQLite 인덱스 idempotency 버그 우회.
 *
 * 버그: drizzle-kit이 SQLite 테이블을 drop+recreate 할 때 인덱스를 인라인 생성하고,
 *      동일 실행 내에서 해당 인덱스를 "누락된 인덱스"로 재시도 → "already exists" 에러.
 *
 * 우회 전략:
 *   1) Pre-drop: push 전 사용자 정의 인덱스 전체 삭제 (일반 idempotency 케이스 처리)
 *   2) Retry: "already exists" 에러 발생 시 해당 인덱스만 삭제 후 재시도
 *      (테이블 재생성이 포함된 케이스 처리)
 */

import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { getDbPath } from './db-helpers';

const dbPath = getDbPath();

// ── Step 1: Pre-drop all user-defined indexes ───────────────────────────────
if (existsSync(dbPath)) {
  const db = new Database(dbPath);
  let dropped = 0;
  try {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    for (const { name } of rows) {
      const escaped = name.replaceAll('"', '""');
      db.prepare(`DROP INDEX IF EXISTS "${escaped}"`).run();
      dropped++;
    }
  } finally {
    db.close();
  }
  if (dropped > 0) {
    console.log(`🗑  Pre-drop: ${dropped} index(es) removed (drizzle-kit idempotency fix)`);
  }
}

// ── Step 2: Run drizzle-kit push with retry on "already exists" ─────────────
function runDrizzlePush(): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    // 'drizzle-kit push' as single string avoids Node.js DEP0190 (args + shell:true)
    const child = spawn('drizzle-kit push', [], {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env },
    });

    let output = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      output += text;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(text);
      output += text;
    });

    child.on('close', (code) => resolve({ status: code ?? 1, output }));
  });
}

async function main(): Promise<void> {
  const MAX_RETRIES = 10;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const { status, output } = await runDrizzlePush();

    if (status === 0) process.exit(0);

    const match = output.match(/SqliteError: index (\S+) already exists/);
    if (match && attempt < MAX_RETRIES) {
      const indexName = match[1];
      console.log(`🔄 Retry ${attempt + 1}: dropping conflicting index "${indexName}"...`);
      const db = new Database(dbPath);
      try {
        const escaped = indexName.replaceAll('"', '""');
        db.prepare(`DROP INDEX IF EXISTS "${escaped}"`).run();
      } finally {
        db.close();
      }
      continue;
    }

    process.exit(status);
  }
}

main().catch((err) => {
  console.error('❌ db:push error:', err);
  process.exit(1);
});
