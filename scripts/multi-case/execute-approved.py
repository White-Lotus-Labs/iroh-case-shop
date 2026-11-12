"""Execute only the byte-pinned approved Testnet batch. Importing never signs or writes."""
import argparse
import base64
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
APPROVED_SHA = '4cf07ab44a6dcf3f9aedf970c938808ec2bcb61e6e21fec959bf36d859db5cc9'
OWNER_KEY = 'ed25519:BntboZwnJtLVnBBh4XffXUDwbaygCsQiMmhWXD3xCi6'
DRAGON = 'cases-needmore-1-near.testnet'
USDI = 'usdi-needmore-1-near.testnet'
V1_SHA = 'ca7bcdef4d3640339318c4589808213df8f8de959de09210770f91e062e2c2aa'
V1_CODE = 'EdQrCQ4CDhFLJfJpPxShQVCj1K9DdfF4Cf3z247yh3ow'
EMPTY_CODE = '1' * 32
STORAGE = 1250000000000000000000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def compact(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def load_manifest(path):
    data = Path(path).read_bytes()
    require(hashlib.sha256(data).hexdigest() == APPROVED_SHA, 'Approved manifest checksum changed')
    batch = json.loads(data)
    require(batch['network'] == 'testnet' and len(batch['steps']) == 90, 'Unexpected approved network or step count')
    for artifact in batch['artifacts'].values():
        contents = (ROOT / artifact['path']).read_bytes()
        require(len(contents) == artifact['bytes'] and hashlib.sha256(contents).hexdigest() == artifact['sha256'], 'Artifact checksum changed')
    return batch


def signing_key(batch, step):
    return OWNER_KEY if step['signerId'] == batch['ownerId'] else next(k['publicKey'] for k in batch['dedicatedKeys'] if k['accountId'] == step['signerId'])


def command_for(batch, step, before):
    require(step in batch['steps'] and step['network'] == 'testnet', 'Unapproved step')
    require(isinstance(before.get('nonce'), int) and 0 <= before['nonce'] < 2**64-1
            and isinstance(before.get('block_hash'), str)
            and re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}', before['block_hash']), 'Checked Testnet block and nonce are required')
    actions = step['actions']
    signer = ['sign-with-keychain', '--signer-public-key', signing_key(batch, step), '--block-hash', before['block_hash'], '--nonce', str(before['nonce'] + 1), 'send']
    if actions[0]['type'] == 'CreateAccount':
        require([a['type'] for a in actions] == ['CreateAccount', 'Transfer', 'AddKey'], 'Invalid account creation')
        command = ['near', 'account', 'create-account', 'fund-myself', step['receiverId'], actions[1]['deposit'] + ' yoctoNEAR', 'use-manually-provided-public-key', actions[2]['publicKey'], 'sign-as', step['signerId']]
    elif actions[0]['type'] == 'DeployContract':
        require(step['signerId'] == step['receiverId'] and len(actions) == 2, 'Deployment must initialize atomically as self')
        call = actions[1]
        command = ['near', 'contract', 'deploy', step['receiverId'], 'use-file', str(ROOT / actions[0]['path']), 'with-init-call', call['methodName'], 'json-args', compact(call['args']), 'prepaid-gas', str(int(call['gas']) // 10**12) + ' Tgas', 'attached-deposit', call['deposit'] + ' yoctoNEAR']
    else:
        require(len(actions) == 1 and actions[0]['type'] == 'FunctionCall', 'Unexpected action')
        call = actions[0]
        command = ['near', 'contract', 'call-function', 'as-transaction', step['receiverId'], call['methodName'], 'json-args', compact(call['args']), 'prepaid-gas', str(int(call['gas']) // 10**12) + ' Tgas', 'attached-deposit', call['deposit'] + ' yoctoNEAR', 'sign-as', step['signerId']]
    return command + ['network-config', 'testnet'] + signer


def step_ceiling(batch, step):
    return sum(int(a.get('deposit', 0)) for a in step['actions']) + sum(int(a.get('gas', 0)) for a in step['actions']) * int(batch['gasPriceCeilingYoctoPerGas']) + int(batch['maximumActionFeesPerTransactionYocto'])


def remaining_budget(batch, entries):
    return sum(step_ceiling(batch, s) for s in batch['steps'] if entries.get(s['id'], {}).get('status') != 'verified')


def action_fee(step, protocol, gas_price):
    require(protocol['chain_id'] == 'testnet' and gas_price <= 10**9, 'Testnet gas price ceiling exceeded')
    costs = protocol['runtime_config']['transaction_costs']
    action = costs['action_creation_config']
    def fee(cost):
        return int(cost['execution']) + max(int(cost['send_sir']), int(cost['send_not_sir']))
    # Include callback receipt creation and bounded result-data transport as well as top-level actions.
    gas = 4 * fee(costs['action_receipt_creation_config']) + 2 * (fee(costs['data_receipt_creation_config']['base_cost']) + 1024 * fee(costs['data_receipt_creation_config']['cost_per_byte']))
    for item in step['actions']:
        kind = item['type']
        if kind == 'CreateAccount': gas += fee(action['create_account_cost'])
        elif kind == 'Transfer': gas += fee(action['transfer_cost'])
        elif kind == 'AddKey': gas += fee(action['add_key_cost']['full_access_cost'])
        elif kind == 'DeployContract': gas += fee(action['deploy_contract_cost']) + item['bytes'] * fee(action['deploy_contract_cost_per_byte'])
        elif kind == 'FunctionCall': gas += fee(action['function_call_cost']) + (len(compact(item['args']).encode()) + len(item['methodName'].encode())) * fee(action['function_call_cost_per_byte'])
        else: raise ValueError('Unsupported approved action')
    charge = int(protocol['runtime_config'].get('account_creation_charge', 0)) if step['actions'][0]['type'] == 'CreateAccount' else 0
    total = gas * gas_price + charge
    require(total <= 10**23, 'Action and callback fees exceed approved allowance')
    return total


def parse_hash(output):
    hashes = set(re.findall(r'(?:Transaction (?:ID|Id|id|hash)|transaction_id)\s*[:=]\s*["\']?([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])', output))
    hashes.update(re.findall(r'https://testnet.nearblocks.io/txns/([1-9A-HJ-NP-Za-km-z]{32,44})', output))
    return next(iter(hashes)) if len(hashes) == 1 else None


def may_submit(entry, previous, current):
    if entry is None: return
    require(entry['status'] == 'blocked_signer' and not entry.get('tx_hash'), 'Reconcile the saved transaction hash before resubmission')
    require(entry.get('before', {}).get('nonce') == previous.get('nonce') == current.get('nonce'), 'Signer nonce changed; reconcile before retry')


def local_signer_failure(returncode, output, before, after):
    message = output.lower()
    return (returncode != 0 and 'no access key' in message and 'keychain' in message
            and not parse_hash(output) and before['nonce'] == after['nonce']
            and before.get('target') == after.get('target') and before.get('book') == after.get('book'))


def keychain_available(account, runner=None):
    # Attribute-only query for this dedicated service. Never request password data.
    process = (runner or subprocess.run)(['security', 'find-generic-password', '-s', 'near-testnet-' + account], capture_output=True, text=True)
    return process.returncode == 0


def verify_receipt(batch, step, result, tx_hash):
    tx = result['transaction']
    require(result['final_execution_status'] == 'FINAL' and tx['hash'] == tx_hash and tx['signer_id'] == step['signerId'] and tx['receiver_id'] == step['receiverId'] and tx['public_key'] == signing_key(batch, step), 'Final transaction identity/key mismatch')
    require(len(tx['actions']) == len(step['actions']), 'Transaction actions changed')
    for expected, observed in zip(step['actions'], tx['actions']):
        kind = expected['type']
        if kind == 'CreateAccount': require(observed == 'CreateAccount' or observed == {'CreateAccount': {}}, 'CreateAccount action changed'); continue
        require(isinstance(observed, dict) and list(observed) == [kind], 'Unexpected transaction action')
        value = observed[kind]
        if kind == 'Transfer': require(value == {'deposit': expected['deposit']}, 'Transfer deposit changed')
        elif kind == 'AddKey': require(value['public_key'] == expected['publicKey'] and value['access_key'] == {'nonce': 0, 'permission': 'FullAccess'}, 'Added key changed')
        elif kind == 'DeployContract':
            code = base64.b64decode(value['code'], validate=True)
            # nearcore ActionView returns the code digest; full bytecode comes from view_code.
            digest = code.hex() if len(code) == 32 else hashlib.sha256(code).hexdigest()
            require(digest == expected['sha256'], 'Deployed action checksum changed')
        elif kind == 'FunctionCall': require(value['method_name'] == expected['methodName'] and int(value['gas']) == int(expected['gas']) and value['deposit'] == expected['deposit'] and json.loads(base64.b64decode(value['args'], validate=True)) == expected['args'], 'Function arguments, gas or deposit changed')
    require('SuccessValue' in result['status'], 'Transaction failed or remains unresolved')
    root = result['transaction_outcome']
    require(root['id'] == tx_hash, 'Root receipt mismatch')
    outcomes = result['receipts_outcome']
    by_id = {row['id']: row['outcome'] for row in outcomes}
    require(len(by_id) == len(outcomes), 'Duplicate receipt')
    pending, seen = list(root['outcome']['receipt_ids']), set()
    while pending:
        identifier = pending.pop()
        require(identifier in by_id and identifier not in seen, 'Incomplete or repeating receipt graph')
        seen.add(identifier); pending.extend(by_id[identifier]['receipt_ids'])
    require(seen == set(by_id), 'Unrelated receipt graph')
    for value in [root['outcome'], *by_id.values()]:
        require(len(value['status']) == 1 and any(k in value['status'] for k in ('SuccessValue', 'SuccessReceiptId')), 'Receipt failure')
        if 'SuccessReceiptId' in value['status']: require(value['status']['SuccessReceiptId'] in value['receipt_ids'], 'Unreachable forwarded receipt')
    if step['actions'][0].get('methodName') == 'ft_transfer_call':
        try: accepted = json.loads(base64.b64decode(result['status']['SuccessValue'], validate=True))
        except (ValueError, UnicodeError): accepted = None
        require(accepted == step['actions'][0]['args']['amount'], 'Funding resolver full acceptance missing')
    return sum(int(row['tokens_burnt']) for row in [root['outcome'], *by_id.values()])


def code_hash(digest):
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    data = bytes.fromhex(digest); number = int.from_bytes(data, 'big'); result = ''
    while number: number, digit = divmod(number, 58); result = alphabet[digit] + result
    return '1' * (len(data) - len(data.lstrip(b'\0'))) + result


def case_book(rpc, account, token, pin):
    pool = rpc.view(account, pin, 'get_pool', {})
    require(pool['paused'] and all(int(pool[k]) == 0 for k in ('reserved_rewards', 'in_flight_payouts', 'treasury_in_flight', 'pending_fees', 'pending_openings')), 'Case must be paused with zero pending liabilities')
    if token == USDI:
        require(pool['expected_balance_min'] == pool['expected_balance_max'], 'Unresolved USDI book')
        book = int(pool['expected_balance_max'])
    else:
        row = next(r for r in rpc.view(account, pin, 'get_reward_inventory', {}) if r['token_contract_id'] == token)
        require(all(int(row[k]) == 0 for k in ('reserved', 'in_flight')), 'Unresolved bonus book')
        book = int(row['funds'])
    actual = int(rpc.view(token, pin, 'ft_balance_of', {'account_id': account}))
    require(actual == book, 'Token balance does not equal its book')
    return {'balance': book, 'pool': pool}


def dragon_snapshot(rpc, pin):
    return {'pool': rpc.view(DRAGON, pin, 'get_pool', {}), 'history': rpc.view(DRAGON, pin, 'get_history', {'account_id': 'needmore_1_near.testnet', 'limit': 20}), 'state': rpc.query(DRAGON, pin, 'view_state', prefix_base64='')['values']}


def check_dragon(old, current, revision):
    require(current['pool']['paused'] and current['pool']['revision'] == str(revision), 'Dragon paused revision changed')
    for key in ('pool_funds', 'reserved_rewards', 'pending_fees', 'treasury_available', 'treasury_in_flight', 'in_flight_payouts', 'pending_openings', 'completed_payouts', 'total_paid', 'expected_balance_min', 'expected_balance_max'):
        require(old['pool'][key] == current['pool'][key], 'Dragon accounting changed: ' + key)
    require(len(old['history']) == len(current['history']) == 4, 'Dragon historical count changed')
    for expected, observed in zip(old['history'], current['history']):
        require(all(observed.get(key) == value for key, value in expected.items()), 'Dragon legacy opening changed')
    after = {r['key']: r['value'] for r in current['state']}
    require(all(after.get(row['key']) == row['value'] for row in old['state'] if base64.b64decode(row['key']) != b'STATE'), 'Dragon legacy trie rows or credits changed')


def preconditions(batch, step, rpc, entries):
    require(rpc.call('status', [])['chain_id'] == 'testnet', 'Testnet required')
    block = rpc.call('block', {'finality': 'final'})['header']; pin = block['hash']
    price = int(rpc.call('gas_price', [pin])['gas_price'])
    protocol = rpc.call('EXPERIMENTAL_protocol_config', {'block_id': pin})
    action_fee(step, protocol, max(price, int(protocol['runtime_config'].get('min_gas_purchase_price', 0))))
    for account, expected in batch['expectedExistingCode'].items():
        require(rpc.query(account, pin)['code_hash'] == expected, 'Existing token code drift: ' + account)
    expected_keys = {k['accountId']: k['publicKey'] for k in batch['dedicatedKeys']}
    expected_keys[batch['ownerId']] = OWNER_KEY
    for account, key in expected_keys.items():
        state = rpc.query(account, pin)
        if state.get('absent'):
            require(not any(entries.get(s['id'], {}).get('status') == 'verified' for s in batch['steps'] if s['receiverId'] == account and s['actions'][0]['type'] == 'CreateAccount'), 'A verified account disappeared')
            continue
        keys = rpc.query(account, pin, 'view_access_key_list')['keys']
        require(len(keys) == 1 and keys[0]['public_key'] == key and keys[0]['access_key']['permission'] == 'FullAccess', 'Unexpected account keys: ' + account)
        deployment = next((s for s in batch['steps'] if s['receiverId'] == account and s['actions'][0]['type'] == 'DeployContract'), None)
        if deployment:
            upgraded = entries.get(deployment['id'], {}).get('status') == 'verified'
            expected = code_hash(deployment['actions'][0]['sha256']) if upgraded else V1_CODE if account == DRAGON else EMPTY_CODE
            require(state['code_hash'] == expected, 'Unexpected deployed code: ' + account)
    owner = rpc.query(batch['ownerId'], pin)
    require(int(owner['amount']) >= remaining_budget(batch, entries), 'Owner balance below remaining approved budget')
    key = rpc.query(step['signerId'], pin, 'view_access_key', public_key=signing_key(batch, step))
    require(key['permission'] == 'FullAccess', 'FullAccess signer required')
    signer = rpc.query(step['signerId'], pin)
    storage_backing = int(signer['storage_usage']) * int(protocol['runtime_config']['storage_amount_per_byte'])
    require(int(signer['amount']) - storage_backing >= step_ceiling(batch, step), 'Signer native balance cannot reserve the approved step ceiling')
    target = rpc.query(step['receiverId'], pin)
    before = {'block_hash': pin, 'block_height': block['height'], 'nonce': key['nonce'], 'target': {k: v for k, v in target.items() if k not in ('block_hash', 'block_height')}}
    for condition in step['preconditions']:
        if condition.endswith(' verified') and condition.split()[0] in {s['id'] for s in batch['steps']}:
            require(entries.get(condition.split()[0], {}).get('status') == 'verified', 'Dependency not verified')
    first = step['actions'][0]
    if first['type'] == 'CreateAccount': require(rpc.query(step['receiverId'], pin).get('absent'), 'Creation target already exists')
    elif first['type'] == 'DeployContract':
        if step['id'] == 'dragon-upgrade':
            before['dragon'] = dragon_snapshot(rpc, pin)
            check_dragon(before['dragon'], before['dragon'], 14)
            require(all(int(before['dragon']['pool'][k]) == 0 for k in ('in_flight_payouts', 'treasury_in_flight', 'reserved_rewards', 'pending_openings')), 'Dragon migration has unresolved liabilities')
        else:
            require(rpc.query(step['receiverId'], pin)['code_hash'] == EMPTY_CODE and not rpc.query(step['receiverId'], pin, 'view_state', prefix_base64='')['values'], 'Deployment target is not empty')
    elif first['methodName'] == 'storage_deposit':
        require(rpc.view(step['receiverId'], pin, 'storage_balance_of', {'account_id': first['args']['account_id']}) is None, 'Storage registration already exists; reconcile its hash')
        bounds = rpc.view(step['receiverId'], pin, 'storage_balance_bounds', {})
        require(int(bounds['min']) == int(bounds['max']) == int(first['deposit']) == STORAGE, 'Storage bound changed')
    elif first['methodName'] == 'ft_transfer_call':
        target = first['args']['receiver_id']; before['book'] = case_book(rpc, target, step['receiverId'], pin)
        expected_book = (996000000 if target == DRAGON and step['receiverId'] == USDI else 0) + sum(int(s['actions'][0]['args']['amount']) for s in batch['steps'] if s['receiverId'] == step['receiverId'] and s['actions'][0].get('methodName') == 'ft_transfer_call' and s['actions'][0]['args']['receiver_id'] == target and entries.get(s['id'], {}).get('status') == 'verified')
        require(before['book']['balance'] == expected_book, 'Case funding differs from approved completed allocations')
        require(rpc.view(step['receiverId'], pin, 'storage_balance_of', {'account_id': target}) is not None, 'Fund recipient not registered')
        allocation = sum(int(s['actions'][0]['args']['amount']) for s in batch['steps'] if s['receiverId'] == step['receiverId'] and s['actions'][0].get('methodName') == 'ft_transfer_call' and entries.get(s['id'], {}).get('status') != 'verified')
        require(int(rpc.view(step['receiverId'], pin, 'ft_balance_of', {'account_id': batch['ownerId']})) >= allocation, 'Owner token inventory insufficient for remaining allocation')
    elif first['args']['paused']:
        before['dragon'] = dragon_snapshot(rpc, pin)
        require(not before['dragon']['pool']['paused'] and before['dragon']['pool']['revision'] == '13', 'Original Dragon revision changed')
    else:
        account = step['receiverId']
        base = case_book(rpc, account, USDI, pin)
        if account == DRAGON: require(base['balance'] == 996000000, 'Dragon USDI balance changed before unpause')
        for fund in (s for s in batch['steps'] if s['actions'][0].get('methodName') == 'ft_transfer_call' and s['actions'][0]['args']['receiver_id'] == account):
            require(entries.get(fund['id'], {}).get('status') == 'verified', 'Unpause requires every funding receipt verified')
            book = case_book(rpc, account, fund['receiverId'], pin)
            require(book['balance'] == int(fund['actions'][0]['args']['amount']), 'Inventory allocation changed before unpause')
    return before


def postconditions(batch, step, rpc, before):
    pin = rpc.call('block', {'finality': 'final'})['header']['hash']; first = step['actions'][0]
    after = {'block_hash': pin}
    if first['type'] == 'CreateAccount':
        keys = rpc.query(step['receiverId'], pin, 'view_access_key_list')['keys']
        require(len(keys) == 1 and keys[0]['public_key'] == step['actions'][2]['publicKey'] and keys[0]['access_key']['permission'] == 'FullAccess', 'Created account key mismatch')
        require(int(rpc.query(step['receiverId'], pin)['amount']) == int(step['actions'][1]['deposit']), 'Created account balance mismatch')
    elif first['type'] == 'DeployContract':
        code = base64.b64decode(rpc.query(step['receiverId'], pin, 'view_code')['code_base64'])
        require(hashlib.sha256(code).hexdigest() == first['sha256'], 'Deployed code checksum mismatch')
        init = step['actions'][1]
        if init['methodName'] == 'migrate_v1':
            after['dragon'] = dragon_snapshot(rpc, pin); check_dragon(before['dragon'], after['dragon'], 15)
            inventory = rpc.view(DRAGON, pin, 'get_reward_inventory', {})
            require([row['token_contract_id'] for row in inventory] == init['args']['reward_tokens'] and all(int(row[k]) == 0 for row in inventory for k in ('funds', 'reserved', 'in_flight')), 'Migration inventory tokens or zeroed balances changed')
        elif init['methodName'] == 'new_configured':
            info = rpc.view(step['receiverId'], pin, 'get_case', {}); config = init['args']['config']
            require(info['case_id'] == config['case_id'] and info['name'] == config['name'] and info['token_id'] == init['args']['token_id'] and info['target'] == config['economy']['target'] and info['price'] == config['economy']['price'] and [r['amount'] for r in info['rewards']] == config['economy']['rewards'], 'Initialized case config mismatch')
            inventory = rpc.view(step['receiverId'], pin, 'get_reward_inventory', {})
            require(len(inventory) == len(config['bonus_rewards']), 'Bonus configuration length changed')
            for expected, observed in zip(config['bonus_rewards'], inventory):
                require(all(observed[k] == expected[k] for k in ('token_contract_id', 'token_symbol', 'token_decimals', 'amount', 'display_name')) and observed['tier'] == ['Common', 'Rare', 'Legendary'][expected['tier']], 'Bonus metadata mismatch')
                require(all(int(observed[k]) == 0 for k in ('funds', 'reserved', 'in_flight')), 'New bonus book is not empty')
            after['book'] = case_book(rpc, step['receiverId'], USDI, pin); require(after['book']['balance'] == 0, 'New case has nonzero USDI book')
        else:
            registry = json.loads((ROOT / 'config/tokens.testnet.json').read_text())
            token = next(t for t in registry['tokens'] if t['contractId'] == step['receiverId'])
            metadata = rpc.view(step['receiverId'], pin, 'ft_metadata', {})
            require(all(metadata[k] == token[k] for k in ('name', 'symbol', 'decimals')), 'Token metadata mismatch')
            require(rpc.view(step['receiverId'], pin, 'ft_total_supply', {}) == token['totalSupplyRaw'] == rpc.view(step['receiverId'], pin, 'ft_balance_of', {'account_id': batch['ownerId']}), 'Fixed token supply mismatch')
    elif first['methodName'] == 'storage_deposit':
        require(rpc.view(step['receiverId'], pin, 'storage_balance_of', {'account_id': first['args']['account_id']}) == {'total': str(STORAGE), 'available': '0'}, 'Storage postcondition mismatch')
    elif first['methodName'] == 'ft_transfer_call':
        after['book'] = case_book(rpc, first['args']['receiver_id'], step['receiverId'], pin)
        require(after['book']['balance'] == before['book']['balance'] + int(first['args']['amount']), 'Funded book increment mismatch')
    elif first['args']['paused']:
        after['dragon'] = dragon_snapshot(rpc, pin); check_dragon(before['dragon'], after['dragon'], 14)
    else:
        pool = rpc.view(step['receiverId'], pin, 'get_pool', {}); quote = rpc.view(step['receiverId'], pin, 'get_quote', {'account_id': batch['ownerId']})
        require(not pool['paused'] and pool['revision'] == quote['revision'] and pool['available'] == quote['available'], 'Unpaused quote revision mismatch')
    return after


def persist(path, journal, step_id, entry):
    journal['steps'][step_id] = entry
    records = list(journal['steps'].values())
    journal['verified_steps'] = sum(record['status'] == 'verified' for record in records)
    journal['remaining_steps'] = 90 - journal['verified_steps']
    journal['actual_fees_yocto'] = str(sum(int(record.get('actual_fee_yocto', 0)) for record in records))
    journal['status'] = ('complete' if journal['verified_steps'] == 90 else
        'needs_reconciliation' if any(record['status'] in ('uncertain', 'failed') for record in records) else
        'blocked_signer' if any(record['status'] == 'blocked_signer' for record in records) else 'in_progress')
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(journal, stream, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary, path)
    with path.with_name('execution-journal.jsonl').open('a') as stream:
        stream.write(compact({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'event': entry['status'], 'step_id': step_id, 'tx_hash': entry.get('tx_hash')}) + '\n'); stream.flush(); os.fsync(stream.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True); choice.add_argument('--step'); choice.add_argument('--all', action='store_true')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'docs/multi-case/deployment-batch.json')
    parser.add_argument('--rpc', default='https://rpc.testnet.fastnear.com')
    parser.add_argument('--reconcile-hash')
    args = parser.parse_args(); batch = load_manifest(args.manifest)
    execution_path = ROOT / 'docs/multi-case/execution.json'
    require(args.rpc.startswith('https://') and args.rpc in ('https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'), 'Use an approved public Testnet RPC')
    approval = json.loads((ROOT / 'docs/multi-case/approval.json').read_text())
    require(approval['batchSha256'] == APPROVED_SHA and approval['authorization'] == 'Approve exact batch once funded', 'Exact approval missing')
    spec = importlib.util.spec_from_file_location('iroh_preflight_readonly', Path(__file__).with_name('preflight.py')); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    rpc = module.Rpc(args.rpc)
    execution_path.parent.mkdir(parents=True, exist_ok=True)
    with execution_path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(execution_path.read_text()) if execution_path.exists() else {'manifest_sha256': APPROVED_SHA, 'steps': {}, 'native_budget_yocto': batch['budget']['maximumNativeExpenditureYocto']}
        require(journal['manifest_sha256'] == APPROVED_SHA, 'Execution journal approval mismatch')
        selected = [s for s in batch['steps'] if args.all or s['id'] == args.step]
        require(selected and not (args.all and args.reconcile_hash), 'Select one approved step for hash reconciliation')
        for step in selected:
            saved = journal['steps'].get(step['id'])
            if saved and saved['status'] == 'verified': continue
            if args.reconcile_hash:
                require(saved is not None and saved.get('before'), 'No saved preparation to reconcile')
                tx_hash = args.reconcile_hash; entry = dict(saved, tx_hash=tx_hash, status='submitted')
            else:
                before = preconditions(batch, step, rpc, journal['steps']); may_submit(saved, (saved or {}).get('before', {}), before)
                if 'initial_owner_balance_yocto' not in journal: journal['initial_owner_balance_yocto'] = rpc.query(batch['ownerId'], before['block_hash'])['amount']
                entry = {'status': 'prepared', 'tx_hash': None, 'signer_id': step['signerId'], 'receiver_id': step['receiverId'], 'before': before}
                persist(execution_path, journal, step['id'], entry)
                # No shell, environment credential lookup, signing retry, or raw CLI output in the journal.
                load_manifest(args.manifest)
                if not keychain_available(step['signerId']):
                    entry.update(status='blocked_signer', reason='Dedicated signer Keychain service unavailable; no signing attempted')
                    persist(execution_path, journal, step['id'], entry)
                    raise ValueError(entry['reason'])
                process = subprocess.run(command_for(batch, step, before), capture_output=True, text=True)
                tx_hash = parse_hash(process.stdout + '\n' + process.stderr)
                if not tx_hash:
                    local = False
                    try: local = local_signer_failure(process.returncode, process.stdout + process.stderr, before, preconditions(batch, step, rpc, journal['steps']))
                    except Exception: pass
                    entry.update(status='blocked_signer' if local else 'uncertain', reason='CLI produced no transaction hash; no automatic retry')
                    persist(execution_path, journal, step['id'], entry)
                    raise ValueError(entry['reason'])
                entry.update(status='submitted', tx_hash=tx_hash)
            persist(execution_path, journal, step['id'], entry)
            try:
                result = rpc.call('tx', {'tx_hash': tx_hash, 'sender_account_id': step['signerId'], 'wait_until': 'FINAL'})
                if result.get('final_execution_status') == 'FINAL' and result.get('transaction', {}).get('hash') == tx_hash:
                    receipt_path = execution_path.with_name('receipt-' + step['id'] + '.json')
                    receipt_path.write_text(json.dumps(result, indent=2) + '\n')
                    entry['receipt_file'] = str(receipt_path.relative_to(ROOT))
                    entry['actual_fee_yocto'] = str(sum(int(row['outcome']['tokens_burnt']) for row in [result['transaction_outcome'], *result['receipts_outcome']]))
                fee = verify_receipt(batch, step, result, tx_hash)
                require(fee <= step_ceiling(batch, step) - sum(int(a.get('deposit', 0)) for a in step['actions']), 'Actual execution fee exceeds approval')
                after = postconditions(batch, step, rpc, entry['before'])
                entry.update(status='verified', actual_fee_yocto=str(fee), after=after, verified_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
                persist(execution_path, journal, step['id'], entry)
                print(compact({'step_id': step['id'], 'status': 'verified', 'tx_hash': tx_hash, 'fee_yocto': str(fee)}), flush=True)
            except Exception:
                entry.update(status='uncertain', reason='Final receipt or postcondition verification incomplete; reconcile the saved hash')
                persist(execution_path, journal, step['id'], entry); raise


if __name__ == '__main__':
    main()
