"""Local Meteor handoff for the exact approved owner transactions. No wallet secrets."""
import importlib.util
from pathlib import Path
import sys
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

e = module('iroh_executor', HERE / 'execute-approved.py')

def wallet_transaction(batch, step):
    e.require(batch['network'] == 'testnet' and step in batch['steps'], 'Unapproved Testnet step')
    e.require(step['signerId'] == batch['ownerId'] and all(a['type'] != 'DeployContract' for a in step['actions']), 'Only approved owner actions use the browser')
    return {'network': 'testnet', 'signerId': step['signerId'], 'receiverId': step['receiverId'], 'actions': step['actions']}

def check_browser_freshness(before, result, height):
    e.require(result['transaction']['nonce'] == before['nonce'] + 1 and height > before['block_height'], 'Browser nonce or inclusion block changed')

def authorized(host, origin, supplied, expected):
    return host == '127.0.0.1:4318' and origin == 'http://127.0.0.1:4318' and isinstance(supplied, str) and __import__('hmac').compare_digest(supplied, expected)

def require_requestable(saved):
    e.require(saved is None or saved['status'] == 'blocked_signer' and not saved.get('tx_hash'), 'Existing wallet request must be reconciled; no repeat submission')

import base64
import datetime
import fcntl
import json
import re
import secrets
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

JOURNAL = e.ROOT / 'docs/multi-case/execution.json'

def scoped_steps(batch, dragon_only):
    if not dragon_only: return batch['steps']
    return [s for s in batch['steps'] if s['receiverId'] == e.DRAGON or any(a.get('args', {}).get('account_id') == e.DRAGON or a.get('args', {}).get('receiver_id') == e.DRAGON for a in s['actions'])]

class Coordinator:
    def __init__(self, rpc, dragon_only=False):
        self.rpc = rpc
        self.batch = e.load_manifest(e.ROOT / 'docs/multi-case/deployment-batch.json')
        approval = json.loads((e.ROOT / 'docs/multi-case/approval.json').read_text())
        e.require(approval['batchSha256'] == e.APPROVED_SHA and approval['authorization'] == 'Approve exact batch once funded', 'Exact approval missing')
        self.scope = scoped_steps(self.batch, dragon_only)
        self.lock = None
        self.pending = None

    def journal(self):
        value = json.loads(JOURNAL.read_text())
        e.require(value['manifest_sha256'] == e.APPROVED_SHA, 'Wrong execution history')
        return value

    def state(self):
        journal = self.journal()
        step = next((s for s in self.scope if journal['steps'].get(s['id'], {}).get('status') != 'verified'), None)
        entry = journal['steps'].get(step['id']) if step else None
        return {'approved_sha256': e.APPROVED_SHA, 'verified': journal['verified_steps'], 'step': step, 'entry': entry, 'owner_public_key': e.OWNER_KEY, 'scope': 'existing_dragon_only' if len(self.scope) < len(self.batch['steps']) else 'full_batch', 'scope_complete': step is None, 'complete': journal['verified_steps'] == len(self.batch['steps'])}

    def advance(self):
        e.require(self.pending is None, 'Reconcile current wallet request first')
        while True:
            state = self.state(); step = state['step']
            if step is None or step['signerId'] == self.batch['ownerId']: return state
            # This uses the reviewed canonical lock/journal executor, never a second history.
            result = subprocess.run([sys.executable, str(HERE / 'execute-approved.py'), '--step', step['id']], capture_output=True, text=True)
            if result.returncode:
                raise ValueError('Dedicated step stopped: ' + step['id'] + '. Inspect canonical journal; no retry was attempted.')

    def request(self):
        e.require(self.pending is None, 'Wallet request already open')
        self.lock = JOURNAL.with_suffix('.lock').open('a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            journal = self.journal(); state = self.state(); step = state['step']
            e.require(step is not None, 'All steps complete')
            transaction = wallet_transaction(self.batch, step)
            saved = journal['steps'].get(step['id']); require_requestable(saved)
            before = e.preconditions(self.batch, step, self.rpc, journal['steps'])
            e.may_submit(saved, (saved or {}).get('before', {}), before)
            entry = {'status': 'prepared', 'tx_hash': None, 'signer_id': step['signerId'], 'receiver_id': step['receiverId'], 'before': before, 'transport': 'meteor_browser'}
            e.persist(JOURNAL, journal, step['id'], entry)
            self.pending = step['id']
            return {'step_id': step['id'], 'transaction': transaction, 'public_key': e.OWNER_KEY, 'before': before}
        except Exception:
            self.release(); raise

    def release(self):
        if self.lock:
            self.lock.close(); self.lock = None
        self.pending = None

    def result(self, tx_hash):
        e.require(isinstance(tx_hash, str) and re.fullmatch(r'[1-9A-HJ-NP-Za-km-z]{32,44}', tx_hash), 'Public transaction hash required')
        acquired = not self.lock
        if acquired:
            handle = JOURNAL.with_suffix('.lock').open('a')
            try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except Exception:
                handle.close(); raise
            self.lock = handle
        try:
            journal = self.journal()
            step = next((s for s in self.scope if journal['steps'].get(s['id'], {}).get('status') != 'verified'), None)
            e.require(step is not None and step['signerId'] == self.batch['ownerId'], 'No pending owner request')
            entry = journal['steps'].get(step['id'])
            e.require(entry and entry.get('transport') == 'meteor_browser' and entry['status'] in ('prepared', 'submitted', 'uncertain'), 'No browser preparation to reconcile')
            e.require(not entry.get('tx_hash') or entry['tx_hash'] == tx_hash, 'Saved transaction hash cannot be replaced')
        except Exception:
            if acquired: self.release()
            raise
        entry.update(status='submitted', tx_hash=tx_hash); e.persist(JOURNAL, journal, step['id'], entry)
        try:
            result = self.rpc.call('tx', {'tx_hash': tx_hash, 'sender_account_id': step['signerId'], 'wait_until': 'FINAL'})
            if result.get('final_execution_status') == 'FINAL' and result.get('transaction', {}).get('hash') == tx_hash:
                receipt = JOURNAL.with_name('receipt-' + step['id'] + '.json')
                receipt.write_text(json.dumps(result, indent=2) + '\n')
                entry['receipt_file'] = str(receipt.relative_to(e.ROOT))
                entry['actual_fee_yocto'] = str(sum(int(r['outcome']['tokens_burnt']) for r in [result['transaction_outcome'], *result['receipts_outcome']]))
            fee = e.verify_receipt(self.batch, step, result, tx_hash)
            included = self.rpc.call('block', {'block_id': result['transaction_outcome']['block_hash']})['header']['height']
            check_browser_freshness(entry['before'], result, included)
            e.require(fee <= e.step_ceiling(self.batch, step) - sum(int(a.get('deposit', 0)) for a in step['actions']), 'Actual fee exceeds approval')
            after = e.postconditions(self.batch, step, self.rpc, entry['before'])
            entry.update(status='verified', actual_fee_yocto=str(fee), after=after, verified_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            e.persist(JOURNAL, journal, step['id'], entry)
            print(json.dumps({'verified': step['id'], 'tx_hash': tx_hash, 'fee_yocto': str(fee)}), flush=True)
            self.release()
            return self.state()
        except Exception:
            entry.update(status='uncertain', reason='Browser result needs reconciliation; no repeat request')
            e.persist(JOURNAL, journal, step['id'], entry)
            raise


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dragon-only', action='store_true', help='Only the independent approved existing Dragon chain')
    args = parser.parse_args()
    preflight = module('iroh_rpc', HERE / 'preflight.py')
    coordinator = Coordinator(preflight.Rpc('https://rpc.testnet.fastnear.com'), args.dragon_only)
    # Compile installed dependencies locally. No install, wallet credentials or environment file reads.
    build = "import {createRequire} from 'node:module'; const req=createRequire(import.meta.resolve('vitest')); const {build}=req('esbuild'); const b=await build({entryPoints:['scripts/multi-case/browser-client.mjs'],bundle:true,platform:'browser',format:'esm',write:false,define:{'process.env.NODE_ENV':'\"production\"'}});process.stdout.write(b.outputFiles[0].text);"
    bundle = subprocess.check_output(['node', '--input-type=module', '-e', build], cwd=e.ROOT)
    token = secrets.token_urlsafe(32)
    html = b'''<!doctype html><meta charset="utf-8"><title>Iroh approved Testnet deployment</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;background:#faf4e7;color:#312814}button,input{font:inherit;padding:12px;margin:8px 8px 8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}button:disabled{opacity:.5}</style><h1>Approved NEAR Testnet deployment</h1><p>Exact approved batch. Unofficial Testnet tokens have no monetary value. Approve each request in Meteor yourself.</p><button id="connect">Connect existing Meteor account</button><button id="advance" disabled>Prepare next approved step</button><button id="request" disabled>Open this request in Meteor</button><p><input id="hash" size="48" placeholder="Public transaction hash for reconciliation"><button id="verify">Verify existing hash</button></p><pre id="status">Loading approved state...</pre><script type="module" src="/client.js"></script>'''
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def reply(self, status, data, content_type='application/json'):
            data = data if isinstance(data, bytes) else json.dumps(data).encode()
            self.send_response(status); self.send_header('Content-Type', content_type); self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store'); self.send_header('X-Frame-Options', 'DENY'); self.send_header('Referrer-Policy', 'no-referrer'); self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            if self.headers.get('Host') != '127.0.0.1:4318': return self.reply(403, {'error': 'Host rejected'})
            if self.path == '/': return self.reply(200, html, 'text/html; charset=utf-8')
            if self.path == '/client.js': return self.reply(200, bundle, 'text/javascript')
            return self.reply(404, {'error': 'No such route'})
        def do_POST(self):
            if not authorized(self.headers.get('Host'), self.headers.get('Origin'), self.headers.get('X-Iroh-Session'), token): return self.reply(403, {'error': 'Same-origin session required'})
            try:
                length = int(self.headers.get('Content-Length', '0')); e.require(0 <= length <= 1024, 'Request too large')
                data = json.loads(self.rfile.read(length) or b'{}')
                if self.path == '/state': value = coordinator.state()
                elif self.path == '/advance': value = coordinator.advance()
                elif self.path == '/request': value = coordinator.request()
                elif self.path == '/result': value = coordinator.result(data.get('hash'))
                else: raise ValueError('Unknown route')
                self.reply(200, value)
            except Exception as error: self.reply(409, {'error': str(error)})
    print('http://127.0.0.1:4318/#' + token, flush=True)
    HTTPServer(('127.0.0.1', 4318), Handler).serve_forever()

if __name__ == '__main__': main()
