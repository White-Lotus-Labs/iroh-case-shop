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

    def signed_creation(self):
        step = self.batch['steps'][0]
        def text(value):
            raw = value.encode()
            return len(raw).to_bytes(4, 'little') + raw
        owner = self.e.decode58(self.e.OWNER_KEY.split(':')[1])
        new_key = self.e.decode58(step['actions'][2]['publicKey'].split(':')[1])
        raw = (text(step['signerId']) + b'\0' + owner + (8).to_bytes(8, 'little')
            + text(step['receiverId']) + bytes([2]) * 32 + (3).to_bytes(4, 'little')
            + b'\0' + b'\3' + int(step['actions'][1]['deposit']).to_bytes(16, 'little')
            + b'\5\0' + new_key + bytes(8) + b'\1')
        return step, raw + b'\0' + bytes(64)

    def test_signed_wire_decoder_binds_actions_nonce_block_and_key(self):
        step, raw = self.signed_creation()
        before = {'nonce': 7, 'block_hash': self.e.encode58(bytes([2]) * 32)}
        with patch.object(self.e, 'verify_public_signature', return_value=True):
            result = self.e.verify_signed_transaction(self.batch, step, before, base64.b64encode(raw).decode())
        self.assertEqual(result['nonce'], 8)
        self.assertEqual(result['hash'], self.e.encode58(__import__('hashlib').sha256(raw[:-65]).digest()))
        for changed in [dict(before, nonce=8), dict(before, block_hash='1' * 32)]:
            with patch.object(self.e, 'verify_public_signature', return_value=True), self.assertRaises(ValueError):
                self.e.verify_signed_transaction(self.batch, step, changed, base64.b64encode(raw).decode())
        with patch.object(self.e, 'verify_public_signature', return_value=False), self.assertRaisesRegex(ValueError, 'signature'):
            self.e.verify_signed_transaction(self.batch, step, before, base64.b64encode(raw).decode())
        for malformed in (raw[:-1], raw + b'\0', b'\1' + raw):
            with patch.object(self.e, 'verify_public_signature', return_value=True), self.assertRaises(ValueError):
                self.e.verify_signed_transaction(self.batch, step, before, base64.b64encode(malformed).decode())

    def wire_for_step(self, step, changes=None):
        def text(value):
            raw = value.encode()
            return len(raw).to_bytes(4, 'little') + raw
        raw = text(step['signerId']) + b'\0' + self.e.decode58(self.e.signing_key(self.batch, step).split(':')[1]) + (8).to_bytes(8, 'little') + text(step['receiverId']) + bytes([2]) * 32 + len(step['actions']).to_bytes(4, 'little')
        for action in step['actions']:
            kind = action['type']
            if kind == 'DeployContract':
                code = (ROOT / action['path']).read_bytes()
                if changes == 'wasm': code = code[:-1] + bytes([code[-1] ^ 1])
                raw += b'\1' + len(code).to_bytes(4, 'little') + code
            elif kind == 'FunctionCall':
                method = action['methodName'] + ('x' if changes == 'method' else '')
                args = copy.deepcopy(action['args'])
                if changes == 'args': args['receiver_id'] = 'wrong.testnet'
                if isinstance(changes, dict): args.update(changes)
                args = json.dumps(args, sort_keys=True, separators=(',', ':'))
                if changes == 'duplicates': args = '{"receiver_id":"wrong.testnet",' + args[1:]
                raw += b'\2' + text(method) + text(args) + (int(action['gas']) + (1 if changes == 'gas' else 0)).to_bytes(8, 'little') + (int(action['deposit']) + (1 if changes == 'deposit' else 0)).to_bytes(16, 'little')
            else: raise AssertionError('Test fixture supports deploy and function calls only')
        return base64.b64encode(raw + b'\0' + bytes(64)).decode()

    def test_wire_function_call_rejects_changed_economics_and_duplicate_json_keys(self):
        step = next(s for s in self.batch['steps'] if s['id'].startswith('dragon-fund'))
        before = {'nonce': 7, 'block_hash': self.e.encode58(bytes([2]) * 32)}
        with patch.object(self.e, 'verify_public_signature', return_value=True):
            self.e.verify_signed_transaction(self.batch, step, before, self.wire_for_step(step))
            for change in ('method', 'args', 'gas', 'deposit', 'duplicates'):
                with self.assertRaises(ValueError, msg=change): self.e.verify_signed_transaction(self.batch, step, before, self.wire_for_step(step, change))

    def test_wire_json_does_not_equate_boolean_true_and_integer_one(self):
        step = next(s for s in self.batch['steps'] if s['actions'][0].get('methodName') == 'storage_deposit')
        before = {'nonce': 7, 'block_hash': self.e.encode58(bytes([2]) * 32)}
        with patch.object(self.e, 'verify_public_signature', return_value=True), self.assertRaises(ValueError):
            self.e.verify_signed_transaction(self.batch, step, before, self.wire_for_step(step, {'registration_only': 1}))

    def test_wire_case_tiers_preserve_integer_types(self):
        step = next(s for s in self.batch['steps'] if len(s['actions']) == 2 and s['actions'][1].get('methodName') == 'new_configured')
        before = {'nonce': 7, 'block_hash': self.e.encode58(bytes([2]) * 32)}
        for value in (True, 1.0):
            config = copy.deepcopy(step['actions'][1]['args']['config'])
            row = next(r for r in config['bonus_rewards'] if r['tier'] == 1)
            row['tier'] = value
            with patch.object(self.e, 'verify_public_signature', return_value=True), self.assertRaises(ValueError):
                self.e.verify_signed_transaction(self.batch, step, before, self.wire_for_step(step, {'config': config}))

    def test_wire_deploy_requires_full_exact_wasm_and_private_initializer(self):
        step = self.batch['steps'][1]
        before = {'nonce': 7, 'block_hash': self.e.encode58(bytes([2]) * 32)}
        with patch.object(self.e, 'verify_public_signature', return_value=True):
            self.e.verify_signed_transaction(self.batch, step, before, self.wire_for_step(step))
            for change in ('wasm', 'method', 'gas', 'deposit'):
                with self.assertRaises(ValueError, msg=change): self.e.verify_signed_transaction(self.batch, step, before, self.wire_for_step(step, change))
            reordered = dict(step, actions=list(reversed(step['actions'])))
            with self.assertRaises(ValueError): self.e.verify_signed_transaction(self.batch, step, before, self.wire_for_step(reordered))

    def test_actual_finalized_creation_wire_has_the_approved_owner_signature(self):
        fixture = json.loads((ROOT / 'docs/multi-case/evidence/finalized-creation-wire.json').read_text())
        step = next(s for s in self.batch['steps'] if s['id'] == fixture['step_id'])
        result = self.e.verify_signed_transaction(self.batch, step, fixture['before'], fixture['signed_transaction_base64'])
        self.assertEqual(result['hash'], 'EaRaXfVSA3wiWaRp3Q8uVGkpP8buHsCLD4EsGPg85BTD')
        changed = bytearray(base64.b64decode(fixture['signed_transaction_base64'])); changed[-1] ^= 1
        with self.assertRaisesRegex(ValueError, 'signature'):
            self.e.verify_signed_transaction(self.batch, step, fixture['before'], base64.b64encode(changed).decode())

    def test_signature_verifier_uses_published_public_rfc8032_vector(self):
        key = 'ed25519:' + self.e.encode58(bytes.fromhex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'))
        signature = bytes.fromhex('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b')
        self.assertTrue(self.e.verify_public_signature(key, b'', signature))
        self.assertFalse(self.e.verify_public_signature(key, b'x', signature))

    def test_broadcast_is_exactly_one_attempt_even_when_transport_fails(self):
        from types import SimpleNamespace
        calls = []
        def runner(command, **kwargs):
            calls.append((command, kwargs))
            return SimpleNamespace(returncode=28, stdout='', stderr='timeout')
        with self.assertRaises(ValueError): self.e.broadcast_once('https://rpc.testnet.fastnear.com', 'cHVibGlj', runner)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0][1], '--disable')
        self.assertEqual(calls[0][0][calls[0][0].index('--retry') + 1], '0')
        sent = json.loads(calls[0][1]['input'])
        self.assertEqual(sent['method'], 'send_tx')
        self.assertEqual(sent['params'], {'signed_tx_base64': 'cHVibGlj', 'wait_until': 'FINAL'})
        with self.assertRaises(ValueError): self.e.broadcast_once('https://rpc.mainnet.near.org', 'cHVibGlj', runner)
        self.assertEqual(len(calls), 1)

    def test_manifest_byte_guard_rejects_even_whitespace_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'batch.json'
            path.write_bytes((ROOT / 'docs/multi-case/deployment-batch.json').read_bytes() + b' ')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                self.e.load_manifest(path)

    def test_commands_are_arrays_with_atomic_initialization_and_exact_key(self):
        before = {'nonce': 4, 'block_hash': '2' * 44, 'block_height': 100}
        create = self.e.command_for(self.batch, self.batch['steps'][0], before)
        self.assertEqual(create[:5], ['near', '--offline', 'account', 'create-account', 'fund-myself'])
        self.assertIn('5000000000000000000000000 yoctoNEAR', create)
        self.assertEqual(create[-10:], ['sign-with-keychain', '--signer-public-key', self.e.OWNER_KEY, '--block-hash', '2' * 44, '--block-height', '100', '--nonce', '5', 'display'])
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

    def test_rpc_deploy_action_hash_matches_the_approved_binary_digest(self):
        step = next(s for s in self.batch['steps'] if s['id'] == 'dragon-upgrade')
        receipt = json.loads((ROOT / 'docs/multi-case/receipt-dragon-upgrade.json').read_text())
        self.assertEqual(base64.b64decode(receipt['transaction']['actions'][0]['DeployContract']['code']).hex(), step['actions'][0]['sha256'])
        self.assertEqual(self.e.verify_receipt(self.batch, step, receipt, receipt['transaction']['hash']), 4222705909239500000000)
        receipt['transaction']['actions'][0]['DeployContract']['code'] = base64.b64encode(bytes(32)).decode()
        with self.assertRaisesRegex(ValueError, 'checksum'): self.e.verify_receipt(self.batch, step, receipt, receipt['transaction']['hash'])

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
