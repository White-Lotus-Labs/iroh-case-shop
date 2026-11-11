#!/usr/bin/env python3
"""Validate token identities and optionally read live NEAR state. Never signs transactions."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LEGACY = {"SHITZU", "RHEA", "AURORA"}
DERIVATIVES = {"WNEAR", "STNEAR", "LINEAR", "RNEAR"}


def validate(registry):
    if registry["network"] != "testnet" or registry["ownerId"] != "needmore_1_near.testnet":
        raise ValueError("Unexpected deployment network or inventory owner")
    included = [t for t in registry["tokens"] if t["selection"] == "included"]
    if len({t["asset"] for t in registry["tokens"]}) != len(registry["tokens"]):
        raise ValueError("Duplicate asset identity")
    if len({t["contractId"] for t in included}) != len(included):
        raise ValueError("Duplicate mock account")
    for t in registry["tokens"]:
        if t["selection"] == "excluded":
            if t["intendedCases"] or not t["reason"]:
                raise ValueError(f"Excluded asset has case allocation: {t['asset']}")
            continue
        asset = t["asset"]
        expected_id = (f"iroh-test-{asset.lower()}.testnet" if asset in LEGACY
                       else f"{asset.lower()}.{registry['parentId']}")
        if t["contractId"] != expected_id:
            raise ValueError(f"Unexpected mock account: {asset}")
        decimals = t["decimals"]
        if not isinstance(decimals, int) or isinstance(decimals, bool) or not 0 <= decimals <= 24:
            raise ValueError(f"Invalid precision: {asset}")
        if t["totalSupplyRaw"] != str(int(registry["fixedSupplyWhole"]) * 10 ** decimals):
            raise ValueError(f"Incorrect fixed supply: {asset}")
        if decimals != (6 if asset in LEGACY else t["canonical"]["decimals"]):
            raise ValueError(f"Canonical precision differs: {asset}")
        if t["unofficial"] is not True or t["hasMonetaryValue"] is not False:
            raise ValueError(f"Mock disclaimer missing: {asset}")
        if "No monetary value" not in t["disclaimer"]:
            raise ValueError(f"No-value disclosure missing: {asset}")
        if asset in DERIVATIVES and "No yield, backing, or redemption" not in t["disclaimer"]:
            raise ValueError(f"Derivative disclosure missing: {asset}")
        if not t["canonical"]["sources"] or not t["canonical"]["blockHeight"]:
            raise ValueError(f"Canonical identity lacks evidence: {asset}")
    return included


def rpc(url, account, method, args):
    import base64
    params = {"request_type": "call_function", "finality": "final", "account_id": account,
              "method_name": method, "args_base64": base64.b64encode(json.dumps(args).encode()).decode()}
    payload = {"jsonrpc": "2.0", "id": account + ":" + method, "method": "query", "params": params}
    # curl uses the system trust store on macOS. No private keys or signing libraries are involved.
    result = subprocess.run(["curl", "--silent", "--show-error", "--fail", "--max-time", "25",
                             url, "-H", "Content-Type: application/json", "--data", json.dumps(payload)],
                            check=True, capture_output=True, text=True)
    response = json.loads(result.stdout)
    if "error" in response:
        raise ValueError(json.dumps(response["error"]))
    return json.loads(bytes(response["result"]["result"])), response["result"]["block_height"]


def inspect(token, registry, canonical, owner):
    account = token["canonical"]["contractId"] if canonical else token["contractId"]
    url = registry["canonicalRpcUrl"] if canonical else registry["rpcUrl"]
    try:
        metadata, block = rpc(url, account, "ft_metadata", {})
        expected = token["canonical"] if canonical else token
        for field in ["name", "symbol", "decimals"]:
            if metadata[field] != expected[field]:
                raise ValueError(f"Metadata {field} differs: {metadata[field]!r}")
        report = {"asset": token["asset"], "accountId": account, "blockHeight": block,
                  "symbol": metadata["symbol"], "decimals": metadata["decimals"], "ok": True}
        if not canonical:
            supply, _ = rpc(url, account, "ft_total_supply", {})
            balance, _ = rpc(url, account, "ft_balance_of", {"account_id": owner})
            if supply != token["totalSupplyRaw"]:
                raise ValueError(f"Unexpected total supply: {supply}")
            report.update(totalSupplyRaw=supply, inventoryBalanceRaw=balance)
        return report
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        return {"asset": token["asset"], "accountId": account, "ok": False, "error": str(error)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=ROOT / "config/tokens.testnet.json")
    parser.add_argument("--validate-only", action="store_true", help="No network requests")
    parser.add_argument("--canonical", action="store_true", help="Read canonical Mainnet metadata instead of mocks")
    parser.add_argument("--assets", nargs="*", help="Restrict live reads to selected enum asset names")
    parser.add_argument("--owner", default="needmore_1_near.testnet", help="Inventory account for balance reads")
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text())
    included = validate(registry)
    summary = {"network": "testnet", "included": len(included),
               "excluded": len(registry["tokens"]) - len(included), "readOnly": True}
    if not args.validate_only:
        selected = [t for t in included if args.assets is None or t["asset"] in args.assets]
        if args.assets and set(args.assets) - {t["asset"] for t in included}:
            raise ValueError("Requested an excluded or unknown asset")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            summary["results"] = list(pool.map(lambda t: inspect(t, registry, args.canonical, args.owner), selected))
        print(json.dumps(summary, indent=2))
        return 0 if all(t["ok"] for t in summary["results"]) else 1
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
