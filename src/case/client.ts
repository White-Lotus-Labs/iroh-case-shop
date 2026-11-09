import publicConfig from '../../config/contracts.testnet.json';
import type { WalletFunctionCall } from '../ui/wallet/nearConnector';

export type Deployment = {
  network: 'testnet';
  rpcUrl: string;
  tokenContractId: string;
  caseContractId: string;
};
export function deployment(value: unknown): Deployment | null {
  const config = object(value);
  if (config.network !== 'testnet')
    throw new Error('Only NEAR Testnet is supported.');
  const rpcUrl = text(config.rpcUrl);
  if (new URL(rpcUrl).protocol !== 'https:')
    throw new Error('A public HTTPS Testnet RPC is required.');
  if (config.tokenContractId === null || config.caseContractId === null)
    return null;
  return {
    network: 'testnet',
    rpcUrl,
    tokenContractId: contractId(config.tokenContractId),
    caseContractId: contractId(config.caseContractId),
  };
}
export const configuredDeployment = deployment(publicConfig);

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Malformed contract response.');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Malformed contract text.');
  return value;
}
function contractId(value: unknown) {
  const id = text(value);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(id) || id.length > 64)
    throw new Error('Configure genuine .testnet contract IDs.');
  return id;
}
export function integer(value: unknown, bits = 128): string {
  const result = text(value);
  if (
    !/^(0|[1-9][0-9]*)$/.test(result) ||
    result.length > 39 ||
    BigInt(result) >= 2n ** BigInt(bits)
  )
    throw new Error('Malformed contract integer.');
  return result;
}
function count(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffffffff
  )
    throw new Error('Malformed contract count.');
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Malformed contract flag.');
  return value;
}
export function formatUnits(value: string, decimals = 6) {
  const n = BigInt(integer(value));
  const base = 10n ** BigInt(decimals);
  const fraction = (n % base)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${n / base}${fraction ? `.${fraction}` : ''}`;
}
export function percent(value: number) {
  return `${(value / 10000).toFixed(4).replace(/\.?0+$/, '')}%`;
}
function odds(value: Record<string, unknown>) {
  const common = count(value.common),
    rare = count(value.rare),
    legendary = count(value.legendary);
  if (
    value.denominator !== 1_000_000 ||
    common + rare + legendary !== 1_000_000
  )
    throw new Error('Invalid probability distribution.');
  return { common, rare, legendary, denominator: 1_000_000 };
}
export function parseQuote(raw: unknown) {
  const v = object(raw);
  if (v.case_id !== 'dragon-tea') throw new Error('Unexpected case.');
  return {
    ...odds(v),
    revision: integer(v.revision, 64),
    expires_at: integer(v.expires_at, 64),
    nonce: integer(v.nonce, 64),
    target_ev: integer(v.target_ev),
    expected_numerator: integer(v.expected_numerator),
    available: integer(v.available),
    can_open: flag(v.can_open),
    reason: v.reason === null ? null : text(v.reason),
  };
}
export type Quote = ReturnType<typeof parseQuote>;
export function parsePool(raw: unknown) {
  const v = object(raw);
  const health = text(v.health);
  if (!['Healthy', 'Caution', 'Critical'].includes(health))
    throw new Error('Unknown pool health.');
  const pool = {
    pool_funds: integer(v.pool_funds),
    reserved_rewards: integer(v.reserved_rewards),
    available: integer(v.available),
    target: integer(v.target),
    health,
    pending_fees: integer(v.pending_fees),
    treasury_available: integer(v.treasury_available),
    treasury_in_flight: integer(v.treasury_in_flight),
    in_flight_payouts: integer(v.in_flight_payouts),
    pending_openings: count(v.pending_openings),
    completed_payouts: integer(v.completed_payouts, 64),
    total_paid: integer(v.total_paid),
    revision: integer(v.revision, 64),
    paused: flag(v.paused),
    can_open: flag(v.can_open),
    storage_per_opening: integer(v.storage_per_opening),
    storage_account_cost: integer(v.storage_account_cost),
    expected_balance_min: integer(v.expected_balance_min),
    expected_balance_max: integer(v.expected_balance_max),
  };
  if (
    BigInt(pool.pool_funds) - BigInt(pool.reserved_rewards) !==
    BigInt(pool.available)
  )
    throw new Error('Inconsistent pool accounting.');
  return pool;
}
export type Pool = ReturnType<typeof parsePool>;
const rewardTiers = [
  { tier: 'Common', amount: '100000', probability: 'common' },
  { tier: 'Rare', amount: '1000000', probability: 'rare' },
  { tier: 'Legendary', amount: '5000000', probability: 'legendary' },
] as const;

export function rewardTier(amount: string) {
  return rewardTiers.find((reward) => reward.amount === amount)?.tier;
}

export type PublicOdds = Pick<
  Quote,
  | 'common'
  | 'rare'
  | 'legendary'
  | 'expected_numerator'
  | 'revision'
  | 'available'
>;

export function parseCase(raw: unknown) {
  const v = object(raw);
  if (
    v.case_id !== 'dragon-tea' ||
    v.price !== '1000000' ||
    v.pool_contribution !== '950000' ||
    v.platform_fee !== '50000' ||
    v.probability_denominator !== 1_000_000
  )
    throw new Error('Unexpected Dragon Tea economics.');
  const rewards = v.rewards;
  if (
    !Array.isArray(rewards) ||
    rewards.length !== rewardTiers.length ||
    rewardTiers.some(({ tier, amount }, index) => {
      const reward = object(
        v.rewards instanceof Array ? v.rewards[index] : null,
      );
      return reward.tier !== tier || reward.amount !== amount;
    })
  )
    throw new Error('Unexpected Dragon Tea rewards.');
  return {
    name: text(v.name),
    price: v.price,
    poolContribution: v.pool_contribution,
    platformFee: v.platform_fee,
    rewards: rewardTiers,
    token_id: contractId(v.token_id),
    randomness: text(v.randomness),
    quote_policy: text(v.quote_policy),
  };
}
function openingStatus(
  raw: unknown,
): 'RandomnessPending' | 'Paying' | 'Claimable' | 'Completed' {
  if (
    raw === 'RandomnessPending' ||
    raw === 'Paying' ||
    raw === 'Claimable' ||
    raw === 'Completed'
  )
    return raw;
  throw new Error('Unknown opening status.');
}
export function parseOpening(raw: unknown) {
  const v = object(raw);
  const status = openingStatus(v.status);
  const reward = v.reward === null ? null : integer(v.reward);
  if (reward !== null && !rewardTier(reward))
    throw new Error('Unexpected reward.');
  if (status === 'RandomnessPending' ? reward !== null : reward === null)
    throw new Error('Inconsistent opening result.');
  return {
    ...odds(v),
    opening_id: integer(v.opening_id, 64),
    account_id: text(v.account_id),
    nonce: integer(v.nonce, 64),
    accepted_height: integer(v.accepted_height, 64),
    accepted_revision: integer(v.accepted_revision, 64),
    status,
    reward,
    draw: v.draw === null ? null : count(v.draw),
    attempt: integer(v.attempt, 64),
    reserved: integer(v.reserved),
  };
}
export type Opening = ReturnType<typeof parseOpening>;
export type AccountData = {
  accountId: string;
  balance: string;
  claimed: boolean;
  claimCost: string;
  storage: string;
  tokenRegistered: boolean;
  tokenStorageCost: string;
  quote: Quote;
  active: Opening | null;
  history: Opening[];
};

export type ExpectedTransaction = WalletFunctionCall & {
  afterBlockHeight: string;
};

export function parseFunctionCall(raw: unknown): WalletFunctionCall {
  const v = object(raw);
  const methodName = text(v.methodName);
  if (!/^[a-z][a-z0-9_]*$/.test(methodName))
    throw new Error('Malformed contract method.');
  const args = object(v.args);
  if (JSON.stringify(args).length > 20000)
    throw new Error('Malformed contract arguments.');
  return {
    receiverId: contractId(v.receiverId),
    methodName,
    args,
    gas: integer(v.gas, 64),
    deposit: integer(v.deposit),
  };
}
function rpcInteger(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Malformed RPC integer.');
    return integer(String(value), 64);
  }
  return integer(value, 64);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Malformed contract arguments.');
  return encoded;
}
function callMatches(raw: unknown, expected: WalletFunctionCall): boolean {
  try {
    const call = object(raw);
    const encoded = text(call.args);
    if (encoded.length > 30000) return false;
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const args: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    return (
      call.method_name === expected.methodName &&
      integer(call.deposit) === expected.deposit &&
      rpcInteger(call.gas) === expected.gas &&
      canonical(args) === canonical(expected.args)
    );
  } catch {
    return false;
  }
}

export class TestnetTransportError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

export class CaseClient {
  constructor(
    readonly config: Deployment,
    private readonly request: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}
  async rpc(
    method: string,
    params: object,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(8000);
    const send = async () => {
      const response = await this.request(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'iroh-cases',
          method,
          params,
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        cache: 'no-store',
      });
      if (!response.ok) {
        if (response.status === 429)
          throw new TestnetTransportError(
            'Testnet RPC rate limit reached (HTTP 429).',
          );
        throw new TestnetTransportError(
          `Testnet RPC unavailable (HTTP ${response.status}).`,
          response.status >= 500,
        );
      }
      return object(await response.json());
    };
    let body: Record<string, unknown>;
    try {
      body = await send();
    } catch (cause) {
      if (signal?.aborted) throw cause;
      if (timeout.aborted)
        throw new TestnetTransportError('Testnet RPC request timed out.');
      if (cause instanceof TypeError)
        throw new TestnetTransportError('Could not reach Testnet RPC.');
      throw cause;
    }
    if (body.error !== undefined)
      throw new Error(
        'Testnet RPC could not confirm this request. Refresh to check chain state.',
      );
    if (!('result' in body)) throw new Error('Malformed RPC response.');
    return body.result;
  }
  async finalBlockHeight(signal?: AbortSignal): Promise<string> {
    const block = object(
      await this.rpc('block', { finality: 'final' }, signal),
    );
    return rpcInteger(object(block.header).height);
  }
  async view(
    contract: string,
    method: string,
    args: object,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const bytes = new TextEncoder().encode(JSON.stringify(args));
    const args_base64 = btoa(
      Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''),
    );
    const result = object(
      await this.rpc(
        'query',
        {
          request_type: 'call_function',
          finality: 'final',
          account_id: contract,
          method_name: method,
          args_base64,
        },
        signal,
      ),
    );
    if (
      result.error !== undefined ||
      !Array.isArray(result.result) ||
      result.result.length > 200000 ||
      !result.result.every(
        (x: unknown) =>
          typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 255,
      )
    )
      throw new Error('Contract view failed or returned malformed bytes.');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(result.result),
      ),
    );
  }
  caseInfo = async (signal?: AbortSignal) => {
    const info = parseCase(
      await this.view(this.config.caseContractId, 'get_case', {}, signal),
    );
    if (info.token_id !== this.config.tokenContractId)
      throw new Error(
        'The game token does not match the configured USDI contract.',
      );
    return info;
  };

  pool = async (signal?: AbortSignal) =>
    parsePool(
      await this.view(this.config.caseContractId, 'get_pool', {}, signal),
    );

  async publicState(signal?: AbortSignal) {
    const [caseInfo, pool] = await Promise.all([
      this.caseInfo(signal),
      this.pool(signal),
    ]);
    return { caseInfo, pool };
  }

  async publicOdds(signal?: AbortSignal): Promise<PublicOdds> {
    const { common, rare, legendary, expected_numerator, revision, available } =
      await this.quote(this.config.caseContractId, signal);
    return { common, rare, legendary, expected_numerator, revision, available };
  }

  private tokenView(method: string, accountId: string, signal?: AbortSignal) {
    return this.view(
      this.config.tokenContractId,
      method,
      { account_id: accountId },
      signal,
    );
  }

  private caseView(method: string, accountId: string, signal?: AbortSignal) {
    return this.view(
      this.config.caseContractId,
      method,
      { account_id: accountId },
      signal,
    );
  }

  async balance(id: string, signal?: AbortSignal) {
    return integer(await this.tokenView('ft_balance_of', id, signal));
  }

  async claimed(id: string, signal?: AbortSignal) {
    return flag(await this.tokenView('has_claimed', id, signal));
  }

  async claimCost(id: string, signal?: AbortSignal) {
    return integer(await this.tokenView('claim_storage_cost', id, signal));
  }

  async storage(id: string, signal?: AbortSignal) {
    return integer(await this.caseView('storage_balance_of', id, signal));
  }

  async quote(id: string, signal?: AbortSignal) {
    return parseQuote(await this.caseView('get_quote', id, signal));
  }

  async active(id: string, signal?: AbortSignal) {
    const raw = await this.caseView('get_account_opening', id, signal);
    if (raw === null) return null;
    const current = this.accountOpening(raw, id);
    const opening = await this.opening(current.opening_id, signal);
    if (
      !opening ||
      opening.account_id !== id ||
      opening.opening_id !== current.opening_id
    )
      throw new Error('Opening does not match this account.');
    return opening;
  }

  private accountOpening(raw: unknown, id: string) {
    const opening = parseOpening(raw);
    if (opening.account_id !== id)
      throw new Error('Opening belongs to another account.');
    return opening;
  }

  async history(id: string, signal?: AbortSignal) {
    const raw = await this.view(
      this.config.caseContractId,
      'get_history',
      { account_id: id, limit: 10 },
      signal,
    );
    if (!Array.isArray(raw) || raw.length > 10)
      throw new Error('Malformed opening history.');
    return raw.map((opening: unknown) => this.accountOpening(opening, id));
  }

  async tokenRegistration(
    id: string,
    signal?: AbortSignal,
  ): Promise<
    | { tokenRegistered: true; tokenStorageCost: null }
    | { tokenRegistered: false; tokenStorageCost: string }
  > {
    const raw = await this.tokenView('storage_balance_of', id, signal);
    if (raw !== null) {
      const registration = object(raw);
      integer(registration.total);
      integer(registration.available);
      return { tokenRegistered: true, tokenStorageCost: null };
    }
    const bounds = object(
      await this.view(
        this.config.tokenContractId,
        'storage_balance_bounds',
        {},
        signal,
      ),
    );
    return { tokenRegistered: false, tokenStorageCost: integer(bounds.min) };
  }

  async account(accountId: string, signal?: AbortSignal): Promise<AccountData> {
    const [
      balance,
      claimed,
      claimCost,
      storage,
      quote,
      active,
      history,
      registration,
      bounds,
    ] = await Promise.all([
      this.balance(accountId, signal),
      this.claimed(accountId, signal),
      this.claimCost(accountId, signal),
      this.storage(accountId, signal),
      this.quote(accountId, signal),
      this.caseView('get_account_opening', accountId, signal),
      this.history(accountId, signal),
      this.tokenView('storage_balance_of', accountId, signal),
      this.view(
        this.config.tokenContractId,
        'storage_balance_bounds',
        {},
        signal,
      ),
    ]);
    if (registration !== null) {
      const fields = object(registration);
      integer(fields.total);
      integer(fields.available);
    }
    return {
      accountId,
      balance,
      claimed,
      claimCost,
      storage,
      quote,
      history,
      active: active === null ? null : this.accountOpening(active, accountId),
      tokenRegistered: registration !== null,
      tokenStorageCost: integer(object(bounds).min),
    };
  }

  async opening(id: string, signal?: AbortSignal) {
    const result = await this.view(
      this.config.caseContractId,
      'get_opening',
      { opening_id: integer(id, 64) },
      signal,
    );
    return result === null ? null : parseOpening(result);
  }
  async transaction(
    hash: string,
    accountId: string,
    signal?: AbortSignal,
    expected?: ExpectedTransaction,
  ) {
    const result = object(
      await this.rpc(
        'tx',
        {
          tx_hash: transactionHash(hash),
          sender_account_id: accountId,
          wait_until: 'FINAL',
        },
        signal,
      ),
    );
    const transaction = object(result.transaction);
    if (transaction.hash !== hash || transaction.signer_id !== accountId)
      throw new Error('Transaction does not match this account.');
    if (expected) {
      if (
        transaction.receiver_id !== expected.receiverId ||
        !Array.isArray(transaction.actions) ||
        transaction.actions.length !== 1
      )
        throw new Error(
          'Transaction does not match the pending contract action.',
        );
      const action = object(transaction.actions[0]);
      if (!callMatches(action.FunctionCall, expected))
        throw new Error(
          'Transaction does not match the pending contract action.',
        );
    }
    if (result.final_execution_status !== 'FINAL')
      throw new Error(
        'Transaction is still awaiting finality. Refresh to check again.',
      );
    if (expected) {
      const inclusionHash = transactionHash(
        object(result.transaction_outcome).block_hash,
      );
      const block = object(
        await this.rpc('block', { block_id: inclusionHash }, signal),
      );
      const header = object(block.header);
      if (
        header.hash !== inclusionHash ||
        BigInt(rpcInteger(header.height)) <=
          BigInt(integer(expected.afterBlockHeight, 64))
      ) {
        throw new Error(
          'Transaction predates this saved submission. Check the original wallet transaction.',
        );
      }
    }
    const status = object(result.status);
    if ('Failure' in status) return { hash, success: false };
    if (typeof status.SuccessValue !== 'string')
      throw new Error('Transaction has no final execution outcome.');
    // The NEP-141 transfer resolver returns the amount used by the receiver.
    if (
      expected?.methodName === 'ft_transfer_call' &&
      status.SuccessValue === btoa(JSON.stringify('0'))
    )
      return { hash, success: true, refunded: true };
    return { hash, success: true };
  }
}
export function transactionHash(value: unknown) {
  const hash = text(value);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash))
    throw new Error(
      'Wallet did not return a valid transaction hash. Check the wallet and refresh; do not resubmit.',
    );
  return hash;
}
export function walletTransactionHash(result: unknown) {
  const outcome = object(result);
  const hash = transactionHash(object(outcome.transaction).hash);
  const status = object(outcome.status);
  if (
    !('Failure' in status) &&
    typeof status.SuccessValue !== 'string' &&
    typeof status.SuccessReceiptId !== 'string'
  )
    throw new Error(
      'Malformed wallet transaction status. Check the wallet and refresh before signing again.',
    );
  return hash;
}
export function claimCall(
  config: Deployment,
  cost: string,
): WalletFunctionCall {
  return {
    receiverId: config.tokenContractId,
    methodName: 'claim_starter',
    args: {},
    gas: '50000000000000',
    deposit: integer(cost),
  };
}
export function tokenRegistrationCall(
  config: Deployment,
  cost: string,
): WalletFunctionCall {
  return {
    receiverId: config.tokenContractId,
    methodName: 'storage_deposit',
    args: { registration_only: true },
    gas: '30000000000000',
    deposit: integer(cost),
  };
}

export function storageCall(
  config: Deployment,
  pool: Pool,
): WalletFunctionCall {
  return {
    receiverId: config.caseContractId,
    methodName: 'storage_deposit',
    args: {},
    gas: '30000000000000',
    deposit: (
      BigInt(pool.storage_per_opening) + BigInt(pool.storage_account_cost)
    ).toString(),
  };
}
export function openCall(config: Deployment, quote: Quote): WalletFunctionCall {
  if (!quote.can_open)
    throw new Error(quote.reason ?? 'This case cannot accept an opening.');
  return {
    receiverId: config.tokenContractId,
    methodName: 'ft_transfer_call',
    args: {
      receiver_id: config.caseContractId,
      amount: '1000000',
      msg: JSON.stringify({
        action: 'open',
        case_id: 'dragon-tea',
        nonce: quote.nonce,
        quote: { revision: quote.revision, expires_at: quote.expires_at },
      }),
    },
    gas: '250000000000000',
    deposit: '1',
  };
}
export function recoverCall(
  config: Deployment,
  opening: Opening,
): WalletFunctionCall {
  if (opening.status !== 'Claimable' && opening.status !== 'RandomnessPending')
    throw new Error('An in-flight or completed reward cannot be retried.');
  return {
    receiverId: config.caseContractId,
    methodName:
      opening.status === 'Claimable' ? 'retry_payout' : 'advance_opening',
    args: { opening_id: opening.opening_id },
    gas: '150000000000000',
    deposit: '1',
  };
}
