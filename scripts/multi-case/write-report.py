"""Render the consolidated report from recorded verification and registries."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def units(raw, decimals=6):
    value = int(raw)
    sign = '-' if value < 0 else ''
    value = abs(value)
    scale = 10 ** decimals
    fraction = str(value % scale).rjust(decimals, '0').rstrip('0')
    return sign + str(value // scale) + ('.' + fraction if fraction else '')


def main():
    load = lambda path: json.loads((ROOT / path).read_text())
    catalog = load('config/cases.testnet.json')
    tokens = load('config/tokens.testnet.json')
    batch = load('docs/multi-case/deployment-batch.json')
    live = load('docs/multi-case/live-preflight.json')
    verify = load('docs/multi-case/verification.json')
    simulation = load('docs/multi-case-simulation.json')
    by_case = {c['case_id']: c for c in simulation['cases']}
    digest = (ROOT / 'docs/multi-case/deployment-batch.sha256').read_text().strip()
    approval_path = ROOT / 'docs/multi-case/approval.json'
    approval = json.loads(approval_path.read_text()) if approval_path.exists() else None
    if approval and approval['batchSha256'] != digest:
        raise RuntimeError('Approval does not match the exact deployment batch')
    execution_path = ROOT / 'docs/multi-case/execution.json'
    execution = json.loads(execution_path.read_text()) if execution_path.exists() else None
    if execution and execution['manifest_sha256'] != digest:
        raise RuntimeError('Execution journal does not match the approved batch')
    lines = [
        '# Iroh five-case implementation and Testnet report', '',
        'Prepared November 11, 2026. The local implementation is verified. Public Testnet still runs the original USDI-only Dragon Tea contract. Its bonus upgrade, four new cases and nine new mock deployments remain unsubmitted pending the bounded approval and native funding described below. No new case is claimed live.', '',
        '## Implemented collection', '',
        'All cases stay inside Host → Tea Cases in the existing 3D tea house and animated parchment. Planned cases have exact configured reward previews and disabled signing. Deployed cases read live prices, quotes, balances, inventory and settlement state. The reel displays a validated recorded result. Case selection, refresh recovery, independent read failures, wallet finality and return navigation are covered by tests.', '',
    ]
    for case in catalog['cases']:
        config = case['config']
        economy = config['economy']
        result = by_case[case['id']]
        lines += [f"### {case['name']}", '',
            f"Price {units(economy['price'])} USDI. Common/Rare/Legendary USDI payouts are "
            + ' / '.join(units(r) for r in economy['rewards'])
            + f". Target available liquidity is {units(economy['target'])} USDI. Maximum USDI exposure per admitted opening is {units(economy['rewards'][2])} USDI.", '',
            f"Contract `{case['contractId']}`. Status: " + ('existing live USDI case; bonus activation pending' if case['id'] == 'dragon-tea' else 'proposed, not deployed') + '.', '',
            'Bonus quantities by tier:', '']
        for tier, name in enumerate(['Common', 'Rare', 'Legendary']):
            rewards = [r for r in config['bonus_rewards'] if r['tier'] == tier]
            text = ', '.join(f"{units(r['amount'], r['token_decimals'])} {r['token_symbol']}" for r in rewards)
            lines.append(f'- {name}: {text}.')
        lines += ['', 'The tier has a 50% bonus chance. When several candidates share a tier, one is selected uniformly, so each has conditional probability `1/(2k)` for `k` candidates. All bonus quantities are unofficial mocks with no USD valuation.', '',
            'At target liquidity, Common/Rare/Legendary probability counts are `'
            + ' / '.join(str(p) for p in result['target_probabilities'])
            + '` out of `1,000,000`. These are reference values, not a quote for current public liquidity.', '']
    lines += ['## Token identities and deployment status', '',
        'USDI remains the payment and base reward token with six decimals. Twelve bonus mocks are supported. The existing SHITZU, RHEA and AURORA deployments retain six decimals, even where canonical Mainnet tokens have different precision. New mocks use the verified precision below. Every mock has a fixed initial supply of 100,000 whole units and no post-initialization mint method.', '']
    for token in tokens['tokens']:
        if token['selection'] == 'included':
            lines.append(f"- {token['symbol']}: {token['decimals']} decimals, `{token['contractId']}`, {token['status']}.")
    lines += ['', 'wNEAR, STNEAR, LINEAR and rNEAR mocks do not wrap, stake, redeem, produce yield or carry backing. META is excluded as deprecated, SWEAT because of its announced sunset, and LONK/UWON because current primary-source identity could not be adequately established. [Token research](../token-identities.md) records exact canonical IDs, primary sources, metadata snapshots, duplicate-symbol risks and exclusion reasons.', '',
        'Thirteen distinct dedicated keys were generated directly into macOS Keychain for the nine token and four case accounts. Only public key records are stored in the repository. Existing account permissions were not changed. Account FullAccess keys retain the protocol ability to replace code, even though the token contract exposes no admin mint method.', '',
        '## Probability definitions and solvency', '',
        'Let `D=1,000,000`, `A=pool-reserved`, opening price `P`, target liquidity `T`, and USDI rewards `r0<r1<r2`. Each exact payment puts `19P/20` in the pool and `P/20` in pending fees. Configured prices are divisible by 20 base units.', '',
        'New cases interpolate a floored target EV `E(A)` and Legendary probability count `L(A)` over pool intervals `[0,T]` and `[T,2T]`, then hold them constant. EV endpoints in basis points of price are Bamboo `7000/9500/11500`, Moon `5000/9500/16000`, Phoenix `4000/9500/18000`, Reserve `6500/9500/16500`. Legendary counts at the same endpoints are Bamboo `1000/15000/30000`, Moon `5000/40000/100000`, Phoenix `2000/30000/70000`, Reserve `3000/45000/85000`.', '',
        'The solver is `R=floor((D*E-D*r0-(r2-r0)*L)/(r1-r0))`, `C=D-R-L`. Actual EV is `(r0*C+r1*R+r2*L)/D`. Configuration validation proves positive normalized counts over both intervals with a rounding margin and bounded u128 arithmetic. At target liquidity, target EV is exactly 95% of price before Rare flooring.', '',
        "Dragon's function is preserved exactly: `B=min(A,2000000000)`, `E=clamp(450000+floor(B/2000),600000,1400000)`, `L=clamp(saturating_sub(floor(B/10000),50000),10000,150000)`, followed by the same normalization solver with Dragon's rewards. All amounts here are USDI base units.", '',
        'Admission requires enough available USDI to reserve the maximum payout before counting the incoming contribution. It also reserves every possible bonus candidate. Selection releases unused reserves; successful callbacks subtract matching funds and liabilities, while failed legs retain both. Only unpaid legs can be retried. Fees vest only when all selected legs settle. Each account physically isolates its pool and inventory.', '',
        'The deterministic simulation ran 25,000,000 attempted openings across empty, minimum, low, target and excess liquidity, plus maximum-payout streaks, concurrent reservations, failed callbacks and bonus depletion. Exact conservation and safe admission stops passed. [The mathematical report](../multi-case-economics.md) supplies the rounding proof, bounds and maximum exposure analysis; [simulation data](../multi-case-simulation.json) records every scenario.', '',
        '## Randomness and security', '',
        'The contract uses NEAR protocol randomness in a later receipt, with account/opening/accepted-height hashing and rejection sampling. Separate domains select bonus presence and candidate. A recorded draw is immutable; retry and duplicate callbacks cannot redraw or settle twice. Validator influence, receipt timing, censorship and undrawn-opening scheduling remain assumptions. This is not claimed to be an adversarially fair application VRF. [The randomness analysis](../multi-case-randomness.md) documents the exact rejection and recovery limits.', '',
        'Independent review by gpt-6-astra found no blocking contract accounting or cross-case settlement defect. It found two deployment-preparation defects, acceptance of reordered Dragon tokens and extra Dragon keys. Both are fixed with regression tests. Base58 byte-length validation and new-token funding bounds were tightened too. The indexer received a separate review with no actionable finding. This review is not a public-chain deployment or a real HOT wallet test.', '',
        '## Shelf history', '',
        'The Shelf aggregates finalized records by case contract, case ID and nonce. Details displays case identity, price, tier, reward, settlement state, contract and transaction information where available. Paginated history can load the full per-account opening chain after upgrade; the current V1 API returns the latest 20. Locally saved verified receipts remain bounded to 60 per deployment and browser. Missing hashes remain unavailable.', '',
        'Wallet references use the read-only NearBlocks v3 proxy with cursor pagination. They remain labeled unverified until Details checks the transaction, complete finalized receipt graph, inclusion block and successful NEP-141 event executors through RPC. Historical reads have a fixed archival fallback. Public evidence loaded 10+7 distinct references and verified the original Dragon opening transaction through 12 receipt outcomes, including the real USDI purchase and payout. Indexer coverage can be delayed or omit incoming interactions. This is not a claim of a complete wallet-to-wallet ledger. [Indexer evidence and limits](../multi-case-indexer.md) explain the boundary. The trader board remains accessible.', '',
        '## Verification results', '']
    for key in ['rust', 'vitest', 'deployment', 'browserDevelopment', 'browserProduction', 'typecheck', 'productionBuild', 'sandbox', 'simulation']:
        lines.append(f"- {verify[key]}")
    lines += ['', verify['priorFailures']]
    lines += ['', 'Browser wallet and mutation coverage uses fixture signing and RPC responses. Sandbox uses real local NEP-141 receipts. Neither establishes real HOT Connect signing on public Testnet. Full browser tests run with development camera diagnostics; the production subset covers cases, wallets, roulette and Shelf. The deleted optional account page was restored from its previous implementation after the full suite exposed its broken documented link. Production session cookies remain secure.', '',
        'The final contract verification records before/after artifact hashes around all Rust, Sandbox and simulation steps. [Evidence files](evidence/) include the logs, public-chain snapshots, live indexer verification and visual inspection screenshots.', '',
        '## Public Testnet state and authorized action', '',
        f"At finalized block `{live['block_height']}`, Dragon remains revision 13, unpaused, with 995.8 USDI available, 0.2 USDI vested fees, no pending liabilities and the original four completed openings. Historical payouts total 8 USDI. Existing live addresses are USDI `usdi-needmore-1-near.testnet`, case `cases-needmore-1-near.testnet`, and the three existing mock IDs listed above.", '',
        'The only new submitted transaction is the previously approved SHITZU storage registration: [9oNjXJASSDQgdu3vh4eZuZYMgkiW1fLpcnkaftEksvPq](https://testnet.nearblocks.io/txns/9oNjXJASSDQgdu3vh4eZuZYMgkiW1fLpcnkaftEksvPq). It used the dedicated case signer, 30 Tgas and exactly 0.00125 NEAR. Finalized receipt and storage verification passed. No new paid opening, migration, funding or unpause was submitted.', '',
        '## Bounded batch requiring approval', '',
        f"The exact proposal is [deployment-batch.json](deployment-batch.json), SHA-256 `{digest}`. Its 90 transactions cover thirteen account creations, fourteen deployments or upgrades, twenty-eight storage registrations, twenty-nine inventory funding calls, Dragon pausing and five unpauses. Every account, public key, WASM checksum, initializer, migration argument, raw transfer amount, recipient, gas and deposit is specified. [Deployment review](deployment-review.md) and [individual command templates](deployment-commands.txt) describe sequencing and finalized preconditions.", '',
        f"The maximum native expenditure is **{units(batch['budget']['maximumNativeExpenditureYocto'], 24)} test NEAR**, including {units(batch['budget']['attachedDepositsYocto'], 24)} in attached deposits and {units(batch['budget']['maximumFeesYocto'], 24)} in maximum fees. New case USDI funding is exactly **1,000 USDI**, allocated 50/150/300/500. Bonus funding covers 100 possible payouts per candidate, including the original Dragon allocations.", '',
        f"The owner currently has {units(live['owner']['amount'], 24)} test NEAR and 1,004 USDI. Meeting the conservative batch ceiling requires at least **{units(int(batch['budget']['maximumNativeExpenditureYocto']) - int(live['owner']['amount']), 24)} additional test NEAR**. No unspecified faucet or funding transaction is included. The batch is unapproved and not ready for execution until approval and adequate native funds exist.", '',
        'Case WASM SHA-256: `' + batch['artifacts']['case']['sha256'] + '`. Mock WASM SHA-256: `' + batch['artifacts']['mock']['sha256'] + '`. Exact binaries are archived under `artifacts/testnet/`. USDI is not upgraded.', '',
        '## Remaining work that requires authorization or external state', '',
        '1. Fund the known owner account to the reviewed execution ceiling and approve the exact bounded batch.',
        '2. Execute its dependency chains, stopping affected operations if code, keys, revision, storage costs or finality differ from the reviewed conditions.',
        '3. Verify actual deployed code, all legacy records, inventories, receipts and unpaused quotes; only then update verified deployment status.',
        '4. Obtain bounded approval for any real user claim/opening not included in this batch and verify real HOT signing and new public Testnet payouts. No new case is currently represented as live.', '',
        '## Commits and changed files', '',
        'Branch: `codex/multi-case-testnet-expansion`. No merge, push, reset or history rewrite was performed. Pre-existing unrelated working changes were preserved.', '']
    for commit in verify.get('commits', []):
        lines.append(f"- `{commit['hash']}`: {commit['subject']}")
    lines += ['', 'Changed task files are listed in [changed-files.txt](changed-files.txt).', '']
    report = '\n'.join(lines)
    if approval:
        report = report.replace('remain unsubmitted pending the bounded approval and native funding described below.',
            'remain unsubmitted pending native funding. The user has approved the exact bounded batch once funded.')
        report = report.replace('## Bounded batch requiring approval', '## Approved bounded batch awaiting funding')
        report = report.replace('The batch is unapproved and not ready for execution until approval and adequate native funds exist.',
            'The exact batch is approved once funded. No approval needs to be repeated if all approved parameters and fresh preconditions still match. Native funding remains insufficient, and no further transaction has been submitted. See [the approval record](approval.json) and [the fresh public preflight](approved-preflight.json).')
        report = report.replace('1. Fund the known owner account to the reviewed execution ceiling and approve the exact bounded batch.',
            '1. Fund the known owner account to the reviewed execution ceiling. Conditional approval for this exact batch is already recorded.')
        report = report.replace('4. Obtain bounded approval for any real user claim/opening', '4. Obtain separate bounded approval for any real user claim/opening')
    if execution:
        current = load('docs/multi-case/execution-preflight.json')
        verified = [(step_id, record) for step_id, record in execution['steps'].items() if record['status'] == 'verified']
        fees = int(execution['actual_fees_yocto'])
        steps = {step['id']: step for step in batch['steps']}
        deposits = sum(int(action.get('deposit', 0)) for step_id, _ in verified for action in steps[step_id]['actions'])
        registrations = sum(int(action.get('deposit', 0)) for step_id, _ in verified for action in steps[step_id]['actions'] if action.get('methodName') == 'storage_deposit')
        dragon = current['cases']['dragon-tea']
        pool = dragon['pool']
        upgraded = execution['steps'].get('dragon-upgrade', {}).get('status') == 'verified'
        activated = execution['steps'].get('unpause-dragon-tea', {}).get('status') == 'verified'
        state = 'active with funded bonuses' if activated else 'migrated and paused for inventory funding' if upgraded else 'awaiting migration'
        blocker = 'Meteor blocks the approved new-account FullAccess AddKey actions. The owner CLI signer is still unavailable in Keychain. The four new cases and nine new token accounts remain undeployed.'
        intro = f"The approved Testnet deployment is partially executed: {len(verified)} of {len(batch['steps'])} steps are finalized and verified. Dragon is {state}. {blocker} Funding is sufficient."
        paragraphs = report.split('\n')
        for i, paragraph in enumerate(paragraphs):
            if paragraph.startswith('Prepared November 11, 2026.'):
                paragraphs[i] = 'Updated November 12, 2026. ' + intro
            elif paragraph.startswith('The owner currently has '):
                paragraphs[i] = f"The finalized owner balance is {units(current['owner']['amount'], 24)} test NEAR and {units(current['owner_usdi'])} USDI at block {current['block_height']}. No top-up or replacement batch approval is needed. {blocker}"
            elif paragraph.startswith('At finalized block `'):
                paragraphs[i] = f"At finalized block {current['block_height']}, Dragon is revision {pool['revision']}, paused={str(pool['paused']).lower()}, with {units(pool['available'])} USDI available, {units(pool['treasury_available'])} USDI vested fees, {pool['pending_openings']} pending openings and {pool['completed_payouts']} completed payouts. Historical payouts total {units(pool['total_paid'])} USDI. The pinned migration preserved the legacy opening and credit records."
            elif paragraph.startswith('The only new submitted transaction is '):
                paragraphs[i] = 'The previously approved SHITZU registration remains finalized. Additional completed transactions are listed below. No paid opening, claim, Mainnet transaction or treasury withdrawal was submitted.'
            elif paragraph.startswith('1. Fund the known owner account '):
                paragraphs[i] = '1. Make the existing approved owner signer available through a trusted local signing workflow that supports the approved new-account actions. Meteor explicitly blocks them; its protection was not bypassed. Do not disclose private keys, passwords or seed phrases in chat.'
            elif paragraph.startswith('Contract `cases-needmore-1-near.testnet`. Status:'):
                paragraphs[i] = f"Contract `cases-needmore-1-near.testnet`. Status: {state}."
        report = '\n'.join(paragraphs).replace('## Approved bounded batch awaiting funding', '## Approved bounded batch and execution status')
        if upgraded:
            report = report.replace('the current V1 API returns the latest 20', 'the historical V1 API returned the latest 20; Dragon now runs the paginated implementation')
        progress = ['## Verified execution progress', '', intro, '']
        for step_id, record in verified:
            step = steps[step_id]
            attached = sum(int(a.get('deposit', 0)) for a in step['actions'])
            progress.append(f"- `{step_id}`: [transaction `{record['tx_hash']}`](https://testnet.nearblocks.io/txns/{record['tx_hash']}), FINAL; fee {units(record['actual_fee_yocto'], 24)} test NEAR; attached {units(attached, 24)} test NEAR.")
        progress += ['', f"Actual transaction fees total {units(fees, 24)} test NEAR. Verified attached deposits total {units(deposits, 24)} test NEAR, including {units(registrations, 24)} for token registrations. Total native outflow is {units(deposits + fees, 24)} test NEAR. Storage backing retained in Dragon's existing account is {units(int(dragon['account']['storage_usage']) * int(current['storage_amount_per_byte']), 24)} test NEAR for {dragon['account']['storage_usage']} bytes; this is retained balance, not an additional transfer.", '', verify['executionHelper'], '', '### Finalized Dragon inventory', '']
        for row in dragon.get('reward_inventory', []):
            progress.append(f"- `{row['token_contract_id']}`: raw funds `{row['funds']}`, reserved `{row['reserved']}`, in flight `{row['in_flight']}`. The journal verifies actual token balances against each book increment.")
        progress += ['', f"At finalized block {current['block_height']}, Dragon's {units(pool['available'])} USDI pool, {units(pool['treasury_available'])} USDI vested fees and {pool['completed_payouts']} completed opening records remain intact. All thirteen proposed account names remain absent. SHITZU, RHEA and AURORA have the required Dragon storage registration.", '', f"The owner-specific quote currently reports can_open={str(dragon['quote']['can_open']).lower()} with reason `{dragon['quote']['reason']}`. The pool is healthy and admits openings once the normal user storage prepayment is satisfied. That prepayment and a paid opening are outside this batch and were not submitted.", '', 'The canonical journal is [execution.json](execution.json), with append-only events in [execution-journal.jsonl](execution-journal.jsonl) and raw finalized receipt files alongside it. The approved manifest and checksum remain unchanged. Ambiguous requests cannot be resubmitted automatically.', '', 'Chrome access was enabled, and the existing Meteor Testnet owner signed the approved Dragon calls. The blocked BLACKDRAGON request was canceled without broadcast. Meteor signing does not establish real HOT Connect signing or a new public paid opening.', '', 'The deployment receipt code field is the SHA-256 digest in [nearcore ActionView](https://github.com/near/nearcore/blob/master/core/primitives/src/views.rs). The verifier now handles that representation and still independently downloads and hashes the deployed bytecode before accepting deployment.', '']
        report = report.replace('## Commits and changed files', '\n'.join(progress) + '\n## Commits and changed files')
    (ROOT / 'docs/multi-case/report.md').write_text(report)


if __name__ == '__main__':
    main()
