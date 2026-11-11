# Testnet wallet history indexer

The shelf reads wallet transaction references from Nearblocks independently of contract opening history. References remain in a separate list until the user requests receipt verification. The indexer does not supply case results, token balances, or fabricated transaction hashes.

## Read API

`GET /api/case-history?account=alice.testnet&cursor=...` returns `IndexerPage` from `src/case/indexer.ts`. The cursor is optional. Each request reads at most ten transactions from the fixed `https://api-testnet.nearblocks.io/v3/accounts/{account}/txns` endpoint. The proxy translates `cursor` to the documented upstream `next` parameter. No API key is required.

The proxy accepts valid named `.testnet` accounts and bounded opaque cursors. It rejects redirects, limits the upstream body to 256,000 bytes, and times out after eight seconds. It returns HTTP 400 for invalid inputs, HTTP 429 for upstream rate limits, and HTTP 502 for unavailable or malformed upstream data. It rejects a cursor that repeats the requested page. Responses disable caching. The shelf retains existing rows when another page fails.

Every index row has the source `Indexer reference, not receipt-verified`. The indexer's outcome flag is separate from a verified transaction outcome. Rows contain the indexed transaction hash, signer, receiver, action names, block height, and timestamp. Indexer fields do not establish a purchase or payout.

## Receipt verification

`verifyIndexedTransaction(row, rpc, signal)` performs read-only `tx` and `block` RPC calls. It requests `wait_until: FINAL`. If the configured RPC throws, the helper retries that read against the fixed public `https://archival-rpc.testnet.near.org` endpoint. User cancellation prevents the retry. Each archival request has an eight-second timeout and a 2,000,000-byte response limit.

Verification binds the returned transaction hash, signer, and receiver to the selected reference. It requires final execution, a matching transaction outcome, and every reachable receipt outcome. Duplicate, missing, cyclic, and unrelated receipts fail verification. A failure in any receipt marks the transaction details as failed, even when the top-level return value succeeds. Receipt statuses that return another receipt still represent successful execution of the current receipt.

The helper reads inclusion height and timestamp from a block whose hash matches the transaction outcome's block hash. These verified values replace the corresponding indexer values in details. The helper returns the actual action names and receipt IDs.

NEP-141 `ft_transfer` events come from successful receipt execution logs with `standard: nep141` and `version: 1.0.0`. Each transfer records its receipt executor as `tokenContractId`. An unrelated contract's event cannot establish a transfer of the configured USDI token. Amounts remain integer base units, and no token metadata is inferred from a ticker. The UI also checks the current account against the verified signer, receiver, or transfer owners before displaying verified details.

Verification trusts the selected public RPC service. It validates RPC identities, finality, receipt coverage, and event structure, but does not verify Merkle proofs locally.

## Public read evidence

[indexer-live.json](multi-case/evidence/indexer-live.json) contains public read results captured on 2026-11-11. It excludes contract metadata, gas profiles, signatures, and other fields that the verifier does not use.

The first account page contained ten references. Passing its `meta.next_page` as `next` returned seven more references without a next cursor. Those two pages contained seventeen distinct transaction hashes at observation time. This is the indexer's reported coverage for that account, not an independently proven census of every account interaction.

The actual transaction `2eUx4YuZNt1DwbzA2JbLUU8uFnTQUeSh5KqNrFVCa6sp` finalized in block `276969563`. Archival RPC supplied its twelve reachable receipt outcomes. The verifier extracted a `1000000` base-unit transfer from `needmore_1_near.testnet` to `cases-needmore-1-near.testnet`, plus a `1000000` base-unit payout in the opposite direction. Both transfer logs came from `usdi-needmore-1-near.testnet`. The payout memo was `Dragon Tea opening 3`.

The ordinary configured Testnet RPC reported `NOT_OBSERVED` for this historical transaction during the check. The official archival endpoint returned the finalized result and inclusion block. These checks sent no transactions and read no private keys.

## Coverage limits

Nearblocks availability and indexing delay affect reference discovery. An account transaction endpoint is not a guarantee that every incoming receipt, fungible-token event, or multi-token event appears as a separate row. The implementation does not merge index references into finalized contract history, infer missing purchase hashes from opening IDs, or claim that a loaded page is a complete wallet ledger. Paging continues only while the upstream service supplies a cursor.

Receipt verification can remain unavailable when both public RPC providers reject or time out on a historical read. Existing contract history and already verified local receipts remain separate from that failure. Implicit hexadecimal account IDs cannot use this named `.testnet` account proxy.

## Verification and primary references

`npx vitest run tests/case-indexer.test.ts` checks request validation, the fixed endpoint and cursor translation, body and rate limits, archival fallback, cancellation, receipt failure, malformed receipt graphs, and the stripped real finalized transaction fixture.

- [Nearblocks Testnet OpenAPI schema](https://api-testnet.nearblocks.io/openapi.json) defines `/v3/accounts/{account}/txns`, `limit`, and `next`.
- [Nearblocks Testnet API documentation](https://api-testnet.nearblocks.io/api-docs/) hosts the schema reference.
- [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions) describes `tx`, final execution states, and receipt outcomes.
- [NEAR block RPC](https://docs.near.org/api/rpc/block-chunk) describes inclusion block queries.
- [NEP-300 fungible-token events](https://github.com/near/NEPs/blob/master/neps/nep-0300.md) defines the `nep141` event payload and `ft_transfer` events.
