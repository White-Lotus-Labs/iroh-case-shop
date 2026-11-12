# Open a case in the activated Testnet app

This is the manual functional check for the activated release. Consult `deployment-state.json` for the recorded deployment status. These are real Testnet wallet actions, separate from controlled browser fixtures. A person authorizes their own wallet actions; an agent must obtain a bounded scope before submitting test transactions on that person's behalf.

1. Open the Tea Cases collection through the top navigation or `/?collection=tea`.
2. Connect a NEAR Testnet wallet. Application nickname/password login is not required for case play.
3. Keep native Testnet NEAR in the wallet for gas and storage. USDI is the separate payment token.
4. Inspect a case. The five opening prices are 0.5, 1, 2, 5, and 10 USDI for Bamboo, Dragon, Moon, Phoenix, and Reserve.
5. If eligible, select **Claim 1,000 USDI** and approve the displayed claim-storage deposit and gas. The starter is available once per account, across all cases. An account that already claimed cannot claim again.
6. If the app reports an unregistered USDI account, select **Register USDI account** and confirm the displayed storage deposit.
7. Select **Prepay opening storage** when required. This is separate credit for the selected case, not the USDI token registration. Each case has its own storage credit.
8. Wait for refreshed balance, pool, and account quote. Select **Open Case** and approve the exact USDI payment to the selected case through `ft_transfer_call`.
9. Wait for verified finality and the recorded outcome. Confirm the reel result, USDI balance change, and Activity Ledger entry agree.
10. On a failed bonus payout, follow the offered token-registration and recovery actions. Recovery retains the original draw and pays only outstanding legs. Do not open another case to recover a failed payment.

If the wallet returns no hash or RPC times out, refresh and reconcile the saved action before signing another payment. Switching cases or wallets must not resubmit the previous action. A stale quote can refund the USDI payment; wait for the verified result and refresh before trying again.

The deployment owner funds the case pools and is not a pre-funded player test fixture. After allocating the approved 1,000 USDI, its expected remaining balance is 4 USDI. Do not mistake an insufficient player balance for an inactive case or bypass the one-time faucet marker. A new eligible player account can claim the normal starter.

All assets here are unofficial Testnet assets with no real monetary value. Formal security audit and a new real-wallet public payout verification are separate from the automated fixture and local Sandbox checks.
