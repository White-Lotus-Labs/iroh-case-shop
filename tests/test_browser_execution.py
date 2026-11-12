import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load():
    spec = importlib.util.spec_from_file_location('browser_execution', ROOT / 'scripts/multi-case/browser-execution.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class BrowserExecutionTests(unittest.TestCase):
    def test_creation_uses_exact_approved_owner_actions_without_deployment(self):
        m = load(); batch = m.e.load_manifest(ROOT / 'docs/multi-case/deployment-batch.json')
        tx = m.wallet_transaction(batch, batch['steps'][0])
        self.assertEqual(tx, {'network': 'testnet', 'signerId': 'needmore_1_near.testnet', 'receiverId': 'blackdragon.needmore_1_near.testnet', 'actions': batch['steps'][0]['actions']})
        with self.assertRaisesRegex(ValueError, 'owner'):
            m.wallet_transaction(batch, batch['steps'][1])

    def test_modified_step_and_wrong_network_are_rejected(self):
        m = load(); batch = m.e.load_manifest(ROOT / 'docs/multi-case/deployment-batch.json')
        changed = dict(batch['steps'][0], receiverId='evil.testnet')
        with self.assertRaises(ValueError): m.wallet_transaction(batch, changed)
        with self.assertRaises(ValueError): m.wallet_transaction(dict(batch, network='mainnet'), batch['steps'][0])

    def test_wallet_receipt_must_use_next_checked_nonce_and_later_block(self):
        m = load()
        for nonce, height in [(9, 102), (11, 102), (10, 100), (10, 99)]:
            with self.assertRaises(ValueError): m.check_browser_freshness({'nonce': 9, 'block_height': 100}, {'transaction': {'nonce': nonce}}, height)
        m.check_browser_freshness({'nonce': 9, 'block_height': 100}, {'transaction': {'nonce': 10}}, 101)

    def test_only_same_origin_authorized_requests_can_mutate(self):
        m = load()
        self.assertTrue(m.authorized('127.0.0.1:4318', 'http://127.0.0.1:4318', 'secret', 'secret'))
        for host, origin, token in [('evil:4318', 'http://127.0.0.1:4318', 'secret'), ('127.0.0.1:4318', 'https://evil.test', 'secret'), ('127.0.0.1:4318', 'http://127.0.0.1:4318', 'wrong')]:
            self.assertFalse(m.authorized(host, origin, token, 'secret'))

    def test_prepared_submitted_and_uncertain_wallet_requests_never_retry(self):
        m = load()
        for status in ('prepared', 'submitted', 'uncertain', 'failed', 'verified'):
            with self.assertRaises(ValueError): m.require_requestable({'status': status})
        m.require_requestable(None)
        m.require_requestable({'status': 'blocked_signer', 'tx_hash': None})
        with self.assertRaises(ValueError): m.require_requestable({'status': 'blocked_signer', 'tx_hash': 'x'})

    def test_second_prepare_never_replaces_an_outstanding_wallet_request(self):
        import tempfile
        from unittest.mock import patch
        m = load(); coordinator = m.Coordinator(None)
        batch = coordinator.batch
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / 'execution.json'
            journal.write_text(json.dumps({'manifest_sha256': m.e.APPROVED_SHA, 'steps': {}, 'verified_steps': 0}))
            before = {'nonce': 7, 'block_height': 100, 'block_hash': '2' * 44, 'target': {'absent': True}}
            with patch.object(m, 'JOURNAL', journal), patch.object(m.e, 'preconditions', return_value=before):
                prepared = coordinator.request()
                self.assertEqual(prepared['step_id'], 'token-BLACKDRAGON-create')
                original = journal.read_bytes()
                with self.assertRaisesRegex(ValueError, 'already open'): coordinator.request()
                self.assertEqual(journal.read_bytes(), original)
                coordinator.release()
                # A new coordinator after a crash cannot repeat the durable prepared request.
                resumed = m.Coordinator(None)
                with self.assertRaisesRegex(ValueError, 'reconciled'): resumed.request()
                self.assertEqual(journal.read_bytes(), original)
                self.assertIsNone(resumed.lock)

    def test_completing_dragon_scope_does_not_claim_the_full_batch_complete(self):
        from unittest.mock import patch
        m = load(); coordinator = m.Coordinator(None, True)
        entries = {s['id']: {'status': 'verified'} for s in coordinator.scope}
        with patch.object(coordinator, 'journal', return_value={'steps': entries, 'verified_steps': 8}):
            state = coordinator.state()
        self.assertTrue(state['scope_complete'])
        self.assertFalse(state['complete'])
        self.assertEqual(state['scope'], 'existing_dragon_only')
        self.assertIsNone(state['step'])

    def test_independent_dragon_scope_contains_only_its_existing_account_chain(self):
        m = load(); batch = m.e.load_manifest(ROOT / 'docs/multi-case/deployment-batch.json')
        scoped = m.scoped_steps(batch, True)
        self.assertEqual([s['id'] for s in scoped], ['dragon-register-RHEA', 'dragon-register-AURORA', 'dragon-pause', 'dragon-upgrade', 'dragon-fund-bonus-dragon-tea-SHITZU', 'dragon-fund-bonus-dragon-tea-RHEA', 'dragon-fund-bonus-dragon-tea-AURORA', 'unpause-dragon-tea'])
        self.assertFalse(any(a['type'] in ('CreateAccount', 'AddKey') for s in scoped for a in s['actions']))
        self.assertEqual(m.scoped_steps(batch, False), batch['steps'])

    def test_invalid_reconciliation_releases_a_newly_acquired_lock(self):
        import tempfile
        from unittest.mock import patch
        m = load(); coordinator = m.Coordinator(None)
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / 'execution.json'
            journal.write_text(json.dumps({'manifest_sha256': m.e.APPROVED_SHA, 'steps': {}, 'verified_steps': 0}))
            with patch.object(m, 'JOURNAL', journal):
                with self.assertRaisesRegex(ValueError, 'preparation'): coordinator.result('2' * 32)
                self.assertIsNone(coordinator.lock)

    def test_failed_lock_acquisition_keeps_coordinator_unlocked(self):
        import tempfile
        import fcntl
        from unittest.mock import patch
        m = load()
        coordinator = m.Coordinator(None)
        with tempfile.TemporaryDirectory() as directory:
            journal = Path(directory) / 'execution.json'
            with journal.with_suffix('.lock').open('a') as held:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch.object(m, 'JOURNAL', journal):
                    for _ in range(2):
                        with self.assertRaises(BlockingIOError): coordinator.result('2' * 32)
                        self.assertIsNone(coordinator.lock)

if __name__ == '__main__': unittest.main()
