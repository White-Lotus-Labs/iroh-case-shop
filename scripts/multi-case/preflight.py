"""Capture only public, finalized NEAR Testnet state. Never signs transactions."""

import argparse
import base64
import datetime
import hashlib
import json
import time
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class Rpc:
    def __init__(self, endpoint):
        self.endpoint = endpoint

    def call(self, method, params):
        payload = json.dumps(dict(jsonrpc="2.0", id="iroh-public-preflight", method=method, params=params)).encode()
        for attempt in range(4):
            try:
                response = subprocess.check_output([
                    'curl', '-fsS', '--max-time', '30', '--header', 'Content-Type: application/json',
                    '--data-binary', '@-', self.endpoint,
                ], input=payload)
                value = json.loads(response)
                if "error" in value:
                    cause = value["error"].get("cause", {}).get("name")
                    if cause == "UNKNOWN_ACCOUNT":
                        return {"absent": True}
                    raise RuntimeError(json.dumps(value["error"]))
                return value["result"]
            except (subprocess.CalledProcessError, RuntimeError):
                if attempt == 3:
                    raise
                time.sleep(1 + attempt)

    def query(self, account, block, kind="view_account", **kwargs):
        return self.call("query", dict(request_type=kind, account_id=account, block_id=block, **kwargs))

    def view(self, account, block, method, args):
        result = self.query(account, block, "call_function", method_name=method,
                            args_base64=base64.b64encode(json.dumps(args).encode()).decode())
        if result.get("absent"):
            return result
        return json.loads(bytes(result["result"]))


def snapshot(rpc, catalog, registry=None):
    if rpc.call("status", [])['chain_id'] != "testnet":
        raise RuntimeError("Refusing non-Testnet endpoint")
    block = rpc.call("block", {"finality": "final"})['header']
    pin = block['hash']
    protocol = rpc.call('EXPERIMENTAL_protocol_config', {'block_id': pin})
    owner = catalog['ownerId']
    token = catalog['tokenContractId']
    if registry is None:
        registry = json.loads((ROOT / 'config/tokens.testnet.json').read_text())
    result = dict(network="testnet", rpc=rpc.endpoint,
                  checked_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  block_height=block['height'], block_hash=pin,
                  gas_price=rpc.call("gas_price", [pin])['gas_price'],
                  storage_amount_per_byte=protocol['runtime_config']['storage_amount_per_byte'],
                  owner=rpc.query(owner, pin),
                  owner_public_keys=rpc.query(owner, pin, 'view_access_key_list'),
                  usdi_account=rpc.query(token, pin),
                  owner_usdi=rpc.view(token, pin, "ft_balance_of", {"account_id": owner}),
                  usdi_metadata=rpc.view(token, pin, "ft_metadata", {}),
                  usdi_supply=rpc.view(token, pin, "ft_total_supply", {}),
                  usdi_storage_bounds=rpc.view(token, pin, "storage_balance_bounds", {}),
                  usdi_case_storage={case["id"]: rpc.view(token, pin, "storage_balance_of", {"account_id": case["contractId"]}) for case in catalog["cases"]},
                  cases={}, tokens={})
    for case in catalog['cases']:
        account = case['contractId']
        entry = dict(account=rpc.query(account, pin))
        if not entry['account'].get('absent') and entry['account']['code_hash'] != '1' * 32:
            entry.update(case=rpc.view(account, pin, 'get_case', {}),
                         pool=rpc.view(account, pin, 'get_pool', {}),
                         history=rpc.view(account, pin, 'get_history', {'account_id': owner, 'limit': 20}),
                         usdi_balance=rpc.view(token, pin, 'ft_balance_of', {'account_id': account}),
                         public_keys=rpc.query(account, pin, 'view_access_key_list'))
            code = rpc.query(account, pin, 'view_code')
            entry['wasm_sha256'] = hashlib.sha256(base64.b64decode(code['code_base64'])).hexdigest()
            if entry['wasm_sha256'] == '48e560f15ef75db48d82ab1d57ca119b752059d96c1157c897ce3dbf87b7c06e':
                entry['reward_inventory'] = rpc.view(account, pin, 'get_reward_inventory', {})
                entry['quote'] = rpc.view(account, pin, 'get_quote', {'account_id': owner})
            pool = entry['pool']
            balance = int(entry['usdi_balance'])
            if not int(pool['expected_balance_min']) <= balance <= int(pool['expected_balance_max']):
                raise RuntimeError(f"{account}: USDI book mismatch")
        result['cases'][case['id']] = entry
    for definition in registry['tokens']:
        if definition['selection'] != 'included':
            continue
        account = definition['contractId']
        entry = dict(account_id=account, account=rpc.query(account, pin))
        if not entry['account'].get('absent') and entry['account']['code_hash'] != '1' * 32:
            entry.update(public_keys=rpc.query(account, pin, 'view_access_key_list'),
                         metadata=rpc.view(account, pin, 'ft_metadata', {}),
                         supply=rpc.view(account, pin, 'ft_total_supply', {}),
                         owner_balance=rpc.view(account, pin, 'ft_balance_of', {'account_id': owner}),
                         storage_bounds=rpc.view(account, pin, 'storage_balance_bounds', {}),
                         case_storage={case['id']: rpc.view(account, pin, 'storage_balance_of', {'account_id': case['contractId']}) for case in catalog['cases']},
                         case_balances={case['id']: rpc.view(account, pin, 'ft_balance_of', {'account_id': case['contractId']}) for case in catalog['cases']})
            code = rpc.query(account, pin, 'view_code')
            entry['wasm_sha256'] = hashlib.sha256(base64.b64decode(code['code_base64'])).hexdigest()
            entry['dragon_storage'] = entry['case_storage']['dragon-tea']
            entry['dragon_balance'] = entry['case_balances']['dragon-tea']
        result['tokens'][definition['asset']] = entry
    result['proposed_tokens'] = {definition['asset']: dict(account_id=definition['contractId'], account=result['tokens'][definition['asset']]['account'])
        for definition in registry['tokens'] if definition['selection'] == 'included' and definition['status'] == 'proposed'}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rpc', default='https://rpc.testnet.fastnear.com')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/multi-case/live-preflight.json')
    args = parser.parse_args()
    catalog = json.loads((ROOT / 'config/cases.testnet.json').read_text())
    result = snapshot(Rpc(args.rpc), catalog)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(block_height=result['block_height'], owner_near=result['owner']['amount'],
                         owner_usdi=result['owner_usdi'], cases={k: v['account'].get('absent', False) for k,v in result['cases'].items()},
                         dragon=result['cases']['dragon-tea']['pool'],
                         shitzu_registered=result['tokens']['SHITZU']['dragon_storage'] is not None), indent=2))


if __name__ == '__main__':
    main()
