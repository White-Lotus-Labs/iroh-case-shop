import { resolve } from 'node:path';

/** Prisma stores a relative `file:` URL beside the schema. Absolute paths stay absolute. */
export function sqliteFilePath(databaseUrl, schemaDir) {
  const raw = (databaseUrl ?? '').trim() || 'file:./dev.db';
  if (!raw.startsWith('file:')) {
    throw new Error('DATABASE_URL must be a file: SQLite URL.');
  }
  // Drop connection parameters such as `?connection_limit=1`.
  const spec = decodeURIComponent(raw.slice('file:'.length).split('?')[0]);
  if (spec.startsWith('/')) return spec;
  return resolve(schemaDir, spec);
}
