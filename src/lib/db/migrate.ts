import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client';
import { join } from 'path';

export function runMigrations() {
  try {
    migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
  } catch (err: unknown) {
    // SQLite duplicate column errors happen when migration ran but journal wasn't recorded.
    // Safe to ignore — the column already exists.
    const cause = err instanceof Error && (err as Error & { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : '';
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate column name/i.test(msg) || /duplicate column name/i.test(causeMsg)) {
      console.warn('[Migrate] Skipping already-applied migration (duplicate column)');
      return;
    }
    throw err;
  }
}
