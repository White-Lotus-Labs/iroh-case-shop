import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const registryPath = fileURLToPath(
  new URL('../config/tokens.testnet.json', import.meta.url),
);
const registry: unknown = existsSync(registryPath)
  ? JSON.parse(readFileSync(registryPath, 'utf8'))
  : null;

describe('Testnet mock registry', () => {
  it('records the selected native token mocks and explicit exclusions', () => {
    expect(registry).toMatchObject({
      network: 'testnet',
      ownerId: 'needmore_1_near.testnet',
      fixedSupplyWhole: '100000',
      tokens: expect.arrayContaining([
        expect.objectContaining({
          asset: 'BLACKDRAGON',
          selection: 'included',
          decimals: 24,
        }),
        expect.objectContaining({
          asset: 'NEKO',
          selection: 'included',
          decimals: 24,
        }),
        expect.objectContaining({
          asset: 'MPDAO',
          selection: 'included',
          decimals: 6,
          symbol: 'mpDAO',
        }),
        expect.objectContaining({
          asset: 'GEAR',
          selection: 'included',
          decimals: 18,
        }),
        expect.objectContaining({
          asset: 'PURGE',
          selection: 'included',
          decimals: 18,
        }),
        expect.objectContaining({
          asset: 'WNEAR',
          selection: 'included',
          decimals: 24,
        }),
        expect.objectContaining({
          asset: 'STNEAR',
          selection: 'included',
          decimals: 24,
        }),
        expect.objectContaining({
          asset: 'LINEAR',
          selection: 'included',
          decimals: 24,
        }),
        expect.objectContaining({
          asset: 'RNEAR',
          selection: 'included',
          decimals: 24,
        }),
        ...['META', 'SWEAT', 'LONK', 'UWON'].map((asset) =>
          expect.objectContaining({
            asset,
            selection: 'excluded',
            intendedCases: [],
          }),
        ),
      ]),
    });
  });

  it("passes the read-only preflight's precision and identity checks", () => {
    expect(
      execFileSync(
        'python3',
        ['scripts/token-preflight.py', '--validate-only'],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          encoding: 'utf8',
        },
      ),
    ).toContain('"included": 12');
  });
  it('rejects a registry that assigns the wrong raw fixed supply', () => {
    const directory = mkdtempSync(join(tmpdir(), 'iroh-registry-'));
    const invalidPath = join(directory, 'tokens.json');
    try {
      writeFileSync(
        invalidPath,
        readFileSync(registryPath, 'utf8').replace(
          '"totalSupplyRaw": "100000000000"',
          '"totalSupplyRaw": "1"',
        ),
      );
      expect(() =>
        execFileSync(
          'python3',
          [
            'scripts/token-preflight.py',
            '--registry',
            invalidPath,
            '--validate-only',
          ],
          { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' },
        ),
      ).toThrow('Incorrect fixed supply: SHITZU');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
