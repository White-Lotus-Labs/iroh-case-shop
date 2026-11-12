"""Audit a finalized public snapshot after every exact approved deployment step verifies."""
import argparse
import datetime
import importlib.util
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('approved_executor', Path(__file__).with_name('execute-approved.py'))
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)


def audit(batch, journal, snapshot, catalog, registry):
    check = e.require
    check(snapshot['network'] == batch['network'] == 'testnet' and journal['manifest_sha256'] == e.APPROVED_SHA, 'Snapshot network or approval mismatch')
    check(len(batch['steps']) == 90 and all(journal['steps'].get(step['id'], {}).get('status') == 'verified' for step in batch['steps']), 'All 90 approved steps must be verified')
    for step in batch['steps']:
        record = journal['steps'][step['id']]
        check(re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}', record.get('tx_hash', '')) is not None, 'Verified step lacks a transaction hash')
        check(record.get('signer_id') == step['signerId'] and record.get('receiver_id') == step['receiverId'], 'Verified journal transaction identity mismatch')
    check(len({journal['steps'][step['id']]['tx_hash'] for step in batch['steps']}) == 90, 'Verified steps must have distinct transaction hashes')
    if 'verified_steps' in journal:
        check(journal['verified_steps'] == 90, 'Journal verified step count mismatch')
    check(len(catalog['cases']) == 5 and len(snapshot['cases']) == 5, 'Five case accounts required')
    included = [token for token in registry['tokens'] if token['selection'] == 'included']
    check(len(included) == 12 and len(snapshot['tokens']) == 12, 'Twelve included token accounts required')
    owner, usdi = batch['ownerId'], catalog['tokenContractId']
    check(snapshot['usdi_account']['code_hash'] == batch['expectedExistingCode'][usdi], 'Existing USDI code mismatch')
    bounds = {'min': str(e.STORAGE), 'max': str(e.STORAGE)}
    storage = {'total': str(e.STORAGE), 'available': '0'}
    check(snapshot['usdi_storage_bounds'] == bounds, 'USDI storage bounds changed')
    if 'usdi_metadata' in snapshot:
        check(snapshot['usdi_metadata']['symbol'] == 'USDI' and snapshot['usdi_metadata']['decimals'] == 6, 'USDI metadata mismatch')
    expected_keys = {key['accountId']: key['publicKey'] for key in batch['dedicatedKeys']}
    funds = {}
    for step in batch['steps']:
        action = step['actions'][0]
        if action.get('methodName') == 'ft_transfer_call':
            key = (action['args']['receiver_id'], step['receiverId'])
            funds[key] = funds.get(key, 0) + int(action['args']['amount'])
    tokens_by_id = {definition['contractId']: snapshot['tokens'][definition['asset']] for definition in included}
    case_results = {}
    for definition in catalog['cases']:
        case_id, account = definition['id'], definition['contractId']
        current = snapshot['cases'][case_id]
        check(not current['account'].get('absent'), 'Missing case account: ' + case_id)
        check(current['wasm_sha256'] == batch['artifacts']['case']['sha256'] and current['account']['code_hash'] == e.code_hash(batch['artifacts']['case']['sha256']), 'Case deployed WASM mismatch: ' + case_id)
        keys = current['public_keys']['keys']
        check(len(keys) == 1 and keys[0]['public_key'] == expected_keys[account] and keys[0]['access_key']['permission'] == 'FullAccess', 'Case key mismatch: ' + case_id)
        config = definition['config']
        if case_id == 'dragon-tea':
            check(config['economy']['price'] == '1000000' and config['economy']['rewards'] == ['100000', '1000000', '5000000'] and config['economy']['target'] == '1000000000', 'Dragon approved economics changed')
            migration = next(step for step in batch['steps'] if step['id'] == 'dragon-upgrade')['actions'][1]
            check([row['token_contract_id'] for row in config['bonus_rewards']] == migration['args']['reward_tokens'], 'Dragon bonus config changed')
        else:
            deployment = next(step for step in batch['steps'] if step['receiverId'] == account and step['actions'][0]['type'] == 'DeployContract')
            init = deployment['actions'][1]['args']
            check(init['owner_id'] == owner and init['treasury_id'] == batch['treasuryId'] and init['token_id'] == usdi and config == init['config'], 'Approved case config changed: ' + case_id)
        info, pool, quote = current['case'], current['pool'], current['quote']
        economy = config['economy']; price = int(economy['price']); rewards = economy['rewards']
        check(info['case_id'] == config['case_id'] == case_id and info['name'] == config['name'] == definition['name'] and info['token_id'] == usdi, 'Live case identity mismatch: ' + case_id)
        check(info['price'] == str(price) and info['target'] == pool['target'] == economy['target'] and info['pool_contribution'] == str(price * 19 // 20) and info['platform_fee'] == str(price // 20), 'Live case economics mismatch: ' + case_id)
        check([row['amount'] for row in info['rewards']] == rewards and [row['tier'] for row in info['rewards']] == ['Common', 'Rare', 'Legendary'], 'Live USDI rewards mismatch: ' + case_id)
        check(all(row['token_contract_id'] == usdi and row['token_symbol'] == 'USDI' and row['token_decimals'] == 6 for row in info['rewards']), 'USDI reward metadata mismatch')
        check(info['probability_denominator'] == quote['denominator'] == 1_000_000, 'Invalid quote probability denominator')
        probabilities = [quote[key] for key in ('common', 'rare', 'legendary')]
        check(all(type(value) is int and value > 0 for value in probabilities) and sum(probabilities) == 1_000_000, 'Invalid quote probability normalization: ' + case_id)
        check(quote['case_id'] == case_id and quote['revision'] == pool['revision'] and quote['available'] == pool['available'], 'Live quote revision or available pool mismatch: ' + case_id)
        check(quote['expected_numerator'] == str(sum(int(amount) * probability for amount, probability in zip(rewards, probabilities))), 'Live quote expected numerator mismatch: ' + case_id)
        check(pool['paused'] is False and pool['can_open'] is True and type(quote['can_open']) is bool, 'Case admission or owner quote mismatch: ' + case_id)
        check(quote['can_open'] is True or quote['reason'] == 'Prepay case storage in NEAR', 'Unexpected owner quote restriction: ' + case_id)
        check(all(int(pool[key]) == 0 for key in ('reserved_rewards', 'pending_fees', 'treasury_in_flight', 'in_flight_payouts', 'pending_openings')), 'Unresolved case liabilities: ' + case_id)
        expected_pool = 995800000 if case_id == 'dragon-tea' else funds[(account, usdi)]
        expected_fees = 200000 if case_id == 'dragon-tea' else 0
        check(pool['pool_funds'] == pool['available'] == str(expected_pool) and pool['treasury_available'] == str(expected_fees), 'Independent USDI pool or fee balance mismatch: ' + case_id)
        check(current['usdi_balance'] == pool['expected_balance_min'] == pool['expected_balance_max'] == str(expected_pool + expected_fees), 'Actual USDI balance does not reconcile: ' + case_id)
        check(snapshot['usdi_case_storage'][case_id] == storage, 'Case USDI storage mismatch: ' + case_id)
        if case_id == 'dragon-tea':
            history = journal['steps']['dragon-upgrade']['before']['dragon']['history']
            check(len(current['history']) == len(history) == 4, 'Historical count mismatch')
            check(all(all(now.get(key) == value for key, value in old.items()) for old, now in zip(history, current['history'])), 'Dragon legacy historical opening changed')
            check(pool['completed_payouts'] == '4' and pool['total_paid'] == '8000000' and pool['revision'] == '19', 'Dragon legacy payout accounting or revision changed')
        else:
            check(not current['history'] and pool['completed_payouts'] == pool['total_paid'] == '0', 'Unexpected new case opening or payout')
        inventory = current['reward_inventory']
        check(inventory == info['bonus_rewards'] and len(inventory) == len(config['bonus_rewards']), 'Bonus inventory catalog mismatch: ' + case_id)
        for expected, row in zip(config['bonus_rewards'], inventory):
            token = expected['token_contract_id']; tier = ['Common', 'Rare', 'Legendary'][expected['tier']]
            check(all(row[key] == expected[key] for key in ('token_contract_id', 'token_symbol', 'token_decimals', 'amount', 'display_name')) and row['tier'] == tier and row['chance_in_tier_bps'] == 5000, 'Bonus identity or metadata mismatch: ' + case_id)
            candidates = sum(candidate['tier'] == expected['tier'] for candidate in config['bonus_rewards'])
            check(row.get('candidates_in_tier', 1) == candidates and row.get('selection_denominator', candidates) == candidates, 'Bonus candidate probability mismatch')
            balance = str(funds[(account, token)])
            check(row['funds'] == row['available'] == tokens_by_id[token]['case_balances'][case_id] == balance, 'Actual bonus inventory balance mismatch: ' + case_id)
            check(int(balance) == int(expected['amount']) * 100 and row['reserved'] == row['in_flight'] == '0', 'Bonus allocation or liability mismatch')
            check(tokens_by_id[token]['case_storage'][case_id] == storage, 'Bonus token storage mismatch: ' + case_id)
        case_results[case_id] = {'contract_id': account, 'revision': pool['revision'], 'pool_allows_admissions': pool['can_open'], 'owner_quote_can_open': quote['can_open'], 'owner_quote_reason': quote['reason'], 'pool_usdi_raw': pool['pool_funds'], 'vested_fees_usdi_raw': pool['treasury_available'], 'probability_counts': dict(zip(('common', 'rare', 'legendary'), probabilities)), 'probability_denominator': quote['denominator'], 'expected_numerator': quote['expected_numerator'], 'completed_history_preserved': len(current['history']), 'inventory': inventory}
    token_results = {}
    for definition in included:
        token = snapshot['tokens'][definition['asset']]; account = definition['contractId']
        check(token['account_id'] == account and not token['account'].get('absent'), 'Missing bonus token account')
        check(all(token['metadata'][key] == definition[key] for key in ('name', 'symbol', 'decimals')), 'Bonus token metadata mismatch: ' + definition['asset'])
        check(token['supply'] == definition['totalSupplyRaw'], 'Fixed token supply mismatch: ' + definition['asset'])
        expected_code = batch['expectedExistingCode'].get(account, e.code_hash(batch['artifacts']['mock']['sha256']))
        check(token['account']['code_hash'] == expected_code, 'Token code mismatch: ' + definition['asset'])
        if account not in batch['expectedExistingCode']:
            check(token['wasm_sha256'] == batch['artifacts']['mock']['sha256'], 'New token WASM checksum mismatch')
            keys = token['public_keys']['keys']
            check(len(keys) == 1 and keys[0]['public_key'] == expected_keys[account] and keys[0]['access_key']['permission'] == 'FullAccess', 'New mock token key mismatch')
        check(token['storage_bounds'] == bounds, 'Bonus token storage bounds changed')
        check(set(token['case_balances']) == set(snapshot['cases']) and set(token['case_storage']) == set(snapshot['cases']), 'Token case balance coverage incomplete')
        for case in catalog['cases']:
            check(token['case_balances'][case['id']] == str(funds.get((case['contractId'], account), 0)), 'Cross-case token balance mismatch: ' + definition['asset'])
        check(int(token['owner_balance']) + sum(int(balance) for balance in token['case_balances'].values()) == int(token['supply']), 'Owner plus case balances do not reconcile to fixed token supply: ' + definition['asset'])
        token_results[definition['asset']] = {'contract_id': account, 'symbol': definition['symbol'], 'decimals': definition['decimals'], 'supply_raw': token['supply'], 'owner_balance_raw': token['owner_balance'], 'case_balances_raw': token['case_balances'], 'metadata_supply_balances_storage_code': 'matched'}
    return {'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'block_height': snapshot['block_height'], 'block_hash': snapshot['block_hash'], 'network': 'testnet', 'approved_digest': e.APPROVED_SHA, 'verified_steps': 90, 'cases': case_results, 'tokens': token_results, 'missing_new_case_accounts': 0, 'missing_new_token_accounts': 0, 'new_paid_openings_submitted': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=ROOT / 'docs/multi-case/execution-preflight.json')
    parser.add_argument('--execution', type=Path, default=ROOT / 'docs/multi-case/execution.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/multi-case/evidence/final-readonly-audit.json')
    args = parser.parse_args()
    batch = e.load_manifest(ROOT / 'docs/multi-case/deployment-batch.json')
    load = lambda path: json.loads(Path(path).read_text())
    result = audit(batch, load(args.execution), load(args.snapshot), load(ROOT / 'config/cases.testnet.json'), load(ROOT / 'config/tokens.testnet.json'))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print('PASS all 90 steps, five independent cases, twelve token supplies, exact inventories, quotes, storage and preserved Dragon history')


if __name__ == '__main__': main()
