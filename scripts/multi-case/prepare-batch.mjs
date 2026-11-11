// Preparation only. This module has no signing, secret access or broadcast path.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const YOCTO = 10n ** 24n;
const STORAGE = 1250000000000000000000n;
const T = 10n ** 12n;
const V1_SHA =
  'ca7bcdef4d3640339318c4589808213df8f8de959de09210770f91e062e2c2aa';
const keyPattern = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const accountPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/;
const funding = {
  'bamboo-mist': 50000000n,
  'moon-spirit': 150000000n,
  'phoenix-flame': 300000000n,
  'uncles-secret-reserve': 500000000n,
};

function check(ok, message) {
  if (!ok) throw new Error(message);
}
export function guardApprovedBatch(approvedSha256, proposedSha256) {
  check(
    approvedSha256 === null || approvedSha256 === proposedSha256,
    'The approved batch is immutable. Prepare a separate proposal and obtain new approval for any changed digest.',
  );
}
function validPublicKey(value) {
  if (typeof value !== 'string' || !keyPattern.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const encoded = value.slice('ed25519:'.length);
  let number = 0n;
  for (const c of encoded) number = number * 58n + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  while (number) {
    bytes++;
    number >>= 8n;
  }
  return bytes + (encoded.match(/^1*/)?.[0].length ?? 0) === 32;
}
function account(value) {
  check(
    typeof value === 'string' &&
      value.length <= 64 &&
      accountPattern.test(value),
    'Only named Testnet accounts are allowed',
  );
  return value;
}
function call(methodName, args, gasTgas, deposit = 1n) {
  return {
    type: 'FunctionCall',
    methodName,
    args,
    gas: (gasTgas * T).toString(),
    deposit: deposit.toString(),
  };
}

export function buildBatch({ catalog, tokens, keys, snapshot, artifacts }) {
  check(
    catalog.network === 'testnet' &&
      tokens.network === 'testnet' &&
      snapshot.network === 'testnet',
    'Testnet only',
  );
  const owner = account(catalog.ownerId),
    treasury = account(catalog.treasuryId),
    usdi = account(catalog.tokenContractId);
  check(
    owner === 'needmore_1_near.testnet' &&
      treasury === owner &&
      usdi === 'usdi-needmore-1-near.testnet',
    'Unexpected approved inventory owner or USDI contract',
  );
  const expectedExistingCode = {
    [usdi]: '2z7yWfap6hkGAcow7xFKRghGWv7Uq1uea3Vn7HV6QuaJ',
    'iroh-test-shitzu.testnet': '5heV1Yf3PxjMLWuyXowJoApj38rggW8GsCoScL6Sxidz',
    'iroh-test-rhea.testnet': '5heV1Yf3PxjMLWuyXowJoApj38rggW8GsCoScL6Sxidz',
    'iroh-test-aurora.testnet': '5heV1Yf3PxjMLWuyXowJoApj38rggW8GsCoScL6Sxidz',
  };
  check(
    snapshot.usdi_account?.code_hash === expectedExistingCode[usdi],
    'USDI deployed code changed or is unverified',
  );
  for (const symbol of ['SHITZU', 'RHEA', 'AURORA']) {
    check(
      snapshot.tokens[symbol]?.account?.code_hash ===
        expectedExistingCode[`iroh-test-${symbol.toLowerCase()}.testnet`],
      `${symbol} deployed code changed or is unverified`,
    );
  }
  const cases = catalog.cases;
  check(
    cases.length === 5 && new Set(cases.map((c) => c.id)).size === 5,
    'Exactly five unique cases are required',
  );
  const dragon = cases.find((c) => c.id === 'dragon-tea');
  check(
    dragon?.contractId === 'cases-needmore-1-near.testnet',
    'Preserve the existing Dragon account',
  );
  const legacyBonuses = [
    ['iroh-test-shitzu.testnet', 'SHITZU', '50000000'],
    ['iroh-test-rhea.testnet', 'RHEA', '5000000'],
    ['iroh-test-aurora.testnet', 'AURORA', '1000000'],
  ];
  check(
    dragon.config.bonus_rewards.length === 3 &&
      legacyBonuses.every(([id, symbol, amount], tier) => {
        const reward = dragon.config.bonus_rewards[tier];
        return (
          reward.token_contract_id === id &&
          reward.token_symbol === symbol &&
          reward.amount === amount &&
          reward.tier === tier &&
          reward.token_decimals === 6
        );
      }),
    'Dragon bonus rewards must retain the exact reviewed tier order, tokens, decimals and quantities',
  );
  check(
    dragon.config.economy.price === '1000000' &&
      JSON.stringify(dragon.config.economy.rewards) ===
        '["100000","1000000","5000000"]' &&
      dragon.config.economy.target === '1000000000',
    'Dragon rewards and economics must remain unchanged',
  );
  const liveDragon = snapshot.cases['dragon-tea'];
  check(
    liveDragon.wasm_sha256 === V1_SHA,
    'Dragon code changed; rebuild the migration batch from a fresh audit',
  );
  for (const artifact of Object.values(artifacts)) {
    check(
      /^[a-f0-9]{64}$/.test(artifact.sha256) &&
        Number.isSafeInteger(artifact.bytes) &&
        artifact.bytes > 0,
      'An exact WASM checksum and byte count are required',
    );
  }
  const included = tokens.tokens.filter((t) => t.selection === 'included');
  const tokenById = new Map(included.map((t) => [account(t.contractId), t]));
  check(
    new Set(keys.map((k) => k.accountId)).size === keys.length &&
      new Set(keys.map((k) => k.publicKey)).size === keys.length,
    'Every contract requires distinct dedicated public keys and account IDs',
  );
  const keyById = new Map(keys.map((k) => [account(k.accountId), k.publicKey]));
  const steps = [],
    blockers = [];
  const publicKey = (id) => {
    const k = keyById.get(id);
    check(
      validPublicKey(k),
      `Missing or invalid dedicated public key for ${id}`,
    );
    return k;
  };
  const step = (
    id,
    signerId,
    receiverId,
    actions,
    preconditions = [],
    verification = [],
  ) => {
    steps.push({
      id,
      network: 'testnet',
      signerId: account(signerId),
      receiverId: account(receiverId),
      actions,
      preconditions,
      verification,
    });
  };
  function create(id, contract, artifact, init, args, isCase) {
    const deposit = isCase ? 7n * YOCTO : 5n * YOCTO;
    check(
      BigInt(artifact.bytes + (isCase ? 100000 : 20000)) * 10n ** 19n < deposit,
      'Account funding is below conservative storage backing',
    );
    step(
      `${id}-create`,
      owner,
      contract,
      [
        { type: 'CreateAccount' },
        { type: 'Transfer', deposit: deposit.toString() },
        {
          type: 'AddKey',
          publicKey: publicKey(contract),
          permission: 'FullAccess',
        },
      ],
      [
        'Finalized public query returns UNKNOWN_ACCOUNT',
        'Parent has the maximum authorized native expenditure',
      ],
      ['New account has exactly the dedicated public key and funded balance'],
    );
    step(
      `${id}-deploy`,
      contract,
      contract,
      [{ type: 'DeployContract', ...artifact }, call(init, args, 100n, 0n)],
      [
        `${id}-create verified`,
        'Rehash local WASM and require exact reviewed checksum',
        'No existing deployed code or initialized state',
      ],
      [
        'Finalized deployed WASM SHA-256 equals the manifest',
        isCase
          ? 'get_case equals the exact immutable configuration; get_pool is paused with zero funds and liabilities'
          : 'Metadata and fixed supply match registry; the inventory owner holds the entire initial supply',
      ],
    );
  }
  function register(id, contract, token) {
    step(
      id,
      contract,
      token,
      [
        call(
          'storage_deposit',
          { account_id: contract, registration_only: true },
          30n,
          STORAGE,
        ),
      ],
      [
        'storage_balance_of is null and storage_balance_bounds.min equals 1250000000000000000000',
      ],
      ['Finalized registration equals the attached deposit'],
    );
  }
  function fundBonus(c, reward, prefix) {
    const token = tokenById.get(reward.token_contract_id);
    check(
      token &&
        token.symbol === reward.token_symbol &&
        token.decimals === reward.token_decimals,
      `Reward metadata mismatch for ${reward.token_symbol}`,
    );
    const amount = BigInt(reward.amount) * 100n;
    step(
      `${prefix}-${c.id}-${reward.token_symbol}`,
      owner,
      token.contractId,
      [
        call(
          'ft_transfer_call',
          {
            receiver_id: c.contractId,
            amount: amount.toString(),
            memo: null,
            msg: '{"action":"fund"}',
          },
          250n,
        ),
      ],
      [
        'Case is paused and matching token registration finalized',
        'Inventory owner balance covers the entire remaining batch allocation',
      ],
      [
        'Every receipt succeeds and resolver accepts the full exact amount',
        'Actual token balance and per-token inventory book reconcile with no unresolved transfer',
      ],
    );
  }
  for (const token of included.filter((t) => t.status === 'proposed')) {
    check(
      snapshot.proposed_tokens?.[token.asset]?.account.absent === true,
      `${token.asset} account absence is unverified; no overwrite allowed`,
    );
    create(
      `token-${token.asset}`,
      token.contractId,
      artifacts.mock,
      'new',
      { asset: token.asset, owner_id: owner },
      false,
    );
  }
  for (const c of cases.filter((c) => c.id !== 'dragon-tea')) {
    check(
      snapshot.cases[c.id]?.account.absent === true,
      `${c.id} account is no longer absent; no overwrite allowed`,
    );
    create(
      `case-${c.id}`,
      c.contractId,
      artifacts.case,
      'new_configured',
      {
        owner_id: owner,
        token_id: usdi,
        treasury_id: treasury,
        config: c.config,
      },
      true,
    );
    register(`case-register-usdi-${c.id}`, c.contractId, usdi);
    for (const reward of c.config.bonus_rewards)
      register(
        `case-register-${c.id}-${reward.token_symbol}`,
        c.contractId,
        reward.token_contract_id,
      );
    step(
      `case-fund-usdi-${c.id}`,
      owner,
      usdi,
      [
        call(
          'ft_transfer_call',
          {
            receiver_id: c.contractId,
            amount: funding[c.id].toString(),
            memo: null,
            msg: '{"action":"fund"}',
          },
          250n,
        ),
      ],
      ['Case deployment and USDI registration verified; case remains paused'],
      [
        'Full resolver acceptance; actual USDI balance equals pool books; no fees or reservations',
      ],
    );
    for (const reward of c.config.bonus_rewards)
      fundBonus(c, reward, 'case-fund-bonus');
  }
  for (const reward of dragon.config.bonus_rewards) {
    const live = snapshot.tokens[reward.token_symbol];
    check(
      live?.storage_bounds.min === STORAGE.toString(),
      'Dragon token registration price changed',
    );
    if (live.dragon_storage === null)
      register(
        `dragon-register-${reward.token_symbol}`,
        dragon.contractId,
        reward.token_contract_id,
      );
  }
  const pausedRevision =
    BigInt(liveDragon.pool.revision) + (liveDragon.pool.paused ? 0n : 1n);
  if (!liveDragon.pool.paused)
    step(
      'dragon-pause',
      owner,
      dragon.contractId,
      [call('set_paused', { paused: true }, 30n)],
      [
        `Original V1 SHA-256 is ${V1_SHA}; revision ${liveDragon.pool.revision}`,
        'No intervening openings or administrative changes',
      ],
      ['Finalized paused revision equals the reviewed expected revision'],
    );
  if (
    liveDragon.pool.in_flight_payouts !== '0' ||
    liveDragon.pool.treasury_in_flight !== '0'
  )
    blockers.push(
      'Dragon has in-flight transfers; migration is blocked until reconciled',
    );
  const dragonKeys = liveDragon.public_keys.keys;
  const dragonKey = dragonKeys[0]?.public_key;
  check(
    dragonKeys.length === 1 &&
      dragonKeys[0].access_key.permission === 'FullAccess' &&
      dragonKey === 'ed25519:7mkuqApHc4Da4mzL4Xn3jBatX2o49nkJfxYAAoP9puMc',
    'Dragon dedicated signer or key permissions changed',
  );
  step(
    'dragon-upgrade',
    dragon.contractId,
    dragon.contractId,
    [
      { type: 'DeployContract', ...artifacts.case },
      call(
        'migrate_v1',
        {
          reward_tokens: dragon.config.bonus_rewards.map(
            (r) => r.token_contract_id,
          ),
          expected_revision: pausedRevision.toString(),
        },
        100n,
        0n,
      ),
    ],
    [
      `Paused V1 revision ${pausedRevision}`,
      'Original V1 code checksum unchanged',
      'Zero in-flight payout and treasury transfers',
      'USDΙ balance, book bounds, all legacy openings and credits captured and reconciled',
    ],
    [
      'Atomic deployment and migration succeeded',
      'Code checksum equals manifest; revision advanced once; exact legacy history preserved; bonus inventory zero; case remains paused',
    ],
  );
  for (const reward of dragon.config.bonus_rewards)
    fundBonus(dragon, reward, 'dragon-fund-bonus');
  for (const c of cases)
    step(
      `unpause-${c.id}`,
      owner,
      c.contractId,
      [call('set_paused', { paused: false }, 30n)],
      [
        'All prior deployment, registration and funding receipts finalized successfully',
        'Actual USDI and every token balance reconcile with their respective books',
        'No unresolved transfers; expected inventory exact; code and metadata match the manifest',
      ],
      [
        'Finalized unpaused pool and fresh quote agree at the same revision',
        'Client deployment remains planned until independent read-only verification is recorded',
      ],
    );
  const deposits = steps
    .flatMap((s) => s.actions)
    .reduce((n, a) => n + BigInt(a.deposit ?? 0), 0n);
  const gas = steps
    .flatMap((s) => s.actions)
    .reduce((n, a) => n + BigInt(a.gas ?? 0), 0n);
  const gasCeiling = 1000000000n;
  check(
    BigInt(snapshot.gas_price) <= gasCeiling,
    'Public gas price exceeds the bounded batch ceiling',
  );
  // Explicitly bound action fees separately from prepaid function gas. Re-estimate
  // protocol action fees before each signing; never exceed this per-step ceiling.
  const actionFees = (BigInt(steps.length) * YOCTO) / 10n;
  const fees = gas * gasCeiling + actionFees;
  const maximum = deposits + fees;
  if (BigInt(snapshot.owner.amount) < maximum)
    blockers.push(
      `Insufficient owner native NEAR for the conservative entire-batch ceiling; requires ${(maximum - BigInt(snapshot.owner.amount)).toString()} additional yoctoNEAR before execution`,
    );
  const usdiTotal = Object.values(funding).reduce((n, a) => n + a, 0n);
  if (BigInt(snapshot.owner_usdi) < usdiTotal)
    blockers.push(
      'Insufficient inventory owner USDI for the reviewed funding allocations',
    );
  const tokenAmounts = {};
  for (const s of steps)
    for (const a of s.actions)
      if (
        a.type === 'FunctionCall' &&
        a.methodName === 'ft_transfer_call' &&
        s.receiverId !== usdi
      )
        tokenAmounts[s.receiverId] = (
          BigInt(tokenAmounts[s.receiverId] ?? 0) + BigInt(a.args.amount)
        ).toString();
  for (const token of included.filter((t) => t.status === 'proposed')) {
    if (
      BigInt(tokenAmounts[token.contractId] ?? 0) > BigInt(token.totalSupplyRaw)
    )
      blockers.push(
        `${token.symbol} allocations exceed the fixed minted supply`,
      );
  }
  for (const [symbol, live] of Object.entries(snapshot.tokens)) {
    const token = included.find((t) => t.symbol === symbol);
    if (
      token &&
      BigInt(live.owner_balance) < BigInt(tokenAmounts[token.contractId] ?? 0)
    )
      blockers.push(`Insufficient ${symbol} owner inventory`);
  }
  return {
    version: 1,
    network: 'testnet',
    authorization: 'required',
    preparedFrom: {
      blockHeight: snapshot.block_height,
      blockHash: snapshot.block_hash,
    },
    ownerId: owner,
    treasuryId: treasury,
    scope:
      'Only these exact transactions; no openings, claims, treasury withdrawals, Mainnet writes, old token upgrades or existing-key changes',
    sequencing:
      'Ordered steps. Verify each finalized result and all listed preconditions before continuing. Stop the affected dependency chain on drift; never resubmit an ambiguous transaction.',
    expectedExistingCode,
    globalPreconditions: [
      'Before every signing, verify Testnet chain identity, the unchanged existing contract code hashes and the exact expected keys and permissions. Re-estimate gas and action fees within the stated ceilings.',
    ],
    gasPriceCeilingYoctoPerGas: gasCeiling.toString(),
    maximumActionFeesPerTransactionYocto: (YOCTO / 10n).toString(),
    dedicatedKeys: [
      ...keys,
      { accountId: dragon.contractId, publicKey: dragonKey },
    ],
    artifacts,
    budget: {
      attachedDepositsYocto: deposits.toString(),
      maximumFeesYocto: fees.toString(),
      maximumNativeExpenditureYocto: maximum.toString(),
      usdiRaw: usdiTotal.toString(),
      usdiDecimals: 6,
      bonusTokenAmountsRaw: tokenAmounts,
      note: 'Conservative sum across every signer. Account funding remains on dedicated contract accounts. Mock quantities have no USD valuation.',
    },
    readiness: { ready: blockers.length === 0, blockers },
    steps,
  };
}

function quote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

export function commandsForBatch(batch) {
  const key = new Map(
    batch.dedicatedKeys.map((k) => [k.accountId, k.publicKey]),
  );
  return batch.steps
    .map((step) => {
      const actions = step.actions;
      const signing =
        step.signerId === batch.ownerId
          ? ['sign-later', 'display']
          : [
              'sign-with-keychain',
              '--signer-public-key',
              key.get(step.signerId),
              'send',
            ];
      let command;
      if (actions[0].type === 'CreateAccount') {
        command = [
          'near',
          'account',
          'create-account',
          'fund-myself',
          step.receiverId,
          `${actions[1].deposit} yoctoNEAR`,
          'use-manually-provided-public-key',
          actions[2].publicKey,
          'sign-as',
          step.signerId,
          'network-config',
          'testnet',
          ...signing,
        ];
      } else if (actions[0].type === 'DeployContract') {
        const init = actions[1];
        command = [
          'near',
          'contract',
          'deploy',
          step.receiverId,
          'use-file',
          ROOT + actions[0].path,
          'with-init-call',
          init.methodName,
          'json-args',
          JSON.stringify(init.args),
          'prepaid-gas',
          `${BigInt(init.gas) / T} Tgas`,
          'attached-deposit',
          `${init.deposit} yoctoNEAR`,
          'network-config',
          'testnet',
          ...signing,
        ];
      } else {
        const call = actions[0];
        command = [
          'near',
          'contract',
          'call-function',
          'as-transaction',
          step.receiverId,
          call.methodName,
          'json-args',
          JSON.stringify(call.args),
          'prepaid-gas',
          `${BigInt(call.gas) / T} Tgas`,
          'attached-deposit',
          `${call.deposit} yoctoNEAR`,
          'sign-as',
          step.signerId,
          'network-config',
          'testnet',
          ...signing,
        ];
      }
      check(
        command.every((value) => typeof value === 'string'),
        `Incomplete command for ${step.id}`,
      );
      return `# ${step.id}\n# Preconditions: ${step.preconditions.join('; ')}\n${command.map(quote).join(' ')}\n# Verify: ${step.verification.join('; ')}\n`;
    })
    .join('\n');
}

async function main() {
  const load = async (path) => JSON.parse(await readFile(ROOT + path, 'utf8'));
  const catalog = await load('config/cases.testnet.json'),
    tokens = await load('config/tokens.testnet.json');
  const keys = (await load('config/deployment-keys.testnet.json')).keys;
  const artifacts = {};
  for (const [id, name] of [
    ['case', 'iroh_case_pool'],
    ['mock', 'iroh_mock_token'],
  ]) {
    const source = `contracts/target/wasm32-unknown-unknown/release/${name}.wasm`,
      bytes = await readFile(ROOT + source);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = `artifacts/testnet/${name}-${sha256}.wasm`;
    await mkdir(ROOT + 'artifacts/testnet', { recursive: true });
    try {
      await writeFile(ROOT + path, bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      check(
        createHash('sha256')
          .update(await readFile(ROOT + path))
          .digest('hex') === sha256,
        'Archived artifact checksum mismatch',
      );
    }
    artifacts[id] = { path, sha256, bytes: bytes.length };
  }
  const snapshot = await load('docs/multi-case/live-preflight.json');
  const batch = buildBatch({ catalog, tokens, keys, snapshot, artifacts });
  await mkdir(ROOT + 'docs/multi-case', { recursive: true });
  const serialized = JSON.stringify(batch, null, 2) + '\n';
  const sha256 = createHash('sha256').update(serialized).digest('hex');
  const approval = await load('docs/multi-case/approval.json').catch(
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    },
  );
  guardApprovedBatch(approval === null ? null : approval.batchSha256, sha256);
  await writeFile(ROOT + 'docs/multi-case/deployment-batch.json', serialized);
  await writeFile(
    ROOT + 'docs/multi-case/deployment-batch.sha256',
    sha256 + '\n',
  );
  await writeFile(
    ROOT + 'docs/multi-case/deployment-commands.txt',
    (approval
      ? `# Exact batch ${sha256} approved once funded. Do not execute before sufficient funding and fresh matching preflight.\n`
      : '# PREPARATION ONLY. No approval has been given for this batch. Do not run these commands before approval and successful preflight.\n') +
      '# Owner operations are unsigned templates; sign exact manifest actions with the existing owner wallet. Dedicated account operations use only their named Keychain key.\n' +
      '# Stop on any changed prerequisite or ambiguous receipt. Never run this file as a script.\n\n' +
      commandsForBatch(batch),
  );
  console.log(
    JSON.stringify(
      {
        steps: batch.steps.length,
        sha256,
        budget: batch.budget,
        readiness: batch.readiness,
      },
      null,
      2,
    ),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
