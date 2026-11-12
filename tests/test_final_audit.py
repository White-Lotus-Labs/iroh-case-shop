import base64
import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def fixture():
    catalog = json.loads((ROOT / 'config/cases.testnet.json').read_text())
    registry = json.loads((ROOT / 'config/tokens.testnet.json').read_text())
    batch = json.loads((ROOT / 'docs/multi-case/deployment-batch.json').read_text())
    execution = module('audit_executor_fixture', 'scripts/multi-case/execute-approved.py')
    old_history = [{'opening_id': str(i), 'status': 'Completed', 'reward': ['1000000', '1000000', '5000000', '1000000'][i], 'draw': [494499, 282627, 980221, 688758][i]} for i in range(4)]
    journal = {'manifest_sha256': execution.APPROVED_SHA, 'verified_steps': 90,
        'steps': {step['id']: {'status': 'verified', 'tx_hash': execution.code_hash(f'{index + 1:064x}'), 'signer_id': step['signerId'], 'receiver_id': step['receiverId']} for index, step in enumerate(batch['steps'])}}
    journal['steps']['dragon-upgrade']['before'] = {'dragon': {'history': old_history}}
    snapshot = {'network': 'testnet', 'block_height': 200, 'block_hash': '3' * 32, 'cases': {}, 'tokens': {},
        'usdi_account': {'code_hash': batch['expectedExistingCode'][catalog['tokenContractId']]},
        'usdi_storage_bounds': {'min': str(execution.STORAGE), 'max': str(execution.STORAGE)}, 'usdi_case_storage': {}}
    for case in catalog['cases']:
        config = case['config']; economy = config['economy']; account = case['contractId']
        funding = {s['receiverId']: s['actions'][0]['args']['amount'] for s in batch['steps'] if s['actions'][0].get('methodName') == 'ft_transfer_call' and s['actions'][0]['args']['receiver_id'] == account}
        inventory = [{**bonus, 'tier': ['Common', 'Rare', 'Legendary'][bonus['tier']], 'chance_in_tier_bps': 5000,
            'candidates_in_tier': sum(b['tier'] == bonus['tier'] for b in config['bonus_rewards']),
            'funds': funding[bonus['token_contract_id']], 'available': funding[bonus['token_contract_id']], 'reserved': '0', 'in_flight': '0'} for bonus in config['bonus_rewards']]
        funds = '995800000' if case['id'] == 'dragon-tea' else funding[catalog['tokenContractId']]
        fees = '200000' if case['id'] == 'dragon-tea' else '0'
        balance = str(int(funds) + int(fees)); revision = '19' if case['id'] == 'dragon-tea' else str(len(funding) + 1)
        pool = {'pool_funds': funds, 'available': funds, 'treasury_available': fees, 'expected_balance_min': balance, 'expected_balance_max': balance,
            'paused': False, 'can_open': True, 'revision': revision, 'target': economy['target'], 'completed_payouts': '4' if case['id'] == 'dragon-tea' else '0', 'total_paid': '8000000' if case['id'] == 'dragon-tea' else '0',
            **{k: '0' for k in ('reserved_rewards', 'pending_fees', 'treasury_in_flight', 'in_flight_payouts', 'pending_openings')}}
        snapshot['cases'][case['id']] = {'account': {'code_hash': execution.code_hash(batch['artifacts']['case']['sha256'])}, 'wasm_sha256': batch['artifacts']['case']['sha256'],
            'public_keys': {'keys': [{'public_key': next(k['publicKey'] for k in batch['dedicatedKeys'] if k['accountId'] == account), 'access_key': {'permission': 'FullAccess'}}]},
            'case': {'case_id': case['id'], 'name': case['name'], 'token_id': catalog['tokenContractId'], 'price': economy['price'], 'target': economy['target'], 'pool_contribution': str(int(economy['price']) * 19 // 20), 'platform_fee': str(int(economy['price']) // 20), 'probability_denominator': 1000000,
                'rewards': [{'tier': tier, 'amount': amount, 'token_contract_id': catalog['tokenContractId'], 'token_symbol': 'USDI', 'token_decimals': 6} for tier, amount in zip(('Common', 'Rare', 'Legendary'), economy['rewards'])], 'bonus_rewards': inventory},
            'pool': pool, 'usdi_balance': balance, 'history': copy.deepcopy(old_history) if case['id'] == 'dragon-tea' else [], 'reward_inventory': inventory,
            'quote': {'case_id': case['id'], 'revision': revision, 'available': funds, 'common': 700000, 'rare': 250000, 'legendary': 50000, 'denominator': 1000000,
                'expected_numerator': str(sum(int(amount) * probability for amount, probability in zip(economy['rewards'], (700000, 250000, 50000)))), 'can_open': False, 'reason': 'Prepay case storage in NEAR'}}
        snapshot['usdi_case_storage'][case['id']] = {'total': str(execution.STORAGE), 'available': '0'}
    for token in (t for t in registry['tokens'] if t['selection'] == 'included'):
        balances = {case['id']: str(sum(int(row['funds']) for row in snapshot['cases'][case['id']]['reward_inventory'] if row['token_contract_id'] == token['contractId'])) for case in catalog['cases']}
        registrations = {case['id']: {'total': str(execution.STORAGE), 'available': '0'} if any(b['token_contract_id'] == token['contractId'] for b in case['config']['bonus_rewards']) else None for case in catalog['cases']}
        code = batch['expectedExistingCode'].get(token['contractId'], execution.code_hash(batch['artifacts']['mock']['sha256']))
        snapshot['tokens'][token['asset']] = {'account_id': token['contractId'], 'account': {'code_hash': code}, 'metadata': {k: token[k] for k in ('name', 'symbol', 'decimals')},
            'wasm_sha256': batch['artifacts']['mock']['sha256'],
            'public_keys': {'keys': [{'public_key': next((k['publicKey'] for k in batch['dedicatedKeys'] if k['accountId'] == token['contractId']), 'legacy-key'), 'access_key': {'permission': 'FullAccess'}}]},
            'supply': token['totalSupplyRaw'], 'owner_balance': str(int(token['totalSupplyRaw']) - sum(map(int, balances.values()))),
            'storage_bounds': {'min': str(execution.STORAGE), 'max': str(execution.STORAGE)}, 'case_balances': balances, 'case_storage': registrations,
            'dragon_balance': balances['dragon-tea'], 'dragon_storage': registrations['dragon-tea']}
    return batch, journal, snapshot, catalog, registry


class FinalAuditTests(unittest.TestCase):
    def setUp(self):
        self.audit = module('readonly_audit', 'scripts/multi-case/audit-execution.py')
        self.batch, self.journal, self.snapshot, self.catalog, self.registry = fixture()

    def run_audit(self):
        return self.audit.audit(self.batch, self.journal, self.snapshot, self.catalog, self.registry)

    def test_all_cases_and_tokens_pass_despite_planned_registry_status(self):
        for token in self.registry['tokens']:
            if token['selection'] == 'included' and token['asset'] not in ('SHITZU', 'RHEA', 'AURORA'): token['status'] = 'proposed'
        for case in self.catalog['cases']:
            if case['id'] != 'dragon-tea': case['deploymentStatus'] = 'planned'
        result = self.run_audit()
        self.assertEqual(result['verified_steps'], 90)
        self.assertEqual(len(result['cases']), 5)
        self.assertEqual(len(result['tokens']), 12)
        self.assertEqual(result['cases']['dragon-tea']['completed_history_preserved'], 4)
        self.assertFalse(result['cases']['bamboo-mist']['owner_quote_can_open'])

    def test_rejects_incomplete_batch_and_foreign_manifest(self):
        self.journal['steps']['token-NEKO-create']['status'] = 'prepared'
        with self.assertRaisesRegex(ValueError, '90|verified'): self.run_audit()
        self.journal['steps']['token-NEKO-create']['status'] = 'verified'
        self.journal['manifest_sha256'] = 'wrong'
        with self.assertRaisesRegex(ValueError, 'approval'): self.run_audit()

    def test_duplicate_verified_hashes_cannot_count_as_multiple_transactions(self):
        first, second = self.batch['steps'][:2]
        self.journal['steps'][second['id']]['tx_hash'] = self.journal['steps'][first['id']]['tx_hash']
        with self.assertRaisesRegex(ValueError, 'distinct'): self.run_audit()


    def test_quote_normalization_revision_and_expected_value_are_verified(self):
        quote = self.snapshot['cases']['moon-spirit']['quote']
        for key, bad in (('common', 700001), ('common', 0), ('revision', '999'), ('available', '0'), ('expected_numerator', '1')):
            old = quote[key]; quote[key] = bad
            with self.assertRaisesRegex(ValueError, 'quote|probabil|expected'): self.run_audit()
            quote[key] = old

    def test_cross_case_inventory_and_supply_cannot_be_hidden(self):
        self.snapshot['tokens']['NEKO']['case_balances']['moon-spirit'] = '1'
        with self.assertRaisesRegex(ValueError, 'balance|inventory'): self.run_audit()
        self.batch, self.journal, self.snapshot, self.catalog, self.registry = fixture()
        self.snapshot['tokens']['SHITZU']['owner_balance'] = '1'
        with self.assertRaisesRegex(ValueError, 'supply'): self.run_audit()

    def test_rejects_unregistered_storage_and_changed_legacy_history(self):
        self.snapshot['tokens']['MPDAO']['case_storage']['moon-spirit'] = None
        with self.assertRaisesRegex(ValueError, 'storage'): self.run_audit()
        self.batch, self.journal, self.snapshot, self.catalog, self.registry = fixture()
        self.snapshot['cases']['dragon-tea']['history'][0]['draw'] += 1
        with self.assertRaisesRegex(ValueError, 'legacy|Historical'): self.run_audit()

    def test_rejects_bonus_identity_metadata_and_case_configuration_drift(self):
        self.snapshot['cases']['bamboo-mist']['reward_inventory'][0]['token_decimals'] = 18
        with self.assertRaisesRegex(ValueError, 'bonus|Bonus|metadata'): self.run_audit()
        self.batch, self.journal, self.snapshot, self.catalog, self.registry = fixture()
        self.catalog['cases'][0]['config']['economy']['price'] = '1'
        with self.assertRaisesRegex(ValueError, 'config|economics'): self.run_audit()


class FakeRpc:
    endpoint = 'https://rpc.testnet.near.org'

    def __init__(self, batch, snapshot, catalog, registry, absent=()):
        self.batch, self.snapshot, self.catalog, self.registry = batch, snapshot, catalog, registry
        self.absent = set(absent)
        self.pins = []
        self.case_by_account = {case['contractId']: snapshot['cases'][case['id']] for case in catalog['cases']}
        self.token_by_account = {token['account_id']: token for token in snapshot['tokens'].values()}

    def call(self, method, params):
        if method == 'status': return {'chain_id': 'testnet'}
        if method == 'block': return {'header': {'height': 200, 'hash': '3' * 32}}
        if method == 'gas_price': return {'gas_price': '100000000'}
        if method == 'EXPERIMENTAL_protocol_config': return {'runtime_config': {'storage_amount_per_byte': '10000000000000000000'}}
        raise AssertionError('Unexpected read-only RPC method: ' + method)

    def query(self, account, pin, kind='view_account', **kwargs):
        self.pins.append(pin)
        if account in self.absent: return {'absent': True}
        current = self.case_by_account.get(account, self.token_by_account.get(account))
        if kind == 'view_account':
            if current: return copy.deepcopy(current['account'])
            if account == self.catalog['tokenContractId']: return copy.deepcopy(self.snapshot['usdi_account'])
            return {'amount': '100000000000000000000000000', 'code_hash': '1' * 32}
        if kind == 'view_access_key_list': return copy.deepcopy(current['public_keys']) if current else {'keys': []}
        if kind == 'view_code':
            artifact = self.batch['artifacts']['case' if account in self.case_by_account else 'mock']
            return {'code_base64': base64.b64encode((ROOT / artifact['path']).read_bytes()).decode()}
        raise AssertionError('Unexpected read-only query: ' + kind)

    def view(self, account, pin, method, args):
        self.pins.append(pin)
        if account in self.absent: raise AssertionError('Absent contract must not be called')
        if account in self.case_by_account:
            current = self.case_by_account[account]
            keys = {'get_case': 'case', 'get_pool': 'pool', 'get_history': 'history', 'get_quote': 'quote', 'get_reward_inventory': 'reward_inventory'}
            return copy.deepcopy(current[keys[method]])
        requested_case = next((case['id'] for case in self.catalog['cases'] if case['contractId'] == args.get('account_id')), None)
        if account == self.catalog['tokenContractId']:
            if method == 'ft_metadata': return {'name': 'USD Iroh', 'symbol': 'USDI', 'decimals': 6}
            if method == 'ft_total_supply': return '2000000000'
            if method == 'storage_balance_bounds': return copy.deepcopy(self.snapshot['usdi_storage_bounds'])
            if method == 'storage_balance_of': return copy.deepcopy(self.snapshot['usdi_case_storage'][requested_case])
            if method == 'ft_balance_of': return self.snapshot['cases'][requested_case]['usdi_balance'] if requested_case else '4000000'
        current = self.token_by_account[account]
        if method == 'ft_metadata': return copy.deepcopy(current['metadata'])
        if method == 'ft_total_supply': return current['supply']
        if method == 'storage_balance_bounds': return copy.deepcopy(current['storage_bounds'])
        if method == 'storage_balance_of': return copy.deepcopy(current['case_storage'][requested_case])
        if method == 'ft_balance_of': return current['case_balances'][requested_case] if requested_case else current['owner_balance']
        raise AssertionError('Unexpected read-only view: ' + method)


class PublicSnapshotTests(unittest.TestCase):
    def test_snapshot_reads_all_included_contracts_at_one_finalized_pin(self):
        batch, _, data, catalog, registry = fixture()
        rpc = FakeRpc(batch, data, catalog, registry)
        preflight = module('all_case_preflight', 'scripts/multi-case/preflight.py')
        snapshot = preflight.snapshot(rpc, catalog, registry)
        self.assertEqual(len(snapshot['tokens']), 12)
        self.assertEqual(len(snapshot['cases']), 5)
        self.assertEqual(snapshot['tokens']['MPDAO']['metadata']['symbol'], 'mpDAO')
        self.assertEqual(snapshot['tokens']['NEKO']['case_balances']['moon-spirit'], '5000000000000000000000000000')
        self.assertIsNone(snapshot['tokens']['RNEAR']['case_storage']['bamboo-mist'])
        self.assertEqual(snapshot['tokens']['SHITZU']['dragon_balance'], '5000000000')
        self.assertEqual(snapshot['usdi_case_storage']['phoenix-flame']['total'], '1250000000000000000000')
        self.assertTrue(all(pin == '3' * 32 for pin in rpc.pins))
        self.assertEqual(snapshot['cases']['moon-spirit']['reward_inventory'], data['cases']['moon-spirit']['reward_inventory'])

    def test_absent_proposed_contracts_are_recorded_without_method_calls(self):
        batch, _, data, catalog, registry = fixture()
        next(token for token in registry['tokens'] if token['asset'] == 'NEKO')['status'] = 'proposed'
        absent = {'neko.needmore_1_near.testnet', 'moon.needmore_1_near.testnet'}
        preflight = module('partial_case_preflight', 'scripts/multi-case/preflight.py')
        snapshot = preflight.snapshot(FakeRpc(batch, data, catalog, registry, absent), catalog, registry)
        self.assertTrue(snapshot['tokens']['NEKO']['account']['absent'])
        self.assertNotIn('metadata', snapshot['tokens']['NEKO'])
        self.assertTrue(snapshot['cases']['moon-spirit']['account']['absent'])
        self.assertTrue(snapshot['proposed_tokens']['NEKO']['account']['absent'])


if __name__ == '__main__': unittest.main()
