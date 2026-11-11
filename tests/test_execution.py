import base64
import copy
import importlib.util
import json
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def executor():
    spec = importlib.util.spec_from_file_location('iroh_approved_executor', ROOT / 'scripts/multi-case/execute-approved.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.e = executor()
        self.batch = self.e.load_manifest(ROOT / 'docs/multi-case/deployment-batch.json')

    def receipt(self, step):
        actions = []
        for action in step['actions']:
            if action['type'] == 'FunctionCall':
                actions.append({'FunctionCall': {'method_name': action['methodName'], 'args': base64.b64encode(json.dumps(action['args']).encode()).decode(), 'gas': action['gas'], 'deposit': action['deposit']}})
            elif action['type'] == 'CreateAccount': actions.append('CreateAccount')
            elif action['type'] == 'Transfer': actions.append({'Transfer': {'deposit': action['deposit']}})
            elif action['type'] == 'DeployContract': actions.append({'DeployContract': {'code': base64.b64encode((ROOT / action['path']).read_bytes()).decode()}})
            elif action['type'] == 'AddKey': actions.append({'AddKey': {'public_key': action['publicKey'], 'access_key': {'nonce': 0, 'permission': 'FullAccess'}}})
        tx_hash = '2' * 32
        return {'final_execution_status': 'FINAL', 'transaction': {'hash': tx_hash, 'signer_id': step['signerId'], 'receiver_id': step['receiverId'], 'public_key': self.e.signing_key(self.batch, step), 'actions': actions}, 'status': {'SuccessValue': ''}, 'transaction_outcome': {'id': tx_hash, 'outcome': {'receipt_ids': ['3' * 32], 'tokens_burnt': '2', 'status': {'SuccessReceiptId': '3' * 32}}}, 'receipts_outcome': [{'id': '3' * 32, 'outcome': {'receipt_ids': [], 'tokens_burnt': '5', 'status': {'SuccessValue': ''}}}]}

    def test_manifest_byte_guard_rejects_even_whitespace_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'batch.json'
            path.write_bytes((ROOT / 'docs/multi-case/deployment-batch.json').read_bytes() + b' ')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                self.e.load_manifest(path)

    def test_commands_are_arrays_with_atomic_initialization_and_exact_key(self):
        before = {'nonce': 4, 'block_hash': '2' * 44}
        create = self.e.command_for(self.batch, self.batch['steps'][0], before)
        self.assertEqual(create[:4], ['near', 'account', 'create-account', 'fund-myself'])
        self.assertIn('5000000000000000000000000 yoctoNEAR', create)
        self.assertEqual(create[-8:], ['sign-with-keychain', '--signer-public-key', self.e.OWNER_KEY, '--block-hash', '2' * 44, '--nonce', '5', 'send'])
        deploy = self.e.command_for(self.batch, self.batch['steps'][1], before)
        self.assertIn('with-init-call', deploy)
        self.assertEqual(deploy[deploy.index('with-init-call') + 1], 'new')
        self.assertNotIn('sign-later', deploy)

    def test_cli_rejects_alternate_journal_before_any_signing(self):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/multi-case/execute-approved.py'), '--step', 'token-BLACKDRAGON-create', '--execution', '/private/tmp/another-execution.json', '--rpc', 'http://invalid'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('unrecognized arguments: --execution', result.stderr)

    def test_signing_requires_a_valid_checked_block_and_nonce(self):
        for before in ({}, {'nonce': -1, 'block_hash': '2' * 44}, {'nonce': 2**64-1, 'block_hash': '2' * 44}, {'nonce': 4, 'block_hash': 'wrong'}):
            with self.assertRaises(ValueError):
                self.e.command_for(self.batch, self.batch['steps'][0], before)

    def test_receipt_requires_exact_actions_key_and_finality(self):
        step = self.batch['steps'][0]
        receipt = self.receipt(step)
        self.assertEqual(self.e.verify_receipt(self.batch, step, receipt, '2' * 32), 7)
        for mutation in ('key', 'deposit', 'failure', 'graph', 'finality'):
            changed = copy.deepcopy(receipt)
            if mutation == 'key': changed['transaction']['public_key'] = 'wrong'
            if mutation == 'deposit': changed['transaction']['actions'][1]['Transfer']['deposit'] = '1'
            if mutation == 'failure': changed['receipts_outcome'][0]['outcome']['status'] = {'Failure': {}}
            if mutation == 'graph': changed['receipts_outcome'] = []
            if mutation == 'finality': changed['final_execution_status'] = 'EXECUTED'
            with self.assertRaises(ValueError, msg=mutation): self.e.verify_receipt(self.batch, step, changed, '2' * 32)

    def test_funding_receipt_requires_full_resolver_acceptance(self):
        step = next(s for s in self.batch['steps'] if s['actions'][0].get('methodName') == 'ft_transfer_call')
        receipt = self.receipt(step)
        with self.assertRaisesRegex(ValueError, 'acceptance'): self.e.verify_receipt(self.batch, step, receipt, '2' * 32)
        receipt['status']['SuccessValue'] = base64.b64encode(json.dumps(step['actions'][0]['args']['amount']).encode()).decode()
        self.assertEqual(self.e.verify_receipt(self.batch, step, receipt, '2' * 32), 7)

    def test_remaining_budget_subtracts_verified_step_ceilings(self):
        original = self.e.remaining_budget(self.batch, {})
        done = {self.batch['steps'][0]['id']: {'status': 'verified'}}
        self.assertLess(self.e.remaining_budget(self.batch, done), original)
        self.assertEqual(self.e.remaining_budget(self.batch, {s['id']: {'status': 'verified'} for s in self.batch['steps']}), 0)

    def test_ambiguous_or_prepared_transactions_cannot_be_resubmitted(self):
        for status in ('prepared', 'submitted', 'uncertain', 'failed'):
            with self.assertRaisesRegex(ValueError, '[Rr]econcile'):
                self.e.may_submit({'status': status, 'tx_hash': None}, {'nonce': 1}, {'nonce': 1})
        self.e.may_submit(None, {}, {})
        self.e.may_submit({'status': 'blocked_signer', 'tx_hash': None, 'before': {'nonce': 2}}, {'nonce': 2}, {'nonce': 2})
        with self.assertRaisesRegex(ValueError, 'nonce'):
            self.e.may_submit({'status': 'blocked_signer', 'tx_hash': None, 'before': {'nonce': 2}}, {'nonce': 2}, {'nonce': 3})

    def test_hash_parser_never_accepts_an_unlabelled_base58_string(self):
        self.assertEqual(self.e.parse_hash('Transaction ID: ' + '4' * 32), '4' * 32)
        self.assertIsNone(self.e.parse_hash('Unrelated account key: ' + '4' * 32))
        self.assertIsNone(self.e.parse_hash('Transaction ID: ' + '4' * 32 + '\nTransaction ID: ' + '5' * 32))

    def test_protocol_estimate_includes_create_charge_and_callback_allowance(self):
        fee_config = {'execution': 1, 'send_sir': 2, 'send_not_sir': 3}
        action = {key: fee_config for key in ('create_account_cost', 'transfer_cost', 'deploy_contract_cost', 'deploy_contract_cost_per_byte', 'function_call_cost', 'function_call_cost_per_byte')}
        action['add_key_cost'] = {'full_access_cost': fee_config}
        protocol = {'chain_id': 'testnet', 'runtime_config': {'account_creation_charge': str(7 * 10**21), 'transaction_costs': {'action_creation_config': action, 'action_receipt_creation_config': fee_config, 'data_receipt_creation_config': {'base_cost': fee_config, 'cost_per_byte': fee_config}}}}
        fee = self.e.action_fee(self.batch['steps'][0], protocol, 10**9)
        self.assertGreaterEqual(fee, 7 * 10**21)
        self.assertLessEqual(fee, int(self.batch['maximumActionFeesPerTransactionYocto']))
        with self.assertRaisesRegex(ValueError, 'gas price'):
            self.e.action_fee(self.batch['steps'][0], protocol, 10**9 + 1)

    def test_import_never_invokes_cli_or_mutates_a_journal(self):
        with patch('subprocess.run') as cli, patch('os.replace') as replace:
            executor()
            cli.assert_not_called()
            replace.assert_not_called()

    def test_local_missing_signer_must_prove_unchanged_nonce_and_target(self):
        before = {'nonce': 3, 'target': {'absent': True}}
        self.assertTrue(self.e.local_signer_failure(1, 'No access key found in keychain', before, before))
        self.assertFalse(self.e.local_signer_failure(0, 'No access key found in keychain', before, before))
        self.assertFalse(self.e.local_signer_failure(1, 'No access key found in keychain', before, {'nonce': 4, 'target': {'absent': True}}))
        self.assertFalse(self.e.local_signer_failure(1, 'No access key found in keychain', before, {'nonce': 3, 'target': {}}))
        self.assertFalse(self.e.local_signer_failure(1, 'RPC timed out', before, before))

    def test_keychain_precheck_queries_only_this_service_attributes(self):
        from types import SimpleNamespace
        calls = []
        def runner(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(returncode=44)
        self.assertFalse(self.e.keychain_available('needmore_1_near.testnet', runner))
        self.assertEqual(calls, [['security', 'find-generic-password', '-s', 'near-testnet-needmore_1_near.testnet']])
        self.assertNotIn('-w', calls[0])
        self.assertNotIn('-g', calls[0])

    def test_journal_progress_counts_only_verified_steps_and_retains_known_fees(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'execution.json'
            journal = {'steps': {'waiting': {'status': 'uncertain', 'actual_fee_yocto': '3'}}}
            self.e.persist(path, journal, 'done', {'status': 'verified', 'tx_hash': '2' * 32, 'actual_fee_yocto': '7'})
            saved = json.loads(path.read_text())
            self.assertEqual(saved['verified_steps'], 1)
            self.assertEqual(saved['remaining_steps'], 89)
            self.assertEqual(saved['actual_fees_yocto'], '10')
            self.assertEqual(saved['status'], 'needs_reconciliation')

    def test_atomic_deployment_receipt_requires_exact_wasm_bytes(self):
        step = self.batch['steps'][1]
        receipt = self.receipt(step)
        self.assertEqual(self.e.verify_receipt(self.batch, step, receipt, '2' * 32), 7)
        receipt['transaction']['actions'][0]['DeployContract']['code'] = base64.b64encode(b'wrong').decode()
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.e.verify_receipt(self.batch, step, receipt, '2' * 32)

    def test_legacy_trie_and_history_must_survive_migration(self):
        pool = {key: '0' for key in ('pool_funds', 'reserved_rewards', 'pending_fees', 'treasury_available', 'treasury_in_flight', 'in_flight_payouts', 'pending_openings', 'completed_payouts', 'total_paid', 'expected_balance_min', 'expected_balance_max')}
        pool.update(paused=True, revision='14')
        old = {'pool': pool, 'history': [{'opening_id': str(i), 'draw': i, 'reward': '1000000'} for i in range(4)], 'state': [{'key': base64.b64encode(b'credit').decode(), 'value': 'kept'}]}
        current = copy.deepcopy(old)
        current['pool']['revision'] = '15'
        self.e.check_dragon(old, current, 15)
        current['state'][0]['value'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'trie'):
            self.e.check_dragon(old, current, 15)
        current = copy.deepcopy(old)
        current['pool']['revision'] = '15'
        current['history'][0]['draw'] = 10
        with self.assertRaisesRegex(ValueError, 'legacy'):
            self.e.check_dragon(old, current, 15)
        self.assertEqual(self.e.code_hash(self.e.V1_SHA), self.e.V1_CODE)


if __name__ == '__main__': unittest.main()
