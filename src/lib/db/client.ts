import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), '.autodev');
const DB_PATH = join(DATA_DIR, 'autodev.db');

function getDb() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  // Create indexes if they don't exist (idempotent)
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_dir ON tasks(project_dir);
    CREATE INDEX IF NOT EXISTS idx_attempts_task_id ON attempts(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  `);

  // Cleanup events older than 30 days for completed/failed tasks
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = sqlite.prepare(`
      DELETE FROM events WHERE created_at < ? AND task_id IN (
        SELECT id FROM tasks WHERE status IN ('completed', 'failed', 'escalated')
      )
    `).run(cutoff);
    if (result.changes > 0) {
      console.log(`[db] Cleaned up ${result.changes} old events`);
      sqlite.exec('VACUUM');
    }
  } catch { /* non-critical */ }

  return drizzle(sqlite, { schema });
}

export const db = getDb();
export type DB = typeof db;
