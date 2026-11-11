"""Verify only the already approved, submitted public SHITZU registration."""
import base64
import json
from pathlib import Path
from preflight import Rpc, ROOT

rpc = Rpc('https://rpc.testnet.fastnear.com')
if rpc.call('status', [])['chain_id'] != 'testnet':
    raise RuntimeError('Testnet required')
tx_hash = '9oNjXJASSDQgdu3vh4eZuZYMgkiW1fLpcnkaftEksvPq'
tx = rpc.call('tx', {'tx_hash': tx_hash, 'sender_account_id': 'cases-needmore-1-near.testnet', 'wait_until': 'FINAL'})
t = tx['transaction']
expected = {'account_id': 'cases-needmore-1-near.testnet', 'registration_only': True}
assert t['signer_id'] == 'cases-needmore-1-near.testnet'
assert t['receiver_id'] == 'iroh-test-shitzu.testnet'
assert t['public_key'] == 'ed25519:7mkuqApHc4Da4mzL4Xn3jBatX2o49nkJfxYAAoP9puMc'
assert len(t['actions']) == 1
call = t['actions'][0]['FunctionCall']
assert call['method_name'] == 'storage_deposit'
assert json.loads(base64.b64decode(call['args'])) == expected
assert int(call['gas']) == 30_000_000_000_000
assert call['deposit'] == '1250000000000000000000'
assert tx['final_execution_status'] == 'FINAL'
assert 'SuccessValue' in tx['status']
assert not any('Failure' in r['outcome']['status'] for r in tx['receipts_outcome'])
block = rpc.call('block', {'finality': 'final'})['header']
storage = rpc.view(t['receiver_id'], block['hash'], 'storage_balance_of', {'account_id': t['signer_id']})
assert storage == {'available': '0', 'total': '1250000000000000000000'}
result = dict(network='testnet', transactionHash=tx_hash, transaction=t,
              finalExecutionStatus=tx['final_execution_status'], receipts=tx['receipts_outcome'],
              blockHeight=block['height'], blockHash=block['hash'], storageBalance=storage)
(ROOT / 'docs/multi-case/shitzu-registration.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(dict(transactionHash=tx_hash, finalized=True, storage=storage, blockHeight=block['height']), indent=2))
