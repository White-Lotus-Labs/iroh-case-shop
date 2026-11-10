"""Fetch the reviewed, public Testnet snapshot for the Sandbox migration test."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess

BLOCK_HASH = "6r6fS61CxAQxXBEquBmgGDxAQXm8DsssSMaQ7RNfHScn"
BLOCK_HEIGHT = 277099127
CONTRACTS = {
    "cases-needmore-1-near.testnet": "ca7bcdef4d3640339318c4589808213df8f8de959de09210770f91e062e2c2aa",
    "usdi-needmore-1-near.testnet": "1d7dadcfacdb79ec66c0990c74cc0089b5ee2acce0409937637d6eaefed2b343",
}


def rpc(endpoint, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": "snapshot", "method": method, "params": params})
    response = subprocess.check_output(
        ["curl", "-fsS", "--max-time", "20", "--header", "Content-Type: application/json",
         "--data", body, endpoint]
    )
    result = json.loads(response)
    if "result" not in result:
        raise RuntimeError(result.get("error", result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new directory for the public snapshot")
    parser.add_argument("--rpc", default="https://archival-rpc.testnet.near.org")
    args = parser.parse_args()
    if rpc(args.rpc, "status", [])["result"]["chain_id"] != "testnet":
        raise RuntimeError("Use a Testnet RPC endpoint")
    files = {}
    for account, expected_sha256 in CONTRACTS.items():
        common = {"account_id": account, "block_id": BLOCK_HASH}
        code = rpc(args.rpc, "query", dict(common, request_type="view_code"))["result"]
        state = rpc(
            args.rpc, "query", dict(common, request_type="view_state", prefix_base64="", include_proof=True)
        )
        for record in (code, state["result"]):
            if record["block_hash"] != BLOCK_HASH or record["block_height"] != BLOCK_HEIGHT:
                raise RuntimeError(f"Unexpected block for {account}")
        wasm = base64.b64decode(code["code_base64"], validate=True)
        if hashlib.sha256(wasm).hexdigest() != expected_sha256:
            raise RuntimeError(f"Unexpected WASM for {account}")
        files[f"{account}.wasm"] = wasm
        files[f"{account}-state.json"] = json.dumps(state).encode()
    args.output.mkdir()
    for name, content in files.items():
        (args.output / name).write_bytes(content)
    print(f"Saved the public Testnet snapshot at block {BLOCK_HEIGHT} to {args.output}")


if __name__ == "__main__":
    main()
