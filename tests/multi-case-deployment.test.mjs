import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildBatch,
  commandsForBatch,
  guardApprovedBatch,
} from '../scripts/multi-case/prepare-batch.mjs';

const catalog = JSON.parse(
  await readFile(new URL('../config/cases.testnet.json', import.meta.url)),
);

test('an approved batch cannot be replaced by a changed generated proposal', () => {
  assert.doesNotThrow(() => guardApprovedBatch(null, 'a'.repeat(64)));
  assert.doesNotThrow(() => guardApprovedBatch('a'.repeat(64), 'a'.repeat(64)));
  assert.throws(
    () => guardApprovedBatch('a'.repeat(64), 'b'.repeat(64)),
    /approved batch.*immutable/i,
  );
  assert.throws(
    () => guardApprovedBatch(undefined, 'a'.repeat(64)),
    /approved batch.*immutable/i,
  );
});
const tokens = JSON.parse(
  await readFile(new URL('../config/tokens.testnet.json', import.meta.url)),
);
const selected = tokens.tokens.filter((t) => t.selection === 'included');
const keys = JSON.parse(
  await readFile(
    new URL('../config/deployment-keys.testnet.json', import.meta.url),
  ),
).keys;
const snapshot = {
  network: 'testnet',
  block_height: 277208946,
  block_hash: 'reviewed',
  gas_price: '100000000',
  owner: { amount: '24108852052391552799199995' },
  usdi_account: { code_hash: '2z7yWfap6hkGAcow7xFKRghGWv7Uq1uea3Vn7HV6QuaJ' },
  owner_usdi: '1004000000',
  proposed_tokens: Object.fromEntries(
    selected
      .filter((t) => t.status === 'proposed')
      .map((t) => [t.asset, { account: { absent: true } }]),
  ),
  cases: Object.fromEntries(
    catalog.cases.map((c) => [
      c.id,
      c.id === 'dragon-tea'
        ? {
            wasm_sha256:
              'ca7bcdef4d3640339318c4589808213df8f8de959de09210770f91e062e2c2aa',
            account: { code_hash: 'v1' },
            pool: {
              revision: '13',
              paused: false,
              pending_openings: 0,
              in_flight_payouts: '0',
              treasury_in_flight: '0',
            },
            public_keys: {
              keys: [
                {
                  public_key:
                    'ed25519:7mkuqApHc4Da4mzL4Xn3jBatX2o49nkJfxYAAoP9puMc',
                  access_key: { permission: 'FullAccess' },
                },
              ],
            },
          }
        : { account: { absent: true } },
    ]),
  ),
  tokens: Object.fromEntries(
    ['SHITZU', 'RHEA', 'AURORA'].map((symbol) => [
      symbol,
      {
        dragon_storage:
          symbol === 'SHITZU' ? { total: '1250000000000000000000' } : null,
        owner_balance: '100000000000',
        account: { code_hash: '5heV1Yf3PxjMLWuyXowJoApj38rggW8GsCoScL6Sxidz' },
        storage_bounds: { min: '1250000000000000000000' },
      },
    ]),
  ),
};
const artifacts = {
  case: {
    path: 'contracts/target/wasm32-unknown-unknown/release/iroh_case_pool.wasm',
    sha256: 'a'.repeat(64),
    bytes: 500000,
  },
  mock: {
    path: 'contracts/target/wasm32-unknown-unknown/release/iroh_mock_token.wasm',
    sha256: 'b'.repeat(64),
    bytes: 400000,
  },
};
const input = () => ({ catalog, tokens, keys, snapshot, artifacts });

test('bounded manifest preserves Dragon economics and specifies every new deployment', () => {
  const b = buildBatch(input());
  assert.equal(b.network, 'testnet');
  assert.equal(b.authorization, 'required');
  assert.equal(
    b.steps.filter((s) => s.actions.some((a) => a.type === 'CreateAccount'))
      .length,
    13,
  );
  assert.equal(
    b.steps.filter((s) => s.actions.some((a) => a.type === 'DeployContract'))
      .length,
    14,
  );
  const migration = b.steps.find((s) => s.id === 'dragon-upgrade');
  assert.deepEqual(migration.actions[1].args, {
    reward_tokens: [
      'iroh-test-shitzu.testnet',
      'iroh-test-rhea.testnet',
      'iroh-test-aurora.testnet',
    ],
    expected_revision: '14',
  });
  assert.equal(migration.actions[0].sha256, 'a'.repeat(64));
  assert.equal(
    b.steps.some((s) => s.id === 'dragon-register-SHITZU'),
    false,
  );
  assert.equal(
    b.steps
      .filter((s) => s.id.startsWith('case-fund-usdi-'))
      .reduce((s, v) => s + BigInt(v.actions[0].args.amount), 0n),
    1000000000n,
  );
});

test('every budget covers exact deposits and token transfers without mock dollar valuations', () => {
  const b = buildBatch(input());
  const deposits = b.steps
    .flatMap((s) => s.actions)
    .reduce((n, a) => n + BigInt(a.deposit ?? 0), 0n);
  assert.equal(b.budget.attachedDepositsYocto, deposits.toString());
  assert.equal(
    BigInt(b.budget.maximumNativeExpenditureYocto),
    deposits + BigInt(b.budget.maximumFeesYocto),
  );
  assert.equal(b.budget.usdiRaw, '1000000000');
  assert.equal(b.readiness.ready, false);
  assert.ok(b.readiness.blockers.some((x) => x.includes('native NEAR')));
  assert.equal(JSON.stringify(b).includes('usdValue'), false);
});

test('rejects a different chain or substituted deployment key', () => {
  assert.throws(
    () =>
      buildBatch({ ...input(), snapshot: { ...snapshot, network: 'mainnet' } }),
    /Testnet/,
  );
  assert.throws(
    () => buildBatch({ ...input(), keys: keys.slice(1) }),
    /public key/,
  );
  assert.throws(
    () =>
      buildBatch({
        ...input(),
        keys: keys.map((k) => ({ ...k, publicKey: keys[0].publicKey })),
      }),
    /distinct dedicated public keys/,
  );
});

test('prepared commands keep owner signing unsigned and quote apostrophes safely', () => {
  const commands = commandsForBatch(buildBatch(input()));
  const ownerCommands = commands
    .split('\n')
    .filter(
      (s) =>
        s.startsWith("'near'") &&
        s.includes("'sign-as' 'needmore_1_near.testnet'"),
    );
  assert.ok(ownerCommands.length > 10);
  assert.ok(ownerCommands.every((s) => s.endsWith("'sign-later' 'display'")));
  assert.ok(commands.includes("Uncle'\\''s Secret Reserve"));
  assert.ok(commands.includes("'--signer-public-key'"));
  assert.equal(commands.includes('private_key'), false);
});

test('unsafe pending Dragon state blocks the upgrade and retains paused verification gates', () => {
  const s = structuredClone(snapshot);
  s.cases['dragon-tea'].pool.in_flight_payouts = '100000';
  const b = buildBatch({ ...input(), snapshot: s });
  assert.ok(b.readiness.blockers.some((x) => x.includes('in-flight')));
  assert.ok(
    b.steps
      .find((s) => s.id === 'dragon-upgrade')
      .preconditions.some((x) => x.includes('revision 14')),
  );
  assert.ok(
    b.steps
      .filter((s) => s.id.startsWith('unpause-'))
      .every((s) => s.preconditions.some((x) => x.includes('reconcile'))),
  );
});

test('funds each token inventory with exactly 100 potential bonuses and correct decimals', () => {
  const b = buildBatch(input());
  const near = b.steps.find(
    (s) => s.id === 'case-fund-bonus-phoenix-flame-wNEAR',
  );
  assert.equal(near.receiverId, 'wnear.needmore_1_near.testnet');
  assert.equal(near.actions[0].args.amount, '25000000000000000000000000');
  assert.equal(
    near.actions[0].args.receiver_id,
    'phoenix.needmore_1_near.testnet',
  );
  assert.equal(near.actions[0].deposit, '1');
  assert.equal(near.actions[0].gas, '250000000000000');
});

test('refuses changed Dragon bonus ordering, extra signer keys and invalid base58 key length', () => {
  const changed = structuredClone(catalog);
  const rewards = changed.cases.find((c) => c.id === 'dragon-tea').config
    .bonus_rewards;
  [rewards[0], rewards[2]] = [rewards[2], rewards[0]];
  assert.throws(
    () => buildBatch({ ...input(), catalog: changed }),
    /Dragon.*bonus|Dragon.*reward/i,
  );
  const modified = structuredClone(snapshot);
  modified.cases['dragon-tea'].public_keys.keys.push({
    public_key: keys[0].publicKey,
    access_key: { permission: 'FullAccess' },
  });
  assert.throws(
    () => buildBatch({ ...input(), snapshot: modified }),
    /Dragon.*signer|Dragon.*key/i,
  );
  const invalid = structuredClone(keys);
  invalid[0].publicKey = 'ed25519:' + '1'.repeat(44);
  assert.throws(() => buildBatch({ ...input(), keys: invalid }), /public key/);
});

test('marks allocation above a new token fixed supply as not ready', () => {
  const changed = structuredClone(catalog);
  changed.cases
    .find((c) => c.id === 'bamboo-mist')
    .config.bonus_rewards.find((r) => r.token_symbol === 'BLACKDRAGON').amount =
    '1000000000000000000000000000000000000';
  const b = buildBatch({ ...input(), catalog: changed });
  assert.ok(
    b.readiness.blockers.includes(
      'BLACKDRAGON allocations exceed the fixed minted supply',
    ),
  );
});

test('refuses changed deployed USDI or legacy mock code before proposing transfers', () => {
  const usdi = structuredClone(snapshot);
  usdi.usdi_account.code_hash = 'changed';
  assert.throws(() => buildBatch({ ...input(), snapshot: usdi }), /USDI.*code/);
  const mock = structuredClone(snapshot);
  mock.tokens.RHEA.account.code_hash = 'changed';
  assert.throws(() => buildBatch({ ...input(), snapshot: mock }), /RHEA.*code/);
});
