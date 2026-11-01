import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

// Timestamped folder names sort in apply order, as `prisma migrate` runs them.
const MIGRATIONS = readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join('prisma/migrations', entry.name, 'migration.sql'))
  .sort();

export function openTempDb() {
  const directory = mkdtempSync(join(tmpdir(), 'tea-db-'));
  const path = join(directory, 'test.db');
  const sqlite = new DatabaseSync(path);
  for (const migration of MIGRATIONS)
    sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.close();
  const url = `file:${path}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  return {
    db,
    /** For a test that reconnects with a fresh client. */
    url,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
