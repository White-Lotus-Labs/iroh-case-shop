import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sqliteFilePath } from './sqlite-file.mjs';

const databaseUrl = process.env.DATABASE_URL?.trim() || 'file:./dev.db';
const schemaDir = fileURLToPath(new URL('../prisma/', import.meta.url));
const databasePath = sqliteFilePath(databaseUrl, schemaDir);

mkdirSync(dirname(databasePath), { recursive: true });
if (!existsSync(databasePath)) closeSync(openSync(databasePath, 'w'));

const prismaCli = fileURLToPath(
  new URL('../node_modules/prisma/build/index.js', import.meta.url),
);
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
