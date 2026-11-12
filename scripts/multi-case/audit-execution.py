"""Verify the recorded finalized public snapshot against the exact approved Dragon chain."""
import datetime
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('approved_executor', Path(__file__).with_name('execute-approved.py'))
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)

def main():
    batch = e.load_manifest(ROOT / 'docs/multi-case/deployment-batch.json')
    load = lambda name: json.loads((ROOT / name).read_text())
    journal = load('docs/multi-case/execution.json')
    snapshot = load('docs/multi-case/execution-preflight.json')
    catalog = load('config/cases.testnet.json')
    registry = load('config/tokens.testnet.json')
    dragon = snapshot['cases']['dragon-tea']
    case, pool, quote = dragon['case'], dragon['pool'], dragon['quote']
    config = next(c for c in catalog['cases'] if c['id'] == 'dragon-tea')['config']
    e.require(snapshot['network'] == 'testnet' and journal['manifest_sha256'] == e.APPROVED_SHA, 'Snapshot network or approval mismatch')
    e.require(dragon['wasm_sha256'] == batch['artifacts']['case']['sha256'], 'Deployed WASM mismatch')
    e.require(case['price'] == config['economy']['price'] and case['target'] == config['economy']['target'] and [r['amount'] for r in case['rewards']] == config['economy']['rewards'], 'Live economics mismatch')
    e.require(pool['revision'] == quote['revision'] == '19' and pool['paused'] is False and pool['can_open'] is True, 'Dragon activation mismatch')
    e.require(quote['can_open'] is True or quote['reason'] == 'Prepay case storage in NEAR', 'Unexpected owner quote restriction')
    e.require(pool['pool_funds'] == pool['available'] == '995800000' and pool['treasury_available'] == '200000' and dragon['usdi_balance'] == '996000000', 'USDI accounting mismatch')
    e.require(all(int(pool[k]) == 0 for k in ('reserved_rewards', 'pending_fees', 'treasury_in_flight', 'in_flight_payouts', 'pending_openings')), 'Unresolved liabilities')
    old_history = journal['steps']['dragon-upgrade']['before']['dragon']['history']
    e.require(len(old_history) == len(dragon['history']) == 4, 'Historical count mismatch')
    for old, current in zip(old_history, dragon['history']):
        e.require(all(current.get(k) == v for k, v in old.items()), 'Historical opening changed')
    e.require([r['token_contract_id'] for r in dragon['reward_inventory']] == [r['token_contract_id'] for r in config['bonus_rewards']], 'Inventory identity/order mismatch')
    for row in dragon['reward_inventory']:
        token = snapshot['tokens'][row['token_symbol']]
        expected = next(t for t in registry['tokens'] if t['asset'] == row['token_symbol'])
        e.require(all(token['metadata'][k] == expected[k] for k in ('name', 'symbol', 'decimals')), 'Token metadata mismatch')
        e.require(token['supply'] == expected['totalSupplyRaw'] and token['account']['code_hash'] == batch['expectedExistingCode'][row['token_contract_id']], 'Token supply or code mismatch')
        funding = next(s for s in batch['steps'] if s['id'].startswith('dragon-fund') and s['receiverId'] == row['token_contract_id'])
        e.require(token['dragon_balance'] == row['funds'] == row['available'] == funding['actions'][0]['args']['amount'], 'Inventory funding mismatch')
        e.require(row['reserved'] == row['in_flight'] == '0' and int(token['owner_balance']) + int(token['dragon_balance']) == int(token['supply']), 'Inventory or supply reconciliation mismatch')
        e.require(token['dragon_storage'] == {'total': str(e.STORAGE), 'available': '0'} and token['storage_bounds'] == {'min': str(e.STORAGE), 'max': str(e.STORAGE)}, 'Token storage mismatch')
    e.require(all(v['account'].get('absent') for k, v in snapshot['cases'].items() if k != 'dragon-tea'), 'Unexpected new case account')
    e.require(len(snapshot['proposed_tokens']) == 9 and all(v['account'].get('absent') for v in snapshot['proposed_tokens'].values()), 'Unexpected new token account')
    result = {'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'block_height': snapshot['block_height'], 'network': 'testnet', 'approved_digest': e.APPROVED_SHA, 'verified_steps': journal['verified_steps'], 'dragon_revision': pool['revision'], 'pool_allows_admissions': pool['can_open'], 'owner_quote_can_open': quote['can_open'], 'owner_quote_reason': quote['reason'], 'pool_usdi_raw': pool['pool_funds'], 'vested_fees_usdi_raw': pool['treasury_available'], 'completed_history_preserved': 4, 'inventory': dragon['reward_inventory'], 'existing_token_metadata_supply_balances_storage_code': 'matched', 'missing_new_case_accounts': 4, 'missing_new_token_accounts': 9, 'new_paid_openings_submitted': 0}
    (ROOT / 'docs/multi-case/evidence/final-readonly-audit.json').write_text(json.dumps(result, indent=2) + '\n')
    print('PASS pinned code, economics, quote/storage guard, preserved history, fixed token supplies, exact actual inventory and absent new accounts')

if __name__ == '__main__': main()
