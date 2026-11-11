#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
snapshot="${1:?Usage: bash scripts/multi-case/verify-contracts.sh /path/to/verified-v1-snapshot}"
evidence="docs/multi-case/evidence"
mkdir -p "$evidence"
shasum -a 256 contracts/target/wasm32-unknown-unknown/release/iroh_case_pool.wasm contracts/target/wasm32-unknown-unknown/release/iroh_mock_token.wasm contracts/target/wasm32-unknown-unknown/release/iroh_usdi.wasm > "$evidence/contract-artifacts-before.txt"
node --input-type=module - <<'JS'
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const batch=JSON.parse(await readFile('docs/multi-case/deployment-batch.json','utf8'));
for(const [name,artifact] of Object.entries(batch.artifacts)) {
  const local=`contracts/target/wasm32-unknown-unknown/release/iroh_${name==='case'?'case_pool':'mock_token'}.wasm`;
  const digest=createHash('sha256').update(await readFile(local)).digest('hex');
  if(digest!==artifact.sha256) throw new Error(`${name} artifact differs from the bounded batch`);
}
JS
bash scripts/contracts.sh test > "$evidence/rust-tests.log" 2>&1
bash scripts/contracts.sh collection-integration > "$evidence/sandbox-collection.log" 2>&1
(cd contracts && "${IROH_CARGO_BIN:-cargo}" run --locked --manifest-path integration/Cargo.toml -- "$snapshot") > "$evidence/sandbox-migration.log" 2>&1
bash scripts/contracts.sh integration > "$evidence/sandbox-dragon.log" 2>&1
bash scripts/contracts.sh collection-simulate > "$evidence/simulation.log" 2>&1
shasum -a 256 contracts/target/wasm32-unknown-unknown/release/iroh_case_pool.wasm contracts/target/wasm32-unknown-unknown/release/iroh_mock_token.wasm contracts/target/wasm32-unknown-unknown/release/iroh_usdi.wasm > "$evidence/contract-artifacts-after.txt"
cmp "$evidence/contract-artifacts-before.txt" "$evidence/contract-artifacts-after.txt"
printf '%s\n' 'PASS Rust, five-case Sandbox, captured V1 migration, Dragon Sandbox and simulation against the unchanged pinned artifacts.'
