// Public configuration and unsigned planning only. No signer or credential API.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(
  await readFile(resolve(root, 'config/deployment.testnet.json'), 'utf8'),
);
if (
  config.network !== 'testnet' ||
  config.rpcUrl !== 'https://rpc.testnet.near.org'
)
  throw new Error('Official Testnet only');
const fields = ['ownerId', 'parentId', 'tokenId', 'caseId', 'treasuryId'];
for (const field of fields)
  if (
    typeof config[field] !== 'string' ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(config[field]) ||
    config[field].length > 64
  )
    throw new Error(`Invalid public ${field}`);
if (
  !config.tokenId.endsWith(`.${config.parentId}`) ||
  !config.caseId.endsWith(`.${config.parentId}`)
)
  throw new Error('Contract subaccounts must belong to the specified parent');

async function check(account_id) {
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: account_id,
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.result)
    return {
      account_id,
      status: 'exists',
      block_height: data.result.block_height,
      code_hash: data.result.code_hash,
      storage_usage: data.result.storage_usage,
      amount: data.result.amount,
    };
  if (data.error?.cause?.name === 'UNKNOWN_ACCOUNT')
    return {
      account_id,
      status: 'not_found',
      block_height: data.error.cause.info?.block_height,
    };
  throw new Error('Account availability could not be verified');
}
const command = process.argv[2];
if (command === 'check') {
  const accounts = [...new Set(fields.map((field) => config[field]))];
  const results = await Promise.all(
    accounts.map(async (account_id) => {
      try {
        return await check(account_id);
      } catch (error) {
        return {
          account_id,
          status: 'NOT_VERIFIED',
          reason: error instanceof Error ? error.message : 'RPC failure',
        };
      }
    }),
  );
  const report = {
    network: 'testnet',
    checked_at: new Date().toISOString(),
    accounts: results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[3])
    await writeFile(
      resolve(process.argv[3]),
      JSON.stringify(report, null, 2) + '\n',
    );
  if (results.some((result) => result.status === 'NOT_VERIFIED'))
    process.exitCode = 1;
} else if (command === 'plan') {
  const artifacts = [];
  for (const [name, account_id, args] of [
    ['iroh_usdi', config.tokenId, { owner_id: config.ownerId }],
    [
      'iroh_case_pool',
      config.caseId,
      {
        owner_id: config.ownerId,
        token_id: config.tokenId,
        treasury_id: config.treasuryId,
      },
    ],
  ]) {
    const path = `contracts/target/wasm32-unknown-unknown/release/${name}.wasm`;
    const bytes = await readFile(resolve(root, path));
    if (!bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])))
      throw new Error('Artifact is not WebAssembly');
    artifacts.push({
      account_id,
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      initialization: {
        method: 'new',
        args,
        gas: '100000000000000',
        deposit: '0',
      },
      unsigned_cli: [
        'near',
        'contract',
        'deploy',
        account_id,
        'use-file',
        path,
        'with-init-call',
        'new',
        'json-args',
        JSON.stringify(args),
        'prepaid-gas',
        '100 Tgas',
        'attached-deposit',
        '0 NEAR',
        'network-config',
        'testnet',
        'sign-later',
      ],
    });
  }
  const plan = {
    network: 'testnet',
    status: 'UNSIGNED_NOT_SUBMITTED',
    accounts: config,
    artifacts,
    registration: {
      signer: config.ownerId,
      receiver: config.tokenId,
      method: 'storage_deposit',
      args: { account_id: config.caseId, registration_only: true },
      deposit: 'Query storage_balance_bounds.min before signing',
    },
    funding: {
      signer: config.ownerId,
      receiver: config.tokenId,
      method: 'ft_transfer_call',
      gas: '250000000000000',
      deposit: '1',
      args: {
        receiver_id: config.caseId,
        amount: '1000000000',
        msg: JSON.stringify({ action: 'fund' }),
      },
    },
    warning:
      'All named accounts require verified creation and explicit wallet authorization. Deploy and initialize atomically. No credential files are used by this planner.',
  };
  const target = resolve(
    process.argv[3] ?? '/tmp/iroh-usdi-deployment-plan.json',
  );
  await writeFile(target, JSON.stringify(plan, null, 2) + '\n');
  console.log(
    `Unsigned public deployment plan written to ${target}. No transaction was submitted.`,
  );
} else {
  console.error(
    'Usage: node scripts/usdi-deployment.mjs check [public-report.json] | plan [unsigned-plan.json]',
  );
  process.exitCode = 2;
}
