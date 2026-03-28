import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client';
import { join } from 'path';

export function runMigrations() {
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
}
