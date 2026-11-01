import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sqliteFilePath } from '../scripts/sqlite-file.mjs';

const schemaDir = '/repo/prisma';

describe('sqliteFilePath', () => {
  it('keeps an absolute Railway volume path', () => {
    expect(sqliteFilePath('file:/data/dev.db', schemaDir)).toBe('/data/dev.db');
  });

  it('resolves a relative path from the Prisma schema directory', () => {
    expect(sqliteFilePath('file:./dev.db', schemaDir)).toBe(
      resolve(schemaDir, 'dev.db'),
    );
  });

  it('drops connection parameters from the file name', () => {
    expect(sqliteFilePath('file:./dev.db?connection_limit=1', schemaDir)).toBe(
      resolve(schemaDir, 'dev.db'),
    );
  });

  it('uses the local file when DATABASE_URL is empty', () => {
    expect(sqliteFilePath('  ', schemaDir)).toBe(resolve(schemaDir, 'dev.db'));
  });
});
